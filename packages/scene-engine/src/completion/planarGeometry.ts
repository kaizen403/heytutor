import type { SceneConstruction, SceneDocument } from "../types";
import { evaluateTriangleConstruction } from "../compile/triangleGeometry";

export interface PlanarPoint { x: number; y: number }
export interface PlanarLine {
  a: PlanarPoint;
  b: PlanarPoint;
  startId?: string;
  endId?: string;
  extent: "line" | "ray" | "segment";
}
export const PROOF_EPSILON = 1e-10;
const MAX_COORDINATE = 1e9;
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const subtract = (a: PlanarPoint, b: PlanarPoint): PlanarPoint => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a: PlanarPoint, b: PlanarPoint): number => a.x * b.x + a.y * b.y;
export const norm = (a: PlanarPoint): number => Math.hypot(a.x, a.y);
const cross = (a: PlanarPoint, b: PlanarPoint): number => a.x * b.y - a.y * b.x;
export const samePoint = (a: PlanarPoint, b: PlanarPoint): boolean =>
  norm(subtract(a, b)) <= PROOF_EPSILON * Math.max(1, norm(a), norm(b));

export function angleUnit(unit: unknown): "degree" | "rad" | null {
  if (typeof unit !== "string") return null;
  if (["°", "deg", "degree", "degrees"].includes(unit.trim())) return "degree";
  return ["rad", "radian", "radians"].includes(unit.trim()) ? "rad" : null;
}
function finitePoint(point: PlanarPoint): PlanarPoint | null {
  return [point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE) ? point : null;
}
function inExtent(t: number, extent: PlanarLine["extent"]): boolean {
  return extent === "line" || (t >= -PROOF_EPSILON && (extent === "ray" || t <= 1 + PROOF_EPSILON));
}
export function lineIntersection(first: PlanarLine, second: PlanarLine): PlanarPoint | null {
  const u = subtract(first.b, first.a), v = subtract(second.b, second.a);
  const denominator = cross(u, v);
  if (norm(u) < 1e-9 || norm(v) < 1e-9 || Math.abs(denominator) <= PROOF_EPSILON * norm(u) * norm(v)) return null;
  const offset = subtract(second.a, first.a);
  const t = cross(offset, v) / denominator, s = cross(offset, u) / denominator;
  if (!inExtent(t, first.extent) || !inExtent(s, second.extent)) return null;
  return finitePoint({ x: first.a.x + t * u.x, y: first.a.y + t * u.y });
}
export function perpendicular(first: PlanarLine, second: PlanarLine): boolean {
  const u = subtract(first.b, first.a), v = subtract(second.b, second.a);
  return norm(u) >= 1e-9 && norm(v) >= 1e-9 && Math.abs(dot(u, v) / norm(u) / norm(v)) <= PROOF_EPSILON;
}

/** A deliberately small exact-input resolver. Unsupported or mixed-frame geometry never becomes a pixel proof. */
export class PlanarGeometry {
  readonly producers = new Map<string, SceneConstruction>();
  private readonly points = new Map<string, PlanarPoint | null>();
  private readonly lines = new Map<string, PlanarLine | null>();
  private readonly quantities = new Map<string, SceneDocument["quantities"][number]>();
  constructor(private readonly document: SceneDocument) {
    for (const quantity of document.quantities) this.quantities.set(quantity.id, quantity);
    for (const construction of document.constructions) {
      for (const output of construction.outputs) this.producers.set(output, construction);
    }
  }
  number(value: unknown, depth = 0): number | null {
    if (depth > 24) return null;
    if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE ? value : null;
    if (typeof value === "string") return this.number(this.quantities.get(value)?.value, depth + 1);
    return isRecord(value) && "value" in value ? this.number(value.value, depth + 1) : null;
  }
  point(value: unknown, depth = 0): PlanarPoint | null {
    if (depth > 24) return null;
    if (typeof value !== "string") return null;
    if (this.points.has(value)) return this.points.get(value) ?? null;
    this.points.set(value, null);
    const construction = this.producers.get(value);
    if (!construction) return null;
    const inputs = construction.inputs;
    const point = (ref: unknown) => this.point(ref, depth + 1);
    let result: PlanarPoint | null = null;
    if (construction.operator === "point" && (inputs.coordinateSpace === undefined || inputs.coordinateSpace === "world")) {
      const x = this.number(inputs.x), y = this.number(inputs.y);
      if (x !== null && y !== null) result = { x, y };
    } else if (construction.operator === "midpoint") {
      const a = point(inputs.a ?? inputs.first), b = point(inputs.b ?? inputs.second);
      if (a && b) result = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else if (construction.operator === "rotate") {
      const source = point(inputs.point ?? inputs.source), centre = point(inputs.center);
      const value = this.number(inputs.angle);
      if (source && centre && value !== null) {
        // Match the native rotate constructor, including its omitted-unit heuristic.
        const theta = inputs.angleUnit === "degrees" || Math.abs(value) > 2 * Math.PI ? value * Math.PI / 180 : value;
        const relative = subtract(source, centre);
        result = { x: centre.x + relative.x * Math.cos(theta) - relative.y * Math.sin(theta),
          y: centre.y + relative.x * Math.sin(theta) + relative.y * Math.cos(theta) };
      }
    } else if (construction.operator === "intersection") {
      const a = this.line(inputs.first ?? inputs.a, depth + 1), b = this.line(inputs.second ?? inputs.b, depth + 1);
      if (a && b) result = lineIntersection(a, b);
    } else if (construction.operator === "project") {
      const source = point(inputs.point ?? inputs.source), line = this.line(inputs.line ?? inputs.onto, depth + 1);
      if (source && line) {
        const direction = subtract(line.b, line.a), square = dot(direction, direction);
        if (square >= 1e-18) {
          const t = dot(subtract(source, line.a), direction) / square;
          result = { x: line.a.x + t * direction.x, y: line.a.y + t * direction.y };
        }
      }
    } else if (["triangle_from_sides", "triangle_from_sas", "triangle_from_asa"].includes(construction.operator)) {
      try {
        const evaluated = evaluateTriangleConstruction(construction.operator, inputs, {
          number: raw => { const number = this.number(raw); if (number === null) throw new Error("unresolved number"); return number; },
          point: raw => { const resolved = point(raw); if (!resolved) throw new Error("unresolved point"); return resolved; },
        });
        const output = evaluated[construction.outputs.indexOf(value)];
        if (output?.kind === "point") result = output.point;
      } catch { /* Unsupported inputs withdraw the proof. */ }
    }
    result = result ? finitePoint(result) : null;
    this.points.set(value, result);
    return result;
  }
  line(value: unknown, depth = 0): PlanarLine | null {
    if (depth > 24 || typeof value !== "string") return null;
    if (this.lines.has(value)) return this.lines.get(value) ?? null;
    this.lines.set(value, null);
    const construction = this.producers.get(value);
    if (!construction) return null;
    const inputs = construction.inputs;
    let result: PlanarLine | null = null;
    if (["line", "segment", "ray", "vector"].includes(construction.operator)) {
      const start = inputs.start ?? inputs.from ?? inputs.a ?? inputs.origin;
      const end = inputs.end ?? inputs.to ?? inputs.b;
      const a = this.point(start, depth + 1);
      const endpoint = this.point(end, depth + 1);
      let b = endpoint;
      const directionInput = inputs.direction ?? inputs.vector;
      const direction = Array.isArray(directionInput) && directionInput.length === 2
        ? directionInput.map(value => this.number(value)) : null;
      const dx = direction?.[0], dy = direction?.[1];
      if (a && typeof dx === "number" && typeof dy === "number") {
        const magnitude = Math.hypot(dx, dy);
        if (construction.operator === "vector" && inputs.direction !== undefined) {
          // Native vector direction overrides end; length controls the finite drawn span.
          const span = inputs.length === undefined ? endpoint ? norm(subtract(endpoint, a)) : magnitude : this.number(inputs.length);
          b = magnitude >= 1e-9 && span !== null && span > 0
            ? finitePoint({ x: a.x + dx / magnitude * span, y: a.y + dy / magnitude * span }) : null;
        } else if (!endpoint && construction.operator !== "segment") b = finitePoint({ x: a.x + dx, y: a.y + dy });
      } else if (construction.operator === "vector" && inputs.direction !== undefined) b = null;
      if (a && b && norm(subtract(a, b)) >= 1e-9) result = {
        a, b, startId: typeof start === "string" ? start : undefined,
        endId: typeof end === "string" && endpoint && samePoint(b, endpoint) ? end : undefined,
        extent: construction.operator === "line" ? "line" : construction.operator === "ray" ? "ray" : "segment",
      };
    } else if (["parallel_through", "perpendicular_through"].includes(construction.operator)) {
      const through = inputs.through ?? inputs.point;
      const a = this.point(through, depth + 1), reference = this.line(inputs.line ?? inputs.reference, depth + 1);
      if (a && reference) {
        const vector = subtract(reference.b, reference.a);
        const direction = construction.operator === "perpendicular_through" ? { x: -vector.y, y: vector.x } : vector;
        const b = finitePoint({ x: a.x + direction.x, y: a.y + direction.y });
        if (b) result = { a, b, startId: typeof through === "string" ? through : undefined, extent: "line" };
      }
    }
    this.lines.set(value, result);
    return result;
  }
  arm(value: unknown, vertex: PlanarPoint): PlanarPoint | null {
    const point = this.point(value);
    if (point) return norm(subtract(point, vertex)) >= 1e-9 ? point : null;
    const line = this.line(value);
    if (!line) return null;
    if (samePoint(line.a, vertex) && !samePoint(line.b, vertex)) return line.b;
    if (samePoint(line.b, vertex) && !samePoint(line.a, vertex)) return line.a;
    return null;
  }
}
