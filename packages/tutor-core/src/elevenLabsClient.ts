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
}

export interface TTSClient {
  speak(options: SpeakOptions): Promise<void>;
  speakSegment(text: string, options?: SpeakSegmentOptions): Promise<void>;
  playAudio(bytes: Uint8Array, options?: { onStart?: () => void }): Promise<void>;
  prewarm(options?: PrewarmOptions): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  get isPlaying(): boolean;
  /**
   * Current playback position of the actively-speaking segment, in milliseconds from
   * the moment its audio became audible. Returns null when no position is known.
   * Negative values mean the audio is scheduled but not yet audible. Used to keep the
   * whiteboard writing synced to the true audio clock (not wall-clock at onStart).
   */
  getPlaybackPositionMs(): number | null;
}

interface ElevenLabsClientOptions {
  proxyUrl: string;
  streamUrl?: string;
  modelId?: string;
}

const DEFAULT_MODEL = "eleven_flash_v2_5";
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
};

export function mathToSpeech(text: string): string {
  return text
    .replace(/(\w)\u00b2/g, "$1 squared")
    .replace(/(\w)\u00b3/g, "$1 cubed")
    .replace(/\u221a(\d+)/g, "square root of $1")
    .replace(/\u03c0/g, "pi")
    .replace(/\u03b8/g, "theta")
    .replace(/\bsin\b/gi, "sine")
    .replace(/\bcos\b/gi, "cosine")
    .replace(/\btan\b/gi, "tangent")
    .replace(/\u00d7/g, " times ")
    .replace(/\u00f7/g, " divided by ")
    .replace(/\u2211/g, " sum of ")
    .replace(/\u222b/g, " integral of ")
    .replace(/\^2/g, " squared")
    .replace(/\^3/g, " cubed")
    .replace(/\^/g, " to the power of ");
}

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

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function buildTtsHeaders(options: Pick<SpeakSegmentOptions, "traceId" | "sessionId">): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
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

function mergeTimings(existing: AudioTimings, chunk: TimestampChunkPayload): AudioTimings {
  const align = chunk.alignment;

  if (!align) {
    return existing;
  }

  mergeAudioTimingChunk(existing, {
    startTimesSec: align.character_start_times_seconds,
    endTimesSec: align.character_end_times_seconds,
  });

  return existing;
}

export class ElevenLabsTTSClient implements TTSClient {
  private proxyUrl: string;
  private streamUrl: string;
  private modelId: string;
  private audioContext: AudioContext | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private playing = false;
  private started = false;
  private paused = false;

  constructor(options: ElevenLabsClientOptions) {
    this.proxyUrl = options.proxyUrl;
    this.streamUrl = options.streamUrl ?? "/api/tts/stream";
    this.modelId = options.modelId ?? DEFAULT_MODEL;
  }

  async prewarm(_options?: PrewarmOptions): Promise<void> {
    await this.ensureAudioContext();
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
      headers: buildTtsHeaders(options),
      body: JSON.stringify({
        text: spokenText,
        model_id: this.modelId,
        voice_settings: DEFAULT_VOICE_SETTINGS,
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

    const ctx = await this.ensureAudioContext();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let sseBuffer = "";
    let playedAny = false;
    let scheduledEnd = ctx.currentTime;
    let chunkOffsetSec = 0;
    const sourceDonePromises: Promise<void>[] = [];
    const capturedChunks: Uint8Array[] = [];
    const timings: AudioTimings = {
      charStartTimes: [],
      charDurations: [],
      totalDuration: 0,
    };

    const scheduleChunk = async (audioBase64: string, payload: TimestampChunkPayload) => {
      if (!this.started) {
        this.started = true;
        this.playing = true;
        options.onStart?.();
      }

      const bytes = base64ToUint8Array(audioBase64);
      capturedChunks.push(bytes);
      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer);

      chunkOffsetSec = mergeTimings(timings, payload).totalDuration;

      const startAt = Math.max(ctx.currentTime + 0.15, scheduledEnd);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const donePromise = new Promise<void>((resolve) => {
        source.onended = () => {
          this.activeSources = this.activeSources.filter((node) => node !== source);

          if (this.activeSources.length === 0) {
            this.playing = false;
            options.onEnd?.();
          }

          resolve();
        };
      });

      this.activeSources.push(source);
      source.start(startAt);
      scheduledEnd = startAt + audioBuffer.duration;
      sourceDonePromises.push(donePromise);
      playedAny = true;
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

        if (!audioBase64) {
          continue;
        }

        await scheduleChunk(audioBase64, payload!);
      }
    }

    if (sseBuffer.trim()) {
      const payload = parseTimestampPayload(sseBuffer);
      const audioBase64 = readStreamAudioBase64(payload);

      if (audioBase64) {
        await scheduleChunk(audioBase64, payload!);
      }
    }

    if (!playedAny) {
      return false;
    }

    if (timings.charStartTimes.length > 0) {
      options.onTimings?.(timings);
    }

    if (capturedChunks.length > 0) {
      options.onAudioCaptured?.({
        bytes: concatUint8Arrays(capturedChunks),
        mimeType: "audio/mpeg",
      });
    }

    await Promise.all(sourceDonePromises);
    return true;
  }

  async playAudio(bytes: Uint8Array, options: { onStart?: () => void } = {}): Promise<void> {
    const ctx = await this.ensureAudioContext();
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    await new Promise<void>((resolve) => {
      source.onended = () => {
        this.activeSources = this.activeSources.filter((node) => node !== source);

        if (this.activeSources.length === 0) {
          this.playing = false;
        }

        resolve();
      };

      this.activeSources.push(source);
      this.playing = true;
      this.started = true;
      options.onStart?.();
      source.start();
    });
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    if (this.audioContext.state === "suspended" && !this.paused) {
      try {
        await this.audioContext.resume();
      } catch {
        // Autoplay policy: resume will succeed after user gesture
      }
    }

    return this.audioContext;
  }

  pause(): void {
    this.paused = true;
    void this.audioContext?.suspend();
  }

  resume(): void {
    this.paused = false;
    void this.audioContext?.resume();
  }

  stop(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }

    this.activeSources = [];
    this.playing = false;
    this.started = false;
    this.paused = false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  getPlaybackPositionMs(): number | null {
    return null;
  }
}

export class SpeechSynthesisTTSClient implements TTSClient {
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private playing = false;

  async prewarm(_options?: PrewarmOptions): Promise<void> {
    // SpeechSynthesis has no connection to warm.
  }

  async speak(options: SpeakOptions): Promise<void> {
    return this.speakSegment(options.text, options);
  }

  async speakSegment(
    text: string,
    { traceId, sessionId, onStart, onEnd, onError, onTimings, onAudioCaptured }: SpeakSegmentOptions = {},
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

    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const preferredVoice =
        voices.find((voice) => voice.lang.startsWith("en") && voice.name.includes("Google")) ??
        voices.find((voice) => voice.lang.startsWith("en"));

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      const startTime = { value: 0 };
      const charStartTimes: number[] = new Array(spokenText.length).fill(0);
      const charDurations: number[] = new Array(spokenText.length).fill(0.06);

      utterance.onstart = () => {
        this.playing = true;
        startTime.value = performance.now();
        onStart?.();
      };

      utterance.onboundary = (event: SpeechSynthesisEvent) => {
        const elapsed = (performance.now() - startTime.value) / 1000;
        const idx = Math.min(event.charIndex, charStartTimes.length - 1);

        if (idx >= 0) {
          charStartTimes[idx] = elapsed;
        }
      };

      utterance.onend = () => {
        this.playing = false;
        this.currentUtterance = null;
        const totalDuration = (performance.now() - startTime.value) / 1000;
        onTimings?.({ charStartTimes, charDurations, totalDuration });
        onEnd?.();
        resolve();
      };

      utterance.onerror = (event) => {
        this.playing = false;
        this.currentUtterance = null;
        onError?.(new Error(`SpeechSynthesis error: ${event.error}`));
        resolve();
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  pause(): void {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.pause();
    }
  }

  resume(): void {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.resume();
    }
  }

  stop(): void {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
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

