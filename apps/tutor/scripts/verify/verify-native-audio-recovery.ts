/** Production speech + runner/save consumers, with offline native media/transport ports. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import { parseStoredSegmentCommands, type TutorSegment } from "@heytutor/drawing";
import type { ExecuteCommandOptions } from "../../features/tutor-session/hooks/turn/types";

const app = fileURLToPath(new URL("../../", import.meta.url));
const script = fileURLToPath(import.meta.url);
const requireApp = createRequire(path.join(app, "package.json"));
const runnerPath = path.join(app, "features/tutor-session/hooks/turn/useSegmentRunner.ts");
const savePath = path.join(app, "features/tutor-session/lib/turn/liveTurnSave.ts");
const clientPath = fileURLToPath(new URL("../../../../packages/tutor-core/src/tts/streamingSpeechClient.ts", import.meta.url));
const cases = ["recover", "healthy", "start", "capture", "ws-capture", "stall-all", "partial", "pause", "cancel", "capture-cancel", "successor", "runner-positive", "runner-zero", "runner-intro", "runner-stop", "runner-stale", "runner-healthy", "runner-slow", "capture-cancel-http", "healthy-pause", "prefetch-cancel", "ws-prefetch-cancel", "ended-zero", "runner-error", "cancel-retry", "ws-no-final", "ws-no-final-healthy", "runner-ws-positive", "runner-ws-healthy", "ws-no-final-webaudio", "ws-no-final-webaudio-healthy", "gesture-delay", "gesture-zero-repeated"];
const noop = () => {};
const ref = <T,>(current: T) => ({ current });

/** Synthetic audible PCM: no original student recording is committed. */
function generatedWav(): Uint8Array {
  const bytes = Buffer.alloc(44 + 101_760 * 2); // 4.24 seconds, mono 24 kHz PCM16.
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24); bytes.writeUInt32LE(48_000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < 101_760; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 24_000) * 6_000), 44 + i * 2);
  return new Uint8Array(bytes);
}

async function main() {
  const requestedCase = process.env.NATIVE_AUDIO_CASE;
  if (!requestedCase) {
    for (const name of cases) {
      const child = spawnSync(process.execPath, [...process.execArgv, script], {
        env: { ...process.env, NATIVE_AUDIO_CASE: name }, encoding: "utf8", timeout: 15_000,
      });
      assert.equal(child.status, 0, `${name}: ${child.stdout}${child.stderr}`);
      console.log(`native audio ${name}: PASS`);
    }
    console.log(`verify-native-audio-recovery: ${cases.length} actual consumer groups; no providers`);
    return;
  }
  const selected: string = requestedCase;
  assert(cases.includes(selected), "unknown gate case");
  const { StreamingSpeechClient } = await import(process.env.NATIVE_AUDIO_CLIENT_SOURCE ?? clientPath) as typeof import("../../../../packages/tutor-core/src/tts/streamingSpeechClient");
  const { LiveTurnSaveRegistry } = await import(process.env.NATIVE_AUDIO_SAVE_SOURCE ?? savePath) as typeof import("../../features/tutor-session/lib/turn/liveTurnSave");
  // Load real ink dependencies before exposing the controlled browser port.
  requireApp(path.join(app, "features/tutor-session/lib/turn/segmentInk.ts"));
  const wav = process.env.NATIVE_AUDIO_FIXTURE ? new Uint8Array(readFileSync(process.env.NATIVE_AUDIO_FIXTURE)) : generatedWav();
  const digest = createHash("sha256").update(wav).digest("hex");
  const durationSec = (wav.length - 44) / 48_000;
  assert.equal(Buffer.from(wav).toString("ascii", 0, 4), "RIFF");
  assert(wav.slice(44).some(value => value !== 0), "fixture contains non-silent PCM");
  const narration = "Force equals mass times acceleration.";
  let now = 1_000, sequence = 0, fetches = 0, decoded = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const schedule = (run: () => void, ms = 0): number => {
    const id = ++sequence; timers.set(id, { at: now + ms, run }); return id;
  };
  const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };
  const advance = async (ms: number) => {
    const until = now + ms;
    await flush();
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].run(); await flush();
    }
    now = until; await flush();
  };
  const gestureCase = selected.startsWith("gesture-");
  let gesturePermitted = !gestureCase;
  const healthy = ["healthy", "healthy-pause", "runner-healthy", "runner-slow", "ws-no-final-healthy", "ws-no-final-webaudio-healthy", "runner-ws-healthy", "gesture-delay"].includes(selected);
  const allStalled = selected === "stall-all" || selected.startsWith("runner-") && !healthy;
  const positivePlateau = ["runner-positive", "runner-ws-positive", "runner-intro", "runner-stop", "runner-stale"].includes(selected);
  class NativeAudio {
    static instances: NativeAudio[] = [];
    playbackRate = 1; preservesPitch = false; muted = false; volume = 1; paused = true;
    onplaying: (() => void) | null = null; onended: (() => void) | null = null; onerror: (() => void) | null = null;
    started: number | null = null; playedOffsets: number[] = []; seekOffset = 0; endTimer: number | null = null;
    constructor(public src: string) { NativeAudio.instances.push(this); }
    get currentTime(): number {
      if (this.started === null || this.paused) return this.seekOffset;
      if (selected === "gesture-zero-repeated") return this.seekOffset;
      if (selected === "gesture-delay") return Math.min(this.seekOffset + Math.max(now - this.started - 300, 0) / 1_000 * this.playbackRate, durationSec);
      if (allStalled) return Math.max(this.seekOffset, positivePlateau ? 0.2 : 0);
      if (!healthy && selected !== "partial" && NativeAudio.instances[0] === this) return this.seekOffset;
      const value = this.seekOffset + (now - this.started) / 1_000 * this.playbackRate;
      return Math.min(value, selected === "partial" && NativeAudio.instances[0] === this ? 0.2 : durationSec);
    }
    set currentTime(value: number) { this.seekOffset = value; this.started = now; }
    async play() {
      if (!gesturePermitted) throw new DOMException("offline native gesture required", "NotAllowedError");
      this.playedOffsets.push(this.seekOffset); this.paused = false; this.started = now; this.onplaying?.();
      if (selected === "runner-error") schedule(() => this.onerror?.(), 50);
      if (selected === "ended-zero" && NativeAudio.instances[0] === this) schedule(() => this.onended?.(), 50);
      if (!allStalled && (healthy || NativeAudio.instances[0] !== this)) {
        if (selected !== "gesture-zero-repeated") this.endTimer = schedule(() => { this.seekOffset = durationSec; this.paused = true; this.onended?.(); }, (durationSec - this.seekOffset) * 1_000 / this.playbackRate + (selected === "gesture-delay" ? 300 : 0));
      }
    }
    pause() {
      this.seekOffset = this.currentTime; this.paused = true;
      if (this.endTimer !== null) timers.delete(this.endTimer);
    }
    removeAttribute(name: string) { if (name === "src") this.src = ""; }
    load() {}
  }
  class RunningContext {
    state = "running"; sampleRate = 24_000; destination = {}; started = now;
    get currentTime() { return (now - this.started) / 1_000; }
    async resume() { this.state = "running"; } async suspend() { this.state = "suspended"; } async close() { this.state = "closed"; }
    async decodeAudioData(bytes: ArrayBuffer) {
      assert.equal(createHash("sha256").update(new Uint8Array(bytes)).digest("hex"), digest); decoded++;
      return { duration: durationSec, sampleRate: 24_000, numberOfChannels: 1, length: 101_760, getChannelData: () => new Float32Array(101_760).fill(0.1) };
    }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createBuffer(channels: number, length: number, sampleRate: number) { return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: () => new Float32Array(length) }; }
    createBufferSource() {
      return { buffer: null as { duration: number } | null, loop: false, playbackRate: { value: 1 }, onended: null as (() => void) | null,
        connect() {}, disconnect() {}, start() { if (this.buffer && !this.loop) schedule(() => this.onended?.(), this.buffer.duration * 1_000 / this.playbackRate.value); }, stop() { this.onended?.(); } };
    }
  }
  replace("performance", { now: () => now }); replace("setTimeout", schedule); replace("clearTimeout", (id: number) => timers.delete(id));
  replace("window", globalThis); replace("Audio", selected.includes("webaudio") ? undefined : NativeAudio); replace("AudioContext", RunningContext);
  replace("location", { protocol: "http:", host: "offline.invalid", origin: "http://offline.invalid" });
  const chunk = { audio_base64: Buffer.from(wav).toString("base64"), alignment: {
    character_start_times_seconds: [...narration].map((_, i) => i * durationSec / narration.length),
    character_end_times_seconds: [...narration].map((_, i) => (i + 1) * durationSec / narration.length),
  } };
  replace("fetch", async (input: unknown) => {
    if (String(input).endsWith("/api/tts/ws-ticket")) return ["ws-capture", "capture-cancel", "ws-prefetch-cancel", "ws-no-final", "ws-no-final-healthy", "runner-ws-positive", "runner-ws-healthy", "ws-no-final-webaudio", "ws-no-final-webaudio-healthy"].includes(selected) ? Response.json({ ticket: "offline" }) : new Response(null, { status: 401 });
    assert(String(input).endsWith("/api/tts/stream"), "external/provider dispatch forbidden"); fetches++;
    return selected.startsWith("ws-no-final") && !selected.endsWith("healthy") ? new Response(null, { status: 503 }) : new Response(JSON.stringify(chunk) + "\n");
  });
  class OfflineSocket {
    static OPEN = 1; static CONNECTING = 0; readyState = 0;
    onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
    listeners = new Map<string, Set<(event: { data: string }) => void>>(); segment = 0;
    constructor(url: string) { assert(url.startsWith("ws"), "offline socket URL"); schedule(() => { this.readyState = 1; this.onopen?.(); this.emit({ type: "ready" }); }); }
    addEventListener(type: string, fn: (event: { data: string }) => void) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set); }
    removeEventListener(type: string, fn: (event: { data: string }) => void) { this.listeners.get(type)?.delete(fn); }
    emit(message: object) { for (const fn of this.listeners.get("message") ?? []) fn({ data: JSON.stringify(message) }); }
    send(raw: string) {
      const message = JSON.parse(raw); if (message.segment_index) this.segment = message.segment_index;
      if (message.flush) {
        const final = { ...chunk, context_id: `segment_${this.segment}`, isFinal: !selected.startsWith("ws-no-final") };
        schedule(() => this.emit(final));
        if (selected === "ws-capture") schedule(() => this.emit(final), 50);
      }
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  replace("WebSocket", OfflineSocket);
  const objectUrls = new Map<string, Blob>(), revokedUrls = new Set<string>();
  const createObjectURL = URL.createObjectURL, revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = blob => { assert(blob instanceof Blob, "native audio uses a complete Blob"); const id = `blob:offline-${objectUrls.size}`; objectUrls.set(id, blob); return id; };
  URL.revokeObjectURL = url => { revokedUrls.add(url); };
  const client = new StreamingSpeechClient(); client.setPlaybackRate(selected === "runner-slow" ? 0.5 : 1.25);
  try {
    if (gestureCase) {
      let starts = 0, ends = 0, blocked: string | null = null;
      let outcome: "pending" | "resolved" | "rejected" = "pending";
      const job = client.speakSegment(narration, {
        onStart: () => starts++, onEnd: () => ends++,
        onPlaybackBlocked: next => { blocked = next?.reason ?? null; },
      });
      void job.then(() => { outcome = "resolved"; }, () => { outcome = "rejected"; });
      await advance(100);
      assert.equal(NativeAudio.instances.length, 1);
      const clip = NativeAudio.instances[0]!;
      assert.equal(blocked, "not-allowed", "the actual client retains the blocked native clip for its owner");
      await advance(2_500);
      assert.equal(NativeAudio.instances.length, 1, "waiting for the gesture must not consume native output recovery");
      assert.equal(outcome, "pending"); assert.equal(starts, 0);
      gesturePermitted = true;
      client.resume(); await flush();
      assert.equal(clip.currentTime, 0);
      assert.equal(starts, 0, "a delayed tap's zero-clock playing event cannot release audible start");
      await advance(150);
      assert.equal(NativeAudio.instances.length, 1,
        "the accepted native play attempt gets its progress allowance after a delayed gesture");
      assert.equal(outcome, "pending"); assert.equal(starts, 0);
      if (selected === "gesture-delay") {
        await advance(300);
        assert(clip.currentTime > 0, "genuine clock progress arrives after the zero-clock playing signal");
        assert.equal(starts, 1); assert.equal(blocked, null);
        await advance(5_000);
        assert.equal(outcome, "resolved"); assert.equal(ends, 1);
        assert.equal(NativeAudio.instances.length, 1, "delayed native progress keeps the original clip without spurious recovery");
      } else {
        for (let i = 0; i < 32; i++) {
          NativeAudio.instances.at(-1)!.onplaying?.();
          await advance(100);
        }
        assert.equal(outcome, "rejected", "repeated zero-clock playing events cannot extend the stall deadline");
        assert.equal(starts, 0); assert.equal(ends, 0);
        assert.equal(NativeAudio.instances.length, 2, "two dead native clocks consume only one bounded recovery");
      }
      assert.equal(fetches, 1, "gesture retry and local output recovery do not synthesize again");
      console.log(`native audio ${selected}: GREEN, no providers`);
      return;
    }
    if (selected.startsWith("runner-")) {
      let mint = 0, captured = 0;
      const registry = new LiveTurnSaveRegistry({ transport: { checkpoint: async () => { throw new Error("offline checkpoint forbidden"); }, close: async () => { throw new Error("offline close forbidden"); } },
        now: () => now, isOnline: () => false, mintId: () => `offline-${++mint}`, setTimer: schedule, clearTimer: id => timers.delete(id as number) });
      const originalSpeak = client.speakSegment.bind(client);
      client.speakSegment = (text, options = {}) => originalSpeak(text, { ...options, onAudioCaptured: audio => { captured++; options.onAudioCaptured?.(audio); } });
      class BrowserVoice {
        setPlaybackRate() {} stop() {} pause() {} resume() {}
        async speakSegment() { throw new Error("offline browser speech unavailable"); }
      }
      const source = readFileSync(process.env.NATIVE_AUDIO_RUNNER_SOURCE ?? runnerPath, "utf8");
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      const mod = { exports: {} as Record<string, unknown> };
      new Function("require", "module", "exports", compiled)((specifier: string) => {
        if (specifier === "react") return { useRef: ref, useCallback: <T,>(fn: T) => fn };
        if (specifier === "@heytutor/tutor-core") return { ...core, tutorDebug: noop, SpeechSynthesisTTSClient: BrowserVoice };
        if (specifier.endsWith("/liveTurnSave")) return { liveTurnSave: () => registry };
        return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(runnerPath), specifier) : specifier);
      }, mod, mod.exports);
      const hooks = mod.exports as unknown as typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner");
      const drawn: string[] = [];
      const params = {
        sessionId: "offline-native-audio", ensureTTSClient: () => client, activeVerifiedDiagramRef: ref(null),
        cancelRef: ref(false), isPausedRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1),
        recordedSegmentsRef: ref<import("../../features/tutor-session/hooks/turn/types").UseTurnLifecycleParams["recordedSegmentsRef"]["current"]>([]),
        narrationSinceEpochRef: ref(""), currentTraceIdRef: ref(null), narrationDensityRef: ref(0), drawChainRef: ref(Promise.resolve()),
        turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), turnTelemetryRef: ref({ mark: noop, span: () => ({ end: noop }) }),
        applyTurnPhase: noop, setCurrentSegmentText: noop, cancellableDelay: (ms: number) => new Promise<void>(resolve => schedule(resolve, ms)),
        raceWithCancel: async <T,>(promise: Promise<T>) => promise,
        reserveTextCommandPlacements: async (command: NonNullable<TutorSegment["command"]>) => [command],
        executeCommandWithCancel: async (command: NonNullable<TutorSegment["command"]>, options: ExecuteCommandOptions) => {
          if (options.isCancelled?.()) return; drawn.push(command.text ?? command.type); options.onInkStarted?.();
        },
      };
      const handle = registry.begin({ owner: params.cancelRef, generation: 1, boardId: params.sessionId, traceId: null, kind: "lesson", question: "Explain force.", preview: "Explain force.", speedMultiplier: client.getPlaybackRate(), continuesBoard: false });
      const runner = hooks.useSegmentRunner(params as unknown as Parameters<typeof hooks.useSegmentRunner>[0]);
      const segment: TutorSegment = { narration, command: { type: "WRITE", text: "F = ma", params: [90, 142], charPosition: 0, narrationBefore: narration },
        ...(selected === "runner-intro" ? { verifiedDiagramIntro: true } : {}) };
      let outcome: Error | null | undefined;
      void runner.runSegment(segment, 0, [segment], 1).then(() => { outcome = null; }, error => { outcome = error; });
      await advance(100);
      assert.equal(captured, 1, "complete bytes captured once before stalled native playback");
      if (["runner-stop", "runner-stale"].includes(selected)) {
        if (selected === "runner-stop") params.cancelRef.current = true;
        else params.turnGenerationRef.current = 2;
        handle.close(); client.stop();
      }
      await advance(20_000);
      assert.notEqual(outcome, undefined, "actual runner finishes boundedly");
      assert.equal(fetches, selected.startsWith("runner-ws") ? 0 : 1, "native recovery consumes existing bytes without another synthesis");
      const allRows = handle.submittedRows();
      const rows = allRows.filter(row => row.narration === narration);
      assert(allRows.filter(row => row.narration !== narration).every(row => !row.audioBytes), "page setup has no speech bytes");
      if (["runner-stop", "runner-stale"].includes(selected)) {
        assert.equal(outcome, null, "cancelled/stale failure stays quiet");
        assert(rows.every(row => !row.audioBytes), "intentional cancellation cannot publish failed-playback audio");
        assert.equal(NativeAudio.instances.length, 1, "cancel/stale cannot create late recovery output");
      } else if (selected === "runner-intro") {
        assert(outcome instanceof Error, "failed intro reports terminal voice failure");
        assert.equal(rows.length, 0, "uncommitted figure intro cannot publish speculative bytes or ink");
        assert.equal(params.recordedSegmentsRef.current.length, 0);
      } else {
        assert.equal(rows.length, 1, "one claimed narration row retained");
        const row = rows[0]!;
        assert(row.audioBytes && row.audioBytes.length === wav.length, "save consumer retains the exact generated clip");
        assert.deepEqual(row.audioBytes, wav, "retained content is byte exact");
        assert.equal(row.durationMs, 4_240, "retained clip keeps natural duration independently of speed");
        assert(row.timings && row.timings.totalDuration === durationSec, "alignment survives failure retention");
        if (healthy) {
          assert.equal(outcome, null, "healthy playback completes at supported slow/normal rates");
          assert.equal(params.recordedSegmentsRef.current.length, 1);
          assert.equal(NativeAudio.instances.length, 1);
        } else {
          assert(outcome instanceof Error, "unrecovered native output remains a failed spoken beat");
          assert.equal(params.recordedSegmentsRef.current.length, 0, "retained bytes never claim speech success");
          assert.equal(NativeAudio.instances.length, selected === "runner-error" ? 1 : 2, "terminal errors fail; only stalled clocks get one retry");
        }
        if (["runner-zero", "runner-error"].includes(selected)) { assert.equal(row.command, null, "unheard/unshown output cannot invent ink"); assert.equal(drawn.length, 0); }
        else assert(parseStoredSegmentCommands(row.command).some(command => command.text === "F = ma"), "already shown work survives with its retained clip");
      }
      console.log(`native audio ${selected}: GREEN, no providers`);
      return;
    }
    let starts = 0, ends = 0, captureCount = 0, captured: Uint8Array | undefined;
    let settled = "pending", playbackOwner = 1;
    if (["prefetch-cancel", "ws-prefetch-cancel"].includes(selected)) {
      if (selected === "ws-prefetch-cancel") { const warm = client.prewarm(); await advance(100); await warm; }
      client.prefetchSegment(narration); await advance(100);
      assert.equal(NativeAudio.instances.length, 0, "unclaimed prefetch cannot play");
    }
    const captureCase = ["capture", "ws-capture", "capture-cancel", "capture-cancel-http", "prefetch-cancel", "ws-prefetch-cancel", "ws-no-final", "ws-no-final-healthy", "ws-no-final-webaudio", "ws-no-final-webaudio-healthy"].includes(selected);
    const job = captureCase ? client.speakSegment(narration, { onStart: () => starts++, onEnd: () => ends++, onAudioCaptured: audio => {
      captureCount++; captured = audio.bytes; if (["capture-cancel", "capture-cancel-http", "prefetch-cancel", "ws-prefetch-cancel"].includes(selected)) client.stop();
    } }) : client.playAudio(wav, { onStart: () => starts++ });
    void job.then(() => { if (playbackOwner === 1) settled = "resolved"; }, () => { if (playbackOwner === 1) settled = "rejected"; });
    await advance(100);
    if (selected.startsWith("ws-no-final")) {
      assert.equal(NativeAudio.instances.length, 0, "nonfinal WS bytes cannot play");
      assert.equal(captureCount, 0, "nonfinal bytes are not a complete durable clip");
      assert.equal(decoded, 0, "production WS ingest holds undecoded bytes until final");
      assert.equal(ends, 0, "nonfinal WS cannot announce completion");
      await advance(25_000);
      if (!selected.endsWith("healthy")) {
        assert.equal(settled, "rejected", "missing final + failed recovery rejects visibly, never silently succeeds");
        assert.equal(ends, 0); assert.equal(starts, 0); assert.equal(captureCount, 0);
      } else {
        assert.equal(settled, "resolved", "legitimate complete HTTP replacement can recover missing WS final");
        assert.equal(starts, 1); assert.equal(ends, 1); assert.equal(captureCount, 1); assert.deepEqual(captured, wav);
      }
      assert(fetches > 0, "existing HTTP recovery policy actually ran");
      return;
    }
    if (["capture-cancel", "capture-cancel-http", "prefetch-cancel", "ws-prefetch-cancel"].includes(selected)) {
      assert.equal(captureCount, 1); assert.deepEqual(captured, wav);
      assert.equal(NativeAudio.instances.length, 0, "capture callback cancellation blocks late native output"); assert.equal(starts, 0); return;
    }
    assert.equal(NativeAudio.instances.length, selected === "ended-zero" ? 2 : 1, "complete bytes reach native output; a zero-clock end immediately retries");
    if (selected === "start") { assert.equal(starts, 0, "playing/play resolution at zero cannot release audible-start gate"); return; }
    if (captureCase) {
      client.abandonSpeaking(); await flush(); assert.equal(captureCount, 1, "owned complete capture occurs exactly once before playback ends");
      assert.deepEqual(captured, wav); assert.equal(ends, 0, "failed/abandoned output cannot claim narration completion"); return;
    }
    if (selected === "cancel") { client.stop(); await advance(5_000); assert.equal(NativeAudio.instances.length, 1); assert.equal(starts, 0); return; }
    if (["pause", "healthy-pause"].includes(selected)) {
      await advance(1_000); client.pause(); await advance(10_000);
      assert.equal(NativeAudio.instances.length, 1, "intentional pause does not trigger recovery"); client.resume();
    }
    if (selected === "cancel-retry") {
      await advance(1_600);
      assert.equal(NativeAudio.instances.length, 2, "one recovery was already playing");
      const lateEnd = NativeAudio.instances[1]!.onended;
      client.stop(); lateEnd?.(); await advance(5_000);
      assert.equal(settled, "rejected", "cancelled recovery cannot report completion");
      assert.equal(NativeAudio.instances.length, 2); assert.equal(starts, 1); return;
    }
    if (selected === "successor") {
      const lateStart = NativeAudio.instances[0]!.onplaying;
      const lateEnd = NativeAudio.instances[0]!.onended;
      client.stop(); playbackOwner = 2; settled = "pending";
      void client.playAudio(wav, { onStart: () => starts++ }).then(() => { settled = "resolved"; }, () => { settled = "rejected"; }); await flush();
      lateStart?.(); lateEnd?.();
    }
    await advance(3_000);
    if (selected === "stall-all") {
      assert.equal(settled, "rejected", "two dead outputs fail boundedly"); assert.equal(NativeAudio.instances.length, 2, "native retry cannot loop"); assert.equal(starts, 0); assert.equal(fetches, 0); return;
    }
    assert(NativeAudio.instances.some(audio => audio.currentTime > 0.05), "retained-byte recovery reaches actual native clock progress");
    assert.equal(fetches, 0, "native replay cannot regenerate paid speech");
    await advance(5_000); assert.equal(settled, "resolved", "retained playback reaches native end"); assert.equal(starts, 1, "one owned advancing start");
    if (selected === "healthy-pause") assert.equal(NativeAudio.instances.length, 1, "pause keeps the healthy output rather than spuriously replacing it");
    if (selected === "partial") assert(NativeAudio.instances[1]!.playedOffsets[0]! >= 0.2, "partial recovery resumes after heard media");
    console.log(`native audio ${selected}: GREEN; decoded=${decoded}; no providers`);
  } finally {
    client.stop(); await flush();
    URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL;
    for (const blob of objectUrls.values()) assert.equal(createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex"), digest, "every native attempt reuses exact local bytes");
    assert.equal(revokedUrls.size, objectUrls.size, "every owned output releases its Blob URL");
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
