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
const cases = ["recover", "healthy", "start", "capture", "ws-capture", "stall-all", "partial", "pause", "cancel", "capture-cancel", "successor", "runner-positive", "runner-zero", "runner-intro", "runner-stop", "runner-stale", "runner-healthy", "runner-slow", "capture-cancel-http", "healthy-pause", "prefetch-cancel", "ws-prefetch-cancel", "ended-zero", "runner-error", "cancel-retry", "ws-no-final", "ws-no-final-healthy", "runner-ws-positive", "runner-ws-healthy", "ws-no-final-webaudio", "ws-no-final-webaudio-healthy", "gesture-delay", "gesture-zero-repeated", "relay-final-skip", "relay-final-error", "relay-final-close", "relay-final-pause", "relay-final-stop", "relay-final-successor", "relay-final-zero", "relay-final-decode-error", "relay-final-media-error", "relay-unfinished-skip", "relay-old-close-owner", "relay-prefetch-pump-race", "browser-paused-resume", "browser-paused-wedged"];
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
        // Audio deadlines below use the controlled clock. Allow slower module
        // loading/teardown on a busy host without relaxing those assertions.
        env: { ...process.env, NATIVE_AUDIO_CASE: name }, encoding: "utf8", timeout: 45_000,
      });
      assert.equal(child.status, 0, `${name}: ${child.error?.message ?? child.signal ?? ""}\n${child.stdout}${child.stderr}`);
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
  const relayCase = selected.startsWith("relay-");
  let rejectDecode: ((error: Error) => void) | undefined;
  // v3 p4e1-t2: the browser paused a fully local clip by itself at 1.6 s.
  const browserPaused = selected.startsWith("browser-paused");
  const healthy = relayCase || browserPaused || ["healthy", "healthy-pause", "runner-healthy", "runner-slow", "ws-no-final-healthy", "ws-no-final-webaudio-healthy", "runner-ws-healthy", "gesture-delay"].includes(selected);
  const allStalled = selected === "relay-final-zero" || selected === "stall-all" || selected.startsWith("runner-") && !healthy;
  const positivePlateau = ["runner-positive", "runner-ws-positive", "runner-intro", "runner-stop", "runner-stale"].includes(selected);
  class NativeAudio {
    static instances: NativeAudio[] = [];
    playbackRate = 1; preservesPitch = false; muted = false; volume = 1; paused = true;
    onplaying: (() => void) | null = null; onended: (() => void) | null = null; onerror: (() => void) | null = null;
    started: number | null = null; playedOffsets: number[] = []; seekOffset = 0; endTimer: number | null = null; selfPaused = false;
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
      if (browserPaused && NativeAudio.instances[0] === this) {
        // A wedged element accepts play() but never moves again.
        if (this.selfPaused && selected === "browser-paused-wedged") return;
        if (!this.selfPaused) schedule(() => { if (!this.paused) { this.pause(); this.selfPaused = true; } }, (1.6 - this.seekOffset) * 1_000 / this.playbackRate);
      }
      this.playedOffsets.push(this.seekOffset); this.paused = false; this.started = now; this.onplaying?.();
      if (selected === "runner-error") schedule(() => this.onerror?.(), 50);
      if (selected === "relay-final-media-error") schedule(() => this.onerror?.(), 600);
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
      if (selected === "relay-final-decode-error") await new Promise<never>((_resolve, reject) => { rejectDecode = reject; });
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
  replace("window", globalThis); replace("Audio", selected.includes("webaudio") || selected === "relay-final-decode-error" ? undefined : NativeAudio); replace("AudioContext", RunningContext);
  replace("location", { protocol: "http:", host: "offline.invalid", origin: "http://offline.invalid" });
  const chunk = { audio_base64: Buffer.from(wav).toString("base64"), alignment: {
    character_start_times_seconds: [...narration].map((_, i) => i * durationSec / narration.length),
    character_end_times_seconds: [...narration].map((_, i) => (i + 1) * durationSec / narration.length),
  } };
  replace("fetch", async (input: unknown) => {
    if (String(input).endsWith("/api/tts/ws-ticket")) return ["ws-capture", "capture-cancel", "ws-prefetch-cancel", "ws-no-final", "ws-no-final-healthy", "runner-ws-positive", "runner-ws-healthy", "ws-no-final-webaudio", "ws-no-final-webaudio-healthy"].includes(selected) || relayCase ? Response.json({ ticket: "offline" }) : new Response(null, { status: 401 });
    assert(String(input).endsWith("/api/tts/stream"), "external/provider dispatch forbidden"); fetches++;
    return (selected.startsWith("ws-no-final") && !selected.endsWith("healthy")) || ["relay-unfinished-skip", "relay-final-decode-error"].includes(selected) ? new Response(null, { status: 503 }) : new Response(JSON.stringify(chunk) + "\n");
  });
  class OfflineSocket {
    static instances: OfflineSocket[] = [];
    static OPEN = 1; static CONNECTING = 0; readyState = 0;
    onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
    listeners = new Map<string, Set<(event: { data: string }) => void>>(); segment = 0; sentTexts = 0;
    constructor(url: string) { OfflineSocket.instances.push(this); assert(url.startsWith("ws"), "offline socket URL"); schedule(() => { this.readyState = 1; this.onopen?.(); this.emit({ type: "ready" }); }); }
    addEventListener(type: string, fn: (event: { data: string }) => void) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set); }
    removeEventListener(type: string, fn: (event: { data: string }) => void) { this.listeners.get(type)?.delete(fn); }
    emit(message: object) { for (const fn of this.listeners.get("message") ?? []) fn({ data: JSON.stringify(message) }); }
    send(raw: string) {
      const message = JSON.parse(raw); if (message.segment_index) { this.segment = message.segment_index; this.sentTexts++; }
      if (message.flush) {
        if (relayCase && this.sentTexts > 1) return;
        const final = { ...chunk, context_id: `segment_${this.segment}`, isFinal: !selected.startsWith("ws-no-final") && selected !== "relay-unfinished-skip" };
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
    if (relayCase) {
      const warm = client.prewarm(); await advance(100); await warm;
      let starts = 0, ends = 0, captures = 0;
      const state = { outcome: "pending" as "pending" | "resolved" | "rejected" };
      const active = client.speakSegment(narration, { onStart: () => starts++, onEnd: () => ends++, onAudioCaptured: audio => { captures++; assert.deepEqual(audio.bytes, wav); } });
      void active.then(() => { state.outcome = "resolved"; }, () => { state.outcome = "rejected"; });
      await advance(250);
      const current = Reflect.get(client, "currentJob") as { contextFinal: boolean; claimed: boolean; settled: boolean; capturedChunks: Uint8Array[] } | null;
      assert(current && current.claimed && !current.settled, "actual current ownership exists before relay failure");
      const unfinished = selected === "relay-unfinished-skip";
      assert.equal(current.contextFinal, !unfinished);
      assert.equal(captures, unfinished ? 0 : 1);
      if (!["relay-final-zero", "relay-final-decode-error", "relay-unfinished-skip"].includes(selected)) {
        assert.equal(starts, 1); assert(NativeAudio.instances[0]!.currentTime > .05, "actual current clip advances before generation fails");
      } else assert.equal(starts, 0);
      const pumpRace = selected === "relay-prefetch-pump-race";
      client.prefetchSegment("This unfinished future sentence must fail independently.");
      if (!pumpRace) await advance(20);
      const jobs = Reflect.get(client, "jobs") as Array<{ contextFinal: boolean; settled: boolean; claimed: boolean; textSent: boolean }>;
      const pending = jobs.find(job => !job.claimed);
      assert(pending && pending.textSent === !pumpRace && !pending.contextFinal && !pending.settled,
        pumpRace ? "public prefetch pump is awaiting AudioContext before send" : "unfinished lookahead sent while current drains");
      const clip = NativeAudio.instances[0], lateEnd = clip?.onended;
      if (selected === "relay-final-pause") client.pause();
      const socket = OfflineSocket.instances[0]!;
      if (["relay-final-close", "relay-old-close-owner"].includes(selected)) socket.close();
      else socket.emit(selected === "relay-final-error" ? { type: "error", message: "controlled unfinished generation rejected" } : { type: "skip", reason: "tts_budget" });
      await flush();
      assert.equal(pending.settled, true, "relay failure rejects unfinished future generation");
      if (pumpRace) assert.equal(socket.sentTexts, 1, "failed waiting pump cannot send the rejected future sentence");
      if (unfinished) {
        assert.equal(current.settled, true, "relay failure rejects the unfinished current generation immediately");
        await advance(20_000); assert.equal(state.outcome, "rejected", "unfinished current is not a completed spoken clip");
        assert.equal(starts, 0); assert.equal(ends, 0); assert.equal(captures, 0); assert.equal(NativeAudio.instances.length, 0); return;
      }
      assert.equal(state.outcome, "pending", "network failure cannot reject still-owned complete buffered current audio");
      assert.equal(current.settled, false); assert.equal(ends, 0, "no early success for buffered current");
      const chunkCount = current.capturedChunks.length;
      socket.emit({ ...chunk, context_id: "segment_1", isFinal: true }); await flush();
      assert.equal(current.capturedChunks.length, chunkCount, "failed socket cannot add late bytes to completed current");
      if (selected === "relay-final-decode-error") {
        assert(rejectDecode, "actual WebAudio decode is pending"); rejectDecode(new Error("controlled decode failure"));
        await advance(20_000); assert.equal(state.outcome, "rejected"); assert.equal(starts, 0); assert.equal(ends, 0); return;
      }
      if (selected === "relay-final-zero") {
        await advance(20_000); assert.equal(state.outcome, "rejected", "two nonadvancing native clocks still reject boundedly");
        assert.equal(starts, 0); assert.equal(ends, 0); assert.equal(NativeAudio.instances.length, 2); assert.equal(fetches, 0); return;
      }
      if (selected === "relay-final-media-error") {
        await advance(2_000); assert.equal(state.outcome, "rejected"); assert.equal(ends, 0); assert.equal(fetches, 0); return;
      }
      if (selected === "relay-final-pause") {
        const position = clip!.currentTime; await advance(8_000); assert.equal(clip!.currentTime, position);
        assert.equal(state.outcome, "pending"); assert.equal(ends, 0); client.resume();
      }
      if (["relay-final-stop", "relay-final-successor"].includes(selected)) {
        client.stop(); await flush();
        assert.equal(state.outcome, "resolved", "existing explicit cancellation resolves quietly without announcing onEnd");
        assert.equal(ends, 0); lateEnd?.(); await flush(); assert.equal(ends, 0);
        if (selected === "relay-final-successor") {
          const successor = { outcome: "pending" as "pending" | "resolved" | "rejected", starts: 0 };
          void client.playAudio(wav, { onStart: () => successor.starts++ }).then(() => { successor.outcome = "resolved"; }, () => { successor.outcome = "rejected"; });
          await advance(300); lateEnd?.(); await flush(); assert.equal(successor.outcome, "pending", "old completion cannot finish successor");
          assert.equal(ends, 0); await advance(5_000); assert.equal(successor.outcome, "resolved"); assert.equal(successor.starts, 1);
        } else await advance(5_000);
        assert.equal(ends, 0); assert.equal(fetches, 0); return;
      }
      await advance(5_000);
      if (selected === "relay-old-close-owner") {
        const lateClose = socket.onclose;
        const nextState = { outcome: "pending" as "pending" | "resolved" | "rejected" };
        void client.speakSegment(narration, { onEnd: () => ends++ }).then(() => { nextState.outcome = "resolved"; }, () => { nextState.outcome = "rejected"; });
        await advance(250);
        const nextSocket = OfflineSocket.instances.at(-1)!;
        assert.notEqual(nextSocket, socket, "successor owns a fresh live socket");
        lateClose?.(); await flush();
        assert.equal(Reflect.get(client, "ws"), nextSocket, "late old close cannot clear successor socket ownership");
        assert.equal(nextState.outcome, "pending"); await advance(5_000);
        assert.equal(nextState.outcome, "resolved"); assert.equal(ends, 2); assert.equal(fetches, 0); return;
      }
      assert.equal(state.outcome, "resolved", "buffered current reaches its actual native end"); assert.equal(ends, 1); assert.equal(starts, 1);
      assert.equal(captures, 1); assert.equal(NativeAudio.instances.length, 1); assert.equal(fetches, 0, "complete current is not resynthesized");
      return;
    }
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
      const executed: Array<{ command: NonNullable<TutorSegment["command"]>; options: ExecuteCommandOptions }> = [];
      const voiceDegradedFlags: boolean[] = [];
      const params = {
        sessionId: "offline-native-audio", ensureTTSClient: () => client, activeVerifiedDiagramRef: ref(null),
        cancelRef: ref(false), isPausedRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1),
        recordedSegmentsRef: ref<import("../../features/tutor-session/hooks/turn/types").UseTurnLifecycleParams["recordedSegmentsRef"]["current"]>([]),
        narrationSinceEpochRef: ref(""), currentTraceIdRef: ref(null), narrationDensityRef: ref(0), drawChainRef: ref(Promise.resolve()),
        turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), turnTelemetryRef: ref({ mark: noop, span: () => ({ end: noop }) }),
        applyTurnPhase: noop, setCurrentSegmentText: noop, onVoiceDegraded: (degraded: boolean) => { voiceDegradedFlags.push(degraded); }, cancellableDelay: (ms: number) => new Promise<void>(resolve => schedule(resolve, ms)),
        raceWithCancel: async <T,>(promise: Promise<T>) => promise,
        reserveTextCommandPlacements: async (command: NonNullable<TutorSegment["command"]>) => [command],
        executeCommandWithCancel: async (command: NonNullable<TutorSegment["command"]>, options: ExecuteCommandOptions) => {
          if (options.isCancelled?.()) return;
          executed.push({ command, options });
          // Runtime explanation pointing (main #211) is motion over existing ink, not ink.
          if (options.explanationPointing === true) { assert.equal(command.type, "POINT", "runtime explanation motion is only ever a POINT"); return; }
          drawn.push(command.text ?? command.type); options.onInkStarted?.();
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
      } else if (positivePlateau) {
        // Heard (0.2 s), then the clock froze on both native attempts. The
        // segment finishes: its ink completes and it is recorded with the
        // exact generated clip, rather than failing toward a cancelled turn.
        assert.equal(outcome, null, "a heard voice that freezes finishes its segment");
        assert.equal(NativeAudio.instances.length, 2, "one bounded native retry before finishing silently");
        assert.equal(params.recordedSegmentsRef.current.length, 1, "the heard segment completes once");
        const row = params.recordedSegmentsRef.current[0]!;
        assert.deepEqual(row.audioBytes, wav, "the recorded row keeps the exact generated clip for replay");
        assert(parseStoredSegmentCommands(row.command).some(command => command.text === "F = ma"), "its ink completed");
        // #275: the unheard rest of the sentence is taught silently, its words shown.
        assert.equal(voiceDegradedFlags.at(-1), true, "the student is told the voice failed and sees the words");
        if (selected === "runner-intro") {
          assert.deepEqual(drawn, ["F = ma"], "a verified figure intro has no pointing tour");
          assert.deepEqual(executed.map(({ command }) => command.type), ["WRITE"], "a verified figure intro has no pointing tour, not even a transient pointer");
          // The figure transaction still decides whether it commits, so nothing is published before that.
          assert.equal(rows.length, 0, "uncommitted figure intro cannot publish speculative bytes or ink");
        } else {
        // Main's explanation pointing (#211) adds one transient pointer after
        // the write while speech remains; it is not ink and ends with the clip.
        assert.deepEqual(executed.filter(({ command }) => command.type !== "POINT").map(({ command }) => [command.type, command.text]), [["WRITE", "F = ma"]], "the heard segment's only ink is its WRITE");
        assert.deepEqual(executed.map(({ command }) => command.type), ["WRITE", "POINT"], "exactly one transient pointer follows the write");
        const pointer = executed[1]!;
        const pointerOptions = pointer.options as ExecuteCommandOptions & { explanationPointing?: boolean; spokenClock?: { isSpeechComplete?: () => boolean } };
        assert.equal(pointer.command.text, "last", "the pointer traces the last written row");
        assert.equal(pointerOptions.explanationPointing, true, "the pointer is main's explanation pointing");
        assert.equal(pointerOptions.spokenClock?.isSpeechComplete?.(), true, "the pointer's speech clock is complete once the heard segment finishes");
        // The saved row keeps the complete clip, as for any silently taught beat.
        assert.equal(rows.length, 1, "one claimed narration row retained");
        const saved = rows[0]!;
        assert.deepEqual(saved.audioBytes, wav, "retained content is byte exact");
        assert.equal(saved.durationMs, 4_240, "retained clip keeps natural duration independently of speed");
        assert(saved.timings && saved.timings.totalDuration === durationSec, "alignment survives failure retention");
        assert(parseStoredSegmentCommands(saved.command).some(command => command.text === "F = ma"), "the sentence's work is drawn and saved with its retained clip");
        assert.deepEqual(drawn, ["F = ma"], "the ink reached the board once");
        }
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
          // Unrecovered native output is a voice failure, not a dead board:
          // the beat is taught silently and saved with its complete clip.
          assert.equal(outcome, null, "unrecovered native output is taught silently, never a failed beat the queue counts");
          assert.equal(params.recordedSegmentsRef.current.length, 1, "the silently taught beat is recorded");
          assert.equal(NativeAudio.instances.length, selected === "runner-error" ? 1 : 2, "terminal errors stop the voice; only stalled clocks get one retry");
        }
        // Silent teaching draws the sentence's ink on the estimated schedule, heard or not.
        assert(parseStoredSegmentCommands(row.command).some(command => command.text === "F = ma"), "the sentence's work is drawn and saved with its retained clip");
        assert.deepEqual(drawn, ["F = ma"], "the ink reached the board once");
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
    if (browserPaused) {
      await advance(1_400);
      const first = NativeAudio.instances[0]!;
      assert(first.selfPaused, "the browser paused the element without the client asking");
      await advance(10_000);
      assert.equal(settled, "resolved", "a clip the browser paused by itself still plays to its end");
      assert.equal(starts, 1, "one audible start");
      assert.equal(fetches, 0, "local bytes, no new synthesis");
      if (selected === "browser-paused-resume") {
        assert.equal(NativeAudio.instances.length, 1, "the same element was asked to continue");
        assert.equal(first.playedOffsets.length, 2); assert(first.playedOffsets[1]! >= 1.6 - 1e-6, "it continued from where it stopped");
      } else {
        assert.equal(NativeAudio.instances.length, 2, "a wedged element is replaced once");
        assert(NativeAudio.instances[1]!.playedOffsets[0]! >= 1.6 - 0.01, "the retry continues from the last heard position");
      }
      console.log(`native audio ${selected}: GREEN; no providers`);
      return;
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
