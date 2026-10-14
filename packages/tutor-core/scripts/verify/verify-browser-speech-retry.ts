import assert from "node:assert/strict";
import { mock } from "node:test";
import { SpeechSynthesisTTSClient } from "../../src/tts/speechClient";

class Utterance {
  onstart: (() => void) | null = null;
  onboundary: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(readonly text: string) {}
}
let pending: Utterance | null = null;
let dropNext = false;
let cancelling = false;
let cancellations = 0;
let attachedCancellationHandlers = 0;
let delayedVoices = false;
let voicesReady = false;
const voiceListeners = new Set<() => void>();
const attempts: Utterance[] = [];
const speech = {
  getVoices: () => voicesReady ? [{ name: "Offline English", lang: "en-US" }] : [], resume() {},
  addEventListener: (name: string, listener: () => void) => { if (name === "voiceschanged") voiceListeners.add(listener); },
  removeEventListener: (name: string, listener: () => void) => { if (name === "voiceschanged") voiceListeners.delete(listener); },
  cancel() {
    cancellations++;
    if (pending?.onerror) attachedCancellationHandlers++;
    const old = pending;
    pending = null;
    cancelling = true;
    setTimeout(() => { cancelling = false; }, 0);
    // Real engines can synchronously emit cancellation errors.
    old?.onerror?.({ error: "canceled" });
  },
  speak(utterance: Utterance) {
    attempts.push(utterance);
    if (pending || cancelling) return; // A pending dropped sentence blocks the queue.
    pending = utterance;
    if (dropNext) { dropNext = false; return; }
    if (delayedVoices && !voicesReady) return;
    utterance.onstart?.();
  },
};
Object.defineProperty(globalThis, "window", { configurable: true, value: { speechSynthesis: speech } });
Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: Utterance });
Object.defineProperty(globalThis, "fetch", { configurable: true, value: async () => new Response("{}") });
mock.timers.enable({ apis: ["setTimeout"] });
async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
function end() { const old = pending; assert(old); pending = null; old.onend?.(); }
const owner = new SpeechSynthesisTTSClient();
const sibling = new SpeechSynthesisTTSClient();
try {
  const pausedSpeech = owner.speakSegment("Pause before restarting the sentence.");
  owner.pause();
  await pausedSpeech;
  mock.timers.tick(1);
  assert.equal(attachedCancellationHandlers, 0, "pause must detach before cancelling an owned utterance");
  attempts.length = 0;
  cancellations = 0;

  // Reproduce the post-pause engine: its first sentence is pending, not audible.
  dropNext = true;
  let starts = 0;
  let ends = 0;
  const restarted = owner.speakSegment("The first sentence after pause.", {
    onStart: () => starts++, onEnd: () => ends++,
  });
  const dropped = pending;
  assert(dropped);
  const waiting = sibling.speakSegment("The other lecture waits.");
  assert.equal(attempts.length, 1, "a waiting client must not enter the engine queue");
  mock.timers.tick(400);
  assert.equal(cancellations, 1,
    "400ms retry must cancel the still-pending owned utterance before queueing a replacement");
  assert.equal(attachedCancellationHandlers, 0, "cancel must see detached stale handlers");
  mock.timers.tick(1);
  await flush();
  assert.equal(attempts.length, 2);
  assert.equal(starts, 1, "replacement must start after cancellation has left the current task");
  assert.equal(ends, 0);
  assert.equal(dropped.onstart, null);
  assert.equal(dropped.onerror, null);
  end();
  await restarted;
  assert.equal(ends, 1);
  assert.equal(attempts.length, 3, "only completion releases the queued sibling");
  end();
  await waiting;

  // Pause/stop between cancel and its later-task retry must never leak speech.
  dropNext = true;
  const interrupted = owner.speakSegment("Rapid pause during retry.");
  mock.timers.tick(400);
  owner.pause();
  owner.resume();
  owner.stop();
  const before = attempts.length;
  mock.timers.tick(3_000);
  await interrupted;
  assert.equal(attempts.length, before, "stop must clear a queued retry task");

  // An owner stopped during retry releases its sibling, not a stale replacement.
  dropNext = true;
  const stopping = owner.speakSegment("Stop this pending sentence.");
  const queued = sibling.speakSegment("Keep the successor alive.");
  mock.timers.tick(400);
  owner.stop();
  await stopping;
  mock.timers.tick(400);
  mock.timers.tick(1);
  assert.equal(pending?.text, "Keep the successor alive.");
  end();
  await queued;
  assert.equal(attachedCancellationHandlers, 0);

  // Voice lists can load after both initial utterance attempts. A readiness
  // event must rescue the owned sentence without extending its deadline.
  delayedVoices = true; voicesReady = false; attempts.length = 0;
  let readyStarts = 0;
  const voiceLoading = owner.speakSegment("The available voice arrives after startup.", { onStart: () => readyStarts++ });
  mock.timers.tick(400); mock.timers.tick(1); await flush();
  assert.equal(readyStarts, 0);
  voicesReady = true;
  for (const listener of [...voiceListeners]) listener();
  mock.timers.tick(1); await flush();
  assert.equal(readyStarts, 1, "late voice readiness must restart a stalled owned browser sentence");
  assert.equal(attempts.length, 3, "voice availability grants only one bounded additional startup attempt");
  for (const listener of [...voiceListeners]) listener();
  mock.timers.tick(1);
  assert.equal(attempts.length, 3, "readiness events cannot duplicate audible speech");
  assert.equal(voiceListeners.size, 0, "audibility detaches the readiness listener");
  end(); await voiceLoading;

  voicesReady = false;
  const stoppedLoading = owner.speakSegment("Stop while voices are unavailable.");
  owner.stop(); await stoppedLoading;
  const stoppedAttempts = attempts.length;
  voicesReady = true;
  for (const listener of [...voiceListeners]) listener();
  mock.timers.tick(3_000);
  assert.equal(attempts.length, stoppedAttempts, "readiness after Stop cannot leak an utterance");
  assert.equal(voiceListeners.size, 0);

  voicesReady = false; attempts.length = 0;
  let terminalErrors = 0;
  const stillBroken = owner.speakSegment("An unavailable engine must stay bounded.", { onError: () => terminalErrors++ });
  void stillBroken.catch(() => undefined);
  mock.timers.tick(400); mock.timers.tick(1);
  voicesReady = true; dropNext = true;
  for (const listener of [...voiceListeners]) listener();
  mock.timers.tick(1);
  for (const listener of [...voiceListeners]) listener();
  mock.timers.tick(2_100);
  await assert.rejects(stillBroken, /Browser speech did not start/);
  assert.equal(attempts.length, 3, "repeated readiness events cannot create a retry loop");
  assert.equal(terminalErrors, 1, "readiness recovery retains the original bounded terminal failure");
  assert.equal(voiceListeners.size, 0, "deadline detaches the readiness listener");
  console.log("verified pending browser utterance cancellation, later-task retry, and ownership-safe pause/stop");
} finally {
  owner.stop(); sibling.stop();
  mock.timers.reset();
}
