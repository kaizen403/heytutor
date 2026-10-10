/** Empty Continue attempts must leave the last taught parent and its offer intact. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { RecordedSegmentPayload, StoredTurn } from "../../lib/boards/boardsClient";
import { LiveTurnSaveRegistry, overlayLiveTurnEvent } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { resumePageRecord, type PausedLessonRequest } from "../../features/tutor-session/lib/turn/doubtTurn";
import { currentPausedLesson, lessonResumeState, pausedLessonFromStoredTurns } from "../../features/tutor-session/lib/turn/pausedLessonRestore";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const BOARD = "empty-resume-board";
const QUESTION = "A cart accelerates at 2 m/s^2 for 3 s. Find its velocity.";
const PROJECTION = { velocity: { value: 6, unit: "m/s" } };
const ref = <T,>(current: T) => ({ current });
const noop = () => {};
const row = (text = "v = u + at"): RecordedSegmentPayload => ({
  orderIndex: 0, narration: "Use the velocity equation.", spokenText: "Use the velocity equation.",
  command: { type: "WRITE", text, params: [90, 142], charPosition: 0, narrationBefore: "" },
  audioBytes: null, durationMs: null, timings: null,
});
const parent: StoredTurn = {
  id: "taught-parent", orderIndex: 0, kind: "lesson", question: QUESTION,
  rawResponse: "Use the velocity equation.", speedMultiplier: 1, traceId: "taught-trace",
  sceneDocument: null, sceneEngineVersion: null, validationReport: null,
  visualStatus: "text_only", sceneArtifacts: null, status: "stopped", persistedStatus: "stopped",
  resumeState: lessonResumeState(PROJECTION),
  segments: [{ ...row(), id: "parent-row", audioUrl: null }],
};

/** Execute real hooks with only React render/platform ports replaced. */
function loadHook(file: string, registry: LiveTurnSaveRegistry, effects: Array<() => unknown>, speaking: { current: string }) {
  const filename = path.join(app, file);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const hookModule = { exports: {} as Record<string, unknown> };
  const localRequire = (specifier: string) => {
    if (specifier === "react") return {
      useRef: ref, useState: (value: unknown) => [value, noop], useCallback: (fn: unknown) => fn,
      useEffect: (fn: () => unknown) => effects.push(fn), useLayoutEffect: (fn: () => unknown) => fn(),
      useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    };
    if (specifier.endsWith("/turn/liveTurnSave")) return { liveTurnSave: () => registry, overlayLiveTurnEvent };
    if (specifier.endsWith("/turn/lessonOwnership")) return { lessonAdmission: () => ({ probe: async () => "inactive", cancel: noop, hasAttempt: () => false }) };
    if (specifier === "./useSegmentRunner") return { useSegmentRunner: () => ({
      runSegment: async () => {}, pauseFallbackSpeech: noop, resumeFallbackSpeech: noop,
      stopFallbackSpeech: noop, speakingNarrationRef: speaking,
    }) };
    return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
      : specifier.startsWith(".") ? path.resolve(path.dirname(filename), specifier) : specifier);
  };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", compiled)(localRequire, hookModule, hookModule.exports, () => 1, noop);
  return hookModule.exports;
}

function mount() {
  let minted = 0;
  const calls: string[] = [];
  const registry = new LiveTurnSaveRegistry({
    transport: {
      checkpoint: async (_board, turn) => { calls.push(`PUT ${turn}`); return new Promise(() => {}); },
      close: async (_board, turn) => { calls.push(`PATCH ${turn}`); return new Promise(() => {}); },
    },
    setTimer: () => 1, clearTimer: noop, now: () => 1_000, isOnline: () => true,
    mintId: () => `empty-attempt-${++minted}`,
  });
  const speaking = ref("");
  const page = ref<ReturnType<typeof resumePageRecord> | null>(resumePageRecord({
    boardId: BOARD, lessonQuestion: QUESTION, figureDrawn: false,
    turnPlan: null, solverProjection: PROJECTION, scene: null,
  }));
  const params = {
    sessionId: BOARD, phase: "speaking", isReplaying: false, boardLoaded: true, enableKeyboardControls: false,
    whiteboardRef: ref({ cancelAnimations: noop, setPaused: noop, clearSpotlight: noop }),
    pendingQuestionRef: ref(null), autoSubmitDoneRef: ref(false), phaseRef: ref("idle"),
    isPausedRef: ref(false), rewoundRef: ref(false), conversationHistoryRef: ref([]), liveQuestionRef: ref(QUESTION),
    ttsClientRef: ref(null), ensureTTSClient: () => ({}), currentTraceIdRef: ref<string | null>("attempt-trace"),
    replayAudioRef: ref(null), replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()),
    cancelRef: ref(false), turnActiveRef: ref(false), turnGenerationRef: ref(1), turnAbortRef: ref(null),
    segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()), collectedSegmentsRef: ref([]),
    recordedSegmentsRef: ref<Array<{ narration: string }>>([]), narrationSinceEpochRef: ref(""),
    activeVerifiedDiagramRef: ref(null), codeLessonControllerRef: ref(null), fbdPhaseMarkedRef: ref(false),
    fbdPhaseStartedRef: ref(false), setActiveVerifiedDiagram: noop, segmentPlanStatsRef: ref({}), stopTurnRef: ref(null),
    replayGenerationRef: ref(0), replayCueRef: ref(null), turnTelemetryRef: ref(null),
    setPhase: noop, setIsPaused: noop, setNarrationText: noop, setCurrentSegmentText: noop, setInputInteracted: noop,
    setLastError: noop, setIsReplaying: noop, setReplayProgressMs: noop, setReplayTotalMs: noop, clearCancelTimers: noop,
    pendingSegmentCountRef: ref(0), executeCommandWithCancel: async () => {},
    boardLayoutRef: ref({ rects: [{ x: 90, y: 142, width: 160, height: 30, text: "v = u + at", workId: "parent-work" }] }),
    boardPageRef: page, boardShowsStoppedReplayRef: ref(false),
  };
  const boardEffects: Array<() => unknown> = [];
  const useBoardSession = loadHook("features/tutor-session/hooks/useBoardSession.ts", registry, boardEffects, speaking).useBoardSession as typeof import("../../features/tutor-session/hooks/useBoardSession").useBoardSession;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- real hook in a controlled render/platform fixture
  const board = useBoardSession({
    sessionId: BOARD, router: { push: noop }, phase: "speaking", speedMultiplier: 1,
    whiteboardRef: params.whiteboardRef, cancelRef: params.cancelRef,
    notesEpochsRef: ref([]), narrationSinceEpochRef: params.narrationSinceEpochRef, liveQuestionRef: params.liveQuestionRef,
    captureNotesEpoch: () => false, ttsClientRef: params.ttsClientRef, voicePreferencesRef: ref({}), speedRef: ref(1),
    stopTurnRef: params.stopTurnRef, replayAudioRef: params.replayAudioRef, replayAudioPreloadRef: params.replayAudioPreloadRef,
    setNarrationText: noop, setCurrentSegmentText: noop, resetBoardLayout: noop, executeCommand: async () => {},
  } as never);
  board.storedTurnsRef.current = [structuredClone(parent)];
  const attach = boardEffects.find((effect) => effect.toString().includes(".attach("));
  assert(attach, "fixture mounts the real board-session registry mirror consumer");
  attach();
  const asked: Array<{ resume?: PausedLessonRequest; doubt?: unknown; onAdmission?: (admitted: boolean) => void }> = [];
  let handle: ReturnType<LiveTurnSaveRegistry["begin"]> | undefined;
  let finish = noop;
  const handleQuestionRef = ref(async (_question: string, options?: typeof asked[number]) => {
    asked.push(options ?? {});
    options?.onAdmission?.(true);
    if (options?.resume) {
      params.turnActiveRef.current = true; params.phaseRef.current = "speaking"; params.cancelRef.current = false;
      page.current = resumePageRecord({ boardId: BOARD, lessonQuestion: QUESTION, figureDrawn: false,
        turnPlan: options.resume.turnPlan, solverProjection: options.resume.solverProjection, scene: options.resume.scene });
      handle = registry.begin({ owner: params.cancelRef, generation: params.turnGenerationRef.current,
        boardId: BOARD, traceId: "attempt-trace", kind: "resume", question: QUESTION, preview: QUESTION,
        speedMultiplier: 1, continuesBoard: true, page: page.current });
      registry.setResumeState(params.cancelRef, params.turnGenerationRef.current, lessonResumeState(PROJECTION));
      return new Promise<void>((resolve) => { finish = resolve; });
    }
  });
  const useTurnControl = loadHook("features/tutor-session/hooks/turn/useTurnControl.ts", registry, [], speaking).useTurnControl as typeof import("../../features/tutor-session/hooks/turn/useTurnControl").useTurnControl;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- real hook in a controlled render/platform fixture
  const control = useTurnControl(params as never, handleQuestionRef as never);
  const original = pausedLessonFromStoredTurns([parent], { boardId: BOARD, ownerState: "inactive" });
  assert(original);
  const owedIntro = [{ narration: "An unfinished figure beat.", command: null, charCount: 26 }];
  const request: PausedLessonRequest = { ...original, figureDrawn: true, remainingIntro: owedIntro };
  control.offerPausedLessonResume(request); control.flushPausedLesson();
  assert(handle);
  const generation = params.turnGenerationRef.current;
  const idle = () => { params.turnActiveRef.current = false; params.phaseRef.current = "idle"; };
  return { registry, calls, board, params, control, speaking, asked, request, handle, generation, idle,
    finish: () => { handle!.close(); finish(); } };
}

async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
async function main() {
  for (const mode of ["empty", "epoch-only", "prepared-narration", "prefetched", "held-intro"] as const) {
    const shell = mount();
    if (mode === "epoch-only") shell.registry.recordRow(shell.params.cancelRef, shell.generation,
      { ...row(), narration: "", spokenText: "", command: { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" } }, { intro: false });
    if (mode === "prepared-narration") shell.speaking.current = "Not yet spoken or shown.";
    if (mode === "prefetched") shell.registry.prepareSegment(shell.params.cancelRef, shell.generation, row(), { intro: false });
    if (mode === "held-intro") shell.registry.recordRow(shell.params.cancelRef, shell.generation, row(), { intro: true });
    assert.deepEqual(shell.board.storedTurnsRef.current.map((turn) => turn.id), [parent.id],
      `${mode}: resume metadata/preparation must not insert a live ghost into actual board history`);
    shell.control.stopTurn(); shell.finish(); shell.idle(); await settle();
    assert.equal(shell.registry.turnIdFor(shell.params.cancelRef, shell.generation), undefined,
      `${mode}: an empty attempt is not a taught parent`);
    shell.control.flushPausedLesson();
    const offered = shell.asked[1]?.resume;
    assert(offered, `${mode}: Stop keeps Continue available`);
    assert.equal(offered.parentTurnId, parent.id); assert.equal(offered.parentTraceId, parent.traceId);
    assert.deepEqual(offered.solverProjection, PROJECTION); assert.equal(offered.remainingIntro, shell.request.remainingIntro);
    assert(currentPausedLesson(offered, [parent]), `${mode}: the offer passes the real fresh-parent receipt check`);
    // Stop the second empty attempt, then exercise actual idle saved-row derivation.
    shell.control.stopTurn(); shell.finish(); shell.idle(); await settle();
    const restored = await shell.control.restorePausedLesson(shell.board.storedTurnsRef.current);
    assert.equal(restored?.parentTurnId, parent.id, `${mode}: reopening/idle derivation keeps original parent`);
    assert.equal(shell.calls.length, 0, `${mode}: nothing shown means no durable turn is fabricated`);
  }
  // Doubt interruption must use contribution identity *after* Stop captured ink.
  for (const shown of [false, true]) {
    const shell = mount();
    const pending = shell.registry.prepareSegment(shell.params.cancelRef, shell.generation, row(), { intro: false });
    assert(pending); if (shown) pending.markShown();
    shell.control.handleAskDoubt("Why does acceleration multiply time?");
    shell.finish(); shell.idle(); await settle();
    assert(shell.asked[1]?.doubt, "the actual interruption dispatches the doubt once");
    shell.control.flushPausedLesson();
    const offered = shell.asked[2]?.resume;
    assert(offered);
    assert.equal(offered.parentTurnId, shown ? shell.handle.turnId : parent.id);
    assert.equal(offered.parentTraceId, shown ? "attempt-trace" : "taught-trace");
    if (!shown) {
      assert.equal(offered.remainingIntro, shell.request.remainingIntro);
      assert.deepEqual(shell.board.storedTurnsRef.current.map((turn) => turn.id), [parent.id]);
    }
  }
  // Finished narrated work contributes even without WRITE or native speech callbacks.
  {
    const shell = mount();
    shell.registry.recordRow(shell.params.cancelRef, shell.generation, { ...row(), command: null }, { intro: false });
    shell.control.stopTurn(); shell.finish(); shell.idle(); await settle();
    shell.control.flushPausedLesson();
    assert.equal(shell.asked[1]?.resume?.parentTurnId, shell.handle.turnId);
  }
  // The original empty lesson still follows decision 6; a completed chain stays final.
  {
    const shell = mount(); shell.control.stopTurn(); shell.finish(); shell.idle(); await settle();
    shell.board.storedTurnsRef.current = [{ ...parent, status: "complete", persistedStatus: "complete" }];
    assert.equal(await shell.control.restorePausedLesson(shell.board.storedTurnsRef.current), null);
    const owner = {};
    const original = shell.registry.begin({ owner, generation: 1, boardId: "blank-lesson", traceId: null,
      kind: "lesson", question: QUESTION, preview: QUESTION, speedMultiplier: 1, continuesBoard: false });
    original.close();
    assert.equal(shell.registry.turnIdFor(owner, 1), original.turnId);
    assert(shell.calls.includes(`PUT ${original.turnId}`), "original empty lesson persistence is preserved");
  }
  // A synchronously captured shown row really is a new parent; not a blanket resume bypass.
  {
    const shell = mount();
    const pending = shell.registry.prepareSegment(shell.params.cancelRef, shell.generation, row("v = 6 m/s"), { intro: false });
    assert(pending); pending.markShown();
    shell.control.stopTurn(); shell.finish(); shell.idle(); await settle();
    const taughtId = shell.registry.turnIdFor(shell.params.cancelRef, shell.generation);
    assert.equal(taughtId, shell.handle.turnId);
    const stored = shell.board.storedTurnsRef.current.find((turn) => turn.id === taughtId);
    assert(stored); assert.equal(stored.status, "stopped");
    assert.equal(stored.segments.length, 1); assert.equal(stored.segments[0]!.audioUrl, null);
    shell.control.flushPausedLesson(); assert.equal(shell.asked[1]?.resume?.parentTurnId, taughtId);
    assert(shell.calls.some((call) => call === `PUT ${taughtId}`));
  }
  console.log("empty resume Stop: actual registry + board mirror + control/fresh restore passed (5 empty boundaries, doubt/cut, narrated work, finality and original-lesson controls)");
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
