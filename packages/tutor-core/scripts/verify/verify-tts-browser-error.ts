import assert from "node:assert/strict";
import { StreamingSpeechClient } from "../../src/tts/streamingSpeechClient";
import { SpeechSynthesisTTSClient } from "../../src/tts/speechClient";

class SuspendedContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  async resume() {} // Simulate autoplay blocking WebAudio.
  async suspend() {}
  async close() { this.state = "closed"; }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
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
let utterance: Utterance | null = null;
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  speechSynthesis: {
    getVoices: () => [], resume() {}, cancel() {},
    speak(next: Utterance) { utterance = next; },
  },
} });
Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: SuspendedContext });
Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: Utterance });
const client = new StreamingSpeechClient();
let starts = 0;
let ends = 0;
let errors = 0;
const speech = client.speakSegment("Failure after audible start.", {
  onStart: () => { starts++; },
  onEnd: () => { ends++; },
  onError: () => { errors++; },
});
for (let i = 0; i < 30 && !utterance; i++) await Promise.resolve();
assert(utterance, "browser fallback must begin");
utterance.onstart?.();
utterance.onerror?.({ error: "synthesis-failed" });
await assert.rejects(speech, /SpeechSynthesis error: synthesis-failed/, "partial browser speech must reject, not resolve as a full sentence");
assert.equal(starts, 1);
assert.equal(ends, 0);
assert.equal(errors, 1, "failure must notify the runner once");
client.stop();
const direct = new SpeechSynthesisTTSClient();
let directErrors = 0;
const directSpeech = direct.speakSegment("Browser voice fails after speaking.", {
  onError: () => { directErrors++; },
});
const directUtterance = utterance as Utterance | null;
assert(directUtterance, "direct browser voice must start");
directUtterance.onstart?.();
directUtterance.onerror?.({ error: "synthesis-failed" });
await assert.rejects(directSpeech, /SpeechSynthesis error: synthesis-failed/,
  "the browser client itself must reject on a genuine synthesis error");
assert.equal(directErrors, 1);
direct.stop();
console.log("browser synthesis failure rejects incomplete speech");
