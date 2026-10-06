/** Captured WRAP regression, not a modified lesson or a parser fixture. */
import assert from "node:assert/strict";
import { parseStoredSegmentCommands, serializeSegmentCommands, type DrawCommand, type VerifiedDiagram } from "@heytutor/drawing";
import { estimateSpeechDurationMs, getBestWriteCharScheduleMs, mathToSpeech, type AudioTimings } from "@heytutor/tutor-core";
import { drawSegmentInk, planSegmentInk } from "../../features/tutor-session/lib/turn/segmentInk";
import { findWorkTextSlot } from "../../features/tutor-session/lib/board/boardLayout";
import { TEXT_LAYOUT } from "../../features/tutor-session/constants";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import type { ExecuteCommandOptions } from "../../features/tutor-session/hooks/turn/types";

// Sparse extraction from batch-6e26b848/protocol-and-wrap-audit.json.
const narration = "let's start by looking at the matrix A itself. it has three rows and four columns.";
const savedPieces: DrawCommand[] = [
  { type: "WRITE", text: "A = [[2,5,19,-7],[35,-2,2.5,12],[1.5,1,", params: [90, 145, 32], charPosition: 90, narrationBefore: narration },
  { type: "WRITE", text: "-5,17]]", params: [90, 208, 32], charPosition: 90, narrationBefore: narration },
];
// The capture's alignment arrives late and is non-monotonic. Keep that shape
// here rather than replacing the original speech with a more convenient cue.
const capturedTimings: AudioTimings = {
  totalDuration: 4.415299999999814,
  charDurations: Array.from({ length: 82 }, () => 0.06),
  charStartTimes: [
    0.06329999999981374, 0, 0, 0, 0, 0, 0.3299000000003725, 0, 0, 0, 0, 0,
    0.6499000000003725, 0, 0, 0.8207999999998138, 0, 0, 0, 0, 0, 0, 0, 1.1405,
    0, 0, 1.2685, 0, 0, 0, 1.354299999999814, 0, 0, 0, 0, 0, 0,
    1.876700000000186, 0, 2.015200000000186, 0, 0, 0, 0, 0, 0, 0,
    2.420700000000186, 0, 0, 2.527200000000186, 0, 0, 0, 2.73, 0, 0, 0, 0, 0,
    2.975200000000186, 0, 0, 0, 0, 3.231200000000186, 0, 0, 0, 3.348599999999628,
    0, 0, 0, 0, 3.604700000000186, 0, 0, 0, 0, 0, 0, 0,
  ],
};
const failures: string[] = [];
let checks = 0;
function check(label: string, verify: () => void): void {
  checks++;
  try { verify(); } catch (error) { failures.push(`${label}: ${String(error)}`); }
}

async function run(commands: DrawCommand[], words: string, timings: AudioTimings | null = null, options: {
  lateTimings?: AudioTimings;
  diagram?: VerifiedDiagram;
  opensSentence?: boolean;
  cancelled?: boolean;
} = {}) {
  const executed: DrawCommand[] = [];
  const executionOptions: ExecuteCommandOptions[] = [];
  const sources: unknown[] = [];
  const estimatedSpeechMs = estimateSpeechDurationMs(mathToSpeech(words).length);
  await drawSegmentInk({
    plan: planSegmentInk({ commands, verifiedDiagramIntro: false, hasNarration: true }),
    verifiedDiagramIntro: false,
    clock: {
      narration: words,
      getTimings: () => executed.length > 0 ? options.lateTimings ?? timings : timings,
      totalSpeechMs: timings ? timings.totalDuration * 1000 : estimatedSpeechMs,
      estimatedSpeechMs,
      getAudioPositionMs: () => 0,
      getPlaybackRate: () => 1,
    },
    getDiagram: () => options.diagram ?? null,
    isCancelled: () => options.cancelled === true,
    waitWhilePaused: async () => true,
    execute: async (command, commandOptions) => {
      executed.push(command);
      executionOptions.push(commandOptions);
    },
    commandOptions: () => ({ applyLayout: false }),
    opensSentence: options.opensSentence,
    trace: { writeScheduleReady: (metadata) => { sources.push(metadata.schedule_source); } },
  });
  return { executed, sources, executionOptions };
}

async function main() {
  const estimateMs = estimateSpeechDurationMs(mathToSpeech(narration).length);
  const rawAnchors = savedPieces.map((command, index) =>
    getBestWriteCharScheduleMs(narration, command, null, estimateMs, index)?.offsetsMs[0] ?? 0);
  check("fixture exercises the original inverted independent speech anchors", () => {
    assert.ok(rawAnchors[1]! < rawAnchors[0]!, `head=${rawAnchors[0]}, tail=${rawAnchors[1]}`);
  });
  const live = await run(savedPieces, narration);
  check("captured WRAP keeps head before tail without TTS alignment", () => {
    assert.deepEqual(live.executed.map((command) => command.text), savedPieces.map((command) => command.text));
  });
  check("live still schedules immediately from the estimate", () => {
    assert.deepEqual(live.sources, ["estimated", "estimated"]);
  });
  const late = await run(savedPieces, narration, null, { lateTimings: capturedTimings });
  check("late captured alignment cannot reverse the authored WRAP", () => {
    assert.deepEqual(late.executed.map((command) => command.text), savedPieces.map((command) => command.text));
    assert.deepEqual(late.sources, ["estimated", "estimated"]);
  });
  const roundTrip = await canonicalizeTurnSceneMetadata({
    question: "A=[[2,5,19,-7],[35,-2,2.5,12],[1.5,1,-5,17]]. Show the matrix A, state its order and write the elements a13, a21, a33, a24 and a23.",
    visualStatus: "text_only",
    segments: [{ orderIndex: 0, narration, spokenText: narration, command: serializeSegmentCommands(savedPieces) }],
  });
  assert.ok(roundTrip.ok, "the actual saved two-piece WRITE must still be admitted");
  const restored = parseStoredSegmentCommands(roundTrip.value.segments[0]!.command);
  check("save preserves both pieces and their authored source identity", () => {
    assert.deepEqual(restored, savedPieces);
    assert.equal(restored.map((command) => command.text).join(""), "A = [[2,5,19,-7],[35,-2,2.5,12],[1.5,1,-5,17]]");
  });
  for (const timings of [null, capturedTimings]) {
    const replay = await run(restored, narration, timings);
    check(`saved replay keeps head before tail with ${timings ? "captured" : "missing"} alignment`, () => {
      assert.deepEqual(replay.executed.map((command) => command.text), savedPieces.map((command) => command.text));
      assert.deepEqual(replay.executed.map((command) => command.params), savedPieces.map((command) => command.params));
    });
  }
  const threePieces = [savedPieces[0]!,
    { ...savedPieces[1]!, text: "-5," },
    { ...savedPieces[1]!, text: "17]]", params: [90, 274, 32] },
  ];
  const three = await run(threePieces, narration);
  check("every continuation in a longer WRAP follows its predecessor", () => {
    assert.deepEqual(three.executed.map((command) => command.text), threePieces.map((command) => command.text));
  });
  const independent: DrawCommand[] = [
    { type: "WRITE", text: "u = -20 cm", params: [90, 274, 32], charPosition: 120, narrationBefore: "" },
    { type: "WRITE", text: "v = 60 cm", params: [90, 340, 32], charPosition: 160, narrationBefore: "" },
  ];
  const reverse = await run(independent, "v equals sixty centimetres, then u equals negative twenty centimetres.");
  check("independent reverse-cued commands retain genuine spoken ordering", () => {
    assert.deepEqual(reverse.executed.map((command) => command.text), ["v = 60 cm", "u = -20 cm"]);
  });
  const missingIdentity = independent.map((command) => {
    const row = { ...command };
    Reflect.deleteProperty(row, "charPosition");
    Reflect.deleteProperty(row, "narrationBefore");
    return row;
  });
  const reverseMissing = await run(missingIdentity, "v equals sixty centimetres, then u equals negative twenty centimetres.");
  check("missing source metadata never conflates independent reverse-cued WRITEs", () => {
    assert.deepEqual(reverseMissing.executed.map((command) => command.text), ["v = 60 cm", "u = -20 cm"]);
  });
  const defaultIdentity = independent.map((command) => ({ ...command, charPosition: 0, narrationBefore: "" }));
  const reverseDefault = await run(defaultIdentity, "v equals sixty centimetres, then u equals negative twenty centimetres.");
  check("default zero/empty metadata is not a proven shared source tag", () => {
    assert.deepEqual(reverseDefault.executed.map((command) => command.text), ["v = 60 cm", "u = -20 cm"]);
  });
  const differentNarration = independent.map((command) => ({ ...command, charPosition: 90, narrationBefore: command.text! }));
  const reverseOtherSource = await run(differentNarration, "v equals sixty centimetres, then u equals negative twenty centimetres.");
  check("equal offsets alone do not join different authored narration", () => {
    assert.deepEqual(reverseOtherSource.executed.map((command) => command.text), ["v = 60 cm", "u = -20 cm"]);
  });
  const boundaryCases = [
    independent.map((command) => ({ ...command, charPosition: 90 })),
    independent.map((command) => ({ ...command, charPosition: 90, narrationBefore: "   " })),
    independent.map((command) => ({ ...command, charPosition: 0, narrationBefore: "a shared synthetic sentence" })),
    independent.map((command, index) => ({ ...command, charPosition: 90, narrationBefore: "a shared synthetic sentence", params: [90, index === 0 ? 340 : 274, 32] })),
  ];
  for (const [index, commands] of boundaryCases.entries()) {
    const result = await run(commands, "v equals sixty centimetres, then u equals negative twenty centimetres.");
    check(`unproven continuation boundary ${index} preserves independent spoken ordering`, () => {
      assert.deepEqual(result.executed.map((command) => command.text), ["v = 60 cm", "u = -20 cm"]);
    });
  }
  const resume = await run(independent, "v equals sixty centimetres, then u equals negative twenty centimetres.", null, { opensSentence: false });
  check("a resumed sentence retains the order its resume point was counted in", () => {
    assert.deepEqual(resume.executed, independent);
  });
  const focus: DrawCommand = { type: "FOCUS", text: "point_p", params: [], charPosition: 220, narrationBefore: "" };
  const diagram: VerifiedDiagram = {
    id: "verified_scene", name: "committed point", commands: [], reveals: [], promptAddon: "",
    anchors: [{ id: "point_p", labels: ["P"], x: 500, y: 200, width: 20, height: 20 }],
  };
  const withFocus = await run([independent[1]!, focus], "P is marked, then v equals sixty centimetres.", null, { diagram });
  check("inline verified FOCUS still precedes a later spoken independent WRITE", () => {
    assert.deepEqual(withFocus.executed.map((command) => command.type), ["FOCUS", "WRITE"]);
    assert.deepEqual(withFocus.executionOptions[0]!.focusSchedule?.targets.map((target) => target.id), ["point_p"]);
    assert.deepEqual(withFocus.executed[0]!.params, [], "focus remains entity-bound, without teaching coordinates");
  });
  const cancelled = await run(savedPieces, narration, null, { cancelled: true });
  check("cancellation still stops ink before either piece", () => assert.equal(cancelled.executed.length, 0));
  const tailSlot = findWorkTextSlot({
    layout: { rects: [], nextY: 208 },
    requestedX: 118,
    requestedY: 208,
    width: 100,
    height: TEXT_LAYOUT.textHeight,
    diagramActive: true,
    sequential: true,
    runtimeOwnsX: true,
  });
  check("runtime continuation x agrees with the captured saved work margin", () => {
    assert.equal(tailSlot?.x, savedPieces[1]!.params[0]);
  });
  for (const requestedX of [90, 104, 118, 132, 780]) {
    const slot = findWorkTextSlot({
      layout: { rects: [], nextY: 208 }, requestedX, requestedY: 208,
      width: 100, height: TEXT_LAYOUT.textHeight,
      diagramActive: true, sequential: true, runtimeOwnsX: true,
    });
    check(`live/save/replay continuation placement from requested x=${requestedX}`, () => {
      assert.deepEqual(slot, tailSlot);
      assert.equal(slot?.y, savedPieces[1]!.params[1]);
    });
  }
  if (failures.length) {
    failures.forEach((failure) => console.error(failure));
    throw new Error(`verify-w1-wrap-order: ${failures.length}/${checks} failed`);
  }
  console.log(`verify-w1-wrap-order: ${checks} checks passed`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
