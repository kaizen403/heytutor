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
 * image; it must be the law's image of some declared object (a literal point
 * on the axis at a plan-given distance from a surface vertex) for some pair
 * of the plan's refractive indices (dimensionless values from 1 to 4 written
 * with an n or mu symbol) and 1. Otherwise:
 * `spherical_refraction_image_disagrees`.
 *
 * `spherical_surface` also draws mirrors, and a refractive index in the plan
 * says nothing about which surface it belongs to. A surface refracts only
 * when the document says so (`refractingSphericalSurfaces`). Nothing is read
 * from the question or from role text.
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
  /** Object point on the axis; light travels from it to the vertex. */
  object: RefractionPoint;
  /** Index of the object's medium. */
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
}

/** Image point of one refracting spherical surface (paraxial law, Cartesian signs). */
export function sphericalRefractionImage(input: SphericalRefractionImageInput): SphericalRefractionImage {
  const { vertex, object } = input;
  const gap = Math.hypot(vertex.x - object.x, vertex.y - object.y);
  if (!(gap > 0)) throw new Error("spherical refraction object sits on the vertex");
  const direction = { x: (vertex.x - object.x) / gap, y: (vertex.y - object.y) / gap };
  const radius = input.center
    ? (input.center.x - vertex.x) * direction.x + (input.center.y - vertex.y) * direction.y
    : input.radius;
  if (radius === undefined || !Number.isFinite(radius)) throw new Error("spherical refraction needs a centre or a radius");
  const objectDistance = -gap;
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
  const indices = [...plan.givens ?? [], ...plan.derived ?? []].filter(isRefractiveIndex).map((quantity) => quantity.value);
  if (indices.length === 0) return [];
  const media = [...new Set([1, ...indices])];
  const pairs = media.flatMap((n1) => media.filter((n2) => n2 !== n1).map((n2) => [n1, n2] as const));
  const givens = numericValues(plan.givens);
  const derived = numericValues(plan.derived).filter((value) => !givens.some((given) => matches(value, given)));
  if (givens.length === 0 || derived.length === 0) return [];

  const literal = literalPoints(document);
  // Every surface's vertex and centre stay reserved; only refracting ones are held to the law.
  const frames = sphericalSurfaceFrames(document, literal);
  const refracting = refractingFrames(document, frames);
  if (!frames.some((frame) => refracting.has(frame.surfaceId))) return [];
  const reserved = new Set<string>(frames.map((frame) => frame.vertexId));
  for (const surface of surfaces) {
    const center = (surface.inputs as Record<string, unknown>).center;
    if (typeof center === "string") reserved.add(center);
  }
  const vertices = frames.map((frame) => frame.vertex);
  const near = (a: RefractionPoint, b: RefractionPoint, scale: number) => Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6 * scale;

  const issues: SceneIssue[] = [];
  for (const frame of frames) {
    if (!refracting.has(frame.surfaceId)) continue;
    const { vertex, center } = frame;
    const radius = Math.hypot(center.x - vertex.x, center.y - vertex.y);
    const onAxis = (point: RefractionPoint) =>
      Math.abs((center.x - vertex.x) * (point.y - vertex.y) - (center.y - vertex.y) * (point.x - vertex.x)) / radius <= 1e-3 * radius;
    const candidates = [...literal].filter(([id, point]) =>
      !reserved.has(id) && onAxis(point) && !near(point, center, radius) && !vertices.some((other) => near(point, other, radius)));
    const objects = candidates.filter(([, point]) => vertices.some((other) => {
      const distance = Math.hypot(point.x - other.x, point.y - other.y);
      return givens.some((value) => matches(distance, value));
    }));
    for (const [imageId, image] of candidates) {
      const fromVertex = Math.hypot(image.x - vertex.x, image.y - vertex.y);
      if (!derived.some((value) => matches(fromVertex, value))) continue;
      const sources = objects.filter(([id]) => id !== imageId);
      if (sources.length === 0) continue;
      const lawImages: number[] = [];
      let agrees = false;
      for (const [, object] of sources) {
        for (const [n1, n2] of pairs) {
          let result: SphericalRefractionImage;
          try { result = sphericalRefractionImage({ vertex, center, object, n1, n2 }); } catch { continue; }
          const gap = Math.hypot(result.image.x - image.x, result.image.y - image.y);
          if (gap <= IMAGE_TOLERANCE * Math.max(Math.abs(result.imageDistance), radius)) agrees = true;
          lawImages.push(Math.abs(result.imageDistance));
        }
      }
      if (agrees) continue;
      issues.push({
        code: "spherical_refraction_image_disagrees",
        message: `${imageId} sits ${round(fromVertex)} from the vertex of ${frame.surfaceId}, but refraction at that surface puts the image of the declared object ${[...new Set(lawImages.map(round))].join(" or ")} from it`,
        severity: "fatal",
        entityIds: [imageId, frame.surfaceId],
        expected: [...new Set(lawImages.map(round))],
        actual: round(fromVertex),
      });
    }
  }
  return issues;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
