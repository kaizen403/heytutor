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
 * A third fault was measured on 10 Sep 2026 and is gated here too: every
 * sentence but the first was generated ahead, so its alignment sat complete
 * in the client, and the runner still built every handwriting schedule on
 * the estimate because it asked 1 to 3 ms before the claim replayed
 * `onTimings`. The client now answers `peekSegmentTimings` before the claim,
 * a full alignment precedes `onStart` on every path, and the runner's first
 * schedule waits on `resolveInitialTimingWait` until that start — peeked
 * timings alone used to release the pen onto a silent wall clock. Measured
 * timelines are replayed at the end of this file.
 *
 * The fake socket below is the relay's half of the contract: a context that is
 * closed answers with audio and a final, and one that is not answers nothing.
 */
import {
  ElevenLabsWebSocketTTSClient,
  TTS_WS_LOOKAHEAD_SEGMENTS,
} from "../../src/tts/elevenLabsWebSocketClient";
import type { AudioTimings } from "../../src/tts/elevenLabsClient";
import {
  TUTOR_OPENING_VOICE_SETTINGS,
  TUTOR_VOICE_SETTINGS,
} from "../../src/tts/voiceSettings";
import {
  AUDIBLE_GRACE_AFTER_START_MS,
  INITIAL_TIMING_GRACE_AFTER_START_MS,
  classifyTtsScheduleUse,
  resolveInitialTimingWait,
  shouldStartLiveDraw,
  type InitialTimingWaitRelease,
} from "../../src/sync/liveAudioClock";

/** How long the fake provider takes to generate one sentence. */
const GENERATION_MS = 150;
/** Alignment emitted per character, so audio length identifies its sentence. */
const MS_PER_CHAR = 10;

type MessageListener = (event: { data: string }) => void;

interface SentSegment {
  text: string;
  sentAtMs: number;
  contextId: string;
  /** The dials the client asked for on this context. */
  voiceSettings?: { stability?: number; style?: number; speed?: number };
}

const sentSegments: SentSegment[] = [];
const openedUrls: string[] = [];
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
  private pendingSettings: SentSegment["voiceSettings"];
  private sequence = 0;

  constructor(url: string) {
    openedUrls.push(url);
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
      voice_settings?: { stability?: number; style?: number; speed?: number };
    };
    if (payload.voice_settings) {
      this.pendingSettings = payload.voice_settings;
    }
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
    sentSegments.push({
      text,
      sentAtMs: Date.now(),
      contextId,
      voiceSettings: this.pendingSettings,
    });
    this.pendingSettings = undefined;

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
    // ElevenLabs streams the alignment chunk by chunk, so for half the
    // generation the client holds a partial one: real starts for the first
    // words and nothing for the rest. Only the final says it is whole.
    const half = Math.ceil(charStartTimesMs.length / 2);
    setTimeout(() => {
      this.emit({
        contextId,
        audio: "AQIDBA==",
        normalizedAlignment: {
          charStartTimesMs: charStartTimesMs.slice(0, half),
          charDurationsMs: charDurationsMs.slice(0, half),
        },
      });
    }, generationMs / 2);
    setTimeout(() => {
      this.emit({
        contextId,
        audio: "AQIDBA==",
        normalizedAlignment: {
          charStartTimesMs: charStartTimesMs.slice(half),
          charDurationsMs: charDurationsMs.slice(half),
        },
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
      duration: 0.2,
      length,
      sampleRate: 44_100,
      numberOfChannels: 1,
      getChannelData: () => data[0]!,
    } as unknown as AudioBuffer;
  }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      duration: length / sampleRate,
      length,
      sampleRate,
      numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel] ?? data[0]!,
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
  value: async (url: string) => {
    if (url.endsWith("/api/tts/ws-ticket")) return Response.json({ ticket: "test-ticket" });
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

// The runner builds its handwriting schedule 1 to 3 ms before the claim
// replays `onTimings`, so it asks the client for the alignment first. While
// the sentence is still generating there is nothing complete to hand over: a
// partial alignment would schedule a row that ends mid-sentence.
assert(
  client.peekSegmentTimings(FIRST_TEXT) === null,
  "peek handed over an alignment for a sentence that has not generated anything",
);

// Half the alignment is in and the context is still open.
await new Promise((resolve) => setTimeout(resolve, GENERATION_MS / 2 + 15));
assert(
  client.peekSegmentTimings(FIRST_TEXT) === null,
  "peek handed over a partial alignment: the context was still open, so a row " +
    "scheduled on it would end mid-sentence",
);

await new Promise((resolve) => setTimeout(resolve, GENERATION_MS / 2 + 30));
const peekedFirst = client.peekSegmentTimings(FIRST_TEXT);
assert(peekedFirst !== null, "a generated, unclaimed sentence had no alignment to peek at");
assert(
  peekedFirst.charStartTimes.length === FIRST_TEXT.length,
  `peek returned ${peekedFirst.charStartTimes.length} characters of alignment for a ` +
    `${FIRST_TEXT.length} character sentence`,
);
assert(
  Math.round(peekedFirst.totalDuration * 1000) === FIRST_TEXT.length * MS_PER_CHAR,
  `peeked alignment covers ${Math.round(peekedFirst.totalDuration * 1000)}ms of a ` +
    `${FIRST_TEXT.length * MS_PER_CHAR}ms sentence`,
);
assert(
  client.peekSegmentTimings(FIRST_TEXT, { voiceSettings: TUTOR_OPENING_VOICE_SETTINGS }) === null,
  "peek matched on text alone and would hand an opening line the teaching voice's alignment",
);
assert(
  client.peekSegmentTimings("A sentence the lesson never sent.") === null,
  "peek found an alignment for a sentence that was never generated",
);
assert(
  sentSegments.length === 1,
  "peeking at a sentence's alignment sent its text upstream again",
);

/**
 * The order the client's callbacks fire in, per sentence. The runner gates
 * its first schedule on whichever of `onTimings` and `onStart` comes first,
 * so a transport that starts audio before it hands over the alignment puts
 * every row of that sentence on the estimate.
 */
type CallbackEvent = { kind: "timings"; chars: number } | { kind: "start" };

function assertAlignmentBeforeStart(events: CallbackEvent[], text: string, label: string): void {
  const startIndex = events.findIndex((event) => event.kind === "start");
  assert(startIndex >= 0, `${label} never started playing`);
  const before = events.slice(0, startIndex);
  const full = before.find((event) => event.kind === "timings" && event.chars === text.length);
  assert(
    full !== undefined,
    `${label}: onStart fired before a full alignment was handed over ` +
      `(saw ${JSON.stringify(before)} before start)`,
  );
}

const firstEvents: CallbackEvent[] = [];
let firstStarted = false;
let firstEnded = false;
let firstDurationMs = 0;
const firstSpeak = client.speakSegment(FIRST_TEXT, {
  onStart: () => {
    firstStarted = true;
    firstEvents.push({ kind: "start" });
  },
  onEnd: () => {
    firstEnded = true;
  },
  onTimings: (timings) => {
    firstDurationMs = Math.round(timings.totalDuration * 1000);
    firstEvents.push({ kind: "timings", chars: timings.charStartTimes.length });
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

assertAlignmentBeforeStart(firstEvents, FIRST_TEXT, "the claimed first sentence");

// The live shape exactly: the sentence about to be spoken was generated
// while the previous one played, and the runner reads its alignment before
// asking for it to be spoken.
const peekedSecond = client.peekSegmentTimings(SECOND_TEXT);
assert(
  peekedSecond !== null && peekedSecond.charStartTimes.length === SECOND_TEXT.length,
  `the sentence generated behind the previous one had ` +
    `${peekedSecond?.charStartTimes.length ?? 0} characters of alignment to peek at, ` +
    `not ${SECOND_TEXT.length}`,
);

const secondEvents: CallbackEvent[] = [];
let secondStartedAtMs = 0;
let secondDurationMs = 0;
await client.speakSegment(SECOND_TEXT, {
  onStart: () => {
    secondStartedAtMs = Date.now();
    secondEvents.push({ kind: "start" });
  },
  onTimings: (timings) => {
    secondDurationMs = Math.round(timings.totalDuration * 1000);
    secondEvents.push({ kind: "timings", chars: timings.charStartTimes.length });
  },
});
assertAlignmentBeforeStart(secondEvents, SECOND_TEXT, "the claimed second sentence");

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

// The opening beat is the one sentence in a turn spoken with its own dials,
// and the lookahead reaches it before the runner claims it. Both caches used
// to match on spoken text alone, so a sentence generated flat by the lookahead
// was handed to the opening and the start of every lesson sounded exactly like
// the body of it.
const OPENING_TEXT = "okay... this one asks for the distance travelled.";
const sentBeforeOpening = sentSegments.length;

client.prefetchSegment(OPENING_TEXT);
await new Promise((resolve) => setTimeout(resolve, 20));
const flat = sentSegments.at(-1);
assert(
  sentSegments.length === sentBeforeOpening + 1,
  "the plain prefetch never reached the relay, so this proves nothing",
);
assert(
  flat?.voiceSettings?.style === TUTOR_VOICE_SETTINGS.style,
  `a prefetch with no delivery must use the teaching voice, got style ${String(flat?.voiceSettings?.style)}`,
);

// Generated on demand, with its own dials: the one sentence of a turn that
// is not claimed from the lookahead. Its alignment must still land before
// its audio starts, or the opening row of every lesson runs on the estimate.
const openingEvents: CallbackEvent[] = [];
await client.speakSegment(OPENING_TEXT, {
  voiceSettings: TUTOR_OPENING_VOICE_SETTINGS,
  onStart: () => {
    openingEvents.push({ kind: "start" });
  },
  onTimings: (timings) => {
    openingEvents.push({ kind: "timings", chars: timings.charStartTimes.length });
  },
});
assertAlignmentBeforeStart(openingEvents, OPENING_TEXT, "the fresh opening sentence");
// The flat prefetch of this same text was dropped when the opening asked
// for its own dials, and the relay went on generating it. Its chunks and
// its final must not land on the opening: they once did, and the opening
// started with half its characters aligned and a final that was not its own.
const openingLastTimings = openingEvents.filter((event) => event.kind === "timings").at(-1);
assert(
  openingLastTimings?.kind === "timings" && openingLastTimings.chars === OPENING_TEXT.length,
  `the opening ended with ${openingLastTimings?.kind === "timings" ? openingLastTimings.chars : 0} ` +
    `characters aligned for a ${OPENING_TEXT.length} character sentence: a dropped ` +
    "context's chunks were routed into it",
);
const spoken = sentSegments.at(-1);
assert(
  sentSegments.length === sentBeforeOpening + 2,
  "the opening claimed the flat prefetch instead of generating with its own dials",
);
assert(
  spoken?.voiceSettings?.style === TUTOR_OPENING_VOICE_SETTINGS.style,
  `the opening reached the relay with style ${String(spoken?.voiceSettings?.style)}, not its own`,
);
assert(
  spoken?.voiceSettings?.stability === TUTOR_OPENING_VOICE_SETTINGS.stability,
  "the opening's stability did not reach the relay",
);

client.stop();

// ---------------------------------------------------------------------------
// The runner's first schedule waits on `resolveInitialTimingWait`. The old
// gate ran only once audio had started, which in the paired path was never,
// so it released at +0 and every row was built on the estimate 1 to 3 ms
// before the exact alignment arrived. These timelines are the ones measured
// live on 10 Sep 2026, in ms from the moment the runner asked to schedule.
type TimelineEvent = { atMs: number; kind: "timings" | "start" | "audible" | "complete" | "cancel" };

interface SimulatedRelease {
  releasedAtMs: number;
  source: InitialTimingWaitRelease;
}

function simulateInitialTimingWait(
  events: TimelineEvent[],
  hasNarration = true,
): SimulatedRelease | null {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  let timingChars = 0;
  let audioStartedAtMs: number | null = null;
  let playbackPositionMs: number | null = null;
  let speechComplete = false;
  let cancelled = false;
  const decide = (nowMs: number) =>
    resolveInitialTimingWait({
      hasNarration,
      timingChars,
      audioStartedAtMs,
      nowMs,
      speechComplete,
      cancelled,
      playbackPositionMs,
    });
  // The waiter arms a timer for `releaseAtMs`; it fires unless an event
  // lands first. Both paths go through the same decision, as they do live.
  const timerFires = (atMs: number): SimulatedRelease | null => {
    const timed = decide(atMs);
    return timed.release ? { releasedAtMs: atMs, source: timed.source } : null;
  };

  let decision = decide(0);
  if (decision.release) return { releasedAtMs: 0, source: decision.source };
  for (const event of sorted) {
    if (!decision.release && decision.releaseAtMs !== null && decision.releaseAtMs <= event.atMs) {
      const fired = timerFires(decision.releaseAtMs);
      if (fired) return fired;
    }
    if (event.kind === "timings") timingChars = 29;
    if (event.kind === "start") audioStartedAtMs = event.atMs;
    if (event.kind === "audible") playbackPositionMs = 1;
    if (event.kind === "complete") speechComplete = true;
    if (event.kind === "cancel") cancelled = true;
    decision = decide(event.atMs);
    if (decision.release) return { releasedAtMs: event.atMs, source: decision.source };
  }
  if (!decision.release && decision.releaseAtMs !== null) {
    return timerFires(decision.releaseAtMs);
  }
  return null;
}

function assertRelease(
  label: string,
  actual: SimulatedRelease | null,
  expected: SimulatedRelease,
): void {
  assert(actual !== null, `${label}: the pen never got its schedule`);
  assert(
    actual.releasedAtMs === expected.releasedAtMs && actual.source === expected.source,
    `${label}: released at +${actual.releasedAtMs}ms on ${actual.source}, ` +
      `expected +${expected.releasedAtMs}ms on ${expected.source}`,
  );
}

// Nothing has happened yet: the old gate released here. This one must not.
const idle = resolveInitialTimingWait({
  hasNarration: true,
  timingChars: 0,
  audioStartedAtMs: null,
  nowMs: 0,
  speechComplete: false,
  cancelled: false,
});
assert(
  !idle.release && idle.releaseAtMs === null,
  "the first schedule was released before the voice had started or aligned",
);

assert(
  simulateInitialTimingWait([{ atMs: 3, kind: "timings" }]) === null,
  "a peeked alignment must not release the pen before the voice is audible",
);

assertRelease(
  "prefetched sentence (alignment +3, start +13, audible with start)",
  simulateInitialTimingWait([
    { atMs: 3, kind: "timings" },
    { atMs: 13, kind: "start" },
    { atMs: 13, kind: "audible" },
  ]),
  { releasedAtMs: 13, source: "tts" },
);
assertRelease(
  "opening sentence generated on demand (alignment +838, start +839, audible with start)",
  simulateInitialTimingWait([
    { atMs: 838, kind: "timings" },
    { atMs: 839, kind: "start" },
    { atMs: 839, kind: "audible" },
  ]),
  { releasedAtMs: 839, source: "tts" },
);
assertRelease(
  "onStart before audible (alignment +3, start +13, first sample +180)",
  simulateInitialTimingWait([
    { atMs: 3, kind: "timings" },
    { atMs: 13, kind: "start" },
    { atMs: 180, kind: "audible" },
  ]),
  { releasedAtMs: 180, source: "tts" },
);
assert(
  INITIAL_TIMING_GRACE_AFTER_START_MS === 120,
  `the grace after onStart is ${INITIAL_TIMING_GRACE_AFTER_START_MS}ms; 120 covers every ` +
    "transport that aligns at all and stays under the audible onset plus a frame",
);
assertRelease(
  "browser voice (start +800, audible with start, never aligns)",
  simulateInitialTimingWait([
    { atMs: 800, kind: "start" },
    { atMs: 800, kind: "audible" },
  ]),
  { releasedAtMs: 920, source: "estimated" },
);
assertRelease(
  "alignment late but inside the grace (start +800, audible with start, alignment +850)",
  simulateInitialTimingWait([
    { atMs: 800, kind: "start" },
    { atMs: 800, kind: "audible" },
    { atMs: 850, kind: "timings" },
  ]),
  { releasedAtMs: 850, source: "tts" },
);
assert(
  AUDIBLE_GRACE_AFTER_START_MS === 280,
  `the audible grace is ${AUDIBLE_GRACE_AFTER_START_MS}ms; onStart-to-first-sample must not run a wall clock`,
);
assertRelease(
  "failed transport (speech complete +400, nothing else)",
  simulateInitialTimingWait([{ atMs: 400, kind: "complete" }]),
  { releasedAtMs: 400, source: "complete" },
);
assertRelease(
  "cancelled turn (+50)",
  simulateInitialTimingWait([{ atMs: 50, kind: "cancel" }]),
  { releasedAtMs: 50, source: "cancelled" },
);
assertRelease(
  "draw-only segment",
  simulateInitialTimingWait([], false),
  { releasedAtMs: 0, source: "silent" },
);

assert(
  !shouldStartLiveDraw({ hasNarration: true, audioStarted: false }),
  "a spoken segment must not dump ink before the voice is audible",
);
assert(
  shouldStartLiveDraw({ hasNarration: true, audioStarted: true }),
  "once the voice has started, the pen may follow it",
);
assert(
  shouldStartLiveDraw({ hasNarration: false, audioStarted: false }),
  "a draw-only segment has no voice to wait for",
);

// The schedule log names what became of the alignment. `schedule_source`
// alone could not separate "never came" from "came and was thrown away".
const scheduleUses: Array<[Parameters<typeof classifyTtsScheduleUse>[0], string]> = [
  [{ scheduleSource: "tts", timingChars: 40, timingValid: true }, "used"],
  [
    { scheduleSource: "estimated", scheduleReason: "estimated-from-script", timingChars: 0, timingValid: false },
    "missing",
  ],
  [
    { scheduleSource: "estimated", scheduleReason: "estimated-from-script", timingChars: 40, timingValid: false },
    "invalid",
  ],
  [
    { scheduleSource: "estimated", scheduleReason: "tts-schedule-unusable", timingChars: 40, timingValid: true },
    "unusable",
  ],
  [
    { scheduleSource: "estimated", scheduleReason: "fallback-spread-during-speech", timingChars: 40, timingValid: true },
    "unmatched",
  ],
];
for (const [input, expected] of scheduleUses) {
  const actual = classifyTtsScheduleUse(input);
  assert(
    actual === expected,
    `tts_schedule for ${JSON.stringify(input)} is ${actual}, expected ${expected}`,
  );
}

// A peeked alignment is what the runner hands to the schedule builder, so
// it must be the same shape `onTimings` delivers: segment relative, one
// start per character.
const peekedShape: AudioTimings = peekedFirst;
assert(
  peekedShape.charStartTimes[0] === 0 && peekedShape.charDurations.length === FIRST_TEXT.length,
  "a peeked alignment is not segment relative with one duration per character",
);

const tracedClient = new ElevenLabsWebSocketTTSClient();
const openedBeforeTrace = openedUrls.length;
await tracedClient.prewarm({ traceId: "turn-trace-1" });
assert(
  (openedUrls.at(-1) ?? "").includes("traceId=turn-trace-1"),
  "prewarm must stamp the Langfuse turn id on the TTS socket",
);
await tracedClient.prewarm({ traceId: "turn-trace-2" });
assert(
  openedUrls.length === openedBeforeTrace + 2,
  "a new turn id must reopen the TTS socket instead of keeping the previous turn's id",
);
assert(
  (openedUrls.at(-1) ?? "").includes("traceId=turn-trace-2"),
  "reopened TTS socket must carry the new turn id",
);

console.log(
  `verified tts lookahead: sentence two started ${gapMs}ms after sentence one, ` +
    `with ${GENERATION_MS}ms of generation hidden behind playback; ` +
    "peek returned the full alignment before the claim, alignment preceded onStart " +
    "on 3 of 3 sentences, and the initial timing wait released on 8 of 8 timelines",
);
