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
  WAIT_GRACE_MS,
  WAIT_ROLL_AFTER_MS,
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
assert(instrumentForActivity("draw") === "pencil", "construction geometry is sketched");
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
assert(mid.opacity === 0, "the handover happens while the instrument is invisible");
assert(start.opacity === 1 && end.opacity === 1, "both instruments are fully drawn at rest");
assert(!start.showIncoming && end.showIncoming, "the new instrument arrives at the halfway mark");
let previousSpin = -1;
for (let step = 0; step <= 100; step++) {
  const pose = instrumentSwapPose(step / 100);
  assert(pose.spin >= previousSpin, "the swap spin must never reverse");
  assert(pose.opacity >= 0 && pose.opacity <= 1, "swap opacity stays in range");
  assert(pose.scale >= 1 && pose.scale <= 1.2, "swap scale stays in range");
  previousSpin = pose.spin;
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
  for (let ms = WAIT_GRACE_MS; ms < 30000; ms += 16) {
    const pose = waitingPose(ms);
    assert(Math.abs(pose.dx) <= 2.0, `wait drift x bounded, got ${pose.dx}`);
    assert(Math.abs(pose.dy) <= 1.3, `wait drift y bounded, got ${pose.dy}`);
    assert(Math.abs(pose.tiltOffset) <= 2.5, `wait tilt bounded, got ${pose.tiltOffset}`);
    assert(pose.lift >= 0 && pose.lift <= 11, `wait lift bounded, got ${pose.lift}`);
    assert(pose.scale >= 1 && pose.scale <= 1.12, `wait scale bounded, got ${pose.scale}`);
    assert(
      Math.abs(pose.dx - previous.dx) < 0.2 && Math.abs(pose.dy - previous.dy) < 0.2,
      `wait drift must be continuous at ${ms}ms`,
    );
    // A completed roll lands 360° on, which is the same picture — compare mod 360.
    maxSpinStep = Math.max(maxSpinStep, Math.abs(shortestAngleDelta(previous.spin, pose.spin)));
    previous = pose;
  }
  assert(maxSpinStep < 14, `the wait roll must never jump, worst frame ${maxSpinStep.toFixed(2)}°`);
}
assert(
  waitingPose(WAIT_GRACE_MS + WAIT_ROLL_AFTER_MS - 50).lift < 3,
  "the pen only rolls once the hold is genuinely long",
);
{
  let rolled = false;
  for (let ms = WAIT_GRACE_MS + WAIT_ROLL_AFTER_MS; ms < WAIT_GRACE_MS + WAIT_ROLL_AFTER_MS + 700; ms += 16) {
    if (waitingPose(ms).lift > 6) rolled = true;
  }
  assert(rolled, "a long hold earns a full roll between the fingers");
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

console.log(
  "verify-pen-choreography: cursive does not wobble the barrel, hops and air keep the nib continuous, the parked pen breathes without jerking, swaps are one bounded flip, the pending twirl ramps in, flicks and coasts without ever stalling, and smears with its rate, idle scribbles stay in the margin",
);
