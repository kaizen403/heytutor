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
 * Short gaps stay perfectly still — a jiggle between two letters of the same
 * word reads as a glitch. Past the grace period the hand starts to breathe,
 * and a genuinely long hold earns a full roll between the fingers. This is
 * free motion: the pen is doing nothing during these frames by definition, so
 * none of it costs the audio budget.
 */
export const WAIT_GRACE_MS = 170;
export const WAIT_RAMP_MS = 320;
/** How long the pen must be held before the first roll. */
export const WAIT_ROLL_AFTER_MS = 2600;
export const WAIT_ROLL_MS = 900;
/** Gap between rolls once the pen has started them. */
export const WAIT_ROLL_PERIOD_MS = 4200;

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

  let spin = ramp * 9 * Math.sin(seconds * 0.72);
  let lift = ramp * 1.6 * (0.5 + 0.5 * Math.sin(seconds * 1.4));
  let scale = 1;

  if (since > WAIT_ROLL_AFTER_MS) {
    const intoRoll = (since - WAIT_ROLL_AFTER_MS) % WAIT_ROLL_PERIOD_MS;
    if (intoRoll < WAIT_ROLL_MS) {
      // Deliberately not `flourishPose`: that curve is tuned for the snappy
      // instrument swap and peaks near 28°/frame. A pen idly rolled between
      // the fingers turns unhurriedly.
      const rollT = intoRoll / WAIT_ROLL_MS;
      const arc = Math.sin(Math.PI * rollT);
      spin += 360 * smootherstep(rollT);
      lift = Math.max(lift, FLOURISH_LIFT_PX * arc);
      scale = 1 + 0.1 * arc;
    }
  }

  return {
    active: true,
    dx: ramp * 1.9 * Math.sin(seconds * 1.15),
    dy: ramp * 1.2 * Math.sin(seconds * 1.75 + 0.7),
    tiltOffset: ramp * 2.4 * Math.sin(seconds * 0.95 + 0.4),
    spin,
    lift,
    scale,
  };
}

/** One full twirl of the pencil while the tutor waits on a response. */
export const SPIN_PERIOD_MS = 1200;
/** The wrist takes a beat to bring the twirl up to speed. */
export const SPIN_RAMP_MS = 220;
export const SPIN_LIFT_PX = 6;
const SPIN_RISE_MS = 320;
/**
 * Beats per revolution. A finger twirl is not a motor: the barrel is flicked,
 * coasts, and is flicked again — two flicks per turn, like a two-blade rotor.
 */
export const SPIN_BEATS = 2;
/**
 * How far the rate swings either side of the mean, as a fraction of it. The
 * angle stays monotonic for any value below 1, so 0.55 gives a pronounced
 * flick-and-coast that never stalls and never reverses.
 */
export const SPIN_SWING = 0.55;
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
