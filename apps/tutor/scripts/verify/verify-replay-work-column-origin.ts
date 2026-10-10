/**
 * Replay of a reopened lesson must lay out the work column exactly as the live
 * lesson did (runtime verifier finding, 4 Oct 2026: circle S3 replayed its
 * first row at y 340 instead of 145, three rows below the restored page).
 *
 * Part 1 (control): restore finishes, then Replay. Every row lands at its
 * live y.
 *
 * Part 2 (the browser race, root-caused by the runtime verifier): the
 * production useBoardSession restore is still inking the saved page when the
 * student presses Replay. Replay clears the board and resets the work column
 * layout, then the restore's remaining rows re-enter that layout and every
 * replayed row lands that many rows lower. The race is made deterministic by
 * holding one restore WRITE until replay has reset the layout. Run without
 * `settleBoardRestore` it must reproduce the offset (proof the gate bites);
 * with it every replayed row must land at its live y.
 *
 * Drives the production layout and command executor (only React's hooks are
 * stubbed) on a real Whiteboard: restore the saved turn the way the board
 * session does, then replay it the way the Replay button does, and compare
 * every WRITE row with the coordinates the live lesson recorded.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { parseStoredSegmentCommands, isStoredCommandTrustedGeometry, type DrawCommand } from "@heytutor/drawing";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

const hooksDir = fileURLToPath(new URL("../../features/tutor-session/hooks/", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const effects: Array<() => unknown> = [];
const react = {
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  // Captured, not run: the race scenario starts only the board restore effect.
  useEffect: (fn: () => unknown) => { effects.push(fn); },
  useLayoutEffect: () => {},
  // The live save status: read once, no subscription in this harness.
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useState: (value: unknown) => [typeof value === "function" ? (value as () => unknown)() : value, () => {}],
};
// The loaded hooks are untyped CommonJS; this script only calls their members.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HookResult = Record<string, any>;
const loaded = new Map<string, unknown>();
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
/** The board API, answered from the fixture instead of the network. */
let storedTurnsForApi: StoredTurn[] = [];
const boardsClientStub = {
  fetchBoardDetail: async () => ({ turns: storedTurnsForApi }),
  fetchBoards: async () => [],
  createBoard: async () => null,
  deleteBoardApi: async () => true,
  updateBoard: async () => null,
};
/** Hooks in this folder load with stub React; everything else is the real module. */
function loadHookModule(file: string): Record<string, unknown> {
  if (loaded.has(file)) return loaded.get(file) as Record<string, unknown>;
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  loaded.set(file, mod.exports);
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return react;
    if (specifier === "@/lib/boards/boardsClient") return boardsClientStub;
    if (specifier.startsWith("@/")) return requireApp(path.resolve(appRoot, specifier.slice(2)));
    if (specifier.startsWith(".")) {
      const target = path.resolve(path.dirname(file), specifier);
      if (path.dirname(target) === path.resolve(hooksDir)) return loadHookModule(`${target}.ts`);
      return requireApp(target);
    }
    return requireApp(specifier);
  }, mod, mod.exports);
  return mod.exports;
}

const { useBoardLayout: boardLayoutHook } = loadHookModule(path.join(hooksDir, "useBoardLayout.ts")) as { useBoardLayout: (params: Record<string, unknown>) => HookResult };
const { useCommandExecution: commandExecutionHook } = loadHookModule(path.join(hooksDir, "useCommandExecution.ts")) as { useCommandExecution: (params: Record<string, unknown>) => HookResult };
const { useBoardSession: boardSessionHook } = loadHookModule(path.join(hooksDir, "useBoardSession.ts")) as { useBoardSession: (params: Record<string, unknown>) => HookResult };
const { useReplay: replayHook } = loadHookModule(path.join(hooksDir, "useReplay.ts")) as { useReplay: (params: Record<string, unknown>) => HookResult };
const { restoreVerifiedDiagramFromTurn } = requireApp(path.resolve(hooksDir, "../lib/scene/restoreVerifiedDiagram")) as { restoreVerifiedDiagramFromTurn: (turn: StoredTurn) => unknown };

const ref = <T>(current: T) => ({ current });
const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

interface Row { text: string; x: number; y: number }

async function controlScenario(): Promise<void> {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/replay/circle-s3-turn.json", import.meta.url), "utf8")) as { turn: StoredTurn };
  const turn = fixture.turn;
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const rows: Row[] = [];
  const nativeWrite = board.writeText.bind(board);
  board.writeText = ((text: string, x: number, y: number, ...rest: unknown[]) => {
    rows.push({ text, x, y });
    return (nativeWrite as (...args: unknown[]) => Promise<void>)(text, x, y, ...rest);
  }) as typeof board.writeText;

  const whiteboardRef = ref(board);
  const cancelRef = ref(false);
  const fbdPhaseStartedRef = ref(false);
  const activeVerifiedDiagramRef = ref<unknown>(null);
  const layout = boardLayoutHook({ whiteboardRef, cancelRef, fbdPhaseStartedRef, liveQuestionRef: ref(turn.question) });
  const executor = commandExecutionHook({
    whiteboardRef, cancelRef, speedRef: ref(1),
    boardLayoutRef: layout.boardLayoutRef, forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef,
    fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef, activeVerifiedDiagramRef,
    turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
    cancellableDelay: async () => {}, forgetErasedTextRects: layout.forgetErasedTextRects,
    resetBoardLayout: layout.resetBoardLayout, resolveTextPlacement: layout.resolveTextPlacement,
    raceWithCancel: async <T>(promise: Promise<T>) => promise,
    inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1), nowMs: clock.source.now,
  });
  const run = async (command: DrawCommand, trustedDiagramGeometry: boolean) => {
    const job = executor.executeCommand(command, { durationScale: 0, applyLayout: false, trustedDiagramGeometry });
    let done = false;
    void job.finally(() => { done = true; });
    while (!done) { clock.advance(1000); clock.pump(); await flush(); }
    await job;
  };
  const playTurn = async () => {
    const diagram = restoreVerifiedDiagramFromTurn(turn);
    activeVerifiedDiagramRef.current = diagram;
    fbdPhaseStartedRef.current = Boolean(diagram);
    for (const segment of turn.segments) {
      const trusted = isStoredCommandTrustedGeometry(segment.command);
      for (const command of parseStoredSegmentCommands(segment.command)) {
        if (command.type === "PAUSE" || command.type === "FOCUS" || command.type === "POINT" || command.type === "EMPHASIZE") continue;
        await run(command, trusted);
      }
    }
  };
  const recorded = turn.segments.flatMap((segment) => parseStoredSegmentCommands(segment.command))
    .filter((command) => command.type === "WRITE")
    .map((command) => ({ text: command.text ?? "", y: command.params[1]! }));

  try {
    // Reopen: the board session restores the finished page.
    await board.clearBoard();
    layout.resetBoardLayout(false, false);
    await playTurn();
    const restored = rows.splice(0);
    assert(restored.length > 0, "restore inks the saved page");

    // Replay from the start through the production Replay hook.
    let finished = false;
    const replay = replayHook({
      whiteboardRef, cancelRef, speedRef: ref(40), isPausedRef: ref(false), replayAudioRef: ref(null),
      replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()), storedTurnsRef: ref([turn]),
      codeLessonControllerRef: ref(null), activeVerifiedDiagramRef, setActiveVerifiedDiagram: () => {},
      fbdPhaseStartedRef, replayGenerationRef: ref(0), replayCueRef: ref(null), ttsClientRef: ref(null),
      notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
      liveQuestionRef: ref(turn.question), phaseRef: ref("idle"), isReplaying: false, isPaused: false,
      isDownloading: false, replayProgressMs: 0, boards: [], sessionId: "fixture",
      setPhase: () => {}, setCurrentSegmentText: () => {}, setNarrationText: () => {}, setIsPaused: () => {},
      setIsReplaying: (value: boolean) => { if (!value) finished = true; }, setReplayProgressMs: () => {},
      setReplayTotalMs: () => {}, setSettings: () => {}, setIsDownloading: () => {},
      cancellableDelay: async () => {}, raceWithCancel: async <T>(promise: Promise<T>) => promise,
      executeCommandWithCancel: executor.executeCommandWithCancel, executeCommand: executor.executeCommand,
      resetBoardLayout: layout.resetBoardLayout, finishLectureUi: () => { finished = true; },
      pauseTurn: () => {}, resumeTurn: () => {},
    });
    assert.equal(replay.replayLecture(), true, "Replay lecture starts");
    const deadline = Date.now() + 240_000;
    while (!finished && Date.now() < deadline) {
      clock.advance(50); clock.pump();
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    assert(finished, "replay reaches idle");
    const replayed = rows.splice(0).filter((row) => row.x < 400);
    const firstRows = recorded.map((write) => {
      const row = replayed.find((candidate) => write.text.startsWith(candidate.text) || candidate.text.startsWith(write.text.slice(0, 12)));
      return { text: write.text.slice(0, 32), recordedY: write.y, replayY: row?.y ?? null };
    });
    console.log(JSON.stringify({ restored: restored.filter((row) => row.x < 400).map((row) => [row.text.slice(0, 18), row.y]), replayed: replayed.map((row) => [row.text.slice(0, 18), row.y]) }));
    for (const row of firstRows) {
      assert(row.replayY !== null, `${row.text}: replayed`);
      assert(Math.abs(row.replayY - row.recordedY) <= 4, `${row.text}: replay y ${row.replayY} differs from the live row y ${row.recordedY}`);
    }
    console.log(`replay work column origin: ${firstRows.length} WRITE rows replay at their live coordinates after a reopen`);
  } finally {
    unmountTestWhiteboard(board);
  }
}

/**
 * Restore the saved turn through the production useBoardSession, hold one of
 * its WRITE rows until Replay has reset the work column, then let it go.
 * Returns how far each replayed row landed from its live y.
 */
async function raceScenario(withSettle: boolean, beforeReady = false): Promise<{ offsets: number[]; restoreRowsAfterReplayStart: number; workRows: Row[]; recordedTexts: string[] }> {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/replay/circle-s3-turn.json", import.meta.url), "utf8")) as { turn: StoredTurn };
  const turn = fixture.turn;
  storedTurnsForApi = [turn];
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const pump = setInterval(() => { clock.advance(50); clock.pump(); }, 2);
  const rows: Row[] = [];
  let replayStarted = false;
  let restoreRowsAfterReplayStart = 0;
  const nativeWrite = board.writeText.bind(board);
  board.writeText = ((text: string, x: number, y: number, ...rest: unknown[]) => {
    rows.push({ text, x, y });
    return (nativeWrite as (...args: unknown[]) => Promise<void>)(text, x, y, ...rest);
  }) as typeof board.writeText;

  const whiteboardRef = ref<typeof board | null>(beforeReady ? null : board);
  const cancelRef = ref(false);
  const fbdPhaseStartedRef = ref(false);
  const activeVerifiedDiagramRef = ref<unknown>(null);
  const layout = boardLayoutHook({ whiteboardRef, cancelRef, fbdPhaseStartedRef, liveQuestionRef: ref(turn.question) });
  let resetsAfterReplayStart = 0;
  const resetBoardLayout = (...args: unknown[]) => {
    if (replayStarted) resetsAfterReplayStart++;
    return (layout.resetBoardLayout as (...values: unknown[]) => void)(...args);
  };
  const executor = commandExecutionHook({
    whiteboardRef, cancelRef, speedRef: ref(1),
    boardLayoutRef: layout.boardLayoutRef, forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef,
    fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef, activeVerifiedDiagramRef,
    turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
    cancellableDelay: async () => {}, forgetErasedTextRects: layout.forgetErasedTextRects,
    resetBoardLayout, resolveTextPlacement: layout.resolveTextPlacement,
    raceWithCancel: async <T>(promise: Promise<T>) => promise,
    inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1), nowMs: clock.source.now,
  });

  // The restore's third WRITE waits here until Replay has reset the layout
  // (or, when replay waits for the restore, until a real-time fallback).
  let restoreWrites = 0;
  let held = false;
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const restoreExecute = async (command: DrawCommand, options?: Record<string, unknown>) => {
    if (!beforeReady && command.type === "WRITE" && ++restoreWrites === 3) {
      held = true;
      await barrier;
    }
    if (replayStarted && command.type === "WRITE" && !(options?.isCancelled as (() => boolean) | undefined)?.()) restoreRowsAfterReplayStart++;
    return executor.executeCommand(command, options);
  };

  const noop = () => {};
  effects.length = 0;
  const session = boardSessionHook({
    sessionId: "fixture", isDraft: false, router: { push: noop, replace: noop }, phase: "idle", speedMultiplier: 1,
    whiteboardRef, cancelRef, notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
    liveQuestionRef: ref(""), captureNotesEpoch: () => true, ttsClientRef: ref(null), voicePreferencesRef: ref({}),
    speedRef: ref(1), stopTurnRef: ref(null), replayAudioRef: ref(null), replayAudioPreloadRef: ref(new Map()),
    setNarrationText: noop, setCurrentSegmentText: noop, resetBoardLayout, executeCommand: restoreExecute,
    skipInkRestoreRef: ref(false), codeLessonControllerRef: ref(null), activeVerifiedDiagramRef,
    setActiveVerifiedDiagram: noop, fbdPhaseStartedRef,
  });
  const restoreEffect = effects.find((effect) => effect.toString().includes("restoreBoardFromApiRef.current("));
  assert(restoreEffect, "the board session's restore effect is present");
  try {
    restoreEffect();
    const heldDeadline = Date.now() + 30_000;
    while (!(beforeReady ? session.storedTurnsRef.current.length > 0 : held) && Date.now() < heldDeadline) await new Promise<void>((resolve) => setTimeout(resolve, 2));
    assert(beforeReady ? session.storedTurnsRef.current.length > 0 : held, "the restore reached its requested barrier");
    rows.splice(0);

    let finished = false;
    const replay = replayHook({
      whiteboardRef, cancelRef, speedRef: ref(40), isPausedRef: ref(false), replayAudioRef: ref(null),
      replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()), storedTurnsRef: session.storedTurnsRef,
      codeLessonControllerRef: ref(null), activeVerifiedDiagramRef, setActiveVerifiedDiagram: noop,
      fbdPhaseStartedRef, replayGenerationRef: ref(0), replayCueRef: ref(null), ttsClientRef: ref(null),
      notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
      liveQuestionRef: ref(turn.question), phaseRef: ref("idle"), isReplaying: false, isPaused: false,
      isDownloading: false, replayProgressMs: 0, boards: [], sessionId: "fixture",
      setPhase: noop, setCurrentSegmentText: noop, setNarrationText: noop, setIsPaused: noop,
      setIsReplaying: (value: boolean) => { if (!value) finished = true; }, setReplayProgressMs: noop,
      setReplayTotalMs: noop, setSettings: noop, setIsDownloading: noop,
      cancellableDelay: async () => {}, raceWithCancel: async <T>(promise: Promise<T>) => promise,
      executeCommandWithCancel: executor.executeCommandWithCancel, executeCommand: executor.executeCommand,
      resetBoardLayout, finishLectureUi: () => { finished = true; },
      pauseTurn: noop, resumeTurn: noop,
      ...(withSettle ? { settleBoardRestore: session.settleBoardRestore } : {}),
    });
    replayStarted = true;
    whiteboardRef.current = board;
    assert.equal(replay.replayLecture(), true, "Replay lecture starts while the restore is still inking");
    const releaseDeadline = Date.now() + 1_500;
    while (resetsAfterReplayStart === 0 && Date.now() < releaseDeadline) await new Promise<void>((resolve) => setTimeout(resolve, 2));
    release();

    const deadline = Date.now() + 240_000;
    while (!finished && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 2));
    assert(finished, "replay reaches idle");
    const recorded = turn.segments.flatMap((segment) => parseStoredSegmentCommands(segment.command))
      .filter((command) => command.type === "WRITE")
      .map((command) => ({ text: command.text ?? "", y: command.params[1]! }));
    // Replay rows are the last pass over the work column: take the last row per text.
    const work = rows.filter((row) => row.x < 400);
    const offsets = recorded.map((write) => {
      const matches = work.filter((candidate) => write.text.startsWith(candidate.text) || candidate.text.startsWith(write.text.slice(0, 12)));
      const row = matches.at(-1);
      assert(row, `${write.text.slice(0, 32)}: replayed`);
      return row.y - write.y;
    });
    return { offsets, restoreRowsAfterReplayStart, workRows: work, recordedTexts: recorded.map((write) => write.text) };
  } finally {
    clearInterval(pump);
    unmountTestWhiteboard(board);
  }
}

async function main(): Promise<void> {
  await controlScenario();
  const unfixed = await raceScenario(false);
  console.log(JSON.stringify({ withoutSettle: { offsets: unfixed.offsets, restoreRowsAfterReplayStart: unfixed.restoreRowsAfterReplayStart } }));
  assert(unfixed.restoreRowsAfterReplayStart > 0, "the race is real: restore rows were written after Replay started");
  assert(unfixed.offsets.some((offset) => offset > 4), `without settleBoardRestore the race must push replay rows down (gate must bite): ${JSON.stringify(unfixed.offsets)}`);
  const fixed = await raceScenario(true);
  console.log(JSON.stringify({ withSettle: { offsets: fixed.offsets, restoreRowsAfterReplayStart: fixed.restoreRowsAfterReplayStart } }));
  // WRITE rows now share the canonical work margin, including continuations.
  // The unfixed race still interleaves late restore rows with the replay pass;
  // test that corruption directly rather than inferring it from an x indent.
  const extraUnfixedRows = unfixed.workRows.length - unfixed.recordedTexts.length;
  assert(extraUnfixedRows > 0, "without settleBoardRestore late restore adds rows to the replay pass (gate must bite)");
  // With the fix the board after Replay holds exactly the live rows: same
  // texts, no extra continuation, all at the margin.
  assert.deepEqual(fixed.workRows.map((row) => row.text), fixed.recordedTexts, "with settleBoardRestore every row keeps its live wrap");
  assert(fixed.workRows.every((row) => row.x === 90), "with settleBoardRestore no row is pushed into a continuation indent");
  assert.equal(fixed.restoreRowsAfterReplayStart, 0, "with settleBoardRestore no restore row is inked after Replay starts");
  for (const offset of fixed.offsets) assert(Math.abs(offset) <= 4, `with settleBoardRestore every replayed row lands at its live y: ${JSON.stringify(fixed.offsets)}`);
  const preReadyUnfixed = await raceScenario(false, true);
  assert(preReadyUnfixed.restoreRowsAfterReplayStart > 0, "the pre-ready control must reproduce late restored ink");
  const preReadyFixed = await raceScenario(true, true);
  assert.equal(preReadyFixed.restoreRowsAfterReplayStart, 0, "settle cancels before readiness and initial board clear");
  assert.deepEqual(preReadyFixed.workRows.map((row) => row.text), preReadyFixed.recordedTexts, "pre-ready cancellation preserves every replay row");
  for (const offset of preReadyFixed.offsets) assert(Math.abs(offset) <= 4, "pre-ready cancellation preserves live coordinates");
  console.log(`replay work column race: reproduced without the fix (max offset ${Math.max(...unfixed.offsets)} px), ${fixed.offsets.length} rows exact with it, ${extraUnfixedRows} extra row(s) without it`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
