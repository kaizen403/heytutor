/**
 * One view for a document's space frames, planned before anything is drawn.
 *
 * The pre-pass evaluates the space subgraph in world coordinates only, then
 * chooses the document's z-up projection, how each plane is drawn (a patch
 * holding everything that lies on it, or the intercept triangle), how far each
 * line runs and how far each axis reaches. Compile draws with this plan and
 * validation judges collapse and edge-on guards under the same projection.
 * A document without a space_frame has no plan, so nothing else changes.
 */
import { chooseSpaceProjection, DEFAULT_SPACE_PROJECTION, type SpaceViewConstraints } from "../math/spaceCamera";
import { planeFromCartesian, type SpaceProjection, type Vec3 } from "../math/space";
import type { SceneConstruction, SceneDocument } from "../types";
import {
  deriveSpaceWorld,
  SPACE_DERIVATION_OPERATORS,
  validationNumber,
  type SpaceDerivationEvaluationContext,
  type SpaceWorldRecord,
} from "./spaceDerivations";

export type SpacePlaneDrawing =
  | { kind: "patch"; center: Vec3; u: Vec3; v: Vec3; uSpan: number; vSpan: number }
  | { kind: "triangle"; vertices: [Vec3, Vec3, Vec3] };

export interface SpaceViewPlan {
  /** One per document, shared by every frame. */
  projection: SpaceProjection;
  /** Drawn axis range per frame; axisMin <= 0 < axisLength <= axisMax. */
  frames: Map<string, { axisMin: Vec3; axisMax: Vec3 }>;
  /** Drawn world range of each space_line output along its own direction. */
  lines: Map<string, { tMin: number; tMax: number }>;
  planes: Map<string, SpacePlaneDrawing>;
  report: { candidate: string; score: number; passesFloors: boolean; worst: string };
}

const DEFAULT_AXIS_LENGTH = 2;
/** Presentation tolerance as a fraction of the frame's axis length. */
const PRESENTATION_TOLERANCE = 0.02;
/** A line meets a plane visibly only when it is not nearly parallel to it. */
const MIN_MEETING_SINE = 0.05;
/** A plane is an intercept plane when every unit normal component reaches this. */
const MIN_INTERCEPT_COMPONENT = 0.02;
/** Intercepts farther than this many axis lengths are treated as infinite. */
const MAX_INTERCEPT_AXIS_LENGTHS = 20;
/**
 * A point drawn inside an intercept triangle must sit this far in from every
 * edge, in barycentric units, or at a vertex; a point on an edge reads as the
 * plane's boundary, so that plane is drawn as a patch instead.
 */
const MIN_TRIANGLE_INTERIOR = 0.05;
const MAX_DEPTH = 64;

const plans = new WeakMap<SceneDocument, SpaceViewPlan | null>();

/** The document's space view, or null when it has no space_frame. */
export function planSpaceView(document: SceneDocument): SpaceViewPlan | null {
  if (plans.has(document)) return plans.get(document) ?? null;
  const plan = computePlan(document);
  plans.set(document, plan);
  return plan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function constructionsOf(document: SceneDocument): SceneConstruction[] {
  return Array.isArray(document?.constructions) ? document.constructions.filter((construction) => isRecord(construction)) : [];
}

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const component = (a: Vec3, axis: number): number => (axis === 0 ? a.x : axis === 1 ? a.y : a.z);
const AXES: readonly Vec3[] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
function unitOf(a: Vec3): Vec3 {
  const length = norm(a);
  if (!(length > 1e-12) || !Number.isFinite(length)) throw new Error("space view vector must be nonzero");
  return scale(a, 1 / length);
}
function finite(a: Vec3): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}

interface FrameInfo { id: string; axisLength: number; tolerance: number }
interface LineInfo { id: string; frameId: string; point: Vec3; direction: Vec3; tMin: number; tMax: number; extendable: boolean }
interface PlaneInfo {
  id: string;
  frameId: string;
  /** The plane's equation n·p = delta in its source form. */
  normal: Vec3;
  delta: number;
  anchor: Vec3;
  basis: { u: Vec3; v: Vec3 } | null;
  uSpan?: number;
  vSpan?: number;
}
interface SegmentInfo { frameId: string; a: Vec3; b: Vec3 }
interface AngleInfo { frameId: string; vertex: Vec3; u: Vec3; v: Vec3 }
interface MarkedPoint { frameId: string; point: Vec3 }

interface World {
  frames: Map<string, FrameInfo>;
  points: MarkedPoint[];
  endpoints: MarkedPoint[];
  lines: LineInfo[];
  planes: PlaneInfo[];
  segments: SegmentInfo[];
  angles: AngleInfo[];
}

/**
 * Evaluate every space construction lazily in world units, in the same shape
 * validation uses (cache, visiting set, bounded depth). A construction that
 * throws is skipped; validation and compile report it.
 */
function evaluateWorld(document: SceneDocument): World {
  const constructions = constructionsOf(document);
  const byOutput = new Map<string, SceneConstruction>();
  for (const construction of constructions) {
    for (const output of Array.isArray(construction.outputs) ? construction.outputs : []) {
      if (typeof output === "string" && !byOutput.has(output)) byOutput.set(output, construction);
    }
  }
  const world: World = { frames: new Map(), points: [], endpoints: [], lines: [], planes: [], segments: [], angles: [] };
  const cache = new Map<string, unknown>();
  const failed = new Set<SceneConstruction>();
  const visiting = new Set<string>();
  const number = (value: unknown): number => {
    const result = validationNumber(value, document);
    if (!Number.isFinite(result)) throw new Error("space view number must be finite");
    return result;
  };
  const vector = (value: unknown): Vec3 => {
    if (Array.isArray(value) && value.length === 3) return { x: number(value[0]), y: number(value[1]), z: number(value[2]) };
    if (isRecord(value) && value.x !== undefined && value.y !== undefined && value.z !== undefined) return { x: number(value.x), y: number(value.y), z: number(value.z) };
    throw new Error("space view vector must have three components");
  };
  const context: SpaceDerivationEvaluationContext = {
    number,
    point(value) {
      const geometry = context.geometry(value);
      if (!isRecord(geometry) || geometry.kind !== "point") throw new Error("space view point must be constructed");
      return { x: 0, y: 0 };
    },
    geometry(value) {
      if (typeof value !== "string") return undefined;
      if (cache.has(value)) return cache.get(value);
      const producer = byOutput.get(value);
      if (!producer || failed.has(producer)) return undefined;
      if (visiting.has(value) || visiting.size >= MAX_DEPTH) throw new Error("space dependencies must be acyclic with bounded depth");
      visiting.add(value);
      try {
        const results = evaluate(producer);
        producer.outputs.forEach((output, index) => cache.set(output, results[index]));
        return cache.get(value);
      } catch (error) {
        failed.add(producer);
        throw error;
      } finally { visiting.delete(value); }
    },
  };
  const frameOf = (value: unknown): FrameInfo => {
    const geometry = typeof value === "string" ? context.geometry(value) : undefined;
    const frame = typeof value === "string" ? world.frames.get(value) : undefined;
    if (!isRecord(geometry) || !frame) throw new Error("space view frame must reference a space_frame");
    return frame;
  };
  const spacePointOf = (value: unknown, frameId: string): Vec3 => {
    if (typeof value !== "string") return vector(value);
    const geometry = context.geometry(value);
    if (!isRecord(geometry) || geometry.kind !== "point" || !isRecord(geometry.space) || geometry.spaceFrameId !== frameId) throw new Error("space view point must belong to the frame");
    return geometry.space as unknown as Vec3;
  };
  function evaluate(producer: SceneConstruction): unknown[] {
    const inputs = isRecord(producer.inputs) ? producer.inputs : {};
    const output = String(producer.outputs[0]);
    switch (producer.operator) {
      case "point": return [{ kind: "point", point: { x: 0, y: 0 } }];
      case "space_frame": {
        const axisLength = inputs.axisLength === undefined ? DEFAULT_AXIS_LENGTH : number(inputs.axisLength);
        if (!(axisLength > 0)) throw new Error("space_frame axisLength must be positive");
        world.frames.set(output, { id: output, axisLength, tolerance: PRESENTATION_TOLERANCE * axisLength });
        return [{ kind: "compound", spaceFrame: { origin: { x: 0, y: 0 }, scale: 1 } }];
      }
      case "space_point": {
        const frame = frameOf(inputs.frame);
        const space = { x: number(inputs.x), y: number(inputs.y), z: number(inputs.z) };
        if (!finite(space)) throw new Error("space point must be finite");
        world.points.push({ frameId: frame.id, point: space });
        return [{ kind: "point", point: { x: 0, y: 0 }, space, spaceFrameId: frame.id }];
      }
      case "space_line": {
        const frame = frameOf(inputs.frame);
        const point = spacePointOf(inputs.point ?? inputs.origin ?? inputs.through, frame.id);
        const direction = vector(inputs.direction);
        unitOf(direction);
        const tMin = inputs.tMin === undefined ? -1.5 : number(inputs.tMin);
        const tMax = inputs.tMax === undefined ? 1.5 : number(inputs.tMax);
        if (!(tMin < tMax)) throw new Error("space_line requires tMin < tMax");
        world.lines.push({ id: output, frameId: frame.id, point, direction, tMin, tMax, extendable: true });
        return [{ kind: "path", infinite: true, points: [], spaceLine: { frameId: frame.id, point, direction, tMin, tMax } }];
      }
      case "plane": return [planeGeometry(inputs, output)];
      default: break;
    }
    if (!(SPACE_DERIVATION_OPERATORS as readonly string[]).includes(producer.operator)) return [];
    const derived = deriveSpaceWorld(producer.operator, inputs, context);
    return derived.records.map((record, index) => recordGeometry(record, derived.frameId, String(producer.outputs[index])));
  }
  function planeGeometry(inputs: Record<string, unknown>, output: string): unknown {
    const frame = frameOf(inputs.frame);
    const spans = {
      span: inputs.span === undefined ? undefined : number(inputs.span),
      uSpan: inputs.uSpan === undefined ? undefined : number(inputs.uSpan),
      vSpan: inputs.vSpan === undefined ? undefined : number(inputs.vSpan),
    };
    if ([spans.span, spans.uSpan, spans.vSpan].some((value) => value !== undefined && !(value > 0))) throw new Error("plane spans must be positive");
    const uSpan = spans.uSpan ?? spans.span;
    const vSpan = spans.vSpan ?? spans.span;
    let info: PlaneInfo;
    let anchor: Vec3;
    let normal: Vec3;
    if (inputs.a !== undefined && inputs.b !== undefined && inputs.c !== undefined) {
      const a = number(inputs.a); const b = number(inputs.b); const c = number(inputs.c);
      const d = inputs.d === undefined ? 0 : number(inputs.d);
      // The same anchor and normal compile records, so proofs and derivations agree.
      const cartesian = planeFromCartesian(a, b, c, d);
      anchor = cartesian.point;
      normal = unitOf(cross(cartesian.u, cartesian.v));
      info = { id: output, frameId: frame.id, normal: { x: a, y: b, z: c }, delta: d, anchor, basis: null, uSpan, vSpan };
    } else {
      anchor = spacePointOf(inputs.point ?? inputs.origin, frame.id);
      const u = vector(inputs.u);
      const v = vector(inputs.v);
      const product = cross(u, v);
      normal = unitOf(product);
      info = { id: output, frameId: frame.id, normal: product, delta: dot(product, anchor), anchor, basis: { u, v }, uSpan, vSpan };
    }
    if (!finite(anchor) || !finite(normal)) throw new Error("plane must be finite");
    world.planes.push(info);
    return { kind: "path", closed: true, points: [], spacePlane: { frameId: frame.id, point: anchor, normal } };
  }
  function recordGeometry(record: SpaceWorldRecord, frameId: string, output: string): unknown {
    if (record.kind === "point") {
      world.points.push({ frameId, point: record.space });
      return { kind: "point", point: { x: 0, y: 0 }, space: record.space, spaceFrameId: frameId, ...(record.spaceCross ? { spaceCross: record.spaceCross } : {}) };
    }
    if (record.kind === "line") {
      const { point, direction, tMin = -1, tMax = 1 } = record.spaceLine;
      world.lines.push({ id: output, frameId, point, direction, tMin, tMax, extendable: false });
      return { kind: "path", infinite: true, points: [], spaceLine: record.spaceLine };
    }
    if (record.kind === "segment") {
      world.segments.push({ frameId, a: record.a, b: record.b });
      world.endpoints.push({ frameId, point: record.a }, { frameId, point: record.b });
      return { kind: "path", points: [], ...(record.directed ? { directed: true } : {}), spaceSegment: record.spaceSegment, ...(record.spaceCross ? { spaceCross: record.spaceCross } : {}) };
    }
    const { vertex, u, v, radians } = record.angle;
    world.angles.push({ frameId, vertex, u, v });
    return { kind: "path", points: [], markedAngleRadians: radians, spaceAngle: { frameId, vertex, u, v, radians, right: record.right } };
  }
  for (const construction of constructions) {
    const first = Array.isArray(construction.outputs) ? construction.outputs[0] : undefined;
    if (typeof first !== "string" || byOutput.get(first) !== construction) continue;
    try { context.geometry(first); } catch { /* validation and compile report it */ }
  }
  return world;
}

interface PlaneDrawingResult { drawing: SpacePlaneDrawing; axisPoints: Vec3[]; edges: Vec3[]; vertices: Vec3[] }

function computePlan(document: SceneDocument): SpaceViewPlan | null {
  const constructions = constructionsOf(document);
  if (!constructions.some((construction) => construction.operator === "space_frame")) return null;
  let world: World;
  try { world = evaluateWorld(document); } catch { world = { frames: new Map(), points: [], endpoints: [], lines: [], planes: [], segments: [], angles: [] }; }
  const lines = new Map<string, { tMin: number; tMax: number }>();
  const planes = new Map<string, SpacePlaneDrawing>();
  const frames = new Map<string, { axisMin: Vec3; axisMax: Vec3 }>();
  const frameOf = (id: string): FrameInfo => world.frames.get(id) ?? { id, axisLength: DEFAULT_AXIS_LENGTH, tolerance: PRESENTATION_TOLERANCE * DEFAULT_AXIS_LENGTH };
  const marked = (frameId: string) => world.points.filter((item) => item.frameId === frameId).map((item) => item.point);
  const candidates = (frameId: string) => [...marked(frameId), ...world.endpoints.filter((item) => item.frameId === frameId).map((item) => item.point), ORIGIN];

  /** Where a line meets a plane, when that point is near the line's own drawn range. */
  const meeting = (line: LineInfo, plane: PlaneInfo): { t: number; point: Vec3 } | null => {
    const along = dot(line.direction, plane.normal);
    if (!(Math.abs(along) >= MIN_MEETING_SINE * norm(line.direction) * norm(plane.normal))) return null;
    const t = (plane.delta - dot(plane.normal, line.point)) / along;
    const width = line.tMax - line.tMin;
    if (!Number.isFinite(t) || t < line.tMin - 0.5 * width || t > line.tMax + 0.5 * width) return null;
    return { t, point: add(line.point, scale(line.direction, t)) };
  };

  // Lines: the planner's range, widened to hold every point drawn on the line.
  for (const line of world.lines) {
    if (!line.extendable) continue;
    const frame = frameOf(line.frameId);
    const length = norm(line.direction);
    const unitDirection = scale(line.direction, 1 / length);
    const parameters: number[] = [];
    for (const point of marked(line.frameId)) {
      const offset = sub(point, line.point);
      if (norm(cross(offset, unitDirection)) <= frame.tolerance) parameters.push(dot(offset, line.direction) / (length * length));
    }
    for (const plane of world.planes) {
      if (plane.frameId !== line.frameId) continue;
      const hit = meeting(line, plane);
      if (hit) parameters.push(hit.t);
    }
    const margin = 0.1 * frame.axisLength / length;
    const finiteParameters = parameters.filter(Number.isFinite);
    lines.set(line.id, {
      tMin: Math.min(line.tMin, ...finiteParameters.map((t) => t - margin)),
      tMax: Math.max(line.tMax, ...finiteParameters.map((t) => t + margin)),
    });
  }

  // Planes: the intercept triangle when it holds everything on the plane, else a patch that does.
  const planeResults = new Map<string, PlaneDrawingResult>();
  for (const plane of world.planes) {
    try {
      const result = planeDrawing(plane, frameOf(plane.frameId), [
        ...candidates(plane.frameId),
        ...world.lines.filter((line) => line.frameId === plane.frameId).flatMap((line) => { const hit = meeting(line, plane); return hit ? [hit.point] : []; }),
      ]);
      planes.set(plane.id, result.drawing);
      planeResults.set(plane.id, result);
    } catch { /* compile keeps its own drawing */ }
  }

  // Axes: long enough to reach every point, vertex and intercept drawn on them.
  for (const frame of world.frames.values()) {
    const onAxis: Vec3[] = [
      ...marked(frame.id),
      ...world.planes.filter((plane) => plane.frameId === frame.id).flatMap((plane) => planeResults.get(plane.id)?.axisPoints ?? []),
    ];
    const axisMax = [frame.axisLength, frame.axisLength, frame.axisLength];
    const axisMin = [0, 0, 0];
    for (const point of onAxis) {
      for (let axis = 0; axis < 3; axis += 1) {
        const others = [0, 1, 2].filter((other) => other !== axis).map((other) => component(point, other));
        const value = component(point, axis);
        if (others.some((other) => Math.abs(other) > frame.tolerance)) continue;
        if (!(Math.abs(value) > frame.tolerance) || Math.abs(value) > MAX_INTERCEPT_AXIS_LENGTHS * frame.axisLength) continue;
        const margin = Math.max(0.12 * Math.abs(value), 0.15 * frame.axisLength);
        if (value > 0) axisMax[axis] = Math.max(axisMax[axis]!, value + margin);
        else axisMin[axis] = Math.min(axisMin[axis]!, value - margin);
      }
    }
    frames.set(frame.id, { axisMin: { x: axisMin[0]!, y: axisMin[1]!, z: axisMin[2]! }, axisMax: { x: axisMax[0]!, y: axisMax[1]!, z: axisMax[2]! } });
  }

  const choice = chooseProjection(world, planeResults, frameOf);
  return { projection: choice.projection, frames, lines, planes, report: choice.report };
}

function planeDrawing(plane: PlaneInfo, frame: FrameInfo, candidates: Vec3[]): PlaneDrawingResult {
  const L0 = frame.axisLength;
  const tolerance = frame.tolerance;
  const length = norm(plane.normal);
  const unitNormal = scale(plane.normal, 1 / length);
  const offPlane = (point: Vec3) => Math.abs(dot(unitNormal, point) - plane.delta / length);
  const incident = candidates.filter((point) => finite(point) && offPlane(point) <= tolerance);
  if (plane.basis) incident.push(plane.anchor);
  const crossesAxis = (axis: number) => Math.abs(component(unitNormal, axis)) >= MIN_INTERCEPT_COMPONENT;
  const throughOrigin = !(Math.abs(plane.delta) >= 1e-6 * L0 * length);
  const intercepts: Array<Vec3 | null> = [0, 1, 2].map((axis) => {
    if (throughOrigin || !crossesAxis(axis)) return null;
    const value = plane.delta / component(plane.normal, axis);
    if (!Number.isFinite(value) || Math.abs(value) > MAX_INTERCEPT_AXIS_LENGTHS * L0) return null;
    return scale(AXES[axis]!, value);
  });
  const interceptPlane = intercepts.every((point) => point !== null);
  if (interceptPlane) {
    const [A, B, C] = intercepts as [Vec3, Vec3, Vec3];
    if (incident.every((point) => insideTriangle(point, A, B, C, tolerance))) {
      return { drawing: { kind: "triangle", vertices: [A, B, C] }, axisPoints: [A, B, C], edges: [sub(B, A), sub(C, B), sub(A, C)], vertices: [A, B, C] };
    }
  }
  const finiteIntercepts = intercepts.filter((point): point is Vec3 => point !== null);
  incident.push(...finiteIntercepts);

  // In-plane basis: one horizontal edge and one up-slope edge, or the planner's own u and v.
  let e1: Vec3;
  let e2: Vec3;
  let origin: Vec3;
  if (plane.basis) {
    e1 = plane.basis.u;
    e2 = plane.basis.v;
    origin = plane.anchor;
  } else {
    if (Math.abs(unitNormal.z) > 0.98) {
      e1 = AXES[0]!;
      e2 = AXES[1]!;
    } else {
      e1 = unitOf(cross(unitNormal, AXES[2]!));
      e2 = cross(unitNormal, e1);
      if (e2.z < 0) e2 = scale(e2, -1);
    }
    origin = scale(unitNormal, plane.delta / length);
  }
  const g11 = dot(e1, e1); const g12 = dot(e1, e2); const g22 = dot(e2, e2);
  const determinant = g11 * g22 - g12 * g12;
  if (!(determinant > 1e-12 * g11 * g22)) throw new Error("plane spanning vectors must be independent");
  const coordinates = incident.map((point) => {
    const offset = sub(point, origin);
    const r1 = dot(offset, e1); const r2 = dot(offset, e2);
    return { a: (g22 * r1 - g12 * r2) / determinant, b: (g11 * r2 - g12 * r1) / determinant };
  });
  const as = coordinates.map((item) => item.a);
  const bs = coordinates.map((item) => item.b);
  const aMin = as.length ? Math.min(...as) : 0; const aMax = as.length ? Math.max(...as) : 0;
  const bMin = bs.length ? Math.min(...bs) : 0; const bMax = bs.length ? Math.max(...bs) : 0;
  const unitE1 = Math.sqrt(g11); const unitE2 = Math.sqrt(g22);
  // World lengths along each edge; planner spans count in their own u, v units.
  const spreadU = (aMax - aMin) * unitE1;
  const spreadV = (bMax - bMin) * unitE2;
  const margin = Math.max(0.15 * Math.max(spreadU, spreadV), 0.1 * L0);
  const minimumU = (plane.uSpan ?? 1.2 * L0) * (plane.basis ? unitE1 : 1);
  const minimumV = (plane.vSpan ?? 1.2 * L0) * (plane.basis ? unitE2 : 1);
  const uSpan = Math.max(spreadU + 2 * margin, minimumU);
  const vSpan = Math.max(spreadV + 2 * margin, minimumV);
  const center = add(origin, add(scale(e1, (aMin + aMax) / 2), scale(e2, (bMin + bMax) / 2)));
  const u = scale(e1, 1 / unitE1);
  const v = scale(e2, 1 / unitE2);
  if (!finite(center) || !(uSpan > 0) || !(vSpan > 0) || !Number.isFinite(uSpan) || !Number.isFinite(vSpan)) throw new Error("plane patch must be finite");
  return { drawing: { kind: "patch", center, u, v, uSpan, vSpan }, axisPoints: finiteIntercepts, edges: [u, v], vertices: [] };
}

/** Inside the triangle by a margin from every edge, or at one of its vertices. */
function insideTriangle(point: Vec3, A: Vec3, B: Vec3, C: Vec3, tolerance: number): boolean {
  if ([A, B, C].some((vertex) => norm(sub(point, vertex)) <= tolerance)) return true;
  const normal = cross(sub(B, A), sub(C, A));
  const area = dot(normal, normal);
  if (!(area > 0)) return false;
  const weights = [
    dot(cross(sub(C, B), sub(point, B)), normal) / area,
    dot(cross(sub(A, C), sub(point, C)), normal) / area,
    dot(cross(sub(B, A), sub(point, A)), normal) / area,
  ];
  return weights.every((weight) => weight >= MIN_TRIANGLE_INTERIOR);
}

/** The figure's drawn directions, meeting pairs, faces and points, then the fixed camera rule. */
function chooseProjection(world: World, planeResults: Map<string, PlaneDrawingResult>, frameOf: (id: string) => FrameInfo): { projection: SpaceProjection; report: SpaceViewPlan["report"] } {
  try {
    const directions: Vec3[] = [];
    const faces: Vec3[] = [];
    const meetings: Array<[Vec3, Vec3]> = [];
    const pointGroups: Vec3[][] = [];
    let pointTolerance = Infinity;
    for (const line of world.lines) directions.push(line.direction);
    for (const segment of world.segments) { const delta = sub(segment.b, segment.a); if (norm(delta) > 0) directions.push(delta); }
    for (const plane of world.planes) {
      faces.push(plane.normal);
      directions.push(...(planeResults.get(plane.id)?.edges ?? []));
    }
    for (const angle of world.angles) faces.push(cross(angle.u, angle.v));
    const frameIds = new Set([...world.frames.keys()]);
    for (const frameId of frameIds) {
      const frame = frameOf(frameId);
      pointTolerance = Math.min(pointTolerance, frame.tolerance);
      const vertices = world.planes.filter((plane) => plane.frameId === frameId).flatMap((plane) => planeResults.get(plane.id)?.vertices ?? []);
      const points = [ORIGIN, ...world.points.filter((item) => item.frameId === frameId).map((item) => item.point), ...vertices];
      pointGroups.push(points);
      // Elements through each marked point; any two of them meet there.
      for (const point of points) {
        const through: Vec3[] = [];
        for (let axis = 0; axis < 3; axis += 1) {
          const others = [0, 1, 2].filter((other) => other !== axis);
          if (others.every((other) => Math.abs(component(point, other)) <= frame.tolerance)) through.push(AXES[axis]!);
        }
        for (const line of world.lines) {
          if (line.frameId !== frameId) continue;
          const direction = unitOf(line.direction);
          if (norm(cross(sub(point, line.point), direction)) <= frame.tolerance) through.push(line.direction);
        }
        for (const segment of world.segments) {
          if (segment.frameId === frameId && (norm(sub(point, segment.a)) <= frame.tolerance || norm(sub(point, segment.b)) <= frame.tolerance)) through.push(sub(segment.b, segment.a));
        }
        for (const angle of world.angles) {
          if (angle.frameId === frameId && norm(sub(point, angle.vertex)) <= frame.tolerance) through.push(angle.u, angle.v);
        }
        for (const plane of world.planes) {
          const result = planeResults.get(plane.id);
          if (plane.frameId !== frameId || result?.drawing.kind !== "triangle") continue;
          const [A, B, C] = result.drawing.vertices;
          if (norm(sub(point, A)) <= frame.tolerance) through.push(sub(B, A), sub(C, A));
          if (norm(sub(point, B)) <= frame.tolerance) through.push(sub(C, B), sub(A, B));
          if (norm(sub(point, C)) <= frame.tolerance) through.push(sub(A, C), sub(B, C));
        }
        for (let i = 0; i < through.length; i += 1) for (let j = i + 1; j < through.length; j += 1) meetings.push([through[i]!, through[j]!]);
      }
    }
    const constraints: SpaceViewConstraints = {
      axes: AXES,
      directions: directions.filter((direction) => finite(direction) && norm(direction) > 0),
      meetings: meetings.filter(([a, b]) => finite(a) && finite(b)),
      faces: faces.filter((face) => finite(face) && norm(face) > 0),
      points: [],
      pointGroups: pointGroups.map((group) => group.filter(finite)),
      pointTolerance: Number.isFinite(pointTolerance) ? pointTolerance : PRESENTATION_TOLERANCE * DEFAULT_AXIS_LENGTH,
    };
    return chooseSpaceProjection(constraints);
  } catch {
    return { projection: DEFAULT_SPACE_PROJECTION, report: { candidate: "book 0.5 45", score: 0, passesFloors: false, worst: "planning failed" } };
  }
}
