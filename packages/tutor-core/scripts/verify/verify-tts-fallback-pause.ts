import assert from "node:assert/strict";
import { StreamingSpeechClient } from "../../src/tts/streamingSpeechClient";

class BlockedAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  destination = {};
  async resume() { /* browser gesture did not unlock WebAudio */ }
  async suspend() {}
  async close() {}
}
class FakeUtterance {
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onboundary: (() => void) | null = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: unknown;
  constructor(readonly text: string) {}
}
const utterances: FakeUtterance[] = [];
let cancels = 0;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    speechSynthesis: {
      getVoices: () => [],
      speak: (utterance: FakeUtterance) => { utterances.push(utterance); utterance.onstart?.(); },
      cancel: () => { cancels++; },
      resume: () => {},
    },
  },
});
Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: BlockedAudioContext });
Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });

const client = new StreamingSpeechClient();
let started = 0;
let ended = 0;
let settled = false;
const speech = client.speakSegment("Do not skip after pausing.", {
  onStart: () => { started++; },
  onEnd: () => { ended++; },
}).then(() => { settled = true; });
for (let i = 0; i < 100 && utterances.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(utterances.length, 1, "the internal browser fallback must begin");
assert.equal(started, 1);
client.pause();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(cancels > 0, "pause must mute speech synthesis");
assert.equal(ended, 0);
assert.equal(settled, false, "cancelled fallback is not a completed sentence");
client.resume();
for (let i = 0; i < 100 && utterances.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(utterances.length, 2, "resume must retry the interrupted sentence");
client.pause(); // Interrupt the first retry too, even if resume has not settled yet.
client.resume();
for (let i = 0; i < 100 && utterances.length < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(utterances.length, 3, "rapid pause/resume must retry the same sentence again");
assert.equal(started, 1, "retries must not double-count onStart");
assert.equal(ended, 0);
assert.equal(settled, false);
utterances[2]!.onend?.();
await speech;
assert.equal(ended, 1);
assert.equal(settled, true);
client.stop();

// The browser can start speaking, then fail without ever emitting onend.
// A resolved promise here makes the runner count an incomplete sentence as spoken.
const failingClient = new StreamingSpeechClient();
let failedStarts = 0;
let failedEnds = 0;
const failures: unknown[] = [];
const failedSpeech = failingClient.speakSegment("Do not count partial speech as completed.", {
  onStart: () => { failedStarts++; },
  onEnd: () => { failedEnds++; },
  onError: (error) => { failures.push(error); },
});
for (let i = 0; i < 100 && utterances.length < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(utterances.length, 4, "the failing fallback must reach the browser voice");
utterances[3]!.onerror?.({ error: "synthesis-failed" });
await assert.rejects(failedSpeech, /SpeechSynthesis error: synthesis-failed/,
  "failure after onStart must reject so the runner cannot mark partial speech complete");
assert.equal(failedStarts, 1);
assert.equal(failedEnds, 0);
assert.equal(failures.length, 1, "the final fallback error must reach the caller once");
assert.match(String(failures[0]), /SpeechSynthesis error: synthesis-failed/);
failingClient.stop();

// A browser can throw AbortError itself (without our stop/pause). That is a
// fallback failure, not permission to end a partially spoken sentence.
const abortClient = new StreamingSpeechClient();
let abortStarts = 0;
let abortEnds = 0;
const abortErrors: unknown[] = [];
const browserSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
window.speechSynthesis.speak = (utterance) => {
  browserSpeak(utterance);
  throw new DOMException("browser speech blocked", "AbortError");
};
try {
  await assert.rejects(abortClient.speakSegment("Abort from browser, not the pause button.", {
    onStart: () => { abortStarts++; },
    onEnd: () => { abortEnds++; },
    onError: (error) => { abortErrors.push(error); },
  }), /browser speech blocked/);
  assert.equal(abortStarts, 1);
  assert.equal(abortEnds, 0);
  assert.equal(abortErrors.length, 1);
} finally {
  window.speechSynthesis.speak = browserSpeak;
  abortClient.stop();
}

// The HTTP recovery path must not consume the browser failure and resolve.
class RunningAudioContext extends BlockedAudioContext {
  state: AudioContextState = "running";
}
Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: RunningAudioContext });
let httpCalls = 0;
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (url: unknown) => {
    if (String(url).includes("/api/tts/stream")) {
      httpCalls++;
      return new Response(null, { status: 400 });
    }
    return new Response("{}", { status: 200 });
  },
});
const httpClient = new StreamingSpeechClient();
let httpStarts = 0;
let httpEnds = 0;
const httpErrors: unknown[] = [];
const failedHttpSpeech = httpClient.speakSegment("Server and browser fail this sentence.", {
  onStart: () => { httpStarts++; },
  onEnd: () => { httpEnds++; },
  onError: (error) => { httpErrors.push(error); },
});
for (let i = 0; i < 100 && utterances.length < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(httpCalls, 1, "HTTP must fail before browser recovery");
assert.equal(utterances.length, 6, "HTTP failure must invoke internal browser recovery");
utterances[5]!.onerror?.({ error: "network" });
await assert.rejects(failedHttpSpeech, /SpeechSynthesis error: network/,
  "HTTP recovery must propagate its final browser failure to the runner");
assert.equal(httpStarts, 1);
assert.equal(httpEnds, 0);
assert.equal(httpErrors.length, 1, "HTTP recovery must notify final failure once");
httpClient.stop();

// stop() is cancellation, not failed or completed narration.
Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: BlockedAudioContext });
const stoppedClient = new StreamingSpeechClient();
let stoppedEnds = 0;
let stoppedErrors = 0;
const stoppedSpeech = stoppedClient.speakSegment("Stop this sentence.", {
  onEnd: () => { stoppedEnds++; },
  onError: () => { stoppedErrors++; },
});
for (let i = 0; i < 100 && utterances.length < 7; i++) await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(utterances.length, 7);
stoppedClient.stop();
await stoppedSpeech;
utterances[6]!.onend?.();
utterances[6]!.onerror?.({ error: "canceled" });
assert.equal(utterances.length, 7, "stop must not retry the canceled sentence");
assert.equal(stoppedEnds, 0);
assert.equal(stoppedErrors, 0);
console.log("internal browser fallback retries paused speech, propagates failure, and honors stop");
