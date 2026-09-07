import assert from "node:assert/strict";
import { serializeSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import { shouldHideCursorForCapture } from "@heytutor/whiteboard";
import {
  withBoardEpochSegment,
  type RecordedSegmentPayload,
  type StoredTurn,
} from "../../lib/boards/boardsClient";
import {
  canEncodeLectureMp4,
  canExportLectureTurn,
  latestCompletedTurn,
  lectureDownloadFilename,
  shouldCancelLectureExport,
  speakingLectureSegments,
  turnHasExportableAudio,
} from "../../lib/lecture-export/canExportLectureMp4";
import { waitUntilExportClock } from "../../lib/lecture-export/drawLectureTimeline";
import {
  isAllowedLectureAudioSource,
  lectureAudioFetchUrl,
} from "../../lib/lecture-export/lectureAudioUrl";
import {
  buildLectureAudioTrack,
  concatPcm,
  fitPcmToDuration,
  mixCueAudio,
  resolveLectureAudioUrl,
  silencePcm,
} from "../../lib/lecture-export/lectureAudioTrack";
import { buildReplayTimeline, type ReplayCue } from "../../lib/replay/replayTimeline";

const write = (text: string): DrawCommand => ({
  type: "WRITE",
  text,
  params: [90, 142],
  charPosition: 0,
  narrationBefore: "",
});

const storedSegment = (
  orderIndex: number,
  narration: string,
  durationMs: number,
  audioUrl: string | null,
): StoredTurn["segments"][number] => ({
  id: `seg-${orderIndex}`,
  orderIndex,
  narration,
  spokenText: narration,
  command: serializeSegmentCommands([write(narration || "x")], {
    trustedDiagramGeometry: false,
  }),
  audioUrl,
  durationMs,
  timings: null,
});

const storedTurn = (
  orderIndex: number,
  question: string,
  segments: StoredTurn["segments"],
): StoredTurn => ({
  id: `turn-${orderIndex}`,
  orderIndex,
  question,
  rawResponse: "",
  speedMultiplier: 1,
  traceId: null,
  sceneDocument: null,
  sceneEngineVersion: null,
  validationReport: null,
  visualStatus: null,
  sceneArtifacts: null,
  segments,
});

const first = storedTurn(0, "find v", [
  storedSegment(0, "", 50, null),
  storedSegment(1, "so v equals sixty", 1200, "blob:turn-0"),
]);
const second = storedTurn(1, "find a", [
  storedSegment(0, "", 50, null),
  storedSegment(1, "the block slides", 800, "https://example.test/a.mp3"),
]);

const single = buildReplayTimeline([first]);
const both = buildReplayTimeline([first, second]);
assert.equal(single.cues.every((cue) => cue.turnIndex === 0), true, "export uses one turn only");
assert.ok(both.totalMs > single.totalMs, "a second question must not leak into this lecture file");
assert.ok(
  first.segments[0] && first.segments[0].narration === "",
  "the persisted epoch CLEAR stays on the turn",
);
assert.ok(single.cues[0] && single.cues[0].durationMs === 50, "CLEAR occupies the timeline as 50ms of silence");

assert.equal(latestCompletedTurn([first, second])?.id, "turn-1", "header download is the latest question");
assert.equal(canExportLectureTurn(first), true, "a turn with blob audio is exportable");
assert.equal(
  turnHasExportableAudio(storedTurn(2, "silent", [storedSegment(0, "hello", 800, null)])),
  false,
  "speaking segments without audio cannot export",
);
assert.equal(speakingLectureSegments(first).length, 1, "CLEAR is not a speaking segment");

assert.equal(canEncodeLectureMp4({}), false, "Node has no WebCodecs encoder");
assert.equal(
  canEncodeLectureMp4({
    VideoEncoder: function VideoEncoder() {},
    AudioEncoder: function AudioEncoder() {},
    VideoFrame: function VideoFrame() {},
    AudioData: function AudioData() {},
  }),
  true,
  "all four WebCodecs constructors are required",
);

assert.equal(
  shouldCancelLectureExport({ cancelled: false, phase: "idle", isReplaying: false }),
  false,
  "idle export may run",
);
assert.equal(
  shouldCancelLectureExport({ cancelled: false, phase: "thinking", isReplaying: false }),
  true,
  "a new question cancels export",
);
assert.equal(
  shouldCancelLectureExport({ cancelled: false, phase: "idle", isReplaying: true }),
  true,
  "student replay cancels export",
);
assert.equal(
  shouldCancelLectureExport({ cancelled: true, phase: "idle", isReplaying: false }),
  true,
  "an explicit cancel stops export",
);

assert.equal(lectureDownloadFilename("Find v for the lens"), "lecture-find-v-for-the-lens.mp4");
assert.equal(lectureDownloadFilename("   "), "lecture-question.mp4");

const short = new Float32Array([0.1, 0.2, 0.3]);
const padded = fitPcmToDuration([short], 1000, 10);
assert.equal(padded[0]?.length, 10, "short audio pads with silence to the cue length");
assert.ok(Math.abs((padded[0]?.[2] ?? 0) - short[2]!) < 1e-6, "padded audio keeps the original samples");
assert.equal(padded[0]?.[9], 0);

const long = new Float32Array(20).fill(1);
const trimmed = fitPcmToDuration([long], 1000, 5);
assert.equal(trimmed[0]?.length, 5, "long audio trims to the cue length");

const silence = silencePcm(50, 1000, 1);
assert.equal(silence[0]?.length, 50, "CLEAR silence is 50ms at the export sample rate");

const joined = concatPcm([silence, padded], 1);
assert.equal(joined[0]?.length, 60, "CLEAR silence and the spoken cue concatenate");

const missing = mixCueAudio({
  durationMs: 200,
  sampleRate: 1000,
  channelCount: 1,
  decoded: null,
});
assert.equal(missing.usedStoredAudio, false, "missing audio becomes silence, not a throw");
assert.equal(missing.channels[0]?.length, 200);

const cue = {
  id: "0-1-1",
  turnIndex: 0,
  segmentIndex: 1,
  startMs: 50,
  endMs: 250,
  durationMs: 200,
  narration: "hello",
  commands: [],
  trustedDiagramGeometry: false,
  audioUrl: "blob:hello",
  durationMsStored: 200,
  timings: null,
  segment: first.segments[1]!,
} satisfies ReplayCue;
assert.equal(resolveLectureAudioUrl(cue), "blob:hello");
assert.equal(resolveLectureAudioUrl({ ...cue, audioUrl: null }), null);
assert.equal(lectureAudioFetchUrl("blob:hello"), "blob:hello");
assert.equal(lectureAudioFetchUrl("/api/local.mp3"), "/api/local.mp3");
assert.equal(
  lectureAudioFetchUrl("https://pub.example/lectures/a.mp3", "http://localhost:3000"),
  "/api/lecture-audio?src=https%3A%2F%2Fpub.example%2Flectures%2Fa.mp3",
);
assert.equal(
  lectureAudioFetchUrl("https://localhost:3000/kept.mp3", "https://localhost:3000"),
  "https://localhost:3000/kept.mp3",
);
assert.equal(
  isAllowedLectureAudioSource("https://pub.example/lectures/a.mp3", "https://pub.example"),
  true,
);
assert.equal(
  isAllowedLectureAudioSource("https://evil.example/lectures/a.mp3", "https://pub.example"),
  false,
);
assert.equal(isAllowedLectureAudioSource("http://pub.example/a.mp3", "https://pub.example"), false);

async function main(): Promise<void> {
const built = await buildLectureAudioTrack({
  cues: [
    { ...cue, narration: "", audioUrl: null, durationMs: 50, startMs: 0, endMs: 50 },
    { ...cue, audioUrl: "blob:hello", durationMs: 200 },
    { ...cue, audioUrl: null, narration: "missing", durationMs: 100 },
  ],
  sampleRate: 1000,
  fetchBytes: async (url) => (url === "blob:hello" ? new Uint8Array([1]) : null),
  decodeBytes: async () => ({ channels: [new Float32Array([0.5, 0.5])], sampleRate: 1000 }),
});
assert.equal(built.channels[0]?.length, 350, "CLEAR + spoken + missing-audio silence");
assert.equal(built.missingAudioCues, 1, "only speaking cues without audio count as missing");

let now = 0;
const advances: Array<() => void> = [];
const waitForAdvance = () =>
  new Promise<void>((resolve) => {
    advances.push(resolve);
  });
const pending = waitUntilExportClock(() => now, 100, waitForAdvance, () => false);
now = 120;
advances.splice(0).forEach((resolve) => resolve());
await pending;
}

const recorded: RecordedSegmentPayload[] = [
  {
    orderIndex: 0,
    narration: "so v equals sixty",
    spokenText: "so v equals sixty",
    command: serializeSegmentCommands([write("v = 60")], { trustedDiagramGeometry: false }),
    audioBytes: new Uint8Array([1, 2, 3]),
    durationMs: 1200,
    timings: null,
  },
];
const persisted = withBoardEpochSegment(recorded);
assert.equal((persisted[0]!.command as DrawCommand).type, "CLEAR");
assert.equal(persisted[0]!.durationMs, 50);

assert.equal(shouldHideCursorForCapture("snapshot"), true, "PDF snapshots still hide the pen");
assert.equal(shouldHideCursorForCapture("frame"), false, "lecture frames keep the pen");

void main()
  .then(() => {
    console.log("verify-lecture-mp4: single-turn timeline, audio pad/trim, cancel guards");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
