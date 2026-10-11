/**
 * One deterministic camera for a document's space frames.
 *
 * Two families of parallel projection, both with world z exactly screen up:
 * the book view (oblique: y right, z up, x receding lower left at angle
 * 180 + alpha with length k) and an orthographic z-up turntable as fallback.
 * Every candidate is scored by the figure's own drawn directions, meeting
 * pairs, faces and points; nothing comes from the planner. The rows are
 * literal decimals so the choice is identical on every JavaScript engine.
 */
import type { SpaceProjection, Vec3 } from "./space";

function book(k: number, alpha: number, right: [number, number, number], up: [number, number, number]): SpaceProjection {
  return { family: "book", params: [k, alpha], right: { x: right[0], y: right[1], z: right[2] }, up: { x: up[0], y: up[1], z: up[2] } };
}
function turntable(azimuth: number, elevation: number, right: [number, number, number], up: [number, number, number]): SpaceProjection {
  return { family: "turntable", params: [azimuth, elevation], right: { x: right[0], y: right[1], z: right[2] }, up: { x: up[0], y: up[1], z: up[2] } };
}

/**
 * Book rows r1 = (-k cos a, 1, 0), r2 = (-k sin a, 0, 1), ordered by |a - 45|
 * then |k - 0.5|; turntable rows r1 = (-sin t, cos t, 0),
 * r2 = (-sin p cos t, -sin p sin t, cos p), textbook azimuths first.
 */
export const SPACE_PROJECTION_CANDIDATES: readonly SpaceProjection[] = [
  book(0.5, 45, [-0.353553390593, 1, 0], [-0.353553390593, 0, 1]),
  book(0.42, 45, [-0.296984848098, 1, 0], [-0.296984848098, 0, 1]),
  book(0.6, 45, [-0.424264068712, 1, 0], [-0.424264068712, 0, 1]),
  book(0.5, 52.5, [-0.304380714504, 1, 0], [-0.396676670146, 0, 1]),
  book(0.5, 37.5, [-0.396676670146, 1, 0], [-0.304380714504, 0, 1]),
  book(0.42, 52.5, [-0.255679800184, 1, 0], [-0.333208402922, 0, 1]),
  book(0.42, 37.5, [-0.333208402922, 1, 0], [-0.255679800184, 0, 1]),
  book(0.6, 52.5, [-0.365256857405, 1, 0], [-0.476012004175, 0, 1]),
  book(0.6, 37.5, [-0.476012004175, 1, 0], [-0.365256857405, 0, 1]),
  book(0.5, 60, [-0.25, 1, 0], [-0.433012701892, 0, 1]),
  book(0.5, 30, [-0.433012701892, 1, 0], [-0.25, 0, 1]),
  book(0.42, 60, [-0.21, 1, 0], [-0.363730669589, 0, 1]),
  book(0.42, 30, [-0.363730669589, 1, 0], [-0.21, 0, 1]),
  book(0.6, 60, [-0.3, 1, 0], [-0.519615242271, 0, 1]),
  book(0.6, 30, [-0.519615242271, 1, 0], [-0.3, 0, 1]),
  turntable(30, 25, [-0.5, 0.866025403784, 0], [-0.365998150771, -0.21130913087, 0.906307787037]),
  turntable(45, 25, [-0.707106781187, 0.707106781187, 0], [-0.29883623873, -0.29883623873, 0.906307787037]),
  turntable(15, 25, [-0.258819045103, 0.965925826289, 0], [-0.408217893677, -0.109381654947, 0.906307787037]),
  turntable(60, 25, [-0.866025403784, 0.5, 0], [-0.21130913087, -0.365998150771, 0.906307787037]),
  turntable(75, 25, [-0.965925826289, 0.258819045103, 0], [-0.109381654947, -0.408217893677, 0.906307787037]),
  turntable(0, 25, [0, 1.0, 0], [-0.422618261741, 0, 0.906307787037]),
  turntable(90, 25, [-1.0, 0, 0], [0, -0.422618261741, 0.906307787037]),
  turntable(-15, 25, [0.258819045103, 0.965925826289, 0], [-0.408217893677, 0.109381654947, 0.906307787037]),
  turntable(105, 25, [-0.965925826289, -0.258819045103, 0], [0.109381654947, -0.408217893677, 0.906307787037]),
  turntable(-30, 25, [0.5, 0.866025403784, 0], [-0.365998150771, 0.21130913087, 0.906307787037]),
  turntable(120, 25, [-0.866025403784, -0.5, 0], [0.21130913087, -0.365998150771, 0.906307787037]),
  turntable(-45, 25, [0.707106781187, 0.707106781187, 0], [-0.29883623873, 0.29883623873, 0.906307787037]),
  turntable(135, 25, [-0.707106781187, -0.707106781187, 0], [0.29883623873, -0.29883623873, 0.906307787037]),
  turntable(-60, 25, [0.866025403784, 0.5, 0], [-0.21130913087, 0.365998150771, 0.906307787037]),
  turntable(150, 25, [-0.5, -0.866025403784, 0], [0.365998150771, -0.21130913087, 0.906307787037]),
  turntable(-75, 25, [0.965925826289, 0.258819045103, 0], [-0.109381654947, 0.408217893677, 0.906307787037]),
  turntable(165, 25, [-0.258819045103, -0.965925826289, 0], [0.408217893677, -0.109381654947, 0.906307787037]),
  turntable(-90, 25, [1.0, 0, 0], [0, 0.422618261741, 0.906307787037]),
  turntable(180, 25, [0, -1.0, 0], [0.422618261741, 0, 0.906307787037]),
  turntable(-105, 25, [0.965925826289, -0.258819045103, 0], [0.109381654947, 0.408217893677, 0.906307787037]),
  turntable(-120, 25, [0.866025403784, -0.5, 0], [0.21130913087, 0.365998150771, 0.906307787037]),
  turntable(-135, 25, [0.707106781187, -0.707106781187, 0], [0.29883623873, 0.29883623873, 0.906307787037]),
  turntable(-150, 25, [0.5, -0.866025403784, 0], [0.365998150771, 0.21130913087, 0.906307787037]),
  turntable(-165, 25, [0.258819045103, -0.965925826289, 0], [0.408217893677, 0.109381654947, 0.906307787037]),
  turntable(30, 35, [-0.5, 0.866025403784, 0], [-0.496731764892, -0.286788218176, 0.819152044289]),
  turntable(45, 35, [-0.707106781187, 0.707106781187, 0], [-0.405579787673, -0.405579787673, 0.819152044289]),
  turntable(15, 35, [-0.258819045103, 0.965925826289, 0], [-0.554032293222, -0.14845250555, 0.819152044289]),
  turntable(60, 35, [-0.866025403784, 0.5, 0], [-0.286788218176, -0.496731764892, 0.819152044289]),
  turntable(75, 35, [-0.965925826289, 0.258819045103, 0], [-0.14845250555, -0.554032293222, 0.819152044289]),
  turntable(0, 35, [0, 1.0, 0], [-0.573576436351, 0, 0.819152044289]),
  turntable(90, 35, [-1.0, 0, 0], [0, -0.573576436351, 0.819152044289]),
  turntable(-15, 35, [0.258819045103, 0.965925826289, 0], [-0.554032293222, 0.14845250555, 0.819152044289]),
  turntable(105, 35, [-0.965925826289, -0.258819045103, 0], [0.14845250555, -0.554032293222, 0.819152044289]),
  turntable(-30, 35, [0.5, 0.866025403784, 0], [-0.496731764892, 0.286788218176, 0.819152044289]),
  turntable(120, 35, [-0.866025403784, -0.5, 0], [0.286788218176, -0.496731764892, 0.819152044289]),
  turntable(-45, 35, [0.707106781187, 0.707106781187, 0], [-0.405579787673, 0.405579787673, 0.819152044289]),
  turntable(135, 35, [-0.707106781187, -0.707106781187, 0], [0.405579787673, -0.405579787673, 0.819152044289]),
  turntable(-60, 35, [0.866025403784, 0.5, 0], [-0.286788218176, 0.496731764892, 0.819152044289]),
  turntable(150, 35, [-0.5, -0.866025403784, 0], [0.496731764892, -0.286788218176, 0.819152044289]),
  turntable(-75, 35, [0.965925826289, 0.258819045103, 0], [-0.14845250555, 0.554032293222, 0.819152044289]),
  turntable(165, 35, [-0.258819045103, -0.965925826289, 0], [0.554032293222, -0.14845250555, 0.819152044289]),
  turntable(-90, 35, [1.0, 0, 0], [0, 0.573576436351, 0.819152044289]),
  turntable(180, 35, [0, -1.0, 0], [0.573576436351, 0, 0.819152044289]),
  turntable(-105, 35, [0.965925826289, -0.258819045103, 0], [0.14845250555, 0.554032293222, 0.819152044289]),
  turntable(-120, 35, [0.866025403784, -0.5, 0], [0.286788218176, 0.496731764892, 0.819152044289]),
  turntable(-135, 35, [0.707106781187, -0.707106781187, 0], [0.405579787673, 0.405579787673, 0.819152044289]),
  turntable(-150, 35, [0.5, -0.866025403784, 0], [0.496731764892, 0.286788218176, 0.819152044289]),
  turntable(-165, 35, [0.258819045103, -0.965925826289, 0], [0.554032293222, 0.14845250555, 0.819152044289]),
  turntable(30, 15, [-0.5, 0.866025403784, 0], [-0.224143868042, -0.129409522551, 0.965925826289]),
  turntable(45, 15, [-0.707106781187, 0.707106781187, 0], [-0.183012701892, -0.183012701892, 0.965925826289]),
  turntable(15, 15, [-0.258819045103, 0.965925826289, 0], [-0.25, -0.066987298108, 0.965925826289]),
  turntable(60, 15, [-0.866025403784, 0.5, 0], [-0.129409522551, -0.224143868042, 0.965925826289]),
  turntable(75, 15, [-0.965925826289, 0.258819045103, 0], [-0.066987298108, -0.25, 0.965925826289]),
  turntable(0, 15, [0, 1.0, 0], [-0.258819045103, 0, 0.965925826289]),
  turntable(90, 15, [-1.0, 0, 0], [0, -0.258819045103, 0.965925826289]),
  turntable(-15, 15, [0.258819045103, 0.965925826289, 0], [-0.25, 0.066987298108, 0.965925826289]),
  turntable(105, 15, [-0.965925826289, -0.258819045103, 0], [0.066987298108, -0.25, 0.965925826289]),
  turntable(-30, 15, [0.5, 0.866025403784, 0], [-0.224143868042, 0.129409522551, 0.965925826289]),
  turntable(120, 15, [-0.866025403784, -0.5, 0], [0.129409522551, -0.224143868042, 0.965925826289]),
  turntable(-45, 15, [0.707106781187, 0.707106781187, 0], [-0.183012701892, 0.183012701892, 0.965925826289]),
  turntable(135, 15, [-0.707106781187, -0.707106781187, 0], [0.183012701892, -0.183012701892, 0.965925826289]),
  turntable(-60, 15, [0.866025403784, 0.5, 0], [-0.129409522551, 0.224143868042, 0.965925826289]),
  turntable(150, 15, [-0.5, -0.866025403784, 0], [0.224143868042, -0.129409522551, 0.965925826289]),
  turntable(-75, 15, [0.965925826289, 0.258819045103, 0], [-0.066987298108, 0.25, 0.965925826289]),
  turntable(165, 15, [-0.258819045103, -0.965925826289, 0], [0.25, -0.066987298108, 0.965925826289]),
  turntable(-90, 15, [1.0, 0, 0], [0, 0.258819045103, 0.965925826289]),
  turntable(180, 15, [0, -1.0, 0], [0.258819045103, 0, 0.965925826289]),
  turntable(-105, 15, [0.965925826289, -0.258819045103, 0], [0.066987298108, 0.25, 0.965925826289]),
  turntable(-120, 15, [0.866025403784, -0.5, 0], [0.129409522551, 0.224143868042, 0.965925826289]),
  turntable(-135, 15, [0.707106781187, -0.707106781187, 0], [0.183012701892, 0.183012701892, 0.965925826289]),
  turntable(-150, 15, [0.5, -0.866025403784, 0], [0.224143868042, 0.129409522551, 0.965925826289]),
  turntable(-165, 15, [0.258819045103, -0.965925826289, 0], [0.25, 0.066987298108, 0.965925826289]),
];

/** The cabinet view: k 0.5, alpha 45 degrees. */
export const DEFAULT_SPACE_PROJECTION: SpaceProjection = SPACE_PROJECTION_CANDIDATES[0]!;

export interface SpaceViewConstraints {
  /** Unit world axes of the frames, normally e_x, e_y, e_z. */
  readonly axes: readonly Vec3[];
  /** Drawn figure directions other than the axes; unsigned. */
  readonly directions: readonly Vec3[];
  /** Pairs of drawn directions whose elements share a marked point. */
  readonly meetings: readonly (readonly [Vec3, Vec3])[];
  /** Plane normals and angle mark plane normals. */
  readonly faces: readonly Vec3[];
  /** Marked points and frame origins. */
  readonly points: readonly Vec3[];
  /** Points closer than this are one point. */
  readonly pointTolerance?: number;
}

export interface ProjectionMetrics {
  readonly score: number;
  readonly passesFloors: boolean;
  readonly worst: string;
}

export interface SpaceProjectionChoice {
  readonly projection: SpaceProjection;
  readonly report: { candidate: string; score: number; passesFloors: boolean; worst: string };
}

const FLOORS = { length: 0.3, axisPair: 30, axisFigure: 8, meeting: 6, face: 0.15, pointPair: 0.2 } as const;
const TARGETS = { length: 0.45, axisPair: 30, axisFigure: 15, meeting: 12, face: 0.25, pointPair: 0.3 } as const;
/** Figure directions closer than this to an axis (3D, degrees) may share its line. */
const AXIS_FIGURE_MIN_3D = 20;
/** Meeting lines closer than this (3D, degrees) may share a screen line. */
const MEETING_MIN_3D = 15;
const DEGREES = 180 / Math.PI;
/** The 30 degree axis floor is met exactly by alpha 30 and 60; rounding must not fail it. */
const FLOOR_SLACK = 1e-9;

function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function norm(a: Vec3): number { return Math.hypot(a.x, a.y, a.z); }
function unit(a: Vec3): Vec3 | null {
  const length = norm(a);
  return length > 1e-12 && Number.isFinite(length) ? { x: a.x / length, y: a.y / length, z: a.z / length } : null;
}
/** Unsigned angle between two lines in degrees, 0 to 90. */
function lineAngle3(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.abs(dot(a, b)) / (norm(a) * norm(b)))) * DEGREES;
}
function image(projection: SpaceProjection, direction: Vec3): { x: number; y: number } {
  return { x: dot(projection.right, direction), y: dot(projection.up, direction) };
}
/** Unsigned angle between two drawn lines in degrees; a direction drawn as a point meets everything at 0. */
function screenAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (!(la > 1e-12) || !(lb > 1e-12)) return 0;
  return Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y) / (la * lb))) * DEGREES;
}
function vectorName(v: Vec3): string {
  const short = (value: number) => Number(value.toFixed(3));
  return `(${short(v.x)},${short(v.y)},${short(v.z)})`;
}
/** Unsigned unit lines with near duplicates removed, in first-seen order. */
function distinctLines(values: readonly Vec3[]): Vec3[] {
  const result: Vec3[] = [];
  for (const value of values) {
    const line = unit(value);
    if (line && !result.some((existing) => lineAngle3(existing, line) < 1e-6)) result.push(line);
  }
  return result;
}

interface Prepared {
  axes: Vec3[];
  directions: Vec3[];
  axisFigure: Array<[Vec3, Vec3]>;
  meetings: Array<[Vec3, Vec3]>;
  faces: Vec3[];
  pointPairs: Vec3[];
}
function prepare(constraints: SpaceViewConstraints): Prepared {
  const axes = distinctLines(constraints.axes);
  const directions = distinctLines(constraints.directions).filter((line) => !axes.some((axis) => lineAngle3(axis, line) < 1e-6));
  const axisFigure: Array<[Vec3, Vec3]> = [];
  for (const axis of axes) for (const direction of directions) if (lineAngle3(axis, direction) >= AXIS_FIGURE_MIN_3D) axisFigure.push([axis, direction]);
  const meetings: Array<[Vec3, Vec3]> = [];
  for (const [first, second] of constraints.meetings) {
    const a = unit(first);
    const b = unit(second);
    if (!a || !b || lineAngle3(a, b) < MEETING_MIN_3D) continue;
    if (!meetings.some(([c, d]) => (lineAngle3(a, c) < 1e-6 && lineAngle3(b, d) < 1e-6) || (lineAngle3(a, d) < 1e-6 && lineAngle3(b, c) < 1e-6))) meetings.push([a, b]);
  }
  const faces = distinctLines(constraints.faces);
  const tolerance = constraints.pointTolerance ?? 1e-9;
  const pointPairs: Vec3[] = [];
  const points = constraints.points;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i]!;
      const b = points[j]!;
      const delta = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      if (norm(delta) > tolerance) pointPairs.push(delta);
    }
  }
  return { axes, directions, axisFigure, meetings, faces: faces, pointPairs: distinctLines(pointPairs) };
}

function measure(projection: SpaceProjection, prepared: Prepared): ProjectionMetrics {
  let score = 1;
  let passesFloors = true;
  let worst = "none";
  const take = (name: string, value: number, floor: number, target: number) => {
    if (!(value >= floor - FLOOR_SLACK)) passesFloors = false;
    const ratio = Math.min(1, value / target + FLOOR_SLACK);
    if (ratio < score) { score = ratio; worst = name; }
  };
  const area = cross(projection.right, projection.up);
  for (const line of [...prepared.axes, ...prepared.directions]) {
    const drawn = image(projection, line);
    take(`length ${vectorName(line)}`, Math.hypot(drawn.x, drawn.y), FLOORS.length, TARGETS.length);
  }
  for (let i = 0; i < prepared.axes.length; i += 1) {
    for (let j = i + 1; j < prepared.axes.length; j += 1) {
      const a = prepared.axes[i]!;
      const b = prepared.axes[j]!;
      take(`axes ${vectorName(a)} ${vectorName(b)}`, screenAngle(image(projection, a), image(projection, b)), FLOORS.axisPair, TARGETS.axisPair);
    }
  }
  for (const [axis, direction] of prepared.axisFigure) {
    take(`axis ${vectorName(axis)} vs ${vectorName(direction)}`, screenAngle(image(projection, axis), image(projection, direction)), FLOORS.axisFigure, TARGETS.axisFigure);
  }
  for (const [a, b] of prepared.meetings) {
    take(`meeting ${vectorName(a)} ${vectorName(b)}`, screenAngle(image(projection, a), image(projection, b)), FLOORS.meeting, TARGETS.meeting);
  }
  for (const normal of prepared.faces) take(`face ${vectorName(normal)}`, Math.abs(dot(area, normal)), FLOORS.face, TARGETS.face);
  for (const delta of prepared.pointPairs) {
    const drawn = image(projection, delta);
    take(`points ${vectorName(delta)}`, Math.hypot(drawn.x, drawn.y), FLOORS.pointPair, TARGETS.pointPair);
  }
  return { score, passesFloors, worst };
}

export function projectionName(projection: SpaceProjection): string {
  return `${projection.family} ${projection.params[0]} ${projection.params[1]}`;
}

/** Score one projection against a figure: min over every measure of min(1, measure / target). */
export function projectionMetrics(projection: SpaceProjection, constraints: SpaceViewConstraints): ProjectionMetrics {
  return measure(projection, prepare(constraints));
}

/**
 * Maximise (passes floors, score >= 0.85, book family, score, earlier
 * candidate). The default book wins whenever it is clean; any book within
 * 15% of every target beats a turntable; a turntable is used only when no
 * book view gets there.
 */
export function chooseSpaceProjection(constraints: SpaceViewConstraints): SpaceProjectionChoice {
  const prepared = prepare(constraints);
  let chosen = DEFAULT_SPACE_PROJECTION;
  let chosenMetrics = measure(chosen, prepared);
  let chosenKey = selectionKey(chosen, chosenMetrics, 0);
  for (let index = 1; index < SPACE_PROJECTION_CANDIDATES.length; index += 1) {
    const projection = SPACE_PROJECTION_CANDIDATES[index]!;
    const metrics = measure(projection, prepared);
    const key = selectionKey(projection, metrics, index);
    if (isGreater(key, chosenKey)) { chosen = projection; chosenMetrics = metrics; chosenKey = key; }
  }
  return {
    projection: chosen,
    report: { candidate: projectionName(chosen), score: chosenMetrics.score, passesFloors: chosenMetrics.passesFloors, worst: chosenMetrics.worst },
  };
}

function selectionKey(projection: SpaceProjection, metrics: ProjectionMetrics, index: number): number[] {
  return [metrics.passesFloors ? 1 : 0, metrics.score >= 0.85 ? 1 : 0, projection.family === "book" ? 1 : 0, metrics.score, -index];
}

function isGreater(a: number[], b: number[]): boolean {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! > b[index]!;
  }
  return false;
}
