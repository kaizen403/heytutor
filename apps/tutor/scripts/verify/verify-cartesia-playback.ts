import assert from "node:assert/strict";
import { StreamingSpeechClient } from "../../../../packages/tutor-core/src/tts/streamingSpeechClient";
import { pcmToWav } from "../../lib/tts/cartesiaProtocol";
import { createTtsRelay } from "../../lib/tts/ttsProvider";
import { ttsConfig } from "../../lib/tts/providerConfig";

const relay = createTtsRelay(
  ttsConfig("en-IN", false, { CARTESIA_API_KEY: "test" }),
);
const captures: { bytes: Uint8Array; mimeType: string }[] = [];
let decoded = 0;
let sent = 0;
class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  binaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private listeners = new Map<string, Set<(event: { data: string }) => void>>();
  private text = "";
  private index = 0;
  constructor() {
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      this.emit({ type: "ready" });
    }, 0);
  }
  addEventListener(type: string, fn: (event: { data: string }) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: { data: string }) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  private emit(payload: object) {
    for (const fn of this.listeners.get("message") ?? [])
      fn({ data: JSON.stringify(payload) });
  }
  send(raw: string) {
    const message = JSON.parse(raw);
    if (message.text) this.text += message.text;
    if (message.segment_index) this.index = message.segment_index;
    if (!message.flush || !this.text) return;
    const text = this.text.trim();
    this.text = "";
    const id = `segment_${this.index}`;
    sent++;
    relay.segment(id, text, {
      stability: 0.4,
      similarity_boost: 0.75,
      speed: 0.95,
    });
    setTimeout(
      () => {
        if (this.readyState !== 1) return;
        for (const event of [
          { type: "chunk", data: Buffer.alloc(4800).toString("base64") },
          {
            type: "timestamps",
            word_timestamps: { words: [text], start: [0], end: [0.1] },
          },
          { type: "done" },
        ]) {
          const normalized = relay.receive(
            JSON.stringify({ ...event, context_id: id }),
          );
          if (normalized) this.emit(JSON.parse(normalized));
        }
      },
      this.index === 1 ? 25 : 5,
    );
  }
  close() {
    this.readyState = 3;
    relay.dispose();
    this.onclose?.();
  }
}
class AudioContextFake {
  state = "running";
  currentTime = 0;
  sampleRate = 24000;
  destination = {};
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
  async close() {
    this.state = "closed";
  }
  async decodeAudioData(bytes: ArrayBuffer) {
    const wav = Buffer.from(bytes);
    assert.equal(
      wav.toString("ascii", 0, 4),
      "RIFF",
      "decode received incomplete or missing WAV",
    );
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    decoded++;
    return {
      duration: 0.1,
      sampleRate: 24000,
      numberOfChannels: 1,
      length: 2400,
      getChannelData: () => new Float32Array(2400),
    };
  }
  createBufferSource() {
    return {
      buffer: null,
      playbackRate: { value: 1 },
      onended: null as (() => void) | null,
      connect() {},
      disconnect() {},
      start() {
        setTimeout(() => this.onended?.(), 30);
      },
      stop() {
        this.onended?.();
      },
    };
  }
  createGain() {
    return { gain: { value: 1 }, connect() {} };
  }
}
async function main() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
      protocol: "http:",
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: Socket,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: AudioContextFake,
  });
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/api/tts/ws-ticket"))
      return Response.json({ ticket: "test" });
    throw new Error("Cartesia playback unexpectedly fell back to HTTP");
  };
  const client = new StreamingSpeechClient();
  await client.prewarm();
  client.prefetchSegment("First.");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(client.peekSegmentTimings("First.")?.charStartTimes.length, 6);
  const events: string[] = [];
  const first = client.speakSegment("First.", {
    onTimings: () => events.push("timings"),
    onStart: () => events.push("start"),
    onAudioCaptured: (audio) => captures.push(audio),
  });
  client.prefetchSegment("Second.");
  await first;
  await client.speakSegment("Second.", {
    onAudioCaptured: (audio) => captures.push(audio),
  });
  assert(events.indexOf("timings") < events.indexOf("start"));
  assert.equal(
    sent,
    2,
    "claiming a prefetched sentence must not regenerate it",
  );
  assert.equal(
    captures.length,
    2,
    "both sentences must be captured for replay",
  );
  assert(
    captures.every(
      (audio) => audio.mimeType === "audio/wav" && audio.bytes.length === 4844,
    ),
  );
  assert(decoded >= 2);
  client.stop();
  let httpCalls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/api/tts/ws-ticket"))
      return new Response(null, { status: 401 });
    assert(String(input).endsWith("/api/tts/stream"));
    assert.equal(new Headers(init?.headers).get("x-tts-lang"), "hi-IN");
    assert.equal(JSON.parse(String(init?.body)).low_latency, true);
    httpCalls++;
    return new Response(
      JSON.stringify({
        audio: pcmToWav(Buffer.alloc(4800)).toString("base64"),
      }) + "\n",
    );
  };
  const httpClient = new StreamingSpeechClient();
  httpClient.setVoicePreferences({ voiceKey: "hi-IN", lowLatency: true });
  await httpClient.speakSegment("Fallback.", {
    onAudioCaptured: (audio) => captures.push(audio),
  });
  assert.equal(httpCalls, 1);
  assert.equal(captures[2]?.mimeType, "audio/wav");
  httpClient.stop();
  console.log(
    "Cartesia adapter → browser: final-packet audio, lookahead, timings-before-start, WAV decoding and replay capture passed",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
