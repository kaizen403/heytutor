/**
 * Truth checks on drawn features that labels and dimensions rely on.
 *
 * - A dimension must end at something drawn: a point, a stroke's vertex or
 *   end, or a stroke crossing it. A line running along the dimension (the
 *   principal axis under an object distance) is not an end.
 * - A field line is a smooth curve. A few straight sides meeting at sharp
 *   corners draws a polygon, which no field line is.
 * - A label naming a point must sit nearer that point than any stroke that
 *   does not pass through it ("O" beside the loop, not at its centre).
 */
import type { RenderPrimitive, SceneDocument, SceneIssue } from "../types";
import { isPointIdentifierText } from "./pointLabelText";
import { circularStrokeDistance } from "./circularStrokeDistance";

type Point = { x: number; y: number };
const gap = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function segments(primitive: RenderPrimitive): Array<[Point, Point]> {
  const points = primitive.points;
  const closed = primitive.kind === "polygon" || primitive.kind === "rectangle";
  const pairs: Array<[Point, Point]> = points.slice(1).map((b, i) => [points[i]!, b]);
  if (closed && points.length > 2) pairs.push([points.at(-1)!, points[0]!]);
  return pairs;
}
const STROKES = new Set(["line", "polyline", "polygon", "rectangle", "arrow", "vector", "segment", "ray", "curve", "path"]);

export function validateDimensionAnchors(primitives: RenderPrimitive[]): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const ink = primitives.filter((p) => p.kind !== "label" && p.kind !== "dimension" && !p.provenance?.labelLeader && p.provenance?.fillOnly !== true);
  for (const dimension of primitives.filter((p) => p.kind === "dimension" && p.points.length >= 2)) {
    const [barStart, barEnd] = [dimension.points[0]!, dimension.points.at(-1)!];
    const along = Math.atan2(barEnd.y - barStart.y, barEnd.x - barStart.x);
    // An offset dimension measures what its witness lines reach: the end of
    // each witness farther from the bar. Without witnesses, the bar's own ends.
    const witnesses = primitives.filter((p) => p.entityId === dimension.entityId && p.kind === "line" && p.points.length >= 2);
    const far = (w: RenderPrimitive) => [w.points[0]!, w.points.at(-1)!].sort((p, q) => segmentDistance(q, barStart, barEnd) - segmentDistance(p, barStart, barEnd))[0]!;
    const [a, b] = witnesses.length >= 2 ? [far(witnesses[0]!), far(witnesses[1]!)] : [barStart, barEnd];
    const anchored = (end: Point) => ink.some((p) => {
      if (p.entityId === dimension.entityId) return false;
      if (p.kind === "point") return p.points[0] !== undefined && gap(end, p.points[0]) <= 4;
      if (p.kind === "circle" || p.kind === "arc") return circularStrokeDistance(end, p) <= 3;
      if (p.kind === "axes") {
        // The renderer draws two independent finite strokes, never the
        // bounding box or the connector between the x and y strokes.
        if (p.points.length !== 4) return false;
        return [[p.points[0]!, p.points[1]!], [p.points[2]!, p.points[3]!]].some(([s, t]) => {
          if (!s || !t || gap(s, t) <= 0 || segmentDistance(end, s, t) > 3) return false;
          const angle = Math.abs(Math.atan2(t.y - s.y, t.x - s.x) - along) % Math.PI;
          return Math.min(angle, Math.PI - angle) > (20 * Math.PI) / 180;
        });
      }
      if (!STROKES.has(p.kind)) return false;
      if (p.points.some((q) => gap(end, q) <= 4)) return true; // a vertex or end
      return segments(p).some(([s, t]) => {
        if (segmentDistance(end, s, t) > 3) return false;
        const angle = Math.abs(Math.atan2(t.y - s.y, t.x - s.x) - along) % Math.PI;
        return Math.min(angle, Math.PI - angle) > (20 * Math.PI) / 180; // crosses, not along
      });
    });
    if (!anchored(a) || !anchored(b)) {
      issues.push({ code: "dimension_end_unanchored", severity: "fatal", failureKind: "truth", entityIds: [dimension.entityId],
        message: "A dimension ends where nothing is drawn, so it measures nothing the student can see" });
    }
  }
  return issues;
}

export function validateFieldLineShape(document: SceneDocument, primitives: RenderPrimitive[]): SceneIssue[] {
  const fieldLine = /\b(?:field|flux|force)\s*lines?\b|\blines?\s+of\s+(?:force|flux)\b/i;
  const ids = new Set(document.entities.filter((entity) => fieldLine.test(entity.role ?? "")).map((entity) => entity.id));
  const issues: SceneIssue[] = [];
  for (const id of ids) {
    const strokes = primitives.filter((p) => p.entityId === id && STROKES.has(p.kind) && p.points.length >= 3);
    const sharp = strokes.some((p) => {
      // Sample count is not smoothness: subdividing a polygon's straight sides
      // leaves its corner turns unchanged. Ignore zero-length samples so they
      // cannot invent a direction or hide the turn at a repeated vertex.
      const points = p.points.filter((point, i, all) => i === 0 || point.x !== all[i - 1]!.x || point.y !== all[i - 1]!.y);
      return points.slice(1, -1).some((q, i) => {
        const before = points[i]!, after = points[i + 2]!;
        const a1 = Math.atan2(q.y - before.y, q.x - before.x), a2 = Math.atan2(after.y - q.y, after.x - q.x);
        let turn = Math.abs(a2 - a1) % (2 * Math.PI);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        return turn > (35 * Math.PI) / 180;
      });
    });
    if (sharp) {
      issues.push({ code: "field_line_polygon", severity: "fatal", failureKind: "truth", entityIds: [id],
        message: "A field line is drawn as straight sides with sharp corners; field lines are smooth curves" });
    }
  }
  return issues;
}

export function validatePointLabelPlacement(document: SceneDocument, primitives: RenderPrimitive[]): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const ink = primitives.filter((p) => p.kind !== "label" && !p.provenance?.labelLeader && p.provenance?.fillOnly !== true);
  for (const label of primitives) {
    if (label.kind !== "label" || !label.points[0] || label.provenance?.usesLeader || label.provenance?.summary) continue;
    // Only a name (O, C, P, F₁) claims to be at its point; a value label is not judged here.
    if (!isPointIdentifierText(label.text ?? "")) continue;
    const annotationId = label.provenance?.annotationId;
    const annotationIndex = document.annotations.findIndex((a) => a.id === annotationId);
    const owners = document.annotations[annotationIndex]?.targetIds ?? [label.entityId];
    if (owners.length !== 1) continue;
    const owner = ink.find((p) => p.entityId === owners[0] && p.kind === "point" && p.points[0]);
    if (!owner) continue;
    const dot = owner.points[0]!, at = label.points[0];
    const own = gap(at, dot);
    // Strokes that pass through the point (lines meeting at it) share its neighbourhood.
    const nearer = ink.some((p) => {
      if (owners.includes(p.entityId) || p.kind === "point") return false;
      if (p.kind === "circle" || p.kind === "arc") {
        if (circularStrokeDistance(dot, p) <= 3) return false;
        return circularStrokeDistance(at, p) + 4 < own;
      }
      if (!STROKES.has(p.kind)) return false;
      const pairs = segments(p);
      if (pairs.some(([s, t]) => segmentDistance(dot, s, t) <= 3)) return false;
      return pairs.some(([s, t]) => segmentDistance(at, s, t) + 4 < own);
    });
    if (nearer) {
      const entityIndex = document.entities.findIndex((e) => e.id === owners[0]);
      issues.push({ code: "label_owner_ambiguous", severity: "fatal", failureKind: "proof", entityIds: owners,
        ...(annotationIndex >= 0 ? { path: `annotations[${annotationIndex}].text` } : entityIndex >= 0 ? { path: `entities[${entityIndex}].label` } : {}),
        message: "A point name sits nearer another stroke than the point it names" });
    }
  }
  return issues;
}

/** A figure drawn smaller than this, edge to edge, cannot be read: its labels
 * and marks overlap whatever they name. */
const MIN_READABLE_FIGURE_PX = 100;

export function validateFigureLegibility(primitives: RenderPrimitive[]): SceneIssue[] {
  const xs: number[] = [], ys: number[] = [];
  for (const p of primitives) {
    if (p.kind === "label" || p.provenance?.labelLeader) continue;
    for (const q of p.points) { xs.push(q.x); ys.push(q.y); }
    if ((p.kind === "circle" || p.kind === "arc") && p.points[0]) {
      const r = p.radius ?? 0; xs.push(p.points[0].x - r, p.points[0].x + r); ys.push(p.points[0].y - r, p.points[0].y + r);
    }
  }
  if (xs.length < 2) return [];
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return extent < MIN_READABLE_FIGURE_PX ? [{ code: "figure_illegible", severity: "fatal", failureKind: "truth",
    message: `The figure is drawn ${Math.round(extent)} px across; its labels cannot be read against what they name` }] : [];
}

/** A space frame names its axes x, y, z; each name must sit nearest its own axis line. */
export function validateAxisNamePlacement(primitives: RenderPrimitive[]): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const label of primitives) {
    const match = /^(.*)_label_([xyz])$/.exec(label.id);
    if (label.kind !== "label" || !match || !label.points[0]) continue;
    const lines = [0, 1, 2].map((index) => primitives.find((p) => p.id === `${match[1]}_${index}` && p.points.length >= 2));
    if (lines.some((line) => !line)) continue;
    const own = "xyz".indexOf(match[2]!);
    const distanceTo = (line: RenderPrimitive) => Math.min(...segments(line).map(([s, t]) => segmentDistance(label.points[0]!, s, t)));
    const ownDistance = distanceTo(lines[own]!);
    if (lines.some((line, index) => index !== own && distanceTo(line!) + 4 < ownDistance)) {
      issues.push({ code: "label_owner_ambiguous", severity: "fatal", failureKind: "proof", entityIds: [label.entityId],
        message: `The ${match[2]} axis name sits nearer another axis than its own` });
    }
  }
  return issues;
}

/** An angle mark's name must sit inside the wedge its arc spans from the vertex. */
export function validateAngleLabelWedge(
  document: SceneDocument,
  primitives: RenderPrimitive[],
  pointAliases: ReadonlyMap<string, string> = new Map(),
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const marks = document.entities.filter((entity) => entity.kind === "angle_mark");
  const renderedPoint = (id: string | undefined): Point | undefined => {
    if (!id) return undefined;
    const direct = primitives.find((p) => p.entityId === id && p.kind === "point")?.points[0];
    if (direct) return direct;
    const renderedId = pointAliases.get(id);
    return renderedId ? primitives.find((p) => p.entityId === renderedId && p.kind === "point")?.points[0] : undefined;
  };
  for (const mark of marks) {
    const construction = document.constructions.find((c) => c.outputs.includes(mark.id));
    const vertexId = typeof construction?.inputs.vertex === "string" ? construction.inputs.vertex : undefined;
    // A 2D angle mark renders an arc (screen angles from startAngle to endAngle);
    // a 3D one renders a sampled polyline. Both reduce to points along the arc.
    const arcPrimitive = primitives.find((p) => p.entityId === mark.id && p.kind === "arc" && p.points[0] && p.startAngle !== undefined && p.endAngle !== undefined);
    const arc = arcPrimitive
      ? { points: [arcPrimitive.startAngle!, (arcPrimitive.startAngle! + arcPrimitive.endAngle!) / 2, arcPrimitive.endAngle!].map((a) => ({ x: arcPrimitive.points[0]!.x + (arcPrimitive.radius ?? 0) * Math.cos(a), y: arcPrimitive.points[0]!.y + (arcPrimitive.radius ?? 0) * Math.sin(a) })) }
      : primitives.find((p) => p.entityId === mark.id && p.kind === "polyline" && p.points.length >= 3);
    const vertex = arcPrimitive?.points[0] ?? renderedPoint(vertexId);
    const labels = primitives.filter((p) => p.kind === "label" && !p.provenance?.usesLeader && p.points[0] && (p.entityId === mark.id ||
      (document.annotations ?? []).some((annotation) => annotation.id === p.provenance?.annotationId && annotation.targetIds.length === 1 && annotation.targetIds[0] === mark.id)));
    if (!vertex || !arc || labels.length === 0) continue;
    const angleOf = (p: Point) => Math.atan2(p.y - vertex.y, p.x - vertex.x);
    const start = angleOf(arc.points[0]!), middle = angleOf(arc.points[Math.floor(arc.points.length / 2)]!), end = angleOf(arc.points.at(-1)!);
    const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const ccw = norm(middle - start) <= norm(end - start);
    const span = ccw ? norm(end - start) : norm(start - end);
    const margin = (15 * Math.PI) / 180;
    for (const label of labels) {
      const offset = ccw ? norm(angleOf(label.points[0]!) - start) : norm(start - angleOf(label.points[0]!));
      const inside = offset <= span + margin || offset >= 2 * Math.PI - margin;
      if (inside) continue;
      const annotationIndex = (document.annotations ?? []).findIndex((annotation) => annotation.id === label.provenance?.annotationId);
      const index = document.entities.findIndex((entity) => entity.id === mark.id);
      const path = annotationIndex >= 0 ? `annotations[${annotationIndex}].text` : index >= 0 && document.entities[index]!.label ? `entities[${index}].label` : undefined;
      issues.push({ code: "label_owner_ambiguous", severity: "fatal", failureKind: "proof", entityIds: [mark.id],
        ...(path ? { path } : {}), expected: "angle_wedge", message: "An angle name sits outside the wedge its arc marks" });
    }
  }
  return issues;
}
