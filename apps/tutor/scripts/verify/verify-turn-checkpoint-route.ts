/**
 * Progressive turn save, server side: `PUT` and `PATCH
 * /api/boards/{boardId}/turns/{turnId}` (lib/boards/turnCheckpoint.ts) against
 * an in-memory Prisma stub and a stub canonicalizer that moves rows the way
 * the real figure intro merge does.
 *
 * Covers: create on the first checkpoint, append with audio keyed by the
 * submitted index under a per-attempt folder, seq and baseCount idempotency
 * and ordering, status only moving forward and complete being final, one turn
 * per production trace, ownership, a refused canonicalization leaving the
 * saved state alone, a validated upgrade keeping earlier audio on the right
 * rows, a text-only close dropping figure ink, the keepalive close (status
 * only, with a tail, creating, overlapping) and late audio, the 415 byte
 * check, and growth charging only new bytes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as drawing from "@heytutor/drawing";
import * as requestBody from "../../lib/http/requestBody";
import * as keys from "../../lib/object-store/keys";
import * as turnStatus from "../../lib/boards/turnStatus";
import * as uploadLimits from "../../lib/scene/turnUploadLimits";
import * as storedSceneSource from "../../lib/scene/storedSceneSource";

const root = resolve(__dirname, "../..");
// The in-memory Prisma stub intentionally accepts arbitrary query and row shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const DB_NULL = Symbol("DbNull");
class KnownRequestError extends Error {
  constructor(message: string, public code: string) { super(message); }
}
class StorageQuotaError extends Error {
  constructor(message: string, public status = 413) { super(message); }
}

const boards = [
  { id: "board-a", userId: "alice" },
  { id: "board-b", userId: "alice" },
  { id: "board-c", userId: "bob" },
];
let turns: Row[] = [];
let segments: Row[] = [];
const ownedTraces = new Map<string, Row>();
let userId = "alice";
const env: Record<string, string> = { NODE_ENV: "test" };
const uploads: Array<{ key: string; bytes: number[] }> = [];
const reservations: Row[] = [];
let canonicalizeCalls = 0;
let clock = Date.now();

function clean(value: unknown): unknown {
  return value === DB_NULL ? null : value;
}
function withSegments(turn: Row | undefined, include: unknown) {
  if (!turn) return null;
  const copy = { ...turn };
  if (include) copy.segments = segments.filter((s) => s.turnId === turn.id).sort((a, b) => a.orderIndex - b.orderIndex);
  return copy;
}
const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);

function makeClient(): Row {
  return {
    $queryRaw: async () => [{ id: "locked" }],
    board: {
      findFirst: async ({ where }: Row) => boards.find((b) => b.id === where.id && b.userId === where.userId) ?? null,
      update: async () => ({}),
    },
    turn: {
      findFirst: async ({ where, include }: Row) => withSegments(turns.find((t) => matches(t, where)), include),
      count: async ({ where }: Row) => turns.filter((t) => t.boardId === where.boardId).length,
      create: async ({ data }: Row) => {
        if (turns.some((t) => t.id === data.id || (t.boardId === data.boardId && t.orderIndex === data.orderIndex))) {
          throw new KnownRequestError("unique", "P2002");
        }
        const turn: Row = { checkpointSeq: 0, metadataBytes: 0n, storageBytes: 0n, status: "complete", kind: "lesson", resumeState: null, submittedSegments: null };
        for (const [key, value] of Object.entries(data)) turn[key] = clean(value);
        turn.createdAt = new Date(clock);
        turn.updatedAt = new Date(clock);
        turns.push(turn);
        return { ...turn };
      },
      update: async ({ where, data }: Row) => {
        const turn = turns.find((t) => t.id === where.id);
        if (!turn) throw new Error("missing turn");
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in (value as Row)) turn[key] = turn[key] + (value as Row).increment;
          else turn[key] = clean(value);
        }
        turn.updatedAt = new Date(clock);
        return { ...turn };
      },
    },
    segment: {
      deleteMany: async ({ where }: Row) => { segments = segments.filter((s) => s.turnId !== where.turnId); return {}; },
      createManyAndReturn: async ({ data }: Row) => {
        const inserted = data.map((s: Row) => ({ ...s, command: s.command ?? null, id: crypto.randomUUID() }));
        segments.push(...inserted);
        return inserted;
      },
      findMany: async ({ where }: Row) => segments.filter((s) => s.turnId === where.turnId).sort((a, b) => a.orderIndex - b.orderIndex),
    },
    ownedTrace: {
      findUnique: async ({ where }: Row) => ownedTraces.get(where.traceId) ?? null,
      update: async ({ where, data }: Row) => { Object.assign(ownedTraces.get(where.traceId)!, data); return {}; },
    },
  };
}
let tail = Promise.resolve();
const prisma: Row = {
  ...makeClient(),
  $transaction: async (run: (tx: Row) => Promise<unknown>) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((done) => { release = done; });
    await previous;
    // Roll back on a throw, like a real transaction.
    const snapshot = { turns: turns.map((t) => ({ ...t })), segments: segments.map((s) => ({ ...s })) };
    try {
      return await run(makeClient());
    } catch (error) {
      turns = snapshot.turns;
      segments = snapshot.segments;
      throw error;
    } finally { release(); }
  },
};

const SERVER_INK = drawing.serializeSegmentCommands(
  [{ type: "DRAW_LINE", params: [500, 200, 700, 200], charPosition: 0, narrationBefore: "" }],
  { trustedDiagramGeometry: true },
);

const canonicalize = async (meta: Row) => {
  canonicalizeCalls += 1;
  if (String(meta.question).includes("REFUSE") || meta.segments.some((s: Row) => s.narration === "REFUSE")) {
    return { ok: false, error: "refused by the stub" };
  }
  const rows = meta.segments.map((s: Row) => ({ ...s, sourceOrderIndex: s.orderIndex }));
  if (meta.visualStatus !== "validated") {
    if (rows.some((s: Row) => drawing.isStoredCommandTrustedGeometry(s.command))) {
      return { ok: false, error: "trusted diagram commands require a server-validated scene" };
    }
    return { ok: true, value: { sceneDocument: null, sceneEngineVersion: null, validationReport: null,
      visualStatus: "text_only", sceneArtifacts: meta.sceneArtifacts ?? null, segments: rows } };
  }
  // Like mergeServerDiagramIntro: replace submitted intro ink in place, or
  // insert the whole server intro after the leading CLEAR when none was sent.
  const hasIntro = rows.some((s: Row) => drawing.isStoredCommandTrustedGeometry(s.command));
  const merged = hasIntro
    ? rows.map((s: Row) => drawing.isStoredCommandTrustedGeometry(s.command) ? { ...s, command: SERVER_INK } : s)
    : [rows[0], { orderIndex: 0, narration: "", spokenText: "", command: SERVER_INK, sourceOrderIndex: null }, ...rows.slice(1)];
  return { ok: true, value: { sceneDocument: { id: "doc" }, sceneEngineVersion: "test", validationReport: { valid: true },
    visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3" },
    segments: merged.map((s: Row, orderIndex: number) => ({ ...s, orderIndex })) } };
};

function load(relativePath: string, dependencies: Record<string, unknown>): Row {
  const code = ts.transpileModule(readFileSync(resolve(root, relativePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Row = {};
  const compiledModule = { exports };
  vm.runInNewContext(code, {
    module: compiledModule, exports, require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Missing stub: ${name}`);
      return dependencies[name];
    },
    FormData, Blob, File, Request, Response, Headers, Uint8Array, TextEncoder, TextDecoder, crypto, AbortSignal,
    console, setTimeout, process: { env }, fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  }, { filename: relativePath });
  return compiledModule.exports;
}

const checkpoint = load("lib/boards/turnCheckpoint.ts", {
  "@prisma/client": { Prisma: { DbNull: DB_NULL, PrismaClientKnownRequestError: KnownRequestError } },
  "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
  "@heytutor/drawing": drawing,
  "@/lib/auth": { getUserId: async () => userId, ensureUser: async () => {} },
  "@/lib/db/prisma": { prisma },
  "@/lib/object-store/keys": keys,
  "@/lib/object-store/s3": {
    uploadAudio: async (key: string, bytes: Uint8Array) => {
      uploads.push({ key, bytes: Array.from(bytes) });
      return `/api/lecture-audio?key=${encodeURIComponent(key)}`;
    },
  },
  "@/lib/http/requestBody": requestBody,
  "@/lib/boards/storageQuota": {
    reserveTurnStorage: async (input: Row) => {
      const reservation = { ...input, type: "create", cleanupId: crypto.randomUUID(), pendingTurns: 1, state: "open" };
      reservations.push(reservation);
      return reservation;
    },
    reserveTurnGrowthStorage: async (input: Row) => {
      const reservation = { ...input, type: "growth", cleanupId: crypto.randomUUID(), pendingTurns: 0, state: "open" };
      reservations.push(reservation);
      return reservation;
    },
    settleTurnStorage: async (reservation: Row) => { reservation.state = "settled"; },
    abandonTurnStorage: async (reservation: Row) => { if (reservation.state === "open") reservation.state = "abandoned"; },
    withUserStorageLock: (_userId: string, run: (tx: Row) => Promise<unknown>) => prisma.$transaction(run),
    StorageQuotaError,
  },
  "@/lib/obs/traceOwnership": {
    assertOwnedTrace: async (owner: string, traceId: string) => ownedTraces.get(traceId)?.userId === owner,
  },
  "@/lib/scene/turnScenePersistence": { canonicalizeTurnSceneMetadata: canonicalize },
  "@/lib/scene/turnUploadLimits": uploadLimits,
  "@/lib/boards/turnStatus": turnStatus,
});
const client = load("lib/boards/boardsClient.ts", {
  "@/lib/scene/storedSceneSource": storedSceneSource,
  "@heytutor/tutor-core": { speechAudioMimeType: () => "audio/mpeg", resolveApiUrl: (url: string) => `https://example.test${url}` },
  "@/lib/boards/boardTitle": { finalizeBoardTitle: () => "title" },
  "@/lib/boards/turnStatus": turnStatus,
});
const handleTurnCheckpoint = checkpoint.handleTurnCheckpoint as (r: Request, p: Row) => Promise<Response>;
const handleTurnClose = checkpoint.handleTurnClose as (r: Request, p: Row) => Promise<Response>;

const MP3 = (tag: number) => new Uint8Array([73, 68, 51, 4, 0, 0, tag, tag, tag, tag, tag, tag]);
const CLEAR = { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" };
const write = (text: string) => ({ type: "WRITE", params: [90, 145, 28], text, charPosition: 0, narrationBefore: "" });
const row = (orderIndex: number, text: string, command: unknown = write(text)) =>
  ({ orderIndex, narration: text, spokenText: text, command, durationMs: 900 });

async function put(turnId: string, meta: Row, audio: Record<number, Uint8Array> = {}, boardId = "board-a") {
  const form = new FormData();
  form.append("metadata", JSON.stringify({ question: "Find the slope.", rawResponse: "", status: "live", ...meta }));
  for (const [index, bytes] of Object.entries(audio)) {
    form.append(`audio-${index}`, new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }));
  }
  const response = await handleTurnCheckpoint(
    new Request(`https://example.test/api/boards/${boardId}/turns/${turnId}`, { method: "PUT", body: form }),
    { boardId, turnId },
  );
  return { status: response.status, body: await response.json() as Row };
}
async function close(turnId: string, body: Row, boardId = "board-a") {
  const response = await handleTurnClose(
    new Request(`https://example.test/api/boards/${boardId}/turns/${turnId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    { boardId, turnId },
  );
  return { status: response.status, body: await response.json() as Row };
}
const stored = (turnId: string) => turns.find((t) => t.id === turnId)!;
const rowsOf = (turnId: string) => segments.filter((s) => s.turnId === turnId).sort((a, b) => a.orderIndex - b.orderIndex);
const audioKeyOf = (url: string | null) => url ? decodeURIComponent(url.split("key=")[1] ?? "") : null;

async function main() {
  // --- 1. the first checkpoint creates the turn ------------------------------
  const lesson = crypto.randomUUID();
  const first = await put(lesson, {
    seq: 1, baseCount: 0, kind: "lesson", preview: "Find the slope.",
    appendSegments: [row(0, "", CLEAR), row(1, "Write the rise.")],
  }, { 1: MP3(1) });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(stored(lesson).status, "live");
  assert.equal(stored(lesson).kind, "lesson");
  assert.equal(stored(lesson).checkpointSeq, 1);
  assert.equal(first.body.serverCount, 2);
  assert.equal(first.body.turn.status, "live");
  assert.equal(rowsOf(lesson).length, 2);
  const firstReservation = reservations.at(-1)!;
  assert.equal(firstReservation.type, "create", "the first checkpoint reserves a new turn");
  assert.equal(firstReservation.state, "settled");
  const firstKey = audioKeyOf(rowsOf(lesson)[1]!.audioUrl)!;
  assert.match(firstKey, new RegExp(`^lectures/board-a/${lesson}/[a-z0-9]{12}/1\\.mp3$`),
    "audio lives under a per-attempt folder, keyed by the submitted index");
  assert.ok(firstKey.startsWith(firstReservation.prefix), "the cleanup intent covers the attempt folder");
  assert.notEqual(firstReservation.prefix, `lectures/board-a/${lesson}/`, "never the whole turn folder");
  assert.equal(keys.parseStoredObjectKey(firstKey)?.kind, "lecture", "media serving still parses the key");
  assert.equal(rowsOf(lesson)[1]!.audioRef, 1);
  const chargedAfterFirst = stored(lesson).storageBytes as bigint;
  assert.equal(chargedAfterFirst, BigInt(firstReservation.bytes));

  // --- 2. a later checkpoint appends rows and audio --------------------------
  const uploadsBefore = uploads.length;
  const second = await put(lesson, {
    seq: 2, baseCount: 2, rawResponse: "Write the rise. Then the run.",
    appendSegments: [row(2, "Then the run."), row(3, "Divide.")],
  }, { 2: MP3(2) });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(rowsOf(lesson).length, 4);
  assert.equal(audioKeyOf(rowsOf(lesson)[1]!.audioUrl), firstKey, "an earlier clip keeps its URL");
  const secondKey = audioKeyOf(rowsOf(lesson)[2]!.audioUrl)!;
  assert.match(secondKey, /\/2\.mp3$/);
  const growth = reservations.at(-1)!;
  assert.equal(growth.type, "growth", "appends reserve growth, not a new turn slot");
  assert.equal(growth.state, "settled");
  assert.notEqual(growth.prefix, firstReservation.prefix, "each attempt has its own folder");
  assert.ok(secondKey.startsWith(growth.prefix));
  assert.equal(uploads.length, uploadsBefore + 1, "only the new clip is uploaded");
  assert.equal(stored(lesson).storageBytes, chargedAfterFirst + BigInt(growth.bytes),
    "storage grows by exactly the charged growth");
  assert.ok(growth.bytes < firstReservation.bytes + 12 + 2_000, "growth charges new bytes, not the whole turn again");
  assert.ok(growth.bytes >= 12, "growth includes the new clip");

  // --- 3. replay and reordering ---------------------------------------------
  const replay = await put(lesson, {
    seq: 2, baseCount: 2, appendSegments: [row(2, "Then the run."), row(3, "Divide.")],
  }, { 2: MP3(2) });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.stale, true, "a replayed seq is stale");
  assert.equal(uploads.length, uploadsBefore + 1, "a replay uploads nothing");
  assert.equal(rowsOf(lesson).length, 4);
  const older = await put(lesson, { seq: 1, baseCount: 0, appendSegments: [row(0, "", CLEAR)] });
  assert.equal(older.body.stale, true, "an older seq after a newer one is stale");
  const reservationsBefore = reservations.length;
  const gap = await put(lesson, { seq: 3, baseCount: 7, appendSegments: [row(7, "Too far.")] }, { 7: MP3(7) });
  assert.equal(gap.status, 409, "a baseCount the server does not hold is refused");
  assert.equal(gap.body.serverCount, 4);
  assert.equal(gap.body.serverSeq, 2);
  assert.equal(uploads.length, uploadsBefore + 1, "a conflict uploads nothing");
  assert.equal(reservations.length, reservationsBefore, "a conflict reserves nothing");

  // --- 4. refused canonicalization keeps the saved state ----------------------
  const refused = await put(lesson, { seq: 3, baseCount: 4, appendSegments: [row(4, "REFUSE")] }, { 4: MP3(4) });
  assert.equal(refused.status, 400);
  assert.equal(rowsOf(lesson).length, 4, "a refused checkpoint keeps the previous rows");
  assert.equal(stored(lesson).checkpointSeq, 2, "and the previous seq");
  assert.equal(uploads.length, uploadsBefore + 1, "and uploads nothing");

  // --- 5. 415 byte check ------------------------------------------------------
  const forged = await put(lesson, { seq: 3, baseCount: 4, appendSegments: [row(4, "Next.")] },
    { 4: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) });
  assert.equal(forged.status, 415, "audio bytes must match the declared type");
  assert.equal(rowsOf(lesson).length, 4);

  // --- 6. a validated upgrade merges the server intro, audio stays put --------
  const upgraded = await put(lesson, {
    seq: 3, baseCount: 4, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3" },
    appendSegments: [row(4, "Look at the line.")],
  }, { 4: MP3(4) });
  assert.equal(upgraded.status, 200, JSON.stringify(upgraded.body));
  const afterIntro = rowsOf(lesson);
  assert.equal(afterIntro.length, 6, "the server intro row is inserted");
  assert.ok(drawing.isStoredCommandTrustedGeometry(afterIntro[1]!.command));
  assert.equal(afterIntro[1]!.audioUrl, null, "a server-built intro row has no recording");
  assert.equal(afterIntro[1]!.audioRef, null);
  assert.equal(afterIntro[2]!.narration, "Write the rise.");
  assert.equal(audioKeyOf(afterIntro[2]!.audioUrl), firstKey, "audio follows its submitted row after the merge");
  assert.equal(afterIntro[2]!.audioRef, 1);
  assert.equal(audioKeyOf(afterIntro[3]!.audioUrl), secondKey);
  assert.match(audioKeyOf(afterIntro[5]!.audioUrl)!, /\/4\.mp3$/);

  // --- 7. status only moves forward; complete is final ------------------------
  const stopped = await put(lesson, { seq: 4, baseCount: 5, status: "stopped", visualStatus: "validated",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3" }, appendSegments: [] });
  assert.equal(stopped.status, 200);
  assert.equal(stored(lesson).status, "stopped");
  const lateLive = await put(lesson, { seq: 5, baseCount: 5, status: "live", visualStatus: "validated",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3" }, appendSegments: [row(5, "One more row.")] });
  assert.equal(lateLive.status, 200);
  assert.equal(stored(lesson).status, "stopped", "a late live checkpoint saves rows but cannot reopen a stopped turn");
  assert.equal(rowsOf(lesson).at(-1)!.narration, "One more row.");
  const incomplete = await put(lesson, { seq: 6, baseCount: 6, status: "complete", rawResponse: "",
    visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3" }, appendSegments: [] });
  assert.equal(incomplete.status, 400, "complete needs the narration");
  const done = await put(lesson, { seq: 6, baseCount: 6, status: "complete", rawResponse: "The slope is 2.",
    visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3" }, appendSegments: [] });
  assert.equal(done.status, 200);
  assert.equal(stored(lesson).status, "complete");
  assert.equal(stored(lesson).submittedSegments, null, "pre-canonical rows are dropped once complete");
  const uploadsAtComplete = uploads.length;
  const afterDone = await put(lesson, { seq: 7, baseCount: 6, status: "live", appendSegments: [row(6, "Again.")] }, { 6: MP3(6) });
  assert.equal(afterDone.status, 200);
  assert.equal(afterDone.body.final, true, "complete is terminal");
  assert.equal(stored(lesson).status, "complete");
  assert.equal(uploads.length, uploadsAtComplete);
  const closeDone = await close(lesson, { seq: 8, status: "stopped" });
  assert.equal(closeDone.body.turn.status, "complete", "a close cannot move a complete turn back");

  // --- 8. ownership -----------------------------------------------------------
  userId = "bob";
  const foreign = await put(lesson, { seq: 9, baseCount: 0, appendSegments: [] }, {}, "board-c");
  assert.equal(foreign.status, 404, "another user's turn id is not found");
  userId = "alice";
  const otherBoard = await put(lesson, { seq: 9, baseCount: 0, appendSegments: [] }, {}, "board-b");
  assert.equal(otherBoard.status, 404, "a turn id from another board is not found");
  const badId = await put("not-a-uuid", { seq: 1, baseCount: 0, appendSegments: [] });
  assert.equal(badId.status, 400);

  // --- 9. production: one turn per trace --------------------------------------
  env.NODE_ENV = "production";
  ownedTraces.set("trace-1", { traceId: "trace-1", userId: "alice", expiresAt: new Date(Date.now() + 60_000), savedTurnId: null });
  const traced = crypto.randomUUID();
  const noTrace = await put(traced, { seq: 1, baseCount: 0, appendSegments: [row(0, "", CLEAR)] });
  assert.equal(noTrace.status, 403, "production checkpoints need an owned trace");
  const tracedCreate = await put(traced, { seq: 1, baseCount: 0, traceId: "trace-1", appendSegments: [row(0, "", CLEAR)] });
  assert.equal(tracedCreate.status, 200);
  assert.equal(ownedTraces.get("trace-1")!.savedTurnId, traced, "the create claims the trace");
  const tracedAppend = await put(traced, { seq: 2, baseCount: 1, traceId: "trace-1", appendSegments: [row(1, "Go on.")] });
  assert.equal(tracedAppend.status, 200, "later checkpoints of the same turn keep using the trace");
  const duplicate = crypto.randomUUID();
  const dup = await put(duplicate, { seq: 1, baseCount: 0, traceId: "trace-1", appendSegments: [row(0, "", CLEAR)] });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "trace_saved");
  assert.equal(dup.body.turn.id, traced, "a second turn on the trace gets the first one back");
  assert.equal(turns.some((t) => t.id === duplicate), false);
  ownedTraces.set("trace-2", { traceId: "trace-2", userId: "alice", expiresAt: new Date(Date.now() + 60_000), savedTurnId: null });
  const mismatch = await put(traced, { seq: 3, baseCount: 2, traceId: "trace-2", appendSegments: [] });
  assert.equal(mismatch.status, 409, "a saved turn's trace cannot change");
  env.NODE_ENV = "test";

  // --- 10. a text-only checkpoint drops figure ink the server holds -----------
  const figure = crypto.randomUUID();
  const intro = drawing.serializeSegmentCommands(
    [{ type: "DRAW_LINE", params: [1, 2, 3, 4], charPosition: 0, narrationBefore: "" }], { trustedDiagramGeometry: true });
  const validated = await put(figure, { seq: 1, baseCount: 0, visualStatus: "validated",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3" },
    appendSegments: [row(0, "", CLEAR), row(1, "", intro), row(2, "Read the graph.")] });
  assert.equal(validated.status, 200);
  const textOnly = await put(figure, { seq: 2, baseCount: 3, status: "stopped", visualStatus: "text_only",
    sceneArtifacts: null, appendSegments: [row(3, "Stopped here.")] });
  assert.equal(textOnly.status, 200, JSON.stringify(textOnly.body));
  assert.equal(rowsOf(figure).some((s) => drawing.isStoredCommandTrustedGeometry(s.command)), false,
    "a text-only save keeps no trusted figure ink");
  assert.deepEqual(rowsOf(figure).map((s) => s.narration), ["", "Read the graph.", "Stopped here."]);
  assert.equal(stored(figure).submittedSegments.length, 4, "the submitted rows are kept for a later upgrade");

  // --- 11. the keepalive close -------------------------------------------------
  const closing = crypto.randomUUID();
  await put(closing, { seq: 1, baseCount: 0, appendSegments: [row(0, "", CLEAR), row(1, "First.")] }, { 1: MP3(9) });
  const statusOnly = await close(closing, { seq: 2, status: "stopped" });
  assert.equal(statusOnly.status, 200);
  assert.equal(stored(closing).status, "stopped");
  assert.equal(stored(closing).checkpointSeq, 1, "a status-only close keeps seq");
  const withTail = await close(closing, { seq: 2, status: "stopped", baseCount: 2, rawResponse: "First. Second.",
    appendSegments: [row(2, "Second."), row(3, "Third.")] });
  assert.equal(withTail.status, 200, JSON.stringify(withTail.body));
  assert.equal(rowsOf(closing).length, 4);
  assert.equal(rowsOf(closing)[2]!.audioUrl, null, "the close carries no audio");
  assert.equal(stored(closing).checkpointSeq, 2, "a close with rows takes its seq");
  const overlap = await close(closing, { seq: 3, status: "stopped", baseCount: 3,
    appendSegments: [row(3, "Third."), row(4, "Fourth.")] });
  assert.equal(overlap.status, 200);
  assert.deepEqual(rowsOf(closing).map((s) => s.narration), ["", "First.", "Second.", "Third.", "Fourth."],
    "rows the server already holds are skipped, not doubled");
  const late = await put(closing, { seq: 4, baseCount: 5, status: "stopped", appendSegments: [] }, { 2: MP3(22), 1: MP3(11) });
  assert.equal(late.status, 200, JSON.stringify(late.body));
  assert.match(audioKeyOf(rowsOf(closing)[2]!.audioUrl)!, /\/2\.mp3$/, "late audio attaches to a held row");
  assert.equal(uploads.some((u) => u.bytes[6] === 11), false, "a row that already has audio is not re-uploaded");
  const created = crypto.randomUUID();
  const createdByClose = await close(created, { seq: 1, status: "stopped", question: "Why is the sky blue?",
    preview: "Why is the sky blue?", baseCount: 0, appendSegments: [row(0, "", CLEAR)] });
  assert.equal(createdByClose.status, 200, JSON.stringify(createdByClose.body));
  assert.equal(stored(created).status, "stopped", "a lesson that died before its first checkpoint is kept");
  assert.equal(stored(created).question, "Why is the sky blue?");
  const missing = await close(crypto.randomUUID(), { seq: 1, status: "stopped" });
  assert.equal(missing.status, 404, "a close with nothing to create is not found");

  // --- 13. the browser client round trip --------------------------------------
  const sent: Array<{ method: string; keepalive: boolean; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    sent.push({ method: request.method, keepalive: init?.keepalive === true, body: init?.body });
    const match = /\/api\/boards\/([^/]+)\/turns\/([^/?]+)/.exec(request.url)!;
    const params = { boardId: match[1], turnId: match[2] };
    return request.method === "PUT" ? handleTurnCheckpoint(request, params) : handleTurnClose(request, params);
  };
  try {
    const live = crypto.randomUUID();
    const recorded = (text: string, audio: Uint8Array | null) =>
      ({ orderIndex: 99, narration: text, spokenText: text, command: write(text), audioBytes: audio, durationMs: 700, timings: null });
    const scene = { visualStatus: "text_only", sceneArtifacts: null };
    const createdByClient = await client.checkpointTurn("board-a", live, {
      seq: 1, status: "live", baseCount: 0, question: "Q", rawResponse: "", scene,
      segments: [{ ...recorded("", null), command: CLEAR }, recorded("One.", MP3(31))],
    });
    assert.equal(createdByClient.ok, true, JSON.stringify(createdByClient));
    assert.equal(createdByClient.serverCount, 2);
    assert.equal(createdByClient.turn.status, "live");
    assert.equal(createdByClient.turn.kind, "lesson");
    assert.match(audioKeyOf(rowsOf(live)[1]!.audioUrl)!, /\/1\.mp3$/, "the client keys audio by baseCount + k");
    const conflict = await client.checkpointTurn("board-a", live, {
      seq: 2, status: "live", baseCount: 5, question: "Q", rawResponse: "", scene, segments: [recorded("Two.", null)],
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.reason, "conflict");
    assert.equal(conflict.retryable, true);
    assert.equal(conflict.serverCount, 2, "a conflict tells the client where to resend from");
    const closedByClient = await client.closeTurnKeepalive("board-a", live, {
      seq: 2, baseCount: 2, segments: [recorded("Two.", MP3(32))], rawResponse: "One. Two.",
    });
    assert.equal(closedByClient.ok, true, JSON.stringify(closedByClient));
    assert.equal(closedByClient.turn.status, "stopped");
    assert.equal(rowsOf(live).length, 3);
    assert.equal(rowsOf(live)[2]!.audioUrl, null, "the keepalive close never carries audio");
    const patch = sent.at(-1)!;
    assert.equal(patch.method, "PATCH");
    assert.equal(patch.keepalive, true, "the close is a keepalive fetch");
    const lateByClient = await client.checkpointTurn("board-a", live, {
      seq: 3, status: "stopped", baseCount: 3, question: "Q", rawResponse: "One. Two.", scene, segments: [],
      lateAudio: [{ orderIndex: 2, audioBytes: MP3(33) }],
    });
    assert.equal(lateByClient.ok, true, JSON.stringify(lateByClient));
    assert.ok(rowsOf(live)[2]!.audioUrl, "late audio from the client attaches to the held row");
    const tiny = JSON.parse(client.buildTurnCloseBody({ seq: 9, baseCount: 0, question: "Q",
      segments: Array.from({ length: 60 }, (_, i) => recorded(`Row ${i} `.repeat(30), null)) }, 2_000));
    assert.equal(tiny.appendSegments, undefined, "an oversized tail falls back to a status-only close");
    assert.equal(tiny.question, "Q", "the status-only close can still create the turn");
    assert.equal(client.classifySaveFailure(429, { error: "turn storage quota exceeded" }).reason, "quota");
    assert.equal(client.classifySaveFailure(429, { error: "rate_limited" }).retryable, true);
    assert.equal(client.classifySaveFailure(413, { error: "account storage quota exceeded" }).reason, "quota");
    assert.equal(client.classifySaveFailure(409, { code: "trace_saved" }).retryable, false);
    assert.equal(client.classifySaveFailure(0, null).reason, "network");
  } finally {
    globalThis.fetch = originalFetch;
  }

  // --- 12. stale live reads as stopped ------------------------------------------
  assert.equal(turnStatus.effectiveTurnStatus("live", new Date(clock - 121_000), clock), "stopped");
  assert.equal(turnStatus.effectiveTurnStatus("live", new Date(clock - 5_000), clock), "live");
  assert.equal(turnStatus.effectiveTurnStatus(undefined, null, clock), "complete");
  clock += 1;

  // --- 13. the transport admits a checkpoint's audio ------------------------------
  // server.ts caps every body by path; a checkpoint left on the 512 KB JSON cap
  // would 413 on its first WAV clip.
  const limits = await import("../../lib/http/resourceLimits");
  assert.equal(limits.requestBodyLimitForPath("/api/boards/b/turns/t"), limits.MAX_TURN_BODY_BYTES);
  assert.equal(limits.requestBodyLimitForPath("/api/boards/b/turns"), limits.MAX_TURN_BODY_BYTES);
  assert.equal(limits.requestBodyLimitForPath("/api/boards/b/turns/t/x"), limits.MAX_JSON_BODY_BYTES);

  assert.ok(canonicalizeCalls > 0);
  assert.equal(reservations.filter((r) => r.state === "open").length, 0, "every reservation is settled or abandoned");
  console.log("verify-turn-checkpoint-route: create, append, idempotency, order, status, trace, ownership, audio refs, close and late audio verified");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
