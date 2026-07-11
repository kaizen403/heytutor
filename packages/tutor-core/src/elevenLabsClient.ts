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

/** Insert spaces so `cosθ` and `2θ` tokenize like spoken math. */
function spaceGreekMathSymbols(text: string): string {
  return text
    .replace(/([a-z])([\u03b1-\u03c9])/gi, "$1 $2")
    .replace(/([\u03b1-\u03c9])([a-z0-9])/gi, "$1 $2")
    .replace(/(\d)([\u03b1-\u03c9])/g, "$1 $2");
}

export function mathToSpeech(text: string): string {
  return spaceGreekMathSymbols(text)
    .replace(/([A-Z][a-z]?)_(\d+)/g, "$1 $2 ")
    .replace(/([A-Za-z0-9]+)\^(\d+)([-+])/g, (_m, formula: string, num: string, sign: string) =>
      `${formula} ${num} ${sign === "-" ? "minus" : "plus"} `)
    .replace(/([A-Z]\w*)\+/g, "$1 plus ")
    .replace(/([A-Z]\w*)-(?=\s|,|\.|;|$)/g, "$1 minus ")
    .replace(/⇌/g, " reversible ")
    .replace(/([A-Z][a-z])\s*→/g, "$1 gives ")
    .replace(/([a-z])\s*→/g, "$1 approaches ")
    .replace(/→/g, " gives ")
    .replace(/\(s\)/g, " solid ")
    .replace(/\(l\)/g, " liquid ")
    .replace(/\(g\)/g, " gas ")
    .replace(/\(aq\)/g, " aqueous ")
    .replace(/°C/g, " degrees Celsius ")
    .replace(/°F/g, " degrees Fahrenheit ")
    .replace(/°/g, " degrees ")
    .replace(/\bmol\b/g, " mole ")
    .replace(/(\d)\s+M\b/g, "$1 molar ")
    .replace(/\bd\/dx\b/g, " d d x ")
    .replace(/\bd\/dt\b/g, " d d t ")
    .replace(/∂\/∂(\w)/g, " partial d d $1 ")
    .replace(/∂/g, " partial ")
    .replace(/\b[Ll]im\b/g, " limit ")
    .replace(/∞/g, " infinity ")
    .replace(/≤/g, " less than or equal to ")
    .replace(/≥/g, " greater than or equal to ")
    .replace(/≠/g, " not equal to ")
    .replace(/≈/g, " approximately ")
    .replace(/±/g, " plus or minus ")
    .replace(/sqrt\(([^)]+)\)/g, " square root of $1 ")
    .replace(/\bcsc\b/g, " cosecant ")
    .replace(/\bsec\b/g, " secant ")
    .replace(/\bcot\b/g, " cotangent ")
    .replace(/(\w)''/g, "$1 double prime ")
    .replace(/(\w)'/g, "$1 prime ")
    .replace(/∇/g, " del ")
    .replace(/\u221a\(([^)]+)\)/g, " square root of ($1) ")
    .replace(/\u222e/g, " contour integral of ")
    .replace(/\u220f/g, " product of ")
    .replace(/\u2261/g, " is identical to ")
    .replace(/\u221d/g, " is proportional to ")
    .replace(/\u2234/g, " therefore ")
    .replace(/\u2235/g, " because ")
    .replace(/\u2209/g, " does not belong to ")
    .replace(/\u2208/g, " belongs to ")
    .replace(/\u2286/g, " is a subset of or equal to ")
    .replace(/\u2282/g, " is a subset of ")
    .replace(/\u2287/g, " is a superset of or equal to ")
    .replace(/\u2283/g, " is a superset of ")
    .replace(/\u222a/g, " union ")
    .replace(/\u2229/g, " intersection ")
    .replace(/\u2205/g, " the empty set ")
    .replace(/\u2200/g, " for all ")
    .replace(/\u2203/g, " there exists ")
    .replace(/\u2220/g, " angle ")
    .replace(/[\u27c2\u22a5]/g, " perpendicular to ")
    .replace(/\u2225/g, " parallel to ")
    .replace(/\u2194/g, " ")
    .replace(/\u2190/g, " ")
    .replace(/\u21d2/g, " implies ")
    .replace(/\u21d0/g, " ")
    .replace(/\u2213/g, " minus or plus ")
    .replace(/[\u00b7\u22c5\u2219]/g, " times ")
    .replace(/∫∫/g, " double integral of ")
    .replace(/\blog\b/g, " log ")
    .replace(/\bln\b/g, " natural log ")
    .replace(/\bexp\b/g, " e to the power of ")
    .replace(/(\w)\u00b2/g, "$1 squared")
    .replace(/(\w)\u00b3/g, "$1 cubed")
    .replace(/\u221a(\d+)/g, "square root of $1")
    .replace(/\u221a/g, " square root of ")
    .replace(/\u03c0/g, "pi")
    .replace(/\u03b8/g, "theta")
    .replace(/\u03bc/g, "mu")
    .replace(/\u03bb/g, "lambda")
    .replace(/\u03c1/g, "rho")
    .replace(/\u0394/g, "delta")
    .replace(/\u03bd/g, "nu")
    .replace(/\u03c9/g, "omega")
    .replace(/\u03a9/g, "omega")
    .replace(/\u03a3/g, "sigma")
    .replace(/\u03c6/g, "phi")
    .replace(/\u03c8/g, "psi")
    .replace(/\u03b1/g, "alpha")
    .replace(/\u03b2/g, "beta")
    .replace(/\u03b3/g, "gamma")
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

export class ElevenLabsTTSClient implements TTSClient {
  private proxyUrl: string;
  private streamUrl: string;
  private modelId: string;
  private currentAudioEl: HTMLAudioElement | null = null;
  private playing = false;
  private paused = false;
  private playbackRate = 1.0;

  constructor(options: ElevenLabsClientOptions) {
    this.proxyUrl = options.proxyUrl;
    this.streamUrl = options.streamUrl ?? "/api/tts/stream";
    this.modelId = options.modelId ?? DEFAULT_MODEL;
  }

  async prewarm(_options?: PrewarmOptions): Promise<void> {
    // HTMLAudioElement does not require pre-warming.
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
        mimeType: "audio/mpeg",
      });
    }

    const merged = concatUint8Arrays(capturedChunks);
    const blob = new Blob([merged], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preservesPitch = true;
    audio.playbackRate = this.playbackRate;
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
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preservesPitch = true;
    audio.playbackRate = this.playbackRate;
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
    this.playbackRate = Math.max(rate, 0.1);
    if (this.currentAudioEl) {
      this.currentAudioEl.playbackRate = this.playbackRate;
    }
  }

  pause(): void {
    this.paused = true;
    this.currentAudioEl?.pause();
  }

  resume(): void {
    this.paused = false;
    void this.currentAudioEl?.play();
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
  private playing = false;
  private playbackRate = 1.0;

  async prewarm(_options?: PrewarmOptions): Promise<void> {
    // SpeechSynthesis has no connection to warm.
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

    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.rate = this.playbackRate;
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

  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(rate, 0.1);
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

