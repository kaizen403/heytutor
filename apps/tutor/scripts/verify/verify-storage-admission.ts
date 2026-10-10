import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const userId = "storage-test-user";
const boardId = "storage-test-board";
const now = new Date(Date.now() - 60 * 60_000);
let reservedBytes = 20n * 262144n + 216n * 8388608n;
let pendingTurns = 0;
const turns = Array.from({ length: 20 }, (_, i) => ({
  id: `storage-test-turn-${i}`, boardId, userId, question: "A fixture question", rawResponse: "A fixture explanation",
  storageBytes: 0n, metadataBytes: 0n, sceneDocument: null, sceneArtifacts: null, validationReport: null,
  sceneEngineVersion: null, visualStatus: "text_only", submittedSegments: null, resumeState: null,
  updatedAt: now, status: "complete", kind: "lesson", speedMultiplier: 1,
  segments: Array.from({ length: i < 16 ? 11 : 10 }, (_, k) => ({
    orderIndex: k, narration: "Fixture", spokenText: "Fixture", command: null, timings: null,
    audioUrl: `/api/media?key=${encodeURIComponent(`lectures/${boardId}/storage-test-turn-${i}/${k}.mp3`)}`,
    audioFormat: "audio/mpeg", durationMs: 1000, audioRef: k,
  })),
}));
const jobs: Array<Record<string, unknown>> = [];
const notes: Array<{ id: string; content: string; storageBytes: bigint; tag: unknown }> = [];
const physicalObjects = new Map<string, number>();
const initialTurns = structuredClone(turns);
let objectMode: "found" | "missing" | "unavailable" = "found";
let objectBytes = 1024;
let headReads = 0;
let prefixReads = 0;
const storage = () => ({ userId, reservedBytes, pendingTurns });
const db = {
  $queryRaw: async () => [{ id: userId }],
  board: { findFirst: async () => ({ id: boardId, userId }), findMany: async () => [{ id: boardId }] },
  turn: {
    findMany: async () => structuredClone(turns),
    count: async ({ where }: { where: { storageBytes?: number } }) => where.storageBytes === 0 ? turns.filter(t => t.storageBytes === 0n).length : turns.length,
    aggregate: async () => ({ _sum: { storageBytes: turns.reduce((sum, t) => sum + t.storageBytes, 0n) } }),
    update: async ({ where, data }: { where: { id: string }; data: { storageBytes: bigint; metadataBytes: bigint } }) => {
      const turn = turns.find(t => t.id === where.id)!; Object.assign(turn, data); return turn;
    },
  },
  boardChatMessage: { findMany: async () => structuredClone(notes), count: async () => notes.filter(note => note.storageBytes === 0n && note.content !== "").length,
    aggregate: async () => ({ _sum: { storageBytes: 0n } }),
    update: async ({ where, data }: { where: { id: string }; data: { storageBytes: bigint } }) => {
      const note = notes.find(row => row.id === where.id)!; Object.assign(note, data); return note;
    },
  },
  segment: { count: async () => 216 },
  userStorage: {
    findUnique: async () => storage(),
    create: async ({ data }: { data: { reservedBytes: bigint } }) => { reservedBytes = data.reservedBytes; return storage(); },
    update: async ({ data }: { data: { reservedBytes?: bigint | { increment: bigint }; pendingTurns?: number | { increment: number } } }) => {
      if (typeof data.reservedBytes === "bigint") reservedBytes = data.reservedBytes;
      else if (data.reservedBytes) reservedBytes += data.reservedBytes.increment;
      if (typeof data.pendingTurns === "number") pendingTurns = data.pendingTurns;
      else if (data.pendingTurns) pendingTurns += data.pendingTurns.increment;
      return storage();
    },
  },
  objectDeletionJob: {
    findMany: async () => structuredClone(jobs),
    findFirst: async () => structuredClone(jobs.find(job => job.attempts === 0 &&
      (job.nextAttemptAt as Date).getTime() <= Date.now() && (job.createdAt as Date).getTime() <= Date.now() - 30 * 60_000) ?? null),
    create: async ({ data }: { data: Record<string, unknown> }) => { const job = { attempts: 0, createdAt: now, ...data }; jobs.push(job); return job; },
    deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
      const before = jobs.length;
      for (let i = jobs.length - 1; i >= 0; i--) if (where.id.in.includes(String(jobs[i].id))) jobs.splice(i, 1);
      return { count: before - jobs.length };
    },
  },
};
mock.module(resolve(root, "lib/db/prisma.ts"), { namedExports: { prisma: {
  ...db, $transaction: async <T>(run: (tx: typeof db) => Promise<T>) => run(db),
} } });
mock.module(resolve(root, "lib/object-store/s3.ts"), { namedExports: {
  headObjectSize: async () => {
    headReads++;
    if (objectMode === "unavailable") throw new Error("fixture denied metadata access");
    return objectMode === "missing" ? { status: "missing" } : { status: "found", bytes: objectBytes };
  },
  listObjectSizes: async (prefix: string) => { prefixReads++;
    return [...physicalObjects].filter(([key]) => key.startsWith(prefix)).map(([key, bytes]) => ({ key, bytes }));
  },
} });
globalThis.fetch = async () => { throw new Error("No network permitted in storage admission fixture"); };
const quota = load(resolve(root, "lib/boards/storageQuota.ts")) as typeof import("../../lib/boards/storageQuota");
const accounting = load(resolve(root, "lib/boards/storageAccounting.ts")) as typeof import("../../lib/boards/storageAccounting");
const snapshot = () => accounting.readStorageAccountingSnapshot(db as never, userId);
function reset() {
  turns.splice(0, turns.length, ...structuredClone(initialTurns));
  jobs.length = 0; notes.length = 0; physicalObjects.clear(); reservedBytes = 20n * 262144n + 216n * 8388608n; pendingTurns = 0;
  objectMode = "found"; objectBytes = 1024; headReads = 0; prefixReads = 0;
}
const failures: string[] = [];
async function check(name: string, run: () => Promise<void>) {
  reset();
  try { await run(); console.log(`PASS: ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL: ${name}`, error); }
}

async function main() {
  await check("account with 20 old lessons and 216 small audio clips can save below the actual quota", async () => {
    await quota.reserveTurnStorage({ userId, boardId, turnId: "new-fixture-turn", bytes: 2048 });
    assert(reservedBytes < 1024n * 1024n);
    assert.equal(pendingTurns, 1); assert.equal(jobs.length, 1);
    assert(turns.every(turn => turn.storageBytes > 0n && turn.metadataBytes > 0n));
  });
  await check("genuinely retained audio beyond 1 GiB is refused before a pending upload is created", async () => {
    objectBytes = 8 * 1024 * 1024;
    await assert.rejects(quota.reserveTurnStorage({ userId, boardId, turnId: "over-quota-turn", bytes: 2048 }),
      (error: unknown) => error instanceof quota.StorageQuotaError && error.status === 413);
    assert.equal(jobs.length, 0);
  });
  await check("403/network metadata failures retain the whole balance and report explicit retryable 503", async () => {
    const before = reservedBytes; objectMode = "unavailable";
    await assert.rejects(quota.reserveTurnStorage({ userId, boardId, turnId: "unverified-turn", bytes: 2048 }),
      (error: unknown) => error instanceof quota.StorageQuotaError && error.status === 503 && error.code === "storage_verification_failed");
    assert.equal(reservedBytes, before); assert.equal(jobs.length, 0);
    assert(headReads <= 8, "failed measurement stops scheduling more objects");
  });
  await check("confirmed missing objects release only stale media charges", async () => {
    objectMode = "missing";
    const plan = await accounting.measureStorageAccounting(await snapshot());
    assert.equal(plan.missingObjects, 216); assert.equal(plan.measuredAudioBytes, 0n);
    assert(plan.afterBytes > 0n, "retained metadata remains charged");
    assert(plan.releasedBytes > 1_800_000_000n);
  });
  await check("canonical and private-held references are deduplicated and held-only clips are retained", async () => {
    turns[0].segments[1].audioUrl = turns[0].segments[0].audioUrl;
    const heldUrl = `/api/media?key=${encodeURIComponent(`lectures/${boardId}/${turns[0].id}/777.mp3`)}`;
    (turns[0] as unknown as { submittedSegments: unknown }).submittedSegments = { v: 1, rows: [
      { audioUrl: heldUrl }, { audioUrl: turns[0].segments[0].audioUrl },
    ] };
    const plan = await accounting.measureStorageAccounting(await snapshot());
    assert.equal(headReads, 216); assert.equal(plan.measuredAudioBytes, 216n * 1024n);
  });
  await check("foreign or external media references are never queried or treated as free", async () => {
    turns[0].segments[0].audioUrl = "/api/media?key=lectures/foreign-board/foreign-turn/0.mp3";
    await assert.rejects(accounting.measureStorageAccounting(await snapshot()), accounting.StorageVerificationError);
    assert.equal(headReads, 0);
  });
  await check("unrepresented image and notes budgets survive measured migration", async () => {
    const extra = 7_000_000n; reservedBytes += extra;
    const plan = await accounting.measureStorageAccounting(await snapshot());
    const measured = plan.turnUpdates.reduce((sum, turn) => sum + turn.storageBytes, 0n);
    assert.equal(plan.afterBytes, measured + extra);
  });
  await check("a cache below old ceiling preserves unexplained image bytes and imposes measured floor", async () => {
    reservedBytes = 777n;
    const plan = await accounting.measureStorageAccounting(await snapshot());
    assert.equal(plan.afterBytes, plan.turnUpdates.reduce((sum, turn) => sum + turn.storageBytes, 0n) + 777n);
  });
  await check("active and claimed recovery receipts retain bytes and pending slots", async () => {
    jobs.push({ id: "active-job", userId, prefix: `lectures/${boardId}/new-turn/`, bytes: 4000n, pendingTurns: 1,
      attempts: 0, nextAttemptAt: new Date(Date.now() + 60_000), createdAt: now });
    jobs.push({ id: "claimed-job", userId, prefix: `lectures/${boardId}/claimed-turn/`, bytes: 5000n, pendingTurns: 1,
      attempts: 1, nextAttemptAt: now, createdAt: now });
    reservedBytes += 9000n; pendingTurns = 2;
    const plan = await accounting.measureStorageAccounting(await snapshot());
    assert.equal(plan.expiredEmptyJobs.length, 0); assert.equal(plan.pendingTurnsAfter, 2); assert.equal(prefixReads, 20);
    assert.equal(plan.afterBytes, plan.turnUpdates.reduce((sum, turn) => sum + turn.storageBytes, 0n) + 9000n);
  });
  await check("only a confirmed empty expired untouched owned prefix can release a stale job", async () => {
    jobs.push({ id: "expired-job", userId, prefix: `lectures/${boardId}/expired-turn/`, bytes: 4000n, pendingTurns: 1,
      attempts: 0, nextAttemptAt: now, createdAt: now });
    reservedBytes += 4000n; pendingTurns = 1;
    const plan = await accounting.measureStorageAccounting(await snapshot());
    assert.deepEqual(plan.expiredEmptyJobs, ["expired-job"]); assert.equal(plan.pendingTurnsAfter, 0); assert.equal(prefixReads, 21);
  });
  await check("changed turn, ledger, or job lease fences a prepared correction", async () => {
    const before = await snapshot(); const plan = await accounting.measureStorageAccounting(before);
    turns[0].rawResponse = "Changed while object metadata was read";
    assert.equal(await accounting.applyStorageAccountingPlan(db as never, before, plan), false);
    assert.equal(turns[0].storageBytes, 0n);
    reset();
    const beforeLedger = await snapshot(); const ledgerPlan = await accounting.measureStorageAccounting(beforeLedger);
    reservedBytes += 1n;
    assert.equal(await accounting.applyStorageAccountingPlan(db as never, beforeLedger, ledgerPlan), false);
    assert.equal(turns[0].storageBytes, 0n);
  });
  await check("a second measured plan is idempotent and does not rewrite exact receipts", async () => {
    const before = await snapshot(); const plan = await accounting.measureStorageAccounting(before);
    assert.equal(await accounting.applyStorageAccountingPlan(db as never, before, plan), true);
    const again = await accounting.measureStorageAccounting(await snapshot());
    assert.equal(again.turnUpdates.length, 0); assert.equal(again.releasedBytes, 0n); assert.equal(again.beforeBytes, again.afterBytes);
  });
  await check("legacy zero-byte notes gain exact UTF-8 receipts once", async () => {
    notes.push({ id: "legacy-note", content: "π = 3.14", storageBytes: 0n, tag: { text: "π" } });
    const before = await snapshot(); const plan = await accounting.measureStorageAccounting(before);
    const expected = BigInt(Buffer.byteLength(notes[0].content) + Buffer.byteLength(JSON.stringify(notes[0].tag)));
    assert.deepEqual(plan.noteUpdates, [{ id: "legacy-note", storageBytes: expected }]);
    assert.equal(await accounting.applyStorageAccountingPlan(db as never, before, plan), true);
    const again = await accounting.measureStorageAccounting(await snapshot());
    assert.equal(again.noteUpdates.length, 0); assert.equal(again.beforeBytes, again.afterBytes);
  });
  await check("physical orphan clips remain charged while pending attempt clips are charged exactly once", async () => {
    const turn = turns[0];
    physicalObjects.set(`lectures/${boardId}/${turn.id}/888.mp3`, 42);
    const attemptPrefix = `lectures/${boardId}/${turn.id}/abcdefghijkl/`;
    physicalObjects.set(`${attemptPrefix}999.mp3`, 1000);
    jobs.push({ id: "pending-attempt", userId, prefix: attemptPrefix, bytes: 2000n, pendingTurns: 0,
      attempts: 0, createdAt: new Date(), nextAttemptAt: new Date(Date.now() + 60_000) }); reservedBytes += 2000n;
    const plan = await accounting.measureStorageAccounting(await snapshot());
    assert.equal(plan.orphanObjects, 1); assert.equal(plan.orphanAudioBytes, 42n);
    assert.equal(plan.measuredAudioBytes, 216n * 1024n + 42n);
    assert.equal(plan.afterBytes, plan.turnUpdates.reduce((sum, row) => sum + row.storageBytes, 0n) + 2000n);
  });
  await check("cancelled measurement dispatches no provider request", async () => {
    await assert.rejects(accounting.measureStorageAccounting(await snapshot(), { signal: AbortSignal.abort() }), accounting.StorageVerificationError);
    assert.equal(headReads, 0);
  });
  assert.equal(failures.length, 0, failures.join("; "));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
