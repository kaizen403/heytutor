import {
  ElevenLabsWebSocketTTSClient,
  shouldCompleteTtsJobAfterSilence,
  TTS_WS_CONNECT_TIMEOUT_MS,
} from "../../src/tts/elevenLabsWebSocketClient";

type MessageListener = (event: { data: string }) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static sendCount = 0;

  readyState = FakeWebSocket.CONNECTING;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private readonly messageListeners = new Set<MessageListener>();

  constructor(_url: string) {
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
      setTimeout(() => this.emit({ isFinal: true }), 0);
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

let httpCalls = 0;
const httpPayload = {
  audio_base64: "AQIDBA==",
  normalizedAlignment: {
    charStartTimesMs: [0, 60],
    charDurationsMs: [60, 60],
  },
};
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (input: unknown) => {
    const url = String(input);
    if (!url.includes("/api/tts/stream")) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    httpCalls++;
    return new Response(`data: ${JSON.stringify(httpPayload)}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  },
});

const client = new ElevenLabsWebSocketTTSClient();
let starts = 0;
let ends = 0;
let errors = 0;
let capturedBytes = 0;

await client.speakSegment("This segment must survive an empty websocket result.", {
  onStart: () => starts++,
  onEnd: () => ends++,
  onError: () => errors++,
  onAudioCaptured: ({ bytes }) => {
    capturedBytes += bytes.length;
  },
});

assert(httpCalls === 1, "empty websocket completion did not trigger HTTP fallback");
assert(starts === 1, "fallback audio must start exactly once");
assert(ends === 1, "fallback audio must complete exactly once");
assert(errors === 0, "recoverable websocket failure leaked through onError");
assert(capturedBytes > 0, "fallback audio was not captured for replay");
const sendsAfterEmptyAudio = FakeWebSocket.sendCount;
await client.speakSegment("The next sentence must not wait on the same failed websocket.");
assert(httpCalls === 2, "the sentence after empty websocket audio must speak on HTTP");
assert(
  FakeWebSocket.sendCount === sendsAfterEmptyAudio,
  "empty websocket audio must disable websocket so later lines do not pause",
);

client.stop();

let pendingHttpSignal: AbortSignal | null = null;
let notifyHttpStarted: (() => void) | null = null;
const httpStarted = new Promise<void>((resolve) => {
  notifyHttpStarted = resolve;
});
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (input: unknown, init?: RequestInit) => {
    if (!String(input).includes("/api/tts/stream")) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    pendingHttpSignal = init?.signal ?? null;
    notifyHttpStarted?.();
    return await new Promise<Response>((_resolve, reject) => {
      pendingHttpSignal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
  },
});

const stoppedClient = new ElevenLabsWebSocketTTSClient();
let stoppedStarts = 0;
let stoppedEnds = 0;
let stoppedCapturedBytes = 0;
const stoppedSpeak = stoppedClient.speakSegment("Stop this fallback before its first chunk.", {
  onStart: () => stoppedStarts++,
  onEnd: () => stoppedEnds++,
  onAudioCaptured: ({ bytes }) => {
    stoppedCapturedBytes += bytes.length;
  },
});
await httpStarted;
stoppedClient.stop();
await stoppedSpeak;

assert(pendingHttpSignal?.aborted === true, "stop did not abort the in-flight HTTP fallback");
assert(stoppedStarts === 0, "stopped HTTP fallback invoked onStart");
assert(stoppedEnds === 0, "stopped HTTP fallback invoked onEnd");
assert(stoppedCapturedBytes === 0, "stopped HTTP fallback captured stale audio");

assert(
  shouldCompleteTtsJobAfterSilence({
    contextFinal: false,
    scheduledEnd: 0,
    currentTime: 1,
  }) === false,
  "a short network silence must not end speech before context-final",
);
assert(
  shouldCompleteTtsJobAfterSilence({
    contextFinal: true,
    scheduledEnd: 1.2,
    currentTime: 0.2,
  }) === false,
  "context-final must still wait for scheduled audio to finish",
);
assert(
  shouldCompleteTtsJobAfterSilence({
    contextFinal: true,
    scheduledEnd: 1.0,
    currentTime: 0.95,
  }) === true,
  "speech may complete only after context-final and playback drain",
);

class HangWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readyState = HangWebSocket.CONNECTING;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {
    this.readyState = HangWebSocket.CONNECTING;
    this.onclose?.();
  }
}

Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  value: HangWebSocket,
});

let hangHttpCalls = 0;
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (input: unknown) => {
    if (!String(input).includes("/api/tts/stream")) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    hangHttpCalls++;
    return new Response(`data: ${JSON.stringify(httpPayload)}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  },
});

const hangClient = new ElevenLabsWebSocketTTSClient();
const firstHangStarted = Date.now();
await hangClient.speakSegment("First line after a dead websocket.");
const firstHangMs = Date.now() - firstHangStarted;
assert(hangHttpCalls >= 1, "dead websocket did not fall back to HTTP");
assert(
  firstHangMs < 5_000,
  `dead websocket still used the old 5s connect wait (${firstHangMs}ms)`,
);

const secondHangStarted = Date.now();
await hangClient.speakSegment("Second line must not wait for websocket again.");
const secondHangMs = Date.now() - secondHangStarted;
assert(hangHttpCalls >= 2, "second sentence did not use HTTP");
assert(
  secondHangMs < TTS_WS_CONNECT_TIMEOUT_MS,
  `second sentence retried websocket (${secondHangMs}ms)`,
);

let prefetchFetches = 0;
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (input: unknown) => {
    if (!String(input).includes("/api/tts/stream")) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    prefetchFetches++;
    return new Response(`data: ${JSON.stringify(httpPayload)}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  },
});
const prefetchClient = new ElevenLabsWebSocketTTSClient();
prefetchClient.prefetchSegment("Prefetch this sentence so the next beat is ready.");
await new Promise((resolve) => setTimeout(resolve, 20));
assert(prefetchFetches === 1, "prefetch did not start HTTP generation early");
await prefetchClient.speakSegment("Prefetch this sentence so the next beat is ready.");
assert(prefetchFetches === 1, "speaking a prefetched sentence generated it a second time");

console.log("verified websocket fallback and HTTP stop cancellation");
