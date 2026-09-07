import assert from "node:assert/strict";
import {
  createLectureAudioContext,
  getSharedAudioContext,
  haltAllLectureAudio,
} from "../../src/tts/audioContext";
import { ElevenLabsWebSocketTTSClient } from "../../src/tts/elevenLabsWebSocketClient";

/**
 * Closing the tab (or clicking stop after the UI already looks idle) used to
 * leave WebAudio + speechSynthesis talking. Firefox is the worst: pagehide
 * freezes the document in bfcache and React unmount never runs.
 */

let contextCount = 0;
let speechCancelCount = 0;
let resumeGate: { resolve: () => void } | null = null;
let notifyResumeStarted: (() => void) | null = null;
const resumeStarted = new Promise<void>((resolve) => {
  notifyResumeStarted = resolve;
});

class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  readonly destination = {};

  constructor() {
    contextCount += 1;
  }

  async resume(): Promise<void> {
    notifyResumeStarted?.();
    await new Promise<void>((resolve) => {
      resumeGate = { resolve };
    });
    this.state = "running";
  }

  async suspend(): Promise<void> {
    this.state = "suspended";
  }

  async close(): Promise<void> {
    this.state = "closed";
  }

  async decodeAudioData(_bytes: ArrayBuffer): Promise<AudioBuffer> {
    return {
      duration: 0.1,
      length: 4410,
      sampleRate: 44_100,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(4410),
    } as AudioBuffer;
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      duration: length / sampleRate,
      length,
      sampleRate,
      numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel] ?? data[0],
    } as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    return {
      buffer: null,
      playbackRate: { value: 1 },
      connect() {},
      start() {},
      stop() {},
      onended: null,
    } as AudioBufferSourceNode;
  }

  createGain(): GainNode {
    return {
      gain: { value: 1 },
      connect() {},
    } as GainNode;
  }
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readyState = FakeWebSocket.CONNECTING;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {}
}

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: globalThis,
});
Object.defineProperty(globalThis, "AudioContext", {
  configurable: true,
  value: FakeAudioContext,
});
Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  value: FakeWebSocket,
});
Object.defineProperty(globalThis, "speechSynthesis", {
  configurable: true,
  value: {
    cancel: () => {
      speechCancelCount += 1;
    },
    pause() {},
    resume() {},
    speak() {},
    getVoices: () => [],
  },
});
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async () => new Response("{}", { status: 200 }),
});

const lecture = createLectureAudioContext();
const shared = getSharedAudioContext();
assert.notEqual(lecture.state, "closed", "fixture lecture context should start open");
assert.notEqual(shared.state, "closed", "fixture shared context should start open");

haltAllLectureAudio();

assert.equal(lecture.state, "closed", "haltAllLectureAudio must close lecture AudioContexts");
assert.equal(shared.state, "closed", "haltAllLectureAudio must close the unlock AudioContext");
assert.ok(speechCancelCount > 0, "haltAllLectureAudio must cancel speechSynthesis");

const contextsBeforeSpeak = contextCount;
const client = new ElevenLabsWebSocketTTSClient();
const speaking = client.speakSegment("Stop this while AudioContext.resume is still pending.");
await resumeStarted;
const contextsDuringResume = contextCount;
client.stop();
resumeGate?.resolve();
await speaking.catch(() => undefined);

assert.equal(
  contextCount,
  contextsDuringResume,
  `stop() during resume recreated an AudioContext (${contextsBeforeSpeak} -> ${contextCount})`,
);

console.log("verify-lecture-audio-halt: closing the tab/stop must silence WebAudio and speechSynthesis");
