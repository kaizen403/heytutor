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
import { chooseSpaceProjection, DEFAULT_SPACE_PROJECTION, projectionMetrics, projectionName, SPACE_PROJECTION_CANDIDATES, type SpaceViewConstraints } from "../math/spaceCamera";
import { planeFromCartesian, type SpaceProjection, type Vec3 } from "../math/space";
import type { SceneConstruction, SceneDocument } from "../types";
import { pointLabelText, type PointLabelText } from "./pointLabelText";
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
  /**
   * Drawn world range of each space_line and plane/plane intersection line
   * along its own direction. Lines are drawn as these finite segments.
   */
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
/**
 * A drawn line runs at most this many axis lengths past the points it holds
 * (or past the middle of its planner range when it holds none). The planner's
 * range is a minimum only within that reach, so a long planner range cannot
 * run off the board or shrink the rest of the figure.
 */
const MAX_LINE_REACH = 1.2;
/** A patch around one point is at least this share of the figure's world size. */
const FIGURE_SPAN_SHARE = 0.5;
/** The board room a figure is fitted into: the diagram zone less its label reserve. */
const FIT_WIDTH_PX = 740 - 2 * 64;
const FIT_HEIGHT_PX = 555 - 2 * 64;
/**
 * The label solver's box: the glyph run plus 4 px padding on each side, 24 px
 * text, and the 6 px it keeps clear of ink. A label with a leader lands at
 * most its tether from the point.
 */
const LABEL_PADDING_PX = 4;
const LABEL_HEIGHT_PX = 24 + 2 * LABEL_PADDING_PX;
const LABEL_GAP_PX = 6;
const SLOT_GAPS_PX = [14, 10, 6];
/** The board scale here is an estimate, so a name should fit with this much to spare. */
const LABEL_SLACK_PX = 4;
/** A patch holding a point whose name has no room may grow by these factors, smallest first. */
const PATCH_GROWTH = [1.25, 1.5, 2];
const MAX_DEPTH = 64;

/**
 * Memo by document identity. The stored signature of the constructions,
 * quantities, entities and annotations (point names size the room the view
 * leaves) guards a caller that edits a document in place between compiles.
 */
const plans = new WeakMap<SceneDocument, { signature: string; plan: SpaceViewPlan }>();

/** The document's space view, or null when it has no space_frame. */
export function planSpaceView(document: SceneDocument): SpaceViewPlan | null {
  if (!constructionsOf(document).some((construction) => construction.operator === "space_frame")) return null;
  const signature = planSignature(document);
  const memo = plans.get(document);
  if (memo && signature !== null && memo.signature === signature) return memo.plan;
  const plan = computePlan(document);
  if (plan && signature !== null) plans.set(document, { signature, plan });
  return plan;
}

/** Null when the document cannot be serialised; the plan is then recomputed each time. */
function planSignature(document: SceneDocument): string | null {
  try { return JSON.stringify([document.constructions, document.quantities, document.entities, document.annotations]); } catch { return null; }
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
interface LineInfo {
  id: string;
  frameId: string;
  point: Vec3;
  direction: Vec3;
  tMin: number;
  tMax: number;
  /** A space_line the planner placed; a derived line keeps no meeting points with planes. */
  extendable: boolean;
  /** The two planes a plane/plane intersection line lies in. */
  planes?: [string, string];
}
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
interface MarkedPoint { frameId: string; point: Vec3; id?: string }

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
        world.points.push({ frameId: frame.id, point: space, id: output });
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
    const planes = producer.operator === "space_intersection" && typeof inputs.first === "string" && typeof inputs.second === "string"
      ? [inputs.first, inputs.second] as [string, string]
      : undefined;
    return derived.records.map((record, index) => recordGeometry(record, derived.frameId, String(producer.outputs[index]), planes));
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
  function recordGeometry(record: SpaceWorldRecord, frameId: string, output: string, planes?: [string, string]): unknown {
    if (record.kind === "point") {
      world.points.push({ frameId, point: record.space, id: output });
      return { kind: "point", point: { x: 0, y: 0 }, space: record.space, spaceFrameId: frameId, ...(record.spaceCross ? { spaceCross: record.spaceCross } : {}) };
    }
    if (record.kind === "line") {
      const { point, direction, tMin = -1, tMax = 1 } = record.spaceLine;
      world.lines.push({ id: output, frameId, point, direction, tMin, tMax, extendable: false, ...(planes ? { planes } : {}) });
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
  /** The figure's world size: the largest coordinate range of its axes and marked points. */
  const figureExtent = (frameId: string): number => {
    const points = [...marked(frameId), ...world.endpoints.filter((item) => item.frameId === frameId).map((item) => item.point), ORIGIN, scale({ x: 1, y: 1, z: 1 }, frameOf(frameId).axisLength)].filter(finite);
    return Math.max(...[0, 1, 2].map((axis) => Math.max(...points.map((point) => component(point, axis))) - Math.min(...points.map((point) => component(point, axis)))));
  };
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

  // Lines: a finite stretch that holds every point drawn on the line, and the
  // planner's range within a reach that keeps the line on the board.
  for (const line of world.lines) {
    const frame = frameOf(line.frameId);
    const length = norm(line.direction);
    if (!(length > 0) || !Number.isFinite(length)) continue;
    const unitDirection = scale(line.direction, 1 / length);
    const parameters: number[] = [];
    // Marked points and segment or vector ends (a computed cross product tip, for example).
    const ends = world.endpoints.filter((item) => item.frameId === line.frameId).map((item) => item.point);
    for (const point of [...marked(line.frameId), ...ends]) {
      const offset = sub(point, line.point);
      if (norm(cross(offset, unitDirection)) <= frame.tolerance) parameters.push(dot(offset, line.direction) / (length * length));
    }
    if (line.extendable) {
      for (const plane of world.planes) {
        if (plane.frameId !== line.frameId) continue;
        const hit = meeting(line, plane);
        if (hit) parameters.push(hit.t);
      }
    }
    const extent = drawnLineRange(line, parameters.filter(Number.isFinite), length, frame.axisLength);
    if (extent) lines.set(line.id, extent);
  }

  // Planes: the intercept triangle when it holds everything on the plane, else a patch that does.
  const planeResults = new Map<string, PlaneDrawingResult>();
  /** The patch a plane drawn as its intercept triangle would get instead. */
  const patchAlternatives = new Map<string, SpacePlaneDrawing>();
  for (const plane of world.planes) {
    try {
      // Both planes of an intersection line hold its drawn stretch, so the
      // two patches visibly meet along the line.
      const stretches = world.lines.flatMap((line) => {
        const extent = lines.get(line.id);
        if (!line.planes?.includes(plane.id) || !extent) return [];
        return [add(line.point, scale(line.direction, extent.tMin)), add(line.point, scale(line.direction, extent.tMax))];
      });
      const held = [
        ...candidates(plane.frameId),
        ...world.lines.filter((line) => line.frameId === plane.frameId).flatMap((line) => { const hit = meeting(line, plane); return hit ? [hit.point] : []; }),
      ];
      const result = planeDrawing(plane, frameOf(plane.frameId), figureExtent(plane.frameId), held, stretches);
      planes.set(plane.id, result.drawing);
      planeResults.set(plane.id, result);
      if (result.drawing.kind === "triangle") patchAlternatives.set(plane.id, planeDrawing(plane, frameOf(plane.frameId), figureExtent(plane.frameId), held, stretches, false).drawing);
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

  const named = world.points.flatMap((item) => {
    const label = item.id ? pointLabelText(document, item.id) : null;
    return label ? [{ ...item, label }] : [];
  });
  const roomy = withLabelRoom(chooseProjection(world, planeResults, frameOf), world, named, frames, lines, planes, patchAlternatives, frameOf);
  return { projection: roomy.choice.projection, frames, lines, planes: roomy.planes, report: roomy.choice.report };
}

type ProjectionChoice = { projection: SpaceProjection; report: SpaceViewPlan["report"]; constraints?: SpaceViewConstraints };
interface Screen { x: number; y: number }
const onScreen = (projection: SpaceProjection, point: Vec3): Screen => ({ x: dot(projection.right, point), y: dot(projection.up, point) });
function drawingCorners(drawing: SpacePlaneDrawing): Vec3[] {
  if (drawing.kind === "triangle") return drawing.vertices;
  const halfU = scale(drawing.u, drawing.uSpan / 2);
  const halfV = scale(drawing.v, drawing.vSpan / 2);
  return [add(add(drawing.center, halfU), halfV), add(sub(drawing.center, halfU), halfV), sub(sub(drawing.center, halfU), halfV), sub(add(drawing.center, halfU), halfV)];
}

/**
 * Pixels per world unit the board fit will give the figure under this
 * projection: the screen box of the axes, points, lines and planes, fitted
 * into the diagram zone. An estimate; compile does the real fit.
 */
function figureScale(projection: SpaceProjection, world: World, frames: SpaceViewPlan["frames"], lines: SpaceViewPlan["lines"], planes: SpaceViewPlan["planes"]): number {
  const points: Vec3[] = [ORIGIN, ...world.points.map((item) => item.point), ...world.endpoints.map((item) => item.point)];
  for (const range of frames.values()) {
    for (let axis = 0; axis < 3; axis += 1) points.push(scale(AXES[axis]!, component(range.axisMin, axis)), scale(AXES[axis]!, component(range.axisMax, axis)));
  }
  // Lines stay out of the board fit (compile clips them to the view).
  void lines;
  for (const drawing of planes.values()) points.push(...drawingCorners(drawing));
  const screen = points.filter(finite).map((point) => onScreen(projection, point));
  const width = Math.max(...screen.map((point) => point.x)) - Math.min(...screen.map((point) => point.x));
  const height = Math.max(...screen.map((point) => point.y)) - Math.min(...screen.map((point) => point.y));
  return Math.min(FIT_WIDTH_PX / Math.max(width, 1e-9), FIT_HEIGHT_PX / Math.max(height, 1e-9));
}

interface NamedPoint extends MarkedPoint { label: PointLabelText }
interface LabelRoom { missing: number; slack: number }
type Ink = [Screen, Screen];

const SLOT_DIRECTIONS: readonly Screen[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }];
const LEADER_DIRECTIONS: readonly Screen[] = Array.from({ length: 16 }, (_, index) => ({ x: Math.cos((index * Math.PI) / 8), y: Math.sin((index * Math.PI) / 8) }));

/** Whether segment a-b meets the box centred at c with half sizes hx, hy. */
function segmentMeetsBox(a: Screen, b: Screen, c: Screen, hx: number, hy: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - (c.x - hx)], [dx, c.x + hx - a.x], [-dy, a.y - (c.y - hy)], [dy, c.y + hy - a.y]] as const) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
function segmentsCross(a: Screen, b: Screen, c: Screen, d: Screen): boolean {
  const orient = (p: Screen, q: Screen, r: Screen) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c); const o2 = orient(a, b, d); const o3 = orient(c, d, a); const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * Room for the names of points drawn inside a plane or on its outline (a
 * triangle's corners), in board pixels under this view. Each such point's
 * label is the text compile will place, at its real width, tried where the
 * label solver tries it: compass slots next to the point, and spots along a
 * leader within the label's tether. A spot must keep the solver's gap from
 * the axes, plane edges, lines, segments, points and the names already given
 * a spot, and a leader may not cross any ink. `missing` counts points with no
 * spot; `slack` is the extra clearance the worst of the others has.
 */
function labelRoom(projection: SpaceProjection, world: World, named: NamedPoint[], frames: SpaceViewPlan["frames"], lines: SpaceViewPlan["lines"], planes: SpaceViewPlan["planes"]): LabelRoom {
  const pixels = figureScale(projection, world, frames, lines, planes);
  const toPx = (point: Vec3): Screen => { const screen = onScreen(projection, point); return { x: screen.x * pixels, y: screen.y * pixels }; };
  const ink: Ink[] = [];
  for (const range of frames.values()) {
    for (let axis = 0; axis < 3; axis += 1) ink.push([toPx(scale(AXES[axis]!, component(range.axisMin, axis))), toPx(scale(AXES[axis]!, component(range.axisMax, axis)))]);
  }
  const rings: Screen[][] = [];
  for (const drawing of planes.values()) {
    const ring = drawingCorners(drawing).map(toPx);
    rings.push(ring);
    ring.forEach((a, index) => ink.push([a, ring[(index + 1) % ring.length]!]));
  }
  for (const line of world.lines) {
    const extent = lines.get(line.id);
    if (extent) ink.push([toPx(add(line.point, scale(line.direction, extent.tMin))), toPx(add(line.point, scale(line.direction, extent.tMax)))]);
  }
  for (const segment of world.segments) ink.push([toPx(segment.a), toPx(segment.b)]);
  const dots = [...world.points, ...world.endpoints].map((item) => toPx(item.point));
  const finiteInk = ink.filter(([a, b]) => Number.isFinite(a.x + a.y + b.x + b.y));
  /** Inside the ring by more than `margin` pixels from every edge (negative: on or near it). */
  const insideBy = (q: Screen, ring: Screen[], margin: number): boolean => {
    const area = ring.reduce((sum, a, index) => { const b = ring[(index + 1) % ring.length]!; return sum + a.x * b.y - b.x * a.y; }, 0);
    if (!(Math.abs(area) > 1e-9)) return false;
    return ring.every((a, index) => {
      const b = ring[(index + 1) % ring.length]!;
      return Math.sign(area) * ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y) > margin;
    });
  };
  // Names already given a spot; later names keep the solver's gap from them.
  const placed: Array<{ c: Screen; hx: number; hy: number }> = [];
  const fits = (q: Screen, label: PointLabelText, extra: number): { c: Screen; hx: number; hy: number } | null => {
    const width = label.widthPx + 2 * LABEL_PADDING_PX;
    const hx = width / 2 + LABEL_GAP_PX + extra;
    const hy = LABEL_HEIGHT_PX / 2 + LABEL_GAP_PX + extra;
    const clear = (c: Screen) =>
      finiteInk.every(([a, b]) => !segmentMeetsBox(a, b, c, hx, hy)) &&
      // Every dot, the point's own included, is a 4 px box the label keeps its gap from.
      dots.every((dot) => Math.abs(dot.x - c.x) > hx + 4 || Math.abs(dot.y - c.y) > hy + 4) &&
      placed.every((box) => Math.abs(box.c.x - c.x) >= hx + box.hx || Math.abs(box.c.y - c.y) >= hy + box.hy);
    const spot = (c: Screen) => ({ c, hx: width / 2, hy: LABEL_HEIGHT_PX / 2 });
    for (const gap of SLOT_GAPS_PX) {
      for (const direction of SLOT_DIRECTIONS) {
        const c = { x: q.x + direction.x * (gap + width / 2), y: q.y + direction.y * (gap + LABEL_HEIGHT_PX / 2) };
        if (clear(c)) return spot(c);
      }
    }
    const distances: number[] = [];
    for (let distance = 24; distance <= label.tetherPx; distance += 8) distances.push(distance);
    if (distances.at(-1) !== label.tetherPx) distances.push(label.tetherPx);
    for (const distance of distances) {
      for (const direction of LEADER_DIRECTIONS) {
        const c = { x: q.x + direction.x * distance, y: q.y + direction.y * distance };
        if (!clear(c)) continue;
        if (!label.allowLeader) return spot(c);
        // The leader runs from just off the point to the box edge.
        const reach = Math.min(Math.abs(direction.x) > 1e-9 ? (width / 2) / Math.abs(direction.x) : Infinity, Math.abs(direction.y) > 1e-9 ? (LABEL_HEIGHT_PX / 2) / Math.abs(direction.y) : Infinity);
        const from = { x: q.x + direction.x * 3, y: q.y + direction.y * 3 };
        const to = { x: q.x + direction.x * Math.max(3, distance - reach), y: q.y + direction.y * Math.max(3, distance - reach) };
        if (finiteInk.every(([a, b]) => !segmentsCross(from, to, a, b))) return spot(c);
      }
    }
    return null;
  };
  let missing = 0;
  let slack = Infinity;
  for (const item of named) {
    const q = toPx(item.point);
    if (!Number.isFinite(q.x + q.y) || !rings.some((ring) => insideBy(q, ring, -1))) continue;
    let found = false;
    for (const extra of [2 * LABEL_SLACK_PX, LABEL_SLACK_PX, 0]) {
      const box = fits(q, item.label, extra);
      if (!box) continue;
      placed.push(box);
      slack = Math.min(slack, extra);
      found = true;
      break;
    }
    if (!found) missing += 1;
  }
  return { missing, slack: Number.isFinite(slack) ? slack : 2 * LABEL_SLACK_PX };
}

/** Each patch that holds a point with a name grows about its centre by this factor; null when none does. */
function grownPatches(planes: SpaceViewPlan["planes"], world: World, named: NamedPoint[], factor: number, frameOf: (id: string) => FrameInfo): SpaceViewPlan["planes"] | null {
  const grown = new Map(planes);
  let changed = false;
  for (const plane of world.planes) {
    const drawing = planes.get(plane.id);
    if (drawing?.kind !== "patch") continue;
    const unitNormal = unitOf(plane.normal);
    const offset = plane.delta / norm(plane.normal);
    const holds = named.some((item) => item.frameId === plane.frameId && Math.abs(dot(unitNormal, item.point) - offset) <= frameOf(plane.frameId).tolerance);
    if (holds) { grown.set(plane.id, { ...drawing, uSpan: drawing.uSpan * factor, vSpan: drawing.vSpan * factor }); changed = true; }
  }
  return changed ? grown : null;
}

/**
 * An intercept triangle holding a named point well inside it, drawn instead
 * as the patch the plane would otherwise get; null when there is none.
 */
function openedTriangles(planes: SpaceViewPlan["planes"], world: World, named: NamedPoint[], patchAlternatives: Map<string, SpacePlaneDrawing>, frameOf: (id: string) => FrameInfo): SpaceViewPlan["planes"] | null {
  const opened = new Map(planes);
  let changed = false;
  for (const plane of world.planes) {
    const drawing = planes.get(plane.id);
    const patch = patchAlternatives.get(plane.id);
    if (drawing?.kind !== "triangle" || !patch) continue;
    const [A, B, C] = drawing.vertices;
    const tolerance = frameOf(plane.frameId).tolerance;
    const holds = named.some((item) => item.frameId === plane.frameId && ![A, B, C].some((vertex) => norm(sub(item.point, vertex)) <= tolerance) && insideTriangle(item.point, A, B, C, tolerance));
    if (holds) { opened.set(plane.id, patch); changed = true; }
  }
  return changed ? opened : null;
}

/**
 * A point drawn inside a plane needs room for its name at its real size.
 * When the camera's view leaves too little, take the first acceptable view
 * (floors met, score at least 0.85) that gives every such name room with
 * slack; failing that, grow the patches holding named points, smallest step
 * first; failing that, draw an intercept triangle holding a named point as a
 * patch (it holds the triangle's corners), then grow that. Without any, keep
 * the view and drawings that leave the fewest names without room.
 */
function withLabelRoom(choice: ProjectionChoice, world: World, named: NamedPoint[], frames: SpaceViewPlan["frames"], lines: SpaceViewPlan["lines"], planes: SpaceViewPlan["planes"], patchAlternatives: Map<string, SpacePlaneDrawing>, frameOf: (id: string) => FrameInfo): { choice: ProjectionChoice; planes: SpaceViewPlan["planes"] } {
  const constraints = choice.constraints;
  if (!constraints || planes.size === 0 || named.length === 0) return { choice, planes };
  const enough = (room: LabelRoom) => room.missing === 0 && room.slack >= LABEL_SLACK_PX;
  const better = (a: LabelRoom, b: LabelRoom) => a.missing < b.missing || (a.missing === b.missing && a.slack > b.slack);
  const first = labelRoom(choice.projection, world, named, frames, lines, planes);
  if (enough(first)) return { choice, planes };
  let best = { choice, planes, room: first };
  const acceptable = SPACE_PROJECTION_CANDIDATES.flatMap((projection) => {
    const metrics = projectionMetrics(projection, constraints);
    return metrics.passesFloors && metrics.score >= 0.85 && projection !== choice.projection ? [{ projection, metrics }] : [];
  });
  const options: ProjectionChoice[] = [choice, ...acceptable.map(({ projection, metrics }): ProjectionChoice => ({
    projection,
    report: { candidate: projectionName(projection), score: metrics.score, passesFloors: metrics.passesFloors, worst: `${metrics.worst}; room for names inside a plane` },
    constraints,
  }))];
  const variants: Array<SpaceViewPlan["planes"]> = [];
  for (const base of [planes, openedTriangles(planes, world, named, patchAlternatives, frameOf)]) {
    if (!base) continue;
    variants.push(base);
    for (const factor of PATCH_GROWTH) {
      const grown = grownPatches(base, world, named, factor, frameOf);
      if (grown) variants.push(grown);
    }
  }
  for (const drawn of variants) {
    for (const option of options) {
      const room = drawn === planes && option === choice ? first : labelRoom(option.projection, world, named, frames, lines, drawn);
      if (enough(room)) return { choice: option, planes: drawn };
      if (better(room, best.room)) best = { choice: option, planes: drawn, room };
    }
  }
  return { choice: best.choice, planes: best.planes };
}

/**
 * The drawn parameter range of a line: the points it holds with a margin, and
 * the planner's range only as far as MAX_LINE_REACH axis lengths past them.
 * A line that holds no point is centred on the middle of its planner range.
 */
function drawnLineRange(line: LineInfo, held: number[], length: number, axisLength: number): { tMin: number; tMax: number } | null {
  const margin = 0.1 * axisLength / length;
  const reach = MAX_LINE_REACH * axisLength / length;
  const middle = (line.tMin + line.tMax) / 2;
  const low = held.length > 0 ? Math.min(...held) - margin : middle;
  const high = held.length > 0 ? Math.max(...held) + margin : middle;
  const tMin = Math.min(low, Math.max(line.tMin, low - reach));
  const tMax = Math.max(high, Math.min(line.tMax, high + reach));
  return Number.isFinite(tMin) && Number.isFinite(tMax) && tMin < tMax ? { tMin, tMax } : null;
}

function planeDrawing(plane: PlaneInfo, frame: FrameInfo, extent: number, candidates: Vec3[], stretches: Vec3[] = [], allowTriangle = true): PlaneDrawingResult {
  const L0 = frame.axisLength;
  const tolerance = frame.tolerance;
  const length = norm(plane.normal);
  const unitNormal = scale(plane.normal, 1 / length);
  const offPlane = (point: Vec3) => Math.abs(dot(unitNormal, point) - plane.delta / length);
  const incident = [...candidates, ...stretches].filter((point) => finite(point) && offPlane(point) <= tolerance);
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
  if (interceptPlane && allowTriangle) {
    const [A, B, C] = intercepts as [Vec3, Vec3, Vec3];
    if (incident.every((point) => insideTriangle(point, A, B, C, tolerance))) {
      return { drawing: { kind: "triangle", vertices: [A, B, C] }, axisPoints: [A, B, C], edges: [sub(B, A), sub(C, B), sub(A, C)], vertices: [A, B, C] };
    }
  }
  // Axis crossings locate a plane that holds nothing else. A plane that holds
  // points or lines is drawn around them: its unmarked intercepts would grow
  // the patch until it swamps the figure.
  const finiteIntercepts = incident.length === 0 ? intercepts.filter((point): point is Vec3 => point !== null) : [];
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
      // Near-horizontal: world x and y projected into the plane, so a slightly tilted plane is
      // still drawn in its own surface (exactly x and y when the plane is horizontal).
      e1 = unitOf(sub(AXES[0]!, scale(unitNormal, dot(AXES[0]!, unitNormal))));
      e2 = cross(unitNormal, e1);
      if (dot(e2, AXES[1]!) < 0) e2 = scale(e2, -1);
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
  // A plane in a large figure is drawn large enough to carry its points' names.
  const defaultSpan = Math.max(1.2 * L0, FIGURE_SPAN_SHARE * extent);
  const minimumU = (plane.uSpan ?? defaultSpan) * (plane.basis ? unitE1 : 1);
  const minimumV = (plane.vSpan ?? defaultSpan) * (plane.basis ? unitE2 : 1);
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
function chooseProjection(world: World, planeResults: Map<string, PlaneDrawingResult>, frameOf: (id: string) => FrameInfo): ProjectionChoice {
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
    return { ...chooseSpaceProjection(constraints), constraints };
  } catch {
    return { projection: DEFAULT_SPACE_PROJECTION, report: { candidate: "book 0.5 45", score: 0, passesFloors: false, worst: "planning failed" } };
  }
}
