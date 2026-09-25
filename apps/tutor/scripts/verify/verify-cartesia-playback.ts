import assert from "node:assert/strict";
import { StreamingSpeechClient } from "../../../../packages/tutor-core/src/tts/streamingSpeechClient";
import { pcmToWav } from "../../lib/tts/cartesiaProtocol";
import { createTtsRelay } from "../../lib/tts/ttsProvider";
import { ttsConfig } from "../../lib/tts/providerConfig";
import { requireSpeechStart } from "../../features/tutor-session/lib/turn/speechStartup";

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
  static latest: AudioContextFake | null = null;
  state = "running";
  currentTime = 0;
  sampleRate = 24000;
  destination = {};
  constructor() {
    AudioContextFake.latest = this;
  }
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

  // An HTMLAudioElement may wait for its decoder or output device after
  // play() is called. The whiteboard must not consume AudioContext time as
  // though that pending element were audible, and a rejected play() must not
  // count as a successfully spoken segment.
  class DelayedAudio {
    static latest: DelayedAudio | null = null;
    currentTime = 0;
    playbackRate = 1;
    preservesPitch = false;
    muted = false;
    volume = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private resolvePlay: (() => void) | null = null;
    private rejectPlay: ((error: Error) => void) | null = null;
    constructor() {
      DelayedAudio.latest = this;
    }
    play(): Promise<void> {
      return new Promise((resolve, reject) => {
        this.resolvePlay = resolve;
        this.rejectPlay = reject;
      });
    }
    start() {
      this.currentTime = 0.05;
      this.resolvePlay?.();
    }
    fail() {
      this.rejectPlay?.(new Error("audio output blocked"));
    }
    end() {
      this.onended?.();
    }
    pause() {}
    removeAttribute() {}
    load() {}
  }
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: DelayedAudio,
  });
  const currentHtmlAudio = (): DelayedAudio | null => DelayedAudio.latest;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/api/tts/ws-ticket"))
      return new Response(null, { status: 401 });
    return new Response(
      JSON.stringify({ audio: pcmToWav(Buffer.alloc(4800)).toString("base64") }) + "\n",
    );
  };
  const delayedClient = new StreamingSpeechClient();
  delayedClient.setPlaybackRate(1.25);
  let starts = 0;
  const delayed = delayedClient.speakSegment("Delayed.", {
    onStart: () => { starts++; },
  });
  for (let i = 0; !currentHtmlAudio() && i < 50; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  const firstAudio = currentHtmlAudio();
  assert(firstAudio, "HTTP narration must reach HTML audio");
  AudioContextFake.latest!.currentTime = 1;
  assert.equal(starts, 0, "pending play() must not release the drawing start gate");
  assert.equal(delayedClient.getPlaybackPositionMs(), null, "pending HTML audio must not use the running AudioContext clock");
  firstAudio.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(starts, 1, "audible HTML playback starts the paired drawing");
  assert(Math.abs((delayedClient.getPlaybackPositionMs() ?? 0) - 50) < 1, "drawing follows the HTML media clock");
  firstAudio.end();
  await delayed;
  DelayedAudio.latest = null;
  const blocked = delayedClient.speakSegment("Blocked.", {
    onStart: () => { starts++; },
  });
  for (let i = 0; !currentHtmlAudio() && i < 50; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  const blockedAudio = currentHtmlAudio();
  assert(blockedAudio);
  blockedAudio.fail();
  await assert.rejects(
    requireSpeechStart(blocked, () => starts > 1),
    /voice could not start/i,
    "blocked playback must be recoverable, not silently treated as spoken",
  );
  assert.equal(starts, 1, "blocked playback must not release the drawing start gate");
  delayedClient.stop();

  // The normal production transport is WebSocket lookahead. It must obey the
  // same audible-start contract as the HTTP fallback above.
  DelayedAudio.latest = null;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/api/tts/ws-ticket"))
      return Response.json({ ticket: "test" });
    throw new Error("WebSocket narration unexpectedly fell back to HTTP");
  };
  const wsDelayedClient = new StreamingSpeechClient();
  wsDelayedClient.setPlaybackRate(1.25);
  let wsStarts = 0;
  const wsDelayed = wsDelayedClient.speakSegment("Socket delayed.", {
    onStart: () => { wsStarts++; },
  });
  for (let i = 0; !currentHtmlAudio() && i < 50; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  const socketAudio = currentHtmlAudio();
  assert(socketAudio, "WebSocket narration must reach HTML audio");
  AudioContextFake.latest!.currentTime = 1;
  assert.equal(wsStarts, 0, "WebSocket playback must wait for audible HTML audio");
  assert.equal(wsDelayedClient.getPlaybackPositionMs(), null, "WebSocket drawing must not run on the AudioContext while HTML audio buffers");
  socketAudio.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(wsStarts, 1);
  socketAudio.end();
  await wsDelayed;
  DelayedAudio.latest = null;
  const wsBlocked = wsDelayedClient.speakSegment("Socket blocked.", {
    onStart: () => { wsStarts++; },
  });
  for (let i = 0; !currentHtmlAudio() && i < 50; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  const socketBlockedAudio = currentHtmlAudio();
  assert(socketBlockedAudio);
  socketBlockedAudio.fail();
  await assert.rejects(
    requireSpeechStart(wsBlocked, () => wsStarts > 1),
    /voice could not start/i,
    "a rejected WebSocket playback must fail over instead of hanging the segment",
  );
  assert.equal(wsStarts, 1);
  wsDelayedClient.stop();

  let fallbackUtteranceRate = 0;
  class Utterance {
    rate = 1;
    pitch = 1;
    volume = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onboundary: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: Utterance,
  });
  Object.defineProperty(globalThis, "speechSynthesis", {
    configurable: true,
    value: {
      getVoices: () => [],
      resume() {},
      cancel() {},
      speak(utterance: Utterance) {
        fallbackUtteranceRate = utterance.rate;
        setTimeout(() => {
          utterance.onstart?.();
          setTimeout(() => utterance.onend?.(), 10);
        }, 0);
      },
    },
  });
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/api/tts/ws-ticket"))
      return new Response(null, { status: 401 });
    throw new Error("speech provider unavailable");
  };
  const naturalFallbackClient = new StreamingSpeechClient();
  naturalFallbackClient.setPlaybackRate(2);
  let rateDuringFallback = 0;
  await naturalFallbackClient.speakSegment("Natural fallback.", {
    onStart: () => { rateDuringFallback = naturalFallbackClient.getPlaybackRate(); },
  });
  assert.equal(fallbackUtteranceRate, 1, "system voice must not speak at the user's 2× media rate");
  assert.equal(rateDuringFallback, 1, "drawing must follow the fallback's actual 1× voice rate");
  assert.equal(naturalFallbackClient.getPlaybackRate(), 2, "provider audio retains the selected rate afterward");
  naturalFallbackClient.stop();
  console.log(
    "Cartesia adapter → browser: final-packet audio, lookahead, timings-before-start, WAV decoding and replay capture passed",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
