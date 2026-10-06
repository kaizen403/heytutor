/**
 * Progressive turn save against a real disposable Postgres
 * (`SECURITY_TEST_DATABASE_URL`, a `heytutor_security_*` database on
 * localhost). Object storage and auth are faked; everything else is real: the
 * checkpoint handler, the canonicalizer, storage accounting, the cleanup
 * worker, and the board GET and DELETE routes.
 *
 * Asserts: growth charges only the delta and never touches the pending-turn
 * count; an abandoned attempt's cleanup deletes only that attempt's folder, so
 * earlier clips survive; a retried first create gets a fresh folder; the board
 * GET reports status, kind and trace and never leaks the submitted rows, and a
 * live turn idle for over 120 s reads as stopped; board delete refunds every
 * charged byte; and in production the create claims the trace.
 */
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
  process.env.DATABASE_URL = input;
  const load = createRequire(import.meta.url);
  const root = resolve(import.meta.dirname, "../..");

  const objects = new Map<string, number>();
  const deleted: string[] = [];
  let failUploadsWith: string | null = null;
  mock.module(resolve(root, "lib/object-store/s3.ts"), { namedExports: {
    uploadAudio: async (key: string, bytes: Uint8Array) => {
      if (failUploadsWith) throw new Error(failUploadsWith);
      objects.set(key, bytes.byteLength);
      return `/api/lecture-audio?key=${encodeURIComponent(key)}`;
    },
    deletePrefix: async (prefix: string) => {
      deleted.push(prefix);
      for (const key of [...objects.keys()]) if (key.startsWith(prefix)) objects.delete(key);
    },
    boardAudioPrefix: (boardId: string) => `lectures/${boardId}/`,
  } });
  let currentUser = "";
  mock.module(resolve(root, "lib/auth.ts"), { namedExports: {
    getUserId: async () => currentUser,
    ensureUser: async () => {},
  } });

  const { prisma } = load(resolve(root, "lib/db/prisma.ts")) as typeof import("../../lib/db/prisma");
  const storage = load(resolve(root, "lib/boards/storageQuota.ts")) as typeof import("../../lib/boards/storageQuota");
  const { runObjectDeletionBatch } = load(resolve(root, "lib/object-store/deletionJobs.ts")) as typeof import("../../lib/object-store/deletionJobs");
  const { handleTurnCheckpoint, handleTurnClose } = load(resolve(root, "lib/boards/turnCheckpoint.ts")) as typeof import("../../lib/boards/turnCheckpoint");
  const boardRoute = load(resolve(root, "app/api/boards/[boardId]/route.ts")) as typeof import("../../app/api/boards/[boardId]/route");

  const userId = randomUUID(), boardId = randomUUID();
  currentUser = userId;
  await prisma.user.create({ data: { id: userId } });
  await prisma.board.create({ data: { id: boardId, userId } });

  const MP3 = (size: number, tag = 1) => {
    const bytes = new Uint8Array(size).fill(tag);
    bytes.set([73, 68, 51], 0);
    return bytes;
  };
  const CLEAR = { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" };
  const write = (text: string) => ({ type: "WRITE", params: [90, 145, 28], text, charPosition: 0, narrationBefore: "" });
  const row = (orderIndex: number, text: string, command: unknown = write(text)) =>
    ({ orderIndex, narration: text, spokenText: text, command, durationMs: 800 });
  const put = async (turnId: string, meta: Record<string, unknown>, audio: Record<number, Uint8Array> = {}) => {
    const form = new FormData();
    form.append("metadata", JSON.stringify({ question: "What is 2 + 3?", rawResponse: "", status: "live", ...meta }));
    for (const [index, bytes] of Object.entries(audio)) form.append(`audio-${index}`, new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }));
    const response = await handleTurnCheckpoint(
      new Request(`https://example.test/api/boards/${boardId}/turns/${turnId}`, { method: "PUT", body: form }),
      { boardId, turnId },
    );
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const balance = () => prisma.userStorage.findUniqueOrThrow({ where: { userId } });
  const turnRow = (id: string) => prisma.turn.findUniqueOrThrow({ where: { id } });
  const keyOf = (audioUrl: string | null) => audioUrl ? decodeURIComponent(audioUrl.split("key=")[1]!) : null;
  const later = new Date(Date.now() + 31 * 60_000);

  try {
    // --- create, then grow ------------------------------------------------
    const lesson = randomUUID();
    const first = await put(lesson, { seq: 1, baseCount: 0, appendSegments: [row(0, "", CLEAR), row(1, "Write 2 + 3.")] },
      { 1: MP3(4_000) });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    let turn = await turnRow(lesson);
    let account = await balance();
    assert.equal(turn.status, "live");
    assert.equal(account.pendingTurns, 0, "a settled create releases its pending turn slot");
    assert.equal(account.reservedBytes, turn.storageBytes, "the account is charged exactly what the turn holds");
    assert.equal(await prisma.objectDeletionJob.count({ where: { userId } }), 0, "a settled create leaves no cleanup intent");
    const firstSegments = await prisma.segment.findMany({ where: { turnId: lesson }, orderBy: { orderIndex: "asc" } });
    const firstKey = keyOf(firstSegments[1]!.audioUrl)!;
    assert.match(firstKey, new RegExp(`^lectures/${boardId}/${lesson}/[a-z0-9]{12}/1\\.mp3$`));
    assert.equal(firstSegments[1]!.audioRef, 1);

    const chargedBefore = turn.storageBytes;
    const metadataBefore = turn.metadataBytes;
    const second = await put(lesson, { seq: 2, baseCount: 2, rawResponse: "Write 2 + 3. It is 5.",
      appendSegments: [row(2, "It is 5.")] }, { 2: MP3(3_000, 2) });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    turn = await turnRow(lesson);
    account = await balance();
    const growth = turn.storageBytes - chargedBefore;
    assert.equal(growth, (turn.metadataBytes - metadataBefore) + 3_000n, "growth is the metadata delta plus the new clip only");
    assert.ok(growth < 3_000n + 4_000n, "earlier audio is not charged again");
    assert.equal(account.reservedBytes, turn.storageBytes);
    assert.equal(account.pendingTurns, 0, "growth never takes a turn slot");
    assert.equal(turn.checkpointSeq, 2);

    // --- an abandoned attempt deletes only its own folder ----------------------
    failUploadsWith = "object store down";
    await assert.rejects(put(lesson, { seq: 3, baseCount: 3, appendSegments: [row(3, "So 5.")] }, { 3: MP3(2_000, 3) }),
      /object store down/);
    failUploadsWith = null;
    const jobs = await prisma.objectDeletionJob.findMany({ where: { userId } });
    assert.equal(jobs.length, 1, "the failed attempt left its durable cleanup intent");
    assert.equal(jobs[0]!.pendingTurns, 0, "a growth intent holds no turn slot");
    assert.match(jobs[0]!.prefix, new RegExp(`^lectures/${boardId}/${lesson}/[a-z0-9]{12}/$`));
    assert.ok(!firstKey.startsWith(jobs[0]!.prefix), "the attempt folder does not contain earlier clips");
    assert.equal((await balance()).reservedBytes - turn.storageBytes, jobs[0]!.bytes, "the attempt's bytes stay charged until cleanup");
    await runObjectDeletionBatch({ now: later });
    assert.deepEqual(deleted, [jobs[0]!.prefix], "cleanup deletes only the abandoned attempt");
    assert.ok(objects.has(firstKey), "the earlier clip survives the cleanup");
    assert.equal((await balance()).reservedBytes, turn.storageBytes, "the abandoned bytes are refunded");
    await assert.rejects(storage.reserveTurnGrowthStorage({ userId, boardId, turnId: lesson, bytes: 1,
      prefix: `lectures/${boardId}/${lesson}/` }), /one upload attempt/, "growth can never target the whole turn folder");

    // --- a retried first create gets a fresh folder ----------------------------
    const retried = randomUUID();
    failUploadsWith = "lost";
    await assert.rejects(put(retried, { seq: 1, baseCount: 0, appendSegments: [row(0, "", CLEAR), row(1, "Hi.")] }, { 1: MP3(1_000) }));
    failUploadsWith = null;
    const abandonedCreate = await prisma.objectDeletionJob.findFirstOrThrow({ where: { userId } });
    assert.equal(abandonedCreate.pendingTurns, 0, "the abandoned create gave its turn slot back");
    const retry = await put(retried, { seq: 1, baseCount: 0, appendSegments: [row(0, "", CLEAR), row(1, "Hi.")] }, { 1: MP3(1_000) });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    const retryKey = keyOf((await prisma.segment.findFirstOrThrow({ where: { turnId: retried, orderIndex: 1 } })).audioUrl)!;
    assert.ok(!retryKey.startsWith(abandonedCreate.prefix), "the retry does not share the abandoned prefix");
    await runObjectDeletionBatch({ now: later });
    assert.ok(objects.has(retryKey), "cleaning up the first attempt keeps the retry's clip");
    assert.equal((await balance()).pendingTurns, 0);

    // --- board GET: status, kind, trace; no submitted rows; idle live is stopped
    const get = async () => {
      const response = await boardRoute.GET(new Request(`https://example.test/api/boards/${boardId}?page=0`),
        { params: Promise.resolve({ boardId }) });
      return await response.json() as { turns: Array<Record<string, unknown>> };
    };
    let detail = await get();
    const listed = detail.turns.find((entry) => entry.id === lesson)!;
    assert.equal(listed.status, "live");
    assert.equal(listed.kind, "lesson");
    assert.ok("traceId" in listed);
    assert.equal("submittedSegments" in listed, false, "the board GET never sends the submitted rows");
    await prisma.$executeRaw`UPDATE turns SET updated_at = now() - interval '3 minutes' WHERE id = ${lesson}::uuid`;
    detail = await get();
    assert.equal(detail.turns.find((entry) => entry.id === lesson)!.status, "stopped", "a live turn idle for 120 s reads as stopped");

    // --- the keepalive close on the real database ------------------------------
    const closed = await handleTurnClose(new Request(`https://example.test/api/boards/${boardId}/turns/${lesson}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ seq: 3, status: "stopped", baseCount: 3, appendSegments: [row(3, "So 5.")] }),
    }), { boardId, turnId: lesson });
    assert.equal(closed.status, 200, await closed.clone().text());
    turn = await turnRow(lesson);
    assert.equal(turn.status, "stopped");
    assert.equal(turn.checkpointSeq, 3);
    assert.equal(await prisma.segment.count({ where: { turnId: lesson } }), 4);
    assert.equal((await balance()).reservedBytes, (await prisma.turn.aggregate({ where: { userId }, _sum: { storageBytes: true } }))._sum.storageBytes);

    // --- complete drops the submitted rows ------------------------------------
    const complete = await put(lesson, { seq: 4, baseCount: 4, status: "complete", rawResponse: "Write 2 + 3. It is 5. So 5.", appendSegments: [] });
    assert.equal(complete.status, 200, JSON.stringify(complete.body));
    turn = await turnRow(lesson);
    assert.equal(turn.status, "complete");
    assert.equal(turn.submittedSegments, null);

    // --- production: the create claims the trace -----------------------------
    const previousEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const traceId = randomUUID();
    await prisma.ownedTrace.create({ data: { traceId, userId, expiresAt: new Date(Date.now() + 60_000) } });
    const traced = randomUUID();
    try {
      const tracedCreate = await put(traced, { seq: 1, baseCount: 0, traceId, appendSegments: [row(0, "", CLEAR)] });
      assert.equal(tracedCreate.status, 200, JSON.stringify(tracedCreate.body));
      assert.equal((await prisma.ownedTrace.findUniqueOrThrow({ where: { traceId } })).savedTurnId, traced);
      const other = await put(randomUUID(), { seq: 1, baseCount: 0, traceId, appendSegments: [row(0, "", CLEAR)] });
      assert.equal(other.status, 409);
      assert.equal((other.body.turn as { id: string }).id, traced, "one turn per trace");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = previousEnv;
    }

    // --- board delete refunds every charged byte ------------------------------
    const deletedBoard = await boardRoute.DELETE(new Request(`https://example.test/api/boards/${boardId}`, { method: "DELETE" }),
      { params: Promise.resolve({ boardId }) });
    assert.equal(deletedBoard.status, 200);
    await runObjectDeletionBatch({ now: later });
    account = await balance();
    assert.equal(account.reservedBytes, 0n, "deleting the board refunds every checkpoint's bytes");
    assert.equal(account.pendingTurns, 0);
    console.log("PASS checkpoint storage: delta-only growth, attempt-scoped cleanup, fresh retry folders, GET status, close, trace claim, delete refund");
  } finally {
    await prisma.objectDeletionJob.deleteMany({ where: { userId } });
    await prisma.ownedTrace.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
