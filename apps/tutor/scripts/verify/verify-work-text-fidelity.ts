/** Captured work ink must survive server canonicalization and real reopen. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import {
  BOARD_TYPE_SCALE, fitWorkTextCommand, getSegmentCommands, isStoredCommandTrustedGeometry, measureTextWidth, parseStoredSegmentCommands,
  serializeSegmentCommands, verifiedDiagramCommandToDrawCommand,
  type DrawCommand, type VerifiedDiagram,
} from "@heytutor/drawing";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { withBoardEpochSegment } from "../../lib/boards/boardsClient";
import { boardContinuationArtifacts, pageTurnsEndingAt, storedTurnContinuesBoard } from "../../lib/boards/boardContinuation";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { drawReplayDiagramTimeline } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { resetReplayPageAtTurn } from "../../features/tutor-session/lib/replay/replayPageBoundary";
import { workColumnMaxWidth } from "../../features/tutor-session/lib/board/boardLayout";
import { TEXT_LAYOUT } from "../../features/tutor-session/constants";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

const hooksDir = fileURLToPath(new URL("../../features/tutor-session/hooks/", import.meta.url));
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const ref = <T>(current: T) => ({ current });
const react = {
  useRef: ref, useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(),
  useEffect: () => {}, useLayoutEffect: () => {},
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (value: unknown) => [typeof value === "function" ? value() : value, () => {}],
};
// Only React reconciliation/paint are simulated. The hooks and native ink are real.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HookResult = Record<string, any>;
const modules = new Map<string, HookResult>();
function hook(file: string): HookResult {
  if (modules.has(file)) return modules.get(file)!;
  const source = file === path.join(hooksDir, "useCommandExecution.ts") ? process.env.WORK_TEXT_EXECUTION_SOURCE ?? file
    : file === path.join(hooksDir, "useBoardSession.ts") ? process.env.WORK_TEXT_RESTORE_SOURCE ?? file
    : file === path.join(appRoot, "lib/scene/turnScenePersistence.ts") ? process.env.WORK_TEXT_PERSISTENCE_SOURCE ?? file : file;
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as HookResult };
  modules.set(file, mod.exports);
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return react;
    if (specifier.startsWith("@/")) return requireApp(path.resolve(appRoot, specifier.slice(2)));
    if (specifier.startsWith(".")) {
      const target = path.resolve(path.dirname(file), specifier);
      return target.startsWith(hooksDir) ? hook(target + ".ts") : requireApp(target);
    }
    return requireApp(specifier);
  }, mod, mod.exports);
  return mod.exports;
}
const canonicalize = process.env.WORK_TEXT_PERSISTENCE_SOURCE
  ? hook(path.join(appRoot, "lib/scene/turnScenePersistence.ts")).canonicalizeTurnSceneMetadata as typeof canonicalizeTurnSceneMetadata
  : canonicalizeTurnSceneMetadata;

function scene(question: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-grounded span" },
    source: { question, nonMetric: true, representationTier: "qualitative_verified" }, quantities: [],
    entities: [{ id: "a", kind: "point", role: "start" }, { id: "b", kind: "point", role: "end" }, { id: "edge", kind: "segment", role: "span" }],
    constructions: [
      { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "make_b", operator: "point", inputs: { x: 4, y: 0 }, outputs: ["b"] },
      { id: "make_edge", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["edge"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["a", "b", "edge"],
    revealGroups: [{ id: "setup", entityIds: ["a", "b", "edge"], dependsOn: [], narrationCue: "Here is the span." }], teachingTimeline: [],
  };
}

function ink(board: WhiteboardHandle): string[] {
  const layer = board.getDrawLayer();
  assert(layer);
  return layer.getChildren().map((node) => {
    const object = node.toObject();
    const attrs = Object.fromEntries(Object.entries(object.attrs).filter(([key, value]) =>
      !key.startsWith("ht") && key !== "id" && !(key === "dash" && Array.isArray(value) && value.length === 0),
    ).sort(([a], [b]) => a.localeCompare(b)));
    return JSON.stringify({ className: object.className, attrs });
  }).sort();
}

interface WrittenRow { text: string; x: number; y: number; fontSize: number | undefined }
interface Page { figure: boolean; rows: "simple" | "wrapped" | "overflow" | "reduced"; continuation?: "resume" | "doubt"; historicalOversize?: boolean; unsafeSize?: number; unsafeY?: number }

async function scenario(name: string, pages: Page[]): Promise<void> {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const pump = setInterval(() => { clock.advance(1000); clock.pump(); }, 1);
  const rows: WrittenRow[] = [];
  const nativeWrite = board.writeText.bind(board);
  board.writeText = ((text, x, y, duration, schedule, fontSize, ...rest) => {
    if (x < 400) rows.push({ text, x, y, fontSize });
    return nativeWrite(text, x, y, duration, schedule, fontSize, ...rest);
  }) as typeof board.writeText;
  const whiteboardRef = ref(board);
  const cancelRef = ref(false);
  const activeVerifiedDiagramRef = ref<VerifiedDiagram | null>(null);
  const fbdPhaseStartedRef = ref(false);
  const liveQuestionRef = ref("");
  const layout = hook(path.join(hooksDir, "useBoardLayout.ts")).useBoardLayout({ whiteboardRef, cancelRef, fbdPhaseStartedRef, liveQuestionRef });
  const executor = hook(path.join(hooksDir, "useCommandExecution.ts")).useCommandExecution({
    whiteboardRef, cancelRef, speedRef: ref(1), boardLayoutRef: layout.boardLayoutRef,
    forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef, fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef,
    activeVerifiedDiagramRef, turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef,
    narrationSinceEpochRef: layout.narrationSinceEpochRef, cancellableDelay: async () => {},
    forgetErasedTextRects: layout.forgetErasedTextRects, resetBoardLayout: layout.resetBoardLayout,
    resolveTextPlacement: layout.resolveTextPlacement, raceWithCancel: async <T>(value: Promise<T>) => value,
    inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1), nowMs: clock.source.now,
  });
  const execute = executor.executeCommand as (command: DrawCommand, options: Record<string, unknown>) => Promise<void>;
  const session = hook(path.join(hooksDir, "useBoardSession.ts")).useBoardSession({
    sessionId: "work-fidelity", router: { push() {} }, phase: "idle", speedMultiplier: 1,
    whiteboardRef, cancelRef, activeVerifiedDiagramRef, fbdPhaseStartedRef,
    notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
    liveQuestionRef, captureNotesEpoch: () => true, ttsClientRef: ref(null), voicePreferencesRef: ref({}),
    speedRef: ref(1), stopTurnRef: ref(null), replayAudioRef: ref(null), replayAudioPreloadRef: ref(new Map()),
    setNarrationText() {}, setCurrentSegmentText() {}, resetBoardLayout: layout.resetBoardLayout, executeCommand: execute,
  });
  const savedTurns: StoredTurn[] = [];
  let question = "";
  let document: SceneDocument | null = null;
  let livePageRows: WrittenRow[] = [];
  const liveHistoryRows: WrittenRow[] = [];
  let lastLiveInk: string[] = [];
  try {
    for (const [pageIndex, page] of pages.entries()) {
      rows.length = 0;
      if (!page.continuation) {
        question = "Show a horizontal span and its working, page " + pageIndex + ".";
        liveQuestionRef.current = question;
        document = page.figure ? scene(question) : null;
        await board.clearBoard();
        layout.resetBoardLayout(false, false);
        activeVerifiedDiagramRef.current = null;
        fbdPhaseStartedRef.current = page.figure;
        livePageRows = [];
      }
      const compiled = document ? compileSceneDocument(document) : null;
      assert(!compiled || (compiled.ok && compiled.renderScene));
      const presentation = document && compiled?.renderScene ? buildVerifiedDiagramPresentation(document, compiled.renderScene) : null;
      if (presentation && !page.continuation) {
        activeVerifiedDiagramRef.current = presentation.diagram;
        for (const command of presentation.diagram.commands) await execute(verifiedDiagramCommandToDrawCommand(command), { durationScale: 0, trustedDiagramGeometry: true, applyLayout: false });
      }
      const width = workColumnMaxWidth(layout.boardLayoutRef.current, fbdPhaseStartedRef.current);
      const tokenForSize = (size: number, larger: number) => {
        for (let count = 1; count < 1000; count++) {
          const token = "W".repeat(count);
          if (measureTextWidth(token, larger) > width && measureTextWidth(token, size) <= width) return token;
        }
        throw new Error("Unable to construct a scale-boundary token");
      };
      const texts = page.rows === "overflow" ? Array.from({ length: 16 }, (_, i) => "x_" + i + " = " + i)
        : page.rows === "wrapped" ? ["a = 2", "a + b + c + d + e + f + g + h = total; substitute and evaluate the complete sum", "result = 12"]
        : page.rows === "reduced" ? [tokenForSize(BOARD_TYPE_SCALE.label, BOARD_TYPE_SCALE.workNarrow), tokenForSize(BOARD_TYPE_SCALE.annotation, BOARD_TYPE_SCALE.label), "W".repeat(80)]
        : ["a = 2", "b = -1", "a + b = 1"];
      const placed: DrawCommand[] = [];
      for (const text of texts) {
        const raw: DrawCommand = { type: "WRITE", params: [720, 440, 72], text, charPosition: 0, narrationBefore: "The next row." };
        const reserved = await layout.reserveTextCommandPlacements(raw) as DrawCommand[];
        for (const command of reserved) {
          placed.push(command);
          await execute(command, { durationScale: 0, textPlacementReserved: true });
        }
      }
      assert(placed.every((command) => command.params[2] !== 72), "raw model size must remain discarded by live reservation");
      const currentLiveRows = rows.splice(0);
      livePageRows.push(...currentLiveRows);
      liveHistoryRows.push(...currentLiveRows);
      const liveInk = ink(board);
      lastLiveInk = liveInk;
      const intro = page.continuation ? [] : presentation?.introSegments ?? [];
      const recorded = [
        ...intro.map((segment) => ({ narration: segment.narration, spokenText: segment.narration, command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }) })),
        ...placed.map((command) => ({ narration: "The next row.", spokenText: "The next row.", command: serializeSegmentCommands([
          page.unsafeSize === undefined ? command : { ...command, params: [720, page.unsafeY ?? -500, page.unsafeSize] },
        ]) })),
      ].map((segment, orderIndex) => ({ ...segment, orderIndex, audioBytes: null, durationMs: 0, timings: null }));
      const payload = page.continuation ? recorded : withBoardEpochSegment(recorded);
      const save = await canonicalize({
        question, sceneDocument: document, visualStatus: document ? "validated" : "text_only",
        sceneArtifacts: document ? {
          schemaVersion: "scene-artifacts/v3", representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready",
          turnPlan: { schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" },
          ...(page.continuation ? boardContinuationArtifacts(question) : {}),
        } : undefined,
        segments: payload.map((segment) => ({ ...segment, durationMs: segment.durationMs ?? undefined })),
      });
      assert(save.ok, save.ok ? "" : save.error);
      const canonicalWrites = save.value.segments.flatMap((segment) => parseStoredSegmentCommands(segment.command)).filter((command) => command.type === "WRITE");
      const turn: StoredTurn = {
        ...save.value, id: name + "-" + pageIndex, orderIndex: pageIndex, status: "complete", kind: page.continuation ?? "lesson", question, rawResponse: "", speedMultiplier: 1, traceId: null,
        segments: save.value.segments.map((segment) => ({ ...segment, id: "s" + segment.orderIndex, audioUrl: null, durationMs: null, timings: null,
          command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command), { trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command) }),
        })),
      };
      if (page.historicalOversize) {
        for (const segment of turn.segments) {
          const commands = parseStoredSegmentCommands(segment.command).map((command) => command.type === "WRITE"
            ? { ...command, params: [command.params[0]!, command.params[1]!, BOARD_TYPE_SCALE.work] } : command);
          segment.command = serializeSegmentCommands(commands, { trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command) });
        }
      }
      savedTurns.push(JSON.parse(JSON.stringify(turn)));
      assert(await session.refreshBoardFromTurns("work-fidelity", savedTurns, () => true));
      const reopenedRows = rows.splice(0);
      const reopenedInk = ink(board);
      console.log(JSON.stringify({ name, pageIndex, continuation: page.continuation, liveRows: livePageRows.length, reopenedRows: reopenedRows.length, firstLive: currentLiveRows[0], firstSaved: canonicalWrites[0]?.params, firstReopened: reopenedRows[0], liveNodes: liveInk.length, reopenedNodes: reopenedInk.length }));
      assert.deepEqual(reopenedRows, liveHistoryRows, name + ": real reopened row text/position/font matches live history");
      assert.deepEqual(reopenedInk, liveInk, name + ": permanent work and scene native paths survive save/reload/reopen");
      if (page.unsafeSize === undefined) {
        assert.deepEqual(canonicalWrites.map((command) => ({ text: command.text ?? "", x: command.params[0], y: command.params[1], fontSize: command.params[2] })), currentLiveRows, name + ": server preserves bounded captured row presentation");
      } else {
        const safeY = Math.min(Math.max(page.unsafeY ?? -500, TEXT_LAYOUT.topY), TEXT_LAYOUT.bottomY - TEXT_LAYOUT.textHeight);
        assert(canonicalWrites.every((command) => command.params[0] === TEXT_LAYOUT.marginX && command.params[1] === safeY && command.params[2] === BOARD_TYPE_SCALE.work), "invalid presentation is bounded to work area and work role");
      }
      if (page.rows === "reduced") {
        assert(currentLiveRows.some((row) => row.fontSize === BOARD_TYPE_SCALE.label), "real reservation exercises legitimate24");
        assert(currentLiveRows.some((row) => row.fontSize === BOARD_TYPE_SCALE.annotation), "real reservation exercises legitimate19");
      }
    }
    if (name === "mixed-pages" || name === "continuation") {
      const replayGenerationRef = ref(1);
      const replay = hook(path.join(hooksDir, "useReplay.ts")).useReplay({
        whiteboardRef, cancelRef, speedRef: ref(40), isPausedRef: ref(false), replayAudioRef: ref(null),
        replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()), storedTurnsRef: ref(savedTurns),
        activeVerifiedDiagramRef, fbdPhaseStartedRef, replayGenerationRef, replayCueRef: ref(null), ttsClientRef: ref(null),
        notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef, liveQuestionRef,
        phaseRef: ref("idle"), isReplaying: false, isPaused: false, isDownloading: false, replayProgressMs: 0,
        boards: [], sessionId: "work-fidelity", setPhase() {}, setCurrentSegmentText() {}, setNarrationText() {},
        setIsPaused() {}, setIsReplaying() {}, setReplayProgressMs() {}, setReplayTotalMs() {}, setSettings() {}, setIsDownloading() {},
        cancellableDelay: async () => {}, raceWithCancel: async <T>(promise: Promise<T>) => promise,
        executeCommandWithCancel: executor.executeCommandWithCancel, executeCommand: execute,
        resetBoardLayout: layout.resetBoardLayout, finishLectureUi() {}, pauseTurn() {}, resumeTurn() {},
      });
      const cues = buildReplayTimeline(savedTurns).cues;
      await replay.renderBoardAtTime(Number.MAX_SAFE_INTEGER, cues, replayGenerationRef.current);
      assert.deepEqual(rows.splice(0), liveHistoryRows, "actual Replay seek preserves every page's row presentation");
      assert.deepEqual(ink(board), lastLiveInk, "actual Replay seek ends on the live final page ink");
      await board.clearBoard();
      layout.resetBoardLayout(false, false);
      let syncedTurnIndex = -1;
      await drawReplayDiagramTimeline({
        cues, executeCommand: (command, options) => execute(command, { ...options, durationScale: 0 }),
        getClockMs: () => Number.MAX_SAFE_INTEGER, waitForAdvance: async () => {}, shouldCancel: () => false,
        getTurn: (index) => savedTurns[index], getPageTurns: (index) => pageTurnsEndingAt(savedTurns, index),
        getDiagram: () => activeVerifiedDiagramRef.current,
        onCueStart: async (cue) => {
          if (cue.turnIndex === syncedTurnIndex) return;
          const turn = savedTurns[cue.turnIndex]!;
          await resetReplayPageAtTurn({ turn, previousTurnIndex: syncedTurnIndex, turnIndex: cue.turnIndex, whiteboard: board, resetBoardLayout: layout.resetBoardLayout, shouldCancel: () => false });
          syncedTurnIndex = cue.turnIndex;
          if (!storedTurnContinuesBoard(turn)) {
            activeVerifiedDiagramRef.current = restoreVerifiedDiagramFromTurn(turn);
            fbdPhaseStartedRef.current = Boolean(activeVerifiedDiagramRef.current);
          }
        },
      });
      assert.deepEqual(rows.splice(0), liveHistoryRows, "Player shared actual timeline preserves every page's row presentation");
      assert.deepEqual(ink(board), lastLiveInk, "Player shared actual timeline ends on the live final page ink");
      let now = 0;
      let advance = () => {};
      let releaseBoundary = () => {};
      const tick = new Promise<void>((resolve) => { advance = resolve; });
      const boundary = new Promise<void>((resolve) => { releaseBoundary = resolve; });
      let boundaryStarted = false;
      let timelineFinished = false;
      const scheduled = drawReplayDiagramTimeline({
        cues: [{ ...cues[0]!, commands: [], startMs: 500, endMs: 500 }], executeCommand: async () => {},
        getClockMs: () => now, waitForAdvance: () => tick, shouldCancel: () => false,
        getTurn: () => savedTurns[0], getDiagram: () => null,
        onCueStart: async () => { boundaryStarted = true; await boundary; },
      }).then(() => { timelineFinished = true; });
      for (let flush = 0; flush < 5; flush++) await Promise.resolve();
      assert(!boundaryStarted, "future page must not clear before the cue's clock");
      now = 500;
      advance();
      for (let flush = 0; flush < 5; flush++) await Promise.resolve();
      assert(boundaryStarted && !timelineFinished, "cue ink must await the asynchronous runtime page transition");
      releaseBoundary();
      await scheduled;
      // Narrated CLEAR stays blocked; only explicit runtime page ownership resets.
      activeVerifiedDiagramRef.current = buildVerifiedDiagramPresentation(scene(question), compileSceneDocument(scene(question)).renderScene!).diagram;
      const before = ink(board);
      await execute({ type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" }, { durationScale: 0 });
      assert.deepEqual(ink(board), before, "untrusted narrated CLEAR remains blocked by scene ownership");
      let resets = 0;
      const reset = () => { resets++; };
      assert(await resetReplayPageAtTurn({ turn: savedTurns[0], previousTurnIndex: -1, turnIndex: 0, whiteboard: board, resetBoardLayout: reset, shouldCancel: () => false }));
      assert.equal(resets, 0, "initial turn does not clear/reset twice");
      const doubt = { ...savedTurns.at(-1)!, segments: [], sceneArtifacts: boardContinuationArtifacts(question), kind: "doubt" as const };
      assert(await resetReplayPageAtTurn({ turn: doubt, previousTurnIndex: 0, turnIndex: 1, whiteboard: board, resetBoardLayout: reset, shouldCancel: () => false }));
      assert.deepEqual(ink(board), before, "same-page continuation preserves native ink");
      assert(!await resetReplayPageAtTurn({ turn: savedTurns[0], previousTurnIndex: 0, turnIndex: 1, whiteboard: board, resetBoardLayout: reset, shouldCancel: () => true }));
      assert.deepEqual(ink(board), before, "stale generation cannot begin a new page clear");
      let cancelled = false;
      const nativeClear = board.clearBoard.bind(board);
      board.clearBoard = async () => { await nativeClear(); cancelled = true; };
      assert(!await resetReplayPageAtTurn({ turn: savedTurns[0], previousTurnIndex: 0, turnIndex: 1, whiteboard: board, resetBoardLayout: reset, shouldCancel: () => cancelled }));
      assert.equal(resets, 0, "late cancelled clear cannot reset a new generation's layout");
      console.log(name + ": real restore + Replay seek + Player shared timeline match live; page ownership/cancellation controls pass");
    }
  } finally {
    clearInterval(pump);
    unmountTestWhiteboard(board);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--mixed-only")) {
    await scenario("mixed-pages", [{ figure: false, rows: "simple" }, { figure: true, rows: "wrapped" }, { figure: false, rows: "overflow" }]);
    return;
  }
  const raw: DrawCommand = { type: "WRITE", params: [720, 440, BOARD_TYPE_SCALE.annotation], text: "a = 2", charPosition: 0, narrationBefore: "" };
  assert(fitWorkTextCommand(raw).every((command) => command.params[2] === BOARD_TYPE_SCALE.work), "raw teaching sanitizer must continue ignoring model-requested size");
  await scenario("narrow-nowrap", [{ figure: true, rows: "simple" }]);
  await scenario("historical-oversize", [{ figure: true, rows: "simple", historicalOversize: true }]);
  await scenario("full-nowrap", [{ figure: false, rows: "simple" }]);
  await scenario("narrow-wrap", [{ figure: true, rows: "wrapped" }]);
  await scenario("reduced-token", [{ figure: true, rows: "reduced" }]);
  await scenario("work-page-turns", [{ figure: true, rows: "overflow" }]);
  await scenario("continuation", [{ figure: true, rows: "simple" }, { figure: true, rows: "wrapped", continuation: "resume" }, { figure: true, rows: "simple", continuation: "doubt" }]);
  await scenario("mixed-pages", [{ figure: false, rows: "simple" }, { figure: true, rows: "wrapped" }, { figure: false, rows: "overflow" }]);
  for (const unsafeSize of [-10, 0, 28, BOARD_TYPE_SCALE.heading, 72]) {
    await scenario("invalid-size-" + unsafeSize, [{ figure: false, rows: "simple", unsafeSize }]);
  }
  await scenario("invalid-y", [{ figure: false, rows: "simple", unsafeSize: 72, unsafeY: 1000 }]);
  for (const size of [NaN, Infinity]) {
    const rejected = await canonicalize({ question: "Write a safe row.", visualStatus: "text_only", segments: [{ orderIndex: 0, narration: "", spokenText: "", command: { ...raw, params: [90, 142, size] } }] });
    assert(!rejected.ok, "nonfinite recorded style cannot cross the save boundary");
  }
  console.log("work text fidelity: actual captured font, position, text and native ink survive canonical save and reopen");
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
