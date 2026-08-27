import {
  cancelFrame,
  createScheduledWriteClock,
  scheduleFrame,
  simulateScheduledWriteWait,
} from "../src/index";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const formulaOffsets = [80, 160, 240, 320, 400];

const missingClock = simulateScheduledWriteWait({
  offsetsMs: formulaOffsets,
  getRawPositionMs: () => null,
});
assert(missingClock.completed, "WRITE must finish when getAudioPositionMs is null");
assert(
  missingClock.charsWritten === formulaOffsets.length,
  "every formula character must be released",
);
assert(
  missingClock.elapsedMs <= formulaOffsets[formulaOffsets.length - 1]! + 64,
  `null audio clock parked the pen: elapsed ${missingClock.elapsedMs}ms`,
);

const zeroClock = simulateScheduledWriteWait({
  offsetsMs: formulaOffsets,
  getRawPositionMs: () => 0,
});
assert(zeroClock.completed, "WRITE must finish when the audio clock stays at 0");
assert(
  zeroClock.elapsedMs <= formulaOffsets[formulaOffsets.length - 1]! + 64,
  `a zero audio clock parked the pen: elapsed ${zeroClock.elapsedMs}ms`,
);

const stuckClock = simulateScheduledWriteWait({
  offsetsMs: formulaOffsets,
  getRawPositionMs: () => 16,
  maxElapsedMs: 3_000,
});
assert(stuckClock.completed, "WRITE must finish when the audio clock is stuck");
assert(
  stuckClock.elapsedMs < 2_000,
  `a stuck 16ms clock hung the pen: elapsed ${stuckClock.elapsedMs}ms`,
);

let fakeNow = 0;
const wrapped = createScheduledWriteClock({
  getRawPositionMs: () => 0,
  nowMs: () => fakeNow,
});
assert(wrapped() === 0, "write clock starts at t=0");
fakeNow = 240;
assert(wrapped() === 240, "a missing TTS position must follow wall time so ink tracks speech");

console.log("verify-write-audio-clock: null/zero/stuck WRITE clocks finish during speech");

const frameId = scheduleFrame(() => undefined);
cancelFrame(frameId);
