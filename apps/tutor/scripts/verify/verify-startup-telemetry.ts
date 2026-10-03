/**
 * Startup latency telemetry: the clock starts at the Ask click, checkpoints
 * send each event once, a hidden or closed page keeps what was measured, the
 * startup timeline survives a full buffer, first audible fires once per turn,
 * and the report reads it all back. Fake clocks and fake transports only; no
 * network, no dev server.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-startup-telemetry.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import type { TutorSegment } from "@heytutor/drawing";
import type { SpeakSegmentOptions, TTSClient } from "@heytutor/tutor-core";
import type { TurnTelemetryEvent } from "../../lib/obs/langfuse";
import {
  MAX_TURN_TELEMETRY_EVENTS,
  STARTUP_PRIORITY_EVENTS,
  createTurnTelemetry,
  recordFirstAudible,
  recordTtsFirstByte,
  type TurnTelemetry,
  type TurnTelemetryEnv,
} from "../../lib/obs/turnTelemetry";
import { createPageLoadTiming } from "../../lib/obs/pageLoadTiming";
import {
  STAGE_CAPS_MS,
  formatSummary,
  formatTurn,
  parseArgs,
  parseLabRun,
  parseLangfuseTrace,
  percentile,
  summarizeTurns,
} from "../latency/startup-report";
import type { UseSegmentRunnerParams } from "../../features/tutor-session/hooks/turn/types";
import { StreamingSpeechClient } from "../../../../packages/tutor-core/src/tts/streamingSpeechClient";

const WALL_AT_ZERO = Date.UTC(2026, 9, 4, 9, 0, 0);
/** Student text that must never reach a telemetry payload. */
const STUDENT_TEXT = "A 2 kg block slides down a 30 degree incline";

interface SentBatch {
  traceId: string;
  sessionId?: string;
  events: TurnTelemetryEvent[];
  traceMetadata?: Record<string, unknown>;
  beacon: boolean;
}

function harness(start = 0) {
  const clock = { now: start };
  const batches: SentBatch[] = [];
  const pageWindow = new EventTarget();
  const pageDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const env: TurnTelemetryEnv = {
    now: () => clock.now,
    wallNow: () => WALL_AT_ZERO + clock.now,
    send: async (body, { beacon }) => {
      batches.push({ ...(JSON.parse(body) as Omit<SentBatch, "beacon">), beacon });
    },
    window: pageWindow,
    document: pageDocument,
  };
  const names = () => batches.flatMap((batch) => batch.events.map((event) => event.name));
  return { clock, batches, env, pageWindow, pageDocument, names };
}

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

async function verifyOriginAtAsk() {
  const h = harness(1_000);
  const askAt = h.clock.now;
  // Board commit, billing and the board epoch take 3.2 s before telemetry exists.
  h.clock.now = 4_200;
  const tel = createTurnTelemetry({ originPerf: askAt, env: h.env });
  tel.setTrace("trace-origin", "board-1");
  assert.equal(tel.durationMs(), 3_200, "durationMs counts from the Ask click");
  tel.mark("startup-ask", { pre_telemetry_ms: tel.durationMs(), board_commit_ms: 400, begin_turn_ms: 2_500, board_epoch_ms: 300 });
  const planner = tel.span("planner");
  h.clock.now = 9_200;
  planner.end();
  await tel.flush();
  const events = h.batches.flatMap((batch) => batch.events);
  const startupAsk = events.find((event) => event.name === "startup-ask")!;
  const origin = Date.parse(startupAsk.startTime) - (startupAsk.metadata!.pre_telemetry_ms as number);
  assert.equal(origin, WALL_AT_ZERO + askAt, "startup-ask minus pre_telemetry_ms lands on the Ask wall time");
  const plannerEvent = events.find((event) => event.name === "planner")!;
  assert.equal(Date.parse(plannerEvent.startTime) - origin, 3_200);
  assert.equal(Date.parse(plannerEvent.endTime) - origin, 8_200);

  // An origin after creation is impossible; it falls back to creation time.
  const later = harness(500);
  const odd = createTurnTelemetry({ originPerf: 9_999, env: later.env });
  assert.equal(odd.durationMs(), 0);
  const noOrigin = createTurnTelemetry({ env: later.env });
  later.clock.now = 800;
  assert.equal(noOrigin.durationMs(), 300, "without an origin the clock starts at creation, as before");
}

async function verifyCheckpointOnce() {
  const h = harness();
  const tel = createTurnTelemetry({ originPerf: 0, env: h.env });
  tel.mark("before-trace");
  await tel.checkpoint("no-trace-yet");
  assert.equal(h.batches.length, 0, "no trace id: nothing sent, nothing lost");
  tel.setTrace("trace-checkpoint");
  tel.mark("a");
  const planner = tel.span("planner");
  const child = tel.span("turn-plan", "planner");
  h.clock.now = 100;
  child.end({ attempt: 1 });
  tel.meta({ turn_kind: "lesson" });
  await tel.checkpoint("first-audible");
  assert.deepEqual(h.names(), ["before-trace", "a"], "a child waits while its parent span is open");
  assert.equal(h.batches[0]!.traceMetadata?.turn_kind, "lesson");
  h.clock.now = 200;
  planner.end();
  tel.mark("b");
  await tel.checkpoint("again");
  assert.deepEqual(h.names(), ["before-trace", "a", "turn-plan", "planner", "b"]);
  assert.equal(h.batches[1]!.traceMetadata, undefined, "unchanged metadata is not resent on a checkpoint");
  await tel.checkpoint("empty");
  assert.equal(h.batches.length, 2, "an empty checkpoint sends nothing");
  tel.mark("c");
  await tel.flush();
  assert.deepEqual(h.names(), ["before-trace", "a", "turn-plan", "planner", "b", "c"], "the final flush sends only the remainder");
  assert.equal(h.batches.at(-1)!.traceMetadata?.turn_kind, "lesson", "the final flush always carries metadata");
  const counts = new Map<string, number>();
  for (const name of h.names()) counts.set(name, (counts.get(name) ?? 0) + 1);
  assert(![...counts.values()].some((count) => count > 1), "every event is sent at most once");
  await tel.flush();
  assert.equal(h.batches.at(-1)!.events.length, 0, "a second flush cannot duplicate events");

  // A send that rejects never reaches the turn.
  const broken = createTurnTelemetry({ env: { ...h.env, send: async () => { throw new Error("offline"); } } });
  broken.setTrace("trace-broken");
  broken.mark("x");
  await broken.checkpoint("first-audible");
  await broken.flush();
}

async function verifyPageLifecycleCheckpoint() {
  const h = harness();
  const tel = createTurnTelemetry({ originPerf: 0, env: h.env });
  tel.setTrace("trace-lifecycle");
  tel.watchPageLifecycle();
  tel.watchPageLifecycle();
  tel.mark("startup-ask", { pre_telemetry_ms: 0 });
  tel.span("planner");
  const child = tel.span("turn-plan", "planner");
  h.clock.now = 5_000;
  child.end();
  h.pageDocument.visibilityState = "visible";
  h.pageDocument.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(h.batches.length, 0, "a visible page does not checkpoint");
  h.pageDocument.visibilityState = "hidden";
  h.pageDocument.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(h.batches.length, 1, "the tab going hidden checkpoints once, even with two watch calls");
  const hidden = h.batches[0]!;
  assert.equal(hidden.beacon, true, "lifecycle checkpoints prefer the beacon");
  const marker = hidden.events.find((event) => event.name === "turn-checkpoint")!;
  assert.equal(marker.metadata?.reason, "hidden");
  assert.deepEqual(marker.metadata?.open_spans, ["planner"]);
  const orphan = hidden.events.find((event) => event.name === "turn-plan")!;
  assert.equal(orphan.metadata?.parent_open, true, "an abandoned page still sends a child of an open span, flagged");
  h.clock.now = 6_000;
  tel.mark("teaching-request");
  h.pageWindow.dispatchEvent(new Event("pagehide"));
  await settle();
  assert.equal(h.batches.length, 2);
  assert.deepEqual(h.batches[1]!.events.map((event) => event.name), ["teaching-request", "turn-checkpoint"]);
  await tel.flush();
  const afterFlush = h.batches.length;
  h.pageWindow.dispatchEvent(new Event("pagehide"));
  h.pageDocument.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(h.batches.length, afterFlush, "the final flush unregisters the lifecycle listeners");

  // A page hidden before the trace id exists keeps the events for later.
  const early = harness();
  const pending = createTurnTelemetry({ env: early.env });
  pending.watchPageLifecycle();
  pending.mark("startup-ask");
  early.pageWindow.dispatchEvent(new Event("pagehide"));
  await settle();
  assert.equal(early.batches.length, 0);
  pending.setTrace("trace-late");
  await pending.flush();
  assert(early.names().includes("startup-ask"));

  // No page at all (server, tests): watching is a no-op.
  const headless = createTurnTelemetry({ env: { ...h.env, window: null, document: null } });
  headless.watchPageLifecycle();
}

async function verifyPriorityRetention() {
  const h = harness();
  const tel = createTurnTelemetry({ originPerf: 0, env: h.env });
  tel.setTrace("trace-pressure");
  for (let i = 0; i < MAX_TURN_TELEMETRY_EVENTS; i++) tel.mark("write-char-start", { index: i });
  for (const name of STARTUP_PRIORITY_EVENTS) {
    if (name === "planner" || name === "thinking") continue;
    tel.mark(name);
  }
  for (let i = 0; i < 40; i++) tel.mark("verified-scene-intro-queued");
  for (let i = 0; i < 500; i++) tel.mark("write-char-start", { index: i });
  const span = tel.span("scene-planner", "planner");
  span.end();
  await tel.flush();
  const sent = h.names();
  assert.equal(sent.length, MAX_TURN_TELEMETRY_EVENTS, "the buffer stays bounded");
  for (const name of STARTUP_PRIORITY_EVENTS) {
    if (name === "planner" || name === "thinking") continue;
    assert(sent.includes(name), `${name} survives a full buffer`);
  }
  assert.equal(sent.filter((name) => name === "verified-scene-intro-queued").length, 40, "decision events survive noise");
  assert(Number(h.batches.at(-1)!.traceMetadata?.telemetry_dropped_events) > 0, "drops are counted");

  // Startup events evict decision events, never the other way round.
  const d = harness();
  const decisions = createTurnTelemetry({ env: d.env });
  decisions.setTrace("trace-decisions");
  for (let i = 0; i < MAX_TURN_TELEMETRY_EVENTS; i++) decisions.mark("verified-scene-decision");
  decisions.mark("first-audible");
  decisions.mark("tts-first-byte");
  decisions.mark("write-char-start");
  await decisions.flush();
  const kept = d.names();
  assert(kept.includes("first-audible") && kept.includes("tts-first-byte"));
  assert(!kept.includes("write-char-start"));
  assert.equal(kept.length, MAX_TURN_TELEMETRY_EVENTS);

  // A checkpoint frees the buffer: what follows is not dropped.
  const c = harness();
  const roomy = createTurnTelemetry({ env: c.env });
  roomy.setTrace("trace-room");
  for (let i = 0; i < MAX_TURN_TELEMETRY_EVENTS; i++) roomy.mark("write-char-start");
  await roomy.checkpoint("first-audible");
  roomy.mark("write-char-start");
  await roomy.flush();
  assert.equal(c.names().length, MAX_TURN_TELEMETRY_EVENTS + 1);
}

async function verifyLargeBatchesSplit() {
  const h = harness();
  const tel = createTurnTelemetry({ env: h.env });
  tel.setTrace("trace-split");
  for (let i = 0; i < MAX_TURN_TELEMETRY_EVENTS; i++) tel.mark("write-char-start", { padding: "x".repeat(400), index: i });
  tel.meta({ turn_kind: "lesson" });
  await tel.flush();
  assert(h.batches.length > 1, "a body past the keepalive limit is split");
  assert.equal(h.names().length, MAX_TURN_TELEMETRY_EVENTS);
  assert.equal(h.batches.filter((batch) => batch.traceMetadata).length, 1, "metadata rides on one part only");
}

async function verifyFirstAudibleHelpers() {
  const h = harness();
  const tel = createTurnTelemetry({ originPerf: 0, env: h.env });
  tel.setTrace("trace-audible");
  h.clock.now = 41_000;
  recordTtsFirstByte(tel, { segmentIndex: 0, sinceRequestMs: 812.4, transport: "ws", prefetched: false });
  recordFirstAudible(tel, { segmentIndex: 0, transport: "provider", signal: "audio-context-scheduled", leadMs: 40 });
  h.clock.now = 45_000;
  recordFirstAudible(tel, { segmentIndex: 1, transport: "provider", signal: "html-audio-playing", leadMs: 0 });
  await settle();
  assert.equal(h.batches.length, 1, "first audible checkpoints the turn");
  const audible = h.batches[0]!.events.filter((event) => event.name === "first-audible");
  assert.equal(audible.length, 1, "first-audible is emitted once per turn");
  assert.equal(audible[0]!.metadata?.since_ask_ms, 41_040, "a scheduled source counts its lead");
  assert.equal(h.batches[0]!.traceMetadata?.first_audible_since_ask_ms, 41_040);
  const firstByte = h.batches[0]!.events.find((event) => event.name === "tts-first-byte")!;
  assert.deepEqual(firstByte.metadata, { segment_index: 0, since_request_ms: 812, transport: "ws", prefetched: false });
  // Replay refs and verify fakes carry partial objects; the helpers must not throw.
  recordFirstAudible({ mark() {} } as unknown as TurnTelemetry, { segmentIndex: 0, transport: "browser", signal: "speech-synthesis-start", leadMs: 0 });
  recordFirstAudible(null, { segmentIndex: 0, transport: "browser", signal: "speech-synthesis-start", leadMs: 0 });
  recordTtsFirstByte({} as TurnTelemetry, { segmentIndex: 0, sinceRequestMs: 1, transport: "http", prefetched: true });
}

async function verifyPageLoadClock() {
  const perf = {
    current: 900,
    now() { return this.current; },
    getEntriesByType: (type: string) => type === "navigation"
      ? [{ type: "navigate", responseStart: 120.4, domContentLoadedEventEnd: 640.6, loadEventEnd: 0 }]
      : [],
  };
  const timing = createPageLoadTiming(perf);
  timing.markBoardReady();
  perf.current = 2_000;
  timing.markBoardReady();
  const first = timing.claimFirstTurnMeta(15_250.7);
  assert.deepEqual(first, {
    page_nav_type: "navigate",
    page_response_start_ms: 120,
    page_dom_content_loaded_ms: 641,
    page_load_ms: null,
    page_board_ready_ms: 900,
    ask_since_nav_ms: 15_251,
  });
  assert.equal(timing.claimFirstTurnMeta(30_000), null, "page fields ride on the first turn only");
  assert.equal(createPageLoadTiming(null).claimFirstTurnMeta(1), null);
}

/** Actual useSegmentRunner: one first-audible per turn, one first byte per segment. */
async function verifyRunnerSeam() {
  const requireApp = createRequire(new URL("../../package.json", import.meta.url));
  const react = { useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
    useEffect: () => {}, useState: (value: unknown) => [value, () => {}] };
  const file = path.resolve(import.meta.dirname, "../../features/tutor-session/hooks/turn/useSegmentRunner.ts");
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return react;
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
  }, loaded, loaded.exports);
  const runSegmentHook = loaded.exports.useSegmentRunner as typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner").useSegmentRunner;

  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
    addEventListener() {}, removeEventListener() {},
  } });
  try {
    const h = harness();
    const tel = createTurnTelemetry({ originPerf: 0, env: h.env });
    tel.setTrace("trace-runner");
    h.clock.now = 30_000;
    let speakCalls = 0;
    const tts: TTSClient = {
      speak: async () => {},
      speakSegment: async (_text: string, options: SpeakSegmentOptions = {}) => {
        speakCalls++;
        // A recovery can re-deliver bytes; the mark stays once per segment.
        options.onFirstAudioByte?.({ transport: "ws", sinceRequestMs: 650, prefetched: speakCalls > 1 });
        options.onFirstAudioByte?.({ transport: "ws", sinceRequestMs: 990, prefetched: false });
        options.onStart?.();
        options.onEnd?.();
      },
      prewarm: async () => {}, playAudio: async () => {}, pause: () => {}, resume: () => {}, stop: () => {},
      get isPlaying() { return false; },
      getPlaybackPositionMs: () => 0,
      setPlaybackRate: () => {}, getPlaybackRate: () => 1,
      getLastPlaybackStart: () => ({ signal: "html-audio-playing", leadMs: 0 }),
    };
    const ref = <T,>(current: T) => ({ current });
    const params = {
      sessionId: "board-1", activeVerifiedDiagramRef: ref(null), cancelRef: ref(false), isPausedRef: ref(false),
      turnActiveRef: ref(true), turnGenerationRef: ref(1), turnTelemetryRef: ref(tel),
      turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), recordedSegmentsRef: ref([]), narrationSinceEpochRef: ref(""),
      currentTraceIdRef: ref("trace-runner"), narrationDensityRef: ref(0), drawChainRef: ref(Promise.resolve()),
      setCurrentSegmentText: () => {}, ensureTTSClient: () => tts,
      cancellableDelay: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5))),
      raceWithCancel: async <T,>(promise: Promise<T>) => promise,
      reserveTextCommandPlacements: async (command: unknown) => [command],
      executeCommandWithCancel: async () => {},
      applyTurnPhase: () => {},
      onSpeechStartupStatus: () => {},
    } as unknown as UseSegmentRunnerParams;
    const runner = runSegmentHook(params);
    const first: TutorSegment = { narration: STUDENT_TEXT, command: null };
    const second: TutorSegment = { narration: "Resolve the weight along the slope.", command: null };
    await runner.runSegment(first, 0, [first, second], 1);
    h.clock.now = 34_000;
    await runner.runSegment(second, 1, [first, second], 1);
    await settle();
    await tel.flush();
    const events = h.batches.flatMap((batch) => batch.events);
    const audible = events.filter((event) => event.name === "first-audible");
    assert.equal(audible.length, 1, "the runner emits first-audible once per turn");
    assert.deepEqual(
      { ...audible[0]!.metadata },
      { since_ask_ms: 30_000, segment_index: 0, transport: "provider", signal: "html-audio-playing", scheduled_lead_ms: 0 },
    );
    const firstBytes = events.filter((event) => event.name === "tts-first-byte");
    assert.deepEqual(firstBytes.map((event) => event.metadata?.segment_index), [0, 1], "one first byte per segment");
    assert.equal(firstBytes[0]!.metadata?.since_request_ms, 650);
    assert(h.batches.length >= 2, "first audible checkpointed before the final flush");
    for (const batch of h.batches) {
      const body = JSON.stringify(batch);
      assert(!body.includes(STUDENT_TEXT) && !body.includes("Resolve the weight"), "no narration or question text in telemetry");
    }
  } finally {
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

/** Actual StreamingSpeechClient over HTTP with native audio: first byte and the playing signal. */
async function verifyStreamingClientSeam() {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let now = 10_000;
  class NativeAudio {
    static clips: NativeAudio[] = [];
    playbackRate = 1; preservesPitch = true; muted = false; volume = 1; currentTime = 0;
    onplaying: (() => void) | null = null; onended: (() => void) | null = null; onerror = null;
    constructor(public src = "") { if (src.startsWith("blob:")) NativeAudio.clips.push(this); }
    async play() { if (this.src.startsWith("blob:")) { now += 30; this.onplaying?.(); } }
    pause() {} removeAttribute() { this.src = ""; } load() {}
  }
  const savedAuth = process.env.NEXT_PUBLIC_AUTH_DISABLED;
  delete process.env.NEXT_PUBLIC_AUTH_DISABLED;
  replace("performance", { now: () => now });
  replace("window", { setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms), clearTimeout: (id: number) => clearTimeout(id),
    addEventListener() {}, removeEventListener() {} });
  replace("location", { protocol: "http:", host: "localhost:3000", origin: "http://localhost:3000" });
  replace("Audio", NativeAudio);
  replace("WebSocket", class { static OPEN = 1; constructor() { throw new Error("no sockets in this verify"); } });
  replace("fetch", async (url: unknown) => {
    // A missing ticket keeps the client off the socket, so this stays offline.
    if (String(url).includes("ws-ticket")) return Response.json({});
    assert(String(url).includes("/api/tts/stream"), "only the offline TTS stub may be called");
    now += 700;
    return new Response(`${JSON.stringify({ audio_base64: Buffer.from([73, 68, 51, 1]).toString("base64") })}\n`);
  });
  try {
    const client = new StreamingSpeechClient();
    const firstBytes: unknown[] = [];
    let startSignal: unknown = null;
    const spoken = client.speakSegment("Gravity pulls the block down the slope.", {
      onFirstAudioByte: (info) => firstBytes.push(info),
      onStart: () => { startSignal = client.getLastPlaybackStart(); },
    });
    for (let i = 0; i < 200 && NativeAudio.clips.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(NativeAudio.clips.length, 1);
    await settle();
    NativeAudio.clips[0]!.onended?.();
    await spoken;
    assert.deepEqual(firstBytes, [{ transport: "http", sinceRequestMs: 700, prefetched: false }]);
    assert.deepEqual(startSignal, { signal: "html-audio-playing", leadMs: 0 }, "native playback reports the playing signal");
    client.stop();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    if (savedAuth !== undefined) process.env.NEXT_PUBLIC_AUTH_DISABLED = savedAuth;
  }
}

function observation(name: string, startMs: number, endMs = startMs, metadata: Record<string, unknown> = {}) {
  return {
    id: `obs-${name}-${startMs}`,
    type: "SPAN",
    name,
    startTime: new Date(WALL_AT_ZERO + startMs).toISOString(),
    endTime: new Date(WALL_AT_ZERO + endMs).toISOString(),
    metadata: { ...metadata, client_reported: true },
  };
}

function verifyReportParsing() {
  // Ask at 0; telemetry created 2.9 s later after commit, billing and the epoch.
  const trace = {
    id: "lf-trace-1",
    observations: [
      observation("startup-ask", 2_900, 2_900, { pre_telemetry_ms: 2_900, board_commit_ms: 300, begin_turn_ms: 2_100, board_epoch_ms: 400, queued_for_board_ms: 0 }),
      observation("thinking", 2_900, 47_000),
      observation("websocket-connect", 2_901, 3_300),
      observation("planner", 2_905, 2_905 + STAGE_CAPS_MS.planner!),
      observation("turn-plan", 2_910, 2_910 + STAGE_CAPS_MS["turn-plan"]! - 100),
      observation("problem-ir", 23_000, 30_000, { outcome: "deadline" }),
      observation("scene-planner", 30_000, 41_000),
      observation("teaching-request", 63_000),
      observation("teaching-hedge-start", 66_000),
      observation("teaching-first-token", 66_500),
      observation("teaching-hedge-winner", 66_600, 66_600, { winner: "hedge" }),
      observation("teaching-first-step", 67_200),
      observation("tts-first-byte", 68_000, 68_000, { segment_index: 0, since_request_ms: 640, transport: "ws" }),
      observation("tts-first-byte", 72_000, 72_000, { segment_index: 1, since_request_ms: 300, transport: "ws" }),
      observation("tts-browser-recovery", 69_000),
      observation("first-audible", 68_300, 68_300, { since_ask_ms: 68_340, signal: "audio-context-scheduled" }),
      observation("chat-llm", 63_100, 66_000),
    ],
  };
  const turn = parseLangfuseTrace(trace)!;
  assert.equal(turn.origin, "startup-ask");
  assert.equal(turn.askToFirstAudibleMs, 68_340);
  const stage = (name: string) => turn.stages.find((row) => row.name === name)!;
  assert.equal(stage("begin-turn").durationMs, 2_100);
  assert.equal(stage("thinking").startMs, 2_900);
  assert.equal(stage("planner").hitCap, true, "a stage at its deadline hit the cap");
  assert.equal(stage("turn-plan").hitCap, true, "within the jitter slack still counts");
  assert.equal(stage("problem-ir").hitCap, true, "a deadline outcome counts even under the cap");
  assert.equal(stage("scene-planner").hitCap, false);
  assert.equal(stage("teaching-first-token").startMs, 66_500);
  assert.equal(stage("tts-first-byte").durationMs, 640, "the first segment's first byte is reported");
  assert.deepEqual(turn.retries, ["teaching-hedge-start x1", "teaching-hedge-winner x1 (hedge)", "tts-browser-recovery x1"]);
  assert.equal(parseLangfuseTrace({ id: "tts-only", observations: [observation("tts-segment", 0, 10)] }), null);
  const legacy = parseLangfuseTrace({ id: "legacy", observations: [observation("planner", 5_000, 9_000), observation("first-audible", 12_000)] })!;
  assert.equal(legacy.origin, "earliest-event");
  assert.equal(legacy.askToFirstAudibleMs, null, "without startup-ask there is no Ask origin to measure from");

  const labRuns = [
    { probeId: "physics|3|impulse|hard", question: STUDENT_TEXT, timings: { planMs: 30_000, teachMs: 40_000, totalMs: 70_000 } },
    { probeId: "physics|4|work|hard", timings: { planMs: 50_000, teachMs: 20_000, totalMs: 70_500,
      stages: { "turn-plan": { ms: 20_000, capped: true }, "problem-ir": 9_000, "first-audible": { startMs: 61_000 } } } },
    { probeId: "physics|5|shm|easy", timings: { planMs: 10_000, teachMs: 15_000, totalMs: 25_000,
      stages: [{ name: "turn-plan", durationMs: 8_000 }, { name: "first-audible", startMs: 21_000 }] } },
  ];
  const labTurns = labRuns.map((run) => parseLabRun(run)!);
  assert.equal(labTurns[0]!.askToFirstAudibleMs, null);
  assert.equal(labTurns[1]!.askToFirstAudibleMs, 61_000);
  assert.equal(labTurns[1]!.stages.find((row) => row.name === "turn-plan")!.hitCap, true);
  assert.equal(labTurns[2]!.stages.find((row) => row.name === "turn-plan")!.durationMs, 8_000);
  assert.equal(parseLabRun({ probeId: "broken" }), null);
  const summary = summarizeTurns(labTurns);
  assert.equal(summary.askToFirstAudible.count, 2);
  assert.equal(summary.askToFirstAudible.p50, 21_000);
  assert.equal(summary.askToFirstAudible.p90, 61_000);
  const plan = summary.stages.find((row) => row.name === "plan")!;
  assert.deepEqual([plan.count, plan.p50, plan.p90], [3, 30_000, 50_000]);
  assert.equal(summary.stages.find((row) => row.name === "turn-plan")!.capHits, 1);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5], 90), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  const printed = `${formatTurn(turn)}\n${labTurns.map(formatTurn).join("\n")}\n${formatSummary(labTurns)}`;
  assert(printed.includes("ask to first audible: 68340 ms"));
  assert(printed.includes("p90"));
  assert(!printed.includes(STUDENT_TEXT), "the report never prints question text");
  assert.deepEqual(parseArgs(["a", "b", "--limit", "5"]), { traceIds: ["a", "b"], since: null, lab: null, limit: 5 });
  assert.equal(parseArgs(["--since", "2026-10-01T00:00:00Z"]).since, "2026-10-01T00:00:00Z");
  assert.equal(parseArgs(["--lab", "round-01"]).lab, "round-01");
  assert.throws(() => parseArgs(["--since", "yesterday"]));
}

/** Startup payloads carry durations and ids, never question text. */
function verifyHandlerPrivacy() {
  const source = readFileSync(path.resolve(import.meta.dirname, "../../features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
  const start = source.indexOf('tel.mark("startup-ask", {');
  assert(start > 0, "the handler emits startup-ask");
  const end = source.indexOf("});", start);
  assert(end > start, "startup-ask payload end anchor");
  const payload = source.slice(start, end);
  assert(!/question|narration|doubt\.title|lessonQuestion/.test(payload.replace(/turn_kind: doubt \? "doubt" : resume \? "resume" : "lesson",/, "")),
    "startup-ask carries no question text");
  assert(/createTurnTelemetry\(\{ originPerf: askOrigin \}\)/.test(source), "telemetry is created with the Ask origin");
  const askLine = source.indexOf("const askStartedAt = performance.now();");
  const handlerStart = source.indexOf("async (rawQuestion: string, options?: HandleQuestionOptions) => {");
  assert(handlerStart > 0 && askLine > handlerStart, "the Ask origin is taken inside the handler");
  assert(askLine < source.indexOf("normalizeTutorQuestion(rawQuestion)", handlerStart), "and before anything else");
  assert(source.indexOf("tel.watchPageLifecycle();") > source.indexOf("tel.setTrace(turnTraceId"), "lifecycle checkpoints after the trace id");
}

async function main() {
  await verifyOriginAtAsk();
  await verifyCheckpointOnce();
  await verifyPageLifecycleCheckpoint();
  await verifyPriorityRetention();
  await verifyLargeBatchesSplit();
  await verifyFirstAudibleHelpers();
  await verifyPageLoadClock();
  await verifyRunnerSeam();
  await verifyStreamingClientSeam();
  verifyReportParsing();
  verifyHandlerPrivacy();
  console.log("verified Ask origin, checkpoint once, pagehide and hidden checkpoints, startup priority under pressure, split bodies, first audible once, page load clock, runner and client seams, report parsing, and no question text");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
