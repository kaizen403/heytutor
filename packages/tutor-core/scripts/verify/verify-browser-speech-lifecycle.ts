import assert from "node:assert/strict";
import { mock } from "node:test";
import { SpeechSynthesisTTSClient } from "../../src/tts/elevenLabsClient";

class Utterance {
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(readonly text: string) {}
}

let active: Utterance | null = null;
let paused = true;
let resumeCalls = 0;
const speech = {
  getVoices: () => [],
  resume() { paused = false; resumeCalls++; },
  pause() { paused = true; },
  cancel() { active = null; }, // Browsers need not emit an event on cancel.
  speak(utterance: Utterance) { active = utterance; },
};
Object.defineProperty(globalThis, "window", { configurable: true, value: { speechSynthesis: speech } });
Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: Utterance });
mock.timers.enable({ apis: ["setTimeout"] });
try {
  const client = new SpeechSynthesisTTSClient();
  let settled = false;
  let errors = 0;
  const stalled = client.speakSegment("Explain the forces on the block.", {
    onError: () => errors++,
  }).then(() => { settled = true; });
  mock.timers.tick(3_000);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert(settled, "browser speech that never starts must settle within 3s, not stall every lecture beat");
  await stalled;
  assert.equal(errors, 1, "silent browser speech must report its failure exactly once");
  assert(!paused && resumeCalls > 0, "a previous pause must not leave browser fallback suspended");

  let starts = 0;
  let ends = 0;
  settled = false;
  const speaking = client.speakSegment("The next sentence.", {
    onStart: () => starts++, onEnd: () => ends++,
  }).then(() => { settled = true; });
  const utterance = active;
  assert(utterance);
  utterance.onstart?.();
  mock.timers.tick(3_000);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert(!settled, "the startup watchdog must not cut off speech that started");
  client.stop();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert(settled, "stop must settle speech even when the browser emits no cancellation event");
  await speaking;
  utterance.onstart?.();
  utterance.onend?.();
  assert.equal(starts, 1, "late callbacks must not restart a stopped segment");
  assert.equal(ends, 0, "stopping speech must not emit a stale completion callback");

  settled = false;
  const pausing = client.speakSegment("Pause this sentence.").then(() => { settled = true; });
  client.pause();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert(settled, "pause must release the cancelled utterance");
  await pausing;
  client.resume();
  assert(!paused, "resume must release the browser speech queue");

  // Firefox drops the utterance spoken in the same turn as cancel(). The next
  // sentence has to be spoken again, or the lecture dies on that beat.
  let attempts = 0;
  const previousSpeak = speech.speak.bind(speech);
  speech.speak = (utterance: Utterance) => {
    attempts += 1;
    if (attempts === 1) return;
    previousSpeak(utterance);
  };
  let recoveredStart = false;
  const recovered = client.speakSegment("The fluoride complex is the high spin one.", {
    onStart: () => { recoveredStart = true; },
  });
  mock.timers.tick(400);
  mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert(attempts >= 2, "a dropped browser utterance must be spoken again");
  const recoveredUtterance = active;
  assert(recoveredUtterance, "the retry must reach the speech engine");
  recoveredUtterance.onstart?.();
  recoveredUtterance.onend?.();
  await recovered;
  assert(recoveredStart, "the retried utterance must count as started");
  speech.speak = previousSpeak;

  console.log("verified browser speech startup, stop, pause, and stale callbacks");
} finally {
  mock.timers.reset();
}
