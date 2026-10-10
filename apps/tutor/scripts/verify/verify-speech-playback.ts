import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { TutorSegment } from "@heytutor/drawing";
import type { SpeakSegmentOptions, TTSClient } from "@heytutor/tutor-core";
import type { UseSegmentRunnerParams } from "../../features/tutor-session/hooks/turn/types";
import { MAX_PAGE_AWAY_TELEMETRY_BYTES, MAX_TURN_TELEMETRY_EVENTS, createTurnTelemetry } from "../../lib/obs/turnTelemetry";
import type { TurnTelemetryEvent } from "../../lib/obs/langfuse";
import { createSpeechPlaybackTracker, sanitizeSpeechPlaybackMetadata, sanitizeSpeechPlaybackTraceMetadata } from "../../lib/obs/speechPlayback";

const events: Array<{ name: string; metadata?: Record<string, unknown> }> = [];
let now = 1_000;
const tracker = createSpeechPlaybackTracker({
  telemetry: { durationMs: () => now, mark: (name, metadata) => { events.push({ name, metadata }); } },
  segmentIndex: 3, isCurrent: () => true,
});
tracker.start({ transport: "provider", signal: "audio-context-scheduled", leadMs: 50, muted: false });
now = 2_500;
tracker.end("complete", "on-end");
assert.deepEqual(events.map((event) => ({ name: event.name, at: event.metadata?.since_ask_ms })), [
  { name: "speech-playback-start", at: 1_050 },
  { name: "speech-playback-end", at: 2_500 },
], "playback ends at the actual voice callback, independent of a later paired drawing span");
assert.deepEqual(sanitizeSpeechPlaybackMetadata({
  ...events[1]!.metadata, question: "PRIVATE STUDENT TEXT", narration: "PRIVATE NARRATION", error: "PRIVATE ERROR",
  segment_index: 3.5, playback_index: -1, scheduled_lead_ms: Infinity,
  signal: "PRIVATE SIGNAL", transport: "PRIVATE TRANSPORT", outcome: "PRIVATE OUTCOME", end_signal: "PRIVATE END",
}), { speech_trace_schema: "speech-playback/v1", muted: false, since_ask_ms: 2_500 },
"playback telemetry accepts only exact enums and bounded integer fields, never source text or exceptions");
const broken = createSpeechPlaybackTracker({ telemetry: { durationMs: () => { throw new Error("diagnostic failure"); }, mark() {} },
  segmentIndex: 0, isCurrent: () => true });
assert.doesNotThrow(() => broken.start({ transport: "provider", signal: "unknown", leadMs: 0, muted: false }),
  "a failed diagnostic clock must never throw into speech");
const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const settle = async () => { for (let index = 0; index < 160; index++) await Promise.resolve(); };
function load(file: string, mocks: Record<string, unknown> = {}): Record<string, unknown> {
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier in mocks) return mocks[specifier];
    const target = specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
      : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier;
    return requireApp(target);
  }, loaded, loaded.exports);
  return loaded.exports;
}

async function verifyActualRunner(mode: "paired" | "muted" | "browser-signal" | "stale" | "stale-pause" | "pause-no-start" |
  "pause-provider-observed-start" | "pause-browser-observed-start") {
  const pauses = mode.startsWith("pause-");
  const browserSignal = mode === "browser-signal" || mode === "pause-browser-observed-start";
  const observedRestart = mode === "pause-provider-observed-start" || mode === "pause-browser-observed-start";
  let clock = 0;
  const sent: Array<{ events: TurnTelemetryEvent[]; traceMetadata?: Record<string, unknown> }> = [];
  const tel = createTurnTelemetry({ originPerf: 0, env: {
    now: () => clock, wallNow: () => Date.UTC(2026, 9, 11) + clock,
    send: async (body) => { sent.push(JSON.parse(body)); }, window: null, document: null,
  } });
  tel.setTrace(`speech-${mode}`);
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const savedPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout: (fn: () => void, ms?: number) => {
      const id = setTimeout(() => { pendingTimers.delete(id); fn(); }, ms);
      pendingTimers.add(id);
      return id;
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => { pendingTimers.delete(id); clearTimeout(id); },
    addEventListener() {}, removeEventListener() {},
  } });
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => clock } });
  let options: SpeakSegmentOptions | null = null;
  let speechDone!: () => void;
  let drawDone!: () => void;
  const speech = new Promise<void>((resolve) => { speechDone = resolve; });
  const draw = new Promise<void>((resolve) => { drawDone = resolve; });
  let drawStarted = false;
  const ref = <T,>(current: T) => ({ current });
  const generation = ref(1);
  const paused = ref(false);
  const currentTelemetry = ref(tel);
  const successorEvents: unknown[] = [];
  let turn: Promise<void> | null = null;
  let controls: ReturnType<typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner").useSegmentRunner> | null = null;
  try {
    const runnerModule = load(path.join(app, "features/tutor-session/hooks/turn/useSegmentRunner.ts"), {
      react: { useRef: ref, useCallback: (callback: unknown) => callback },
    });
    const runHook = runnerModule.useSegmentRunner as typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner").useSegmentRunner;
    const tts: TTSClient = {
      speak: async () => {}, speakSegment: async (_text, speakOptions = {}) => {
        options = speakOptions;
        clock = 1_000;
        speakOptions.onStart?.();
        speakOptions.onTimings?.({ totalDuration: 1,
          charStartTimes: Array.from({ length: _text.length }, (_, index) => index * 0.02),
          charDurations: Array.from({ length: _text.length }, () => 0.02) });
        await speech;
      },
      prewarm: async () => {}, playAudio: async () => {}, pause() {}, resume() {}, stop() {},
      get isPlaying() { return true; }, getPlaybackPositionMs: () => 1_000,
      setPlaybackRate() {}, getPlaybackRate: () => 1,
      getLastPlaybackStart: () => browserSignal ? { signal: "speech-synthesis-start", leadMs: 0 }
        : { signal: "audio-context-scheduled", leadMs: 50 },
      isMuted: () => mode === "muted",
    };
    const params = {
      sessionId: "speech-board", activeVerifiedDiagramRef: ref(null), cancelRef: ref(false), isPausedRef: paused,
      turnActiveRef: ref(true), turnGenerationRef: generation, turnTelemetryRef: currentTelemetry,
      turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), recordedSegmentsRef: ref([]), narrationSinceEpochRef: ref(""),
      currentTraceIdRef: ref("speech-trace"), narrationDensityRef: ref(0), drawChainRef: ref(Promise.resolve()),
      setCurrentSegmentText() {}, ensureTTSClient: () => tts,
      cancellableDelay: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5))),
      raceWithCancel: async <T,>(promise: Promise<T>) => promise,
      reserveTextCommandPlacements: async (command: unknown) => [command],
      executeCommandWithCancel: async () => { drawStarted = true; await draw; },
      applyTurnPhase() {}, onSpeechStartupStatus() {},
    } as unknown as UseSegmentRunnerParams;
    const runner = runHook(params);
    controls = runner;
    const segment: TutorSegment = { narration: "PRIVATE SYNTHETIC NARRATION", command: mode === "paired"
      ? { type: "WRITE", text: "PRIVATE SYNTHETIC ROW", params: [80, 150], charPosition: 0, narrationBefore: "" } : null };
    turn = runner.runSegment(segment, 0, [segment], 1);
    await settle();
    assert(options, "the real runner must dispatch its speech callback");
    if (mode === "paired") assert(drawStarted, "the real paired draw must actually be held, not mocked away");
    if (pauses) {
      clock = 1_500;
      runner.pauseFallbackSpeech();
      paused.current = true;
      await tel.checkpoint("paused");
      const interrupted = sent.flatMap((batch) => batch.events).filter((event) => event.name.startsWith("speech-playback-"));
      assert.equal(interrupted.length, 2, "actual Pause closes the accepted voice interval immediately");
      assert.equal(interrupted[1]!.metadata?.since_ask_ms, 1_500);
      assert.equal(interrupted[1]!.metadata?.outcome, "cancelled");
      assert.equal(interrupted[1]!.metadata?.end_signal, "abandoned");
      runner.pauseFallbackSpeech();
      clock = 7_000;
      paused.current = false;
      runner.resumeFallbackSpeech();
      await tel.checkpoint("resumed-without-onset");
      assert.equal(sent.flatMap((batch) => batch.events).filter((event) => event.name.startsWith("speech-playback-")).length, 2,
        "Resume without an observed audio onset must not invent a new interval");
      if (observedRestart) {
        (options as SpeakSegmentOptions).onStart?.();
        await tel.checkpoint("observed-resumed-onset");
        const restarted = sent.flatMap((batch) => batch.events).filter((event) => event.name.startsWith("speech-playback-"));
        assert.equal(restarted.length, 3, "only an actual accepted resumed onStart opens another interval");
        assert.equal(restarted[2]!.metadata?.since_ask_ms, browserSignal ? 7_000 : 7_050);
        assert.equal(restarted[2]!.metadata?.playback_index, 2);
      }
    }
    clock = pauses ? 8_000 : 2_500;
    if (mode === "stale" || mode === "stale-pause") {
      generation.current++;
      currentTelemetry.current = { ...tel, mark: (...args) => { successorEvents.push(args); } };
      if (mode === "stale-pause") {
        runner.pauseFallbackSpeech();
        runner.resumeFallbackSpeech();
      }
    }
    (options as SpeakSegmentOptions).onEnd?.();
    speechDone();
    await settle();
    await tel.checkpoint("speech-ended");
    const playback = sent.flatMap((batch) => batch.events).filter((event) => event.name.startsWith("speech-playback-"));
    const stale = mode === "stale" || mode === "stale-pause";
    assert.equal(playback.length, stale ? 1 : observedRestart ? 4 : 2,
      "actual callbacks must mark voice start/end; a stale completion cannot report into an old or successor turn");
    assert.equal(playback[0]!.metadata?.muted, mode === "muted");
    assert.equal(playback[0]!.metadata?.transport, browserSignal ? "browser" : "provider");
    assert.equal(playback[0]!.metadata?.since_ask_ms, browserSignal ? 1_000 : 1_050);
    if (!stale) {
      assert.equal(playback[1]!.metadata?.since_ask_ms, pauses ? 1_500 : 2_500,
        "voice end cannot wait for paused time or paired draw completion");
      assert.equal(playback[1]!.metadata?.end_signal, pauses ? "abandoned" : "on-end");
      assert.equal(playback[1]!.metadata?.outcome, pauses ? "cancelled" : "complete");
      if (observedRestart) {
        assert.equal(playback[3]!.metadata?.since_ask_ms, 8_000);
        assert.equal(playback[3]!.metadata?.outcome, "complete");
        assert.equal(playback[3]!.metadata?.end_signal, "on-end");
      }
    }
    if (mode === "paired") assert(!sent.flatMap((batch) => batch.events).some((event) => event.name === "segment-0"),
      "the paired segment span must still be open after voice has ended");
    clock = pauses ? 9_000 : 4_000;
    drawDone();
    await turn;
    await tel.flush();
    assert.equal(pendingTimers.size, 0, "completed runner releases both timeout/watch timers, including after Pause");
    assert.equal(sent.filter((batch) => batch.traceMetadata).at(-1)?.traceMetadata?.speech_playback_total_events,
      stale ? 1 : observedRestart ? 4 : 2, "Pause/restart marks retain exact total-event evidence");
    assert.equal(successorEvents.length, 0, "late callbacks must never write into successor telemetry");
    const wire = JSON.stringify(sent.flatMap((batch) => batch.events).filter((event) => event.name.startsWith("speech-playback-")));
    assert(!wire.includes("PRIVATE SYNTHETIC"), "speech marks may not contain narration, rows or student text");
  } finally {
    paused.current = false;
    controls?.resumeFallbackSpeech();
    speechDone(); drawDone();
    await turn?.catch(() => undefined);
    for (const id of pendingTimers) clearTimeout(id);
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow); else Reflect.deleteProperty(globalThis, "window");
    if (savedPerformance) Object.defineProperty(globalThis, "performance", savedPerformance); else Reflect.deleteProperty(globalThis, "performance");
  }
}

async function main() {
  if (process.argv.includes("--pause-only")) {
    for (const mode of ["pause-no-start", "pause-provider-observed-start", "pause-browser-observed-start"] as const)
      await verifyActualRunner(mode);
    console.log("verify-speech-playback: actual runner Pause closes the interval without a fabricated resumed onset");
    return;
  }
  for (const mode of ["paired", "muted", "browser-signal", "stale", "stale-pause", "pause-no-start",
    "pause-provider-observed-start", "pause-browser-observed-start"] as const) await verifyActualRunner(mode);
  await verifyOwnedRoute();
  await verifyRetention();
  await verifyLifecycleBudget();
  console.log("verify-speech-playback: independent voice end, Pause interruption, observed-only resumed onset, muted/stale ownership and zero timers");
}

async function verifyRetention() {
  const batches: Array<{ events: TurnTelemetryEvent[]; traceMetadata?: Record<string, unknown> }> = [];
  const tel = createTurnTelemetry({ env: { now: () => 0, wallNow: () => 0,
    send: async (body) => { batches.push(JSON.parse(body)); }, window: null, document: null } });
  tel.setTrace("retention-trace");
  for (let index = 0; index < MAX_TURN_TELEMETRY_EVENTS; index++) tel.mark("write-char-start");
  for (let index = 0; index < 30; index++) {
    const tracker = createSpeechPlaybackTracker({ telemetry: tel, segmentIndex: index, isCurrent: () => true });
    tracker.start({ transport: "provider", signal: "html-audio-playing", leadMs: 0, muted: false });
    tracker.end("complete", "on-end");
  }
  await tel.flush();
  assert.equal(batches.flatMap((batch) => batch.events).filter((event) => event.name.startsWith("speech-playback-")).length, 60,
    "all speech intervals under the fixed limit must survive ordinary character telemetry pressure");
  const overflowBatches: Array<{ traceMetadata?: Record<string, unknown> }> = [];
  const overflow = createTurnTelemetry({ env: { now: () => 0, wallNow: () => 0,
    send: async (body) => { overflowBatches.push(JSON.parse(body)); }, window: null, document: null } });
  overflow.setTrace("overflow-trace");
  for (let index = 0; index < MAX_TURN_TELEMETRY_EVENTS / 2 + 1; index++) {
    const tracker = createSpeechPlaybackTracker({ telemetry: overflow, segmentIndex: index, isCurrent: () => true });
    tracker.start({ transport: "provider", signal: "html-audio-playing", leadMs: 0, muted: false });
    tracker.end("complete", "on-end");
  }
  await overflow.flush();
  assert.equal(overflowBatches.find((batch) => batch.traceMetadata)?.traceMetadata?.speech_playback_dropped_events, 2,
    "if speech intervals exceed the bounded trace budget, explicitly report missing evidence rather than a false no-gap claim");
  assert.equal(overflowBatches.find((batch) => batch.traceMetadata)?.traceMetadata?.speech_playback_total_events, 402,
    "total emitted marks include rejected marks so a missing complete pair or failed network chunk cannot look like complete evidence");
}

async function verifyLifecycleBudget() {
  const bodies: string[] = [];
  const page = new EventTarget();
  const tel = createTurnTelemetry({ env: { now: () => 0, wallNow: () => 0,
    send: async (body) => { bodies.push(body); }, window: page, document: null } });
  tel.setTrace("page-away-trace");
  for (let index = 0; index < 200; index++) {
    const tracker = createSpeechPlaybackTracker({ telemetry: tel, segmentIndex: index, isCurrent: () => true });
    tracker.start({ transport: "provider", signal: "html-audio-playing", leadMs: 0, muted: false });
    tracker.end("complete", "on-end");
  }
  tel.watchPageLifecycle(() => true);
  page.dispatchEvent(new Event("pagehide"));
  await settle();
  assert.equal(bodies.length, 1, "page away gets one body, not parallel keepalive requests");
  assert(Buffer.byteLength(bodies[0]!, "utf8") <= MAX_PAGE_AWAY_TELEMETRY_BYTES);
  const away = JSON.parse(bodies[0]!) as { events: TurnTelemetryEvent[]; traceMetadata?: Record<string, unknown> };
  const sentSpeech = away.events.filter((event) => event.name.startsWith("speech-playback-")).length;
  assert(sentSpeech < 400, "the synthetic whole-pair fixture must actually exceed the page-away budget");
  assert.equal(away.traceMetadata?.speech_playback_pending_events, 400 - sentSpeech,
    "whole speech pairs omitted from a size-limited body must be explicitly reported, not mistaken for exact gap evidence");
  await tel.flush();
  const all = bodies.map((body) => JSON.parse(body) as typeof away);
  assert.equal(all.flatMap((body) => body.events).filter((event) => event.name.startsWith("speech-playback-")).length, 400,
    "coming back sends every withheld playback mark once, without confusing buffering with permanent loss");
  assert.equal(all.filter((body) => body.traceMetadata).at(-1)!.traceMetadata!.speech_playback_pending_events, 0,
    "a completed drain explicitly clears the pending evidence counter");
}

async function verifyOwnedRoute() {
  const recorded: Array<Record<string, unknown>> = [];
  let authenticated = true;
  const route = load(path.join(app, "app/api/trace/event/route.ts"), {
    "@/lib/auth": { getUserId: async () => authenticated ? "synthetic-owner" : null, ensureUser: async () => {} },
    "@/lib/obs/traceOwnership": { assertOwnedTrace: async (_owner: string, trace: string, board: string) =>
      trace === "issued-trace" && board === "owned-board" },
    "@/lib/obs/langfuse": { recordTurnEvents: (value: Record<string, unknown>) => recorded.push(value),
      updateTurnTrace: (value: Record<string, unknown>) => recorded.push(value), flushSafely: async () => {} },
  }) as unknown as typeof import("../../app/api/trace/event/route");
  const stamp = new Date(0).toISOString();
  const dispatch = (body: Record<string, unknown>) => route.POST(new Request("https://example.invalid/api/trace/event", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ traceId: "issued-trace", sessionId: "owned-board", ...body }),
  }));
  assert.deepEqual(sanitizeSpeechPlaybackTraceMetadata({ speech_playback_total_events: 402,
    speech_playback_dropped_events: 2, speech_playback_pending_events: 255, speech_playback_raw: "PRIVATE TEXT" }),
  { speech_playback_total_events: 402, speech_playback_dropped_events: 2, speech_playback_pending_events: 255 });
  assert.deepEqual(sanitizeSpeechPlaybackTraceMetadata({ speech_playback_total_events: -1,
    speech_playback_dropped_events: 1.5, speech_playback_pending_events: "PRIVATE TEXT" }), {});
  const privateText = "PRIVATE SYNTHETIC SOURCE";
  const scopedEvent = { name: "speech-playback-start", startTime: stamp, endTime: stamp, parentName: privateText,
    metadata: { speech_trace_schema: "speech-playback/v1", segment_index: 0, playback_index: 1, since_ask_ms: 1_050,
      transport: "provider", signal: "audio-context-scheduled", scheduled_lead_ms: 50, muted: true,
      question: privateText, narration: privateText, source: privateText, commands: [privateText], error: privateText } };
  assert.equal((await dispatch({ events: [scopedEvent], traceMetadata: { speech_playback_total_events: 402,
    speech_playback_dropped_events: 2, speech_playback_pending_events: 255, speech_playback_raw: privateText } })).status, 200);
  assert.equal(JSON.stringify(recorded).includes(privateText), false,
    "the actual owned route must drop all arbitrary metadata and parent text from speech playback events");
  const wire = recorded[0]!.events as Array<{ metadata: Record<string, unknown>; parentName?: unknown }>;
  assert.equal(wire[0]!.parentName, undefined);
  assert.deepEqual(wire[0]!.metadata, { speech_trace_schema: "speech-playback/v1", segment_index: 0, playback_index: 1,
    since_ask_ms: 1_050, transport: "provider", signal: "audio-context-scheduled", scheduled_lead_ms: 50,
    muted: true, client_reported: true });
  assert.deepEqual(recorded[1]!.metadata, { client_telemetry: { speech_playback_total_events: 402,
    speech_playback_dropped_events: 2, speech_playback_pending_events: 255 } },
  "the owned route preserves only the three bounded numeric speech evidence counters");
  recorded.length = 0;
  assert.equal((await dispatch({ events: [{ ...scopedEvent, name: `speech-playback-${privateText}` }] })).status, 400,
    "an arbitrary speech-playback prefix must not grant permission to smuggle source text");
  assert.equal((await dispatch({ events: [scopedEvent], traceId: "foreign-trace" })).status, 404);
  assert.equal((await dispatch({ events: [scopedEvent], sessionId: "foreign-board" })).status, 404);
  authenticated = false;
  assert.equal((await dispatch({ events: [scopedEvent] })).status, 401);
  assert.equal(recorded.length, 0, "foreign trace/session and unauthenticated requests never record observations");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
