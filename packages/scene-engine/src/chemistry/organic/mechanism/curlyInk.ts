/**
 * Curly arrow ink shared by the mechanism figures: one electron pair drawn
 * as a sampled quadratic curve from its tail to its head.
 */
import type { ChemScene, Vec2 } from "../../sceneKit";

const CURVE_SAMPLES = 10;
/** The compiler holds any curved path to 12 px across; the bow keeps a short arrow clear of that at board scale. */
const CURVE_MIN_BOW = 0.36;

/** The sampled curve, bowed to the left of travel for `side` 1 and to the right for -1. */
export function curvePoints(tail: Vec2, head: Vec2, side: number): Vec2[] {
  const dx = head.x - tail.x, dy = head.y - tail.y;
  const span = Math.hypot(dx, dy) || 1;
  const bow = Math.max(CURVE_MIN_BOW, span * 0.35);
  const along = { x: dx / span, y: dy / span };
  const control = { x: (tail.x + head.x) / 2 - along.y * side * 2 * bow, y: (tail.y + head.y) / 2 + along.x * side * 2 * bow };
  return Array.from({ length: CURVE_SAMPLES + 1 }, (_, step) => {
    const t = step / CURVE_SAMPLES;
    return {
      x: tail.x * (1 - t) ** 2 + control.x * 2 * (1 - t) * t + head.x * t * t,
      y: tail.y * (1 - t) ** 2 + control.y * 2 * (1 - t) * t + head.y * t * t,
    };
  });
}

/** One curly arrow: a multi point vector through `points`, with its helpers named `${id}_p${n}`. */
export function curlyArrow(c: ChemScene, id: string, points: readonly Vec2[]): string {
  const helpers = points.map((point, step) => c.scene.helper(`${id}_p${step}`, point, "curly arrow path helper"));
  c.scene.entities.push({ id, kind: "vector", role: "curly arrow: one electron pair moves from tail to head" });
  c.scene.constructions.push({ id: `make_${id}`, operator: "polyline", inputs: { points: helpers }, outputs: [id] });
  return id;
}
