import assert from "node:assert/strict";
import type { DrawCommand } from "@heytutor/drawing";
import {
  buildLocalStoredTurn,
  enrichStoredSegmentsWithReplayAudio,
} from "../lib/replayTurns";
import {
  buildReplayTimeline,
  findCueAtTime,
  formatReplayTime,
} from "../lib/replayTimeline";

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

const recorded = [
  {
    orderIndex: 0,
    narration: "hello world",
    spokenText: "hello world",
    command: writeCommand,
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
    command: writeCommand,
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
assert.equal(timeline.totalMs, 900);
assert.equal(formatReplayTime(900), "0:00");
const atMid = findCueAtTime(timeline.cues, 450);
assert.ok(atMid);
assert.equal(atMid!.offsetMs, 450);

console.log("verify-replay: ok");
