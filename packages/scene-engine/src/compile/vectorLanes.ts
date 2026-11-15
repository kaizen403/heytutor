import { chargeLayoutSteps } from "./figureWork";
import type { RenderPrimitive, SceneDocument } from "../types";

type View = { x: number; y: number; width: number; height: number };

/** Screen endpoints are rounded to 0.01 px. Each direction component can
 * therefore differ from its exact value by 0.01 px (two endpoint errors).
 * Bound the resulting cross-product error; this is a display overlap test,
 * never a tolerance for proving a physical angle or moving an angle arm.
 */
function parallelAfterRounding(dx: number, dy: number, ox: number, oy: number): boolean {
  const componentError = 0.01;
  const crossError = componentError * (Math.abs(dx) + Math.abs(dy) + Math.abs(ox) + Math.abs(oy))
    + 2 * componentError ** 2;
  return Math.abs(dx * oy - dy * ox) <= crossError;
}

/** Two named free arrows may share a physical origin and direction. Translate
 * only their display shafts, retaining their lengths/senses and a dashed
 * witness to the exact origin. Never translate rays, derived physical states,
 * angle arms, endpoint constructions, or arrows with different origins.
 */
export function separateSharedOriginVectors(document: SceneDocument, primitives: RenderPrimitive[], viewport: View): void {
  const producers = new Map(document.constructions.flatMap(c => c.outputs.map(id => [id, c] as const)));
  const referenced = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") referenced.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  document.constructions.forEach(c => visit(c.inputs));
  const arrows = primitives.filter(p => p.kind === "vector" && p.points.length === 2 && !p.provenance?.annotationId);
  const named = new Set(document.entities.filter(e => e.label?.trim()).map(e => e.id));
  for (const annotation of document.annotations) {
    if ((annotation.kind === "label" || annotation.kind === "callout") && (annotation.text?.trim() || annotation.quantityId) && annotation.targetIds[0]) named.add(annotation.targetIds[0]);
  }
  const eligible = (p: RenderPrimitive) => {
    const producer = producers.get(p.entityId);
    return producer?.operator === "vector" &&
      // A witness to the origin cannot preserve a bound tip's incidence.
      !["end", "to", "b"].some(key => producer.inputs[key] !== undefined) &&
      !referenced.has(p.entityId) && named.has(p.entityId);
  };
  for (let i = 1; i < arrows.length; i++) {
    const arrow = arrows[i]!;
    if (!eligible(arrow)) continue;
    const [a, b] = arrow.points as [typeof arrow.points[number], typeof arrow.points[number]];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!(length > 6)) continue;
    const start = producers.get(arrow.entityId)?.inputs.start;
    const overlaps = arrows.slice(0, i).some(other => {
      chargeLayoutSteps(1, "shared-origin vector lanes");
      if (!eligible(other) || arrow.groupId !== other.groupId || typeof start !== "string" || producers.get(other.entityId)?.inputs.start !== start) return false;
      const [c, d] = other.points as [typeof a, typeof a];
      const ox = d.x - c.x, oy = d.y - c.y;
      return Math.hypot(c.x - a.x, c.y - a.y) < 0.01 &&
        parallelAfterRounding(dx, dy, ox, oy) && dx * ox + dy * oy > 0;
    });
    if (!overlaps) continue;
    for (const lane of [14, -14, 28, -28, 42, -42]) {
      const shift = { x: -dy / length * lane, y: dx / length * lane };
      const points = [a, b].map(p => ({ x: p.x + shift.x, y: p.y + shift.y }));
      if (points.some(p => p.x < viewport.x + 4 || p.x > viewport.x + viewport.width - 4 || p.y < viewport.y + 4 || p.y > viewport.y + viewport.height - 4)) continue;
      // Keep the new shaft off all other parallel shafts, including lanes
      // allocated earlier in this pass. The final ink validator still runs.
      const conflicts = arrows.some(other => {
        chargeLayoutSteps(1, "shared-origin vector lanes");
        if (other === arrow) return false;
        const [c, d] = other.points as [typeof a, typeof a];
        const ox = d.x - c.x, oy = d.y - c.y;
        if (!parallelAfterRounding(dx, dy, ox, oy)) return false;
        const gap = Math.abs(dx * (c.y - points[0]!.y) - dy * (c.x - points[0]!.x)) / length;
        return gap < 8;
      });
      if (conflicts) continue;
      arrow.points = points;
      arrow.provenance = { ...arrow.provenance, vectorLane: true, physicalStart: { ...a }, physicalEnd: { ...b } };
      primitives.push({ id: `${arrow.id}_origin_witness`, entityId: arrow.entityId, groupId: arrow.groupId, kind: "line", points: [{ ...a }, points[0]!], provenance: { dashed: true, strokeRole: "construction", vectorOriginWitness: true } });
      break;
    }
  }
}
