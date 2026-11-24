/** Native executor/Konva evidence; browser pixel paint is a separate check. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import type { DrawCommand, VerifiedDiagram } from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";
import { commandInkStyle } from "../../../../packages/whiteboard/src/instruments";

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
async function observedInk(command: DrawCommand, trusted: boolean, durationScale: number) {
  const board = mountTestWhiteboard(), clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const pump = setInterval(() => { clock.advance(1000 / 60); clock.pump(); }, 1);
  try {
    const whiteboardRef = ref<WhiteboardHandle | null>(board), cancelRef = ref(false), fbdPhaseStartedRef = ref(false);
    const layout = hook<LayoutModule>(path.join(hooksDir, "useBoardLayout.ts")).useBoardLayout({
      whiteboardRef, cancelRef, fbdPhaseStartedRef, liveQuestionRef: ref("Draw a verified line.") });
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
  const line: DrawCommand = { type: "DRAW_LINE", params: [450, 200, 650, 300], charPosition: 0, narrationBefore: "",
    visualStyle: { scientificPalette: "teal" }, semanticRef: { entityId: "line", primitiveId: "native_line" } };
  const instant = await observedInk(structuredClone(line), true, 0);
  const paced = await observedInk(structuredClone(line), true, 1);
  const settings = { markerColor: "#000000", pencilColor: "#0b4a48", markerThickness: 1, pencilThickness: 1 };
  const expected = commandInkStyle("pencil", settings, settings).color;
  assert(instant.some(node => node.stroke === expected), "actual native board geometry applies the sampled engine color through pencil rendering");
  assert(paced.some(node => node.stroke === expected), "paced lecture retains the same palette as seek/restore");
  assert.deepEqual(await observedInk(structuredClone(line), false, 0), [], "a palette cannot authorize untrusted geometry");
  console.log("scientific style ink: real executor/Konva geometry uses fixed palette in paced and seek paths; ownership preserved");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
