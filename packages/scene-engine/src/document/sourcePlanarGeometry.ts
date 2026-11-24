import { validationNumber } from "../compile/sourceScalars";
import type { SceneConstruction, SceneDocument } from "../types";

export type SourcePlanarPoint = { x: number; y: number; frame: string };
export type SourcePlanarPath = { points: SourcePlanarPoint[]; extent: "finite" | "ray" | "line" };
export type SourcePlanarCircle = { center: SourcePlanarPoint; radius: number };
type Point = SourcePlanarPoint;
type Path = SourcePlanarPath;
const first = (construction: SceneConstruction, keys: string[]) => keys.map(key => construction.inputs[key]).find(value => value !== undefined);
export const sourcePlanarEndpoints = (construction: SceneConstruction) => construction.operator === "midpoint"
  ? [first(construction, ["a", "start"]), first(construction, ["b", "end"])]
  : [first(construction, ["segment", "dimension"].includes(construction.operator) ? ["start", "from", "a"] : ["start", "from", "a", "origin"]), first(construction, ["end", "to", "b"])];
const ends = sourcePlanarEndpoints;
/** Vertex identity follows the coordinates the compiler actually executes.
 * Even one representable nonzero span can be enlarged by a view transform;
 * the absolute world origin supplies no permission to merge it away. */
export function sameSourcePlanarPoint(a: Point | null, b: Point | null): boolean {
  return Boolean(a && b && a.frame === b.frame && a.x === b.x && a.y === b.y);
}
const same = sameSourcePlanarPoint;

/** A deliberately bounded source-coordinate proof reader. Unsupported producers,
 * frames and nonplanar directions remain unproved, never guessed from display
 * coordinates. It reads supplied geometry; it never edits an angle or a path. */
export function readSourcePlanarGeometry(document: SceneDocument) {
  const producers = new Map(document.constructions.flatMap(construction => construction.outputs.map(id => [id, construction] as const)));
  const number = (value: unknown) => validationNumber(value, document);
  const point = (id: unknown, seen = new Set<string>()): Point | null => {
    // resolvePoint also executes finite inline world literals. These are
    // coordinates, never quantity references or a candidate-authored frame.
    if (Array.isArray(id) && id.length === 2 && id.every(value => typeof value === "number" && Number.isFinite(value)))
      return { x: id[0], y: id[1], frame: "world:" };
    if (id && typeof id === "object" && !Array.isArray(id)) {
      const literal = id as Record<string, unknown>;
      if (typeof literal.x === "number" && Number.isFinite(literal.x) && typeof literal.y === "number" && Number.isFinite(literal.y) &&
          (literal.coordinateSpace === undefined || literal.coordinateSpace === "world") && literal.axes === undefined)
        return { x: literal.x, y: literal.y, frame: "world:" };
      return null;
    }
    if (typeof id !== "string" || seen.has(id) || seen.size >= 32) return null;
    const construction = producers.get(id);
    if (!construction) return null;
    const next = new Set([...seen, id]);
    try {
      if (construction.operator === "point") {
        const x = number(construction.inputs.x), y = number(construction.inputs.y);
        const space = construction.inputs.coordinateSpace ?? "world";
        if (!["world", "layout"].includes(String(space)) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y, frame: `${space}:${construction.inputs.axes ?? ""}` };
      }
      if (construction.operator === "midpoint") {
        const [a, b] = ends(construction).map(ref => point(ref, next));
        return a && b && a.frame === b.frame ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, frame: a.frame } : null;
      }
    } catch { /* Missing scalar/frame authority cannot prove a source motion. */ }
    return null;
  };
  const path = (id: string): Path | null => {
    const construction = producers.get(id);
    if (!construction) return null;
    try {
      if (construction.operator === "polyline") {
        const refs = first(construction, ["points", "vertices"]);
        if (!Array.isArray(refs) || refs.length < 2 || refs.length > 256) return null;
        const points = refs.map(ref => point(ref));
        if (points.some(p => !p || p.frame !== points[0]?.frame)) return null;
        return { points: points as Point[], extent: "finite" };
      }
      if (!["segment", "vector", "line", "ray"].includes(construction.operator)) return null;
      const [startRef, endRef] = ends(construction), start = point(startRef), endpoint = point(endRef);
      if (!start || endRef !== undefined && !endpoint || endpoint && endpoint.frame !== start.frame) return null;
      let end = endpoint;
      const explicitDirection = construction.inputs.direction;
      // The native vector overrides an endpoint only with `direction`.
      // `vector` is the linePoints fallback when no endpoint/direction exists.
      // Segments ignore directions; line/ray endpoints take precedence.
      const usesDirection = construction.operator !== "segment" &&
        (construction.operator === "vector" ? explicitDirection !== undefined || !end : !end);
      const direction = explicitDirection !== undefined ? explicitDirection : construction.inputs.vector;
      if (usesDirection) {
        const spatial = construction.operator === "vector" && explicitDirection !== undefined && Array.isArray(direction) && direction.length === 3;
        if (!Array.isArray(direction) || (spatial ? number(direction[2]) !== 0 : direction.length !== 2)) return null;
        const x = number(direction[0]), y = number(direction[1]), norm = Math.hypot(x, y);
        if (!(norm > 0) || !Number.isFinite(norm)) return null;
        let span = norm;
        if (construction.operator === "vector" && explicitDirection !== undefined) {
          const distance = endpoint ? Math.hypot(endpoint.x - start.x, endpoint.y - start.y) : spatial ? 1 : norm;
          const defaultSpan = spatial ? Math.max(distance, 1) : distance < 1e-6 ? 1 : distance;
          span = construction.inputs.length === undefined ? defaultSpan : number(construction.inputs.length);
        }
        if (!(span > 0) || !Number.isFinite(span)) return null;
        end = { x: start.x + x / norm * span, y: start.y + y / norm * span, frame: start.frame };
      }
      return end && !same(start, end) ? { points: [start, end], extent: construction.operator === "ray" ? "ray" : construction.operator === "line" ? "line" : "finite" } : null;
    } catch { return null; }
  };
  const arm = (ref: unknown, vertex: Point): Point | null => {
    const p = point(ref);
    if (p) return p.frame === vertex.frame && !same(p, vertex) ? p : null;
    if (typeof ref !== "string") return null;
    const points = path(ref)?.points, a = points?.[0], b = points?.at(-1);
    // Same endpoint-arm convention as angle_mark. No auto-flipping the arm.
    return a && b && same(a, vertex) !== same(b, vertex) ? same(a, vertex) ? b : a : null;
  };
  // Match the ordinary compiler's center and radius|r operand precedence.
  // Neither a circle kind/role nor an ignored alias proves a circular mark.
  const circle = (id: string): SourcePlanarCircle | null => {
    const construction = producers.get(id);
    if (construction?.operator !== "circle" || construction.outputs.length !== 1) return null;
    try {
      const center = point(construction.inputs.center), radius = number(first(construction, ["radius", "r"]));
      return center && /^(?:world|layout):$/.test(center.frame) && Number.isFinite(radius) && radius > 0
        ? { center, radius } : null;
    } catch { return null; }
  };
  const dimension = (id: string): boolean => {
    const construction = producers.get(id);
    if (construction?.operator !== "dimension") return false;
    const [a, b] = ends(construction).map(ref => point(ref));
    return Boolean(a && b && a.frame === b.frame && !same(a, b));
  };
  const axes = (id: string): boolean => {
    const construction = producers.get(id);
    if (construction?.operator !== "axes") return false;
    try {
      const values = [number(first(construction, ["xMin", "x_min"])), number(first(construction, ["xMax", "x_max"])),
        number(first(construction, ["yMin", "y_min"])), number(first(construction, ["yMax", "y_max"]))];
      return values.every(Number.isFinite) && values[0]! < values[1]! && values[2]! < values[3]!;
    } catch { return false; }
  };
  return { point, path, arm, circle, dimension, axes, producers };
}

