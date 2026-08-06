import { ElevenLabsWebSocketTTSClient } from "../src/elevenLabsWebSocketClient";

type MessageListener = (event: { data: string }) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;

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
    return { duration: 0.1 } as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    return new FakeAudioBufferSource() as unknown as AudioBufferSourceNode;
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
  value: async () => {
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

client.stop();
console.log("verified empty websocket audio falls back to one HTTP playback");
