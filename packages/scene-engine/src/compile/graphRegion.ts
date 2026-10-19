/**
 * The region under a graph, read from the graph itself.
 *
 * A motion graph or any other piecewise linear graph is drawn as a polyline
 * whose vertices strictly increase in x. Such a polyline is a function of x,
 * so it can bound a `function_region` and carry a `function_value` check the
 * same way a `function_curve` does. Its own vertices are the breakpoints, so a
 * region built from it keeps every corner exactly instead of cutting it with a
 * uniform sample grid.
 *
 * `polygonMatchesGraphRegion` proves that a polygon a planner wrote by hand is
 * exactly the set between two boundaries over its own x span. The validator
 * asks it only for a graph and its baseline (the axis y = 0, or the zero
 * line a motion graph draws at its origin), with no other graph passing
 * through. A polygon that matches is the deterministic region; anything else,
 * such as the full bounding rectangle of a trapezium, is a guessed shape.
 */

export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphBoundary {
  min: number;
  max: number;
  /** Interior x values where the graph changes slope. */
  breakpoints: number[];
  evaluate: (x: number) => number;
}

const RELATIVE_TOLERANCE = 1e-6;

/** A polyline is a graph y = f(x) only when its x values strictly increase. */
export function piecewiseLinearGraph(points: readonly GraphPoint[]): GraphBoundary | null {
  if (points.length < 2) return null;
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  for (let index = 1; index < points.length; index += 1) {
    if (!(points[index]!.x > points[index - 1]!.x)) return null;
  }
  const vertices = points.map((point) => ({ x: point.x, y: point.y }));
  const min = vertices[0]!.x;
  const max = vertices.at(-1)!.x;
  return {
    min,
    max,
    breakpoints: vertices.slice(1, -1).map((point) => point.x),
    evaluate: (x: number) => {
      if (!(x >= min - tolerance(min, max) && x <= max + tolerance(min, max))) return Number.NaN;
      if (x <= min) return vertices[0]!.y;
      if (x >= max) return vertices.at(-1)!.y;
      let segment = 1;
      while (segment < vertices.length - 1 && vertices[segment]!.x < x) segment += 1;
      const start = vertices[segment - 1]!;
      const end = vertices[segment]!;
      return start.y + (end.y - start.y) * (x - start.x) / (end.x - start.x);
    },
  };
}

/** The axis line y = 0 as a boundary over any span. */
export const AXIS_BASELINE: GraphBoundary = {
  min: Number.NEGATIVE_INFINITY,
  max: Number.POSITIVE_INFINITY,
  breakpoints: [],
  evaluate: () => 0,
};

/**
 * The closed boundary between `upper` and `lower` on [xMin, xMax]: the lower
 * graph left to right, then the upper graph right to left. Every breakpoint
 * of either graph inside the span is a vertex, alongside `samples` evenly
 * spaced x values for any curved boundary.
 */
export function graphRegionBoundary(
  upper: GraphBoundary,
  lower: GraphBoundary,
  xMin: number,
  xMax: number,
  samples: number,
): GraphPoint[] {
  const xs = regionGrid(upper, lower, xMin, xMax, samples);
  const lowerPoints = xs.map((x) => ({ x, y: lower.evaluate(x) }));
  const upperPoints = xs.map((x) => ({ x, y: upper.evaluate(x) }));
  return [...lowerPoints, ...upperPoints.reverse()];
}

export function regionGrid(
  upper: GraphBoundary,
  lower: GraphBoundary,
  xMin: number,
  xMax: number,
  samples: number,
): number[] {
  const grid = Array.from({ length: samples }, (_, index) => xMin + (xMax - xMin) * index / (samples - 1));
  const corners = [...upper.breakpoints, ...lower.breakpoints].filter((x) => x > xMin && x < xMax);
  const merged = [...grid, ...corners].sort((left, right) => left - right);
  const span = tolerance(xMin, xMax);
  return merged.filter((x, index) => index === 0 || x - merged[index - 1]! > span);
}

/**
 * True when `polygon` is exactly the set between `lower` and `upper` over the
 * polygon's own x span: every vertical line through the interior crosses the
 * polygon boundary twice, at lower(x) and upper(x). When `others` is given,
 * none of those graphs may pass strictly between the two boundaries at any
 * probe, so the polygon is one cell of the figure and not a band that another
 * graph cuts through.
 */
export function polygonMatchesGraphRegion(
  polygon: readonly GraphPoint[],
  upper: GraphBoundary,
  lower: GraphBoundary,
  others: readonly GraphBoundary[] = [],
): boolean {
  if (polygon.length < 3) return false;
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  if (!(xMax > xMin)) return false;
  const span = tolerance(xMin, xMax);
  if (upper.min > xMin + span || upper.max < xMax - span) return false;
  if (lower.min > xMin + span || lower.max < xMax - span) return false;
  const scale = Math.max(1, Math.max(...ys) - Math.min(...ys), xMax - xMin);
  const yTolerance = scale * RELATIVE_TOLERANCE * 10;
  const stations = [...new Set([...xs, ...upper.breakpoints, ...lower.breakpoints])]
    .filter((x) => x >= xMin && x <= xMax)
    .sort((left, right) => left - right);
  const probes: number[] = [];
  for (let index = 1; index < stations.length; index += 1) {
    const left = stations[index - 1]!;
    const right = stations[index]!;
    if (!(right - left > span)) continue;
    for (let step = 1; step <= 4; step += 1) probes.push(left + (right - left) * step / 5);
  }
  if (probes.length === 0) return false;
  for (const x of probes) {
    const crossings = verticalCrossings(polygon, x);
    if (crossings.length !== 2) return false;
    const top = upper.evaluate(x);
    const bottom = lower.evaluate(x);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || top + yTolerance < bottom) return false;
    if (Math.abs(crossings[0]! - bottom) > yTolerance || Math.abs(crossings[1]! - top) > yTolerance) return false;
    for (const other of others) {
      if (x < other.min - span || x > other.max + span) continue;
      const y = other.evaluate(x);
      if (Number.isFinite(y) && y > bottom + yTolerance && y < top - yTolerance) return false;
    }
  }
  return true;
}

function verticalCrossings(polygon: readonly GraphPoint[], x: number): number[] {
  const crossings: number[] = [];
  polygon.forEach((start, index) => {
    const end = polygon[(index + 1) % polygon.length]!;
    if (start.x === end.x) return;
    const low = Math.min(start.x, end.x);
    const high = Math.max(start.x, end.x);
    if (!(x >= low && x < high)) return;
    crossings.push(start.y + (end.y - start.y) * (x - start.x) / (end.x - start.x));
  });
  return crossings.sort((left, right) => left - right);
}

function tolerance(min: number, max: number): number {
  return Math.max(1e-9, Math.abs(max - min) * RELATIVE_TOLERANCE);
}
