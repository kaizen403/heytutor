/**
 * Total internal reflection happens only above the critical angle.
 *
 * A reflection inside the denser medium is total only when its incidence
 * exceeds asin(n2/n1). Below that angle most of the light refracts out, so a
 * figure that draws only the reflection there shows light trapped where it
 * escapes. Round 7 drew a fibre's reflection at about 27 degrees to the
 * normal, far below a core and cladding critical angle.
 *
 * Rule R7, from declared operators only. An interface's indices are declared
 * by the numeric n1 and n2 inputs of the refractions on it (`refract_at`,
 * `refract_direction`), n1 on the side its incident ray comes from. For each
 * reflection (`reflect_at`, `reflect_direction`) on such an interface:
 * - from the denser side, the incidence must exceed the critical angle, or a
 *   refraction must leave from the same contact;
 * - from the rarer side no reflection is total, so a reflection whose drawn
 *   label or callout says it is total internal reflection needs that
 *   refraction too.
 * Otherwise the figure fails with `reflection_below_critical_angle`. Indices
 * are never read from words; with none declared the rule does not apply.
 *
 * The rule judges what the figure draws: only a reflection whose outgoing ray
 * is drawn is checked, and only a refraction whose outgoing ray is drawn
 * excuses it. A refraction that is not drawn still declares the indices. The
 * incoming direction is read from a path or from a literal vector, as the
 * compiler accepts both.
 */
import type { SceneDocument, SceneIssue } from "../types";

interface Point { x: number; y: number }

type GeometryLike = { kind: string };
type PathValue = { kind: "path"; points: Point[]; closed?: boolean; infinite?: boolean };
type RoundValue = { kind: "circle" | "arc"; center: Point; radius: number };

interface Event {
  constructionId: string;
  surfaceId: string;
  contact: Point;
  /** Unit direction the incident light travels in. */
  incoming: Point;
  outputs: string[];
  /** The outgoing ray: output 2 of `*_at`, output 0 of `*_direction`. */
  outgoingId: string | null;
  n1?: number;
  n2?: number;
}

export interface ReflectionCriticalAngleInput {
  document: SceneDocument;
  geometry: Map<string, GeometryLike>;
  resolvePoint: (value: unknown) => Point;
  /** A declared numeric input (literal or quantity), or null when it has none. */
  resolveNumber: (value: unknown) => number | null;
  /** The compiler's drawn check; without it every entity counts as drawn. */
  drawn?: (entityId: string) => boolean;
  issues: SceneIssue[];
}

/** Incidence above the critical angle by at least this much reads as total. */
const CRITICAL_MARGIN_DEG = 0.1;
const TOTAL_INTERNAL_REFLECTION_TEXT = /total(?:ly)?[\s-]+internal(?:ly)?[\s-]+reflect|\bTIR\b/i;

export function validateReflectionCriticalAngles(input: ReflectionCriticalAngleInput): void {
  const { document, geometry } = input;
  const drawn = (event: Event) => event.outgoingId !== null && (input.drawn?.(event.outgoingId) ?? true);
  const constructions = document.constructions ?? [];
  if (!constructions.some((construction) => construction.operator === "reflect_at" || construction.operator === "reflect_direction")) return;
  const producers = new Map<string, SceneDocument["constructions"][number]>();
  for (const construction of constructions) {
    for (const output of construction.outputs ?? []) producers.set(output, construction);
  }
  const refractions: Event[] = [];
  const reflections: Event[] = [];
  for (const construction of constructions) {
    const refract = construction.operator === "refract_at" || construction.operator === "refract_direction";
    const reflect = construction.operator === "reflect_at" || construction.operator === "reflect_direction";
    if (!refract && !reflect) continue;
    const event = readEvent(construction, producers, input);
    if (!event) continue;
    if (refract) {
      const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
      const n1 = input.resolveNumber(inputs.n1);
      const n2 = input.resolveNumber(inputs.n2);
      if (n1 === null || n2 === null || !(n1 > 0) || !(n2 > 0)) continue;
      refractions.push({ ...event, n1, n2 });
    } else if (drawn(event)) {
      reflections.push(event);
    }
  }
  if (refractions.length === 0 || reflections.length === 0) return;
  const span = sceneScale([...refractions, ...reflections].map((event) => event.contact));
  const tolerance = 4e-3 * Math.max(span, 1e-9);
  const claimsTotal = totalReflectionClaims(document);

  for (const reflection of reflections) {
    const surface = geometry.get(reflection.surfaceId);
    const onSurface = refractions.filter((event) => event.surfaceId === reflection.surfaceId);
    if (onSurface.length === 0) continue;
    // Index on each side of the interface, as the refractions declare it.
    const indexBySide = new Map<number, number>();
    let conflict = false;
    const record = (side: number, index: number) => {
      const known = indexBySide.get(side);
      if (known !== undefined && Math.abs(known - index) > 1e-9 * Math.max(known, index)) conflict = true;
      indexBySide.set(side, index);
    };
    for (const event of onSurface) {
      const side = sideOf(surface, back(event, tolerance));
      if (side === 0) continue;
      record(side, event.n1!);
      record(-side, event.n2!);
    }
    if (conflict) continue;
    const side = sideOf(surface, back(reflection, tolerance));
    const incidentIndex = indexBySide.get(side);
    const farIndex = indexBySide.get(-side);
    if (side === 0 || incidentIndex === undefined || farIndex === undefined) continue;
    const refractsThere = onSurface.some((event) => drawn(event) && distance(event.contact, reflection.contact) <= tolerance);
    if (refractsThere) continue;
    const normal = surfaceNormal(surface, reflection.contact);
    if (!normal) continue;
    const incidence = Math.acos(Math.min(1, Math.abs(dot(reflection.incoming, normal)))) * 180 / Math.PI;
    if (incidentIndex > farIndex) {
      const critical = Math.asin(farIndex / incidentIndex) * 180 / Math.PI;
      if (incidence >= critical + CRITICAL_MARGIN_DEG) continue;
      input.issues.push({
        code: "reflection_below_critical_angle",
        message: `${reflection.constructionId} reflects at ${incidence.toFixed(1)} degrees to the normal, not above the ${critical.toFixed(1)} degree critical angle of the declared indices (${incidentIndex} to ${farIndex}); light refracts out there and no refraction is drawn`,
        severity: "fatal",
        entityIds: reflection.outputs,
      });
    } else if (reflection.outputs.some((id) => claimsTotal.has(id))) {
      input.issues.push({
        code: "reflection_below_critical_angle",
        message: `${reflection.constructionId} is labelled total internal reflection but its light comes from the rarer side of the declared indices (${incidentIndex} to ${farIndex}), where no reflection is total`,
        severity: "fatal",
        entityIds: reflection.outputs,
      });
    }
  }
}

function readEvent(
  construction: SceneDocument["constructions"][number],
  producers: Map<string, SceneDocument["constructions"][number]>,
  input: ReflectionCriticalAngleInput,
): Event | null {
  const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
  const outputs = (construction.outputs ?? []).filter((id): id is string => typeof id === "string");
  let surfaceId: unknown;
  let contactRef: unknown;
  let incomingPath: unknown;
  let incomingVector: Point | null = null;
  let outgoingId: string | null;
  if (construction.operator === "refract_at" || construction.operator === "reflect_at") {
    surfaceId = inputs.surface;
    contactRef = inputs.point ?? inputs.contact;
    incomingPath = input.geometry.get(outputs[0] ?? "");
    outgoingId = outputs[2] ?? null;
  } else {
    outgoingId = outputs[0] ?? null;
    contactRef = inputs.origin ?? inputs.point;
    const normalProducer = typeof inputs.normal === "string" ? producers.get(inputs.normal) : undefined;
    const contactProducer = typeof contactRef === "string" ? producers.get(contactRef) : undefined;
    surfaceId = normalProducer?.operator === "normal_at"
      ? normalProducer.inputs?.surface
      : contactProducer?.operator === "surface_contact" || contactProducer?.operator === "surface_intersection"
        ? contactProducer.inputs?.surface
        : undefined;
    const incoming = inputs.incoming ?? inputs.direction;
    if (typeof incoming === "string") incomingPath = input.geometry.get(incoming);
    else incomingVector = literalVector(incoming);
  }
  if (typeof surfaceId !== "string") return null;
  let travel: Point;
  if (incomingVector) {
    travel = incomingVector;
  } else {
    if (!isPath(incomingPath as GeometryLike)) return null;
    const path = incomingPath as PathValue;
    travel = path.infinite
      ? sub(path.points[1]!, path.points[0]!)
      : sub(path.points.at(-1)!, path.points[0]!);
  }
  let contact: Point;
  try { contact = input.resolvePoint(contactRef); } catch { return null; }
  const incoming = unit(travel);
  if (!incoming || !finite(contact)) return null;
  return { constructionId: construction.id, surfaceId, contact, incoming, outputs, outgoingId };
}

/** A literal direction, [x, y] or { x, y }, as the compiler's resolveVector reads it. */
function literalVector(value: unknown): Point | null {
  if (Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "number")) {
    const vector = { x: value[0] as number, y: value[1] as number };
    return finite(vector) ? vector : null;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.x === "number" && typeof record.y === "number") {
      const vector = { x: record.x, y: record.y };
      return finite(vector) ? vector : null;
    }
  }
  return null;
}

/** Annotated or entity labels a reflection's outputs carry that say total internal reflection. */
function totalReflectionClaims(document: SceneDocument): Set<string> {
  const ids = new Set<string>();
  for (const annotation of document.annotations ?? []) {
    if (annotation.kind !== "label" && annotation.kind !== "callout") continue;
    if (!TOTAL_INTERNAL_REFLECTION_TEXT.test(annotation.text ?? "")) continue;
    for (const id of annotation.targetIds ?? []) ids.add(id);
  }
  for (const entity of document.entities ?? []) {
    if (typeof entity.label === "string" && TOTAL_INTERNAL_REFLECTION_TEXT.test(entity.label)) ids.add(entity.id);
  }
  return ids;
}

/** A point just behind the contact on the incident light. */
function back(event: Event, tolerance: number): Point {
  return { x: event.contact.x - event.incoming.x * 4 * tolerance, y: event.contact.y - event.incoming.y * 4 * tolerance };
}

/** Which side of the interface a point is on: -1 or 1, or 0 when it cannot be read. */
function sideOf(surface: GeometryLike | undefined, point: Point): number {
  if (isRound(surface)) {
    const offset = distance(point, surface.center) - surface.radius;
    return offset === 0 ? 0 : Math.sign(offset);
  }
  if (!isPath(surface)) return 0;
  if (surface.closed) {
    if (surface.points.length < 3) return 0;
    return insidePolygon(point, surface.points) ? -1 : 1;
  }
  if (surface.points.length !== 2) return 0;
  const [a, b] = surface.points as [Point, Point];
  return Math.sign(cross(sub(b, a), sub(point, a)));
}

function surfaceNormal(surface: GeometryLike | undefined, contact: Point): Point | null {
  if (isRound(surface)) return unit(sub(contact, surface.center));
  if (!isPath(surface) || surface.points.length < 2) return null;
  let best: [Point, Point] | null = null;
  let bestDistance = Infinity;
  const count = surface.closed ? surface.points.length : surface.points.length - 1;
  for (let index = 0; index < count; index += 1) {
    const a = surface.points[index]!;
    const b = surface.points[(index + 1) % surface.points.length]!;
    const next = lineDistance(contact, a, b);
    if (next < bestDistance) { best = [a, b]; bestDistance = next; }
  }
  if (!best) return null;
  const tangent = unit(sub(best[1], best[0]));
  return tangent ? { x: -tangent.y, y: tangent.x } : null;
}

function lineDistance(point: Point, a: Point, b: Point): number {
  const edge = sub(b, a);
  const length = Math.hypot(edge.x, edge.y);
  return length > 0 ? Math.abs(cross(edge, sub(point, a))) / length : distance(point, a);
}

function insidePolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function sceneScale(points: Point[]): number {
  if (points.length === 0) return 0;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function isPath(value: GeometryLike | undefined): value is PathValue {
  return value?.kind === "path" && Array.isArray((value as PathValue).points) &&
    (value as PathValue).points.length >= 2 && (value as PathValue).points.every(finite);
}

function isRound(value: GeometryLike | undefined): value is RoundValue {
  if (value?.kind !== "circle" && value?.kind !== "arc") return false;
  const round = value as RoundValue;
  return finite(round.center) && round.radius > 0;
}

function finite(point: Point | undefined): point is Point {
  return Boolean(point) && Number.isFinite(point!.x) && Number.isFinite(point!.y);
}

function unit(vector: Point): Point | null {
  const length = Math.hypot(vector.x, vector.y);
  return length > 0 ? { x: vector.x / length, y: vector.y / length } : null;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
