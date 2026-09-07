/**
 * Pen choreography — the human motion that rides on top of the ink.
 *
 * `penMotion` decides *when* ink appears. This decides how the instrument is
 * held while it happens: how the barrel leans into a stroke, how the hand
 * trembles, how a pen is twirled away so a pencil can take its place, and what
 * the hand fidgets with while the tutor is thinking.
 *
 * Everything here is pure so `verify-pen-choreography` can assert the motion
 * without a canvas.
 */

import { clamp01 } from "./penMotion";
import type { PenActivity } from "./instruments";

const DEG = Math.PI / 180;

/**
 * Resting barrel tilt per activity (degrees, Konva clockwise-positive).
 * Negative lays the barrel back over the already-written ink and keeps the
 * board ahead of the nib clear. A pencil sits more upright than a pen because
 * construction lines are drawn from the wrist, not the fingers.
 */
export const RESTING_TILT: Record<PenActivity, number> = {
  write: -33,
  draw: -25,
  // A pencil laying in a construction line stands more upright than a pen
  // writing a word, because the stroke comes from the wrist and the lead has
  // to be kept off its own flank.
  sketch: -20,
  annotate: -38,
  highlight: -47,
  erase: 0,
  idle: -29,
};

/** Default lean away from rest as the stroke changes heading. */
export const LEAN_GAIN_DEGREES = 8;
/**
 * Lean per activity. Handwriting reverses direction every few pixels, so it
 * gets a gentler roll than a long construction line drawn from the wrist.
 */
export const LEAN_GAIN: Record<PenActivity, number> = {
  write: 5,
  draw: 8,
  sketch: 9,
  annotate: 6,
  highlight: 4,
  erase: 0,
  idle: 5,
};
/** Time constant for the wrist catching up to a new tilt. */
export const TILT_TIME_CONSTANT_MS = 140;
/** The wrist cannot whip: cap on how fast the barrel may roll. */
export const TILT_MAX_DEG_PER_SEC = 110;
/**
 * Heading is smoothed over distance travelled, not frames, so a slow careful
 * stroke and a fast one turn the barrel the same way per pixel.
 */
export const HEADING_SMOOTH_PX = 7;
/** Travel below this is noise — keep the previous heading instead of spinning. */
export const HEADING_MIN_TRAVEL = 0.45;
/**
 * After the pen has waited on the voice, the first frame back must not swallow
 * the whole pause as one giant catch-up step.
 */
export const MAX_FRAME_DT_MS = 50;
/** Short lifted hop to the next glyph instead of a teleport. */
export const HOP_MIN_PX = 10;
export const HOP_MIN_MS = 32;
export const HOP_MAX_MS = 64;
export const HOP_LIFT_PX = 3.5;
/** Air travel between strokes inside one glyph moves faster than ink. */
export const AIR_TRAVEL_WEIGHT = 0.55;
export const AIR_MIN_GAP_PX = 2.5;
export const AIR_LIFT_PX = 2.5;

export const SWAP_DURATION_MS = 340;
export const SWAP_HURRY_MS = 120;
export const SWAP_LIFT_PX = 15;
export const FLOURISH_LIFT_PX = 9;
export const FLIGHT_LIFT_PX = 7;

export function restingTilt(activity: PenActivity): number {
  return RESTING_TILT[activity];
}

export function toDegrees(radians: number): number {
  return radians / DEG;
}

/** Screen-space heading of a step, in degrees (0 = right, +90 = down). */
export function headingDegrees(dx: number, dy: number): number {
  return toDegrees(Math.atan2(dy, dx));
}

/** Signed shortest way round from one angle to another, in (-180, 180]. */
export function shortestAngleDelta(from: number, to: number): number {
  const wrapped = ((to - from + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + shortestAngleDelta(from, to) * clamp01(t);
}

/**
 * A hand rolls the barrel a little as the stroke turns: pulling down stands the
 * pen up, pushing up lays it back. Bounded to `rest ± gain` so it never flips.
 */
export function tiltForHeading(
  headingDeg: number,
  rest: number,
  gain = LEAN_GAIN_DEGREES,
): number {
  return rest + gain * Math.sin(headingDeg * DEG);
}

/**
 * Frame-rate independent approach: the same wall-clock elapsed time lands in
 * the same place whether it arrived as one frame or four.
 */
export function followAngle(
  current: number,
  target: number,
  dtMs: number,
  timeConstantMs = TILT_TIME_CONSTANT_MS,
): number {
  if (!(dtMs > 0)) return current;
  const k = 1 - Math.exp(-dtMs / Math.max(timeConstantMs, 1));
  return current + shortestAngleDelta(current, target) * k;
}

/**
 * Micro tremor — two slow incommensurate sines so it never reads as a loop.
 * Periods of ~1.6 s and ~3.8 s: the hand breathes, it does not buzz.
 */
export const TREMOR_DEGREES = 0.2;
export function tremor(timeMs: number, amplitude = TREMOR_DEGREES): number {
  return amplitude * (Math.sin(timeMs / 260) * 0.6 + Math.sin(timeMs / 610) * 0.4);
}

/**
 * Exponential approach with a rate cap. The exponential gives the wrist its
 * lag; the cap stops a large target change from reading as a flick.
 */
export function slewToward(
  current: number,
  target: number,
  dtMs: number,
  timeConstantMs = TILT_TIME_CONSTANT_MS,
  maxDegPerSec = TILT_MAX_DEG_PER_SEC,
): number {
  if (!(dtMs > 0)) return current;
  const delta = shortestAngleDelta(current, target);
  const k = 1 - Math.exp(-dtMs / Math.max(timeConstantMs, 1));
  const cap = (maxDegPerSec * dtMs) / 1000;
  return current + Math.max(-cap, Math.min(cap, delta * k));
}

/**
 * The nib on the board: where it is, which way it has been travelling, and
 * how the barrel is currently held. Pure and clock-injected so the motion can
 * be replayed frame by frame in verification.
 */
export class NibTracker {
  x: number;
  y: number;
  /** Smoothed unit travel direction. */
  dirX = 1;
  dirY = 0;
  tilt: number;
  lastMs = 0;

  constructor(x: number, y: number, tilt: number) {
    this.x = x;
    this.y = y;
    this.tilt = tilt;
  }

  heading(): number {
    return headingDegrees(this.dirX, this.dirY);
  }

  private advance(activity: PenActivity, nowMs: number): number {
    const dtMs = this.lastMs > 0 ? Math.min(Math.max(nowMs - this.lastMs, 1), MAX_FRAME_DT_MS) : 16;
    const target = tiltForHeading(this.heading(), restingTilt(activity), LEAN_GAIN[activity]);
    this.tilt = slewToward(this.tilt, target, dtMs);
    this.lastMs = nowMs;
    return this.tilt;
  }

  /** Trace: the nib is on the ink, so its travel steers the barrel. */
  move(x: number, y: number, activity: PenActivity, nowMs: number): number {
    const dx = x - this.x;
    const dy = y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= HEADING_MIN_TRAVEL) {
      const blend = 1 - Math.exp(-dist / HEADING_SMOOTH_PX);
      const nx = this.dirX * (1 - blend) + (dx / dist) * blend;
      const ny = this.dirY * (1 - blend) + (dy / dist) * blend;
      const mag = Math.hypot(nx, ny);
      if (mag < 0.05) {
        // A full reversal passed through zero: take the new direction outright.
        this.dirX = dx / dist;
        this.dirY = dy / dist;
      } else {
        this.dirX = nx / mag;
        this.dirY = ny / mag;
      }
    }
    this.x = x;
    this.y = y;
    return this.advance(activity, nowMs);
  }

  /** Reposition without inventing a heading — a hop, not a stroke. */
  jump(x: number, y: number, activity: PenActivity, nowMs: number): number {
    this.x = x;
    this.y = y;
    return this.advance(activity, nowMs);
  }

  /** Land at an exact pose — the end of a flight or a sweep. */
  settle(x: number, y: number, tilt: number, nowMs: number): void {
    this.x = x;
    this.y = y;
    this.tilt = tilt;
    this.lastMs = nowMs;
  }
}

export interface GlyphStroke {
  length: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export interface GlyphSegment {
  kind: "ink" | "air";
  /** Ink: the stroke being drawn. Air: the stroke the pen is travelling to. */
  stroke: number;
  length: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * Interleave the strokes of one glyph with the air between them, so the dot
 * of an i and the bar of a t are reached by a lifted pen rather than a jump.
 * Air is weighted lighter than ink so it borrows little from the glyph's time.
 */
export function planGlyphSegments(strokes: readonly GlyphStroke[]): GlyphSegment[] {
  const segments: GlyphSegment[] = [];
  strokes.forEach((stroke, index) => {
    if (index > 0) {
      const previous = strokes[index - 1]!;
      const gap = Math.hypot(stroke.start.x - previous.end.x, stroke.start.y - previous.end.y);
      if (gap >= AIR_MIN_GAP_PX) {
        segments.push({
          kind: "air",
          stroke: index,
          length: gap * AIR_TRAVEL_WEIGHT,
          from: previous.end,
          to: stroke.start,
        });
      }
    }
    segments.push({
      kind: "ink",
      stroke: index,
      length: Math.max(stroke.length, 1),
      from: stroke.start,
      to: stroke.end,
    });
  });
  return segments;
}

/** Duration of the hop from one glyph to the next; 0 means just place the nib. */
export function hopDurationMs(distancePx: number): number {
  if (!(distancePx >= HOP_MIN_PX)) return 0;
  return Math.min(Math.max(distancePx * 0.9, HOP_MIN_MS), HOP_MAX_MS);
}

export function easeInOutCubic(progress: number): number {
  const t = clamp01(progress);
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

export function smoothstep(progress: number): number {
  const t = clamp01(progress);
  return t * t * (3 - 2 * t);
}

/**
 * Zero velocity *and* zero acceleration at both ends (peak slope 1.875 against
 * smoothstep's 2.5 and easeInOutCubic's 3). Used where a full turn has to read
 * as an unhurried roll rather than a flick.
 */
export function smootherstep(progress: number): number {
  const t = clamp01(progress);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export interface InstrumentPose {
  /** Rotation about the barrel mid-point — the twirl between the fingers. */
  spin: number;
  /** Distance the instrument is pulled back along its own axis, in px. */
  lift: number;
  scale: number;
  opacity: number;
  /** Once true, the incoming instrument is the one being rendered. */
  showIncoming: boolean;
}

/**
 * One full flip between the fingers: the instrument rises off the board,
 * spins, blanks out at the top of the arc, and the next one lands in its place.
 */
export function instrumentSwapPose(progress: number): InstrumentPose {
  const t = clamp01(progress);
  const arc = Math.sin(Math.PI * t);
  const opacity =
    t < 0.5
      ? 1 - smoothstep((t - 0.3) / 0.2)
      : smoothstep((t - 0.5) / 0.2);
  return {
    spin: 360 * easeInOutCubic(t),
    lift: SWAP_LIFT_PX * arc,
    scale: 1 + 0.18 * arc,
    opacity,
    showIncoming: t >= 0.5,
  };
}

/** A flourish with no swap — the pen spins in place and comes back down. */
export function flourishPose(progress: number, turns = 1): InstrumentPose {
  const t = clamp01(progress);
  const arc = Math.sin(Math.PI * t);
  return {
    spin: 360 * turns * easeInOutCubic(t),
    lift: FLOURISH_LIFT_PX * arc,
    scale: 1 + 0.1 * arc,
    opacity: 1,
    showIncoming: false,
  };
}

export interface ThinkingPose {
  dx: number;
  dy: number;
  spin: number;
  tiltOffset: number;
  lift: number;
  scale: number;
}

export const TAP_PERIOD_MS = 2400;
const TAP_FRACTION = 0.16;
const TAP_RISE_PX = 6.5;

/**
 * The hand while the tutor is thinking: a slow hover drift, a lazy roll of the
 * barrel, and a pen tap against the board every couple of seconds.
 */
export function thinkingPose(elapsedMs: number): ThinkingPose {
  const seconds = elapsedMs / 1000;
  const beat = ((elapsedMs % TAP_PERIOD_MS) + TAP_PERIOD_MS) % TAP_PERIOD_MS / TAP_PERIOD_MS;
  const tap = beat < TAP_FRACTION ? Math.sin((beat / TAP_FRACTION) * Math.PI) : 0;
  return {
    dx: 5.5 * Math.sin(seconds * 1.35) + 2.1 * Math.sin(seconds * 0.61 + 1.1),
    dy: 3.2 * Math.sin(seconds * 2.05 + 0.4) - tap * TAP_RISE_PX,
    spin: 6.5 * Math.sin(seconds * 0.83),
    tiltOffset: 3.4 * Math.sin(seconds * 1.15 + 0.6),
    lift: tap * TAP_RISE_PX * 0.55,
    scale: 1 + tap * 0.045,
  };
}

/**
 * The pen parked mid-sentence, waiting for the narration to reach the moment
 * this character is spoken.
 *
 * This is what the board shows for most of a lesson, because writing is gated
 * on the voice character by character, so it has to read as a person holding a
 * pause rather than a widget playing an animation.
 *
 * Short gaps stay perfectly still — a jiggle between two letters of the same
 * word reads as a glitch. Past the grace period the nib eases off the board and
 * the hand breathes. Longer holds pick up the small things a hand does when it
 * is waiting to write: a re-grip, a tap against the board, a drift and back.
 * They are spaced irregularly on purpose; a gesture on a fixed period is the
 * one thing that gives a loop away. This is free motion: the pen is doing
 * nothing during these frames by definition, so none of it costs the audio
 * budget.
 */
export const WAIT_GRACE_MS = 170;
export const WAIT_RAMP_MS = 320;
/** How far the nib relaxes off the board once the pause is real. */
export const WAIT_HOVER_PX = 1.5;
export const WAIT_HOVER_MS = 850;
/** Nothing happens before this: a pause has to become a pause first. */
export const WAIT_FIRST_GESTURE_MS = 2200;
/** Gap between gestures — a floor plus a per-gesture spread, never a period. */
export const WAIT_GESTURE_GAP_MIN_MS = 2500;
export const WAIT_GESTURE_GAP_SPREAD_MS = 4300;
/** Past this the hand has settled, so the gestures get smaller and rarer. */
export const WAIT_CALM_AFTER_MS = 14000;
export const WAIT_CALM_RAMP_MS = 9000;
/** The hand comes back to the board over this long before the next character. */
export const WAIT_SETTLE_MS = 220;

/** Deterministic 0..1 from an integer, so a pause replays identically. */
function fract01(seed: number): number {
  const x = Math.sin(seed * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Zero value and zero slope at both ends — a gesture that cannot pop. */
function bell(t: number): number {
  const s = Math.sin(Math.PI * clamp01(t));
  return s * s;
}

export type WaitGestureKind = "regrip" | "tap" | "drift";

export interface WaitGesture {
  kind: WaitGestureKind;
  /** Milliseconds after the grace period. */
  startMs: number;
  durationMs: number;
  index: number;
}

const GESTURE_MS: Record<WaitGestureKind, number> = {
  regrip: 780,
  tap: 360,
  drift: 1500,
};

function gestureKind(index: number): WaitGestureKind {
  const roll = fract01(index * 7 + 3);
  if (roll < 0.42) return "regrip";
  if (roll < 0.72) return "tap";
  return "drift";
}

/**
 * The gesture covering `sinceMs`, if any. Gaps are drawn per gesture and grow
 * once the hand has settled, so nothing here repeats on a period.
 */
export function waitGestureAt(sinceMs: number): { gesture: WaitGesture; t: number } | null {
  if (!(sinceMs > WAIT_FIRST_GESTURE_MS)) return null;
  let startMs = WAIT_FIRST_GESTURE_MS;
  for (let index = 0; index < 512; index++) {
    const kind = gestureKind(index);
    const durationMs = GESTURE_MS[kind];
    if (sinceMs < startMs) return null;
    if (sinceMs < startMs + durationMs) {
      return {
        gesture: { kind, startMs, durationMs, index },
        t: (sinceMs - startMs) / durationMs,
      };
    }
    // Gaps stretch as the wait goes on: an unhurried hand fidgets less, not more.
    const stretch = 1 + 0.9 * smoothstep((startMs - WAIT_CALM_AFTER_MS) / WAIT_CALM_RAMP_MS);
    startMs +=
      durationMs +
      (WAIT_GESTURE_GAP_MIN_MS + WAIT_GESTURE_GAP_SPREAD_MS * fract01(index * 13 + 5)) * stretch;
  }
  return null;
}

export interface WaitingPose {
  /** False while the pen should hold perfectly still. */
  active: boolean;
  dx: number;
  dy: number;
  tiltOffset: number;
  spin: number;
  lift: number;
  scale: number;
}

const STILL: WaitingPose = {
  active: false,
  dx: 0,
  dy: 0,
  tiltOffset: 0,
  spin: 0,
  lift: 0,
  scale: 1,
};

export function waitingPose(waitedMs: number): WaitingPose {
  if (!(waitedMs > WAIT_GRACE_MS)) return STILL;

  const since = waitedMs - WAIT_GRACE_MS;
  // Ramp from exactly zero so the pen eases out of stillness, never pops.
  const ramp = smoothstep(since / WAIT_RAMP_MS);
  const seconds = since / 1000;

  // Breathing. The periods run from about 5 to 14 seconds and none divides
  // another, so the drift never returns to where it was and never reads as a
  // loop — which is what gives an idle animation away.
  let dx = ramp * (1.15 * Math.sin(seconds * 0.62) + 0.5 * Math.sin(seconds * 1.13 + 2.1));
  let dy = ramp * (0.8 * Math.sin(seconds * 0.51 + 0.7) + 0.35 * Math.sin(seconds * 0.97 + 1.4));
  let tiltOffset = ramp * 1.6 * Math.sin(seconds * 0.44 + 0.4);
  let spin = 0;
  let lift = WAIT_HOVER_PX * smoothstep(since / WAIT_HOVER_MS);
  let scale = 1;

  const gesture = waitGestureAt(since);
  if (gesture) {
    const { kind, index } = gesture.gesture;
    // Smaller once the hand has settled into the wait.
    const calm =
      1 - 0.4 * smoothstep((gesture.gesture.startMs - WAIT_CALM_AFTER_MS) / WAIT_CALM_RAMP_MS);
    const swing = fract01(index * 29 + 11) < 0.5 ? -1 : 1;
    const shape = bell(gesture.t);

    if (kind === "regrip") {
      // The barrel rolled a little between the fingers and back: a hand
      // adjusting its hold. The pen used to turn a full 360° every four
      // seconds here, which is a fidget spinner, not a teacher mid-sentence.
      spin += calm * swing * (20 + 14 * fract01(index * 17 + 2)) * shape;
      lift += calm * 4.2 * shape;
      dx += calm * swing * 2.1 * shape;
      dy += calm * -1.5 * shape;
      scale = 1 + calm * 0.02 * shape;
    } else if (kind === "tap") {
      // The pen taken off the board and set back down on it. The exponent puts
      // the peak late, so the lift is unhurried and the contact is quick — a
      // tap, rather than a flinch away from the board and a slow return.
      const tap = bell(Math.pow(clamp01(gesture.t), 1.45));
      lift += calm * 4.2 * tap;
      dy += calm * -1.1 * tap;
      tiltOffset += calm * swing * 1.4 * tap;
      scale = 1 + calm * 0.03 * tap;
    } else {
      dx += calm * swing * 3.4 * shape;
      dy += calm * (fract01(index * 23 + 7) - 0.5) * 3.2 * shape;
      tiltOffset += calm * swing * 2.2 * shape;
      lift += calm * 1.6 * shape;
    }
  }

  return { active: true, dx, dy, tiltOffset, spin, lift, scale };
}

/**
 * Fade a waiting pose back to rest.
 *
 * The wait ends the instant the voice reaches the next character, and the pen
 * has to be back on the board by then — snapping it there from mid-drift is a
 * visible twitch on every character. The board knows how much of the wait is
 * left, so the hand starts coming back before it is needed, the way a person
 * does. `settle` is 1 while the wait is open and eases to 0 on approach.
 */
export function settleWaitingPose(pose: WaitingPose, settle: number): WaitingPose {
  const k = clamp01(settle);
  if (k >= 1) return pose;
  return {
    active: pose.active,
    dx: pose.dx * k,
    dy: pose.dy * k,
    tiltOffset: pose.tiltOffset * k,
    spin: pose.spin * k,
    lift: pose.lift * k,
    scale: 1 + (pose.scale - 1) * k,
  };
}

/** One full twirl of the pen while the tutor waits on a response. */
export const SPIN_PERIOD_MS = 1400;
/** The wrist takes a beat to bring the twirl up to speed. */
export const SPIN_RAMP_MS = 220;
export const SPIN_LIFT_PX = 6;
const SPIN_RISE_MS = 320;
/**
 * Beats per revolution. A finger twirl is not a motor: the barrel is flicked,
 * coasts, and is flicked again. One beat per turn, not two — with two, each
 * coast is only half a revolution long and the eye reads the whole thing as a
 * steady spin with a wobble. One gives a single unmistakable slow arc and a
 * single whip round.
 */
export const SPIN_BEATS = 1;
/**
 * How far the rate swings either side of the mean, as a fraction of it. The
 * angle stays monotonic for any value below 1, so 0.9 nearly stalls the coast
 * (0.1x mean) and nearly doubles the flick (1.9x) while never reversing and
 * never actually stopping.
 */
export const SPIN_SWING = 0.9;
/**
 * Degrees of cadence wobble. Derived so the swing above comes out exactly:
 * differentiating `SPIN_CADENCE_DEG · sin(beats · 2π · t / T)` gives a peak
 * rate deviation of `SPIN_CADENCE_DEG · beats · 2π / T`, and the mean rate is
 * `360 / T`, so their ratio is the swing regardless of the period.
 */
export const SPIN_CADENCE_DEG = (SPIN_SWING * 360) / (SPIN_BEATS * 2 * Math.PI);

export interface SpinningPose {
  /** Rotation about the barrel mid-point, in [0, 360). */
  spin: number;
  lift: number;
  scale: number;
  dx: number;
  dy: number;
  /**
   * Angular rate as a fraction of the mean — 0 at rest, 1 at the average, up
   * to `1 + SPIN_SWING` at the top of a flick. Renderers scale motion blur by
   * this, so the smear thickens through the flick and thins as it coasts.
   */
  velocity: number;
}

/**
 * The hand while a response is pending: the pencil rises off the board and is
 * twirled between the fingers.
 *
 * Rate is deliberately not constant. A flick accelerates the barrel, it coasts
 * and slows, and the next flick picks it up — `SPIN_BEATS` times a turn. The
 * cadence term is a sine over the same period, so it contributes exactly zero
 * net angle per revolution: every turn still takes `periodMs` to the frame
 * while the motion inside it breathes. Both terms are smooth in all
 * derivatives, so there is no seam anywhere in the loop.
 *
 * Time is pushed through an exponential ramp first, so the twirl starts from
 * rest instead of snapping to full speed.
 */
export function spinningPose(elapsedMs: number, periodMs = SPIN_PERIOD_MS): SpinningPose {
  const t = Math.max(elapsedMs, 0);
  const period = Math.max(periodMs, 1);
  const gate = 1 - Math.exp(-t / SPIN_RAMP_MS);
  // Effective time: lags real time by the ramp, so the barrel spins up rather
  // than starting mid-flick.
  const phase = t - SPIN_RAMP_MS * gate;
  const beat = (SPIN_BEATS * 2 * Math.PI * phase) / period;

  const angle = (360 * phase) / period + SPIN_CADENCE_DEG * Math.sin(beat) * gate;
  const rise = smoothstep(t / SPIN_RISE_MS);
  const seconds = t / 1000;

  return {
    spin: ((angle % 360) + 360) % 360,
    lift: SPIN_LIFT_PX * rise,
    scale: 1 + 0.08 * rise,
    dx: rise * 2.2 * Math.sin(seconds * 0.9),
    dy: rise * 1.4 * Math.sin(seconds * 1.3 + 0.7),
    velocity: gate * (1 + SPIN_SWING * Math.cos(beat)),
  };
}

/**
 * Trailing ghosts of the barrel, newest first — the poor man's motion blur,
 * and the only kind available to a vector renderer. Each ghost sits a little
 * further back along the arc just swept, fading as it goes, so a fast flick
 * smears into a wide arc and a slow coast tightens to almost nothing.
 */
export interface SpinGhost {
  /** Degrees behind the instrument. */
  offset: number;
  opacity: number;
}

/** Widest smear, in degrees, at the top of a flick. */
export const SPIN_SMEAR_DEG = 46;
export const SPIN_GHOST_COUNT = 4;

export function spinGhosts(
  velocity: number,
  count = SPIN_GHOST_COUNT,
  smearDeg = SPIN_SMEAR_DEG,
): SpinGhost[] {
  const strength = clamp01(velocity / (1 + SPIN_SWING));
  if (strength <= 0.001 || count <= 0) return [];
  const span = smearDeg * strength;
  const ghosts: SpinGhost[] = [];
  for (let index = 1; index <= count; index++) {
    const t = index / count;
    ghosts.push({
      offset: span * t,
      // Quadratic falloff: the ghost nearest the barrel carries the smear, the
      // far ones only soften its trailing edge.
      opacity: 0.3 * strength * (1 - t) ** 2 + 0.02 * strength,
    });
  }
  return ghosts;
}

export interface ScratchBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Deterministic per-seed noise, so a doodle replays identically in verify. */
export function randomSource(seed: number): () => number {
  let state = (Math.floor(seed) * 1664525 + 1013904223) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function smoothThrough(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return "M 0 0";
  const first = points[0]!;
  if (points.length < 3) {
    const last = points[points.length - 1]!;
    return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  }
  let data = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  for (let index = 1; index < points.length - 1; index++) {
    const current = points[index]!;
    const next = points[index + 1]!;
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    data += ` Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }
  const last = points[points.length - 1]!;
  return `${data} L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
}

/**
 * An idle scribble in the margin — the rough-paper doodle a tutor leaves while
 * working something out. Always stays inside `box` so it cannot reach the work.
 */
export function scratchStrokePath(seed: number, box: ScratchBox): string {
  const random = randomSource(seed);
  const padX = box.width * 0.08;
  const padY = box.height * 0.16;
  const left = box.x + padX;
  const right = box.x + box.width - padX;
  const top = box.y + padY;
  const bottom = box.y + box.height - padY;
  const span = Math.max(right - left, 1);
  const count = 6 + Math.floor(random() * 3);
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index <= count; index++) {
    const t = index / count;
    const zig = index % 2 === 0 ? 0.16 : 0.84;
    const jitter = (random() - 0.5) * 0.22;
    points.push({
      x: left + span * (t * 0.94 + (random() - 0.5) * 0.05),
      y: top + (bottom - top) * Math.min(Math.max(zig + jitter, 0), 1),
    });
  }
  return smoothThrough(
    points.map((point) => ({
      x: Math.min(Math.max(point.x, left), right),
      y: Math.min(Math.max(point.y, top), bottom),
    })),
  );
}

/**
 * Travel — how the hand gets from one place on the board to the next.
 *
 * A hand never slides in a straight line at a constant rate. Short carries
 * between two strokes bow over the gap and keep their speed through it; long
 * reaches across the board arc, accelerate quickly, and settle slowly onto the
 * landing point. Both are described here as a curve plus a rate, so the board
 * only has to sample them.
 */

/** How far a carry between strokes bows above the straight line. */
export const CARRY_BOW_RATIO = 0.18;
export const CARRY_BOW_MAX_PX = 9;
/** How far a full flight across the board bows above the straight line. */
export const FLIGHT_BOW_RATIO = 0.15;
export const FLIGHT_BOW_MAX_PX = 34;

export interface TravelPoint {
  x: number;
  y: number;
}

/**
 * Quadratic bow between two points. The control point is pushed perpendicular
 * to the line of travel, always toward the top of the board, because a hand
 * carries the nib over the gap rather than dragging it through the ink below.
 */
export function bowedPoint(
  from: TravelPoint,
  to: TravelPoint,
  t: number,
  bow: number,
): TravelPoint {
  const progress = clamp01(t);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  if (!(distance > 1e-6) || !(Math.abs(bow) > 1e-6)) {
    return { x: from.x + dx * progress, y: from.y + dy * progress };
  }
  // Perpendicular, flipped so it always points up-screen.
  let nx = -dy / distance;
  let ny = dx / distance;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const cx = midX + nx * bow * 2;
  const cy = midY + ny * bow * 2;
  const inverse = 1 - progress;
  return {
    x: inverse * inverse * from.x + 2 * inverse * progress * cx + progress * progress * to.x,
    y: inverse * inverse * from.y + 2 * inverse * progress * cy + progress * progress * to.y,
  };
}

export function carryBow(distancePx: number): number {
  return Math.min(distancePx * CARRY_BOW_RATIO, CARRY_BOW_MAX_PX);
}

export function flightBow(distancePx: number): number {
  return Math.min(distancePx * FLIGHT_BOW_RATIO, FLIGHT_BOW_MAX_PX);
}

/**
 * Rate for a carry between two strokes of the same word.
 *
 * Deliberately not an ease-in-out: the pen is already moving when it leaves
 * the last stroke and is still moving when it meets the next one. A curve that
 * parks at both ends puts a full stop between every pair of letters, which is
 * exactly what made the writing read as stamped rather than written.
 */
export function carryEase(progress: number): number {
  const t = clamp01(progress);
  return 0.36 * t + 0.64 * smoothstep(t);
}

/**
 * Rate for a reach across the board.
 *
 * Human point-to-point movement follows a minimum-jerk profile, skewed a
 * little early: the arm commits quickly and spends the tail of the movement
 * placing the nib. `smootherstep` is that profile; the skew moves peak speed
 * to roughly 42% of the way through.
 */
export const REACH_SKEW = 0.18;
export function reachEase(progress: number): number {
  const t = clamp01(progress);
  return smootherstep(clamp01(t + REACH_SKEW * t * (1 - t)));
}

/**
 * When the barrel starts rolling toward its landing tilt. Early in a flight
 * the pen still holds the angle it wrote at; the turn happens on approach.
 */
export const FLIGHT_SETTLE_FROM = 0.5;
export function flightRotationBlend(progress: number): number {
  return smoothstep(clamp01((clamp01(progress) - FLIGHT_SETTLE_FROM) / (1 - FLIGHT_SETTLE_FROM)));
}
