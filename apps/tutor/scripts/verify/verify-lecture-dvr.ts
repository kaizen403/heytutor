import assert from "node:assert/strict";
import { serializeSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import {
  buildLectureTimeline,
  buildLiveTurnSegments,
  clampToLiveEdge,
  isAtLiveEdge,
  lectureScrubberModel,
  LIVE_BAR_HIT_PX,
  resolveLecturePlayback,
  rewindPausedTheLecture,
  shouldEnterRewind,
  shouldResumeLiveAfterRewind,
  shouldTrackLiveLectureEdge,
  LIVE_EDGE_TOLERANCE_MS,
} from "../../lib/replay/liveTimeline";
import { resolveCommandInkBudgetMs } from "../../features/tutor-session/types";
import { resolveActiveStatus } from "../../features/tutor-session/lib/statusConfig";
import type {
  RecordedSegmentPayload,
  StoredTurn,
} from "../../lib/boards/boardsClient";

const write = (text: string): DrawCommand => ({
  type: "WRITE",
  text,
  params: [90, 142],
  charPosition: 0,
  narrationBefore: "",
});

const recordedSegment = (
  orderIndex: number,
  narration: string,
  durationMs: number,
  audio = true,
): RecordedSegmentPayload => ({
  orderIndex,
  narration,
  spokenText: narration,
  command: serializeSegmentCommands([write(narration)], {
    trustedDiagramGeometry: false,
  }),
  audioBytes: audio ? new Uint8Array([1, 2, 3]) : null,
  durationMs,
  timings: null,
});

const storedTurn = (orderIndex: number, durations: number[]): StoredTurn => ({
  id: `turn-${orderIndex}`,
  orderIndex,
  question: `q${orderIndex}`,
  rawResponse: "",
  speedMultiplier: 1,
  traceId: null,
  sceneDocument: null,
  sceneEngineVersion: null,
  validationReport: null,
  visualStatus: null,
  sceneArtifacts: null,
  segments: durations.map((durationMs, index) => ({
    id: `turn-${orderIndex}-seg-${index}`,
    orderIndex: index,
    narration: `stored ${orderIndex}.${index}`,
    spokenText: `stored ${orderIndex}.${index}`,
    command: serializeSegmentCommands([write("x")], {
      trustedDiagramGeometry: false,
    }),
    audioUrl: null,
    durationMs,
    timings: null,
  })),
});

// --- the in-progress turn becomes replayable -------------------------------

const minted: string[] = [];
let mintCount = 0;
const cache = new Map<number, string>();
const audioUrlFor = (segment: RecordedSegmentPayload) => {
  if (!segment.audioBytes?.length) return null;
  const cached = cache.get(segment.orderIndex);
  if (cached) return cached;
  mintCount += 1;
  const url = `blob:live-${segment.orderIndex}`;
  cache.set(segment.orderIndex, url);
  minted.push(url);
  return url;
};

const liveSegments = [
  recordedSegment(0, "first", 1000),
  recordedSegment(1, "second", 2000),
  recordedSegment(2, "silent", 500, false),
];

const liveTurnSegments = buildLiveTurnSegments(liveSegments, audioUrlFor);
assert.equal(liveTurnSegments.length, 4, "the live turn carries its board epoch plus each segment");
assert.equal(
  (liveTurnSegments[0]!.command as DrawCommand).type,
  "CLEAR",
  "rewinding into the live turn must wipe the previous page the way the lecture did",
);
assert.deepEqual(
  liveTurnSegments.map((segment) => segment.orderIndex),
  [0, 1, 2, 3],
  "segments are reindexed behind the epoch, matching withBoardEpochSegment",
);
assert.equal(liveTurnSegments[3]!.audioUrl, null, "a segment with no captured audio has no URL");

// Re-measuring the live edge must not mint a second URL for the same segment.
buildLiveTurnSegments(liveSegments, audioUrlFor);
buildLiveTurnSegments(liveSegments, audioUrlFor);
assert.equal(mintCount, 2, `live audio URLs must be cached per segment, minted ${mintCount}`);

// --- the timeline is stored turns plus what has been taught so far ---------

const stored = [storedTurn(0, [1000, 1500])];
const withLive = buildLectureTimeline({
  storedTurns: stored,
  liveSegments,
  liveQuestion: "live question",
  audioUrlFor,
});

assert.equal(withLive.turns.length, 2, "the in-progress turn joins the persisted ones");
assert.equal(withLive.turns[1]!.question, "live question");
// 1000 + 1500 stored, then 50 epoch + 1000 + 2000 + 500 live.
assert.equal(withLive.timeline.totalMs, 6050, "the live edge is everything taught so far");
assert.ok(
  withLive.timeline.cues.every((cue) => cue.endMs <= withLive.timeline.totalMs),
  "no cue may sit past the live edge",
);

const withoutLive = buildLectureTimeline({
  storedTurns: stored,
  liveSegments: [],
  liveQuestion: "",
  audioUrlFor,
});
assert.equal(withoutLive.turns.length, 1, "a turn that has taught nothing yet adds no cues");
assert.equal(withoutLive.timeline.totalMs, 2500);

// --- the scrub track ------------------------------------------------------

const liveEdgeMs = 6050;
const wholeLectureMs = 20000;

const live = lectureScrubberModel({
  mode: "live",
  progressMs: 0,
  totalMs: wholeLectureMs,
  liveEdgeMs,
});
assert.equal(live.maxMs, liveEdgeMs, "a live track must stop at the live edge, not the whole lecture");
assert.equal(live.valueMs, liveEdgeMs, "watching live pins the playhead to the edge");
assert.equal(live.atLiveEdge, true);

const rewound = lectureScrubberModel({
  mode: "rewind",
  progressMs: 2000,
  totalMs: wholeLectureMs,
  liveEdgeMs,
});
assert.equal(rewound.maxMs, liveEdgeMs, "rewinding shows the same past-only track");
assert.equal(rewound.valueMs, 2000);
assert.equal(rewound.atLiveEdge, false);

const overshoot = lectureScrubberModel({
  mode: "rewind",
  progressMs: liveEdgeMs + 5000,
  totalMs: wholeLectureMs,
  liveEdgeMs,
});
assert.equal(overshoot.valueMs, liveEdgeMs, "a live lecture has no future to seek into");

const replay = lectureScrubberModel({
  mode: "replay",
  progressMs: 12000,
  totalMs: wholeLectureMs,
  liveEdgeMs: 0,
});
assert.equal(replay.maxMs, wholeLectureMs, "a finished lecture shows its whole timeline");
assert.equal(replay.valueMs, 12000);

// --- entering and leaving the past ----------------------------------------

assert.equal(clampToLiveEdge(-500, liveEdgeMs), 0);
assert.equal(clampToLiveEdge(Number.NaN, liveEdgeMs), 0);
assert.equal(clampToLiveEdge(99999, liveEdgeMs), liveEdgeMs);

assert.equal(isAtLiveEdge(liveEdgeMs, liveEdgeMs), true);
assert.equal(isAtLiveEdge(liveEdgeMs - LIVE_EDGE_TOLERANCE_MS + 1, liveEdgeMs), true);
assert.equal(isAtLiveEdge(liveEdgeMs - LIVE_EDGE_TOLERANCE_MS - 1, liveEdgeMs), false);

assert.equal(
  shouldEnterRewind(liveEdgeMs - 10, liveEdgeMs),
  false,
  "a stray pixel of drag must not pause the lecture",
);
assert.equal(shouldEnterRewind(1000, liveEdgeMs), true, "a real drag back opens the past");
assert.equal(
  shouldEnterRewind(0, 0),
  false,
  "a lecture that has taught nothing yet cannot be rewound",
);

// --- which timeline the bar is showing ------------------------------------

const teaching = resolveLecturePlayback({
  isHeadless: false,
  isReplaying: false,
  isPaused: false,
  rewindActive: false,
  rewindPlaying: false,
  canRewind: true,
});
assert.equal(teaching.mode, "live");
assert.equal(teaching.visible, true, "a live lecture with a past offers the scrub bar");
assert.equal(teaching.playing, false, "live transport is owned by the lesson chrome, not the bar");

const nothingTaughtYet = resolveLecturePlayback({
  isHeadless: false,
  isReplaying: false,
  isPaused: false,
  rewindActive: false,
  rewindPlaying: false,
  canRewind: false,
});
assert.equal(nothingTaughtYet.visible, false, "no past yet means no bar");

const reviewing = resolveLecturePlayback({
  isHeadless: false,
  isReplaying: false,
  isPaused: true,
  rewindActive: true,
  rewindPlaying: true,
  canRewind: true,
});
assert.equal(reviewing.mode, "rewind");
assert.equal(reviewing.visible, true);
assert.equal(
  reviewing.playing,
  true,
  "the live lesson is paused under a rewind, but the rewind itself is playing",
);

const replaying = resolveLecturePlayback({
  isHeadless: false,
  isReplaying: true,
  isPaused: false,
  rewindActive: false,
  rewindPlaying: false,
  canRewind: false,
});
assert.equal(replaying.mode, "replay");
assert.equal(replaying.visible, true);
assert.equal(replaying.playing, true);

const recorder = resolveLecturePlayback({
  isHeadless: true,
  isReplaying: true,
  isPaused: false,
  rewindActive: false,
  rewindPlaying: false,
  canRewind: true,
});
assert.equal(recorder.visible, false, "the headless recorder never draws playback chrome");

assert.equal(
  shouldTrackLiveLectureEdge({ enabled: false, phase: "speaking", isReplaying: false }),
  false,
  "headless must not measure the live edge or mint bar audio URLs",
);
assert.equal(
  shouldTrackLiveLectureEdge({ enabled: true, phase: "speaking", isReplaying: false }),
  true,
  "a student lesson still tracks the live edge",
);
assert.equal(
  shouldTrackLiveLectureEdge({ enabled: true, phase: "idle", isReplaying: false }),
  false,
  "an idle board has no live edge to poll",
);

assert.equal(LIVE_BAR_HIT_PX >= 48, true, "the live hover slab must be thicker than the faded slider");

assert.equal(
  rewindPausedTheLecture(true),
  false,
  "scrubbing back must not claim a pause the student already owned",
);
assert.equal(rewindPausedTheLecture(false), true, "rewind may pause a lecture that was still playing");
assert.equal(
  shouldResumeLiveAfterRewind({ rewindPausedTheLecture: false, lecturePhase: "speaking" }),
  false,
  "Go Live must not un-pause a lecture the student paused themselves",
);
assert.equal(
  shouldResumeLiveAfterRewind({ rewindPausedTheLecture: true, lecturePhase: "speaking" }),
  true,
  "Go Live resumes only the lecture rewind itself froze",
);
assert.equal(
  shouldResumeLiveAfterRewind({ rewindPausedTheLecture: true, lecturePhase: "idle" }),
  false,
  "Go Live must not resume a lecture that has already stopped",
);

assert.equal(
  resolveCommandInkBudgetMs({
    command: write("F = ma"),
    pace: "follow",
    verifiedDiagramIntro: false,
    isTextCommand: true,
    speechWindowMs: 40,
    commandSpeechMs: 40,
    naturalDrawMs: 420,
    multiShapeSegment: false,
  }) >= 420,
  true,
  "a short speech window must not dump a follow WRITE without pen motion",
);

// --- what the header says -------------------------------------------------

assert.equal(resolveActiveStatus("drawing", false, false).label, "teaching…");
assert.equal(resolveActiveStatus("idle", true, false).label, "replaying…");
assert.equal(
  resolveActiveStatus("drawing", false, true, true).label,
  "reviewing…",
  "a rewound lecture reads as reviewing, not paused",
);

console.log("verify-lecture-dvr: ok");
