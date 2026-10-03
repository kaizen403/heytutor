import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { getSegmentCommands, type DrawCommand, type TutorSegment } from "@heytutor/drawing";
import { mathToSpeech, voiceSettingsForDelivery, normalizeTutorQuestion, type SpeakSegmentOptions, type TTSClient } from "@heytutor/tutor-core";
import { validateTurnPlanV3, synthesizeFamilyScene, type TurnPlanV3, type ProblemIR } from "@heytutor/scene-engine";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { forgetVerifiedScene } from "../../features/tutor-session/lib/scene/verifiedSceneRecovery";
import { createEmptySegmentPlanStats } from "../../features/tutor-session/lib/turn/segmentPlanning";
import type { HandleQuestionOptions, UseTurnLifecycleParams, TurnControlApi } from "../../features/tutor-session/hooks/turn/types";
import type { PausedLessonRequest } from "../../features/tutor-session/lib/turn/doubtTurn";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
requireApp("konva");
const react = {
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useEffect() {},
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
assert(validateTurnPlanV3(symbolicPlan, symbolicPlan.question).plan, "the symbolic fixture must be a real valid TurnPlanV3");
assert(validateTurnPlanV3(recordedPlan, recordedPlan.question).plan, "the recorded-question fixture must be a real valid TurnPlanV3");
const numericValidation = validateTurnPlanV3(numericPlan, numericQuestion);
assert(numericValidation.plan, `the numeric fixture must be a real valid TurnPlanV3: ${JSON.stringify(numericValidation)}`);
assert(selectFastVerifiedRepresentation({ question: symbolicPlan.question, turnPlan: symbolicPlan }), "the source-valid projectile must compile without a scene model");
assert(selectFastVerifiedRepresentation({ question: recordedPlan.question, turnPlan: recordedPlan }), "the source-stated angle must retain its verified deterministic figure");
assert.equal(selectFastVerifiedRepresentation({ question: numericQuestion, turnPlan: numericPlan }), null, "the numeric fixture must retain normal model validation");
assert.equal(synthesizeFamilyScene({ question: failedCompileQuestion, turnPlan: failedCompilePlan }), null, "the pole-crossing fixture must genuinely fail the deterministic family compile");

type Mode = "ready" | "recorded-projectile" | "numeric" | "failed-compile" | "retry" | "prefix-stall" | "partial-stall" | "pause-stall" | "pause-prelude" | "control-eof" | "one-step-stall" | "one-step-split-stall" | "resume-no-ink" | "retry-expires" | "stop-before-expiry" | "stop-during-retry" | "stale-content" | "marker-only" | "hedge-wins" | "hedge-primary-wins" | "hedge-fails";
type Event = { atMs: number; name: string; data?: unknown };

async function scenario(mode: Mode) {
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
  Date.now = () => 1_800_000_000_000 + now;
  const plan = mode === "numeric" ? numericPlan : mode === "failed-compile" ? failedCompilePlan
    : mode === "recorded-projectile" ? recordedPlan : symbolicPlan;
  const question = plan.question;
  const boardId = `startup-${mode}`;
  const streams: Array<{
    controller: ReadableStreamDefaultController<Uint8Array>;
    response: Response;
    retry: boolean;
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
    if (url.endsWith("/api/visual-need")) {
      record("visual-need-request");
      return Response.json({ decision: "required" });
    }
    if (url.endsWith("/api/trace/event")) {
      telemetry.push(JSON.parse(String(init?.body)));
      return Response.json({});
    }
    assert(url.endsWith("/api/chat"), `${mode}: no real network call is permitted: ${url}`);
    if (headers.get("x-turn-planner-version") === "3") {
      record("turn-plan-request");
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
    pause() {}, resume() {},
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
    executeCommandWithCancel: async (command: DrawCommand) => { record("board-command", command); },
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
      return requireApp(target);
    };
    new Function("require", "module", "exports", compiled)(localRequire, hookModule, hookModule.exports);
    loaded.set(file, hookModule.exports);
    return hookModule.exports;
  }

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
    const resume: PausedLessonRequest | undefined = mode === "resume-no-ink" ? {
      boardId, lessonQuestion: question, turnPlan: plan, solverProjection: null,
      scene: null, figureDrawn: true, codeLesson: false, lessonBoardRows: [], interruptedStep: "The range follows from horizontal motion.",
    } : undefined;
    if (resume) control.offerPausedLessonResume(resume);
    let done = false;
    const turn = handler.handleQuestion(plan === recordedPlan ? projectileQuestion : question, resume ? { resume } : undefined).finally(() => { done = true; });
    await flush();
    assert.equal(streams.length, 1, `${mode}: planning must reach the real teaching stream`);
    const outputs = () => events.filter((event) => ["enqueue", "enqueue-intro", "playback", "board-command"].includes(event.name));
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

    if (mode === "resume-no-ink") {
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
      assert(events.some((event) => event.name === "resume-offer" && event.data === resume),
        "failed notebook resumption must restore Continue with the exact original request");
      let continued: { question: string; options?: HandleQuestionOptions } | undefined;
      handleRef.current = async (nextQuestion, options) => {
        continued = { question: nextQuestion, options };
        lifecycle.turnActiveRef.current = true;
      };
      control.flushPausedLesson();
      await flush();
      assert.equal(continued?.question, question, "the restored Continue action must still dispatch the paused lecture");
      assert.equal(continued?.options?.resume, resume, "Continue must retain the board/plan/scene ownership of the original lecture");
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
        const silent = !["prefix-stall", "partial-stall", "pause-stall"].includes(mode);
        await advance(8_000);
        assert.equal(streams.length, silent ? 2 : 1, silent ? "a silent primary must be hedged at 8 seconds" : "a primary with a content token is never hedged");
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
        if (["hedge-wins", "hedge-primary-wins", "hedge-fails"].includes(mode)) {
          const marks = telemetry.flatMap((payload) => payload.events ?? []);
          const named = (name: string) => marks.filter((event) => event.name === name);
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
            assert.equal(typeof winner[0]!.metadata?.ttft_content_ms, "number");
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
    assert.equal(timers.size, 0, `${mode}: settled success/error must not leave startup or queue timers running (${[...timers.values()].map((timer) => timer.at - now).join(", ")} ms remain)`);
    if (mode === "retry") {
      assert(telemetry.some((payload) => payload.events?.some((event) => event.name === "teaching-startup-retry" || event.name === "reasoning-only-retry")), "the actual expiry must emit retry telemetry");
    }
    return { mode, events: events.length, teachingRequests: streams.length, sceneRequests: sceneRequests.length };
  } finally {
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
  const modes: Mode[] = ["ready", "recorded-projectile", "numeric", "failed-compile", "retry", "prefix-stall", "partial-stall", "pause-stall", "pause-prelude", "control-eof", "one-step-stall", "one-step-split-stall", "resume-no-ink", "retry-expires", "stop-before-expiry", "stop-during-retry", "stale-content", "marker-only", "hedge-wins", "hedge-primary-wins", "hedge-fails"];
  assert(!selected || modes.includes(selected as Mode), `unknown case: ${selected}`);
  for (const mode of modes) {
    if (selected && selected !== mode) continue;
    try { console.log("verify-startup-turn:", await scenario(mode)); }
    catch (error) {
      console.error(`verify-startup-turn: ${mode}`, error);
      failures.push(`${mode}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log("verify-startup-turn: actual handler, validation, first-step gate, opening delivery, hedge, retry, Stop, and cleanup verified");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
