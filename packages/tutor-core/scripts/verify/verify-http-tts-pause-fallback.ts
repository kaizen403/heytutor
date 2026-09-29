import assert from "node:assert/strict";
import { HttpSpeechClient } from "../../src/tts/speechClient";

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
let failHttp!: (error: Error) => void;
let starts = 0;
let ends = 0;
const spoken: Utterance[] = [];
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  speechSynthesis: {
    getVoices: () => [], resume() {},
    cancel() {},
    speak(utterance: Utterance) { spoken.push(utterance); },
  },
} });
Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: Utterance });
Object.defineProperty(globalThis, "fetch", { configurable: true, value: () => new Promise<Response>((_, reject) => { failHttp = reject; }) });

const client = new HttpSpeechClient({ proxyUrl: "/api/tts" });
const sentence = client.speakSegment("Do not drop this sentence.", {
  onStart: () => { starts++; },
  onEnd: () => { ends++; },
});
client.pause();
failHttp(new Error("offline"));
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(spoken.length, 0, "HTTP failure during pause must not start fallback speech");
assert.equal(ends, 0, "pause must not finish the sentence");
client.resume();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(spoken.length, 1, "resume must speak the interrupted sentence");
const first = spoken[0];
first.onstart?.();
client.pause();
await Promise.resolve();
assert.equal(ends, 0, "pausing an audible fallback must not finish the sentence");
client.resume();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(spoken.length, 2, "resume must restart the cancelled fallback sentence");
spoken[1].onstart?.();
spoken[1].onend?.();
await Promise.race([sentence, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("HTTP fallback hung")), 1000))]);
assert.equal(starts, 1, "restarted sentence must not announce a second start to the draw clock");
assert.equal(ends, 1);
client.stop();
console.log("HTTP failure and browser fallback pause retain sentence until audible end");
