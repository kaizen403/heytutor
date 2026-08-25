import assert from "node:assert/strict";
import {
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
} from "@heytutor/drawing";
import {
  createScheduledWriteClock,
  simulateScheduledWriteWait,
} from "@heytutor/tutor-core";
import {
  buildLocalStoredTurn,
  enrichStoredSegmentsWithReplayAudio,
} from "../../lib/replay/replayTurns";
import {
  buildReplayTimeline,
  findCueAtTime,
  formatReplayTime,
} from "../../lib/replay/replayTimeline";

const blobUrls: string[] = [];
const register = (url: string) => {
  blobUrls.push(url);
};

const writeCommand = {
  type: "WRITE",
  text: "x",
  params: [90, 142],
  charPosition: 0,
  narrationBefore: "",
} satisfies DrawCommand;
const trustedCommand = serializeSegmentCommands([writeCommand], {
  trustedDiagramGeometry: true,
});
assert.ok(trustedCommand);
assert.equal(isStoredCommandTrustedGeometry(trustedCommand), true);
assert.deepEqual(parseStoredSegmentCommands(trustedCommand), [writeCommand]);

const recorded = [
  {
    orderIndex: 0,
    narration: "hello world",
    spokenText: "hello world",
    command: trustedCommand,
    audioBytes: new Uint8Array([1, 2, 3, 4]),
    durationMs: 900,
    timings: null,
  },
];

const savedSegments = [
  {
    id: "seg-0",
    orderIndex: 0,
    narration: "hello world",
    spokenText: "hello world",
    command: trustedCommand,
    audioUrl: null,
    durationMs: 900,
    timings: null,
  },
];

const enriched = enrichStoredSegmentsWithReplayAudio(savedSegments, recorded, register);
assert.equal(enriched.length, 1);
assert.ok(enriched[0]?.audioUrl?.startsWith("blob:"));

const localTurn = buildLocalStoredTurn(
  {
    question: "What is x?",
    rawResponse: "[STEP]hello[/STEP]",
    speedMultiplier: 1.5,
    segments: recorded,
  },
  0,
  register,
);
assert.equal(localTurn.segments.length, 1);
assert.ok(localTurn.segments[0]?.audioUrl?.startsWith("blob:"));

const timeline = buildReplayTimeline([localTurn]);
assert.equal(timeline.cues.length, 1);
assert.equal(timeline.cues[0]?.trustedDiagramGeometry, true);
assert.equal(timeline.totalMs, 900);
assert.equal(formatReplayTime(900), "0:00");
const atMid = findCueAtTime(timeline.cues, 450);
assert.ok(atMid);
assert.equal(atMid!.offsetMs, 450);

const parkedWatchWrite = simulateScheduledWriteWait({
  offsetsMs: [80, 160, 240, 320, 400],
  getRawPositionMs: () => 0,
});
assert.equal(parkedWatchWrite.completed, true, "Watch WRITE must not hang when replay audio currentTime is 0");
assert.ok(
  parkedWatchWrite.elapsedMs < 500,
  `Watch live-TTS fallback parked the pen for ${parkedWatchWrite.elapsedMs}ms`,
);

let fakeNow = 0;
const deadAudioClock = createScheduledWriteClock({
  getRawPositionMs: () => 0,
  nowMs: () => fakeNow,
});
assert.equal(deadAudioClock(), 0);
fakeNow = 180;
assert.equal(deadAudioClock(), 180, "a missing MP3 clock must write against wall time");

console.log("verify-replay: ok");
