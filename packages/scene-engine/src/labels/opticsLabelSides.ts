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
 * R2c: a label on a refraction whose quantityId, or leading symbol, is the
 * refraction's n1 or n2 input sits on the incident or transmitted side.
 * R2a: a label on a refraction's interface follows a side placementIntent
 * (`incident_side`, `transmitted_side`, or "<medium> side" when the medium is
 * the text of a label or quantity bound to n1 or n2). An unbound, unnumbered
 * label on the interface with no side it can resolve is dropped; the figure
 * is not declined.
 * R2d: a closed region (a drawn closed path or circle) with a refraction on
 * its edge whose incident or transmitted path runs inside holds that medium.
 * A label bound to the index of the medium inside it, or an unbound and
 * unnumbered label on the region itself, names that medium and sits inside
 * the region; with no slot there it is dropped.
 */

import { parseSidePlacementIntent } from "../document/placementIntent";
import type { RenderPoint, SceneAnnotation, SceneDocument } from "../types";
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
  /** Refractive index inputs, as written: a quantity ID or a literal. */
  n1: unknown;
  n2: unknown;
}

type RefractionSide = "incident" | "transmitted";

/** Screen distance from the contact at which a path's side is sampled. */
const SIDE_PROBE_PX = 4;

/**
 * Attach side regions to label owners on refractions and reflections, and
 * drop the interface labels R2a cannot place. The caller drops an owner that
 * has no legal slot on its side; it is never moved across.
 */
export function bindOpticsLabelSides(
  document: SceneDocument,
  geometry: ReadonlyMap<string, unknown>,
  transformFor: (entityId: string) => Transform,
  owners: LabelOwner[],
  /** Header legend rows: R2d leaves them in the legend. */
  summaryLabelIds: ReadonlySet<string> = new Set(),
): LabelOwner[] {
  const events = lightEvents(document, geometry);
  if (events.length === 0) return owners;
  const media = closedMedia(events, geometry, transformFor);
  const annotations = new Map(document.annotations
    .filter((annotation) => annotation.kind === "label" || annotation.kind === "callout")
    .map((annotation) => [annotation.id, annotation]));
  return owners.flatMap((owner) => {
    const regions: LabelSideRegion[] = [];
    for (const event of events) {
      if (owner.entityId !== event.incidentPathId && owner.entityId !== event.outgoingPathId) continue;
      const region = pathSideRegion(event, owner.entityId, geometry, transformFor);
      if (region) regions.push(region);
    }
    const annotation = owner.labelId ? annotations.get(owner.labelId) : undefined;
    for (const medium of owner.labelId && summaryLabelIds.has(owner.labelId) ? [] : media) {
      const bound = Boolean(annotation) && medium.indexInputs.some((input) => boundToIndex(annotation!, input, document));
      // On the region itself, an unbound label names the medium only when it
      // carries no quantity and no number ("glass", not "δ = 38.4°").
      const names = owner.entityId === medium.entityId && !annotation?.quantityId && !/\p{N}/u.test(annotation?.text ?? owner.text);
      if (bound || names) regions.push(medium.region);
    }
    const refractions = annotation ? refractionsOn(owner.entityId, events) : [];
    let bound = false;
    for (const event of refractions) {
      const side = boundIndexSide(annotation!, event, document);
      if (!side) continue;
      bound = true;
      const region = sideRegion(event, side, geometry, transformFor);
      if (region) regions.push(region);
    }
    if (annotation && refractions.length > 0 && !bound) {
      const side = intentSide(annotation, refractions, document);
      const region = side ? sharedSideRegion(refractions, side, geometry, transformFor) : null;
      if (region) {
        regions.push(region);
      } else if (
        refractions.some((event) => event.surfaceId === owner.entityId) &&
        !annotation.quantityId &&
        !/\p{N}/u.test(annotation.text ?? owner.text)
      ) {
        return [];
      }
    }
    return [regions.length > 0 ? { ...owner, sideRegions: [...(owner.sideRegions ?? []), ...regions] } : owner];
  });
}

/**
 * The side a label's placementIntent names on these refractions. A
 * "<medium> side" counts only when the medium is the text of a label or
 * quantity bound to n1 or n2; every other intent is unknown.
 */
function intentSide(annotation: SceneAnnotation, refractions: LightEvent[], document: SceneDocument): RefractionSide | null {
  const intent = parseSidePlacementIntent(annotation.placementIntent);
  if (!intent) return null;
  if ("side" in intent) return intent.side === "incident_side" ? "incident" : "transmitted";
  const sides = new Set<RefractionSide>();
  for (const event of refractions) {
    const incident = mediumNames(event.n1, document).has(intent.medium);
    const transmitted = mediumNames(event.n2, document).has(intent.medium);
    if (incident !== transmitted) sides.add(incident ? "incident" : "transmitted");
  }
  return sides.size === 1 ? [...sides][0]! : null;
}

/** Lower-case texts naming the medium of an n1 or n2 input. */
function mediumNames(input: unknown, document: SceneDocument): Set<string> {
  const names = new Set<string>();
  if (typeof input !== "string") return names;
  for (const annotation of document.annotations) {
    if ((annotation.kind === "label" || annotation.kind === "callout") && annotation.quantityId === input && annotation.text) {
      names.add(annotation.text.trim().toLowerCase());
    }
  }
  const quantity = document.quantities.find((candidate) => candidate.id === input);
  for (const key of ["label", "name", "symbol"]) {
    const value = quantity?.[key];
    if (typeof value === "string" && value.trim()) names.add(value.trim().toLowerCase());
  }
  return names;
}

/** One region for `side` that every refraction on the entity agrees on, else null. */
function sharedSideRegion(
  refractions: LightEvent[],
  side: RefractionSide,
  geometry: ReadonlyMap<string, unknown>,
  transformFor: (entityId: string) => Transform,
): LabelSideRegion | null {
  const regions = refractions.map((event) => sideRegion(event, side, geometry, transformFor));
  const first = regions[0];
  if (!first || regions.some((region) => !region || !sameRegion(region, first))) return null;
  return first;
}

function sameRegion(a: LabelSideRegion, b: LabelSideRegion): boolean {
  const near = (p: RenderPoint, q: RenderPoint) => distance(p, q) <= 1;
  if (a.kind === "half_plane" && b.kind === "half_plane") {
    const offset = (b.point.x - a.point.x) * a.normal.x + (b.point.y - a.point.y) * a.normal.y;
    return a.normal.x * b.normal.x + a.normal.y * b.normal.y > 0.999 && Math.abs(offset) <= 1;
  }
  if (a.kind === "circle" && b.kind === "circle") {
    return a.inside === b.inside && near(a.center, b.center) && Math.abs(a.radius - b.radius) <= 1;
  }
  if (a.kind === "polygon" && b.kind === "polygon") {
    return a.inside === b.inside && a.points.length === b.points.length && a.points.every((point, index) => near(point, b.points[index]!));
  }
  return false;
}

/** Refractions whose interface, incident path or transmitted path is `entityId`. */
function refractionsOn(entityId: string, events: LightEvent[]): LightEvent[] {
  return events.filter((event) => event.mode === "refract" && (
    entityId === event.surfaceId || entityId === event.incidentPathId || entityId === event.outgoingPathId));
}

function sideRegion(
  event: LightEvent,
  side: RefractionSide,
  geometry: ReadonlyMap<string, unknown>,
  transformFor: (entityId: string) => Transform,
): LabelSideRegion | null {
  const pathId = side === "incident" ? event.incidentPathId : event.outgoingPathId;
  return pathId ? pathSideRegion(event, pathId, geometry, transformFor) : null;
}

/**
 * The side named by a label bound to the refraction's n1 (incident) or n2
 * (transmitted) input, through its quantityId or its leading symbol.
 */
function boundIndexSide(annotation: SceneAnnotation, event: LightEvent, document: SceneDocument): RefractionSide | null {
  const incident = boundToIndex(annotation, event.n1, document);
  const transmitted = boundToIndex(annotation, event.n2, document);
  if (incident === transmitted) return null;
  return incident ? "incident" : "transmitted";
}

/** True when a label is bound to an index input through its quantityId or its leading symbol. */
function boundToIndex(annotation: SceneAnnotation, input: unknown, document: SceneDocument): boolean {
  if (typeof input !== "string") return false;
  if (annotation.quantityId === input) return true;
  const symbol = leadingSymbol(annotation.text);
  return symbol !== null && quantityKeys(input, document).has(symbol);
}

/** A closed region that holds one medium of a refraction on its edge. */
interface ClosedMedium {
  entityId: string;
  region: LabelSideRegion;
  /** The n1 or n2 inputs, as written, of the medium inside it. */
  indexInputs: unknown[];
}

/**
 * R2d: closed regions (a drawn closed path or circle) with a refraction on
 * their edge whose incident or transmitted path runs inside. A label on the
 * region itself, or bound to the index of the medium inside it, names that
 * medium and must sit inside the region.
 */
function closedMedia(
  events: LightEvent[],
  geometry: ReadonlyMap<string, unknown>,
  transformFor: (entityId: string) => Transform,
): ClosedMedium[] {
  const refractions = events.filter((event) => event.mode === "refract");
  if (refractions.length === 0) return [];
  const media: ClosedMedium[] = [];
  for (const [entityId, value] of geometry) {
    const transform = transformFor(entityId);
    let region: LabelSideRegion;
    if (isRecord(value) && value.kind === "circle" && isRound(value)) {
      const center = transform(value.center);
      const radius = distance(center, transform({ x: value.center.x + value.radius, y: value.center.y }));
      if (!(radius > 0)) continue;
      region = { kind: "circle", center, radius, inside: true };
    } else if (isPath(value) && value.closed === true && value.points.length >= 3) {
      region = { kind: "polygon", points: value.points.map(transform), inside: true };
    } else {
      continue;
    }
    const indexInputs: unknown[] = [];
    for (const event of refractions) {
      if (!onRegionEdge(transform(event.contact), region)) continue;
      if (event.outgoingPathId && pathRunsInside(event, event.outgoingPathId, geometry, transform, region)) indexInputs.push(event.n2);
      if (event.incidentPathId && pathRunsInside(event, event.incidentPathId, geometry, transform, region)) indexInputs.push(event.n1);
    }
    if (indexInputs.length > 0) media.push({ entityId, region, indexInputs });
  }
  return media;
}

/** Screen distance within which a contact is on a region's edge. */
const EDGE_TOLERANCE_PX = 3;

function onRegionEdge(point: RenderPoint, region: LabelSideRegion): boolean {
  if (region.kind === "circle") return Math.abs(distance(point, region.center) - region.radius) <= EDGE_TOLERANCE_PX;
  if (region.kind !== "polygon") return false;
  return region.points.some((a, index) => segmentDistance(point, a, region.points[(index + 1) % region.points.length]!) <= EDGE_TOLERANCE_PX);
}

/** True when the path leaves the event's contact into the region. */
function pathRunsInside(
  event: LightEvent,
  pathId: string,
  geometry: ReadonlyMap<string, unknown>,
  transform: Transform,
  region: LabelSideRegion,
): boolean {
  const path = geometry.get(pathId);
  if (!isPath(path)) return false;
  const far = farthestPoint(path.points, event.contact);
  if (!far) return false;
  const contact = transform(event.contact);
  const farScreen = transform(far);
  const length = distance(farScreen, contact);
  if (length < 1e-6) return false;
  const probe = {
    x: contact.x + (farScreen.x - contact.x) / length * SIDE_PROBE_PX,
    y: contact.y + (farScreen.y - contact.y) / length * SIDE_PROBE_PX,
  };
  if (region.kind === "circle") return distance(probe, region.center) < region.radius;
  return region.kind === "polygon" && pointInPolygon(probe, region.points);
}

/** A quantity ID and its declared symbol, normalized for comparison. */
function quantityKeys(quantityId: string, document: SceneDocument): Set<string> {
  const keys = new Set([normalizeSymbol(quantityId)]);
  const quantity = document.quantities.find((candidate) => candidate.id === quantityId);
  if (typeof quantity?.symbol === "string") keys.add(normalizeSymbol(quantity.symbol));
  return keys;
}

/** The symbol a label opens with, when it stands alone or before "=", "≈" or ":". */
function leadingSymbol(text: string | undefined): string | null {
  const match = text?.trim().match(/^([^\s=≈:]+)\s*(?:[=≈:]|$)/u);
  return match ? normalizeSymbol(match[1]!) : null;
}

/** "n₁", "n_1" and "n1" compare equal; so do "nᵣ" and "nr". */
function normalizeSymbol(symbol: string): string {
  return symbol.normalize("NFKC").replace(/[_{}\s]/g, "");
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
        n1: inputs.n1,
        n2: inputs.n2,
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
        n1: inputs.n1,
        n2: inputs.n2,
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
