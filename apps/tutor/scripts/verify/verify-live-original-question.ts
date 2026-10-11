/**
 * H1 caller-lineage regression gate. Executes the real live hooks and paused
 * lesson helpers. Only React/platform/paid transports are replaced; scene
 * selection, validation and compilation remain real. This is NOT an F2
 * consumer acceptance or save-path gate: those dependencies have not landed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import Konva from "konva";
import { normalizeTutorQuestion } from "@heytutor/tutor-core";
import { synthesizeFamilyScene, type TurnPlanV3 } from "@heytutor/scene-engine";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import type { HandleQuestionOptions, UseTurnLifecycleParams } from "../../features/tutor-session/hooks/turn/types";
import {
  lessonPageRecord, pausedLessonFromLive, pausedLessonOnStop, resumePageRecord,
  type PausedLessonRequest,
} from "../../features/tutor-session/lib/turn/doubtTurn";
import { pausedLessonFromStoredTurns, currentPausedLesson } from "../../features/tutor-session/lib/turn/pausedLessonRestore";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { autoQuestionSubmissionKey } from "../../features/tutor-session/lib/input/askDoubt";
import { createEmptySegmentPlanStats } from "../../features/tutor-session/lib/turn/segmentPlanning";
import { findVerifiedSceneRecovery, forgetVerifiedScene } from "../../features/tutor-session/lib/scene/verifiedSceneRecovery";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { NeutralPanelPresentationDeclined } from "./fixtures/frozen-neutral-panel-decline";
import { getSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
requireApp("konva");
const QUESTION = "Derive the formula for the range of a projectile on level ground.";
const RAW = `  ${QUESTION}\u200B  `;
const RAW_REPLACEMENT = `\n${QUESTION}\u200B\n`;
const CONTINUATION = "Continue from the last step.";
const BOARD = "original-question-gate";
const ref = <T,>(current: T) => ({ current });
const noop = () => {};
const originalOf = (value: unknown): unknown =>
  typeof value === "object" && value !== null && "originalQuestion" in value
    ? value.originalQuestion : undefined;
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question: QUESTION, givens: [],
  unknowns: [{ id: "range", symbol: "R" }], derived: [],
  qualitativeClaims: [{ id: "range", claim: "R = u^2 sin(2 theta) / g", expected: "u^2 sin(2 theta) / g", relatedQuantityIds: ["range"] }],
  lawIds: ["constant-acceleration"], assumptions: ["Air resistance is negligible"], visualRequirement: "required",
};

type Effect = { run: () => unknown; cleanup?: () => void };
type Loaded = Record<string, unknown>;

/** Persist refs across renders, including board changes. Effects are executed,
 * cleaned up and reinstalled; this observes behavior, not source text. */
function hookRuntime() {
  const slots = new Map<string, unknown[]>();
  const effects = new Map<string, Effect[]>();
  let owner = "", cursor = 0;
  const react = {
    useRef(current: unknown) {
      const state = slots.get(owner)!;
      const index = cursor++;
      if (!(index in state)) state[index] = ref(current);
      return state[index];
    },
    useState(value: unknown) {
      const state = slots.get(owner)!;
      const index = cursor++;
      if (!(index in state)) state[index] = typeof value === "function" ? value() : value;
      return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useCallback(fn: unknown) { cursor++; return fn; },
    useEffect(run: () => unknown) { cursor++; effects.get(owner)!.push({ run }); },
    useLayoutEffect(run: () => unknown) { cursor++; run(); },
    useSyncExternalStore(_subscribe: unknown, snapshot: () => unknown) { cursor++; return snapshot(); },
  };
  return {
    react,
    render<T>(name: string, render: () => T): T {
      for (const effect of effects.get(name) ?? []) effect.cleanup?.();
      owner = name; cursor = 0;
      if (!slots.has(name)) slots.set(name, []);
      effects.set(name, []);
      return render();
    },
    commit(name: string) {
      for (const effect of effects.get(name) ?? []) {
        const cleanup = effect.run();
        if (typeof cleanup === "function") effect.cleanup = cleanup as () => void;
      }
    },
    unmount() { for (const list of effects.values()) for (const effect of list) effect.cleanup?.(); },
  };
}

async function flush() { for (let index = 0; index < 120; index++) await Promise.resolve(); }

function fixture(options: { loaded?: boolean; autoQuestion?: string; boardId?: string;
  presentationError?: Error; restoreRefused?: boolean } = {}) {
  let now = 1_000;
  const presentationSources: unknown[] = [];
  const restorationInputs: Array<Parameters<typeof restoreVerifiedPresentationFromTurn>[0]> = [];
  const errors: unknown[] = [];
  const asked: Array<{ question: string; options?: HandleQuestionOptions }> = [];
  const teachingRequests: string[] = [];
  const verifiedIntros: unknown[][] = [];
  const telemetryPayloads: Array<{ events?: Array<{ name?: string; metadata?: Record<string, unknown> }> }> = [];
  const runtime = hookRuntime();
  const registry = new LiveTurnSaveRegistry({
    transport: {
      checkpoint: async () => ({ ok: false, status: 0, error: "offline gate", reason: "network", retryable: false }),
      close: async () => ({ ok: false, status: 0, error: "offline gate", reason: "network", retryable: false }),
    },
    setTimer: () => 1, clearTimer: noop, now: () => now, isOnline: () => false,
    mintId: () => "original-question-offline-turn",
  });
  const provider = { unlockAudio: noop, prewarm: async () => {}, prefetchSegment: noop };
  const params = {
    sessionId: options.boardId ?? BOARD, boards: [], boardLoaded: options.loaded ?? true,
    autoQuestion: options.autoQuestion, narrationText: "", phase: "idle", isReplaying: false, enableKeyboardControls: false,
    phaseRef: ref("idle"), cancelRef: ref(false), turnActiveRef: ref(false), pendingSegmentCountRef: ref(0),
    turnGenerationRef: ref(0), turnAbortRef: ref(null), isPausedRef: ref(false),
    pendingQuestionRef: ref<string | null>(null), autoSubmitDoneRef: ref(null), liveQuestionRef: ref(""),
    boardPageRef: ref(null), boardShowsStoppedReplayRef: ref(false), conversationHistoryRef: ref([]),
    collectedSegmentsRef: ref([]), recordedSegmentsRef: ref([]), storedTurnsRef: ref([]), rawResponseRef: ref(""),
    currentTraceIdRef: ref(null), turnTelemetryRef: ref(null), segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()),
    turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), segmentPlanStatsRef: ref(createEmptySegmentPlanStats()),
    narrationSinceEpochRef: ref(""), narrationDensityRef: ref(0), boardLayoutRef: ref({ rects: [], nextY: 100 }),
    fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false), activeVerifiedDiagramRef: ref(null),
    speedRef: ref(1), fastModeRef: ref(true), familiarityRef: ref("normal"), ttsClientRef: ref(provider),
    stopTurnRef: ref(null), rewoundRef: ref(false), replayAudioRef: ref(null), replayDrawClockRef: ref(null),
    replayAudioPreloadRef: ref(new Map()), replayGenerationRef: ref(0), replayCueRef: ref(null),
    whiteboardRef: ref({ getDrawLayer: () => ({}) }), ensureTTSClient: () => provider,
    setPhase: noop, setNarrationText: noop, setCurrentSegmentText: noop,
    setLastError: (error: unknown) => { if (error !== null) errors.push(error); }, setLiveQuestion: noop,
    setIsPaused: noop, setInputInteracted: noop, setIsReplaying: noop, setReplayProgressMs: noop, setReplayTotalMs: noop,
    setStoredTurnsCount: noop, setBoards: noop, setActiveVerifiedDiagram: noop, resetBoardLayout: noop,
    executeCommandWithCancel: async () => {}, reserveTextCommandPlacements: async () => [], raceWithCancel: (operation: Promise<unknown>) => operation,
    clearCancelTimers: noop, beginBoardEpoch: async () => {}, registerReplayBlobUrl: noop, revokeUnreferencedReplayBlobUrls: noop,
    refreshBoardFromTurns: async () => true,
  };
  const restores = new Map<string, PropertyDescriptor | undefined>();
  const replace = (name: string, value: unknown) => {
    restores.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  replace("window", { setTimeout, clearTimeout, addEventListener: noop, removeEventListener: noop,
    requestAnimationFrame: (run: () => void) => setTimeout(run, 0), cancelAnimationFrame: clearTimeout,
    location: { pathname: `/c/${params.sessionId}` }, history: { replaceState: noop } });
  replace("performance", { now: () => now });
  replace("navigator", { locks: {
    request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({}),
    query: async () => ({ held: [], pending: [] }),
  } });
  replace("fetch", async (url: string, init?: RequestInit) => {
    if (/\/api\/boards\/[^/]+\?page=0$/.test(url)) return Response.json({ board: { id: params.sessionId, title: "Test", createdAt: 0 }, turns: params.storedTurnsRef.current, nextPage: null });
    if (url.endsWith("/api/trace/event")) {
      telemetryPayloads.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({});
    }
    if (url.endsWith("/api/visual-need")) return Response.json({ decision: "required" });
    if (url.endsWith("/api/chat") && new Headers(init?.headers).get("x-turn-planner-version") === "3") {
      return Response.json({ choices: [{ message: { content: JSON.stringify(plan) } }] });
    }
    if (url.endsWith("/api/chat")) {
      teachingRequests.push(String(init?.body ?? ""));
      // The live caller owns parsing this ordinary teaching response. It is
      // deliberately not a chemistry/F2 response or a fabricated witness.
      const content = Array.from({ length: 8 }, (_, index) => `[STEP]Use the motion relation.[WRITE:x = u t,80,${150 + 40 * index}][/STEP]`).join("");
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } });
    }
    if (/\/api\/boards\/[^/]+\/turns\/[^/]+$/.test(url)) return new Response("offline checkpoint", { status: 503 });
    throw new Error(`No paid or real network transport is permitted by this gate: ${url}`);
  });
  const loaded = new Map<string, Loaded>();
  function loadHook(relative: string): Loaded {
    const filename = path.join(app, relative);
    if (loaded.has(filename)) return loaded.get(filename)!;
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loadedModule = { exports: {} as Loaded };
    const localRequire = (specifier: string) => {
      if (specifier === "react") return runtime.react;
      if (specifier.endsWith("/turn/liveTurnSave")) return {
        ...requireApp(path.join(app, "features/tutor-session/lib/turn/liveTurnSave.ts")), liveTurnSave: () => registry,
      };
      if (specifier === "@/lib/billing/billingClient") return {
        ...requireApp(path.join(app, "lib/billing/billingClient.ts")), beginTurn: async () => ({ ok: true }),
      };
      if (specifier === "@/lib/boards/boardsClient") return {
        ...requireApp(path.join(app, "lib/boards/boardsClient.ts")), requestBoardTitle: async () => null,
        updateBoard: async () => null,
      };
      if (specifier === "../../lib/scene/verifiedScenePresentation") return {
        ...requireApp(path.join(app, "features/tutor-session/lib/scene/verifiedScenePresentation.ts")),
        buildVerifiedDiagramPresentation(...args: Parameters<typeof buildVerifiedDiagramPresentation>) {
          presentationSources.push(originalOf(args[2]));
          if (options.presentationError) throw options.presentationError;
          return buildVerifiedDiagramPresentation(...args);
        },
      };
      if (specifier === "../../lib/scene/restoreVerifiedDiagram") return {
        ...requireApp(path.join(app, "features/tutor-session/lib/scene/restoreVerifiedDiagram.ts")),
        restoreVerifiedPresentationFromTurn(turn: Parameters<typeof restoreVerifiedPresentationFromTurn>[0]) {
          restorationInputs.push(turn);
          if (options.restoreRefused) return null;
          return restoreVerifiedPresentationFromTurn(turn);
        },
      };
      if (specifier === "./useSegmentRunner") return { useSegmentRunner: () => ({
        runSegment: async () => {}, pauseFallbackSpeech: noop, resumeFallbackSpeech: noop, stopFallbackSpeech: noop,
        speakingNarrationRef: ref(""),
      }) };
      return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
        : specifier.startsWith(".") ? path.resolve(path.dirname(filename), specifier) : specifier);
    };
    new Function("require", "module", "exports", compiled)(localRequire, loadedModule, loadedModule.exports);
    loaded.set(filename, loadedModule.exports);
    return loadedModule.exports;
  }
  const Handler = loadHook("features/tutor-session/hooks/turn/useQuestionHandler.ts").useQuestionHandler as typeof import("../../features/tutor-session/hooks/turn/useQuestionHandler").useQuestionHandler;
  const Control = loadHook("features/tutor-session/hooks/turn/useTurnControl.ts").useTurnControl as typeof import("../../features/tutor-session/hooks/turn/useTurnControl").useTurnControl;
  const controlPort = {
    finishLectureUi: () => { params.phaseRef.current = "idle"; params.turnActiveRef.current = false; },
    enqueueSegment: (segment: unknown) => { (params.collectedSegmentsRef.current as unknown[]).push(segment); },
    enqueueVerifiedIntro: (segments: unknown[]) => { verifiedIntros.push(segments); },
    processResponseText: async () => {}, offerPausedLessonResume: noop, clearPausedLesson: noop,
  };
  const handleRef = ref(async (question: string, askOptions?: HandleQuestionOptions) => { asked.push({ question, options: askOptions }); });
  const mountHandler = () => runtime.render("handler", () => Handler(params as unknown as UseTurnLifecycleParams, controlPort));
  const mountControl = () => runtime.render("control", () => Control(params as unknown as UseTurnLifecycleParams, handleRef));
  return {
    params, asked, presentationSources, restorationInputs, errors, runtime, mountHandler, mountControl, teachingRequests, verifiedIntros, telemetryPayloads,
    advance: (milliseconds: number) => { now += milliseconds; },
    async settle() { await flush(); },
    close() {
      params.cancelRef.current = true;
      runtime.unmount(); forgetVerifiedScene(QUESTION, { boardId: params.sessionId });
      for (const [name, descriptor] of restores) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

const results: Array<{ name: string; passed: boolean; error?: string }> = [];
async function test(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}

async function queuedTest(options: { replacement?: boolean; expire?: boolean; switchBoard?: boolean; cancel?: boolean; superseded?: boolean } = {}) {
  const f = fixture({ loaded: false });
  try {
    const handler = f.mountHandler();
    await handler.handleQuestion(RAW);
    if (options.replacement) await handler.handleQuestion(RAW_REPLACEMENT);
    if (options.expire) f.advance(60_001);
    if (options.switchBoard) f.params.sessionId = `${BOARD}-other`;
    if (options.cancel) f.params.cancelRef.current = true;
    if (options.superseded) f.params.turnGenerationRef.current += 1;
    f.params.boardLoaded = true;
    f.mountHandler(); f.runtime.commit("handler"); await f.settle();
    if (options.expire || options.switchBoard || options.cancel || options.superseded) {
      assert.equal(f.presentationSources.length, 0, "stale queued intake cannot promote any original source to a new live figure");
    } else {
      assert.equal(f.presentationSources.length, 1, "queued intake must reach actual validated presentation once");
      assert.equal(f.presentationSources[0], options.replacement ? RAW_REPLACEMENT : RAW,
        "queue must retain the latest unchanged raw source, not a normalized same-text predecessor");
    }
  } finally { f.close(); }
}

function stored(question = RAW): StoredTurn {
  return {
    id: "original-source-parent", orderIndex: 0, question, kind: "lesson", status: "stopped", persistedStatus: "stopped",
    rawResponse: "A spoken step.", speedMultiplier: 1, traceId: "original-source-trace", sceneDocument: null,
    sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
    segments: [{ id: "source-step", orderIndex: 0, narration: "A spoken step.", spokenText: "A spoken step.", command: null, audioUrl: null, durationMs: null, timings: null }],
  };
}

/** A genuinely drawn cached ordinary scene, with canonical trusted intro rows.
 * Authenticated resume admission derives figureDrawn from those rows, not a
 * forged request boolean. This fixture makes no F2/save admission claim. */
function cachedResumeFixture(source = `  ${QUESTION}  `) {
  const representation = synthesizeFamilyScene({ question: QUESTION, turnPlan: plan });
  assert(representation);
  const presentation = buildVerifiedDiagramPresentation(representation.document, representation.renderScene, { originalQuestion: source });
  assert(presentation.introSegments.length > 0);
  const parent: StoredTurn = { ...stored(source), sceneDocument: representation.document, visualStatus: "validated",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: plan, representationTier: representation.tier, nonMetric: representation.nonMetric },
    segments: [...presentation.introSegments.map((segment, index) => ({
      id: `canonical-intro-${index}`, orderIndex: index, narration: segment.narration, spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }),
      audioUrl: null, durationMs: null, timings: null,
    })), { ...stored(source).segments[0]!, orderIndex: presentation.introSegments.length }],
  };
  const paused = pausedLessonFromStoredTurns([parent], { boardId: BOARD, ownerState: "inactive" });
  assert(paused?.figureDrawn, "actual trusted intro rows must establish a drawn cached parent");
  return { source, parent, paused, presentation };
}

async function main() {
  assert.equal(normalizeTutorQuestion(RAW), QUESTION);
  assert.equal(normalizeTutorQuestion(RAW_REPLACEMENT), QUESTION, "the replacement control must genuinely collide after normalization");
  await test("fresh hook presents unchanged original while retaining normalized teaching question", async () => {
    const f = fixture();
    try {
      await f.mountHandler().handleQuestion(RAW);
      assert.equal(f.presentationSources.length, 1, "source-valid scene must pass actual validation/compile/presentation");
      assert.equal(f.presentationSources[0], RAW);
      assert.equal(f.params.liveQuestionRef.current, QUESTION, "normal teaching context remains normalized");
      assert.equal(originalOf(f.params.boardPageRef.current), RAW, "the owning page retains original source for Stop");
    } finally { f.close(); }
  });
  await test("scoped presentation refusal drops visual authority while teaching continues", async () => {
    // This error-port control tests the live caller's containment only. The
    // scene before that boundary still passes real selection and compilation;
    // the pinned Error is NOT a mocked F2 producer acceptance or rejection.
    const f = fixture({ presentationError: new NeutralPanelPresentationDeclined([
      { code: "neutral_comparison_declined", severity: "fatal", message: "Synthetic original source refusal" },
    ]) });
    try {
      await f.mountHandler().handleQuestion(RAW);
      assert.deepEqual(f.presentationSources, [RAW]);
      assert.equal(f.teachingRequests.length, 1, "a typed visual refusal cannot abort ordinary teaching");
      assert.equal(f.errors.length, 0, "a scoped visual refusal is not an operational turn failure");
      assert.equal(f.params.activeVerifiedDiagramRef.current, null);
      assert.equal(f.verifiedIntros.flat().length, 0, "no refused figure beat is queued");
      const page = f.params.boardPageRef.current as ReturnType<typeof lessonPageRecord> | null;
      assert(page);
      assert.equal(page.figureDrawn, false);
      assert.equal(page.turn.scene?.sceneDocument ?? null, null, "refused raw geometry cannot reach the save owner");
      const artifacts = page.turn.scene?.sceneArtifacts as Record<string, unknown> | null | undefined;
      assert.notEqual(artifacts?.diagramResultStatus, "ready");
      assert.equal(artifacts?.selectedCandidateId ?? null, null, "no stale selected candidate retains figure authority");
      assert.equal(findVerifiedSceneRecovery(QUESTION, [], { boardId: BOARD }), null);
    } finally { f.close(); }
  });
  await test("unrelated presentation failure remains fatal instead of being treated as text-only", async () => {
    const f = fixture({ presentationError: new Error("Synthetic operational presentation failure") });
    try {
      await f.mountHandler().handleQuestion(RAW);
      assert.deepEqual(f.presentationSources, [RAW]);
      assert.equal(f.teachingRequests.length, 0, "an operational error cannot silently become a successful text-only lesson");
      assert.equal(f.errors.length, 1);
      assert.equal(f.params.activeVerifiedDiagramRef.current, null);
      assert.equal(f.verifiedIntros.flat().length, 0);
      assert.equal(f.params.turnActiveRef.current, false);
    } finally { f.close(); }
  });
  await test("source-refused resume cannot retain an inherited cached figure or its remaining intro", async () => {
    const { parent, paused, presentation: checkedPresentation } = cachedResumeFixture(RAW);
    const f = fixture({ restoreRefused: true });
    try {
      (f.params.storedTurnsRef as { current: StoredTurn[] }).current = [parent];
      (f.params.activeVerifiedDiagramRef as { current: unknown }).current = checkedPresentation.diagram;
      await f.mountHandler().handleQuestion(QUESTION, { resume: { ...paused, figureDrawn: true,
        remainingIntro: checkedPresentation.introSegments } });
      assert.equal(f.errors.length, 0, `resume must reach source restore without an earlier operational error: ${JSON.stringify(f.errors)}`);
      assert.equal(f.restorationInputs.length, 1, "even an active inherited figure needs source-aware restore before reuse");
      assert.equal(f.restorationInputs[0]?.question, RAW);
      assert.equal(f.params.activeVerifiedDiagramRef.current, null, "a cached active diagram cannot outlive source refusal");
      assert.equal(f.verifiedIntros.flat().length, 0, "unproved live remaining beats cannot bypass source refusal");
      assert.equal(f.teachingRequests.length, 1);
      assert.equal(f.errors.length, 0);
      const page = f.params.boardPageRef.current as ReturnType<typeof lessonPageRecord> | null;
      assert.equal(page?.figureDrawn, false);
      assert.equal(page?.turn.scene?.sceneDocument ?? null, null);
    } finally { f.close(); }
  });
  for (const refusal of ["source", "suffix"] as const) {
    await test(`drawn resume ${refusal} refusal retains observed prior ink without scene authority, including a later doubt`, async () => {
      const { parent, paused, presentation } = cachedResumeFixture(RAW);
      const f = fixture({ restoreRefused: refusal === "source" });
      const board = mountTestWhiteboard();
      try {
        // One genuinely compiled permanent mark is enough to observe retained
        // ink. This is not a whole-frame fidelity or save-acceptance oracle.
        const mark = presentation.diagram.commands.find((command) => command.type === "DRAW_LINE" && command.params.length >= 4);
        assert(mark, "the actual engine fixture must supply a permanent line");
        const layer = board.getDrawLayer();
        assert(layer);
        layer.add(new Konva.Line({ points: mark.params.slice(0, 4), stroke: "black" }));
        const retainedInk = JSON.stringify(layer.getChildren().map((node) => node.toObject()));
        const page = lessonPageRecord(BOARD, QUESTION, RAW);
        page.figureDrawn = true;
        page.turnPlan = plan;
        page.turn.scene = paused.scene;
        page.figureSubject = "physics";
        page.figureDiagnostics = { figureSource: "family", representationTier: "qualitative_verified", primitiveCount: null };
        (f.params.whiteboardRef as { current: unknown }).current = board;
        (f.params.boardPageRef as { current: unknown }).current = page;
        (f.params.storedTurnsRef as { current: StoredTurn[] }).current = [parent];
        (f.params.activeVerifiedDiagramRef as { current: unknown }).current = presentation.diagram;
        const remainingIntro = structuredClone(presentation.introSegments.slice(-1));
        if (refusal === "suffix") remainingIntro[0]!.narration += " synthetic noncanonical remainder";
        const handler = f.mountHandler();
        await handler.handleQuestion(QUESTION, { resume: { ...paused, remainingIntro } });
        await f.settle();
        const terminal = () => f.telemetryPayloads.flatMap((payload) => payload.events ?? [])
          .filter((event) => event.name === "figure-turn-terminal").at(-1)?.metadata;
        assert.equal(terminal()?.figure_outcome, "empty");
        assert.equal(terminal()?.figure_empty_cause, "presentation_refused");
        assert.equal(terminal()?.figure_prior_ink_retained, true,
          "refused new authority must not claim the retained board mark vanished");
        assert.equal(f.params.activeVerifiedDiagramRef.current, null);
        assert.equal(f.verifiedIntros.flat().length, 0);
        const refusedPage = f.params.boardPageRef.current as ReturnType<typeof lessonPageRecord> | null;
        assert.equal(refusedPage?.figureDrawn, false);
        assert.equal(refusedPage?.turn.scene?.sceneDocument ?? null, null);
        assert.equal(refusedPage?.figureDiagnostics?.priorInkRetained, true);
        assert.equal(JSON.stringify(layer.getChildren().map((node) => node.toObject())), retainedInk);

        await handler.handleQuestion("Explain the last step.", { doubt: { prompt: "Explain the last step.",
          title: "Doubt: last step", lessonQuestion: QUESTION, afterReplay: false } });
        await f.settle();
        assert.equal(terminal()?.figure_outcome, "empty", "a visibility observer cannot restore figure authority for a doubt");
        assert.equal(terminal()?.figure_prior_ink_retained, true,
          "a later in-tab doubt must carry the observer even after active authority was cleared");
        assert.equal(f.params.activeVerifiedDiagramRef.current, null);
        assert.equal(f.verifiedIntros.flat().length, 0);
        assert.equal(f.teachingRequests.length, 2, "both refused Continue and text-only doubt still teach");
        assert.equal(f.errors.length, 0);
        assert.equal(JSON.stringify(layer.getChildren().map((node) => node.toObject())), retainedInk);
      } finally { unmountTestWhiteboard(board); f.close(); }
    });
  }
  await test("a valid cached drawn resume receives fresh canonical authority without redrawing its figure", async () => {
    const { source, parent, paused, presentation } = cachedResumeFixture();
    const f = fixture();
    try {
      (f.params.storedTurnsRef as { current: StoredTurn[] }).current = [parent];
      (f.params.activeVerifiedDiagramRef as { current: unknown }).current = presentation.diagram;
      await f.mountHandler().handleQuestion(QUESTION, { resume: paused });
      assert.equal(f.restorationInputs.length, 1);
      assert.equal(f.restorationInputs[0]?.question, source);
      assert(f.params.activeVerifiedDiagramRef.current);
      assert.equal(f.verifiedIntros.flat().length, 0, "a fully drawn cached figure is not drawn twice");
      assert.equal(f.teachingRequests.length, 1);
      assert.equal(f.errors.length, 0);
    } finally { f.close(); }
  });
  await test("source-refused resume withdraws a historically accepted candidate", async () => {
    const { parent, paused, presentation } = cachedResumeFixture();
    // Historical candidate evidence is not new producer acceptance. The
    // caller must withdraw its actual persisted `accepted` discriminant when
    // the freshly restored presentation is refused.
    parent.sceneArtifacts = {
      ...(parent.sceneArtifacts as Record<string, unknown>), selectedCandidateId: "historical-accepted-candidate",
      candidates: [{ candidateId: "historical-accepted-candidate", accepted: true,
        sceneDocument: parent.sceneDocument, validationReport: parent.validationReport }],
    };
    const request = currentPausedLesson(paused, [parent]);
    assert(request);
    const f = fixture({ restoreRefused: true });
    try {
      (f.params.storedTurnsRef as { current: StoredTurn[] }).current = [parent];
      (f.params.activeVerifiedDiagramRef as { current: unknown }).current = presentation.diagram;
      await f.mountHandler().handleQuestion(QUESTION, { resume: request });
      assert.equal(f.restorationInputs.length, 1);
      assert.equal(f.teachingRequests.length, 1);
      assert.equal(f.errors.length, 0);
      const page = f.params.boardPageRef.current as ReturnType<typeof lessonPageRecord> | null;
      const artifacts = page?.turn.scene?.sceneArtifacts as {
        selectedCandidateId?: string | null; candidates?: Array<{ accepted?: boolean }>;
      } | undefined;
      assert.equal(artifacts?.selectedCandidateId, null);
      assert.equal(artifacts?.candidates?.length, 1, "diagnostic evidence is retained, not silently deleted");
      assert.equal(artifacts?.candidates?.[0]?.accepted, false,
        "a refused presentation cannot preserve accepted:true in the real persisted candidate field");
    } finally { f.close(); }
  });
  await test("a legitimate text-only resume clears unrelated cached diagram authority", async () => {
    const { source, presentation } = cachedResumeFixture();
    const parent = { ...stored(source), sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: plan } };
    const paused = pausedLessonFromStoredTurns([parent], { boardId: BOARD, ownerState: "inactive" });
    assert(paused);
    assert.equal(paused.figureDrawn, false);
    assert.equal(paused.scene?.sceneDocument ?? null, null);
    const f = fixture();
    try {
      (f.params.storedTurnsRef as { current: StoredTurn[] }).current = [parent];
      (f.params.activeVerifiedDiagramRef as { current: unknown }).current = presentation.diagram;
      await f.mountHandler().handleQuestion(QUESTION, { resume: paused });
      assert.equal(f.errors.length, 0);
      assert.equal(f.teachingRequests.length, 1);
      assert.equal(f.restorationInputs.length, 0, "a text-only historical page supplies no scene to restore");
      assert.equal(f.verifiedIntros.flat().length, 0);
      assert.equal(f.params.activeVerifiedDiagramRef.current, null,
        "absence of scene authority must clear an unrelated inherited active diagram ref");
      const page = f.params.boardPageRef.current as ReturnType<typeof lessonPageRecord> | null;
      assert.equal(page?.figureDrawn, false);
      assert.equal(page?.turn.scene?.sceneDocument ?? null, null);
    } finally { f.close(); }
  });
  await test("a canonical cached intro suffix is retained while a mutated suffix loses visual authority", async () => {
    const { source, parent, paused, presentation } = cachedResumeFixture();
    const canonical = presentation.introSegments.slice(-1);
    for (const mutated of [false, true]) {
      const f = fixture();
      try {
        (f.params.storedTurnsRef as { current: StoredTurn[] }).current = [parent];
        (f.params.activeVerifiedDiagramRef as { current: unknown }).current = presentation.diagram;
        const remainder = structuredClone(canonical);
        if (mutated) remainder[0]!.narration += " synthetic noncanonical remainder";
        await f.mountHandler().handleQuestion(QUESTION, { resume: { ...paused, remainingIntro: remainder } });
        assert.equal(f.restorationInputs[0]?.question, source);
        assert.equal(f.teachingRequests.length, 1);
        assert.equal(f.errors.length, 0);
        if (mutated) {
          assert.equal(f.params.activeVerifiedDiagramRef.current, null);
          assert.equal(f.verifiedIntros.flat().length, 0);
          const page = f.params.boardPageRef.current as ReturnType<typeof lessonPageRecord> | null;
          assert.equal(page?.figureDrawn, false);
          assert.equal(page?.turn.scene?.sceneDocument ?? null, null);
        } else {
          assert(f.params.activeVerifiedDiagramRef.current);
          assert.deepEqual(f.verifiedIntros.flat(), canonical);
        }
      } finally { f.close(); }
    }
  });
  await test("AutoAsk preserves raw source but keeps existing trimmed once-per-board key", async () => {
    const f = fixture({ autoQuestion: RAW });
    try {
      f.mountControl(); f.runtime.commit("control"); await f.settle();
      assert.equal(f.asked.length, 1);
      assert.equal(originalOf(f.asked[0]!.options) ?? f.asked[0]!.question, RAW);
      const key = f.params.autoSubmitDoneRef.current;
      assert.equal(key, autoQuestionSubmissionKey(BOARD, RAW.trim()), "raw source must not change the existing trimmed submission identity");
      f.mountControl(); f.runtime.commit("control"); await f.settle();
      assert.equal(f.asked.length, 1, "a raw-source sidecar must not repeat an already-consumed AutoAsk");
      assert.equal(f.params.autoSubmitDoneRef.current, key);
      f.params.sessionId = `${BOARD}-second`;
      f.mountControl(); f.runtime.commit("control"); await f.settle();
      assert.equal(f.asked.length, 2, "an identical AutoAsk on another board remains a different submission");
    } finally { f.close(); }
  });
  await test("queue forwards raw source", () => queuedTest());
  await test("same normalized queue replacement uses newest raw source", () => queuedTest({ replacement: true }));
  await test("queue source expires rather than adopting a later visit", () => queuedTest({ expire: true }));
  await test("queue source cannot cross a board switch", () => queuedTest({ switchBoard: true }));
  await test("cancelled queue does not start a new lesson", () => queuedTest({ cancel: true }));
  await test("superseded generation cannot reuse queued source", () => queuedTest({ superseded: true }));
  await test("queued doubt keeps its own options and the lesson original source", async () => {
    const f = fixture({ loaded: false });
    try {
      (f.params.boardPageRef as { current: unknown }).current = lessonPageRecord(BOARD, QUESTION, RAW);
      const prompt = "i have a doubt about this lesson. Why is the range zero?";
      const doubt = { prompt, title: "Doubt: range", lessonQuestion: QUESTION, afterReplay: false };
      await f.mountHandler().handleQuestion(prompt, { doubt });
      f.params.boardLoaded = true; f.mountHandler(); f.runtime.commit("handler"); await f.settle();
      const page = f.params.boardPageRef.current as ReturnType<typeof lessonPageRecord> | null;
      assert.equal(page?.turn.kind, "doubt", "a queued doubt cannot become a fresh lesson");
      assert.equal(page?.turn.question, doubt.title);
      assert.equal(originalOf(page), RAW, "the doubt prompt cannot replace the lesson source");
      assert.equal(f.presentationSources.length, 0, "a doubt does not plan a replacement figure");
    } finally { f.close(); }
  });
  await test("a later same-normalized lesson replacement cannot inherit queued doubt options", async () => {
    const f = fixture({ loaded: false });
    try {
      const handler = f.mountHandler();
      await handler.handleQuestion(RAW, { doubt: { prompt: RAW, title: "Doubt: previous queued request",
        lessonQuestion: QUESTION, afterReplay: false } });
      await handler.handleQuestion(RAW_REPLACEMENT);
      f.params.boardLoaded = true; f.mountHandler(); f.runtime.commit("handler"); await f.settle();
      const page = f.params.boardPageRef.current as ReturnType<typeof lessonPageRecord> | null;
      assert.equal(page?.turn.kind, "lesson");
      assert.equal(page?.turn.question, QUESTION);
      assert.equal(originalOf(page), RAW_REPLACEMENT);
      assert.deepEqual(f.presentationSources, [RAW_REPLACEMENT]);
    } finally { f.close(); }
  });
  await test("live Stop then Continue carries original lesson source, not continuation prompt", () => {
    const page = { ...lessonPageRecord(BOARD, QUESTION), originalQuestion: RAW };
    const stop = pausedLessonOnStop({ record: page, boardId: BOARD, activeResume: null, taught: true,
      liveQuestion: QUESTION, codeLesson: false, lessonBoardRows: [], interruptedStep: "A spoken step.", parentTraceId: "parent" });
    assert(stop);
    assert.equal(originalOf(stop), RAW);
    const resumed = resumePageRecord({ boardId: BOARD, lessonQuestion: stop.lessonQuestion, figureDrawn: false,
      turnPlan: null, solverProjection: null, scene: stop.scene, originalQuestion: stop.originalQuestion });
    const next = pausedLessonFromLive({ record: resumed, boardId: BOARD, lessonQuestion: CONTINUATION,
      codeLesson: false, figureDrawn: false });
    assert.equal(originalOf(next), RAW, "a continuation's own prompt never owns the lesson figure");
  });
  await test("planning interrupted before page creation retains externally supplied original", () => {
    const paused = pausedLessonFromLive({ record: null, boardId: BOARD, lessonQuestion: QUESTION,
      originalQuestion: RAW, codeLesson: false, figureDrawn: false });
    assert.equal(originalOf(paused), RAW);
  });
  await test("reloaded stopped lesson retains stored original source and fresh parent lineage", () => {
    const parent = stored();
    const paused = pausedLessonFromStoredTurns([parent], { boardId: BOARD, ownerState: "inactive" });
    assert(paused);
    assert.equal(originalOf(paused), RAW);
    assert.equal(originalOf(currentPausedLesson(paused, [parent])), RAW);
    assert.equal(paused.parentTurnId, parent.id);
    assert.equal(paused.parentTraceId, parent.traceId);
  });
  await test("authenticated matched live resume keeps its raw sidecar despite a normalized saved header", () => {
    // This proves only in-tab caller carry: the persisted header intentionally
    // remains normalized, so this is NOT canonical raw-source reload proof.
    const parent = stored(QUESTION);
    const fresh = pausedLessonFromStoredTurns([parent], { boardId: BOARD, ownerState: "inactive" });
    assert(fresh);
    assert.equal(fresh.originalQuestion, QUESTION);
    const liveRequest = { ...fresh, originalQuestion: RAW };
    assert.equal(currentPausedLesson(liveRequest, [parent])?.originalQuestion, RAW);
    assert.equal(currentPausedLesson({ ...liveRequest, parentTurnId: "foreign-parent" }, [parent]), null,
      "a foreign parent cannot carry a raw sidecar across authenticated admission");
    assert.equal(currentPausedLesson({ ...liveRequest, parentTurnId: undefined, parentTraceId: "foreign-trace" }, [parent]), null);
  });
  await test("actual Continue restore receives the saved source and artifacts, not its request prompt", async () => {
    const source = `  ${QUESTION}  `;
    const representation = synthesizeFamilyScene({ question: QUESTION, turnPlan: plan });
    assert(representation, "real source-valid fixture must compile");
    const parent = { ...stored(source), sceneDocument: representation.document, visualStatus: "validated" as const,
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: plan, representationTier: representation.tier, nonMetric: representation.nonMetric } };
    const paused = pausedLessonFromStoredTurns([parent], { boardId: BOARD, ownerState: "inactive" });
    assert(paused);
    const f = fixture();
    try {
      (f.params.storedTurnsRef as { current: StoredTurn[] }).current = [parent];
      await f.mountHandler().handleQuestion(CONTINUATION, { resume: paused });
      assert.equal(f.restorationInputs.length, 1, "the actual Continue path re-establishes an undrawn saved scene");
      assert.equal(f.restorationInputs[0]?.question, source);
      assert.deepEqual(f.restorationInputs[0]?.sceneArtifacts, paused.scene?.sceneArtifacts);
      assert.equal(originalOf(f.params.boardPageRef.current), source);
      assert.notEqual(f.restorationInputs[0]?.question, CONTINUATION);
    } finally { f.close(); }
  });
  await test("setup exception before telemetry is handled and releases the owning turn", async () => {
    const f = fixture();
    try {
      f.params.revokeUnreferencedReplayBlobUrls = () => { throw new Error("synthetic setup failure"); };
      await assert.doesNotReject(f.mountHandler().handleQuestion(RAW), "the UI's fire-and-forget Ask must not leak a rejected promise");
      assert.equal(f.params.turnActiveRef.current, false);
      assert.equal(f.params.phaseRef.current, "idle");
      assert.equal(f.params.turnAbortRef.current, null);
      assert.equal(f.errors.length, 1, "a current operational failure is surfaced exactly once, not misclassified as superseded");
    } finally { f.close(); }
  });
  await test("epoch exception after telemetry is handled without an unhandled Ask rejection", async () => {
    const f = fixture();
    try {
      f.params.beginBoardEpoch = async () => { throw new Error("synthetic epoch failure"); };
      await assert.doesNotReject(f.mountHandler().handleQuestion(RAW), "an already handled startup error must resolve its public UI call");
      assert.equal(f.params.turnActiveRef.current, false);
      assert.equal(f.params.phaseRef.current, "idle");
      assert.equal(f.params.turnAbortRef.current, null);
      assert.equal(f.errors.length, 1);
    } finally { f.close(); }
  });
  await test("authenticated visible refresh installs raw original source on the restored page", async () => {
    const f = fixture();
    try {
      const control = f.mountControl(); f.runtime.commit("control");
      // The public hook exposes the ordinary read-only restore. Exercise the
      // actual callback's internal refresh toggle without widening that API.
      const refreshVisible = control.restorePausedLesson as (
        turns: readonly StoredTurn[], refreshVisible: boolean,
      ) => Promise<PausedLessonRequest | null>;
      const paused = await refreshVisible([stored()], true);
      assert(paused, "the real read-only refresh must derive the stopped lesson");
      assert.equal(originalOf(paused), RAW);
      assert.equal(originalOf(f.params.boardPageRef.current), RAW,
        "a doubt or Stop before Continue must retain the stored external source, not its trimmed title");
    } finally { f.close(); }
  });
  await test("cancelled AutoAsk whiteboard wait cannot leave unpaired intake for another board", async () => {
    const f = fixture({ loaded: false });
    try {
      await f.mountHandler().handleQuestion(RAW);
      const whiteboard = f.params.whiteboardRef.current;
      (f.params.whiteboardRef as { current: unknown }).current = null;
      f.params.boardLoaded = true;
      f.params.autoQuestion = RAW_REPLACEMENT;
      f.mountControl(); f.runtime.commit("control");
      assert.equal(f.asked.length, 0, "actual AutoAsk must still be waiting for its board's whiteboard");
      f.params.sessionId = `${BOARD}-successor`;
      f.params.autoQuestion = undefined;
      f.mountControl(); f.runtime.commit("control");
      f.params.whiteboardRef.current = whiteboard;
      f.mountHandler(); f.runtime.commit("handler"); await f.settle();
      assert.equal(f.presentationSources.length, 0,
        "a cancelled AutoAsk must not replace the paired queue with unscoped raw intake that another board adopts");
      assert.equal(f.asked.length, 0);
    } finally { f.close(); }
  });
  const failed = results.filter((row) => !row.passed);
  console.log(JSON.stringify({ gate: "live-original-question/v1", scope: "actual live caller/queue/AutoAsk and paused-source lineage; no F2 acceptance or save-path claim",
    cases: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exitCode = 1;
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
