/**
 * Measures directed ink drawn on other ink in a compiled render scene.
 *
 * - `missing`: a required vector or ray entity with no directed primitive.
 * - `overlaps`: a directed stroke (vector, or a straight sign badge shaft)
 *   lying along another stroke on the same line for 12 px or more, or a ray
 *   lying along a vector. A ray along an undirected line (a light ray on an
 *   optical axis) is not counted. This covers
 *   a shaft drawn on an axis, a bank or a reference line, two heads stacked on
 *   one line, and a helper running past an arrowhead.
 * - `runPast`: the subset where an undirected stroke continues past the head.
 * - `dotsOnVector`: an unnamed point drawn on a vector's shaft between its ends.
 * - `shortShafts`: a vector whose drawn length is under 40 px.
 */
import type { RenderPrimitive, SceneDocument } from "../../src";

type P = { x: number; y: number };
interface Stroke { primitiveId: string; entityId: string; a: P; b: P; directed: boolean; ray?: boolean; marks?: string[] }
export interface DirectedOverlap { directed: string; other: string; overlapPx: number; otherDirected: boolean; runsPastHead: boolean }
export interface DirectedStrokeAudit {
  missing: string[];
  overlaps: DirectedOverlap[];
  runPast: DirectedOverlap[];
  dotsOnVector: Array<{ point: string; vector: string }>;
  shortShafts: Array<{ entity: string; lengthPx: number }>;
}

export const OVERLAP_PX = 12;
export const READABLE_SHAFT_PX = 40;
const ANGLE = Math.sin(2.5 * Math.PI / 180);
const OFF_LINE_PX = 3;

const len = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y);

function strokesOf(primitive: RenderPrimitive, document: SceneDocument): Stroke[] {
  if (primitive.provenance?.labelLeader === true) return [];
  const points = primitive.points;
  const entity = document.entities.find((candidate) => candidate.id === primitive.entityId);
  const badge = entity?.kind === "sign_badge";
  const segments = (list: P[], closed: boolean, directedLast: boolean): Stroke[] => {
    const out: Stroke[] = [];
    const count = closed ? list.length : list.length - 1;
    for (let index = 0; index < count; index += 1) {
      const a = list[index]!; const b = list[(index + 1) % list.length]!;
      if (len(a, b) < 0.5) continue;
      out.push({ primitiveId: primitive.id, entityId: primitive.entityId, a, b, directed: directedLast && index === count - 1 });
    }
    return out;
  };
  switch (primitive.kind) {
    case "vector": case "ray": {
      // A directed curve is one stroke per vertex pair; only its last segment carries the head.
      const straight = points.length >= 2 ? [{ primitiveId: primitive.id, entityId: primitive.entityId, a: points[0]!, b: points.at(-1)!, directed: true }] : [];
      return points.length === 2 ? straight : segments(points, false, true);
    }
    case "line": case "dimension": return segments(points.slice(0, 2), false, false);
    case "polyline": {
      // A sign badge is a shaft plus two head strokes; its shaft is directed ink.
      if (badge && primitive.id.endsWith("_0") && points.length === 2) return [{ primitiveId: primitive.id, entityId: primitive.entityId, a: points[0]!, b: points[1]!, directed: true }];
      if (badge) return [];
      // A sampled curve is not a line (a tangent velocity leaves it); a sampled straight path is.
      if (points.length > 2 && !points.every((point) => offLine(point, points[0]!, unit(points[0]!, points.at(-1)!)) <= 1.5)) return [];
      return mergeCollinear(segments(points, false, false));
    }
    case "polygon": case "rectangle": return segments(points, true, false);
    case "axes": return points.length === 4
      ? [{ primitiveId: primitive.id, entityId: primitive.entityId, a: points[0]!, b: points[1]!, directed: false }, { primitiveId: primitive.id, entityId: primitive.entityId, a: points[2]!, b: points[3]!, directed: false }]
      : [];
    default: return [];
  }
}

/** Sampled polylines are many short chords; merge the straight runs. */
function mergeCollinear(segments: Stroke[]): Array<Stroke & { chords: number }> {
  const out: Array<Stroke & { chords: number }> = [];
  for (const segment of segments) {
    const last = out.at(-1);
    if (last && Math.abs(cross(unit(last.a, last.b), unit(segment.a, segment.b))) < ANGLE && len(last.b, segment.a) < 0.5) { last.b = segment.b; last.chords += 1; }
    else out.push({ ...segment, chords: 1 });
  }
  return out;
}
function unit(a: P, b: P): P { const l = len(a, b) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; }
function cross(u: P, v: P): number { return u.x * v.y - u.y * v.x; }
function offLine(point: P, a: P, u: P): number { return Math.abs(cross(u, { x: point.x - a.x, y: point.y - a.y })); }
function along(point: P, a: P, u: P): number { return u.x * (point.x - a.x) + u.y * (point.y - a.y); }

export function collinearOverlap(d: { a: P; b: P }, s: { a: P; b: P }): { overlap: number; runsPastHead: boolean } | null {
  const u = unit(d.a, d.b);
  if (Math.abs(cross(u, unit(s.a, s.b))) > ANGLE) return null;
  if (offLine(s.a, d.a, u) > OFF_LINE_PX || offLine(s.b, d.a, u) > OFF_LINE_PX) return null;
  const head = len(d.a, d.b);
  const t0 = Math.min(along(s.a, d.a, u), along(s.b, d.a, u));
  const t1 = Math.max(along(s.a, d.a, u), along(s.b, d.a, u));
  const overlap = Math.min(head, t1) - Math.max(0, t0);
  return { overlap, runsPastHead: overlap > 0 && t0 < head - 1 && t1 > head + OFF_LINE_PX };
}

export function auditDirectedStrokes(document: SceneDocument, primitives: RenderPrimitive[]): DirectedStrokeAudit {
  // A trace or highlight annotation follows its target's own ink by design.
  const strokes = primitives.flatMap((primitive) => {
    const annotation = document.annotations.find((candidate) => candidate.id === primitive.provenance?.annotationId);
    return strokesOf(primitive, document).map((stroke) => ({ ...stroke, ray: primitive.kind === "ray", marks: annotation?.targetIds }));
  });
  const directed = strokes.filter((stroke) => stroke.directed);
  const overlaps: DirectedOverlap[] = [];
  for (const d of directed) {
    for (const s of strokes) {
      if (s === d || s.entityId === d.entityId || s.marks?.includes(d.entityId) || d.marks?.includes(s.entityId)) continue;
      // A light ray along an optical axis is on it; rays are judged only beside a vector.
      if (d.ray && (!s.directed || s.ray)) continue;
      if (s.ray && !d.directed) continue;
      const measured = collinearOverlap(d, s);
      if (!measured || measured.overlap < OVERLAP_PX) continue;
      // One arrow drawn twice (same tail, same head) hides and stacks nothing.
      if (s.directed && len(d.a, s.a) <= 1.5 && len(d.b, s.b) <= 1.5) continue;
      // Report each directed pair once.
      if (s.directed && overlaps.some((o) => o.directed === s.entityId && o.other === d.entityId)) continue;
      overlaps.push({ directed: d.entityId, other: s.entityId, overlapPx: Math.round(measured.overlap), otherDirected: s.directed, runsPastHead: !s.directed && measured.runsPastHead });
    }
  }
  const visible = new Set(document.revealGroups.flatMap((group) => group.entityIds));
  const required = new Set(document.requiredEntityIds);
  const missing = document.entities
    .filter((entity) => (entity.kind === "vector" || entity.kind === "ray") && required.has(entity.id) && visible.has(entity.id))
    .filter((entity) => !primitives.some((primitive) => primitive.entityId === entity.id && (primitive.kind === "vector" || primitive.kind === "ray")))
    .map((entity) => entity.id);
  const named = (id: string) => Boolean(document.entities.find((entity) => entity.id === id)?.label?.trim()) ||
    document.annotations.some((annotation) => (annotation.kind === "label" || annotation.kind === "callout") && annotation.targetIds.includes(id) && Boolean(annotation.text?.trim()));
  const dotsOnVector: DirectedStrokeAudit["dotsOnVector"] = [];
  for (const point of primitives.filter((primitive) => primitive.kind === "point" && primitive.points.length === 1)) {
    if (named(point.entityId)) continue;
    const at = point.points[0]!;
    for (const vector of primitives.filter((primitive) => primitive.kind === "vector" && primitive.points.length === 2)) {
      const [a, b] = vector.points as [P, P];
      const u = unit(a, b);
      const t = along(at, a, u);
      if (offLine(at, a, u) <= OFF_LINE_PX && t > OFF_LINE_PX + 1 && t < len(a, b) - OFF_LINE_PX - 1) dotsOnVector.push({ point: point.entityId, vector: vector.entityId });
    }
  }
  const shortShafts = primitives
    .filter((primitive) => primitive.kind === "vector" && primitive.points.length === 2 && document.entities.some((entity) => entity.id === primitive.entityId && entity.kind === "vector"))
    .map((primitive) => ({ entity: primitive.entityId, lengthPx: Math.round(len(primitive.points[0]!, primitive.points[1]!)) }))
    .filter((entry) => entry.lengthPx < READABLE_SHAFT_PX);
  return { missing, overlaps, runPast: overlaps.filter((overlap) => overlap.runsPastHead), dotsOnVector, shortShafts };
}
