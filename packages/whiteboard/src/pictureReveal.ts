/**
 * Reference picture reveal: how long a pass takes and where the pencil is at
 * every moment of it. The board lays a paper card, the pencil traces the
 * outline strokes (the picture shows through the plan's ink mask under the
 * brush), then sweeps the fill strokes (the full picture shows). See the
 * `@heytutor/drawing` referencePicture contract for the plan itself.
 *
 * Pure, so the gate measures the timeline the board draws. A pass is one
 * tween with this timeline inside it, not one tween per stroke: a picture is
 * hundreds of strokes, and every chained tween costs a frame, which over a
 * 500 stroke outline is eight seconds of stalls.
 */
import type { PicturePass, PicturePlacement, ReferencePicturePass } from "@heytutor/drawing";
import { clamp01, paceShapeDurationMs } from "./penMotion";
import {
  AIR_LIFT_PX,
  FLIGHT_LIFT_PX,
  HOP_LIFT_PX,
  bowedPoint,
  carryBow,
  carryEase,
  flightBow,
  nibTravelFor,
  reachEase,
  type NibTravel,
} from "./penChoreography";

/**
 * Floors and caps on one pass, in 1x media ms.
 *
 * Inside the range the pass's board stroke length decides, at the same hand
 * speed as every other stroke (`INK_SPEED_PX_PER_MS`), so a picture is drawn
 * by the hand that drew the rest of the board. The floor keeps a sparse
 * outline a drawing the student watches rather than a flash; the cap keeps a
 * dense one from holding the lesson. The single shape scene ceiling (320 ms)
 * never applies: a pass is a whole drawing, not one stroke of one.
 *
 * tutor-core's `REFERENCE_PICTURE_PASS_MS` carries the same numbers for the
 * turn's schedule; the gate checks they agree. A numbered picture's legend
 * pass takes the outline's range: tutor-core times every pass that is not the
 * fill by the outline's numbers, and a key of up to 24 names is about as much
 * writing as an outline is drawing.
 */
export const PICTURE_PASS_MS: Readonly<Record<PicturePass, { minMs: number; maxMs: number }>> = {
  outline: { minMs: 4_000, maxMs: 14_000 },
  fill: { minMs: 2_000, maxMs: 7_000 },
  legend: { minMs: 4_000, maxMs: 14_000 },
};

/** The card fades in while the pencil reaches the first stroke. */
export const PICTURE_CARD_FADE_MS = 220;
/** Paper showing round the picture, board px. */
export const PICTURE_CARD_PADDING_PX = 6;

/** Air travel is cheaper than ink (srt-whiteboard `travel_speed_ratio`). */
const TRAVEL_SPEED_RATIO = 1.5;
/** A lift between two touching strokes still costs a beat, or it is not seen. */
const TRAVEL_MIN_WEIGHT_PX = 12;
/** A short sweep still takes a stroke's time (whiteboard-animation-vi, 0.35 bw). */
const SWEEP_MIN_BRUSH_FRACTION = 0.35;

/**
 * The time one pass takes. A requested time (a spoken window, or the turn's
 * own estimate) stands, stretched at most `INK_STRETCH_MAX` toward hand speed
 * the way any narrated stroke is; with none, hand speed over the pass's
 * length decides. Either way the result sits inside `PICTURE_PASS_MS`.
 */
export function resolvePicturePassMs(input: {
  pass: PicturePass;
  /** The pass's stroke length on the board, px. */
  lengthPx: number;
  requestedMs: number;
  paceScale?: number;
}): number {
  const { minMs, maxMs } = PICTURE_PASS_MS[input.pass];
  const lengthPx = Number.isFinite(input.lengthPx) ? Math.max(input.lengthPx, 0) : 0;
  const requestedMs = Number.isFinite(input.requestedMs) && input.requestedMs > 0 ? input.requestedMs : 0;
  const paced = requestedMs > 0
    ? paceShapeDurationMs({ lengthPx, requestedMs, minMs, paceScale: input.paceScale })
    : paceShapeDurationMs({ lengthPx, requestedMs: 0, minMs, maxMs, paceScale: input.paceScale });
  return Math.round(Math.min(Math.max(paced, minMs), maxMs));
}

export interface PicturePoint {
  x: number;
  y: number;
}

/** One stroke of a pass, moved onto the board. */
export interface PictureStrokePath {
  /** Flat `[x0, y0, x1, y1, ...]`, board px. */
  points: Float64Array;
  /** Arc length at each vertex, board px. */
  cumulative: Float64Array;
  length: number;
}

/** A pass's strokes in board px. Degenerate strokes (one point) are dropped. */
export function boardPictureStrokes(
  pass: Pick<ReferencePicturePass, "strokes">,
  plan: { width: number; height: number },
  placement: PicturePlacement,
): PictureStrokePath[] {
  const sx = placement.width / Math.max(plan.width, 1);
  const sy = placement.height / Math.max(plan.height, 1);
  const strokes: PictureStrokePath[] = [];
  for (const stroke of pass.strokes) {
    const count = Math.floor(stroke.length / 2);
    if (count < 2) continue;
    const points = new Float64Array(count * 2);
    const cumulative = new Float64Array(count);
    let length = 0;
    for (let i = 0; i < count; i++) {
      const x = placement.x + stroke[i * 2]! * sx;
      const y = placement.y + stroke[i * 2 + 1]! * sy;
      if (i > 0) length += Math.hypot(x - points[i * 2 - 2]!, y - points[i * 2 - 1]!);
      points[i * 2] = x;
      points[i * 2 + 1] = y;
      cumulative[i] = length;
    }
    strokes.push({ points, cumulative, length });
  }
  return strokes;
}

/**
 * A stroke from points already on the board (a sampled glyph stroke of the
 * legend), or null when it has no length to draw along.
 */
export function pictureStrokeFromPoints(samples: ReadonlyArray<{ x: number; y: number }>): PictureStrokePath | null {
  if (samples.length < 2) return null;
  const points = new Float64Array(samples.length * 2);
  const cumulative = new Float64Array(samples.length);
  let length = 0;
  samples.forEach((point, i) => {
    if (i > 0) length += Math.hypot(point.x - samples[i - 1]!.x, point.y - samples[i - 1]!.y);
    points[i * 2] = point.x;
    points[i * 2 + 1] = point.y;
    cumulative[i] = length;
  });
  return length > 0 ? { points, cumulative, length } : null;
}

export type PictureSegment =
  | {
      kind: "travel";
      /** The stroke this travel arrives at. */
      stroke: number;
      startMs: number;
      endMs: number;
      from: PicturePoint;
      to: PicturePoint;
      travel: NibTravel;
      bow: number;
      lift: number;
    }
  | { kind: "paint"; stroke: number; startMs: number; endMs: number };

export interface PictureTimeline {
  pass: PicturePass;
  strokes: PictureStrokePath[];
  /** travel 0, paint 0, travel 1, paint 1, ... */
  segments: PictureSegment[];
  totalMs: number;
}

/**
 * Split a pass's time over its strokes: each stroke's paint by its length,
 * each lift by the distance flown at the lighter air weight. The first travel
 * starts wherever the nib is now; when this pass lays the card it is held for
 * at least `leadInMs`, so the card is down before the first line touches it.
 */
export function planPictureTimeline(input: {
  pass: PicturePass;
  strokes: PictureStrokePath[];
  /** Brush diameter on the board, px. Floors a fill sweep's weight. */
  brushPx: number;
  from: PicturePoint;
  totalMs: number;
  leadInMs?: number;
}): PictureTimeline {
  const { pass, strokes } = input;
  const totalMs = Math.max(input.totalMs, 0);
  const sweepFloor = pass === "fill" ? Math.max(input.brushPx, 0) * SWEEP_MIN_BRUSH_FRACTION : 1;
  const weights: number[] = [];
  const legs: Array<{ from: PicturePoint; to: PicturePoint; distance: number }> = [];
  let at = input.from;
  for (const stroke of strokes) {
    const to = { x: stroke.points[0]!, y: stroke.points[1]! };
    const distance = Math.hypot(to.x - at.x, to.y - at.y);
    legs.push({ from: at, to, distance });
    weights.push(Math.max(distance / TRAVEL_SPEED_RATIO, TRAVEL_MIN_WEIGHT_PX));
    weights.push(Math.max(stroke.length, sweepFloor));
    const last = stroke.points.length - 2;
    at = { x: stroke.points[last]!, y: stroke.points[last + 1]! };
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const segments: PictureSegment[] = [];
  if (strokes.length === 0 || !(totalWeight > 0)) return { pass, strokes, segments, totalMs };

  // The first lift carries the card fade, never more than half the pass.
  const evenMs = (weights[0]! / totalWeight) * totalMs;
  const leadMs = Math.min(Math.max(evenMs, input.leadInMs ?? 0), totalMs * 0.5);
  const restWeight = totalWeight - weights[0]!;
  const msPerWeight = restWeight > 0 ? (totalMs - leadMs) / restWeight : 0;
  let clock = 0;
  for (let i = 0; i < strokes.length; i++) {
    const leg = legs[i]!;
    const travel = nibTravelFor(leg.distance);
    const travelMs = i === 0 ? leadMs : weights[i * 2]! * msPerWeight;
    segments.push({
      kind: "travel",
      stroke: i,
      startMs: clock,
      endMs: clock + travelMs,
      from: leg.from,
      to: leg.to,
      travel,
      bow: travel === "fly" ? flightBow(leg.distance) : travel === "hop" ? carryBow(leg.distance) : 0,
      lift: travel === "fly" ? FLIGHT_LIFT_PX : travel === "hop" ? HOP_LIFT_PX : AIR_LIFT_PX,
    });
    clock += travelMs;
    const paintMs = weights[i * 2 + 1]! * msPerWeight;
    segments.push({ kind: "paint", stroke: i, startMs: clock, endMs: clock + paintMs });
    clock += paintMs;
  }
  // Float drift must not leave the last stroke short of the pass's end.
  segments[segments.length - 1]!.endMs = totalMs;
  return { pass, strokes, segments, totalMs };
}

/** How far a pass has got: strokes before `stroke` are done, `stroke` is done to `arcPx`. */
export interface PictureRevealMark {
  stroke: number;
  arcPx: number;
}

export interface PictureFrame extends PictureRevealMark {
  /** Segment index, a search hint for the next frame. */
  segment: number;
  nib: PicturePoint;
  /** Nib height off the board, px. 0 while painting. */
  lift: number;
  painting: boolean;
}

export function pointAlongPictureStroke(stroke: PictureStrokePath, arcPx: number): PicturePoint {
  const { points, cumulative } = stroke;
  const count = cumulative.length;
  if (count === 0) return { x: 0, y: 0 };
  if (!(arcPx > 0)) return { x: points[0]!, y: points[1]! };
  if (arcPx >= stroke.length) return { x: points[count * 2 - 2]!, y: points[count * 2 - 1]! };
  let lo = 0;
  let hi = count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= arcPx) lo = mid;
    else hi = mid;
  }
  const span = cumulative[hi]! - cumulative[lo]!;
  const t = span > 0 ? (arcPx - cumulative[lo]!) / span : 0;
  return {
    x: points[lo * 2]! + (points[hi * 2]! - points[lo * 2]!) * t,
    y: points[lo * 2 + 1]! + (points[hi * 2 + 1]! - points[lo * 2 + 1]!) * t,
  };
}

/** Line work is laid at an even rate; a colour sweep eases in and out. */
function paintEase(pass: PicturePass, progress: number): number {
  const t = clamp01(progress);
  return pass === "fill" ? 0.5 - 0.5 * Math.cos(Math.PI * t) : t;
}

function travelEase(travel: NibTravel, progress: number): number {
  if (travel === "fly") return reachEase(progress);
  if (travel === "hop") return carryEase(progress);
  return clamp01(progress);
}

/**
 * Where the pass is at `ms`. `hint` is the previous frame's segment: time only
 * moves forward inside a tween, so the search starts there.
 */
export function pictureFrameAt(timeline: PictureTimeline, ms: number, hint = 0): PictureFrame {
  const { segments, strokes } = timeline;
  if (segments.length === 0 || ms >= timeline.totalMs) {
    const last = strokes[strokes.length - 1];
    const nib = last ? pointAlongPictureStroke(last, last.length) : { x: 0, y: 0 };
    return { stroke: strokes.length, arcPx: 0, segment: Math.max(segments.length - 1, 0), nib, lift: 0, painting: false };
  }
  let index = Math.min(Math.max(hint, 0), segments.length - 1);
  if (segments[index]!.startMs > ms) index = 0;
  while (index < segments.length - 1 && segments[index]!.endMs <= ms) index++;
  const segment = segments[index]!;
  const span = segment.endMs - segment.startMs;
  const q = span > 0 ? clamp01((ms - segment.startMs) / span) : 1;
  if (segment.kind === "travel") {
    const eased = travelEase(segment.travel, q);
    return {
      stroke: segment.stroke,
      arcPx: 0,
      segment: index,
      nib: bowedPoint(segment.from, segment.to, eased, segment.bow),
      lift: segment.lift * Math.sin(Math.PI * q),
      painting: false,
    };
  }
  const stroke = strokes[segment.stroke]!;
  const arcPx = paintEase(timeline.pass, q) * stroke.length;
  return {
    stroke: segment.stroke,
    arcPx,
    segment: index,
    nib: pointAlongPictureStroke(stroke, arcPx),
    lift: 0,
    painting: true,
  };
}

/** The stretches of stroke newly covered between two marks, in order. */
export function pictureRevealSpans(
  strokes: readonly PictureStrokePath[],
  from: PictureRevealMark,
  to: PictureRevealMark,
): Array<{ stroke: number; fromArcPx: number; toArcPx: number }> {
  const spans: Array<{ stroke: number; fromArcPx: number; toArcPx: number }> = [];
  for (let index = from.stroke; index <= to.stroke && index < strokes.length; index++) {
    const start = index === from.stroke ? from.arcPx : 0;
    const end = index < to.stroke ? strokes[index]!.length : to.arcPx;
    if (end > start || (index < to.stroke && start === 0)) spans.push({ stroke: index, fromArcPx: start, toArcPx: end });
  }
  return spans;
}

/** The vertices of a stroke between two arc lengths, flat, board px. */
export function pictureStrokeSpan(stroke: PictureStrokePath, fromArcPx: number, toArcPx: number): number[] {
  const start = pointAlongPictureStroke(stroke, fromArcPx);
  const out = [start.x, start.y];
  const { points, cumulative } = stroke;
  for (let i = 0; i < cumulative.length; i++) {
    const at = cumulative[i]!;
    if (at <= fromArcPx) continue;
    if (at >= toArcPx) break;
    out.push(points[i * 2]!, points[i * 2 + 1]!);
  }
  const end = pointAlongPictureStroke(stroke, toArcPx);
  out.push(end.x, end.y);
  return out;
}
