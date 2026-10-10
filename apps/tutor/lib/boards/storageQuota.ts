import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

export const MAX_ACCOUNT_STORAGE_BYTES = 1024 * 1024 * 1024;
export const MAX_ACCOUNT_BOARDS = 200;
export const MAX_ACCOUNT_TURNS = 1000;
export const MAX_BOARD_TURNS = 100;
export const MAX_BOARD_TITLE_CHARS = 200;
export const MAX_BOARD_PREVIEW_CHARS = 2000;
export const BOARD_PAGE_SIZE = 100;

export class StorageQuotaError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 | 413 | 429 = 413) {
    super(message);
    this.name = "StorageQuotaError";
  }
}

/** All account storage admissions share a DB lock, including concurrent saves. */
export async function withUserStorageLock<T>(
  userId: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (!users.length) throw new StorageQuotaError("account not found", 404);
    return run(tx);
  });
}

async function storageRow(tx: Prisma.TransactionClient, userId: string) {
  const existing = await tx.userStorage.findUnique({ where: { userId } });
  if (existing) return existing;
  // Older rows predate exact byte accounting. Charge the legacy per-audio
  // ceiling rather than treating all existing media as free storage. Future
  // records carry exact storageBytes. A reconciler may replace this upper bound
  // with measured object sizes without weakening admission during migration.
  const stored = await tx.turn.aggregate({ where: { userId }, _sum: { storageBytes: true } });
  const notes = await tx.boardChatMessage.aggregate({ where: { userId }, _sum: { storageBytes: true } });
  const legacyTurns = await tx.turn.count({ where: { userId, storageBytes: 0 } });
  const legacyAudioCount = await tx.segment.count({
    where: { turn: { userId, storageBytes: 0 }, audioUrl: { not: null } },
  });
  const reservedBytes = (stored._sum.storageBytes ?? 0n) + (notes._sum.storageBytes ?? 0n) +
    BigInt(legacyTurns) * BigInt(256 * 1024) + BigInt(legacyAudioCount) * BigInt(8 * 1024 * 1024);
  return tx.userStorage.create({ data: { userId, reservedBytes } });
}

export async function ensureStorageAccounting(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await storageRow(tx, userId);
}

export async function boardStorageBytes(tx: Prisma.TransactionClient, boardId: string): Promise<bigint> {
  const turns = await tx.turn.aggregate({ where: { boardId }, _sum: { storageBytes: true } });
  const notes = await tx.boardChatMessage.aggregate({ where: { boardId }, _sum: { storageBytes: true } });
  const legacyTurns = await tx.turn.count({ where: { boardId, storageBytes: 0 } });
  const legacyAudio = await tx.segment.count({ where: { turn: { boardId, storageBytes: 0 }, audioUrl: { not: null } } });
  return (turns._sum.storageBytes ?? 0n) + (notes._sum.storageBytes ?? 0n) +
    BigInt(legacyTurns) * BigInt(256 * 1024) + BigInt(legacyAudio) * BigInt(8 * 1024 * 1024);
}

function checkBytes(current: bigint, incoming: number): void {
  if (!Number.isSafeInteger(incoming) || incoming < 0 || current + BigInt(incoming) > BigInt(MAX_ACCOUNT_STORAGE_BYTES)) {
    throw new StorageQuotaError("account storage quota exceeded");
  }
}

export async function reserveStorageBytes(userId: string, bytes: number): Promise<void> {
  await withUserStorageLock(userId, async (tx) => {
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
  await withUserStorageLock(input.userId, async (tx) => {
    const board = await tx.board.findFirst({ where: { id: input.boardId, userId: input.userId } });
    if (!board) throw new StorageQuotaError("board not found", 404);
    const storage = await storageRow(tx, input.userId);
    const userTurns = await tx.turn.count({ where: { userId: input.userId } });
    const boardTurns = await tx.turn.count({ where: { boardId: input.boardId } });
    // Pending uploads consume both count allowances. Using the account's small
    // pending count for each board is conservative across simultaneous boards.
    if (userTurns + storage.pendingTurns >= MAX_ACCOUNT_TURNS || boardTurns + storage.pendingTurns >= MAX_BOARD_TURNS) {
      throw new StorageQuotaError("turn storage quota exceeded", 429);
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
  await withUserStorageLock(input.userId, async (tx) => {
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
export async function settleTurnStorage(reservation: TurnStorageReservation, refundBytes = false, transaction?: Prisma.TransactionClient): Promise<void> {
  const settle = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM object_deletion_jobs WHERE id = ${reservation.cleanupId}::uuid FOR UPDATE`;
    const intent = await tx.objectDeletionJob.findUnique({ where: { id: reservation.cleanupId } });
    const slots = reservedTurnSlots(reservation);
    if (!intent || intent.userId !== reservation.userId || intent.attempts !== 0 || intent.pendingTurns !== slots || intent.nextAttemptAt <= new Date()) {
      throw new StorageQuotaError("upload reservation expired", 409);
    }
    const storage = await tx.userStorage.findUnique({ where: { userId: reservation.userId } });
    if (!storage) throw new StorageQuotaError("account not found", 404);
    const bytes = refundBytes ? storage.reservedBytes - BigInt(reservation.bytes) : storage.reservedBytes;
    await tx.userStorage.update({
      where: { userId: reservation.userId },
      data: { reservedBytes: bytes > 0n ? bytes : 0n, pendingTurns: Math.max(0, storage.pendingTurns - slots) },
    });
    await tx.objectDeletionJob.delete({ where: { id: reservation.cleanupId } });
  };
  if (transaction) await settle(transaction);
  else await withUserStorageLock(reservation.userId, settle);
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
