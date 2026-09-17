import {
  bowedPoint,
  carryBow,
  carryEase,
  flightBow,
  nibTravelFor,
  reachEase,
  shapeReachMs,
} from "../src/penChoreography";
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
  dampPaceScale,
  paceScaleForLagMs,
  paceShapeDurationMs,
  INK_SPEED_PX_PER_MS,
  PACE_SCALE_MAX,
  PACE_SCALE_MIN,
  PACE_SCALE_STEP_MAX,
  GLYPH_BUDGET_STEP_MAX,
  GLYPH_LAG_TOLERANCE_MS,
  GLYPH_SLOT_MAX_MS,
  GLYPH_SLOT_MIN_MS,
  INK_STRETCH_MAX,
  lingeringGlyphProgress,
  resolveShapeDurationMs,
  scheduledGlyphBudgetMs,
  simulateScheduledGlyphs,
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

// --- one figure is drawn by one hand ---------------------------------------
/*
  Every shape in a reveal used to get the same millisecond budget, so how fast
  the nib moved was decided by how long the line happened to be: on a mirror
  figure the ticks crawled at 0.04 px/ms while the axis was whipped out at 1.94,
  a 44x spread inside one drawing. Length decides the time now, so the hand
  holds one speed.
*/
{
  const SCENE_MIN = 70;
  const SCENE_MAX = 320;
  const figure = [
    { name: "mirror arc", lengthPx: 470 },
    { name: "principal axis", lengthPx: 620 },
    { name: "object arrow", lengthPx: 96 },
    { name: "incident ray", lengthPx: 210 },
    { name: "reflected ray", lengthPx: 240 },
    { name: "image arrow", lengthPx: 58 },
    { name: "focus tick", lengthPx: 14 },
    { name: "normal (dropped)", lengthPx: 130 },
  ];

  const durations = figure.map((shape) =>
    paceShapeDurationMs({
      lengthPx: shape.lengthPx,
      requestedMs: SCENE_MAX,
      minMs: SCENE_MIN,
      maxMs: SCENE_MAX,
    }),
  );
  const speeds = figure.map((shape, index) => shape.lengthPx / durations[index]!);

  for (let index = 0; index < figure.length; index++) {
    const shape = figure[index]!;
    const duration = durations[index]!;
    assert(
      duration >= SCENE_MIN && duration <= SCENE_MAX,
      `${shape.name} must stay inside the reveal envelope, got ${duration.toFixed(0)}ms`,
    );
    assert(
      speeds[index]! <= INK_SPEED_PX_PER_MS + 1e-9,
      `${shape.name} must not be drawn faster than a hand can, got ${speeds[index]!.toFixed(2)} px/ms`,
    );
  }

  // The remaining spread is only the shapes too short to fill the floor — a
  // tick is a deliberate little mark, not a line drawn at speed.
  const longEnough = figure
    .map((shape, index) => ({ shape, speed: speeds[index]! }))
    .filter((entry) => entry.shape.lengthPx >= SCENE_MIN * INK_SPEED_PX_PER_MS);
  const fastest = Math.max(...longEnough.map((entry) => entry.speed));
  const slowest = Math.min(...longEnough.map((entry) => entry.speed));
  assert(
    fastest / slowest < 1.2,
    `a figure must be drawn at one speed, got a ${(fastest / slowest).toFixed(1)}x spread`,
  );

  // And it can only have got quicker: nothing takes longer than it used to.
  const before = figure.length * SCENE_MAX;
  const after = durations.reduce((sum, duration) => sum + duration, 0);
  assert(
    after < before,
    `pacing by length must not make a figure slower: ${after.toFixed(0)}ms vs ${before}ms`,
  );
}

// --- the whole figure leans on the voice, not each shape separately --------
{
  assert(paceScaleForLagMs(0) > 1, "with the voice level, the hand takes its time");
  assert(paceScaleForLagMs(400) < paceScaleForLagMs(150), "further behind means hurry more");
  assert(paceScaleForLagMs(150) < paceScaleForLagMs(0), "behind the voice means hurry");
  assert(paceScaleForLagMs(-400) > paceScaleForLagMs(0), "ink ahead of the voice may linger");
  assert(paceScaleForLagMs(Number.NaN) === 1, "a broken clock must not change the hand's speed");
  for (const lag of [-2000, -300, -100, 0, 100, 300, 2000]) {
    const scale = paceScaleForLagMs(lag);
    assert(
      scale >= PACE_SCALE_MIN && scale <= PACE_SCALE_MAX,
      `lag ${lag}ms asked for an impossible speed (${scale})`,
    );
  }

  // Nothing snaps: one shape may only move the hand's speed so far.
  let scale: number | null = null;
  const path: number[] = [];
  for (let shape = 0; shape < 24; shape++) {
    // The voice runs away halfway through the figure.
    scale = dampPaceScale(scale, paceScaleForLagMs(shape < 12 ? -400 : 400));
    path.push(scale);
  }
  for (let index = 1; index < path.length; index++) {
    const ratio = path[index]! / path[index - 1]!;
    assert(
      ratio <= PACE_SCALE_STEP_MAX + 1e-9 && ratio >= 1 / PACE_SCALE_STEP_MAX - 1e-9,
      `the hand must accelerate, not switch speed: ${ratio.toFixed(3)}x at shape ${index}`,
    );
  }
  assert(path[11]! > 1.3, "a long lead should have let the hand slow right down");
  assert(path[23]! < 0.75, "and it must have caught back up by the end of the figure");
  assert(dampPaceScale(null, 5) === PACE_SCALE_MAX, "an absurd target is still clamped");

  // The step clamp is not the only thing holding this together: a change small
  // enough to fit inside the clamp must still be eased into, or the hand
  // switches speed on every shape and simply never trips the clamp.
  const nudged = dampPaceScale(1, 1.02);
  assert(
    nudged > 1 && nudged < 1.02,
    `a small change must be approached, not taken in one step, got ${nudged}`,
  );
  assert(
    Math.abs(nudged - 1) < Math.abs(nudged - 1.02),
    "the first shape of a change moves less than half way",
  );
}

// --- a reach and the stroke after it are one continuous motion -------------
/*
  A drawn shape used to place the nib on the first point of its path, so every
  stroke of a figure began with the instrument appearing somewhere else. It now
  reaches; and the reach is budgeted by speed, because a flat 180ms for any
  distance meant crossing the board ran at about 9000 px/s — a whip.
*/
{
  type Point = { x: number; y: number };
  const FRAME_MS = 16.67;
  // Measured maxima with the constants as they stand are 82px and 27px/frame²;
  // these leave headroom without leaving room for a teleport.
  const MAX_STEP_PX = 100;
  const MAX_ACCEL_PX = 40;

  const polyLength = (points: readonly Point[]): number => {
    let total = 0;
    for (let index = 1; index < points.length; index++) {
      total += Math.hypot(
        points[index]!.x - points[index - 1]!.x,
        points[index]!.y - points[index - 1]!.y,
      );
    }
    return total;
  };

  const timeline = (from: Point, samples: Point[], strokeMs: number): Point[] => {
    const start = samples[0]!;
    const reachPx = Math.hypot(start.x - from.x, start.y - from.y);
    const travel = nibTravelFor(reachPx);
    const reachMs = shapeReachMs(reachPx);
    const total = polyLength(samples);
    const frames: Point[] = [];
    for (let ms = 0; ms < reachMs; ms += FRAME_MS) {
      const progress = ms / reachMs;
      frames.push(
        travel === "fly"
          ? bowedPoint(from, start, reachEase(progress), flightBow(reachPx))
          : bowedPoint(from, start, carryEase(progress), carryBow(reachPx)),
      );
    }
    for (let ms = 0; ms <= strokeMs; ms += FRAME_MS) {
      const drawn = pacedStrokeDistance(
        samples,
        total,
        Math.min(ms / strokeMs, 1),
        strokeMs,
        0.3,
      );
      frames.push(pointAlongSamples(samples, total, drawn));
    }
    return frames;
  };

  const arc = samplePolyline(280, (distance) => {
    const angle = Math.PI * 0.15 + (distance / 280) * Math.PI * 0.95;
    return { x: 400 + 120 * Math.cos(angle), y: 300 + 120 * Math.sin(angle) };
  });
  const box: Point[] = [];
  const corners: Array<[Point, Point]> = [
    [{ x: 0, y: 0 }, { x: 200, y: 0 }],
    [{ x: 200, y: 0 }, { x: 200, y: 120 }],
    [{ x: 200, y: 120 }, { x: 0, y: 120 }],
    [{ x: 0, y: 120 }, { x: 0, y: 0 }],
  ];
  for (const [from, to] of corners) {
    for (let step = 0; step <= 20; step++) {
      box.push({
        x: from.x + (to.x - from.x) * (step / 20),
        y: from.y + (to.y - from.y) * (step / 20),
      });
    }
  }

  const cases: Array<{ name: string; from: Point; samples: Point[]; strokeMs: number }> = [
    { name: "across the board into a long arc", from: { x: 60, y: 520 }, samples: arc, strokeMs: 235 },
    { name: "a carry into the same arc", from: { x: arc[0]!.x - 20, y: arc[0]!.y - 8 }, samples: arc, strokeMs: 235 },
    { name: "already there", from: { ...arc[0]! }, samples: arc, strokeMs: 235 },
    { name: "across the board into a box", from: { x: 700, y: 500 }, samples: box, strokeMs: 320 },
    { name: "a hop onto a tick", from: { x: 288, y: 196 }, samples: [{ x: 300, y: 200 }, { x: 306, y: 208 }], strokeMs: 70 },
  ];

  for (const scenario of cases) {
    const frames = timeline(scenario.from, scenario.samples, scenario.strokeMs);
    const steps: number[] = [];
    for (let index = 1; index < frames.length; index++) {
      steps.push(
        Math.hypot(
          frames[index]!.x - frames[index - 1]!.x,
          frames[index]!.y - frames[index - 1]!.y,
        ),
      );
    }
    let stall = 0;
    let longestStall = 0;
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]!;
      assert(
        Number.isFinite(step) && step <= MAX_STEP_PX,
        `${scenario.name}: the nib covered ${step.toFixed(1)}px in one frame — that reads as a jump`,
      );
      if (index > 0) {
        const accel = Math.abs(step - steps[index - 1]!);
        assert(
          accel <= MAX_ACCEL_PX,
          `${scenario.name}: speed changed by ${accel.toFixed(1)}px in one frame — that reads as a lurch`,
        );
      }
      if (step < 0.05) {
        stall += 1;
        longestStall = Math.max(longestStall, stall);
      } else {
        stall = 0;
      }
    }
    assert(
      longestStall * FRAME_MS <= 60,
      `${scenario.name}: the nib parked for ${(longestStall * FRAME_MS).toFixed(0)}ms mid-motion`,
    );
  }
}

// --- the ink of a character fills its spoken slot ---------------------------
/*
  Measured on the mirror lesson (10 Sep 2026): the scheduled glyph budget was
  clamp(slot x 0.78, 42, 128) media ms run at 1.8x with the first frame
  credited, so a glyph took one to six frames whatever its word took, and
  "1/f = 1/u + 1/v" was inked in 2.6 s of a 4.1 s sentence with the pen parked
  for the last 1.5 s. The slot rule below is what replaces it.
*/
{
  const budget = (slotMs: number, lagMs: number, previousMs?: number | null) =>
    scheduledGlyphBudgetMs({ slotMs, lagMs, previousMs });

  const onTime = budget(300, 0);
  assert(onTime.inkMs === 300, `a 300 ms slot is a 300 ms glyph, got ${onTime.inkMs}`);
  assert(onTime.lingerMs === 0, "a slot inside the cap has nothing left to linger on");

  const quick = budget(60, 0);
  assert(
    quick.inkMs === GLYPH_SLOT_MIN_MS && GLYPH_SLOT_MIN_MS === 90,
    `a 60 ms syllable is still written over the 90 ms floor, got ${quick.inkMs}`,
  );
  assert(quick.lingerMs === 0, "a slot under the floor leaves no linger");

  const long = budget(900, 0);
  assert(
    long.inkMs === GLYPH_SLOT_MAX_MS && GLYPH_SLOT_MAX_MS === 350,
    `a 900 ms word caps the glyph at 350, got ${long.inkMs}`,
  );
  assert(
    long.lingerMs === 550,
    `the rest of a 900 ms word is a 550 ms linger on the last stroke, got ${long.lingerMs}`,
  );

  const behind = budget(300, 400);
  assert(
    behind.inkMs === GLYPH_SLOT_MIN_MS,
    `400 ms behind on a 300 ms slot must hurry to the 90 ms floor, not stamp, got ${behind.inkMs}`,
  );
  assert(
    behind.inkMs >= GLYPH_SLOT_MIN_MS,
    "catch-up must still write the letter — a 48 ms stamp is the unsmooth failure",
  );
  assert(behind.lingerMs === 0, "a pen that is behind gives up its linger first");
  const behindAfterLong = budget(300, 400, 350);
  assert(
    behindAfterLong.inkMs <= 120,
    `catching up is not smoothed away: after a 350 ms glyph, 400 ms behind still hurries (${behindAfterLong.inkMs})`,
  );
  const tolerated = budget(300, GLYPH_LAG_TOLERANCE_MS);
  assert(
    tolerated.inkMs === 300,
    `inside the ${GLYPH_LAG_TOLERANCE_MS} ms tolerance the glyph keeps its slot, got ${tolerated.inkMs}`,
  );

  // Consecutive budgets never change by more than 1.5x while the pen is on
  // time, whatever the slots do.
  const slots = [90, 900, 60, 350, 40, 700, 120, 300, 900, 90];
  let previous: number | null = null;
  for (const slot of slots) {
    const next = budget(slot, 0, previous).inkMs;
    if (previous !== null) {
      const ratio = next / previous;
      assert(
        ratio <= GLYPH_BUDGET_STEP_MAX + 1e-9 && ratio >= 1 / GLYPH_BUDGET_STEP_MAX - 1e-9,
        `glyph budgets must change by at most ${GLYPH_BUDGET_STEP_MAX}x, got ${ratio.toFixed(2)}x at slot ${slot}`,
      );
    }
    assert(
      next >= GLYPH_SLOT_MIN_MS && next <= GLYPH_SLOT_MAX_MS,
      `a smoothed budget stays inside the floor and the cap, got ${next}`,
    );
    previous = next;
  }
  assert(budget(Number.NaN, Number.NaN).inkMs >= GLYPH_SLOT_MIN_MS, "a broken slot is still written");

  // A spoken word with many letters (e.g. "quotient") must stay one continuous
  // hand: each glyph still takes the 90 ms floor, and the pen does not park
  // between letters. Catch-up that stamped at 48 ms and jumped the carry
  // was the "not at all smooth" failure.
  {
    const packed = simulateScheduledGlyphs({
      offsetsMs: [0, 70, 140, 210, 280, 350, 420, 490],
      slotsMs: [70, 70, 70, 70, 70, 70, 70, 70],
    });
    for (const glyph of packed.glyphs) {
      assert(
        glyph.inkEndMs - glyph.startMs >= GLYPH_SLOT_MIN_MS - 1e-9,
        `packed-word ink stamped at ${glyph.inkEndMs - glyph.startMs} ms`,
      );
    }
    assert(
      packed.glyphs.slice(1).every((glyph) => glyph.pauseMs < 1),
      "a packed word must not start-stop between letters",
    );
  }

  // The linger is a slow finishing stroke, not a park: progress keeps moving,
  // ends on the last point, and the tail runs slower than the body.
  for (const [inkMs, lingerMs] of [
    [350, 550],
    [350, 80],
    [300, 0],
    [90, 0],
  ] as const) {
    const total = inkMs + lingerMs;
    let last = -1;
    for (let ms = 0; ms <= total + 1e-6; ms += total / 200) {
      const value = lingeringGlyphProgress(ms, inkMs, lingerMs, 0.3);
      assert(value >= last - 1e-9, `a lingering glyph never runs backwards (${inkMs}+${lingerMs})`);
      last = value;
    }
    assert(
      Math.abs(lingeringGlyphProgress(total, inkMs, lingerMs, 0.3) - 1) < 1e-9,
      `a lingering glyph finishes its ink (${inkMs}+${lingerMs})`,
    );
    if (lingerMs > 0) {
      const atInkEnd = lingeringGlyphProgress(inkMs, inkMs, lingerMs, 0.3);
      assert(atInkEnd < 1 && atInkEnd > 0.6, `the body leaves a tail for the linger, got ${atInkEnd}`);
      const bodyRate = atInkEnd / inkMs;
      const tailRate = (1 - atInkEnd) / lingerMs;
      assert(tailRate > 0, "the tail still moves");
      assert(tailRate < bodyRate, `the finishing stroke is slower than the body (${tailRate} vs ${bodyRate})`);
      for (let ms = inkMs; ms < total; ms += lingerMs / 50) {
        const step =
          lingeringGlyphProgress(ms + lingerMs / 50, inkMs, lingerMs, 0.3) -
          lingeringGlyphProgress(ms, inkMs, lingerMs, 0.3);
        assert(step > 0, `the pen never stops dead inside a linger (${inkMs}+${lingerMs} at ${ms.toFixed(0)})`);
      }
    }
  }
  assert(
    lingeringGlyphProgress(200, 350, 550, 0.3, 0) === handwritingProgress(200 / 350, 350, 0.3),
    "a glyph whose last stroke owns none of the map lingers nowhere and keeps its cadence",
  );
}

// --- "1/f = 1/u + 1/v" is written under its sentence, not before it ---------
/*
  The mirror run's line, with the real slots reconstructed at the measured
  86 ms per spoken character: "the mirror equation is one over f equals one
  over u plus one over v." Each board character is cued at its spoken word.
*/
{
  const spoken = ["one ", "over ", "f ", "equals ", "one ", "over ", "u ", "plus ", "one ", "over ", "v."];
  const MS_PER_SPOKEN_CHAR = 86;
  const slots = spoken.map((word) => word.length * MS_PER_SPOKEN_CHAR);
  const offsets: number[] = [];
  let cue = "the mirror equation is ".length * MS_PER_SPOKEN_CHAR;
  for (const slot of slots) {
    offsets.push(cue);
    cue += slot;
  }
  const lastWordEndMs = cue;

  const line = simulateScheduledGlyphs({ offsetsMs: offsets, slotsMs: slots });
  assert(line.glyphs.length === 11, "every character of the row is written");
  assert(
    line.maxPauseMs <= 300,
    `the pen must not park inside the row, longest pause ${line.maxPauseMs.toFixed(0)} ms`,
  );
  assert(
    Math.abs(line.lastEndMs - lastWordEndMs) <= 250,
    `the last glyph ends with the last word: ink ${line.lastEndMs.toFixed(0)} vs voice ${lastWordEndMs} ms`,
  );
  for (let index = 0; index < line.glyphs.length; index++) {
    const glyph = line.glyphs[index]!;
    assert(
      glyph.lagMs <= GLYPH_LAG_TOLERANCE_MS,
      `character ${index} fell ${glyph.lagMs.toFixed(0)} ms behind its word`,
    );
    const wordEndMs = offsets[index]! + slots[index]!;
    assert(
      Math.abs(glyph.endMs - wordEndMs) <= 150,
      `character ${index} leaves its word ${(glyph.endMs - wordEndMs).toFixed(0)} ms off the word end`,
    );
    // It is the ink that fills the slot, not a linger after a stamped glyph:
    // a capped budget with the rest spent lingering would pass the pause and
    // end checks above and still write every letter in a few frames. The cap
    // and the step are pinned as numbers here on purpose, so lowering the
    // constant back toward the old 128 fails this line and not only the
    // unit checks above.
    const inkMs = glyph.inkEndMs - glyph.startMs;
    const slotInk = Math.min(slots[index]!, 350);
    assert(
      inkMs >= slotInk / 1.5 - 1e-9,
      `character ${index} inked in ${inkMs.toFixed(0)} ms of a ${slots[index]} ms word`,
    );
    const lingerMs = glyph.endMs - glyph.inkEndMs;
    assert(
      lingerMs <= Math.max(slots[index]! - 350, 0) + 1e-9,
      `character ${index} lingered ${lingerMs.toFixed(0)} ms on a ${slots[index]} ms word`,
    );
  }
  for (let index = 1; index < line.glyphs.length; index++) {
    const ratio =
      (line.glyphs[index]!.inkEndMs - line.glyphs[index]!.startMs) /
      (line.glyphs[index - 1]!.inkEndMs - line.glyphs[index - 1]!.startMs);
    assert(
      ratio <= GLYPH_BUDGET_STEP_MAX + 1e-9 && ratio >= 1 / GLYPH_BUDGET_STEP_MAX - 1e-9,
      `the hand changed speed ${ratio.toFixed(2)}x between characters ${index - 1} and ${index}`,
    );
  }

  // The old rule on the same line, kept here as the shape of the failure:
  // every glyph capped at 128 ms and the pen parked for the rest of each word.
  const oldRule = (slotMs: number, lagMs: number, previousMs: number | null) => {
    const target =
      lagMs > 220
        ? Math.min(Math.max(slotMs * 0.45, 28), 76)
        : lagMs > 100
          ? Math.min(Math.max(slotMs * 0.62, 34), 98)
          : Math.min(Math.max(slotMs * 0.78, 42), 128);
    const prev = previousMs ?? 72;
    const inkMs = Math.min(Math.max(prev * 0.65 + target * 0.35, prev * 0.72), prev * 1.28);
    return { inkMs, lingerMs: 0 };
  };
  const before = simulateScheduledGlyphs({ offsetsMs: offsets, slotsMs: slots, budget: oldRule });
  assert(
    before.maxPauseMs > 300,
    `the 128 ms cap is the rule being replaced and it parked the pen (${before.maxPauseMs.toFixed(0)} ms)`,
  );
}

// --- a cued stroke takes its spoken window ----------------------------------
/*
  The intro handed drawShape a 10 s window and drawShape clipped every stroke
  to the 320 ms scene ceiling: 14 mirror strokes in 3.5 s, pen parked 3.3 s.
  A cued stroke honours the request; an uncued scene stroke keeps its ceiling.
*/
{
  const SCENE_MIN = 70;
  const SCENE_MAX = 320;
  const cued = resolveShapeDurationMs({
    lengthPx: 600,
    requestedMs: 2000,
    minMs: SCENE_MIN,
    sceneMaxMs: SCENE_MAX,
    pace: "scene",
    cued: true,
  });
  assert(cued === 2000, `a cued 600 px line asked for 2000 ms must take 2000, got ${cued}`);
  const uncued = resolveShapeDurationMs({
    lengthPx: 600,
    requestedMs: 2000,
    minMs: SCENE_MIN,
    sceneMaxMs: SCENE_MAX,
    pace: "scene",
  });
  assert(uncued <= SCENE_MAX, `an uncued scene stroke keeps the ${SCENE_MAX} ms ceiling, got ${uncued}`);
  const uncuedLong = resolveShapeDurationMs({
    lengthPx: 900,
    requestedMs: 2000,
    minMs: SCENE_MIN,
    sceneMaxMs: SCENE_MAX,
    pace: "scene",
  });
  assert(uncuedLong === SCENE_MAX, `a long uncued scene stroke is clamped to ${SCENE_MAX}, got ${uncuedLong}`);
  // Cued still floors at hand speed, and stretches only so far past the request.
  const cuedTooFast = resolveShapeDurationMs({
    lengthPx: 5000,
    requestedMs: 2000,
    minMs: SCENE_MIN,
    sceneMaxMs: SCENE_MAX,
    pace: "scene",
    cued: true,
  });
  assert(
    cuedTooFast === Math.min(5000 / INK_SPEED_PX_PER_MS, 2000 * INK_STRETCH_MAX),
    `a cued stroke stretches to hand speed at most ${INK_STRETCH_MAX}x, got ${cuedTooFast}`,
  );
  const follow = resolveShapeDurationMs({
    lengthPx: 600,
    requestedMs: 2000,
    minMs: SCENE_MIN,
    sceneMaxMs: SCENE_MAX,
    pace: "follow",
  });
  assert(follow === 2000, `follow pace is untouched by the cue flag, got ${follow}`);
}

console.log(
  "verify-pen-motion: handwriting cadence varies; path lookup is monotonic; one figure is " +
    "drawn at one hand speed that leans on the voice without ever switching gear; a reach " +
    "into a stroke is one continuous motion with no jump, no lurch and no parked nib; the ink " +
    "of a character fills its spoken slot and a cued stroke takes its spoken window",
);
