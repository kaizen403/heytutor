import assert from "node:assert/strict";
import { StreamingSpeechClient } from "../../src/tts/streamingSpeechClient";

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {};
  async resume() { this.state = "running"; }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; }
  async decodeAudioData() { return { duration: 1 } as AudioBuffer; }
  createGain() { return { gain: { value: 1 }, connect() {} } as unknown as GainNode; }
}

class FakeAudio {
  static latest: FakeAudio;
  static rejectNext = false;
  static delaySecondPlay = false;
  playbackRate = 1;
  preservesPitch = false;
  muted = false;
  volume = 1;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private rejectPlay: ((error: Error) => void) | null = null;
  private playCount = 0;
  constructor(_url: string) { FakeAudio.latest = this; }
  play(): Promise<void> {
    this.playCount++;
    if (FakeAudio.rejectNext) {
      FakeAudio.rejectNext = false;
      return Promise.reject(new DOMException("autoplay blocked", "NotAllowedError"));
    }
    // The first play is still loading when the student presses Pause.
    if (this.playCount === 1 || (this.playCount === 2 && FakeAudio.delaySecondPlay)) {
      return new Promise((_, reject) => { this.rejectPlay = reject; });
    }
    return Promise.resolve();
  }
  pause() {
    this.rejectPlay?.(new DOMException("play() interrupted by pause()", "AbortError"));
    this.rejectPlay = null;
  }
  removeAttribute(_attribute: string) {}
  load() {}
  end() { this.onended?.(); }
}

Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeAudioContext });
Object.defineProperty(globalThis, "Audio", { configurable: true, value: FakeAudio });

const client = new StreamingSpeechClient();
let finished = false;
let started = 0;
const speech = client.playAudio(new Uint8Array([1, 2, 3]), {
  onStart: () => { started++; },
}).then(() => { finished = true; });
const deadline = Date.now() + 1000;
while (!FakeAudio.latest && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.ok(FakeAudio.latest, "live audio never began playback");
assert.equal(started, 0, "onStart must not claim the audio is audible while play() is pending");
client.pause();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(finished, false, "pausing during media load must not finish or discard the sentence");
client.resume();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(started, 1, "resuming the clip must announce audible playback once");
assert.equal(finished, false, "resuming must keep the sentence active until its audio ends");
FakeAudio.latest.end();
await speech;
assert.equal(finished, true);
client.stop();
const previousAudio = FakeAudio.latest;
FakeAudio.delaySecondPlay = true;
const repeated = new StreamingSpeechClient();
let repeatedFinished = false;
const repeatedSpeech = repeated.playAudio(new Uint8Array([7, 8, 9]))
  .then(() => { repeatedFinished = true; });
const repeatedDeadline = Date.now() + 1000;
while (FakeAudio.latest === previousAudio && Date.now() < repeatedDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
repeated.pause();
await new Promise((resolve) => setTimeout(resolve, 5));
repeated.resume(); // This play() is also pending when the student pauses again.
repeated.pause();
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(repeatedFinished, false, "repeated pause must not turn a pending resume into a failed sentence");
repeated.resume();
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(repeatedFinished, false);
FakeAudio.latest.end();
await repeatedSpeech;
FakeAudio.delaySecondPlay = false;
repeated.stop();
FakeAudio.rejectNext = true;
const blocked = new StreamingSpeechClient();
let blockedStarted = false;
await assert.rejects(
  blocked.playAudio(new Uint8Array([4, 5, 6]), {
    onStart: () => { blockedStarted = true; },
  }),
  /autoplay blocked/,
  "a real playback failure must not complete silently as audible speech",
);
assert.equal(blockedStarted, false);
blocked.stop();
console.log("tts pause/resume keeps pending audio alive");
