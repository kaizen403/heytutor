import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { synthesizeDsaScene } from "@heytutor/scene-engine";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import {
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  resolveVerifiedDiagramFocusTargets,
  serializeSegmentCommands,
  type DrawCommand,
} from "@heytutor/drawing";
import { DSA_DIAGRAM_ZONE } from "../../features/tutor-session/constants";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
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

const remoteSaved = enrichStoredSegmentsWithReplayAudio(
  [{ ...savedSegments[0]!, audioUrl: "https://pub.example/lectures/a.mp3" }],
  recorded,
  register,
);
assert.ok(
  remoteSaved[0]?.audioUrl?.startsWith("blob:"),
  "captured bytes win over a public URL the browser may not be able to fetch",
);

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

{
  // Replay draws intro ink from stored commands, then teaching FOCUS looks up
  // the verified diagram. If that diagram is never rebuilt, the pen stops
  // after the figure is on the board — the admin Watch symptom.
  const question = "Explain binary search on a sorted array.";
  const plan = getMockCodeLessonPlan(question);
  const dsaScene = synthesizeDsaScene(plan.diagramHint, {
    question,
    compile: { viewport: DSA_DIAGRAM_ZONE },
  });
  assert.ok(dsaScene, "the mock plan must synthesize a scene for this check");
  const stamped = {
    ...dsaScene.document,
    source: {
      ...dsaScene.document.source,
      nonMetric: true,
      representationTier: dsaScene.tier,
    },
  };
  const diagram = restoreVerifiedDiagramFromTurn({ sceneDocument: stamped });
  assert.ok(diagram, "a stored scene document must rebuild a verified diagram");
  const anchorId = diagram!.anchors[0]?.id;
  assert.ok(anchorId, "the rebuilt diagram must expose focus anchors");
  const focus = {
    type: "FOCUS",
    params: [],
    text: `${anchorId}|spotlight`,
    charPosition: 0,
    narrationBefore: "",
    semanticRef: { entityId: `${anchorId}|spotlight` },
  } as unknown as DrawCommand;
  assert.equal(
    resolveVerifiedDiagramFocusTargets(focus, null).length,
    0,
    "FOCUS against a missing diagram is a silent no-op: that is the bug",
  );
  assert.ok(
    resolveVerifiedDiagramFocusTargets(focus, diagram).length > 0,
    "FOCUS against the restored diagram must resolve the intro's own anchors",
  );

  const replaySource = readFileSync(
    resolve(import.meta.dirname, "../../features/tutor-session/hooks/useReplay.ts"),
    "utf8",
  );
  assert.match(
    replaySource,
    /restoreVerifiedDiagramFromTurn/,
    "replay must rebuild the verified diagram before teaching FOCUS runs",
  );
  assert.match(
    replaySource,
    /activeVerifiedDiagramRef\.current = diagram/,
    "replay must publish the restored diagram onto the FOCUS resolver",
  );
}

console.log("verify-replay: ok");
