/**
 * A straight line that copies a light path's direction is light too.
 *
 * Round 7 drew a glass slab's emergent ray as `parallel_through` the incident
 * ray through the exit point. The construction is right, but a line is drawn
 * both ways, so the "emergent ray" also ran back through the block and out
 * of its other faces without bending. The light paths rule (R1) never saw
 * it: only operator outputs and `ray` entities are light there.
 *
 * Rule R6, from declared operators only (no roles, no label words): the
 * drawn output of a `parallel_through` whose `line` is a declared light path
 * carries that light, in that path's direction.
 * - Its `through` point on the edge of a closed glass element, with the line
 *   leaving the element forward: the light emerges there. The line is drawn
 *   from that point forward only, as the directed path it is.
 * - Its `through` point on that edge with the line entering the element
 *   forward: light would cross the glass with no event, so the figure fails
 *   with `light_line_crosses_element`.
 * - What remains drawn may not run through a closed glass element's
 *   interior, unless the through point is strictly inside it (a thin lens
 *   centre): `light_line_crosses_element`.
 *
 * A closed glass element is a drawn closed path or circle that a declared
 * light path has a vertex on, as for R1.
 */
import type { SceneDocument, SceneIssue } from "../types";
import { opticsRoles } from "./lightPathElements";

interface Point { x: number; y: number }

type PathValue = {
  kind: "path";
  points: Point[];
  closed?: boolean;
  directed?: boolean;
  infinite?: boolean;
};
type CircleValue = { kind: "circle"; center: Point; radius: number };
type ClosedElement = PathValue | CircleValue;
type GeometryLike = { kind: string };

export interface EmergentLightLineInput {
  document: SceneDocument;
  geometry: Map<string, GeometryLike>;
  /** True when the entity is drawn ink in the compiled figure. */
  drawn: (id: string) => boolean;
  issues: SceneIssue[];
}

export function continueLightLinesFromElements(input: EmergentLightLineInput): void {
  const { document, geometry } = input;
  const roles = opticsRoles(document);
  if (!roles) return;
  const lines: Array<{ id: string; value: PathValue; through: Point; direction: Point }> = [];
  for (const construction of document.constructions ?? []) {
    if (construction.operator !== "parallel_through") continue;
    const inputs = (construction.inputs ?? {}) as Record<string, unknown>;
    const source = inputs.line ?? inputs.reference;
    const id = construction.outputs?.[0];
    if (typeof source !== "string" || !roles.lightPaths.has(source) || typeof id !== "string") continue;
    if (!input.drawn(id) || roles.lightPaths.has(id) || roles.normals.has(id) || roles.surfaces.has(id)) continue;
    const value = geometry.get(id);
    const light = geometry.get(source);
    if (!isPath(value) || !value.infinite || value.directed || value.points.length !== 2) continue;
    if (!isPath(light) || light.points.length < 2) continue;
    const direction = unit(sub(light.points.at(-1)!, light.points[0]!));
    if (!direction) continue;
    lines.push({ id, value, through: value.points[0]!, direction });
  }
  if (lines.length === 0) return;

  const vertices: Point[] = [];
  for (const id of roles.lightPaths.keys()) {
    const value = geometry.get(id);
    if (!isPath(value) || !input.drawn(id)) continue;
    vertices.push(...(value.infinite ? [value.points[0]!] : value.points));
  }
  const closed: Array<[string, ClosedElement]> = [];
  for (const [id, value] of geometry) {
    if (roles.lightPaths.has(id) || roles.normals.has(id) || !input.drawn(id)) continue;
    if (isCircle(value) || (isPath(value) && value.closed === true && value.points.length >= 3)) closed.push([id, value as ClosedElement]);
  }
  const span = sceneScale([...vertices, ...lines.map((line) => line.through), ...closed.flatMap(([, value]) => extent(value))]);
  if (!(span > 1e-9)) return;
  // About 3 px on a full diagram, as for R1.
  const tolerance = 4e-3 * span;
  const elements = closed.filter(([, value]) => vertices.some((vertex) => boundaryDistance(vertex, value) <= tolerance));
  if (elements.length === 0) return;
  const far = 1e4 * span;

  for (const line of lines) {
    const probe = 2 * tolerance;
    let directed = false;
    let refused = false;
    for (const [elementId, element] of elements) {
      if (boundaryDistance(line.through, element) > tolerance) continue;
      const ahead = inside(add(line.through, scale(line.direction, probe)), element);
      const behind = inside(add(line.through, scale(line.direction, -probe)), element);
      if (!ahead && behind) {
        directed = true;
      } else if (ahead && !behind) {
        input.issues.push({
          code: "light_line_crosses_element",
          message: `${line.id} carries the light of a declared ray into ${elementId} at its through point and runs on through it with no event there`,
          severity: "fatal",
          entityIds: [line.id, elementId],
        });
        refused = true;
      }
    }
    if (refused) continue;
    const start = directed ? 0 : -far;
    for (const [elementId, element] of elements) {
      if (strictlyInside(line.through, element, tolerance)) continue;
      if (!runsInside(line.through, line.direction, start, far, element, tolerance)) continue;
      input.issues.push({
        code: "light_line_crosses_element",
        message: `${line.id} carries the light of a declared ray straight through ${elementId} with no event there`,
        severity: "fatal",
        entityIds: [line.id, elementId],
      });
      refused = true;
      break;
    }
    if (refused || !directed) continue;
    geometry.set(line.id, {
      ...line.value,
      directed: true,
      points: [line.through, add(line.through, line.direction)],
    } as GeometryLike);
  }
}

/** True when the line through `origin` has a stretch of positive length strictly inside the element. */
function runsInside(origin: Point, direction: Point, from: number, to: number, element: ClosedElement, tolerance: number): boolean {
  const cuts = [from, to, ...boundaryParameters(origin, direction, element)
    .filter((t) => t > from && t < to)].sort((a, b) => a - b);
  for (let index = 1; index < cuts.length; index += 1) {
    const a = cuts[index - 1]!;
    const b = cuts[index]!;
    if (b - a <= 2 * tolerance) continue;
    if (strictlyInside(add(origin, scale(direction, (a + b) / 2)), element, tolerance)) return true;
  }
  return false;
}

/** Line parameters where `origin + t direction` meets the element boundary. */
function boundaryParameters(origin: Point, direction: Point, element: ClosedElement): number[] {
  if (element.kind === "circle") {
    const offset = sub(origin, element.center);
    const b = dot(offset, direction);
    const c = dot(offset, offset) - element.radius * element.radius;
    const discriminant = b * b - c;
    if (discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    return [-b - root, -b + root];
  }
  const hits: number[] = [];
  const points = element.points;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const edge = sub(b, a);
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) < 1e-12) continue;
    const offset = sub(a, origin);
    const t = cross(offset, edge) / denominator;
    const u = cross(offset, direction) / denominator;
    if (u >= -1e-9 && u <= 1 + 1e-9) hits.push(t);
  }
  return hits;
}

function inside(point: Point, element: ClosedElement): boolean {
  if (element.kind === "circle") return Math.hypot(point.x - element.center.x, point.y - element.center.y) < element.radius;
  let result = false;
  const points = element.points;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index]!;
    const b = points[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

function strictlyInside(point: Point, element: ClosedElement, tolerance: number): boolean {
  return inside(point, element) && boundaryDistance(point, element) > tolerance;
}

function boundaryDistance(point: Point, element: ClosedElement): number {
  if (element.kind === "circle") return Math.abs(Math.hypot(point.x - element.center.x, point.y - element.center.y) - element.radius);
  let best = Infinity;
  const points = element.points;
  for (let index = 0; index < points.length; index += 1) {
    best = Math.min(best, segmentDistance(point, points[index]!, points[(index + 1) % points.length]!));
  }
  return best;
}

function segmentDistance(point: Point, a: Point, b: Point): number {
  const edge = sub(b, a);
  const lengthSquared = dot(edge, edge);
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(point, a), edge) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * edge.x), point.y - (a.y + t * edge.y));
}

function extent(element: ClosedElement): Point[] {
  if (element.kind === "circle") {
    return [
      { x: element.center.x - element.radius, y: element.center.y - element.radius },
      { x: element.center.x + element.radius, y: element.center.y + element.radius },
    ];
  }
  return element.points;
}

function sceneScale(points: Point[]): number {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length === 0) return 0;
  const xs = finite.map((point) => point.x);
  const ys = finite.map((point) => point.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function isPath(value: GeometryLike | undefined): value is PathValue {
  return value?.kind === "path" && Array.isArray((value as PathValue).points) &&
    (value as PathValue).points.every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
}

function isCircle(value: GeometryLike | undefined): value is CircleValue {
  if (value?.kind !== "circle") return false;
  const circle = value as CircleValue;
  return Number.isFinite(circle.center?.x) && Number.isFinite(circle.center?.y) && circle.radius > 0;
}

function unit(vector: Point): Point | null {
  const length = Math.hypot(vector.x, vector.y);
  return length > 0 ? { x: vector.x / length, y: vector.y / length } : null;
}

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
