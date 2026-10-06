// Adapted from the authorized external w2-shared-review/hook-harness.ts.
// Actual local hook/parser/segment runner; virtual time, React primitives and I/O mocks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { type DrawCommand, type TutorSegment } from "@heytutor/drawing";
import { mathToSpeech, normalizeTutorQuestion, type SpeakSegmentOptions, type TTSClient } from "@heytutor/tutor-core";
import { validateTurnPlanV3, synthesizeFamilyScene, type TurnPlanV3, type ProblemIR } from "@heytutor/scene-engine";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { forgetVerifiedScene } from "../../features/tutor-session/lib/scene/verifiedSceneRecovery";
import { createEmptySegmentPlanStats } from "../../features/tutor-session/lib/turn/segmentPlanning";
import type { HandleQuestionOptions, UseTurnLifecycleParams, TurnControlApi } from "../../features/tutor-session/hooks/turn/types";
import type { PausedLessonRequest } from "../../features/tutor-session/lib/turn/doubtTurn";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(path.join(app, "package.json"));
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

type Mode = string;
type Event = { atMs: number; name: string; data?: unknown };
type TeachingBody = { stream?: boolean; messages: { role: string; content: string }[] };
const teachingBodies = (events: Event[]) => events
  .filter(event => event.name === "request-body")
  .map(event => (event.data as { body: TeachingBody | null }).body)
  .filter((body): body is TeachingBody => Boolean(body?.stream));


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
    record("request-body", {url, body: init?.body ? JSON.parse(String(init.body)) : null});
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
    persistTurnForReplay: (...args: unknown[]) => { record("persist-local", args); return { id: "offline-turn", question, rawResponse: "", segments: [] }; },
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
      if (file.endsWith("useQuestionHandler.ts") && specifier === "../../constants") return {...requireApp(path.join(app, "features/tutor-session/constants.ts")), STREAM_SEGMENTS_LIVE: !mode.startsWith("batch")};
      if (specifier === "@/lib/billing/billingClient") return {
        ...requireApp(path.join(app, "lib/billing/billingClient.ts")),
        beginTurn: async () => { record("turn-admission"); return { ok: true }; },
      };
      if (specifier === "@/lib/boards/boardsClient") return {
        ...requireApp(path.join(app, "lib/boards/boardsClient.ts")),
        saveTurn: async (...args: unknown[]) => { record("board-save", args); return null; },
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

    const resume: PausedLessonRequest | undefined = ["resume-repair","resume-noink-arith","resume-noink-positive","resume-noink-leading-arith"].includes(mode) ? {
      boardId, lessonQuestion: question, turnPlan: plan, solverProjection: null,
      scene: null, figureDrawn: true, codeLesson: false, lessonBoardRows: [], interruptedStep: "Paused derivation.",
    } : undefined;
    let done = false;
    const turn = handler.handleQuestion(question, resume ? {resume} : undefined).finally(() => { done = true; });
    await flush();
    assert.equal(streams.length, 1, "actual hook reaches teaching");
    const good = "[STEP]ADMITTED sum five.[WRITE:2+3=5,80,150][/STEP]";
    const bad = "[STEP]REJECTED square six point three one six.[WRITE:2.513^2=6.316,80,210][/STEP]";
    const tail = "[STEP]WITHHELD tail even though correct.[WRITE:7+1=8,80,260][/STEP]";
    const fix = "[STEP]REPAIRED square rounds to six point three one five.[WRITE:2.513^2=6.315,80,210][/STEP]";
    const send = async (i: number, text: string, end=true) => { content(i,text); if(end) finishStream(i); await flush(); };
    if (mode === "positive" || mode === "batch-positive") await send(0,good+fix);
    else if (mode === "mixed" || mode === "batch-mixed") {
      await send(0,"[STEP]Two and one half.[WRITE:2 \\frac{1}{2}=2.5,80,150][/STEP]"+good);
      assert.equal(streams.length,1,"valid mixed notation must not request arithmetic repair");
    }
    else if (mode === "negative-mixed" || mode === "batch-negative-mixed") {
      await send(0,"[STEP]AMBIGUOUS negative mixed notation.[WRITE:-2\\frac{1}{2}=-2.5,80,150][/STEP]"+good);
      assert.equal(streams.length,1,"negative mixed notation must abstain rather than emit a false multiplication proof");
    }
    else if(mode==="explicit-fraction" || mode==="batch-explicit-fraction") await send(0,"[STEP]Explicit addition.[WRITE:2+\\frac{1}{2}=2.5,80,150][/STEP][STEP]Explicit multiplication.[WRITE:2*\\frac{1}{2}=1,80,210][/STEP]"+good);
    else if (mode === "parentheses-repair") {
      await send(0,"[STEP]REJECTED parentheses.[WRITE:2(3+4)=13,80,150][/STEP]"+tail);
      assert.equal(streams.length,2,"ordinary parenthesis multiplication must still reject a false answer");
      assert(JSON.stringify(teachingBodies(events).at(-1)).includes("= 14"),"repair carries the independently computed product");
      await send(1,"[STEP]FIXED parentheses.[WRITE:2(3+4)=14,80,150][/STEP]");
    }
    else if (mode === "atomic-multi") {
      await send(0,"[STEP]REJECTED combined beat.[WRITE:2+3=5,80,150][WRITE:2.513^2=6.316,80,210][/STEP]"+tail);
      assert.equal(streams.length,2); await send(1,fix);
    } else if (mode === "final-open") { await send(0,good+bad.replace("[/STEP]", ""));
      for(let i=1;i<3;i++){ assert.equal(streams.length,i+1); await send(i," more unfinished words"); }
    }
    else if (mode === "split") {
      content(0,good+bad.slice(0,-3)); await flush();
      content(0,bad.slice(-3)+tail); finishStream(0); await flush();
      assert.equal(streams.length,2); await send(1,fix);
    } else if (mode === "cancel") {
      content(0,good+bad+tail); await flush();
      runControl({...lifecycle,phase:lifecycle.phaseRef.current},handleRef).stopTurn({keepVisibleBoard:true});
    } else if(mode==="resume-noink-positive") {
      await send(0,"[STEP]DISCARDED no ink attempt words.[/STEP]");assert.equal(streams.length,2);await send(1,good+fix);
    } else if(mode==="resume-noink-arith") {
      await send(0,"[STEP]DISCARDED no ink attempt words.[/STEP]"); assert.equal(streams.length,2);
      await send(1,good+bad+tail); assert.equal(streams.length,3); await send(2,fix);
    } else if(mode==="resume-noink-leading-arith") {
      await send(0,"[STEP]DISCARDED no ink lead-in words.[/STEP]"+good+bad+tail);
      assert.equal(streams.length,2); await send(1,fix);
    } else if(mode==="cancel-repair") {
      await send(0,good+bad+tail);assert.equal(streams.length,2);
      runControl({...lifecycle,phase:lifecycle.phaseRef.current},handleRef).stopTurn({keepVisibleBoard:true});
    } else if (mode === "continuation-repair") {
      await send(0,good+"[STEP]Incomplete words");
      assert.equal(streams.length,2); await send(1,bad+tail);
      assert.equal(streams.length,3); await send(2,fix);
    } else {
      await send(0,(mode === "first-bad" ? "" : good)+bad+tail);
      if (mode === "batch-negative") { }
      else {
        assert.equal(streams.length,2, "first false arithmetic produces one repair");
        if (mode === "exhausted" || mode === "two-repairs") {
          await send(1,bad+tail); assert.equal(streams.length,3);
          await send(2,mode === "two-repairs" ? fix : bad+tail);
        } else await send(1,fix);
      }
    }
    await pump(()=>done); await turn;
    if(mode.startsWith("cancel")) { await advance(now+2000); }

    const output = events.filter(e=>["enqueue","playback","board-command","opening-prefetch"].includes(e.name));
    const forbidden = output.filter(e=>JSON.stringify(e.data).includes("REJECTED") || JSON.stringify(e.data).includes("WITHHELD") || JSON.stringify(e.data).includes("6.316"));
    assert.deepEqual(forbidden, [], "false full speech/ink and entire attempt tail must be absent from actual queues");
    for(const body of teachingBodies(events)) {
      assert(!body.messages.filter(m=>m.role==="assistant").some(m=>/DISCARDED|REJECTED|WITHHELD|6[.]316/.test(m.content)), "resumed assistant history excludes false beat and attempt tail; retry proof is user content");
    }
    const error=events.filter(e=>e.name==="turn-error");
    const raw=lifecycle.rawResponseRef.current;
    assert(!raw.includes("REJECTED")&&!raw.includes("WITHHELD")&&!raw.includes("6.316"), "raw persistence excludes rejected attempts");
    assert(!JSON.stringify(lifecycle.conversationHistoryRef.current).includes("REJECTED"), "final history excludes bad narration");
    const persisted = JSON.stringify({ recorded: lifecycle.recordedSegmentsRef.current,
      saved: events.filter(e=>["persist-local","board-save"].includes(e.name)) });
    assert(!/REJECTED|WITHHELD|6[.]316/.test(persisted), "recorded segments and both save payloads exclude the false beat and its tail");
    if (["exhausted","final-open","batch-negative"].includes(mode)) assert(error.length>0);
    else if(!mode.startsWith("cancel")) assert.equal(error.length,0, "success scenario must not fail");
    if(mode==="exhausted") assert.equal(streams.length,3,"two repairs maximum");
    if(mode==="cancel") assert.equal(streams.length,1,"cancellation must not dispatch a repair");
    if(mode==="atomic-multi") assert(!output.some(e=>JSON.stringify(e.data).includes("2+3=5")), "positive prefix of false multiwrite beat withheld");
    assert.equal(lifecycle.turnActiveRef.current,false); assert.equal(lifecycle.turnAbortRef.current,null);
    assert.equal(timers.size,0,"settled timers cleaned");
    if(mode.startsWith("resume-noink")) {
      assert(!raw.includes("DISCARDED"),"discarded no-ink narration stays out of saved response");
      assert(!JSON.stringify(lifecycle.conversationHistoryRef.current).includes("DISCARDED"),"discarded narration stays out of final history");
      assert(!JSON.stringify(events.filter(e=>["persist-local","board-save"].includes(e.name))).includes("DISCARDED"),"discarded narration stays out of both save payloads");
      assert(!JSON.stringify(lifecycle.recordedSegmentsRef.current).includes("DISCARDED"),"discarded narration stays out of recorded segments");
      assert(!output.some(e=>JSON.stringify(e.data).includes("DISCARDED")),"discarded narration stays out of queues and playback");
      assert(events.some(e=>e.name==="persist-local") && events.some(e=>e.name==="board-save"),"successful resumed turn exercises both persistence payloads");
      assert(raw.includes("ADMITTED sum five") && raw.includes("REPAIRED square"),"previously admitted work survives repair");
    }
    if(mode==="resume-noink-positive") assert(!raw.includes("DISCARDED"),"positive no-ink retry excludes abandoned narration when no arithmetic filter occurs");
    const receipt={mode,requests:streams.length,error:error.length,raw,history:lifecycle.conversationHistoryRef.current,
      queued:events.filter(e=>e.name==="enqueue").map(e=>e.data),
      playback:events.filter(e=>e.name==="playback").map(e=>e.data),
      teachingBodies:teachingBodies(events),
      recorded:lifecycle.recordedSegmentsRef.current,
      saved:events.filter(e=>["persist-local","board-save"].includes(e.name)).map(e=>e.data)};
    console.log(JSON.stringify(receipt)); return receipt;
  } finally {
    params.clearCancelTimers(); timers.clear(); forgetVerifiedScene(question,{boardId});
    Date.now=originalDateNow;
    for(const [key,descriptor] of saved) { if(descriptor) Object.defineProperty(globalThis,key,descriptor); else Reflect.deleteProperty(globalThis,key); }
  }
}
async function main(){
  for(const mode of ["positive","repair","first-bad","two-repairs","exhausted","atomic-multi","split","continuation-repair","final-open","cancel","cancel-repair","mixed","negative-mixed","batch-mixed","batch-negative-mixed","explicit-fraction","batch-explicit-fraction","parentheses-repair","resume-repair","resume-noink-arith","resume-noink-positive","resume-noink-leading-arith","batch-positive","batch-negative"]) {
    try { await scenario(mode); } catch(error) { console.log(JSON.stringify({mode,harnessFailure:String(error)})); process.exitCode=1; }
  }
}
void main();
