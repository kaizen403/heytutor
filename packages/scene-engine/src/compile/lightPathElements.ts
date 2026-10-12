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
 *   path that crosses that plane inside the aperture passes the lens. Thin
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
        if (typeof line === "string") lensPlanes.push({ elements: [], line });
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
      if (lensChords.get(elementId)?.some((chord) => meetsChord(segments, path.vertices, chord, tolerance))) continue;
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
): Map<string, Array<[Point, Point]>> {
  const chords = new Map<string, Array<[Point, Point]>>();
  const add = (id: string, chord: [Point, Point]) => chords.set(id, [...(chords.get(id) ?? []), chord]);
  const planes: Array<[Point, Point]> = [];
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
      planes.push(chord);
      add(plane.line, chord);
      continue;
    }
    let center: Point;
    try { center = input.resolvePoint(plane.center); } catch { continue; }
    const axis = axisDirection(plane.axis, input.geometry);
    if (!finitePoint(center) || !axis) continue;
    const across = { x: -axis.y, y: axis.x };
    planes.push([center, { x: center.x + across.x, y: center.y + across.y }]);
    for (const id of plane.elements) {
      const value = input.geometry.get(id);
      if (!isPath(value) || !value.points.every(finitePoint)) continue;
      const half = Math.max(...value.points.map((point) => Math.abs((point.x - center.x) * across.x + (point.y - center.y) * across.y)));
      if (!(half > 0)) continue;
      add(id, [
        { x: center.x - across.x * half, y: center.y - across.y * half },
        { x: center.x + across.x * half, y: center.y + across.y * half },
      ]);
    }
  }
  // A thin lens drawn as a segment or line on a lens plane.
  for (const [id, value] of candidates) {
    if (chords.has(id)) continue;
    const chord = straight(value as GeometryLike);
    if (!chord) continue;
    if (planes.some(([a, b]) => lineDistance(chord[0], a, b) <= tolerance && lineDistance(chord[1], a, b) <= tolerance)) add(id, chord);
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

/** True when the path crosses or touches the chord, which is lengthened by the tolerance at both ends. */
function meetsChord(segments: Segment[], vertices: Point[], chord: [Point, Point], tolerance: number): boolean {
  const [a, b] = chord;
  const length = distance(a, b);
  if (!(length > 0)) return false;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const from = { x: a.x - ux * tolerance, y: a.y - uy * tolerance };
  const to = { x: b.x + ux * tolerance, y: b.y + uy * tolerance };
  if (segments.some((segment) => segmentIntersection(segment.a, segment.b, from, to) !== null)) return true;
  return vertices.some((vertex) => pointSegmentDistance(vertex, from, to) <= tolerance);
}

/**
 * Glass lets light along the normal through; a mirror does not. Glass is a
 * thin lens, a surface with a declared refraction, or a closed region,
 * unless that region carries a declared reflection, no refraction, and its
 * reflected light arrives from outside (a mirror body; light reflected
 * inside closed glass is total internal reflection).
 */
function isGlass(input: LightPathClipInput, roles: OpticsRoles, id: string, value: ElementValue, tolerance: number): boolean {
  if (roles.thinLenses.has(id) || roles.refracting.has(id)) return true;
  if (!isClosed(value)) return false;
  return !roles.reflections.some((reflection) => {
    if (reflection.surface !== id || typeof reflection.incoming !== "string") return false;
    const incoming = input.geometry.get(reflection.incoming);
    if (!isPath(incoming) || incoming.points.length < 2 || !incoming.points.every(finitePoint)) return false;
    const start = incoming.points[0]!;
    const next = incoming.infinite ? incoming.points[1]! : incoming.points.at(-1)!;
    const length = distance(start, next);
    if (!(length > 0)) return false;
    let contact: Point;
    try { contact = reflection.contact === undefined ? next : input.resolvePoint(reflection.contact); } catch { return false; }
    if (!finitePoint(contact)) return false;
    const probe = { x: contact.x - (next.x - start.x) / length * 4 * tolerance, y: contact.y - (next.y - start.y) / length * 4 * tolerance };
    return !insideElement(probe, value);
  });
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

/** Operators whose `axis` input declares an optical axis. */
const AXIS_OPERATORS = new Set(["lens_section", "spherical_surface", "optical_train", "gaussian_image", "optical_focus"]);

export interface AxisArrowInput {
  document: SceneDocument;
  geometry: Map<string, GeometryLike>;
  /** True when the entity is drawn ink in the compiled figure. */
  drawn: (id: string) => boolean;
  issues: SceneIssue[];
}

/**
 * Object and image arrows stand on their rays. When a figure draws light
 * paths and declares an optical axis (the `axis` input of an optics
 * operator), every drawn arrow (`vector` output or entity) whose foot is on
 * that axis and which stands across it must have its tip on a drawn light
 * path or that path's straight extension. Otherwise the arrows mark an
 * object or image the rays never form: `axis_arrow_off_rays`.
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
  const rays: Point[][] = [];
  for (const id of roles.lightPaths.keys()) {
    if (!input.drawn(id)) continue;
    const value = geometry.get(id);
    if (isPath(value) && !value.closed && value.points.length >= 2 && value.points.every(finitePoint)) rays.push(value.points);
  }
  if (rays.length === 0) return;
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
  // About 3 px on a full diagram, as for the element crossings.
  const span = sceneScale([...rays.flat(), ...arrows.flatMap((arrow) => [arrow.foot, arrow.tip])]);
  if (!(span > 1e-9)) return;
  const tolerance = 4e-3 * span;
  for (const arrow of arrows) {
    const stands = axes.some(([a, b]) => {
      if (lineDistance(arrow.foot, a, b) > tolerance) return false;
      const ax = b.x - a.x;
      const ay = b.y - a.y;
      const vx = arrow.tip.x - arrow.foot.x;
      const vy = arrow.tip.y - arrow.foot.y;
      return Math.abs(ax * vx + ay * vy) <= 0.2 * Math.hypot(ax, ay) * Math.hypot(vx, vy);
    });
    if (!stands) continue;
    const onRay = rays.some((points) => points.some((point, index) =>
      index + 1 < points.length && lineDistance(arrow.tip, point, points[index + 1]!) <= tolerance));
    if (onRay) continue;
    input.issues.push({
      code: "axis_arrow_off_rays",
      message: `${arrow.id} stands on the optical axis but its tip is on no drawn ray or ray extension; the rays do not form that object or image`,
      severity: "fatal",
      entityIds: [arrow.id],
    });
  }
}

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
