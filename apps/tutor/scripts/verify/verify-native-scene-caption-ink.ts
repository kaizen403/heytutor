import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { compileGeneratedSceneGuide } from "@heytutor/scene-engine";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { getSegmentCommands, parseStoredSegmentCommands, serializeSegmentCommands, type DrawCommand, type VerifiedDiagram } from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { selectProductionNativeSourceRepresentation } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { deriveNativeSceneStaging } from "../../lib/scene/nativeSceneStaging";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

globalThis.fetch = async () => { throw new Error("Native caption verification forbids network"); };
const fixtures = JSON.parse(readFileSync(new URL("../../../../packages/scene-engine/scripts/verify/fixtures/native-source-lecture.json", import.meta.url), "utf8")) as
  Array<{ name: string; question: string; turnPlan: TurnPlanV3; problemIR: unknown }>;
const fixture = fixtures.find(row => row.name.includes("hydrogen"))!;
assert(fixture);
const { question, turnPlan } = fixture;
const guide = compileGeneratedSceneGuide({ question, turnPlan });
assert(guide.ok && guide.guide.caption, "the engine must independently place the source caption");
const native = selectProductionNativeSourceRepresentation(question, turnPlan, null);
assert(native);
const original = structuredClone({ document: native.sceneDocument, render: native.renderScene });
const presentation = buildVerifiedDiagramPresentation(native.sceneDocument, native.renderScene, { originalQuestion: question, turnPlan });
for (const row of guide.guide.caption.board.lines) {
  const expected: number[] = [row.glyphOrigin.x, row.glyphOrigin.y, guide.guide.caption.fontPx];
  const command = presentation.diagram.commands.find(command => command.type === "LABEL" && command.text === row.text);
  assert(command, "the engine-owned caption must be actual diagram ink, not metadata only");
  assert.deepEqual(command.params, expected, "caption origin and font must exactly match the fresh engine layout");
  assert(presentation.introSegments.some(segment => getSegmentCommands(segment).some(command => command.text === row.text)),
    "a setup caption must appear in the actual narrated reveal commands");
}
assert.deepEqual({ document: native.sceneDocument, render: native.renderScene }, original, "caption ink cannot change scientific source or geometry");
const captionText = new Set(guide.guide.caption.board.lines.map(row => row.text));
const captionCommands = presentation.diagram.commands.filter(command => command.type === "LABEL" && captionText.has(command.text ?? ""));
assert(captionCommands.every(command => command.semanticRef?.entityId === "native_scene_caption"));
const staged = deriveNativeSceneStaging(native.sceneDocument, question, turnPlan, null, native.renderScene);
assert(staged.matched && staged.caption);
assert.deepEqual(staged.caption, guide.guide.caption, "only the complete engine descriptor crosses source reconstruction");
const forgedDocument = structuredClone(native.sceneDocument);
forgedDocument.source.nativeCaption = { text: "Unproved answer = 999", board: { lines: [{ text: "Unproved answer = 999", glyphOrigin: { x: 1, y: 1 } }] } };
const forgedStamp = buildVerifiedDiagramPresentation(forgedDocument, native.renderScene, { originalQuestion: question, turnPlan });
assert(!forgedStamp.diagram.commands.some(command => command.text?.includes("999")), "source stamps cannot choose caption ink");
assert(captionText.size > 0 && forgedStamp.diagram.commands.some(command => captionText.has(command.text ?? "")));
const forgedRender = structuredClone(native.renderScene);
forgedRender.primitives.find(primitive => primitive.points.length)!.points[0]!.x += 123;
assert.equal(deriveNativeSceneStaging(native.sceneDocument, question, turnPlan, null, forgedRender).caption, undefined,
  "a stale or forged active render cannot borrow an independently proved caption");
assert(!buildVerifiedDiagramPresentation(native.sceneDocument, forgedRender, { originalQuestion: question, turnPlan }).diagram.commands
  .some(command => captionText.has(command.text ?? "")));
assert(!buildVerifiedDiagramPresentation(native.sceneDocument, native.renderScene, { originalQuestion: "A different source.", turnPlan }).diagram.commands
  .some(command => captionText.has(command.text ?? "")), "a different question cannot reuse the caption descriptor");
assert(!buildVerifiedDiagramPresentation(native.sceneDocument, native.renderScene, { originalQuestion: question, turnPlan, layout: "code_lesson" }).diagram.commands
  .some(command => captionText.has(command.text ?? "")), "DSA and code-lesson caption behavior stays unchanged");

const hooksDir = fileURLToPath(new URL("../../features/tutor-session/hooks/", import.meta.url));
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const ref = <T>(current: T) => ({ current });
const react = { useRef: ref, useCallback: <T>(fn: T) => fn, useMemo: <T>(fn: () => T) => fn(),
  useEffect() {}, useLayoutEffect() {}, useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (value: unknown) => [typeof value === "function" ? value() : value, () => {}] };
const modules = new Map<string, unknown>();
function hook<T>(file: string): T {
  if (modules.has(file)) return modules.get(file) as T;
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  modules.set(file, mod.exports);
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return react;
    if (specifier.startsWith("@/")) return requireApp(path.resolve(appRoot, specifier.slice(2)));
    if (specifier.startsWith(".")) {
      const target = path.resolve(path.dirname(file), specifier);
      return target.startsWith(hooksDir) ? hook(`${target}.ts`) : requireApp(target);
    }
    return requireApp(specifier);
  }, mod, mod.exports);
  return mod.exports as T;
}
type ExecutorModule = typeof import("../../features/tutor-session/hooks/useCommandExecution");
type LayoutModule = typeof import("../../features/tutor-session/hooks/useBoardLayout");
async function observedInk(command: DrawCommand, trusted: boolean, durationScale: number, cancelled = false) {
  const board = mountTestWhiteboard(), clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const pump = setInterval(() => { clock.advance(1000 / 60); clock.pump(); }, 1);
  try {
    const whiteboardRef = ref<WhiteboardHandle | null>(board), cancelRef = ref(cancelled), fbdPhaseStartedRef = ref(false);
    const layout = hook<LayoutModule>(path.join(hooksDir, "useBoardLayout.ts")).useBoardLayout({
      whiteboardRef, cancelRef, fbdPhaseStartedRef, liveQuestionRef: ref("Read the source-proved caption.") });
    const execute = hook<ExecutorModule>(path.join(hooksDir, "useCommandExecution.ts")).useCommandExecution({
      whiteboardRef, cancelRef, speedRef: ref(1), adaptiveFactorRef: ref(1), inkPaceRef: ref("scene"),
      boardLayoutRef: layout.boardLayoutRef, forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef,
      fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef, activeVerifiedDiagramRef: ref<VerifiedDiagram | null>({
        id: "verified_scene", name: "source", commands: [command], anchors: [], reveals: [], promptAddon: "" }),
      turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
      forgetErasedTextRects: layout.forgetErasedTextRects, resetBoardLayout: layout.resetBoardLayout,
      resolveTextPlacement: layout.resolveTextPlacement, raceWithCancel: async <T>(promise: Promise<T>) => promise,
      cancellableDelay: async duration => { const end = clock.now() + duration; while (clock.now() < end) await clock.waitForAdvance(); },
      nowMs: clock.now }).executeCommand;
    await execute(command, { trustedDiagramGeometry: trusted, applyLayout: false, durationScale, inkPace: "scene" });
    return board.getDrawLayer()!.getChildren().map(node => node.toObject().attrs);
  } finally { clearInterval(pump); unmountTestWhiteboard(board); }
}
async function main() {
  assert(native);
  const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: native.sceneDocument, visualStatus: "validated",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, problemIR: null, solverResult: null,
      representationTier: native.tier, nonMetric: native.nonMetric, figureSource: "native_source", candidates: [], diagramResultStatus: "ready" },
    segments: presentation.introSegments.map((segment, orderIndex) => ({ orderIndex, narration: segment.narration,
      spokenText: segment.narration, command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }) })),
  });
  assert(saved.ok, !saved.ok ? saved.error : "");
  const savedCaptions = saved.value.segments.flatMap(segment => parseStoredSegmentCommands(segment.command))
    .filter(command => command.type === "LABEL" && captionText.has(command.text ?? ""));
  assert.deepEqual(savedCaptions.map(command => ({ params: command.params, text: command.text, semanticRef: command.semanticRef })),
    captionCommands.map(command => ({ params: command.params, text: command.text, semanticRef: command.semanticRef })),
    "server save rebuilds the same trusted caption rows instead of trusting submitted commands");
  const reopened = restoreVerifiedPresentationFromTurn({ question, sceneDocument: saved.value.sceneDocument, sceneArtifacts: saved.value.sceneArtifacts });
  assert(reopened);
  assert.deepEqual(reopened.diagram.commands, presentation.diagram.commands, "source read/reopen reconstructs caption and scientific ink together");
  const actualCaption = getSegmentCommands(presentation.introSegments.find(segment => getSegmentCommands(segment)
    .some(command => captionText.has(command.text ?? "")))!)[0]!;
  const paced = await observedInk(structuredClone(actualCaption), true, 1);
  const instant = await observedInk(structuredClone(actualCaption), true, 0);
  assert(paced.length > 0 && paced.some(node => node.data || node.text), "the actual executor must create native Konva caption glyphs");
  assert.deepEqual(instant, paced, "seek renders the same caption glyph paths and style as paced lecture execution");
  assert.deepEqual(await observedInk(structuredClone(actualCaption), false, 0), [], "caption text cannot authorize untrusted diagram ink");
  assert.deepEqual(await observedInk(structuredClone(actualCaption), true, 0, true), [], "cancelled turns cannot write a caption");
  console.log("native caption ink: fresh descriptor, actual setup LABELs, source/render forgery refusal, save/read/reopen, native Konva paced/seek and cancellation pass; no network or browser pixel claim");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
