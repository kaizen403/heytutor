/** Extrusion and taper of a source-defined convex base, in world units. */
import { isometricProject, type Point2 } from "./space";

export interface PolyhedralSolid {
  base: Point2[];
  height: number;
  topScale: number;
}

export function readPolyhedralSolid(
  inputs: Record<string, unknown>,
  number: (value: unknown) => number,
): PolyhedralSolid {
  if ([inputs.radius, inputs.topRadius, inputs.innerRadius, inputs.axis].some((value) => value !== undefined)) throw new Error("polyhedron uses base, height and topScale; circular or axis inputs are not valid");
  const positive = (value: unknown, name: string) => {
    const result = number(value);
    if (!Number.isFinite(result) || result <= 0) throw new Error(`${name} must be positive and finite`);
    return result;
  };
  const raw = inputs.base;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("base must describe a rectangle, regular polygon, or convex polygon");
  const base = raw as Record<string, unknown>;
  let vertices: Point2[];
  if (base.kind === "rectangle") {
    const l = positive(base.length, "base length") / 2;
    const w = positive(base.width, "base width") / 2;
    vertices = [{ x: -l, y: -w }, { x: l, y: -w }, { x: l, y: w }, { x: -l, y: w }];
  } else if (base.kind === "regular_polygon") {
    const sides = number(base.sides);
    if (!Number.isInteger(sides) || sides < 3 || sides > 32) throw new Error("base sides must be an integer from 3 to 32");
    const radius = positive(base.side, "base side") / (2 * Math.sin(Math.PI / sides));
    vertices = Array.from({ length: sides }, (_, index) => {
      const angle = 2 * Math.PI * index / sides - Math.PI / 2;
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    });
  } else if (base.kind === "polygon" && Array.isArray(base.vertices) && base.vertices.length >= 3 && base.vertices.length <= 32) {
    vertices = base.vertices.map((vertex: unknown) => {
      if (!Array.isArray(vertex) || vertex.length !== 2) throw new Error("base vertices must be pairs of world coordinates");
      return { x: number(vertex[0]), y: number(vertex[1]) };
    });
  } else throw new Error("unsupported solid base");
  assertConvexBase(vertices);
  const center = vertices.reduce((sum, p) => ({ x: sum.x + p.x / vertices.length, y: sum.y + p.y / vertices.length }), { x: 0, y: 0 });
  vertices = vertices.map((p) => ({ x: p.x - center.x, y: p.y - center.y }));
  const height = positive(inputs.height, "solid height");
  const topScale = inputs.topScale === undefined ? 1 : number(inputs.topScale);
  if (!Number.isFinite(topScale) || topScale < 0 || topScale > 1) throw new Error("topScale must be from 0 to 1 (0 apex, 1 prism)");
  return { base: vertices, height, topScale };
}

function assertConvexBase(vertices: Point2[]): void {
  if (vertices.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error("base coordinates must be finite");
  const extent = Math.max(...vertices.map((p) => Math.hypot(p.x - vertices[0]!.x, p.y - vertices[0]!.y)));
  const tolerance = extent ** 2 * 1e-9;
  if (!(extent > 0)) throw new Error("base must have positive area");
  let sign = 0;
  // All other vertices must be strictly on the same side of each edge. This
  // rejects collinear, concave and self-crossing bases rather than repairing them.
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    for (let j = 0; j < vertices.length; j += 1) {
      if (j === i || j === (i + 1) % vertices.length) continue;
      const p = vertices[j]!;
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cross) <= tolerance || (sign && Math.sign(cross) !== sign)) throw new Error("base must be a simple strictly convex polygon");
      sign = Math.sign(cross);
    }
  }
}

export function projectSolidPoint(center: Point2, base: Point2, height: number): Point2 {
  return isometricProject({ x: base.x, y: height, z: base.y }, { origin: center, scale: 1 });
}

export function polyhedralSection(solid: PolyhedralSolid, center: Point2, at: number): Point2[] {
  if (!Number.isFinite(at) || at < 0 || at > 1) throw new Error("section position must be from 0 to 1");
  const scale = 1 + (solid.topScale - 1) * at;
  const points = solid.base.map((p) => projectSolidPoint(center, { x: p.x * scale, y: p.y * scale }, solid.height * at));
  return [...points, points[0]!];
}

export function polyhedralPaths(solid: PolyhedralSolid, center: Point2): Point2[][] {
  const base = polyhedralSection(solid, center, 0);
  const top = polyhedralSection(solid, center, 1);
  return [base, ...(solid.topScale > 0 ? [top] : []), ...solid.base.map((_, i) => [base[i]!, top[i]!])];
}
