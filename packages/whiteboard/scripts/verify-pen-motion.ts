import {
  audioWaitAlreadyDue,
  handwritingProgress,
  pointAlongSamples,
  samplePolyline,
  splitDrawnLength,
} from "../src/penMotion";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(handwritingProgress(0.5, 40) === 0.5, "a short glyph must move linearly, not ease-in-out");
assert(handwritingProgress(0, 40) === 0, "linear handwriting must start at the nib");
assert(handwritingProgress(1, 40) === 1, "linear handwriting must finish the glyph");
assert(
  handwritingProgress(0.25, 400) < 0.2,
  "a long scene stroke may keep cubic easing",
);

assert(audioWaitAlreadyDue(100, 90), "a character already due must not park the pen");
assert(audioWaitAlreadyDue(80, 90), "a character within slack must start without a wait hitch");
assert(!audioWaitAlreadyDue(40, 90), "a character still in the future must wait for the voice");

const line = samplePolyline(100, (distance) => ({ x: distance, y: 10 }));
assert(line.length >= 13, "path sampling must cache more than a start and end point");
const mid = pointAlongSamples(line, 100, 50);
assert(Math.abs(mid.x - 50) < 1, `sampled midpoint should stay on the path, got x=${mid.x}`);
const later = pointAlongSamples(line, 100, 80);
assert(later.x > mid.x, "sampled lookup must be monotonic along the stroke");

assert(splitDrawnLength([10, 20, 10], 0).index === 0, "empty ink is the first stroke");
assert(splitDrawnLength([10, 20, 10], 11).index === 1, "drawn length must walk onto the next stroke");
assert(splitDrawnLength([10, 20, 10], 11).inStroke === 1, "remainder stays inside the active stroke");
assert(splitDrawnLength([10, 20, 10], 400).index === 2, "overshoot stays on the last stroke");

console.log("verify-pen-motion: handwriting stays linear on short strokes; path lookup is monotonic");
