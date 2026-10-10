/** Real account locks, canonical save routes and storage receipts; local disposable DB only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

async function main() {
  const input = process.env.SECURITY_TEST_DATABASE_URL;
  assert(input, "explicit disposable security database required");
  const url = new URL(input);
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && /^\/heytutor_security_[a-zA-Z0-9_]+$/.test(url.pathname));
  for (const [name, value] of Object.entries(process.env)) {
    if (/API_KEY|API_TOKEN|AZURE_TOKEN|AWS_ACCESS_KEY|AWS_SECRET|AWS_SESSION_TOKEN|AI_GATEWAY/i.test(name)) assert(!value, "provider credentials must be absent");
  }
  process.env.DATABASE_URL = input;
  Object.assign(process.env, { NODE_ENV: "production" });
  const root = resolve(import.meta.dirname, "../..");
  const load = createRequire(import.meta.url);
  const objects = new Map<string, number>();
  let unavailable = false, nullUpload = false, uploads = 0;
  let currentUser = "";
  mock.module(resolve(root, "lib/auth.ts"), { namedExports: {
    getUserId: async () => currentUser, ensureUser: async () => {},
  } });
  mock.module(resolve(root, "lib/object-store/s3.ts"), { namedExports: {
    headObjectSize: async (key: string) => {
      if (unavailable) throw new Error("fixture metadata unavailable");
      return objects.has(key) ? { status: "found", bytes: objects.get(key)! } : { status: "missing" };
    },
    listObjectSizes: async (prefix: string) => {
      if (unavailable) throw new Error("fixture metadata unavailable");
      return [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, bytes]) => ({ key, bytes }));
    },
    uploadAudio: async (key: string, bytes: Uint8Array) => {
      uploads++; objects.set(key, bytes.byteLength);
      return nullUpload ? null : `/api/media?key=${encodeURIComponent(key)}`;
    },
  } });
  globalThis.fetch = async () => { throw new Error("External network prohibited in storage DB verification"); };
  const { prisma } = load(resolve(root, "lib/db/prisma.ts")) as typeof import("../../lib/db/prisma");
  const quota = load(resolve(root, "lib/boards/storageQuota.ts")) as typeof import("../../lib/boards/storageQuota");
  const accounting = load(resolve(root, "lib/boards/storageAccounting.ts")) as typeof import("../../lib/boards/storageAccounting");
  const checkpoint = load(resolve(root, "lib/boards/turnCheckpoint.ts")) as typeof import("../../lib/boards/turnCheckpoint");
  const legacy = load(resolve(root, "app/api/boards/[boardId]/turns/route.ts")) as typeof import("../../app/api/boards/[boardId]/turns/route");
  const boardRoute = load(resolve(root, "app/api/boards/[boardId]/route.ts")) as typeof import("../../app/api/boards/[boardId]/route");
  const users: string[] = [];
  const createAccount = async () => {
    const userId = randomUUID(), boardId = randomUUID(); users.push(userId);
    await prisma.user.create({ data: { id: userId } });
    await prisma.board.create({ data: { id: boardId, userId } });
    currentUser = userId; return { userId, boardId };
  };
  const traceFor = async (userId: string) => {
    const traceId = randomUUID();
    await prisma.ownedTrace.create({ data: { traceId, userId, expiresAt: new Date(Date.now() + 86_400_000) } });
    return traceId;
  };
  const mp3 = new Uint8Array(1024); mp3.set([73, 68, 51]);
  const segment = { orderIndex: 0, narration: "Five.", spokenText: "Five.", command: { type: "WRITE", params: [90, 145, 28], text: "2 + 3 = 5", charPosition: 0, narrationBefore: "" }, durationMs: 800 };
  const put = async (account: { userId: string; boardId: string }, turnId: string, traceId: string, extra: Record<string, unknown> = {}, withAudio = true) => {
    currentUser = account.userId;
    const form = new FormData();
    form.append("metadata", JSON.stringify({ seq: 1, baseCount: 0, status: "complete", kind: "lesson", question: "What is 2 + 3?", rawResponse: "[STEP] Five.", visualStatus: "text_only", appendSegments: [segment], traceId, ...extra }));
    if (withAudio) form.append("audio-0", new Blob([mp3], { type: "audio/mpeg" }));
    const response = await checkpoint.handleTurnCheckpoint(new Request(`https://example.test/api/boards/${account.boardId}/turns/${turnId}`, { method: "PUT", body: form }), { boardId: account.boardId, turnId });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  try {
    const account = await createAccount();
    const oldTime = new Date(Date.now() - 86_400_000);
    for (let i = 0; i < 20; i++) {
      const turnId = randomUUID();
      await prisma.turn.create({ data: { id: turnId, boardId: account.boardId, userId: account.userId, orderIndex: i,
        question: "A fixture question", rawResponse: "A fixture explanation", visualStatus: "text_only", updatedAt: oldTime } });
      await prisma.segment.createMany({ data: Array.from({ length: i < 16 ? 11 : 10 }, (_, index) => {
        const key = `lectures/${account.boardId}/${turnId}/${index}.mp3`; objects.set(key, 1024);
        return { turnId, orderIndex: index, narration: "Fixture", spokenText: "Fixture", audioUrl: `/api/media?key=${encodeURIComponent(key)}` };
      }) });
    }
    const oldEstimate = 20n * 262144n + 216n * 8388608n;
    const photoResidual = 12345n;
    await prisma.userStorage.create({ data: { userId: account.userId, reservedBytes: oldEstimate + photoResidual } });
    const savedId = randomUUID(), savedTrace = await traceFor(account.userId);
    const saved = await put(account, savedId, savedTrace);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const receipt = await prisma.turn.findUniqueOrThrow({ where: { id: savedId }, include: { segments: true } });
    assert.equal(receipt.metadataBytes, BigInt(accounting.turnMetadataStorageBytes(receipt as unknown as Record<string, unknown>)));
    assert.equal(receipt.storageBytes, receipt.metadataBytes + 1024n);
    const stored = await prisma.turn.findMany({ where: { userId: account.userId } });
    assert(stored.filter(turn => turn.id !== savedId).every(turn => turn.updatedAt.getTime() === oldTime.getTime()), "accounting must not revive lesson idle clocks");
    let balance = await prisma.userStorage.findUniqueOrThrow({ where: { userId: account.userId } });
    assert.equal(balance.reservedBytes, stored.reduce((sum, turn) => sum + turn.storageBytes, 0n) + photoResidual);
    assert.equal(balance.pendingTurns, 0);
    assert.equal((await prisma.ownedTrace.findUniqueOrThrow({ where: { traceId: savedTrace } })).savedTurnId, savedId);
    const readback = await boardRoute.GET(new Request("https://example.test/board?page=2"), { params: Promise.resolve({ boardId: account.boardId }) });
    assert.equal(readback.status, 200); assert((await readback.json() as { turns: Array<{ id: string }> }).turns.some(turn => turn.id === savedId));
    console.log("PASS real canonical PUT migrates 20 old lessons/216 tiny clips, preserves residual and idle clocks, claims trace and reopens");

    for (const key of objects.keys()) objects.set(key, 8 * 1024 * 1024);
    await prisma.userStorage.update({ where: { userId: account.userId }, data: { reservedBytes: oldEstimate + photoResidual } });
    const beforeUploads = uploads;
    const refused = await put(account, randomUUID(), await traceFor(account.userId));
    assert.equal(refused.status, 413); assert.equal(refused.body.code, "storage_admission_rejected"); assert.equal(uploads, beforeUploads);
    const postForm = new FormData();
    postForm.append("metadata", JSON.stringify({ question: "What is 2 + 3?", rawResponse: "Five.", visualStatus: "text_only", segments: [segment], traceId: await traceFor(account.userId) }));
    const post = await legacy.POST(new Request("https://example.test/api/turns", { method: "POST", body: postForm }), { params: Promise.resolve({ boardId: account.boardId }) });
    assert.equal(post.status, 413); assert.equal((await post.json() as { code: string }).code, "storage_admission_rejected");
    console.log("PASS genuine retained quota blocks both PUT and legacy POST before upload");

    unavailable = true;
    const unverified = await put(account, randomUUID(), await traceFor(account.userId));
    assert.equal(unverified.status, 503); assert.equal(unverified.body.code, "storage_verification_failed"); assert.equal(uploads, beforeUploads);
    unavailable = false;
    for (const key of objects.keys()) objects.set(key, 1024);
    await prisma.userStorage.update({ where: { userId: account.userId }, data: { reservedBytes:
      (await prisma.turn.aggregate({ where: { userId: account.userId }, _sum: { storageBytes: true } }))._sum.storageBytes! + photoResidual } });
    const missingKey = objects.keys().next().value!; objects.delete(missingKey);
    const snapshot = await prisma.$transaction(tx => accounting.readStorageAccountingSnapshot(tx, account.userId));
    const plan = await accounting.measureStorageAccounting(snapshot);
    assert.equal(plan.missingObjects, 1);
    assert.equal(await quota.withUserStorageLock(account.userId, tx => accounting.applyStorageAccountingPlan(tx, snapshot, plan)), true);
    const staleSnapshot = await prisma.$transaction(tx => accounting.readStorageAccountingSnapshot(tx, account.userId));
    const stalePlan = await accounting.measureStorageAccounting(staleSnapshot);
    await prisma.userStorage.update({ where: { userId: account.userId }, data: { reservedBytes: { increment: 1n } } });
    assert.equal(await quota.withUserStorageLock(account.userId, tx => accounting.applyStorageAccountingPlan(tx, staleSnapshot, stalePlan)), false);
    console.log("PASS metadata failure is explicit503, confirmed missing is released, changed account snapshot is fenced");
    const orphanKey = `lectures/${account.boardId}/${savedId}/999.mp3`; objects.set(orphanKey, 321);
    const orphanSnapshot = await prisma.$transaction(tx => accounting.readStorageAccountingSnapshot(tx, account.userId));
    const orphanPlan = await accounting.measureStorageAccounting(orphanSnapshot);
    assert.equal(orphanPlan.orphanObjects, 1); assert.equal(orphanPlan.orphanAudioBytes, 321n);
    assert.equal(await quota.withUserStorageLock(account.userId, tx => accounting.applyStorageAccountingPlan(tx, orphanSnapshot, orphanPlan)), true);
    const orphanReceipt = await prisma.turn.findUniqueOrThrow({ where: { id: savedId } });
    assert.equal(orphanReceipt.storageBytes - orphanReceipt.metadataBytes, 1345n);
    const note = await prisma.boardChatMessage.create({ data: { boardId: account.boardId, userId: account.userId, role: "user", content: "π = 3.14" } });
    const noteSnapshot = await prisma.$transaction(tx => accounting.readStorageAccountingSnapshot(tx, account.userId));
    const notePlan = await accounting.measureStorageAccounting(noteSnapshot);
    assert.deepEqual(notePlan.noteUpdates, [{ id: note.id, storageBytes: BigInt(Buffer.byteLength("π = 3.14")) }]);
    assert.equal(await quota.withUserStorageLock(account.userId, tx => accounting.applyStorageAccountingPlan(tx, noteSnapshot, notePlan)), true);
    assert.equal((await prisma.boardChatMessage.findUniqueOrThrow({ where: { id: note.id } })).storageBytes, BigInt(Buffer.byteLength("π = 3.14")));
    console.log("PASS owned physical orphan audio stays charged and zero-byte retained notes receive measured receipts");

    const liveId = randomUUID(), liveTrace = await traceFor(account.userId);
    const live = await put(account, liveId, liveTrace, { status: "live", rawResponse: "x".repeat(5000), resumeState: { state: "x".repeat(5000) } });
    assert.equal(live.status, 200, JSON.stringify(live.body));
    const liveBefore = await prisma.turn.findUniqueOrThrow({ where: { id: liveId } });
    const balanceBefore = await prisma.userStorage.findUniqueOrThrow({ where: { userId: account.userId } });
    const closed = await checkpoint.handleTurnClose(new Request("https://example.test/close", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ seq: 2, baseCount: 1, status: "stopped", rawResponse: "Five.", resumeState: null, traceId: liveTrace }) }), { boardId: account.boardId, turnId: liveId });
    assert.equal(closed.status, 200, JSON.stringify(await closed.json()));
    const liveAfter = await prisma.turn.findUniqueOrThrow({ where: { id: liveId }, include: { segments: true } });
    const balanceAfter = await prisma.userStorage.findUniqueOrThrow({ where: { userId: account.userId } });
    assert(liveAfter.storageBytes < liveBefore.storageBytes); assert.equal(liveAfter.metadataBytes, BigInt(accounting.turnMetadataStorageBytes(liveAfter as unknown as Record<string, unknown>)));
    assert.equal(balanceBefore.reservedBytes - balanceAfter.reservedBytes, liveBefore.storageBytes - liveAfter.storageBytes);
    const finished = await put(account, liveId, liveTrace, { seq: 3, baseCount: 1, status: "complete", appendSegments: [], rawResponse: "Five.", resumeState: null }, false);
    assert.equal(finished.status, 200, JSON.stringify(finished.body));
    const finishedReceipt = await prisma.turn.findUniqueOrThrow({ where: { id: liveId }, include: { segments: true } });
    assert(finishedReceipt.storageBytes < liveAfter.storageBytes);
    assert.equal(finishedReceipt.metadataBytes, BigInt(accounting.turnMetadataStorageBytes(finishedReceipt as unknown as Record<string, unknown>)));
    console.log("PASS stopped and completed checkpoints refund shrinking metadata atomically and record exact retained bytes");

    nullUpload = true;
    const failedId = randomUUID();
    const failed = await put(account, failedId, await traceFor(account.userId));
    assert.equal(failed.status, 503); assert.equal(failed.body.code, "storage_verification_failed");
    assert.equal(await prisma.turn.findUnique({ where: { id: failedId } }), null);
    const cleanup = await prisma.objectDeletionJob.findFirstOrThrow({ where: { userId: account.userId, prefix: { startsWith: `lectures/${account.boardId}/${failedId}/` } } });
    assert(cleanup.bytes > 0n); assert.equal(cleanup.pendingTurns, 0);
    assert([...objects.keys()].some(key => key.startsWith(cleanup.prefix)), "possibly accepted upload remains fenced by cleanup"); nullUpload = false;
    console.log("PASS null upload never acknowledges save and retains a durable charged cleanup receipt");

    const concurrent = await createAccount();
    await prisma.userStorage.create({ data: { userId: concurrent.userId, reservedBytes: BigInt(quota.MAX_ACCOUNT_STORAGE_BYTES) - 100n } });
    const concurrentResults = await Promise.allSettled([0, 1].map(() => quota.reserveTurnStorage({ userId: concurrent.userId, boardId: concurrent.boardId, turnId: randomUUID(), bytes: 60 })));
    assert.equal(concurrentResults.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(concurrentResults.filter(result => result.status === "rejected" && result.reason instanceof quota.StorageQuotaError && result.reason.status === 413).length, 1);
    balance = await prisma.userStorage.findUniqueOrThrow({ where: { userId: concurrent.userId } });
    assert.equal(balance.pendingTurns, 1); assert.equal(balance.reservedBytes, BigInt(quota.MAX_ACCOUNT_STORAGE_BYTES) - 40n);
    console.log("PASS real concurrent account locks admit one near-cap upload and refuse the other without losing its reservation");
    const staleSlots = await createAccount();
    const exactMetadata = BigInt(accounting.turnMetadataStorageBytes({ question: "Fixture", rawResponse: "Fixture", segments: [] }));
    await prisma.turn.createMany({ data: Array.from({ length: 99 }, (_, i) => ({ boardId: staleSlots.boardId, userId: staleSlots.userId,
      orderIndex: i, question: "Fixture", rawResponse: "Fixture", storageBytes: exactMetadata, metadataBytes: exactMetadata })) });
    await prisma.userStorage.create({ data: { userId: staleSlots.userId, reservedBytes: 99n * exactMetadata + 500n, pendingTurns: 1 } });
    const expiredId = randomUUID();
    await prisma.objectDeletionJob.create({ data: { id: expiredId, userId: staleSlots.userId,
      prefix: `lectures/${staleSlots.boardId}/${randomUUID()}/`, bytes: 500n, pendingTurns: 1, createdAt: oldTime, nextAttemptAt: oldTime } });
    await quota.reserveTurnStorage({ userId: staleSlots.userId, boardId: staleSlots.boardId, turnId: randomUUID(), bytes: 30 });
    assert.equal(await prisma.objectDeletionJob.findUnique({ where: { id: expiredId } }), null);
    const slotsAfter = await prisma.userStorage.findUniqueOrThrow({ where: { userId: staleSlots.userId } });
    assert.equal(slotsAfter.pendingTurns, 1); assert.equal(slotsAfter.reservedBytes, 99n * exactMetadata + 30n);
    console.log("PASS expired confirmed-empty attempt releases a stale final turn slot below the byte cap before new admission");

    currentUser = account.userId;
    const ownedBytes = (await prisma.turn.aggregate({ where: { boardId: account.boardId }, _sum: { storageBytes: true } }))._sum.storageBytes! +
      (await prisma.boardChatMessage.aggregate({ where: { boardId: account.boardId }, _sum: { storageBytes: true } }))._sum.storageBytes!;
    const deleted = await boardRoute.DELETE(new Request("https://example.test/delete", { method: "DELETE" }), { params: Promise.resolve({ boardId: account.boardId }) });
    assert.equal(deleted.status, 200);
    const deletion = await prisma.objectDeletionJob.findUniqueOrThrow({ where: { prefix: `lectures/${account.boardId}/` } });
    assert.equal(deletion.bytes, ownedBytes);
    console.log("PASS board deletion queues only corrected measured receipts, preserving existing cleanup fencing");
  } finally {
    await prisma.objectDeletionJob.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
