import type { RenderPrimitive, SceneDocument, SceneIssue } from "../types";
import { circularStrokeDistance } from "./circularStrokeDistance";
type Point = { x: number; y: number };
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x-a.x, dy = b.y-a.y;
  const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function insidePolygon(p: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside = !inside;
  }
  return inside;
}
function distance(p: Point, primitive: RenderPrimitive, owner = false): number {
  const first = primitive.points[0];
  if (!first) return Infinity;
  if (primitive.kind === "point") return Math.hypot(p.x-first.x,p.y-first.y);
  if (primitive.kind === "circle" || primitive.kind === "arc") {
    if (primitive.kind === "circle" && owner && Math.hypot(p.x-first.x,p.y-first.y) <= (primitive.radius ?? 0)) return 0;
    return circularStrokeDistance(p, primitive);
  }
  if (primitive.kind === "axes") {
    const points = primitive.points;
    return points.length === 4 ? Math.min(segmentDistance(p,points[0]!,points[1]!),segmentDistance(p,points[2]!,points[3]!)) : Infinity;
  }
  let points = primitive.points;
  if (primitive.kind === "rectangle") {
    const xs = points.map(q => q.x), ys = points.map(q => q.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    points = [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
  }
  const closed = primitive.kind === "polygon" || primitive.kind === "rectangle";
  // An interior name can identify its region without hugging its boundary.
  if (owner && closed && insidePolygon(p,points)) return 0;
  const distances = points.slice(1).map((b,i) => segmentDistance(p,points[i]!,b));
  if (closed && points.length > 2) distances.push(segmentDistance(p,points.at(-1)!,points[0]!));
  return Math.min(...distances);
}
const STRAIGHT_LINE_NAME_MARGIN_PX = 4;
/** A name whose box is this close to another stroke reads as that stroke's. */
const STRAIGHT_LINE_NAME_RIVAL_PX = 35;
type Box = { x: number; y: number; width: number; height: number };
function labelBox(label: RenderPrimitive): Box | null {
  const bounds = label.provenance?.labelBounds as Partial<Box> | undefined;
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(value => typeof value === "number" && Number.isFinite(value))) return null;
  return bounds as Box;
}
function pointBoxDistance(p: Point, box: Box): number {
  return Math.hypot(Math.max(box.x - p.x, 0, p.x - (box.x + box.width)), Math.max(box.y - p.y, 0, p.y - (box.y + box.height)));
}
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}
/** The straight pieces a primitive is stroked with. An arc is cut into chords of at most a pixel, within 1/(8r) px of its ink. */
export function strokePieces(primitive: RenderPrimitive): Array<[Point, Point]> {
  let points = primitive.points;
  if (!points.length) return [];
  if (primitive.kind === "axes" && points.length === 4) return [[points[0]!, points[1]!], [points[2]!, points[3]!]];
  if (primitive.kind === "arc" || primitive.kind === "circle") {
    const centre = points[0]!, radius = primitive.radius ?? 0;
    const start = primitive.kind === "circle" ? 0 : primitive.startAngle ?? 0;
    const sweep = primitive.kind === "circle" ? 2 * Math.PI : (primitive.endAngle ?? start) - start;
    const count = Math.min(4096, Math.max(8, Math.ceil(Math.abs(sweep) * radius)));
    points = Array.from({ length: count + 1 }, (_, index) => {
      const angle = start + sweep * index / count;
      return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
    });
  } else if (points.length === 1 || primitive.kind === "point") return [[points[0]!, points[0]!]];
  else if (primitive.kind === "rectangle") {
    const xs = points.map(q => q.x), ys = points.map(q => q.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    points = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }
  const pieces = points.slice(1).map((point, index) => [points[index]!, point] as [Point, Point]);
  if ((primitive.kind === "polygon" || primitive.kind === "rectangle") && points.length > 2) pieces.push([points.at(-1)!, points[0]!]);
  return pieces;
}
/** Distance from a box to a stroke: 0 when they touch, else the nearest gap between the box edges and the stroke. */
function boxDistance(box: Box, primitive: RenderPrimitive): number {
  const corners = [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }];
  if (primitive.kind === "circle" && primitive.points[0]) {
    // The circle's ink, not its centre: the gap from the box to the ring, inside or out.
    const centre = primitive.points[0], radius = primitive.radius ?? 0;
    const nearest = pointBoxDistance(centre, box), farthest = Math.max(...corners.map(corner => Math.hypot(corner.x - centre.x, corner.y - centre.y)));
    return radius < nearest ? nearest - radius : radius > farthest ? radius - farthest : 0;
  }
  const edges = corners.map((corner, index) => [corner, corners[(index + 1) % 4]!] as const);
  let best = Infinity;
  for (const [a, b] of strokePieces(primitive)) {
    if (pointBoxDistance(a, box) === 0 || pointBoxDistance(b, box) === 0) return 0;
    if (edges.some(([c, d]) => segmentsCross(a, b, c, d))) return 0;
    best = Math.min(best, pointBoxDistance(a, box), pointBoxDistance(b, box), ...corners.map(corner => segmentDistance(corner, a, b)));
  }
  return best;
}
/** A polyline of many samples that is one straight line, within a pixel. */
function isStraightSampledPolyline(primitive: RenderPrimitive): boolean {
  const points = primitive.points;
  if (primitive.kind !== "polyline" || points.length <= 3) return false;
  const start = points[0]!, end = points.at(-1)!;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(length > 1)) return false;
  return points.every(p => Math.abs((p.x - start.x) * (end.y - start.y) - (p.y - start.y) * (end.x - start.x)) / length <= 0.75);
}

/**
 * A straight line drawn as a sampled polyline (a graph of y = mx + c) is read
 * like any straight stroke: an untethered name nearer another stroke than its
 * own line, and close to it, names that stroke. Live candidate validation
 * only (with figure consistency), so verified_parts omits the name from a new
 * figure; a saved figure is not refused for it.
 */
export function validateStraightLineNames(document: SceneDocument, primitives: RenderPrimitive[]): SceneIssue[] {
  const ink = primitives.filter(p => p.kind !== "label" && !p.provenance?.labelLeader);
  const issues: SceneIssue[] = [];
  for (const label of primitives) {
    if (label.kind !== "label" || !label.points[0] || label.provenance?.usesLeader) continue;
    const annotationId = label.provenance?.annotationId ?? (document.annotations.some(a => a.id === label.id) ? label.id : undefined);
    const annotationIndex = document.annotations.findIndex(a => a.id === annotationId);
    const annotation = document.annotations[annotationIndex];
    const owners = annotation?.targetIds ?? [label.entityId];
    const own = ink.filter(p => owners.includes(p.entityId));
    if (!own.length || !own.every(isStraightSampledPolyline)) continue;
    // Measured from the lettered box, not its anchor: a name is read by where its ink sits.
    const box = labelBox(label);
    if (!box) continue;
    const ownDistance = Math.min(...own.map(p => boxDistance(box, p)));
    // An axis is named at its ends, so a line's name beside one still reads as a plotted line's: not a rival.
    const nearest = Math.min(...ink.filter(p => !owners.includes(p.entityId) && p.kind !== "axes").map(p => boxDistance(box, p)));
    // A name floating clear of every stroke is read by elimination; one that hugs another stroke names it.
    if (!(nearest <= STRAIGHT_LINE_NAME_RIVAL_PX && nearest + STRAIGHT_LINE_NAME_MARGIN_PX < ownDistance)) continue;
    const entityIndex = document.entities.findIndex(e => e.id === label.entityId);
    issues.push({ code: "label_owner_ambiguous", severity: "fatal", failureKind: "proof", entityIds: owners,
      ...(annotation ? { path: `annotations[${annotationIndex}].text` } : entityIndex >= 0 ? { path: `entities[${entityIndex}].label` } : {}),
      message: "A straight line's name sits nearer another stroke than its own line.", expected: ownDistance, actual: nearest });
  }
  return issues;
}

/**
 * With graph labels placed by their own stroke, does each one still read as its own curve's? A graph label whose
 * lettered box sits nearer another stroke than its own does not, and nor does one whose leader crosses another
 * stroke. An axis is not a rival, as it is named at its ends, and nor is a shaded region, whose edge is the curves
 * that bound it.
 */
export function curveLabelsReadAsOwn(document: SceneDocument, primitives: RenderPrimitive[]): boolean {
  const curves = new Set(document.constructions.filter(c => c.operator === "function_curve").flatMap(c => c.outputs));
  const regions = new Set(document.constructions.filter(c => /(^|_)region$/.test(c.operator)).flatMap(c => c.outputs));
  const ink = primitives.filter(p => p.kind !== "label" && !p.provenance?.labelLeader);
  for (const label of primitives) {
    if (label.kind !== "label") continue;
    const annotationId = label.provenance?.annotationId ?? (document.annotations.some(a => a.id === label.id) ? label.id : undefined);
    const owners = document.annotations.find(a => a.id === annotationId)?.targetIds ?? [label.entityId];
    if (!owners.some(id => curves.has(id))) continue;
    const own = ink.filter(p => owners.includes(p.entityId));
    const rivals = ink.filter(p => !owners.includes(p.entityId) && p.kind !== "axes" && !regions.has(p.entityId));
    if (!own.length || !rivals.length) continue;
    const box = labelBox(label);
    if (box && Math.min(...rivals.map(p => boxDistance(box, p))) < Math.min(...own.map(p => boxDistance(box, p)))) return false;
    const leader = primitives.find(p => p.id === `${label.id}_leader` && p.provenance?.labelLeader);
    if (leader && strokePieces(leader).some(([a, b]) => rivals.some(rival => strokePieces(rival).some(([c, d]) => segmentsCross(a, b, c, d))))) return false;
  }
  return true;
}

/**
 * Graph labels moved onto their stroke are kept only if the figure is never worse than dev's: it draws every
 * label dev draws, and each graph label still reads as its own curve's.
 */
export function curveLabelsNeverWorse(onStroke: { document: SceneDocument; primitives: RenderPrimitive[] }, devPrimitives: RenderPrimitive[]): boolean {
  const drawn = new Set(onStroke.primitives.filter(p => p.kind === "label" || p.kind === "dimension").map(p => p.id));
  return devPrimitives.filter(p => p.kind === "label" || p.kind === "dimension").every(p => drawn.has(p.id)) &&
    curveLabelsReadAsOwn(onStroke.document, onStroke.primitives);
}

/** An untethered, displaced label cannot identify an unrelated nearby stroke.
 * This is a localized missing attachment proof, not a claim about the topic.
 */
export function validateLabelOwnerTruth(document: SceneDocument, primitives: RenderPrimitive[], separatelyProvedAnnotations: ReadonlySet<string> = new Set()): SceneIssue[] {
  const ink = primitives.filter(p => p.kind !== "label" && !p.provenance?.labelLeader);
  const issues: SceneIssue[] = [];
  for (const label of primitives) {
    if (label.kind !== "label" || !label.points[0]) continue;
    // Named summaries are self-identifying. A bare value still needs its owner.
    if (label.provenance?.summary && /^[\p{L}][\p{L}\p{M}\p{Nd}_₀-₉]*\s*=/u.test(label.text ?? "")) continue;
    const annotationId = label.provenance?.annotationId ?? (document.annotations.some(a => a.id === label.id) ? label.id : undefined);
    // Medium names identify a proved halfspace, not its boundary stroke.
    // Their actual rendered side is checked independently by the compiler.
    if (typeof annotationId === "string" && separatelyProvedAnnotations.has(annotationId)) continue;
    const annotationIndex = document.annotations.findIndex(a => a.id === annotationId);
    const annotation = document.annotations[annotationIndex];
    const owners = annotation?.targetIds ?? [label.entityId];
    const own = ink.filter(p => owners.includes(p.entityId));
    if (!own.length) continue;
    const ownDistance = Math.min(...own.map(p => distance(label.points[0]!,p,true)));
    const leader = label.provenance?.usesLeader ? primitives.find(p => p.id === `${label.id}_leader` && p.provenance?.labelLeader) : undefined;
    // A nearby exterior name is ambiguous when its entire circular owner is
    // enclosed by another circular region. It visually names that surrounding
    // region unless it stays inside its owner or has an explicit attachment.
    const nestedRegionAmbiguity = !label.provenance?.usesLeader && own.some(owner =>
      owner.kind === "circle" && owner.points[0] && owner.radius !== undefined
      && distance(label.points[0]!, owner, true) > 1
      && ink.some(other => other.kind === "circle" && !owners.includes(other.entityId)
        && other.points[0] && other.radius !== undefined && other.radius > owner.radius!
        && Math.hypot(other.points[0].x - owner.points[0]!.x, other.points[0].y - owner.points[0]!.y) + owner.radius! <= other.radius));
    // A tether does not establish which object it names when it starts inside
    // a different region. A line crossing a body needs a free attachment site,
    // just as an untethered label needs proximity to its own stroke.
    const ambiguousLeader = !!leader?.points[0] && own.some(p => ["line", "ray", "vector"].includes(p.kind))
      && ink.some(p => !owners.includes(p.entityId)
        && ["polygon", "rectangle", "circle"].includes(p.kind)
        && distance(leader.points[0]!, p, true) === 0 && distance(label.points[0]!, p, true) > 0);
    if (label.provenance?.usesLeader && !ambiguousLeader) continue;
    if (ownDistance <= 40 && !ambiguousLeader && !nestedRegionAmbiguity) continue;
    const otherDistance = Math.min(...ink.filter(p => !owners.includes(p.entityId)).map(p => distance(label.points[0]!,p)));
    if (otherDistance >= ownDistance * 0.5 && !ambiguousLeader && !nestedRegionAmbiguity) continue;
    const entityIndex = document.entities.findIndex(e => e.id === label.entityId);
    issues.push({ code: "label_owner_ambiguous", severity: "fatal", failureKind: "proof", entityIds: owners,
      ...(annotation ? { path: `annotations[${annotationIndex}].text` } : entityIndex >= 0 ? { path: `entities[${entityIndex}].label` } : {}),
      message: ambiguousLeader ? "A label leader starts inside another region instead of an unambiguous part of its own stroke." : nestedRegionAmbiguity ? "An untethered name lies outside its circular owner, which is enclosed by another circle." : "An untethered label is substantially closer to another stroke than its declared owner.", expected: ownDistance, actual: otherDistance });
  }
  // Two untethered point names are crossed when each sits nearer the other's
  // point than its own: the reader assigns both names to the wrong points.
  const pointNames = primitives.flatMap(label => {
    if (label.kind !== "label" || !label.points[0] || label.provenance?.usesLeader || label.provenance?.summary) return [];
    const annotationId = label.provenance?.annotationId ?? (document.annotations.some(a => a.id === label.id) ? label.id : undefined);
    const annotationIndex = document.annotations.findIndex(a => a.id === annotationId);
    const owners = document.annotations[annotationIndex]?.targetIds ?? [label.entityId];
    const own = ink.filter(p => owners.includes(p.entityId) && p.kind === "point" && p.points[0]);
    if (owners.length !== 1 || own.length !== 1) return [];
    const entityIndex = document.entities.findIndex(e => e.id === label.entityId);
    return [{ at: label.points[0], point: own[0]!.points[0]!, owners, path: annotationIndex >= 0 ? `annotations[${annotationIndex}].text` : entityIndex >= 0 ? `entities[${entityIndex}].label` : undefined }];
  });
  const gap = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  const crossed = new Set<number>();
  for (let i = 0; i < pointNames.length; i++) for (let j = i + 1; j < pointNames.length; j++) {
    const a = pointNames[i]!, b = pointNames[j]!;
    if (a.owners[0] === b.owners[0] || gap(a.point, b.point) <= 3) continue;
    if (gap(a.at, b.point) < gap(a.at, a.point) && gap(b.at, a.point) < gap(b.at, b.point)) crossed.add(i).add(j);
  }
  for (const index of crossed) {
    const name = pointNames[index]!;
    issues.push({ code: "label_owner_ambiguous", severity: "fatal", failureKind: "proof", entityIds: name.owners, ...(name.path ? { path: name.path } : {}),
      message: "Two point names are crossed: each lies nearer the other's point than its own." });
  }
  return issues;
}
