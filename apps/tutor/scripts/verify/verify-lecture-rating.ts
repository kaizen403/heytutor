/**
 * Lecture ratings: the body the route accepts, when the board asks, and what
 * the live save registry tells the prompt about the newest turn.
 */
import assert from "node:assert/strict";
import type { RecordedSegmentPayload, TurnCheckpointInput, TurnCheckpointResult } from "../../lib/boards/boardsClient";
import {
  MAX_LECTURE_FEEDBACK_CHARS,
  parseLectureRatingInput,
} from "../../lib/lecture-rating/ratingInput";
import {
  duringClockRuns,
  lectureRatingPrompt,
  parseRatingTurnSnapshot,
  ratingPromptKey,
  ratingTurnSnapshot,
  type RatingPromptTurn,
} from "../../features/tutor-session/lib/turn/lectureRatingPrompt";
import { LiveTurnSaveRegistry, SAVE_RETRY_DELAYS_MS } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { lessonPageRecord } from "../../features/tutor-session/lib/turn/doubtTurn";
import { sessionCapabilities } from "../../features/tutor-session/lib/sessionCapabilities";

// --- The body ---------------------------------------------------------------

{
  const ok = parseLectureRatingInput({ moment: "after", stars: 4, feedback: "  clear steps  ", stepsTaught: 12.7 });
  assert(ok.ok);
  assert.deepEqual(ok.input, { moment: "after", stars: 4, feedback: "clear steps", stepsTaught: 12 });

  const blankNote = parseLectureRatingInput({ moment: "during", stars: 1, feedback: "   " });
  assert(blankNote.ok);
  assert.equal(blankNote.input.feedback, null, "a blank note is no note");
  assert.equal(blankNote.input.stepsTaught, 0);

  for (const stars of [0, 6, 3.5, "4", null]) {
    assert.equal(parseLectureRatingInput({ moment: "after", stars }).ok, false, `stars ${String(stars)} refused`);
  }
  assert.equal(parseLectureRatingInput({ moment: "midway", stars: 3 }).ok, false, "unknown moment refused");
  assert.equal(parseLectureRatingInput({ moment: "after", stars: 3, feedback: 7 }).ok, false, "a non-text note refused");
  assert.equal(
    parseLectureRatingInput({ moment: "after", stars: 3, feedback: "x".repeat(MAX_LECTURE_FEEDBACK_CHARS + 1) }).ok,
    false,
    "an over-long note refused",
  );
  assert.equal(parseLectureRatingInput(null).ok, false);
  const negative = parseLectureRatingInput({ moment: "after", stars: 5, stepsTaught: -4 });
  assert(negative.ok && negative.input.stepsTaught === 0, "steps never go negative");
}

// --- When the board asks ----------------------------------------------------

{
  const none = new Set<string>();
  const lesson = (patch: Partial<RatingPromptTurn> = {}): RatingPromptTurn => ({
    turnId: "t1", kind: "lesson", status: "live", taught: true, ...patch,
  });

  assert.equal(lectureRatingPrompt({ turn: null, lecturing: false, duringDue: false, asked: none }), null);
  assert.equal(lectureRatingPrompt({ turn: lesson(), lecturing: true, duringDue: false, asked: none }), null, "not before the midway clock");
  assert.equal(lectureRatingPrompt({ turn: lesson(), lecturing: true, duringDue: true, asked: none }), "during");
  assert.equal(
    lectureRatingPrompt({ turn: lesson(), lecturing: true, duringDue: true, asked: new Set([ratingPromptKey("t1", "during")]) }),
    null,
    "asked once midway",
  );
  assert.equal(
    lectureRatingPrompt({ turn: lesson({ kind: "resume" }), lecturing: true, duringDue: true, asked: none }),
    null,
    "a Continue is not asked midway",
  );
  assert.equal(duringClockRuns(lesson({ taught: false }), true), false, "the clock waits for a finished step");
  assert.equal(duringClockRuns(lesson(), false), false, "the clock stops when the lecture does");

  assert.equal(lectureRatingPrompt({ turn: lesson(), lecturing: false, duringDue: true, asked: none }), null, "a turn still saving as live waits");
  assert.equal(lectureRatingPrompt({ turn: lesson({ status: "complete" }), lecturing: false, duringDue: false, asked: none }), "after");
  assert.equal(lectureRatingPrompt({ turn: lesson({ status: "stopped" }), lecturing: false, duringDue: false, asked: none }), "after", "a stopped lecture is asked too");
  assert.equal(lectureRatingPrompt({ turn: lesson({ kind: "resume", status: "complete" }), lecturing: false, duringDue: false, asked: none }), "after");
  assert.equal(
    lectureRatingPrompt({ turn: lesson({ status: "complete" }), lecturing: false, duringDue: false, asked: new Set([ratingPromptKey("t1", "after")]) }),
    null,
    "closed once, never again",
  );
  assert.equal(
    lectureRatingPrompt({ turn: lesson({ status: "complete" }), lecturing: false, duringDue: false, asked: new Set([ratingPromptKey("t1", "during")]) }),
    "after",
    "the midway answer does not skip the end",
  );
  assert.equal(lectureRatingPrompt({ turn: lesson({ kind: "doubt", status: "complete" }), lecturing: false, duringDue: false, asked: none }), null, "doubt answers are not rated");
  assert.equal(lectureRatingPrompt({ turn: lesson({ status: "stopped", taught: false }), lecturing: false, duringDue: false, asked: none }), null, "nothing taught, nothing to rate");

  const snapshot = ratingTurnSnapshot({ turnId: "t1", kind: "lesson", status: "live", saved: true, steps: 7 });
  assert.equal(snapshot, ratingTurnSnapshot({ turnId: "t1", kind: "lesson", status: "live", saved: true, steps: 8 }), "a new step does not change the snapshot");
  assert.deepEqual(parseRatingTurnSnapshot(snapshot), { turnId: "t1", kind: "lesson", status: "live", saved: true, taught: true });
  assert.equal(parseRatingTurnSnapshot(""), null);
}

// --- Who is asked -----------------------------------------------------------

assert.equal(sessionCapabilities("full").rateLectures, true);
for (const variant of ["panel", "embed", "community", "headless"] as const) {
  assert.equal(sessionCapabilities(variant).rateLectures, false, `${variant} never asks`);
}

// --- The registry read ------------------------------------------------------

async function registryRead() {
  const calls: Array<{ input: TurnCheckpointInput; resolve: (result: TurnCheckpointResult) => void }> = [];
  const registry = new LiveTurnSaveRegistry({
    transport: {
      checkpoint: (_boardId, _turnId, input) => new Promise((resolve) => calls.push({ input, resolve })),
      close: (_boardId, _turnId, input) => new Promise((resolve) => calls.push({ input: input as unknown as TurnCheckpointInput, resolve })),
    },
    setTimer: () => 0,
    clearTimer: () => {},
    now: () => 1_000,
    isOnline: () => true,
    mintId: () => "11111111-1111-4111-8111-111111111111",
  });
  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const owner = { current: false };
  const answer = (status: "live" | "stopped" | "complete", count: number, seq: number): TurnCheckpointResult => ({
    ok: true,
    turn: {
      id: "11111111-1111-4111-8111-111111111111", orderIndex: 0, question: "q", rawResponse: "", speedMultiplier: 1,
      traceId: null, sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
      sceneArtifacts: null, segments: [], status,
    },
    serverCount: status === "complete" ? null : count,
    serverSeq: seq,
    stale: false,
    final: status === "complete",
  });
  const row = (narration: string): RecordedSegmentPayload => ({
    orderIndex: 0,
    narration,
    spokenText: narration,
    command: { type: "WRITE", params: [400, 100], text: narration, charPosition: 0, narrationBefore: "" } as never,
    audioBytes: null,
    durationMs: 900,
    timings: null,
  });

  assert.equal(registry.ratableTurnFor(owner, "board-1"), null, "no turn, nothing to rate");
  const handle = registry.begin({
    owner, generation: 1, boardId: "board-1", traceId: "trace-1", kind: "lesson", question: "Why?",
    preview: "Why?", speedMultiplier: 1, continuesBoard: false, page: lessonPageRecord("board-1", "Why?"),
  });
  const fresh = registry.ratableTurnFor(owner, "board-1");
  assert(fresh);
  assert.equal(fresh.steps, 0);
  assert.equal(fresh.saved, false);
  assert.equal(fresh.status, "live");

  registry.recordRow(owner, 1, row("first"), { intro: false });
  await settle();
  assert.equal(registry.ratableTurnFor(owner, "board-1")?.steps, 1, "the runtime CLEAR is not a step");
  assert.equal(registry.ratableTurnFor(owner, "board-1")?.saved, false, "not saved before the answer");
  assert.equal(registry.turnSaveState(handle.turnId), "waiting", "a queued rating waits for its own turn");
  calls[0]!.resolve(answer("live", 2, 1));
  await settle();
  assert.equal(registry.ratableTurnFor(owner, "board-1")?.saved, true, "saved once the server holds the row");
  assert.equal(registry.turnSaveState(handle.turnId), "saved");
  assert.equal(registry.turnSaveState("22222222-2222-4222-8222-222222222222"), "unknown", "a turn this tab never held");
  assert.equal(registry.ratableTurnFor(owner, "other-board"), null, "another board has its own turns");

  registry.recordRow(owner, 1, row("second"), { intro: false });
  const completing = handle.complete({ rawResponse: "first second" });
  await settle();
  const last = calls.at(-1)!;
  last.resolve(answer("complete", 3, last.input.seq));
  await completing;
  await settle();
  const done = registry.ratableTurnFor(owner, "board-1");
  assert(done);
  assert.equal(done.status, "complete");
  assert.equal(done.steps, 2);
  assert.equal(
    lectureRatingPrompt({ turn: { ...done, taught: done.steps > 0 }, lecturing: false, duringDue: false, asked: new Set() }),
    "after",
    "a finished lecture is asked about",
  );
}

async function stalledSave() {
  const calls: Array<(result: TurnCheckpointResult) => void> = [];
  const timers: Array<() => void> = [];
  const registry = new LiveTurnSaveRegistry({
    transport: {
      checkpoint: () => new Promise((resolve) => calls.push(resolve)),
      close: () => new Promise((resolve) => calls.push(resolve)),
    },
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
    now: () => 1_000,
    isOnline: () => true,
    mintId: () => "33333333-3333-4333-8333-333333333333",
  });
  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const owner = { current: false };
  const handle = registry.begin({
    owner, generation: 1, boardId: "board-2", traceId: "trace-2", kind: "lesson", question: "Why?",
    preview: "Why?", speedMultiplier: 1, continuesBoard: false, page: lessonPageRecord("board-2", "Why?"),
  });
  registry.recordRow(owner, 1, {
    orderIndex: 0, narration: "first", spokenText: "first", audioBytes: null, durationMs: 900, timings: null,
    command: { type: "WRITE", params: [400, 100], text: "first", charPosition: 0, narrationBefore: "" } as never,
  }, { intro: false });
  await settle();
  const outage: TurnCheckpointResult = { ok: false, status: 503, error: "down", reason: "network", retryable: true };
  for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt += 1) {
    assert.equal(registry.turnSaveState(handle.turnId), "waiting", `still retrying after ${attempt} failures`);
    calls.shift()!(outage);
    await settle();
    for (const fire of timers.splice(0)) fire();
    await settle();
  }
  assert.equal(registry.turnSaveState(handle.turnId), "stalled", "out of retries: the rating card can report it");
  registry.retry("board-2");
  await settle();
  assert.equal(registry.turnSaveState(handle.turnId), "waiting", "a manual retry sends again");
}

Promise.all([registryRead(), stalledSave()]).then(
  () => console.log("lecture rating: body, prompt rules, capabilities and registry read hold"),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
