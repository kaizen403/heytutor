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
  for (const [name, value] of Object.entries(process.env)) {
    if (/API_KEY|API_TOKEN|AZURE_TOKEN|AWS_ACCESS_KEY|AWS_SECRET|AWS_SESSION_TOKEN|AI_GATEWAY/i.test(name)) {
      assert(!value, `disposable DB verification requires ${name} absent`);
    }
  }
  process.env.DATABASE_URL = input;
  const load = createRequire(import.meta.url);
  const root = resolve(import.meta.dirname, "../..");

  const objects = new Map<string, number>();
  const deleted: string[] = [];
  let failUploadsWith: string | null = null;
  let uploadPause: ((key: string) => Promise<void>) | null = null;
  mock.module(resolve(root, "lib/object-store/s3.ts"), { namedExports: {
    uploadAudio: async (key: string, bytes: Uint8Array) => {
      await uploadPause?.(key);
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
  const WAV = () => {
    const dataSize = 800 * 8_000 * 2 / 1_000;
    const bytes = new Uint8Array(44 + dataSize), view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => bytes.set([...value].map(char => char.charCodeAt(0)), offset);
    text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8_000, true); view.setUint32(28, 16_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, dataSize, true);
    for (let offset = 44; offset < bytes.length; offset += 2) view.setInt16(offset, (offset / 2 % 32 - 16) * 100, true);
    return bytes;
  };
  const CLEAR = { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" };
  const write = (text: string) => ({ type: "WRITE", params: [90, 145, 28], text, charPosition: 0, narrationBefore: "" });
  const row = (orderIndex: number, text: string, command: unknown = write(text)) =>
    ({ orderIndex, narration: text, spokenText: text, command, durationMs: 800 });
  const put = async (turnId: string, meta: Record<string, unknown>, audio: Record<number, Uint8Array> = {}, audioFormat = "audio/mpeg") => {
    const form = new FormData();
    form.append("metadata", JSON.stringify({ question: "What is 2 + 3?", rawResponse: "", status: "live", ...meta }));
    for (const [index, bytes] of Object.entries(audio)) form.append(`audio-${index}`, new Blob([new Uint8Array(bytes)], { type: audioFormat }));
    const response = await handleTurnCheckpoint(
      new Request(`https://example.test/api/boards/${boardId}/turns/${turnId}`, { method: "PUT", body: form }),
      { boardId, turnId },
    );
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const close = async (turnId: string, body: Record<string, unknown>) => {
    const response = await handleTurnClose(new Request(`https://example.test/api/boards/${boardId}/turns/${turnId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), { boardId, turnId });
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
      const turns: Array<Record<string, unknown>> = [];
      let page: number | null = 0;
      for (let reads = 0; page !== null && reads < 20; reads++) {
        const response = await boardRoute.GET(new Request(`https://example.test/api/boards/${boardId}?page=${page}`),
          { params: Promise.resolve({ boardId }) });
        assert.equal(response.status, 200);
        const detail = await response.json() as { turns: Array<Record<string, unknown>>; nextPage: number | null };
        turns.push(...detail.turns); page = detail.nextPage;
      }
      assert.equal(page, null, "bounded actual history reads cover all private fixture rows");
      return { turns };
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

    // --- real sequence ownership across close, tail and delayed voice ---------
    const metadata = randomUUID();
    const readMetadata = async () => (await get()).turns.find(entry => entry.id === metadata)!;
    await put(metadata, { seq: 1, baseCount: 0, appendSegments: [row(0, "First.")] });
    await put(metadata, { seq: 3, baseCount: 1, appendSegments: [], rawResponse: "Current.", resumeState: { solver: "new" } });
    const oldClose = await close(metadata, { seq: 2, status: "stopped", rawResponse: "Old.", resumeState: { solver: "old" } });
    assert.equal(oldClose.status, 200);
    assert.deepEqual((await readMetadata()).resumeState, { solver: "new" });
    assert.equal((await readMetadata()).rawResponse, "Current.");
    assert.equal((await readMetadata()).persistedStatus, "stopped");
    assert.equal(oldClose.body.serverSeq, 3);
    await close(metadata, { seq: 3, status: "stopped", resumeState: { solver: "equal-replay" } });
    assert.deepEqual((await readMetadata()).resumeState, { solver: "new" });
    const cleared = await close(metadata, { seq: 4, status: "stopped", rawResponse: "Latest.", resumeState: null });
    assert.equal(cleared.body.serverSeq, 4); assert.equal((await readMetadata()).resumeState, null);
    const cut = { ...row(1, "Shown cut."), durationMs: null };
    const oldTail = { seq: 2, status: "stopped", baseCount: 0, appendSegments: [row(0, "First."), cut],
      rawResponse: "Old tail.", resumeState: { solver: "old-tail" } };
    assert.equal((await close(metadata, oldTail)).status, 200);
    assert.equal((await readMetadata()).resumeState, null); assert.equal((await readMetadata()).rawResponse, "Latest.");
    await close(metadata, oldTail);
    const cutRows = (await readMetadata()).segments as Array<Record<string, unknown>>;
    assert.equal(cutRows.length, 2); assert.equal(cutRows[1]!.audioUrl, null); assert.equal(cutRows[1]!.durationMs, null);
    const olderPut = { seq: 3, baseCount: 2, appendSegments: [row(2, "Already voiced.")], rawResponse: "Old PUT.", resumeState: { solver: "old-put" } };
    assert.equal((await put(metadata, olderPut, { 2: MP3(2_000, 8) })).status, 200);
    assert.deepEqual((await readMetadata()).resumeState, null); assert.equal((await readMetadata()).rawResponse, "Latest.");
    const voiced = (await readMetadata()).segments as Array<Record<string, unknown>>;
    assert.equal(voiced.length, 3); assert.ok(voiced[2]!.audioUrl);
    const oldObjectCount = objects.size;
    await put(metadata, olderPut, { 2: MP3(2_000, 8) });
    assert.equal(((await readMetadata()).segments as unknown[]).length, 3); assert.equal(objects.size, oldObjectCount);
    await put(metadata, { seq: 5, baseCount: 3, status: "complete", rawResponse: "Final.", resumeState: { solver: "final" } });
    await close(metadata, { seq: 99, status: "stopped", resumeState: { solver: "too-late" } });
    assert.equal((await readMetadata()).persistedStatus, "complete"); assert.deepEqual((await readMetadata()).resumeState, { solver: "final" });

    const race = randomUUID();
    await put(race, { seq: 1, baseCount: 0, appendSegments: [row(0, "First.")] });
    let started!: () => void, release!: () => void;
    const uploading = new Promise<void>(resolve => { started = resolve; });
    const heldUpload = new Promise<void>(resolve => { release = resolve; });
    uploadPause = async key => { if (key.includes(`/${race}/`)) { started(); await heldUpload; } };
    try {
      const racingInput = { seq: 2, baseCount: 1, appendSegments: [row(1, "Shown during upload.")],
        rawResponse: "Old upload.", resumeState: { solver: "old-upload" } };
      const wav = WAV();
      const pending = put(race, racingInput, { 1: wav }, "audio/wav");
      await uploading;
      await close(race, { seq: 3, status: "stopped", rawResponse: "New close.", resumeState: { solver: "new-close" } });
      release(); assert.equal((await pending).status, 200);
      const savedRace = (await get()).turns.find(entry => entry.id === race)!;
      assert.deepEqual(savedRace.resumeState, { solver: "new-close" }); assert.equal(savedRace.rawResponse, "New close.");
      assert.equal(savedRace.persistedStatus, "stopped");
      const raceRows = savedRace.segments as Array<Record<string, unknown>>;
      assert.equal(raceRows.length, 2); const clipKey = keyOf(raceRows[1]!.audioUrl as string)!;
      assert.equal(raceRows[1]!.audioFormat, "audio/wav"); assert.match(clipKey, /\/1\.wav$/);
      assert.equal(objects.get(clipKey), wav.length);
      const objectCount = objects.size;
      await put(race, racingInput, { 1: wav }, "audio/wav");
      const duplicateRace = (await get()).turns.find(entry => entry.id === race)!;
      const duplicateRows = duplicateRace.segments as Array<Record<string, unknown>>;
      assert.equal(duplicateRows.length, 2); assert.equal(duplicateRows[1]!.audioUrl, raceRows[1]!.audioUrl);
      assert.equal(objects.size, objectCount, "replaying the older WAV upload creates no duplicate object");
      await runObjectDeletionBatch({ now: later });
      assert.ok(objects.has(clipKey), "abandoning the earlier upload attempt preserves the final rescued voice");
      assert.equal((await balance()).reservedBytes, (await prisma.turn.aggregate({ where: { userId }, _sum: { storageBytes: true } }))._sum.storageBytes,
        "rescued voice charges only settled attempt storage after cleanup");
    } finally { release(); uploadPause = null; }

    // --- real unique-index ordering, metadata and raw liveness -----------------
    const prefix = (await get()).turns.map(entry => entry.id);
    const p = randomUUID(), a = randomUUID(), x = randomUUID(), b = randomUUID();
    const create = (id: string, text: string, extra: Record<string, unknown> = {}) => put(id, {
      seq: 1, baseCount: 0, status: "stopped", appendSegments: [row(0, text)], ...extra,
    });
    assert.equal((await create(p, "P", { status: "complete", rawResponse: "P" })).status, 200);
    // A was shown locally and failed before its first durable write; another tab saves X.
    assert.equal((await create(x, "X", { status: "complete", rawResponse: "X" })).status, 200);
    assert.equal((await create(b, "B", { status: "live", orderAfterTurnId: x })).status, 200);
    await prisma.$executeRaw`UPDATE turns SET updated_at = now() - interval '3 minutes' WHERE id = ${b}::uuid`;
    const oldB = (await turnRow(b)).updatedAt;
    assert.equal((await create(a, "A", { orderAfterTurnId: p, orderBeforeTurnId: x,
      resumeState: { v: 1, solverProjection: { q: 24 } } })).status, 200);
    assert.deepEqual((await get()).turns.map(entry => entry.id), [...prefix, p, a, x, b],
      "descending insert under real UNIQUE(board_id,order_index) preserves late earlier first save");
    assert.equal((await turnRow(b)).updatedAt.getTime(), oldB.getTime(), "order-only shift preserves existing successor freshness");
    const rawB = (await get()).turns.find(entry => entry.id === b)!;
    assert.equal(rawB.persistedStatus, "live"); assert.equal(rawB.status, "stopped", "old raw live remains idle-derived stopped");
    assert.deepEqual((await get()).turns.find(entry => entry.id === a)!.resumeState, { v: 1, solverProjection: { q: 24 } });
    assert.equal((await put(a, { seq: 2, baseCount: 1, appendSegments: [], resumeState: null, orderAfterTurnId: b })).status, 200);
    assert.equal((await get()).turns.find(entry => entry.id === a)!.resumeState, null, "metadata-only null clear survives real JSON persistence");
    assert.deepEqual((await get()).turns.map(entry => entry.id), [...prefix, p, a, x, b], "existing-turn retries never reorder");
    const foreignBoard = randomUUID(), foreignAnchor = randomUUID();
    await prisma.board.create({ data: { id: foreignBoard, userId } });
    await prisma.turn.create({ data: { id: foreignAnchor, boardId: foreignBoard, userId, orderIndex: 0,
      question: "foreign board", rawResponse: "", status: "complete" } });
    const beforeInvalid = (await get()).turns.map(entry => entry.id);
    for (const anchors of [{ orderBeforeTurnId: foreignAnchor }, { orderBeforeTurnId: randomUUID() },
      { orderBeforeTurnId: p, orderAfterTurnId: b }]) {
      const rejected = await create(randomUUID(), "invalid", anchors);
      assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
      assert.deepEqual((await get()).turns.map(entry => entry.id), beforeInvalid, "invalid anchors mutate no durable order");
    }
    const self = randomUUID(); assert.equal((await create(self, "self", { orderBeforeTurnId: self })).status, 400);
    currentUser = randomUUID();
    try { assert.equal((await create(randomUUID(), "foreign auth", { orderBeforeTurnId: b })).status, 404); }
    finally { currentUser = userId; }
    assert.deepEqual((await get()).turns.map(entry => entry.id), beforeInvalid);
    const c = randomUUID(), d = randomUUID();
    const concurrent = await Promise.all([create(c, "C", { orderBeforeTurnId: b }), create(d, "D", { orderBeforeTurnId: b })]);
    assert(concurrent.every(result => result.status === 200), JSON.stringify(concurrent));
    const order = (await get()).turns.map(entry => entry.id);
    assert.deepEqual(order.slice(0, prefix.length + 3), [...prefix, p, a, x]);
    assert.deepEqual(new Set(order.slice(-3, -1)), new Set([c, d])); assert.equal(order.at(-1), b);
    const unique = await prisma.turn.findMany({ where: { boardId }, orderBy: { orderIndex: "asc" }, select: { orderIndex: true } });
    assert.equal(new Set(unique.map(entry => entry.orderIndex)).size, unique.length, "simultaneous inserts keep real unique indexes distinct");
    assert.equal((await turnRow(b)).updatedAt.getTime(), oldB.getTime());
    const deleteForeign = await boardRoute.DELETE(new Request(`https://example.test/api/boards/${foreignBoard}`, { method: "DELETE" }),
      { params: Promise.resolve({ boardId: foreignBoard }) });
    assert.equal(deleteForeign.status, 200, "extra owned fixture board is deleted through the authenticated consumer");

    // --- board delete refunds every charged byte ------------------------------
    const deletedBoard = await boardRoute.DELETE(new Request(`https://example.test/api/boards/${boardId}`, { method: "DELETE" }),
      { params: Promise.resolve({ boardId }) });
    assert.equal(deletedBoard.status, 200);
    // Invalid insert attempts and both deleted boards leave separate durable receipts.
    // Drain bounded default-size waves; none may be silently forgiven.
    for (let wave = 0; wave < 4 && await prisma.objectDeletionJob.count({ where: { userId } }) > 0; wave++) {
      await runObjectDeletionBatch({ now: later });
    }
    assert.equal(await prisma.objectDeletionJob.count({ where: { userId } }), 0, "all private test cleanup receipts settled");
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
