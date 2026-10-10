/** Actual scheduled Continue consumer + saved-board/controller hydration. No server or provider. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { CodeLessonController } from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { lessonPageRecord } from "../../features/tutor-session/lib/turn/doubtTurn";
const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
const ref = <T>(current: T) => ({ current });
const tick = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
function load(relative: string, react: unknown, overrides: Record<string, unknown> = {}) {
  const file = path.join(app, relative);
  const source = relative.endsWith("useTurnControl.ts") ? process.env.CONTINUE_REFRESH_TEST_SOURCE ?? file : file;
  const js = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as Record<string, (...args: never[]) => unknown> };
  new Function("require", "module", "exports", js)((id: string) => id === "react" ? react : overrides[id] ?? requireApp(id.startsWith(".") ? path.resolve(path.dirname(file), id) : id), mod, mod.exports);
  return mod.exports;
}
const plan = getMockCodeLessonPlan("Explain binary search on a sorted array.");
const block = plan.sections[0]!.blocks[0]!;
function turn(chars: number, status: "live" | "stopped" = "stopped", id = "lesson"): StoredTurn {
  return { id, orderIndex: 0, kind: "lesson", status: status === "live" ? "stopped" : status, persistedStatus: status,
    updatedAt: Date.now(), question: plan.question, rawResponse: "Explain the function.", speedMultiplier: 1, traceId: id,
    sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: { codeLesson: plan }, resumeState: null,
    segments: [{ id: `${id}-type`, orderIndex: 0, narration: "Explain the function.", spokenText: "Explain the function.", audioUrl: null, durationMs: null, timings: null,
      command: { type: "TYPE", params: [], charPosition: 0, narrationBefore: "", text: block.code, semanticRef: { entityId: block.id }, shownChars: chars } }] };
}
function fixture() {
  const controller = new CodeLessonController();
  const registry = new LiveTurnSaveRegistry({ transport: { checkpoint: async () => ({ ok: false, status: 403, reason: "forbidden", error: "fixture", retryable: false }), close: async () => ({ ok: false, status: 403, reason: "forbidden", error: "fixture", retryable: false }) }, mintId: () => "attempt", now: () => 1000, isOnline: () => true, setTimer: () => 1, clearTimer() {} });
  const effects: Array<() => void> = []; const offers: unknown[] = []; const paints: string[] = [];
  const commonReact = { useRef: ref, useCallback: (fn: unknown) => fn, useState: (initial: unknown) => [initial, () => {}], useLayoutEffect: (fn: () => void) => fn(), useSyncExternalStore: (_listen: unknown, get: () => unknown) => get(), useEffect: (fn: () => void) => effects.push(fn) };
  let currentDetail: { turns: StoredTurn[] } | null = { turns: [turn(2, "live")] };
  let reads = 0; const boardId = "board";
  let ownerState: "active" | "inactive" | "unknown" = "inactive";
  let controlRead: (() => Promise<typeof currentDetail>) | null = null;
  let paintWait: Promise<void> | null = null; let paintFails = false;
  const cancelRef = ref(false); const pageRef = ref(lessonPageRecord(boardId, plan.question));
  const shared = { cancelRef, liveQuestionRef: ref(""), narrationSinceEpochRef: ref(""), codeLessonControllerRef: ref(controller), notesEpochsRef: ref([]), activeVerifiedDiagramRef: ref(null), fbdPhaseStartedRef: ref(false),
    whiteboardRef: ref({ getDrawLayer: () => ({}), clearBoard: async () => { paints.length = 0; }, setPaused() {}, clearSpotlight() {}, cancelAnimations() {} }),
    setNarrationText() {}, setCurrentSegmentText() {}, resetBoardLayout() {} };
  const boardHook = load("features/tutor-session/hooks/useBoardSession.ts", commonReact, {
    "@/lib/boards/boardsClient": { ...requireApp("./lib/boards/boardsClient"), fetchBoardDetail: async () => { reads++; return currentDetail; }, createBoard: async () => { throw Error("positive read fixture must never create"); } },
    "../lib/turn/liveTurnSave": { ...requireApp("./features/tutor-session/lib/turn/liveTurnSave"), liveTurnSave: () => registry },
  });
  const board = boardHook.useBoardSession({ ...shared, sessionId: boardId, isDraft: false, router: { push() {} }, phase: "idle", speedMultiplier: 1,
    captureNotesEpoch: () => false, ttsClientRef: ref(null), voicePreferencesRef: ref({}), speedRef: ref(1), stopTurnRef: ref(null), replayAudioRef: ref(null), replayAudioPreloadRef: ref(new Map()),
    executeCommand: async (cmd: { type: string; text?: string; semanticRef?: { entityId?: string }; shownChars?: number }, options: { isCancelled?: () => boolean } = {}) => {
      if (paintWait) await paintWait;
      if (options.isCancelled?.()) return;
      if (paintFails) throw Error("paint failed");
      if (cmd.type === "TYPE") controller.revealBlockInstant(cmd.semanticRef?.entityId ?? "", cmd.shownChars);
      else if (cmd.type === "WRITE") paints.push(cmd.text ?? "");
    },
  } as never) as { storedTurnsRef: { current: StoredTurn[] }; refreshBoardFromTurns?: (boardId: string, turns: readonly StoredTurn[], current: () => boolean) => Promise<boolean>; settleBoardRestore: () => Promise<void> };
  const params = { ...shared, sessionId: boardId, phase: "idle", isReplaying: false, boardLoaded: true, enableKeyboardControls: false,
    boardPageRef: pageRef, boardShowsStoppedReplayRef: ref(false), refreshBoardFromTurns: board.refreshBoardFromTurns,
    pendingQuestionRef: ref(null), autoSubmitDoneRef: ref(null), phaseRef: ref("idle"), turnActiveRef: ref(false), pendingSegmentCountRef: ref(0), turnGenerationRef: ref(1),
    isPausedRef: ref(false), conversationHistoryRef: ref([]), currentTraceIdRef: ref(null), ttsClientRef: ref(null), ensureTTSClient: () => ({}),
    replayAudioRef: ref(null), replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()), turnAbortRef: ref(null), segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()), collectedSegmentsRef: ref([]), recordedSegmentsRef: ref([]),
    fbdPhaseMarkedRef: ref(false), segmentPlanStatsRef: ref({}), stopTurnRef: ref(null), replayGenerationRef: ref(0), replayCueRef: ref(null), turnTelemetryRef: ref(null),
    setPhase() {}, setIsPaused() {}, setInputInteracted() {}, setLastError() {}, setIsReplaying() {}, setReplayProgressMs() {}, setReplayTotalMs() {}, clearCancelTimers() {}, executeCommandWithCancel: async () => {}, boardLayoutRef: ref({ rects: [] }),
  };
  const controlRefs: Array<{ current: unknown }> = []; let refIndex = 0;
  const controlStates: unknown[] = []; let stateIndex = 0;
  const controlReact = { ...commonReact, useRef: (initial: unknown) => controlRefs[refIndex++] ?? (controlRefs[refIndex - 1] = ref(initial)),
    useState: (initial: unknown) => { const index = stateIndex++; if (!(index in controlStates)) controlStates[index] = initial;
      return [controlStates[index], (value: unknown) => { controlStates[index] = value; offers.push(value); }]; }, useEffect() {} };
  const asked: unknown[] = [];
  const controlHook = load("features/tutor-session/hooks/turn/useTurnControl.ts", controlReact, {
    "./useSegmentRunner": { useSegmentRunner: () => ({ runSegment: async () => {}, pauseFallbackSpeech() {}, resumeFallbackSpeech() {}, stopFallbackSpeech() {}, speakingNarrationRef: ref("") }) },
    "../../lib/turn/liveTurnSave": { ...requireApp("./features/tutor-session/lib/turn/liveTurnSave"), liveTurnSave: () => registry },
    "../../lib/turn/lessonOwnership": { lessonAdmission: () => ({ probe: async () => ownerState, hasAttempt: () => false, cancel() {} }) },
    "@/lib/boards/boardsClient": { ...requireApp("./lib/boards/boardsClient"), fetchBoardDetail: async () => { reads++; return controlRead ? controlRead() : currentDetail; } },
  });
  const handler = ref(async (_question: string, options: import("../../features/tutor-session/hooks/turn/types").HandleQuestionOptions | undefined) => { asked.push({ options, shown: controller.getState().revealedChars[block.id] }); });
  const render = () => { refIndex = 0; stateIndex = 0; return controlHook.useTurnControl(params as never, handler as never) as import("../../features/tutor-session/hooks/turn/types").TurnControlApi; };
  const control = render();
  return { controller, registry, board, control, render, handler, params, effects, offers, asked, paints,
    setDetail: (detail: typeof currentDetail) => { currentDetail = detail; }, setRead: (read: () => Promise<typeof currentDetail>) => { controlRead = read; },
    setOwner: (state: typeof ownerState) => { ownerState = state; },
    holdPaint: (wait: Promise<void> | null) => { paintWait = wait; }, failPaint: () => { paintFails = true; }, get reads() { return reads; } };
}
const defer = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
async function mountAndRetry(h: ReturnType<typeof fixture>, timers: Map<number, () => void>, fresh: StoredTurn[]) {
  const mount = h.effects.find(effect => effect.toString().includes("restoreBoardFromApiRef.current(sessionId")); assert(mount); mount(); await tick();
  await h.control.restorePausedLesson(h.board.storedTurnsRef.current);
  const retry = [...timers.values()].at(-1); assert(retry); timers.clear(); h.setDetail({ turns: fresh }); retry(); await tick();
}
function plainTurn(rows = 1): StoredTurn {
  const question = "Compute the work from a force and displacement.";
  return { ...turn(0), question, traceId: "plain", sceneArtifacts: { turnPlan: { schemaVersion: "turn-plan/v3", question, givens: [], lawIds: [], derived: [], unknowns: [], assumptions: ["planner unavailable"], qualitativeClaims: [], visualRequirement: "required" } },
    segments: Array.from({ length: rows }, (_, index) => ({ id: `plain-${index}`, orderIndex: index, narration: index ? `Explain step ${index}` : "", spokenText: index ? `Explain step ${index}` : "", audioUrl: null, durationMs: index ? null : 50, timings: null,
      command: index ? { type: "WRITE" as const, params: [90, 145 + index * 40, 28], text: `work = ${index}`, charPosition: 0, narrationBefore: "" } : { type: "CLEAR" as const, params: [], charPosition: 0, narrationBefore: "" } })) };
}
async function main() {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map<number, () => void>(); let timerId = 0;
  globalThis.setTimeout = ((fn: () => void) => { const id = ++timerId; timers.set(id, fn); return id; }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
  try {
    const h = fixture();
    const mount = h.effects.find(effect => effect.toString().includes("restoreBoardFromApiRef.current(sessionId")); assert(mount); mount(); await tick();
    assert.equal(h.controller.getState().revealedChars[block.id], 2, "opening snapshot has the old shown code prefix");
    assert.equal(await h.control.restorePausedLesson(h.board.storedTurnsRef.current), null, "fresh raw live status cannot be offered yet");
    const retry = [...timers.values()].at(-1); assert(retry); timers.clear(); h.setDetail({ turns: [turn(6)] }); retry(); await tick();
    assert(h.offers.at(-1), "fresh stopped parent is offered after its owner released");
    assert.equal(h.controller.getState().revealedChars[block.id], 6, "scheduled fresh Continue must restore the shown controller prefix before its offer");
    h.control.flushPausedLesson(); await tick();
    assert.equal((h.asked[0] as { shown: number }).shown, 6, "Continue starts from the same fresh page visible on screen");
    assert.equal(await h.board.refreshBoardFromTurns?.("other", [turn(10)], () => true), false, "actual hydration rejects a foreign board even before effect revisions advance");
    assert.equal(h.controller.getState().revealedChars[block.id], 6);
    // A newer plan must replace the opening controller, without showing future source.
    const changed = fixture(); const changedPlan = structuredClone(plan); changedPlan.title = "Fresh committed plan";
    await mountAndRetry(changed, timers, [{ ...turn(6), sceneArtifacts: { codeLesson: changedPlan } }]);
    assert.equal(changed.controller.getActivePlan()?.title, changedPlan.title);
    assert.equal(changed.controller.getState().revealedChars[block.id], 6);
    // The latest page replaces the former diagram/code surface and contains only its current rows.
    const page = fixture(); page.params.activeVerifiedDiagramRef.current = { old: true } as never;
    await mountAndRetry(page, timers, [plainTurn(3)]);
    assert.equal(page.controller.getActivePlan(), null); assert.equal(page.params.activeVerifiedDiagramRef.current, null);
    assert.deepEqual(page.paints, ["work = 1", "work = 2"]);
    assert.equal(page.params.liveQuestionRef.current, plainTurn().question);
    assert.equal(page.params.boardPageRef.current.lessonQuestion, plainTurn().question);
    // GETs racing a new owner or selected page cannot redraw it or install an offer.
    for (const mode of ["generation", "page", "foreign", "null", "error"] as const) {
      const denied = fixture(); const read = defer<{ turns: StoredTurn[] } | null>();
      denied.setRead(() => mode === "error" ? Promise.reject(Error("read failed")) : read.promise);
      await mountAndRetry(denied, timers, [turn(6)]);
      if (mode === "generation") denied.params.turnGenerationRef.current++;
      if (mode === "page") denied.params.boardPageRef.current = lessonPageRecord("board", "successor page");
      if (mode === "foreign") denied.params.boardPageRef.current.boardId = "other";
      read.resolve(mode === "null" ? null : { turns: [turn(6)] }); await tick();
      assert.equal(denied.controller.getState().revealedChars[block.id], 2, `${mode}: stale/failed/foreign source cannot redraw`);
      assert(!denied.offers.at(-1), `${mode}: no fresh continuation may start`);
    }
    // Publishing and clicking are both gated until actual hydration completes.
    const held = fixture(); const paint = defer<void>(); held.holdPaint(paint.promise);
    // Hold only the refresh, after the opening board actually loaded.
    held.holdPaint(null); const initial = held.effects.find(effect => effect.toString().includes("restoreBoardFromApiRef.current(sessionId")); assert(initial); initial(); await tick();
    await held.control.restorePausedLesson(held.board.storedTurnsRef.current);
    const retryHeld = [...timers.values()].at(-1); assert(retryHeld); timers.clear(); held.setDetail({ turns: [turn(6)] }); held.holdPaint(paint.promise); retryHeld(); await tick();
    held.control.flushPausedLesson(); assert.equal(held.asked.length, 0); assert(!held.offers.at(-1));
    paint.resolve(); await tick(); assert(held.offers.at(-1)); assert.equal(held.controller.getState().revealedChars[block.id], 6);
    const broken = fixture();
    const initialBroken = broken.effects.find(effect => effect.toString().includes("restoreBoardFromApiRef.current(sessionId")); assert(initialBroken); initialBroken(); await tick();
    await broken.control.restorePausedLesson(broken.board.storedTurnsRef.current); const retryBroken = [...timers.values()].at(-1); assert(retryBroken); timers.clear(); broken.setDetail({ turns: [turn(6)] }); broken.failPaint(); retryBroken(); await tick();
    assert(!broken.offers.at(-1), "failed hydration never publishes Continue");
    // Record-equivalent native empty resume: null resumeState, fallback plan, eleven untimed rows.
    const empty = fixture(); await mountAndRetry(empty, timers, [plainTurn(11)]);
    const finish = defer<void>(); empty.handler.current = async (_q, options) => {
      empty.asked.push({ options }); options?.onAdmission?.(true);
      empty.registry.begin({ owner: empty.params.cancelRef, generation: empty.params.turnGenerationRef.current, boardId: "board", traceId: "empty", kind: "resume", question: plainTurn().question,
        preview: "", speedMultiplier: 1, continuesBoard: true, page: empty.params.boardPageRef.current });
      empty.params.phase = "thinking"; empty.params.phaseRef.current = "thinking"; empty.params.turnActiveRef.current = true;
      await finish.promise;
    };
    empty.control.flushPausedLesson(); await tick();
    const thinking = empty.render(); thinking.stopTurn(); finish.resolve(); await tick();
    assert(empty.offers.at(-1), "empty admitted Stop keeps the original fallback parent offered");
    // A releasing owner can briefly hide the offer. Its scheduled positive read
    // must restore the original page before the owner-inactive offer returns.
    empty.setOwner("active");
    assert.equal(await thinking.restorePausedLesson([plainTurn(11)]), null);
    assert(!empty.offers.at(-1), "active owner conservatively hides Continue during release");
    const afterRelease = [...timers.values()].at(-1); assert(afterRelease); timers.clear();
    empty.setOwner("inactive"); empty.setDetail({ turns: [plainTurn(11)] }); afterRelease(); await tick();
    assert(empty.offers.at(-1), "owner-inactive reread restores the stopped fallback parent offer");
    assert.deepEqual(empty.paints, Array.from({ length: 10 }, (_, index) => `work = ${index + 1}`), "settled reread restores all saved visible work before Continue");
    assert((await thinking.restorePausedLesson([plainTurn(11)]))?.parentTurnId === "lesson", "settled fresh read preserves the original stopped parent with null resumeState");
    thinking.flushPausedLesson(); assert.equal(empty.asked.length, 2, "settled empty Stop still permits a second Continue"); finish.resolve(); await tick();
    console.log("verify-continue-board-refresh: actual retry read hydrates the visible page/controller before Continue");
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
