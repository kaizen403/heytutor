/**
 * Historical unhandled rejections HEYTUTOR-16/1Q/1D. Exercise the real gesture,
 * pause and stop call sites, including browsers that update state after close.
 * pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-audio-context-closure.ts
 */
import assert from "node:assert/strict";
import { haltAllLectureAudio } from "../../src/tts/audioContext";
import { StreamingSpeechClient } from "../../src/tts/streamingSpeechClient";

const messages = {
  "16": "Cannot resume a closed AudioContext.",
  "1Q": "AudioContext closed before a pending resume() could complete.",
  "1D": "Cannot resume a context that has been closed",
};
const issues = Object.entries(messages).filter(([issue]) => !process.argv[2] || process.argv[2] === issue);
assert(issues.length, "expected 16, 1Q or 1D");
let message = messages["16"];
let mode: "already-closed" | "pending-close" | "open-device-failure" = "pending-close";
let delayedState = false;
let resumed = 0;
let suspended = 0;
let closing: Promise<void>[] = [];

class ClosingContext {
  state: AudioContextState = "suspended";
  sampleRate = 44_100;
  private rejects: Array<(error: unknown) => void> = [];
  resume(): Promise<void> {
    resumed++;
    if (mode === "open-device-failure") return Promise.reject(new Error("synthetic device failure"));
    if (mode === "already-closed") {
      this.state = "closed";
      return Promise.reject(new DOMException(message, "InvalidStateError"));
    }
    return new Promise((_, reject) => this.rejects.push(reject));
  }
  suspend(): Promise<void> {
    suspended++;
    return new Promise((_, reject) => this.rejects.push(reject));
  }
  close(): Promise<void> {
    for (const reject of this.rejects.splice(0)) reject(new DOMException(message, "InvalidStateError"));
    const done = delayedState
      ? new Promise<void>(resolve => setImmediate(() => { this.state = "closed"; resolve(); }))
      : Promise.resolve();
    if (!delayedState) this.state = "closed";
    closing.push(done);
    return done;
  }
}

Object.defineProperties(globalThis, {
  window: { configurable: true, value: globalThis },
  AudioContext: { configurable: true, value: ClosingContext },
  speechSynthesis: { configurable: true, value: { cancel() {}, resume() {}, pause() {}, getVoices: () => [] } },
});
const unhandled: unknown[] = [];
const noteUnhandled = (error: unknown) => unhandled.push(error);
process.on("unhandledRejection", noteUnhandled);
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
try {
  for (const [issue, text] of issues) {
    message = text;
    const scenarios = issue === "1Q" ? ["pending-close", "already-closed"] as const : ["already-closed", "pending-close"] as const;
    for (const scenario of scenarios) {
      mode = scenario;
      for (const delayed of [false, true]) {
        delayedState = delayed;
        resumed = 0;
        suspended = 0;
        closing = [];
        unhandled.length = 0;
        const client = new StreamingSpeechClient();
        client.unlockAudio();
        client.pause();
        client.stop();
        haltAllLectureAudio();
        await Promise.all(closing);
        await flush();
        assert(resumed > 0, "the gesture exercised resume()");
        assert(suspended > 0, "pause exercised suspend()");
        assert.deepEqual(unhandled, [], `HEYTUTOR-${issue}/${scenario}/delayed=${delayed}: closure must not be unhandled`);
      }
    }
    console.log(`HEYTUTOR-${issue}: closed and pending resume/suspend races handled`);
  }
  // The guard must not hide failures on an open graph.
  mode = "open-device-failure";
  unhandled.length = 0;
  const broken = new StreamingSpeechClient();
  broken.unlockAudio();
  await flush();
  assert(unhandled.length > 0, "an unexpected device failure still surfaces");
  assert(unhandled.every(error => error instanceof Error && error.message === "synthetic device failure"));
  broken.stop();
  haltAllLectureAudio();
} finally {
  process.off("unhandledRejection", noteUnhandled);
}
