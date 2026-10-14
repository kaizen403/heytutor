/**
 * The image one refracting spherical surface forms, from the law.
 *
 * A planner placed the two images of a bubble in a glass sphere at literal
 * points 2.29 and 5.33 cm from the surfaces. Its ProblemIR expression had
 * flipped the sign of (n2 - n1)/R and the solver only evaluated it, so the
 * figure carried numbers the law does not give (3.2 cm, and 16 cm at the
 * near surface).
 *
 * `sphericalRefractionImage` is the operator: the declared surface (vertex
 * and centre, or a signed radius), n1, n2 and an object on the axis give the
 * image point through `evaluateOpticsLaw("spherical_refraction")`.
 *
 * `validateSphericalRefractionImagePlacements` holds a document to it. For
 * each `spherical_surface` the document declares refracting, a literal point
 * on its axis placed at a plan-derived distance from its vertex is a placed
 * image, when that distance is an image distance: a derived quantity in a
 * unit of length, one the document binds to the point by quantity id (an
 * annotation or a construction naming both), or a point named or labelled as
 * an image. A derived magnification or ratio that happens to equal a
 * marker's distance places nothing, and neither does a derived quantity that
 * restates a given (its id or symbol); a derived number that only happens to
 * equal a given is still an image distance. A placed image must be the law's image
 * of some declared object (a literal point on the axis at a plan-given
 * distance from a surface vertex). The media are the indices a refraction
 * declared at that surface gives, each on the side of the surface the
 * figure puts it (n1 where the declared incident ray comes from); light
 * from an object starts in the medium on the object's side. With none
 * declared, any ordered pair of the plan's refractive
 * indices (dimensionless values from 1 to 4 written with an n or mu symbol)
 * and 1; with neither, the surface holds no image. Otherwise:
 * `spherical_refraction_image_disagrees`.
 *
 * Light crosses surfaces in turn. A placed image the law confirms is the
 * object of the next refracting surface along the light (coaxial, nearest
 * vertex downstream), in the medium the light entered; lying past that vertex
 * it is a virtual object, signed along the light like any other distance.
 * Confirmation repeats until nothing new is confirmed, so a glass sphere's
 * final image is checked through its first. A confirmed image is not held as
 * an image at the surface it is the object of.
 *
 * `spherical_surface` also draws mirrors, and a refractive index in the plan
 * says nothing about which surface it belongs to. A surface refracts only
 * when the document says so (`refractingSphericalSurfaces`). Whether a
 * surface refracts, and its media, are never read from the question or from
 * role text; an id, role or label only marks a point as an image.
 */
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../contracts/contractsV3";
import { sphericalSurfaceGeometry } from "../compile/opticsSurfaces";
import type { SceneDocument, SceneIssue } from "../types";
import { evaluateOpticsLaw } from "./opticsLaws";

export interface RefractionPoint { x: number; y: number }

export interface SphericalRefractionImageInput {
  /** Pole of the surface, on the axis. */
  vertex: RefractionPoint;
  /** Centre of curvature; or give `radius`. */
  center?: RefractionPoint;
  /** Signed radius along the light's direction (object toward vertex), used without `center`. */
  radius?: number;
  /** Object point on the axis. Real (before the vertex) unless `direction` puts it beyond. */
  object: RefractionPoint;
  /**
   * Direction the light travels along the axis. Without it the light runs from
   * the object to the vertex (a real object). Give it for a virtual object: the
   * image of an earlier surface that lies beyond this vertex.
   */
  direction?: RefractionPoint;
  /** Index of the medium the light arrives through (the object's, for a real object). */
  n1: number;
  /** Index beyond the surface. */
  n2: number;
}

export interface SphericalRefractionImage {
  image: RefractionPoint;
  /** Cartesian distances along the light's direction from the vertex. */
  objectDistance: number;
  imageDistance: number;
  radius: number;
  /** Unit direction the light travels, along which the distances are signed. */
  direction: RefractionPoint;
}

/** Image point of one refracting spherical surface (paraxial law, Cartesian signs). */
export function sphericalRefractionImage(input: SphericalRefractionImageInput): SphericalRefractionImage {
  const { vertex, object } = input;
  const gap = Math.hypot(vertex.x - object.x, vertex.y - object.y);
  if (!(gap > 0)) throw new Error("spherical refraction object sits on the vertex");
  const given = input.direction ? Math.hypot(input.direction.x, input.direction.y) : 0;
  if (input.direction && !(given > 0)) throw new Error("spherical refraction direction has no length");
  const direction = input.direction
    ? { x: input.direction.x / given, y: input.direction.y / given }
    : { x: (vertex.x - object.x) / gap, y: (vertex.y - object.y) / gap };
  const radius = input.center
    ? (input.center.x - vertex.x) * direction.x + (input.center.y - vertex.y) * direction.y
    : input.radius;
  if (radius === undefined || !Number.isFinite(radius)) throw new Error("spherical refraction needs a centre or a radius");
  const objectDistance = input.direction
    ? (object.x - vertex.x) * direction.x + (object.y - vertex.y) * direction.y
    : -gap;
  if (!(Math.abs(objectDistance) > 1e-12 * gap)) throw new Error("spherical refraction object sits off the light's line");
  const { imageDistance } = evaluateOpticsLaw("spherical_refraction", {
    n1: input.n1,
    n2: input.n2,
    objectDistance,
    radius,
  });
  return {
    image: { x: vertex.x + direction.x * imageDistance!, y: vertex.y + direction.y * imageDistance! },
    objectDistance,
    imageDistance: imageDistance!,
    radius,
    direction,
  };
}

const DISTANCE_TOLERANCE = 5e-3;
const IMAGE_TOLERANCE = 1e-2;

type PlanLike = Pick<TurnPlanV3, "givens" | "derived">;

function numericValues(quantities: readonly TurnPlanQuantityV3[] | undefined): number[] {
  return (quantities ?? []).flatMap((quantity) =>
    typeof quantity?.value === "number" && Number.isFinite(quantity.value) && quantity.value !== 0 ? [Math.abs(quantity.value)] : []);
}

const matches = (distance: number, value: number) => Math.abs(distance - value) <= DISTANCE_TOLERANCE * Math.max(Math.abs(value), 1e-9);

const LENGTH_UNITS = new Set([
  "m", "meter", "meters", "metre", "metres", "cm", "centimeter", "centimeters", "centimetre", "centimetres",
  "mm", "millimeter", "millimeters", "millimetre", "millimetres", "km", "kilometer", "kilometers", "kilometre", "kilometres",
  "um", "µm", "μm", "micrometer", "micrometers", "micrometre", "micrometres", "nm", "nanometer", "nanometers", "nanometre", "nanometres",
  "in", "inch", "inches", "ft", "foot", "feet", "yd", "yard", "yards",
]);

function isLengthUnit(unit: unknown): boolean {
  return typeof unit === "string" && LENGTH_UNITS.has(unit.normalize("NFKC").trim().toLowerCase());
}

/** A derived number, with what the plan says it measures, and whether it restates a given. */
type DerivedValue = { value: number; id: string; length: boolean; restates: boolean };

function isRefractiveIndex(quantity: TurnPlanQuantityV3): boolean {
  if (typeof quantity?.value !== "number" || !(quantity.value >= 1 && quantity.value <= 4)) return false;
  const unit = typeof quantity.unit === "string" ? quantity.unit.trim().toLowerCase() : "";
  if (unit && unit !== "1" && unit !== "dimensionless" && unit !== "none") return false;
  const symbol = String(quantity.symbol || quantity.id || "").normalize("NFKC").replace(/[^\p{L}]/gu, "");
  return /^[nμµ]/iu.test(symbol);
}

/** Operators whose `surface` (or `target`) input names the boundary their outputs stand on. */
const SURFACE_ANCHORED = new Set(["refract_at", "reflect_at", "normal_at", "surface_contact", "surface_intersection"]);

type Frame = { surfaceId: string; vertexId: string; vertex: RefractionPoint; center: RefractionPoint };
/** Light reaching a surface: a declared object, or an image an earlier surface formed (its direction and medium carried). */
type LightSource = { id: string; point: RefractionPoint; direction?: RefractionPoint; n1?: number };

/**
 * The `spherical_surface` outputs a document declares refracting:
 * - a refraction event at the surface: `refract_at` on it, a
 *   `refract_direction` whose normal or origin stands on it (`normal_at`,
 *   `surface_contact`, `surface_intersection`, or the contact or normal of a
 *   `refract_at`/`reflect_at` there), or a `snells_law` assertion on such a
 *   normal;
 * - or one face of a ball: another `spherical_surface` has the same centre
 *   with its vertex on the far side of it, so the two faces bound one
 *   medium. A face with a declared reflection and no refraction event there
 *   is a mirror.
 * A surface with no such declaration may be a mirror, and a refractive index
 * elsewhere in the plan does not make it refract.
 */
export function refractingSphericalSurfaces(document: SceneDocument): Set<string> {
  return refractingFrames(document, sphericalSurfaceFrames(document));
}

function refractingFrames(document: SceneDocument, frames: Frame[]): Set<string> {
  const constructions = document.constructions ?? [];
  const refracts = new Set<string>();
  const reflects = new Set<string>();
  const standsOn = new Map<string, string>();
  for (const construction of constructions) {
    if (!SURFACE_ANCHORED.has(construction.operator)) continue;
    const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
    const surface = inputs.surface ?? inputs.target;
    if (typeof surface !== "string") continue;
    const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
    const event = construction.operator === "refract_at" || construction.operator === "reflect_at";
    if (construction.operator === "refract_at") refracts.add(surface);
    if (construction.operator === "reflect_at") reflects.add(surface);
    const anchored = event ? [outputs[1], inputs.point ?? inputs.contact] : outputs;
    for (const id of anchored) if (typeof id === "string") standsOn.set(id, surface);
  }
  for (const construction of constructions) {
    if (construction.operator !== "refract_direction" && construction.operator !== "reflect_direction") continue;
    const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
    for (const reference of [inputs.normal, inputs.origin, inputs.point]) {
      const surface = typeof reference === "string" ? standsOn.get(reference) : undefined;
      if (surface) (construction.operator === "refract_direction" ? refracts : reflects).add(surface);
    }
  }
  for (const assertion of document.assertions ?? []) {
    if (assertion?.predicate !== "snells_law" || !Array.isArray(assertion.entities)) continue;
    for (const id of assertion.entities) {
      const surface = typeof id === "string" ? standsOn.get(id) : undefined;
      if (surface) refracts.add(surface);
    }
  }
  const result = new Set<string>();
  for (const frame of frames) {
    if (refracts.has(frame.surfaceId)) { result.add(frame.surfaceId); continue; }
    if (reflects.has(frame.surfaceId)) continue;
    const { vertex, center } = frame;
    const radius = Math.hypot(vertex.x - center.x, vertex.y - center.y);
    const ball = frames.some((other) => other.surfaceId !== frame.surfaceId
      && Math.hypot(other.center.x - center.x, other.center.y - center.y) <= 1e-6 * radius
      && (other.vertex.x - center.x) * (vertex.x - center.x) + (other.vertex.y - center.y) * (vertex.y - center.y) < 0);
    if (ball) result.add(frame.surfaceId);
  }
  return result;
}

/** A declared refraction at a surface: n1 on the side its incident ray comes from, when the figure shows that side. */
type DeclaredMedia = { n1: number; n2: number; n1Side?: "centre" | "far" };

/** A literal vector input: [x, y] or { x, y }. */
function literalVector(value: unknown): RefractionPoint | null {
  if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") return { x: value[0], y: value[1] };
  if (value && typeof value === "object" && typeof (value as RefractionPoint).x === "number" && typeof (value as RefractionPoint).y === "number") {
    return { x: (value as RefractionPoint).x, y: (value as RefractionPoint).y };
  }
  return null;
}

/**
 * The media a refraction declared at each surface gives (n1 the medium the
 * light comes from): `refract_at` on the surface, a `refract_direction`
 * standing on it (as for `refractingFrames`), or n1 and n2 on the
 * `spherical_surface` itself. Numbers or quantity ids.
 *
 * Each pair stays on its geometric sides: n1 is the medium on the side the
 * declared incident ray comes from, the centre side of the surface or the far
 * side. `refract_at` draws its incident ray from the centre side (its normal
 * points to the centre and the source stands along it). A
 * `refract_direction` reads its incoming direction (a literal vector, a
 * `surface_contact` ray, or a segment or ray with literal ends) at its
 * contact. Where the figure does not show the side (n1 and n2 on the surface,
 * an incoming ray built from other light), the declared order holds as given.
 */
function declaredMedia(
  document: SceneDocument,
  plan: PlanLike,
  frames: Frame[],
  literal: Map<string, RefractionPoint>,
): Map<string, DeclaredMedia[]> {
  const values = new Map<string, number>();
  for (const quantity of [...plan.givens ?? [], ...plan.derived ?? [], ...document.quantities ?? []]) {
    const value = (quantity as { value?: unknown }).value;
    if (typeof quantity?.id === "string" && typeof value === "number" && Number.isFinite(value)) values.set(quantity.id, value);
  }
  const index = (value: unknown, depth = 0): number | null => {
    if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value === "string") {
      const found = values.get(value);
      return found !== undefined && found > 0 ? found : null;
    }
    if (depth < 4 && value && typeof value === "object" && "value" in value) return index((value as { value: unknown }).value, depth + 1);
    return null;
  };
  const media = new Map<string, DeclaredMedia[]>();
  const frameOf = new Map(frames.map((frame) => [frame.surfaceId, frame]));
  const declare = (surface: unknown, inputs: Record<string, unknown>, n1Side?: (frame: Frame) => DeclaredMedia["n1Side"]) => {
    const n1 = index(inputs.n1);
    const n2 = index(inputs.n2);
    if (typeof surface !== "string" || n1 === null || n2 === null || n1 === n2) return;
    const frame = frameOf.get(surface);
    const side = frame && n1Side ? n1Side(frame) : undefined;
    media.set(surface, [...media.get(surface) ?? [], { n1, n2, ...(side ? { n1Side: side } : {}) }]);
  };
  const constructions = document.constructions ?? [];
  const producer = (id: unknown) => typeof id === "string"
    ? constructions.find((construction) => Array.isArray(construction.outputs) && construction.outputs.includes(id))
    : undefined;
  const standsOn = new Map<string, string>();
  for (const construction of constructions) {
    const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
    if (construction.operator === "spherical_surface") declare(construction.outputs?.[0], inputs);
    if (!SURFACE_ANCHORED.has(construction.operator)) continue;
    const surface = inputs.surface ?? inputs.target;
    if (typeof surface !== "string") continue;
    const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
    const event = construction.operator === "refract_at" || construction.operator === "reflect_at";
    if (construction.operator === "refract_at") declare(surface, inputs, () => "centre");
    for (const id of event ? [outputs[1], inputs.point ?? inputs.contact] : outputs) if (typeof id === "string") standsOn.set(id, surface);
  }
  /** The incoming ray of a refract_direction: where it starts (when literal) and which way it runs. */
  const incomingRay = (value: unknown): { start?: RefractionPoint; direction: RefractionPoint } | null => {
    const vector = literalVector(value);
    if (vector) return { direction: vector };
    const made = producer(value);
    if (!made) return null;
    const inputs = (made.inputs ?? {}) as Record<string, unknown>;
    const start = literal.get(String(inputs.origin ?? inputs.start ?? inputs.from));
    if (made.operator === "surface_contact" && made.outputs?.[1] === value && start) {
      const through = literal.get(String(inputs.through));
      const direction = through ? { x: through.x - start.x, y: through.y - start.y }
        : literalVector(inputs.parallelTo ?? inputs.direction ?? inputs.incoming);
      return direction ? { start, direction } : null;
    }
    if (["segment", "ray", "line", "vector"].includes(made.operator) && start) {
      const end = literal.get(String(inputs.end ?? inputs.to ?? inputs.through));
      const direction = end ? { x: end.x - start.x, y: end.y - start.y } : literalVector(inputs.direction);
      return direction ? { start, direction } : null;
    }
    return null;
  };
  /** The side of the surface the incoming light comes from: it leaves that side as it meets the surface. */
  const incidentSide = (inputs: Record<string, unknown>) => (frame: Frame): DeclaredMedia["n1Side"] => {
    const ray = incomingRay(inputs.incoming ?? inputs.direction);
    if (!ray || !(Math.hypot(ray.direction.x, ray.direction.y) > 0)) return undefined;
    const { center, vertex } = frame;
    const radius = Math.hypot(vertex.x - center.x, vertex.y - center.y);
    // The contact: a literal point, else where the incoming ray first meets the
    // drawn face, else the vertex. The face is the half of the circle of
    // curvature on the vertex side of the centre, (p - centre) . (vertex - centre) > 0.
    // A ray that starts outside the circle on the centre side (an object in
    // air beyond 2R before a concave face, or a ray in the glass more than 2R
    // behind a convex one) first crosses the far half, which is not drawn;
    // reading the side there reverses it and swaps n1 and n2.
    let contact = literal.get(String(inputs.origin ?? inputs.point)) ?? vertex;
    if (!literal.has(String(inputs.origin ?? inputs.point)) && ray.start) {
      const start = ray.start;
      const length = Math.hypot(ray.direction.x, ray.direction.y);
      const d = { x: ray.direction.x / length, y: ray.direction.y / length };
      const fx = start.x - center.x;
      const fy = start.y - center.y;
      const b = fx * d.x + fy * d.y;
      const disc = b * b - (fx * fx + fy * fy - radius * radius);
      if (disc >= 0) {
        const at = (t: number) => ({ x: start.x + d.x * t, y: start.y + d.y * t });
        const onFace = (p: RefractionPoint) => (p.x - center.x) * (vertex.x - center.x) + (p.y - center.y) * (vertex.y - center.y) > 0;
        const t = [-b - Math.sqrt(disc), -b + Math.sqrt(disc)].find((value) => value > 1e-9 * radius && onFace(at(value)));
        if (t !== undefined) contact = at(t);
      }
    }
    const outward = ray.direction.x * (contact.x - center.x) + ray.direction.y * (contact.y - center.y);
    if (!(Math.abs(outward) > 1e-9 * radius * Math.hypot(ray.direction.x, ray.direction.y))) return undefined;
    return outward > 0 ? "centre" : "far";
  };
  for (const construction of constructions) {
    if (construction.operator !== "refract_direction") continue;
    const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
    const surfaces = new Set([inputs.normal, inputs.origin, inputs.point].flatMap((reference) =>
      typeof reference === "string" && standsOn.has(reference) ? [standsOn.get(reference)!] : []));
    surfaces.forEach((surface) => declare(surface, inputs, incidentSide(inputs)));
  }
  return media;
}

/** True when the document ties a point to a quantity by id: an annotation or a construction naming both. */
function boundToQuantity(document: SceneDocument, pointId: string, quantityId: string): boolean {
  if (!quantityId) return false;
  const names = (inputs: unknown, id: string) => Object.values((inputs ?? {}) as Record<string, unknown>)
    .some((value) => value === id || (Array.isArray(value) && value.includes(id)));
  const constructions = document.constructions ?? [];
  if (constructions.some((construction) => names(construction.inputs, pointId) && names(construction.inputs, quantityId))) return true;
  // Entities standing on the point (a dimension or segment to it) carry its annotations too.
  const standing = new Set([pointId, ...constructions.filter((construction) => names(construction.inputs, pointId))
    .flatMap((construction) => construction.outputs ?? [])]);
  return (document.annotations ?? []).some((annotation) =>
    annotation?.quantityId === quantityId && (annotation.targetIds ?? []).some((id) => standing.has(id)));
}

const IMAGE_LABEL = /^I(?:\d+|_?\{?\d+\}?|[\u2080-\u2089]+)?['\u2032\u2033\u2019]*$/u;

/** A point the document names or labels as an image (its id, role or label). */
function namedImage(document: SceneDocument, pointId: string): boolean {
  const entity = (document.entities ?? []).find((candidate) => candidate.id === pointId);
  const label = typeof entity?.label === "string" ? entity.label.trim() : "";
  return /image/i.test(pointId) || /image/i.test(entity?.role ?? "") || /image/i.test(label) || IMAGE_LABEL.test(label);
}

function literalPoints(document: SceneDocument): Map<string, RefractionPoint> {
  const literal = new Map<string, RefractionPoint>();
  for (const construction of document.constructions ?? []) {
    const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
    if (construction.operator !== "point" || typeof inputs.x !== "number" || typeof inputs.y !== "number") continue;
    if (inputs.coordinateSpace !== undefined && inputs.coordinateSpace !== "world") continue;
    if (!Number.isFinite(inputs.x) || !Number.isFinite(inputs.y)) continue;
    const id = construction.outputs?.[0];
    if (typeof id === "string") literal.set(id, { x: inputs.x, y: inputs.y });
  }
  return literal;
}

/** Each spherical_surface with a literal vertex, an axis and a centre (declared, or from its signed radius). */
function sphericalSurfaceFrames(document: SceneDocument, literal = literalPoints(document)): Frame[] {
  const constructions = document.constructions ?? [];
  const axisPoints = (id: unknown): [RefractionPoint, RefractionPoint] | null => {
    const producer = constructions.find((construction) => construction.outputs?.includes(id as string));
    if (!producer || (producer.operator !== "line" && producer.operator !== "segment")) return null;
    const inputs = producer.inputs as Record<string, unknown>;
    const start = literal.get(String(inputs.start ?? inputs.from));
    const end = literal.get(String(inputs.end ?? inputs.to ?? inputs.through));
    if (start && end) return [start, end];
    const direction = inputs.direction;
    if (start && Array.isArray(direction) && typeof direction[0] === "number" && typeof direction[1] === "number") {
      return [start, { x: start.x + direction[0], y: start.y + direction[1] }];
    }
    return null;
  };
  const frames: Frame[] = [];
  for (const surface of constructions) {
    if (surface.operator !== "spherical_surface") continue;
    const inputs = surface.inputs as Record<string, unknown>;
    const vertexId = String(inputs.vertex ?? inputs.pole ?? "");
    const vertex = literal.get(vertexId);
    const axis = axisPoints(inputs.axis);
    const surfaceId = surface.outputs?.[0];
    if (!vertex || !axis || typeof surfaceId !== "string") continue;
    const declaredCenter = typeof inputs.center === "string" ? literal.get(inputs.center) : undefined;
    const signedRadius = typeof inputs.signedRadius === "number" ? inputs.signedRadius
      : typeof inputs.radius === "number" ? inputs.radius : undefined;
    const halfHeight = typeof inputs.halfHeight === "number" && inputs.halfHeight > 0 ? inputs.halfHeight : 1;
    let center = declaredCenter;
    if (!center && signedRadius !== undefined) {
      try {
        const geometry = sphericalSurfaceGeometry({ vertex, axisFrom: axis[0], axisTo: axis[1], halfHeight, signedRadius });
        if (geometry.kind === "arc") center = geometry.center;
      } catch { /* an undrawable surface has no frame */ }
    }
    if (!center || !(Math.hypot(center.x - vertex.x, center.y - vertex.y) > 0)) continue;
    frames.push({ surfaceId, vertexId, vertex, center });
  }
  return frames;
}

/** Placed images of declared refracting surfaces that the law does not give. */
export function validateSphericalRefractionImagePlacements(document: SceneDocument, plan: PlanLike): SceneIssue[] {
  const constructions = document.constructions ?? [];
  const surfaces = constructions.filter((construction) => construction.operator === "spherical_surface");
  if (surfaces.length === 0) return [];
  // The plan's indices serve only a surface that declares no media of its own.
  const indices = [...plan.givens ?? [], ...plan.derived ?? []].filter(isRefractiveIndex).map((quantity) => quantity.value);
  const media = [...new Set([1, ...indices])];
  const pairs = indices.length === 0 ? [] : media.flatMap((n1) => media.filter((n2) => n2 !== n1).map((n2) => [n1, n2] as const));
  const givens = numericValues(plan.givens);
  const units = new Map((document.quantities ?? []).map((quantity) => [quantity.id, quantity.unit]));
  const symbolOf = (quantity: TurnPlanQuantityV3) => String(quantity?.symbol ?? "").normalize("NFKC").replace(/\s+/gu, "");
  const derived: DerivedValue[] = (plan.derived ?? []).flatMap((quantity) => {
    if (typeof quantity?.value !== "number" || !Number.isFinite(quantity.value) || quantity.value === 0) return [];
    const value = Math.abs(quantity.value);
    const id = typeof quantity.id === "string" ? quantity.id : "";
    // A derived quantity restating a given (its id or symbol, the same number) is that given. Any other
    // derived number stays an image distance, even one that happens to equal a given.
    const restates = (plan.givens ?? []).some((given) => typeof given?.value === "number" && matches(value, Math.abs(given.value))
      && ((id !== "" && given.id === id) || (symbolOf(given) !== "" && symbolOf(given) === symbolOf(quantity))));
    return [{ value, id, length: isLengthUnit(quantity.unit) || isLengthUnit(units.get(id)), restates }];
  });
  if (givens.length === 0 || derived.length === 0) return [];
  const literal = literalPoints(document);
  // Every surface's vertex and centre stay reserved; only refracting ones are held to the law.
  const frames = sphericalSurfaceFrames(document, literal);
  const declared = declaredMedia(document, plan, frames, literal);
  const refracting = refractingFrames(document, frames);
  // A refracting surface is held to the law when its media are known: declared there, or the plan's indices.
  const known = (frame: Frame) => declared.has(frame.surfaceId) || pairs.length > 0;
  if (!frames.some((frame) => refracting.has(frame.surfaceId) && known(frame))) return [];
  const reserved = new Set<string>(frames.map((frame) => frame.vertexId));
  for (const surface of surfaces) {
    const center = (surface.inputs as Record<string, unknown>).center;
    if (typeof center === "string") reserved.add(center);
  }
  const vertices = frames.map((frame) => frame.vertex);
  const near = (a: RefractionPoint, b: RefractionPoint, scale: number) => Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6 * scale;

  const checked = frames.filter((frame) => refracting.has(frame.surfaceId)).map((frame) => {
    const { vertex, center } = frame;
    const radius = Math.hypot(center.x - vertex.x, center.y - vertex.y);
    const onAxis = (point: RefractionPoint) =>
      Math.abs((center.x - vertex.x) * (point.y - vertex.y) - (center.y - vertex.y) * (point.x - vertex.x)) / radius <= 1e-3 * radius;
    const candidates = [...literal].filter(([id, point]) =>
      !reserved.has(id) && onAxis(point) && !near(point, center, radius) && !vertices.some((other) => near(point, other, radius)));
    const objects: LightSource[] = candidates.filter(([, point]) => vertices.some((other) => {
      const distance = Math.hypot(point.x - other.x, point.y - other.y);
      return givens.some((value) => matches(distance, value));
    })).map(([id, point]) => ({ id, point }));
    // An image sits at an image distance: a derived length, a quantity bound to
    // the point by id, or any derived distance when the point is named an image.
    // A surface whose media are unknown still passes light on but holds no image.
    const placed = !known(frame) ? [] : candidates.flatMap(([id, point]) => {
      const fromVertex = Math.hypot(point.x - vertex.x, point.y - vertex.y);
      const at = derived.filter((quantity) => matches(fromVertex, quantity.value));
      if (at.length === 0) return [];
      const image = namedImage(document, id)
        || at.some((quantity) => !quantity.restates && (quantity.length || boundToQuantity(document, id, quantity.id)));
      return image ? [{ id, point, fromVertex }] : [];
    });
    return { frame, radius, objects, placed };
  });

  /** The next refracting surface the light meets: coaxial with `from`, its vertex nearest downstream. */
  const nextSurface = (from: number, direction: RefractionPoint): number => {
    const { vertex } = checked[from]!.frame;
    let next = -1;
    let nearest = Infinity;
    checked.forEach((surface, index) => {
      if (index === from) return;
      const scale = Math.max(checked[from]!.radius, surface.radius);
      const off = (point: RefractionPoint) => Math.abs(direction.x * (point.y - vertex.y) - direction.y * (point.x - vertex.x));
      if (off(surface.frame.vertex) > 1e-3 * scale || off(surface.frame.center) > 1e-3 * scale) return;
      const along = (surface.frame.vertex.x - vertex.x) * direction.x + (surface.frame.vertex.y - vertex.y) * direction.y;
      if (along > 1e-6 * scale && along < nearest) { next = index; nearest = along; }
    });
    return next;
  };

  // A placed image the law confirms is the object of the next surface along the
  // light, in the medium the light entered (a virtual object when it lies past
  // that vertex). Repeat until no new image is confirmed.
  const confirmed = new Map<string, Array<{ at: number; next: number; direction: RefractionPoint; medium: number }>>();
  const sourcesAt = (index: number): LightSource[] => [
    ...checked[index]!.objects,
    ...[...confirmed].flatMap(([id, list]) => list.filter((entry) => entry.next === index)
      .map((entry) => ({ id, point: literal.get(id)!, direction: entry.direction, n1: entry.medium }))),
  ];
  // A surface with a declared refraction keeps its declared media on their sides: the
  // light from a source starts in the medium on the source's side (for a real object,
  // the side it stands on). Where the figure shows no side, the declared order holds.
  // Only an undeclared surface tries both orders of every pair.
  const mediaFor = (frame: Frame, source: LightSource): Array<readonly [number, number]> => {
    const list = declared.get(frame.surfaceId);
    if (!list) return pairs;
    const { vertex, center } = frame;
    const light = source.direction ?? { x: vertex.x - source.point.x, y: vertex.y - source.point.y };
    const fromCentre = light.x * (vertex.x - center.x) + light.y * (vertex.y - center.y) > 0;
    const ordered = list.map(({ n1, n2, n1Side }) =>
      n1Side === undefined || (n1Side === "centre") === fromCentre ? [n1, n2] as const : [n2, n1] as const);
    return ordered.filter(([n1, n2], at) => ordered.findIndex(([m1, m2]) => m1 === n1 && m2 === n2) === at);
  };
  const lawImages = (index: number, source: LightSource): Array<{ result: SphericalRefractionImage; n2: number }> => {
    const { vertex, center } = checked[index]!.frame;
    return mediaFor(checked[index]!.frame, source).flatMap(([n1, n2]) => {
      if (source.n1 !== undefined && n1 !== source.n1) return [];
      try { return [{ result: sphericalRefractionImage({ vertex, center, object: source.point, direction: source.direction, n1, n2 }), n2 }]; } catch { return []; }
    });
  };
  const agrees = (index: number, result: SphericalRefractionImage, image: RefractionPoint) =>
    Math.hypot(result.image.x - image.x, result.image.y - image.y) <= IMAGE_TOLERANCE * Math.max(Math.abs(result.imageDistance), checked[index]!.radius);
  const seen = new Set<string>();
  for (let grew = true, pass = 0; grew && pass <= checked.length * literal.size; pass += 1) {
    grew = false;
    checked.forEach((surface, index) => {
      for (const { id: imageId, point: image } of surface.placed) {
        for (const source of sourcesAt(index)) {
          if (source.id === imageId) continue;
          for (const { result, n2: medium } of lawImages(index, source)) {
            if (!agrees(index, result, image)) continue;
            const next = nextSurface(index, result.direction);
            const key = `${imageId}|${index}|${medium}|${next}`;
            if (seen.has(key)) continue;
            seen.add(key);
            grew = true;
            confirmed.set(imageId, [...confirmed.get(imageId) ?? [], { at: index, next, direction: result.direction, medium }]);
          }
        }
      }
    });
  }

  const issues: SceneIssue[] = [];
  checked.forEach(({ frame, placed }, index) => {
    for (const { id: imageId, fromVertex } of placed) {
      const entries = confirmed.get(imageId) ?? [];
      // Agrees here, or is this surface's object (an image an earlier surface confirmed).
      if (entries.some((entry) => entry.at === index || entry.next === index)) continue;
      const sources = sourcesAt(index).filter((source) => source.id !== imageId);
      if (sources.length === 0) continue;
      const expected = [...new Set(sources.flatMap((source) => lawImages(index, source)).map(({ result }) => round(Math.abs(result.imageDistance))))];
      const of = sources.some((source) => source.n1 !== undefined) ? "the declared object or an earlier surface's image" : "the declared object";
      issues.push({
        code: "spherical_refraction_image_disagrees",
        message: `${imageId} sits ${round(fromVertex)} from the vertex of ${frame.surfaceId}, but refraction at that surface puts the image of ${of} ${expected.join(" or ")} from it`,
        severity: "fatal",
        entityIds: [imageId, frame.surfaceId],
        expected,
        actual: round(fromVertex),
      });
    }
  });
  return issues;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
