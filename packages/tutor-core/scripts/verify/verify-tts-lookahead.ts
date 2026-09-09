/**
 * A lecture may not stop between sentences.
 *
 * Two measured faults produced the pauses this gate exists to keep out:
 *
 * 1. ElevenLabs emits `isFinal` for a context only when that context closes,
 *    never on a flush. The browser gates playback on that final, so while the
 *    relay left contexts open the socket generated every sentence and spoke
 *    none: twelve seconds of silence, then HTTP for the rest of the lesson.
 * 2. Nothing was generated ahead. The next sentence's text went upstream only
 *    after the current one had finished playing, so every segment boundary
 *    cost a full round trip — measured at 1.2s to 2.6s of dead air.
 *
 * The fake socket below is the relay's half of the contract: a context that is
 * closed answers with audio and a final, and one that is not answers nothing.
 */
import {
  ElevenLabsWebSocketTTSClient,
  TTS_WS_LOOKAHEAD_SEGMENTS,
} from "../../src/tts/elevenLabsWebSocketClient";

/** How long the fake provider takes to generate one sentence. */
const GENERATION_MS = 150;
/** Alignment emitted per character, so audio length identifies its sentence. */
const MS_PER_CHAR = 10;

type MessageListener = (event: { data: string }) => void;

interface SentSegment {
  text: string;
  sentAtMs: number;
  contextId: string;
}

const sentSegments: SentSegment[] = [];
let closedContexts = 0;
let clientNamedContexts = 0;

class RelayWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;

  readyState = RelayWebSocket.CONNECTING;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private readonly listeners = new Set<MessageListener>();
  private pendingText = "";
  private pendingIndex: number | undefined;
  private sequence = 0;

  constructor(_url: string) {
    setTimeout(() => {
      this.readyState = RelayWebSocket.OPEN;
      this.emit({ type: "ready" });
    }, 0);
  }

  addEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.listeners.delete(listener);
  }

  send(data: string): void {
    const payload = JSON.parse(data) as {
      text?: string;
      flush?: boolean;
      segment_index?: number;
    };
    if (typeof payload.text === "string" && payload.text.length > 0) {
      this.pendingText += payload.text;
    }
    if (typeof payload.segment_index === "number") {
      this.pendingIndex = payload.segment_index;
    }
    if (!payload.flush) return;

    const text = this.pendingText.trim();
    this.pendingText = "";
    if (!text) return;

    // The relay answers on the context the client named. Numbering the
    // contexts here instead is what lets a mismatch go unnoticed.
    this.sequence += 1;
    clientNamedContexts += this.pendingIndex === undefined ? 0 : 1;
    const contextId = `segment_${this.pendingIndex ?? this.sequence}`;
    this.pendingIndex = undefined;
    sentSegments.push({ text, sentAtMs: Date.now(), contextId });

    // One tick of alignment per character, so a sentence's audio is as long as
    // the sentence. A crossed context then shows up as the wrong duration.
    const charStartTimesMs = text.split("").map((_char, i) => i * MS_PER_CHAR);
    const charDurationsMs = text.split("").map(() => MS_PER_CHAR);

    // A later context can finish first — the second sentence is shorter, or
    // the provider is simply quicker with it. Routing has to survive that.
    const generationMs = this.sequence === 1 ? GENERATION_MS : GENERATION_MS / 3;

    // The relay closes the context in the same breath as the flush. Without
    // that close there is no final, and the client would never speak.
    closedContexts += 1;
    setTimeout(() => {
      this.emit({
        contextId,
        audio: "AQIDBA==",
        normalizedAlignment: { charStartTimesMs, charDurationsMs },
      });
      this.emit({ contextId, isFinal: true });
    }, generationMs);
  }

  close(): void {
    this.readyState = RelayWebSocket.CONNECTING;
  }

  private emit(payload: object): void {
    const event = { data: JSON.stringify(payload) };
    for (const listener of this.listeners) listener(event);
  }
}

class FakeAudioBufferSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  playbackRate = { value: 1 };
  connect(_destination: unknown): void {}
  start(_at: number): void {
    // Playing takes real time, which is what a lookahead has to hide behind.
    setTimeout(() => this.onended?.(), 200);
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
      duration: 0.2,
      length,
      sampleRate: 44_100,
      numberOfChannels: 1,
      getChannelData: () => data[0]!,
    } as unknown as AudioBuffer;
  }
  createBufferSource(): AudioBufferSourceNode {
    return new FakeAudioBufferSource() as unknown as AudioBufferSourceNode;
  }
  createGain(): GainNode {
    return { gain: { value: 1 }, connect(_destination: unknown) {} } as GainNode;
  }
  async close(): Promise<void> {
    this.state = "closed";
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
// resolveWebSocketUrl reads window.location; without one the socket never
// opens and this gate would quietly pass on the HTTP path instead.
Object.defineProperty(globalThis, "location", {
  configurable: true,
  value: { protocol: "http:", host: "localhost:3000", origin: "http://localhost:3000" },
});
Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: RelayWebSocket });
Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeAudioContext });
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async () => {
    throw new Error("a working websocket must not fall back to HTTP");
  },
});

assert(
  TTS_WS_LOOKAHEAD_SEGMENTS >= 1,
  "the socket must generate at least one sentence ahead of the one being spoken",
);

const FIRST_TEXT = "First sentence of the lesson.";
const SECOND_TEXT = "Second one, which is a good deal longer than the first sentence was.";

const client = new ElevenLabsWebSocketTTSClient();
await client.prewarm();


// This is the live shape: a segment is prefetched when it is queued, and the
// segment runner asks for the next one as it starts speaking the current one.
client.prefetchSegment(FIRST_TEXT);
await new Promise((resolve) => setTimeout(resolve, 20));

assert(
  sentSegments.length === 1,
  `prefetch did not open a context for the first sentence (sent ${sentSegments.length})`,
);

let firstStarted = false;
let firstEnded = false;
let firstDurationMs = 0;
const firstSpeak = client.speakSegment(FIRST_TEXT, {
  onStart: () => {
    firstStarted = true;
  },
  onEnd: () => {
    firstEnded = true;
  },
  onTimings: (timings) => {
    firstDurationMs = Math.round(timings.totalDuration * 1000);
  },
});
client.prefetchSegment(SECOND_TEXT);

await firstSpeak;
const firstFinishedAtMs = Date.now();

assert(firstStarted, "a pre-generated sentence never started playing");
assert(firstEnded, "a pre-generated sentence never finished");
assert(
  sentSegments.length === 2,
  "the next sentence's text was not sent while the current one was still speaking",
);
assert(
  sentSegments[1]!.sentAtMs < firstFinishedAtMs,
  "the next sentence went upstream only after the current one stopped — that gap is the pause",
);
assert(
  closedContexts === sentSegments.length,
  "a flushed context was left open, so its sentence can never be spoken",
);

let secondStartedAtMs = 0;
let secondDurationMs = 0;
await client.speakSegment(SECOND_TEXT, {
  onStart: () => {
    secondStartedAtMs = Date.now();
  },
  onTimings: (timings) => {
    secondDurationMs = Math.round(timings.totalDuration * 1000);
  },
});

const gapMs = secondStartedAtMs - firstFinishedAtMs;
assert(secondStartedAtMs > 0, "the second sentence never started playing");
assert(
  gapMs < GENERATION_MS,
  `the lecture paused ${gapMs}ms between sentences — the second was generated from scratch`,
);
assert(
  sentSegments.length === 2,
  "speaking a pre-generated sentence sent its text upstream a second time",
);

assert(
  clientNamedContexts === sentSegments.length,
  "the client stopped naming its contexts, so pairing falls back to arrival order",
);

// Two contexts are open at once and the second finishes first, so each
// sentence has to be handed the audio of its own text and no one else's.
assert(
  firstDurationMs === FIRST_TEXT.length * MS_PER_CHAR,
  `the first sentence got ${firstDurationMs}ms of audio for ${FIRST_TEXT.length} characters — contexts crossed`,
);
assert(
  secondDurationMs === SECOND_TEXT.length * MS_PER_CHAR,
  `the second sentence got ${secondDurationMs}ms of audio for ${SECOND_TEXT.length} characters — contexts crossed`,
);

client.stop();

console.log(
  `verified tts lookahead: sentence two started ${gapMs}ms after sentence one, ` +
    `with ${GENERATION_MS}ms of generation hidden behind playback`,
);
