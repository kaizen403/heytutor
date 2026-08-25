import type { DrawCommand } from "@heytutor/drawing";
import {
  catchUpWriteScheduleOffsets,
  leadWriteScheduleToSpeech,
  getEstimatedWriteCharScheduleMs,
  getBestWriteCharScheduleMs,
  getFallbackWriteCharScheduleMs,
  getWriteCharScheduleMs,
  isWriteScheduleUsable,
  mathToSpeech,
  mergeAudioTimingChunk,
  hasPlayableSegmentAudio,
  resolveLiveAudioPositionMs,
  shouldReleaseAudioPositionWait,
  simulateScheduledWriteWait,
  toSegmentRelativeAudioTimings,
} from "../../src/index";

interface Case {
  name: string;
  narration: string;
  text: string;
}

const cases: Case[] = [
  {
    name: "linear expression",
    narration: "five x plus three. five x is the variable term, and three is the constant.",
    text: "5x + 3",
  },
  {
    name: "power expression",
    narration: "x cubed. that means x times x times x.",
    text: "x^3",
  },
  {
    name: "circle equation",
    narration: "r squared equals x minus h squared plus y minus k squared. this is the circle equation.",
    text: "r^2 = (x-h)^2 + (y-k)^2",
  },
  {
    name: "trig ratio",
    narration: "sine theta equals y. cosine theta equals x. tangent theta equals y over x.",
    text: "sin θ = y",
  },
  {
    name: "chord half-angle",
    narration: "D equals 2 R cosine theta over 2",
    text: "D = 2R cos θ/2",
  },
];

function command(text: string): DrawCommand {
  return {
    type: "WRITE",
    text,
    params: [100, 100],
    charPosition: 0,
    narrationBefore: "",
  };
}

function syntheticTimings(narration: string) {
  const spoken = mathToSpeech(narration);
  return {
    charStartTimes: Array.from({ length: spoken.length }, (_, index) => index * 0.065),
    charDurations: new Array(spoken.length).fill(0.065),
    totalDuration: spoken.length * 0.065,
  };
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

for (const testCase of cases) {
  const estimated = getEstimatedWriteCharScheduleMs(testCase.narration, command(testCase.text));
  const timed = getWriteCharScheduleMs(
    testCase.narration,
    command(testCase.text),
    syntheticTimings(testCase.narration),
  );

  for (const [source, schedule] of [
    ["estimated", estimated],
    ["tts", timed],
  ] as const) {
    assert(schedule, `${testCase.name}: ${source} schedule was not created`);
    assert(schedule.matched, `${testCase.name}: ${source} schedule did not match spoken text`);
    assert(schedule.offsetsMs.length === testCase.text.replace(/\s/g, "").length, `${testCase.name}: wrong char count`);
    assert(
      schedule.charDurationsMs.length === schedule.offsetsMs.length,
      `${testCase.name}: char duration count mismatch`,
    );
    assert((schedule.offsetsMs[0] ?? 999) <= 100, `${testCase.name}: first character starts too late`);
    for (let i = 1; i < schedule.offsetsMs.length; i++) {
      assert(schedule.offsetsMs[i] >= schedule.offsetsMs[i - 1], `${testCase.name}: offsets are not monotonic`);
    }
    for (const duration of schedule.charDurationsMs) {
      assert(duration >= 24, `${testCase.name}: char duration too short`);
    }
  }
}

const unsyncable = getEstimatedWriteCharScheduleMs(
  "this formula comes from rearranging the original equation.",
  command("5x + 3"),
);
assert(unsyncable === null, "unsyncable board text should not get a character schedule");

const beforeAudioStart = getBestWriteCharScheduleMs(
  "write five x plus three on the board.",
  command("5x + 3"),
  null,
);
assert(beforeAudioStart, "text must receive an estimated schedule before audio starts");
assert(
  beforeAudioStart.source === "estimated",
  "pre-audio text scheduling must use the deterministic estimate",
);

assert(
  !hasPlayableSegmentAudio({
    receivedAudio: false,
    decodedAudio: false,
    capturedChunkCount: 0,
  }),
  "a finalized websocket segment without audio must be rejected",
);
assert(
  !hasPlayableSegmentAudio({
    receivedAudio: true,
    decodedAudio: false,
    capturedChunkCount: 1,
  }),
  "undecodable websocket bytes must not count as playable audio",
);
assert(
  hasPlayableSegmentAudio({
    receivedAudio: true,
    decodedAudio: true,
    capturedChunkCount: 1,
  }),
  "a finalized websocket segment with captured audio must be playable",
);

const fallback = getFallbackWriteCharScheduleMs(
  "this formula comes from rearranging the original equation.",
  command("5x + 3"),
);
assert(fallback, "fallback schedule must exist when board text is not spoken");
assert(fallback.offsetsMs.length === 4, "fallback schedule must cover non-space characters");
assert((fallback.offsetsMs[0] ?? 0) > 200, "fallback writing must start mid-speech, not at t=0");
assert(
  (fallback.offsetsMs[fallback.offsetsMs.length - 1] ?? 0) <
    Math.max("this formula comes from rearranging the original equation.".length * (1000 / 15), 700),
  "fallback writing must finish during speech",
);

const caughtUp = catchUpWriteScheduleOffsets([100, 300, 500, 700], 450);
assert(caughtUp[0] === 450 && caughtUp[1] === 450, "overdue characters must catch up to now");
assert(caughtUp[2] === 500 && caughtUp[3] === 700, "future character cues must stay anchored");
assert(
  catchUpWriteScheduleOffsets([100, 300], 50).join(",") === "100,300",
  "on-time schedules must not be rewritten",
);

const connectionRelative = {
  charStartTimes: [] as number[],
  charDurations: [] as number[],
  totalDuration: 0,
};
let connectionOffset = mergeAudioTimingChunk(connectionRelative, {
  startTimesMs: [39_000, 39_100],
  durationsMs: [100, 100],
});
connectionOffset = mergeAudioTimingChunk(connectionRelative, {
  startTimesMs: [39_200, 39_300],
  durationsMs: [100, 100],
}, connectionOffset);
const relative = toSegmentRelativeAudioTimings(connectionRelative);
assert(relative.charStartTimes.map((value) => value.toFixed(1)).join(",") === "0.0,0.1,0.2,0.3", "connection-relative timings were not rebased");
assert(Math.abs(relative.totalDuration - 0.4) < 1e-9, "rebased timing duration is wrong");

const firstLiveSegment = toSegmentRelativeAudioTimings({
  charStartTimes: [0, 4.404],
  charDurations: [0.1, 0.1],
  totalDuration: 4.504,
});
const secondLiveSegment = toSegmentRelativeAudioTimings({
  charStartTimes: [4.504, 8.073],
  charDurations: [0.1, 0.1],
  totalDuration: 8.173,
});
assert(Math.abs(firstLiveSegment.totalDuration - 4.504) < 1e-9, "first live segment changed unexpectedly");
assert(Math.abs(secondLiveSegment.totalDuration - 3.669) < 1e-9, "later live segment retained its connection origin");

const lateSchedule = getWriteCharScheduleMs(
  "let's use a real example. center at two comma three, radius five.",
  command("ex: (2,3), r=5"),
  syntheticTimings(
    "let's use a real example. center at two comma three, radius five.",
  ),
);
if (lateSchedule) {
  // Force an implausibly late first offset like bad streaming alignment can produce.
  lateSchedule.offsetsMs[0] = 9996;
  assert(
    !isWriteScheduleUsable(
      lateSchedule,
      "let's use a real example. center at two comma three, radius five.",
      11000,
    ),
    "late first offset schedule should be rejected",
  );
}

const delayedHttpStart = resolveLiveAudioPositionMs({
  speechComplete: false,
  capturedDurationMs: null,
  estimateSpeechMs: 8000,
  playbackPositionMs: null,
  audioStartedAtMs: null,
  nowMs: 800,
  maxAudioPositionMs: Number.NEGATIVE_INFINITY,
});
assert(delayedHttpStart.positionMs >= 0, "late HTTP/WS audio must not leave the write clock at -1");
assert(delayedHttpStart.positionMs < 200, "before audio starts, writing should use t=0 not the sentence end");

const afterSpeech = resolveLiveAudioPositionMs({
  speechComplete: true,
  capturedDurationMs: 8200,
  estimateSpeechMs: 8000,
  playbackPositionMs: null,
  audioStartedAtMs: null,
  nowMs: 8200,
  maxAudioPositionMs: 0,
});
assert(afterSpeech.positionMs >= 8200, "completed speech should release leftover ink");

const wallClock = resolveLiveAudioPositionMs({
  speechComplete: false,
  capturedDurationMs: null,
  estimateSpeechMs: 8000,
  playbackPositionMs: null,
  audioStartedAtMs: 1000,
  nowMs: 2500,
  maxAudioPositionMs: 0,
});
assert(wallClock.positionMs === 1500, "once audio starts, the write clock must follow wall time");

const pinnedZeroPlayback = resolveLiveAudioPositionMs({
  speechComplete: false,
  capturedDurationMs: null,
  estimateSpeechMs: 8000,
  playbackPositionMs: 0,
  audioStartedAtMs: 1000,
  nowMs: 2800,
  maxAudioPositionMs: 0,
});
assert(
  pinnedZeroPlayback.positionMs === 1800,
  "a zero TTS playback position must not pin writing at t=0",
);

const led = leadWriteScheduleToSpeech([4081, 4300, 4600, 5000], 0);
assert((led[0] ?? 999) <= 250, "writing must start with speech instead of waiting seconds");
assert((led[3] ?? 0) < 5000, "later characters must shift forward with the first");
assert(
  leadWriteScheduleToSpeech([120, 240], 0).join(",") === "120,240",
  "on-time schedules must keep their spoken cues",
);

assert(
  shouldReleaseAudioPositionWait({
    positionMs: -1,
    targetMs: 2400,
    elapsedMs: 400,
    clockEverStarted: false,
    stalledFrames: 0,
  }),
  "writeText must not hang a full sentence waiting for a clock that never starts",
);
assert(
  !shouldReleaseAudioPositionWait({
    positionMs: 200,
    targetMs: 2400,
    elapsedMs: 200,
    clockEverStarted: true,
    stalledFrames: 0,
  }),
  "an advancing clock must still wait for its spoken cue",
);

const parkedPenOffsets = [80, 160, 240, 320, 400];
const nullClockWrite = simulateScheduledWriteWait({
  offsetsMs: parkedPenOffsets,
  getRawPositionMs: () => null,
});
assert(nullClockWrite.completed, "a WRITE+speech segment must not hang when getAudioPositionMs is null");
assert(
  nullClockWrite.elapsedMs <= parkedPenOffsets[parkedPenOffsets.length - 1]! + 64,
  `null getAudioPositionMs parked the pen for ${nullClockWrite.elapsedMs}ms`,
);
const stuckClockWrite = simulateScheduledWriteWait({
  offsetsMs: parkedPenOffsets,
  getRawPositionMs: () => 16,
  maxElapsedMs: 3_000,
});
assert(stuckClockWrite.completed, "a WRITE+speech segment must not hang when the audio clock is stuck");
assert(
  stuckClockWrite.elapsedMs < 2_000,
  `stuck getAudioPositionMs parked the pen for ${stuckClockWrite.elapsedMs}ms`,
);

const stuckPlayback = resolveLiveAudioPositionMs({
  speechComplete: false,
  capturedDurationMs: null,
  estimateSpeechMs: 8000,
  playbackPositionMs: 16,
  audioStartedAtMs: 1000,
  nowMs: 2800,
  maxAudioPositionMs: 16,
});
assert(
  stuckPlayback.positionMs >= 1700,
  "a stuck TTS playback position must fall through to wall time",
);

console.log(
  `verified ${cases.length} sync schedule cases, fallback mid-speech writing, and catch-up offsets`,
);
