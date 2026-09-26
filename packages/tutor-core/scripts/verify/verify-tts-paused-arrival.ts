import assert from "node:assert/strict";
import { StreamingSpeechClient } from "../../src/tts/streamingSpeechClient";

class FakeWebSocket {
  static OPEN = 1;
  static flushes = 0;
  static autoPackets = true;
  static latest: FakeWebSocket;
  readyState = 0;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private listeners = new Set<(event: { data: string }) => void>();
  constructor(_url: string) {
    FakeWebSocket.latest = this;
    setTimeout(() => { this.readyState = 1; this.emit({ type: "ready" }); }, 0);
  }
  addEventListener(_event: string, listener: (event: { data: string }) => void) { this.listeners.add(listener); }
  removeEventListener(_event: string, listener: (event: { data: string }) => void) { this.listeners.delete(listener); }
  emit(payload: object) {
    for (const listener of this.listeners) listener({ data: JSON.stringify(payload) });
  }
  send(raw: string) {
    if (!JSON.parse(raw).flush) return;
    FakeWebSocket.flushes++;
    if (!FakeWebSocket.autoPackets) return;
    setTimeout(() => {
      this.emit({ context_id: "segment_1", audio_base64: Buffer.from("audio").toString("base64") });
      this.emit({ context_id: "segment_1", isFinal: true });
    }, 40);
  }
  close() { this.readyState = 0; this.onclose?.(); }
}
class FakeAudioContext {
  static decodeCalls = 0;
  static holdDecodes = false;
  static releaseDecodes: Array<() => void> = [];
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {};
  async resume() { this.state = "running"; }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; }
  async decodeAudioData() {
    FakeAudioContext.decodeCalls++;
    if (FakeAudioContext.holdDecodes) {
      await new Promise<void>((resolve) => { FakeAudioContext.releaseDecodes.push(resolve); });
    }
    return { duration: 1 } as AudioBuffer;
  }
  createGain() { return { gain: { value: 1 }, connect() {} } as unknown as GainNode; }
}
class FakeAudio {
  static latest: FakeAudio;
  static playCalls = 0;
  playbackRate = 1;
  preservesPitch = false;
  muted = false;
  volume = 1;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) { FakeAudio.latest = this; }
  play() { FakeAudio.playCalls++; return Promise.resolve(); }
  pause() {}
  removeAttribute(_attribute: string) {}
  load() {}
  end() { this.onended?.(); }
}

Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "location", {
  configurable: true, value: { protocol: "http:", host: "localhost:3000", origin: "http://localhost:3000" },
});
Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeWebSocket });
Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeAudioContext });
Object.defineProperty(globalThis, "Audio", { configurable: true, value: FakeAudio });
Object.defineProperty(globalThis, "fetch", {
  configurable: true, value: async () => Response.json({ ticket: "test" }),
});

const client = new StreamingSpeechClient();
await client.prewarm();
let started = 0;
let finished = false;
const speech = client.speakSegment("Paused final packet.", {
  onStart: () => { started++; },
}).then(() => { finished = true; });
const flushDeadline = Date.now() + 1000;
while (FakeWebSocket.flushes === 0 && Date.now() < flushDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 2));
}
assert.equal(FakeWebSocket.flushes, 1, "pause must happen after sending, before the audio packet");
client.pause();
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(FakeAudio.playCalls, 0, "late audio must not play while paused");
assert.equal(started, 0, "audio must not announce speech during pause");
assert.equal(finished, false, "pause must retain the sentence for resume");
client.resume();
const deadline = Date.now() + 1000;
while (!FakeAudio.latest && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.equal(FakeAudio.playCalls, 1, "resuming must play buffered sentence exactly once");
FakeAudio.latest.end();
await Promise.race([speech, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("speech did not complete")), 1000))]);
assert.equal(started, 1);
assert.equal(finished, true);
client.stop();

// The final-packet handler and resume() both try to start the same decoded job.
// Hold decoding so the second starter enters before the first can mark started.
FakeWebSocket.autoPackets = false;
FakeAudioContext.holdDecodes = true;
FakeAudioContext.decodeCalls = 0;
FakeAudio.playCalls = 0;
const racing = new StreamingSpeechClient();
await racing.prewarm();
let racingStarts = 0;
const racingSpeech = racing.speakSegment("One buffered sentence.", {
  onStart: () => { racingStarts++; },
});
const flushRaceDeadline = Date.now() + 1000;
while (FakeWebSocket.flushes < 2 && Date.now() < flushRaceDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 2));
}
assert.equal(FakeWebSocket.flushes, 2);
FakeWebSocket.latest.emit({ context_id: "segment_1", audio_base64: Buffer.from("audio").toString("base64"), isFinal: true });
const decodeDeadline = Date.now() + 1000;
while (FakeAudioContext.decodeCalls === 0 && Date.now() < decodeDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 2));
}
assert.equal(FakeAudioContext.decodeCalls, 1, "final packet must enter decoding");
racing.pause();
racing.resume();
await Promise.resolve();
await Promise.resolve();
assert.equal(FakeAudioContext.decodeCalls, 1,
  "resume must join the in-flight final decode instead of decoding again");
FakeAudioContext.holdDecodes = false;
for (const release of FakeAudioContext.releaseDecodes.splice(0)) release();
const playDeadline = Date.now() + 1000;
while (FakeAudio.playCalls === 0 && Date.now() < playDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 2));
}
assert.equal(FakeAudio.playCalls, 1, "concurrent final/resume must create only one media playback");
assert.equal(racingStarts, 1);
FakeAudio.latest.end();
await Promise.race([racingSpeech, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("racing speech did not finish")), 1000))]);
racing.stop();
console.log("late TTS audio waits for resume; concurrent final/resume starts once");
