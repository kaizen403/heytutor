import { isometricProject, planeFromCartesian, vec3Add, vec3Length, vec3Scale, type SpaceFrame, type Vec3 } from "../math/space";
import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const SPACE_DERIVATION_OPERATORS = ["space_project", "space_intersection", "space_closest_points", "space_segment"] as const;
export interface SpaceLineDefinition { frameId: string; point: Vec3; direction: Vec3 }
export interface SpacePlaneDefinition { frameId: string; point: Vec3; normal: Vec3 }
export interface SpaceSegmentDefinition { frameId: string; a: Vec3; b: Vec3; length: number }
export type SpaceDerivationGeometry =
  | { kind: "point"; point: RenderPoint; space: Vec3; spaceFrameId: string }
  | { kind: "path"; points: RenderPoint[]; infinite?: boolean; spaceLine?: SpaceLineDefinition; spaceSegment?: SpaceSegmentDefinition };
export interface SpaceDerivationEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry(value: unknown): unknown;
}

const MAX_WORLD = 1e9;
const MAX_RENDER = 1e12;
const MIN_VECTOR = 1e-9;
const MIN_SINE = 1e-8;
class SpaceInputError extends Error {
  constructor(readonly key: string, message: string) { super(message); }
}
function invalid(key: string, message: string): never { throw new SpaceInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function bounded(value: number, key: string, maximum = MAX_WORLD): number {
  if (!Number.isFinite(value) || Math.abs(value) > maximum) invalid(key, `${key} must be finite with magnitude at most ${maximum}`);
  return value;
}
function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function finiteVector(value: unknown, key: string): Vec3 {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number" || typeof value.z !== "number") return invalid(key, `${key} must contain world x, y, z coordinates`);
  return { x: bounded(value.x, key), y: bounded(value.y, key), z: bounded(value.z, key) };
}
function unit(value: Vec3, key: string): Vec3 {
  const length = vec3Length(value);
  if (!(length > MIN_VECTOR) || !Number.isFinite(length)) invalid(key, `${key} must be a nonzero finite vector`);
  return vec3Scale(value, 1 / length);
}
function numberInput(value: unknown, key: string, context: SpaceDerivationEvaluationContext, depth = 0): number {
  if (depth > 32) return invalid(key, "numeric input nesting exceeds 32");
  if (isRecord(value) && "value" in value) return numberInput(value.value, key, context, depth + 1);
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return invalid(key, `${key} must be a numeric literal or quantity reference`);
  try { return bounded(context.number(value), key); }
  catch (error) { if (error instanceof SpaceInputError) throw error; return invalid(key, `${key} must resolve to a finite bounded number`); }
}
function vectorInput(value: unknown, key: string, context: SpaceDerivationEvaluationContext): Vec3 {
  if (Array.isArray(value) && value.length === 3) return { x: numberInput(value[0], key, context), y: numberInput(value[1], key, context), z: numberInput(value[2], key, context) };
  if (isRecord(value)) return { x: numberInput(value.x, key, context), y: numberInput(value.y, key, context), z: numberInput(value.z, key, context) };
  return invalid(key, `${key} must be a three-component world vector`);
}
function reference(value: unknown, key: string, context: SpaceDerivationEvaluationContext): Record<string, unknown> {
  if (typeof value !== "string") return invalid(key, `${key} must reference constructed space geometry`);
  const geometry = context.geometry(value);
  if (!isRecord(geometry)) return invalid(key, `${key} must reference constructed space geometry`);
  return geometry;
}
function frameInput(value: unknown, context: SpaceDerivationEvaluationContext): { frameId: string; frame: SpaceFrame } {
  const geometry = reference(value, "frame", context);
  if (geometry.kind !== "compound" || !isRecord(geometry.spaceFrame) || !isRecord(geometry.spaceFrame.origin)) return invalid("frame", "frame must reference a space_frame output");
  const { origin, scale } = geometry.spaceFrame;
  if (typeof origin.x !== "number" || typeof origin.y !== "number" || typeof scale !== "number") return invalid("frame", "frame must have finite origin and positive scale");
  const frame = { origin: { x: bounded(origin.x, "frame"), y: bounded(origin.y, "frame") }, scale: bounded(scale, "frame") };
  if (!(frame.scale > 0)) invalid("frame", "space frame scale must be positive");
  return { frameId: value as string, frame };
}
function sameFrame(actual: unknown, expected: string, key: string): void {
  if (actual !== expected) invalid(key, `${key} must belong to the same space_frame ${expected}`);
}
function spacePoint(value: unknown, key: string, frameId: string, context: SpaceDerivationEvaluationContext): Vec3 {
  const geometry = reference(value, key, context);
  if (geometry.kind !== "point" || geometry.space === undefined) return invalid(key, `${key} must reference a constructed space point`);
  sameFrame(geometry.spaceFrameId, frameId, key);
  return finiteVector(geometry.space, key);
}
function lineDefinition(geometry: Record<string, unknown>, key: string): SpaceLineDefinition {
  if (geometry.kind !== "path" || !isRecord(geometry.spaceLine) || typeof geometry.spaceLine.frameId !== "string") return invalid(key, `${key} must reference an infinite space_line`);
  const result = { frameId: geometry.spaceLine.frameId, point: finiteVector(geometry.spaceLine.point, key), direction: finiteVector(geometry.spaceLine.direction, key) };
  unit(result.direction, key);
  return result;
}
function planeDefinition(geometry: Record<string, unknown>, key: string): SpacePlaneDefinition {
  if (geometry.kind !== "path" || !isRecord(geometry.spacePlane) || typeof geometry.spacePlane.frameId !== "string") return invalid(key, `${key} must reference a plane`);
  const result = { frameId: geometry.spacePlane.frameId, point: finiteVector(geometry.spacePlane.point, key), normal: finiteVector(geometry.spacePlane.normal, key) };
  unit(result.normal, key);
  return result;
}
function projectedPoint(space: Vec3, frameId: string, frame: SpaceFrame): Extract<SpaceDerivationGeometry, { kind: "point" }> {
  const world = finiteVector(space, "geometry");
  const point = isometricProject(world, frame);
  bounded(point.x, "geometry", MAX_RENDER);
  bounded(point.y, "geometry", MAX_RENDER);
  return { kind: "point", point, space: world, spaceFrameId: frameId };
}
function projectedPath(a: Vec3, b: Vec3, frameId: string, frame: SpaceFrame): RenderPoint[] {
  const first = projectedPoint(a, frameId, frame).point;
  const second = projectedPoint(b, frameId, frame).point;
  if (!(Math.hypot(second.x - first.x, second.y - first.y) > MIN_VECTOR)) invalid("geometry", "world path collapses under this isometric projection");
  return [first, second];
}
function inputKeys(inputs: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(inputs).filter((key) => !allowed.includes(key));
  if (extra.length) invalid("fields", `unsupported space derivation inputs: ${extra.join(", ")}`);
}

/** All derivations use world vectors; the isometric projection is a presentation step. */
export function evaluateSpaceDerivationConstruction(operator: string, inputs: Record<string, unknown>, context: SpaceDerivationEvaluationContext): SpaceDerivationGeometry[] {
  const { frameId, frame } = frameInput(inputs.frame, context);
  if (operator === "space_project") {
    inputKeys(inputs, ["frame", "point", "onto"]);
    const point = spacePoint(inputs.point, "point", frameId, context);
    const target = reference(inputs.onto, "onto", context);
    let foot: Vec3;
    if (target.spaceLine !== undefined) {
      const line = lineDefinition(target, "onto");
      sameFrame(line.frameId, frameId, "onto");
      const direction = unit(line.direction, "onto");
      foot = vec3Add(line.point, vec3Scale(direction, dot(sub(point, line.point), direction)));
    } else {
      const plane = planeDefinition(target, "onto");
      sameFrame(plane.frameId, frameId, "onto");
      const normal = unit(plane.normal, "onto");
      foot = sub(point, vec3Scale(normal, dot(sub(point, plane.point), normal)));
    }
    return [projectedPoint(foot, frameId, frame)];
  }
  if (operator === "space_intersection") {
    const first = reference(inputs.first, "first", context);
    const second = reference(inputs.second, "second", context);
    const firstIsPlane = first.spacePlane !== undefined;
    const secondIsPlane = second.spacePlane !== undefined;
    if (firstIsPlane && secondIsPlane) {
      inputKeys(inputs, ["frame", "first", "second", "tMin", "tMax"]);
      const a = planeDefinition(first, "first");
      const b = planeDefinition(second, "second");
      sameFrame(a.frameId, frameId, "first"); sameFrame(b.frameId, frameId, "second");
      const n = unit(a.normal, "first");
      const m = unit(b.normal, "second");
      const direction = cross(n, m);
      const sine = vec3Length(direction);
      if (!(sine > MIN_SINE)) invalid("second", "parallel or coincident planes do not determine a unique intersection line");
      const point = vec3Scale(vec3Add(vec3Scale(cross(m, direction), dot(n, a.point)), vec3Scale(cross(direction, n), dot(m, b.point))), 1 / (sine * sine));
      finiteVector(point, "geometry");
      const normalized = unit(direction, "geometry");
      const tMin = numberInput(inputs.tMin, "tMin", context);
      const tMax = numberInput(inputs.tMax, "tMax", context);
      if (!(tMin < tMax)) invalid("tMax", "plane-plane intersection requires explicit finite tMin < tMax world distances");
      const start = vec3Add(point, vec3Scale(normalized, tMin));
      const end = vec3Add(point, vec3Scale(normalized, tMax));
      return [{ kind: "path", points: projectedPath(start, end, frameId, frame), infinite: true, spaceLine: { frameId, point, direction: normalized } }];
    }
    inputKeys(inputs, ["frame", "first", "second"]);
    if (firstIsPlane === secondIsPlane) invalid("second", "space_intersection supports a line and plane, or two planes");
    const line = lineDefinition(firstIsPlane ? second : first, firstIsPlane ? "second" : "first");
    const plane = planeDefinition(firstIsPlane ? first : second, firstIsPlane ? "first" : "second");
    sameFrame(line.frameId, frameId, "first"); sameFrame(plane.frameId, frameId, "second");
    const direction = unit(line.direction, "first");
    const normal = unit(plane.normal, "second");
    const denominator = dot(direction, normal);
    if (!(Math.abs(denominator) > MIN_SINE)) invalid("second", "parallel line and plane, including an incident line, do not determine a unique intersection point");
    const distance = bounded(dot(sub(plane.point, line.point), normal) / denominator, "geometry");
    return [projectedPoint(vec3Add(line.point, vec3Scale(direction, distance)), frameId, frame)];
  }
  if (operator === "space_closest_points") {
    inputKeys(inputs, ["frame", "first", "second"]);
    const first = lineDefinition(reference(inputs.first, "first", context), "first");
    const second = lineDefinition(reference(inputs.second, "second", context), "second");
    sameFrame(first.frameId, frameId, "first"); sameFrame(second.frameId, frameId, "second");
    const u = unit(first.direction, "first");
    const v = unit(second.direction, "second");
    const normal = cross(u, v);
    const sine = vec3Length(normal);
    if (!(sine > MIN_SINE)) invalid("second", "parallel or coincident lines do not determine unique closest points");
    const n = vec3Scale(normal, 1 / sine);
    const separation = sub(second.point, first.point);
    const firstDistance = bounded(dot(cross(separation, v), n) / sine, "geometry");
    const secondDistance = bounded(dot(cross(separation, u), n) / sine, "geometry");
    const a = projectedPoint(vec3Add(first.point, vec3Scale(u, firstDistance)), frameId, frame);
    const b = projectedPoint(vec3Add(second.point, vec3Scale(v, secondDistance)), frameId, frame);
    const connector = sub(b.space, a.space);
    const tolerance = 1e-7 * Math.max(1, vec3Length(connector));
    if (Math.abs(dot(connector, u)) > tolerance || Math.abs(dot(connector, v)) > tolerance) invalid("geometry", "closest points cannot be numerically verified as perpendicular to both lines");
    return [a, b];
  }
  if (operator === "space_segment") {
    inputKeys(inputs, ["frame", "a", "b"]);
    const a = spacePoint(inputs.a, "a", frameId, context);
    const b = spacePoint(inputs.b, "b", frameId, context);
    const length = bounded(vec3Length(sub(b, a)), "geometry");
    if (!(length > MIN_VECTOR)) invalid("b", "space_segment endpoints must be distinct world points");
    return [{ kind: "path", points: projectedPath(a, b, frameId, frame), spaceSegment: { frameId, a, b, length } }];
  }
  return invalid("operator", `unsupported space derivation operator ${operator}`);
}

function hasWorldGeometry(value: unknown): boolean {
  return isRecord(value) && ["space", "spaceFrameId", "spaceFrame", "spaceLine", "spacePlane", "spaceSegment"].some((key) => value[key] !== undefined);
}
/** A world proof cannot compare screen geometry or different projection frames. */
export function spaceProofCompatibility(geometries: readonly unknown[]): boolean | null {
  if (!geometries.some(hasWorldGeometry)) return null;
  try {
    const frames = geometries.map((geometry) => {
      if (!hasWorldGeometry(geometry)) return invalid("geometry", "world proofs require world metadata on every operand");
      return isRecord(geometry) && geometry.kind === "point"
        ? proofPoint(geometry).frameId
        : proofDirection(geometry).frameId;
    });
    return frames.length > 0 && frames.every((frame) => frame === frames[0]);
  } catch { return false; }
}

/** Distance from the middle point to the finite world segment, including its endpoints. */
export function spaceBetweenResidual(middle: unknown, first: unknown, last: unknown): number | null {
  if (![middle, first, last].some(hasWorldGeometry)) return null;
  try {
    const p = proofPoint(middle); const a = proofPoint(first); const b = proofPoint(last);
    sameFrame(p.frameId, a.frameId, "geometry"); sameFrame(b.frameId, a.frameId, "geometry");
    const delta = sub(b.point, a.point);
    const extent = vec3Length(delta);
    if (!(extent > MIN_VECTOR)) return Infinity;
    const direction = vec3Scale(delta, 1 / extent);
    const along = Math.max(0, Math.min(extent, dot(sub(p.point, a.point), direction)));
    return vec3Length(sub(p.point, vec3Add(a.point, vec3Scale(direction, along))));
  } catch { return Infinity; }
}
function proofPoint(value: unknown): { point: Vec3; frameId: string } {
  if (!isRecord(value) || value.kind !== "point" || typeof value.spaceFrameId !== "string") return invalid("geometry", "proof requires a world point with frame identity");
  return { point: finiteVector(value.space, "geometry"), frameId: value.spaceFrameId };
}
function segmentDefinition(value: unknown): SpaceSegmentDefinition {
  if (!isRecord(value) || value.kind !== "path" || !isRecord(value.spaceSegment) || typeof value.spaceSegment.frameId !== "string") return invalid("geometry", "proof requires a world segment");
  const segment = value.spaceSegment;
  const a = finiteVector(segment.a, "geometry");
  const b = finiteVector(segment.b, "geometry");
  const length = bounded(vec3Length(sub(b, a)), "geometry");
  if (!(length > MIN_VECTOR) || typeof segment.length !== "number" || !Number.isFinite(segment.length) || Math.abs(segment.length - length) > 1e-7 * Math.max(1, length)) invalid("geometry", "segment world length is inconsistent with endpoints");
  return { frameId: segment.frameId as string, a, b, length };
}
function proofDirection(value: unknown): { direction: Vec3; frameId: string; plane: boolean } {
  if (!isRecord(value)) return invalid("geometry", "proof requires world line, segment, or plane geometry");
  if (value.spacePlane !== undefined) {
    const plane = planeDefinition(value, "geometry");
    return { direction: unit(plane.normal, "geometry"), frameId: plane.frameId, plane: true };
  }
  if (value.spaceLine !== undefined) {
    const line = lineDefinition(value, "geometry");
    return { direction: unit(line.direction, "geometry"), frameId: line.frameId, plane: false };
  }
  const segment = segmentDefinition(value);
  return { direction: unit(sub(segment.b, segment.a), "geometry"), frameId: segment.frameId, plane: false };
}

/** Null leaves an entirely 2D proof with its own authority; Infinity rejects incompatible world geometry. */
export function spaceIncidenceResidual(pointGeometry: unknown, targetGeometry: unknown): number | null {
  if (!hasWorldGeometry(pointGeometry) && !hasWorldGeometry(targetGeometry)) return null;
  try {
    const point = proofPoint(pointGeometry);
    if (!isRecord(targetGeometry)) return Infinity;
    if (targetGeometry.spacePlane !== undefined) {
      const plane = planeDefinition(targetGeometry, "geometry");
      sameFrame(plane.frameId, point.frameId, "geometry");
      return Math.abs(dot(sub(point.point, plane.point), unit(plane.normal, "geometry")));
    }
    if (targetGeometry.spaceLine !== undefined) {
      const line = lineDefinition(targetGeometry, "geometry");
      sameFrame(line.frameId, point.frameId, "geometry");
      return vec3Length(cross(sub(point.point, line.point), unit(line.direction, "geometry")));
    }
    const segment = segmentDefinition(targetGeometry);
    sameFrame(segment.frameId, point.frameId, "geometry");
    const direction = unit(sub(segment.b, segment.a), "geometry");
    const distance = Math.max(0, Math.min(segment.length, dot(sub(point.point, segment.a), direction)));
    return vec3Length(sub(point.point, vec3Add(segment.a, vec3Scale(direction, distance))));
  } catch { return Infinity; }
}
export function spaceDirectionResidual(first: unknown, second: unknown, predicate: "parallel" | "perpendicular"): number | null {
  if (!hasWorldGeometry(first) && !hasWorldGeometry(second)) return null;
  try {
    const a = proofDirection(first); const b = proofDirection(second);
    sameFrame(a.frameId, b.frameId, "geometry");
    const mixedPlane = a.plane !== b.plane;
    const useDot = predicate === "perpendicular" ? !mixedPlane : mixedPlane;
    return useDot ? Math.abs(dot(a.direction, b.direction)) : vec3Length(cross(a.direction, b.direction));
  } catch { return Infinity; }
}
/** Acute angle in radians; a line-plane angle measures the inclination to the plane. */
export function spaceAcuteAngle(first: unknown, second: unknown): number | null {
  if (!hasWorldGeometry(first) && !hasWorldGeometry(second)) return null;
  try {
    const a = proofDirection(first); const b = proofDirection(second);
    sameFrame(a.frameId, b.frameId, "geometry");
    const cosine = Math.min(1, Math.max(0, Math.abs(dot(a.direction, b.direction))));
    return a.plane !== b.plane ? Math.asin(cosine) : Math.acos(cosine);
  } catch { return Infinity; }
}
export function spacePointDistance(first: unknown, second: unknown): number | null {
  if (!hasWorldGeometry(first) && !hasWorldGeometry(second)) return null;
  try {
    const a = proofPoint(first); const b = proofPoint(second);
    sameFrame(a.frameId, b.frameId, "geometry");
    return bounded(vec3Length(sub(a.point, b.point)), "geometry");
  } catch { return Infinity; }
}
export function spaceMetricLength(geometry: unknown): number | null {
  if (!hasWorldGeometry(geometry)) return null;
  try { return segmentDefinition(geometry).length; } catch { return Infinity; }
}
export function spaceCollinearityResidual(pointGeometries: unknown[]): number | null {
  if (!pointGeometries.some(hasWorldGeometry)) return null;
  try {
    const points = pointGeometries.map(proofPoint);
    if (points.length < 2) return Infinity;
    const first = points[0]!;
    for (const point of points) sameFrame(point.frameId, first.frameId, "geometry");
    const second = points.find((point) => vec3Length(sub(point.point, first.point)) > MIN_VECTOR);
    if (!second) return Infinity;
    const direction = unit(sub(second.point, first.point), "geometry");
    return Math.max(...points.map((point) => vec3Length(cross(sub(point.point, first.point), direction))));
  } catch { return Infinity; }
}

function validationNumber(value: unknown, document: SceneDocument, seen = new Set<string>(), depth = 0): number {
  if (depth > 32) return invalid("number", "numeric reference nesting exceeds 32");
  if (typeof value === "number") return bounded(value, "number");
  if (isRecord(value) && "value" in value) return validationNumber(value.value, document, seen, depth + 1);
  if (typeof value !== "string" || !value.trim() || seen.has(value)) return invalid("number", "numeric input must be a finite literal or acyclic quantity reference");
  const quantity = document.quantities.find((quantity) => quantity.id === value);
  if (!quantity) return bounded(Number(value), "number");
  seen.add(value);
  return validationNumber(quantity.value, document, seen, depth + 1);
}

/** Re-evaluate the dependency graph in world units, including derived references, before any ink is committed. */
export function validateSpaceDerivationConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const add = (key: string, message: string, actual?: unknown): void => {
    issues.push({ code: `invalid_${construction.operator}_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`, actual });
  };
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const count = construction.operator === "space_closest_points" ? 2 : 1;
  if (outputs.length !== count || outputs.some((id) => typeof id !== "string") || new Set(outputs).size !== count) add("outputs", `${construction.operator} requires ${count} distinct output${count === 1 ? "" : "s"}`, construction.outputs);
  const cache = new Map<string, unknown>();
  const visiting = new Set<string>();
  const context: SpaceDerivationEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      const geometry = context.geometry(value);
      if (!isRecord(geometry) || geometry.kind !== "point" || !isRecord(geometry.point) || typeof geometry.point.x !== "number" || typeof geometry.point.y !== "number") return invalid("origin", "space_frame origin must reference a constructed 2D point");
      return { x: bounded(geometry.point.x, "origin"), y: bounded(geometry.point.y, "origin") };
    },
    geometry(value) {
      if (typeof value !== "string") return undefined;
      if (cache.has(value)) return cache.get(value);
      if (visiting.has(value) || visiting.size >= 64) return invalid("reference", "space dependencies must be acyclic with depth at most 64");
      const producer = constructionByOutput.get(value);
      if (!producer) return undefined;
      visiting.add(value);
      try {
        const results = evaluateProducer(producer);
        for (const [outputIndex, output] of producer.outputs.entries()) cache.set(output, results[outputIndex]);
        return cache.get(value);
      } finally { visiting.delete(value); }
    },
  };
  function anchor(value: unknown, frameId: string): Vec3 {
    return typeof value === "string" ? spacePoint(value, "point", frameId, context) : vectorInput(value, "point", context);
  }
  function evaluateProducer(producer: SceneConstruction): unknown[] {
    const { operator, inputs } = producer;
    if (operator === "point") return [{ kind: "point", point: { x: numberInput(inputs.x, "x", context), y: numberInput(inputs.y, "y", context) } }];
    if (operator === "space_frame") {
      const originId = inputs.origin ?? inputs.center;
      if (typeof originId !== "string" || constructionByOutput.get(originId)?.operator !== "point") return invalid("frame", "space_frame origin must reference a constructed 2D point");
      const origin = context.point(originId);
      const scale = inputs.scale === undefined ? 1 : numberInput(inputs.scale, "scale", context);
      const axisLength = inputs.axisLength === undefined ? 2 : numberInput(inputs.axisLength, "axisLength", context);
      if (!(scale > 0) || !(axisLength > 0)) return invalid("frame", "space_frame scale and axisLength must be positive");
      return [{ kind: "compound", spaceFrame: { origin, scale } }];
    }
    if ((SPACE_DERIVATION_OPERATORS as readonly string[]).includes(operator)) return evaluateSpaceDerivationConstruction(operator, inputs, context);
    if (!["space_point", "space_line", "plane"].includes(operator)) return [];
    const { frameId, frame } = frameInput(inputs.frame, context);
    if (operator === "space_point") return [projectedPoint(vectorInput({ x: inputs.x, y: inputs.y, z: inputs.z }, "point", context), frameId, frame)];
    if (operator === "space_line") {
      const point = anchor(inputs.point ?? inputs.origin ?? inputs.through, frameId);
      const direction = vectorInput(inputs.direction, "direction", context);
      unit(direction, "direction");
      const tMin = inputs.tMin === undefined ? -1.5 : numberInput(inputs.tMin, "tMin", context);
      const tMax = inputs.tMax === undefined ? 1.5 : numberInput(inputs.tMax, "tMax", context);
      if (!(tMin < tMax)) return invalid("tMax", "space_line requires finite tMin < tMax");
      const start = vec3Add(point, vec3Scale(direction, tMin));
      const end = vec3Add(point, vec3Scale(direction, tMax));
      return [{ kind: "path", infinite: true, points: projectedPath(start, end, frameId, frame), spaceLine: { frameId, point, direction } }];
    }
    let point: Vec3;
    let normal: Vec3;
    if (["a", "b", "c", "d"].some((key) => inputs[key] !== undefined)) {
      const a = numberInput(inputs.a, "a", context); const b = numberInput(inputs.b, "b", context); const c = numberInput(inputs.c, "c", context);
      const d = inputs.d === undefined ? 0 : numberInput(inputs.d, "d", context);
      normal = unit({ x: a, y: b, z: c }, "normal");
      point = finiteVector(planeFromCartesian(a, b, c, d).point, "point");
    } else {
      point = anchor(inputs.point ?? inputs.origin, frameId);
      const u = unit(vectorInput(inputs.u, "u", context), "u");
      const v = unit(vectorInput(inputs.v, "v", context), "v");
      const product = cross(u, v);
      if (!(vec3Length(product) > MIN_SINE)) return invalid("v", "plane spanning vectors must be numerically independent");
      normal = unit(product, "normal");
    }
    const span = inputs.span === undefined ? 2.4 : numberInput(inputs.span, "span", context);
    const uSpan = inputs.uSpan === undefined ? span : numberInput(inputs.uSpan, "uSpan", context);
    const vSpan = inputs.vSpan === undefined ? span : numberInput(inputs.vSpan, "vSpan", context);
    if (!(uSpan > 0) || !(vSpan > 0)) return invalid("span", "plane spans must be positive finite numbers");
    return [{ kind: "path", closed: true, spacePlane: { frameId, point, normal } }];
  }
  try {
    const results = evaluateSpaceDerivationConstruction(construction.operator, construction.inputs, context);
    for (const [outputIndex, result] of results.entries()) {
      const expectedKind = result.kind === "point" ? "point" : result.spaceLine ? "line" : "segment";
      const entity = document.entities.find((entity) => entity.id === outputs[outputIndex]);
      if (!entity || entity.kind !== expectedKind) add("output_kind", `${construction.operator} output ${outputIndex + 1} requires entity kind ${expectedKind}`, entity?.kind);
    }
  } catch (error) {
    const key = error instanceof SpaceInputError ? error.key : "inputs";
    add(key, error instanceof Error ? error.message : "space derivation inputs are invalid");
  }
}
