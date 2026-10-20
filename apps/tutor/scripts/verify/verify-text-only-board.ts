/** Text-only ink uses the board, and absent targets never move its pen. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  BOARD_TYPE_SCALE, buildLessonSegments, getSegmentCommands, measureTextWidth,
  prepareVerifiedLessonSegments, serializeSegmentCommands, WORK_ZONE,
  type DrawCommand, type VerifiedDiagram,
} from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { drawReplayDiagramTimeline } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { workColumnMaxWidth } from "../../features/tutor-session/lib/board/boardLayout";

const app = fileURLToPath(new URL("../../", import.meta.url));
const hooks = path.join(app, "features/tutor-session/hooks");
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const ref = <T>(current: T) => ({ current });
const react = { useRef: ref, useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(),
  useEffect() {}, useLayoutEffect() {}, useState: (value: unknown) => [typeof value === "function" ? value() : value, () => {}],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() };
function load<T>(name: string): T {
  const file = path.join(hooks, `${name}.ts`);
  const sourceArg = process.argv.indexOf("--layout-source");
  const source = name === "useBoardLayout" && sourceArg >= 0 ? process.argv[sourceArg + 1]! : file;
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return react;
    if (specifier === "./useBoardViewport") return { useBoardViewport: () => ({ scale: 1, width: 1200, height: 700 }) };
    if (specifier.startsWith("@/")) return requireApp(path.join(app, specifier.slice(2)));
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
  }, loaded, loaded.exports);
  return loaded.exports as T;
}
type Layout = ReturnType<typeof import("../../features/tutor-session/hooks/useBoardLayout").useBoardLayout>;
type Executor = ReturnType<typeof import("../../features/tutor-session/hooks/useCommandExecution").useCommandExecution>;
type Session = ReturnType<typeof import("../../features/tutor-session/hooks/useBoardSession").useBoardSession>;
type Replay = ReturnType<typeof import("../../features/tutor-session/hooks/useReplay").useReplay>;
type FixtureHook<T> = Record<string, (params: Record<string, unknown>) => T>;
type Row = { text: string; x: number; y: number; size: number };
const command = (type: DrawCommand["type"], text: string): DrawCommand => ({ type, text, params: [90, 211], charPosition: 0, narrationBefore: "" });

function fixture() {
  const rows: Row[] = [], flights: number[][] = [], marks: string[] = [];
  const board = {
    setAnimationSpeed() {}, setCursorState() {}, setSpotlight() {}, cancelAnimations() {},
    clearBoard: async () => {}, eraseRegion: async () => {}, eraseWorkInk: async () => {},
    captureSnapshot: () => "", getInkSettings: () => ({ markerColor: "#111111", pencilColor: "#111111", markerThickness: 1, pencilThickness: 1 }),
    getDrawLayer: () => ({}),
    flyCursorTo: async (x: number, y: number) => { flights.push([x, y]); },
    writeText: async (text: string, x: number, y: number, _duration: number, _schedule: unknown, size: number) => { rows.push({ text, x, y, size }); },
    drawShape: async () => { marks.push("shape"); }, drawAnnotation: async () => { marks.push("annotation"); },
  } as unknown as WhiteboardHandle;
  const whiteboardRef = ref(board), cancelRef = ref(false), fbdPhaseStartedRef = ref(false);
  const activeVerifiedDiagramRef = ref<VerifiedDiagram | null>(null), liveQuestionRef = ref("Synthetic lesson");
  const layout = load<FixtureHook<Layout>>("useBoardLayout").useBoardLayout!({ whiteboardRef, cancelRef, fbdPhaseStartedRef, liveQuestionRef });
  const executor = load<FixtureHook<Executor>>("useCommandExecution").useCommandExecution!({
    whiteboardRef, cancelRef, fbdPhaseStartedRef, activeVerifiedDiagramRef,
    fbdPhaseMarkedRef: ref(false), speedRef: ref(1), adaptiveFactorRef: ref(1), inkPaceRef: ref("follow"),
    boardLayoutRef: layout.boardLayoutRef, forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef,
    notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef, turnTelemetryRef: ref(null),
    resolveTextPlacement: layout.resolveTextPlacement, forgetErasedTextRects: layout.forgetErasedTextRects,
    resetBoardLayout: layout.resetBoardLayout, raceWithCancel: async <T>(value: Promise<T>) => value, cancellableDelay: async () => {},
  });
  const session = load<FixtureHook<Session>>("useBoardSession").useBoardSession!({
    sessionId: "text-only-fixture", router: { push() {} }, phase: "idle", speedMultiplier: 1,
    whiteboardRef, cancelRef, activeVerifiedDiagramRef, fbdPhaseStartedRef,
    notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
    liveQuestionRef, captureNotesEpoch: () => true, ttsClientRef: ref(null), voicePreferencesRef: ref({}),
    speedRef: ref(1), stopTurnRef: ref(null), replayAudioRef: ref(null), replayAudioPreloadRef: ref(new Map()),
    setNarrationText() {}, setCurrentSegmentText() {}, resetBoardLayout: layout.resetBoardLayout,
    executeCommand: executor.executeCommand,
  });
  return { rows, flights, marks, board, whiteboardRef, cancelRef, fbdPhaseStartedRef, activeVerifiedDiagramRef, liveQuestionRef, layout, executor, session };
}

async function verify(raw: string, name: string, allPaths: boolean) {
  const f = fixture();
  const source = buildLessonSegments(raw);
  const prepared = prepareVerifiedLessonSegments(source, null).segments;
  assert(!prepared.flatMap(getSegmentCommands).some(c => ["FOCUS", "POINT", "ANNOTATE"].includes(c.type)), "absent figure targets do not enter live ink");
  const placed: DrawCommand[] = [];
  assert.equal(workColumnMaxWidth(f.layout.boardLayoutRef.current, false), WORK_ZONE.fullWidthTextWidth);
  const writes = prepared.flatMap(getSegmentCommands).filter(c => c.type === "WRITE");
  for (const input of writes) for (const output of await f.layout.reserveTextCommandPlacements(input)) {
    placed.push(output);
    await f.executor.executeCommand(output, { durationScale: 0, textPlacementReserved: true });
  }
  const live = f.rows.splice(0);
  assert.equal(live.map(row => row.text).join("").replace(/\s/g, ""), writes.map(c => c.text).join("").replace(/\s/g, ""), "full-width placement retains all recorded row symbols");
  assert(live.every(row => row.x === WORK_ZONE.marginX && row.x + measureTextWidth(row.text, row.size) <= 1200 - WORK_ZONE.marginX + 1), "all work stays inside the full board margins");
  f.layout.resetBoardLayout(false, false); f.fbdPhaseStartedRef.current = true;
  let narrowRows = 0;
  for (const input of writes) narrowRows += (await f.layout.reserveTextCommandPlacements(input)).length;
  f.fbdPhaseStartedRef.current = false; f.layout.resetBoardLayout(false, false);
  if (allPaths) {
    const turn: StoredTurn = { id: name, orderIndex: 0, status: "complete", kind: "lesson", question: "Synthetic lesson", rawResponse: "",
      speedMultiplier: 1, traceId: null, visualStatus: "text_only", sceneDocument: null, sceneArtifacts: null,
      sceneEngineVersion: null, validationReport: null,
      segments: placed.map((c, orderIndex) => ({ id: `s${orderIndex}`, orderIndex, narration: "The next relation.", spokenText: "The next relation.",
        command: serializeSegmentCommands([c]), audioUrl: null, durationMs: 1, timings: null })) };
    assert(await f.session.refreshBoardFromTurns("text-only-fixture", [turn], () => true));
    assert.equal(f.activeVerifiedDiagramRef.current, null);
    assert.equal(f.fbdPhaseStartedRef.current, false);
    assert.deepEqual(f.rows.splice(0), live, "real reopen preserves the full-width live row ink contract");
    const cues = buildReplayTimeline([turn]).cues;
    const replay = load<FixtureHook<Replay>>("useReplay").useReplay!({
      whiteboardRef: f.whiteboardRef, cancelRef: f.cancelRef, speedRef: ref(40), isPausedRef: ref(false), replayAudioRef: ref(null),
      replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()), storedTurnsRef: ref([turn]),
      activeVerifiedDiagramRef: f.activeVerifiedDiagramRef, fbdPhaseStartedRef: f.fbdPhaseStartedRef,
      replayGenerationRef: ref(1), replayCueRef: ref(null), ttsClientRef: ref(null),
      notesEpochsRef: f.layout.notesEpochsRef, narrationSinceEpochRef: f.layout.narrationSinceEpochRef, liveQuestionRef: f.liveQuestionRef,
      phaseRef: ref("idle"), isReplaying: false, isPaused: false, isDownloading: false, replayProgressMs: 0,
      boards: [], sessionId: "text-only-fixture", setPhase() {}, setCurrentSegmentText() {}, setNarrationText() {}, setIsPaused() {},
      setIsReplaying() {}, setReplayProgressMs() {}, setReplayTotalMs() {}, setSettings() {}, setIsDownloading() {},
      cancellableDelay: async () => {}, raceWithCancel: async <T>(promise: Promise<T>) => promise,
      executeCommandWithCancel: f.executor.executeCommandWithCancel, executeCommand: f.executor.executeCommand,
      resetBoardLayout: f.layout.resetBoardLayout, finishLectureUi() {}, pauseTurn() {}, resumeTurn() {},
    });
    await replay.renderBoardAtTime(Number.MAX_SAFE_INTEGER, cues, 1);
    assert.deepEqual(f.rows.splice(0), live, "actual replay seek keeps the same rows, positions and font sizes");
    f.layout.resetBoardLayout(false, false);
    await drawReplayDiagramTimeline({ cues,
      executeCommand: (c, options) => f.executor.executeCommand(c, { ...options, durationScale: 0 }),
      getClockMs: () => Number.MAX_SAFE_INTEGER, waitForAdvance: async () => {}, shouldCancel: () => false,
      getTurn: () => turn, getDiagram: () => null,
    });
    assert.deepEqual(f.rows.splice(0), live, "player/export's actual shared timeline keeps full-width row presentation");
    const flights = f.flights.length, marks = f.marks.length;
    for (const c of [command("FOCUS", "absent"), command("POINT", "absent"), command("ANNOTATE", "absent")])
      await f.executor.executeCommand(c, { durationScale: 0 });
    assert.equal(f.flights.length, flights, "no absent figure target flies the pen into the empty area");
    assert.equal(f.marks.length, marks, "no absent figure target adds a mark");
    await f.executor.executeCommand(command("EMPHASIZE", "last"), { durationScale: 0 });
    assert(f.marks.length > marks, "a visible work row can still be emphasized without a figure");
  }
  return { sourceRows: writes.length, liveRows: live.length, counterfactualNarrowRows: narrowRows,
    width: WORK_ZONE.fullWidthTextWidth, sizes: [...new Set(live.map(row => row.size))], allPaths };
}

async function main() {
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("text-only board gate forbids network/provider calls"); };
  const raw = "[STEP]The pressure difference equals the flow times the resistance.[WRITE:pressure difference = volume flow times hydraulic resistance,90,211][/STEP]";
  const control = await verify(raw, "synthetic", true);
  assert.equal(control.liveRows, 1, "a row that fits the full board is not prewrapped into the empty left column");
  assert(control.counterfactualNarrowRows > control.liveRows, "the figure-present negative control really occupies a narrower column");
  assert.deepEqual(control.sizes, [BOARD_TYPE_SCALE.work]);
  const malformed = prepareVerifiedLessonSegments(buildLessonSegments("[STEP]The relation holds.[FOCUS:missing][WRITE:p = q r,90,211][/STEP]"), null);
  assert.equal(malformed.blockedCommandCount, 1);
  assert(malformed.segments.some(segment => segment.narration.includes("The relation holds")), "rejecting a dead gesture preserves useful speech");
  const recorded = process.argv.indexOf("--recorded"), report = process.argv.indexOf("--report");
  const results: unknown[] = [];
  if (recorded >= 0) for (const file of readdirSync(process.argv[recorded + 1]!).filter(file => file.endsWith(".json")).sort()) {
    const bytes = readFileSync(path.join(process.argv[recorded + 1]!, file));
    const run = JSON.parse(bytes.toString());
    if (run.diagram?.committed !== false || typeof run.teaching?.rawText !== "string") continue;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    results.push({ sha256, ...await verify(run.teaching.rawText, sha256.slice(0, 12), true) });
  }
  if (recorded >= 0) assert(results.length > 0, "recorded mode must actually exercise nonempty text-only lesson records");
  assert.equal(networkCalls, 0);
  if (report >= 0) {
    const reportPath = process.argv[report + 1]!;
    writeFileSync(reportPath, JSON.stringify({ control, recorded: results, limits: "Real hooks and shared timeline with synchronous board-method spies; no browser, pixels, audio or MP4 encoding." }, null, 2) + "\n", { mode: 0o600 });
    chmodSync(reportPath, 0o600);
  }
  console.log(JSON.stringify({ synthetic: control, recordedLessons: results.length, providers: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
