import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { getSegmentCommands, serializeSegmentCommands, verifiedDiagramCommandToDrawCommand, type DrawCommand, type TutorSegment } from "@heytutor/drawing";
import { classifyDsaQuestion, mathToSpeech, voiceSettingsForDelivery, normalizeTutorQuestion, type SpeakSegmentOptions, type TTSClient } from "@heytutor/tutor-core";
import { validateTurnPlanV3, synthesizeFamilyScene, type TurnPlanV3, type ProblemIR } from "@heytutor/scene-engine";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { forgetVerifiedScene } from "../../features/tutor-session/lib/scene/verifiedSceneRecovery";
import { createEmptySegmentPlanStats } from "../../features/tutor-session/lib/turn/segmentPlanning";
import type { HandleQuestionOptions, UseTurnLifecycleParams, TurnControlApi } from "../../features/tutor-session/hooks/turn/types";
import { lessonPageRecord, pausedLessonFromLive, type PausedLessonRequest } from "../../features/tutor-session/lib/turn/doubtTurn";
import { pausedLessonFromStoredTurns } from "../../features/tutor-session/lib/turn/pausedLessonRestore";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { buildEarlyLessonOpeningSegment } from "../../features/tutor-session/lib/turn/earlyLessonOpening";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
requireApp("konva");
const react = {
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useEffect() {},
  useLayoutEffect: (commit: () => void) => commit(),
  useState: (value: unknown) => [value, () => {}],
};
const projectileQuestion = "Derive the formula for the range of a projectile on level ground, and show why 45° gives the maximum range.";
const qualitativeQuestion = "Derive the formula for the range of a projectile on level ground.";
const symbolicPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: qualitativeQuestion,
  givens: [],
  unknowns: [{ id: "range", symbol: "R" }],
  derived: [],
  qualitativeClaims: [
    { id: "range", claim: "R = u^2 sin(2 theta) / g", expected: "u^2 sin(2 theta) / g", relatedQuantityIds: ["range"] },
  ],
  lawIds: ["constant-acceleration"],
  assumptions: ["Air resistance is negligible"],
  visualRequirement: "required",
};
const recordedPlan: TurnPlanV3 = {
  ...symbolicPlan,
  question: normalizeTutorQuestion(projectileQuestion),
  unknowns: [...symbolicPlan.unknowns, { id: "maximum_angle", symbol: "theta_max" }],
  qualitativeClaims: [...symbolicPlan.qualitativeClaims,
    { id: "maximum_angle", claim: "A launch angle of 45 degrees maximizes the level-ground range", expected: "The maximum range occurs at 45 degrees", relatedQuantityIds: ["maximum_angle"] }],
};
const numericQuestion = "A projectile is launched at 20 m/s and an angle of 30 degrees on level ground. Find its range.";
const numericPlan: TurnPlanV3 = {
  ...symbolicPlan,
  question: numericQuestion,
  givens: [
    { id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given" },
    { id: "theta", symbol: "theta", value: 30, unit: "deg", provenance: "given" },
    { id: "g", symbol: "g", value: 9.8, unit: "m/s^2", provenance: "given" },
  ],
  unknowns: [{ id: "range", symbol: "R", unit: "m" }],
  derived: [{ id: "range", symbol: "R", value: 400 * Math.sin(Math.PI / 3) / 9.8, unit: "m", provenance: "derived", sourceText: "R = 20^2 * sin(pi / 3) / 9.8" }],
  qualitativeClaims: [],
};
const failedCompileQuestion = "Plot y = 1/x from x = -1 to x = 1 and shade the region below the graph.";
const failedCompilePlan: TurnPlanV3 = {
  ...symbolicPlan,
  question: failedCompileQuestion,
  unknowns: [],
  derived: [],
  qualitativeClaims: [],
};
const dsaQuestion = "Explain how breadth-first search visits nodes in a graph.";
const dsaPlan: TurnPlanV3 = {
  ...symbolicPlan, question: dsaQuestion, unknowns: [], qualitativeClaims: [], lawIds: [],
  assumptions: [], visualRequirement: "optional",
};
assert(classifyDsaQuestion(dsaQuestion).isDsa, "the exclusion fixture must enter the real DSA lane");
assert(validateTurnPlanV3(symbolicPlan, symbolicPlan.question).plan, "the symbolic fixture must be a real valid TurnPlanV3");
assert(validateTurnPlanV3(recordedPlan, recordedPlan.question).plan, "the recorded-question fixture must be a real valid TurnPlanV3");
const numericValidation = validateTurnPlanV3(numericPlan, numericQuestion);
assert(numericValidation.plan, `the numeric fixture must be a real valid TurnPlanV3: ${JSON.stringify(numericValidation)}`);
assert(selectFastVerifiedRepresentation({ question: symbolicPlan.question, turnPlan: symbolicPlan }), "the source-valid projectile must compile without a scene model");
assert(selectFastVerifiedRepresentation({ question: recordedPlan.question, turnPlan: recordedPlan }), "the source-stated angle must retain its verified deterministic figure");
assert.equal(selectFastVerifiedRepresentation({ question: numericQuestion, turnPlan: numericPlan }), null, "the numeric fixture must retain normal model validation");
assert.equal(synthesizeFamilyScene({ question: failedCompileQuestion, turnPlan: failedCompilePlan }), null, "the pole-crossing fixture must genuinely fail the deterministic family compile");

type Mode = "ready" | "recorded-projectile" | "numeric" | "failed-compile" | "retry" | "prefix-stall" | "partial-stall" | "pause-stall" | "pause-prelude" | "control-eof" | "one-step-stall" | "one-step-split-stall" | "resume-no-ink" | "retry-expires" | "stop-before-expiry" | "stop-during-retry" | "stale-content" | "marker-only" | "hedge-wins" | "hedge-primary-wins" | "hedge-fails" | "early-on" | "early-off" | "early-stop" | "early-pause" | "early-dsa" | "early-doubt" | "early-resume" | "intro-draw-failure";
type Event = { atMs: number; name: string; data?: unknown };
const HELD_PLANNER_MS = 15_000; // Below the real first-attempt and total plan deadlines.

function openingOnlyStoredTurn(): StoredTurn {
  const opening = buildEarlyLessonOpeningSegment();
  return {
    id: "early-opening-only-parent", orderIndex: 0, question: qualitativeQuestion,
    rawResponse: opening.narration, speedMultiplier: 1, traceId: "early-opening-only-trace",
    kind: "lesson", status: "stopped", persistedStatus: "stopped",
    sceneDocument: null, sceneEngineVersion: null, validationReport: null,
    visualStatus: "text_only", sceneArtifacts: null,
    resumeState: { v: 1, earlyOpeningOnly: true },
    segments: [{ id: "early-opening-only-segment", orderIndex: 0, narration: opening.narration,
      spokenText: opening.narration, command: null, audioUrl: null, durationMs: null, timings: null }],
  };
}

function verifyOpeningOnlyReload() {
  const stopped = openingOnlyStoredTurn();
  assert.equal(pausedLessonFromStoredTurns([stopped], { boardId: "opening-only-board", ownerState: "inactive" }), null,
    "a saved/reloaded opening-only stop must not offer Continue with a null turnPlan");
  const unmarked = { ...stopped, resumeState: null };
  assert(pausedLessonFromStoredTurns([unmarked], { boardId: "opening-only-board", ownerState: "inactive" }),
    "the opaque opening marker must not suppress a legacy substantive text-only lesson");
  const substantial = { ...stopped, segments: [{ ...stopped.segments[0]!, narration: "The horizontal speed stays constant." }] };
  assert(pausedLessonFromStoredTurns([substantial], { boardId: "opening-only-board", ownerState: "inactive" }),
    "a stale opening marker must not discard genuine teaching speech");
  const planned = { ...stopped, sceneArtifacts: { turnPlan: symbolicPlan } };
  assert(pausedLessonFromStoredTurns([planned], { boardId: "opening-only-board", ownerState: "inactive" }),
    "a completed authoritative plan must not be discarded by an old opening marker");
  const figure = { ...stopped, segments: [{ ...stopped.segments[0]!, command: serializeSegmentCommands([
    { type: "DRAW_LINE", params: [500, 200, 700, 300], charPosition: 0, narrationBefore: "" },
  ], { trustedDiagramGeometry: true }) }] };
  assert(pausedLessonFromStoredTurns([figure], { boardId: "opening-only-board", ownerState: "inactive" }),
    "actual trusted figure ink remains substantive even with an old opening marker");
  return { mode: "early-reload", cases: 5 };
}

function verifyOpeningOnlyDoubtSnapshot() {
  const page = { ...lessonPageRecord("opening-only-board", qualitativeQuestion), earlyOpeningStarted: true };
  const input = { record: page, boardId: page.boardId, lessonQuestion: qualitativeQuestion,
    codeLesson: false, figureDrawn: false, interruptedStep: buildEarlyLessonOpeningSegment().narration };
  assert.equal(pausedLessonFromLive(input), null,
    "a doubt asked during opening-only planning cannot resume an unplanned lesson with a null turnPlan");
  assert(pausedLessonFromLive({ ...input, record: { ...page, turnPlan: symbolicPlan } }),
    "a planned live lesson must retain its genuine doubt continuation");
  assert(pausedLessonFromLive({ ...input, record: { ...page, earlyOpeningStarted: false } }),
    "the default-off legacy planning snapshot remains unchanged");
  assert(pausedLessonFromLive({ ...input, figureDrawn: true }),
    "a figure already on the board remains a genuine continuation");
  return { mode: "early-opening-doubt", cases: 4 };
}

const HEDGE_MODES: Mode[] = ["hedge-wins", "hedge-primary-wins", "hedge-fails"];

async function scenario(mode: Mode, hedgeEnabled = false, earlyEnabled = false) {
  const earlyMode = mode.startsWith("early-");
  const excludesEarlyOpening = ["early-dsa", "early-doubt", "early-resume"].includes(mode);
  const isResume = mode === "resume-no-ink" || mode === "early-resume";
  let now = 0;
  let sequence = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const events: Event[] = [];
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const originalDateNow = Date.now;
  const record = (name: string, data?: unknown) => events.push({ atMs: now, name, data });
  const replace = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const setTimer = (run: () => void, delay = 0) => {
    const id = ++sequence;
    timers.set(id, { at: now + delay, run });
    return id;
  };
  const flush = async () => { for (let i = 0; i < 160; i++) await Promise.resolve(); };
  const advance = async (target: number) => {
    await flush();
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].run();
      await flush();
    }
    now = target;
    await flush();
  };
  const pump = async (done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) {
      await flush();
      if (done()) return;
      const next = [...timers.values()].sort((left, right) => left.at - right.at)[0];
      assert(next && next.at < 90_000, `${mode}: the actual hook must settle without an unowned asynchronous operation`);
      await advance(next.at);
    }
    assert(done(), `${mode}: the actual hook did not settle`);
  };
  replace("performance", { now: () => now });
  replace("setTimeout", setTimer);
  replace("clearTimeout", (id: number) => timers.delete(id));
  replace("window", globalThis);
  replace("addEventListener", () => {});
  replace("removeEventListener", () => {});
  const heldLocks = new Set<string>();
  replace("navigator", { locks: {
    async request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: { name: string } | null) => Promise<void>) {
      assert(!(options.ifAvailable && options.signal), "native Web Locks rejects ifAvailable with signal");
      if (heldLocks.has(name)) return callback(null);
      heldLocks.add(name);
      record("lesson-claim-acquired");
      try { await callback({ name }); }
      finally { heldLocks.delete(name); record("lesson-claim-released"); }
    },
    query: async () => ({ held: [...heldLocks].map((name) => ({ name, mode: "exclusive" })), pending: [] }),
  } });
  Date.now = () => 1_800_000_000_000 + now;
  const plan = mode === "numeric" ? numericPlan : mode === "failed-compile" ? failedCompilePlan
    : mode === "recorded-projectile" ? recordedPlan : mode === "early-dsa" ? dsaPlan : symbolicPlan;
  const question = plan.question;
  const boardId = `startup-${mode}`;
  const parentId = `${boardId}-stopped-parent`;
  const parentTraceId = `${boardId}-parent-trace`;
  const savedRepresentation = isResume ? selectFastVerifiedRepresentation({ question, turnPlan: plan }) : null;
  if (isResume) assert(savedRepresentation, "the stopped parent uses the same source-valid verified figure");
  const savedCommands = savedRepresentation ? buildVerifiedDiagramPresentation(savedRepresentation.sceneDocument, savedRepresentation.renderScene).diagram.commands.map((command) => verifiedDiagramCommandToDrawCommand(command)) : [];
  const streams: Array<{
    controller: ReadableStreamDefaultController<Uint8Array>;
    response: Response;
    retry: boolean;
    startupRetry: string | null;
    hedge: boolean;
    signal: AbortSignal | null | undefined;
    cancelled: boolean;
  }> = [];
  const telemetry: Array<{ events?: Array<{ name: string; metadata?: Record<string, unknown> }> }> = [];
  const encoder = new TextEncoder();
  const content = (index: number, text: string) => {
    const stream = streams[index]!;
    stream.controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
  };
  const finishStream = (index: number) => {
    streams[index]!.controller.enqueue(encoder.encode("data: [DONE]\n\n"));
  };
  const completion = (value: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
  replace("fetch", async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (url.endsWith(`/api/boards/${boardId}?page=0`)) {
      record("owned-history-read");
      return Response.json({ board: { id: boardId, title: "Projectile lesson", createdAt: 0 }, nextPage: null,
        turns: savedRepresentation ? [{
          id: parentId, orderIndex: 0, question, rawResponse: "The range follows from horizontal motion.",
          speedMultiplier: 1, traceId: parentTraceId, status: "stopped", persistedStatus: "stopped", kind: "lesson",
          sceneDocument: savedRepresentation.sceneDocument, sceneEngineVersion: null, validationReport: savedRepresentation.validationReport,
          visualStatus: "validated", sceneArtifacts: { turnPlan: plan },
          segments: [{ id: `${parentId}-figure`, orderIndex: 0, narration: "The range follows from horizontal motion.",
            spokenText: "The range follows from horizontal motion.", command: serializeSegmentCommands(savedCommands, { trustedDiagramGeometry: true }),
            audioUrl: null, durationMs: null, timings: null }],
        }] : [],
      });
    }
    if (url.endsWith("/api/visual-need")) {
      record("visual-need-request");
      return Response.json({ decision: "required" });
    }
    if (url.endsWith("/api/dsa-teaching-policy")) return Response.json({ includeMotivation: false });
    if (url.endsWith("/api/trace/event")) {
      telemetry.push(JSON.parse(String(init?.body)));
      return Response.json({});
    }
    // The progressive lesson save (liveTurnSave): accept every checkpoint.
    const checkpoint = /\/api\/boards\/[^/]+\/turns\/([^/]+)$/.exec(url);
    if (checkpoint && (init?.method === "PUT" || init?.method === "PATCH")) {
      record("board-save");
      const meta = JSON.parse(init.method === "PUT" ? String((init.body as FormData).get("metadata")) : String(init.body)) as {
        seq: number; status: string; baseCount: number; question?: string; appendSegments?: unknown[];
      };
      return Response.json({
        turn: {
          id: checkpoint[1], orderIndex: 0, question: meta.question ?? question, rawResponse: "", speedMultiplier: 1,
          traceId: null, sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
          sceneArtifacts: null, segments: [], status: meta.status,
        },
        serverCount: meta.status === "complete" ? null : meta.baseCount + (meta.appendSegments?.length ?? 0),
        serverSeq: meta.seq,
        final: meta.status === "complete",
      });
    }
    assert(url.endsWith("/api/chat"), `${mode}: no real network call is permitted: ${url}`);
    if (headers.get("x-code-lesson-version") === "1") {
      record("code-plan-request");
      // Exercise real classification and its actual rejected-plan fallback,
      // rather than replacing the classifier or code planner internally.
      return completion({});
    }
    if (headers.get("x-turn-planner-version") === "3") {
      record("turn-plan-request");
      if (earlyMode) await new Promise<void>((resolve) => { setTimer(resolve, HELD_PLANNER_MS); });
      record("turn-plan-response");
      return completion(plan);
    }
    if (headers.get("x-problem-ir-version") === "1") {
      record("problem-authority-request");
      const problem: ProblemIR = {
        schemaVersion: "problem-ir/v1", id: "sourceAngle", question,
        facts: [{ id: "request", kind: "requested", statement: question,
          evidence: { source: "question", start: 0, end: question.length, quote: question } }],
        entities: [], expressions: [], constraints: [], representationIntents: [], solveRequests: [],
      };
      if (plan === recordedPlan) {
        problem.expressions.push({ id: "angle", valueType: "scalar", root: { kind: "number", value: 45 }, evidenceFactIds: ["request"] });
        problem.solveRequests.push({ id: "angleValue", kind: "evaluate", expressionId: "angle",
          resultBinding: { turnPlanQuantityId: "maximum_angle", symbol: "theta_max", unit: "deg", evidenceFactIds: ["request"] } });
      } else if (plan === numericPlan) {
        problem.expressions.push({ id: "rangeExpression", valueType: "scalar", evidenceFactIds: ["request"], root: {
          kind: "binary", operator: "/", right: { kind: "number", value: 9.8 },
          left: { kind: "binary", operator: "*",
            left: { kind: "binary", operator: "^", left: { kind: "number", value: 20 }, right: { kind: "number", value: 2 } },
            right: { kind: "call", function: "sin", argument: { kind: "binary", operator: "/",
              left: { kind: "binary", operator: "*", left: { kind: "number", value: 60 }, right: { kind: "constant", name: "pi" } },
              right: { kind: "number", value: 180 } } },
          },
        } });
        problem.solveRequests.push({ id: "rangeValue", kind: "evaluate", expressionId: "rangeExpression",
          resultBinding: { turnPlanQuantityId: "range", symbol: "R", unit: "m", evidenceFactIds: ["request"] } });
      }
      record("problem-authority-response");
      return completion(problem);
    }
    if (headers.get("x-scene-planner-version") === "2") {
      record("scene-model-request", { phase: headers.get("x-scene-planner-phase") });
      return completion({ schemaVersion: "scene-document/v2", source: { question }, entities: [{ id: "invalid-model-mark", kind: "not-a-real-entity" }] });
    }
    const hedgeRequest = headers.get("x-heytutor-teaching-hedge") === "1";
    record("teaching-request", { retry: headers.get("x-heytutor-reasoning-retry") === "1", hedge: hedgeRequest });
    if (hedgeRequest && mode === "hedge-fails") {
      return new Response("provider busy", { status: 503 });
    }
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = {
      get controller() { return controller; },
      response: new Response(new ReadableStream<Uint8Array>({
        start(next) { controller = next; },
        cancel() { stream.cancelled = true; record("teaching-reader-cancelled"); },
      }), { headers: { "content-type": "text/event-stream", "x-heytutor-trace-id": "offline-teaching-trace" } }),
      retry: headers.get("x-heytutor-reasoning-retry") === "1",
      startupRetry: headers.get("x-heytutor-startup-retry"),
      hedge: hedgeRequest,
      signal: init?.signal,
      cancelled: false,
    };
    streams.push(stream);
    return stream.response;
  });

  const provider = {
    unlockAudio() { record("audio-unlock"); },
    async prewarm(options?: { onConnect?: (result: { ms: number; ok: boolean }) => void }) {
      record("tts-prewarm"); options?.onConnect?.({ ms: 0, ok: true });
    },
    prefetchSegment(text: string, options?: unknown) { record("opening-prefetch", { text, options }); },
    peekPrefetchedTimings() { return null; },
    getPlaybackPositionMs: () => 1_000_000,
    getPlaybackRate: () => 1,
    setPlaybackRate() {},
    async speakSegment(text: string, options: SpeakSegmentOptions = {}) {
      record("playback", { text, voiceSettings: options.voiceSettings });
      const chars = mathToSpeech(text).length;
      options.onTimings?.({ totalDuration: chars * 0.02,
        charStartTimes: Array.from({ length: chars }, (_, index) => index * 0.02),
        charDurations: Array.from({ length: chars }, () => 0.02) });
      options.onAudioReady?.();
      options.onStart?.();
      options.onAudioCaptured?.({ bytes: Uint8Array.of(82, 73, 70, 70), mimeType: "audio/wav" });
      options.onEnd?.();
    },
    abandonSpeaking() { record("provider-stop"); },
    stop() { record("provider-stop"); },
    pause() { record("provider-pause"); }, resume() { record("provider-resume"); },
  };
  const ref = <T,>(current: T) => ({ current });
  const cancelTimers = new Map<number, () => void>();
  const params = {
    sessionId: boardId, boards: [{ id: boardId, title: "Projectile lesson", createdAt: 0, preview: "" }],
    phase: "idle", boardLoaded: true, narrationText: "", isReplaying: false, enableKeyboardControls: false,
    phaseRef: ref("idle"), cancelRef: ref(false), isPausedRef: ref(false), turnActiveRef: ref(false),
    turnGenerationRef: ref(0), turnAbortRef: ref<AbortController | null>(null),
    pendingQuestionRef: ref(null), autoSubmitDoneRef: ref(null), liveQuestionRef: ref(""),
    boardPageRef: ref(null), boardShowsStoppedReplayRef: ref(false), conversationHistoryRef: ref([]),
    collectedSegmentsRef: ref<TutorSegment[]>([]), recordedSegmentsRef: ref([]), storedTurnsRef: ref([]),
    rawResponseRef: ref(""), currentTraceIdRef: ref(null), turnTelemetryRef: ref(null),
    segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()),
    turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), segmentPlanStatsRef: ref(createEmptySegmentPlanStats()),
    narrationSinceEpochRef: ref(""), narrationDensityRef: ref(0), pendingSegmentCountRef: ref(0),
    boardLayoutRef: ref({ rects: [], nextY: 100 }), fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false),
    activeVerifiedDiagramRef: ref(null), speedRef: ref(1), fastModeRef: ref(true), familiarityRef: ref("normal"),
    stopTurnRef: ref(null), rewoundRef: ref(false), replayAudioRef: ref(null), replayDrawClockRef: ref(null),
    replayAudioPreloadRef: ref(new Map()), replayGenerationRef: ref(0), replayCueRef: ref(null),
    ttsClientRef: ref(provider), ensureTTSClient: () => provider as unknown as TTSClient,
    whiteboardRef: ref({
      getDrawLayer: () => ({}), beginDrawTransaction: () => "offline-intro",
      createDrawSavepoint: () => "offline-savepoint", rollbackDrawSavepoint() {},
      commitDrawTransaction() { record("intro-commit"); }, abortDrawTransaction() {},
      finishAbortedDrawTransaction() {}, setPaused() {}, cancelAnimations() {}, clearSpotlight() {},
    }),
    setPhase(value: unknown) { record("phase", value); },
    setNarrationText(value: unknown) { record("narration", value); },
    setCurrentSegmentText() {}, setLastError(value: unknown) { record("error-state", value); },
    setIsPaused() {}, setInputInteracted() {}, setIsReplaying() {}, setReplayProgressMs() {}, setReplayTotalMs() {},
    setStoredTurnsCount() {}, setBoards() {}, setActiveVerifiedDiagram() {},
    beginBoardEpoch: async () => { record("board-epoch"); }, resetBoardLayout() {},
    executeCommandWithCancel: async (command: DrawCommand) => {
      if (mode === "intro-draw-failure" && command.type.startsWith("DRAW_")) {
        record("injected-intro-draw-failure");
        throw new Error("offline verified intro draw failure");
      }
      record("board-command", command);
    },
    reserveTextCommandPlacements: async (command: DrawCommand) => [command],
    raceWithCancel: <T,>(promise: Promise<T>) => promise,
    cancellableDelay: (delay: number) => new Promise<void>((resolve) => {
      const timer = setTimer(() => { cancelTimers.delete(timer); resolve(); }, delay);
      cancelTimers.set(timer, resolve);
    }),
    clearCancelTimers() {
      for (const [timer, resolve] of cancelTimers) { timers.delete(timer); resolve(); }
      cancelTimers.clear();
    },
    persistTurnForReplay: () => ({ id: "offline-turn", question, rawResponse: "", segments: [] }),
    registerReplayBlobUrl() {}, revokeUnreferencedReplayBlobUrls() {},
    onError(error: unknown) { record("turn-error", error); },
  };
  const loaded = new Map<string, Record<string, unknown>>();
  function loadHook(file: string): Record<string, unknown> {
    const cached = loaded.get(file);
    if (cached) return cached;
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const hookModule = { exports: {} };
    const localRequire = (specifier: string) => {
      if (specifier === "react") return react;
      if (specifier === "@/lib/billing/billingClient") return {
        ...requireApp(path.join(app, "lib/billing/billingClient.ts")),
        beginTurn: async () => { record("turn-admission"); return { ok: true }; },
      };
      if (specifier === "@/lib/boards/boardsClient") return {
        ...requireApp(path.join(app, "lib/boards/boardsClient.ts")),
        saveTurn: async () => { record("board-save"); return null; },
        requestBoardTitle: async () => null,
        updateBoard: async () => null,
      };
      if (["./useSegmentRunner", "./useBoardViewport"].includes(specifier)) {
        return loadHook(path.resolve(path.dirname(file), `${specifier}.ts`));
      }
      const target = specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
        : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier;
      if (target.endsWith("/earlyLessonOpening")) return loadHook(`${target}.ts`);
      return requireApp(target);
    };
    new Function("require", "module", "exports", compiled)(localRequire, hookModule, hookModule.exports);
    loaded.set(file, hookModule.exports);
    return hookModule.exports;
  }

  const savedHedgeFlag = process.env.NEXT_PUBLIC_TEACHING_HEDGE;
  const savedEarlyFlag = process.env.NEXT_PUBLIC_EARLY_LESSON_OPENING;
  // The hook reads the flag once at module load, and each scenario loads it fresh.
  if (hedgeEnabled) process.env.NEXT_PUBLIC_TEACHING_HEDGE = "1";
  else delete process.env.NEXT_PUBLIC_TEACHING_HEDGE;
  // Every legacy scenario explicitly preserves the shipped, default-off order.
  process.env.NEXT_PUBLIC_EARLY_LESSON_OPENING = earlyEnabled ? "1" : "0";
  try {
    forgetVerifiedScene(question, { boardId });
    const lifecycle = params as unknown as UseTurnLifecycleParams;
    const handleRef = ref<(question: string, options?: HandleQuestionOptions) => Promise<void>>(async () => {});
    const runControl = loadHook(path.join(app, "features/tutor-session/hooks/turn/useTurnControl.ts")).useTurnControl as
      typeof import("../../features/tutor-session/hooks/turn/useTurnControl").useTurnControl;
    const control = runControl(lifecycle, handleRef);
    const observeControl: Pick<TurnControlApi, "finishLectureUi" | "enqueueSegment" | "enqueueVerifiedIntro" | "processResponseText" | "offerPausedLessonResume" | "clearPausedLesson"> = {
      ...control,
      enqueueSegment(segment, generation) { record("enqueue", segment); control.enqueueSegment(segment, generation); },
      enqueueVerifiedIntro(segments, generation) { record("enqueue-intro", segments); control.enqueueVerifiedIntro(segments, generation); },
      offerPausedLessonResume(resume) { record("resume-offer", resume); control.offerPausedLessonResume(resume); },
    };
    const runHandler = loadHook(path.join(app, "features/tutor-session/hooks/turn/useQuestionHandler.ts")).useQuestionHandler as
      typeof import("../../features/tutor-session/hooks/turn/useQuestionHandler").useQuestionHandler;
    const handler = runHandler(lifecycle, observeControl);
    handleRef.current = handler.handleQuestion;
    const resume: PausedLessonRequest | undefined = isResume ? {
      boardId, reason: "doubt", lessonQuestion: question, turnPlan: plan, solverProjection: null,
      parentTurnId: parentId, parentTraceId,
      scene: null, figureDrawn: true, codeLesson: false, lessonBoardRows: [], interruptedStep: "The range follows from horizontal motion.",
    } : undefined;
    if (resume) control.offerPausedLessonResume(resume);
    if (mode === "early-resume" && savedRepresentation) {
      // A real reopened board has restored its trusted diagram before Continue.
      // Supply that actual compiled receipt, not a mocked scene/renderer.
      lifecycle.activeVerifiedDiagramRef.current = buildVerifiedDiagramPresentation(
        savedRepresentation.sceneDocument, savedRepresentation.renderScene,
      ).diagram;
      lifecycle.boardPageRef.current = {
        ...lessonPageRecord(boardId, question), turnPlan: plan, figureDrawn: true,
        turn: { kind: "lesson", question, continuesBoard: false, saved: true, scene: {
          sceneDocument: savedRepresentation.sceneDocument, sceneEngineVersion: null,
          validationReport: savedRepresentation.validationReport, visualStatus: "validated", sceneArtifacts: { turnPlan: plan },
        } },
      };
    }
    if (mode === "early-doubt") {
      lifecycle.boardPageRef.current = {
        ...lessonPageRecord(boardId, question), turnPlan: plan,
        turn: { kind: "lesson", question, continuesBoard: false, scene: null, saved: true },
      };
    }
    const questionOptions: HandleQuestionOptions | undefined = resume ? { resume }
      : mode === "early-doubt" ? { doubt: {
          prompt: "I have a doubt about the horizontal motion: why is its speed constant?",
          title: "Doubt: why is horizontal speed constant?", lessonQuestion: question, afterReplay: false,
        } } : undefined;
    let done = false;
    const turn = handler.handleQuestion(plan === recordedPlan ? projectileQuestion : question, questionOptions).finally(() => { done = true; });
    await flush();
    const claimAt = events.findIndex((event) => event.name === "lesson-claim-acquired");
    const historyAt = events.findIndex((event) => event.name === "owned-history-read");
    const billingAt = events.findIndex((event) => event.name === "turn-admission");
    assert(claimAt >= 0 && historyAt >= 0 && billingAt >= 0, "startup requires positive claim, history and billing receipts");
    assert(claimAt < historyAt, "fresh history is read under the held claim");
    assert(historyAt < billingAt, "successful owned history precedes billing");
    assert(heldLocks.has(`heytutor-lesson:${boardId}`), "the native claim remains held throughout the live teaching turn");
    const outputs = () => events.filter((event) => ["enqueue", "enqueue-intro", "playback", "board-command"].includes(event.name));
    if (earlyMode) {
      const opening = buildEarlyLessonOpeningSegment();
      const playbacks = () => events.filter((event) => event.name === "playback");
      const skipsPlanner = mode === "early-doubt" || mode === "early-resume";
      assert.equal(streams.length, skipsPlanner ? 1 : 0, "only existing-page turns may skip the held planner");
      assert(!events.some((event) => event.name === "turn-plan-response"));
      if (earlyEnabled && !excludesEarlyOpening) {
        assert.equal(playbacks().length, 1, "an admitted fresh lesson must actually speak its safe opening before the delayed turn planner responds");
        assert.equal((playbacks()[0]!.data as { text: string }).text, opening.narration);
        assert(events.indexOf(playbacks()[0]!) > billingAt, "early speech must follow successful admission");
      } else {
        assert.equal(outputs().length, 0, "flag-off or excluded turns must retain the old first-step ordering");
      }
      assert.equal(events.filter((event) => event.name === "board-command" || event.name === "enqueue-intro").length, 0,
        "no numeric or figure authority exists during the safe opening");
      if (mode === "early-dsa") assert.equal(events.filter((event) => event.name === "code-plan-request").length, 2,
        "a DSA question must really pass through both code-planner attempts before the standard fallback");
      if (mode === "early-stop") {
        const outputsBeforeStop = outputs().length;
        const stopControl = runControl({ ...lifecycle, phase: lifecycle.phaseRef.current }, handleRef);
        stopControl.stopTurn({ keepVisibleBoard: true });
        await flush();
        await advance(HELD_PLANNER_MS); // A late valid model response deliberately ignores fetch abort.
        await pump(() => done);
        await turn;
        assert.equal(outputs().length, outputsBeforeStop, "Stop must suppress every late planner, figure and teaching effect");
        assert.equal(streams.length, 0, "the stale planner response must never start teaching after Stop");
        assert.equal(lifecycle.boardPageRef.current?.figureDrawn, false);
        let continued: { question: string; options?: HandleQuestionOptions } | undefined;
        handleRef.current = async (nextQuestion, options) => { continued = { question: nextQuestion, options }; };
        stopControl.flushPausedLesson();
        await flush();
        assert(!continued?.options?.resume, "an opening-only Stop cannot offer Continue with a null, unplanned turnPlan");
        assert.equal(lifecycle.turnActiveRef.current, false);
        assert.equal(lifecycle.phaseRef.current, "idle");
        assert.equal(lifecycle.pendingSegmentCountRef.current, 0);
        assert.equal(lifecycle.turnAbortRef.current, null);
        assert.equal(timers.size, 0);
        return { mode, early: earlyEnabled, events: events.length, teachingRequests: 0, sceneRequests: 0 };
      }
      if (mode === "early-pause") {
        control.pauseTurn();
        assert.equal(lifecycle.isPausedRef.current, true, "the actual Pause action must latch during planning");
        assert(events.some((event) => event.name === "provider-pause"));
      }
      if (!skipsPlanner) await advance(HELD_PLANNER_MS);
      assert.equal(streams.length, 1, "the real planner response must still lead to exactly one teaching request");
      const usableAt = events.length;
      record("usable-step-delivered");
      content(0, "[STEP]The range follows from horizontal motion.[WRITE:R = u t,80,150][/STEP]\n[STEP]The flight time comes from vertical motion.[WRITE:t = 2 u sin(theta) / g,80,205][/STEP]");
      finishStream(0);
      if (mode === "early-pause") {
        await advance(HELD_PLANNER_MS + 1_000);
        assert.equal(playbacks().length, 1, "Pause must hold all substantive narration while the planner finishes");
        assert.equal(events.filter((event) => event.name === "board-command").length, 0,
          "Pause must hold verified figure and writing as well as speech");
        control.resumeTurn();
        assert.equal(lifecycle.isPausedRef.current, false);
        assert(events.some((event) => event.name === "provider-resume"));
      }
      await pump(() => done);
      await turn;
      assert(!events.some((event) => event.name === "turn-error"), "delaying the planner must not turn a valid figure lesson into an error");
      const openings = events.filter((event) => event.name === "enqueue" && (event.data as TutorSegment).delivery === "opening");
      assert.equal(openings.length, skipsPlanner ? 0 : 1, "early opening must replace, not duplicate, the legacy opening; page continuations add none");
      if (earlyEnabled && !excludesEarlyOpening) assert.equal((openings[0]!.data as TutorSegment).narration, opening.narration);
      else if (skipsPlanner) assert.equal(events.filter((event) => event.name === "enqueue" && (event.data as TutorSegment).narration === opening.narration).length, 0);
      else assert(events.indexOf(openings[0]!) > usableAt, "flag-off opening still waits for a usable teaching step");
      if (!excludesEarlyOpening) {
        assert.equal(events.filter((event) => event.name === "enqueue-intro").length, 1, "the verified figure must not be lost behind the early opening");
        assert.equal(events.filter((event) => event.name === "intro-commit").length, 1, "the figure must still commit atomically once");
        const representation = selectFastVerifiedRepresentation({ question, turnPlan: plan });
        assert(representation);
        const expected = buildVerifiedDiagramPresentation(representation.sceneDocument, representation.renderScene).introSegments.flatMap(getSegmentCommands);
        const commandIdentity = (command: DrawCommand) => ({ type: command.type, params: command.params, text: command.text });
        assert.deepEqual(events.filter((event) => event.name === "board-command").slice(0, expected.length)
          .map((event) => commandIdentity(event.data as DrawCommand)), expected.map(commandIdentity),
        "the complete source-verified projectile intro must still reach the actual board runner, in order and unchanged");
      } else if (skipsPlanner) {
        assert.equal(events.filter((event) => event.name === "turn-plan-request" || event.name === "code-plan-request").length, 0,
          "existing-page turns must not quietly replan for the early opening");
        assert.deepEqual(events.filter((event) => event.name === "enqueue-intro")
          .flatMap((event) => (event.data as TutorSegment[]).flatMap(getSegmentCommands)), [],
        "an existing-page turn must not redraw its figure; the existing empty intro call is harmless");
      }
      assert.equal(lifecycle.turnAbortRef.current, null);
      assert.equal(lifecycle.turnActiveRef.current, false);
      assert.equal(lifecycle.phaseRef.current, "idle");
      assert.equal(lifecycle.pendingSegmentCountRef.current, 0);
      assert.equal(lifecycle.turnTelemetryRef.current, null);
      for (const stream of streams) assert.equal(stream.response.body?.locked, false);
      assert.equal(timers.size, 0, "early opening settlement must release planner, queue and startup timers");
      return { mode, hedge: hedgeEnabled, early: earlyEnabled, events: events.length, teachingRequests: streams.length,
        sceneRequests: events.filter((event) => event.name === "scene-model-request").length };
    }
    assert.equal(streams.length, 1, `${mode}: planning must reach the real teaching stream`);
    assert.equal(outputs().length, 0, "planning/prefetch must not enqueue or play the opening");
    const prefetch = events.find((event) => event.name === "opening-prefetch");
    if (!resume) {
      assert(prefetch, "the actual opening must be prefetched");
      assert(events.indexOf(prefetch) < events.findIndex((event) => event.name === "teaching-request"), "opening prefetch must precede the teaching request");
    }
    if (mode === "numeric" || mode === "failed-compile" || mode === "recorded-projectile") {
      assert(prefetch);
      const authority = events.findIndex((event) => event.name === "problem-authority-response");
      assert(authority >= 0 && authority < events.indexOf(prefetch), "source numbers/operators must retain a formulation attempt before teaching");
      if (mode === "numeric") {
        assert(authority < events.findIndex((event) => event.name === "scene-model-request"), "numeric solver authority must resolve before startup scene selection");
      }
    } else if (plan === symbolicPlan) {
      assert.equal(events.filter((event) => event.name === "problem-authority-request").length, 0, "the source-answered symbolic projectile must not formulate a numeric problem");
    }
    const sceneRequests = events.filter((event) => event.name === "scene-model-request");
    if (mode === "numeric" || mode === "failed-compile") {
      assert(sceneRequests.length > 0, "rejected fast representations must still request and validate model scenes");
      const artifacts = lifecycle.boardPageRef.current?.turn.scene?.sceneArtifacts;
      assert(typeof artifacts === "object" && artifacts !== null && "candidates" in artifacts && Array.isArray(artifacts.candidates));
      assert(artifacts.candidates.length > 0);
      assert(artifacts.candidates.every((candidate) => candidate.validationReport.valid === false && candidate.accepted === false),
        `invalid model scenes must be rejected by actual validation: ${JSON.stringify(artifacts.candidates.map((candidate) => ({ id: candidate.candidateId, valid: candidate.validationReport.valid, accepted: candidate.accepted, codes: candidate.rejectionCodes })))}`);
      assert("selectedCandidateId" in artifacts);
      assert.equal(artifacts.selectedCandidateId, null, "an invalid model candidate cannot be recorded as the selected numeric fallback");
    } else {
      assert.equal(sceneRequests.length, 0, "accepted source-valid projectile startup must never call the scene model");
    }
    streams[0]!.controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"Hidden planning only."}}]}\n\n'));
    content(0, " \n");
    await flush();
    assert.equal(outputs().length, 0, "reasoning and whitespace are not a usable teaching step");
    if (mode === "pause-stall" || mode === "pause-prelude") {
      content(0, "[STEP][PAUSE:11][/STEP][STEP][PAUSE:22][/STEP]");
      await flush();
      assert.equal(outputs().length, 0, "accepted PAUSE-only steps cannot release any opening, queue, or playback");
      assert([...timers.values()].some((timer) => timer.at === 15_000), "control-only steps must keep the startup deadline armed");
    }

    if (mode === "intro-draw-failure") {
      // Execute the actual handler, intro queue, segment runner and figure
      // tracker. Only the external whiteboard command port throws; no tracker
      // state or terminal classification is substituted by the verifier.
      content(0, "[STEP]The range follows from horizontal motion.[WRITE:R = u t,80,150][/STEP]\n[STEP]The flight time comes from vertical motion.[WRITE:t = 2 u sin(theta) / g,80,205][/STEP]");
      finishStream(0);
      await pump(() => done);
      await turn;
      assert.equal(events.filter((event) => event.name === "injected-intro-draw-failure").length, 1,
        "the actual verified intro must reach the failing drawing port exactly once");
      assert.equal(events.filter((event) => event.name === "intro-commit").length, 0,
        "a failed intro must never commit its incomplete geometry");
      const terminal = telemetry.flatMap((payload) => payload.events ?? [])
        .filter((event) => event.name === "figure-turn-terminal");
      assert.equal(terminal.length, 1, "an admitted failed intro emits one terminal figure event");
      assert.equal(terminal[0]!.metadata?.figure_outcome, "empty");
      assert.equal(terminal[0]!.metadata?.figure_empty_cause, "intro_failed");
      assert.equal(terminal[0]!.metadata?.turn_terminal_outcome, "error",
        "an internal verified-intro draw error must not be relabelled as a student cancellation");
      assert.equal(lifecycle.activeVerifiedDiagramRef.current, null,
        "the failed intro withdraws its own active figure");
      assert(!JSON.stringify(terminal).includes(question), "terminal figure diagnostics carry no student text");
      assert.equal(lifecycle.phaseRef.current, "idle", "the failed turn is already settled before sibling speech cleanup");
      assert.equal(lifecycle.turnActiveRef.current, false);
      assert.equal(lifecycle.pendingSegmentCountRef.current, 0);
      const settledOutputs = outputs().length;
      const providerPrefetches = events.filter((event) => event.name === "opening-prefetch").length;
      const upstreamRequests = events.filter((event) => event.name.endsWith("-request")).length;
      const terminalMetadata = JSON.stringify(terminal[0]!.metadata);
      // Measured separately from turn settlement: Promise.all rejects on ink
      // while its already-started speech sibling needs one 25 ms startup poll
      // to observe the synthetic provider's resolved onStart/onEnd. That poll
      // clears its two 250 ms watchdogs. This is a precise bounded drain, not
      // an arbitrary idle wait or relaxed final lifetime assertion.
      await advance(now + 25);
      assert.equal(outputs().length, settledOutputs, "cleanup cannot start late playback, enqueue or board ink");
      assert.equal(events.filter((event) => event.name === "opening-prefetch").length, providerPrefetches,
        "cleanup cannot dispatch more provider prefetches");
      assert.equal(events.filter((event) => event.name.endsWith("-request")).length, upstreamRequests,
        "cleanup cannot make another upstream request");
      const settledTerminal = telemetry.flatMap((payload) => payload.events ?? [])
        .filter((event) => event.name === "figure-turn-terminal");
      assert.equal(settledTerminal.length, 1, "late sibling cleanup cannot emit a second terminal");
      assert.equal(JSON.stringify(settledTerminal[0]!.metadata), terminalMetadata,
        "late sibling cleanup cannot mutate the originating error outcome");
    } else if (mode === "resume-no-ink") {
      content(0, "[STEP]We continue from the horizontal motion without writing anything.[/STEP]");
      finishStream(0);
      await flush();
      assert.equal(streams.length, 2, "a speech-only notebook resume must get its existing corrective ink retry");
      content(1, "[STEP]The corrective attempt also speaks without a board row.[/STEP]");
      finishStream(1);
      await pump(() => done);
      await turn;
      assert.equal(outputs().length, 0, "no-ink resumed attempts must not release opening, figure or speech");
      assert(events.some((event) => event.name === "turn-error"), "a failed no-ink resume must expose an error");
      const restoredOffer = events.find((event) => event.name === "resume-offer")?.data as PausedLessonRequest | undefined;
      assert(restoredOffer && savedRepresentation, "failed notebook resumption must restore its authenticated request");
      assert.equal(restoredOffer.boardId, boardId);
      assert.equal(restoredOffer.parentTurnId, parentId);
      assert.equal(restoredOffer.parentTraceId, parentTraceId);
      assert.equal(restoredOffer.lessonQuestion, question);
      assert.equal(restoredOffer.reason, "stop", "the saved parent is an explicit Stop, not the obsolete doubt context");
      assert.deepEqual(restoredOffer.turnPlan, plan, "retry retains the source plan in the owned parent receipt");
      assert.deepEqual(restoredOffer.scene, {
        sceneDocument: savedRepresentation.sceneDocument, sceneEngineVersion: null,
        validationReport: savedRepresentation.validationReport, visualStatus: "validated", sceneArtifacts: { turnPlan: plan },
      }, "retry retains the already drawn, source-validated parent scene");
      assert.equal(restoredOffer.solverProjection, null, "retry preserves the saved null solver projection");
      assert.equal(restoredOffer.figureDrawn, true);
      assert.equal(restoredOffer.codeLesson, false);
      assert.equal(restoredOffer.interruptedStep, "The range follows from horizontal motion.");
      assert.deepEqual(restoredOffer.lessonBoardRows, []);
      let continued: { question: string; options?: HandleQuestionOptions } | undefined;
      handleRef.current = async (nextQuestion, options) => {
        continued = { question: nextQuestion, options };
        lifecycle.turnActiveRef.current = true;
      };
      control.flushPausedLesson();
      await flush();
      assert.equal(continued?.question, question, "the restored Continue action must still dispatch the paused lecture");
      assert.equal(continued?.options?.resume, restoredOffer, "Continue dispatches the exact restored receipt object with its board/plan/scene ownership");
      control.finishLectureUi(lifecycle.turnGenerationRef.current);
    } else if (mode === "control-eof") {
      content(0, "[STEP][PAUSE:11][/STEP]");
      finishStream(0);
      await pump(() => done);
      await turn;
      assert.equal(outputs().length, 0, "control-only EOF must never enqueue an opening, figure, playback or board work");
      assert(events.some((event) => event.name === "turn-error"), "control-only EOF must expose an actionable error");
      assert(!events.some((event) => event.name === "persist-local"), "a control-only response is not a saved lecture");
    } else if (mode === "one-step-stall" || mode === "one-step-split-stall") {
      record("usable-step-delivered");
      content(0, "[STEP]The range follows from horizontal motion.[WRITE:R = u t,80,150]" +
        (mode === "one-step-split-stall" ? "[/ST" : "[/STEP]"));
      if (mode === "one-step-split-stall") {
        await flush();
        assert.equal(outputs().length, 0, "an incomplete closing STEP must not release the buffered teaching step");
        content(0, "EP]");
      }
      await flush();
      assert(outputs().length > 0, "one complete usable teaching step must release the opening without waiting for another step");
      assert(events.some((event) => event.name === "enqueue" && (event.data as TutorSegment).narration.startsWith("The range follows")),
        "the complete first step must reach the actual teaching queue");
      await advance(30_000);
      assert.equal(streams.length, 1, "a complete usable step must not be discarded by a startup timeout retry");
      assert(!events.some((event) => event.name === "turn-error"), "available teaching content must not become a false startup error");
      const countBeforeStop = outputs().length;
      runControl({ ...lifecycle, phase: lifecycle.phaseRef.current }, handleRef).stopTurn({ keepVisibleBoard: true });
      await pump(() => done);
      await turn;
      assert.equal(outputs().length, countBeforeStop, "Stop must not release more work from the stalled stream");
    } else if (mode === "stop-before-expiry" || mode === "stale-content") {
      if (mode === "stale-content") {
        content(0, "[STEP]This queued stale sentence must not play.[WRITE:R = u t,80,150][/STEP][STEP]Nor may this one.[/STEP]");
      }
      runControl({ ...lifecycle, phase: lifecycle.phaseRef.current }, handleRef).stopTurn({ keepVisibleBoard: true });
      await flush();
      assert.equal(streams[0]!.signal?.aborted, true);
      assert.equal(streams[0]!.cancelled, true);
      await pump(() => done);
      await turn;
      assert.equal(timers.size, 0, "Stop must immediately release startup and planner timers");
      await advance(now + 31_000);
      assert.equal(streams.length, 1, "Stop must never start the no-reasoning retry");
      assert.equal(outputs().length, 0, "Stop must prevent stale opening, playback, and board work");
    } else {
      let active = 0;
      let expectedStreams = 1;
      if (["retry", "prefix-stall", "partial-stall", "pause-stall", "retry-expires", "stop-during-retry"].includes(mode)) {
        if (mode === "prefix-stall") content(0, "[STEP]");
        if (mode === "partial-stall") content(0, "[STEP]Abandoned incomplete narration from the first attempt");
        await flush();
        assert.equal(outputs().length, 0, "partial prefixes/narration cannot release the opening");
        // A primary that has said nothing at all is hedged at 8s; one that
        // already sent a content token (even a bare prefix) is not.
        const silent = hedgeEnabled && !["prefix-stall", "partial-stall", "pause-stall"].includes(mode);
        await advance(8_000);
        assert.equal(streams.length, silent ? 2 : 1, silent ? "a silent primary must be hedged at 8 seconds"
          : hedgeEnabled ? "a primary with a content token is never hedged" : "with the hedge flag off no second request opens at 8 seconds");
        if (silent) {
          assert.equal(streams[1]!.hedge, true);
          assert.equal(streams[1]!.retry, true, "the hedge must ask for reasoning off");
          assert.equal(streams[0]!.signal?.aborted, false, "opening a hedge must not abort the primary");
        }
        await advance(15_000);
        active = silent ? 2 : 1;
        assert.equal(streams.length, active + 1, "a first-content expiry must retry exactly once");
        assert(streams.slice(0, active).every((stream) => stream.cancelled), "expiry must cancel the primary and any hedge");
        assert.equal(streams[active]!.retry, true, "the retry must send noReasoning to the actual stream transport");
        assert.equal(streams[active]!.hedge, false, "the startup retry is never hedged");
        assert.equal(streams[active]!.startupRetry, "first_content_timeout",
          "the startup retry must name itself so the server moves it off the stalled Fast router");
        assert(streams.slice(0, active).every((stream) => stream.startupRetry === null),
          "the first request and its hedge are never startup retries");
        assert.equal(outputs().length, 0, "the first expiry must not prematurely enqueue an opening");
        expectedStreams = active + 1;
      }
      if (["hedge-wins", "hedge-primary-wins", "hedge-fails"].includes(mode)) {
        await advance(7_999);
        assert.equal(events.filter((event) => event.name === "teaching-request").length, 1, "the hedge must wait for its threshold");
        await advance(8_000);
        const requests = events.filter((event) => event.name === "teaching-request");
        assert.equal(requests.length, 2, "a silent primary must be hedged at 8 seconds");
        assert.deepEqual(requests[1]!.data, { retry: true, hedge: true }, "the hedge must send both hedge and reasoning-off headers");
        assert.equal(streams[0]!.signal?.aborted, false, "opening a hedge must not abort the primary");
        assert.equal(outputs().length, 0, "opening a hedge must not release the opening");
        if (mode === "hedge-wins") {
          active = 1;
          expectedStreams = 2;
        } else {
          expectedStreams = mode === "hedge-fails" ? 1 : 2;
        }
      }
      if (mode === "retry-expires") {
        await advance(30_000);
      } else if (mode === "stop-during-retry") {
        runControl({ ...lifecycle, phase: lifecycle.phaseRef.current }, handleRef).stopTurn({ keepVisibleBoard: true });
        await flush();
      } else {
        content(active, "[STEP]");
        await flush();
        assert.equal(outputs().length, 0, "an incomplete STEP prefix must not release the opening");
        if (mode === "marker-only") {
          content(active, "[DRAW_CIRCLE:800,300,40][/STEP][STEP][DRAW_CIRCLE:800,300,40][/STEP]");
          await flush();
          assert.equal(outputs().length, 0, "filtered marker-only steps must not release the opening");
          content(active, "[STEP]");
        }
        if (mode === "hedge-wins" || mode === "hedge-primary-wins") {
          const loser = mode === "hedge-wins" ? 0 : 1;
          assert.equal(streams[loser]!.signal?.aborted, true, "the first content token must abort the other request");
          assert.equal(streams[loser]!.cancelled, true, "the losing paid body must be cancelled");
          assert.equal(streams[active]!.signal?.aborted, false);
        }
        record("usable-step-delivered");
        content(active, "The range follows from horizontal motion.[WRITE:R = u t,80,150][/STEP]\n[STEP]The flight time comes from vertical motion.[WRITE:t = 2 u sin(theta) / g,80,205][/STEP]");
        finishStream(active);
      }
      await pump(() => done);
      await turn;
      assert.equal(streams.length, expectedStreams, "the one-shot startup retry cannot repeat or silently continue");
      if (mode === "retry-expires") {
        const error = events.find((event) => event.name === "turn-error");
        assert(error, "a second startup expiry must expose a clear error, not an empty success");
        assert.match((error.data as { message: string }).message, /start|time|too long/i, "the terminal retry error must explain startup expiry");
        assert.equal(outputs().length, 0);
      } else if (mode === "stop-during-retry") {
        assert.equal(outputs().length, 0, "Stop must suppress the retry's stale content and opening");
        assert(streams.every((stream) => stream.signal?.aborted && stream.cancelled), "Stop must abort the primary, the hedge and the retry");
      } else {
        const usable = events.findIndex((event) => event.name === "usable-step-delivered");
        assert(outputs().length > 0, "a usable teaching step must actually run through the real queue and provider");
        assert(outputs().every((event) => events.indexOf(event) > usable), "opening playback and enqueue must follow usable teaching content");
        const opening = events.find((event) => event.name === "enqueue" && (event.data as TutorSegment).delivery === "opening");
        assert(opening, "the opening must be enqueued once the real step gate opens");
        const segment = opening.data as TutorSegment;
        assert(prefetch);
        const fetched = prefetch.data as { text: string; options: { voiceSettings: unknown; traceId: string; sessionId: string } };
        assert.equal(fetched.text, segment.narration);
        assert.equal(fetched.options.sessionId, boardId);
        assert(fetched.options.traceId);
        assert.deepEqual(fetched.options.voiceSettings, voiceSettingsForDelivery(segment.delivery));
        const spoken = events.find((event) => event.name === "playback" && (event.data as { text: string }).text === segment.narration);
        assert(spoken, "the real segment runner must play the prefetched opening");
        assert.deepEqual((spoken.data as { voiceSettings: unknown }).voiceSettings, fetched.options.voiceSettings, "prefetch and actual playback must use the same delivery settings");
        assert(!events.some((event) => event.name === "turn-error"));
        const openings = events.filter((event) => event.name === "enqueue" && (event.data as TutorSegment).delivery === "opening");
        assert.equal(openings.length, 1, "the opening must be released exactly once");
        assert(events.filter((event) => event.name === "enqueue-intro").length <= 1, "the figure intro must be released at most once");
        const narrations = events.filter((event) => event.name === "enqueue").map((event) => (event.data as TutorSegment).narration);
        assert.equal(narrations.filter((text) => text.startsWith("The range follows")).length, 1, "no teaching step may be queued twice");
        const marks = telemetry.flatMap((payload) => payload.events ?? []);
        const named = (name: string) => marks.filter((event) => event.name === name);
        for (const name of ["teaching-first-token", "teaching-first-step"]) {
          assert.equal(named(name).length, 1, `${name} must be marked once whatever the hedge flag`);
        }
        assert(named("teaching-request").length >= 1, "every teaching request must be marked");
        if (!hedgeEnabled) {
          assert.equal(marks.filter((event) => event.name.startsWith("teaching-hedge-")).length, 0, "no hedge marks without a hedge");
          assert(named("teaching-request").every((event) => event.metadata?.attempt === "primary"));
        }
        if (HEDGE_MODES.includes(mode)) {
          assert.deepEqual(named("teaching-request").map((event) => event.metadata?.attempt), ["primary", "hedge"]);
          assert.equal(named("teaching-hedge-start").length, 1);
          assert.equal(named("teaching-hedge-start")[0]!.metadata?.after_ms, 8_000);
          const winner = named("teaching-hedge-winner");
          if (mode === "hedge-fails") {
            assert.equal(winner.length, 1, "a primary that outlives a failed hedge still wins the race");
            assert.equal(winner[0]!.metadata?.winner, "primary");
          } else {
            assert.equal(winner.length, 1);
            assert.equal(winner[0]!.metadata?.winner, mode === "hedge-wins" ? "hedge" : "primary");
            assert.equal(typeof winner[0]!.metadata?.first_content_token_ms, "number");
          }
          for (const name of ["teaching-first-token", "teaching-first-step"]) {
            assert.equal(named(name).length, 1, `${name} must be marked once`);
            assert(Number(named(name)[0]!.metadata?.ms_since_request) >= 8_000, `${name} must be measured from the first request`);
          }
          const leaked = JSON.stringify(marks.filter((event) => event.name.startsWith("teaching-")));
          assert(!leaked.includes("projectile") && !leaked.includes("range follows"), "teaching startup marks carry no student or lesson text");
        }
        if (mode === "prefix-stall" || mode === "partial-stall") {
          assert(!lifecycle.rawResponseRef.current.includes("Abandoned incomplete narration"), "startup recovery must discard partial failed content");
          assert.equal((lifecycle.rawResponseRef.current.match(/\[STEP\]/g) ?? []).length, 2, "startup recovery must reset the partial STEP parser and markup");
        }
        if (mode === "pause-stall" || mode === "pause-prelude") {
          const queuedPauses = events.filter((event) => event.name === "enqueue")
            .flatMap((event) => getSegmentCommands(event.data as TutorSegment))
            .filter((command) => command.type === "PAUSE");
          const executedPauses = events.filter((event) => event.name === "board-command" && (event.data as DrawCommand).type === "PAUSE");
          if (mode === "pause-stall") {
            assert.deepEqual(queuedPauses, [], "timeout retry must discard held control-only prelude segments");
            assert.deepEqual(executedPauses, [], "abandoned controls must never execute on the retry's board");
            assert(!lifecycle.rawResponseRef.current.includes("[PAUSE:"), "abandoned controls must not leak into the final saved response");
          } else {
            assert.deepEqual(queuedPauses.map((command) => command.params[0]), [11, 22], "held controls must release in their original order once narration is usable");
            assert.deepEqual(executedPauses.map((event) => (event.data as DrawCommand).params[0]), [11, 22], "the real queue must execute each released control in order");
            const firstTeaching = events.findIndex((event) => event.name === "enqueue" && (event.data as TutorSegment).narration.startsWith("The range follows"));
            assert(firstTeaching > usable);
            assert(events.filter((event) => event.name === "enqueue" && getSegmentCommands(event.data as TutorSegment).some((command) => command.type === "PAUSE"))
              .every((event) => events.indexOf(event) > usable && events.indexOf(event) < firstTeaching), "released controls must precede the first teaching segment without starting the lesson early");
          }
        }
      }
    }
    assert.equal(lifecycle.turnAbortRef.current, null, "settlement must release the owned abort controller");
    assert.equal(lifecycle.turnActiveRef.current, false, "success and error must release the turn latch");
    assert.equal(lifecycle.phaseRef.current, "idle");
    assert.equal(lifecycle.pendingSegmentCountRef.current, 0);
    assert.equal(lifecycle.turnTelemetryRef.current, null);
    for (const stream of streams) assert.equal(stream.response.body?.locked, false, "every real stream reader must be released");
    if (!hedgeEnabled) {
      assert(streams.every((stream) => !stream.hedge), "the hedge flag is off by default: no hedge request may open");
      assert(!events.some((event) => event.name === "teaching-request" && (event.data as { hedge: boolean }).hedge), "no hedge request may open");
    }
    assert.equal(timers.size, 0, `${mode}: settled success/error must not leave startup or queue timers running (${[...timers.values()].map((timer) => timer.at - now).join(", ")} ms remain)`);
    if (mode === "retry") {
      assert(telemetry.some((payload) => payload.events?.some((event) => event.name === "teaching-startup-retry" || event.name === "reasoning-only-retry")), "the actual expiry must emit retry telemetry");
    }
    return { mode, hedge: hedgeEnabled, events: events.length, teachingRequests: streams.length, sceneRequests: sceneRequests.length };
  } finally {
    if (savedHedgeFlag === undefined) delete process.env.NEXT_PUBLIC_TEACHING_HEDGE;
    else process.env.NEXT_PUBLIC_TEACHING_HEDGE = savedHedgeFlag;
    if (savedEarlyFlag === undefined) delete process.env.NEXT_PUBLIC_EARLY_LESSON_OPENING;
    else process.env.NEXT_PUBLIC_EARLY_LESSON_OPENING = savedEarlyFlag;
    params.clearCancelTimers();
    timers.clear();
    forgetVerifiedScene(question, { boardId });
    Date.now = originalDateNow;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

async function main() {
  const selected = process.argv[2];
  const failures: string[] = [];
  if (!selected || selected === "early-reload") {
    try { console.log("verify-startup-turn:", verifyOpeningOnlyReload()); }
    catch (error) { console.error("verify-startup-turn: early-reload", error); failures.push(`early-reload: ${String(error)}`); }
  }
  if (!selected || selected === "early-opening-doubt") {
    try { console.log("verify-startup-turn:", verifyOpeningOnlyDoubtSnapshot()); }
    catch (error) { console.error("verify-startup-turn: early-opening-doubt", error); failures.push(`early-opening-doubt: ${String(error)}`); }
  }
  const modes: Mode[] = ["ready", "recorded-projectile", "numeric", "failed-compile", "retry", "prefix-stall", "partial-stall", "pause-stall", "pause-prelude", "control-eof", "one-step-stall", "one-step-split-stall", "resume-no-ink", "retry-expires", "stop-before-expiry", "stop-during-retry", "stale-content", "marker-only", "hedge-wins", "hedge-primary-wins", "hedge-fails", "early-on", "early-off", "early-stop", "early-pause", "early-dsa", "early-doubt", "early-resume", "intro-draw-failure"];
  // Default modes run with the hedge flag off, as shipped. The hedge modes,
  // and one retry with a silent hedge, run with it forced on.
  const runs: Array<[Mode, boolean, boolean]> = [
    ...modes.map((mode): [Mode, boolean, boolean] => [mode, HEDGE_MODES.includes(mode), mode.startsWith("early-") && mode !== "early-off"]),
    ["retry", true, false],
  ];
  assert(!selected || modes.includes(selected as Mode) || ["early-reload", "early-opening-doubt"].includes(selected), `unknown case: ${selected}`);
  for (const [mode, hedge, early] of runs) {
    if (selected && selected !== mode) continue;
    const label = hedge && !HEDGE_MODES.includes(mode) ? `${mode}+hedge` : mode;
    try { console.log("verify-startup-turn:", await scenario(mode, hedge, early)); }
    catch (error) {
      console.error(`verify-startup-turn: ${label}`, error);
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log("verify-startup-turn: actual handler, validation, first-step gate, opening delivery, hedge, retry, Stop, and cleanup verified");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
