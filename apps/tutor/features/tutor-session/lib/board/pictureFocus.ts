/**
 * Pointing at a part of a reference picture.
 *
 * A picture part ("R1" printed on the drawing, or a numbered picture's mark
 * and its row in the key) owns no ink: the picture is one image. Its anchor is
 * the box of the printed text, so the gesture is a ring round that text. The
 * verified diagram's anchor ring is an ellipse inscribed in a padded box,
 * which cuts the corners of a wide word and strikes through a key row. This
 * ring is a loop with round ends that clears every corner of the text by a
 * few pixels and stays that close along its length, so it reads as "this
 * word" and never as "this region" or the whole card.
 *
 * Only picture part and key anchors take this path. Their ids exist only when
 * part focus is on, so a picture without them, and every verified diagram,
 * keeps its gestures and its veil exactly as before.
 */
import { REFERENCE_PICTURE_ZONE, isReferencePicturePartFocusId } from "@heytutor/drawing";
import type { FocusTracePath } from "./scheduledFocus";
import type { SpotlightRect } from "./spotlight";

/** Clearance between the text's box and the ring, board px. */
const RING_CLEARANCE_PX = 3;
/** Smallest half width and half height of the padded box: a lone "3" still gets a ring a pen can draw. */
const RING_MIN_HALF_WIDTH_PX = 10;
const RING_MIN_HALF_HEIGHT_PX = 9;
/**
 * A box no wider than this many times its height (a mark, a short symbol)
 * gets a circle; anything wider gets a flat loop, since a circle round a word
 * would reach up into the rows above and below it.
 */
const RING_CIRCLE_ASPECT = 1.3;
/** How far a flat loop's round end reaches past the text, as a share of the padded half height. */
const RING_END_SHARE = 0.6;
/** The pulse after a trace sits just outside the ring rather than on it. */
const PULSE_EXTRA_PX = 3;
/** The spotlight hole clears the ring by this much, so no part of the ring is dimmed. */
const HOLE_MARGIN_PX = 4;
const KAPPA = 0.552284749831;

const round = (value: number) => Math.round(value * 10) / 10;

interface RingShape {
  cx: number;
  cy: number;
  /** Half the straight run along the top and bottom; 0 for a circle. */
  run: number;
  /** How far each round end reaches past the straight run. */
  reach: number;
  /** Half the ring's height. */
  half: number;
}

function ringShape(rect: SpotlightRect, extraPx: number): RingShape {
  const pad = RING_CLEARANCE_PX + Math.max(0, extraPx);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hx = Math.max(rect.width / 2 + pad, RING_MIN_HALF_WIDTH_PX);
  const hy = Math.max(rect.height / 2 + pad, RING_MIN_HALF_HEIGHT_PX);
  if (hx <= hy * RING_CIRCLE_ASPECT) {
    // Round the padded box's corners.
    const radius = Math.hypot(hx, hy);
    return { cx, cy, run: 0, reach: radius, half: radius };
  }
  // Straight along the padded box's top and bottom, so the loop is no taller
  // than the text plus its clearance, with a half ellipse at each end.
  return { cx, cy, run: hx, reach: hy * RING_END_SHARE, half: hy };
}

/**
 * A ring round a box of printed text, clear of it by `RING_CLEARANCE_PX` plus
 * `extraPx` everywhere: a circle round a mark, a flat loop round a word or a
 * key row. The pen starts at the top left of the loop and goes clockwise;
 * `x`/`y` are that start, so the flight lands where the trace begins.
 */
export function pictureTextRingPath(rect: SpotlightRect, extraPx = 0): FocusTracePath {
  const { cx, cy, run, reach, half } = ringShape(rect, extraPx);
  const left = cx - run;
  const right = cx + run;
  const top = cy - half;
  const bottom = cy + half;
  const kx = reach * KAPPA;
  const ky = half * KAPPA;
  const p = (x: number, y: number) => `${round(x)} ${round(y)}`;
  const path = [
    `M ${p(left, top)}`,
    ...(run > 0 ? [`L ${p(right, top)}`] : []),
    `C ${p(right + kx, top)} ${p(right + reach, cy - ky)} ${p(right + reach, cy)}`,
    `C ${p(right + reach, cy + ky)} ${p(right + kx, bottom)} ${p(right, bottom)}`,
    ...(run > 0 ? [`L ${p(left, bottom)}`] : []),
    `C ${p(left - kx, bottom)} ${p(left - reach, cy + ky)} ${p(left - reach, cy)}`,
    `C ${p(left - reach, cy - ky)} ${p(left - kx, top)} ${p(left, top)}`,
  ].join(" ");
  return { path, x: round(left), y: round(top) };
}

/** The ring drawn after the trace when the emphasis is pulse: the same loop, a little wider. */
export function pictureTextPulsePath(rect: SpotlightRect): FocusTracePath {
  return pictureTextRingPath(rect, PULSE_EXTRA_PX);
}

/**
 * The spotlight hole for a part: the ring's own bounds plus a margin. The
 * verified diagram's hole pads the anchor by a fixed 10 px, which a ring
 * round a tall key row overruns, leaving its round ends dimmed.
 */
export function pictureFocusHole(rect: SpotlightRect): SpotlightRect {
  const { cx, cy, run, reach, half } = ringShape(rect, 0);
  const halfWidth = run + reach + HOLE_MARGIN_PX;
  const halfHeight = half + HOLE_MARGIN_PX;
  return { x: cx - halfWidth, y: cy - halfHeight, width: halfWidth * 2, height: halfHeight * 2 };
}

/** One hole round every ring of `rects`, or null unless every target is a picture part. */
export function pictureFocusUnionHole(targets: ReadonlyArray<SpotlightRect & { id: string }>): SpotlightRect | null {
  if (targets.length === 0 || !targets.every((target) => isReferencePicturePartFocusId(target.id))) return null;
  const holes = targets.map(pictureFocusHole);
  const x = Math.min(...holes.map((hole) => hole.x));
  const y = Math.min(...holes.map((hole) => hole.y));
  const right = Math.max(...holes.map((hole) => hole.x + hole.width));
  const bottom = Math.max(...holes.map((hole) => hole.y + hole.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The zone a spotlight dims. A picture is taller than the verified diagram
 * zone and its key sits beside it, so a focus on a picture part dims the
 * picture zone; anything else keeps `fallback`.
 */
export function focusVeilZone<T extends SpotlightRect>(
  targets: ReadonlyArray<{ id: string }>,
  fallback: T,
): T | SpotlightRect {
  if (!targets.some((target) => isReferencePicturePartFocusId(target.id))) return fallback;
  const zone = REFERENCE_PICTURE_ZONE;
  return { x: zone.x, y: zone.y, width: zone.width, height: zone.height };
}
