/**
 * Medium sides for labels on a refraction or reflection.
 *
 * A ray-optics label names something in one medium: the incident ray, the
 * glass, the water's index. Compass slots know nothing of the interface, so a
 * label could land across it and name the wrong medium. These rules read only
 * what the document declares: the optics operators, their surface, contact,
 * paths and n1/n2 inputs, and each label's quantity binding. They never read
 * stems, topics or role words.
 *
 * R2b: a label on a light path that starts or ends at a refraction or
 * reflection contact stays on that path's side of the interface.
 */

import type { RenderPoint, SceneDocument } from "../types";
import type { LabelEngineResult, LabelOwner, LabelSideRegion } from "./labelEngine";

interface Point { x: number; y: number }

type Transform = (point: Point) => RenderPoint;

/** One refraction or reflection the document declares, in world space. */
interface LightEvent {
  mode: "refract" | "reflect";
  surfaceId: string | null;
  contact: Point;
  incidentPathId: string | null;
  outgoingPathId: string | null;
  normalId: string | null;
}

/** Screen distance from the contact at which a path's side is sampled. */
const SIDE_PROBE_PX = 4;

/**
 * Attach side regions to label owners on optics paths. The caller drops an
 * owner that has no legal slot on its side; it is never moved across.
 */
export function bindOpticsLabelSides(
  document: SceneDocument,
  geometry: ReadonlyMap<string, unknown>,
  transformFor: (entityId: string) => Transform,
  owners: LabelOwner[],
): LabelOwner[] {
  const events = lightEvents(document, geometry);
  if (events.length === 0) return owners;
  return owners.map((owner) => {
    const regions: LabelSideRegion[] = [];
    for (const event of events) {
      if (owner.entityId !== event.incidentPathId && owner.entityId !== event.outgoingPathId) continue;
      const region = pathSideRegion(event, owner.entityId, geometry, transformFor);
      if (region) regions.push(region);
    }
    return regions.length > 0 ? { ...owner, sideRegions: [...(owner.sideRegions ?? []), ...regions] } : owner;
  });
}

/**
 * Solve labels, dropping each side-bound label that has no slot left on its
 * side. A figure whose labels fail even with no side rules fails as before:
 * dropping a label never rescues a figure the old layout declined.
 */
export function solveWithSideBoundLabels(
  owners: LabelOwner[],
  solve: (owners: LabelOwner[]) => LabelEngineResult,
): LabelEngineResult {
  let current = owners;
  let result = solve(current);
  if (result.ok || !current.some(isSideBound)) return result;
  const free = solve(owners.map(({ sideRegions: _sides, ...owner }) => owner));
  if (!free.ok) return result;
  while (!result.ok) {
    const sideBound = current.filter(isSideBound);
    if (sideBound.length === 0) break;
    const named = new Set(result.issues.flatMap((issue) => [issue.entityId, ...(issue.overlappingIds ?? [])]));
    const failing = sideBound.filter((owner) => named.has(owner.entityId) || (owner.labelId !== undefined && named.has(owner.labelId)));
    const dropped = new Set(failing.length > 0 ? failing : [sideBound.at(-1)!]);
    current = current.filter((owner) => !dropped.has(owner));
    result = solve(current);
  }
  return result;
}

function isSideBound(owner: LabelOwner): boolean {
  return (owner.sideRegions?.length ?? 0) > 0;
}

function lightEvents(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): LightEvent[] {
  const producers = new Map<string, SceneDocument["constructions"][number]>();
  for (const construction of document.constructions) {
    for (const output of construction.outputs ?? []) producers.set(output, construction);
  }
  const events: LightEvent[] = [];
  for (const construction of document.constructions) {
    const inputs = construction.inputs ?? {};
    const outputs = construction.outputs ?? [];
    if (construction.operator === "refract_at" || construction.operator === "reflect_at") {
      const contact = pointInput(inputs.point ?? inputs.contact, geometry);
      if (!contact) continue;
      events.push({
        mode: construction.operator === "refract_at" ? "refract" : "reflect",
        surfaceId: typeof inputs.surface === "string" ? inputs.surface : null,
        contact,
        incidentPathId: outputs[0] ?? null,
        outgoingPathId: outputs[2] ?? null,
        normalId: outputs[1] ?? null,
      });
      continue;
    }
    if (construction.operator === "refract_direction" || construction.operator === "reflect_direction") {
      const originRef = inputs.origin ?? inputs.point;
      const contact = pointInput(originRef, geometry);
      if (!contact) continue;
      const incoming = inputs.incoming ?? inputs.direction;
      const normalId = typeof inputs.normal === "string" ? inputs.normal : null;
      const normalProducer = normalId ? producers.get(normalId) : undefined;
      const contactProducer = typeof originRef === "string" ? producers.get(originRef) : undefined;
      const surface = normalProducer?.operator === "normal_at"
        ? normalProducer.inputs?.surface
        : contactProducer && (contactProducer.operator === "surface_contact" || contactProducer.operator === "surface_intersection")
          ? contactProducer.inputs?.surface
          : undefined;
      events.push({
        mode: construction.operator === "refract_direction" ? "refract" : "reflect",
        surfaceId: typeof surface === "string" ? surface : null,
        contact,
        incidentPathId: typeof incoming === "string" && isPath(geometry.get(incoming)) ? incoming : null,
        outgoingPathId: outputs[0] ?? null,
        normalId,
      });
    }
  }
  return events;
}

/**
 * The region holding the medium a path runs through, next to its contact.
 * Null when the side cannot be read: no interface, or a grazing path.
 */
function pathSideRegion(
  event: LightEvent,
  pathId: string,
  geometry: ReadonlyMap<string, unknown>,
  transformFor: (entityId: string) => Transform,
): LabelSideRegion | null {
  const path = geometry.get(pathId);
  if (!isPath(path)) return null;
  const far = farthestPoint(path.points, event.contact);
  if (!far || distance(far, event.contact) < 1e-9) return null;
  const transform = transformFor(event.surfaceId ?? pathId);
  const contact = transform(event.contact);
  const farScreen = transform(far);
  const length = distance(farScreen, contact);
  if (length < 1e-6) return null;
  const probe = {
    x: contact.x + (farScreen.x - contact.x) / length * SIDE_PROBE_PX,
    y: contact.y + (farScreen.y - contact.y) / length * SIDE_PROBE_PX,
  };
  const surface = event.surfaceId ? geometry.get(event.surfaceId) : undefined;
  if (isRound(surface)) {
    const center = transform(surface.center);
    const radius = distance(center, transform({ x: surface.center.x + surface.radius, y: surface.center.y }));
    if (!(radius > 0)) return null;
    return { kind: "circle", center, radius, inside: distance(probe, center) < radius };
  }
  if (isPath(surface) && surface.closed === true && surface.points.length >= 3) {
    const points = surface.points.map(transform);
    return { kind: "polygon", points, inside: pointInPolygon(probe, points) };
  }
  let tangent: { a: Point; b: Point } | null = null;
  if (isPath(surface) && surface.points.length >= 2) {
    tangent = nearestSegment(surface.points, event.contact);
  } else {
    const normal = event.normalId ? geometry.get(event.normalId) : undefined;
    if (isPath(normal) && normal.points.length >= 2) {
      const [a, b] = [normal.points[0]!, normal.points.at(-1)!];
      const direction = { x: b.x - a.x, y: b.y - a.y };
      tangent = { a: event.contact, b: { x: event.contact.x - direction.y, y: event.contact.y + direction.x } };
    }
  }
  if (!tangent) return null;
  const a = transform(tangent.a);
  const b = transform(tangent.b);
  const span = distance(a, b);
  if (span < 1e-6) return null;
  let normal = { x: -(b.y - a.y) / span, y: (b.x - a.x) / span };
  const side = (probe.x - contact.x) * normal.x + (probe.y - contact.y) * normal.y;
  // A path lying along the interface has no side to keep.
  if (Math.abs(side) < SIDE_PROBE_PX * 0.05) return null;
  if (side < 0) normal = { x: -normal.x, y: -normal.y };
  return { kind: "half_plane", point: contact, normal };
}

function pointInput(value: unknown, geometry: ReadonlyMap<string, unknown>): Point | null {
  if (typeof value === "string") {
    const target = geometry.get(value);
    return isRecord(target) && target.kind === "point" && isPoint(target.point) ? target.point : null;
  }
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    return { x: value[0], y: value[1] };
  }
  return null;
}

function farthestPoint(points: Point[], from: Point): Point | null {
  let best: Point | null = null;
  let bestDistance = -1;
  for (const point of points) {
    const next = distance(point, from);
    if (next > bestDistance) {
      best = point;
      bestDistance = next;
    }
  }
  return best;
}

function nearestSegment(points: Point[], at: Point): { a: Point; b: Point } {
  let best = { a: points[0]!, b: points[1]! };
  let bestDistance = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const next = segmentDistance(at, a, b);
    if (next < bestDistance) {
      best = { a, b };
      bestDistance = next;
    }
  }
  return best;
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointInPolygon(point: RenderPoint, polygon: RenderPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

function isPath(value: unknown): value is { kind: "path"; points: Point[]; closed?: boolean } {
  return isRecord(value) && value.kind === "path" && Array.isArray(value.points) && value.points.length >= 2 && value.points.every(isPoint);
}

function isRound(value: unknown): value is { kind: "circle" | "arc"; center: Point; radius: number } {
  return isRecord(value) && (value.kind === "circle" || value.kind === "arc") && isPoint(value.center) && typeof value.radius === "number";
}
