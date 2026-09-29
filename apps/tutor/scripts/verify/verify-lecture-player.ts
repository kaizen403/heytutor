import assert from "node:assert/strict";
import { serializeSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import type { StoredSegment, StoredTurn } from "../../lib/boards/boardsClient";
import {
  buildLecturePlayerTimeline,
  canPlayFinishedLecture,
  createLecturePlayerStore,
  createSeekQueue,
  createSmoothedMediaClock,
  lectureAudioComplete,
  lecturePlayerKeyAction,
  msFromFraction,
  planLectureSeek,
  skipTarget,
} from "../../lib/replay/lecturePlayer";

const LESSON = "Two Sum: find two indices whose values add to target.";
const DOUBT = "Why   do we check the map\n before inserting?";
const NEXT = "Reverse a linked list.";

const CLEAR: DrawCommand = { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" };

const write = (text: string): DrawCommand => ({
  type: "WRITE",
  text,
  params: [90, 142],
  charPosition: 0,
  narrationBefore: "",
});

function clearSegment(): StoredSegment {
  return {
    id: "seg-clear",
    orderIndex: 0,
    narration: "",
    spokenText: "",
    command: CLEAR,
    audioUrl: null,
    durationMs: 700,
    timings: null,
  };
}

function spokenSegment(
  orderIndex: number,
  text: string,
  durationMs: number,
  audioUrl: string | null = `https://audio.test/${text}.mp3`,
): StoredSegment {
  return {
    id: `seg-${text}`,
    orderIndex,
    narration: `say ${text}`,
    spokenText: `say ${text}`,
    command: serializeSegmentCommands([write(text)], { trustedDiagramGeometry: false }),
    audioUrl,
    durationMs,
    timings: null,
  };
}

function turn(
  id: string,
  orderIndex: number,
  question: string,
  segments: StoredSegment[],
  sceneArtifacts: unknown = null,
): StoredTurn {
  return {
    id,
    orderIndex,
    question,
    rawResponse: "",
    speedMultiplier: 1,
    traceId: null,
    sceneDocument: null,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: null,
    sceneArtifacts,
    segments,
  };
}

// Cues: lesson 0-700 CLEAR, 700-1700, 1700-2700; doubt 2700-3200, 3200-3700;
// next 3700-4400 CLEAR, 4400-6400.
const lessonTurn = turn("lesson", 0, LESSON, [
  clearSegment(),
  spokenSegment(1, "a", 1000),
  spokenSegment(2, "b", 1000),
]);
const doubtTurn = turn(
  "doubt",
  1,
  DOUBT,
  [spokenSegment(0, "c", 500), spokenSegment(1, "d", 500)],
  boardContinuationArtifacts(LESSON),
);
const nextTurn = turn("next", 2, NEXT, [clearSegment(), spokenSegment(1, "e", 2000)]);
const turns = [lessonTurn, doubtTurn, nextTurn];

// --- timeline, chapters and pages ------------------------------------------

const timeline = buildLecturePlayerTimeline(turns);
assert.equal(timeline.totalMs, 6400);
assert.equal(timeline.cues.length, 7);
assert.deepEqual(
  timeline.chapters,
  [
    { id: "lesson", turnIndex: 0, title: LESSON, startMs: 0, endMs: 2700 },
    {
      id: "doubt",
      turnIndex: 1,
      title: "Why do we check the map before inserting?",
      startMs: 2700,
      endMs: 3700,
    },
    { id: "next", turnIndex: 2, title: NEXT, startMs: 3700, endMs: 6400 },
  ],
  "one chapter per turn, each running to the next chapter's start",
);
assert.deepEqual(
  timeline.pageStartTurnIndex,
  [0, 0, 2],
  "the doubt continues the lesson's page; the next question opens its own",
);

const secondDoubt = turn(
  "doubt-2",
  3,
  "",
  [spokenSegment(0, "f", 400)],
  boardContinuationArtifacts(NEXT),
);
const clearedDoubt = turn(
  "doubt-cleared",
  4,
  "x".repeat(200),
  [clearSegment(), spokenSegment(1, "g", 400)],
  boardContinuationArtifacts(NEXT),
);
const empty = turn("empty", 5, "no cues", []);
const wider = buildLecturePlayerTimeline([...turns, empty, secondDoubt, clearedDoubt]);
assert.deepEqual(
  wider.pageStartTurnIndex,
  [0, 0, 2, 2, 2, 5],
  "a doubt continues the page on the board, past a turn that drew nothing; a marked turn opening on CLEAR starts one",
);
assert.deepEqual(
  wider.chapters.map((chapter) => chapter.id),
  ["lesson", "doubt", "next", "doubt-2", "doubt-cleared"],
  "a turn without cues has no chapter",
);
assert.equal(wider.chapters[3]!.title, "Question 4", "an empty question is numbered by chapter");
assert.equal(wider.chapters[3]!.turnIndex, 4, "turnIndex is the index in turns, not the chapter");
assert.equal(wider.chapters[4]!.title, `${"x".repeat(79)}…`);
assert.equal(wider.chapters[4]!.title.length, 80);
assert.equal(wider.chapters[4]!.endMs, wider.totalMs);

const spacedLong = buildLecturePlayerTimeline([
  turn("spaced", 0, `${"y".repeat(78)} ${"z".repeat(10)}`, [spokenSegment(0, "h", 300)]),
]);
assert.equal(
  spacedLong.chapters[0]!.title,
  `${"y".repeat(78)}…`,
  "the truncated title drops trailing whitespace before the ellipsis",
);

const noCues = buildLecturePlayerTimeline([empty]);
assert.deepEqual(noCues.chapters, []);
assert.deepEqual(noCues.pageStartTurnIndex, [0]);
assert.deepEqual(buildLecturePlayerTimeline([]).pageStartTurnIndex, []);

// --- seek plans -------------------------------------------------------------

assert.equal(planLectureSeek(noCues, 100), null, "no cues, nothing to seek");

assert.deepEqual(planLectureSeek(timeline, 0), {
  targetMs: 0,
  epochCueIndex: 0,
  targetCueIndex: 0,
  targetOffsetMs: 0,
});
assert.deepEqual(planLectureSeek(timeline, 1200), {
  targetMs: 1200,
  epochCueIndex: 0,
  targetCueIndex: 1,
  targetOffsetMs: 500,
});
assert.deepEqual(
  planLectureSeek(timeline, 1700),
  { targetMs: 1700, epochCueIndex: 0, targetCueIndex: 2, targetOffsetMs: 0 },
  "a boundary belongs to the cue that starts there",
);
assert.deepEqual(
  planLectureSeek(timeline, 3000),
  { targetMs: 3000, epochCueIndex: 0, targetCueIndex: 3, targetOffsetMs: 300 },
  "a seek into the doubt rebuilds from the lesson's first cue",
);
assert.deepEqual(
  planLectureSeek(timeline, 3700),
  { targetMs: 3700, epochCueIndex: 5, targetCueIndex: 5, targetOffsetMs: 0 },
  "a seek into the new question rebuilds from its own first cue",
);
assert.deepEqual(
  planLectureSeek(timeline, 5000),
  { targetMs: 5000, epochCueIndex: 5, targetCueIndex: 6, targetOffsetMs: 600 },
);
assert.deepEqual(
  planLectureSeek(timeline, 6400),
  { targetMs: 6400, epochCueIndex: 5, targetCueIndex: 6, targetOffsetMs: 2000 },
  "the end sits at the tail of the last cue",
);
assert.deepEqual(planLectureSeek(timeline, 99_999), planLectureSeek(timeline, 6400));
assert.deepEqual(planLectureSeek(timeline, -50), planLectureSeek(timeline, 0));
assert.deepEqual(planLectureSeek(timeline, Number.NaN), planLectureSeek(timeline, 0));
assert.deepEqual(
  planLectureSeek(timeline, Number.POSITIVE_INFINITY),
  planLectureSeek(timeline, 0),
  "non-finite targets fall back to the start",
);

const orphanPage = { ...timeline, pageStartTurnIndex: [0, 9, 2] };
assert.equal(
  planLectureSeek(orphanPage, 3000)!.epochCueIndex,
  3,
  "a page start with no cues falls back to the target turn's first cue",
);

// --- the gate ---------------------------------------------------------------

const gate = {
  isHeadless: false,
  phase: "idle",
  lectureActive: false,
  storedTurns: turns,
};
assert.equal(lectureAudioComplete(turns), true, "silent CLEAR segments need no audio");
assert.equal(canPlayFinishedLecture(gate), true);

const missingAudio = [
  lessonTurn,
  turn("doubt", 1, DOUBT, [spokenSegment(0, "c", 500), spokenSegment(1, "d", 500, "  ")]),
  nextTurn,
];
assert.equal(lectureAudioComplete(missingAudio), false, "a blank audioUrl is missing audio");
assert.equal(canPlayFinishedLecture({ ...gate, storedTurns: missingAudio }), false);

const nullAudio = [turn("t", 0, "q", [spokenSegment(0, "a", 500, null)])];
assert.equal(lectureAudioComplete(nullAudio), false);

const spokenOnly: StoredSegment = {
  ...spokenSegment(0, "s", 500, null),
  narration: "  ",
  spokenText: "only the spoken text",
};
assert.equal(
  lectureAudioComplete([turn("t", 0, "q", [spokenOnly])]),
  false,
  "spokenText alone makes a segment spoken",
);

assert.equal(lectureAudioComplete([]), false, "no spoken segment, no lecture audio");
assert.equal(
  lectureAudioComplete([turn("t", 0, "q", [clearSegment()])]),
  false,
  "a board with only silent segments has nothing to play",
);

assert.equal(canPlayFinishedLecture({ ...gate, phase: "speaking" }), false);
assert.equal(canPlayFinishedLecture({ ...gate, isHeadless: true }), false);
assert.equal(canPlayFinishedLecture({ ...gate, lectureActive: true }), false);
assert.equal(canPlayFinishedLecture({ ...gate, storedTurns: [] }), false);

// --- the smoothed media clock -----------------------------------------------

{
  const clock = createSmoothedMediaClock();
  assert.equal(clock.sample({ mediaMs: 1000, wallMs: 0, playing: true, rate: 1 }), 1000);
  assert.equal(
    clock.sample({ mediaMs: 1000, wallMs: 50, playing: true, rate: 1 }),
    1050,
    "between coarse reports the clock follows the wall clock",
  );
  assert.equal(clock.sample({ mediaMs: 1000, wallMs: 100, playing: true, rate: 1 }), 1100);
  assert.equal(
    clock.sample({ mediaMs: 1090, wallMs: 110, playing: true, rate: 1 }),
    1100,
    "a report slightly behind the prediction never pulls the clock backwards",
  );
  assert.equal(clock.sample({ mediaMs: 1090, wallMs: 150, playing: true, rate: 1 }), 1130);

  let previous = 0;
  let media = 1090;
  for (let wall = 150; wall <= 1500; wall += 16) {
    if (wall % 250 < 16) media = 1090 + (wall - 150) - 20;
    const out = clock.sample({ mediaMs: media, wallMs: wall, playing: true, rate: 1 });
    assert.ok(out >= previous, `clock ran backwards at wall ${wall}: ${out} < ${previous}`);
    previous = out;
  }

  assert.equal(
    clock.sample({ mediaMs: 2345, wallMs: 1600, playing: false, rate: 1 }),
    2345,
    "a paused clock reports the media time exactly",
  );
  assert.equal(clock.sample({ mediaMs: 2345, wallMs: 2600, playing: false, rate: 1 }), 2345);
  assert.equal(
    clock.sample({ mediaMs: 2345, wallMs: 2600, playing: true, rate: 1 }),
    2345,
    "resuming starts from the paused position, not the paused wall time",
  );
  assert.equal(clock.sample({ mediaMs: 2345, wallMs: 2650, playing: true, rate: 1 }), 2395);
}

{
  const clock = createSmoothedMediaClock();
  clock.sample({ mediaMs: 0, wallMs: 0, playing: true, rate: 2 });
  assert.equal(
    clock.sample({ mediaMs: 0, wallMs: 50, playing: true, rate: 2 }),
    100,
    "the prediction scales with the playback rate",
  );
  assert.equal(
    clock.sample({ mediaMs: 0, wallMs: 60, playing: true, rate: -1 }),
    100,
    "a negative rate is treated as stopped and never rewinds",
  );
}

{
  const clock = createSmoothedMediaClock({ maxDriftMs: 120 });
  clock.sample({ mediaMs: 500, wallMs: 0, playing: true, rate: 1 });
  assert.equal(
    clock.sample({ mediaMs: 500, wallMs: 200, playing: true, rate: 1 }),
    500,
    "a stalled element (prediction 200ms ahead) snaps back to the reported time",
  );
  assert.equal(clock.sample({ mediaMs: 500, wallMs: 250, playing: true, rate: 1 }), 550);
}

{
  const clock = createSmoothedMediaClock();
  clock.sample({ mediaMs: 5000, wallMs: 0, playing: true, rate: 1 });
  assert.equal(clock.sample({ mediaMs: 5000, wallMs: 80, playing: true, rate: 1 }), 5080);
  clock.reset(1000, 100);
  assert.equal(
    clock.sample({ mediaMs: 1000, wallMs: 100, playing: true, rate: 1 }),
    1000,
    "after a seek back the clock follows the new position",
  );
  assert.equal(clock.sample({ mediaMs: 1000, wallMs: 150, playing: true, rate: 1 }), 1050);
}

// --- the seek queue ---------------------------------------------------------

{
  const queue = createSeekQueue();
  assert.equal(queue.busy(), false);
  assert.equal(queue.request(1000), true, "an idle queue seeks right away");
  assert.equal(queue.busy(), true);
  assert.equal(queue.request(2000), false);
  assert.equal(queue.request(3000), false);
  assert.equal(queue.request(4000), false);
  assert.equal(queue.finish(), 4000, "requests made during a seek collapse to the latest");
  assert.equal(queue.busy(), true, "the queue stays busy while it seeks to the pending target");
  assert.equal(queue.finish(), null);
  assert.equal(queue.busy(), false);
  assert.equal(queue.request(0), true, "a pending target of 0 is still a target");
  assert.equal(queue.request(0), false);
  assert.equal(queue.finish(), 0);
  assert.equal(queue.finish(), null);

  queue.request(10);
  queue.request(20);
  queue.clear();
  assert.equal(queue.busy(), false);
  assert.equal(queue.finish(), null, "clear drops the pending target");
}

// --- the store --------------------------------------------------------------

{
  const store = createLecturePlayerStore({ durationMs: 6400 });
  const first = store.getSnapshot();
  assert.deepEqual(first, {
    status: "unavailable",
    active: false,
    positionMs: 0,
    durationMs: 6400,
    loadedMs: 0,
    rate: 1,
    chapters: [],
    error: null,
  });
  assert.equal(store.getSnapshot(), first, "the snapshot is stable between changes");

  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });

  store.set({ positionMs: 0, rate: 1 });
  store.set({});
  assert.equal(calls, 0, "an identical patch does not notify");
  assert.equal(store.getSnapshot(), first, "an identical patch keeps the same snapshot");

  store.set({ positionMs: 1500, status: "playing" });
  assert.equal(calls, 1);
  const second = store.getSnapshot();
  assert.notEqual(second, first, "a change produces a new snapshot object");
  assert.equal(second.positionMs, 1500);
  assert.equal(second.status, "playing");
  assert.equal(first.positionMs, 0, "the previous snapshot is not mutated");

  store.set({ chapters: timeline.chapters });
  assert.equal(calls, 2);
  store.set({ chapters: timeline.chapters });
  assert.equal(calls, 2, "the same chapters array is not a change");

  unsubscribe();
  store.set({ positionMs: 2000 });
  assert.equal(calls, 2, "an unsubscribed listener is not called");
  assert.equal(store.getSnapshot().positionMs, 2000);
}

// --- keys -------------------------------------------------------------------

const key = (value: string, extra: Partial<Parameters<typeof lecturePlayerKeyAction>[0]> = {}) =>
  lecturePlayerKeyAction({
    key: value,
    withModifier: false,
    typing: false,
    dialogOpen: false,
    ...extra,
  });

for (const value of [" ", "k", "K"]) assert.equal(key(value), "toggle");
for (const value of ["ArrowLeft", "j", "J"]) assert.equal(key(value), "back");
for (const value of ["ArrowRight", "l", "L"]) assert.equal(key(value), "forward");
assert.equal(key("Home"), "start");
assert.equal(key("End"), "end");
assert.equal(key("x"), null);
assert.equal(key("Enter"), null);
assert.equal(key("k", { withModifier: true }), null, "Cmd/Ctrl shortcuts belong to the browser");
assert.equal(key(" ", { typing: true }), null, "typing in a field must not toggle playback");
assert.equal(key("ArrowLeft", { dialogOpen: true }), null);

// --- skip and fraction ------------------------------------------------------

assert.equal(skipTarget(5000, 10_000, 6400), 6400);
assert.equal(skipTarget(5000, -10_000, 6400), 0);
assert.equal(skipTarget(3000, 1000, 6400), 4000);
assert.equal(skipTarget(Number.NaN, 1000, 6400), 0);
assert.equal(skipTarget(1000, Number.POSITIVE_INFINITY, 6400), 0);

assert.equal(msFromFraction(0.5, 6400), 3200);
assert.equal(msFromFraction(-0.2, 6400), 0);
assert.equal(msFromFraction(1.5, 6400), 6400);
assert.equal(msFromFraction(Number.NaN, 6400), 0);

console.log("verify-lecture-player: ok");
