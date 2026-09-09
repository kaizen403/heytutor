import {
  DEFAULT_VOICE_PREFERENCES,
  TTS_LANG_QUERY,
  type TutorVoicePreferences,
} from "./voiceLanguage";
import type { AudioTimings, PrewarmOptions, SpeakSegmentOptions, TTSClient } from "./elevenLabsClient";
import {
  SpeechSynthesisTTSClient,
  mergeAudioTimingChunk,
  mathToSpeech,
  toSegmentRelativeAudioTimings,
} from "./elevenLabsClient";
import { tutorDebug } from "../tutorDebug";
import {
  isCrossOriginWebSocket,
  resolveApiUrl,
  resolveWebSocketUrl,
} from "../publicOrigins";
import {
  canConcatAudioBuffers,
  concatDecodedAudioBuffers,
  nextScheduleStartSec,
} from "./playbackSchedule";
import { createLectureAudioContext, releaseLectureAudioContext } from "./audioContext";
import { TUTOR_VOICE_SETTINGS } from "./voiceSettings";
import {
  applyBufferSourcePlaybackRate,
  applyHtmlAudioMute,
  applyHtmlAudioPlaybackRate,
  clampPlaybackRate,
  createRateMediaClock,
  mediaPositionSec,
  remainingWallSec,
  setRateMediaClockRate,
  startRateMediaClock,
  type RateMediaClock,
} from "./playbackRate";
import {
  createHttpTtsGate,
  MAX_HTTP_PREFETCH,
  parseRetryAfterSec,
  ttsHttpRetryDelayMs,
} from "./httpTtsPolicy";

interface TimestampChunkPayload {
  audio?: string;
  audio_base64?: string;
  alignment?: {
    character_start_times_seconds?: number[];
    character_end_times_seconds?: number[];
    charStartTimesMs?: number[];
    charDurationsMs?: number[];
  };
  normalizedAlignment?: {
    charStartTimesMs?: number[];
    charDurationsMs?: number[];
  };
  isFinal?: boolean;
  is_final?: boolean;
  contextId?: string;
  context_id?: string;
}

interface SegmentJob {
  spokenText: string;
  options: SpeakSegmentOptions;
  /**
   * Upstream context carrying this job's chunks. Bound on the first message
   * that names a context id, in the order the texts were sent, so several
   * sentences can generate at once without their audio getting crossed.
   */
  contextId?: string;
  /**
   * A prefetched sentence is generated ahead of the lesson and waits; only a
   * job the segment runner has actually asked to speak may become current.
   */
  claimed: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
  settled: boolean;
  textSent: boolean;
  playbackStarted: boolean;
  /** ctx.currentTime (seconds) when this job's first audio source begins playing. */
  audibleStartCtxTime?: number;
  timingsEmitted: boolean;
  contextFinal: boolean;
  timings: AudioTimings;
  capturedChunks: Uint8Array[];
  pendingAudioBuffers: AudioBuffer[];
  sourceDonePromises: Promise<void>[];
  pendingAudioIngestPromises: Promise<void>[];
  started: boolean;
  receivedAudio: boolean;
  decodedAudio: boolean;
  chunkOffsetSec: number;
  startedAt: number;
}

const HTTP_STREAM_URL = "/api/tts/stream";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_VOICE_SETTINGS = TUTOR_VOICE_SETTINGS;
/** Fail over to HTTP quickly; a 5s connect wait after every sentence stalls the teacher. */
export const TTS_WS_CONNECT_TIMEOUT_MS = 1_200;
/** After a connect failure, skip WebSocket for this long and use HTTP immediately. */
export const TTS_WS_DISABLE_AFTER_FAIL_MS = 120_000;
/**
 * Sentences generated ahead of the one being spoken, each on its own context.
 *
 * One covers an ordinary beat, which runs for seconds against a sentence that
 * generates in well under one. Two covers the short beats between them — a
 * one-line emphasis, a five-word aside — where a single sentence of cover is
 * not enough and the seam is audible. Past two, a cancelled turn starts
 * throwing away work for no gain the student can hear.
 */
export const TTS_WS_LOOKAHEAD_SEGMENTS = 2;

interface HttpPrefetch {
  spokenText: string;
  controller: AbortController;
  done: Promise<void>;
  buffers: AudioBuffer[];
  chunks: Uint8Array[];
  timings: AudioTimings;
  error?: unknown;
  /** True until the audio is in hand. Only these count against the cap. */
  generating: boolean;
}

function readAudioBase64(chunk: TimestampChunkPayload): string | undefined {
  return chunk.audio_base64 ?? chunk.audio;
}

function mergeChunkTimings(timings: AudioTimings, chunk: TimestampChunkPayload, chunkOffsetSec: number): number {
  const alignment = chunk.alignment;
  const normalized = chunk.normalizedAlignment;

  if (alignment?.character_start_times_seconds) {
    return mergeAudioTimingChunk(timings, {
      startTimesSec: alignment.character_start_times_seconds,
      endTimesSec: alignment.character_end_times_seconds,
    }, chunkOffsetSec);
  }

  return mergeAudioTimingChunk(timings, {
    startTimesMs: normalized?.charStartTimesMs ?? alignment?.charStartTimesMs,
    durationsMs: normalized?.charDurationsMs ?? alignment?.charDurationsMs,
  }, chunkOffsetSec);
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

function parseHttpTimestampPayload(line: string): TimestampChunkPayload | null {
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

function getWebSocketUrl(
  path: string,
  traceId?: string,
  sessionId?: string,
  voiceSpeed?: number,
  ticket?: string,
  preferences: TutorVoicePreferences = DEFAULT_VOICE_PREFERENCES,
): string {
  const base = resolveWebSocketUrl(path, traceId, sessionId, ticket);
  const params: string[] = [];
  if (voiceSpeed && voiceSpeed !== 1) {
    params.push(`speed=${voiceSpeed}`);
  }
  // The relay resolves the voice id from this key; ids never reach the browser.
  params.push(`${TTS_LANG_QUERY}=${encodeURIComponent(preferences.voiceKey)}`);
  if (preferences.lowLatency) {
    params.push("model=flash");
  }
  if (params.length === 0) {
    return base;
  }
  return `${base}${base.includes("?") ? "&" : "?"}${params.join("&")}`;
}

async function fetchWsAuthTicket(): Promise<string | undefined> {
  if (!isCrossOriginWebSocket()) {
    return undefined;
  }

  try {
    const response = await fetch(resolveApiUrl("/api/tts/ws-ticket"), {
      credentials: "include",
    });
    if (!response.ok) {
      return undefined;
    }
    const data = (await response.json()) as { ticket?: string };
    return typeof data.ticket === "string" && data.ticket.length > 0
      ? data.ticket
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * ElevenLabs generation speed. Lecture playback rate is separate: it retimes
 * already-produced audio so a mid-lesson slider change takes effect now.
 */
function clampVoiceSpeed(rate: number): number {
  return Math.min(Math.max(rate, 0.7), 1.2);
}

export function hasPlayableSegmentAudio(state: {
  receivedAudio: boolean;
  decodedAudio: boolean;
  capturedChunkCount: number;
}): boolean {
  return state.receivedAudio && state.decodedAudio && state.capturedChunkCount > 0;
}

/**
 * Never treat a short network silence as the end of a spoken segment.
 * Complete only after the provider's context-final event, and only once
 * the already-scheduled audio has finished playing.
 */
export function shouldCompleteTtsJobAfterSilence(options: {
  contextFinal: boolean;
  scheduledEnd: number;
  currentTime: number;
}): boolean {
  return options.contextFinal && options.scheduledEnd <= options.currentTime + 0.1;
}

function parseWsPayload(data: string): TimestampChunkPayload | { type?: string; message?: string } | null {
  try {
    return JSON.parse(data) as TimestampChunkPayload | { type?: string; message?: string };
  } catch {
    return null;
  }
}

export class ElevenLabsWebSocketTTSClient implements TTSClient {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private outputGain: GainNode | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private playing = false;
  private connectPromise: Promise<void> | null = null;
  private scheduledEnd = 0;
  private connectedTraceId?: string;
  private connectedSessionId?: string;
  private speechFallback = new SpeechSynthesisTTSClient();
  private paused = false;
  private playbackRate = 1.0;
  private mediaClock: RateMediaClock = createRateMediaClock(1);
  private totalScheduledMediaSec = 0;
  private currentHtmlAudio: HTMLAudioElement | null = null;
  private muted = false;
  private voicePreferences: TutorVoicePreferences = { ...DEFAULT_VOICE_PREFERENCES };

  private jobs: SegmentJob[] = [];
  private currentJob: SegmentJob | null = null;
  /** Job currently receiving audio chunks from the WebSocket. */
  private chunkTargetJob: SegmentJob | null = null;
  /** Upstream context id -> the job whose sentence it is generating. */
  private jobsByContext = new Map<string, SegmentJob>();
  /** Fallback binding for a relay that numbers contexts itself, oldest first. */
  private unboundJobs: SegmentJob[] = [];
  /** Context numbering for this socket; the relay echoes it back. */
  private sentSegmentSequence = 0;
  private streamHandler: ((event: MessageEvent) => void) | null = null;
  private idleCompleteTimer: number | null = null;
  private watchdogTimer: number | null = null;
  /** Bumped by abandonSpeaking() so in-flight speakSegment work can bail out. */
  private speakGeneration = 0;
  /**
   * Set by stop() so an in-flight ensureAudioContext cannot mint a new graph
   * after the student (or pagehide) already silenced the lecture.
   */
  private halted = false;
  private httpStreamAbortController: AbortController | null = null;
  private httpControllers = new Set<AbortController>();
  private wsDisabledUntil = 0;
  private lastSuccessfulTransport: "ws" | "http" | null = null;
  private prefetches = new Map<string, HttpPrefetch>();
  /** HTTP playback origin so getPlaybackPositionMs works without a WS job. */
  private httpPlaybackOriginCtxTime: number | null = null;
  private readonly httpGate = createHttpTtsGate();

  async prewarm(options: PrewarmOptions = {}): Promise<void> {
    this.halted = false;
    await this.ensureAudioContext();

    const connectStart = performance.now();

    try {
      await this.ensureConnected(undefined, undefined, (info) => {
        options.onConnect?.(info);
      });
    } catch {
      options.onConnect?.({
        ms: performance.now() - connectStart,
        ok: false,
      });
    }
  }

  async speak(options: { text: string } & SpeakSegmentOptions): Promise<void> {
    return this.speakSegment(options.text, options);
  }

  prefetchSegment(text: string, options: SpeakSegmentOptions = {}): void {
    const spokenText = mathToSpeech(text.trim());
    if (!spokenText || this.paused || this.prefetches.has(spokenText)) {
      return;
    }
    // On the socket the next sentence gets a context of its own and starts
    // generating now, while this one is still being spoken.
    if (this.ws?.readyState === WebSocket.OPEN && Date.now() >= this.wsDisabledUntil) {
      this.prefetchOverWebSocket(spokenText, options);
      return;
    }
    // The cap is an ElevenLabs concurrency cap, so it counts sentences still
    // being generated. Counting a finished one too was refusing the lookahead
    // exactly when it was needed — the sentence about to be spoken still held
    // the only slot — and every second beat then waited ~2s in silence.
    let generating = 0;
    for (const entry of this.prefetches.values()) {
      if (entry.generating) generating += 1;
    }
    if (generating >= MAX_HTTP_PREFETCH) {
      return;
    }
    const controller = new AbortController();
    this.httpControllers.add(controller);
    const entry: HttpPrefetch = {
      spokenText,
      controller,
      buffers: [],
      chunks: [],
      timings: { charStartTimes: [], charDurations: [], totalDuration: 0 },
      done: Promise.resolve(),
      generating: true,
    };
    this.prefetches.set(spokenText, entry);
    entry.done = this.fillHttpPrefetch(entry, options).finally(() => {
      entry.generating = false;
      this.httpControllers.delete(controller);
    });
  }

  /**
   * Open a context for a sentence the lesson has not reached yet. The job sits
   * unclaimed in the queue collecting its audio; `speakSegment` claims it when
   * the runner gets there, and playback starts with no round trip at all.
   */
  private prefetchOverWebSocket(spokenText: string, options: SpeakSegmentOptions): void {
    if (this.jobs.some((job) => job.spokenText === spokenText && !job.settled)) {
      return;
    }
    // The head of the queue is the sentence being spoken, or the one the
    // runner is a step away from claiming; only what sits past it is
    // lookahead. Counting the head too refuses the request in exactly the
    // moment it pays for itself, and every second beat goes silent again.
    //
    // A sentence marks itself settled when its context closes and then keeps
    // playing for seconds, so it has to be counted while it drains — without
    // that, a slot opens mid-sentence and a later segment takes the lookahead
    // meant for the next one.
    const queued = this.jobs.filter((job) => !job.settled).length;
    const draining = this.currentJob && this.currentJob.settled ? 1 : 0;
    if (Math.max(queued + draining - 1, 0) >= TTS_WS_LOOKAHEAD_SEGMENTS) {
      return;
    }
    const job = this.createJob(spokenText, {
      traceId: options.traceId,
      sessionId: options.sessionId,
      previousText: options.previousText,
      nextText: options.nextText,
    });
    job.claimed = false;
    this.jobs.push(job);
    void this.pumpJobQueue();
  }

  /**
   * Hand a pre-generated sentence its real callbacks and let it speak. Timings
   * that arrived while it was still only a prefetch are replayed here, so the
   * handwriting schedule sees them as it would on any other segment.
   */
  private claimPrefetchedJob(job: SegmentJob, options: SpeakSegmentOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      job.claimed = true;
      job.options = options;
      job.resolve = resolve;
      job.reject = reject;
      job.timingsEmitted = false;
      this.emitTimings(job);
      tutorDebug("tts", "ws segment claimed from lookahead", {
        spoken_chars: job.spokenText.length,
        context_final: job.contextFinal,
        buffered_chunks: job.capturedChunks.length,
      });
      void this.pumpJobQueue();
    });
  }

  unlockAudio(): void {
    this.halted = false;
    this.paused = false;
    this.audioContext = this.audioContext ?? createLectureAudioContext();
    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume().then(() => {
        tutorDebug("tts", "audio unlocked", { state: this.audioContext?.state });
      });
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.speechFallback.setMuted?.(muted);
    if (this.outputGain) {
      this.outputGain.gain.value = muted ? 0 : 1;
    }
    if (this.currentHtmlAudio) {
      applyHtmlAudioMute(this.currentHtmlAudio, muted);
    }
  }

  private stopActiveAudio(reason: string, options?: { preserveHttp?: boolean }): void {
    if (!options?.preserveHttp) {
      this.abortHttpStream(reason);
    }
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.activeSources = [];
    this.playing = false;
    this.totalScheduledMediaSec = 0;
    this.mediaClock = createRateMediaClock(this.playbackRate);
    this.stopHtmlAudio();
    if (this.audioContext) {
      this.scheduledEnd = this.audioContext.currentTime;
    } else {
      this.scheduledEnd = 0;
    }
    this.speechFallback.stop();
    tutorDebug("tts", "stopActiveAudio", { reason });
  }

  private abortHttpStream(reason: string): void {
    for (const controller of this.httpControllers) {
      controller.abort();
    }
    this.httpControllers.clear();
    this.httpStreamAbortController = null;
    for (const prefetch of this.prefetches.values()) {
      prefetch.controller.abort();
    }
    this.prefetches.clear();
    tutorDebug("tts", "abortHttpStream", { reason });
  }

  async speakSegment(text: string, options: SpeakSegmentOptions = {}): Promise<void> {
    this.halted = false;
    const spokenText = mathToSpeech(text.trim());
    const generation = this.speakGeneration;

    if (spokenText.length === 0) {
      options.onEnd?.();
      return;
    }

    try {
    // Pause must silence immediately and must not start a fallback voice.
    if (!(await this.waitWhileUnpaused(generation))) {
      options.onEnd?.();
      return;
    }

    const ctx = await this.ensureAudioContext();
    if (ctx.state === "suspended") {
      // Intentional pause leaves the context suspended — wait, don't speak.
      if (this.paused) {
        if (!(await this.waitWhileUnpaused(generation))) {
          options.onEnd?.();
          return;
        }
      }

      const resumed = await this.ensureAudioContext();
      if (resumed.state === "suspended") {
        // WebAudio blocked (no gesture / autoplay). Browser speech still works.
        // Never use this path while paused — that would ignore the pause button.
        if (this.paused || this.speakGeneration !== generation) {
          options.onEnd?.();
          return;
        }
        tutorDebug("tts", "AudioContext suspended — using speechSynthesis fallback");
        this.stopActiveAudio("suspended-fallback");
        await this.speechFallback.speakSegment(spokenText, options);
        return;
      }
    }

    const allowWebSocket = Date.now() >= this.wsDisabledUntil;
    // A sentence already generating on its own context: no round trip left to
    // pay, so it takes precedence over every other way of producing audio.
    const lookaheadJob = allowWebSocket
      ? this.jobs.find(
          (job) => !job.claimed && !job.settled && job.spokenText === spokenText,
        ) ?? null
      : null;

    if (!lookaheadJob) {
      const prefetch = this.prefetches.get(spokenText);
      if (prefetch) {
        this.prefetches.delete(spokenText);
        try {
          await prefetch.done;
          if (!prefetch.error && (prefetch.buffers.length > 0 || prefetch.chunks.length > 0)) {
            await this.playPrefetchedHttp(prefetch, options, generation);
            return;
          }
        } catch {
          prefetch.controller.abort();
        }
      }
    }

    if (!lookaheadJob && allowWebSocket && this.shouldReconnect(options.traceId, options.sessionId)) {
      this.resetConnection();
    }

    if (!lookaheadJob && allowWebSocket) {
      try {
        await this.ensureConnected(options.traceId, options.sessionId);
      } catch {
        this.wsDisabledUntil = Date.now() + TTS_WS_DISABLE_AFTER_FAIL_MS;
        tutorDebug("tts", "websocket unavailable, using http for upcoming segments");
      }
    }

    if (this.speakGeneration !== generation) {
      return;
    }

    if (!(await this.waitWhileUnpaused(generation))) {
      options.onEnd?.();
      return;
    }

    let wsPlaybackStarted = false;
    if (allowWebSocket && this.ws?.readyState === WebSocket.OPEN) {
      const wsOptions: SpeakSegmentOptions = {
        ...options,
        onStart: () => {
          this.lastSuccessfulTransport = "ws";
          wsPlaybackStarted = true;
          options.onStart?.();
        },
      };
      try {
        await (lookaheadJob && !lookaheadJob.settled
          ? this.claimPrefetchedJob(lookaheadJob, wsOptions)
          : this.enqueueWebSocketSegment(spokenText, wsOptions));
        return;
      } catch (error) {
        if (this.speakGeneration !== generation) {
          return;
        }
        // Always mute leftover WS buffers before any fallback — otherwise HTTP
        // or speechSynthesis layers a second voice on top (user-reported echo).
        this.stopActiveAudio("ws-segment-failed", { preserveHttp: true });
        tutorDebug("tts", "websocket segment failed", {
          error: error instanceof Error ? error.message : String(error),
          playback_started: wsPlaybackStarted,
        });
        if (wsPlaybackStarted) {
          // Student already heard this segment; do not replay it.
          options.onEnd?.();
          return;
        }
        // Empty/failed WS audio was retrying every sentence (~500–800ms pause).
        this.wsDisabledUntil = Date.now() + TTS_WS_DISABLE_AFTER_FAIL_MS;
        this.lastSuccessfulTransport = "http";
        // Drop queued WS jobs so they cannot speak under HTTP fallback.
        this.rejectAllJobs(new Error("superseded by http fallback"));
        this.currentJob = null;
        this.chunkTargetJob = null;
        this.jobs = [];
      }
    }

    if (this.speakGeneration !== generation) {
      return;
    }

    if (!(await this.waitWhileUnpaused(generation))) {
      options.onEnd?.();
      return;
    }

    try {
      await this.streamHttpSegment(spokenText, options, generation);
    } catch (error) {
      if (this.speakGeneration !== generation) {
        return;
      }
      this.stopActiveAudio("http-segment-failed");
      tutorDebug("tts", "HTTP segment failed, trying speechSynthesis", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (this.paused) {
        options.onEnd?.();
        return;
      }
      try {
        await this.speechFallback.speakSegment(spokenText, options);
      } catch (fallbackError) {
        options.onError?.(fallbackError);
      }
    }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        options.onEnd?.();
        return;
      }
      throw error;
    }
  }

  /**
   * Abort stuck speech without closing the WebSocket permanently.
   * Clears audio sources and rejects queued jobs so the segment runner can continue.
   */
  abandonSpeaking(): void {
    this.speakGeneration += 1;
    this.clearTimers();
    this.detachStreamHandler();
    this.abortHttpStream("abandonSpeaking");
    this.stopActiveAudio("abandonSpeaking");

    const error = new Error("tts segment abandoned");
    if (this.currentJob && !this.currentJob.settled) {
      this.currentJob.settled = true;
      this.currentJob.reject(error);
    }
    this.rejectAllJobs(error);
    this.currentJob = null;
    this.chunkTargetJob = null;
    tutorDebug("tts", "abandonSpeaking");
  }

  private shouldReconnect(_traceId?: string, _sessionId?: string): boolean {
    // Reuse an in-flight CONNECTING socket / connectPromise instead of
    // orphaning it with resetConnection (which only closes OPEN sockets).
    if (this.connectPromise || this.ws?.readyState === WebSocket.CONNECTING) {
      return false;
    }
    return this.ws === null || this.ws.readyState !== WebSocket.OPEN;
  }

  private resetConnection(): void {
    this.clearTimers();
    this.detachStreamHandler();
    this.rejectAllJobs(new Error("websocket connection reset"));
    this.currentJob = null;
    this.chunkTargetJob = null;
    this.jobs = [];

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      this.ws.close();
    }

    this.ws = null;
    this.connectPromise = null;
    this.connectedTraceId = undefined;
    this.connectedSessionId = undefined;
    this.sentSegmentSequence = 0;
  }

  private async ensureConnected(
    traceId?: string,
    sessionId?: string,
    onConnect?: (info: { ms: number; ok: boolean }) => void,
  ): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      onConnect?.({ ms: 0, ok: true });
      return;
    }

    if (this.connectPromise) {
      await this.connectPromise;

      if (this.ws?.readyState === WebSocket.OPEN) {
        onConnect?.({ ms: 0, ok: true });
      }

      return;
    }

    const connectStart = performance.now();
    let connectNotified = false;

    const notifyConnect = (ok: boolean) => {
      if (connectNotified || !onConnect) {
        return;
      }

      connectNotified = true;
      onConnect({ ms: performance.now() - connectStart, ok });
    };

    const voiceSpeed = clampVoiceSpeed(DEFAULT_VOICE_SETTINGS.speed ?? 1);
    this.connectPromise = (async () => {
      const ticket = await fetchWsAuthTicket();
      await new Promise<void>((resolve, reject) => {
        const ws = new globalThis.WebSocket(
          getWebSocketUrl(
            "/api/tts/ws",
            traceId,
            sessionId,
            voiceSpeed,
            ticket,
            this.voicePreferences,
          ),
        );
        this.ws = ws;
        this.connectedTraceId = traceId;
        this.connectedSessionId = sessionId;
        // The relay counts contexts per connection, so this must too.
        this.sentSegmentSequence = 0;

        const timeout = window.setTimeout(() => {
          notifyConnect(false);
          reject(new Error("websocket connection timeout"));
          ws.close();
        }, TTS_WS_CONNECT_TIMEOUT_MS);

        const onReady = (event: MessageEvent) => {
          const payload = parseWsPayload(String(event.data));

          if (payload && "type" in payload && payload.type === "ready") {
            window.clearTimeout(timeout);
            ws.removeEventListener("message", onReady);
            notifyConnect(true);
            resolve();
          }

          if (payload && "type" in payload && payload.type === "error") {
            window.clearTimeout(timeout);
            ws.removeEventListener("message", onReady);
            notifyConnect(false);
            reject(new Error(payload.message ?? "websocket tts error"));
          }
        };

        ws.addEventListener("message", onReady);

        ws.onerror = () => {
          window.clearTimeout(timeout);
          ws.removeEventListener("message", onReady);
          notifyConnect(false);
          reject(new Error("websocket connection failed"));
        };

        ws.onclose = () => {
          this.ws = null;
          this.connectPromise = null;
          this.connectedTraceId = undefined;
          this.connectedSessionId = undefined;
          this.detachStreamHandler();
          this.rejectAllJobs(new Error("websocket closed"));
          this.currentJob = null;
          this.chunkTargetJob = null;
          this.jobs = [];
        };
      });
    })();

    try {
      await this.connectPromise;
    } catch (error) {
      this.connectPromise = null;
      throw error;
    }
  }

  private createJob(spokenText: string, options: SpeakSegmentOptions): SegmentJob {
    return {
      spokenText,
      options,
      claimed: true,
      resolve: () => {},
      reject: () => {},
      settled: false,
      textSent: false,
      playbackStarted: false,
      timingsEmitted: false,
      contextFinal: false,
      timings: {
        charStartTimes: [],
        charDurations: [],
        totalDuration: 0,
      },
      capturedChunks: [],
      pendingAudioBuffers: [],
      sourceDonePromises: [],
      pendingAudioIngestPromises: [],
      started: false,
      receivedAudio: false,
      decodedAudio: false,
      chunkOffsetSec: 0,
      startedAt: performance.now(),
    };
  }

  private emitTimings(job: SegmentJob): void {
    if (job.timings.totalDuration <= 0) {
      return;
    }

    job.options.onTimings?.(toSegmentRelativeAudioTimings(job.timings));

    if (!job.timingsEmitted) {
      job.timingsEmitted = true;
    }
  }

  private finalizeJob(job: SegmentJob): void {
    this.emitTimings(job);

    if (job.capturedChunks.length > 0) {
      job.options.onAudioCaptured?.({
        bytes: concatUint8Arrays(job.capturedChunks),
        mimeType: "audio/mpeg",
      });
    }

    tutorDebug("tts", "segment complete", {
      duration_ms: Math.round(performance.now() - job.startedAt),
      total_audio_sec: job.timings.totalDuration,
    });
    job.options.onEnd?.();
    job.resolve();
  }

  private enqueueWebSocketSegment(
    spokenText: string,
    options: SpeakSegmentOptions,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Reaching here means the lesson is speaking something other than what
      // was generated ahead, so that guess is stale. Dropping it matters: an
      // unclaimed job at the head of the queue is never promoted, and the
      // sentence behind it would wait on it forever.
      for (const stale of this.jobs.filter((queued) => !queued.claimed && !queued.settled)) {
        stale.settled = true;
        this.releaseJobContext(stale);
        tutorDebug("tts", "dropping unspoken lookahead", {
          preview: stale.spokenText.slice(0, 60),
        });
      }
      this.jobs = this.jobs.filter((queued) => !queued.settled);
      const job = this.createJob(spokenText, options);
      job.resolve = resolve;
      job.reject = reject;
      this.jobs.push(job);
      void this.pumpJobQueue();
    });
  }

  private async pumpJobQueue(): Promise<void> {
    if (this.halted) {
      return;
    }

    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const error = new Error("websocket not open for tts segment");
      for (const job of this.jobs) {
        if (!job.settled) {
          job.settled = true;
          job.reject(error);
        }
      }
      this.jobs = [];
      this.currentJob = null;
      this.chunkTargetJob = null;
      this.jobsByContext.clear();
      this.unboundJobs = [];
      return;
    }

    while (this.jobs.length > 0 && this.jobs[0].settled) {
      this.releaseJobContext(this.jobs.shift()!);
    }

    let ctx: AudioContext;
    try {
      ctx = await this.ensureAudioContext();
    } catch {
      return;
    }
    this.attachStreamHandler(ws, ctx);

    // Every queued sentence gets its text out now, each on a context of its
    // own. Generation for the next beat then runs under the one being spoken
    // instead of after it, which is the whole of the gap between sentences.
    for (const job of this.jobs) {
      if (job.settled || job.textSent) {
        continue;
      }
      tutorDebug("tts", "ws segment send", {
        spoken_chars: job.spokenText.length,
        claimed: job.claimed,
        preview: job.spokenText.slice(0, 80),
      });
      this.sendSegmentText(ws, job);
      job.textSent = true;
      job.startedAt = performance.now();
      this.unboundJobs.push(job);
    }

    // Still set while a sentence drains its scheduled audio, so this is what
    // keeps a pre-generated next sentence from speaking over the current one.
    if (this.currentJob) {
      return;
    }

    const nextJob = this.jobs[0];
    if (!nextJob) {
      this.currentJob = null;
      this.chunkTargetJob = null;
      this.detachStreamHandler();
      return;
    }

    // The head is a sentence the lesson has not reached yet. It keeps
    // generating; whether it speaks is `speakSegment`'s call, not the queue's.
    if (!nextJob.claimed) {
      this.currentJob = null;
      return;
    }

    this.currentJob = nextJob;
    // Advance chunk routing with the job queue — a settled prior target must
    // not keep absorbing (and discarding) chunks meant for the next segment.
    if (this.chunkTargetJob === null || this.chunkTargetJob.settled) {
      this.chunkTargetJob = nextJob;
    }
    // No waitForTimelineReady here — completeCurrentJob already waits for
    // all audio sources via sourceDonePromises before calling pumpJobQueue.
    this.scheduledEnd = Math.max(this.scheduledEnd, ctx.currentTime);
    this.totalScheduledMediaSec = 0;
    this.mediaClock = createRateMediaClock(this.playbackRate);

    // A sentence generated ahead already holds its audio, so this is where it
    // starts speaking — with no round trip between it and the last one. Its
    // context finished long ago, so closing it out is this path's job too.
    if (!nextJob.playbackStarted) {
      void this.tryStartJobPlayback(nextJob).then(() => {
        if (nextJob.contextFinal && nextJob === this.currentJob && !nextJob.settled) {
          void this.completeCurrentJob();
        }
      });
    }

    this.resetWatchdog(nextJob);
  }

  /** Stop routing upstream chunks to a job that is done with them. */
  private releaseJobContext(job: SegmentJob): void {
    for (const [contextId, bound] of this.jobsByContext) {
      if (bound === job) this.jobsByContext.delete(contextId);
    }
    const waiting = this.unboundJobs.indexOf(job);
    if (waiting >= 0) {
      this.unboundJobs.splice(waiting, 1);
    }
  }

  /**
   * Which job a message belongs to. Contexts are bound on first sight, in the
   * order their texts were sent, so two sentences generating at once cannot
   * pour their audio into each other.
   */
  private jobForPayload(contextId: string | undefined): SegmentJob | null {
    if (!contextId) {
      return this.chunkTargetJob ?? this.currentJob;
    }
    const bound = this.jobsByContext.get(contextId);
    if (bound) {
      return bound;
    }
    // A relay that numbers contexts itself instead of echoing ours: fall back
    // to send order and remember what it actually called this one.
    const job = this.unboundJobs.shift();
    if (!job) {
      return this.chunkTargetJob ?? this.currentJob;
    }
    this.jobsByContext.set(contextId, job);
    return job;
  }

  private sendSegmentText(ws: WebSocket, job: SegmentJob): void {
    // Generation stays at the tutor's natural pace. Lecture speed is playback
    // rate on the already-produced audio so a mid-sentence change takes effect now.
    const speed = clampVoiceSpeed(DEFAULT_VOICE_SETTINGS.speed ?? 1);
    // Name the context here rather than inferring it from the order replies
    // come back in. Sentences generate concurrently and a short one finishes
    // first, so arrival order is not send order — reading it as such handed a
    // sentence the audio of its neighbour.
    this.sentSegmentSequence += 1;
    const contextId = `segment_${this.sentSegmentSequence}`;
    job.contextId = contextId;
    this.jobsByContext.set(contextId, job);
    ws.send(
      JSON.stringify({
        text: job.spokenText,
        segment_index: this.sentSegmentSequence,
        previous_text: job.options.previousText,
        next_text: job.options.nextText,
        voice_settings: { ...DEFAULT_VOICE_SETTINGS, speed },
      }),
    );
    ws.send(JSON.stringify({ text: "", flush: true }));
  }

  private attachStreamHandler(ws: WebSocket, ctx: AudioContext): void {
    if (this.streamHandler) {
      return;
    }

    this.streamHandler = async (event: MessageEvent) => {
      try {
        if (typeof event.data !== "string") {
          const binaryJob = this.chunkTargetJob ?? this.currentJob;
          if (!binaryJob || binaryJob.settled) {
            return;
          }
          const arrayBuffer =
            event.data instanceof ArrayBuffer
              ? event.data
              : event.data instanceof Blob
                ? await event.data.arrayBuffer()
                : null;

          if (arrayBuffer) {
            const ingestPromise = this.ingestAudioBuffer(ctx, binaryJob, arrayBuffer);
            binaryJob.pendingAudioIngestPromises.push(ingestPromise);
            await ingestPromise;
          }

          return;
        }

        const payload = parseWsPayload(event.data);
        if (!payload || ("type" in payload && payload.type)) {
          return;
        }

        const chunk = payload as TimestampChunkPayload;
        // Several sentences may be generating at once, so the context the
        // message names — not "the segment being spoken" — owns this audio.
        const job = this.jobForPayload(chunk.contextId ?? chunk.context_id);
        if (!job || job.settled) {
          return;
        }

        if (chunk.isFinal || chunk.is_final) {
          job.contextFinal = true;
          this.emitTimings(job);
          await Promise.allSettled(job.pendingAudioIngestPromises);
          if (!job.playbackStarted) {
            await this.tryStartJobPlayback(job);
          }

          // A sentence generated ahead of the lesson finishes its context
          // while an earlier one is still being spoken. It waits its turn;
          // promotion in pumpJobQueue is what closes it out.
          if (job === this.currentJob) {
            await this.completeCurrentJob();
          }
          return;
        }

        const audioBase64 = readAudioBase64(chunk);
        if (!audioBase64) {
          return;
        }

        const bytes = base64ToUint8Array(audioBase64);
        const ingestPromise = this.ingestAudioBuffer(
          ctx,
          job,
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        );
        job.pendingAudioIngestPromises.push(ingestPromise);
        await ingestPromise;
        job.chunkOffsetSec = mergeChunkTimings(job.timings, chunk, job.chunkOffsetSec);

        if (job.timings.totalDuration > 0) {
          this.emitTimings(job);
        }
      } catch (error) {
        tutorDebug("tts", "ws stream handler error", { error: String(error) });
      }
    };

    ws.addEventListener("message", this.streamHandler);
  }

  private detachStreamHandler(): void {
    if (this.streamHandler && this.ws) {
      this.ws.removeEventListener("message", this.streamHandler);
    }

    this.streamHandler = null;
  }

  private canSchedulePlayback(job: SegmentJob): boolean {
    return job === this.currentJob && !job.settled;
  }

  private async tryStartJobPlayback(job: SegmentJob): Promise<void> {
    if (!this.canSchedulePlayback(job) || job.playbackStarted) {
      return;
    }
    if (!job.contextFinal) {
      return;
    }
    if (job.pendingAudioBuffers.length === 0 && job.capturedChunks.length === 0) {
      return;
    }

    const ctx = await this.ensureAudioContext();
    const playable = await this.buffersForSmoothPlayback(
      ctx,
      job.capturedChunks,
      job.pendingAudioBuffers,
    );
    if (playable.length === 0) {
      return;
    }
    job.decodedAudio = true;
    job.pendingAudioBuffers.length = 0;
    job.playbackStarted = true;
    this.playing = true;

    if (!job.started) {
      job.started = true;
      tutorDebug("tts", "ws playback start (buffered)", {
        ttft_ms: Math.round(performance.now() - job.startedAt),
        buffered_chunks: playable.length,
      });
      job.options.onStart?.();
    }

    const htmlDone = this.tryPlayHtmlMpeg(job.capturedChunks, job);
    if (htmlDone) {
      job.sourceDonePromises.push(htmlDone);
      return;
    }

    for (const audioBuffer of playable) {
      this.scheduleBufferSource(ctx, job, audioBuffer);
    }
  }

  private async ingestAudioBuffer(
    ctx: AudioContext,
    job: SegmentJob,
    arrayBuffer: ArrayBuffer,
  ): Promise<void> {
    job.receivedAudio = true;
    if (job === this.currentJob) {
      this.resetWatchdog(job);
    }
    job.capturedChunks.push(new Uint8Array(arrayBuffer));

    if (!this.canSchedulePlayback(job) || !job.playbackStarted) {
      if (this.canSchedulePlayback(job)) {
        await this.tryStartJobPlayback(job);
      }
    }
  }

  private async buffersForSmoothPlayback(
    ctx: AudioContext,
    chunks: Uint8Array[],
    decoded: AudioBuffer[],
  ): Promise<AudioBuffer[]> {
    if (chunks.length > 0) {
      try {
        const merged = concatUint8Arrays(chunks);
        const audioBuffer = await ctx.decodeAudioData(
          merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength) as ArrayBuffer,
        );
        return [audioBuffer];
      } catch {
        tutorDebug("tts", "concat mpeg decode failed, using decoded slices");
      }
    }
    const slices = decoded.length > 0
      ? decoded
      : await this.decodeMpegSlices(ctx, chunks);
    if (slices.length === 0) {
      return [];
    }
    if (canConcatAudioBuffers(slices) && slices.length > 1) {
      return [concatDecodedAudioBuffers(ctx, slices)];
    }
    return slices;
  }

  private async decodeMpegSlices(ctx: AudioContext, chunks: Uint8Array[]): Promise<AudioBuffer[]> {
    const slices: AudioBuffer[] = [];
    for (const chunk of chunks) {
      try {
        slices.push(await ctx.decodeAudioData(
          chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
        ));
      } catch {
        tutorDebug("tts", "mpeg slice decode failed");
      }
    }
    return slices;
  }

  private scheduleBufferSource(
    ctx: AudioContext,
    job: SegmentJob,
    audioBuffer: AudioBuffer,
  ): void {
    const startAt = nextScheduleStartSec({
      currentTime: ctx.currentTime,
      scheduledEnd: this.scheduledEnd,
    });
    if (job.audibleStartCtxTime === undefined) {
      job.audibleStartCtxTime = startAt;
    }
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    applyBufferSourcePlaybackRate(source, this.playbackRate);
    this.connectSource(source, ctx);

    const donePromise = new Promise<void>((resolveSource) => {
      source.onended = () => {
        this.activeSources = this.activeSources.filter((node) => node !== source);

        if (this.activeSources.length === 0) {
          this.playing = false;
        }

        resolveSource();
      };
    });

    this.activeSources.push(source);
    source.start(startAt);
    this.totalScheduledMediaSec += audioBuffer.duration;
    this.scheduledEnd = startAt + remainingWallSec(audioBuffer.duration, this.playbackRate);
    job.sourceDonePromises.push(donePromise);
    this.scheduleIdleComplete(ctx, job);
  }

  private scheduleIdleComplete(ctx: AudioContext, job: SegmentJob): void {
    if (this.idleCompleteTimer !== null) {
      window.clearTimeout(this.idleCompleteTimer);
    }

    this.idleCompleteTimer = window.setTimeout(() => {
      if (this.currentJob !== job || job.settled) {
        return;
      }

      if (shouldCompleteTtsJobAfterSilence({
        contextFinal: job.contextFinal,
        scheduledEnd: this.scheduledEnd,
        currentTime: ctx.currentTime,
      })) {
        void this.completeCurrentJob();
      } else {
        this.scheduleIdleComplete(ctx, job);
      }
    }, 350);
  }

  private resetWatchdog(job: SegmentJob): void {
    if (this.watchdogTimer !== null) {
      window.clearTimeout(this.watchdogTimer);
    }

    // Fail when ElevenLabs never returns audio; leave room for cold WS + first chunk.
    this.watchdogTimer = window.setTimeout(() => {
      if (this.currentJob !== job || job.settled) {
        return;
      }

      if (!job.receivedAudio) {
        this.failCurrentJob(new Error("websocket tts timeout"));
        return;
      }

      void this.completeCurrentJob();
    }, 12_000);
  }

  private clearTimers(): void {
    if (this.idleCompleteTimer !== null) {
      window.clearTimeout(this.idleCompleteTimer);
      this.idleCompleteTimer = null;
    }

    if (this.watchdogTimer !== null) {
      window.clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private async completeCurrentJob(): Promise<void> {
    const job = this.currentJob;
    if (!job || job.settled) {
      return;
    }

    await Promise.allSettled(job.pendingAudioIngestPromises);

    if (!hasPlayableSegmentAudio({
      receivedAudio: job.receivedAudio,
      decodedAudio: job.decodedAudio,
      capturedChunkCount: job.capturedChunks.length,
    })) {
      this.failCurrentJob(new Error("websocket tts finalized without audio"));
      return;
    }

    job.settled = true;
    this.clearTimers();

    await Promise.all(job.sourceDonePromises);
    this.finalizeJob(job);

    while (this.jobs.length > 0 && this.jobs[0].settled) {
      this.releaseJobContext(this.jobs.shift()!);
    }

    this.currentJob = null;
    if (this.chunkTargetJob === job) {
      this.chunkTargetJob = null;
    }
    await this.pumpJobQueue();
  }

  private failCurrentJob(error: unknown): void {
    const job = this.currentJob;
    this.clearTimers();

    // Mute any buffers already scheduled for this job so HTTP/speech fallback
    // (or the next queue item) cannot overlap and echo.
    this.stopActiveAudio("failCurrentJob", { preserveHttp: true });

    if (job && !job.settled) {
      job.settled = true;
      job.reject(error);
    }

    // Drop only the failed job — keep the rest of the queue alive so later
    // segments can still speak (HTTP fallback / next WS job).
    if (job) {
      const idx = this.jobs.indexOf(job);
      if (idx >= 0) {
        this.jobs.splice(idx, 1);
      }
      this.releaseJobContext(job);
    }

    this.currentJob = null;
    this.chunkTargetJob = null;
    this.detachStreamHandler();
    void this.pumpJobQueue();
  }

  private rejectAllJobs(error: unknown): void {
    this.jobsByContext.clear();
    this.unboundJobs = [];
    for (const job of this.jobs) {
      if (!job.settled) {
        job.settled = true;
        job.reject(error);
      }
    }
    this.jobs = [];
  }

  private async waitForTimelineReady(ctx: AudioContext): Promise<void> {
    // Never snap the playhead forward while buffers are still audible — that
    // was a prime cause of overlapping voices on HTTP fallback.
    const deadline = performance.now() + 8_000;
    while (
      (this.activeSources.length > 0 || this.scheduledEnd > ctx.currentTime + 0.05) &&
      performance.now() < deadline
    ) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 32);
      });
    }
    if (this.activeSources.length > 0 || this.scheduledEnd > ctx.currentTime + 0.05) {
      this.stopActiveAudio("waitForTimelineReady-timeout");
    }
  }

  private async fillHttpPrefetch(
    entry: HttpPrefetch,
    options: SpeakSegmentOptions,
  ): Promise<void> {
    try {
      const ctx = await this.ensureAudioContext();
      const ingested = await this.ingestHttpAudio(entry.spokenText, options, entry.controller);
      entry.buffers = ingested.buffers;
      entry.chunks = ingested.chunks;
      entry.timings = ingested.timings;
    } catch (error) {
      entry.error = error;
    }
  }

  private async playPrefetchedHttp(
    entry: HttpPrefetch,
    options: SpeakSegmentOptions,
    generation: number,
  ): Promise<void> {
    if (this.speakGeneration !== generation || this.paused) {
      options.onEnd?.();
      return;
    }
    const ctx = await this.ensureAudioContext();
    this.scheduledEnd = Math.max(this.scheduledEnd, ctx.currentTime);
    this.httpPlaybackOriginCtxTime = null;
    const sourceDonePromises: Promise<void>[] = [];
    const playable = await this.buffersForSmoothPlayback(ctx, entry.chunks, entry.buffers);
    if (playable.length === 0) {
      options.onEnd?.();
      return;
    }
    this.playing = true;
    this.lastSuccessfulTransport = "http";
    options.onStart?.();
    const htmlDone = this.tryPlayHtmlMpeg(entry.chunks);
    if (htmlDone) {
      sourceDonePromises.push(htmlDone);
    } else {
      for (const audioBuffer of playable) {
        if (this.speakGeneration !== generation) {
          return;
        }
        sourceDonePromises.push(this.scheduleDecodedBuffer(ctx, audioBuffer));
      }
    }
    if (entry.timings.totalDuration > 0) {
      options.onTimings?.(toSegmentRelativeAudioTimings(entry.timings));
    }
    if (entry.chunks.length > 0) {
      options.onAudioCaptured?.({
        bytes: concatUint8Arrays(entry.chunks),
        mimeType: "audio/mpeg",
      });
    }
    await Promise.all(sourceDonePromises);
    if (this.speakGeneration === generation) {
      options.onEnd?.();
    }
  }

  private scheduleDecodedBuffer(ctx: AudioContext, audioBuffer: AudioBuffer): Promise<void> {
    const startAt = nextScheduleStartSec({
      currentTime: ctx.currentTime,
      scheduledEnd: this.scheduledEnd,
    });
    if (this.httpPlaybackOriginCtxTime === null) {
      this.httpPlaybackOriginCtxTime = startAt;
    }
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    applyBufferSourcePlaybackRate(source, this.playbackRate);
    this.connectSource(source, ctx);
    const donePromise = new Promise<void>((resolve) => {
      source.onended = () => {
        this.activeSources = this.activeSources.filter((node) => node !== source);
        if (this.activeSources.length === 0) {
          this.playing = false;
        }
        resolve();
      };
    });
    this.activeSources.push(source);
    source.start(startAt);
    this.totalScheduledMediaSec += audioBuffer.duration;
    this.scheduledEnd = startAt + remainingWallSec(audioBuffer.duration, this.playbackRate);
    return donePromise;
  }

  private async fetchHttpTtsStream(
    spokenText: string,
    options: SpeakSegmentOptions,
    signal: AbortSignal,
  ): Promise<Response> {
    const init: RequestInit = {
      method: "POST",
      signal,
      headers: buildTtsHeaders(options),
      body: JSON.stringify({
        text: spokenText,
        model_id: DEFAULT_MODEL,
        voice_settings: {
          ...DEFAULT_VOICE_SETTINGS,
          speed: clampVoiceSpeed(DEFAULT_VOICE_SETTINGS.speed ?? 1),
        },
        previous_text: options.previousText,
        next_text: options.nextText,
      }),
    };
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(resolveApiUrl(HTTP_STREAM_URL), init);
      if (response.ok) return response;
      const delay = ttsHttpRetryDelayMs(
        response.status,
        attempt,
        parseRetryAfterSec(response.headers.get("retry-after")),
      );
      if (delay == null || signal.aborted) return response;
      tutorDebug("tts", "retrying http tts", { status: response.status, attempt, delay });
      void response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  private async ingestHttpAudio(
    spokenText: string,
    options: SpeakSegmentOptions,
    controller: AbortController,
  ): Promise<{ buffers: AudioBuffer[]; chunks: Uint8Array[]; timings: AudioTimings }> {
    await this.httpGate.acquire();
    try {
      const response = await this.fetchHttpTtsStream(spokenText, options, controller.signal);
      if (!response.ok) {
        throw new Error(`TTS stream error ${response.status}`);
      }
      if (!response.body) {
        throw new Error("TTS stream returned no body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let chunkOffsetSec = 0;
      const chunks: Uint8Array[] = [];
      const timings: AudioTimings = {
        charStartTimes: [],
        charDurations: [],
        totalDuration: 0,
      };

      const ingestLine = async (line: string) => {
        const payload = parseHttpTimestampPayload(line);
        const audioBase64 = payload ? readAudioBase64(payload) : undefined;
        if (!audioBase64 || !payload) return;
        const bytes = base64ToUint8Array(audioBase64);
        chunks.push(bytes);
        chunkOffsetSec = mergeChunkTimings(timings, payload, chunkOffsetSec);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split(/\r?\n/);
        sseBuffer = lines.pop() ?? "";
        for (const line of lines) {
          await ingestLine(line);
        }
      }
      if (sseBuffer.trim()) {
        await ingestLine(sseBuffer);
      }
      if (chunks.length === 0) {
        throw new Error("TTS stream returned no audio");
      }
      return { buffers: [], chunks, timings };
    } finally {
      this.httpGate.release();
    }
  }

  private async streamHttpSegment(
    spokenText: string,
    options: SpeakSegmentOptions,
    generation: number,
  ): Promise<void> {
    const controller = new AbortController();
    this.httpControllers.add(controller);
    this.httpStreamAbortController = controller;
    const isCurrentSpeak = () =>
      this.speakGeneration === generation &&
      !controller.signal.aborted;
    const throwIfStopped = () => {
      if (!isCurrentSpeak()) {
        throw new DOMException("tts stopped", "AbortError");
      }
    };

    let httpSlotHeld = false;
    try {
      const ctx = await this.ensureAudioContext();
      throwIfStopped();
      this.scheduledEnd = Math.max(this.scheduledEnd, ctx.currentTime);
      this.httpPlaybackOriginCtxTime = null;

      await this.httpGate.acquire();
      httpSlotHeld = true;
      const response = await this.fetchHttpTtsStream(spokenText, options, controller.signal);
      throwIfStopped();
      if (!response.ok) throw new Error(`TTS stream error ${response.status}`);
      if (!response.body) throw new Error("TTS stream returned no body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let chunkOffsetSec = 0;
      let started = false;
      const sourceDonePromises: Promise<void>[] = [];
      const capturedChunks: Uint8Array[] = [];
      const timings: AudioTimings = {
        charStartTimes: [],
        charDurations: [],
        totalDuration: 0,
      };

      const startPlayback = async () => {
        if (started) {
          return;
        }
        throwIfStopped();
        const playable = await this.buffersForSmoothPlayback(ctx, capturedChunks, []);
        if (playable.length === 0) {
          return;
        }
        started = true;
        this.playing = true;
        this.lastSuccessfulTransport = "http";
        options.onStart?.();
        const htmlDone = this.tryPlayHtmlMpeg(capturedChunks);
        if (htmlDone) {
          sourceDonePromises.push(htmlDone);
          return;
        }
        for (const audioBuffer of playable) {
          sourceDonePromises.push(this.scheduleDecodedBuffer(ctx, audioBuffer));
        }
      };

      const playLine = async (line: string) => {
        const payload = parseHttpTimestampPayload(line);
        const audioBase64 = payload ? readAudioBase64(payload) : undefined;
        if (!audioBase64 || !payload) return;
        throwIfStopped();
        const bytes = base64ToUint8Array(audioBase64);
        capturedChunks.push(bytes);
        chunkOffsetSec = mergeChunkTimings(timings, payload, chunkOffsetSec);
        if (timings.totalDuration > 0) {
          options.onTimings?.(toSegmentRelativeAudioTimings(timings));
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        throwIfStopped();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split(/\r?\n/);
        sseBuffer = lines.pop() ?? "";
        for (const line of lines) await playLine(line);
      }
      if (sseBuffer.trim()) await playLine(sseBuffer);
      await startPlayback();
      if (!started) throw new Error("TTS stream returned no audio");
      if (capturedChunks.length > 0 && isCurrentSpeak()) {
        options.onAudioCaptured?.({
          bytes: concatUint8Arrays(capturedChunks),
          mimeType: "audio/mpeg",
        });
      }
      // The ElevenLabs request is done; do not hold the slot through playback.
      this.httpGate.release();
      httpSlotHeld = false;
      await Promise.all(sourceDonePromises);
      if (isCurrentSpeak()) options.onEnd?.();
    } finally {
      if (httpSlotHeld) {
        this.httpGate.release();
      }
      this.httpControllers.delete(controller);
      if (this.httpStreamAbortController === controller) {
        this.httpStreamAbortController = null;
      }
    }
  }

  async playAudio(bytes: Uint8Array, options: { onStart?: () => void } = {}): Promise<void> {
    this.halted = false;
    const ctx = await this.ensureAudioContext();
    await this.waitForTimelineReady(ctx);

    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const startAt = Math.max(ctx.currentTime + 0.05, this.scheduledEnd);
    const htmlDone = this.tryPlayHtmlMpeg([bytes]);
    if (htmlDone) {
      this.playing = true;
      options.onStart?.();
      await htmlDone;
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    applyBufferSourcePlaybackRate(source, this.playbackRate);
    this.connectSource(source, ctx);

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
      options.onStart?.();
      source.start(startAt);
      this.totalScheduledMediaSec += audioBuffer.duration;
      this.scheduledEnd = startAt + remainingWallSec(audioBuffer.duration, this.playbackRate);
    });
  }

  private connectSource(source: AudioBufferSourceNode, ctx: AudioContext): void {
    source.connect(this.ensureOutputGain(ctx));
  }

  private stopHtmlAudio(): void {
    const audio = this.currentHtmlAudio;
    if (!audio) {
      return;
    }
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    this.currentHtmlAudio = null;
  }

  private tryPlayHtmlMpeg(chunks: Uint8Array[], job?: SegmentJob): Promise<void> | null {
    if (typeof Audio !== "function" || typeof Blob === "undefined" || chunks.length === 0) {
      return null;
    }
    let url: string;
    let audio: HTMLAudioElement;
    try {
      const bytes = concatUint8Arrays(chunks);
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      url = URL.createObjectURL(blob);
      audio = new Audio(url);
    } catch {
      return null;
    }
    applyHtmlAudioPlaybackRate(audio, this.playbackRate);
    applyHtmlAudioMute(audio, this.muted);
    this.currentHtmlAudio = audio;
    const ctx = this.audioContext;
    if (job && job.audibleStartCtxTime === undefined && ctx) {
      job.audibleStartCtxTime = ctx.currentTime;
    }
    if (!job && this.httpPlaybackOriginCtxTime === null && ctx) {
      this.httpPlaybackOriginCtxTime = ctx.currentTime;
    }
    return new Promise<void>((resolve) => {
      const finish = () => {
        URL.revokeObjectURL(url);
        if (this.currentHtmlAudio === audio) {
          this.currentHtmlAudio = null;
        }
        if (this.activeSources.length === 0) {
          this.playing = false;
        }
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      this.playing = true;
      void audio.play().catch(finish);
    });
  }

  private retuneScheduledEnd(ctx: AudioContext): void {
    const played = Math.max(mediaPositionSec(this.mediaClock, ctx.currentTime), 0);
    const remaining = this.totalScheduledMediaSec - played;
    this.scheduledEnd = ctx.currentTime + remainingWallSec(remaining, this.playbackRate);
  }

  private ensureOutputGain(ctx: AudioContext): GainNode {
    if (!this.outputGain) {
      this.outputGain = ctx.createGain();
      this.outputGain.gain.value = this.muted ? 0 : 1;
      this.outputGain.connect(ctx.destination);
    }
    return this.outputGain;
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    if (this.halted) {
      throw new DOMException("tts stopped", "AbortError");
    }
    this.audioContext = this.audioContext ?? createLectureAudioContext();

    if (this.audioContext.state === "suspended" && !this.paused) {
      try {
        await this.audioContext.resume();
      } catch (error) {
        tutorDebug("tts", "AudioContext resume failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (this.halted) {
      releaseLectureAudioContext(this.audioContext);
      this.audioContext = null;
      throw new DOMException("tts stopped", "AbortError");
    }

    if (this.audioContext.state === "suspended") {
      tutorDebug("tts", "AudioContext still suspended", {
        paused: this.paused,
      });
    }

    return this.audioContext;
  }

  pause(): void {
    this.paused = true;
    this.currentHtmlAudio?.pause();
    void this.audioContext?.suspend();
    // Chromium often ignores speechSynthesis.pause(); cancel is the reliable mute.
    this.speechFallback.pause();
    tutorDebug("tts", "pause");
  }

  resume(): void {
    this.paused = false;
    void this.currentHtmlAudio?.play().catch(() => undefined);
    void this.audioContext?.resume();
    this.speechFallback.resume();
    tutorDebug("tts", "resume");
  }

  /** Hold until the user resumes, or the speak generation is aborted. */
  private async waitWhileUnpaused(generation: number): Promise<boolean> {
    while (this.paused) {
      if (this.speakGeneration !== generation) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return this.speakGeneration === generation;
  }

  stop(): void {
    this.halted = true;
    this.speakGeneration += 1;
    this.clearTimers();
    this.detachStreamHandler();
    this.abortHttpStream("stop");
    this.rejectAllJobs(new Error("tts stopped"));
    this.currentJob = null;
    this.chunkTargetJob = null;
    this.jobs = [];
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }

    this.activeSources = [];
    this.playing = false;
    this.scheduledEnd = 0;
    this.totalScheduledMediaSec = 0;
    this.mediaClock = createRateMediaClock(this.playbackRate);
    this.stopHtmlAudio();

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }

    this.ws = null;
    this.connectPromise = null;
    this.connectedTraceId = undefined;
    this.connectedSessionId = undefined;
    this.sentSegmentSequence = 0;
    this.paused = false;
    this.speechFallback.stop();
    releaseLectureAudioContext(this.audioContext);
    this.audioContext = null;
    this.outputGain = null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  getPlaybackPositionMs(): number | null {
    const html = this.currentHtmlAudio;
    if (html && Number.isFinite(html.currentTime) && html.currentTime > 0) {
      return html.currentTime * 1000;
    }
    const ctx = this.audioContext;
    if (!ctx) {
      return null;
    }
    const job = this.currentJob;
    const audibleAt = job?.audibleStartCtxTime ?? this.httpPlaybackOriginCtxTime;
    if (audibleAt == null) {
      return null;
    }
    // ctx.currentTime freezes while suspended (pause), so this is pause-aware.
    // Negative until the scheduled audio actually becomes audible.
    if (ctx.currentTime < audibleAt) {
      return (ctx.currentTime - audibleAt) * 1000;
    }
    if (this.mediaClock.lastCtxTime === null) {
      startRateMediaClock(this.mediaClock, audibleAt);
      this.mediaClock.rate = this.playbackRate;
    }
    return mediaPositionSec(this.mediaClock, ctx.currentTime) * 1000;
  }

  /**
   * The voice id is baked into the upstream socket, so a language or model
   * change can only take effect on a fresh connection. Drop the idle socket
   * here and let the next segment reconnect; a socket that is mid-sentence is
   * left alone so the current line finishes in the old voice.
   */
  setVoicePreferences(preferences: TutorVoicePreferences): void {
    const changed =
      this.voicePreferences.voiceKey !== preferences.voiceKey ||
      this.voicePreferences.lowLatency !== preferences.lowLatency;
    this.voicePreferences = { ...preferences };
    if (!changed) {
      return;
    }
    if (!this.playing && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
      this.ws = null;
      this.connectPromise = null;
    }
  }

  setPlaybackRate(rate: number): void {
    const safe = clampPlaybackRate(rate);
    const ctx = this.audioContext;
    if (ctx && this.mediaClock.lastCtxTime !== null) {
      setRateMediaClockRate(this.mediaClock, ctx.currentTime, safe);
      this.retuneScheduledEnd(ctx);
    } else {
      this.mediaClock.rate = safe;
    }
    this.playbackRate = safe;
    for (const source of this.activeSources) {
      applyBufferSourcePlaybackRate(source, safe);
    }
    if (this.currentHtmlAudio) {
      applyHtmlAudioPlaybackRate(this.currentHtmlAudio, safe);
    }
    this.speechFallback.setPlaybackRate(safe);
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }
}
