import assert from "node:assert/strict";
import { mock } from "node:test";
import { createLectureAudioContext, getSharedAudioContext, haltAllLectureAudio, releaseLectureAudioContext, unlockTutorAudio } from "../../src/tts/audioContext";
import { HttpSpeechClient, SpeechSynthesisTTSClient } from "../../src/tts/speechClient";
import { StreamingSpeechClient } from "../../src/tts/streamingSpeechClient";

let inGesture = false;
let contextsCreated = 0;
class Context {
  state: AudioContextState = "suspended";
  currentTime = 0;
  sampleRate = 44_100;
  destination = {};
  private readonly createdInGesture = inGesture;
  constructor() { contextsCreated++; }
  async resume() { if (this.createdInGesture) this.state = "running"; }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; }
  createBuffer() { return {} as AudioBuffer; }
  createBufferSource() { return { connect() {}, start() {}, stop() {} } as AudioBufferSourceNode; }
  createGain() { return { gain: { value: 1 }, connect() {} } as GainNode; }
}
class Utterance {
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onboundary: (() => void) | null = null;
  volume = 1;
  rate = 1;
  pitch = 1;
  constructor(readonly text: string) {}
}
let active: Utterance | null = null;
function currentUtterance(): Utterance {
  const value = active as Utterance | null;
  assert(value, "browser speech did not start");
  return value;
}
let cancellations = 0;
const speech = {
  getVoices: () => [],
  resume() {},
  pause() {},
  cancel() { cancellations++; active = null; },
  speak(utterance: Utterance) { active = utterance; },
};
Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: Context });
Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: Utterance });
Object.defineProperty(globalThis, "window", { configurable: true, value: { speechSynthesis: speech } });
Object.defineProperty(globalThis, "fetch", { configurable: true, value: async () => new Response("{}") });
Object.defineProperty(globalThis, "Audio", { configurable: true, value: class { volume = 1; play() { return Promise.resolve(); } } });

mock.timers.enable({ apis: ["setTimeout"] });
try {
  inGesture = true;
  unlockTutorAudio();
  const primed = getSharedAudioContext();
  inGesture = false;
  const lateLectures = Array.from({ length: 5 }, () => createLectureAudioContext());
  assert.equal(new Set(lateLectures).size, 5, "all five concurrent lectures need independent graphs");
  assert.equal(contextsCreated, 6, "the shared context and five lecture contexts exhaust the reserve");
  inGesture = true;
  unlockTutorAudio();
  unlockTutorAudio();
  inGesture = false;
  assert.equal(contextsCreated, 6, "repeated Watch unlocks with five active lectures must not construct five more contexts");
  for (const ctx of lateLectures) {
    assert.notEqual(ctx, primed, "a lecture must not borrow replay's unlock context");
    assert.equal(ctx.state, "running", "all five late-mounted lecture clocks must advance after one gesture");
  }
  for (const ctx of lateLectures.slice(0, 2)) releaseLectureAudioContext(ctx);
  inGesture = true;
  unlockTutorAudio();
  inGesture = false;
  assert.equal(contextsCreated, 8, "three active lectures need only two new gesture-primed contexts");
  const replacements = [createLectureAudioContext(), createLectureAudioContext()];
  assert(replacements.every((ctx) => ctx.state === "running"), "replacements must use the new gesture's reserve");
  for (const ctx of [...lateLectures.slice(2), ...replacements]) releaseLectureAudioContext(ctx);
  haltAllLectureAudio();

  const foreground = new StreamingSpeechClient();
  const background = new StreamingSpeechClient();
  const foregroundSpeech = foreground.speakSegment("Foreground narration.");
  for (let i = 0; i < 8 && !active; i++) await Promise.resolve();
  const spoken = currentUtterance();
  spoken.onstart?.();
  const before = cancellations;
  background.stop(); // This client never used speechSynthesis.
  assert.equal(cancellations, before, "stopping an idle lecture must not cancel another lecture's voice");
  assert.equal(active, spoken);
  background.pause();
  assert.equal(cancellations, before, "pausing an idle lecture must not cancel another lecture's voice");
  spoken.onend?.();
  await foregroundSpeech;
  foreground.stop();
  active = null;

  const interruptedClient = new StreamingSpeechClient();
  let interruptedFinished = false;
  const interruptedSpeech = interruptedClient.speakSegment("Keep this sentence through pause.")
    .then(() => { interruptedFinished = true; });
  for (let i = 0; i < 8 && !active; i++) await Promise.resolve();
  const interruptedUtterance = currentUtterance();
  interruptedUtterance.onstart?.();
  interruptedClient.pause();
  for (let i = 0; i < 16; i++) await Promise.resolve();
  assert.equal(interruptedFinished, false, "pausing browser fallback must not complete the sentence");
  interruptedClient.resume();
  mock.timers.tick(80);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const resumedUtterance = currentUtterance();
  resumedUtterance.onstart?.();
  interruptedClient.setMuted(true);
  assert.equal(resumedUtterance.volume, 0, "demoting a streaming lecture must mute its browser fallback now");
  interruptedClient.setMuted(false);
  assert.equal(resumedUtterance.volume, 1, "promoting a streaming lecture must restore its browser fallback now");
  resumedUtterance.onend?.();
  await interruptedSpeech;
  interruptedClient.stop();

  const first = new SpeechSynthesisTTSClient();
  const queued = new SpeechSynthesisTTSClient();
  const firstSpeaking = first.speakSegment("Already audible.");
  const firstUtterance = currentUtterance();
  firstUtterance.onstart?.();
  const queuedSpeaking = queued.speakSegment("Waiting for its turn.");
  assert.equal(active, firstUtterance, "a second lecture must not preempt the active utterance");
  queued.stop();
  assert.equal(active, firstUtterance, "canceling queued speech must not cut off the owner");
  firstUtterance.onend?.();
  await Promise.all([firstSpeaking, queuedSpeaking]);
  assert.equal(active, firstUtterance, "stopped queued speech must never start later");

  const outgoing = new SpeechSynthesisTTSClient();
  const incoming = new SpeechSynthesisTTSClient();
  const outgoingSpeech = outgoing.speakSegment("Old owner.");
  const oldUtterance = currentUtterance();
  oldUtterance.onstart?.();
  const incomingSpeech = incoming.speakSegment("New owner.");
  outgoing.stop();
  await outgoingSpeech;
  const newUtterance = currentUtterance();
  assert.notEqual(newUtterance, oldUtterance, "stopping the owner must release its queued successor");
  newUtterance.onstart?.();
  newUtterance.onend?.();
  await incomingSpeech;

  const voice = new SpeechSynthesisTTSClient();
  const speaking = voice.speakSegment("Switch the watch target mid-utterance.");
  const utterance = currentUtterance();
  utterance.onstart?.();
  const http = new HttpSpeechClient({ proxyUrl: "/api/tts" });
  const beforeHttpPause = cancellations;
  http.pause();
  assert.equal(cancellations, beforeHttpPause, "pausing an idle HTTP lecture must not cancel another browser fallback");
  assert.equal(active, utterance);
  voice.setMuted(true);
  assert.equal(utterance.volume, 0, "demoting the lecture must mute the current utterance immediately");
  voice.setMuted(false);
  assert.equal(utterance.volume, 1, "promoting the lecture must restore the current utterance immediately");
  utterance.onend?.();
  await speaking;
  active = null;
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async () => new Response("unavailable", { status: 503 }) });
  const httpFallback = new HttpSpeechClient({ proxyUrl: "/api/tts" });
  const httpSpeech = httpFallback.speakSegment("Browser fallback for HTTP.");
  for (let i = 0; i < 16 && !active; i++) await Promise.resolve();
  const httpUtterance = currentUtterance();
  httpUtterance.onstart?.();
  httpFallback.setMuted(true);
  assert.equal(httpUtterance.volume, 0, "demoting HTTP fallback must mute its active utterance");
  httpFallback.setMuted(false);
  assert.equal(httpUtterance.volume, 1);
  httpFallback.pause();
  let httpFinished = false;
  void httpSpeech.then(() => { httpFinished = true; });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(httpFinished, false, "HTTP fallback pause must retain its sentence");
  httpFallback.resume();
  for (let i = 0; i < 16 && !active; i++) await Promise.resolve();
  const resumedHttp = currentUtterance();
  resumedHttp.onstart?.();
  resumedHttp.onend?.();
  await httpSpeech;
  console.log("verified late-context gesture lease, two-client fallback ownership, pause/resume, and mid-utterance mute switching");
} finally {
  mock.timers.reset();
  haltAllLectureAudio();
}
