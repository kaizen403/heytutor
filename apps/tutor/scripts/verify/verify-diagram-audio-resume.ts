import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { synthesizeArchetypeScene } from "@heytutor/scene-engine";
import type { DrawCommand, TutorSegment } from "@heytutor/drawing";
import { mathToSpeech, type AudioTimings, type TTSClient } from "@heytutor/tutor-core";
import { SpeechSynthesisTTSClient, type SpeakSegmentOptions } from "../../../../packages/tutor-core/src/tts/speechClient";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import type { ExecuteCommandOptions, UseTurnLifecycleParams } from "../../features/tutor-session/hooks/turn/types";
import type { RecordedSegmentPayload } from "../../lib/boards/boardsClient";

/**
 * Actual useTurnControl -> useSegmentRunner -> drawSegmentInk -> browser client.
 * Only React storage, provider transport, the synthesis engine and canvas are
 * deterministic fakes. Generic compiled scene; no production trace or credentials.
 * Native media playback is tested separately: this gate proves turn ownership,
 * actual executed ink, transaction commit, and complete captured rows.
 */
const app = fileURLToPath(new URL("../../", import.meta.url));
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
    if (specifier === "./useSegmentRunner") return loadHook(path.resolve(path.dirname(file), `${specifier}.ts`));
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
  };
  new Function("require", "module", "exports", compiled)(localRequire, hookModule, hookModule.exports);
  loaded.set(file, hookModule.exports);
  return hookModule.exports;
}
const runTurnControl = loadHook(path.join(app, "features/tutor-session/hooks/turn/useTurnControl.ts")).useTurnControl as
  typeof import("../../features/tutor-session/hooks/turn/useTurnControl").useTurnControl;
const scene = synthesizeArchetypeScene({ question: "A 2 kg block on a 30 degree incline with friction coefficient 0.2. Find its acceleration." });
assert(scene, "the generic scene must compile");
const presentation = buildVerifiedDiagramPresentation(scene.document, scene.renderScene);
const intro = presentation.introSegments[0]!;
assert(intro.commands && intro.commands.length > 1);
const lesson: TutorSegment = { narration: "The net force equals mass times acceleration.", command: {
  type: "WRITE", text: "F = ma", params: [80, 150], charPosition: 0, narrationBefore: "The net force equals mass times acceleration.",
} };

type Mode = "near" | "late-grace" | "late-grace-paused" | "late-grace-stop" | "ready-no-audio" | "grace-expiry-race" | "grace-expiry-handoff" | "retry-grace-expiry-race" | "retry-late-grace" | "retry-late-grace-paused" | "restart" | "reject-pause" | "never" | "stop" | "stop-error" | "stale" | "retry-fails" | "retry-hangs";
type Event = { atMs: number; name: string; [key: string]: unknown };
async function scenario(mode: Mode) {
  const directProvider = ["near", "late-grace", "late-grace-paused", "late-grace-stop", "ready-no-audio", "grace-expiry-race", "grace-expiry-handoff"].includes(mode);
  const lateRetry = mode === "retry-late-grace" || mode === "retry-late-grace-paused" || mode === "retry-grace-expiry-race";
  const expiryRace = ["grace-expiry-race", "grace-expiry-handoff", "retry-grace-expiry-race"].includes(mode);
  const successful = ["near", "late-grace", "late-grace-paused", "retry-late-grace", "retry-late-grace-paused", "restart", "reject-pause", "grace-expiry-handoff"].includes(mode);
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
      if (mode !== "never" && mode !== "ready-no-audio" && mode !== "grace-expiry-race" && browserAttempts === 1) {
        setTimer(() => { if (utterance === next) { record("browser-start"); next.onstart?.(); } }, 50);
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
    startedAt: number | null; position: number; duration: number; dead: boolean };
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
      return new Promise<void>((resolve) => {
        const duration = mathToSpeech(text).length * 86;
        const job: Job = { text, options, resolve, startedAt: null, position: 0, duration, dead: false };
        jobs.push(job); current = job;
        if (mode === "never" || mode === "stop-error" || (mode === "retry-fails" && providerCalls > 1)) return;
        if (!directProvider && providerCalls === 1) return; // Force app browser recovery.
        const timings: AudioTimings = { totalDuration: duration / 1000,
          charStartTimes: Array.from({ length: mathToSpeech(text).length }, (_, i) => i * 0.086),
          charDurations: Array.from({ length: mathToSpeech(text).length }, () => 0.086) };
        const lateGrace = directProvider && mode !== "near" && providerCalls === 1 || lateRetry && providerCalls === 2;
        const readyAfter = directProvider && providerCalls === 1 || lateGrace ? 6_485 : 100;
        setTimer(() => {
          // Keep these callbacks callable even when abandoned, to catch stale ownership.
          record("provider-bytes-ready");
          if (mode !== "retry-hangs" || providerCalls !== 2) options.onTimings?.(timings);
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
            if (mode === "retry-hangs" && providerCalls === 2) return; // Starts without alignment, then never ends.
            const checkEnd = () => {
              if (job.dead) return;
              if (!providerPaused && (samplePosition() ?? 0) >= duration) {
                options.onAudioCaptured?.({ bytes: Uint8Array.of(82, 73, 70, 70), mimeType: "audio/wav" });
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
  const params = {
    sessionId: "offline-board", phase: "thinking", isReplaying: false, boardLoaded: false,
    ensureTTSClient: () => provider as unknown as TTSClient, ttsClientRef: ref(provider), phaseRef: ref("thinking"),
    cancelRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1), isPausedRef: ref(false),
    turnAbortRef: ref(new AbortController()), currentTraceIdRef: ref("offline-trace"),
    segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()),
    collectedSegmentsRef: ref<TutorSegment[]>([]), recordedSegmentsRef: ref<RecordedSegmentPayload[]>([]), narrationSinceEpochRef: ref(""),
    activeVerifiedDiagramRef: ref(presentation.diagram), pendingSegmentCountRef: ref(0),
    fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false),
    boardLayoutRef: ref({ rects: [], textRects: [], anchors: new Map(), occupiedRects: [] }),
    boardPageRef: ref({ boardId: "offline-board", figureDrawn: false }),
    narrationDensityRef: ref(0), turnStatsRef: ref({ ttsChars: 0, drawMs: 0 }),
    turnTelemetryRef: ref({ mark: record, span: () => ({ end() {} }), meta() {}, durationMs: () => now, flush: async () => {} }),
    whiteboardRef: ref({ beginDrawTransaction: () => "intro", commitDrawTransaction: () => {
      assert.equal(ink.filter((row) => row.command.type !== "WRITE").length, intro.commands!.length,
        "commit requires every actual intro ink command, not draw-complete's planned count");
      committed = true; record("intro-committed");
    }, abortDrawTransaction: () => { aborted = true; record("intro-aborted"); },
    finishAbortedDrawTransaction() {}, setPaused() {}, cancelAnimations() {}, clearSpotlight() {} }),
    stopTurnRef: ref(null), replayDrawClockRef: ref(null), replayAudioRef: ref(null), rewoundRef: ref(false),
    replayCueRef: ref(null), replayAudioPreloadRef: ref(new Map()), replayGenerationRef: ref(1),
    clearCancelTimers() {},
    cancellableDelay: (ms: number) => new Promise<void>((resolve) => setTimer(resolve, ms)),
    raceWithCancel: (promise: Promise<unknown>) => promise,
    reserveTextCommandPlacements: async (command: unknown) => [command],
    executeCommandWithCancel: async (command: DrawCommand, options: ExecuteCommandOptions): Promise<void> => {
      while (params.isPausedRef.current && !options.isCancelled?.()) await new Promise<void>((resolve) => setTimer(resolve, 25));
      if (options.isCancelled?.() || params.cancelRef.current) return;
      ink.push({ command, atMs: now, audioPosition: samplePosition() });
      // Canvas engine's command completion is asynchronous, not fabricated by telemetry.
      await new Promise<void>((resolve) => setTimer(resolve, 20));
    },
    setCurrentSegmentText() {}, setPhase() {}, setIsPaused() {}, setActiveVerifiedDiagram() {},
    setInputInteracted() {}, setIsReplaying() {}, setReplayProgressMs() {}, setReplayTotalMs() {},
  };
  try {
    // Unused UI dependencies are intentionally omitted from this hook seam.
    const control = runTurnControl(params as unknown as UseTurnLifecycleParams, ref(async () => {}));
    control.enqueueVerifiedIntro([intro], 1);
    control.enqueueSegment(lesson, 1);
    let failure: unknown = null;
    let settled = false;
    const run = params.segmentChainRef.current.then(() => { settled = true; }, (error: unknown) => {
      failure = error; settled = true;
    });
    if (lateRetry) {
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
    let drawSettled = false;
    void params.drawChainRef.current.then(() => { drawSettled = true; });
    await flush();
    assert.equal(drawSettled, true, `${mode}: failure/cancellation must also release the actual draw wait`);
    if (successful) {
      assert.equal(failure, null);
      assert.equal(committed, true);
      assert.equal(aborted, false);
      assert.equal(params.boardPageRef.current.figureDrawn, true);
      assert.equal(params.cancelRef.current, false);
      assert(ink.some((row) => row.command.type === "WRITE"), "subsequent lesson must progress with actual work ink");
      assert.deepEqual(params.recordedSegmentsRef.current.map((row) => row.narration), [intro.narration, lesson.narration]);
      if (mode === "grace-expiry-handoff") {
        assert.equal(params.recordedSegmentsRef.current[0]!.audioBytes, null, "browser synthesis does not fabricate captured provider bytes");
        assert((params.recordedSegmentsRef.current[0]!.durationMs ?? 0) > 0, "the browser row must reach its actual onEnd before recording");
        assert((params.recordedSegmentsRef.current[1]!.audioBytes?.length ?? 0) > 0);
        assert(events.findIndex((event) => event.name === "browser-end") < events.findIndex((event) => event.name === "intro-committed"));
      } else {
        assert(params.recordedSegmentsRef.current.every((row) => (row.audioBytes?.length ?? 0) > 0), "only complete provider-captured rows are recorded");
        assert.equal(params.recordedSegmentsRef.current[0]!.durationMs, mathToSpeech(intro.narration.trim()).length * 86,
          "browser partial capture must not leak into recovered provider recording");
      }
      assert.equal(events.filter((event) => event.name === "provider-attempt").length, directProvider ? 2 : 3);
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
      assert.equal(params.boardPageRef.current.figureDrawn, false, "a failed/cancelled intro cannot claim diagram metadata");
      assert.equal(params.recordedSegmentsRef.current.length, 0, "no partial successful saved rows");
      if (mode === "never" || mode === "stop-error" || mode === "ready-no-audio" || mode === "late-grace-stop") assert.equal(ink.length, 0);
      if (mode === "retry-fails" || mode === "retry-hangs") assert.equal(providerCalls, 2, "provider retry cannot loop indefinitely");
    }
    record("scenario-complete");
    console.log(`verified diagram audio ${mode}: ${ink.length} executed ink commands, ${params.recordedSegmentsRef.current.length} complete recorded rows`);
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
  const cases: Mode[] = ["near", "late-grace", "late-grace-paused", "late-grace-stop", "ready-no-audio", "grace-expiry-race", "grace-expiry-handoff", "retry-grace-expiry-race", "retry-late-grace", "retry-late-grace-paused", "restart", "reject-pause", "never", "stop", "stop-error", "stale", "retry-fails", "retry-hangs"];
  assert(!selection || cases.includes(selection), `unknown case: ${selection}`);
  for (const mode of selection ? [selection] : cases) await scenario(mode);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
