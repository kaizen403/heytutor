/**
 * Abandoning a stalled sentence keeps the audio already fetched for the next.
 *
 * Production lessons on 20 to 23 Oct 2026: the provider answered every
 * request in under three seconds, but on the student's link a sentence's
 * bytes arrived after the 6.5 s startup deadline. The runner then called
 * `abandonSpeaking()`, which aborted every HTTP prefetch and rejected every
 * socket lookahead job, including the NEXT sentence that had already been
 * downloaded. The next segment asked for it again behind the same congested
 * link, missed its deadline too, and the lesson never recovered.
 *
 * This gate stalls the first sentence, lets the second finish generating
 * ahead, abandons the first, and requires the second to play from what was
 * already fetched: no new socket context and no new HTTP request. It runs
 * once over the socket and once over HTTP, then checks late audio from the
 * abandoned sentence and a prefetch still in flight at the abandon.
 */
import { ElevenLabsWebSocketTTSClient } from "../../src/tts/elevenLabsWebSocketClient";

const FIRST = "The first sentence stalls on a slow link.";
const SECOND = "The second sentence was generated ahead and must still play.";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not finish in ${ms} ms`)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class FakeAudioBufferSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  playbackRate = { value: 1 };
  connect(): void {}
  start(): void { setTimeout(() => this.onended?.(), 50); }
  stop(): void { this.onended?.(); }
}
class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  sampleRate = 44_100;
  readonly destination = {};
  async resume(): Promise<void> { this.state = "running"; }
  async suspend(): Promise<void> { this.state = "suspended"; }
  async decodeAudioData(): Promise<AudioBuffer> { return this.createBuffer(1, 4410, 44_100); }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / sampleRate, length, sampleRate, numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel] ?? data[0]! } as unknown as AudioBuffer;
  }
  createBufferSource(): AudioBufferSourceNode { return new FakeAudioBufferSource() as unknown as AudioBufferSourceNode; }
  createGain(): GainNode { return { gain: { value: 1 }, connect() {} } as unknown as GainNode; }
  async close(): Promise<void> { this.state = "closed"; }
}

const define = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
define("window", globalThis);
define("location", { protocol: "http:", host: "localhost:3000", origin: "http://localhost:3000" });
define("AudioContext", FakeAudioContext);

const alignment = (text: string) => ({
  charStartTimesMs: [...text].map((_, i) => i * 10),
  charDurationsMs: [...text].map(() => 10),
});

/** The relay: the first sentence never answers, the second answers at once. */
const sentContexts: string[] = [];
class StallingRelay {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  /** The stalled first sentence's context, so a scenario can deliver its bytes late. */
  static stalled: { relay: StallingRelay; contextId: string } | null = null;
  /** Holds a sentence's end so late audio can arrive while it still generates. */
  static finalDelayMs = 0;
  readyState = StallingRelay.CONNECTING;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private readonly listeners = new Set<(event: { data: string }) => void>();
  private pending = "";
  private index: number | undefined;
  constructor() {
    setTimeout(() => { this.readyState = StallingRelay.OPEN; this.emit({ type: "ready" }); }, 0);
  }
  addEventListener(type: string, listener: (event: { data: string }) => void): void { if (type === "message") this.listeners.add(listener); }
  removeEventListener(type: string, listener: (event: { data: string }) => void): void { if (type === "message") this.listeners.delete(listener); }
  send(data: string): void {
    const payload = JSON.parse(data) as { text?: string; flush?: boolean; segment_index?: number };
    if (typeof payload.text === "string") this.pending += payload.text;
    if (typeof payload.segment_index === "number") this.index = payload.segment_index;
    if (!payload.flush) return;
    const text = this.pending.trim();
    this.pending = "";
    if (!text) return;
    const contextId = `segment_${this.index}`;
    sentContexts.push(text);
    if (text === FIRST) { StallingRelay.stalled = { relay: this, contextId }; return; } // No first byte: the production stall.
    setTimeout(() => this.emit({ contextId, audio: "AQIDBA==", normalizedAlignment: alignment(text) }), 20);
    setTimeout(() => this.emit({ contextId, isFinal: true }), 20 + StallingRelay.finalDelayMs);
  }
  close(): void { this.readyState = StallingRelay.CONNECTING; }
  emit(payload: object): void {
    const event = { data: JSON.stringify(payload) };
    for (const listener of this.listeners) listener(event);
  }
}

async function overWebSocket(): Promise<void> {
  define("WebSocket", StallingRelay);
  define("fetch", async (input: unknown) => {
    if (String(input).endsWith("/api/tts/ws-ticket")) return Response.json({ ticket: "test-ticket" });
    throw new Error("the socket scenario must not fall back to HTTP");
  });
  const client = new ElevenLabsWebSocketTTSClient();
  await client.prewarm();
  const first = client.speakSegment(FIRST).then(() => "resolved", () => "rejected");
  await sleep(30);
  client.prefetchSegment(SECOND);
  await sleep(120);
  assert(sentContexts.length === 2 && sentContexts[1] === SECOND, `expected the lookahead context for the second sentence, sent ${sentContexts.length}`);
  assert(client.peekSegmentTimings(SECOND) !== null, "the second sentence finished generating ahead");

  client.abandonSpeaking(); // The runner's 6.5 s startup deadline for the first.
  await within(first, 2_000, "the abandoned first sentence");

  let started = false;
  await within(client.speakSegment(SECOND, { onStart: () => { started = true; } }), 3_000, "the second sentence");
  assert(started, "the second sentence played");
  assert(sentContexts.length === 2,
    `the second sentence was generated again after the abandon (${sentContexts.length} contexts sent): ` +
      "abandonSpeaking threw away the lookahead job that already held its audio");
  client.stop();
  console.log("websocket: abandon keeps the lookahead job; the next sentence plays with no new context");
}

async function overHttp(): Promise<void> {
  // The socket ticket is refused, so this client speaks over HTTP.
  define("WebSocket", StallingRelay);
  const requests = new Map<string, number>();
  let firstAborted = false;
  define("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/tts/ws-ticket")) return new Response("{}", { status: 503 });
    if (!url.includes("/api/tts/stream")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    const text = (JSON.parse(String(init?.body ?? "{}")) as { text?: string }).text ?? "";
    requests.set(text, (requests.get(text) ?? 0) + 1);
    if (text === FIRST) {
      // The handler answered, but the bytes never reach this browser in time.
      return await new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => { firstAborted = true; reject(new DOMException("aborted", "AbortError")); });
      });
    }
    const payload = { audio_base64: "AQIDBA==", normalizedAlignment: alignment(text) };
    return new Response(`data: ${JSON.stringify(payload)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  const client = new ElevenLabsWebSocketTTSClient();
  const first = client.speakSegment(FIRST).then(() => "resolved", () => "rejected");
  await sleep(50);
  assert(requests.get(FIRST) === 1, "the first sentence is streaming over HTTP");
  client.prefetchSegment(SECOND);
  await sleep(120);
  assert(requests.get(SECOND) === 1, "the second sentence was prefetched over HTTP");
  assert(client.peekSegmentTimings(SECOND) !== null, "the second sentence's prefetch finished");

  client.abandonSpeaking();
  await within(first, 2_000, "the abandoned first sentence");
  assert(firstAborted, "abandon still aborts the stalled sentence's own stream");

  let started = false;
  await within(client.speakSegment(SECOND, { onStart: () => { started = true; } }), 3_000, "the second sentence");
  assert(started, "the second sentence played");
  assert(requests.get(SECOND) === 1,
    `the second sentence was requested ${requests.get(SECOND)} times: abandonSpeaking threw away its finished prefetch`);
  client.stop();
  console.log("http: abandon keeps the finished prefetch; the next sentence plays with no new request");
}

const SECOND_BYTES = [1, 2, 3, 4]; // "AQIDBA=="
const LATE_FIRST_AUDIO = "CQkJCQ=="; // [9, 9, 9, 9]: the abandoned sentence's own bytes

/**
 * Review of #275: the abandoned first sentence's audio arrives late, once
 * before the next sentence is claimed and once while it plays. It must be
 * dropped, never captured as the next sentence's audio, and must not open a
 * new context.
 */
async function lateAudioOverWebSocket(): Promise<void> {
  sentContexts.length = 0;
  StallingRelay.stalled = null;
  // The second sentence is still generating when the late bytes arrive, so
  // misrouted audio would land in its clip.
  StallingRelay.finalDelayMs = 400;
  define("WebSocket", StallingRelay);
  define("fetch", async (input: unknown) => {
    if (String(input).endsWith("/api/tts/ws-ticket")) return Response.json({ ticket: "test-ticket" });
    throw new Error("the socket scenario must not fall back to HTTP");
  });
  const client = new ElevenLabsWebSocketTTSClient();
  await client.prewarm();
  const first = client.speakSegment(FIRST).then(() => "resolved", () => "rejected");
  await sleep(30);
  client.prefetchSegment(SECOND);
  await sleep(120);
  const stalled = StallingRelay.stalled as { relay: StallingRelay; contextId: string } | null;
  assert(stalled, "the first sentence's context is stalled");
  client.abandonSpeaking();
  await within(first, 2_000, "the abandoned first sentence");

  // Before the claim: the abandoned sentence's bytes finally arrive.
  stalled.relay.emit({ contextId: stalled.contextId, audio: LATE_FIRST_AUDIO, normalizedAlignment: alignment(FIRST) });
  await sleep(10);
  const captured: number[][] = [];
  const second = client.speakSegment(SECOND, { onAudioCaptured: ({ bytes }) => { captured.push([...bytes]); } });
  await sleep(20); // The claim has landed: the second sentence is the current job.
  // After the claim: more of the abandoned sentence, then its end.
  stalled.relay.emit({ contextId: stalled.contextId, audio: LATE_FIRST_AUDIO, normalizedAlignment: alignment(FIRST) });
  stalled.relay.emit({ contextId: stalled.contextId, isFinal: true });
  await within(second, 3_000, "the second sentence");
  assert(captured.length >= 1, "the second sentence captured its audio");
  assert(captured.every((bytes) => JSON.stringify(bytes) === JSON.stringify(SECOND_BYTES)),
    `the second sentence captured ${JSON.stringify(captured)}: late audio from the abandoned sentence was attributed to it`);
  assert(sentContexts.length === 2, `late audio opened a new context (${sentContexts.length} sent)`);
  client.stop();
  StallingRelay.finalDelayMs = 0;
  console.log("websocket: late audio from the abandoned sentence is dropped; the next sentence keeps its own bytes");
}

/**
 * Review of #275: a prefetch still in flight when the stalled sentence is
 * abandoned survives: it is not aborted, it is requested once, and it plays
 * its own bytes.
 */
async function inFlightPrefetchOverHttp(): Promise<void> {
  define("WebSocket", StallingRelay);
  const requests = new Map<string, number>();
  let secondAborted = false;
  define("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/tts/ws-ticket")) return new Response("{}", { status: 503 });
    if (!url.includes("/api/tts/stream")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    const text = (JSON.parse(String(init?.body ?? "{}")) as { text?: string }).text ?? "";
    requests.set(text, (requests.get(text) ?? 0) + 1);
    if (text === FIRST) {
      return await new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    init?.signal?.addEventListener("abort", () => { secondAborted = true; });
    await sleep(250); // Still downloading when the first sentence is abandoned.
    const payload = { audio_base64: "AQIDBA==", normalizedAlignment: alignment(text) };
    return new Response(`data: ${JSON.stringify(payload)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  const client = new ElevenLabsWebSocketTTSClient();
  const first = client.speakSegment(FIRST).then(() => "resolved", () => "rejected");
  await sleep(50);
  client.prefetchSegment(SECOND);
  await sleep(30);
  assert(requests.get(SECOND) === 1, "the second sentence's prefetch is in flight");
  assert(client.peekSegmentTimings(SECOND) === null, "the prefetch has not finished yet");

  client.abandonSpeaking();
  await within(first, 2_000, "the abandoned first sentence");
  assert(!secondAborted, "abandon aborted the next sentence's prefetch while it was still in flight");

  let started = false;
  const captured: number[][] = [];
  await within(client.speakSegment(SECOND, {
    onStart: () => { started = true; },
    onAudioCaptured: ({ bytes }) => { captured.push([...bytes]); },
  }), 3_000, "the second sentence");
  assert(started, "the second sentence played");
  assert(!secondAborted, "the in flight prefetch was aborted");
  assert(requests.get(SECOND) === 1, `the second sentence was requested ${requests.get(SECOND)} times`);
  assert(captured.length >= 1, "the second sentence captured its audio");
  assert(captured.every((bytes) => JSON.stringify(bytes) === JSON.stringify(SECOND_BYTES)),
    `the second sentence played ${JSON.stringify(captured)}, not its own bytes`);
  client.stop();
  console.log("http: an in flight prefetch survives the abandon, is requested once and plays its own bytes");
}

let failures = 0;
for (const scenario of [overWebSocket, overHttp, lateAudioOverWebSocket, inFlightPrefetchOverHttp]) {
  try { await scenario(); } catch (error) { failures++; console.error(`FAIL ${scenario.name}:`, error instanceof Error ? error.message : error); }
}
if (failures > 0) {
  console.error(`verify-tts-abandon-keeps-lookahead: ${failures} scenario(s) failed`);
  process.exit(1);
}
console.log("verify-tts-abandon-keeps-lookahead: passed");
process.exit(0);
