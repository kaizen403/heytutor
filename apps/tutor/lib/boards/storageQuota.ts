import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import {
  applyStorageAccountingPlan,
  historicalTurnStorageCharge,
  measureStorageAccounting,
  readStorageAccountingSnapshot,
  StorageVerificationError,
} from "./storageAccounting";

export const MAX_ACCOUNT_STORAGE_BYTES = 1024 * 1024 * 1024;
export const MAX_ACCOUNT_BOARDS = 200;
export const MAX_ACCOUNT_TURNS = 1000;
export const MAX_BOARD_TURNS = 100;
export const MAX_BOARD_TITLE_CHARS = 200;
export const MAX_BOARD_PREVIEW_CHARS = 2000;
export const BOARD_PAGE_SIZE = 100;

export class StorageQuotaError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 | 413 | 429 | 503 = 413,
    public readonly code?: "storage_verification_failed" | "storage_accounting_changed" | "turn_storage_limit_reached" | "turn_audio_oversized") {
    super(message);
    this.name = "StorageQuotaError";
  }
}

/** All account storage admissions share a DB lock, including concurrent saves. */
export async function withUserStorageLock<T>(
  userId: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeout: number; maxWait: number },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (!users.length) throw new StorageQuotaError("account not found", 404);
    return run(tx);
  }, options);
}

async function storageRow(tx: Prisma.TransactionClient, userId: string) {
  const existing = await tx.userStorage.findUnique({ where: { userId } });
  if (existing) return existing;
  // Measurement is prepared outside this transaction; never bootstrap from
  // fixed audio ceilings or perform object-store I/O while holding the lock.
  const stored = await tx.turn.aggregate({ where: { userId }, _sum: { storageBytes: true } });
  const notes = await tx.boardChatMessage.aggregate({ where: { userId }, _sum: { storageBytes: true } });
  const legacyTurns = await tx.turn.count({ where: { userId, storageBytes: 0 } });
  if (legacyTurns) throw new StorageQuotaError(new StorageVerificationError().message, 503, "storage_verification_failed");
  const pending = await tx.objectDeletionJob.aggregate({ where: { userId }, _sum: { bytes: true, pendingTurns: true } });
  const reservedBytes = (stored._sum.storageBytes ?? 0n) + (notes._sum.storageBytes ?? 0n) + (pending._sum.bytes ?? 0n);
  return tx.userStorage.create({ data: { userId, reservedBytes, pendingTurns: pending._sum.pendingTurns ?? 0 } });
}

/** Measure outside the lock, then apply an unchanged snapshot and admission together. */
async function withMeasuredStorageLock<T>(userId: string, incomingBytes: number, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  checkBytes(0n, incomingBytes);
  const measurementSignal = AbortSignal.timeout(15_000);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (measurementSignal.aborted) throw new StorageQuotaError(new StorageVerificationError().message, 503, "storage_verification_failed");
      const now = new Date();
      const [storage, legacy, legacyNotes, expiredJob] = await Promise.all([
        prisma.userStorage.findUnique({ where: { userId } }),
        prisma.turn.count({ where: { userId, storageBytes: 0 } }),
        prisma.boardChatMessage.count({ where: { userId, storageBytes: 0, content: { not: "" } } }),
        prisma.objectDeletionJob.findFirst({ where: { userId, attempts: 0, nextAttemptAt: { lte: now },
          createdAt: { lte: new Date(now.getTime() - 30 * 60_000) } }, select: { id: true } }),
      ]);
      const needsMeasurement = !storage || legacy > 0 || legacyNotes > 0 || expiredJob !== null ||
        storage.reservedBytes + BigInt(incomingBytes) > BigInt(MAX_ACCOUNT_STORAGE_BYTES);
      let prepared: { snapshot: Awaited<ReturnType<typeof readStorageAccountingSnapshot>>; plan: Awaited<ReturnType<typeof measureStorageAccounting>> } | null = null;
      let measurementFailed = false;
      if (needsMeasurement) {
        // Query failures cannot prove a ledger safe; only provider measurement
        // uncertainty may fall back to an already-held conservative balance.
        const snapshot = await prisma.$transaction(tx => readStorageAccountingSnapshot(tx, userId), { timeout: 30_000, maxWait: 5_000 });
        try {
          prepared = { snapshot, plan: await measureStorageAccounting(snapshot, { signal: measurementSignal }) };
        } catch {
          measurementFailed = true;
        }
      }
      const outcome = await withUserStorageLock(userId, async tx => {
        if (measurementFailed) {
          // Re-read after acquiring the same lock used by every admission. Never
          // refund unverified objects or bootstrap a missing ledger from guesses.
          const existing = await tx.userStorage.findUnique({ where: { userId } });
          if (!existing || (incomingBytes > 0 && existing.reservedBytes + BigInt(incomingBytes) > BigInt(MAX_ACCOUNT_STORAGE_BYTES))) {
            throw new StorageQuotaError(new StorageVerificationError().message, 503, "storage_verification_failed");
          }
        }
        if (prepared && !await applyStorageAccountingPlan(tx, prepared.snapshot, prepared.plan)) return { retry: true as const };
        return { retry: false as const, value: await run(tx) };
      }, { timeout: 30_000, maxWait: 5_000 });
      if (!outcome.retry) return outcome.value;
    }
  } catch (error) {
    if (error instanceof StorageQuotaError) throw error;
    throw new StorageQuotaError(new StorageVerificationError().message, 503, "storage_verification_failed");
  }
  throw new StorageQuotaError(new StorageVerificationError().message, 503, "storage_verification_failed");
}

/** Used before loading a turn for growth. Deletion never requires provider reads. */
export async function prepareStorageAccounting(userId: string): Promise<void> {
  await withMeasuredStorageLock(userId, 0, async () => {});
}

/**
 * Transfer a removed board's already-held allocation to its cleanup receipt.
 * Caller holds account and board locks; no provider read or refund occurs here.
 * A historical allocation can be transferred only when the whole old baseline
 * is covered. An inconsistent smaller cache keeps its unknown residual, while
 * recorded receipts and other cleanup jobs always impose a lower floor.
 */
export async function boardDeletionStorageBytes(tx: Prisma.TransactionClient, userId: string, boardId: string): Promise<bigint> {
  await tx.$queryRaw`SELECT id FROM object_deletion_jobs WHERE user_id = ${userId} FOR UPDATE`;
  const [storage, turns, notes, jobs] = await Promise.all([
    tx.userStorage.findUnique({ where: { userId } }),
    tx.turn.findMany({ where: { userId }, select: { boardId: true, storageBytes: true,
      _count: { select: { segments: { where: { audioUrl: { not: null } } } } } } }),
    tx.boardChatMessage.findMany({ where: { userId }, select: { boardId: true, storageBytes: true } }),
    tx.objectDeletionJob.aggregate({ where: { userId }, _sum: { bytes: true, pendingTurns: true } }),
  ]);
  const noteBytes = notes.reduce((sum, note) => sum + note.storageBytes, 0n);
  const jobBytes = jobs._sum.bytes ?? 0n;
  const recorded = turns.reduce((sum, turn) => sum + turn.storageBytes, 0n) + noteBytes + jobBytes;
  const historicalCharge = (turn: typeof turns[number]) => historicalTurnStorageCharge({
    storageBytes: turn.storageBytes, audioReferences: turn._count.segments,
  });
  const historical = turns.reduce((sum, turn) => sum + historicalCharge(turn), 0n) + noteBytes + jobBytes;
  const coveredHistorical = !storage || storage.reservedBytes >= historical;
  if (!storage) {
    await tx.userStorage.create({ data: { userId, reservedBytes: historical, pendingTurns: jobs._sum.pendingTurns ?? 0 } });
  } else if (storage.reservedBytes < recorded) {
    await tx.userStorage.update({ where: { userId }, data: { reservedBytes: recorded } });
  }
  return turns.filter(turn => turn.boardId === boardId).reduce((sum, turn) =>
    sum + (coveredHistorical ? historicalCharge(turn) : turn.storageBytes), 0n) +
    notes.filter(note => note.boardId === boardId).reduce((sum, note) => sum + note.storageBytes, 0n);
}

function checkBytes(current: bigint, incoming: number): void {
  if (!Number.isSafeInteger(incoming) || incoming < 0 || (incoming > 0 && current + BigInt(incoming) > BigInt(MAX_ACCOUNT_STORAGE_BYTES))) {
    throw new StorageQuotaError("account storage quota exceeded");
  }
}

export async function reserveStorageBytes(userId: string, bytes: number): Promise<void> {
  await withMeasuredStorageLock(userId, bytes, async (tx) => {
    const storage = await storageRow(tx, userId);
    checkBytes(storage.reservedBytes, bytes);
    await tx.userStorage.update({ where: { userId }, data: { reservedBytes: { increment: BigInt(bytes) } } });
  });
}

export async function releaseStorageBytes(userId: string, bytes: bigint | number): Promise<void> {
  if (BigInt(bytes) <= 0n) return;
  await withUserStorageLock(userId, async (tx) => {
    const storage = await tx.userStorage.findUnique({ where: { userId } });
    if (!storage) return;
    const remaining = storage.reservedBytes - BigInt(bytes);
    await tx.userStorage.update({ where: { userId }, data: { reservedBytes: remaining > 0n ? remaining : 0n } });
  });
}

export interface TurnStorageReservation {
  userId: string;
  bytes: number;
  cleanupId: string;
  /** Turn slots the intent holds: 1 for a new turn, 0 for growth of a saved one. Absent means 1. */
  pendingTurns?: 0 | 1;
}

function reservedTurnSlots(reservation: TurnStorageReservation): number {
  return reservation.pendingTurns ?? 1;
}

const UPLOAD_RECOVERY_MS = 30 * 60_000;

export async function reserveTurnStorage(input: {
  userId: string;
  boardId: string;
  bytes: number;
  turnId: string;
  /**
   * What the cleanup intent may delete if this save is abandoned. Defaults to
   * the whole turn folder. A checkpoint save passes its own attempt folder: a
   * retried create of the same turn must never share a prefix with an
   * abandoned attempt, or the worker would delete the retry's clips.
   */
  prefix?: string;
}): Promise<TurnStorageReservation> {
  const cleanupId = randomUUID();
  await withMeasuredStorageLock(input.userId, input.bytes, async (tx) => {
    const board = await tx.board.findFirst({ where: { id: input.boardId, userId: input.userId } });
    if (!board) throw new StorageQuotaError("board not found", 404);
    const storage = await storageRow(tx, input.userId);
    const userTurns = await tx.turn.count({ where: { userId: input.userId } });
    const boardTurns = await tx.turn.count({ where: { boardId: input.boardId } });
    // Pending uploads consume both count allowances. Using the account's small
    // pending count for each board is conservative across simultaneous boards.
    if (userTurns + storage.pendingTurns >= MAX_ACCOUNT_TURNS || boardTurns + storage.pendingTurns >= MAX_BOARD_TURNS) {
      throw new StorageQuotaError("Your saved lesson limit has been reached. Delete an old lesson and try saving again.", 429, "turn_storage_limit_reached");
    }
    checkBytes(storage.reservedBytes, input.bytes);
    await tx.userStorage.update({
      where: { userId: input.userId },
      data: { reservedBytes: { increment: BigInt(input.bytes) }, pendingTurns: { increment: 1 } },
    });
    await tx.objectDeletionJob.create({ data: {
      id: cleanupId, prefix: input.prefix ?? `lectures/${input.boardId}/${input.turnId}/`, userId: input.userId,
      bytes: BigInt(input.bytes), pendingTurns: 1, nextAttemptAt: new Date(Date.now() + UPLOAD_RECOVERY_MS),
    } });
  });
  return { userId: input.userId, bytes: input.bytes, cleanupId, pendingTurns: 1 };
}

/**
 * Charge the bytes a saved turn grows by (new audio plus metadata growth). It
 * takes the same account lock and byte check as a new turn, but holds no turn
 * slot: the turn already counts. Its cleanup intent covers only `prefix`, the
 * attempt's own folder, so abandoning it never touches earlier clips.
 */
export async function reserveTurnGrowthStorage(input: {
  userId: string;
  boardId: string;
  turnId: string;
  bytes: number;
  prefix: string;
}): Promise<TurnStorageReservation> {
  const turnPrefix = `lectures/${input.boardId}/${input.turnId}/`;
  if (!input.prefix.startsWith(turnPrefix) || input.prefix === turnPrefix) {
    throw new StorageQuotaError("growth cleanup must cover one upload attempt only", 409);
  }
  const cleanupId = randomUUID();
  await withMeasuredStorageLock(input.userId, input.bytes, async (tx) => {
    const board = await tx.board.findFirst({ where: { id: input.boardId, userId: input.userId } });
    if (!board) throw new StorageQuotaError("board not found", 404);
    const storage = await storageRow(tx, input.userId);
    checkBytes(storage.reservedBytes, input.bytes);
    await tx.userStorage.update({
      where: { userId: input.userId },
      data: { reservedBytes: { increment: BigInt(input.bytes) } },
    });
    await tx.objectDeletionJob.create({ data: {
      id: cleanupId, prefix: input.prefix, userId: input.userId,
      bytes: BigInt(input.bytes), pendingTurns: 0, nextAttemptAt: new Date(Date.now() + UPLOAD_RECOVERY_MS),
    } });
  });
  return { userId: input.userId, bytes: input.bytes, cleanupId, pendingTurns: 0 };
}

/** Settle exactly once from the handler after persistence or an abandoned save. */
export async function settleTurnStorage(reservation: TurnStorageReservation, refundBytes = false, transaction?: Prisma.TransactionClient,
  retainedBytes = reservation.bytes): Promise<void> {
  if (!Number.isSafeInteger(retainedBytes) || retainedBytes < 0 || retainedBytes > reservation.bytes) throw new StorageQuotaError("invalid retained storage charge", 409);
  const settle = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM object_deletion_jobs WHERE id = ${reservation.cleanupId}::uuid FOR UPDATE`;
    const intent = await tx.objectDeletionJob.findUnique({ where: { id: reservation.cleanupId } });
    const slots = reservedTurnSlots(reservation);
    if (!intent || intent.userId !== reservation.userId || intent.attempts !== 0 || intent.pendingTurns !== slots || intent.nextAttemptAt <= new Date()) {
      throw new StorageQuotaError("upload reservation expired", 409);
    }
    const storage = await tx.userStorage.findUnique({ where: { userId: reservation.userId } });
    if (!storage) throw new StorageQuotaError("account not found", 404);
    const refund = refundBytes ? reservation.bytes : reservation.bytes - retainedBytes;
    const bytes = storage.reservedBytes - BigInt(refund);
    await tx.userStorage.update({
      where: { userId: reservation.userId },
      data: { reservedBytes: bytes > 0n ? bytes : 0n, pendingTurns: Math.max(0, storage.pendingTurns - slots) },
    });
    await tx.objectDeletionJob.delete({ where: { id: reservation.cleanupId } });
  };
  if (transaction) await settle(transaction);
  else await withUserStorageLock(reservation.userId, settle);
}

/** Refund a saved turn's shrinking metadata inside its account-locked commit. */
export async function refundTurnMetadataStorage(tx: Prisma.TransactionClient, userId: string, bytes: bigint): Promise<void> {
  if (bytes <= 0n) return;
  const storage = await tx.userStorage.findUnique({ where: { userId } });
  if (!storage) return;
  const remaining = storage.reservedBytes - bytes;
  await tx.userStorage.update({ where: { userId }, data: { reservedBytes: remaining > 0n ? remaining : 0n } });
}

/** Leave bytes charged and make the pre-existing cleanup intent due. If the
 * database is unavailable, its original deadline still recovers both charges. */
export async function abandonTurnStorage(reservation: TurnStorageReservation, transaction?: Prisma.TransactionClient): Promise<void> {
  const abandon = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM object_deletion_jobs WHERE id = ${reservation.cleanupId}::uuid FOR UPDATE`;
    const intent = await tx.objectDeletionJob.findUnique({ where: { id: reservation.cleanupId } });
    const slots = reservedTurnSlots(reservation);
    if (!intent || intent.userId !== reservation.userId || intent.attempts !== 0 || intent.pendingTurns !== slots) return;
    const storage = await tx.userStorage.findUnique({ where: { userId: reservation.userId } });
    if (storage && slots > 0) await tx.userStorage.update({ where: { userId: reservation.userId }, data: { pendingTurns: Math.max(0, storage.pendingTurns - slots) } });
    await tx.objectDeletionJob.update({ where: { id: intent.id }, data: { pendingTurns: 0, nextAttemptAt: new Date() } });
  };
  if (transaction) await abandon(transaction);
  else await withUserStorageLock(reservation.userId, abandon);
}
