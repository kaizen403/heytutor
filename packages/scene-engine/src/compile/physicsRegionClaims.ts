import type { RenderPoint, SceneDocument, SceneIssue } from "../types";
import type { MagneticHelixDefinition } from "./magneticHelixGeometry";
import type { Vec3 } from "../math/space";
import { spaceProofCompatibility } from "./spaceDerivations";

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

function helixRadius(value: unknown, helix: MagneticHelixDefinition): boolean {
  if (!record(value) || !record(value.spaceSegment) || value.spaceSegment.frameId !== helix.frameId) return false;
  const segment = value.spaceSegment;
  if (!record(segment.a) || !record(segment.b)) return false;
  const a = segment.a as unknown as Vec3, b = segment.b as unknown as Vec3;
  const v = helix.perpendicularVelocity, axis = helix.axis, k = helix.displayScale / helix.angularFrequency;
  const centre = { x: helix.origin.x + (v.y * axis.z - v.z * axis.y) * k, y: helix.origin.y + (v.z * axis.x - v.x * axis.z) * k, z: helix.origin.z + (v.x * axis.y - v.y * axis.x) * k };
  const radius = helix.radius * helix.displayScale;
  const tolerance = Math.max(radius * 1e-7, 64 * Number.EPSILON * Math.max(...[a, b, centre].flatMap(p => [Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)])));
  const offset = (p: Vec3): { axial: number; radial: number } => {
    const x = p.x - centre.x, y = p.y - centre.y, z = p.z - centre.z;
    const axial = x * axis.x + y * axis.y + z * axis.z;
    return { axial, radial: Math.hypot(x - axial * axis.x, y - axial * axis.y, z - axial * axis.z) };
  };
  const first = offset(a), second = offset(b);
  return Math.abs(first.axial - second.axial) <= tolerance &&
    (first.radial <= tolerance && Math.abs(second.radial - radius) <= tolerance || second.radial <= tolerance && Math.abs(first.radial - radius) <= tolerance);
}

function planarRadius(value: unknown, circle: unknown): boolean {
  const points = path(value);
  if (!points || points.length !== 2 || !record(circle) || circle.kind !== "circle" || !point(circle.center) || typeof circle.radius !== "number") return false;
  const centre = circle.center;
  const distances = points.map(p => Math.hypot(p.x - centre.x, p.y - centre.y));
  const tolerance = circle.radius * 1e-7;
  return distances[0]! <= tolerance && Math.abs(distances[1]! - circle.radius) <= tolerance || distances[1]! <= tolerance && Math.abs(distances[0]! - circle.radius) <= tolerance;
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
    if (!record(region) || region.closed !== true || !polygon || polygon.length < 3 || spaceProofCompatibility([region]) !== null) continue;
    for (const [id, value] of geometry) {
      const points = path(value);
      // This is a planar interior test. A world vector can project through a
      // region while lying outside its plane, so screen overlap proves nothing.
      if (id === regionId || !points || !record(value) || value.directed !== true || !isElectricField(id) || spaceProofCompatibility([value]) !== null) continue;
      if (points.slice(1).some((p, i) => intersectsInterior(points[i]!, p, polygon))) {
        issues.push({ code: "field_in_zero_region", message: "A nonzero electric-field arrow crosses the interior of a region explicitly labelled E = 0; place it in the nonzero-field region", severity: "fatal", entityIds: [regionId, id] });
      }
    }
  }
  // Ownership is local to the claim: an unrelated (even hidden) valid helix
  // cannot bless a circle calling itself a trajectory. Points may name a helix
  // origin without claiming to draw its path. A visible projection caption
  // makes an honest cross section, but never certifies axial pitch.
  const visibleTexts = (id: string): string[] => [document.entities.find(e => e.id === id)?.label ?? "", ...document.annotations.filter(a => a.targetIds.includes(id) && ["label", "callout"].includes(a.kind)).map(a => a.text ?? "")];
  const projections = new Set(document.entities.filter(entity => visibleTexts(entity.id).some(text => /\b(?:transverse|planar|cross[- ]section)\b.*\bprojection\b|\btransverse (?:section|cross[- ]section)\b/i.test(text)) && !visibleTexts(entity.id).some(text => /\b(?:pitch|p)\s*[=≈~]/i.test(text))).map(entity => entity.id));
  const helixes = [...geometry.values()].filter(value => record(value) && record(value.magneticHelix)).map(value => (value as { magneticHelix: MagneticHelixDefinition }).magneticHelix);
  const helixClaims = document.entities.filter(entity => ["circle", "arc", "segment", "polyline", "vector", "line"].includes(entity.kind) && /\bheli(?:x|cal)\b/i.test(`${entity.role} ${entity.label ?? ""}`));
  for (const entity of helixClaims) {
    const value = geometry.get(entity.id);
    if (record(value) && record(value.magneticHelix)) continue;
    const isRadius = /\bradius\b/i.test(entity.role);
    if (isRadius && (helixes.some(helix => helixRadius(value, helix)) || [...projections].some(id => planarRadius(value, geometry.get(id))))) continue;
    if (projections.has(entity.id)) continue;
    issues.push({ code: "helical_path_not_proven", message: "A helical trajectory needs its own source-derived world helix; a radius needs a verified relation to its axis. A visibly labelled planar projection proves no pitch or axial advance", severity: "fatal", entityIds: [entity.id] });
  }
}
