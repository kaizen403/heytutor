/**
 * Mid-lecture playback speed. Changing the slider must retune the audio
 * that is already speaking, and the write clock must follow media time so
 * ink stays with the voice.
 */
import {
  applyBufferSourcePlaybackRate,
  applyHtmlAudioPlaybackRate,
  clampPlaybackRate,
  createRateMediaClock,
  mediaPositionSec,
  remainingWallSec,
  setRateMediaClockRate,
  startRateMediaClock,
} from "../../src/tts/playbackRate";
import { TUTOR_VOICE_SETTINGS } from "../../src/tts/voiceSettings";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(clampPlaybackRate(2) === 2, "2× must not be clamped to ElevenLabs generation range");
assert(clampPlaybackRate(0.5) === 0.5, "0.5× must stay below the generation floor");
assert(clampPlaybackRate(3) === 3, "3× is a legal lecture speed");

const html = { playbackRate: 1, preservesPitch: false } as HTMLAudioElement & {
  preservesPitch: boolean;
};
applyHtmlAudioPlaybackRate(html, 2.5);
assert(html.playbackRate === 2.5, "HTML audio must pick up a mid-cue rate");
assert(html.preservesPitch === true, "HTML audio must keep pitch while speeding");

const clock = createRateMediaClock(1);
startRateMediaClock(clock, 0);
assert(Math.abs(mediaPositionSec(clock, 0.5) - 0.5) < 1e-9, "1× media follows context time");
setRateMediaClockRate(clock, 0.5, 2);
assert(
  Math.abs(mediaPositionSec(clock, 1) - 1.5) < 1e-9,
  "a mid-sentence 2× change must add only the new-rate tail, not jump the first half",
);
assert(
  Math.abs(remainingWallSec(1, 2) - 0.5) < 1e-9,
  "remaining audio at 2× must finish in half the wall time",
);

type MessageListener = (event: { data: string }) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static sent: Array<Record<string, unknown>> = [];
  static sendCount = 0;
  static constructCount = 0;

  readyState = FakeWebSocket.CONNECTING;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private readonly messageListeners = new Set<MessageListener>();

  constructor(_url: string) {
    FakeWebSocket.constructCount += 1;
    setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit({ type: "ready" });
    }, 0);
  }

  addEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.messageListeners.add(listener);
  }

  removeEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.messageListeners.delete(listener);
  }

  send(data: string): void {
    const payload = JSON.parse(data) as Record<string, unknown>;
    FakeWebSocket.sent.push(payload);
    FakeWebSocket.sendCount = (FakeWebSocket.sendCount ?? 0) + 1;
    if (payload.flush) {
      setTimeout(() => {
        this.emit({
          audio_base64: "AQIDBA==",
          alignment: {
            character_start_times_seconds: [0, 0.05],
            character_end_times_seconds: [0.05, 0.1],
          },
        });
        this.emit({ isFinal: true });
      }, 0);
    }
  }

  close(): void {
    this.readyState = FakeWebSocket.CONNECTING;
  }

  private emit(payload: object): void {
    const event = { data: JSON.stringify(payload) };
    for (const listener of this.messageListeners) listener(event);
  }
}

class FakeAudioBufferSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  playbackRate = { value: 1 };
  started = false;

  connect(_destination: unknown): void {}

  start(_at: number): void {
    this.started = true;
  }

  stop(): void {
    this.onended?.();
  }
}

const sources: FakeAudioBufferSource[] = [];
let lastCtx: FakeAudioContext | null = null;

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  readonly destination = {};

  constructor() {
    lastCtx = this;
  }

  async resume(): Promise<void> {
    this.state = "running";
  }

  async suspend(): Promise<void> {
    this.state = "suspended";
  }

  async decodeAudioData(_bytes: ArrayBuffer): Promise<AudioBuffer> {
    const length = 44100;
    const data = [new Float32Array(length)];
    return {
      duration: 1,
      length,
      sampleRate: 44_100,
      numberOfChannels: 1,
      getChannelData: (channel: number) => data[channel] ?? data[0],
    } as AudioBuffer;
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      duration: length / sampleRate,
      length,
      sampleRate,
      numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel] ?? data[0],
    } as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeAudioBufferSource();
    sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createGain(): GainNode {
    return {
      gain: { value: 1 },
      connect(_destination: unknown) {},
    } as GainNode;
  }

  async close(): Promise<void> {
    this.state = "closed";
  }
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: globalThis,
});
Object.defineProperty(globalThis, "location", {
  configurable: true,
  value: { protocol: "http:", host: "localhost:3000", origin: "http://localhost:3000" },
});
Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  value: FakeWebSocket,
});
Object.defineProperty(globalThis, "AudioContext", {
  configurable: true,
  value: FakeAudioContext,
});
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
});

const { ElevenLabsWebSocketTTSClient } = await import("../../src/tts/elevenLabsWebSocketClient");
if (globalThis.WebSocket !== FakeWebSocket) {
  throw new Error(`WebSocket mock was replaced after import (got ${globalThis.WebSocket?.name})`);
}
const client = new ElevenLabsWebSocketTTSClient();
client.setPlaybackRate(2);
let speakError: unknown = null;
const speaking = client.speakSegment("The force is mass times acceleration.").catch((error: unknown) => {
  speakError = error;
});

const started = Date.now();
while (sources.length === 0 && Date.now() - started < 2000) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
if (sources.length === 0) {
  throw new Error(
    `websocket TTS never scheduled a buffer source (ws=${FakeWebSocket.constructCount}, sends=${FakeWebSocket.sendCount}, ctx=${lastCtx ? lastCtx.state : "none"}, speakError=${speakError instanceof Error ? speakError.message : String(speakError)}, sent=${JSON.stringify(FakeWebSocket.sent).slice(0, 400)})`,
  );
}
assertCondition(sources[0]!.started, "buffer source must start before a mid-cue rate change");
assertCondition(
  sources[0]!.playbackRate.value === 2,
  `fresh audio must start at the live rate, got ${sources[0]!.playbackRate.value}`,
);

const ctx = lastCtx;
assertCondition(ctx, "lecture AudioContext was not created");

const voiceMessage = FakeWebSocket.sent.find((payload) => payload.voice_settings);
const generatedSpeed =
  voiceMessage && typeof voiceMessage.voice_settings === "object" && voiceMessage.voice_settings
    ? (voiceMessage.voice_settings as { speed?: number }).speed
    : undefined;
assertCondition(
  generatedSpeed === TUTOR_VOICE_SETTINGS.speed,
  `user 2× must not be baked into ElevenLabs generation (got ${generatedSpeed})`,
);

ctx.currentTime = 0.52;
const firstHalf = client.getPlaybackPositionMs();
assertCondition(
  firstHalf !== null && firstHalf > 800,
  `2× media time must outrun wall time, got ${firstHalf}`,
);

client.setPlaybackRate(1);
assertCondition(
  sources.every((source) => source.playbackRate.value === 1),
  `mid-lecture 1× must retune the playing source, got ${sources.map((s) => s.playbackRate.value).join(",")}`,
);

ctx.currentTime = 1.02;
const afterSlowdown = client.getPlaybackPositionMs();
assertCondition(
  afterSlowdown !== null &&
    afterSlowdown > (firstHalf ?? 0) + 400 &&
    afterSlowdown < (firstHalf ?? 0) + 700,
  `slowing to 1× must add only the new-rate tail, got ${afterSlowdown} after ${firstHalf}`,
);

const rate = client.getPlaybackRate?.();
assertCondition(rate === 1, `getPlaybackRate must report the live rate, got ${rate}`);

const extraSource = {
  playbackRate: { value: 1 },
} as AudioBufferSourceNode;
applyBufferSourcePlaybackRate(extraSource, 1.75);
assert(extraSource.playbackRate.value === 1.75, "helper must write AudioBufferSourceNode.playbackRate");

client.stop();
await speaking.catch(() => undefined);

console.log("tts playback rate verification passed");
