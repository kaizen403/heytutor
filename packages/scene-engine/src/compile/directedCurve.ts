export interface CurvePoint {
  readonly x: number;
  readonly y: number;
}

export interface DirectedCurveInk {
  readonly stroke: readonly CurvePoint[];
  readonly arrow: readonly [CurvePoint, CurvePoint] | null;
}

/**
 * Shaft length, in board pixels, the head is drawn along. The board drops an
 * arrowhead whose shaft is under 2 px, and a densely sampled field line can
 * end in sub-pixel steps.
 */
export const DIRECTED_CURVE_HEAD_SHAFT_PX = 4;

/**
 * A two-point vector is a straight arrow. Extra vertices are the curve, with
 * the head along its last direction: from the nearest earlier vertex at least
 * `headShaft` away from the end (or the start, for a curve shorter than that).
 */
export function directedCurveInk(
  points: readonly CurvePoint[],
  headShaft: number = DIRECTED_CURVE_HEAD_SHAFT_PX,
): DirectedCurveInk {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return { stroke: [], arrow: null };
  if (points.length <= 2) return { stroke: [start, end], arrow: [start, end] };
  let tail = points.length - 2;
  while (tail > 0 && Math.hypot(end.x - points[tail]!.x, end.y - points[tail]!.y) < headShaft) tail -= 1;
  return { stroke: points, arrow: [points[tail]!, end] };
}
