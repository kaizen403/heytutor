import { speechAudioMimeType } from "./audioFormat";
import {
  DEFAULT_VOICE_KEY,
  DEFAULT_VOICE_PREFERENCES,
  TTS_LANG_HEADER,
  type TutorVoiceKey,
  type TutorVoicePreferences,
} from "./voiceLanguage";
import { TUTOR_VOICE_SETTINGS, type TutorVoiceSettings } from "./voiceSettings";
import { mathToSpeech } from "./speechNotation";
import {
  applyHtmlAudioMute,
  applyHtmlAudioPlaybackRate,
  clampPlaybackRate,
} from "./playbackRate";
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
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: unknown) => void;
  onTimings?: (timings: AudioTimings) => void;
  onAudioCaptured?: (audio: { bytes: Uint8Array; mimeType: string }) => void;
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

interface ElevenLabsClientOptions {
  proxyUrl: string;
  streamUrl?: string;
  modelId?: string;
}

const DEFAULT_VOICE_SETTINGS = TUTOR_VOICE_SETTINGS;

/**
 * Narration to spoken text. The rules and the measurements behind them live in
 * `speechNotation.ts`; it is re-exported here because every caller in the app
 * and every verify gate imports it from this module.
 */
export { mathToSpeech };

interface AlignmentPayload {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

interface TimestampChunkPayload {
  audio?: string;
  audio_base64?: string;
  alignment?: AlignmentPayload;
}

function readStreamAudioBase64(payload: TimestampChunkPayload | null): string | undefined {
  if (!payload) {
    return undefined;
  }

  return payload.audio_base64 ?? payload.audio;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

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

function parseTimestampPayload(line: string): TimestampChunkPayload | null {
  const trimmed = line.trim();

  if (!trimmed) {
    return null;
  }

  const jsonString = trimmed.startsWith("data: ") ? trimmed.slice(6).trim() : trimmed;

  if (!jsonString.startsWith("{")) {
    return null;
  }

  try {
    return JSON.parse(jsonString) as TimestampChunkPayload;
  } catch {
    return null;
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

export class HttpSpeechClient implements TTSClient {
  private proxyUrl: string;
  private streamUrl: string;
  private modelId?: string;
  private currentAudioEl: HTMLAudioElement | null = null;
  private playing = false;
  private paused = false;
  private playbackRate = 1.0;
  private muted = false;
  private voicePreferences: TutorVoicePreferences = { ...DEFAULT_VOICE_PREFERENCES };

  constructor(options: ElevenLabsClientOptions) {
    this.proxyUrl = options.proxyUrl;
    this.streamUrl = options.streamUrl ?? "/api/tts/stream";
    this.modelId = options.modelId;
  }

  setVoicePreferences(preferences: TutorVoicePreferences): void {
    this.voicePreferences = { ...preferences };
  }

  async prewarm(_options?: PrewarmOptions): Promise<void> {
    // HTMLAudioElement does not require pre-warming.
  }

  unlockAudio(): void {
    // No AudioContext on the HTTP client path.
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.currentAudioEl) {
      applyHtmlAudioMute(this.currentAudioEl, muted);
    }
  }

  async speak({ text, onStart, onEnd, onError, onTimings }: SpeakOptions): Promise<void> {
    return this.speakSegment(text, { onStart, onEnd, onError, onTimings });
  }

  async speakSegment(
    text: string,
    {
      previousText,
      nextText,
      traceId,
      sessionId,
      onStart,
      onEnd,
      onError,
      onTimings,
      onAudioCaptured,
      voiceSettings,
    }: SpeakSegmentOptions = {},
  ): Promise<void> {
    const spokenText = mathToSpeech(text.trim());

    if (spokenText.length === 0) {
      onEnd?.();
      return;
    }

    try {
      const streamed = await this.streamAndPlaySegment(spokenText, {
        previousText,
        nextText,
        traceId,
        sessionId,
        onStart,
        onEnd,
        onTimings,
        onAudioCaptured,
        voiceSettings,
      });

      if (streamed) {
        return;
      }

      throw new Error("TTS stream returned no audio");
    } catch (error) {
      this.playing = false;
      onError?.(error);

      const fallback = new SpeechSynthesisTTSClient();
      await fallback.speakSegment(spokenText, {
        traceId,
        sessionId,
        onStart,
        onEnd,
        onTimings,
      });
    }
  }

  private async streamAndPlaySegment(
    spokenText: string,
    options: SpeakSegmentOptions,
  ): Promise<boolean> {
    const response = await fetch(this.streamUrl, {
      method: "POST",
      headers: buildTtsHeaders(options, this.voicePreferences.voiceKey),
      body: JSON.stringify({
        text: spokenText,
        low_latency: this.voicePreferences.lowLatency,
        model_id: this.modelId,
        voice_settings: options.voiceSettings ?? DEFAULT_VOICE_SETTINGS,
        previous_text: options.previousText,
        next_text: options.nextText,
      }),
    });

    if (!response.ok) {
      throw new Error(`TTS stream error ${response.status}`);
    }

    if (!response.body) {
      throw new Error("TTS stream returned no body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let sseBuffer = "";
    let collectedAny = false;
    let chunkOffsetSec = 0;
    const capturedChunks: Uint8Array[] = [];
    const timings: AudioTimings = {
      charStartTimes: [],
      charDurations: [],
      totalDuration: 0,
    };

    const collectChunk = (audioBase64: string, payload: TimestampChunkPayload) => {
      const bytes = base64ToUint8Array(audioBase64);
      capturedChunks.push(bytes);
      chunkOffsetSec = mergeAudioTimingChunk(timings, {
        startTimesSec: payload.alignment?.character_start_times_seconds,
        endTimesSec: payload.alignment?.character_end_times_seconds,
      }, chunkOffsetSec);
      collectedAny = true;
    };

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split(/\r?\n/);
      sseBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const payload = parseTimestampPayload(line);
        const audioBase64 = readStreamAudioBase64(payload);

        if (!audioBase64 || !payload) {
          continue;
        }

        collectChunk(audioBase64, payload);
      }
    }

    if (sseBuffer.trim()) {
      const payload = parseTimestampPayload(sseBuffer);
      const audioBase64 = readStreamAudioBase64(payload);

      if (audioBase64 && payload) {
        collectChunk(audioBase64, payload);
      }
    }

    if (!collectedAny) {
      return false;
    }

    if (timings.charStartTimes.length > 0) {
      options.onTimings?.(timings);
    }

    if (capturedChunks.length > 0) {
      options.onAudioCaptured?.({
        bytes: concatUint8Arrays(capturedChunks),
        mimeType: speechAudioMimeType(capturedChunks[0]),
      });
    }

    const merged = concatUint8Arrays(capturedChunks);
    const blob = new Blob([merged], { type: speechAudioMimeType(merged) });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    applyHtmlAudioPlaybackRate(audio, this.playbackRate);
    applyHtmlAudioMute(audio, this.muted);
    this.currentAudioEl = audio;

    await new Promise<void>((resolve) => {
      const finish = () => {
        URL.revokeObjectURL(url);
        if (this.currentAudioEl === audio) {
          this.currentAudioEl = null;
          this.playing = false;
        }
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      this.playing = true;
      options.onStart?.();
      void audio.play().catch(finish);
    });

    options.onEnd?.();
    return true;
  }

  async playAudio(bytes: Uint8Array, options: { onStart?: () => void } = {}): Promise<void> {
    const buffer = new ArrayBuffer(bytes.byteLength);
    const copy = new Uint8Array(buffer);
    copy.set(bytes);
    const blob = new Blob([buffer], { type: speechAudioMimeType(new Uint8Array(buffer)) });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    applyHtmlAudioPlaybackRate(audio, this.playbackRate);
    applyHtmlAudioMute(audio, this.muted);
    this.currentAudioEl = audio;

    await new Promise<void>((resolve) => {
      const finish = () => {
        URL.revokeObjectURL(url);
        if (this.currentAudioEl === audio) {
          this.currentAudioEl = null;
          this.playing = false;
        }
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      this.playing = true;
      options.onStart?.();
      void audio.play().catch(finish);
    });
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = clampPlaybackRate(rate);
    if (this.currentAudioEl) {
      applyHtmlAudioPlaybackRate(this.currentAudioEl, this.playbackRate);
    }
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  pause(): void {
    this.paused = true;
    this.currentAudioEl?.pause();
    // Also silence any browser-speech fallback path if layered.
    if (typeof window !== "undefined") {
      window.speechSynthesis?.pause();
      window.speechSynthesis?.cancel();
    }
  }

  resume(): void {
    this.paused = false;
    void this.currentAudioEl?.play().catch(() => undefined);
  }

  stop(): void {
    if (this.currentAudioEl) {
      this.currentAudioEl.pause();
      this.currentAudioEl = null;
    }
    this.playing = false;
    this.paused = false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  getPlaybackPositionMs(): number | null {
    const audio = this.currentAudioEl;
    if (!audio) {
      return null;
    }
    return audio.currentTime * 1000;
  }
}

export class SpeechSynthesisTTSClient implements TTSClient {
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
    if (typeof window === "undefined" || !window.speechSynthesis) {
      onError?.(new Error("SpeechSynthesis not available"));
      return;
    }

    const spokenText = mathToSpeech(text.trim());

    if (spokenText.length === 0) {
      onEnd?.();
      return;
    }

    void recordBrowserFallbackTts(spokenText, { traceId, sessionId });

    this.stop();
    // cancel() does not clear the browser's paused flag. A previous lecture
    // pause otherwise leaves every fallback utterance queued forever.
    window.speechSynthesis.resume();
    await new Promise<void>((resolve) => {
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
      const finish = (notify?: () => void) => {
        if (settled) return;
        settled = true;
        clearWatches();
        detach();
        this.playing = false;
        this.currentUtterance = null;
        this.cancelUtterance = null;
        try { notify?.(); } finally { resolve(); }
      };
      this.cancelUtterance = () => finish();

      const startTime = { value: 0 };
      const charStartTimes: number[] = new Array(spokenText.length).fill(0);
      const charDurations: number[] = new Array(spokenText.length).fill(0.06);

      const speakNow = () => {
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
          finish(() => onError?.(new Error(`SpeechSynthesis error: ${event.error}`)));
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
        finish(() => onError?.(new Error("Browser speech did not start")));
        window.speechSynthesis.cancel();
      };
      watches.push(setTimeout(() => {
        if (settled) return;
        window.speechSynthesis.resume();
        watches.push(setTimeout(() => {
          if (settled) return;
          try {
            speakNow();
          } catch (error) {
            finish(() => onError?.(error));
          }
        }, 0));
      }, 400));
      watches.push(setTimeout(() => {
        if (!settled) giveUp();
      }, 2_500));

      try {
        speakNow();
      } catch (error) {
        finish(() => onError?.(error));
      }
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
    if (typeof window !== "undefined" && window.speechSynthesis) {
      // Chromium frequently keeps talking through pause(), and Firefox leaves
      // the engine paused after cancel() so the next sentence never starts.
      // cancel() is the mute; resume() clears the stuck flag.
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    }
    this.playing = false;
    this.currentUtterance = null;
  }

  resume(): void {
    this.unlockAudio();
  }

  stop(): void {
    this.cancelUtterance?.();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    }

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
