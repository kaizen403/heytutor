export interface CurvePoint {
  readonly x: number;
  readonly y: number;
}

export interface DirectedCurveInk {
  readonly stroke: readonly CurvePoint[];
  readonly arrow: readonly [CurvePoint, CurvePoint] | null;
}

/** A two-point vector is a straight arrow. Extra vertices are the curve, with the head on the last segment. */
export function directedCurveInk(points: readonly CurvePoint[]): DirectedCurveInk {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return { stroke: [], arrow: null };
  if (points.length <= 2) return { stroke: [start, end], arrow: [start, end] };
  const previous = points[points.length - 2];
  if (!previous) return { stroke: points, arrow: null };
  return { stroke: points, arrow: [previous, end] };
}
