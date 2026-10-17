/** The real segment queue must persist terminal teaching failures before Stop closes it. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import type { TutorSegment } from "@heytutor/drawing";
import type { UseTurnLifecycleParams } from "../../features/tutor-session/hooks/turn/types";
import type { BoardPageRecord } from "../../features/tutor-session/lib/turn/doubtTurn";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { IncompleteCodeBeatError } from "../../features/tutor-session/lib/turn/turnFailurePolicy";
import { classifyTurnFailure } from "../../lib/obs/turnFailureClassification";
import { buildFailedTurnSentryEvent } from "../../lib/obs/failedTurnTelemetry";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const controlPath = path.join(app, "features/tutor-session/hooks/turn/useTurnControl.ts");
const ref = <T,>(current: T) => ({ current });
const noop = () => {};
const segment: TutorSegment = { narration: "Explain the next verified step.", command: null };
const env = { NODE_ENV: "production", SENTRY_ENVIRONMENT: "production", SENTRY_RELEASE: "a".repeat(40) };

function page(boardId = "offline-segment-board"): BoardPageRecord {
  return {
    boardId, lessonQuestion: "PRIVATE_SYNTHETIC_QUESTION", turnPlan: null, solverProjection: null,
    figureDrawn: true, failureTelemetry: { subject: "physics", requestCount: 2 },
    turn: { kind: "lesson", question: "PRIVATE_SYNTHETIC_QUESTION", continuesBoard: false, saved: false,
      scene: { sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "validated",
        sceneArtifacts: { turnPlan: { visualRequirement: "required" } } } },
  };
}

function mount(runSegment: () => Promise<void>) {
  const errors: unknown[] = [], receipts: Array<NonNullable<ReturnType<LiveTurnSaveRegistry["liveTurnFor"]>>> = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const registry = new LiveTurnSaveRegistry({
    // The save registry is real; the network boundary cannot reach any service.
    transport: { checkpoint: () => new Promise(() => {}), close: () => new Promise(() => {}) },
    setTimer: (callback) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimer: (id) => { timers.delete(id as number); },
    now: () => 1_000, isOnline: () => false, mintId: () => "offline-segment-turn",
  });
  const params = {
    sessionId: "offline-segment-board", phase: "speaking", isReplaying: false, boardLoaded: false, enableKeyboardControls: false,
    boardLayoutRef: ref({ rects: [], nextY: 142 }), boardPageRef: ref<BoardPageRecord | null>(page()),
    whiteboardRef: ref(null), boardShowsStoppedReplayRef: ref(false), pendingQuestionRef: ref(null), autoSubmitDoneRef: ref(null),
    phaseRef: ref("speaking"), isPausedRef: ref(false), rewoundRef: ref(false), conversationHistoryRef: ref([]),
    liveQuestionRef: ref("PRIVATE_SYNTHETIC_QUESTION"), ttsClientRef: ref(null), ensureTTSClient: () => ({ prefetchSegment: noop }),
    currentTraceIdRef: ref(null), replayAudioRef: ref(null), replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()),
    cancelRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1), turnAbortRef: ref(null),
    segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()), collectedSegmentsRef: ref<TutorSegment[]>([]),
    recordedSegmentsRef: ref([]), narrationSinceEpochRef: ref(""), activeVerifiedDiagramRef: ref(null), codeLessonControllerRef: ref(null),
    fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false), setActiveVerifiedDiagram: noop, segmentPlanStatsRef: ref({}),
    stopTurnRef: ref<(() => void) | null>(null), replayGenerationRef: ref(0), replayCueRef: ref(null), turnTelemetryRef: ref(null),
    setPhase: noop, setIsPaused: noop, setNarrationText: noop, setCurrentSegmentText: noop, setInputInteracted: noop,
    setLastError: (error: unknown) => errors.push(error), onError: () => captureStoppedReceipt(), setIsReplaying: noop,
    setReplayProgressMs: noop, setReplayTotalMs: noop, clearCancelTimers: noop, pendingSegmentCountRef: ref(0), executeCommandWithCancel: noop,
  };
  const captureStoppedReceipt = () => {
    registry.closeOwner(params.cancelRef);
    const receipt = registry.liveTurnFor(params.cancelRef, params.sessionId);
    assert(receipt, "the real save registry retains the already-taught lesson");
    receipts.push(structuredClone(receipt));
  };
  registry.begin({ owner: params.cancelRef, generation: 1, boardId: params.sessionId, traceId: null,
    kind: "lesson", question: "PRIVATE_SYNTHETIC_QUESTION", preview: "PRIVATE_SYNTHETIC_QUESTION",
    speedMultiplier: 1, continuesBoard: false, page: params.boardPageRef.current });
  registry.recordRow(params.cancelRef, 1, { orderIndex: 0, narration: "Previously taught step.", spokenText: "Previously taught step.",
    command: null, audioBytes: null, durationMs: null, timings: null }, { intro: false });
  params.stopTurnRef.current = () => { captureStoppedReceipt(); params.turnGenerationRef.current++; };
  const compiled = ts.transpileModule(readFileSync(process.env.TEACHING_SEGMENT_CONTROL_SOURCE ?? controlPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return { useRef: ref, useCallback: <T,>(fn: T) => fn, useEffect: noop,
      useState: (value: unknown) => [value, noop] };
    if (specifier === "@heytutor/tutor-core") return { ...core, tutorDebug: noop };
    if (specifier.endsWith("/liveTurnSave")) return { liveTurnSave: () => registry };
    if (specifier === "./useSegmentRunner") return { useSegmentRunner: () => ({ runSegment,
      pauseFallbackSpeech: noop, resumeFallbackSpeech: noop, stopFallbackSpeech: noop, speakingNarrationRef: ref("") }) };
    return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
      : specifier.startsWith(".") ? path.resolve(path.dirname(controlPath), specifier) : specifier);
  }, mod, mod.exports);
  const hooks = mod.exports as unknown as typeof import("../../features/tutor-session/hooks/turn/useTurnControl");
  const control = hooks.useTurnControl(params as unknown as UseTurnLifecycleParams, ref(async () => {}));
  return { params, control, registry, errors, receipts };
}

function checkFailureReceipt(receipt: NonNullable<ReturnType<LiveTurnSaveRegistry["liveTurnFor"]>>) {
  assert.equal(receipt.status, "stopped");
  assert.equal(receipt.visualStatus, "validated", "the already-visible verified diagram remains intact");
  assert(receipt.segments.some(row => row.narration === "Previously taught step."), "reporting preserves prior teaching rows");
  assert.equal(classifyTurnFailure(receipt).classification, "failed", "saved rows and a verified diagram cannot hide terminal teaching failure");
  const event = buildFailedTurnSentryEvent({ status: "stopped", visualStatus: receipt.visualStatus,
    sceneArtifacts: receipt.sceneArtifacts, segments: receipt.segments }, env);
  assert(event, "the actual saved scene metadata must build a failed-turn Sentry event");
  assert.equal(event.level, "error");
  assert.equal(event.tags.subject, "physics", "the terminal marker preserves the owning page subject");
  assert.equal(event.tags.stage, "teaching");
  assert.equal(event.tags.code, "teaching_segment_failed");
  assert.deepEqual(event.fingerprint, ["turn-failure", "teaching", "teaching_segment_failed", "physics"]);
  assert(!JSON.stringify(event).includes("PRIVATE_SYNTHETIC"), "question/error details cannot enter the content-free event");
}

async function terminalCodeFailure() {
  const h = mount(async () => { throw new IncompleteCodeBeatError("PRIVATE_SYNTHETIC_BLOCK", 20, 7,
    new Error("PRIVATE_SYNTHETIC_PROVIDER_ERROR")); });
  h.control.enqueueSegment(segment, 1);
  await h.params.segmentChainRef.current;
  assert.equal(h.errors.length, 1);
  assert(h.receipts.length > 0, "incomplete code closes the save");
  h.receipts.forEach(checkFailureReceipt);
  assert.equal(h.params.cancelRef.current, true);
  console.log("teaching segment incomplete code: first Stop receipt carries failure");
}

async function repeatedDrawFailure() {
  let runs = 0;
  const h = mount(async () => { runs++; throw new Error("PRIVATE_SYNTHETIC_DRAW_ERROR"); });
  for (let i = 0; i < 3; i++) h.control.enqueueSegment(segment, 1);
  await h.params.segmentChainRef.current;
  assert.equal(runs, 2, "existing abandonment policy stops later queued teaching");
  assert.equal(h.errors.length, 1);
  assert.equal(h.receipts.length, 1);
  checkFailureReceipt(h.receipts[0]!);
  console.log("teaching segment repeated draw: stopped receipt carries failure");
}

async function recoveredOrHealthy(recover: boolean) {
  let runs = 0;
  const h = mount(async () => { if (recover && runs++ % 2 === 0) throw new Error("recoverable draw hiccup"); });
  for (let i = 0; i < 4; i++) h.control.enqueueSegment(segment, 1);
  await h.params.segmentChainRef.current;
  assert.equal(h.params.cancelRef.current, false, "reporting cannot change the existing recovery policy");
  assert.equal(h.errors.length, 0);
  h.registry.closeOwner(h.params.cancelRef);
  const receipt = h.registry.liveTurnFor(h.params.cancelRef, h.params.sessionId)!;
  assert.equal(classifyTurnFailure(receipt).classification, "healthy");
  assert.equal(receipt.status, "stopped");
  assert.equal(buildFailedTurnSentryEvent({ status: "stopped", visualStatus: receipt.visualStatus,
    sceneArtifacts: receipt.sceneArtifacts, segments: receipt.segments }, env), null, "healthy or recovered teaching emits no failure event");
  console.log(`teaching segment ${recover ? "recovered hiccup" : "healthy"}: no failure event`);
}

async function obsoleteFailure(mode: "cancelled" | "generation" | "page" | "board") {
  let reject: ((error: Error) => void) | undefined;
  const h = mount(() => new Promise<void>((_resolve, rejectRun) => { reject = rejectRun; }));
  const originalPage = h.params.boardPageRef.current!;
  h.control.enqueueSegment(segment, 1);
  await Promise.resolve();
  assert(reject);
  if (mode === "cancelled") h.params.cancelRef.current = true;
  if (mode === "generation") h.params.turnGenerationRef.current++;
  if (mode === "page" || mode === "board") h.params.boardPageRef.current = {
    ...page(mode === "board" ? "other-board" : h.params.sessionId), failureTelemetry: { subject: "chemistry" },
  };
  reject(new IncompleteCodeBeatError("obsolete-block", 20, 7, new Error("obsolete ink")));
  await h.params.segmentChainRef.current;
  assert.notEqual(originalPage.failureTelemetry?.failed, true, "a no-longer-owned queued segment cannot mark its former page");
  assert.notEqual(h.params.boardPageRef.current?.failureTelemetry?.failed, true, "stale cleanup cannot mark a successor page");
  if (mode === "cancelled" || mode === "generation") assert.equal(h.errors.length, 0);
  h.registry.closeOwner(h.params.cancelRef);
  const receipt = h.registry.liveTurnFor(h.params.cancelRef, h.params.sessionId)!;
  assert.equal(receipt.status, "stopped");
  assert.equal(buildFailedTurnSentryEvent({ status: "stopped", visualStatus: receipt.visualStatus,
    sceneArtifacts: receipt.sceneArtifacts, segments: receipt.segments }, env), null, "obsolete cleanup cannot emit a failed-turn event");
  console.log(`teaching segment ${mode}: no obsolete failure marker`);
}

async function main() {
  const originalError = console.error;
  // These expected local queue errors are synthetic; the assertions inspect saved outcomes.
  console.error = noop;
  try {
    await terminalCodeFailure();
    await repeatedDrawFailure();
    await recoveredOrHealthy(false); await recoveredOrHealthy(true);
    for (const mode of ["cancelled", "generation", "page", "board"] as const) await obsoleteFailure(mode);
  } finally { console.error = originalError; }
  console.log("verify-teaching-segment-failure: 8 actual queue/save groups passed; no providers");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
