/** Public quota seams with an unavailable object-store boundary; no network or production access. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

const app = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const userId = "fallback-fixture-user", boardId = "fallback-fixture-board";
const turnId = "2a420c33-63a2-410d-8583-f222c00e24dc";
const cap = 1024n * 1024n * 1024n, oldCharge = 262144n + 8388608n;
const oldTime = new Date("2026-09-01T00:00:00Z");
const initialTurn = {
  id: turnId, userId, boardId, question: "Retained lesson", rawResponse: "Old explanation",
  storageBytes: 0n, metadataBytes: 0n, updatedAt: oldTime, status: "complete", kind: "lesson",
  segments: [{ orderIndex: 0, audioUrl: `/api/media?key=${encodeURIComponent(`lectures/${boardId}/${turnId}/0.mp3`)}` }],
};
let turn = structuredClone(initialTurn);
let balance = oldCharge, pending = 0, hasLedger = true;
let totalTurns = 1, boardTurns = 1, ownsBoard = true;
let providerAvailable = false, providerReads = 0;
let preflightFails = false, snapshotFails = false, lockFails = false, applyFails = false;
let atAccountLock: (() => void) | null = null;
const jobs: Array<{ id: string; userId: string; prefix: string; bytes: bigint; pendingTurns: number; attempts: number; createdAt: Date; nextAttemptAt: Date }> = [];
const storage = () => hasLedger ? { userId, reservedBytes: balance, pendingTurns: pending } : null;
const db = {
  $queryRaw: async (sql: TemplateStringsArray) => {
    if (sql.join("").includes("FROM users")) {
      if (lockFails) throw new Error("synthetic lock query failure");
      atAccountLock?.(); atAccountLock = null;
    }
    return [{ id: userId }];
  },
  $executeRaw: async (sql: TemplateStringsArray, rows: string) => {
    if (applyFails) throw new Error("synthetic receipt query failure");
    assert(sql.join("").includes("UPDATE turns"));
    const updates: Array<{ id: string; storageBytes: string; metadataBytes: string }> = JSON.parse(rows);
    for (const row of updates) {
      assert.equal(row.id, turn.id);
      turn.storageBytes = BigInt(row.storageBytes); turn.metadataBytes = BigInt(row.metadataBytes);
    }
    return updates.length;
  },
  board: { findFirst: async () => ownsBoard ? { id: boardId, userId } : null,
    findMany: async () => [{ id: boardId }] },
  turn: {
    findMany: async () => { if (snapshotFails) throw new Error("synthetic snapshot query failure"); return [structuredClone(turn)]; },
    count: async ({ where }: { where: { storageBytes?: number; boardId?: string } }) =>
      where.storageBytes === 0 ? (turn.storageBytes === 0n ? 1 : 0) : where.boardId ? boardTurns : totalTurns,
    aggregate: async () => ({ _sum: { storageBytes: turn.storageBytes } }),
    update: async () => { if (applyFails) throw new Error("synthetic receipt query failure"); throw new Error("unbatched receipt update"); },
  },
  boardChatMessage: { findMany: async () => [], count: async () => 0, aggregate: async () => ({ _sum: { storageBytes: 0n } }) },
  userStorage: {
    findUnique: async () => { if (preflightFails) throw new Error("synthetic preflight query failure"); return storage(); },
    create: async ({ data }: { data: { reservedBytes: bigint; pendingTurns: number } }) => {
      hasLedger = true; balance = data.reservedBytes; pending = data.pendingTurns; return storage();
    },
    update: async ({ data }: { data: { reservedBytes?: bigint | { increment: bigint }; pendingTurns?: number | { increment: number } } }) => {
      if (typeof data.reservedBytes === "bigint") balance = data.reservedBytes;
      else if (data.reservedBytes) balance += data.reservedBytes.increment;
      if (typeof data.pendingTurns === "number") pending = data.pendingTurns;
      else if (data.pendingTurns) pending += data.pendingTurns.increment;
      return storage();
    },
  },
  objectDeletionJob: {
    findMany: async () => structuredClone(jobs), findFirst: async () => null,
    aggregate: async () => ({ _sum: { bytes: 0n, pendingTurns: 0 } }),
    create: async ({ data }: { data: Omit<typeof jobs[number], "attempts" | "createdAt"> }) => {
      const job = { attempts: 0, createdAt: new Date(), ...data }; jobs.push(job); return job;
    },
    deleteMany: async () => { throw new Error("fallback must never release cleanup reservations"); },
  },
};
mock.module(resolve(app, "lib/db/prisma.ts"), { namedExports: { prisma: {
  ...db, $transaction: async <T>(run: (tx: typeof db) => Promise<T>) => {
    const before = { balance, pending, hasLedger, turn: structuredClone(turn), jobs: structuredClone(jobs) };
    try { return await run(db); }
    catch (error) {
      balance = before.balance; pending = before.pending; hasLedger = before.hasLedger; turn = before.turn;
      jobs.splice(0, jobs.length, ...before.jobs); throw error;
    }
  },
} } });
mock.module(resolve(app, "lib/object-store/s3.ts"), { namedExports: {
  headObjectSize: async () => { providerReads++; if (!providerAvailable) throw new Error("synthetic HEAD outage"); return { status: "found", bytes: 100 }; },
  listObjectSizes: async () => { providerReads++; if (!providerAvailable) throw new Error("synthetic LIST outage"); return []; },
} });
globalThis.fetch = async () => { throw new Error("network prohibited in fallback fixture"); };
const quota = load(resolve(app, "lib/boards/storageQuota.ts")) as typeof import("../../lib/boards/storageQuota");
const failures: string[] = [];
function reset() {
  turn = structuredClone(initialTurn); balance = oldCharge; pending = 0; hasLedger = true;
  totalTurns = 1; boardTurns = 1; ownsBoard = true; jobs.length = 0;
  providerAvailable = false; providerReads = 0; preflightFails = false; snapshotFails = false;
  lockFails = false; applyFails = false; atAccountLock = null;
}
async function check(name: string, run: () => Promise<void>) {
  reset();
  try { await run(); console.log(`PASS: ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL: ${name}`, error); }
}
const reserve = (bytes = 2048) => quota.reserveTurnStorage({ userId, boardId, turnId: "new-fallback-turn", bytes });
const retryable = (error: unknown) => error instanceof quota.StorageQuotaError && error.status === 503 && error.code === "storage_verification_failed";
const status = (value: number) => (error: unknown) => error instanceof quota.StorageQuotaError && error.status === value;

async function main() {
  await check("provider outage admits affordable new lesson against locked existing ledger without refunds", async () => {
    jobs.push({ id: "held", userId, prefix: `images/${userId}/held.png`, bytes: 300n, pendingTurns: 0,
      attempts: 1, createdAt: oldTime, nextAttemptAt: oldTime }); balance += 300n;
    const before = balance; const result = await reserve();
    assert.equal(balance, before + 2048n); assert.equal(pending, 1); assert.equal(jobs.length, 2);
    assert.equal(result.bytes, 2048); assert.equal(turn.storageBytes, 0n); assert.equal(turn.metadataBytes, 0n);
    assert.equal(turn.updatedAt.getTime(), oldTime.getTime()); assert(providerReads > 0);
  });
  await check("unknown old public host does not block an affordable save or get queried/refunded", async () => {
    turn.segments[0].audioUrl = `https://retired-unconfigured.invalid/lectures/${boardId}/${turnId}/0.mp3`;
    await reserve(); assert.equal(balance, oldCharge + 2048n); assert.equal(providerReads, 0); assert.equal(turn.storageBytes, 0n);
  });
  await check("generic notes/photo byte admission also retains the conservative existing ledger", async () => {
    await quota.reserveStorageBytes(userId, 64); assert.equal(balance, oldCharge + 64n); assert.equal(jobs.length, 0);
  });
  await check("turn growth keeps a durable zero-slot cleanup receipt during an outage", async () => {
    const result = await quota.reserveTurnGrowthStorage({ userId, boardId, turnId, bytes: 512,
      prefix: `lectures/${boardId}/${turnId}/fallbackattempt/` });
    assert.equal(balance, oldCharge + 512n); assert.equal(pending, 0); assert.equal(result.pendingTurns, 0); assert.equal(jobs.length, 1);
  });
  await check("unmeasurable missing ledger stays retryable and creates no budget", async () => {
    hasLedger = false; await assert.rejects(reserve(), retryable); assert.equal(hasLedger, false); assert.equal(jobs.length, 0);
  });
  await check("unmeasurable over-cap ledger cannot admit any positive bytes", async () => {
    balance = cap; await assert.rejects(reserve(), retryable); assert.equal(balance, cap); assert.equal(jobs.length, 0);
  });
  await check("ledger is rechecked under the account lock after the failed measurement", async () => {
    atAccountLock = () => { balance = cap; };
    await assert.rejects(reserve(), retryable); assert.equal(jobs.length, 0);
  });
  await check("fallback still enforces account pending turn slots", async () => {
    totalTurns = 999; pending = 1; await assert.rejects(reserve(), status(429)); assert.equal(jobs.length, 0);
  });
  await check("fallback still enforces board pending turn slots", async () => {
    boardTurns = 100; await assert.rejects(reserve(), status(429)); assert.equal(jobs.length, 0);
  });
  await check("fallback still enforces board ownership", async () => {
    ownsBoard = false; await assert.rejects(reserve(), status(404)); assert.equal(jobs.length, 0);
  });
  await check("oversized/invalid incoming allocation is refused before provider work", async () => {
    await assert.rejects(reserve(Number(cap) + 1), status(413)); await assert.rejects(reserve(-1), status(413)); assert.equal(providerReads, 0);
  });
  await check("unexpected preflight query failures receive coded503 rather than raw500", async () => {
    preflightFails = true; await assert.rejects(reserve(), retryable); assert.equal(jobs.length, 0);
  });
  await check("unexpected snapshot query failures receive coded503 without falling back", async () => {
    snapshotFails = true; await assert.rejects(reserve(), retryable); assert.equal(jobs.length, 0);
  });
  await check("unexpected account lock query failures receive coded503", async () => {
    providerAvailable = true; lockFails = true; await assert.rejects(reserve(), retryable); assert.equal(jobs.length, 0);
  });
  await check("unexpected measured receipt apply query failures receive coded503 and rollback", async () => {
    providerAvailable = true; applyFails = true; await assert.rejects(reserve(), retryable);
    assert.equal(turn.storageBytes, 0n); assert.equal(balance, oldCharge); assert.equal(jobs.length, 0);
  });
  await check("zero-byte preparation does not turn an existing over-cap ledger into free budget", async () => {
    balance = cap + 1n; await quota.prepareStorageAccounting(userId); assert.equal(balance, cap + 1n); assert.equal(turn.storageBytes, 0n);
  });
  await check("shrinking metadata closes clamp an undercounted ledger to zero", async () => {
    balance = 2n; await quota.withUserStorageLock(userId, tx => quota.refundTurnMetadataStorage(tx, userId, 20n));
    assert.equal(balance, 0n); assert.equal(pending, 0); assert.equal(jobs.length, 0);
  });
  await check("shrinking metadata closes do not bootstrap a missing ledger", async () => {
    hasLedger = false; await quota.withUserStorageLock(userId, tx => quota.refundTurnMetadataStorage(tx, userId, 20n)); assert.equal(hasLedger, false);
  });
  assert.deepEqual(failures, []); console.log("verify-storage-admission-fallback: 18 groups passed");
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
