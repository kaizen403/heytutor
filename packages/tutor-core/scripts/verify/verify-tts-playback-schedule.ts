import {
  TTS_PREROLL_SEC,
  canConcatAudioBuffers,
  concatDecodedAudioBuffers,
  decodedDurationSec,
  nextScheduleStartSec,
  scheduleGapSec,
  shouldHoldForPreroll,
} from "../../src/tts/playbackSchedule";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// A short first slice plus a slower decode leaves a hole — the mid-sentence break.
const firstChunkSec = 0.06;
const decodeDelaySec = 0.1;
const oldStart = nextScheduleStartSec({ currentTime: 0, scheduledEnd: 0, lookaheadSec: 0.02 });
const oldScheduledEnd = oldStart + firstChunkSec;
const oldGap = scheduleGapSec({
  currentTime: oldStart + decodeDelaySec,
  scheduledEnd: oldScheduledEnd,
});
assert(oldGap > 0.02, "starting the first short slice immediately must be able to open a gap");

assert(
  shouldHoldForPreroll({ bufferedSec: firstChunkSec, streamComplete: false }),
  "a single short chunk must wait for preroll instead of starting playback",
);
assert(
  !shouldHoldForPreroll({
    bufferedSec: TTS_PREROLL_SEC,
    streamComplete: false,
  }),
  "playback may start once preroll is buffered",
);
assert(
  !shouldHoldForPreroll({ bufferedSec: 0.12, streamComplete: true }),
  "a finished stream must play even if it is shorter than preroll",
);

const prerollChunks = [
  { duration: 0.16 },
  { duration: 0.16 },
  { duration: 0.16 },
];
assert(decodedDurationSec(prerollChunks) >= TTS_PREROLL_SEC - 1e-9, "fixture must cover preroll");
const prerollStart = nextScheduleStartSec({ currentTime: 0.01, scheduledEnd: 0.01 });
const prerollEnd = prerollStart + decodedDurationSec(prerollChunks);
const nextReadyAt = prerollStart + decodeDelaySec;
assert(
  scheduleGapSec({ currentTime: nextReadyAt, scheduledEnd: prerollEnd }) === 0,
  "after preroll, a typical decode delay must not open a playback gap",
);

class FakeAudioContext {
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      duration: length / sampleRate,
      length,
      sampleRate,
      numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel] ?? data[0],
      copyToChannel: () => {},
    } as AudioBuffer;
  }
}

function tone(offset: number): ConcatFixture {
  const samples = new Float32Array(8);
  samples[0] = offset;
  return {
    duration: 8 / 44_100,
    length: 8,
    sampleRate: 44_100,
    numberOfChannels: 1,
    getChannelData: () => samples,
  };
}

interface ConcatFixture {
  duration: number;
  length: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData: (channel: number) => Float32Array;
}

const left = tone(0.25);
const right = tone(0.75);
assert(canConcatAudioBuffers([left, right]), "same-rate buffers must concat");
const merged = concatDecodedAudioBuffers(new FakeAudioContext(), [left, right]);
assert(merged.length === 16, "concat must keep every sample");
assert(merged.getChannelData(0)[0] === 0.25, "first buffer samples must lead");
assert(merged.getChannelData(0)[8] === 0.75, "second buffer samples must follow");

console.log("verified tts preroll holds short chunks and closes the first-slice gap");
