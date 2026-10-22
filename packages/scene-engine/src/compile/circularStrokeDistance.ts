import type { RenderPrimitive } from "../types";

type Point = { x: number; y: number };

/** Distance to visible circular ink, including the endpoints of a partial arc. */
export function circularStrokeDistance(p: Point, primitive: RenderPrimitive): number {
  const centre = primitive.points[0];
  if (!centre) return Infinity;
  const radius = primitive.radius ?? 0;
  const radial = Math.hypot(p.x - centre.x, p.y - centre.y);
  if (primitive.kind === "circle") return Math.abs(radial - radius);
  const start = primitive.startAngle ?? 0, end = primitive.endAngle ?? start;
  const sweep = end - start;
  const tau = 2 * Math.PI;
  const normalized = (a: number) => ((a % tau) + tau) % tau;
  const angle = Math.atan2(p.y - centre.y, p.x - centre.x);
  const along = normalized(sweep < 0 ? start - angle : angle - start);
  if (Math.abs(sweep) >= tau || along <= Math.abs(sweep)) return Math.abs(radial - radius);
  return Math.min(...[start, end].map(a => Math.hypot(p.x - centre.x - radius * Math.cos(a), p.y - centre.y - radius * Math.sin(a))));
}
