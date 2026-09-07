import {
  advanceSpeedAwareProgress,
  pacedGlyphPosition,
  planGlyphPacing,
  audioWaitAlreadyDue,
  handwritingProgress,
  handwritingVariation,
  INSTANT_LABEL_MS_PER_CHAR,
  pacedStrokeDistance,
  pointAlongSamples,
  samplePolyline,
  splitDrawnLength,
  tweenStartDeltaMs,
  writeUsesStrokePenMotion,
} from "../src/penMotion";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function velocityAt(durationMs: number, t: number, dt = 0.02, variation = 0): number {
  return (
    (handwritingProgress(t + dt, durationMs, variation) -
      handwritingProgress(t, durationMs, variation)) /
    dt
  );
}

const firstHalf = advanceSpeedAwareProgress({
  elapsedMediaMs: 0,
  durationMs: 2000,
  wallDeltaMs: 1000,
  speed: 1,
});
assert(Math.abs(firstHalf.progress - 0.5) < 1e-9, "1× must cover half a 2s stroke in 1s");
const spedUp = advanceSpeedAwareProgress({
  elapsedMediaMs: firstHalf.elapsedMediaMs,
  durationMs: 2000,
  wallDeltaMs: 250,
  speed: 2,
});
assert(
  Math.abs(spedUp.progress - 0.75) < 1e-9,
  "mid-stroke 2× must add only the new-rate tail, not jump to the end",
);
const slowed = advanceSpeedAwareProgress({
  elapsedMediaMs: firstHalf.elapsedMediaMs,
  durationMs: 2000,
  wallDeltaMs: 200,
  speed: 0.5,
});
assert(
  Math.abs(slowed.progress - 0.55) < 1e-9,
  "mid-stroke 0.5× must not rewind the pen",
);

assert(handwritingProgress(0, 40) === 0, "handwriting must start at the nib");
assert(handwritingProgress(1, 40) === 1, "handwriting must finish the glyph");
assert(
  handwritingProgress(0.25, 40) !== 0.25,
  "even a short glyph must not travel at one constant speed",
);

const shortStart = velocityAt(40, 0.02);
const shortMid = velocityAt(40, 0.5);
const shortEnd = velocityAt(40, 0.96);
assert(shortStart > 0.45, `a short stroke must not stall at the start (${shortStart.toFixed(2)})`);
assert(shortEnd > 0.45, `a short stroke must not stall at the finish (${shortEnd.toFixed(2)})`);
assert(shortMid > shortStart, "a short stroke must run faster through the middle than the start");
assert(shortMid > shortEnd, "a short stroke must run faster through the middle than the finish");

const longMid = velocityAt(400, 0.5);
const longStart = velocityAt(400, 0.02);
assert(longMid > longStart * 1.15, "a long stroke must show a clearer mid-stroke surge");

const early = handwritingProgress(0.35, 90, -0.8);
const late = handwritingProgress(0.35, 90, 0.8);
assert(Math.abs(early - late) > 0.01, "consecutive strokes must not share the same pulse");
assert(handwritingVariation(1) !== handwritingVariation(2), "variation seeds must differ");

const corner: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 0.5 },
  { x: 40, y: 40 },
];
const cornerLength = 80.5;
const beforeCorner = pacedStrokeDistance(corner, cornerLength, 0.45, 240);
const afterCorner = pacedStrokeDistance(corner, cornerLength, 0.55, 240);
assert(
  0.45 * cornerLength - beforeCorner > afterCorner - 0.55 * cornerLength,
  "the pen must linger on a corner rather than holding one speed through the turn",
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

assert(
  writeUsesStrokePenMotion({ hasSchedule: true, durationMs: 0, visibleCharacterCount: 8 }),
  "a live write schedule must keep the nib on the glyphs even when duration is 0",
);
assert(
  writeUsesStrokePenMotion({
    hasSchedule: false,
    durationMs: 420,
    visibleCharacterCount: 5,
  }),
  "follow-pace handwriting must stay above the instant-label dump",
);
assert(
  !writeUsesStrokePenMotion({
    hasSchedule: false,
    durationMs: 5 * INSTANT_LABEL_MS_PER_CHAR,
    visibleCharacterCount: 5,
  }),
  "a tiny compiler label may appear without walking the nib",
);

// --- a glyph is written, not unrolled --------------------------------------
{
  const straight = Array.from({ length: 21 }, (_, index) => ({ x: index * 2, y: 0 }));
  const plan = planGlyphPacing([{ kind: "ink", samples: straight }]);
  assert(Math.abs(plan.totalLength - 40) < 1e-6, "a paced plan measures its own ink");
  assert(plan.segmentLengths.length === 1, "every segment reports a length");
  assert(pacedGlyphPosition(plan, 0).distance === 0, "a glyph starts at the nib");
  assert(
    Math.abs(pacedGlyphPosition(plan, 1).distance - 40) < 1e-6,
    "a glyph finishes its last stroke, leaving no sliver unpainted",
  );
  let previous = -1;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const distance = pacedGlyphPosition(plan, t).distance;
    assert(distance >= previous - 1e-9, "paced ink never runs backwards");
    previous = distance;
  }
  // The ends of a stroke carry the pen-down and the lift-off, so the middle of
  // a plain straight stroke still covers more ground than either end.
  const first = pacedGlyphPosition(plan, 0.1).distance;
  const middle =
    pacedGlyphPosition(plan, 0.55).distance - pacedGlyphPosition(plan, 0.45).distance;
  assert(middle > first, "the pen presses in and lifts off rather than starting at full speed");
}
{
  // An L: the corner must cost time, or the letter reads as a plotted path.
  const corner = [
    ...Array.from({ length: 11 }, (_, index) => ({ x: index * 4, y: 0 })),
    ...Array.from({ length: 10 }, (_, index) => ({ x: 40, y: (index + 1) * 4 })),
  ];
  const plan = planGlyphPacing([{ kind: "ink", samples: corner }]);
  const timeToReach = (distance: number): number => {
    for (let t = 0; t <= 1.0001; t += 0.0005) {
      if (pacedGlyphPosition(plan, t).distance >= distance) return t;
    }
    return 1;
  };
  // Time spent on the 8px through the bend against 8px of plain straight run.
  const throughCorner = timeToReach(44) - timeToReach(36);
  const throughStraight = timeToReach(24) - timeToReach(16);
  assert(
    throughCorner > throughStraight * 1.3,
    `the pen must slow into the turn: ${throughCorner.toFixed(4)} at the corner vs ${throughStraight.toFixed(4)} on the straight`,
  );
}
{
  // Air between two strokes of one glyph is crossed quickly: the dot of an i
  // must not cost as much of the letter as its stem.
  const stem = Array.from({ length: 11 }, (_, index) => ({ x: 0, y: index * 2 }));
  const air = [
    { x: 0, y: 0 },
    { x: 0, y: -20 },
  ];
  const plan = planGlyphPacing([
    { kind: "ink", samples: stem },
    { kind: "air", samples: air },
    { kind: "ink", samples: stem },
  ]);
  let airFrames = 0;
  let inkFrames = 0;
  for (let t = 0; t <= 1.0001; t += 0.001) {
    if (pacedGlyphPosition(plan, t).segment === 1) airFrames += 1;
    else inkFrames += 1;
  }
  assert(airFrames > 0, "the pen is actually shown crossing the gap");
  assert(
    airFrames * 2 < inkFrames,
    `air must be cheaper than ink, got ${airFrames} air vs ${inkFrames} ink frames`,
  );
  assert(pacedGlyphPosition(plan, 1).segment === 2, "a glyph ends on its last stroke");
}

// --- a chained tween does not open with a stalled frame --------------------
{
  // Created at 1000, first frame at 1016: that refresh is the tween's, not a
  // free frame where the pen stands still.
  assert(tweenStartDeltaMs(1000, 1016, 50) === 16, "the first frame is worth the wait before it");
  assert(tweenStartDeltaMs(1000, 1000, 50) === 0, "a frame that runs immediately is worth nothing");
  assert(tweenStartDeltaMs(1000, 990, 50) === 0, "a clock that went backwards credits nothing");
  assert(
    tweenStartDeltaMs(1000, 4000, 50) === 50,
    "a stalled tab must not swallow a whole glyph in one step",
  );
}

console.log("verify-pen-motion: handwriting cadence varies; path lookup is monotonic");
