// Exercise real public sentence/voice ownership across asynchronous socket close.
import {
  ElevenLabsWebSocketTTSClient,
} from "../../src/tts/elevenLabsWebSocketClient";
type MessageListener = (event: { data: string }) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static sendCount = 0;
  static flushCount = 0;
  static closeCount = 0;
  static autoAudio = false;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private readonly messageListeners = new Set<MessageListener>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
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
    FakeWebSocket.sendCount += 1;
    const payload = JSON.parse(data) as { flush?: boolean };
    if (payload.flush) {
      FakeWebSocket.flushCount += 1;
      if (FakeWebSocket.autoAudio) setTimeout(() => this.emit({ isFinal: true, audio_base64: "AQIDBA==" }), 0);
    }
  }

  close(): void {
    FakeWebSocket.closeCount += 1;
    this.readyState = 3;
    setTimeout(() => this.onclose?.(), 0);
  }

  emit(payload: object): void {
    const event = { data: JSON.stringify(payload) };
    for (const listener of this.messageListeners) listener(event);
  }
}

class FakeAudioBufferSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  playbackRate = { value: 1 };

  connect(_destination: unknown): void {}

  start(_at: number): void {
    setTimeout(() => this.onended?.(), 0);
  }

  stop(): void {
    this.onended?.();
  }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  sampleRate = 44_100;
  readonly destination = {};

  async resume(): Promise<void> {
    this.state = "running";
  }

  async suspend(): Promise<void> {
    this.state = "suspended";
  }

  async decodeAudioData(_bytes: ArrayBuffer): Promise<AudioBuffer> {
    const length = 4410;
    const data = [new Float32Array(length)];
    return {
      duration: 0.1,
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
    return new FakeAudioBufferSource() as unknown as AudioBufferSourceNode;
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: globalThis,
});
Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  value: FakeWebSocket,
});
Object.defineProperty(globalThis, "AudioContext", {
  configurable: true,
  value: FakeAudioContext,
});

Object.defineProperty(globalThis, "location", { configurable: true, value: { protocol: "http:", host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } });
let httpCalls = 0;
let requestedVoice: string | null = null;
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (input: unknown, init?: RequestInit) => {
    if (!String(input).includes("/api/tts/stream")) {
      return new Response('{"ticket":"test-ticket"}', { status: 200, headers: { "content-type": "application/json" } });
    }
    httpCalls++;
    requestedVoice = new Headers(init?.headers).get("x-tts-lang");
    return new Response(`data: ${JSON.stringify({ audio_base64: "AQIDBA==" })}\n\n`, {
      status: 200, headers: { "content-type": "text/event-stream" },
    });
  },
});
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const client = new ElevenLabsWebSocketTTSClient();
let settled = false;
const speaking = client.speakSegment("The next sentence is waiting for its first audio.");
void speaking.then(() => { settled = true; }, () => { settled = true; });
try {
  const deadline = Date.now() + 500;
  while (FakeWebSocket.flushCount === 0 && Date.now() < deadline) await sleep(1);
  assert(FakeWebSocket.flushCount === 1, "the real speak path must queue one unsounded sentence");
  const unchangedCloses = FakeWebSocket.closeCount;
  client.setVoicePreferences({ voiceKey: "en-IN", lowLatency: false });
  await sleep(10);
  assert(FakeWebSocket.closeCount === unchangedCloses && httpCalls === 0,
    "unchanged voice preferences must keep the waiting sentence and socket");
  client.setVoicePreferences({ voiceKey: "en-GB", lowLatency: false });
  await sleep(40);
  assert(httpCalls === 1, "a same-language voice switch must release the unsounded socket job immediately, not wait for the segment timeout");
  assert(requestedVoice === "en-GB", "recovery must use the new accent");
  await speaking;
  assert(settled, "the switched sentence must finish");
  console.log("verified same-language voice switch releases the unsounded sentence promptly");
} finally { client.stop(); }

// An audible line is kept until it ends in the selected old voice.
FakeWebSocket.autoAudio = true;
const activeClient = new ElevenLabsWebSocketTTSClient();
let activeStarts = 0, activeEnds = 0;
const activeCloses = FakeWebSocket.closeCount;
try {
  await activeClient.speakSegment("The line already speaking keeps its voice.", {
    onStart: () => {
      activeStarts++;
      activeClient.setVoicePreferences({ voiceKey: "en-GB", lowLatency: false });
      assert(FakeWebSocket.closeCount === activeCloses, "a mid-sentence voice switch must not close the current line's socket");
    },
    onEnd: () => activeEnds++,
  });
  assert(activeStarts === 1 && activeEnds === 1, "the audible line must finish once after a voice switch");
} finally { activeClient.stop(); }

// A close queued by the retired socket must never settle the successor's job.
FakeWebSocket.autoAudio = false;
const staleClient = new ElevenLabsWebSocketTTSClient();
const staleHttpBefore = httpCalls;
try {
  await staleClient.prewarm();
  const old = FakeWebSocket.instances.at(-1);
  assert(old, "the old connection must exist");
  staleClient.setVoicePreferences({ voiceKey: "en-GB", lowLatency: false });
  const successor = staleClient.speakSegment("The newly selected voice owns this job.");
  void successor.catch(() => {});
  const sentBefore = FakeWebSocket.flushCount;
  const deadline = Date.now() + 500;
  while (FakeWebSocket.flushCount === sentBefore && Date.now() < deadline) await sleep(1);
  const fresh = FakeWebSocket.instances.at(-1);
  assert(fresh && fresh !== old && fresh.url.includes("lang=en-GB"), "the next socket must use the new accent");
  await sleep(40);
  assert(httpCalls === staleHttpBefore, "a retired socket close must not reject a fresh waiting sentence");
  fresh.emit({ isFinal: true, audio_base64: "AQIDBA==" });
  await successor;
} finally { staleClient.stop(); }
console.log("verified unchanged preferences, active speech, and stale-close successor isolation");
