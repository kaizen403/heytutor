/** Opening-only recovery uses persistent hook state and explicit fresh lesson dispatch. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionInputChrome } from "../../features/tutor-session/components/SessionInputChrome";
import { doubtPageRecord, lessonPageRecord, type BoardPageRecord } from "../../features/tutor-session/lib/turn/doubtTurn";
import { buildEarlyLessonOpeningSegment } from "../../features/tutor-session/lib/turn/earlyLessonOpening";
import type { HandleQuestionOptions, TurnControlApi } from "../../features/tutor-session/hooks/turn/types";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import type { TutorSegment } from "@heytutor/drawing";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";

Object.defineProperty(globalThis, "React", { value: React, configurable: true });
const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const noop = () => {};
const ref = <T,>(current: T) => ({ current });
const question = "Derive the projectile range.\nExplain the assumptions precisely.";
const opening = buildEarlyLessonOpeningSegment();

/** The same ref/state slots survive every render, including effect cleanup. */
function reactSlots() {
  const slots: unknown[] = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  const effect = (fn: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = cursor++;
    const old = slots[index] as { deps?: readonly unknown[]; cleanup?: () => void } | undefined;
    if (old && deps && old.deps && deps.length === old.deps.length && deps.every((value, i) => Object.is(value, old.deps![i]))) return;
    effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
  };
  const api = {
    useRef(value: unknown) { const index = cursor++; return slots[index] ??= ref(value); },
    useState(value: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useCallback(fn: unknown, deps: readonly unknown[]) {
      const index = cursor++;
      const old = slots[index] as { value: unknown; deps: readonly unknown[] } | undefined;
      if (!old || deps.length !== old.deps.length || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[index] = { value: fn, deps };
      return (slots[index] as { value: unknown }).value;
    },
    useEffect: effect, useLayoutEffect: effect,
  };
  return { api, render<T>(fn: () => T): T { cursor = 0; const value = fn(); const ready = effects; effects = []; ready.forEach((run) => run()); return value; } };
}

function mount(codeLesson = false) {
  const slots = reactSlots();
  const speaking = ref(opening.narration);
  const page = ref<BoardPageRecord | null>({ ...lessonPageRecord("restart-board", question), earlyOpeningStarted: true });
  const params = {
    sessionId: "restart-board", phase: "speaking", isReplaying: false, boardLoaded: true, enableKeyboardControls: false,
    whiteboardRef: ref({ cancelAnimations: noop, setPaused: noop, clearSpotlight: noop }),
    pendingQuestionRef: ref(null), autoSubmitDoneRef: ref(null), phaseRef: ref("speaking"), isPausedRef: ref(false),
    rewoundRef: ref(false), conversationHistoryRef: ref([]), liveQuestionRef: ref(question), ttsClientRef: ref(null),
    ensureTTSClient: () => ({}), currentTraceIdRef: ref("opening-trace"), replayAudioRef: ref(null),
    replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()), cancelRef: ref(false), turnActiveRef: ref(true),
    turnGenerationRef: ref(1), turnAbortRef: ref(null), segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()),
    collectedSegmentsRef: ref([opening]), recordedSegmentsRef: ref([opening]), narrationSinceEpochRef: ref(opening.narration),
    storedTurnsRef: ref<StoredTurn[]>([]),
    activeVerifiedDiagramRef: ref(null), codeLessonControllerRef: ref(codeLesson
      ? { getActivePlan: () => getMockCodeLessonPlan("Explain LeetCode 20 Valid Parentheses") }
      : null), fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false),
    setActiveVerifiedDiagram: noop, segmentPlanStatsRef: ref({}), stopTurnRef: ref(null), replayGenerationRef: ref(0),
    replayCueRef: ref(null), turnTelemetryRef: ref(null), setPhase: noop, setIsPaused: noop, setNarrationText: noop,
    setCurrentSegmentText: noop, setInputInteracted: noop, setLastError: noop, setIsReplaying: noop,
    setReplayProgressMs: noop, setReplayTotalMs: noop, clearCancelTimers: noop, pendingSegmentCountRef: ref(0),
    executeCommandWithCancel: async () => {}, boardLayoutRef: ref({ rects: [], nextY: 100 }), boardPageRef: page,
    boardShowsStoppedReplayRef: ref(false),
  };
  const asked: Array<{ question: string; options?: HandleQuestionOptions }> = [];
  const owner = ref("inactive");
  const ownerProbes: string[] = [];
  const probeOwner = ref(async () => { ownerProbes.push(params.sessionId); return owner.current; });
  const admissionPending = ref(false);
  const handle = ref(async (text: string, options?: HandleQuestionOptions) => { asked.push({ question: text, options }); });
  const filename = path.join(app, "features/tutor-session/hooks/turn/useTurnControl.ts");
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as { useTurnControl?: (...args: unknown[]) => TurnControlApi } };
  const localRequire = (specifier: string) => {
    if (specifier === "react") return slots.api;
    if (specifier.endsWith("/turn/liveTurnSave")) return { liveTurnSave: () => ({ captureShown: noop, closeOwner: noop, turnIdFor: () => "opening-parent", isLiveHere: () => false, resumeTurns: (_board: string, turns: unknown) => turns }) };
    if (specifier.endsWith("/turn/lessonOwnership")) return { lessonAdmission: () => ({ probe: () => probeOwner.current(), cancel: noop, hasAttempt: () => admissionPending.current }) };
    if (specifier === "./useSegmentRunner") return { useSegmentRunner: () => ({ runSegment: async () => {}, pauseFallbackSpeech: noop, resumeFallbackSpeech: noop, stopFallbackSpeech: noop, speakingNarrationRef: speaking }) };
    return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(filename), specifier) : specifier);
  };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", compiled)(localRequire, mod, mod.exports, () => 1, noop);
  const render = () => slots.render(() => mod.exports.useTurnControl!({ ...params, phase: params.phaseRef.current }, handle));
  return { params, asked, render, handle, owner, ownerProbes, probeOwner, admissionPending, speaking, control: render() };
}

function restartButton(control: TurnControlApi) {
  const props = {
    isInputOverlay: false, phase: "idle" as const, isPaused: false, inputSubmitMode: "follow-up" as const,
    onSubmit: noop, onAskDoubt: noop, onPauseToggle: noop, onCancel: noop, onUserInteractionChange: noop,
    earlyLessonRestartOffer: control.earlyLessonRestartOffer, onRestartEarlyLesson: control.restartEarlyLesson,
    earlyLessonRestartReason: control.earlyLessonRestartReason,
    pausedLessonOffer: control.pausedLessonOffer,
  };
  const html = renderToStaticMarkup(React.createElement(SessionInputChrome, props));
  assert(html.includes("Teach it again") && !html.includes("Continue lesson") && !html.includes("not saved"),
    "the actual input renders a restart without false continuation or unsaved copy");
  assert.equal(html.includes("Your doubt is answered."), control.earlyLessonRestartReason === "doubt",
    "restart uses its own doubt/Stop copy, independent of Continue state");
  const chrome = SessionInputChrome(props);
  const bar = (chrome.props.children as React.ReactElement[])[0]!;
  const renderBar = bar.type as (props: unknown) => React.ReactElement;
  const tree = renderBar(bar.props);
  assert(!/\b(?:fixed|absolute|inset-0)\b/.test((tree.props as { className: string }).className),
    "restart keeps the existing inline chrome instead of covering the doubt board");
  const buttons = ((tree.props as { children: React.ReactElement[] }).children[1]!.props as { children: React.ReactElement[] }).children;
  const button = buttons.find((child) => (child.props as { children: unknown }).children === "Teach it again");
  assert(button, "the real bar exposes a native Teach it again button");
  return (button.props as { onClick: () => void }).onClick;
}

const epoch = { id: "epoch", orderIndex: 0, narration: "", spokenText: "", audioUrl: null, durationMs: null, timings: null,
  command: { type: "CLEAR" as const, params: [], charPosition: 0, narrationBefore: "" } };
const savedLesson: StoredTurn = {
  id: "opening-parent", orderIndex: 0, question, rawResponse: opening.narration, speedMultiplier: 1,
  traceId: "opening-trace", kind: "lesson", status: "stopped", persistedStatus: "stopped",
  sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
  resumeState: { v: 1, earlyOpeningOnly: true }, segments: [epoch, { ...epoch, id: "opening", orderIndex: 1,
    narration: opening.narration, spokenText: opening.narration, command: null }],
};
const savedDoubt: StoredTurn = { ...savedLesson, id: "saved-doubt", orderIndex: 1, kind: "doubt", question: "Clarify the symbols",
  status: "complete", persistedStatus: "complete", resumeState: null, sceneArtifacts: boardContinuationArtifacts(question),
  segments: [{ ...epoch, id: "doubt", narration: "The symbol denotes launch speed.", spokenText: "The symbol denotes launch speed.",
    command: { type: "WRITE", text: "u: launch speed", params: [90, 140], charPosition: 0, narrationBefore: "" } }],
};
const idleRuntime = (shell: ReturnType<typeof mount>) => {
  shell.params.phaseRef.current = "idle"; shell.params.turnActiveRef.current = false; shell.speaking.current = "";
};
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
async function main() {
  for (const heard of [false, true]) {
    const shell = mount();
    if (!heard) { shell.params.recordedSegmentsRef.current = []; shell.speaking.current = ""; }
    shell.control.stopTurn();
    const idle = shell.render();
    assert.equal(idle.pausedLessonOffer, false);
    assert.equal(idle.earlyLessonRestartOffer, true, "opening-only Stop remains visible after rerender");
    assert.equal(shell.asked.length, 0, "Stop itself never starts planning again");
    restartButton(idle)();
    assert.equal(shell.asked.length, 1); assert.equal(shell.asked[0]!.question, question);
    assert.equal(shell.asked[0]!.options?.resume, undefined); assert.equal(shell.asked[0]!.options?.doubt, undefined);
  }
  // A locally stopped opening is newer than the last save receipt. Stale reads
  // must not revoke its page/generation identity before ordinary admission.
  const laggingReceipts: Array<{ name: string; freshDispatches: number }> = [];
  for (const [name, turns] of [
    ["earlier completed lesson", [{ ...savedLesson, id: "prior-lesson", question: "An earlier lesson",
      status: "complete", persistedStatus: "complete" }]],
    ["current progressive live receipt", [{ ...savedLesson, status: "live", persistedStatus: "live", updatedAt: Date.now() }]],
    ["pending stopped save", [{ ...savedLesson, status: "stopped", persistedStatus: "live", updatedAt: Date.now() }]],
  ] as const) {
    const shell = mount(); shell.params.storedTurnsRef.current = [...turns];
    shell.control.stopTurn(); const idle = shell.render();
    assert.equal(idle.earlyLessonRestartOffer, true, `${name} leaves the captured live offer visible`);
    restartButton(idle)();
    laggingReceipts.push({ name, freshDispatches: shell.asked.length });
    if (shell.asked.length) {
      assert.equal(shell.asked[0]!.question, question);
      assert.equal(shell.asked[0]!.options?.resume, undefined); assert.equal(shell.asked[0]!.options?.doubt, undefined);
    }
  }
  assert.deepEqual(laggingReceipts, laggingReceipts.map(({ name }) => ({ name, freshDispatches: 1 })),
    "lagging receipts must not erase legitimate live restart clicks");
  for (const [name, segment] of [
    ["teaching speech", { narration: "The horizontal speed stays constant.", command: null }],
    ["silent WRITE", { narration: "", command: { type: "WRITE", text: "setup", params: [], charPosition: 0, narrationBefore: "" } }],
    ["unknown historical command", { narration: "", command: { unknown: true } }],
    ["narrated CLEAR", { narration: opening.narration, command: epoch.command }],
  ] as const) {
    const shell = mount();
    shell.params.recordedSegmentsRef.current = [opening, segment as TutorSegment];
    shell.control.stopTurn(); const idle = shell.render();
    assert.equal(idle.earlyLessonRestartOffer, false, `${name} remains substantive in the actual Stop hook`);
    assert.equal(idle.pausedLessonOffer, true, `${name} retains the legacy Continue behavior`);
  }
  // A doubt may overwrite the page and live title, but the original request remains.
  {
    const shell = mount(); shell.control.handleAskDoubt("What does this symbol mean?");
    assert.equal(shell.asked.length, 1); assert(shell.asked[0]!.options?.doubt);
    shell.params.boardPageRef.current = doubtPageRecord({ boardId: "restart-board", lessonQuestion: question,
      title: "Clarify the symbols", continuesBoard: true, figureDrawn: false, turnPlan: null, solverProjection: null });
    shell.params.liveQuestionRef.current = "composed doubt prompt";
    shell.params.storedTurnsRef.current = [savedLesson, savedDoubt];
    shell.params.recordedSegmentsRef.current = [{ narration: savedDoubt.segments[0]!.narration, command: null, delivery: "opening" }];
    idleRuntime(shell); shell.render().offerPausedLessonResume();
    const before = structuredClone(shell.params.boardLayoutRef.current);
    const idle = shell.render(); assert.equal(idle.pausedLessonOffer, false);
    restartButton(idle)(); assert.equal(shell.asked[1]!.question, question);
    assert.deepEqual(shell.params.boardLayoutRef.current, before, "offering/clicking never erases saved doubt ink");
  }
  // Interrupting a doubt cannot turn the original unplanned lesson into a
  // null-authority Continue. Substantive and code lessons keep Continue.
  for (const progress of ["substantive", "code-lesson", "opening-only"] as const) {
    const shell = mount(progress === "code-lesson");
    if (progress === "substantive") {
      shell.params.recordedSegmentsRef.current = [opening, { narration: "The horizontal speed stays constant.", command: null }];
    }
    if (progress === "code-lesson") shell.params.boardPageRef.current!.earlyOpeningStarted = false;
    shell.control.stopTurn();
    const stopped = shell.render();
    assert.equal(stopped.earlyLessonRestartOffer, progress === "opening-only");
    assert.equal(stopped.pausedLessonOffer, progress !== "opening-only");
    stopped.handleAskDoubt("What does this symbol mean?");
    assert.equal(shell.asked.length, 1);
    assert.equal(shell.asked[0]!.options?.doubt?.lessonQuestion, question);

    // Admit the first doubt as the real handler does: a new generation and
    // doubt page, without copying the opening-only lesson's runtime marker.
    shell.params.turnGenerationRef.current += 1;
    shell.params.cancelRef.current = false;
    shell.params.turnActiveRef.current = true;
    shell.params.phaseRef.current = "speaking";
    shell.params.boardPageRef.current = doubtPageRecord({ boardId: "restart-board", lessonQuestion: question,
      title: "Clarify the symbols", continuesBoard: true, figureDrawn: false, turnPlan: null, solverProjection: null });
    const firstDoubtSegment: TutorSegment = { narration: "The symbol denotes launch speed.", command: null };
    shell.params.recordedSegmentsRef.current = [firstDoubtSegment];
    shell.speaking.current = firstDoubtSegment.narration;
    assert.equal(shell.params.boardPageRef.current.earlyOpeningStarted, undefined);
    const firstGeneration = shell.params.turnGenerationRef.current;
    shell.render().handleAskDoubt("Which direction is positive?");
    assert.equal(shell.params.turnGenerationRef.current, firstGeneration + 1,
      "nested doubt invalidates the interrupted first doubt's generation");
    assert.equal(shell.asked.length, 2, "the nested doubt dispatches once after the interrupted doubt stops");
    assert.equal(shell.asked[1]!.options?.doubt?.lessonQuestion, question);

    // Complete the second admitted doubt and publish the ordinary follow-up.
    shell.params.turnGenerationRef.current += 1;
    shell.params.cancelRef.current = false;
    shell.params.boardPageRef.current = doubtPageRecord({ boardId: "restart-board", lessonQuestion: question,
      title: "Clarify the direction", continuesBoard: true, figureDrawn: false, turnPlan: null, solverProjection: null });
    shell.params.recordedSegmentsRef.current = [{ narration: "Choose the positive direction consistently.", command: null }];
    const original = progress === "substantive"
      ? { ...savedLesson, segments: [{ ...savedLesson.segments[1]!, narration: "The horizontal speed stays constant." }] }
      : progress === "code-lesson"
        ? { ...savedLesson, resumeState: null, sceneArtifacts: { codeLesson: getMockCodeLessonPlan("Explain LeetCode 20 Valid Parentheses") } }
        : savedLesson;
    shell.params.storedTurnsRef.current = [original,
      { ...savedDoubt, status: "stopped", persistedStatus: "stopped" },
      { ...savedDoubt, id: "second-doubt", orderIndex: 2, question: "Clarify the direction" }];
    const savedBefore = structuredClone(shell.params.storedTurnsRef.current);
    const boardBefore = structuredClone(shell.params.boardLayoutRef.current);
    idleRuntime(shell);
    shell.render().offerPausedLessonResume();
    const completed = shell.render();
    assert.equal(completed.pausedLessonOffer, progress !== "opening-only",
      `${progress}: a nested doubt never invents Continue for an unfinished original lesson`);
    assert.equal(completed.earlyLessonRestartOffer, progress === "opening-only",
      `${progress}: completion preserves the original recovery action`);
    if (progress === "opening-only") {
      assert.equal(completed.earlyLessonRestartReason, "doubt");
      const click = restartButton(completed);
      click(); click();
      assert.equal(shell.asked.length, 3, "Teach it again after nested doubts is still single-flight");
      assert.equal(shell.asked[2]!.question, question, "restart retains the full original multiline question, not either doubt");
      assert.equal(shell.asked[2]!.options?.resume, undefined);
      assert.equal(shell.asked[2]!.options?.doubt, undefined);
    }
    assert.deepEqual(shell.params.storedTurnsRef.current, savedBefore,
      "nested recovery does not rewrite the saved opening or doubt chain");
    assert.deepEqual(shell.params.boardLayoutRef.current, boardBefore,
      "nested recovery leaves the visible doubt work intact");
  }
  // The same saved chain recovers on reload, under the existing ownership checks.
  {
    const shell = mount(); idleRuntime(shell);
    shell.params.boardPageRef.current = doubtPageRecord({ boardId: "restart-board", lessonQuestion: question,
      title: savedDoubt.question, continuesBoard: true, figureDrawn: false, turnPlan: null, solverProjection: null });
    shell.params.storedTurnsRef.current = [savedLesson, savedDoubt];
    assert.equal(await shell.control.restorePausedLesson([savedLesson, savedDoubt]), null);
    assert.equal(shell.asked.length, 0);
    restartButton(shell.render())(); assert.equal(shell.asked[0]!.question, question);
  }
  for (const ownerState of ["active", "unknown"]) {
    const shell = mount(); idleRuntime(shell); shell.owner.current = ownerState;
    await shell.control.restorePausedLesson([savedLesson, savedDoubt]);
    assert.equal(shell.render().earlyLessonRestartOffer, false, `${ownerState} ownership cannot authorize restart recovery`);
  }
  for (const turns of [[{ ...savedLesson, status: "complete" as const, persistedStatus: "complete" as const }],
    [savedLesson, { ...savedLesson, id: "newer-page", orderIndex: 2, status: "complete" as const, persistedStatus: "complete" as const }]]) {
    const shell = mount(); idleRuntime(shell); await shell.control.restorePausedLesson(turns);
    assert.equal(shell.render().earlyLessonRestartOffer, false, "completed/current newer page never recovers an old opening");
  }
  // A pending click is single-flight, and a declined fresh admission restores its local request.
  {
    const shell = mount(); shell.control.stopTurn(); let receipt: ((ok: boolean) => void) | undefined;
    shell.handle.current = async (text, options) => {
      shell.asked.push({ question: text, options }); receipt = options?.onAdmission;
      shell.render().clearPausedLesson(); return new Promise<void>(() => {});
    };
    const click = restartButton(shell.render()); click(); click(); assert.equal(shell.asked.length, 1);
    receipt!(false); assert.equal(shell.render().earlyLessonRestartOffer, true);
    restartButton(shell.render())(); assert.equal(shell.asked.length, 2);
    receipt!(true); assert.equal(shell.render().earlyLessonRestartOffer, false);
  }
  // A declined restored click keeps receipt provenance even if admission clears
  // its refs. A later complete receipt must still invalidate the restored offer.
  {
    const shell = mount(); idleRuntime(shell); shell.params.storedTurnsRef.current = [savedLesson];
    await shell.control.restorePausedLesson([savedLesson]);
    let receipt: ((ok: boolean) => void) | undefined;
    shell.handle.current = async (text, options) => {
      shell.asked.push({ question: text, options }); receipt = options?.onAdmission;
      shell.render().clearPausedLesson(); return new Promise<void>(() => {});
    };
    restartButton(shell.render())(); receipt!(false);
    assert.equal(shell.render().earlyLessonRestartOffer, true);
    shell.params.storedTurnsRef.current = [{ ...savedLesson, status: "complete", persistedStatus: "complete" }];
    restartButton(shell.render())();
    assert.equal(shell.asked.length, 1, "declined admission must not turn a restored offer into live authority");
    assert.equal(shell.render().earlyLessonRestartOffer, false);
  }
  // A stale admission callback cannot put another board's offer back.
  {
    const shell = mount(); shell.control.stopTurn(); let receipt: ((ok: boolean) => void) | undefined;
    shell.handle.current = async (_text, options) => { receipt = options?.onAdmission; return new Promise<void>(() => {}); };
    restartButton(shell.render())(); shell.params.sessionId = "successor-board";
    shell.params.boardPageRef.current = lessonPageRecord("successor-board", "A new question");
    shell.render(); receipt!(false); assert.equal(shell.render().earlyLessonRestartOffer, false);
  }
  // Playback invalidates the live page, not the trusted original restart.
  // Both natural completion and Stop may leave a null page behind.
  for (const stopped of [false, true]) {
    const shell = mount(); shell.control.stopTurn();
    shell.params.isReplaying = true; shell.params.phaseRef.current = "speaking";
    shell.params.boardPageRef.current = null; shell.params.replayGenerationRef.current += 1;
    const replaying = shell.render(); replaying.restartEarlyLesson();
    assert.equal(shell.asked.length, 0, "an active replay still blocks restarting");
    if (stopped) replaying.stopTurn();
    shell.params.isReplaying = false; shell.params.rewoundRef.current = true; idleRuntime(shell);
    const idle = shell.render();
    assert.equal(idle.earlyLessonRestartOffer, true, "playback preserves the explicit original restart offer");
    const before = structuredClone(shell.params.boardLayoutRef.current);
    shell.handle.current = async (text, options) => {
      shell.asked.push({ question: text, options });
      // The ordinary handler clears stale offers before admission. A declined
      // attempt must retain this replay-scoped request, not erase itself.
      shell.render().clearPausedLesson(); options?.onAdmission?.(false);
    };
    restartButton(idle)();
    assert.equal(shell.asked.length, 1, `${stopped ? "stopped" : "completed"} replay permits exactly one fresh restart`);
    assert.equal(shell.asked[0]!.question, question);
    assert(!shell.asked[0]!.options?.resume && !shell.asked[0]!.options?.doubt);
    assert.deepEqual(shell.params.boardLayoutRef.current, before, "restart itself does not clear replay ink before admission");
    assert.equal(shell.render().earlyLessonRestartOffer, true, "declined admission keeps the replay-scoped restart visible");
    shell.handle.current = async (text, options) => {
      shell.asked.push({ question: text, options }); shell.render().clearPausedLesson(); options?.onAdmission?.(true);
    };
    restartButton(shell.render())();
    assert.equal(shell.asked.length, 2, "the retained restart permits a later fresh admitted attempt");
    assert.equal(shell.render().earlyLessonRestartOffer, false, "accepted admission consumes the offer exactly once");
  }
  {
    const shell = mount(); idleRuntime(shell); shell.params.boardShowsStoppedReplayRef.current = true;
    const beforePage = shell.params.boardPageRef.current;
    assert.equal(await shell.control.restorePausedLesson([savedLesson]), null);
    assert.equal(shell.ownerProbes.length, 0, "stopped-replay restoration must stop before even probing stored ownership");
    assert.equal(shell.render().earlyLessonRestartOffer, false, "stored recovery cannot replace the stopped replay's page");
    assert.equal(shell.params.boardPageRef.current, beforePage);
  }
  {
    const shell = mount(); idleRuntime(shell);
    let finishProbe!: (owner: string) => void;
    shell.probeOwner.current = () => new Promise<string>((resolve) => { finishProbe = resolve; });
    const recovery = shell.control.restorePausedLesson([savedLesson]);
    shell.params.boardShowsStoppedReplayRef.current = true;
    shell.params.boardPageRef.current = null;
    finishProbe("inactive"); await recovery;
    assert.equal(shell.render().earlyLessonRestartOffer, false,
      "a stopped replay reached during an ownership read invalidates that stale restore");
  }
  for (const guard of ["replay", "stopped-replay", "rewound", "unobserved-null-page", "new-generation", "admission", "different-page", "same-text-page", "completed-saved", "newer-saved", "live-saved", "fresh-question"] as const) {
    const shell = mount();
    if (guard === "completed-saved" || guard === "newer-saved" || guard === "live-saved") {
      idleRuntime(shell); shell.params.storedTurnsRef.current = [savedLesson];
      await shell.control.restorePausedLesson([savedLesson]);
    } else shell.control.stopTurn();
    const idle = shell.render();
    if (guard === "replay") { shell.params.isReplaying = true; shell.render(); }
    if (guard === "stopped-replay") shell.params.boardShowsStoppedReplayRef.current = true;
    if (guard === "rewound") shell.params.rewoundRef.current = true;
    if (guard === "unobserved-null-page") shell.params.boardPageRef.current = null;
    if (guard === "new-generation") shell.params.turnGenerationRef.current += 1;
    if (guard === "admission") shell.admissionPending.current = true;
    if (guard === "different-page") shell.params.boardPageRef.current = lessonPageRecord("restart-board", "A different question");
    if (guard === "same-text-page") shell.params.boardPageRef.current = lessonPageRecord("restart-board", question);
    if (guard === "completed-saved") shell.params.storedTurnsRef.current = [{ ...savedLesson, status: "complete", persistedStatus: "complete" }];
    if (guard === "newer-saved") shell.params.storedTurnsRef.current = [savedLesson, { ...savedLesson, id: "newer-same-text", orderIndex: 2,
      status: "complete", persistedStatus: "complete" }];
    if (guard === "live-saved") shell.params.storedTurnsRef.current = [{ ...savedLesson, status: "live", persistedStatus: "live", updatedAt: Date.now() }];
    if (guard === "fresh-question") idle.clearPausedLesson();
    idle.restartEarlyLesson(); assert.equal(shell.asked.length, 0, `${guard} blocks a stale restart click`);
  }
  for (const guard of ["generation", "different-page", "different-board", "newer-receipt"] as const) {
    const shell = mount(); idleRuntime(shell); shell.params.storedTurnsRef.current = [savedLesson];
    await shell.control.restorePausedLesson([savedLesson]);
    shell.params.isReplaying = true; shell.params.boardPageRef.current = null; shell.render();
    shell.params.isReplaying = false; shell.render();
    if (guard === "generation") shell.params.turnGenerationRef.current += 1;
    if (guard === "different-page") shell.params.boardPageRef.current = lessonPageRecord("restart-board", question);
    if (guard === "different-board") { shell.params.sessionId = "successor-board"; shell.render(); }
    if (guard === "newer-receipt") shell.params.storedTurnsRef.current = [savedLesson,
      { ...savedLesson, id: "newer-page", orderIndex: 2, status: "complete", persistedStatus: "complete" }];
    shell.render().restartEarlyLesson();
    assert.equal(shell.asked.length, 0, `observed replay does not bypass ${guard} authority`);
  }
  await settle();
  console.log("verify-early-opening-restart: mounted Stop/doubt/reload state, rendered native button, exact fresh dispatch and stale/admission guards passed");
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
