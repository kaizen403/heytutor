import type { RenderPoint, SceneDocument, SceneIssue } from "../types";

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function point(value: unknown): value is RenderPoint { return record(value) && typeof value.x === "number" && typeof value.y === "number"; }
function path(value: unknown): RenderPoint[] | null { return record(value) && value.kind === "path" && Array.isArray(value.points) && value.points.every(point) ? value.points : null; }
const fieldUnit = (value: unknown): boolean => typeof value === "string" && ["V/m", "N/C"].includes(value.replace(/\s+/g, ""));
const cross = (a: RenderPoint, b: RenderPoint): number => a.x * b.y - a.y * b.x;
const sub = (a: RenderPoint, b: RenderPoint): RenderPoint => ({ x: a.x - b.x, y: a.y - b.y });

/** Strict interior test: an interface mark may lie on the zero-field boundary. */
function inside(p: RenderPoint, polygon: RenderPoint[], tolerance: number): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!, b = polygon[i]!, edge = sub(b, a), delta = sub(p, a);
    const span = Math.hypot(edge.x, edge.y);
    const along = delta.x * edge.x + delta.y * edge.y;
    if (span > 0 && Math.abs(cross(edge, delta)) <= tolerance * span && along >= -tolerance * span && along <= span * span + tolerance * span) return false;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
function intersectsInterior(a: RenderPoint, b: RenderPoint, polygon: RenderPoint[]): boolean {
  const scale = Math.max(...polygon.map((p, i) => Math.hypot(p.x - polygon[(i + 1) % polygon.length]!.x, p.y - polygon[(i + 1) % polygon.length]!.y)));
  const tolerance = Math.max(scale * 1e-10, 64 * Number.EPSILON * Math.max(...polygon.flatMap(p => [Math.abs(p.x), Math.abs(p.y)])));
  if (inside(a, polygon, tolerance) || inside(b, polygon, tolerance)) return true;
  const direction = sub(b, a), crossings = [0, 1];
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i]!, d = polygon[(i + 1) % polygon.length]!, edge = sub(d, c);
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) <= tolerance * Math.max(Math.hypot(direction.x, direction.y), Math.hypot(edge.x, edge.y))) continue;
    const offset = sub(c, a), t = cross(offset, edge) / denominator, u = cross(offset, direction) / denominator;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) crossings.push(t);
  }
  crossings.sort((x, y) => x - y);
  return crossings.slice(1).some((end, i) => {
    const t = (crossings[i]! + end) / 2;
    return inside({ x: a.x + direction.x * t, y: a.y + direction.y * t }, polygon, tolerance);
  });
}

/** Check explicit semantic claims against constructed geometry, never topics. */
export function validatePhysicsRegionClaims(document: SceneDocument, geometry: ReadonlyMap<string, unknown>, number: (value: unknown) => number, issues: SceneIssue[]): void {
  const zeroRegions = new Set<string>();
  for (const annotation of document.annotations) {
    if (!["label", "callout"].includes(annotation.kind) || !annotation.quantityId) continue;
    const quantity = document.quantities.find(q => q.id === annotation.quantityId);
    if (!quantity || !fieldUnit(quantity.unit)) continue;
    try { if (number(quantity.id) === 0) annotation.targetIds.forEach(id => zeroRegions.add(id)); } catch { /* Invalid quantities fail their existing authority checks. */ }
  }
  const isElectricField = (id: string): boolean => {
    const entity = document.entities.find(e => e.id === id);
    const semantic = `${entity?.role ?? ""} ${entity?.label ?? ""}`.replaceAll("_", " ");
    if (/\bmagnetic\b|^\s*B(?:\s|$)/i.test(semantic)) return false;
    if (/\b(?:electric|electrostatic)\s+field\b|\bE(?:\s|$)/.test(semantic)) return true;
    return document.annotations.some(annotation => annotation.targetIds.includes(id) && fieldUnit(document.quantities.find(q => q.id === annotation.quantityId)?.unit));
  };
  for (const regionId of zeroRegions) {
    const region = geometry.get(regionId), polygon = path(region);
    if (!record(region) || region.closed !== true || !polygon || polygon.length < 3) continue;
    for (const [id, value] of geometry) {
      const points = path(value);
      if (id === regionId || !points || !record(value) || value.directed !== true || !isElectricField(id)) continue;
      if (points.slice(1).some((p, i) => intersectsInterior(points[i]!, p, polygon))) {
        issues.push({ code: "field_in_zero_region", message: "A nonzero electric-field arrow crosses the interior of a region explicitly labelled E = 0; place it in the nonzero-field region", severity: "fatal", entityIds: [regionId, id] });
      }
    }
  }
  // A radius/trajectory explicitly called helical cannot be certified by a
  // planar circle plus narration. Only constructed world helix metadata proves
  // axial advance. Unrelated circles and projections remain valid diagrams.
  const helixClaims = document.entities.filter(entity => /\bheli(?:x|cal)\b/i.test(`${entity.role} ${entity.label ?? ""}`));
  if (helixClaims.length && ![...geometry.values()].some(value => record(value) && record(value.magneticHelix))) {
    issues.push({ code: "helical_path_not_proven", message: "A helical trajectory claim requires source-derived world helix geometry; a planar projection cannot prove pitch or axial advance", severity: "fatal", entityIds: helixClaims.map(entity => entity.id) });
  }
}
