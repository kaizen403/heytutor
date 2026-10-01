import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type Konva from "konva";
import { DrawTransactionRegistry } from "../../../../packages/whiteboard/src/drawTransactionRegistry";
import { mountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { synthesizeArchetypeScene } from "@heytutor/scene-engine";
import { textToStrokePaths, type DrawCommand, type TutorSegment } from "@heytutor/drawing";
import { mathToSpeech, type AudioTimings, type TTSClient } from "@heytutor/tutor-core";
import { SpeechSynthesisTTSClient, type SpeakSegmentOptions } from "../../../../packages/tutor-core/src/tts/speechClient";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import type { ExecuteCommandOptions, UseTurnLifecycleParams } from "../../features/tutor-session/hooks/turn/types";
import type { RecordedSegmentPayload } from "../../lib/boards/boardsClient";
import type { BoardLayoutState } from "../../features/tutor-session/types";
import { TEXT_LAYOUT } from "../../features/tutor-session/constants";
import { createIntroLayoutCheckpoint } from "../../features/tutor-session/lib/board/introLayoutCheckpoint";

/**
 * Actual useTurnControl -> useSegmentRunner -> drawSegmentInk -> browser client.
 * Only React storage, provider transport, the synthesis engine and canvas are
 * deterministic fakes. Generic compiled scene; no production trace or credentials.
 * Native media playback is tested separately: this gate proves turn ownership,
 * actual executed ink, transaction commit, and complete captured rows.
 */
const app = fileURLToPath(new URL("../../", import.meta.url));
// Read-only unchanged-worktree comparison; fixtures/transports stay identical.
const hookApp = process.env.DIAGRAM_AUDIO_SOURCE_ROOT ? path.join(process.env.DIAGRAM_AUDIO_SOURCE_ROOT, "apps/tutor") : app;
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const core = { ...requireApp("@heytutor/tutor-core"), SpeechSynthesisTTSClient };
const react = { useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
  useEffect: () => {}, useState: (value: unknown) => [value, () => {}] };
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
    if (specifier === "@heytutor/tutor-core") return core;
    if (["./useSegmentRunner", "./useBoardViewport"].includes(specifier)) return loadHook(path.resolve(path.dirname(file), `${specifier}.ts`));
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
  };
  new Function("require", "module", "exports", compiled)(localRequire, hookModule, hookModule.exports);
  loaded.set(file, hookModule.exports);
  return hookModule.exports;
}
const runTurnControl = loadHook(path.join(hookApp, "features/tutor-session/hooks/turn/useTurnControl.ts")).useTurnControl as
  typeof import("../../features/tutor-session/hooks/turn/useTurnControl").useTurnControl;
const scene = synthesizeArchetypeScene({ question: "A 2 kg block on a 30 degree incline with friction coefficient 0.2. Find its acceleration." });
assert(scene, "the generic scene must compile");
const presentation = buildVerifiedDiagramPresentation(scene.document, scene.renderScene);
const intros = presentation.introSegments;
const intro = intros[0]!;
const introCommandCount = intros.reduce((total, beat) => total + beat.commands!.length, 0);
assert.deepEqual(intros.map((beat) => beat.commands!.length), [14, 11, 8]);
const lesson: TutorSegment = { narration: "The net force equals mass times acceleration.", command: {
  type: "WRITE", text: "F = ma", params: [80, 150], charPosition: 0, narrationBefore: "The net force equals mass times acceleration.",
} };

type Mode = "intro-command-join" | "later-same-narration-new-turn" | "real-later-same-layout-new-turn" | "third-stop" | "third-no-audio" | "third-failure" | "third-timeout" | "third-draw-failure" | "real-later-stop" | "real-later-new-turn" | "intro-focus-rejected" | "later-new-turn" | "later-doubt" | "real-label-restart" | "real-browser-restart" | "real-provider-restart" | "browser-restart" | "provider-restart" | "later-timeout" | "later-failure" | "later-no-audio" | "later-stop" | "later-draw-failure" | "near" | "late-grace" | "late-grace-paused" | "late-grace-stop" | "ready-no-audio" | "grace-expiry-race" | "grace-expiry-handoff" | "retry-grace-expiry-race" | "retry-late-grace" | "retry-late-grace-paused" | "restart" | "reject-pause" | "never" | "stop" | "stop-error" | "stale" | "retry-fails" | "retry-hangs";
type Event = { atMs: number; name: string; [key: string]: unknown };
async function scenario(selectedMode: Mode) {
  const realCanvas = selectedMode.startsWith("real-");
  const deferredLabel = selectedMode === "real-label-restart";
  const failureBeat = selectedMode.startsWith("third-") ? 2 : 1;
  const mode = (selectedMode.includes("same-narration-new-turn") || selectedMode.includes("same-layout-new-turn") ? "later-new-turn" : deferredLabel ? "provider-restart" : realCanvas ? selectedMode.slice(5) : selectedMode.startsWith("third-") ? selectedMode.replace("third-", "later-") : selectedMode) as Mode;
  const restartCase = mode === "browser-restart" || mode === "provider-restart";
  const directProvider = ["later-new-turn", "later-doubt", "later-timeout", "later-failure", "later-no-audio", "later-stop", "later-draw-failure", "near", "late-grace", "late-grace-paused", "late-grace-stop", "ready-no-audio", "grace-expiry-race", "grace-expiry-handoff"].includes(mode);
  const lateRetry = mode === "retry-late-grace" || mode === "retry-late-grace-paused" || mode === "retry-grace-expiry-race";
  const expiryRace = ["grace-expiry-race", "grace-expiry-handoff", "retry-grace-expiry-race"].includes(mode);
  const successful = ["browser-restart", "provider-restart", "near", "late-grace", "late-grace-paused", "retry-late-grace", "retry-late-grace-paused", "restart", "reject-pause", "grace-expiry-handoff"].includes(mode);
  let now = 0;
  let sequence = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const events: Event[] = [];
  const record = (name: string, data: Record<string, unknown> = {}) => events.push({ atMs: now, name, ...data });
  const setTimer = (run: () => void, delay = 0) => {
    const id = ++sequence; timers.set(id, { at: now + delay, run }); return id;
  };
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  replace("performance", { now: () => now });
  replace("setTimeout", setTimer);
  replace("clearTimeout", (id: number) => timers.delete(id));
  replace("window", globalThis);
  replace("fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/tts", "all real network calls are blocked");
    assert.equal(new Headers(init.headers).get("x-tts-transport"), "browser-fallback");
    record("browser-post"); return Response.json({});
  });
  class Utterance {
    onstart: (() => void) | null = null; onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onboundary = null; rate = 1; pitch = 1; volume = 1;
    constructor(readonly text: string) {}
  }
  let utterance: Utterance | null = null;
  let browserAttempts = 0;
  replace("SpeechSynthesisUtterance", Utterance);
  replace("speechSynthesis", {
    getVoices: () => [{ name: "Offline English", lang: "en-US" }], resume() {},
    cancel() { record("browser-stop"); utterance = null; },
    speak(next: Utterance) {
      utterance = next; browserAttempts++;
      record("browser-attempt", { text: next.text, rate: next.rate });
      if (mode !== "later-no-audio" && mode !== "never" && mode !== "ready-no-audio" && mode !== "grace-expiry-race" && browserAttempts === 1) {
        setTimer(() => { if (utterance === next) { record("browser-start"); next.onstart?.(); } }, 50);
      }
      if (mode === "browser-restart" && browserAttempts > 1) {
        setTimer(() => { if (utterance === next) { record("browser-start"); next.onstart?.(); } }, 200);
        setTimer(() => { if (utterance === next) { utterance = null; record("browser-end"); next.onend?.(); } }, 200 + mathToSpeech(next.text).length * 86);
      }
      if (mode === "grace-expiry-handoff") {
        setTimer(() => {
          if (utterance !== next) return;
          utterance = null;
          record("browser-end"); next.onend?.();
        }, 5_000);
      }
      if (lateRetry && browserAttempts > 1) {
        setTimer(() => {
          if (utterance !== next) return;
          utterance = null; // A native synthesis error ends the owned utterance.
          record("browser-error"); next.onerror?.({ error: "synthesis-failed" });
        }, 50);
      }
      // Resume and its built-in 400ms retry are deliberately dropped.
    },
  });
  class LateRejectedBrowser extends SpeechSynthesisTTSClient {
    private pending: { options: SpeakSegmentOptions; reject: (error: unknown) => void } | null = null;
    private first = true;
    override async speakSegment(text: string, options: SpeakSegmentOptions = {}) {
      if (!this.first) return super.speakSegment(text, options);
      this.first = false;
      browserAttempts++;
      record("browser-start");
      options.onStart?.();
      await new Promise<void>((_resolve, reject) => { this.pending = { options, reject }; });
    }
    override pause() {
      const pending = this.pending;
      this.pending = null;
      if (pending) setTimer(() => {
        // Deliberately buggy browser adapter: stale callbacks and a rejection
        // arrive AFTER rapid Resume, so the pause boolean alone cannot help.
        pending.options.onStart?.();
        pending.options.onTimings?.({ totalDuration: 999, charStartTimes: [0], charDurations: [999] });
        pending.options.onAudioCaptured?.({ bytes: Uint8Array.of(255), mimeType: "audio/wav" });
        pending.options.onEnd?.();
        pending.reject(new DOMException("late pause interruption", "AbortError"));
      }, 100);
      super.pause();
    }
  }
  if (mode === "reject-pause") core.SpeechSynthesisTTSClient = LateRejectedBrowser;
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const advance = async (target: number) => {
    await flush();
    while (true) {
      const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].run(); await flush();
    }
    now = target; await flush();
  };
  const ref = <T,>(current: T) => ({ current });
  type Job = { text: string; options: SpeakSegmentOptions & { onAudioReady?: () => void }; resolve: () => void;
    startedAt: number | null; position: number; duration: number; dead: boolean; reject: (error: unknown) => void };
  const jobs: Job[] = [];
  let current: Job | null = null;
  let providerPaused = false;
  let providerPausedAt: number | null = null;
  let providerPausedMs = 0;
  const providerActiveMs = () => (providerPausedAt ?? now) - providerPausedMs;
  let providerCalls = 0;
  const samplePosition = () => current?.startedAt === null || !current ? null :
    current.position + (providerPaused ? 0 : now - current.startedAt) * 1.25;
  const provider = {
    getPlaybackRate: () => 1.25, getPlaybackPositionMs: samplePosition,
    prefetchSegment() {},
    speakSegment(text: string, options: Job["options"] = {}) {
      providerCalls++;
      record("provider-attempt", { text, voiceSettings: options.voiceSettings });
      return new Promise<void>((resolve, reject) => {
        const duration = mathToSpeech(text).length * 86;
        const job: Job = { text, options, resolve, startedAt: null, position: 0, duration, dead: false, reject };
        jobs.push(job); current = job;
        if (mode === "later-no-audio" && providerCalls === failureBeat + 1) return;
        if (mode === "never" || mode === "stop-error" || (mode === "retry-fails" && providerCalls > 1)) return;
        if (restartCase && providerCalls === 2) return;
        if (!restartCase && !directProvider && providerCalls === 1) return; // Force app browser recovery.
        const timings: AudioTimings = { totalDuration: duration / 1000,
          charStartTimes: Array.from({ length: mathToSpeech(text).length }, (_, i) => i * 0.086),
          charDurations: Array.from({ length: mathToSpeech(text).length }, () => 0.086) };
        const lateGrace = directProvider && mode !== "near" && providerCalls === 1 || lateRetry && providerCalls === 2;
        const readyAfter = directProvider && providerCalls === 1 || lateGrace ? 6_485 : 100;
        setTimer(() => {
          // Keep these callbacks callable even when abandoned, to catch stale ownership.
          record("provider-bytes-ready");
          if ((mode !== "retry-hangs" || providerCalls !== 2) && (mode !== "later-timeout" || providerCalls !== failureBeat + 1)) options.onTimings?.(timings);
          options.onAudioReady?.();
          if (mode === "ready-no-audio") {
            setTimer(() => { record("provider-ready-repeat"); options.onAudioReady?.(); }, 2_400);
            return; // Complete bytes alone must not produce ink or success.
          }
          const nativeReadyAtMs = providerActiveMs();
          const nativeDelayMs = lateGrace ? expiryRace ? 2_510 : 2_400 : 400;
          const start = () => {
            if (job.dead) return;
            const remainingMs = nativeDelayMs - (providerActiveMs() - nativeReadyAtMs);
            if (providerPaused || remainingMs > 0) { setTimer(start, Math.min(Math.max(remainingMs, 1), 25)); return; }
            assert.equal(utterance, null, "browser synthesis must be silent before provider playback");
            job.startedAt = now;
            record("provider-start", { rate: 1.25, nativeActiveMs: providerActiveMs() - nativeReadyAtMs }); options.onStart?.();
            if (mode === "later-failure" && providerCalls === failureBeat + 1) {
              setTimer(() => { record("provider-error"); job.dead = true; reject(new Error("offline later-beat speech failure")); }, 200);
              return;
            }
            if (mode === "retry-hangs" && providerCalls === 2 || mode === "later-timeout" && providerCalls === failureBeat + 1) return; // Starts without alignment, then never ends.
            const checkEnd = () => {
              if (job.dead) return;
              if (!providerPaused && (samplePosition() ?? 0) >= duration) {
                options.onAudioCaptured?.({ bytes: Uint8Array.of(82, 73, 70, 70), mimeType: "audio/wav" });
                record("provider-end", { text });
                options.onEnd?.(); job.dead = true; resolve(); current = null;
              } else setTimer(checkEnd, 25);
            };
            setTimer(checkEnd, 25);
          };
          setTimer(start, Math.min(nativeDelayMs, 25)); // Native startup spends active time, not pause time.
        }, readyAfter);
      });
    },
    abandonSpeaking() {
      record("provider-stop");
      if (mode === "never" || mode === "stop-error") throw new Error("offline provider stop failed");
      if (current) { current.dead = true; current.resolve(); current = null; }
    },
    stop() { this.abandonSpeaking(); },
    pause() {
      if (current?.startedAt !== null && current) current.position = samplePosition() ?? 0;
      providerPausedAt ??= now;
      providerPaused = true;
    },
    resume() {
      if (current?.startedAt !== null && current) current.startedAt = now;
      if (providerPausedAt !== null) providerPausedMs += now - providerPausedAt;
      providerPausedAt = null;
      providerPaused = false;
    },
  };
  let committed = false;
  let aborted = false;
  const ink: Array<{ command: DrawCommand; atMs: number; audioPosition: number | null }> = [];
  class InkNode {
    attrs = new Map<string, unknown>();
    destroyed = false;
    constructor(readonly command: DrawCommand) {}
    getAttr(name: string) { return this.attrs.get(name); }
    setAttr(name: string, value: unknown) { this.attrs.set(name, value); }
    destroy() { this.destroyed = true; }
  }
  const registry = new DrawTransactionRegistry<InkNode>();
  const nodes: InkNode[] = [];
  const visibleIntro = () => [...new Map(nodes.filter((node) => !node.destroyed && node.command.type !== "WRITE")
    .map((node) => [node.command, node])).values()];
  const unrelated = new InkNode(lesson.command!);
  registry.track(unrelated); nodes.push(unrelated);
  const params = {
    sessionId: "offline-board", phase: "thinking", isReplaying: false, boardLoaded: false,
    ensureTTSClient: () => provider as unknown as TTSClient, ttsClientRef: ref(provider), phaseRef: ref("thinking"),
    cancelRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1), isPausedRef: ref(false),
    turnAbortRef: ref(new AbortController()), currentTraceIdRef: ref("offline-trace"),
    segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()),
    collectedSegmentsRef: ref<TutorSegment[]>([]), recordedSegmentsRef: ref<RecordedSegmentPayload[]>([]), narrationSinceEpochRef: ref("Earlier work narration."),
    activeVerifiedDiagramRef: ref(presentation.diagram), pendingSegmentCountRef: ref(0),
    fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false),
    boardLayoutRef: ref<BoardLayoutState>({ rects: [], nextY: 100 }),
    boardPageRef: ref({ boardId: "offline-board", figureDrawn: false }),
    narrationDensityRef: ref(0), turnStatsRef: ref({ ttsChars: 0, drawMs: 0 }),
    turnTelemetryRef: ref({ mark: record, span: () => ({ end() {} }), meta() {}, durationMs: () => now, flush: async () => {} }),
    whiteboardRef: ref({ beginDrawTransaction: () => registry.begin(),
    createDrawSavepoint: (id: string) => registry.savepoint(id),
    rollbackDrawSavepoint: (id: string, origin: string) => { registry.rollback(id, origin); record("beat-rolled-back"); },
    commitDrawTransaction: (id: string) => {
      if (mode !== "later-doubt") assert.equal(visibleIntro().length, introCommandCount,
        "commit requires every actual intro ink command, not draw-complete's planned count");
      if (mode !== "later-doubt") assertCapturedAtCommit();
      registry.commit(id); committed = true; record("intro-committed");
    }, abortDrawTransaction: (id: string) => { registry.abort(id); aborted = true; record("intro-aborted"); },
    finishAbortedDrawTransaction(id: string) { registry.finishAborted(id); }, setPaused() {}, cancelAnimations() {}, clearSpotlight() {} }),
    stopTurnRef: ref(null), replayDrawClockRef: ref(null), replayAudioRef: ref(null), rewoundRef: ref(false),
    replayCueRef: ref(null), replayAudioPreloadRef: ref(new Map()), replayGenerationRef: ref(1),
    clearCancelTimers() {},
    cancellableDelay: (ms: number) => new Promise<void>((resolve) => setTimer(resolve, ms)),
    raceWithCancel: (promise: Promise<unknown>) => promise,
    reserveTextCommandPlacements: async (command: unknown) => [command],
    executeCommandWithCancel: async (command: DrawCommand, options: ExecuteCommandOptions): Promise<void> => {
      while (params.isPausedRef.current && !options.isCancelled?.()) await new Promise<void>((resolve) => setTimer(resolve, 25));
      if (options.isCancelled?.() || params.cancelRef.current) return;
      if (mode === "later-draw-failure" && options.segmentNarration === intros[failureBeat]!.narration) throw new Error("offline later-beat draw failure");
      const node = new InkNode(command); registry.track(node); nodes.push(node);
      ink.push({ command, atMs: now, audioPosition: samplePosition() });
      // The command can still own async ink when Pause cancels its voice.
      const duration = restartCase ? Math.max((options.speechDurationMs ?? 20) / (options.getPlaybackRate?.() ?? 1), 80) : 20;
      let elapsed = 0;
      while (elapsed < duration && !options.isCancelled?.()) {
        await new Promise<void>((resolve) => setTimer(resolve, 20));
        if (!params.isPausedRef.current) elapsed += 20;
      }
      record("command-settled", { beat: options.segmentNarration, cancelled: options.isCancelled?.() ?? false });
    },
    setCurrentSegmentText() {}, setPhase() {}, setIsPaused() {}, setActiveVerifiedDiagram() {},
    setInputInteracted() {}, setIsReplaying() {}, setReplayProgressMs() {}, setReplayTotalMs() {},
  };
  const pathGate: { release: (() => void) | null } = { release: null };
  const metadataAtSavepoint = new Map<string, { layout: BoardLayoutState; rects: BoardLayoutState["rects"]; nextY: number }>();
  const unrelatedAnchor = { x: 80, y: 80, width: 120, height: 28, text: "F = ma" };
  const earlierFigureAnchor = { x: 1000, y: 80, width: 80, height: 28, text: "earlier figure" };
  const concurrentAnchor = { x: 900, y: 600, width: 60, height: 28, text: "unrelated figure" };
  const successorAnchor = { x: 1100, y: 90, width: 70, height: 28, text: "successor figure" };
  const successorDiagram = { ...presentation.diagram, name: "offline-successor" };
  let successorLayout: BoardLayoutState | null = null;
  let expectedSuccessorPrefix = "replacement turn";
  let originalLayout: BoardLayoutState | null = null;
  type MetadataRollback = { before: { layout: BoardLayoutState; rects: BoardLayoutState["rects"]; nextY: number }; layout: BoardLayoutState; rects: BoardLayoutState["rects"]; nextY: number };
  let rolledBackMetadata: MetadataRollback | null = null;
  const assertCapturedAtCommit = () => {
    assert.deepEqual(params.recordedSegmentsRef.current.map((row) => row.narration), intros.map((beat) => beat.narration),
      "every completed intro row is already captured at root commit, not just afterwards");
    for (const [index, row] of params.recordedSegmentsRef.current.entries()) {
      assert((row.durationMs ?? 0) > 0, "every intro recording at commit has its complete speech duration");
      const uncapturedBrowser = mode === "browser-restart" && index === 1 || mode === "grace-expiry-handoff" && index === 0;
      if (uncapturedBrowser) assert.equal(row.audioBytes, null, "browser speech does not invent captured bytes at commit");
      else assert((row.audioBytes?.length ?? 0) > 0, "provider bytes must exist before root commit");
    }
  };
  try {
    if (realCanvas) {
      const board = mountTestWhiteboard(process.env.DIAGRAM_AUDIO_SOURCE_ROOT
        ? path.join(process.env.DIAGRAM_AUDIO_SOURCE_ROOT, "packages/whiteboard/src/Whiteboard.tsx") : undefined,
      async (...args) => {
        const paths = textToStrokePaths(...args);
        if (deferredLabel && !events.some((event) => event.name === "label-path-pending") &&
            args[0] === intros[1]!.commands!.find((command) => command.type === "LABEL")!.text) {
          record("label-path-pending");
          await new Promise<void>((resolve) => { pathGate.release = resolve; });
          record("label-path-released");
        }
        return paths;
      });
      board.setTimeSource({ now: () => now, requestFrame: (callback) => setTimer(() => callback(now), 16),
        cancelFrame: (id) => { timers.delete(id); } });
      let drawingCommand = lesson.command!;
      for (const layer of [board.getDrawLayer()!, board.getAnimLayer()!]) {
        const add = layer.add.bind(layer);
        layer.add = (...children) => {
          for (const child of children as Konva.Node[]) {
            if (child.getAttr("verifyCommand")) continue;
            const command = drawingCommand;
            child.setAttr("verifyCommand", command);
            nodes.push({ command, get destroyed() { return child.getParent() === null; },
              destroy: () => child.destroy(), getAttr: (name: string) => child.getAttr(name),
              setAttr: (name: string, value: unknown) => { child.setAttr(name, value); }, attrs: new Map(),
            });
          }
          return add(...children);
        };
      }
      nodes.length = 0;
      await board.writeText("F = ma", 80, 80, 0);
      assert(nodes.length > 0, "the real canvas harness must start with actual unrelated work ink");
      const workNodes = [...nodes];
      const commit = board.commitDrawTransaction;
      board.commitDrawTransaction = (id) => {
        assert.equal(visibleIntro().length, introCommandCount, "real node tracking requires ink from every compiled command");
        assertCapturedAtCommit();
        commit(id); committed = true; record("intro-committed");
      };
      const rollback = board.rollbackDrawSavepoint;
      const checkpoint = board.createDrawSavepoint;
      board.createDrawSavepoint = (id) => {
        const point = checkpoint(id);
        const layout = params.boardLayoutRef.current;
        metadataAtSavepoint.set(point, { layout, rects: [...layout.rects], nextY: layout.nextY });
        return point;
      };
      board.rollbackDrawSavepoint = (id, origin) => {
        const before = metadataAtSavepoint.get(origin)!;
        rolledBackMetadata = { before, layout: params.boardLayoutRef.current, rects: [...before.layout.rects], nextY: before.layout.nextY };
        rollback(id, origin); record("beat-rolled-back");
      };
      const abort = board.abortDrawTransaction;
      board.abortDrawTransaction = (id) => { abort(id); aborted = true; record("intro-aborted"); };
      params.whiteboardRef.current = board as unknown as typeof params.whiteboardRef.current;
      const commandHook = loadHook(path.join(hookApp, "features/tutor-session/hooks/useCommandExecution.ts")).useCommandExecution as
        typeof import("../../features/tutor-session/hooks/useCommandExecution").useCommandExecution;
      const layoutHook = loadHook(path.join(hookApp, "features/tutor-session/hooks/useBoardLayout.ts")).useBoardLayout as
        typeof import("../../features/tutor-session/hooks/useBoardLayout").useBoardLayout;
      const placement = layoutHook({ whiteboardRef: { current: board }, cancelRef: params.cancelRef,
        fbdPhaseStartedRef: params.fbdPhaseStartedRef, liveQuestionRef: ref("offline"), viewportMode: "fixed" });
      placement.boardLayoutRef.current = { rects: [unrelatedAnchor, earlierFigureAnchor], nextY: 150 };
      params.boardLayoutRef = placement.boardLayoutRef;
      originalLayout = placement.boardLayoutRef.current;
      const execution = commandHook({ ...params, whiteboardRef: { current: board }, speedRef: ref(1),
        forceSequentialWorkLayoutRef: ref(false), inkPaceRef: ref("scene"), adaptiveFactorRef: ref(1), notesEpochsRef: ref([]),
        forgetErasedTextRects() {}, resetBoardLayout() {}, resolveTextPlacement: placement.resolveTextPlacement,
      } as unknown as Parameters<typeof commandHook>[0]);
      params.executeCommandWithCancel = async (command, options) => {
        drawingCommand = command;
        ink.push({ command, atMs: now, audioPosition: samplePosition() });
        await execution.executeCommandWithCancel(command, options);
        record("command-settled", { beat: options.segmentNarration, cancelled: options.isCancelled?.() ?? false });
        assert(workNodes.every((node) => !node.destroyed), "restart must preserve all real work-row nodes");
      };
    }
    // Unused UI dependencies are intentionally omitted from this hook seam.
    const control = runTurnControl(params as unknown as UseTurnLifecycleParams, ref(async () => {}));
    if (selectedMode === "intro-command-join") {
      const board = mountTestWhiteboard();
      let drawEntered = false;
      let releaseDraw = () => {};
      let releaseCancel = () => {};
      const cancelled = new Promise<undefined>((resolve) => { releaseCancel = () => resolve(undefined); });
      board.drawShape = async () => {
        drawEntered = true;
        await new Promise<void>((resolve) => { releaseDraw = resolve; });
      };
      board.flyCursorTo = async () => {};
      const commandHook = loadHook(path.join(hookApp, "features/tutor-session/hooks/useCommandExecution.ts")).useCommandExecution as
        typeof import("../../features/tutor-session/hooks/useCommandExecution").useCommandExecution;
      const execution = commandHook({ ...params, whiteboardRef: { current: board }, speedRef: ref(1),
        inkPaceRef: ref("scene"), adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: ref(false),
        raceWithCancel: (promise: Promise<unknown>) => Promise.race([promise, cancelled]),
        resolveTextPlacement: async (_command: DrawCommand, x: number, y: number) => ({ x, y }),
      } as unknown as Parameters<typeof commandHook>[0]);
      const ownership = createIntroLayoutCheckpoint(params.boardLayoutRef.current);
      let joined = false;
      const runCommand = execution.executeCommandWithCancel({ type: "DRAW_POINT", params: [800, 300], charPosition: 0, narrationBefore: "" },
        { trustedDiagramGeometry: true, introLayoutCheckpoint: ownership } as ExecuteCommandOptions).then(() => { joined = true; });
      await flush();
      assert(drawEntered, "the real executor must enter the underlying async draw");
      params.cancelRef.current = true;
      releaseCancel();
      await flush();
      try {
        assert.equal(joined, false, "the transactional command wrapper must join actual drawing, not merely win its cancellation race");
      } finally { releaseDraw(); await runCommand; }
      ownership.rollback();
      assert.equal(params.boardLayoutRef.current.rects.length, 0, "rollback after join has no late anchor mutations");
      console.log("verified diagram audio intro-command-join: transaction awaits the underlying cancelled executor");
      return;
    }
    if (selectedMode === "intro-focus-rejected") {
      assert(intros.every((beat) => beat.commands!.every((command) => command.type !== "FOCUS")),
        "canonical presentations keep semantic/deferred FOCUS outside the transactional intro");
      const originalDiagram = params.activeVerifiedDiagramRef.current;
      const originalDeferred = originalDiagram.deferredAnnotations;
      const injected: TutorSegment = { ...intros[1]!, commands: [...intros[1]!.commands!, {
        type: "FOCUS", params: [], text: "B", semanticRef: { entityId: "B" }, charPosition: 0, narrationBefore: "",
      }] };
      try {
        assert.throws(() => control.enqueueVerifiedIntro([intros[0]!, injected, intros[2]!], 1),
          /verified intro contains non-transactional command FOCUS/,
          "a FOCUS that may consume deferred annotations is rejected before any intro side effect");
      } finally {
        // A red run may have enqueued it: invalidate before restoring globals.
        params.cancelRef.current = true;
        await flush();
      }
      assert.equal(params.activeVerifiedDiagramRef.current, originalDiagram);
      assert.equal(originalDiagram.deferredAnnotations, originalDeferred);
      assert.equal(params.collectedSegmentsRef.current.length, 0);
      assert.equal(params.pendingSegmentCountRef.current, 0);
      assert.equal(providerCalls, 0);
      console.log("verified diagram audio intro-focus-rejected: canonical intro contract preserves deferred metadata");
      return;
    }
    control.enqueueVerifiedIntro(intros, 1);
    control.enqueueSegment(lesson, 1);
    let failure: unknown = null;
    let settled = false;
    const run = params.segmentChainRef.current.then(() => { settled = true; }, (error: unknown) => {
      failure = error; settled = true;
    });
    let replacementRun: Promise<void> = Promise.resolve();
    if (restartCase) {
      for (let target = 0; !events.some((event) => event.name === "browser-start"); target += 100) {
        assert(target < 35_000); await advance(target);
      }
      if (deferredLabel) {
        for (let target = now; pathGate.release === null; target += 20) { assert(target < 45_000); await advance(target); }
      } else await advance(now + (realCanvas ? 6_000 : 2_500));
      const previousNodes = visibleIntro().filter((node) => intros[0]!.commands!.includes(node.command));
      const interruptedNodes = visibleIntro().filter((node) => intros[1]!.commands!.includes(node.command));
      assert.equal(previousNodes.length, intros[0]!.commands!.length);
      assert(interruptedNodes.length > 0 && interruptedNodes.length < intros[1]!.commands!.length,
        "Pause must happen after actual paced ink, inside the current reveal beat");
      control.pauseTurn();
      const pausedNodes = visibleIntro().length;
      await advance(now + 20_000);
      assert.equal(visibleIntro().length, pausedNodes, "Pause itself does not roll back the visible board");
      if (realCanvas) {
        assert(params.boardLayoutRef.current.rects.some((rect) => rect.text === intros[1]!.commands!.find((command) => command.type === "LABEL")!.text),
          "the interrupted beat must register actual label metadata, not a coordinate-only placement stub");
        params.boardLayoutRef.current.rects.push(concurrentAnchor);
      }
      control.resumeTurn();
      await advance(now + 100);
      if (deferredLabel) {
        const rollbackBeforeRelease = events.some((event) => event.name === "beat-rolled-back");
        if (rollbackBeforeRelease) {
          // The real adapter can now cancel/join its owned lookup without
          // waiting for an uncooperative glyph provider. Its detached promise
          // must never create nodes or metadata after ownership was released.
          const joined = events.findIndex((event) => event.name === "command-settled" &&
            event.beat === intros[1]!.narration && event.cancelled === true);
          assert(joined >= 0 && joined < events.findIndex((event) => event.name === "beat-rolled-back"),
            "rollback still joins the actual cancelled command before restoring metadata");
        }
        const nodesBeforeRelease = visibleIntro().length;
        pathGate.release!();
        await advance(now + 100);
        assert(events.some((event) => event.name === "beat-rolled-back"), "a joined glyph wait must release beat rollback");
        if (rollbackBeforeRelease) assert.equal(visibleIntro().length, nodesBeforeRelease,
          "late detached glyph fulfillment cannot paint onto the restarted beat");
        else assert(events.findIndex((event) => event.name === "label-path-released") <
          events.findIndex((event) => event.name === "beat-rolled-back"), "a pending owned glyph execution joins before rollback");
      }
      if (realCanvas) {
        const metadata = rolledBackMetadata as MetadataRollback | null;
        assert(metadata, "the actual adapter must reach beat rollback");
        assert.equal(metadata.layout, metadata.before.layout, "rollback retains the original layout object");
        assert.deepEqual(metadata.rects, [...metadata.before.rects, concurrentAnchor],
          "rollback removes current-beat metadata only, preserving earlier anchors and unrelated concurrent work");
        for (const rect of metadata.before.rects) assert(metadata.rects.includes(rect), "earlier anchor identity survives rollback");
        assert.equal(metadata.nextY, metadata.before.nextY, "scene-only rollback preserves the work-column cursor");
      }
      assert.equal(visibleIntro().length, previousNodes.length,
        "restart startup removes only the interrupted beat; stale pen cannot draw ahead of narration");
      for (const node of previousNodes) assert.equal(node.destroyed, false);
      for (const node of interruptedNodes) assert.equal(node.destroyed, true);
      assert.equal(unrelated.destroyed, false);
      const restartOrigin = now;
      for (let target = now; events.filter((event) => event.name === "tts-start" && event.segment_index === 1).length < 2; target += 10) {
        assert(target < restartOrigin + 10_000); await advance(target);
      }
      assert.equal(visibleIntro().length, previousNodes.length, "restarted media position zero contains no current-beat ink");
      await advance(now + 1_200);
      assert(visibleIntro().length > previousNodes.length && visibleIntro().length < previousNodes.length + intros[1]!.commands!.length,
        "only the current beat replays progressively on its new speech origin");
    } else if (["later-stop", "later-new-turn", "later-doubt"].includes(mode)) {
      for (let target = 0; !events.some((event) => event.name === "tts-start" && event.segment_index === failureBeat); target += 100) {
        assert(target < 30_000); await advance(target);
      }
      assert.equal(visibleIntro().filter((node) => intros[0]!.commands!.includes(node.command)).length, intros[0]!.commands!.length);
      if (failureBeat === 2) assert.equal(params.recordedSegmentsRef.current.length, 2, "the final beat fails after two complete captured reveal rows");
      assert(visibleIntro().length < introCommandCount, "Stop interrupts a later beat, not the completed intro");
      if (realCanvas) params.boardLayoutRef.current.rects.push(concurrentAnchor);
      const stoppedEpoch = params.narrationSinceEpochRef.current;
      control.stopTurn({ keepVisibleBoard: mode === "later-doubt", supersede: mode === "later-new-turn" });
      assert.equal(params.narrationSinceEpochRef.current,
        mode === "later-doubt" ? `Earlier work narration. ${intros[0]!.narration}` : "Earlier work narration.",
        "ordinary Stop removes completed intro-owned epoch narration synchronously; explicit doubt retains it");
      if (mode === "later-new-turn") {
        params.cancelRef.current = false;
        params.turnActiveRef.current = true;
        params.activeVerifiedDiagramRef.current = successorDiagram;
        if (realCanvas) {
          successorLayout = selectedMode.includes("same-layout") ? originalLayout! : { rects: [], nextY: 200 };
          successorLayout.rects.push(successorAnchor);
          successorLayout.nextY = 200;
          params.boardLayoutRef.current = successorLayout;
        }
        expectedSuccessorPrefix = selectedMode.includes("same-narration") ? stoppedEpoch : "replacement turn";
        params.narrationSinceEpochRef.current = expectedSuccessorPrefix;
        if (selectedMode.includes("same-narration")) {
          await advance(now + 100);
          assert.equal(params.narrationSinceEpochRef.current, expectedSuccessorPrefix,
            "Stop cleanup is idempotent: a successor owning the same text cannot be overwritten by late unwind");
        }
        control.enqueueSegment(lesson, params.turnGenerationRef.current);
        replacementRun = params.segmentChainRef.current;
        const successorNarration = params.narrationSinceEpochRef.current;
        const startCount = events.filter((event) => event.name === "tts-start").length;
        const stale = jobs[failureBeat]!;
        stale.options.onAudioReady?.(); stale.options.onStart?.();
        stale.options.onTimings?.({ totalDuration: 999, charStartTimes: [0], charDurations: [999] });
        stale.options.onAudioCaptured?.({ bytes: Uint8Array.of(255), mimeType: "audio/wav" });
        stale.options.onEnd?.();
        assert.equal(params.narrationSinceEpochRef.current, successorNarration, "old provider callbacks cannot append successor narration");
        assert.equal(events.filter((event) => event.name === "tts-start").length, startCount, "old provider callbacks cannot restart successor clocks");
      }
    } else if (lateRetry) {
      await advance(6_525); // Pause the first browser attempt before it starts.
      assert.equal(browserAttempts, 1);
      assert.equal(ink.length, 0);
      control.pauseTurn();
      await advance(25_000);
      control.resumeTurn();
      await advance(25_100);
      const recovery = events.find((event) => event.name === "tts-provider-recovery");
      assert(recovery, "a genuine browser restart error must hand this same sentence back to the provider");
      assert.equal(providerCalls, 2);
      if (mode === "retry-grace-expiry-race") {
        await advance(recovery.atMs + 8_995);
        assert.equal(events.find((event) => event.name === "provider-start")?.atMs, recovery.atMs + 8_995);
        await advance(recovery.atMs + 9_000);
        assert.equal(settled, true, "a provider retry starting after grace must fail, not succeed at the next startup poll");
        assert(failure instanceof Error && failure.message === "Provider voice recovery failed");
        assert.equal(ink.length, 0, "an expired retry cannot release any intro ink");
      } else if (mode === "retry-late-grace-paused") {
        await advance(recovery.atMs + 8_150);
        control.pauseTurn();
        const pausedAt = now;
        await advance(pausedAt + 20_000);
        assert.equal(ink.length, 0, "retry media-ready grace must not ink while paused beyond its wall deadline");
        assert.equal(events.filter((event) => event.name === "provider-start").length, 0);
        control.resumeTurn();
        await advance(recovery.atMs + 20_000 + 8_884);
        assert.equal(ink.length, 0, "retry readiness and the OLD draw clock cannot fabricate intro ink");
        await advance(recovery.atMs + 20_000 + 8_910);
      } else {
        await advance(recovery.atMs + 8_884);
        assert.equal(ink.length, 0, "retry readiness and the OLD draw clock cannot fabricate intro ink");
      }
      if (mode === "retry-late-grace") {
        assert.equal(events.filter((event) => event.name === "provider-start").length, 0);
        await advance(recovery.atMs + 8_885);
        assert.equal(events.find((event) => event.name === "provider-start")?.atMs, recovery.atMs + 8_885);
      }
      const restartedInk = events.filter((event) => event.name === "tts-start").length;
      jobs[0]!.options.onAudioReady?.(); jobs[0]!.options.onStart?.(); jobs[0]!.options.onEnd?.();
      assert.equal(events.filter((event) => event.name === "tts-start").length, restartedInk, "stale provider callbacks cannot steal retry ownership");
    } else if (mode === "grace-expiry-race" || mode === "grace-expiry-handoff") {
      await advance(8_984);
      assert.equal(ink.length, 0);
      await advance(8_995); // Grace ended at 8985; draw poll 8992 precedes this late native start.
      assert.equal(events.find((event) => event.name === "provider-start")?.atMs, 8_995);
      await advance(9_000);
      assert.equal(events.find((event) => event.name === "tts-browser-recovery")?.atMs, 9_000,
        "the 25ms startup poll must not accept a native start after the 2500ms grace");
      assert.equal(events.filter((event) => event.name === "tts-start").length, 0,
        "a rejected late start cannot bypass the guard through app onStart/hasStarted");
      if (mode === "grace-expiry-handoff") {
        await advance(10_000); // Browser onStart at 9050 plus the real audible/cue waits.
        assert(ink.length > 0, "the pen must wait for the owned browser handoff instead of permanently skipping at grace expiry");
      } else {
        await advance(12_000);
        assert.equal(settled, true, "expired provider plus silent browser must settle as failure");
        assert(failure instanceof Error);
        assert.equal(aborted, true, "deadline failure must abort the intro transaction");
        assert.equal(ink.length, 0);
      }
    } else if (mode === "late-grace-paused" || mode === "late-grace-stop") {
      await advance(8_150); // Past the old ink deadline, but inside readiness grace.
      assert.equal(ink.length, 0);
      control.pauseTurn();
      await advance(25_000);
      assert.equal(ink.length, 0);
      assert.equal(events.filter((event) => event.name === "provider-start").length, 0);
      if (mode === "late-grace-stop") {
        control.stopTurn(); // Stop must settle even though both clocks were paused.
        jobs[0]!.options.onAudioReady?.(); jobs[0]!.options.onStart?.(); jobs[0]!.options.onEnd?.();
      } else {
        control.resumeTurn();
        await advance(25_300);
        control.pauseTurn();
        await advance(35_000);
        assert.equal(ink.length, 0, "a repeated pause must not exhaust media-ready grace");
        assert.equal(browserAttempts, 0);
        control.resumeTurn();
      }
    } else if (mode === "ready-no-audio") {
      await advance(8_975);
      assert(events.some((event) => event.name === "provider-ready-repeat"));
      assert.equal(browserAttempts, 0, "the accepted first-readiness allowance must not end early");
      assert.equal(ink.length, 0);
      await advance(9_000);
      assert.equal(events.find((event) => event.name === "tts-browser-recovery")?.atMs, 9_000,
        "repeated readiness cannot renew the 2500 active-ms allowance");
      jobs[0]!.options.onAudioReady?.(); jobs[0]!.options.onStart?.(); jobs[0]!.options.onEnd?.();
      await advance(12_000);
      assert.equal(settled, true, "bytes without any audible provider/browser voice must fail within a bounded budget");
    } else if (mode === "late-grace") {
      await advance(8_884);
      assert.equal(ink.length, 0, "ready bytes and alignment cannot ink before actual speech start");
      assert.equal(browserAttempts, 0, "late grace must retain provider voice without browser recovery");
      await advance(8_885);
      assert.equal(events.find((event) => event.name === "provider-start")?.atMs, 8_885);
    } else if (mode === "near") {
      await advance(6_525);
      assert(events.some((event) => event.name === "provider-bytes-ready"));
      assert.equal(events.filter((event) => event.name === "tts-browser-recovery").length, 0,
        "near-deadline complete bytes must keep the provider's voice and speed");
      control.pauseTurn();
      await advance(25_000);
      assert.equal(ink.length, 0, "paused provider bytes must not produce ink or speech");
      control.resumeTurn();
      await advance(25_600);
      assert.equal(events.filter((event) => event.name === "provider-start").length, 1);
      control.pauseTurn();
      const pausedInk = ink.length;
      await advance(35_000);
      assert.equal(ink.length, pausedInk);
      control.resumeTurn();
    } else if (mode === "restart" || mode === "reject-pause" || mode === "retry-fails" || mode === "retry-hangs") {
      await advance(6_600);
      assert.equal(events.filter((event) => event.name === "browser-start").length, 1);
      await advance(7_200); // Initial browser voice has a nonzero wall-clock high water.
      const startMarks = events.filter((event) => event.name === "tts-start").length;
      const timingMarks = events.filter((event) => event.name === "tts-timing-received").length;
      control.pauseTurn();
      if (mode !== "reject-pause") await advance(25_000);
      control.resumeTurn();
      if (mode === "reject-pause") {
        await advance(7_350);
        assert.equal(events.filter((event) => event.name === "tts-start").length, startMarks,
          "late rejected pause callbacks must not restart the media clock after rapid Resume");
        assert.equal(events.filter((event) => event.name === "tts-timing-received").length, timingMarks,
          "late rejected pause callbacks must not poison alignment or capture");
      }
      await advance(mode === "reject-pause" ? 10_300 : 28_000);
      assert.equal(providerCalls, 2, "genuine failed browser restart must retry SAME narration once on provider transport");
      assert.equal(events.filter((event) => event.name === "provider-attempt")[1]?.text, intro.narration.trim());
      assert(events.findIndex((event) => event.name === "browser-stop") < events.findIndex((event) => event.name === "tts-provider-recovery"),
        "failed browser voice must be stopped before provider retry");
      const ownedStarts = events.filter((event) => event.name === "tts-start").length;
      jobs[0]!.options.onAudioReady?.(); jobs[0]!.options.onStart?.(); jobs[0]!.options.onEnd?.();
      assert.equal(events.filter((event) => event.name === "tts-start").length, ownedStarts,
        "an old provider attempt cannot revive when provider ownership is reacquired by the retry");
    } else if (mode === "stop" || mode === "stop-error" || mode === "stale") {
      await advance(mode === "stop-error" ? 100 : 6_600);
      if (mode === "stop" || mode === "stop-error") {
        assert.doesNotThrow(() => control.stopTurn(), "Stop must cancel the turn even if provider cleanup throws");
        assert.equal(params.phaseRef.current, "idle");
      }
      else { params.turnGenerationRef.current++; params.cancelRef.current = true; provider.abandonSpeaking(); }
      const priorInk = ink.length;
      // Misbehaving transport callbacks after cancellation cannot revive a beat.
      jobs[0]!.options.onAudioReady?.(); jobs[0]!.options.onStart?.(); jobs[0]!.options.onEnd?.();
      await advance(70_000);
      assert.equal(ink.length, priorInk);
      assert.equal(providerCalls, 1, "stop/stale must not request a provider retry");
    }
    await advance(110_000);
    assert.equal(settled, true, `${mode}: all pending work must settle within a bounded active-time budget`);
    await run;
    await replacementRun;
    let drawSettled = false;
    void params.drawChainRef.current.then(() => { drawSettled = true; });
    await flush();
    assert.equal(drawSettled, true, `${mode}: failure/cancellation must also release the actual draw wait`);
    if (process.env.DIAGRAM_AUDIO_EVENTS) console.log(JSON.stringify(events));
    if (mode === "later-doubt") {
      assert.equal(committed, true, "an explicit doubt interrupt retains the visible figure");
      assert.equal(aborted, false, "the old intro unwind cannot roll back a doubt-kept figure");
      assert.equal(params.boardPageRef.current.figureDrawn, true);
      assert(visibleIntro().length >= intros[0]!.commands!.length && visibleIntro().length < introCommandCount);
      assert.deepEqual(params.recordedSegmentsRef.current.map((row) => row.narration), [intros[0]!.narration],
        "a doubt preserves completed narration only, never a partial current beat");
      assert.equal(params.narrationSinceEpochRef.current, `Earlier work narration. ${intros[0]!.narration}`,
        "late doubt unwind must preserve the retained epoch narration");
    } else if (successful) {
      assert.equal(failure, null);
      assert.equal(committed, true);
      assert.equal(aborted, false);
      assert.equal(params.boardPageRef.current.figureDrawn, true);
      assert.equal(params.cancelRef.current, false);
      const commit = events.find((event) => event.name === "intro-committed")!;
      for (const beat of intros) {
        const ended = events.filter((event) => event.name === "provider-end" && event.text === beat.narration.trim()).at(-1);
        if (ended) assert(ended.atMs <= commit.atMs, "atomic commit must join every intro narration's actual end");
        else assert(events.some((event) => event.name === "browser-end" && event.atMs <= commit.atMs), "uncaptured browser narration still needs actual onEnd before commit");
      }
      assert.deepEqual(visibleIntro().map((node) => node.command), intros.flatMap((beat) => beat.commands!),
        "success requires actual visible commands from ALL compiled beats in their authoritative order");
      if (restartCase) assert.equal(ink.filter((row) => intros[0]!.commands!.includes(row.command)).length, intros[0]!.commands!.length,
        "completed earlier beats are never replayed");
      assert(ink.some((row) => row.command.type === "WRITE"), "subsequent lesson must progress with actual work ink");
      assert.deepEqual(params.recordedSegmentsRef.current.map((row) => row.narration), [...intros.map((beat) => beat.narration), lesson.narration]);
      if (mode === "grace-expiry-handoff" || mode === "browser-restart") {
        const browserRowIndex = mode === "browser-restart" ? 1 : 0;
        assert.equal(params.recordedSegmentsRef.current[browserRowIndex]!.audioBytes, null, "browser synthesis does not fabricate captured provider bytes");
        assert((params.recordedSegmentsRef.current[browserRowIndex]!.durationMs ?? 0) > 0, "the browser row must reach its actual onEnd before recording");
        assert((params.recordedSegmentsRef.current.at(-1)!.audioBytes?.length ?? 0) > 0);
        assert(events.findIndex((event) => event.name === "browser-end") < events.findIndex((event) => event.name === "intro-committed"));
      } else {
        assert(params.recordedSegmentsRef.current.every((row) => (row.audioBytes?.length ?? 0) > 0), "only complete provider-captured rows are recorded");
        assert.equal(params.recordedSegmentsRef.current[0]!.durationMs, mathToSpeech(intro.narration.trim()).length * 86,
          "browser partial capture must not leak into recovered provider recording");
      }
      assert.equal(events.filter((event) => event.name === "provider-attempt").length, mode === "browser-restart" || directProvider ? intros.length + 1 : intros.length + 2);
      if (mode.startsWith("late-grace") || lateRetry) {
        assert(ink.every((row) => (row.audioPosition ?? 0) > 0), "every intro/work command must follow actual advancing provider speech");
        assert.equal(events.find((event) => event.name === "provider-start")?.nativeActiveMs, 2_400);
        if (directProvider) assert.equal(browserAttempts, 0, "pause-aware late readiness must preserve the provider voice");
      }
      if (mode === "near") {
        assert.equal(browserAttempts, 0);
        assert.deepEqual(events.filter((event) => event.name === "turn-paused").map((event) => event.atMs), [6_525, 25_600],
          "live Pause timestamps must be observable, not inferred from browser fallback records");
        assert.deepEqual(events.filter((event) => event.name === "turn-resumed").map((event) => event.atMs), [25_000, 35_000]);
      }
    } else {
      assert.equal(committed, false, "a failed/cancelled intro must never fake a committed diagram");
      assert.equal(aborted, true, "every failed intro must abort atomically");
      assert.equal(visibleIntro().length, 0, "abort removes every beat of intro ink");
      assert.equal(params.boardPageRef.current.figureDrawn, false, "a failed/cancelled intro cannot claim diagram metadata");
      if (mode === "later-new-turn") {
        assert.equal(params.cancelRef.current, false, "old intro unwind cannot cancel a replacement turn");
        assert.equal(params.activeVerifiedDiagramRef.current, successorDiagram);
        assert.deepEqual(params.recordedSegmentsRef.current.map((row) => row.narration), [lesson.narration],
          "old intro rows are discarded by identity; the replacement turn's real WRITE row survives");
        assert(params.narrationSinceEpochRef.current.startsWith(expectedSuccessorPrefix));
      } else {
        assert.equal(params.recordedSegmentsRef.current.length, 0, "no partial successful saved rows");
        assert.equal(params.narrationSinceEpochRef.current, "Earlier work narration.", "aborted intro never leaks narration into the notes epoch");
      }
      if (mode === "never" || mode === "stop-error" || mode === "ready-no-audio" || mode === "late-grace-stop") assert.equal(ink.length, 0);
      if (mode === "retry-fails" || mode === "retry-hangs") assert.equal(providerCalls, 2, "provider retry cannot loop indefinitely");
    }
    assert.equal(unrelated.destroyed, false, "intro transaction never clears unrelated work rows");
    if (originalLayout) {
      assert(originalLayout.rects.includes(unrelatedAnchor));
      assert(originalLayout.rects.includes(earlierFigureAnchor), "an intro abort cannot discard pre-existing figure anchors");
      assert(originalLayout.rects.includes(concurrentAnchor));
      if (restartCase) assert.equal(params.boardLayoutRef.current, originalLayout);
      else if (originalLayout !== successorLayout) assert.deepEqual(originalLayout.rects, [unrelatedAnchor, earlierFigureAnchor, concurrentAnchor], "root abort removes only intro-owned metadata from its original object");
      else assert.deepEqual(originalLayout.rects.filter((rect) => rect.x >= 400), [earlierFigureAnchor, concurrentAnchor, successorAnchor],
        "root abort cannot remove successor anchors appended to the very same layout object");
      if (successorLayout) {
        assert.equal(params.boardLayoutRef.current, successorLayout);
        assert(successorLayout.rects.includes(successorAnchor), "old intro unwind preserves successor layout metadata");
        assert.equal(successorLayout.nextY, 200 + TEXT_LAYOUT.lineHeight, "old rollback does not reset successor work placement");
      }
    }
    record("scenario-complete");
    console.log(`verified diagram audio ${selectedMode}: ${ink.length} executed ink commands, ${params.recordedSegmentsRef.current.length} complete recorded rows`);
  } finally {
    core.SpeechSynthesisTTSClient = SpeechSynthesisTTSClient;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}
async function main() {
  const selection = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7) as Mode | undefined;
  const cases: Mode[] = ["intro-command-join", "later-same-narration-new-turn", "real-later-same-layout-new-turn", "third-stop", "third-no-audio", "third-failure", "third-timeout", "third-draw-failure", "real-later-stop", "real-later-new-turn", "intro-focus-rejected", "later-new-turn", "later-doubt", "real-label-restart", "real-browser-restart", "real-provider-restart", "browser-restart", "provider-restart", "later-timeout", "later-draw-failure", "later-failure", "later-no-audio", "later-stop", "near", "late-grace", "late-grace-paused", "late-grace-stop", "ready-no-audio", "grace-expiry-race", "grace-expiry-handoff", "retry-grace-expiry-race", "retry-late-grace", "retry-late-grace-paused", "restart", "reject-pause", "never", "stop", "stop-error", "stale", "retry-fails", "retry-hangs"];
  assert(!selection || cases.includes(selection), `unknown case: ${selection}`);
  for (const mode of selection ? [selection] : cases) await scenario(mode);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
