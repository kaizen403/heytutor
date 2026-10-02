import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export const MAX_ACCOUNT_STORAGE_BYTES = 1024 * 1024 * 1024;
export const MAX_ACCOUNT_BOARDS = 200;
export const MAX_ACCOUNT_TURNS = 1000;
export const MAX_BOARD_TURNS = 100;
export const MAX_BOARD_TITLE_CHARS = 200;
export const MAX_BOARD_PREVIEW_CHARS = 2000;
export const BOARD_PAGE_SIZE = 100;

export class StorageQuotaError extends Error {
  constructor(message: string, public readonly status: 403 | 404 | 409 | 413 | 429 = 413) {
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

export interface TurnStorageReservation { userId: string; bytes: number }

export async function reserveTurnStorage(input: {
  userId: string;
  boardId: string;
  bytes: number;
}): Promise<TurnStorageReservation> {
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
  });
  return { userId: input.userId, bytes: input.bytes };
}

/** Settle exactly once from the handler after persistence or an abandoned save. */
export async function settleTurnStorage(reservation: TurnStorageReservation, refundBytes = false, transaction?: Prisma.TransactionClient): Promise<void> {
  const settle = async (tx: Prisma.TransactionClient) => {
    const storage = await tx.userStorage.findUnique({ where: { userId: reservation.userId } });
    if (!storage) return;
    const bytes = refundBytes ? storage.reservedBytes - BigInt(reservation.bytes) : storage.reservedBytes;
    await tx.userStorage.update({
      where: { userId: reservation.userId },
      data: { reservedBytes: bytes > 0n ? bytes : 0n, pendingTurns: Math.max(0, storage.pendingTurns - 1) },
    });
  };
  if (transaction) await settle(transaction);
  else await withUserStorageLock(reservation.userId, settle);
}
