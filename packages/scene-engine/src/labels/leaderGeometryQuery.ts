import type { RenderPoint } from "../types";
import type { LabelObstacle } from "./labelEngine";

/** Prepare immutable stroke terms once for all leader candidates in a placement.
 * Every intersection still uses the original predicate, tolerance, operation
 * order and anchor-contact rule. This changes only repeated arithmetic. */
export function createLeaderGeometryQuery(obstacles: LabelObstacle[]): (path: RenderPoint[]) => boolean {
  const strokes = obstacles.flatMap(obstacle => (obstacle.segments ?? []).map(([a, b]) => {
    const ex = b.x - a.x, ey = b.y - a.y;
    return { a, b, ex, ey, absEx: Math.abs(ex), absEy: Math.abs(ey),
      left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
  }));
  return path => {
    const anchor = path[0]!;
    for (let index = 1; index < path.length; index++) {
      const start = path[index - 1]!, end = path[index]!;
      const dx = end.x - start.x, dy = end.y - start.y;
      const directionSpan = Math.abs(dx) + Math.abs(dy);
      const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
      const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
      for (const stroke of strokes) {
        const { a, b, ex, ey } = stroke;
        const margin = 1 + 1e-6 * (directionSpan + stroke.absEx + stroke.absEy);
        if (right + margin < stroke.left || stroke.right + margin < left ||
            bottom + margin < stroke.top || stroke.bottom + margin < top) continue;
        const denominator = dx * ey - dy * ex;
        const ax = a.x - start.x, ay = a.y - start.y;
        if (Math.abs(denominator) < 1e-9) {
          if (Math.abs(ax * dy - ay * dx) > 1e-6) continue;
          const span = dx * dx + dy * dy;
          if (span < 1e-9) continue;
          const first = (ax * dx + ay * dy) / span;
          const second = ((b.x - start.x) * dx + (b.y - start.y) * dy) / span;
          if (Math.min(1, Math.max(first, second)) - Math.max(0, Math.min(first, second)) > 1e-6) return true;
          continue;
        }
        const along = (ax * ey - ay * ex) / denominator;
        const across = (ax * dy - ay * dx) / denominator;
        if (along < -1e-6 || along > 1 + 1e-6 || across < -1e-6 || across > 1 + 1e-6) continue;
        const hit = { x: start.x + dx * along, y: start.y + dy * along };
        if (Math.hypot(hit.x - anchor.x, hit.y - anchor.y) > 0.05) return true;
      }
    }
    return false;
  };
}

