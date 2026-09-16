/**
 * The hand while the voice is doing the teaching.
 *
 * Most of a lesson is narration over ink that is already on the board: the
 * tutor is talking, and the pen has nothing to draw. The board used to fill
 * that with one gesture — the barrel twirling about its mid-point, forever, on
 * a 1400ms period, in the one spot the pen happened to stop. Held for a couple
 * of seconds that reads as a person playing with a pen. Held for thirty it
 * reads as a loading spinner someone forgot to switch off, and it is the same
 * loop every pause of every lesson.
 *
 * So the idle hand gets a repertoire instead. Ten gestures, each a different
 * thing a person does with a pen while they are talking: a roll between the
 * fingers, a tap against the board, a bob, a drift out and back, a metronome
 * sway, leaning back to look at what is written, a lazy loop in the air, a jab
 * of emphasis, a nervous jitter, and — occasionally, not constantly — the full
 * twirl. They are sequenced with real rests between them, they are drawn from
 * a per-pause seed so two pauses in one lesson are not the same performance,
 * and each pause gets a mood that decides how big and how often.
 *
 * Rules the whole module holds to, because a fidget that breaks them is worse
 * than no fidget at all:
 *
 *  - Every gesture starts and ends at exactly rest, with zero slope at both
 *    ends, so nothing can pop into or out of one. A twirl "ends at rest" by
 *    finishing its turn: 360° is the pose it started in.
 *  - Between gestures the hand still breathes. The pen is never frozen.
 *  - Nothing travels far. The pen fidgets where it is standing; it does not go
 *    anywhere, so it can never be mistaken for the pen being taken somewhere.
 *  - Amplitude and frequency both decay as the pause lengthens. An unhurried
 *    hand fidgets less, not more.
 *
 * Everything here is a pure function of (elapsed, seed) so
 * `verify-pen-idle` can measure the motion without a canvas.
 */

import { clamp01 } from "./penMotion";
import {
  SPIN_PERIOD_MS,
  SPIN_SWING,
  shortestAngleDelta,
  smoothstep,
  smootherstep,
} from "./penChoreography";

/** Ease out of stillness rather than starting mid-gesture. */
export const IDLE_RAMP_MS = 320;
/** How far the nib relaxes off the board once the hand is off duty. */
export const IDLE_HOVER_PX = 3.2;
export const IDLE_HOVER_MS = 700;
/**
 * The hand is off duty the moment the pen is, so the first gesture comes soon
 * — the voice is already talking. `IDLE_HOLD_DWELL_MS` upstream has already
 * proved the quiet is real before any of this runs.
 */
export const IDLE_FIRST_GESTURE_MS = 420;
/** Rest between gestures — a floor plus a per-gesture spread, never a period. */
export const IDLE_GAP_MIN_MS = 700;
export const IDLE_GAP_SPREAD_MS = 1900;
/** Past this the hand has settled into the pause: smaller, rarer gestures. */
export const IDLE_CALM_AFTER_MS = 12000;
export const IDLE_CALM_RAMP_MS = 10000;
export const IDLE_CALM_GAP_GAIN = 0.9;
export const IDLE_CALM_AMPLITUDE_DROP = 0.35;
/** The pen fidgets where it stands: a soft cap on how far it may stray, in px. */
export const IDLE_TRAVEL_MAX_PX = 18;
/** And on how far off the board it may be pulled back. */
export const IDLE_LIFT_MAX_PX = 16;
/** How long the hand takes to put the instrument back down when work arrives. */
export const IDLE_RELEASE_MS = 140;
/** Lift at the top of a full twirl. */
export const IDLE_TWIRL_LIFT_PX = 7;

/**
 * What the hand is doing with the pen.
 *
 * - `twirl`   one full turn between the fingers, ending where it began
 * - `roll`    the barrel rolled a little and rolled back: adjusting the hold
 * - `tap`     three taps of the nib against the board
 * - `bob`     the hand bobbing in the air, nodding along with the sentence
 * - `wander`  a drift out across the board and back, hovering
 * - `sway`    the barrel swung about the nib like a metronome
 * - `lean`    pulled back and up to look at what is written, held, returned
 * - `loop`    a lazy figure eight in the air
 * - `jab`     two quick dips at the board: emphasis on what is being said
 * - `jitter`  a fast nervous roll back and forth
 */
export type IdleGestureKind =
  | "twirl"
  | "roll"
  | "tap"
  | "bob"
  | "wander"
  | "sway"
  | "lean"
  | "loop"
  | "jab"
  | "jitter";

export const IDLE_GESTURE_KINDS: readonly IdleGestureKind[] = [
  "twirl",
  "roll",
  "tap",
  "bob",
  "wander",
  "sway",
  "lean",
  "loop",
  "jab",
  "jitter",
];

export const IDLE_GESTURE_MS: Record<IdleGestureKind, number> = {
  twirl: 1400,
  roll: 620,
  tap: 900,
  bob: 700,
  wander: 1700,
  sway: 1150,
  lean: 1500,
  loop: 1500,
  jab: 520,
  jitter: 640,
};

/**
 * How often each gesture comes up. The twirl is deliberately the rarest thing
 * in the set: it is the largest read on the board, and showing it constantly is
 * exactly the failure this module exists to fix.
 */
export const IDLE_GESTURE_WEIGHT: Record<IdleGestureKind, number> = {
  twirl: 0.6,
  roll: 1.6,
  tap: 1.5,
  bob: 1.3,
  wander: 1.2,
  sway: 1.2,
  lean: 0.9,
  loop: 1,
  jab: 1.1,
  jitter: 1,
};

/** Deterministic 0..1 from an integer, so a pause replays identically. */
function fract01(seed: number): number {
  const x = Math.sin(seed * 91.7891 + 24.1263) * 51321.7443;
  return x - Math.floor(x);
}

/** Zero value and zero slope at both ends — a gesture that cannot pop. */
function bell(t: number): number {
  const s = Math.sin(Math.PI * clamp01(t));
  return s * s;
}

/** `count` bells back to back, each starting and ending at rest. */
function pulseTrain(t: number, count: number): number {
  const scaled = clamp01(t) * count;
  return bell(scaled % 1);
}

/** Rise, hold, fall — for a gesture that goes somewhere and stays a moment. */
function holdEnvelope(t: number, riseFraction: number, fallFraction: number): number {
  const u = clamp01(t);
  if (u < riseFraction) return smootherstep(u / riseFraction);
  if (u > 1 - fallFraction) return smootherstep((1 - u) / fallFraction);
  return 1;
}

/**
 * Squash a value into a band without a corner at the boundary. A hard clamp
 * would put a kink in the velocity exactly where the biggest gestures live.
 */
function softCap(value: number, cap: number): number {
  if (cap <= 0) return 0;
  return cap * Math.tanh(value / cap);
}

/** The mood of one pause: how big the gestures are and how close together. */
export interface IdleMood {
  /** Amplitude scale, around 1. */
  energy: number;
  /** >1 shortens the rests, <1 stretches them. */
  restless: number;
}

export function idleMood(seed: number): IdleMood {
  return {
    energy: 0.82 + 0.36 * fract01(seed * 37 + 9),
    restless: 0.72 + 0.7 * fract01(seed * 53 + 17),
  };
}

export interface IdleGesture {
  kind: IdleGestureKind;
  /** Milliseconds since the hand took the instrument. */
  startMs: number;
  durationMs: number;
  index: number;
}

/**
 * Pick a gesture, excluding whatever the last two were.
 *
 * Excluding two is what stops the eye finding a pattern: with ten kinds and a
 * weighted draw, "not the same as last time" still lets tap/roll/tap/roll
 * happen, and two of those in a row is a tic.
 */
function pickKind(
  index: number,
  seed: number,
  previous: IdleGestureKind | null,
  twoBack: IdleGestureKind | null,
): IdleGestureKind {
  const allowed = IDLE_GESTURE_KINDS.filter((kind) => kind !== previous && kind !== twoBack);
  const total = allowed.reduce((sum, kind) => sum + IDLE_GESTURE_WEIGHT[kind], 0);
  let roll = fract01(index * 7 + 3 + seed * 101) * total;
  for (const kind of allowed) {
    roll -= IDLE_GESTURE_WEIGHT[kind];
    if (roll <= 0) return kind;
  }
  return allowed[allowed.length - 1]!;
}

/** Rest after the gesture that ended at `startMs` + its duration. */
function gapAfter(index: number, endedAtMs: number, seed: number, mood: IdleMood): number {
  const stretch =
    1 + IDLE_CALM_GAP_GAIN * smoothstep((endedAtMs - IDLE_CALM_AFTER_MS) / IDLE_CALM_RAMP_MS);
  const drawn = IDLE_GAP_MIN_MS + IDLE_GAP_SPREAD_MS * fract01(index * 13 + 5 + seed * 197);
  return (drawn * stretch) / Math.max(mood.restless, 0.1);
}

const MAX_GESTURES = 512;

/** The performance for one pause, as a list — the shape verify asserts on. */
export function idleGestureSequence(count: number, seed = 0): IdleGesture[] {
  const mood = idleMood(seed);
  const gestures: IdleGesture[] = [];
  let startMs = IDLE_FIRST_GESTURE_MS;
  for (let index = 0; index < Math.min(count, MAX_GESTURES); index++) {
    const kind = pickKind(
      index,
      seed,
      gestures[index - 1]?.kind ?? null,
      gestures[index - 2]?.kind ?? null,
    );
    const durationMs = IDLE_GESTURE_MS[kind];
    gestures.push({ kind, startMs, durationMs, index });
    startMs += durationMs + gapAfter(index, startMs + durationMs, seed, mood);
  }
  return gestures;
}

/** The gesture covering `sinceMs`, if the hand is between gestures. */
export function idleGestureAt(
  sinceMs: number,
  seed = 0,
): { gesture: IdleGesture; t: number } | null {
  if (!(sinceMs > IDLE_FIRST_GESTURE_MS)) return null;
  const mood = idleMood(seed);
  let startMs = IDLE_FIRST_GESTURE_MS;
  let previous: IdleGestureKind | null = null;
  let twoBack: IdleGestureKind | null = null;
  for (let index = 0; index < MAX_GESTURES; index++) {
    const kind = pickKind(index, seed, previous, twoBack);
    const durationMs = IDLE_GESTURE_MS[kind];
    if (sinceMs < startMs) return null;
    if (sinceMs < startMs + durationMs) {
      return {
        gesture: { kind, startMs, durationMs, index },
        t: (sinceMs - startMs) / durationMs,
      };
    }
    startMs += durationMs + gapAfter(index, startMs + durationMs, seed, mood);
    twoBack = previous;
    previous = kind;
  }
  return null;
}

/** One gesture's departure from rest, before mood and calm are applied. */
interface GestureFrame {
  dx: number;
  dy: number;
  tiltOffset: number;
  spin: number;
  lift: number;
  scaleUp: number;
  /**
   * True when the spin term is a whole turn. A turn is the one thing mood may
   * not scale: 0.8 of a turn does not end where it began, so a low-energy pause
   * would leave the barrel at 290° and snap it back the frame the gesture ends.
   * Mood shows up in such a gesture's lift and drift instead.
   */
  fullTurn?: boolean;
}

const REST_FRAME: GestureFrame = { dx: 0, dy: 0, tiltOffset: 0, spin: 0, lift: 0, scaleUp: 0 };

/**
 * Where one gesture has the instrument at `t` in [0, 1].
 *
 * `swing` is ±1 so a gesture reads left-handed or right-handed, `hover` is how
 * far off the board the resting hand is holding the nib — the gestures that
 * touch the board have to cancel it to make contact.
 */
function gestureFrame(
  kind: IdleGestureKind,
  t: number,
  swing: number,
  hover: number,
  roll1: number,
  roll2: number,
): GestureFrame {
  const u = clamp01(t);

  if (kind === "twirl") {
    // Smootherstep: the flick accelerates the barrel, it coasts, and it comes
    // to rest a full turn later. Zero rate at both ends, so the turn cannot
    // start or stop abruptly.
    const shape = bell(u);
    return {
      dx: 0,
      dy: -1.6 * shape,
      tiltOffset: 0,
      spin: 360 * smootherstep(u),
      lift: IDLE_TWIRL_LIFT_PX * shape,
      scaleUp: 0.075 * shape,
      fullTurn: true,
    };
  }

  if (kind === "roll") {
    const shape = bell(u);
    return {
      dx: swing * 1.8 * shape,
      dy: -1.2 * shape,
      tiltOffset: 0,
      spin: swing * (24 + 14 * roll1) * shape,
      lift: 3.4 * shape,
      scaleUp: 0.018 * shape,
    };
  }

  if (kind === "tap") {
    // Later taps land a little softer, the way a real triplet does.
    const pulse = pulseTrain(u, 3) * (1 - 0.16 * Math.min(Math.floor(u * 3), 2));
    return {
      dx: swing * 0.6 * pulse,
      dy: 0.9 * pulse,
      tiltOffset: swing * 1.2 * pulse,
      spin: 0,
      // Cancels the hover with room to spare, so the nib really does touch.
      lift: -(hover * 1.4 + 1.2) * pulse,
      scaleUp: 0.02 * pulse,
    };
  }

  if (kind === "bob") {
    const pulse = pulseTrain(u, 2);
    return {
      dx: swing * 0.8 * pulse,
      dy: -4.2 * pulse,
      tiltOffset: swing * 1.8 * pulse,
      spin: 0,
      lift: 2.4 * pulse,
      scaleUp: 0.02 * pulse,
    };
  }

  if (kind === "wander") {
    // Skewed so the hand drifts out a little quicker than it comes back.
    const shape = bell(Math.pow(u, 1.2));
    return {
      dx: swing * (8 + 5 * roll1) * shape,
      dy: (roll2 - 0.5) * 7 * shape,
      tiltOffset: swing * 3.2 * shape,
      spin: 0,
      lift: 3.2 * shape,
      scaleUp: 0.015 * shape,
    };
  }

  if (kind === "sway") {
    const env = bell(u);
    const swingPhase = Math.sin(2 * Math.PI * 2 * u);
    return {
      dx: -swing * 2.4 * swingPhase * env,
      dy: 0,
      tiltOffset: swing * 6.5 * swingPhase * env,
      spin: 0,
      lift: 1.8 * env,
      scaleUp: 0,
    };
  }

  if (kind === "lean") {
    const env = holdEnvelope(u, 0.28, 0.34);
    return {
      dx: swing * 1.5 * env,
      dy: -3.6 * env,
      // Negative lays the barrel further back — standing off to look at it.
      tiltOffset: -5.5 * env,
      spin: 0,
      lift: 11 * env,
      scaleUp: 0.05 * env,
    };
  }

  if (kind === "loop") {
    const env = holdEnvelope(u, 0.22, 0.26);
    const phase = 2 * Math.PI * u;
    return {
      dx: swing * 6.5 * Math.sin(phase) * env,
      dy: 3.6 * Math.sin(2 * phase) * env,
      tiltOffset: swing * 2.6 * Math.cos(phase) * env,
      spin: 0,
      lift: 4.2 * env,
      scaleUp: 0,
    };
  }

  if (kind === "jab") {
    const pulse = pulseTrain(u, 2);
    return {
      dx: swing * 1.2 * pulse,
      dy: 2.6 * pulse,
      // Tips forward into the board rather than straight down: emphasis.
      tiltOffset: -3.4 * pulse,
      spin: 0,
      lift: -(hover * 1.4 + 0.9) * pulse,
      scaleUp: 0.015 * pulse,
    };
  }

  if (kind === "jitter") {
    const env = bell(u);
    const shake = Math.sin(2 * Math.PI * 2 * u);
    return {
      dx: swing * 1.1 * shake * env,
      dy: 0,
      tiltOffset: 0,
      spin: swing * 15 * shake * env,
      lift: 2.2 * env,
      scaleUp: 0.01 * env,
    };
  }

  return REST_FRAME;
}

export interface IdlePose {
  /** Which gesture is running, or null while the hand is only breathing. */
  gesture: IdleGestureKind | null;
  dx: number;
  dy: number;
  tiltOffset: number;
  spin: number;
  lift: number;
  scale: number;
  /**
   * Angular rate as a fraction of a twirl's mean rate, for the motion smear.
   * Differentiated from the spin term itself rather than hand-written per
   * gesture, so a smear can never disagree with the motion it is smearing.
   */
  spinVelocity: number;
}

/** The resting hand: the drift and hover that run whether or not a gesture is. */
export interface IdleBreath {
  dx: number;
  dy: number;
  tiltOffset: number;
  /** How far off the board the resting nib is held. */
  hover: number;
}

/**
 * Breathing. The periods run from about 2.6 to 15 seconds and none divides
 * another, so the drift never returns to where it was and never reads as a
 * loop — which is what gives an idle animation away. This runs under every
 * gesture and through every rest between them: the pen is never frozen.
 */
export function idleBreath(heldMs: number): IdleBreath {
  const held = Math.max(heldMs, 0);
  const ramp = smoothstep(held / IDLE_RAMP_MS);
  const seconds = held / 1000;
  return {
    dx:
      ramp *
      (2.2 * Math.sin(seconds * 0.62) +
        Math.sin(seconds * 1.13 + 2.1) +
        0.5 * Math.sin(seconds * 2.41 + 0.9)),
    dy:
      ramp *
      (1.5 * Math.sin(seconds * 0.51 + 0.7) +
        0.6 * Math.sin(seconds * 0.97 + 1.4) +
        0.35 * Math.sin(seconds * 1.87 + 2.6)),
    tiltOffset: ramp * 2 * Math.sin(seconds * 0.41 + 0.4),
    hover: IDLE_HOVER_PX * smoothstep(held / IDLE_HOVER_MS),
  };
}

/**
 * How big a gesture starting at `startMs` into the pause is allowed to be.
 * An unhurried hand fidgets less, not more, so this decays once the pause has
 * gone on long enough that the hand has settled into it.
 */
export function idleCalm(startMs: number): number {
  return (
    1 - IDLE_CALM_AMPLITUDE_DROP * smoothstep((startMs - IDLE_CALM_AFTER_MS) / IDLE_CALM_RAMP_MS)
  );
}

function poseAt(heldMs: number, seed: number): Omit<IdlePose, "spinVelocity"> {
  const held = Math.max(heldMs, 0);
  const ramp = smoothstep(held / IDLE_RAMP_MS);
  const breath = idleBreath(held);
  const hover = breath.hover;
  const mood = idleMood(seed);

  let dx = breath.dx;
  let dy = breath.dy;
  let tiltOffset = breath.tiltOffset;
  let spin = 0;
  let lift = hover;
  let scaleUp = 0;
  let gesture: IdleGestureKind | null = null;

  const current = idleGestureAt(held, seed);
  if (current) {
    const { kind, index, startMs } = current.gesture;
    const amplitude = ramp * idleCalm(startMs) * mood.energy;
    const swing = fract01(index * 29 + 11 + seed * 271) < 0.5 ? -1 : 1;
    const frame = gestureFrame(
      kind,
      current.t,
      swing,
      hover,
      fract01(index * 17 + 2 + seed * 313),
      fract01(index * 23 + 7 + seed * 419),
    );
    gesture = kind;
    dx += amplitude * frame.dx;
    dy += amplitude * frame.dy;
    tiltOffset += amplitude * frame.tiltOffset;
    spin += (frame.fullTurn ? 1 : amplitude) * frame.spin;
    lift += amplitude * frame.lift;
    scaleUp += amplitude * frame.scaleUp;
  }

  // The pen fidgets where it stands. Softly capped rather than clamped, so the
  // biggest gestures compress instead of hitting a wall mid-motion.
  const travel = Math.hypot(dx, dy);
  if (travel > 0) {
    const scaled = softCap(travel, IDLE_TRAVEL_MAX_PX) / travel;
    dx *= scaled;
    dy *= scaled;
  }

  return {
    gesture,
    dx,
    dy,
    tiltOffset,
    spin,
    lift: lift > 0 ? softCap(lift, IDLE_LIFT_MAX_PX) : 0,
    scale: 1 + scaleUp,
  };
}

/** Mean rate of a twirl, in degrees per ms — the unit the smear is scaled in. */
const SPIN_MEAN_DEG_PER_MS = 360 / SPIN_PERIOD_MS;
const VELOCITY_PROBE_MS = 1;

/**
 * The whole idle hand at `heldMs` into one pause. `seed` should change with
 * every pause, so a lesson never plays the same performance twice.
 */
export function idlePose(heldMs: number, seed = 0): IdlePose {
  const pose = poseAt(heldMs, seed);
  const ahead = poseAt(heldMs + VELOCITY_PROBE_MS, seed);
  // Shortest delta, so the frame where a twirl closes on 360° — the same pose
  // it opened from — reads as the end of a turn and not as a 360°/ms flick.
  const rate = Math.abs(shortestAngleDelta(pose.spin, ahead.spin)) / VELOCITY_PROBE_MS;
  return {
    ...pose,
    spinVelocity: Math.min(rate / SPIN_MEAN_DEG_PER_MS, 1 + SPIN_SWING),
  };
}

/** The turn the barrel is nearest to having finished. */
function nearestTurn(spin: number): number {
  return Math.round(spin / 360) * 360;
}

/**
 * Put the instrument back down.
 *
 * Work arrives mid-gesture — that is the normal case, since the pen is only
 * idle until the next command lands — and snapping out of a gesture is a
 * visible twitch on the frame the lesson resumes. `k` runs 1 to 0 over
 * `IDLE_RELEASE_MS`: the offsets fall away, and the barrel eases on to the
 * nearest whole turn rather than unwinding backwards out of a twirl.
 */
export function releaseIdlePose(pose: IdlePose, k: number): IdlePose {
  const f = clamp01(k);
  const turn = nearestTurn(pose.spin);
  return {
    gesture: pose.gesture,
    dx: pose.dx * f,
    dy: pose.dy * f,
    tiltOffset: pose.tiltOffset * f,
    spin: pose.spin + (turn - pose.spin) * (1 - f),
    lift: pose.lift * f,
    scale: 1 + (pose.scale - 1) * f,
    spinVelocity: pose.spinVelocity * f,
  };
}
