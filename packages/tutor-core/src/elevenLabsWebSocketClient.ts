import type { AudioTimings, PrewarmOptions, SpeakSegmentOptions, TTSClient } from "./elevenLabsClient";
import {
  SpeechSynthesisTTSClient,
  mergeAudioTimingChunk,
  mathToSpeech,
} from "./elevenLabsClient";
import { tutorDebug } from "./tutorDebug";
import { resolveApiUrl, resolveWebSocketUrl } from "./publicOrigins";

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
}

interface SegmentJob {
  spokenText: string;
  options: SpeakSegmentOptions;
  resolve: () => void;
  reject: (error: unknown) => void;
  settled: boolean;
  textSent: boolean;
  synthesisFinalized: boolean;
  playbackStarted: boolean;
  timingsEmitted: boolean;
  timings: AudioTimings;
  capturedChunks: Uint8Array[];
  audioEl: HTMLAudioElement | null;
  blobUrl: string | null;
  playbackEnded: Promise<void> | null;
  playbackResolve: (() => void) | null;
  started: boolean;
  receivedAudio: boolean;
  chunkOffsetSec: number;
  startedAt: number;
}

const DEFAULT_MODEL = "eleven_flash_v2_5";
/** ElevenLabs WS relay often sends binary MP3 only (no JSON isFinal). */
const SYNTHESIS_IDLE_FLUSH_MS = 750;
const WATCHDOG_MIN_MS = 15_000;
const WATCHDOG_MAX_MS = 120_000;
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
};

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

function getWebSocketUrl(path: string, traceId?: string, sessionId?: string): string {
  return resolveWebSocketUrl(path, traceId, sessionId);
}

function isSynthesisFinalChunk(chunk: TimestampChunkPayload): boolean {
  return chunk.isFinal === true || chunk.is_final === true;
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
  private currentAudioEl: HTMLAudioElement | null = null;
  private playing = false;
  private connectPromise: Promise<void> | null = null;
  private connectedTraceId?: string;
  private connectedSessionId?: string;
  private speechFallback = new SpeechSynthesisTTSClient();
  private paused = false;
  private playbackRate = 1.0;

  private jobs: SegmentJob[] = [];
  private currentJob: SegmentJob | null = null;
  /** Job currently receiving audio chunks from the WebSocket (always the playing job). */
  private chunkTargetJob: SegmentJob | null = null;
  private streamHandler: ((event: MessageEvent) => void) | null = null;
  private streamProcessing: Promise<void> = Promise.resolve();
  private synthesisFlushTimers = new WeakMap<SegmentJob, number>();
  private idleCompleteTimer: number | null = null;
  private watchdogTimer: number | null = null;

  async prewarm(options: PrewarmOptions = {}): Promise<void> {
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

  async speakSegment(text: string, options: SpeakSegmentOptions = {}): Promise<void> {
    const spokenText = mathToSpeech(text.trim());

    if (spokenText.length === 0) {
      options.onEnd?.();
      return;
    }

    if (this.shouldReconnect(options.traceId, options.sessionId)) {
      this.resetConnection();
    }

    try {
      await this.ensureConnected(options.traceId, options.sessionId);
    } catch {
      // HTTP fallback will be used if WS is unavailable.
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        return await this.enqueueWebSocketSegment(spokenText, options);
      } catch (error) {
        options.onError?.(error);
      }
    }

    try {
      await this.streamHttpSegment(spokenText, options);
    } catch (error) {
      options.onError?.(error);
      await this.speechFallback.speakSegment(spokenText, options);
    }
  }

  private shouldReconnect(_traceId?: string, _sessionId?: string): boolean {
    return this.ws === null || this.ws.readyState !== WebSocket.OPEN;
  }

  private resetConnection(): void {
    this.clearTimers();
    this.detachStreamHandler();
    this.rejectAllJobs(new Error("websocket connection reset"));
    this.currentJob = null;
    this.chunkTargetJob = null;
    this.jobs = [];

    if (this.currentAudioEl) {
      this.currentAudioEl.pause();
      this.currentAudioEl = null;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }

    this.ws = null;
    this.connectPromise = null;
    this.connectedTraceId = undefined;
    this.connectedSessionId = undefined;
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

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(getWebSocketUrl("/api/tts/ws", traceId, sessionId));
      this.ws = ws;
      this.connectedTraceId = traceId;
      this.connectedSessionId = sessionId;

      const timeout = window.setTimeout(() => {
        notifyConnect(false);
        reject(new Error("websocket connection timeout"));
        ws.close();
      }, 5000);

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
      resolve: () => {},
      reject: () => {},
      settled: false,
      textSent: false,
      synthesisFinalized: false,
      playbackStarted: false,
      timingsEmitted: false,
      timings: {
        charStartTimes: [],
        charDurations: [],
        totalDuration: 0,
      },
      capturedChunks: [],
      audioEl: null,
      blobUrl: null,
      playbackEnded: null,
      playbackResolve: null,
      started: false,
      receivedAudio: false,
      chunkOffsetSec: 0,
      startedAt: performance.now(),
    };
  }

  private emitTimings(job: SegmentJob): void {
    if (job.timings.totalDuration <= 0) {
      return;
    }

    job.options.onTimings?.(job.timings);

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
      const job = this.createJob(spokenText, options);
      job.resolve = resolve;
      job.reject = reject;
      this.jobs.push(job);
      void this.pumpJobQueue();
    });
  }

  private async pumpJobQueue(): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.jobs.length > 0 && this.jobs[0].settled) {
      this.jobs.shift();
    }

    if (this.currentJob && !this.currentJob.settled) {
      return;
    }

    const nextJob = this.jobs[0];
    if (!nextJob) {
      this.currentJob = null;
      this.chunkTargetJob = null;
      this.detachStreamHandler();
      return;
    }

    this.currentJob = nextJob;
    if (this.chunkTargetJob === null || this.chunkTargetJob.settled) {
      this.chunkTargetJob = nextJob;
    }
    this.attachStreamHandler(ws);

    if (!nextJob.textSent) {
      tutorDebug("tts", "ws segment send", {
        spoken_chars: nextJob.spokenText.length,
        preview: nextJob.spokenText.slice(0, 80),
      });
      this.sendSegmentText(ws, nextJob.spokenText, nextJob.options);
      nextJob.textSent = true;
      nextJob.startedAt = performance.now();
    }

    if (nextJob.synthesisFinalized && nextJob.capturedChunks.length > 0 && !nextJob.playbackStarted) {
      await this.maybeStartJobPlayback(nextJob);
    }

    this.resetWatchdog(nextJob);
  }

  private sendSegmentText(
    ws: WebSocket,
    spokenText: string,
    options: Pick<SpeakSegmentOptions, "previousText" | "nextText">,
  ): void {
    ws.send(
      JSON.stringify({
        text: spokenText,
        previous_text: options.previousText,
        next_text: options.nextText,
      }),
    );
    ws.send(JSON.stringify({ text: "", flush: true }));
  }

  private clearSynthesisFlushTimer(job: SegmentJob): void {
    const timer = this.synthesisFlushTimers.get(job);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.synthesisFlushTimers.delete(job);
    }
  }

  /**
   * ElevenLabs stream-input often delivers audio as binary frames with no JSON
   * isFinal. After a short idle gap, treat the buffered chunks as one segment.
   */
  private scheduleSynthesisIdleFlush(job: SegmentJob): void {
    this.clearSynthesisFlushTimer(job);

    const timer = window.setTimeout(() => {
      this.synthesisFlushTimers.delete(job);
      if (job.settled) {
        return;
      }

      job.synthesisFinalized = true;
      void this.maybeStartJobPlayback(job);
      void this.pumpJobQueue();
    }, SYNTHESIS_IDLE_FLUSH_MS);

    this.synthesisFlushTimers.set(job, timer);
  }

  private finalizeSynthesis(job: SegmentJob): void {
    this.clearSynthesisFlushTimer(job);
    job.synthesisFinalized = true;
    void this.maybeStartJobPlayback(job);
    void this.pumpJobQueue();
  }

  private attachStreamHandler(ws: WebSocket): void {
    if (this.streamHandler) {
      return;
    }

    this.streamHandler = (event: MessageEvent) => {
      this.streamProcessing = this.streamProcessing
        .then(() => this.handleStreamEvent(event))
        .catch((error) => {
          tutorDebug("tts", "ws stream handler error", { error: String(error) });
        });
    };

    ws.addEventListener("message", this.streamHandler);
  }

  private async handleStreamEvent(event: MessageEvent): Promise<void> {
    const job = this.chunkTargetJob;
    if (!job || job.settled) {
      return;
    }

    if (typeof event.data !== "string") {
      const arrayBuffer =
        event.data instanceof ArrayBuffer
          ? event.data
          : event.data instanceof Blob
            ? await event.data.arrayBuffer()
            : null;

      if (arrayBuffer) {
        this.ingestAudioBytes(job, arrayBuffer);
      }

      return;
    }

    const payload = parseWsPayload(event.data);
    if (!payload || ("type" in payload && payload.type)) {
      return;
    }

    const chunk = payload as TimestampChunkPayload;
    const audioBase64 = readAudioBase64(chunk);

    if (audioBase64) {
      const bytes = base64ToUint8Array(audioBase64);
      this.ingestAudioBytes(
        job,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
      job.chunkOffsetSec = mergeChunkTimings(job.timings, chunk, job.chunkOffsetSec);

      if (job.timings.totalDuration > 0) {
        this.emitTimings(job);
      }
    }

    if (isSynthesisFinalChunk(chunk)) {
      this.emitTimings(job);
      this.finalizeSynthesis(job);
    }
  }

  private detachStreamHandler(): void {
    if (this.streamHandler && this.ws) {
      this.ws.removeEventListener("message", this.streamHandler);
    }

    this.streamHandler = null;
    this.streamProcessing = Promise.resolve();
  }

  private canSchedulePlayback(job: SegmentJob): boolean {
    return job === this.currentJob && !job.settled;
  }

  private async maybeStartJobPlayback(job: SegmentJob): Promise<void> {
    if (!job.synthesisFinalized || job.playbackStarted || job.settled) {
      return;
    }

    if (job.capturedChunks.length === 0) {
      if (!job.receivedAudio && job.synthesisFinalized && job === this.currentJob) {
        this.failCurrentJob(new Error("websocket tts returned no audio"));
      }
      return;
    }

    if (!this.canSchedulePlayback(job)) {
      return;
    }

    await this.flushJobPlayback(job);
  }

  private async flushJobPlayback(job: SegmentJob): Promise<void> {
    if (!this.canSchedulePlayback(job) || job.playbackStarted || job.capturedChunks.length === 0) {
      return;
    }

    job.playbackStarted = true;
    this.playing = true;

    if (!job.started) {
      job.started = true;
      tutorDebug("tts", "ws playback start", {
        ttft_ms: Math.round(performance.now() - job.startedAt),
        chunk_count: job.capturedChunks.length,
        total_bytes: job.capturedChunks.reduce((sum, c) => sum + c.length, 0),
      });
      job.options.onStart?.();
    }

    const merged = concatUint8Arrays(job.capturedChunks);
    const blob = new Blob([merged], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    job.blobUrl = url;

    const audio = new Audio(url);
    audio.preservesPitch = true;
    audio.playbackRate = this.playbackRate;
    job.audioEl = audio;
    this.currentAudioEl = audio;

    job.playbackEnded = new Promise<void>((resolve) => {
      job.playbackResolve = resolve;
      audio.onended = () => {
        this.cleanupJobAudio(job);
        if (this.currentAudioEl === audio) {
          this.currentAudioEl = null;
          this.playing = false;
        }
        resolve();
        if (this.currentJob === job && !job.settled) {
          void this.completeCurrentJob();
        }
      };
      audio.onerror = () => {
        this.cleanupJobAudio(job);
        if (this.currentAudioEl === audio) {
          this.currentAudioEl = null;
          this.playing = false;
        }
        resolve();
        if (this.currentJob === job && !job.settled) {
          void this.completeCurrentJob();
        }
      };
    });

    this.scheduleIdleComplete(job);

    await audio.play().catch(() => {
      // Autoplay may be blocked; the ended/error handler will still resolve.
    });
  }

  private ingestAudioBytes(job: SegmentJob, arrayBuffer: ArrayBuffer): void {
    job.receivedAudio = true;
    job.capturedChunks.push(new Uint8Array(arrayBuffer));

    if (job.playbackStarted && job.audioEl && !job.audioEl.ended) {
      void this.extendJobPlayback(job);
      return;
    }

    this.scheduleSynthesisIdleFlush(job);
  }

  /**
   * Late binary frames can arrive after idle-flush started playback. Rebuild the
   * blob from all captured chunks and resume from the current playback position.
   */
  private async extendJobPlayback(job: SegmentJob): Promise<void> {
    const audio = job.audioEl;
    if (!audio || !job.playbackStarted || job.settled) {
      return;
    }

    const resumeAtSec = audio.currentTime;
    const wasPaused = audio.paused;
    this.clearSynthesisFlushTimer(job);
    job.synthesisFinalized = false;

    audio.onended = null;
    audio.onerror = null;
    audio.pause();

    const merged = concatUint8Arrays(job.capturedChunks);
    const blob = new Blob([merged], { type: "audio/mpeg" });
    if (job.blobUrl) {
      URL.revokeObjectURL(job.blobUrl);
    }
    const url = URL.createObjectURL(blob);
    job.blobUrl = url;
    audio.src = url;
    audio.playbackRate = this.playbackRate;

    await new Promise<void>((resolve) => {
      const onReady = () => {
        audio.removeEventListener("loadedmetadata", onReady);
        audio.removeEventListener("error", onReady);
        resolve();
      };
      audio.addEventListener("loadedmetadata", onReady);
      audio.addEventListener("error", onReady);
      audio.load();
    });

    audio.currentTime = Math.min(
      resumeAtSec,
      Number.isFinite(audio.duration) ? audio.duration : resumeAtSec,
    );

    if (!wasPaused && !this.paused) {
      await audio.play().catch(() => undefined);
    }

    this.scheduleSynthesisIdleFlush(job);
    this.resetWatchdog(job);
  }

  private cleanupJobAudio(job: SegmentJob): void {
    if (job.blobUrl) {
      URL.revokeObjectURL(job.blobUrl);
      job.blobUrl = null;
    }
    const audio = job.audioEl;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      job.audioEl = null;
    }
    if (this.currentAudioEl === audio) {
      this.currentAudioEl = null;
      this.playing = false;
    }
  }

  private scheduleIdleComplete(job: SegmentJob): void {
    if (this.idleCompleteTimer !== null) {
      window.clearTimeout(this.idleCompleteTimer);
    }

    this.idleCompleteTimer = window.setTimeout(() => {
      if (this.currentJob !== job || job.settled) {
        return;
      }

      const audio = this.currentAudioEl;
      if (!audio || audio.ended) {
        void this.completeCurrentJob();
      } else {
        this.scheduleIdleComplete(job);
      }
    }, 500);
  }

  private estimateWatchdogMs(job: SegmentJob): number {
    if (job.playbackStarted && job.audioEl) {
      const audio = job.audioEl;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        const remainingSec = Math.max(audio.duration - audio.currentTime, 0);
        return Math.min(
          Math.max(Math.ceil((remainingSec / this.playbackRate) * 1000) + 8_000, WATCHDOG_MIN_MS),
          WATCHDOG_MAX_MS,
        );
      }
    }

    if (job.receivedAudio) {
      const totalBytes = job.capturedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const estimatedSec = totalBytes / 16_000;
      return Math.min(
        Math.max(Math.ceil(estimatedSec * 1000) + 20_000, WATCHDOG_MIN_MS),
        WATCHDOG_MAX_MS,
      );
    }

    return WATCHDOG_MIN_MS;
  }

  private resetWatchdog(job: SegmentJob): void {
    if (this.watchdogTimer !== null) {
      window.clearTimeout(this.watchdogTimer);
    }

    const timeoutMs = this.estimateWatchdogMs(job);

    this.watchdogTimer = window.setTimeout(() => {
      if (this.currentJob !== job || job.settled) {
        return;
      }

      if (!job.receivedAudio) {
        this.failCurrentJob(new Error("websocket tts timeout"));
        return;
      }

      if (!job.playbackStarted) {
        job.synthesisFinalized = true;
        void this.maybeStartJobPlayback(job);
        this.resetWatchdog(job);
        return;
      }

      const audio = job.audioEl;
      if (audio && !audio.ended) {
        this.resetWatchdog(job);
        return;
      }

      void this.completeCurrentJob();
    }, timeoutMs);
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

    job.settled = true;
    this.clearSynthesisFlushTimer(job);
    this.clearTimers();

    if (job.playbackEnded) {
      await job.playbackEnded;
    }
    this.cleanupJobAudio(job);
    this.finalizeJob(job);

    while (this.jobs.length > 0 && this.jobs[0].settled) {
      this.jobs.shift();
    }

    this.currentJob = null;
    await this.pumpJobQueue();
  }

  private failCurrentJob(error: unknown): void {
    const job = this.currentJob;
    if (job) {
      this.clearSynthesisFlushTimer(job);
      this.cleanupJobAudio(job);
    }
    this.clearTimers();

    if (job && !job.settled) {
      job.settled = true;
      job.options.onError?.(error);
      job.reject(error);
    }

    while (this.jobs.length > 0 && this.jobs[0]?.settled) {
      this.jobs.shift();
    }

    this.currentJob = null;
    this.chunkTargetJob = null;
    if (this.jobs.length === 0) {
      this.detachStreamHandler();
    }
    this.currentAudioEl = null;
    void this.pumpJobQueue();
  }

  private rejectAllJobs(error: unknown): void {
    for (const job of this.jobs) {
      if (!job.settled) {
        this.cleanupJobAudio(job);
        job.settled = true;
        job.options.onError?.(error);
        job.reject(error);
      }
    }
    this.jobs = [];
  }

  private async streamHttpSegment(
    spokenText: string,
    options: SpeakSegmentOptions,
  ): Promise<void> {
    const response = await fetch(resolveApiUrl("/api/tts/stream"), {
      method: "POST",
      headers: buildTtsHeaders(options),
      body: JSON.stringify({
        text: spokenText,
        model_id: DEFAULT_MODEL,
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
      chunkOffsetSec = mergeChunkTimings(timings, payload, chunkOffsetSec);
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
        const payload = parseHttpTimestampPayload(line);
        const audioBase64 = payload ? readAudioBase64(payload) : undefined;

        if (!audioBase64 || !payload) {
          continue;
        }

        collectChunk(audioBase64, payload);
      }
    }

    if (sseBuffer.trim()) {
      const payload = parseHttpTimestampPayload(sseBuffer);
      const audioBase64 = payload ? readAudioBase64(payload) : undefined;

      if (audioBase64 && payload) {
        collectChunk(audioBase64, payload);
      }
    }

    if (!collectedAny) {
      throw new Error("TTS stream returned no audio");
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

  pause(): void {
    this.paused = true;
    this.currentAudioEl?.pause();
    this.speechFallback.pause();
    tutorDebug("tts", "pause");
  }

  resume(): void {
    this.paused = false;
    void this.currentAudioEl?.play();
    this.speechFallback.resume();
    tutorDebug("tts", "resume");
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(rate, 0.1);
    if (this.currentAudioEl) {
      this.currentAudioEl.playbackRate = this.playbackRate;
    }
    this.speechFallback.setPlaybackRate(this.playbackRate);
    tutorDebug("tts", "setPlaybackRate", { rate: this.playbackRate });
  }

  stop(): void {
    this.clearTimers();
    this.detachStreamHandler();
    this.rejectAllJobs(new Error("tts stopped"));
    this.currentJob = null;
    this.chunkTargetJob = null;
    this.jobs = [];

    if (this.currentAudioEl) {
      this.currentAudioEl.pause();
      this.currentAudioEl = null;
    }

    this.playing = false;

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }

    this.ws = null;
    this.connectPromise = null;
    this.connectedTraceId = undefined;
    this.connectedSessionId = undefined;
    this.paused = false;
    this.speechFallback.stop();
  }

  get isPlaying(): boolean {
    return this.playing || this.speechFallback.isPlaying;
  }

  getPlaybackPositionMs(): number | null {
    const audio = this.currentAudioEl;
    const job = this.currentJob;
    if (!audio || !job || !job.playbackStarted) {
      return null;
    }
    return audio.currentTime * 1000;
  }
}
