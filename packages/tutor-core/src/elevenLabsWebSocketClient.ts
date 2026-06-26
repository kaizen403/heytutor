import type { AudioTimings, PrewarmOptions, SpeakSegmentOptions, TTSClient } from "./elevenLabsClient";
import {
  SpeechSynthesisTTSClient,
  mergeAudioTimingChunk,
  mathToSpeech,
} from "./elevenLabsClient";
import { tutorDebug } from "./tutorDebug";

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
  /** ctx.currentTime (seconds) when this job's first audio source begins playing. */
  audibleStartCtxTime?: number;
  timingsEmitted: boolean;
  timings: AudioTimings;
  capturedChunks: Uint8Array[];
  pendingAudioBuffers: AudioBuffer[];
  sourceDonePromises: Promise<void>[];
  started: boolean;
  receivedAudio: boolean;
  chunkOffsetSec: number;
  startedAt: number;
}

const HTTP_STREAM_URL = "/api/tts/stream";
const DEFAULT_MODEL = "eleven_flash_v2_5";
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

function getWebSocketUrl(path: string, traceId?: string, sessionId?: string): string {
  if (typeof window === "undefined") {
    return path;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}${path}`);

  if (traceId) {
    url.searchParams.set("traceId", traceId);
  }

  if (sessionId) {
    url.searchParams.set("sessionId", sessionId);
  }

  return url.toString();
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
  private activeSources: AudioBufferSourceNode[] = [];
  private playing = false;
  private connectPromise: Promise<void> | null = null;
  private scheduledEnd = 0;
  private connectedTraceId?: string;
  private connectedSessionId?: string;
  private speechFallback = new SpeechSynthesisTTSClient();
  private paused = false;

  private jobs: SegmentJob[] = [];
  private currentJob: SegmentJob | null = null;
  /**
   * Job currently receiving audio chunks from the WebSocket.
   * Decoupled from `currentJob` (the playing job) to enable prefetching:
   * the next segment's text is sent to ElevenLabs as soon as the current
   * segment's synthesis finalizes, so audio generation overlaps with playback.
   */
  private chunkTargetJob: SegmentJob | null = null;
  private streamHandler: ((event: MessageEvent) => void) | null = null;
  private idleCompleteTimer: number | null = null;
  private watchdogTimer: number | null = null;

  async prewarm(options: PrewarmOptions = {}): Promise<void> {
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
      pendingAudioBuffers: [],
      sourceDonePromises: [],
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
    if (this.currentJob && !this.currentJob.settled) {
      return;
    }

    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.jobs.length > 0 && this.jobs[0].settled) {
      this.jobs.shift();
    }

    const nextJob = this.jobs[0];
    if (!nextJob) {
      this.currentJob = null;
      this.chunkTargetJob = null;
      this.detachStreamHandler();
      return;
    }

    this.currentJob = nextJob;
    if (this.chunkTargetJob === null) {
      this.chunkTargetJob = nextJob;
    }
    const ctx = await this.ensureAudioContext();
    // No waitForTimelineReady here — completeCurrentJob already waits for
    // all audio sources via sourceDonePromises before calling pumpJobQueue.
    this.scheduledEnd = Math.max(this.scheduledEnd, ctx.currentTime);
    this.attachStreamHandler(ws, ctx);

    if (!nextJob.textSent) {
      tutorDebug("tts", "ws segment send", {
        spoken_chars: nextJob.spokenText.length,
        preview: nextJob.spokenText.slice(0, 80),
      });
      this.sendSegmentText(ws, nextJob.spokenText, nextJob.options);
      nextJob.textSent = true;
      nextJob.startedAt = performance.now();
    }

    // If the job already has buffered audio from prefetching, start playback now.
    if (nextJob.pendingAudioBuffers.length > 0 && !nextJob.playbackStarted) {
      void this.tryStartJobPlayback(nextJob);
    }

    this.resetWatchdog(nextJob);
  }

  /**
   * Send the next queued job's text to ElevenLabs immediately after the
   * current job's synthesis finalizes. This overlaps audio generation for
   * the next segment with playback of the current segment, eliminating the
   * inter-segment gap where we'd otherwise wait for ElevenLabs to respond.
   */
  private prefetchNextJobText(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Find the next job that hasn't had its text sent yet.
    for (let i = 0; i < this.jobs.length; i++) {
      const job = this.jobs[i];
      if (job.settled || job.textSent) {
        continue;
      }
      tutorDebug("tts", "ws prefetch next segment", {
        spoken_chars: job.spokenText.length,
        preview: job.spokenText.slice(0, 80),
      });
      this.sendSegmentText(ws, job.spokenText, job.options);
      job.textSent = true;
      job.startedAt = performance.now();
      this.chunkTargetJob = job;
      return;
    }
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

  private attachStreamHandler(ws: WebSocket, ctx: AudioContext): void {
    if (this.streamHandler) {
      return;
    }

    this.streamHandler = async (event: MessageEvent) => {
      const job = this.chunkTargetJob;
      if (!job || job.settled) {
        return;
      }

      try {
        if (typeof event.data !== "string") {
          const arrayBuffer =
            event.data instanceof ArrayBuffer
              ? event.data
              : event.data instanceof Blob
                ? await event.data.arrayBuffer()
                : null;

          if (arrayBuffer) {
            await this.ingestAudioBuffer(ctx, job, arrayBuffer);
          }

          return;
        }

        const payload = parseWsPayload(event.data);
        if (!payload || ("type" in payload && payload.type)) {
          return;
        }

        const chunk = payload as TimestampChunkPayload;

        if (chunk.isFinal) {
          job.synthesisFinalized = true;
          this.emitTimings(job);

          // Prefetch: send the next job's text to ElevenLabs immediately,
          // before the current job's audio playback finishes.
          if (job === this.currentJob) {
            this.prefetchNextJobText();
            await this.completeCurrentJob();
          }
          // If job !== this.currentJob (prefetched job finished synthesis
          // while a previous job is still playing), just mark it as
          // synthesisFinalized. Playback will start when it becomes currentJob.
          return;
        }

        const audioBase64 = readAudioBase64(chunk);
        if (!audioBase64) {
          return;
        }

        const bytes = base64ToUint8Array(audioBase64);
        await this.ingestAudioBuffer(
          ctx,
          job,
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        );
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

    const ctx = await this.ensureAudioContext();
    job.playbackStarted = true;
    this.playing = true;

    if (!job.started) {
      job.started = true;
      tutorDebug("tts", "ws playback start (buffered)", {
        ttft_ms: Math.round(performance.now() - job.startedAt),
        buffered_chunks: job.pendingAudioBuffers.length,
      });
      job.options.onStart?.();
    }

    const buffered = job.pendingAudioBuffers.splice(0);
    for (const audioBuffer of buffered) {
      this.scheduleBufferSource(ctx, job, audioBuffer);
    }
  }

  private async ingestAudioBuffer(
    ctx: AudioContext,
    job: SegmentJob,
    arrayBuffer: ArrayBuffer,
  ): Promise<void> {
    job.receivedAudio = true;
    job.capturedChunks.push(new Uint8Array(arrayBuffer));

    if (!job.started) {
      job.started = true;
      tutorDebug("tts", "ws first audio chunk", {
        ttft_ms: Math.round(performance.now() - job.startedAt),
      });
      job.options.onStart?.();
    }

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

    if (!this.canSchedulePlayback(job) || !job.playbackStarted) {
      job.pendingAudioBuffers.push(audioBuffer);
      if (this.canSchedulePlayback(job)) {
        await this.tryStartJobPlayback(job);
      }
      return;
    }

    this.scheduleBufferSource(ctx, job, audioBuffer);
  }

  private scheduleBufferSource(
    ctx: AudioContext,
    job: SegmentJob,
    audioBuffer: AudioBuffer,
  ): void {
    const startAt = Math.max(ctx.currentTime + 0.05, this.scheduledEnd);
    if (job.audibleStartCtxTime === undefined) {
      job.audibleStartCtxTime = startAt;
    }
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

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
    this.scheduledEnd = startAt + audioBuffer.duration;
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

      if (this.scheduledEnd <= ctx.currentTime + 0.1) {
        void this.completeCurrentJob();
      } else {
        this.scheduleIdleComplete(ctx, job);
      }
    }, 2000);
  }

  private resetWatchdog(job: SegmentJob): void {
    if (this.watchdogTimer !== null) {
      window.clearTimeout(this.watchdogTimer);
    }

    this.watchdogTimer = window.setTimeout(() => {
      if (this.currentJob !== job || job.settled) {
        return;
      }

      if (!job.receivedAudio) {
        this.failCurrentJob(new Error("websocket tts timeout"));
        return;
      }

      void this.completeCurrentJob();
    }, 30000);
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
    this.clearTimers();

    await Promise.all(job.sourceDonePromises);
    this.finalizeJob(job);

    while (this.jobs.length > 0 && this.jobs[0].settled) {
      this.jobs.shift();
    }

    this.currentJob = null;
    await this.pumpJobQueue();
  }

  private failCurrentJob(error: unknown): void {
    const job = this.currentJob;
    this.clearTimers();

    if (job && !job.settled) {
      job.settled = true;
      job.options.onError?.(error);
      job.reject(error);
    }

    this.rejectAllJobs(error);
    this.currentJob = null;
    this.chunkTargetJob = null;
    this.jobs = [];
    this.detachStreamHandler();
  }

  private rejectAllJobs(error: unknown): void {
    for (const job of this.jobs) {
      if (!job.settled) {
        job.settled = true;
        job.options.onError?.(error);
        job.reject(error);
      }
    }
    this.jobs = [];
  }

  private async waitForTimelineReady(ctx: AudioContext): Promise<void> {
    while (this.activeSources.length > 0 || this.scheduledEnd > ctx.currentTime + 0.05) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 32);
      });
    }
  }

  private async streamHttpSegment(
    spokenText: string,
    options: SpeakSegmentOptions,
  ): Promise<void> {
    const ctx = await this.ensureAudioContext();
    await this.waitForTimelineReady(ctx);
    this.scheduledEnd = Math.max(this.scheduledEnd, ctx.currentTime);

    const response = await fetch(HTTP_STREAM_URL, {
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
    let playedAny = false;
    let chunkOffsetSec = 0;
    let playbackStarted = false;
    const sourceDonePromises: Promise<void>[] = [];
    const capturedChunks: Uint8Array[] = [];
    const timings: AudioTimings = {
      charStartTimes: [],
      charDurations: [],
      totalDuration: 0,
    };
    let timingsEmitted = false;

    const emitTimings = (): void => {
      if (timings.totalDuration <= 0) {
        return;
      }

      options.onTimings?.(timings);
      timingsEmitted = true;
    };

    const scheduleChunk = async (audioBase64: string, payload: TimestampChunkPayload) => {
      if (!playbackStarted) {
        playbackStarted = true;
        this.playing = true;
        options.onStart?.();
      }

      const bytes = base64ToUint8Array(audioBase64);
      capturedChunks.push(bytes);
      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer);

      chunkOffsetSec = mergeChunkTimings(timings, payload, chunkOffsetSec);

      const startAt = Math.max(ctx.currentTime + 0.05, this.scheduledEnd);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

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
      this.scheduledEnd = startAt + audioBuffer.duration;
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
        const payload = parseHttpTimestampPayload(line);
        const audioBase64 = payload ? readAudioBase64(payload) : undefined;

        if (!audioBase64 || !payload) {
          continue;
        }

        await scheduleChunk(audioBase64, payload);
      }
    }

    if (sseBuffer.trim()) {
      const payload = parseHttpTimestampPayload(sseBuffer);
      const audioBase64 = payload ? readAudioBase64(payload) : undefined;

      if (audioBase64 && payload) {
        await scheduleChunk(audioBase64, payload);
      }
    }

    if (!playedAny) {
      throw new Error("TTS stream returned no audio");
    }

    emitTimings();

    if (capturedChunks.length > 0) {
      options.onAudioCaptured?.({
        bytes: concatUint8Arrays(capturedChunks),
        mimeType: "audio/mpeg",
      });
    }

    await Promise.all(sourceDonePromises);
    options.onEnd?.();
  }

  async playAudio(bytes: Uint8Array, options: { onStart?: () => void } = {}): Promise<void> {
    const ctx = await this.ensureAudioContext();
    await this.waitForTimelineReady(ctx);

    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const startAt = Math.max(ctx.currentTime + 0.05, this.scheduledEnd);
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
      options.onStart?.();
      source.start(startAt);
      this.scheduledEnd = startAt + audioBuffer.duration;
    });
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    this.audioContext = this.audioContext ?? new AudioContext();

    if (this.audioContext.state === "suspended" && !this.paused) {
      await this.audioContext.resume();
    }

    return this.audioContext;
  }

  pause(): void {
    this.paused = true;
    void this.audioContext?.suspend();
    this.speechFallback.pause();
    tutorDebug("tts", "pause");
  }

  resume(): void {
    this.paused = false;
    void this.audioContext?.resume();
    this.speechFallback.resume();
    tutorDebug("tts", "resume");
  }

  stop(): void {
    this.clearTimers();
    this.detachStreamHandler();
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
    return this.playing;
  }

  getPlaybackPositionMs(): number | null {
    const ctx = this.audioContext;
    const job = this.currentJob;
    if (!ctx || !job || job.audibleStartCtxTime === undefined) {
      return null;
    }
    // ctx.currentTime freezes while suspended (pause), so this is pause-aware.
    // Negative until the scheduled audio actually becomes audible.
    return (ctx.currentTime - job.audibleStartCtxTime) * 1000;
  }
}
