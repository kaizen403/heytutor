/**
 * Replays the 6 Nov 2026 production stall (Gauss law lesson).
 *
 * Sentence 0 was prefetched and played as native audio. While it played the
 * runner asked for sentences 1 and 2 ahead; both finished upstream (2 first,
 * then 1) before sentence 0 ended. The runner then asked to speak sentence 1
 * and nothing played: no first byte, no timings, 6.5 s of a still pen, then
 * the robotic browser voice.
 *
 * The audio existed: each Cartesia sentence is one uncompressed WAV, and on a
 * ~155 KB/s link sentence 1 was still downloading behind sentence 2 when the
 * 6.5 s startup budget ran out (it would have landed 20 ms later). The relay
 * now says `audio-in-transit` before it sends a sentence's audio, and the
 * client passes that to the claimed sentence, now or on claim, so the runner
 * waits for the voice instead of replacing it.
 */
import assert from "node:assert/strict";
import { StreamingSpeechClient, TTS_AUDIO_IN_TRANSIT_TYPE } from "../../src/tts/streamingSpeechClient";
import { TUTOR_OPENING_VOICE_SETTINGS, TUTOR_VOICE_SETTINGS } from "../../src/tts/voiceSettings";

class RunningContext {
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {};
  async resume() { this.state = "running"; }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; }
  decodeAudioData(): Promise<AudioBuffer> { return new Promise(() => {}); }
}
class NativeAudio {
  static instances: NativeAudio[] = [];
  playbackRate = 1;
  preservesPitch = false;
  muted = false;
  volume = 1;
  currentTime = 0;
  paused = true;
  src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  constructor(url: string) { this.src = url; NativeAudio.instances.push(this); }
  async play() { this.paused = false; this.currentTime += 0.1; this.onplaying?.(); }
  pause() { this.paused = true; }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  load() {}
  end() { this.onended?.(); }
}
type Listener = (event: { data: string }) => void;
class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static all: Socket[] = [];
  readyState = 0;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Array<{ text: string; index: number }> = [];
  listeners = new Set<Listener>();
  constructor(_url: string) {
    Socket.all.push(this);
    setTimeout(() => { this.readyState = 1; this.emit({ type: "ready" }); }, 0);
  }
  addEventListener(_type: string, listener: Listener) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: Listener) { this.listeners.delete(listener); }
  send(raw: string) {
    const message = JSON.parse(raw) as { text?: string; segment_index?: number };
    if (message.text) this.sent.push({ text: message.text, index: message.segment_index ?? this.sent.length + 1 });
  }
  close() { this.readyState = 3; this.onclose?.(); }
  emit(payload: object) { for (const listener of [...this.listeners]) listener({ data: JSON.stringify(payload) }); }
  /** Cartesia through the relay: audio with alignment, then a final, on the named context. */
  inTransit(index: number) {
    this.emit({ type: TTS_AUDIO_IN_TRANSIT_TYPE, contextId: `segment_${index}` });
  }
  answer(index: number) {
    // CartesiaContexts.accept: one message per sentence, the whole WAV, its
    // alignment and the final together, on the context the client named.
    this.emit({ contextId: `segment_${index}`, isFinal: true,
      audio: Buffer.from([82, 73, 70, 70, index]).toString("base64"),
      alignment: { characters: ["a", "b"], character_start_times_seconds: [0, 0.2], character_end_times_seconds: [0.2, 0.4] } });
  }
}
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: RunningContext });
Object.defineProperty(globalThis, "Audio", { configurable: true, value: NativeAudio });
Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket });
Object.defineProperty(globalThis, "location", { configurable: true,
  value: { protocol: "http:", host: "localhost:3000", origin: "http://localhost:3000" } });
Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: unknown) => {
  if (String(url).includes("ws-ticket")) return Response.json({ ticket: "offline-test" });
  throw new Error(`unexpected network call in offline gate: ${String(url)}`);
} });

async function waitFor(predicate: () => boolean, message: string) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 2));
  assert(predicate(), message);
}

const OPENING = "Let's understand Gauss's law with a simple picture.";
const INTRO = "Here S is a closed surface around an illustrative positive enclosed charge q, and the field vector starts on the surface.";
const NEXT = "The total flux through S depends only on the charge inside it.";
const trace = { traceId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222" };

async function replay(notice: "before-claim" | "after-claim" | "none") {
  const client = new StreamingSpeechClient();
  try {
    client.unlockAudio();
    // Production connects the socket when the question is asked (websocket-connect span).
    await client.prewarm(trace);
    client.prefetchSegment(OPENING, { ...trace, voiceSettings: TUTOR_OPENING_VOICE_SETTINGS });
    await waitFor(() => Socket.all.at(-1)?.sent.length === 1, "opening goes upstream");
    const socket = Socket.all.at(-1)!;
    socket.inTransit(1);
    socket.answer(1);
    await new Promise((resolve) => setTimeout(resolve, 5));

    let openingStarted = false;
    let openingInTransit = 0;
    const opening = client.speakSegment(OPENING, { ...trace, voiceSettings: TUTOR_OPENING_VOICE_SETTINGS,
      onAudioInTransit: () => { openingInTransit++; },
      onStart: () => { openingStarted = true; } });
    await waitFor(() => openingStarted, "the prefetched opening speaks");
    assert.equal(openingInTransit, 0, "audio already in hand is not in transit");
    const openingAudio = NativeAudio.instances.at(-1)!;
    const afterOpening = NativeAudio.instances.length;

    // Lookahead from the runner while sentence 0 plays.
    client.prefetchSegment(INTRO, { ...trace, previousText: OPENING, nextText: NEXT, voiceSettings: TUTOR_VOICE_SETTINGS });
    client.prefetchSegment(NEXT, { ...trace, previousText: INTRO, voiceSettings: TUTOR_VOICE_SETTINGS });
    await waitFor(() => socket.sent.length === 3, "both lookahead sentences go upstream");
    const introIndex = socket.sent.find((s) => s.text === INTRO)!.index;
    const nextIndex = socket.sent.find((s) => s.text === NEXT)!.index;
    // Sentence 2 is shorter and finishes first; its WAV holds the link.
    socket.inTransit(nextIndex);
    socket.answer(nextIndex);
    // Sentence 1 is complete at the relay, but its WAV is still on the wire.
    if (notice === "before-claim") socket.inTransit(introIndex);

    openingAudio.end();
    await opening;

    let inTransit = 0;
    let firstByte = false;
    let started = false;
    const intro = client.speakSegment(INTRO, { ...trace, previousText: OPENING, nextText: NEXT,
      voiceSettings: TUTOR_VOICE_SETTINGS,
      onAudioInTransit: () => { inTransit++; },
      onFirstAudioByte: () => { firstByte = true; },
      onStart: () => { started = true; } });
    void intro.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(started, false, `${notice}: nothing plays before the audio lands`);
    if (notice === "before-claim") assert.equal(inTransit, 1, "a notice heard before the claim reaches the claim");
    if (notice === "after-claim") {
      assert.equal(inTransit, 0);
      socket.inTransit(introIndex);
      assert.equal(inTransit, 1, "a notice for the claimed sentence reaches it at once");
      socket.inTransit(introIndex);
      assert.equal(inTransit, 1, "one notice per sentence");
    }
    if (notice === "none") assert.equal(inTransit, 0, "no notice, no extension");

    socket.answer(introIndex);
    await waitFor(() => started, `${notice}: sentence 1 speaks in the provider voice once its audio lands`);
    assert(firstByte, `${notice}: first byte reported`);
    assert.equal(socket.sent.length, 3, `${notice}: no second generation of sentence 1`);
    assert.equal(NativeAudio.instances.length, afterOpening + 1, `${notice}: one native element for sentence 1`);
    assert.equal(inTransit, notice === "none" ? 0 : 1, `${notice}: the final does not repeat the notice`);
    NativeAudio.instances.at(-1)!.end();
    await intro;
  } finally { client.stop(); }
}

await replay("before-claim");
await replay("after-claim");
await replay("none");
console.log("verify-tts-lookahead-claim: ok");
