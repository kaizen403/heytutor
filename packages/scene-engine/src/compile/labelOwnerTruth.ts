import type { RenderPrimitive, SceneDocument, SceneIssue } from "../types";
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
    const radius = primitive.radius ?? 0;
    const radial = Math.hypot(p.x-first.x,p.y-first.y);
    if (primitive.kind === "circle") return owner && radial <= radius ? 0 : Math.abs(radial-radius);
    const start = primitive.startAngle ?? 0, end = primitive.endAngle ?? start;
    const sweep = end-start;
    const tau = 2*Math.PI;
    const normalized = (a: number) => ((a % tau)+tau) % tau;
    const angle = Math.atan2(p.y-first.y,p.x-first.x);
    const along = normalized(sweep < 0 ? start-angle : angle-start);
    if (Math.abs(sweep) >= tau || along <= Math.abs(sweep)) return Math.abs(radial-radius);
    return Math.min(...[start,end].map(a => Math.hypot(p.x-first.x-radius*Math.cos(a),p.y-first.y-radius*Math.sin(a))));
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
        && Math.hypot(other.points[0].x - owner.points[0]!.x, other.points[0].y - owner.points[0]!.y) + owner.radius! <= other.radius
        && distance(label.points[0]!, other, true) === 0));
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
      message: ambiguousLeader ? "A label leader starts inside another region instead of an unambiguous part of its own stroke." : nestedRegionAmbiguity ? "An untethered circular-region name lies outside its owner and inside a surrounding region." : "An untethered label is substantially closer to another stroke than its declared owner.", expected: ownDistance, actual: otherDistance });
  }
  return issues;
}
