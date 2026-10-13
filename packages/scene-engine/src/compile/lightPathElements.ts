/**
 * Light paths stop at the optical elements they meet.
 *
 * A ray's drawn extent comes from a construction span or the view edge, so a
 * refracted ray inside a prism ran straight on through the second face, a ray
 * refracted into a sphere left through the far side unbent, and a ray to a
 * convex mirror's centre passed through the mirror. Each is a figure that
 * shows light crossing glass or a mirror with no event there.
 *
 * Rule, from declared operator outputs and inputs only:
 * - a light path may cross an element boundary only at one of its own
 *   vertices;
 * - an outgoing path is cut at its first crossing (drawn extent and label
 *   anchor both follow the cut);
 * - a path that is incident on a contact and crosses an element before that
 *   contact cannot be repaired: `incident_path_crosses_element`.
 *
 * Two crossings are not errors, because light really does pass there:
 * - Normal incidence. A path that meets a glass boundary within 4 degrees of
 *   the surface normal goes on unbent (a ray along a radius of a sphere or a
 *   semicircular block, a ray square to a slab face). Glass is a closed
 *   region, a thin lens, or a surface with a declared refraction. A mirror (a
 *   surface with a declared reflection and no refraction, or a closed body
 *   that light reflects from outside) never lets light through.
 * - Thin lens convention. Rays meet a thin lens at its centre plane, so a
 *   path that bends there (a vertex on the plane inside the aperture, or
 *   inside the drawn lens) or runs straight through the lens centre passes
 *   the lens; a straight path across the plane elsewhere is cut. Thin
 *   lenses are `lens_section` outputs (plane through `center` across `axis`,
 *   aperture the drawn half height), the `objective` and `eyepiece` lines of
 *   `optical_train`, and a drawn segment or line lying on such a plane or on
 *   the plane of a `gaussian_image` or `optical_focus` of kind lens.
 * Thick glass (a sphere, a prism, a slab, a block) has no centre plane: a
 * path that crosses it away from the normal is cut or refused, whatever
 * points it passes inside.
 */
import type { SceneDocument, SceneIssue } from "../types";
import { refractingSphericalSurfaces } from "../physics/sphericalRefractionImage";

interface Point { x: number; y: number }

type PathValue = {
  kind: "path";
  points: Point[];
  closed?: boolean;
  directed?: boolean;
  infinite?: boolean;
  elementClip?: Point;
};
type ElementValue =
  | PathValue
  | { kind: "circle"; center: Point; radius: number }
  | { kind: "arc"; center: Point; radius: number; startAngle: number; endAngle: number };
type GeometryLike = { kind: string };

/** Operators whose `surface` (or `target`) input is an optical boundary. */
const SURFACE_OPERATORS = new Set(["refract_at", "reflect_at", "surface_contact", "surface_intersection", "normal_at"]);
/** Operators whose outputs are optical elements. */
const ELEMENT_OPERATORS = new Set(["lens_section", "spherical_surface"]);
/** A document has light paths only when it declares an optical event or element. */
const OPTICS_OPERATORS = new Set([...SURFACE_OPERATORS, ...ELEMENT_OPERATORS, "refract_direction", "reflect_direction", "optical_train"]);
/** Light within this angle of a glass boundary's normal crosses it unbent (covers a 24 sided outline of a round face). */
export const NORMAL_INCIDENCE_DEG = 4;
const NORMAL_INCIDENCE_COS = Math.cos(NORMAL_INCIDENCE_DEG * Math.PI / 180);

export interface LightPathRole {
  /** Contacts this path is incident on (point references as declared). */
  contacts: unknown[];
  /** The second point of an infinite path is a declared point it passes through. */
  declaredThrough: boolean;
}

export interface OpticsRoles {
  lightPaths: Map<string, LightPathRole>;
  normals: Set<string>;
  surfaces: Set<string>;
  elements: Set<string>;
  /** Thin lenses (`lens_section` outputs): rays bend at their centre plane. */
  thinLenses: Set<string>;
  /** Thin lens centre planes the document declares. */
  lensPlanes: LensPlane[];
  /** Surfaces with a declared refraction (glass faces). */
  refracting: Set<string>;
  /** Surfaces with a declared reflection, and the light each reflection receives. */
  reflections: Array<{ surface: string; incoming: unknown; contact: unknown }>;
}

/** A thin lens centre plane: a drawn line, or the plane through `center` across `axis`. */
export interface LensPlane {
  /** Elements drawn as this lens; their outline gives the aperture. */
  elements: string[];
  line?: string;
  center?: unknown;
  /** The lens axis: with `line`, it fixes the lens centre on that line. */
  axis?: unknown;
}

const rolesCache = new WeakMap<SceneDocument, OpticsRoles | null>();

/** Light paths, normals and element boundaries a document declares, or null without optics. */
export function opticsRoles(document: SceneDocument): OpticsRoles | null {
  if (rolesCache.has(document)) return rolesCache.get(document)!;
  const constructions = document.constructions ?? [];
  if (!constructions.some((construction) => OPTICS_OPERATORS.has(construction.operator))) {
    rolesCache.set(document, null);
    return null;
  }
  const roles = collectOpticsRoles(document);
  rolesCache.set(document, roles);
  return roles;
}

function collectOpticsRoles(document: SceneDocument): OpticsRoles {
  const constructions = document.constructions ?? [];
  const lightPaths = new Map<string, LightPathRole>();
  const normals = new Set<string>();
  const surfaces = new Set<string>();
  const elements = new Set<string>();
  const thinLenses = new Set<string>();
  const lensPlanes: LensPlane[] = [];
  const refracting = new Set<string>();
  const reflections: OpticsRoles["reflections"] = [];
  // Normals and contacts standing on a surface, so direction operators find it.
  const standsOn = new Map<string, string>();
  const light = (id: unknown, contact?: unknown, declaredThrough = false) => {
    if (typeof id !== "string" || !id) return;
    const role = lightPaths.get(id) ?? { contacts: [], declaredThrough: false };
    if (contact !== undefined) role.contacts.push(contact);
    role.declaredThrough ||= declaredThrough;
    lightPaths.set(id, role);
  };
  for (const construction of constructions) {
    const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
    const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
    const operator = construction.operator;
    if (SURFACE_OPERATORS.has(operator)) {
      const surface = inputs.surface ?? inputs.target;
      if (typeof surface === "string") {
        surfaces.add(surface);
        const event = operator === "refract_at" || operator === "reflect_at";
        if (operator === "refract_at") refracting.add(surface);
        if (operator === "reflect_at") reflections.push({ surface, incoming: outputs[0], contact: inputs.point ?? inputs.contact });
        for (const id of event ? [outputs[1], inputs.point ?? inputs.contact] : outputs) {
          if (typeof id === "string") standsOn.set(id, surface);
        }
      }
    }
    if (ELEMENT_OPERATORS.has(operator)) outputs.forEach((id) => elements.add(id));
    if (operator === "lens_section") {
      outputs.forEach((id) => thinLenses.add(id));
      lensPlanes.push({ elements: outputs.filter((id): id is string => typeof id === "string"), center: inputs.center, axis: inputs.axis });
    } else if (operator === "optical_train") {
      for (const line of [inputs.objective, inputs.eyepiece]) {
        if (typeof line === "string") lensPlanes.push({ elements: [], line, axis: inputs.axis });
      }
    } else if ((operator === "gaussian_image" || operator === "optical_focus") && inputs.kind === "lens") {
      lensPlanes.push({ elements: [], center: inputs.center, axis: inputs.axis });
    }
    if (operator === "refract_at" || operator === "reflect_at") {
      light(outputs[0], inputs.point ?? inputs.contact);
      if (outputs[1]) normals.add(outputs[1]);
      light(outputs[2]);
    } else if (operator === "refract_direction" || operator === "reflect_direction") {
      outputs.forEach((id) => light(id));
      light(inputs.incoming ?? inputs.direction, inputs.origin ?? inputs.point);
      if (typeof inputs.normal === "string") normals.add(inputs.normal);
    } else if (operator === "surface_contact") {
      if (outputs[1]) light(outputs[1], outputs[0]);
    } else if (operator === "normal_at") {
      outputs.forEach((id) => normals.add(id));
    } else if (operator === "optical_train") {
      outputs.forEach((id) => light(id));
    } else if (operator === "ray") {
      light(outputs[0], undefined, true);
    }
  }
  for (const construction of constructions) {
    if (construction.operator !== "refract_direction" && construction.operator !== "reflect_direction") continue;
    const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
    for (const reference of [inputs.normal, inputs.origin, inputs.point]) {
      const surface = typeof reference === "string" ? standsOn.get(reference) : undefined;
      if (!surface) continue;
      if (construction.operator === "refract_direction") refracting.add(surface);
      else reflections.push({ surface, incoming: inputs.incoming ?? inputs.direction, contact: inputs.origin ?? inputs.point });
    }
  }
  for (const assertion of document.assertions ?? []) {
    if (assertion?.predicate !== "snells_law" || !Array.isArray(assertion.entities)) continue;
    for (const id of assertion.entities) {
      const surface = typeof id === "string" ? standsOn.get(id) : undefined;
      if (surface) refracting.add(surface);
    }
  }
  refractingSphericalSurfaces(document).forEach((id) => refracting.add(id));
  for (const entity of document.entities ?? []) {
    if (entity.kind === "ray") light(entity.id);
  }
  surfaces.forEach((id) => elements.add(id));
  // A normal is never a light path, whatever kind the planner gave it.
  normals.forEach((id) => lightPaths.delete(id));
  return { lightPaths, normals, surfaces, elements, thinLenses, lensPlanes, refracting, reflections };
}

export interface LightPathClipInput {
  document: SceneDocument;
  geometry: Map<string, GeometryLike>;
  /** True when the entity is drawn ink in the compiled figure. */
  drawn: (id: string) => boolean;
  resolvePoint: (value: unknown) => Point;
  /** A declared numeric input (literal or quantity), or null when it has none. */
  resolveNumber?: (value: unknown) => number | null;
  issues: SceneIssue[];
}

/**
 * Cut every drawn light path at the first element boundary it crosses away
 * from its own vertices, or report an incident path that crosses one before
 * its contact. Finite paths are shortened in place; infinite rays keep their
 * definition and carry `elementClip`, which the renderer applies after the
 * view clip.
 */
export function clipLightPathsAtElements(input: LightPathClipInput): void {
  const roles = opticsRoles(input.document);
  if (!roles) return;
  const { geometry } = input;
  const paths: Array<{ id: string; value: PathValue; role: LightPathRole; vertices: Point[] }> = [];
  for (const [id, role] of roles.lightPaths) {
    if (!input.drawn(id)) continue;
    const value = geometry.get(id);
    if (!isPath(value) || value.closed || value.points.length < 2) continue;
    if (value.infinite && (!value.directed || value.points.length !== 2)) continue;
    const vertices = value.infinite
      ? (role.declaredThrough ? value.points.slice(0, 2) : [value.points[0]!])
      : value.points;
    paths.push({ id, value, role, vertices });
  }
  if (paths.length === 0) return;

  const candidates = new Map<string, ElementValue>();
  for (const id of roles.elements) {
    if (!input.drawn(id) || roles.lightPaths.has(id)) continue;
    const value = geometry.get(id);
    if (isElement(value)) candidates.set(id, value);
  }
  const allVertices = paths.flatMap((path) => path.vertices);
  // Closed regions become elements once a light path has a vertex on their edge.
  const closedRegions: Array<[string, ElementValue]> = [];
  for (const [id, value] of geometry) {
    if (candidates.has(id) || roles.lightPaths.has(id) || roles.normals.has(id) || !input.drawn(id)) continue;
    if (!isElement(value) || !isClosed(value)) continue;
    closedRegions.push([id, value]);
  }
  // Tolerances scale with the figure: about 3 px on a full diagram.
  const span = sceneScale([...allVertices, ...[...candidates.values(), ...closedRegions.map(([, value]) => value)].flatMap(elementExtent)]);
  if (!(span > 1e-9)) return;
  const tolerance = 4e-3 * span;
  for (const [id, value] of closedRegions) {
    if (allVertices.some((vertex) => boundaryDistance(vertex, value) <= tolerance)) candidates.set(id, value);
  }
  if (candidates.size === 0) return;
  const far = 1e4 * span;
  const lensChords = thinLensChords(input, roles, candidates, far, tolerance);
  const glass = new Map<string, boolean>();
  for (const [id, value] of candidates) {
    glass.set(id, isGlass(input, roles, id, value, tolerance) && !(isClosed(value) && insideIndexConflict(input, value, tolerance)));
  }

  for (const path of paths) {
    const segments = pathSegments(path.value, far);
    let best: { s: number; point: Point; elementId: string } | null = null;
    for (const [elementId, element] of candidates) {
      if (elementId === path.id) continue;
      // Thin lens convention: a path across the centre plane inside the aperture passes the lens.
      if (lensChords.get(elementId)?.some((lens) => passesThinLens(segments, path.vertices, lens, element, tolerance))) continue;
      for (const hit of crossings(segments, element, far)) {
        if (path.vertices.some((vertex) => distance(vertex, hit.point) <= tolerance)) continue;
        // Normal incidence: light crosses glass along the normal unbent.
        if (glass.get(elementId) && alongNormal(hit)) continue;
        if (!best || hit.s < best.s) best = { s: hit.s, point: hit.point, elementId };
      }
    }
    if (!best) continue;
    const incidentCrossing = path.role.contacts.some((reference) => {
      let contact: Point;
      try { contact = input.resolvePoint(reference); } catch { return false; }
      const projected = projectOntoSegments(contact, segments);
      return projected.distance <= tolerance && best!.s < projected.s - tolerance;
    });
    if (incidentCrossing) {
      input.issues.push({
        code: "incident_path_crosses_element",
        message: `${path.id} crosses ${best.elementId} before it reaches its contact; light cannot pass an optical element with no event there`,
        severity: "fatal",
        entityIds: [path.id, best.elementId],
      });
      continue;
    }
    if (path.value.infinite) {
      geometry.set(path.id, { ...path.value, elementClip: best.point } as GeometryLike);
    } else {
      geometry.set(path.id, { ...path.value, points: truncatePoints(path.value.points, best.s, best.point) } as GeometryLike);
    }
  }
}

/**
 * Centre plane chords of the thin lenses among the candidate elements. A
 * `lens_section` spans its drawn half height about its centre; a drawn
 * segment or line on a lens plane (an `optical_train` lens line, or a line
 * across a declared lens centre) is its own chord.
 */
function thinLensChords(
  input: LightPathClipInput,
  roles: OpticsRoles,
  candidates: Map<string, ElementValue>,
  far: number,
  tolerance: number,
): Map<string, ThinLens[]> {
  const chords = new Map<string, ThinLens[]>();
  const add = (id: string, chord: [Point, Point], center: Point | null) => chords.set(id, [...(chords.get(id) ?? []), { chord, center }]);
  const planes: Array<{ line: [Point, Point]; center: Point | null }> = [];
  const straight = (value: GeometryLike | undefined): [Point, Point] | null => {
    if (!isPath(value) || value.closed || value.points.length !== 2 || !value.points.every(finitePoint)) return null;
    const [a, b] = value.points as [Point, Point];
    const length = distance(a, b);
    if (!(length > 0)) return null;
    if (!value.infinite) return [a, b];
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    return [value.directed ? a : { x: a.x - ux * far, y: a.y - uy * far }, { x: a.x + ux * far, y: a.y + uy * far }];
  };
  for (const plane of roles.lensPlanes) {
    if (plane.line !== undefined) {
      const chord = straight(input.geometry.get(plane.line));
      if (!chord) continue;
      const axis = plane.axis === undefined ? null : straight(input.geometry.get(String(plane.axis)));
      const center = axis ? lineIntersection(chord, axis) : null;
      planes.push({ line: chord, center });
      add(plane.line, chord, center);
      continue;
    }
    let center: Point;
    try { center = input.resolvePoint(plane.center); } catch { continue; }
    const axis = axisDirection(plane.axis, input.geometry);
    if (!finitePoint(center) || !axis) continue;
    const across = { x: -axis.y, y: axis.x };
    planes.push({ line: [center, { x: center.x + across.x, y: center.y + across.y }], center });
    for (const id of plane.elements) {
      const value = input.geometry.get(id);
      if (!isPath(value) || !value.points.every(finitePoint)) continue;
      const half = Math.max(...value.points.map((point) => Math.abs((point.x - center.x) * across.x + (point.y - center.y) * across.y)));
      if (!(half > 0)) continue;
      add(id, [
        { x: center.x - across.x * half, y: center.y - across.y * half },
        { x: center.x + across.x * half, y: center.y + across.y * half },
      ], center);
    }
  }
  // A thin lens drawn as a segment or line on a lens plane.
  for (const [id, value] of candidates) {
    if (chords.has(id)) continue;
    const chord = straight(value as GeometryLike);
    if (!chord) continue;
    const plane = planes.find(({ line: [a, b] }) => lineDistance(chord[0], a, b) <= tolerance && lineDistance(chord[1], a, b) <= tolerance);
    if (plane) add(id, chord, plane.center);
  }
  return chords;
}

/** Unit direction of an axis given as a drawn line or a literal direction. */
function axisDirection(axis: unknown, geometry: Map<string, GeometryLike>): Point | null {
  let vector: Point | null = null;
  if (typeof axis === "string") {
    const value = geometry.get(axis);
    if (isPath(value) && value.points.length >= 2 && value.points.every(finitePoint)) {
      vector = { x: value.points[1]!.x - value.points[0]!.x, y: value.points[1]!.y - value.points[0]!.y };
    }
  } else if (Array.isArray(axis) && axis.length === 2 && axis.every((value) => typeof value === "number")) {
    vector = { x: axis[0] as number, y: axis[1] as number };
  }
  const length = vector ? Math.hypot(vector.x, vector.y) : 0;
  return vector && length > 0 ? { x: vector.x / length, y: vector.y / length } : null;
}

interface ThinLens { chord: [Point, Point]; center: Point | null }

/**
 * Thin lens convention: a path passes the lens when it bends there (a vertex
 * on the centre plane inside the aperture, or inside the drawn lens) or goes
 * straight through the lens centre. A straight path across the plane
 * anywhere else would bend there, so it is cut at the lens as before.
 */
function passesThinLens(segments: Segment[], vertices: Point[], lens: ThinLens, element: ElementValue, tolerance: number): boolean {
  const [a, b] = lens.chord;
  const length = distance(a, b);
  if (!(length > 0)) return false;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const from = { x: a.x - ux * tolerance, y: a.y - uy * tolerance };
  const to = { x: b.x + ux * tolerance, y: b.y + uy * tolerance };
  if (vertices.some((vertex) => pointSegmentDistance(vertex, from, to) <= tolerance)) return true;
  if (isClosed(element) && vertices.some((vertex) => insideElement(vertex, element))) return true;
  const center = lens.center;
  return center !== null && finitePoint(center) && segments.some((segment) => pointSegmentDistance(center, segment.a, segment.b) <= tolerance);
}

/** Where two lines (each through two points) meet, or null when parallel. */
function lineIntersection([a, b]: [Point, Point], [c, d]: [Point, Point]): Point | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= 1e-12 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  return { x: a.x + rx * t, y: a.y + ry * t };
}

/**
 * Glass lets light along the normal through; a mirror does not. Glass is a
 * thin lens, a surface with a declared refraction, or a closed region,
 * unless that region carries a declared reflection, no refraction, and its
 * reflected light arrives from outside (a mirror body; light reflected
 * inside closed glass is total internal reflection).
 */
function isGlass(input: LightPathClipInput, roles: OpticsRoles, id: string, value: ElementValue, tolerance: number): boolean {
  return glassBody(roles, input.geometry, input.resolvePoint, id, value, tolerance);
}

/**
 * The same glass or mirror test for a drawn element, where only the compiled
 * geometry is at hand: a body light along its normal may cross. Light never
 * passes through a mirror, whatever angle it meets it at.
 */
export function isRefractingBody(
  document: SceneDocument,
  geometry: Map<string, GeometryLike>,
  id: string,
  value: GeometryLike,
  tolerance: number,
): boolean {
  const roles = opticsRoles(document);
  if (!roles || !isElement(value)) return false;
  return glassBody(roles, geometry, (reference) => geometryPoint(geometry, reference), id, value, tolerance);
}

function glassBody(
  roles: OpticsRoles,
  geometry: Map<string, GeometryLike>,
  resolvePoint: (value: unknown) => Point,
  id: string,
  value: ElementValue,
  tolerance: number,
): boolean {
  if (roles.thinLenses.has(id) || roles.refracting.has(id)) return true;
  if (!isClosed(value)) return false;
  return !roles.reflections.some((reflection) => {
    if (reflection.surface !== id || typeof reflection.incoming !== "string") return false;
    const incoming = geometry.get(reflection.incoming);
    if (!isPath(incoming) || incoming.points.length < 2 || !incoming.points.every(finitePoint)) return false;
    const start = incoming.points[0]!;
    const next = incoming.infinite ? incoming.points[1]! : incoming.points.at(-1)!;
    const length = distance(start, next);
    if (!(length > 0)) return false;
    let contact: Point;
    try { contact = reflection.contact === undefined ? next : resolvePoint(reflection.contact); } catch { return false; }
    if (!finitePoint(contact)) return false;
    const probe = { x: contact.x - (next.x - start.x) / length * 4 * tolerance, y: contact.y - (next.y - start.y) / length * 4 * tolerance };
    return !insideElement(probe, value);
  });
}

/** A point reference resolved from compiled geometry: a point id or a literal [x, y]. */
function geometryPoint(geometry: Map<string, GeometryLike>, reference: unknown): Point {
  if (Array.isArray(reference) && typeof reference[0] === "number" && typeof reference[1] === "number") return { x: reference[0], y: reference[1] };
  const value = typeof reference === "string" ? geometry.get(reference) as { kind: string; point?: Point } | undefined : undefined;
  if (value?.kind === "point" && finitePoint(value.point)) return value.point;
  throw new Error(`no point for ${String(reference)}`);
}

/**
 * True when the refractions on a closed element's boundary disagree on the
 * index inside it (n1 is the side the incident light comes from). Such a
 * figure has its media inverted somewhere (a recorded prism drew a ray
 * entering the glass along one face's normal and then refracting from "air"
 * at the other), so no crossing of it is excused as normal incidence.
 */
function insideIndexConflict(input: LightPathClipInput, element: ElementValue, tolerance: number): boolean {
  const number = (value: unknown): number | null => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    return input.resolveNumber?.(value) ?? null;
  };
  let inside: number | null = null;
  for (const construction of input.document.constructions ?? []) {
    if (construction.operator !== "refract_at" && construction.operator !== "refract_direction") continue;
    const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
    const n1 = number(inputs.n1);
    const n2 = number(inputs.n2);
    if (n1 === null || n2 === null || !(n1 > 0) || !(n2 > 0)) continue;
    const incoming = input.geometry.get(construction.operator === "refract_at"
      ? String((construction.outputs ?? [])[0] ?? "")
      : String(inputs.incoming ?? inputs.direction ?? ""));
    if (!isPath(incoming) || incoming.points.length < 2 || !incoming.points.every(finitePoint)) continue;
    let contact: Point;
    try { contact = input.resolvePoint(construction.operator === "refract_at" ? inputs.point ?? inputs.contact : inputs.origin ?? inputs.point); } catch { continue; }
    if (!finitePoint(contact) || boundaryDistance(contact, element) > tolerance) continue;
    const start = incoming.points[0]!;
    const next = incoming.infinite ? incoming.points[1]! : incoming.points.at(-1)!;
    const length = distance(start, next);
    if (!(length > 0)) continue;
    const probe = { x: contact.x - (next.x - start.x) / length * 4 * tolerance, y: contact.y - (next.y - start.y) / length * 4 * tolerance };
    const index = insideElement(probe, element) ? n1 : n2;
    if (inside !== null && Math.abs(inside - index) > 1e-6 * Math.max(inside, index)) return true;
    inside = index;
  }
  return false;
}

function alongNormal(hit: { direction: Point; normal: Point }): boolean {
  const scale = Math.hypot(hit.direction.x, hit.direction.y) * Math.hypot(hit.normal.x, hit.normal.y);
  if (!(scale > 0)) return false;
  return Math.abs(hit.direction.x * hit.normal.x + hit.direction.y * hit.normal.y) >= NORMAL_INCIDENCE_COS * scale;
}

/** Entity kinds a planner draws a ray as. */
const RAY_KINDS = new Set(["ray", "segment", "line", "vector", "polyline", "path"]);

/** Operators whose `axis` input declares an optical axis. */
const AXIS_OPERATORS = new Set(["lens_section", "spherical_surface", "optical_train", "gaussian_image", "optical_focus"]);

export interface AxisArrowInput {
  document: SceneDocument;
  geometry: Map<string, GeometryLike>;
  /** True when the entity is drawn ink in the compiled figure. */
  drawn: (id: string) => boolean;
  /** A declared numeric input (literal or quantity), or null when it has none. */
  resolveNumber?: (value: unknown) => number | null;
  issues: SceneIssue[];
}

/**
 * Object and image arrows stand on their rays. When a figure draws light
 * paths and declares an optical axis (the `axis` input of an optics
 * operator), every drawn arrow (`vector` output or entity) whose foot is on
 * that axis and which stands across it must have its tip on a drawn ray or
 * that ray's straight extension. Otherwise the arrows mark an object or
 * image the rays never form: `axis_arrow_off_rays`.
 *
 * Planners often draw rays as plain segments, so a ray here is a declared
 * light path, or a drawn open straight path (segment, ray, line, polyline,
 * oblique vector) that is not an axis, a normal, an optical element or one of
 * the standing arrows themselves, provided it is joined to the light (an end
 * on a declared ray or a stroke already joined, on an element's boundary,
 * inside a thin lens or on a lens line) and does not stand across the axis
 * the arrow being checked stands on (a ray of a second setup, across another
 * axis, still counts). A screen, a lens line, a dimension line or a stray
 * segment through a misplaced tip supports nothing, and no stroke lying
 * along an arrow fixes that arrow's height.
 *
 * An image arrow comes from a paraxial model (`gaussian_image`, the mirror
 * and refraction laws), while the engine traces a reflection or refraction
 * at a spherical surface exactly, so spherical aberration takes the traced
 * ray a few pixels off the image. Where a traced ray leaves a spherical
 * surface along the exact law, the paraxial ray from the same contact counts
 * as a ray too (see `paraxialCounterpart`).
 */
export function validateAxisArrowsOnRays(input: AxisArrowInput): void {
  const { document, geometry } = input;
  const constructions = document.constructions ?? [];
  const axisIds = new Set<string>();
  for (const construction of constructions) {
    const axis = (construction.inputs as Record<string, unknown> | undefined)?.axis;
    if (AXIS_OPERATORS.has(construction.operator) && typeof axis === "string") axisIds.add(axis);
  }
  if (axisIds.size === 0) return;
  const roles = opticsRoles(document) ?? collectOpticsRoles(document);
  const openPath = (value: GeometryLike | undefined): value is PathValue =>
    isPath(value) && !value.closed && value.points.length >= 2 && value.points.every(finitePoint);
  // The check runs only on figures that draw a declared light path.
  if (![...roles.lightPaths.keys()].some((id) => input.drawn(id) && openPath(geometry.get(id)))) return;
  const axes: Array<[Point, Point]> = [];
  for (const id of axisIds) {
    const value = geometry.get(id);
    if (isPath(value) && value.points.length >= 2 && value.points.every(finitePoint)) {
      axes.push([value.points[0]!, value.points.at(-1)!]);
    }
  }
  if (axes.length === 0) return;
  const vectorOutputs = new Set(constructions.flatMap((construction) =>
    construction.operator === "vector" && Array.isArray(construction.outputs) ? construction.outputs : []));
  const arrows: Array<{ id: string; foot: Point; tip: Point }> = [];
  for (const entity of document.entities ?? []) {
    if (entity.kind !== "vector" && !vectorOutputs.has(entity.id)) continue;
    if (roles.lightPaths.has(entity.id) || !input.drawn(entity.id)) continue;
    const value = geometry.get(entity.id);
    if (!isPath(value) || value.infinite || value.points.length < 2 || !value.points.every(finitePoint)) continue;
    const foot = value.points[0]!;
    const tip = value.points.at(-1)!;
    if (distance(foot, tip) > 0) arrows.push({ id: entity.id, foot, tip });
  }
  if (arrows.length === 0) return;
  const lightPoints = [...roles.lightPaths.keys()].flatMap((id) => {
    const value = geometry.get(id);
    return input.drawn(id) && openPath(value) ? value.points : [];
  });
  // About 3 px on a full diagram, as for the element crossings.
  const span = sceneScale([...lightPoints, ...arrows.flatMap((arrow) => [arrow.foot, arrow.tip])]);
  if (!(span > 1e-9)) return;
  const tolerance = 4e-3 * span;
  // A direction stands across an axis when it is within about 11 degrees of its normal.
  const acrossAxis = ([a, b]: [Point, Point], vx: number, vy: number) =>
    Math.abs((b.x - a.x) * vx + (b.y - a.y) * vy) <= 0.2 * distance(a, b) * Math.hypot(vx, vy);
  // Each arrow with the axes it stands on: its foot on the axis, the arrow across it.
  const standing = arrows.flatMap((arrow) => {
    const on = axes.flatMap((axis, index) => lineDistance(arrow.foot, axis[0], axis[1]) <= tolerance
      && acrossAxis(axis, arrow.tip.x - arrow.foot.x, arrow.tip.y - arrow.foot.y) ? [index] : []);
    return on.length > 0 ? [{ ...arrow, axes: on }] : [];
  });
  if (standing.length === 0) return;
  const standingIds = new Set(standing.map((arrow) => arrow.id));
  const lensLines = new Set(roles.lensPlanes.flatMap((plane) => plane.line === undefined ? [] : [plane.line]));
  const far = 1e4 * span;
  // The axes a stroke stands across. Against an arrow on one of them, the
  // stroke (a screen, a lens line, a height mark) runs along the arrow and
  // would pass it at any height; against an arrow on another axis (a second
  // setup) it is an ordinary ray. A stroke of no length stands across all.
  const acrossAxes = (points: Point[]) => {
    const vx = points.at(-1)!.x - points[0]!.x;
    const vy = points.at(-1)!.y - points[0]!.y;
    if (!(Math.hypot(vx, vy) > 0)) return axes.map((_, index) => index);
    return axes.flatMap((axis, index) => acrossAxis(axis, vx, vy) ? [index] : []);
  };
  const rays: Array<{ points: Point[]; value: PathValue }> = [];
  const candidates: Array<{ points: Point[]; value: PathValue; across: number[] }> = [];
  for (const entity of document.entities ?? []) {
    const id = entity.id;
    const light = roles.lightPaths.has(id);
    if (!RAY_KINDS.has(entity.kind) && !light) continue;
    if (!input.drawn(id) || axisIds.has(id) || standingIds.has(id) || lensLines.has(id)) continue;
    if (roles.normals.has(id) || (roles.elements.has(id) && !light)) continue;
    const value = geometry.get(id);
    if (!openPath(value)) continue;
    if (light) rays.push({ points: value.points, value });
    else candidates.push({ points: value.points, value, across: acrossAxes(value.points) });
  }
  // A stroke that is not a declared light path is a ray only when it is
  // joined to the light: an end on a declared ray (or on a stroke already
  // joined), on an element's boundary, inside a thin lens, or on a lens line.
  // A stray segment through a misplaced tip, a dimension line or a screen
  // edge drawn apart from the rays supports nothing.
  const anchors: Array<{ id: string; value: ElementValue }> = [];
  for (const id of roles.elements) {
    if (!input.drawn(id) || roles.lightPaths.has(id)) continue;
    const value = geometry.get(id);
    if (isElement(value)) anchors.push({ id, value });
  }
  for (const id of lensLines) {
    const value = geometry.get(id);
    if (input.drawn(id) && isElement(value)) anchors.push({ id, value });
  }
  // A thin lens drawn as a stroke on a declared lens plane (through `center` across `axis`).
  const planes: Array<[Point, Point]> = [];
  for (const plane of roles.lensPlanes) {
    if (plane.line !== undefined) continue;
    let center: Point;
    try { center = geometryPoint(geometry, plane.center); } catch { continue; }
    const axis = axisDirection(plane.axis, geometry);
    if (axis) planes.push([center, { x: center.x - axis.y, y: center.y + axis.x }]);
  }
  for (const entity of document.entities ?? []) {
    const value = geometry.get(entity.id);
    if (!RAY_KINDS.has(entity.kind) || roles.lightPaths.has(entity.id) || standingIds.has(entity.id)) continue;
    if (!input.drawn(entity.id) || !openPath(value)) continue;
    if (planes.some(([a, b]) => value.points.every((point) => lineDistance(point, a, b) <= tolerance))) anchors.push({ id: entity.id, value });
  }
  const onAnchor = (point: Point) => anchors.some(({ id, value }) => {
    if (value.kind === "path" && value.infinite) {
      return strokeSegments(value, far).some(([a, b]) => pointSegmentDistance(point, a, b) <= tolerance);
    }
    if (boundaryDistance(point, value) <= tolerance) return true;
    return roles.thinLenses.has(id) && isClosed(value) && insideElement(point, value);
  });
  const onRayStroke = (joined: Array<{ value: PathValue }>, point: Point) => joined.some(({ value }) =>
    strokeSegments(value, far).some(([a, b]) => pointSegmentDistance(point, a, b) <= tolerance));
  const counterparts: Point[][] = [];
  for (const construction of constructions) {
    const counterpart = paraxialCounterpart(input, construction, tolerance);
    if (counterpart) counterparts.push(counterpart);
  }
  // The rays for arrows standing on a set of axes: the declared light paths,
  // and the strokes across none of those axes that join the light.
  const linesFor = new Map<string, Point[][]>();
  const raysFor = (arrowAxes: number[]) => {
    const key = arrowAxes.join(",");
    const cached = linesFor.get(key);
    if (cached) return cached;
    const joinedRays = [...rays];
    const support = candidates.filter(({ across }) => !across.some((index) => arrowAxes.includes(index)));
    for (let joined = true; joined && support.length > 0;) {
      joined = false;
      for (let index = support.length - 1; index >= 0; index -= 1) {
        const { points } = support[index]!;
        if (![points[0]!, points.at(-1)!].some((end) => onAnchor(end) || onRayStroke(joinedRays, end))) continue;
        joinedRays.push(...support.splice(index, 1));
        joined = true;
      }
    }
    const lines = [...joinedRays.map(({ points }) => points), ...counterparts];
    linesFor.set(key, lines);
    return lines;
  };
  for (const arrow of standing) {
    const lines = raysFor(arrow.axes);
    // A stroke along the arrow itself (parallel to it, through its foot) fixes no height.
    const ax = arrow.tip.x - arrow.foot.x;
    const ay = arrow.tip.y - arrow.foot.y;
    const onRay = lines.some((points) => points.some((point, index) => {
      if (index + 1 >= points.length) return false;
      const next = points[index + 1]!;
      if (lineDistance(arrow.tip, point, next) > tolerance) return false;
      const vx = next.x - point.x;
      const vy = next.y - point.y;
      const along = Math.abs(ax * vy - ay * vx) <= 0.2 * Math.hypot(ax, ay) * Math.hypot(vx, vy);
      return !(along && lineDistance(arrow.foot, point, next) <= tolerance);
    }));
    if (onRay) continue;
    input.issues.push({
      code: "axis_arrow_off_rays",
      message: `${arrow.id} stands on the optical axis but its tip is on no drawn ray or ray extension; the rays do not form that object or image`,
      severity: "fatal",
      entityIds: [arrow.id],
    });
  }
}

/** A traced ray leaves a spherical surface along the exact law within this angle. */
const EXACT_LAW_SIN = Math.sin(Math.PI / 180);

type Construction = NonNullable<SceneDocument["constructions"]>[number];

/**
 * The paraxial ray for a traced reflection or refraction at a spherical
 * surface, as two points on it, or null.
 *
 * Paraxial optics meets the surface at its vertex plane: the incoming line
 * crosses that plane at Q, and every incoming ray parallel to it leaves
 * through one point of the image side focal plane, where the ray through the
 * centre of curvature C (along the normal, so undeviated) meets that plane.
 * With mu = -1 for a mirror and n1/n2 for refraction, that plane stands at
 * V + (C - V) / (1 - mu): f = R/2, and f2 = n2 R / (n2 - n1).
 *
 * Only a drawn outgoing ray of `reflect_direction`, `refract_direction`,
 * `reflect_at` or `refract_at` that starts on a spherical surface and leaves
 * it along the exact law about that sphere's normal has a counterpart; a ray
 * reflected about some other normal, or refracted with no declared indices,
 * is measured as drawn.
 */
function paraxialCounterpart(input: AxisArrowInput, construction: Construction, tolerance: number): [Point, Point] | null {
  const operator = construction.operator;
  const mirror = operator === "reflect_direction" || operator === "reflect_at";
  const event = operator === "reflect_at" || operator === "refract_at";
  if (!mirror && operator !== "refract_direction" && operator !== "refract_at") return null;
  const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const outgoingId = event ? outputs[2] : outputs[0];
  if (typeof outgoingId !== "string" || !input.drawn(outgoingId)) return null;
  const outgoing = input.geometry.get(outgoingId);
  if (!isPath(outgoing) || outgoing.points.length < 2 || !outgoing.points.every(finitePoint)) return null;
  const contact = outgoing.points[0]!;
  const out = unit(subtract(outgoing.points[1]!, contact));
  const incoming = unit(incomingDirection(input.geometry, event ? outputs[0] : inputs.incoming ?? inputs.direction));
  if (!out || !incoming) return null;
  let mu = -1;
  if (!mirror) {
    const number = (value: unknown) => typeof value === "number" ? value : input.resolveNumber?.(value) ?? null;
    const n1 = number(inputs.n1);
    const n2 = number(inputs.n2);
    if (n1 === null || n2 === null || !(n1 > 0) || !(n2 > 0) || !Number.isFinite(n1 / n2) || Math.abs(n1 - n2) <= 1e-9 * n2) return null;
    mu = n1 / n2;
  }
  for (const surface of input.document.constructions ?? []) {
    if (surface.operator !== "spherical_surface") continue;
    const arc = input.geometry.get(String(surface.outputs?.[0] ?? "")) as { kind: string; center?: Point; radius?: number } | undefined;
    if (arc?.kind !== "arc" || !finitePoint(arc.center) || !(arc.radius! > 0)) continue;
    const center = arc.center;
    const radius = arc.radius!;
    if (Math.abs(distance(contact, center) - radius) > tolerance) continue;
    const axisPath = input.geometry.get(String((surface.inputs as Record<string, unknown> | undefined)?.axis ?? ""));
    if (!isPath(axisPath) || axisPath.points.length < 2 || !axisPath.points.every(finitePoint)) continue;
    const axis = unit(subtract(axisPath.points[1]!, axisPath.points[0]!));
    if (!axis || lineDistance(center, axisPath.points[0]!, axisPath.points[1]!) > tolerance) continue;
    // The exact law at the contact, about the sphere's normal facing the light.
    let normal = { x: (contact.x - center.x) / radius, y: (contact.y - center.y) / radius };
    if (dot(incoming, normal) > 0) normal = scale(normal, -1);
    const cosi = -dot(incoming, normal);
    const k = 1 - mu * mu * (1 - cosi * cosi);
    if (k < 0) continue;
    const exact = mirror
      ? add(incoming, scale(normal, 2 * cosi))
      : add(scale(incoming, mu), scale(normal, mu * cosi - Math.sqrt(k)));
    if (Math.abs(out.x * exact.y - out.y * exact.x) > EXACT_LAW_SIN || dot(out, exact) <= 0) continue;
    const side = Math.sign(dot(subtract(contact, center), axis));
    const along = dot(incoming, axis);
    if (side === 0 || Math.abs(along) < 1e-6) continue;
    const vertex = add(center, scale(axis, side * radius));
    const focalPlane = add(vertex, scale(subtract(center, vertex), 1 / (1 - mu)));
    const q = add(contact, scale(incoming, dot(subtract(vertex, contact), axis) / along));
    const focus = add(center, scale(incoming, dot(subtract(focalPlane, center), axis) / along));
    if (!finitePoint(q) || !finitePoint(focus) || !(distance(q, focus) > tolerance)) continue;
    return [q, focus];
  }
  return null;
}

/** The direction light arrives along: a literal vector, or a path's last segment (an infinite path's direction). */
function incomingDirection(geometry: Map<string, GeometryLike>, value: unknown): Point {
  if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") return { x: value[0], y: value[1] };
  const path = typeof value === "string" ? geometry.get(value) : undefined;
  if (!isPath(path) || path.points.length < 2 || !path.points.every(finitePoint)) return { x: 0, y: 0 };
  const [from, to] = path.infinite ? [path.points[0]!, path.points[1]!] : [path.points.at(-2)!, path.points.at(-1)!];
  return subtract(to, from);
}

function unit(vector: Point): Point | null {
  const length = Math.hypot(vector.x, vector.y);
  return length > 0 && Number.isFinite(length) ? { x: vector.x / length, y: vector.y / length } : null;
}
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Point, factor: number): Point => ({ x: a.x * factor, y: a.y * factor });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;

/** Distance from a point to the line through a and b (to a when they coincide). */
function lineDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return distance(point, a);
  return Math.abs(dy * (point.x - a.x) - dx * (point.y - a.y)) / length;
}

/** The rendered stroke cut at a clip point that lies on it, else unchanged. */
export function truncateRenderedPath<T extends Point>(points: T[], clip: T): T[] {
  if (points.length < 2) return points;
  const start = points[0]!;
  const end = points.at(-1)!;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) return points;
  const t = ((clip.x - start.x) * dx + (clip.y - start.y) * dy) / lengthSquared;
  if (!(t > 1e-6 && t < 1 - 1e-6)) return points;
  if (points.length === 2) return [start, clip];
  return points;
}

function isPath(value: GeometryLike | undefined): value is PathValue {
  return value?.kind === "path" && Array.isArray((value as PathValue).points);
}

function isElement(value: GeometryLike | undefined): value is ElementValue {
  if (!value) return false;
  if (isPath(value)) return value.points.length >= 2 && value.points.every(finitePoint);
  if (value.kind === "circle") {
    const circle = value as unknown as { center: Point; radius: number };
    return finitePoint(circle.center) && circle.radius > 0;
  }
  if (value.kind === "arc") {
    const arc = value as unknown as { center: Point; radius: number; startAngle: number; endAngle: number };
    return finitePoint(arc.center) && arc.radius > 0 && Number.isFinite(arc.startAngle) && Number.isFinite(arc.endAngle);
  }
  return false;
}

function isClosed(value: ElementValue): boolean {
  return value.kind === "circle" || (value.kind === "path" && value.closed === true && value.points.length >= 3);
}

function finitePoint(point: Point | undefined): point is Point {
  return Boolean(point) && Number.isFinite(point!.x) && Number.isFinite(point!.y);
}

function elementExtent(value: ElementValue): Point[] {
  if (value.kind === "path") return value.infinite ? value.points.slice(0, 1) : value.points;
  return [
    { x: value.center.x - value.radius, y: value.center.y - value.radius },
    { x: value.center.x + value.radius, y: value.center.y + value.radius },
  ];
}

function sceneScale(points: Point[]): number {
  const finite = points.filter(finitePoint);
  if (finite.length === 0) return 0;
  const xs = finite.map((point) => point.x);
  const ys = finite.map((point) => point.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

type Segment = { a: Point; b: Point; s0: number; length: number };

function pathSegments(value: PathValue, far: number): Segment[] {
  const points = value.infinite
    ? (() => {
        const [start, next] = value.points as [Point, Point];
        const length = distance(start, next);
        return [start, { x: start.x + (next.x - start.x) / length * far, y: start.y + (next.y - start.y) / length * far }];
      })()
    : value.points;
  const segments: Segment[] = [];
  let s0 = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const length = distance(a, b);
    if (length > 0) segments.push({ a, b, s0, length });
    s0 += length;
  }
  return segments;
}

function elementEdges(value: PathValue, far: number): Array<[Point, Point]> {
  const points = value.points;
  if (value.infinite) {
    const [start, next] = points as [Point, Point];
    const length = distance(start, next);
    if (!(length > 0)) return [];
    const ux = (next.x - start.x) / length;
    const uy = (next.y - start.y) / length;
    const from = value.directed ? start : { x: start.x - ux * far, y: start.y - uy * far };
    return [[from, { x: start.x + ux * far, y: start.y + uy * far }]];
  }
  const edges: Array<[Point, Point]> = [];
  for (let index = 0; index + 1 < points.length; index += 1) edges.push([points[index]!, points[index + 1]!]);
  if (value.closed && points.length >= 3) edges.push([points.at(-1)!, points[0]!]);
  return edges;
}

/** The drawn stroke of an open path as segments: an infinite path runs `far` out, or to its element clip. */
function strokeSegments(value: PathValue, far: number): Array<[Point, Point]> {
  if (value.infinite && value.directed && finitePoint(value.elementClip)) return [[value.points[0]!, value.elementClip]];
  return elementEdges({ ...value, closed: false }, far);
}

type Hit = { s: number; point: Point; direction: Point; normal: Point };

/** Where the path crosses the element, with the path direction and the boundary normal there. */
function crossings(segments: Segment[], element: ElementValue, far: number): Hit[] {
  const hits: Hit[] = [];
  for (const segment of segments) {
    const direction = { x: segment.b.x - segment.a.x, y: segment.b.y - segment.a.y };
    if (element.kind === "path") {
      for (const [c, d] of elementEdges(element, far)) {
        const t = segmentIntersection(segment.a, segment.b, c, d);
        if (t !== null) hits.push({ s: segment.s0 + t * segment.length, point: lerp(segment.a, segment.b, t), direction, normal: { x: c.y - d.y, y: d.x - c.x } });
      }
    } else {
      for (const t of segmentCircle(segment.a, segment.b, element.center, element.radius)) {
        const point = lerp(segment.a, segment.b, t);
        if (element.kind === "arc" && !angleOnArc(Math.atan2(point.y - element.center.y, point.x - element.center.x), element.startAngle, element.endAngle)) continue;
        hits.push({ s: segment.s0 + t * segment.length, point, direction, normal: { x: point.x - element.center.x, y: point.y - element.center.y } });
      }
    }
  }
  return hits;
}

/** Parameter along a→b of a proper crossing with c→d, or null (parallel or missing). */
function segmentIntersection(a: Point, b: Point, c: Point, d: Point): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= 1e-9 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return Math.max(0, Math.min(1, t));
}

function segmentCircle(a: Point, b: Point, center: Point, radius: number): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const discriminant = B * B - 4 * A * C;
  // A tangent ray touches the boundary without crossing it.
  if (!(A > 0) || !(discriminant > 1e-12 * A * radius * radius)) return [];
  const root = Math.sqrt(discriminant);
  return [(-B - root) / (2 * A), (-B + root) / (2 * A)].filter((t) => t >= -1e-9 && t <= 1 + 1e-9);
}

function angleOnArc(value: number, start: number, end: number): boolean {
  const full = Math.PI * 2;
  const low = Math.min(start, end);
  const sweep = Math.abs(end - start);
  if (sweep >= full - 1e-9) return true;
  const offset = (((value - low) % full) + full) % full;
  return offset <= sweep + 1e-9;
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function projectOntoSegments(point: Point, segments: Segment[]): { s: number; distance: number } {
  let best = { s: 0, distance: Number.POSITIVE_INFINITY };
  for (const segment of segments) {
    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;
    const t = Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / (dx * dx + dy * dy)));
    const gap = distance(point, lerp(segment.a, segment.b, t));
    if (gap < best.distance) best = { s: segment.s0 + t * segment.length, distance: gap };
  }
  return best;
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
  return distance(point, lerp(a, b, t));
}

function boundaryDistance(point: Point, element: ElementValue): number {
  if (element.kind === "path") {
    return Math.min(...elementEdges(element, 0).map(([a, b]) => pointSegmentDistance(point, a, b)));
  }
  return Math.abs(distance(point, element.center) - element.radius);
}

function insideElement(point: Point, element: ElementValue): boolean {
  if (element.kind === "circle") return distance(point, element.center) < element.radius;
  if (element.kind !== "path" || !element.closed) return false;
  const points = element.points;
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const a = points[index]!;
    const b = points[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function truncatePoints(points: Point[], s: number, hit: Point): Point[] {
  const kept: Point[] = [points[0]!];
  let walked = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const length = distance(points[index]!, points[index + 1]!);
    if (walked + length >= s) break;
    kept.push(points[index + 1]!);
    walked += length;
  }
  kept.push(hit);
  return kept;
}

/**
 * A refraction or reflection angle is measured from the half of the normal
 * on the ray's side, so it is always acute. `refract_at` emits its normal on
 * the incident side only, and an arc from that half to the refracted ray drew
 * the 136 to 151 degree supplement. Returns the mirrored arm point when one
 * arm is a declared normal and the other a light path meeting at an obtuse
 * angle, else null. A repair: it never declines a figure.
 */
export function acuteNormalArm(
  document: SceneDocument,
  vertex: Point,
  first: { ref: unknown; point: Point },
  second: { ref: unknown; point: Point },
): { arm: "first" | "second"; normalId: string; point: Point } | null {
  const roles = opticsRoles(document);
  if (!roles) return null;
  const mirrored = (normal: { ref: unknown; point: Point }, path: { ref: unknown; point: Point }): Point | null => {
    if (typeof normal.ref !== "string" || typeof path.ref !== "string") return null;
    if (!roles.normals.has(normal.ref) || !roles.lightPaths.has(path.ref)) return null;
    const dot = (normal.point.x - vertex.x) * (path.point.x - vertex.x) + (normal.point.y - vertex.y) * (path.point.y - vertex.y);
    if (!(dot < 0)) return null;
    return { x: 2 * vertex.x - normal.point.x, y: 2 * vertex.y - normal.point.y };
  };
  const firstMirror = mirrored(first, second);
  if (firstMirror) return { arm: "first", normalId: first.ref as string, point: firstMirror };
  const secondMirror = mirrored(second, first);
  if (secondMirror) return { arm: "second", normalId: second.ref as string, point: secondMirror };
  return null;
}
