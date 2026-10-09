import {
  DEFAULT_VOICE_KEY,
  TTS_LANG_HEADER,
  type TutorVoiceKey,
  type TutorVoicePreferences,
} from "./voiceLanguage";
import type { TutorVoiceSettings } from "./voiceSettings";
import { mathToSpeech } from "./speechNotation";
import { clampPlaybackRate } from "./playbackRate";
export interface SpeakOptions {
  text: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: unknown) => void;
  onTimings?: (timings: AudioTimings) => void;
}

export interface SpeakSegmentOptions {
  previousText?: string;
  nextText?: string;
  /**
   * Dials for this one sentence, when it is not spoken in the teaching voice.
   * Set from the segment's `delivery`, so an opening line is generated with
   * its own expression rather than the lesson's steady one.
   */
  voiceSettings?: TutorVoiceSettings;
  traceId?: string;
  sessionId?: string;
  /** Fires once for complete claimed provider bytes, before decode/load; not audibility. */
  onAudioReady?: () => void;
  /**
   * Latency telemetry: the first provider audio bytes for this segment
   * arrived. `sinceRequestMs` counts from when the segment was requested,
   * which for a sentence generated ahead is the lookahead request. Never
   * gates playback.
   */
  onFirstAudioByte?: (info: FirstAudioByteInfo) => void;
  onPlaybackBlocked?: (blocked: {
    reason: "context-suspended" | "context-interrupted" | "not-allowed";
    audioContextState: AudioContextState | "interrupted" | null;
  } | null) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: unknown) => void;
  onTimings?: (timings: AudioTimings) => void;
  onAudioCaptured?: (audio: { bytes: Uint8Array; mimeType: string }) => void;
}

export interface FirstAudioByteInfo {
  transport: "ws" | "http";
  sinceRequestMs: number;
  /** Generated ahead of the claim (socket lookahead or HTTP prefetch). */
  prefetched: boolean;
}

/**
 * The signal behind the most recent `onStart`. `html-audio-playing` is the
 * media element's `playing` event or its `play()` promise resolving;
 * `audio-context-scheduled` is a buffer source queued `leadMs` ahead of the
 * context clock, so the voice is audible that much later;
 * `speech-synthesis-start` is the browser voice's `start` event.
 */
export interface PlaybackStartSignal {
  signal: "html-audio-playing" | "audio-context-scheduled" | "speech-synthesis-start";
  leadMs: number;
}

export interface AudioTimings {
  charStartTimes: number[];
  charDurations: number[];
  totalDuration: number;
}

export interface TimingChunkInput {
  startTimesSec?: number[];
  endTimesSec?: number[];
  startTimesMs?: number[];
  durationsMs?: number[];
}

export interface PrewarmOptions {
  onConnect?: (info: { ms: number; ok: boolean }) => void;
  /** Stamp the TTS websocket with this turn so `tts-segment` gens land on it. */
  traceId?: string;
  sessionId?: string;
}

export interface TTSClient {
  speak(options: SpeakOptions): Promise<void>;
  speakSegment(text: string, options?: SpeakSegmentOptions): Promise<void>;
  /**
   * Start generating the next spoken line while the current one is still
   * playing so the voice does not stall between sentences.
   */
  prefetchSegment?(text: string, options?: SpeakSegmentOptions): void;
  /**
   * The complete alignment already held for a sentence generated ahead of
   * the lesson, before `speakSegment` claims it. The segment runner builds
   * its handwriting schedule a few milliseconds before the claim replays
   * `onTimings`; without this every prefetched sentence scheduled on the
   * estimate while its exact alignment sat in the queue (15 of 15 WRITE
   * rows on 10 Sep 2026). Null when nothing complete is held for that text
   * with those dials. Segment-relative, like `onTimings`.
   */
  peekSegmentTimings?(text: string, options?: SpeakSegmentOptions): AudioTimings | null;
  playAudio(bytes: Uint8Array, options?: { onStart?: () => void }): Promise<void>;
  prewarm(options?: PrewarmOptions): Promise<void>;
  /**
   * Create/resume the AudioContext inside a user-gesture turn so the browser
   * allows audible playback later (planning awaits would otherwise leave it suspended).
   */
  unlockAudio?(): void;
  getAudioContextState?(): AudioContextState | "interrupted" | null;
  /**
   * What the latest `onStart` was based on; telemetry only. Null until the
   * current `speakSegment` has started.
   */
  getLastPlaybackStart?(): PlaybackStartSignal | null;
  /** Whether output is muted (Watch Live off); telemetry only. */
  isMuted?(): boolean;
  /**
   * Keep generating and capturing TTS, but do not play it through speakers.
   * Writing sync still uses the audio clock.
   */
  setMuted?(muted: boolean): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /**
   * Drop a stuck in-flight segment without tearing down the client.
   * Used when the segment runner times out so zombie WS/HTTP work cannot
   * block the next paragraph.
   */
  abandonSpeaking?(): void;
  get isPlaying(): boolean;
  /**
   * Current playback position of the actively-speaking segment, in milliseconds from
   * the moment its audio became audible. Returns null when no position is known.
   * Negative values mean the audio is scheduled but not yet audible. Used to keep the
   * whiteboard writing synced to the true audio clock (not wall-clock at onStart).
   *
   * The value is in audio-buffer time (scaled by playback rate), so it can be compared
   * directly against character alignment timings from onTimings.
   */
  getPlaybackPositionMs(): number | null;
  /**
   * Set the playback rate for live TTS audio. Takes effect immediately on currently
   * playing audio and all subsequently scheduled segments. 1.0 = normal speed,
   * 2.0 = twice as fast. Values below 0.1 are clamped.
   */
  setPlaybackRate(rate: number): void;
  /** Live playback rate. Writing clocks use this so wall fallback stays in media time. */
  getPlaybackRate?(): number;
  /**
   * Apply the language/accent and latency choices from Settings. The WebSocket
   * client drops its socket so the next connection uses the new voice.
   */
  setVoicePreferences?(preferences: TutorVoicePreferences): void;
}

/**
 * Narration to spoken text. The rules and the measurements behind them live in
 * `speechNotation.ts`; it is re-exported here because every caller in the app
 * and every verify gate imports it from this module.
 */
export { mathToSpeech };

function buildTtsHeaders(
  options: Pick<SpeakSegmentOptions, "traceId" | "sessionId">,
  voiceKey: TutorVoiceKey = DEFAULT_VOICE_KEY,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [TTS_LANG_HEADER]: voiceKey,
  };

  if (options.traceId) {
    headers["x-heytutor-trace-id"] = options.traceId;
  }

  if (options.sessionId) {
    headers["x-session-id"] = options.sessionId;
  }

  return headers;
}

async function recordBrowserFallbackTts(
  spokenText: string,
  options: Pick<SpeakSegmentOptions, "traceId" | "sessionId">,
): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  try {
    await fetch("/api/tts", {
      method: "POST",
      headers: {
        ...buildTtsHeaders(options),
        "x-tts-transport": "browser-fallback",
      },
      body: JSON.stringify({ text: spokenText }),
    });
  } catch {
    // tracing should not block playback
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizedTimingRows(chunk: TimingChunkInput): Array<{ start: number; end: number }> {
  const rows: Array<{ start: number; end: number }> = [];

  if (chunk.startTimesSec && chunk.startTimesSec.length > 0) {
    const starts = chunk.startTimesSec;
    const ends = chunk.endTimesSec ?? [];
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      if (!finiteNumber(start)) {
        continue;
      }
      const end = finiteNumber(ends[i]) ? ends[i] : start + 0.06;
      rows.push({ start, end: Math.max(end, start + 0.01) });
    }
    return rows;
  }

  const startsMs = chunk.startTimesMs ?? [];
  const durationsMs = chunk.durationsMs ?? [];
  for (let i = 0; i < startsMs.length; i++) {
    const startMs = startsMs[i];
    if (!finiteNumber(startMs)) {
      continue;
    }
    const durationMs = finiteNumber(durationsMs[i]) ? durationsMs[i] : 60;
    const start = startMs / 1000;
    rows.push({ start, end: start + Math.max(durationMs / 1000, 0.01) });
  }

  return rows;
}

function chooseTimingOffsetSec(rows: Array<{ start: number; end: number }>, existingEndSec: number): number {
  if (rows.length === 0 || existingEndSec <= 0.05) {
    return 0;
  }

  const firstStart = rows[0]?.start ?? 0;
  const lastEnd = rows.at(-1)?.end ?? firstStart;

  // ElevenLabs transports are inconsistent: some chunks start at 0, others
  // already contain cumulative offsets. Add an offset only when the chunk looks
  // local to itself. This prevents impossible schedules like 33s in a short segment.
  const looksCumulative =
    firstStart >= existingEndSec - 0.2 ||
    lastEnd > existingEndSec + 0.5;

  return looksCumulative ? 0 : existingEndSec;
}

export function mergeAudioTimingChunk(
  existing: AudioTimings,
  chunk: TimingChunkInput,
  chunkOffsetSec = existing.totalDuration,
): number {
  const rows = normalizedTimingRows(chunk);
  if (rows.length === 0) {
    return chunkOffsetSec;
  }

  const existingEndSec = Math.max(existing.totalDuration, chunkOffsetSec, 0);
  const offsetSec = chooseTimingOffsetSec(rows, existingEndSec);
  let maxEndSec = existingEndSec;

  for (const row of rows) {
    const start = row.start + offsetSec;
    const end = Math.max(row.end + offsetSec, start + 0.01);

    // Drop duplicated overlap from cumulative streams without disturbing normal
    // local chunks that have been offset to the current timeline end.
    if (start < existing.totalDuration - 0.08) {
      continue;
    }

    existing.charStartTimes.push(start);
    existing.charDurations.push(Math.max(end - start, 0.01));
    maxEndSec = Math.max(maxEndSec, end);
  }

  existing.totalDuration = maxEndSec;
  return existing.totalDuration;
}

/**
 * Convert connection-relative alignment into a fresh segment timeline without
 * mutating the merger's raw coordinates. Long-lived websocket transports may
 * start a later utterance at the previous utterance's cumulative timestamp.
 */
export function toSegmentRelativeAudioTimings(raw: AudioTimings): AudioTimings {
  const firstFiniteStart = raw.charStartTimes.find(finiteNumber) ?? 0;
  const origin = Math.max(firstFiniteStart, 0);
  const charStartTimes = raw.charStartTimes.map((start) =>
    finiteNumber(start) ? Math.max(0, start - origin) : 0);
  const charDurations = raw.charDurations.map((duration) =>
    finiteNumber(duration) ? Math.max(duration, 0.01) : 0.06);
  const lastEnd = charStartTimes.reduce((maximum, start, index) =>
    Math.max(maximum, start + (charDurations[index] ?? 0.06)), 0);
  return {
    charStartTimes,
    charDurations,
    totalDuration: Math.max(lastEnd, raw.totalDuration - origin, 0),
  };
}

// speechSynthesis.cancel() affects the entire window, not one utterance. Lease
// the engine to one client at a time; pending clients never enter its queue.
let browserSpeechOwner: SpeechSynthesisTTSClient | null = null;
const browserSpeechWaiters: Array<{ client: SpeechSynthesisTTSClient; start: () => void }> = [];

function claimBrowserSpeech(client: SpeechSynthesisTTSClient): void {
  browserSpeechOwner = client;
}

export class SpeechSynthesisTTSClient implements TTSClient {
  private lastPlaybackStart: PlaybackStartSignal | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private cancelUtterance: (() => void) | null = null;
  private playing = false;
  private playbackRate = 1.0;
  private muted = false;

  async prewarm(_options?: PrewarmOptions): Promise<void> {
    // SpeechSynthesis has no connection to warm.
  }

  unlockAudio(): void {
    if (typeof window !== "undefined") {
      window.speechSynthesis?.resume();
    }
  }

  getLastPlaybackStart(): PlaybackStartSignal | null {
    return this.lastPlaybackStart;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.currentUtterance) {
      this.currentUtterance.volume = muted ? 0 : 1;
    }
  }

  async speak(options: SpeakOptions): Promise<void> {
    return this.speakSegment(options.text, options);
  }

  async speakSegment(
    text: string,
    { traceId, sessionId, onStart, onEnd, onError, onTimings, onAudioCaptured: _onAudioCaptured }: SpeakSegmentOptions = {},
  ): Promise<void> {
    this.lastPlaybackStart = null;
    if (typeof window === "undefined" || !window.speechSynthesis) {
      const error = new Error("SpeechSynthesis not available");
      onError?.(error);
      throw error;
    }

    const spokenText = mathToSpeech(text.trim());

    if (spokenText.length === 0) {
      onEnd?.();
      return;
    }

    void recordBrowserFallbackTts(spokenText, { traceId, sessionId });

    this.stop();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let utterance: SpeechSynthesisUtterance | null = null;
      const watches: Array<ReturnType<typeof setTimeout>> = [];
      const detach = () => {
        if (!utterance) return;
        utterance.onstart = null;
        utterance.onboundary = null;
        utterance.onend = null;
        utterance.onerror = null;
      };
      const clearWatches = () => {
        for (const id of watches) clearTimeout(id);
        watches.length = 0;
      };
      const finish = (notify?: () => void, error?: unknown) => {
        if (settled) return;
        settled = true;
        clearWatches();
        detach();
        this.playing = false;
        this.currentUtterance = null;
        this.cancelUtterance = null;
        const waiting = browserSpeechWaiters.findIndex((entry) => entry.client === this);
        if (waiting >= 0) browserSpeechWaiters.splice(waiting, 1);
        const owned = browserSpeechOwner === this;
        if (owned) browserSpeechOwner = null;
        try { notify?.(); } finally {
          if (error) reject(error);
          else resolve();
          if (owned && !browserSpeechOwner) browserSpeechWaiters.shift()?.start();
        }
      };
      const cancelOwnedUtterance = () => {
        if (browserSpeechOwner !== this) return;
        // Cancellation can dispatch onerror synchronously. Retain the lease
        // until the engine is empty so a successor cannot be cancelled too.
        detach();
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
      };
      this.cancelUtterance = () => { cancelOwnedUtterance(); finish(); };

      const startTime = { value: 0 };
      const charStartTimes: number[] = new Array(spokenText.length).fill(0);
      const charDurations: number[] = new Array(spokenText.length).fill(0.06);

      const speakNow = () => {
        if (settled || browserSpeechOwner !== this) return;
        detach();
        const next = new SpeechSynthesisUtterance(spokenText);
        utterance = next;
        next.rate = this.playbackRate;
        next.pitch = 1.0;
        next.volume = this.muted ? 0 : 1.0;

        const voices = window.speechSynthesis.getVoices();
        const preferredVoice =
          voices.find((voice) => voice.lang.startsWith("en") && voice.name.includes("Google")) ??
          voices.find((voice) => voice.lang.startsWith("en"));
        if (preferredVoice) next.voice = preferredVoice;

        next.onstart = () => {
          if (settled || utterance !== next) return;
          clearWatches();
          this.playing = true;
          startTime.value = performance.now();
          this.lastPlaybackStart = { signal: "speech-synthesis-start", leadMs: 0 };
          onStart?.();
        };
        next.onboundary = (event: SpeechSynthesisEvent) => {
          if (utterance !== next) return;
          const elapsed = (performance.now() - startTime.value) / 1000;
          const idx = Math.min(event.charIndex, charStartTimes.length - 1);
          if (idx >= 0) charStartTimes[idx] = elapsed;
        };
        next.onend = () => {
          if (utterance !== next) return;
          const totalDuration = (performance.now() - startTime.value) / 1000;
          finish(() => {
            onTimings?.({ charStartTimes, charDurations, totalDuration });
            onEnd?.();
          });
        };
        next.onerror = (event) => {
          if (utterance !== next) return;
          const error = new Error(`SpeechSynthesis error: ${event.error}`);
          finish(() => onError?.(error), error);
        };
        this.currentUtterance = next;
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(next);
      };

      // Firefox and Chromium drop an utterance spoken in the same turn as
      // cancel(), and pause() leaves the engine stuck so onstart never fires.
      // One fresh utterance on a later turn recovers. The give-up stays at
      // 2.5s so a dead engine cannot stall the lecture.
      const giveUp = () => {
        cancelOwnedUtterance();
        const error = new Error("Browser speech did not start");
        finish(() => onError?.(error), error);
      };
      const start = () => {
        if (settled) return;
        claimBrowserSpeech(this);
        // cancel() does not clear the browser's paused flag.
        window.speechSynthesis.resume();
        watches.push(setTimeout(() => {
          if (settled || browserSpeechOwner !== this || this.playing) return;
          cancelOwnedUtterance();
          watches.push(setTimeout(() => {
            if (settled || browserSpeechOwner !== this) return;
            try { speakNow(); } catch (error) { finish(() => onError?.(error), error); }
          }, 0));
        }, 400));
        watches.push(setTimeout(() => { if (!settled) giveUp(); }, 2_500));
        try { speakNow(); } catch (error) { finish(() => onError?.(error), error); }
      };
      if (browserSpeechOwner) browserSpeechWaiters.push({ client: this, start });
      else start();
    });
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = clampPlaybackRate(rate);
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  pause(): void {
    this.cancelUtterance?.();
    this.playing = false;
    this.currentUtterance = null;
  }

  resume(): void {
    this.unlockAudio();
  }

  stop(): void {
    this.cancelUtterance?.();

    this.playing = false;
    this.currentUtterance = null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  async playAudio(_bytes: Uint8Array, _options: { onStart?: () => void } = {}): Promise<void> {
    // Browser speech synthesis cannot replay captured bytes.
  }

  getPlaybackPositionMs(): number | null {
    return null;
  }
}
