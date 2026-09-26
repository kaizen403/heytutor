import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  captureCommandInk,
  inheritCommandInk,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
} from "../../../../packages/drawing/src/protocol/drawingProtocol";
import { commandInkStyle } from "../../../../packages/whiteboard/src/instruments";

const command = (text: string): DrawCommand => ({
  type: "WRITE",
  params: [30, 80],
  text,
  charPosition: 0,
  narrationBefore: "",
});

const first = captureCommandInk(command("before"), {
  markerColor: "#123456",
  pencilColor: "#654321",
  markerThickness: 0.6,
  pencilThickness: 0.8,
});
const second = captureCommandInk(command("after"), {
  markerColor: "#c53248",
  pencilColor: "#48a65a",
  markerThickness: 1.6,
  pencilThickness: 1.4,
});
const stored = JSON.parse(JSON.stringify(serializeSegmentCommands([first, second])));
const [restoredFirst, restoredSecond] = parseStoredSegmentCommands(stored);
const current = {
  markerColor: "#000000",
  pencilColor: "#ffffff",
  markerThickness: 1,
  pencilThickness: 1,
};
captureCommandInk(restoredFirst!, current);

assert.deepEqual(restoredFirst?.inkSettings, first.inkSettings, "first stroke keeps its draw-time settings");
assert.deepEqual(restoredSecond?.inkSettings, second.inkSettings, "later stroke keeps its own settings");
assert.deepEqual(
  commandInkStyle("pen", current, restoredFirst?.inkSettings),
  { color: "#123456", widthScale: 0.6, opacity: 1 },
  "rewind/export uses the first stroke's recorded marker color and thickness",
);
assert.deepEqual(
  commandInkStyle("pen", current, restoredSecond?.inkSettings),
  { color: "#c53248", widthScale: 1.6, opacity: 1 },
  "a settings change during the lecture applies only to later strokes",
);
assert.equal(
  commandInkStyle("pencil", current, restoredFirst?.inkSettings).widthScale,
  0.82 * 0.8,
  "pencil thickness is also recorded",
);
assert.notEqual(
  commandInkStyle("pencil", current, restoredFirst?.inkSettings).color,
  commandInkStyle("pencil", current, undefined).color,
  "pencil color does not follow the current settings",
);
assert.equal(
  commandInkStyle("pen", current, undefined).color,
  current.markerColor,
  "older records without ink metadata still render",
);

for (const type of ["FOCUS", "ANNOTATE", "FRAME"] as const) {
  const parent = captureCommandInk({ ...command(type), type }, first.inkSettings!);
  const [restored] = parseStoredSegmentCommands(JSON.parse(JSON.stringify(serializeSegmentCommands([parent]))));
  const generatedChild = inheritCommandInk(restored!, command(`${type} child`));
  captureCommandInk(generatedChild, current);
  assert.deepEqual(generatedChild.inkSettings, first.inkSettings, `${type} child keeps the persisted parent ink on replay`);
  assert.equal(commandInkStyle("pen", current, generatedChild.inkSettings).color, "#123456");
}

const execution = readFileSync(new URL("../../features/tutor-session/hooks/useCommandExecution.ts", import.meta.url), "utf8");
const board = readFileSync(new URL("../../../../packages/whiteboard/src/Whiteboard.tsx", import.meta.url), "utf8");
const replay = readFileSync(new URL("../../features/tutor-session/hooks/useReplay.ts", import.meta.url), "utf8");
assert.match(execution, /captureCommandInk\(rawCommand, wb\.getInkSettings\(\)\)/, "live execution records ink before persistence");
assert.match(execution, /wb\.writeText\([^\n]+inkSettings\)/, "replay supplies recorded ink to handwriting");
assert.match(execution, /wb\.drawShape\(path, duration, \{\s*inkSettings/, "replay supplies recorded ink to figures");
assert.match(execution, /wb\.drawAnnotation\(kind, path, duration, \{[^}]*inkSettings/s, "replay supplies recorded ink to annotations");
assert.match(board, /styleForCommand\(inkSettings\)/, "handwriting uses recorded ink, including fallback text");
assert.match(board, /styleForCommand\(options\?\.inkSettings\)/, "figure strokes use recorded ink");
assert.match(board, /styleForCommand\(options\.inkSettings\)/, "annotations use recorded ink");
const frameBranch = execution.split('case "FRAME":')[1]?.split('case "FOCUS":')[0] ?? "";
const focusBranch = execution.split('case "FOCUS":')[1]?.split('case "EMPHASIZE":')[0] ?? "";
const annotateBranch = execution.split('case "ANNOTATE":')[1]?.split('case "UNDERLINE":')[0] ?? "";
assert.equal((frameBranch.match(/inheritCommandInk\(command,/g) ?? []).length, 2, "live and seek FRAME children inherit ink");
assert.ok(/if \(durationScale <= 0\.05\) \{\s*const frame = frames\.advance\(\)/.test(frameBranch), "seek advances each FRAME so the final frame uses its own saved ink");
assert.equal((focusBranch.match(/inheritCommandInk\(command,/g) ?? []).length, 2, "scheduled and ordinary FOCUS children inherit ink");
assert.equal((annotateBranch.match(/inheritCommandInk\(command,/g) ?? []).length, 1, "ANNOTATE children inherit ink");
assert.doesNotMatch(replay, /command\.type === "PAUSE" \|\| command\.type === "FOCUS"/, "seek must release permanent FOCUS children");
assert.match(focusBranch, /if \(isSeekCatchUp\) break;/, "seek skips transient FOCUS gestures after releasing permanent ink");

console.log("verify-replay-ink: draw-time ink survives save, rewind, restore, and export");
