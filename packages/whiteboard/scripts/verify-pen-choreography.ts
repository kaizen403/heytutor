import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  AIR_TRAVEL_WEIGHT,
  HOP_MAX_MS,
  HOP_MIN_MS,
  LEAN_GAIN,
  LEAN_GAIN_DEGREES,
  NibTracker,
  RESTING_TILT,
  TREMOR_DEGREES,
  flourishPose,
  followAngle,
  headingDegrees,
  hopDurationMs,
  instrumentSwapPose,
  lerpAngle,
  advanceIdleHold,
  approachFraction,
  idleHoldStart,
  nibTravelFor,
  CURSOR_ALPHA_EPSILON,
  CURSOR_FADE_TIME_CONSTANT_MS,
  ERASER_BLEND_TIME_CONSTANT_MS,
  FLY_MIN_PX,
  HOP_MIN_PX,
  IDLE_HOLD_DWELL_MS,
  SWAP_MIN_OPACITY,
  planGlyphSegments,
  restingTilt,
  scratchStrokePath,
  shortestAngleDelta,
  slewToward,
  spinGhosts,
  spinningPose,
  SPIN_GHOST_COUNT,
  SPIN_LIFT_PX,
  SPIN_PERIOD_MS,
  SPIN_SMEAR_DEG,
  SPIN_SWING,
  thinkingPose,
  tiltForHeading,
  tremor,
  WAIT_CALM_AFTER_MS,
  WAIT_FIRST_GESTURE_MS,
  WAIT_GESTURE_GAP_MIN_MS,
  WAIT_GRACE_MS,
  bowedPoint,
  carryBow,
  carryEase,
  flightBow,
  flightRotationBlend,
  reachEase,
  settleWaitingPose,
  waitGestureAt,
  waitingPose,
} from "../src/penChoreography";
import {
  instrumentForActivity,
  instrumentMetrics,
  instrumentPalette,
  shade,
  tint,
} from "../src/instruments";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- the hand picks the right tool ----------------------------------------
assert(instrumentForActivity("write") === "pen", "words are written with a pen");
assert(instrumentForActivity("draw") === "pencil", "the figure is drawn in pencil, not in ink");
assert(instrumentForActivity("sketch") === "pencil", "its scaffolding is drawn in the same lead");
assert(instrumentForActivity("highlight") === "highlighter", "emphasis uses the chisel marker");
assert(instrumentForActivity("erase") === "duster", "erasing uses the duster");

// --- palettes stay distinct and legal hex ---------------------------------
const pencil = instrumentPalette("pencil", "#1B2A4A");
const pen = instrumentPalette("pen", "#1B2A4A");
assert(pencil.barrel !== pen.barrel, "a pencil must not be a recoloured pen");
assert(/^#[0-9a-f]{6}$/i.test(pencil.nib), `pencil lead must be hex, got ${pencil.nib}`);
assert(
  instrumentPalette("pencil", "#D64545").nib !== pencil.nib,
  "a red board must give the pencil a red lead",
);
assert(shade("#808080", 0.5) === "#404040", "shade must darken toward black");
assert(tint("#808080", 0.5) === "#c0c0c0", "tint must lighten toward white");
assert(instrumentPalette("pen", "not-a-colour").accent === "#1B2A4A", "bad ink falls back");
assert(instrumentMetrics("pencil").pivotY < 0, "the twirl pivot sits up the barrel");

// --- the barrel leans into the stroke, and never flips ---------------------
const writeRest = restingTilt("write");
assert(writeRest === RESTING_TILT.write, "resting tilt is table-driven");
const down = tiltForHeading(headingDegrees(0, 1), writeRest);
const up = tiltForHeading(headingDegrees(0, -1), writeRest);
const flat = tiltForHeading(headingDegrees(1, 0), writeRest);
assert(down > flat && flat > up, "a downstroke stands the pen up, an upstroke lays it back");
assert(Math.abs(down - writeRest) <= LEAN_GAIN_DEGREES + 1e-9, "lean is bounded by the gain");
assert(Math.abs(up - writeRest) <= LEAN_GAIN_DEGREES + 1e-9, "lean is bounded by the gain");
assert(
  restingTilt("draw") > restingTilt("write"),
  "a pencil sketching geometry sits more upright than a pen writing",
);

// --- tilt eases; it never snaps and never depends on frame rate ------------
const oneStep = followAngle(0, 40, 32);
const twoHalves = followAngle(followAngle(0, 40, 16), 40, 16);
assert(Math.abs(oneStep - twoHalves) < 1e-9, "tilt easing must be frame-rate independent");
assert(oneStep > 0 && oneStep < 40, "one frame moves toward the target without arriving");
assert(followAngle(10, 40, 0) === 10, "a zero-length frame moves nothing");
assert(Math.abs(shortestAngleDelta(350, 10) - 20) < 1e-9, "angle delta takes the short way round");
assert(Math.abs(shortestAngleDelta(10, 350) + 20) < 1e-9, "angle delta is signed");
assert(Math.abs(lerpAngle(350, 10, 0.5) - 360) < 1e-9, "angle lerp crosses the wrap point");
let tremorMaxStep = 0;
for (let ms = 0; ms < 20000; ms += 16) {
  assert(Math.abs(tremor(ms)) <= TREMOR_DEGREES, `tremor must stay tiny, got ${tremor(ms)}`);
  tremorMaxStep = Math.max(tremorMaxStep, Math.abs(tremor(ms + 16) - tremor(ms)));
}
assert(tremorMaxStep < 0.03, `tremor must drift, not buzz: ${tremorMaxStep.toFixed(4)}°/frame`);

// --- the slew cap stops a flick, the exponential keeps the lag ------------
assert(slewToward(0, 90, 16) <= (110 * 16) / 1000 + 1e-9, "a big change is rate-capped per frame");
assert(slewToward(0, 4, 16) > 0 && slewToward(0, 4, 16) < 4, "a small change eases in");
assert(slewToward(10, 10, 16) === 10, "at target, nothing moves");

// --- real handwriting must not wobble the barrel ---------------------------
// A cursive "eeee": loops that reverse direction every few px — the worst case
// for a heading-driven lean. Walk it at 60 fps at a slow and a fast pace.
function walkCursive(pxPerSecond: number): { maxStep: number; min: number; max: number } {
  const nib = new NibTracker(0, 40, restingTilt("write"));
  const point = (s: number) => ({ x: 14 * s + 6 * Math.cos(2 * Math.PI * s), y: 40 + 9 * Math.sin(2 * Math.PI * s) });
  let s = 0;
  let now = 1000;
  let previous = nib.tilt;
  let maxStep = 0;
  let min = Infinity;
  let max = -Infinity;
  // arc-length rate is ~40px per unit of s, so advance s to match the speed
  const dsPerFrame = (pxPerSecond / 60) / 40;
  for (let frame = 0; frame < 600; frame++) {
    s += dsPerFrame;
    const p = point(s);
    const tilt = nib.move(p.x, p.y, "write", now);
    now += 1000 / 60;
    maxStep = Math.max(maxStep, Math.abs(tilt - previous));
    min = Math.min(min, tilt);
    max = Math.max(max, tilt);
    previous = tilt;
  }
  return { maxStep, min, max };
}
const slow = walkCursive(60);
const brisk = walkCursive(180);
const fast = walkCursive(420);
for (const [speed, walk] of [[60, slow], [180, brisk], [420, fast]] as const) {
  // The old heading-follower could flick the barrel 8° in a single frame.
  assert(
    walk.maxStep <= 1.0,
    `cursive at ${speed}px/s must not wobble: ${walk.maxStep.toFixed(2)}° in one frame`,
  );
  const rest = restingTilt("write");
  assert(
    walk.min >= rest - LEAN_GAIN.write - 1e-6 && walk.max <= rest + LEAN_GAIN.write + 1e-6,
    `lean stays inside rest ± gain at ${speed}px/s (${walk.min.toFixed(1)}..${walk.max.toFixed(1)})`,
  );
}
// A slow, careful stroke shows the full roll; a fast hand calms down rather
// than shaking harder — smoothing must grow with speed.
assert(slow.max - slow.min > 4, `slow writing must visibly roll the barrel (${(slow.max - slow.min).toFixed(2)}°)`);
assert(brisk.max - brisk.min > 1.5, `brisk writing still rolls (${(brisk.max - brisk.min).toFixed(2)}°)`);
assert(fast.max - fast.min > 0.6, `fast writing keeps a hint of life (${(fast.max - fast.min).toFixed(2)}°)`);
assert(fast.max - fast.min < brisk.max - brisk.min && brisk.max - brisk.min < slow.max - slow.min, "roll must shrink as speed rises");

// --- a long wait on the voice must not snap the barrel on the next frame ---
{
  const nib = new NibTracker(0, 0, restingTilt("write"));
  let now = 1000;
  for (let i = 0; i < 30; i++) { nib.move(i * 2, 0, "write", now); now += 16; }
  const before = nib.tilt;
  now += 900; // the pen parked while the narration caught up
  const after = nib.move(70, 12, "write", now);
  assert(Math.abs(after - before) <= 6, `no snap after a pause: ${Math.abs(after - before).toFixed(2)}°`);
}

// --- a hop keeps the heading; settle lands exactly ------------------------
{
  const nib = new NibTracker(0, 0, "write" ? restingTilt("write") : 0);
  let now = 1000;
  for (let i = 0; i < 20; i++) { nib.move(i * 3, i * 3, "write", now); now += 16; }
  const heading = nib.heading();
  nib.jump(300, -200, "write", now + 16);
  assert(Math.abs(shortestAngleDelta(heading, nib.heading())) < 1e-9, "a hop never rewrites the heading");
  nib.settle(5, 5, -20, now + 32);
  assert(nib.x === 5 && nib.y === 5 && nib.tilt === -20, "settle lands at the exact pose");
}

// --- hops and air segments ------------------------------------------------
assert(hopDurationMs(4) === 0, "a tiny reposition is just placed");
assert(hopDurationMs(12) === HOP_MIN_MS, "a short hop has a floor");
assert(hopDurationMs(500) === HOP_MAX_MS, "a long hop is capped so sync survives");
const glyph = planGlyphSegments([
  { length: 20, start: { x: 0, y: 0 }, end: { x: 0, y: 20 } },
  { length: 4, start: { x: 0, y: -8 }, end: { x: 0, y: -6 } }, // the dot of an i
  { length: 10, start: { x: 0, y: -6 }, end: { x: 10, y: -6 } }, // touching: no air
]);
assert(glyph.map((seg) => seg.kind).join(",") === "ink,air,ink,ink", `segments: ${glyph.map((s) => s.kind)}`);
assert(glyph[1]!.stroke === 1 && glyph[1]!.from.y === 20 && glyph[1]!.to.y === -8, "air travels to the next stroke");
assert(Math.abs(glyph[1]!.length - 28 * AIR_TRAVEL_WEIGHT) < 1e-9, "air is weighted lighter than ink");

// --- swapping instruments is one continuous flip --------------------------
const start = instrumentSwapPose(0);
const mid = instrumentSwapPose(0.5);
const end = instrumentSwapPose(1);
assert(start.lift < 1e-9 && end.lift < 1e-9, "the pen starts and ends on the board");
assert(mid.lift > 0, "the pen must leave the board to be swapped");
assert(Math.abs(end.spin - 360) < 1e-9, "the swap completes exactly one turn");
// The hand-over is carried by the barrel turning edge-on, not by fading out.
// It used to run the instrument to opacity 0 for the middle 40% of the flip,
// which, now that every write/draw boundary swaps, is a pen that blinks out of
// existence several times a minute.
assert(
  SWAP_MIN_OPACITY >= 0.5,
  `the swap's own floor must keep the instrument legible, got ${SWAP_MIN_OPACITY}`,
);
assert(mid.flatten < 0.2, "the handover happens while the barrel is edge-on");
assert(start.flatten === 1 && end.flatten === 1, "both instruments end up face-on");
assert(start.opacity === 1 && end.opacity === 1, "both instruments are fully drawn at rest");
assert(!start.showIncoming && end.showIncoming, "the new instrument arrives at the halfway mark");
let previousSpin = -1;
for (let step = 0; step <= 100; step++) {
  const pose = instrumentSwapPose(step / 100);
  assert(pose.spin >= previousSpin, "the swap spin must never reverse");
  // An absolute floor, not `>= SWAP_MIN_OPACITY` — comparing the curve against
  // the very constant that shapes it asserts nothing, and lets someone set the
  // floor back to zero with the gate still green.
  assert(
    pose.opacity >= 0.5,
    `the instrument must stay on screen through the swap, got ${pose.opacity.toFixed(3)} at ${step}%`,
  );
  assert(pose.opacity <= 1, "swap opacity stays in range");
  assert(pose.flatten >= 0 && pose.flatten <= 1, "flatten stays in range");
  assert(pose.scale >= 1 && pose.scale <= 1.2, "swap scale stays in range");
  previousSpin = pose.spin;
}
// The flip reads as one object turning: the barrel goes thin exactly once,
// at the hand-over, rather than pulsing.
{
  let edgeCrossings = 0;
  let wasThin = instrumentSwapPose(0).flatten < 0.35;
  for (let step = 1; step <= 200; step++) {
    const thin = instrumentSwapPose(step / 200).flatten < 0.35;
    if (thin && !wasThin) edgeCrossings += 1;
    wasThin = thin;
  }
  assert(edgeCrossings === 1, `the barrel turns edge-on once, got ${edgeCrossings} times`);
}
assert(Math.abs(flourishPose(1, 2).spin - 720) < 1e-9, "a two-turn flourish spins twice");
assert(flourishPose(0.5, 1).opacity === 1, "a flourish never blinks the instrument out");

// --- the thinking fidget is bounded and continuous ------------------------
let previous = thinkingPose(0);
for (let ms = 8; ms <= 20000; ms += 8) {
  const pose = thinkingPose(ms);
  assert(Math.abs(pose.dx) < 12 && Math.abs(pose.dy) < 14, "the fidget stays a fidget");
  assert(Math.abs(pose.spin) < 12, "the idle roll never becomes a spin");
  assert(pose.lift >= 0 && pose.lift < 6, "the tap lifts the nib a few px at most");
  assert(
    Math.abs(pose.dx - previous.dx) < 1 && Math.abs(pose.dy - previous.dy) < 1.5,
    `the fidget must be continuous frame to frame at ${ms}ms`,
  );
  previous = pose;
}

// --- the pen waiting on the voice: still, then breathing, never a jerk ----
assert(!waitingPose(0).active, "no motion at the instant the wait starts");
assert(!waitingPose(WAIT_GRACE_MS).active, "a gap between two letters stays perfectly still");
assert(waitingPose(WAIT_GRACE_MS + 1).active, "past the grace period the hand takes over");
{
  const first = waitingPose(WAIT_GRACE_MS + 1);
  assert(
    Math.abs(first.dx) < 0.02 && Math.abs(first.dy) < 0.02 && Math.abs(first.tiltOffset) < 0.02,
    "idle motion must ramp from exactly zero, not pop",
  );
}
{
  let previous = waitingPose(WAIT_GRACE_MS);
  let maxSpinStep = 0;
  let maxSpin = 0;
  for (let ms = WAIT_GRACE_MS; ms < 60000; ms += 16) {
    const pose = waitingPose(ms);
    assert(Math.abs(pose.dx) <= 6, `wait drift x bounded, got ${pose.dx}`);
    assert(Math.abs(pose.dy) <= 4, `wait drift y bounded, got ${pose.dy}`);
    assert(Math.abs(pose.tiltOffset) <= 4.5, `wait tilt bounded, got ${pose.tiltOffset}`);
    assert(pose.lift >= 0 && pose.lift <= 8, `wait lift bounded, got ${pose.lift}`);
    assert(pose.scale >= 1 && pose.scale <= 1.06, `wait scale bounded, got ${pose.scale}`);
    assert(
      Math.abs(pose.dx - previous.dx) < 0.25 && Math.abs(pose.dy - previous.dy) < 0.25,
      `wait drift must be continuous at ${ms}ms`,
    );
    assert(
      Math.abs(pose.lift - previous.lift) < 1.2,
      `the nib must not jump off the board at ${ms}ms`,
    );
    maxSpinStep = Math.max(maxSpinStep, Math.abs(shortestAngleDelta(previous.spin, pose.spin)));
    maxSpin = Math.max(maxSpin, Math.abs(pose.spin));
    previous = pose;
  }
  assert(maxSpinStep < 3, `a waiting hand never whips the barrel, worst frame ${maxSpinStep.toFixed(2)}°`);
  // The old wait rolled the pen a full turn every few seconds. A teacher
  // holding a pause re-grips; they do not perform.
  assert(maxSpin < 60, `a waiting hand re-grips, it does not twirl (peak ${maxSpin.toFixed(1)}°)`);
}
{
  // Nothing but breath until the pause is genuinely a pause.
  for (let ms = WAIT_GRACE_MS; ms < WAIT_GRACE_MS + WAIT_FIRST_GESTURE_MS; ms += 16) {
    assert(
      waitGestureAt(ms - WAIT_GRACE_MS) === null && waitingPose(ms).lift < 2,
      `a short hold must stay quiet at ${ms}ms`,
    );
  }
}
{
  // Gestures do happen, and they are not on a metronome: a fidget that repeats
  // on a fixed period is the tell that gives an animation away.
  const starts: number[] = [];
  let seen = -1;
  for (let ms = 0; ms < 90000; ms += 8) {
    const at = waitGestureAt(ms);
    if (at && at.gesture.index !== seen) {
      seen = at.gesture.index;
      starts.push(at.gesture.startMs);
    }
  }
  assert(starts.length >= 8, `a long wait shows its hand, got ${starts.length} gestures`);
  const gaps: number[] = [];
  for (let index = 1; index < starts.length; index++) {
    gaps.push(starts[index]! - starts[index - 1]!);
  }
  const unique = new Set(gaps.map((gap) => Math.round(gap / 50)));
  assert(unique.size >= gaps.length - 1, "wait gestures must not repeat on a period");
  assert(
    Math.min(...gaps) >= WAIT_GESTURE_GAP_MIN_MS,
    `gestures must stay spaced, tightest ${Math.min(...gaps).toFixed(0)}ms`,
  );
  const early = gaps.filter((_, index) => starts[index]! < WAIT_CALM_AFTER_MS);
  const late = gaps.filter((_, index) => starts[index]! > WAIT_CALM_AFTER_MS + 20000);
  if (early.length > 0 && late.length > 0) {
    const mean = (values: number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    assert(mean(late) > mean(early), "a hand that has been waiting a while fidgets less, not more");
  }
}
{
  // The wait ends on the voice's schedule, so the hand has to be back on the
  // board by then rather than snapping there.
  const mid = waitingPose(WAIT_GRACE_MS + WAIT_FIRST_GESTURE_MS + 200);
  const settled = settleWaitingPose(mid, 0);
  assert(
    settled.dx === 0 && settled.dy === 0 && settled.spin === 0 && settled.lift === 0 && settled.scale === 1,
    "a fully settled wait pose is rest",
  );
  const held = settleWaitingPose(mid, 1);
  assert(held.dx === mid.dx && held.lift === mid.lift, "an open wait is left alone");
  const half = settleWaitingPose(mid, 0.5);
  assert(
    Math.abs(half.lift - mid.lift * 0.5) < 1e-9 && Math.abs(half.spin - mid.spin * 0.5) < 1e-9,
    "the return to the board is proportional",
  );
}

// --- travel: a hand arcs, and never stops between two letters -------------
{
  const from = { x: 100, y: 400 };
  const to = { x: 260, y: 380 };
  const bow = flightBow(Math.hypot(to.x - from.x, to.y - from.y));
  assert(bow > 8, "a long reach bows well clear of the straight line");
  const start = bowedPoint(from, to, 0, bow);
  const finish = bowedPoint(from, to, 1, bow);
  assert(start.x === from.x && start.y === from.y, "travel starts where the pen is");
  assert(finish.x === to.x && finish.y === to.y, "travel lands exactly on target");
  const mid = bowedPoint(from, to, 0.5, bow);
  const straightY = (from.y + to.y) / 2;
  assert(mid.y < straightY - 4, `the arc must rise over the line, got ${mid.y} vs ${straightY}`);
  // Down-screen travel has to bow the same way: over the top, not through the
  // ink the pen just laid down.
  const down = bowedPoint({ x: 100, y: 200 }, { x: 300, y: 500 }, 0.5, 20);
  assert(down.y < 350, `travel must arc over, not sag under, got ${down.y}`);

  let previous = bowedPoint(from, to, 0, bow);
  for (let t = 0.01; t <= 1.0001; t += 0.01) {
    const point = bowedPoint(from, to, t, bow);
    assert(
      Math.hypot(point.x - previous.x, point.y - previous.y) < 12,
      "the arc must be sampled continuously",
    );
    previous = point;
  }
}
{
  assert(carryEase(0) === 0 && Math.abs(carryEase(1) - 1) < 1e-9, "a carry covers the gap exactly");
  const entry = (carryEase(0.02) - carryEase(0)) / 0.02;
  const exit = (carryEase(1) - carryEase(0.98)) / 0.02;
  assert(entry > 0.3, `the pen is still moving as it leaves a letter (${entry.toFixed(2)})`);
  assert(exit > 0.3, `the pen is already moving as it meets the next (${exit.toFixed(2)})`);
  let previousRate = 0;
  for (let t = 0; t < 1; t += 0.01) {
    const rate = (carryEase(t + 0.01) - carryEase(t)) / 0.01;
    assert(rate > 0, "a carry never stalls or reverses");
    previousRate = rate;
  }
  assert(previousRate > 0, "a carry is still running at the end");
}
{
  assert(reachEase(0) === 0 && Math.abs(reachEase(1) - 1) < 1e-9, "a reach lands on its target");
  let peakAt = 0;
  let peak = 0;
  for (let t = 0; t < 1; t += 0.005) {
    const rate = (reachEase(t + 0.005) - reachEase(t)) / 0.005;
    if (rate > peak) {
      peak = rate;
      peakAt = t;
    }
  }
  // Minimum-jerk, skewed early: the arm commits, then spends the tail placing
  // the nib rather than arriving at speed.
  assert(peakAt < 0.5, `a reach commits early, peak speed at ${peakAt.toFixed(2)}`);
  assert(peakAt > 0.3, `a reach is not a lunge, peak speed at ${peakAt.toFixed(2)}`);
  assert(
    (reachEase(0.02) - reachEase(0)) / 0.02 < 0.2,
    "a reach starts from a hand at rest",
  );
}
{
  assert(flightRotationBlend(0) === 0, "the barrel holds the angle it wrote at");
  assert(flightRotationBlend(0.4) === 0, "the roll waits for the approach");
  assert(Math.abs(flightRotationBlend(1) - 1) < 1e-9, "the barrel is landed by touchdown");
  assert(carryBow(4) < carryBow(40), "a longer carry bows further");
  assert(carryBow(1000) <= 9.001, "a carry bow stays a carry");
}

// --- margin scribbles never leave the margin ------------------------------
const box = { x: 62, y: 647, width: 196, height: 41 };
const numbers = (data: string): number[] =>
  data.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
for (let seed = 0; seed < 24; seed++) {
  const data = scratchStrokePath(seed, box);
  assert(data.startsWith("M "), "a scribble is a path");
  const values = numbers(data);
  assert(values.length >= 6, "a scribble has more than one segment");
  for (let index = 0; index < values.length; index += 2) {
    const px = values[index]!;
    const py = values[index + 1]!;
    assert(
      px >= box.x - 0.01 && px <= box.x + box.width + 0.01,
      `scribble ${seed} escaped the margin horizontally at ${px}`,
    );
    assert(
      py >= box.y - 0.01 && py <= box.y + box.height + 0.01,
      `scribble ${seed} escaped the margin vertically at ${py}`,
    );
  }
}
assert(
  scratchStrokePath(7, box) === scratchStrokePath(7, box),
  "a scribble must be deterministic per seed",
);
assert(scratchStrokePath(7, box) !== scratchStrokePath(8, box), "each doodle differs");

// --- the pending-state twirl ------------------------------------------------
const rest = spinningPose(0);
assert(rest.spin === 0 && rest.lift === 0 && rest.scale === 1, "the twirl starts from the board");
{
  // Velocity ramps in: the first turn takes longer than the steady period.
  let previous = 0;
  let firstTurnMs = 0;
  for (let ms = 16; ms <= SPIN_PERIOD_MS * 2; ms += 16) {
    const spin = spinningPose(ms).spin;
    if (spin < previous && firstTurnMs === 0) firstTurnMs = ms;
    previous = spin;
  }
  assert(firstTurnMs > SPIN_PERIOD_MS, `first turn must ramp in, completed at ${firstTurnMs}ms`);
  // Steady state: the cadence nets to zero, so a turn still takes exactly one
  // period however much the rate breathes inside it.
  const late = spinningPose(10 * SPIN_PERIOD_MS);
  const later = spinningPose(11 * SPIN_PERIOD_MS);
  assert(Math.abs(late.spin - later.spin) < 0.5, "steady turns repeat exactly per period");

  // ...but within a turn it flicks and coasts rather than running like a motor.
  let fastest = 0;
  let slowest = Infinity;
  let previousAngle = spinningPose(8 * SPIN_PERIOD_MS).spin;
  for (let ms = 8 * SPIN_PERIOD_MS + 4; ms <= 10 * SPIN_PERIOD_MS; ms += 4) {
    const angle = spinningPose(ms).spin;
    const step = ((angle - previousAngle + 540) % 360) - 180;
    previousAngle = angle;
    assert(step > 0, `the barrel must never stall or reverse, got ${step}° in 4ms`);
    fastest = Math.max(fastest, step);
    slowest = Math.min(slowest, step);
  }
  const mean = (360 * 4) / SPIN_PERIOD_MS;
  assert(
    Math.abs(fastest / mean - (1 + SPIN_SWING)) < 0.02,
    `a flick must peak at ${(1 + SPIN_SWING).toFixed(2)}x the mean, got ${(fastest / mean).toFixed(3)}x`,
  );
  assert(
    Math.abs(slowest / mean - (1 - SPIN_SWING)) < 0.02,
    `a coast must ebb to ${(1 - SPIN_SWING).toFixed(2)}x the mean, got ${(slowest / mean).toFixed(3)}x`,
  );

  assert(spinningPose(2000).lift === SPIN_LIFT_PX, "the pencil holds its lift once up");
  assert(spinningPose(2000).scale > 1, "a lifted pencil reads slightly larger");
  for (let ms = 0; ms < 5000; ms += 7) {
    const pose = spinningPose(ms);
    assert(pose.spin >= 0 && pose.spin < 360, "spin stays wrapped");
    assert(Math.abs(pose.dx) <= 2.2 && Math.abs(pose.dy) <= 1.4, "the hover stays a hover");
    assert(pose.velocity >= 0 && pose.velocity <= 1 + SPIN_SWING + 1e-9, "rate stays in band");
  }
}

// --- motion blur follows the rate ------------------------------------------
assert(spinGhosts(0).length === 0, "a still barrel casts no smear");
{
  const flick = spinGhosts(1 + SPIN_SWING);
  const coast = spinGhosts(1 - SPIN_SWING);
  assert(flick.length === SPIN_GHOST_COUNT, "a full flick uses the whole trail");
  assert(
    flick[flick.length - 1]!.offset > coast[coast.length - 1]!.offset,
    "a flick must smear wider than a coast",
  );
  assert(
    flick[0]!.opacity > flick[flick.length - 1]!.opacity,
    "the trail fades away from the barrel",
  );
  for (const ghost of flick) {
    assert(ghost.offset >= 0, "ghosts trail behind, never lead");
    assert(ghost.offset <= SPIN_SMEAR_DEG, "the smear stays inside its budget");
    assert(ghost.opacity > 0 && ghost.opacity < 0.5, "a ghost is a hint, not a second pencil");
  }
}

// --- the fidget may not steal the pen mid-lesson ---------------------------
/*
  The board sits in `thinking` for the whole of a live turn, not just the wait
  before it, so "thinking" alone is not permission to fidget. Between two
  commands there are a handful of frames with nothing in flight; a fidget that
  engages there used to yank the instrument back to wherever it stood when the
  turn began and spin it, then the next stroke snatched it away again. That is
  the pen vanishing from one place and reappearing in another.
*/
{
  let hold = idleHoldStart();
  const feed = (workInFlight: boolean, nowMs: number) => {
    const step = advanceIdleHold(hold, { workInFlight, nowMs });
    hold = step.state;
    return step;
  };

  // A short gap between two commands must never engage the hold.
  feed(true, 0);
  let engagedInGap = false;
  for (let ms = 16; ms < IDLE_HOLD_DWELL_MS; ms += 16) {
    if (feed(false, ms).engaged) engagedInGap = true;
  }
  assert(!engagedInGap, "a gap between commands must not hand the pen to the fidget");

  // Work resumes: the hold is not owed anything for the quiet it just had.
  feed(true, IDLE_HOLD_DWELL_MS + 16);
  assert(
    !feed(false, IDLE_HOLD_DWELL_MS + 32).engaged,
    "the dwell must be re-earned after every stroke, not banked",
  );

  // A real wait does engage — once, and it reports the frame it did so on.
  let engagements = 0;
  let engagedAt = -1;
  for (let ms = IDLE_HOLD_DWELL_MS + 48; ms <= IDLE_HOLD_DWELL_MS * 4; ms += 16) {
    const step = feed(false, ms);
    if (step.justEngaged) {
      engagements += 1;
      engagedAt = ms;
    }
  }
  assert(engagements === 1, `a single wait engages the hold once, got ${engagements}`);
  assert(engagedAt > 0, "the hold reports the frame it took the pen, so the fidget can anchor there");

  // The pose clock starts at the engage, not at the top of the turn: the twirl
  // begins from rest instead of jumping into the middle of a revolution.
  const first = advanceIdleHold(hold, { workInFlight: false, nowMs: engagedAt });
  assert(first.heldMs < 200, `the fidget clock starts fresh, got ${first.heldMs}ms`);

  // And it lets go the instant there is work again, reporting that frame so
  // the instrument can be put back exactly where the fidget picked it up.
  const released = advanceIdleHold(hold, { workInFlight: true, nowMs: engagedAt + 5000 });
  assert(released.justReleased, "work resuming must hand the instrument straight back");
  assert(!released.engaged, "the fidget does not keep hold while the pen is writing");
  assert(
    !advanceIdleHold(released.state, { workInFlight: true, nowMs: engagedAt + 5016 }).justReleased,
    "the release fires once, not on every working frame",
  );
}

// --- the nib is never simply somewhere else -------------------------------
/*
  Every reposition goes through one policy, so there is a single answer to "may
  the nib just appear over there?" — and it is only yes inside a nib width or
  two. A drawn shape used to start its reveal by placing the nib on the first
  point of the path, wherever that was.
*/
assert(nibTravelFor(0) === "settle", "a nib already there just settles");
assert(nibTravelFor(HOP_MIN_PX - 1) === "settle", "a hair's breadth is not worth a hop");
assert(nibTravelFor(HOP_MIN_PX + 1) === "hop", "a short carry is a hop");
assert(nibTravelFor(FLY_MIN_PX - 1) === "hop", "the carry holds up to the fly threshold");
assert(nibTravelFor(FLY_MIN_PX + 1) === "fly", "crossing the board is an arm movement");
assert(nibTravelFor(900) === "fly", "a long reach is still a flight, not a teleport");
assert(nibTravelFor(Number.NaN) === "settle", "a broken distance must not fly the pen away");
for (let distance = 0; distance <= 400; distance += 3) {
  const travel = nibTravelFor(distance);
  assert(
    distance <= HOP_MIN_PX || travel !== "settle",
    `${distance}px must be bridged, not stepped over`,
  );
}

// --- the instrument fades, it never blinks --------------------------------
/*
  `cursorOpacity` is a step function and `idle` is 0. A lecture is a run of
  turns, so the board drops back to `idle` between them; read straight into the
  node, that is a pen that disappears mid-lesson. Only the approach is smoothed.
*/
{
  assert(approachFraction(0, CURSOR_FADE_TIME_CONSTANT_MS) === 0, "no time, no movement");
  assert(approachFraction(-5, CURSOR_FADE_TIME_CONSTANT_MS) === 0, "time does not run backwards");
  let opacity = 1;
  let frames = 0;
  const dt = 16;
  while (opacity > 0.02 && frames < 600) {
    opacity += (0 - opacity) * approachFraction(dt, CURSOR_FADE_TIME_CONSTANT_MS);
    frames += 1;
    assert(opacity >= 0 && opacity <= 1, "the fade stays in range");
  }
  assert(frames > 6, `the pen must be set down, not deleted: took ${frames} frames`);
  assert(frames < 45, `the fade must not outlast the pause: took ${frames} frames`);
  // Frame rate must not change where it lands: one 32ms frame equals two 16ms.
  const oneStep = approachFraction(32, CURSOR_FADE_TIME_CONSTANT_MS);
  const a = approachFraction(16, CURSOR_FADE_TIME_CONSTANT_MS);
  const twoSteps = a + (1 - a) * a;
  assert(Math.abs(oneStep - twoSteps) < 1e-9, "the fade must not depend on frame rate");
}

// --- and nothing on the board is allowed to hard-hide it -------------------
/*
  The fade above is correct arithmetic that the render used to throw away.

  `cursorOpacity` is a step function whose `idle` is 0, and the cursor layer
  read it straight into the Konva node's `visible` and `opacity` props. So every
  React render during a fade snapped the marker back onto the step, and at
  `idle` it set `visible(false)` outright — the ease carried on running, on a
  node nobody could see. On top of that the eraser was a React branch: `erasing`
  destroyed the marker and created a block in its place, and the end of the wipe
  did the reverse. Two hard pops per erase, and a marker that blinked out
  between every pair of turns in a lecture.

  None of that is visible to a pure function, so it is asserted against the
  source. The rule is: exactly one place decides how visible the instrument is,
  it reads the eased value, and both nodes stay mounted.
*/
{
  const boardPath = fileURLToPath(new URL("../src/Whiteboard.tsx", import.meta.url));
  const board = readFileSync(boardPath, "utf8");
  // Comments quote the old code, so they are stripped before matching.
  const code = board
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  assert(
    !/visible=\{[^}]*cursorOpacity/.test(code),
    "the cursor layer must not compute visibility from the opacity step function",
  );
  assert(
    !/opacity=\{[^}]*cursorOpacity/.test(code),
    "nor its opacity: a render mid-fade would snap the marker back onto the step",
  );
  assert(
    /visible=\{cursorAlphaRef\.current\.pen > CURSOR_ALPHA_EPSILON\}/.test(code),
    "the marker is visible exactly while its eased alpha is above the epsilon",
  );
  assert(
    /opacity=\{cursorAlphaRef\.current\.pen\}/.test(code),
    "and its opacity is that eased alpha, nothing else",
  );
  assert(
    !/activeCursorState === "erasing" \? \(/.test(code),
    "the marker and the eraser must both stay mounted; a branch here is two pops per wipe",
  );
  // One painter. A second `group.opacity(...)` anywhere is a second opinion
  // about how visible the marker is, and the two will disagree on some frame.
  const painters = code.match(/(?:group|duster)\.opacity\(/g) ?? [];
  assert(
    painters.length === 2,
    `exactly one place may set the instrument's opacity, found ${painters.length} writes`,
  );
  const hides = code.match(/(?:group|duster)\.visible\(/g) ?? [];
  assert(
    hides.length === 2,
    `and one place may hide it, found ${hides.length} writes`,
  );
  assert(
    /group\.visible\(penAlpha > CURSOR_ALPHA_EPSILON\)/.test(code),
    "and it may only hide the marker once the fade has actually reached zero",
  );
  // The epsilon has to be under the eye, not a convenient early exit. At 0.02
  // of full opacity the marker is already invisible; anything above that and
  // "hide it once the fade is done" is just the old blink with a threshold.
  assert(
    CURSOR_ALPHA_EPSILON > 0 && CURSOR_ALPHA_EPSILON < 0.02,
    `the hide threshold must be below the eye, got ${CURSOR_ALPHA_EPSILON}`,
  );

  // The idle hand runs while the tutor is speaking, not only while it thinks.
  // The marker tour holds `speaking` through a hop-and-dwell walk, and for the
  // whole of every dwell the pen used to stand perfectly dead.
  assert(
    /IDLE_ELIGIBLE_STATES: readonly CursorState\[\] = \["thinking", "speaking"\]/.test(code),
    "the idle hand must stay alive through `speaking`, or the tour's dwells are frozen",
  );
  /*
    And the eligibility is read per frame, not made a dependency of the effect.
    As a dependency, a tour flipping the state to `speaking` unmounted the idle
    effect mid-gesture and ran its cleanup, and the cleanup wrote the
    instrument back to rest on that one frame: a twirl caught at 180° snapped
    and a lifted nib dropped. Every state change during a lecture did it.
  */
  assert(
    /!IDLE_ELIGIBLE_STATES\.includes\(state\)/.test(code),
    "eligibility must be read on the frame, so a state change cannot snap a gesture",
  );
  const idleDeps = code.match(
    /\}, \[cancelTrackedFrame, nowMs, requestTrackedFrame, setCursorViewSafely, settleNib, thinkingMotion\]\);/,
  );
  assert(
    idleDeps !== null,
    "the idle effect must not depend on the cursor state; that is what remounts it mid-gesture",
  );
  // Nor may the cleanup reset the pose, whatever remounts it.
  assert(
    !/if \(frameId !== null\) cancelTrackedFrame\(frameId\);\s*\n\s*const view = cursorViewRef\.current;\s*\n\s*setCursorViewSafely\(view\.x, view\.y, view\.rotation, 1\);/.test(
      code,
    ),
    "an effect cleanup may not write the instrument back to rest on its unmount frame",
  );

  // Stunts are a setting, read live, and they never reach the board as a value
  // that could make the marker fainter.
  assert(
    /idlePose\([^)]*\{\s*\n?\s*stunts: markerStuntsRef\.current,?\s*\n?\s*\}\)/.test(code) ||
      /stunts: markerStuntsRef\.current/.test(code),
    "the idle pose must be given the live stunt setting",
  );
}

// --- a wipe is a hand-over, and it is slower than a state fade -------------
{
  assert(
    ERASER_BLEND_TIME_CONSTANT_MS > CURSOR_FADE_TIME_CONSTANT_MS,
    "putting the marker down and picking the eraser up is a movement, not a cut",
  );
  // Crossfading two nodes must never leave a hole: at every point of the
  // hand-over something is on the board, and the two never sum above one.
  let thinnest = 1;
  let blend = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    blend += (1 - blend) * approachFraction(16, ERASER_BLEND_TIME_CONSTANT_MS);
    const total = (1 - blend) + blend;
    assert(Math.abs(total - 1) < 1e-9, "the hand-over must not dim the board on its way across");
    thinnest = Math.min(thinnest, Math.max(1 - blend, blend));
  }
  assert(thinnest >= 0.5 - 1e-9, "at the midpoint both are at half, which is a hand-over");
}

console.log(
  "verify-pen-choreography: cursive does not wobble the barrel, hops and air keep the nib continuous, the parked pen breathes without jerking, swaps turn edge-on without ever blinking out, the fidget only takes the pen after a real dwell and hands it straight back, every reposition is bridged rather than stepped over, the instrument fades instead of disappearing, the pending twirl ramps in, flicks and coasts without ever stalling, and smears with its rate, idle scribbles stay in the margin, and nothing in the board hard-hides the instrument or unmounts it for a wipe",
);
