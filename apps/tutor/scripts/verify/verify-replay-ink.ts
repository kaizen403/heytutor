import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
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

const executionPath = fileURLToPath(new URL("../../features/tutor-session/hooks/useCommandExecution.ts", import.meta.url));
const execution = readFileSync(process.env.REPLAY_INK_TEST_SOURCE ?? executionPath, "utf8");
const board = readFileSync(new URL("../../../../packages/whiteboard/src/Whiteboard.tsx", import.meta.url), "utf8");
const replay = readFileSync(new URL("../../features/tutor-session/hooks/useReplay.ts", import.meta.url), "utf8");
assert.match(execution, /captureCommandInk\(rawCommand, wb\.getInkSettings\(\)\)/, "live execution records ink before persistence");
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

async function verifyActualHandwritingForwarding() {
  const requireApp = createRequire(new URL("../../package.json", import.meta.url));
  const drawing = requireApp("@heytutor/drawing");
  const compiled = ts.transpileModule(execution, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const hookExports = { exports: {} as typeof import("../../features/tutor-session/hooks/useCommandExecution") };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return { useRef: (value: unknown) => ({ current: value }), useCallback: (fn: unknown) => fn };
    // Rendering is the boundary adapter. Glyph prefetch has no bearing on
    // recorded ink/observer forwarding, so do not launch background font work.
    if (specifier === "@heytutor/drawing") return { ...drawing, prefetchStrokePaths() {} };
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(executionPath), specifier) : specifier);
  }, hookExports, hookExports.exports);
  const calls: unknown[][] = [];
  const ref = <T,>(value: T) => ({ current: value });
  const wb = { getInkSettings: () => current, setAnimationSpeed() {}, flyCursorTo: async () => {},
    writeText: async (...args: unknown[]) => { calls.push(args); } };
  const executor = hookExports.exports.useCommandExecution({
    whiteboardRef: ref(wb), cancelRef: ref(false), activeVerifiedDiagramRef: ref(null),
    fbdPhaseStartedRef: ref(false), fbdPhaseMarkedRef: ref(false), boardLayoutRef: ref({ rects: [], nextY: 100 }),
    inkPaceRef: ref("follow"), speedRef: ref(1), adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: ref(false),
    turnTelemetryRef: ref(null), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""),
    raceWithCancel: async (job: Promise<unknown>) => job,
    resolveTextPlacement: async (_command: unknown, x: number, y: number) => ({ x, y }),
    cancellableDelay: async () => {}, forgetErasedTextRects() {}, resetBoardLayout() {},
  } as never);
  const observer = () => {};
  await executor.executeCommand(restoredFirst!, { durationScale: 0, onInkStarted: observer, textPlacementReserved: true });
  const write = calls.at(-1)!;
  assert.equal(write[0], "before");
  assert.deepEqual(write[7], first.inkSettings, "actual replay handwriting receives its recorded ink even after current settings change");
  assert.equal(write[8], observer, "actual executor forwards the shown-ink observer in its own argument slot");
  assert.equal(write[9], undefined, "ordinary replay rows carry no special lettering budget");
  assert.equal(typeof write[6], "function", "the cancellation predicate remains between typography and ink");

  const label: DrawCommand = { ...restoredFirst!, type: "LABEL", text: "A", params: [700, 200, 24] };
  await executor.executeCommand(label, { trustedDiagramGeometry: true, inkPace: "scene" });
  const ordinary = calls.at(-1)!;
  await executor.executeCommand(label, { durationScale: 0, trustedDiagramGeometry: true, finishVerifiedDiagramIntro: true,
    inkPace: "scene", onInkStarted: observer });
  const finished = calls.at(-1)!;
  assert.equal(finished[3], 0, "completed intro labels are instantaneous");
  assert.equal(finished[9], ordinary[3], "instant intro completion still uses ordinary label lettering style");
  assert(typeof finished[9] === "number" && finished[9] > 0);
  assert.deepEqual(finished[7], first.inkSettings);
  assert.equal(finished[8], observer, "adding the lettering budget cannot shift the ink observer argument");
}
void verifyActualHandwritingForwarding().then(() => {
  console.log("verify-replay-ink: draw-time ink survives save, rewind, restore, and export; actual handwriting forwards ink, observer, and lettering budget");
}).catch((error) => { console.error(error); process.exitCode = 1; });
