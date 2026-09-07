import {
  createVirtualWhiteboardClock,
  shouldHideCursorForCapture,
} from "../src/whiteboardClock";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const clock = createVirtualWhiteboardClock(0);
assert(clock.now() === 0, "virtual clock starts at the given origin");
clock.advance(1000 / 24);
assert(Math.abs(clock.now() - 1000 / 24) < 1e-6, "advance moves the export clock");

let fired = 0;
let firedAt = -1;
clock.source.requestFrame((time) => {
  fired += 1;
  firedAt = time;
});
assert(clock.pendingCount() === 1, "requestFrame queues instead of using rAF");
clock.pump();
assert(fired === 1 && firedAt === clock.now(), "pump delivers the virtual timestamp");
assert(clock.pendingCount() === 0, "pump drains the current frame queue");

let late = 0;
clock.source.requestFrame(() => {
  clock.source.requestFrame(() => {
    late += 1;
  });
});
clock.pump();
assert(late === 0 && clock.pendingCount() === 1, "a frame scheduled during pump waits for the next pump");
clock.pump();
assert(late === 1, "the next pump runs the rescheduled frame");

const cancelled = createVirtualWhiteboardClock();
const id = cancelled.source.requestFrame(() => {
  throw new Error("cancelled frame must not run");
});
cancelled.source.cancelFrame(id);
cancelled.pump();

let advanced = false;
const wait = clock.waitForAdvance().then(() => {
  advanced = true;
});
clock.pump();
await wait;
assert(advanced, "waitForAdvance resolves after pump");

assert(shouldHideCursorForCapture("snapshot") === true, "notes PDF snapshots always hide the pen");
assert(shouldHideCursorForCapture("snapshot", false) === true, "snapshot hide-cursor cannot be opted out");
assert(shouldHideCursorForCapture("frame") === false, "lecture frames keep the pen by default");
assert(shouldHideCursorForCapture("frame", false) === false, "lecture frames keep the pen when asked");
assert(shouldHideCursorForCapture("frame", true) === true, "lecture frames can hide the pen");

console.log("verify-whiteboard-export: virtual clock pumps frames; snapshots still hide the pen");
