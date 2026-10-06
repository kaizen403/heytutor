/**
 * The progressive lesson save, driven for real: `LiveTurnSaveRegistry` from
 * `features/tutor-session/lib/turn/liveTurnSave.ts` with a fake transport that
 * keeps the server's rules (seq, baseCount, status only forward, complete is
 * final), a fake clock and a fake online flag. No network, no React.
 *
 * What it proves:
 * - one request in flight per turn; rows recorded meanwhile go in the next one
 * - a lesson opens its page with the runtime CLEAR, a doubt continues it
 * - figure intro rows wait for the figure; a rolled back or undrawn figure
 *   never sends them; Stop with the figure kept sends them
 * - close is idempotent and saves a turn that taught nothing (decision 6)
 * - a doubt's first save waits for the lesson it stopped; a lesson that never
 *   reached the server makes the doubt open its own page
 * - backoff 1, 2, 4, 8, 16, 30 s, then failed; retry; offline waits for online
 * - a refused figure is retried once as text only (decision 7)
 * - a 409 resends from the server's count; complete is final
 * - the segment Stop cut off is saved without audio (decision 12) and never
 *   exported as a finished step
 * - Stop in the first step of a doubt or resume keeps that cut step: the turn
 *   waits for the segment's late cleanup before it counts as empty
 * - a checkpoint that never answers is aborted after its timeout and retried,
 *   so Stop and Try again still send
 * - reopening a board hands back the turns the server does not hold in full,
 *   and sends a save that gave up again
 * - the keepalive close fits its budget beside telemetry's page away body
 * - the local mirror lands only on the board that is still open
 * - `liveTurnFor` / `hasLiveTurn` / `statusFor` / `drained` / `hasUnsentData`
 */
import assert from "node:assert/strict";
import {
  buildTurnCloseBody,
  KEEPALIVE_CLOSE_MAX_BYTES,
  type RecordedSegmentPayload,
  type SaveFailure,
  type StoredTurn,
  type TurnCheckpointInput,
  type TurnCheckpointResult,
  type TurnCloseInput,
} from "../../lib/boards/boardsClient";
import { boardContinuationOf } from "../../lib/boards/boardContinuation";
import { MAX_PAGE_AWAY_TELEMETRY_BYTES, MAX_TELEMETRY_BODY_BYTES } from "../../lib/obs/turnTelemetry";
import {
  CHECKPOINT_TIMEOUT_MS,
  checkpointTimeoutMs,
  CUT_ROW_GRACE_MS,
  LiveTurnSaveRegistry,
  SAVE_RETRY_DELAYS_MS,
  type LiveTurnMirrorEvent,
} from "../../features/tutor-session/lib/turn/liveTurnSave";
import { lessonPageRecord, doubtPageRecord, type BoardPageRecord } from "../../features/tutor-session/lib/turn/doubtTurn";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type Call =
  | { method: "PUT"; boardId: string; turnId: string; input: TurnCheckpointInput; resolve: (r: TurnCheckpointResult) => void }
  | { method: "PATCH"; boardId: string; turnId: string; input: TurnCloseInput; resolve: (r: TurnCheckpointResult) => void };

interface ServerTurn { count: number; seq: number; status: "live" | "stopped" | "complete"; rows: Array<{ narration: string; audio: boolean }> }

function harness() {
  let now = 1_000;
  let online = true;
  let nextTimer = 1;
  let ids = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const calls: Call[] = [];
  const server = new Map<string, ServerTurn>();
  const registry = new LiveTurnSaveRegistry({
    transport: {
      checkpoint: (boardId, turnId, input) => new Promise((resolve) => calls.push({ method: "PUT", boardId, turnId, input, resolve })),
      close: (boardId, turnId, input) => new Promise((resolve) => calls.push({ method: "PATCH", boardId, turnId, input, resolve })),
    },
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
    now: () => now,
    isOnline: () => online,
    mintId: () => `turn-${++ids}`,
  });

  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
      await settle();
    }
    now = until;
    await settle();
  };
  const turnOf = (status: ServerTurn["status"], turnId: string): StoredTurn => ({
    id: turnId, orderIndex: 0, question: "q", rawResponse: "", speedMultiplier: 1, traceId: null,
    sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
    sceneArtifacts: null, segments: [], status,
  });
  const rank = { live: 0, stopped: 1, complete: 2 } as const;
  /** Answer a call the way the checkpoint route does. */
  const ack = async (call: Call) => {
    const held = server.get(call.turnId);
    if (held?.status === "complete") {
      call.resolve({ ok: true, turn: turnOf("complete", call.turnId), serverCount: null, serverSeq: held.seq, stale: true, final: true });
      await settle();
      return;
    }
    if (held && call.input.seq <= held.seq && call.method === "PUT") {
      call.resolve({ ok: true, turn: turnOf(held.status, call.turnId), serverCount: held.count, serverSeq: held.seq, stale: true, final: false });
      await settle();
      return;
    }
    const base = call.input.baseCount;
    const rows = call.input.segments ?? [];
    const state: ServerTurn = held ?? { count: 0, seq: 0, status: "live", rows: [] };
    if (call.method === "PUT" && base !== state.count) {
      call.resolve({ ok: false, status: 409, error: "baseCount", reason: "conflict", retryable: true, serverCount: state.count, serverSeq: state.seq });
      await settle();
      return;
    }
    rows.forEach((row, k) => {
      const index = base + k;
      if (index < state.count) return;
      state.rows[index] = { narration: row.narration, audio: call.method === "PUT" && Boolean(row.audioBytes?.length) };
    });
    state.count = Math.max(state.count, base + rows.length);
    const wanted = call.input.status ?? "stopped";
    if (rank[wanted] > rank[state.status]) state.status = wanted;
    state.seq = call.input.seq;
    server.set(call.turnId, state);
    const final = state.status === "complete";
    call.resolve({ ok: true, turn: turnOf(state.status, call.turnId), serverCount: final ? null : state.count, serverSeq: state.seq, stale: false, final });
    await settle();
  };
  const fail = async (call: Call, failure: SaveFailure) => {
    call.resolve(failure);
    await settle();
  };
  return {
    registry, calls, server, timers, settle, advance, ack, fail,
    setOnline(value: boolean) { online = value; },
    get now() { return now; },
  };
}

const NETWORK: SaveFailure = { ok: false, status: 0, error: "network error", reason: "network", retryable: true };
const REFUSED: SaveFailure = { ok: false, status: 400, error: "scene persistence rejected: x", reason: "refused", retryable: false };
const FORBIDDEN: SaveFailure = { ok: false, status: 403, error: "forbidden", reason: "forbidden", retryable: false };

let rowCounter = 0;
function row(narration = `step ${++rowCounter}`, audio = true): RecordedSegmentPayload {
  return {
    orderIndex: 99,
    narration,
    spokenText: narration,
    command: { type: "WRITE", params: [400, 100], text: narration, charPosition: 0, narrationBefore: "" } as never,
    audioBytes: audio ? new Uint8Array([0x49, 0x44, 0x33, rowCounter & 0xff]) : null,
    durationMs: 900,
    timings: null,
  };
}

const LESSON = "Why does a ball thrown up slow down?";
const owner = { current: false };

function begin(h: ReturnType<typeof harness>, options: {
  generation: number; boardId?: string; kind?: "lesson" | "doubt" | "resume"; continuesBoard?: boolean; page?: BoardPageRecord;
  question?: string;
}) {
  const boardId = options.boardId ?? "board-1";
  const kind = options.kind ?? "lesson";
  const page = options.page ?? lessonPageRecord(boardId, LESSON);
  return {
    page,
    handle: h.registry.begin({
      owner, generation: options.generation, boardId, traceId: `trace-${options.generation}`, kind,
      question: options.question ?? (kind === "doubt" ? "Why is it negative?" : LESSON),
      preview: LESSON, speedMultiplier: 1, continuesBoard: options.continuesBoard ?? false, page,
    }),
  };
}

function isClear(r: { command: unknown; narration: string }): boolean {
  return !r.narration && (r.command as { type?: string } | null)?.type === "CLEAR";
}

const validatedScene = {
  sceneDocument: { schemaVersion: "scene-document/v2" },
  sceneEngineVersion: "test",
  validationReport: { valid: true, issues: [] },
  visualStatus: "validated" as const,
  sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: { plan: true } },
};

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function oneInFlightAndCoalescing() {
  const h = harness();
  const { page } = begin(h, { generation: 1 });
  h.registry.recordRow(owner, 1, row("first"), { intro: false });
  await h.settle();
  assert.equal(h.calls.length, 1, "the first row goes out at once");
  const first = h.calls[0]!;
  assert(first.method === "PUT");
  assert.equal(first.input.seq, 1);
  assert.equal(first.input.baseCount, 0);
  assert.equal(first.input.status, "live");
  assert.equal(first.input.kind, "lesson");
  assert.equal(first.input.segments.length, 2, "CLEAR plus the row");
  assert(isClear(first.input.segments[0]!), "a lesson opens its page with the runtime CLEAR");
  assert.equal(first.input.question, LESSON);
  assert.equal(first.input.traceId, "trace-1", "saved under the billed trace");
  assert.equal(page.turn.saved, false, "saved is never claimed before the answer");
  h.registry.recordRow(owner, 1, row("second"), { intro: false });
  h.registry.recordRow(owner, 1, row("third"), { intro: false });
  await h.settle();
  assert.equal(h.calls.length, 1, "one request in flight per turn");
  assert(h.registry.hasUnsentData(), "unsent rows are pending");
  await h.ack(first);
  assert.equal(page.turn.saved, true, "saved once the server answered");
  assert.equal(h.calls.length, 2, "the rows recorded meanwhile go in one request");
  const second = h.calls[1]!;
  assert(second.method === "PUT");
  assert.equal(second.input.seq, 2, "seq strictly increases");
  assert.equal(second.input.baseCount, 2);
  assert.deepEqual(second.input.segments.map((r) => r.narration), ["second", "third"]);
  assert.equal(second.input.rawResponse, "first second third", "the words taught so far");
  await h.ack(second);
  assert.equal(h.calls.length, 2);
  assert.equal(h.registry.hasUnsentData(), false, "nothing pending once acked");
  const status = h.registry.statusFor("board-1");
  assert.equal(status.kind, "saved");
  assert.equal(h.registry.statusFor("board-1"), status, "a stable snapshot while nothing changed");
}

async function introRowsWaitForTheFigure() {
  const h = harness();
  const page = lessonPageRecord("board-1", LESSON);
  page.turn.scene = { ...validatedScene };
  begin(h, { generation: 1, page });
  h.registry.recordRow(owner, 1, row("opening"), { intro: false });
  await h.settle();
  const opening = h.calls[0]!;
  assert(opening.method === "PUT");
  assert.equal(opening.input.scene.visualStatus, "text_only", "an undrawn figure is not stated");
  assert.deepEqual((opening.input.scene.sceneArtifacts as { turnPlan?: unknown }).turnPlan, { plan: true }, "the plan is kept");
  await h.ack(opening);
  h.registry.recordRow(owner, 1, row("beat one"), { intro: true });
  h.registry.recordRow(owner, 1, row("beat two"), { intro: true });
  await h.settle();
  assert.equal(h.calls.length, 1, "intro rows are held until the figure commits");
  page.figureDrawn = true;
  h.registry.figureCommitted(owner, 1);
  await h.settle();
  assert.equal(h.calls.length, 2, "the commit sends them at once");
  const intro = h.calls[1]!;
  assert(intro.method === "PUT");
  assert.deepEqual(intro.input.segments.map((r) => r.narration), ["beat one", "beat two"]);
  assert.equal(intro.input.scene.visualStatus, "validated", "with the figure, once drawn");

  // Rolled back: never sent, and the lesson goes on saving after it.
  const r = harness();
  const rolled = lessonPageRecord("board-1", LESSON);
  rolled.turn.scene = { ...validatedScene };
  begin(r, { generation: 1, page: rolled });
  r.registry.recordRow(owner, 1, row("opening"), { intro: false });
  await r.settle();
  await r.ack(r.calls[0]!);
  r.registry.recordRow(owner, 1, row("doomed beat"), { intro: true });
  r.registry.dropIntroRows(owner, 1);
  r.registry.recordRow(owner, 1, row("after"), { intro: false });
  await r.settle();
  assert.equal(r.calls.length, 2);
  const after = r.calls[1]!;
  assert(after.method === "PUT");
  assert.deepEqual(after.input.segments.map((x) => x.narration), ["after"], "a rolled back intro row is never saved");

  // Stop mid figure, figure not kept: held rows are dropped.
  const s = harness();
  const stopped = lessonPageRecord("board-1", LESSON);
  stopped.turn.scene = { ...validatedScene };
  const plain = begin(s, { generation: 1, page: stopped });
  s.registry.recordRow(owner, 1, row("opening"), { intro: false });
  await s.settle();
  await s.ack(s.calls[0]!);
  s.registry.recordRow(owner, 1, row("half figure"), { intro: true });
  plain.handle.close();
  await s.settle();
  const close = s.calls[1]!;
  assert(close.method === "PUT");
  assert.equal(close.input.status, "stopped");
  assert.deepEqual(close.input.segments, [], "an uncommitted figure's rows never reach the server");
  assert.equal(close.input.scene.visualStatus, "text_only");

  // Stop for a doubt keeps the figure: held rows go with the close.
  const k = harness();
  const kept = lessonPageRecord("board-1", LESSON);
  kept.turn.scene = { ...validatedScene };
  const keep = begin(k, { generation: 1, page: kept });
  k.registry.recordRow(owner, 1, row("figure beat"), { intro: true });
  kept.figureDrawn = true; // what stopTurn({ keepVisibleBoard }) does before it closes
  keep.handle.close();
  await k.settle();
  const keptClose = k.calls[0]!;
  assert(keptClose.method === "PUT");
  assert.deepEqual(keptClose.input.segments.map((x) => x.narration), ["", "figure beat"]);
  assert.equal(keptClose.input.scene.visualStatus, "validated");
}

async function closeIsIdempotentAndKeepsEmptyTurns() {
  const h = harness();
  const { handle } = begin(h, { generation: 1 });
  await h.settle();
  assert.equal(h.calls.length, 0, "nothing is sent while a turn has taught nothing");
  assert.equal(h.registry.hasUnsentData(), false, "no beforeunload prompt for a lesson still planning");
  handle.close();
  handle.close();
  h.registry.closeOwner(owner);
  await h.settle();
  assert.equal(h.calls.length, 1, "close is idempotent");
  const close = h.calls[0]!;
  assert(close.method === "PUT");
  assert.equal(close.input.status, "stopped", "a lesson that died in planning is kept as stopped");
  assert.equal(close.input.question, LESSON, "with its exact question");
  assert.equal(close.input.segments.length, 1, "and the CLEAR, so its page is blank, not the page before");
  await h.ack(close);
  handle.close();
  h.registry.closeOwner(owner);
  await h.settle();
  assert.equal(h.calls.length, 1, "closing a saved stopped turn again sends nothing");
  const done = handle.complete({ rawResponse: "late" });
  await h.settle();
  assert.equal(h.calls.length, 2, "a stopped turn may still complete");
  await h.ack(h.calls[1]!);
  const result = await done;
  assert(result.ok, "complete resolves with the server turn");
  handle.close();
  h.registry.recordRow(owner, 1, row(), { intro: false });
  await h.settle();
  assert.equal(h.calls.length, 2, "a complete turn is final");
}

async function emptyDoubtIsNotSaved() {
  const h = harness();
  const mirrored: LiveTurnMirrorEvent[] = [];
  h.registry.attach(owner, { openBoardId: () => "board-1", mirror: (event) => mirrored.push(event) });
  const { handle } = begin(h, { generation: 1, kind: "doubt", continuesBoard: true, page: doubtPageRecord({
    boardId: "board-1", lessonQuestion: LESSON, title: "Why?", continuesBoard: true,
    figureDrawn: false, turnPlan: null, solverProjection: null,
  }) });
  handle.close();
  h.registry.pageHideClose();
  await h.settle();
  assert.equal(h.calls.length, 0, "a doubt that taught nothing is not saved as an empty turn");
  assert.equal(mirrored.length, 0, "nor shown as one");
  assert.equal(h.registry.hasUnsentData(), false);
  // It never holds up the next turn on the board.
  begin(h, { generation: 2 });
  h.registry.recordRow(owner, 2, row("next lesson"), { intro: false });
  await h.settle();
  assert.equal(h.calls.length, 1, "the next lesson saves at once");
}

async function doubtWaitsForTheLessonItStopped() {
  const h = harness();
  const lesson = begin(h, { generation: 1 });
  h.registry.recordRow(owner, 1, row("lesson step"), { intro: false });
  await h.settle();
  lesson.handle.close();
  const doubtPage = doubtPageRecord({
    boardId: "board-1", lessonQuestion: LESSON, title: "Why is it negative?", continuesBoard: true,
    figureDrawn: false, turnPlan: null, solverProjection: null,
  });
  begin(h, { generation: 2, kind: "doubt", continuesBoard: true, page: doubtPage });
  h.registry.recordRow(owner, 2, row("doubt answer"), { intro: false });
  await h.settle();
  assert.equal(h.calls.length, 1, "the doubt's first save waits for the lesson to exist on the server");
  await h.ack(h.calls[0]!);
  const doubtCall = h.calls.find((call) => call.turnId === "turn-2");
  assert(doubtCall && doubtCall.method === "PUT", "the lesson's answer releases the doubt");
  assert.equal(doubtCall.input.kind, "doubt");
  assert(!isClear(doubtCall.input.segments[0]!), "a doubt continues the page: no CLEAR");
  assert.equal(boardContinuationOf(doubtCall.input.scene.sceneArtifacts)?.lessonQuestion, LESSON, "with the continuation marker");
  assert.equal(doubtCall.input.preview, LESSON, "the board list keeps the lesson's question");

  // The lesson never reached the server: the doubt opens its own page.
  const f = harness();
  const doomed = begin(f, { generation: 1 });
  f.registry.recordRow(owner, 1, row("lost step"), { intro: false });
  await f.settle();
  doomed.handle.close();
  begin(f, { generation: 2, kind: "doubt", continuesBoard: true, page: doubtPageRecord({
    boardId: "board-1", lessonQuestion: LESSON, title: "Why?", continuesBoard: true,
    figureDrawn: false, turnPlan: null, solverProjection: null,
  }) });
  f.registry.recordRow(owner, 2, row("doubt"), { intro: false });
  await f.fail(f.calls[0]!, FORBIDDEN);
  const own = f.calls.find((call) => call.turnId === "turn-2");
  assert(own && own.method === "PUT");
  assert(isClear(own.input.segments[0]!), "the doubt opens its own page with a CLEAR");
  assert.equal(boardContinuationOf(own.input.scene.sceneArtifacts), null, "and claims no continuation");
  assert.equal(f.registry.statusFor("board-1").kind, "failed", "the lost lesson is reported, not hidden");
}

async function backoffThenFailedThenRetry() {
  const h = harness();
  begin(h, { generation: 1 });
  h.registry.recordRow(owner, 1, row(), { intro: false });
  await h.settle();
  await h.fail(h.calls[0]!, NETWORK);
  for (const [attempt, delay] of SAVE_RETRY_DELAYS_MS.entries()) {
    assert.equal(h.calls.length, attempt + 1);
    assert.equal(h.registry.statusFor("board-1").kind, "saving", "still saving while it retries");
    await h.advance(delay - 1);
    assert.equal(h.calls.length, attempt + 1, `retry ${attempt + 1} waits ${delay} ms`);
    await h.advance(1);
    assert.equal(h.calls.length, attempt + 2, `retry ${attempt + 1} goes after ${delay} ms`);
    const retried = h.calls.at(-1)!;
    assert(retried.method === "PUT");
    assert.equal(retried.input.seq, attempt + 2, "every attempt takes a new seq");
    await h.fail(retried, NETWORK);
  }
  assert.deepEqual([...SAVE_RETRY_DELAYS_MS], [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
  const failed = h.registry.statusFor("board-1");
  assert.equal(failed.kind, "failed", "retries stop after the 30 s step");
  assert(failed.kind === "failed" && !/[–—]| - /.test(failed.message), "failure copy has no dashes");
  await h.advance(120_000);
  assert.equal(h.calls.length, SAVE_RETRY_DELAYS_MS.length + 1, "no more automatic retries");
  assert(h.registry.hasUnsentData(), "a failed save still holds unsent data");
  h.registry.retry("board-1");
  await h.settle();
  assert.equal(h.calls.length, SAVE_RETRY_DELAYS_MS.length + 2, "Try again sends it again");
  await h.ack(h.calls.at(-1)!);
  assert.equal(h.registry.statusFor("board-1").kind, "saved");

  // Offline: wait for the network, never fail.
  const o = harness();
  begin(o, { generation: 1 });
  o.registry.recordRow(owner, 1, row(), { intro: false });
  await o.settle();
  o.setOnline(false);
  await o.fail(o.calls[0]!, NETWORK);
  assert.equal(o.registry.statusFor("board-1").kind, "offline");
  await o.advance(300_000);
  assert.equal(o.calls.length, 1, "no retries while offline");
  o.setOnline(true);
  o.registry.online();
  await o.settle();
  assert.equal(o.calls.length, 2, "back online, it sends");
  await o.ack(o.calls[1]!);
  assert.equal(o.registry.statusFor("board-1").kind, "saved");

  // Quota is final at once: no retries.
  const q = harness();
  begin(q, { generation: 1 });
  q.registry.recordRow(owner, 1, row(), { intro: false });
  await q.settle();
  await q.fail(q.calls[0]!, { ok: false, status: 413, error: "storage quota exceeded", reason: "quota", retryable: false });
  const quota = q.registry.statusFor("board-1");
  assert(quota.kind === "failed" && /storage is full/.test(quota.message));
  await q.advance(60_000);
  assert.equal(q.calls.length, 1);
}

async function refusedFigureSavesOnceAsText() {
  const h = harness();
  const page = lessonPageRecord("board-1", LESSON);
  page.turn.scene = { ...validatedScene };
  page.figureDrawn = true;
  begin(h, { generation: 1, page });
  h.registry.recordRow(owner, 1, row("figure step"), { intro: false });
  await h.settle();
  const first = h.calls[0]!;
  assert(first.method === "PUT");
  assert.equal(first.input.scene.visualStatus, "validated");
  await h.fail(first, REFUSED);
  assert.equal(h.calls.length, 2, "a refused figure is retried at once");
  const textOnly = h.calls[1]!;
  assert(textOnly.method === "PUT");
  assert.equal(textOnly.input.scene.visualStatus, "text_only", "as text only");
  assert.deepEqual((textOnly.input.scene.sceneArtifacts as { turnPlan?: unknown }).turnPlan, { plan: true }, "keeping the plan");
  assert.equal(textOnly.input.segments.length, 2, "with the same rows");
  await h.fail(textOnly, REFUSED);
  assert.equal(h.calls.length, 2, "only once");
  assert.equal(h.registry.statusFor("board-1").kind, "failed");
}

async function conflictResendsFromServerCount() {
  const h = harness();
  begin(h, { generation: 1 });
  h.registry.recordRow(owner, 1, row("a"), { intro: false });
  await h.settle();
  await h.ack(h.calls[0]!);
  // A keepalive close we never heard back from moved the server's seq on
  // without adding rows: the next PUT is stale and its row did not land.
  h.server.get("turn-1")!.seq = 5;
  h.registry.recordRow(owner, 1, row("b"), { intro: false });
  h.registry.recordRow(owner, 1, row("c"), { intro: false });
  await h.settle();
  const stale = h.calls[1]!;
  assert(stale.method === "PUT");
  assert.equal(stale.input.baseCount, 2);
  assert.deepEqual(stale.input.segments.map((r) => r.narration), ["b"]);
  await h.ack(stale); // seq 2 <= 5: stale, serverCount still 2
  const resend = h.calls[2]!;
  assert(resend.method === "PUT");
  assert.equal(resend.input.baseCount, 2, "stale is not success: resend from the server's count");
  assert.equal(resend.input.seq, 6, "with a seq past the server's");
  assert.deepEqual(resend.input.segments.map((r) => r.narration), ["b", "c"]);
  await h.ack(resend);
  assert.equal(h.server.get("turn-1")!.count, 4);
  // A plain 409 conflict also resends from serverCount.
  h.server.get("turn-1")!.count = 5;
  h.registry.recordRow(owner, 1, row("d"), { intro: false });
  await h.settle();
  const conflicted = h.calls[3]!;
  await h.ack(conflicted);
  const after = h.calls[4]!;
  assert(after && after.method === "PUT" && after.input.baseCount === 5, "a 409 resends from serverCount");
}

async function cutRowAndLiveTurn() {
  const h = harness();
  const mirrored: LiveTurnMirrorEvent[] = [];
  let openBoard = "board-1";
  h.registry.attach(owner, { openBoardId: () => openBoard, mirror: (event) => mirrored.push(event) });
  const { handle } = begin(h, { generation: 1 });
  assert.equal(h.registry.hasLiveTurn(owner, "board-1"), false, "no finished step yet");
  assert.equal(h.registry.liveTurnFor(owner, "board-1"), null);
  h.registry.recordRow(owner, 1, row("done step"), { intro: false });
  await h.settle();
  assert.equal(h.registry.hasLiveTurn(owner, "board-1"), true);
  const live = h.registry.liveTurnFor(owner, "board-1");
  assert(live, "the live turn is exported");
  assert.equal(live.id, handle.turnId, "under its checkpoint turn id");
  assert.equal(live.status, "live");
  assert.equal(live.segments.length, 2);
  assert(live.segments[1]!.audioBytes && live.segments[1]!.audioBytes.length > 0, "with its clip in memory");
  assert.equal(mirrored.length, 0, "mid lesson checkpoints do not touch the stored turns");
  await h.ack(h.calls[0]!);

  handle.close();
  assert.equal(mirrored.length, 1, "Stop mirrors the stopped lesson at once");
  const local = mirrored[0]!;
  assert(local.source === "local");
  assert.equal(local.turnId, handle.turnId);
  assert.equal(local.turn.status, "stopped");
  await h.settle();
  await h.ack(h.calls[1]!);
  // Stop cut a segment off: saved after the close, words and ink, no audio.
  h.registry.recordCutRow(owner, 1, row("cut short"));
  await h.settle();
  const cut = h.calls[2]!;
  assert(cut && cut.method === "PUT", "the cut segment goes in its own checkpoint");
  assert.deepEqual(cut.input.segments.map((r) => r.narration), ["cut short"]);
  assert.equal(cut.input.segments[0]!.audioBytes, null, "without audio");
  assert.equal(cut.input.status, "stopped");
  const stoppedLive = h.registry.liveTurnFor(owner, "board-1");
  assert(stoppedLive && stoppedLive.segments.every((s) => s.narration !== "cut short"), "a cut segment is not a finished step");
  assert(mirrored.at(-1)!.rows.some((r) => r.narration === "cut short"), "the board's own copy shows it");
  await h.ack(cut);
  assert.equal(h.server.get(handle.turnId)!.rows[2]!.audio, false, "the server holds the cut row without a clip");
  assert(mirrored.at(-1)!.source === "server", "the server's answer replaces the local copy");

  // A board switch: the next close is not mirrored onto the other board.
  begin(h, { generation: 2 });
  h.registry.recordRow(owner, 2, row("second lesson"), { intro: false });
  openBoard = "board-2";
  const before = mirrored.length;
  h.registry.closeOwner(owner);
  assert.equal(mirrored.length, before, "a lesson stopped by a board switch never lands on the next board");

  // Completed: no longer a live turn.
  const c = harness();
  const done = begin(c, { generation: 1 });
  c.registry.recordRow(owner, 1, row(), { intro: false });
  await c.settle();
  const completing = done.handle.complete({ rawResponse: "all of it" });
  await c.ack(c.calls[0]!);
  const final = c.calls[1]!;
  assert(final.method === "PUT");
  assert.equal(final.input.status, "complete");
  assert.equal(final.input.rawResponse, "all of it");
  await c.ack(final);
  assert((await completing).ok);
  assert.equal(c.registry.liveTurnFor(owner, "board-1"), null, "a finished turn is exported from the stored turns only");
  assert.equal(c.registry.hasLiveTurn(owner, "board-1"), false);
}

async function cutFirstStepOfDoubtOrResumeIsKept() {
  for (const kind of ["doubt", "resume"] as const) {
    const h = harness();
    const mirrored: LiveTurnMirrorEvent[] = [];
    h.registry.attach(owner, { openBoardId: () => "board-1", mirror: (event) => mirrored.push(event) });
    const page = kind === "doubt"
      ? doubtPageRecord({ boardId: "board-1", lessonQuestion: LESSON, title: "Why?", continuesBoard: true,
        figureDrawn: false, turnPlan: null, solverProjection: null })
      : lessonPageRecord("board-1", LESSON);
    const { handle } = begin(h, { generation: 1, kind, continuesBoard: true, page });
    // Stop lands first; the cut segment's cleanup records its row a moment later.
    h.registry.closeOwner(owner);
    await h.settle();
    assert.equal(h.calls.length, 0, `${kind}: nothing to send before the cut row`);
    await h.advance(CUT_ROW_GRACE_MS - 1);
    h.registry.recordCutRow(owner, 1, row(`${kind} first step`));
    await h.settle();
    const cut = h.calls[0];
    assert(cut && cut.method === "PUT", `${kind}: the first step Stop cut off is still saved`);
    assert.equal(cut.turnId, handle.turnId);
    assert.equal(cut.input.status, "stopped");
    assert(cut.input.segments.some((r) => r.narration === `${kind} first step`), `${kind}: with its words and ink`);
    assert(mirrored.at(-1)?.rows.some((r) => r.narration === `${kind} first step`), `${kind}: and the board's copy shows it`);
    await h.ack(cut);
    assert.equal(h.registry.statusFor("board-1").kind, "saved");
  }
  // No cut row comes: dropped after the wait, and the next turn is not held.
  const e = harness();
  begin(e, { generation: 1, kind: "resume", continuesBoard: true });
  e.registry.closeOwner(owner);
  await e.advance(CUT_ROW_GRACE_MS);
  begin(e, { generation: 2 });
  e.registry.recordRow(owner, 2, row("next lesson"), { intro: false });
  await e.settle();
  assert.equal(e.calls.length, 1, "an empty resume is dropped once its cut row did not come");
  const next = e.calls[0]!;
  assert(next.method === "PUT" && next.input.segments.some((r) => r.narration === "next lesson"));
}

async function hungCheckpointTimesOut() {
  assert.equal(CHECKPOINT_TIMEOUT_MS, 30_000);
  assert(checkpointTimeoutMs(4_000_000) > CHECKPOINT_TIMEOUT_MS, "big clips get longer");
  assert(checkpointTimeoutMs(1e12) <= 120_000, "but the wait is bounded");
  const h = harness();
  const { handle } = begin(h, { generation: 1 });
  h.registry.recordRow(owner, 1, row("first"), { intro: false });
  await h.settle();
  const hung = h.calls[0]!;
  assert(hung.method === "PUT");
  const timeout = checkpointTimeoutMs((hung.input.segments ?? []).reduce((n, r) => n + (r.audioBytes?.length ?? 0), 0));
  assert(hung.input.signal, "the checkpoint can be aborted");
  // The connection never answers. Stop meanwhile.
  h.registry.recordRow(owner, 1, row("second"), { intro: false });
  handle.close();
  await h.advance(timeout - 1);
  assert.equal(h.calls.length, 1, "one request in flight until the timeout");
  assert.equal(hung.input.signal!.aborted, false);
  await h.advance(1);
  assert.equal(hung.input.signal!.aborted, true, "the hung request is aborted");
  assert.equal(h.registry.statusFor("board-1").kind, "saving", "and retried, not failed");
  await h.advance(SAVE_RETRY_DELAYS_MS[0]!);
  const retried = h.calls[1];
  assert(retried && retried.method === "PUT", "the retry goes out after the backoff");
  assert.equal(retried.input.status, "stopped", "carrying the Stop");
  assert.deepEqual(retried.input.segments.filter((r) => !isClear(r)).map((r) => r.narration), ["first", "second"]);
  // A late answer from the aborted request changes nothing.
  hung.resolve({ ok: false, status: 500, error: "late", reason: "server", retryable: true });
  await h.settle();
  assert.equal(h.calls.length, 2);
  await h.ack(retried);
  assert.equal(h.registry.statusFor("board-1").kind, "saved");
  assert.equal(h.server.get(handle.turnId)!.status, "stopped");
}

async function reopenKeepsUnsavedTurns() {
  // The save gave up on a network failure, then the student reopened the board.
  const h = harness();
  const { handle } = begin(h, { generation: 1 });
  h.registry.recordRow(owner, 1, row("saved step"), { intro: false });
  await h.settle();
  await h.ack(h.calls[0]!);
  h.registry.recordRow(owner, 1, row("unsaved step"), { intro: false });
  handle.close();
  await h.settle();
  await h.fail(h.calls.at(-1)!, NETWORK);
  for (const delay of SAVE_RETRY_DELAYS_MS) {
    await h.advance(delay);
    await h.fail(h.calls.at(-1)!, NETWORK);
  }
  assert.equal(h.registry.statusFor("board-1").kind, "failed");
  const sent = h.calls.length;
  const kept = h.registry.reopen("board-1");
  assert.equal(kept.length, 1, "the unsaved lesson is handed back to the restore");
  const local = kept[0]!;
  assert(local.source === "local" && local.turnId === handle.turnId, "as the local copy, under the saved turn's id");
  assert.equal(local.turn.status, "stopped");
  assert.deepEqual(local.rows.filter((r) => !isClear(r)).map((r) => r.narration), ["saved step", "unsaved step"],
    "with every row the student saw, not only the ones the server holds");
  assert.equal(h.calls.length, sent + 1, "and the save is sent again");
  assert.equal(h.registry.statusFor("board-1").kind, "saving");
  await h.ack(h.calls.at(-1)!);
  assert.equal(h.registry.statusFor("board-1").kind, "saved");
  assert.deepEqual(h.registry.reopen("board-1"), [], "once the server holds it all, the server copy is enough");
  assert.equal(h.calls.length, sent + 1);

  // A final failure (storage full): kept locally, not sent again.
  const q = harness();
  const quota = begin(q, { generation: 1 });
  q.registry.recordRow(owner, 1, row("step"), { intro: false });
  quota.handle.close();
  await q.settle();
  await q.fail(q.calls[0]!, { ok: false, status: 413, error: "storage quota exceeded", reason: "quota", retryable: false });
  assert.equal(q.registry.reopen("board-1").length, 1, "a lesson the server refused still shows on its board");
  assert.equal(q.calls.length, 1, "a quota failure is not retried on its own");
  assert.deepEqual(q.registry.reopen("board-2"), [], "never another board's turn");
}

async function keepaliveCloseFitsTheBudget() {
  assert(KEEPALIVE_CLOSE_MAX_BYTES + MAX_PAGE_AWAY_TELEMETRY_BYTES <= 64 * 1024,
    "the lesson close and telemetry's page away body fit one 64 KiB keepalive budget together");
  assert(MAX_PAGE_AWAY_TELEMETRY_BYTES < MAX_TELEMETRY_BODY_BYTES, "telemetry gives way on page away");
  const h = harness();
  begin(h, { generation: 1 });
  h.registry.recordRow(owner, 1, row("acked"), { intro: false });
  await h.settle();
  await h.ack(h.calls[0]!);
  for (let i = 0; i < 40; i += 1) h.registry.recordRow(owner, 1, row(`tail ${i} ${"x".repeat(400)}`), { intro: false });
  await h.settle();
  const inflight = h.calls.length;
  h.registry.pageHideClose();
  h.registry.pageHideClose(); // a second shell in the tab
  const closes = h.calls.filter((call) => call.method === "PATCH");
  assert.equal(closes.length, 1, "one keepalive close per turn, even with two listeners");
  const close = closes[0]!;
  assert(close.method === "PATCH");
  assert.equal(close.input.status, "stopped");
  assert.equal(close.input.baseCount, 2, "rows the server holds are not resent");
  assert(close.input.seq > (h.calls[inflight - 1]!.input.seq), "the close takes the next seq");
  assert(close.input.segments!.every((r) => r.audioBytes === null || r.audioBytes !== undefined), "rows ride along");
  const body = buildTurnCloseBody(close.input);
  assert(new TextEncoder().encode(body).byteLength <= KEEPALIVE_CLOSE_MAX_BYTES, "the close body stays under its cap");
  assert.equal(JSON.parse(body).question, LESSON, "it can still create the turn");

  // A lesson closed in planning: the close creates it as stopped with its question.
  const p = harness();
  begin(p, { generation: 1 });
  p.registry.pageHideClose();
  const created = p.calls[0]!;
  assert(created && created.method === "PATCH");
  assert.equal(created.input.question, LESSON);
  assert.equal(created.input.baseCount, 0);
}

async function drainAndStatus() {
  const h = harness();
  begin(h, { generation: 1 });
  assert.equal(await h.registry.drained("board-1", 8_000), true, "nothing pending drains at once");
  h.registry.recordRow(owner, 1, row(), { intro: false });
  await h.settle();
  assert.equal(h.registry.statusFor("board-1").kind, "saving");
  assert.equal(h.registry.statusFor("board-2").kind, "idle", "another board is idle");
  const waiting = h.registry.drained("board-1", 8_000);
  await h.ack(h.calls[0]!);
  assert.equal(await waiting, true, "drained once acked");
  h.registry.recordRow(owner, 1, row(), { intro: false });
  await h.settle();
  const timedOut = h.registry.drained("board-1", 8_000);
  await h.advance(8_000);
  assert.equal(await timedOut, false, "gives up after the wait");
}

async function main() {
  await oneInFlightAndCoalescing();
  await introRowsWaitForTheFigure();
  await closeIsIdempotentAndKeepsEmptyTurns();
  await emptyDoubtIsNotSaved();
  await doubtWaitsForTheLessonItStopped();
  await backoffThenFailedThenRetry();
  await refusedFigureSavesOnceAsText();
  await conflictResendsFromServerCount();
  await cutRowAndLiveTurn();
  await cutFirstStepOfDoubtOrResumeIsKept();
  await hungCheckpointTimesOut();
  await reopenKeepsUnsavedTurns();
  await keepaliveCloseFitsTheBudget();
  await drainAndStatus();
  console.log("verify-live-turn-save: coalescing, intro hold, close, doubt queue, backoff, offline, text only fallback, 409, cut row, cut first step of a doubt or resume, hung checkpoint timeout, reopen keeps unsaved turns, keepalive budget, mirror, export and status verified");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
