/** Actual segment runner/save consumers; offline provider and browser speech ports. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import type { TutorSegment } from "@heytutor/drawing";
import type { RecordedSegmentPayload } from "../../lib/boards/boardsClient";
import type { TurnTelemetryEvent } from "../../lib/obs/langfuse";
import { createTurnTelemetry } from "../../lib/obs/turnTelemetry";
import type { UseSegmentRunnerParams } from "../../features/tutor-session/hooks/turn/types";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { recordingAudioCaptureComplete } from "../../features/tutor-session/lib/turn/recordingAudioCapture";
import { SPEECH_STARTUP_DEADLINE_MS } from "../../features/tutor-session/lib/turn/speechStartup";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(path.join(app, "package.json"));
const runnerPath = path.join(app, "features/tutor-session/hooks/turn/useSegmentRunner.ts");
const cases = ["full-clip", "late-provider-timings", "no-clip", "other-segment", "stale-turn"] as const;
type CaseName = typeof cases[number];
const ref = <T,>(current: T) => ({ current });
const noop = () => {};
const providerDurationMs = 4_240;
const browserDurationMs = 1_600;

/** Complete synthetic PCM; no student recording, provider request, or credential. */
function generatedWav(frequency: number): Uint8Array {
  const samples = providerDurationMs * 8;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8_000, 24); bytes.writeUInt32LE(16_000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < samples; i++) {
    bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * frequency / 8_000) * 6_000), 44 + i * 2);
  }
  return new Uint8Array(bytes);
}

function providerTimings(text: string): core.AudioTimings {
  const chars = core.mathToSpeech(text).length;
  const step = providerDurationMs / 1_000 / chars;
  return {
    charStartTimes: Array.from({ length: chars }, (_, index) => index * step),
    charDurations: Array.from({ length: chars }, () => step),
    totalDuration: providerDurationMs / 1_000,
  };
}

async function verifyCase(name: CaseName): Promise<void> {
  // As in verify-native-audio-recovery: load real ink before exposing browser ports.
  requireApp(path.join(app, "features/tutor-session/lib/turn/segmentInk.ts"));
  let now = 1_000, sequence = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const schedule = (run: () => void, ms = 0): number => {
    const id = ++sequence;
    timers.set(id, { at: now + ms, run });
    return id;
  };
  const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  const advance = async (ms: number) => {
    const until = now + ms;
    await flush();
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].run(); await flush();
    }
    now = until; await flush();
  };

  const clip = generatedWav(440);
  const obsoleteClip = generatedWav(660);
  const attempts: Array<{
    text: string;
    options: core.SpeakSegmentOptions;
    reject: (error: Error) => void;
    startedAt: number | null;
  }> = [];
  class ProviderSpeech implements core.TTSClient {
    private playbackRate = 1.5;
    async speak(options: core.SpeakOptions) { await this.speakSegment(options.text, options); }
    speakSegment(text: string, options: core.SpeakSegmentOptions = {}): Promise<void> {
      const healthy = name === "other-segment" && attempts.length === 0;
      const complete = name !== "no-clip" && (name !== "other-segment" || healthy);
      return new Promise<void>((resolve, reject) => {
        const attempt = { text, options, reject, startedAt: null as number | null };
        attempts.push(attempt);
        schedule(() => {
          options.onFirstAudioByte?.({ transport: "http", sinceRequestMs: 50, prefetched: false });
          const timings = providerTimings(text);
          options.onTimings?.(name === "late-provider-timings" ? {
            charStartTimes: timings.charStartTimes.map((start) => start / 2),
            charDurations: timings.charDurations.map((duration) => duration / 2),
            totalDuration: timings.totalDuration / 2,
          } : timings);
          // Timing/first-byte callbacks alone are not a complete recording.
          if (complete) {
            options.onAudioCaptured?.({ bytes: clip, mimeType: "audio/wav" });
            options.onAudioReady?.();
          }
          // Final provider alignment can arrive after complete audio capture,
          // before native startup expires. Replay must keep this newer metadata.
          if (name === "late-provider-timings") schedule(() => options.onTimings?.(providerTimings(text)), 60);
          if (healthy) {
            attempt.startedAt = now;
            options.onStart?.();
            schedule(() => { options.onEnd?.(); resolve(); }, providerDurationMs / this.getPlaybackRate());
          }
          // The other native outputs remain pending until startup recovery abandons them.
        }, 50);
      });
    }
    async playAudio() { throw new Error("Unexpected audio regeneration/replay in the offline runner test"); }
    async prewarm() {}
    pause() {} resume() {}
    stop() { this.abandonSpeaking(); }
    abandonSpeaking() { attempts.at(-1)?.reject(new Error("Offline native playback did not start")); }
    get isPlaying() { return true; }
    setPlaybackRate(rate: number) { this.playbackRate = rate; }
    getPlaybackRate() { return this.playbackRate; }
    getPlaybackPositionMs() {
      const started = attempts.at(-1)?.startedAt;
      return started == null ? 0 : Math.min((now - started) * this.getPlaybackRate(), providerDurationMs);
    }
  }
  const provider = new ProviderSpeech();

  // Drive the real SpeechSynthesisTTSClient. It emits timings at onend and no audio bytes.
  class BrowserUtterance {
    rate = 1; pitch = 1; volume = 1; lang = "";
    onstart: (() => void) | null = null;
    onboundary: ((event: { charIndex: number }) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    constructor(public text: string) {}
  }
  const browserNarrations: string[] = [];
  const browserRates: number[] = [];
  const browserTraceNarrations: string[] = [];
  replace("performance", { now: () => now });
  replace("setTimeout", schedule); replace("clearTimeout", (id: number) => timers.delete(id));
  replace("window", globalThis); replace("SpeechSynthesisUtterance", BrowserUtterance);
  replace("speechSynthesis", {
    getVoices: () => [], resume: noop, cancel: noop,
    speak: (utterance: BrowserUtterance) => {
      browserNarrations.push(utterance.text); browserRates.push(utterance.rate);
      schedule(() => {
        utterance.onstart?.();
        for (let i = 0; i < utterance.text.length; i++) {
          schedule(() => utterance.onboundary?.({ charIndex: i }), i * browserDurationMs / utterance.text.length);
        }
        schedule(() => utterance.onend?.(), browserDurationMs);
      }, 20);
    },
  });
  replace("fetch", async (input: unknown, init?: RequestInit) => {
    assert.equal(input, "/api/tts", "Only the browser voice's local telemetry port may be called");
    assert.equal(new Headers(init?.headers).get("x-tts-transport"), "browser-fallback",
      "Provider speech/network dispatch is forbidden");
    browserTraceNarrations.push(JSON.parse(String(init?.body)).text);
    return new Response(null, { status: 204 });
  });

  const events: TurnTelemetryEvent[] = [];
  const telemetry = createTurnTelemetry({ env: {
    now: () => now, wallNow: () => now, window: null, document: null,
    send: async (body) => { events.push(...JSON.parse(body).events); },
  } });
  telemetry.setTrace("offline-recording", `offline-${name}`);
  const registry = new LiveTurnSaveRegistry({
    now: () => now, isOnline: () => false, mintId: () => `offline-${name}`,
    setTimer: schedule, clearTimer: (id) => timers.delete(id as number),
    transport: {
      checkpoint: async () => { throw new Error("Offline checkpoint dispatch forbidden"); },
      close: async () => { throw new Error("Offline close dispatch forbidden"); },
    },
  });
  const params: UseSegmentRunnerParams = {
    sessionId: `offline-${name}`, ensureTTSClient: () => provider, activeVerifiedDiagramRef: ref(null),
    cancelRef: ref(false), isPausedRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1),
    recordedSegmentsRef: ref<RecordedSegmentPayload[]>([]), narrationSinceEpochRef: ref(""),
    currentTraceIdRef: ref(null), narrationDensityRef: ref(0), drawChainRef: ref(Promise.resolve()),
    turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), turnTelemetryRef: ref(telemetry),
    applyTurnPhase: noop, setCurrentSegmentText: noop,
    cancellableDelay: (ms) => new Promise<void>((resolve) => schedule(resolve, ms)),
    raceWithCancel: async (promise) => promise,
    reserveTextCommandPlacements: async (command) => [command],
    executeCommandWithCancel: async (_command, options = {}) => {
      if (!options.isCancelled?.()) options.onInkStarted?.();
    },
  };
  const handle = registry.begin({
    owner: params.cancelRef, generation: 1, boardId: params.sessionId, traceId: null,
    kind: "lesson", question: "Explain Ohm's law.", preview: "Explain Ohm's law.",
    speedMultiplier: provider.getPlaybackRate(), continuesBoard: false,
  });

  // Same hook seam as verify-native-audio-recovery; product source and dependencies stay real.
  const compiled = ts.transpileModule(readFileSync(runnerPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return { useRef: ref, useCallback: <T,>(fn: T) => fn };
    if (specifier.endsWith("/liveTurnSave")) return { liveTurnSave: () => registry };
    return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
      : specifier.startsWith(".") ? path.resolve(path.dirname(runnerPath), specifier) : specifier);
  }, mod, mod.exports);
  const hooks = mod.exports as unknown as typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner");
  const runner = hooks.useSegmentRunner(params);
  const first: TutorSegment = {
    narration: "Voltage equals current times resistance.",
    command: { type: "WRITE", text: "V = IR", params: [90, 142], charPosition: 0, narrationBefore: "" },
  };
  const second: TutorSegment = { narration: "The slope measures resistance.", command: null };
  const segments = name === "other-segment" ? [first, second] : [first];
  const lateCapture = (attempt: typeof attempts[number]) => {
    attempt.options.onTimings?.({ ...providerTimings(attempt.text), totalDuration: 9.9 });
    attempt.options.onAudioCaptured?.({ bytes: obsoleteClip, mimeType: "audio/wav" });
    attempt.options.onStart?.(); attempt.options.onEnd?.();
  };
  const run = async (segment: TutorSegment, index: number) => {
    let settled = false;
    const task = runner.runSegment(segment, index, segments, 1).finally(() => { settled = true; });
    // Observe immediately; await below still reports the original failure.
    void task.catch(noop);
    await advance(100);
    if (name === "stale-turn") {
      params.turnGenerationRef.current = 2;
      lateCapture(attempts[0]!);
    } else if (name !== "other-segment" || index === 1) {
      schedule(() => lateCapture(attempts[0]!), SPEECH_STARTUP_DEADLINE_MS + 100);
    }
    await advance(12_000);
    assert(settled, "The actual segment runner must finish boundedly");
    assert.equal(await task, undefined, "Speech must complete normally, without falling through to silent teaching");
  };

  try {
    await run(first, 0);
    if (name === "other-segment") await run(second, 1);
    await telemetry.flush();
    const rows = params.recordedSegmentsRef.current;
    const savedRows = handle.submittedRows().filter((row) => row.narration.trim());
    if (name === "stale-turn") {
      assert.equal(rows.length, 0, "A replaced turn cannot record late provider bytes");
      assert(savedRows.every((row) => !row.audioBytes), "A replaced turn cannot submit late provider bytes");
      assert.equal(browserNarrations.length, 0, "A replaced turn cannot start browser recovery");
      return;
    }
    const recovered = name === "other-segment" ? second : first;
    assert.deepEqual(browserNarrations, [core.mathToSpeech(recovered.narration)],
      "Browser recovery speaks the same narration exactly once");
    assert.deepEqual(browserTraceNarrations, browserNarrations);
    assert.deepEqual(browserRates, [1], "Live browser recovery has its own clamped playback rate");
    assert(events.some((event) => event.name === "tts-browser-recovery" && event.metadata?.reason === "timeout"),
      "This regression must exercise the production startup-timeout handoff");
    assert.equal(rows.length, segments.length, "Successfully taught narration completes its recorded rows");
    assert.equal(savedRows.length, rows.length, "The real save consumer receives every completed narration row");
    if (name === "full-clip" || name === "late-provider-timings") {
      const liveWrite = events.find((event) => event.name === "write-schedule-ready");
      assert.equal(liveWrite?.metadata?.timing_chars, 0, "Live browser writing must discard provider alignment");
      assert.equal(liveWrite?.metadata?.timing_total_ms, 0, "Live browser writing must use its own clock");
      for (const row of [rows[0]!, savedRows[0]!]) {
        assert(row.audioBytes, "Completed browser recovery must retain the full captured provider clip for recording");
        assert.deepEqual(row.audioBytes, clip, "Saved replay keeps byte-exact provider audio, never obsolete bytes");
        assert.equal(row.durationMs, providerDurationMs, "Saved duration describes the provider clip, independent of live voice/speed");
        assert.deepEqual(row.timings, providerTimings(first.narration), "Saved timings describe the provider clip, not browser speech");
      }
      assert.equal(recordingAudioCaptureComplete(rows), true, "Full provider capture makes this automatic recording replayable");
    } else {
      assert.equal(rows.at(-1)?.audioBytes, null, "Browser speech without an owned full provider clip stays unrecordable");
      assert.equal(savedRows.at(-1)?.audioBytes, null, "The save consumer cannot borrow late or another segment's bytes");
      assert.equal(recordingAudioCaptureComplete(rows), false, "First bytes, timings, and browser speech cannot complete a recording");
      if (name === "other-segment") {
        assert.deepEqual(rows[0]?.audioBytes, clip, "An earlier healthy segment keeps its own complete clip");
        assert.deepEqual(savedRows[0]?.audioBytes, clip, "Late callbacks cannot change an earlier submitted clip");
      }
    }
  } finally {
    runner.stopFallbackSpeech(); provider.stop(); handle.close(); await flush();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

async function main(): Promise<void> {
  let failures = 0;
  for (const name of cases) {
    try {
      await verifyCase(name);
      console.log(`recording voice recovery ${name}: PASS`);
    } catch (error) {
      failures++;
      console.error(`recording voice recovery ${name}: FAIL`, error);
    }
  }
  assert.equal(failures, 0, `verify-recording-voice-recovery: ${failures}/${cases.length} groups failed`);
  console.log(`verify-recording-voice-recovery: ${cases.length} actual consumer groups; no providers`);
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
