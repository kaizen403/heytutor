type Point = { x: number; y: number };
export type ConnectorObstacle = { points: Point[]; contacts: Point[] };
const EPS = 1e-8;
const near = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= EPS;
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;

/** An electrical-looking crossing cannot be inferred from logical connectivity.
 * Test whole ink segments, including a route bend touching unrelated ink. Only
 * the declared start/end may meet existing ink; overlapping leads are blocked. */
function blocked(a: Point, b: Point, c: Point, d: Point, terminals: Point[]): boolean {
  const u = { x: b.x - a.x, y: b.y - a.y };
  const v = { x: d.x - c.x, y: d.y - c.y };
  const w = { x: c.x - a.x, y: c.y - a.y };
  const denominator = cross(u, v);
  if (Math.abs(denominator) > EPS) {
    const t = cross(w, v) / denominator, s = cross(w, u) / denominator;
    if (t < -EPS || t > 1 + EPS || s < -EPS || s > 1 + EPS) return false;
    const hit = { x: a.x + t * u.x, y: a.y + t * u.y };
    return !terminals.some(p => near(p, hit));
  }
  if (Math.abs(cross(w, u)) > EPS) return false;
  const length2 = u.x * u.x + u.y * u.y;
  if (length2 < EPS * EPS) return false;
  const projection = (p: Point): number => ((p.x - a.x) * u.x + (p.y - a.y) * u.y) / length2;
  const lo = Math.max(0, Math.min(projection(c), projection(d)));
  const hi = Math.min(1, Math.max(projection(c), projection(d)));
  if (hi < lo - EPS) return false;
  if (hi - lo > EPS) return true;
  return !terminals.some(p => near(p, { x: a.x + lo * u.x, y: a.y + lo * u.y }));
}

/** Deterministic nonmetric routing. Logical endpoints never move. Candidate
 * paths are checked against every obstacle segment, not sampled vertices. */
export function routeConnector(start: Point, end: Point, obstacles: ConnectorObstacle[]): Point[] {
  const segments = obstacles.flatMap(({points,contacts}) => points.slice(1).map((p, i) => ({a:points[i]!,b:p,contacts})));
  const compact = (path: Point[]): Point[] => path.filter((p, i) => i === 0 || !near(p, path[i - 1]!));
  const clear = (path: Point[]): boolean => path.slice(1).every((p, i) =>
    segments.every(({a,b,contacts}) => !blocked(path[i]!, p, a, b, contacts)));
  if (clear([start, end])) return [start, end];
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  const margin = Math.max(0.35, span * 0.08);
  const points = obstacles.flatMap(obstacle => obstacle.points);
  const xs = [...new Set([start.x, end.x, ...points.flatMap(p => [p.x - margin, p.x + margin])])];
  const ys = [...new Set([start.y, end.y, ...points.flatMap(p => [p.y - margin, p.y + margin])])];
  const candidates: Point[][] = [
    [start, { x: start.x, y: end.y }, end],
    [start, { x: end.x, y: start.y }, end],
    ...xs.map(x => [start, { x, y: start.y }, { x, y: end.y }, end]),
    ...ys.map(y => [start, { x: start.x, y }, { x: end.x, y }, end]),
  ];
  const length = (path: Point[]): number => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y), 0);
  const valid = candidates.map(compact).filter(clear).sort((a, b) => length(a) - length(b) || a.length - b.length);
  if (valid[0]) return valid[0];
  throw new Error('No connector route avoids unrelated geometry');
}
