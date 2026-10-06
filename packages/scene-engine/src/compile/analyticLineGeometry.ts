import { exactBinary64LineResidual } from "../math/exactBinary64";
import { validatePublicationDerivedClaims, type PublicationClaimAuthority } from "./publicationDerivedClaims";
import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const ANALYTIC_LINE_OPERATORS = [
  "coordinate_distance",
  "section_point",
  "axis_translation",
  "line_relation",
  "line_intercepts",
  "line_equation",
  "line_intersection_angle",
  "line_concurrence",
  "point_line_distance",
] as const;

export type AnalyticLineOperator = (typeof ANALYTIC_LINE_OPERATORS)[number];

/** Certified world-coordinate results. Display length never overwrites these numbers. */
export interface AnalyticLineRecord {
  topic: string;
  worldUnits: true;
  displayLength?: number | null;
  distance?: number;
  coincidentPoints?: boolean;
  axisAligned?: "horizontal" | "vertical" | "neither" | "coincident";
  quadrants?: [string, string];
  coefficients?: LineCoefficients;
  normalized?: LineCoefficients;
  slope?: number | null;
  slopeDefined?: boolean;
  direction?: RenderPoint;
  otherDirection?: RenderPoint;
  xIntercept?: RenderPoint | null;
  yIntercept?: RenderPoint | null;
  xAxisCoincident?: boolean;
  yAxisCoincident?: boolean;
  throughOrigin?: boolean;
  section?: { mode: SectionMode; m: number; n: number; parameter: number };
  translation?: {
    h: number;
    k: number;
    direction: TranslationDirection;
    linear: readonly [1, 0, 0, 1];
    examScope: {
      jeeMain: "application";
      jeeAdvanced: "listed";
      neet: "not_applicable";
      shiftOfOrigin: true;
    };
  };
  parallel?: boolean;
  perpendicular?: boolean;
  coincidentLines?: boolean;
  sameSense?: boolean;
  relation?: "intersecting" | "parallel" | "coincident";
  angleRadians?: number;
  angleConvention?: "acute";
  intersection?: RenderPoint | null;
  concurrent?: boolean;
  concurrenceReason?: "unique" | "pairwise-distinct" | "parallel" | "coincident";
  /** Reported for inspection. A zero value is not treated as a unique common point. */
  determinant?: number;
  commonPoint?: RenderPoint | null;
  foot?: RenderPoint;
  signedDistance?: number;
  form?: LineForm;
  conic?: ConicCoefficients;
  circleEquation?: { d: number; e: number; f: number };
}

export type AnalyticLineGeometry =
  | { kind: "point"; point: RenderPoint; analyticLine: AnalyticLineRecord }
  | { kind: "path"; points: RenderPoint[]; infinite?: true; directed?: true; analyticLine: AnalyticLineRecord }
  | { kind: "circle"; center: RenderPoint; radius: number; analyticLine: AnalyticLineRecord };

export interface AnalyticLineEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry(value: unknown): unknown;
}

type LineCoefficients = { a: number; b: number; c: number };
type ConicCoefficients = { a: number; b: number; c: number; d: number; e: number; f: number };
type SectionMode = "internal" | "external" | "midpoint";
type TranslationDirection = "toNew" | "toOld";
type LineForm = "general" | "pointSlope" | "twoPoint" | "intercept" | "normal";
type PairStatus = { kind: "point"; point: RenderPoint } | { kind: "parallel" } | { kind: "coincident" };

const TOPICS = {
  distance: "maths|10|cartesian-distance-section-and-locus",
  section: "maths|10|section-formula",
  translation: "maths|10|translation-of-axes",
  slope: "maths|10|slope-parallel-perpendicular-and-intercepts",
  intercepts: "maths|10|intercepts-of-a-line",
  equation: "maths|10|straight-line-equations",
  angle: "maths|10|line-intersection-angles-and-concurrence",
  concurrence: "maths|10|concurrence-of-three-lines",
  pointDistance: "maths|10|point-to-line-distance",
} as const;

const SHIFT_SCOPE = {
  jeeMain: "application",
  jeeAdvanced: "listed",
  neet: "not_applicable",
  shiftOfOrigin: true,
} as const;

const INPUT_KEYS: Readonly<Record<AnalyticLineOperator, readonly string[]>> = {
  coordinate_distance: ["a", "b", "displayLength"],
  section_point: ["a", "b", "mode", "m", "n"],
  axis_translation: ["h", "k", "direction", "target", "point", "line", "circle", "conic", "witness"],
  line_relation: ["mode", "line", "other", "p", "q", "r", "s", "displayLength"],
  line_intercepts: ["a", "b", "c", "displayLength"],
  line_equation: ["form", "a", "b", "c", "point", "slope", "p", "q", "xIntercept", "yIntercept", "normal", "displayLength"],
  line_intersection_angle: ["first", "second", "displayLength"],
  line_concurrence: ["first", "second", "third"],
  point_line_distance: ["point", "a", "b", "c", "displayLength"],
};

const MIN_LENGTH = 1e-6;
const MAX_LENGTH = 1e9;
const MAX_COORDINATE = 1e12;
const MAX_COEFFICIENT = 1e12;
const METRIC_TOLERANCE = 1e-8;
const DEFAULT_SPAN = 2;

class AnalyticLineInputError extends Error {
  constructor(readonly key: string, message: string) {
    super(message);
    this.name = "AnalyticLineInputError";
  }
}

class UnresolvedAnalyticLine extends Error {
  constructor() { super("analytic line source is not resolved"); }
}

function invalid(key: string, message: string): never {
  throw new AnalyticLineInputError(key, message);
}

export function isAnalyticLineOperator(operator: string): operator is AnalyticLineOperator {
  return (ANALYTIC_LINE_OPERATORS as readonly string[]).includes(operator);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(value: number, key: string, maximum = MAX_COORDINATE): number {
  if (!Number.isFinite(value) || Math.abs(value) > maximum) {
    invalid(key, `${key} must be finite with magnitude at most ${maximum}`);
  }
  return value;
}

function near(actual: number, expected: number, scale: number): boolean {
  return Math.abs(actual - expected) <= METRIC_TOLERANCE * Math.max(1, scale, Math.abs(expected), Math.abs(actual));
}

function readNumber(value: unknown, key: string, context: AnalyticLineEvaluationContext, maximum = MAX_COORDINATE, depth = 0): number {
  if (depth > 32) invalid(key, `${key} numeric nesting exceeds 32`);
  if (isRecord(value)) {
    const extra = Object.keys(value).filter((name) => name !== "value" && name !== "unit");
    if (extra.length > 0 || !("value" in value)) invalid(key, `${key} numeric wrapper only accepts value and unit`);
    if (typeof value.unit === "string" && /px|pixel|board/i.test(value.unit)) {
      invalid(key, "a board-pixel length cannot change a world-coordinate metric");
    }
    return readNumber(value.value, key, context, maximum, depth + 1);
  }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, `${key} must be a finite number`);
  try { return bounded(context.number(value), key, maximum); }
  catch (error) {
    if (error instanceof AnalyticLineInputError || error instanceof UnresolvedAnalyticLine) throw error;
    return invalid(key, `${key} must be a finite number`);
  }
}

function checkedPoint(value: { x: number; y: number }, key: string): RenderPoint {
  return { x: bounded(value.x, key), y: bounded(value.y, key) };
}

function readPoint(value: unknown, key: string, context: AnalyticLineEvaluationContext): RenderPoint {
  if (typeof value === "string") {
    if (!value.trim()) invalid(key, `${key} must reference a point`);
    let geometry: unknown;
    try { geometry = context.geometry(value); }
    catch (error) {
      if (error instanceof AnalyticLineInputError || error instanceof UnresolvedAnalyticLine) throw error;
      return invalid(key, `${key} must reference a constructed point`);
    }
    if (geometry !== undefined) {
      if (!isRecord(geometry) || geometry.kind !== "point" || !isRecord(geometry.point)) invalid(key, `${key} must reference a point`);
      const extra = Object.keys(geometry).filter((name) => !["kind", "point", "analyticLine"].includes(name));
      if (extra.length > 0) invalid(key, `${key} cannot discard protected geometry metadata`);
      const point = geometry.point;
      if (typeof point.x !== "number" || typeof point.y !== "number") invalid(key, `${key} must reference a finite point`);
      return checkedPoint({ x: point.x, y: point.y }, key);
    }
    try { return checkedPoint(context.point(value), key); }
    catch (error) {
      if (error instanceof AnalyticLineInputError || error instanceof UnresolvedAnalyticLine) throw error;
      return invalid(key, `${key} must resolve to a finite point`);
    }
  }
  if (Array.isArray(value)) {
    if (value.length !== 2) invalid(key, `${key} must be [x, y]`);
    return checkedPoint({ x: readNumber(value[0], key, context), y: readNumber(value[1], key, context) }, key);
  }
  if (isRecord(value)) {
    const extra = Object.keys(value).filter((name) => name !== "x" && name !== "y");
    if (extra.length > 0) invalid(key, `${key} point does not accept ${extra.join(", ")}`);
    return checkedPoint({ x: readNumber(value.x, key, context), y: readNumber(value.y, key, context) }, key);
  }
  return invalid(key, `${key} must be a finite point`);
}

function rejectUnknown(inputs: Record<string, unknown>, operator: AnalyticLineOperator): void {
  for (const key of Object.keys(inputs)) {
    if (!INPUT_KEYS[operator].includes(key)) invalid("input", `${operator} does not accept ${key}`);
  }
}

function has(inputs: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(inputs, key);
}

function assertKeys(inputs: Record<string, unknown>, required: readonly string[], optional: readonly string[], operator: string): void {
  for (const key of Object.keys(inputs)) {
    if (!required.includes(key) && !optional.includes(key)) invalid("input", `${operator} does not accept ${key}`);
  }
  for (const key of required) {
    if (!has(inputs, key)) invalid(key, `${operator} requires ${key}`);
  }
}

function readDisplayLength(inputs: Record<string, unknown>, context: AnalyticLineEvaluationContext): number | null {
  if (!has(inputs, "displayLength")) return null;
  const length = readNumber(inputs.displayLength, "displayLength", context, MAX_LENGTH);
  if (!(length > MIN_LENGTH) || length > MAX_LENGTH) invalid("displayLength", `displayLength must be greater than ${MIN_LENGTH} and no greater than ${MAX_LENGTH}`);
  return length;
}

function readCoefficient(value: unknown, key: string, context: AnalyticLineEvaluationContext): number {
  return readNumber(value, key, context, MAX_COEFFICIENT);
}

function lineScale(line: LineCoefficients): number {
  return Math.hypot(line.a, line.b);
}

function assertLine(line: LineCoefficients, key: string): LineCoefficients {
  const scale = lineScale(line);
  if (!(scale > 0) || !Number.isFinite(line.c) || !Number.isFinite(scale)) invalid(key, "a=b=0 is not a line");
  bounded(line.a, key, MAX_COEFFICIENT);
  bounded(line.b, key, MAX_COEFFICIENT);
  bounded(line.c, key, MAX_COEFFICIENT);
  return { a: line.a, b: line.b, c: line.c };
}

function readLine(value: unknown, key: string, context: AnalyticLineEvaluationContext): LineCoefficients {
  if (!isRecord(value)) invalid(key, `${key} must be a line {a, b, c}`);
  const extra = Object.keys(value).filter((name) => !["a", "b", "c"].includes(name));
  if (extra.length > 0) invalid(key, `${key} line does not accept ${extra.join(", ")}`);
  for (const name of ["a", "b", "c"]) if (!has(value, name)) invalid(key, `${key} line requires ${name}`);
  return assertLine({
    a: readCoefficient(value.a, key, context),
    b: readCoefficient(value.b, key, context),
    c: readCoefficient(value.c, key, context),
  }, key);
}

function readFlatLine(inputs: Record<string, unknown>, context: AnalyticLineEvaluationContext, key = "coefficients"): LineCoefficients {
  return assertLine({
    a: readCoefficient(inputs.a, key, context),
    b: readCoefficient(inputs.b, key, context),
    c: readCoefficient(inputs.c, key, context),
  }, key);
}

function directionOf(line: LineCoefficients): RenderPoint {
  return { x: -line.b, y: line.a };
}

function slopeOf(line: LineCoefficients): number | null {
  const scale = lineScale(line);
  if (Math.abs(line.b) <= METRIC_TOLERANCE * scale) return null;
  return -line.a / line.b;
}

function normalizeLine(line: LineCoefficients): LineCoefficients {
  const scale = lineScale(line);
  if (!(scale > 0)) invalid("coefficients", "a=b=0 is not a line");
  let a = line.a / scale;
  let b = line.b / scale;
  let c = line.c / scale;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) invalid("coefficients", "line normalization is not finite");
  if (a < 0 || (Math.abs(a) <= 1e-12 && b < 0)) {
    a = -a;
    b = -b;
    c = -c;
  }
  if (Math.abs(a) < 1e-12) a = 0;
  if (Math.abs(b) < 1e-12) b = 0;
  if (Math.abs(c) < 1e-12) c = 0;
  return { a, b, c };
}

function pointOnLine(line: LineCoefficients): RenderPoint {
  const scale = line.a * line.a + line.b * line.b;
  const point = checkedPoint({ x: -line.c * line.a / scale, y: -line.c * line.b / scale }, "geometry");
  if (lineResidual(line, point) > METRIC_TOLERANCE * Math.max(1, Math.hypot(point.x, point.y))) {
    invalid("geometry", "a point on the line could not be certified");
  }
  return point;
}

function lineResidual(line: LineCoefficients, point: RenderPoint): number {
  return Math.abs(exactBinary64LineResidual(line, point)) / lineScale(line);
}

function satisfiesLine(line: LineCoefficients, point: RenderPoint): boolean {
  const scale = Math.max(1, Math.hypot(point.x, point.y), Math.abs(line.c) / lineScale(line));
  return lineResidual(line, point) <= METRIC_TOLERANCE * scale;
}

function pointSeparation(a: RenderPoint, b: RenderPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointsIdentical(a: RenderPoint, b: RenderPoint): boolean {
  const scale = Math.max(1, Math.hypot(a.x, a.y), Math.hypot(b.x, b.y));
  const separation = pointSeparation(a, b);
  return separation <= MIN_LENGTH || separation <= 1e-9 * scale;
}

function quadrant(point: RenderPoint): string {
  if (point.x === 0 && point.y === 0) return "origin";
  if (point.x === 0) return "y-axis";
  if (point.y === 0) return "x-axis";
  if (point.x > 0 && point.y > 0) return "I";
  if (point.x < 0 && point.y > 0) return "II";
  if (point.x < 0 && point.y < 0) return "III";
  return "IV";
}

function axisClass(a: RenderPoint, b: RenderPoint): "horizontal" | "vertical" | "neither" | "coincident" {
  if (pointsIdentical(a, b)) return "coincident";
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const scale = Math.hypot(dx, dy);
  if (Math.abs(dy) <= METRIC_TOLERANCE * scale) return "horizontal";
  if (Math.abs(dx) <= METRIC_TOLERANCE * scale) return "vertical";
  return "neither";
}

function cross(a: RenderPoint, b: RenderPoint): number {
  return a.x * b.y - a.y * b.x;
}

function dot(a: RenderPoint, b: RenderPoint): number {
  return a.x * b.x + a.y * b.y;
}

function spanAround(anchor: RenderPoint, direction: RenderPoint, span: number): [RenderPoint, RenderPoint] {
  const length = Math.hypot(direction.x, direction.y);
  if (!(length > 0) || !(span > MIN_LENGTH)) invalid("geometry", "a line mark needs a nonzero direction and span");
  const ux = direction.x / length;
  const uy = direction.y / length;
  const first = checkedPoint({ x: anchor.x - ux * span / 2, y: anchor.y - uy * span / 2 }, "geometry");
  const second = checkedPoint({ x: anchor.x + ux * span / 2, y: anchor.y + uy * span / 2 }, "geometry");
  const drawn = pointSeparation(first, second);
  if (Math.abs(drawn - span) > span * METRIC_TOLERANCE) invalid("geometry", "drawn line span drifted from the requested world span");
  return [first, second];
}

function segmentToward(start: RenderPoint, toward: RenderPoint, length: number): [RenderPoint, RenderPoint] {
  const dx = toward.x - start.x;
  const dy = toward.y - start.y;
  const scale = Math.hypot(dx, dy);
  if (!(scale > 0) || !(length > MIN_LENGTH)) invalid("geometry", "segment direction is zero");
  const end = checkedPoint({ x: start.x + dx / scale * length, y: start.y + dy / scale * length }, "geometry");
  const drawn = pointSeparation(start, end);
  if (Math.abs(drawn - length) > length * METRIC_TOLERANCE) invalid("geometry", "drawn segment length drifted");
  return [start, end];
}

function linePath(line: LineCoefficients, displayLength: number | null, analyticLine: AnalyticLineRecord): AnalyticLineGeometry {
  const [first, second] = spanAround(pointOnLine(line), directionOf(line), displayLength ?? DEFAULT_SPAN);
  for (const point of [first, second]) {
    if (!satisfiesLine(line, point)) invalid("geometry", "drawn line left the certified equation");
  }
  return { kind: "path", points: [first, second], infinite: true, analyticLine };
}

function emitPoint(point: RenderPoint, analyticLine: AnalyticLineRecord): AnalyticLineGeometry {
  return { kind: "point", point: checkedPoint(point, "geometry"), analyticLine };
}

function worldDistance(a: RenderPoint, b: RenderPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const hypot = Math.hypot(dx, dy);
  const radical = Math.sqrt(dx * dx + dy * dy);
  if (!near(hypot, radical, hypot)) invalid("geometry", "distance radicals disagree");
  return hypot;
}

function coordinateDistance(inputs: Record<string, unknown>, context: AnalyticLineEvaluationContext): AnalyticLineGeometry[] {
  assertKeys(inputs, ["a", "b"], ["displayLength"], "coordinate_distance");
  const a = readPoint(inputs.a, "a", context);
  const b = readPoint(inputs.b, "b", context);
  const displayLength = readDisplayLength(inputs, context);
  const distance = worldDistance(a, b);
  const analyticLine: AnalyticLineRecord = {
    topic: TOPICS.distance,
    worldUnits: true,
    displayLength,
    distance: pointsIdentical(a, b) && distance === 0 ? 0 : distance,
    coincidentPoints: pointsIdentical(a, b),
    axisAligned: axisClass(a, b),
    quadrants: [quadrant(a), quadrant(b)],
  };
  if (pointsIdentical(a, b)) {
    if (displayLength !== null) invalid("displayLength", "coincident points have no direction for a display segment");
    analyticLine.distance = distance === 0 ? 0 : distance;
    return [emitPoint(a, analyticLine)];
  }
  const points = displayLength === null
    ? [a, b]
    : segmentToward(a, b, displayLength);
  if (displayLength === null && !near(pointSeparation(points[0]!, points[1]!), distance, distance)) {
    invalid("geometry", "segment length drifted from the world distance");
  }
  return [{ kind: "path", points, directed: true, analyticLine }];
}

function ratioDenom(m: number, n: number, mode: "internal" | "external"): number {
  const scale = Math.max(Math.abs(m), Math.abs(n));
  const denominator = mode === "external" ? m - n : m + n;
  if (m === 0 && n === 0) invalid("ratio", "0:0 is an undefined ratio and cannot define a finite section point");
  if (denominator === 0) {
    invalid("ratio", `${mode} division has an exact zero denominator; no finite point exists, and distinct endpoints give a point at infinity`);
  }
  if (Math.abs(denominator) <= METRIC_TOLERANCE * scale) {
    invalid("ratio", `finite ${mode} division has an ill-conditioned nonzero denominator and cannot be certified`);
  }
  return denominator;
}

function sectionPoint(inputs: Record<string, unknown>, context: AnalyticLineEvaluationContext): AnalyticLineGeometry[] {
  const mode = inputs.mode;
  if (mode !== "internal" && mode !== "external" && mode !== "midpoint") invalid("mode", "section mode must be internal, external, or midpoint");
  if (mode === "midpoint") assertKeys(inputs, ["a", "b", "mode"], [], "section_point");
  else assertKeys(inputs, ["a", "b", "mode", "m", "n"], [], "section_point");
  const a = readPoint(inputs.a, "a", context);
  const b = readPoint(inputs.b, "b", context);
  const m = mode === "midpoint" ? 1 : readCoefficient(inputs.m, "m", context);
  const n = mode === "midpoint" ? 1 : readCoefficient(inputs.n, "n", context);
  const denominator = mode === "external" ? ratioDenom(m, n, "external") : ratioDenom(m, n, "internal");
  const parameter = m / denominator;
  const aNumeratorWeight = mode === "external" ? -n : n;
  const point = checkedPoint({
    // Form the weighted numerator exactly before dividing. Dividing each
    // weight first creates a nonzero rounding residue at a true zero point.
    x: exactBinary64LineResidual({a:aNumeratorWeight,b:m,c:0},{x:a.x,y:b.x}) / denominator,
    y: exactBinary64LineResidual({a:aNumeratorWeight,b:m,c:0},{x:a.y,y:b.y}) / denominator,
  }, "geometry");
  const reconstructed = checkedPoint({
    x: a.x + parameter * (b.x - a.x),
    y: a.y + parameter * (b.y - a.y),
  }, "geometry");
  if (!near(point.x, reconstructed.x, Math.hypot(point.x, reconstructed.x)) || !near(point.y, reconstructed.y, Math.hypot(point.y, reconstructed.y))) {
    invalid("geometry", "section point failed its parameter reconstruction");
  }
  if (pointsIdentical(a, b)) {
    if (!pointsIdentical(point, a)) invalid("geometry", "section of coincident points must stay on that point");
  } else {
    const spread = pointSeparation(a, b);
    const area = Math.abs(cross({ x: point.x - a.x, y: point.y - a.y }, { x: b.x - a.x, y: b.y - a.y }));
    if (area > METRIC_TOLERANCE * spread * Math.max(spread, pointSeparation(point, a), 1)) {
      invalid("geometry", "section point is not collinear with the endpoints");
    }
  }
  if (mode === "midpoint") {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!near(point.x, mid.x, Math.abs(mid.x)) || !near(point.y, mid.y, Math.abs(mid.y))) invalid("geometry", "midpoint disagrees with the internal 1:1 section");
  }
  return [emitPoint(point, {
    topic: TOPICS.section,
    worldUnits: true,
    coincidentPoints: a.x === b.x && a.y === b.y,
    section: { mode, m, n, parameter },
  })];
}

function shiftPoint(point: RenderPoint, h: number, k: number, direction: TranslationDirection): RenderPoint {
  return direction === "toNew"
    ? checkedPoint({ x: point.x - h, y: point.y - k }, "geometry")
    : checkedPoint({ x: point.x + h, y: point.y + k }, "geometry");
}

function shiftLine(line: LineCoefficients, h: number, k: number, direction: TranslationDirection): LineCoefficients {
  const delta = line.a * h + line.b * k;
  return assertLine({ a: line.a, b: line.b, c: direction === "toNew" ? line.c + delta : line.c - delta }, "line");
}

function shiftConic(conic: ConicCoefficients, h: number, k: number, direction: TranslationDirection): ConicCoefficients {
  const hh = direction === "toNew" ? h : -h;
  const kk = direction === "toNew" ? k : -k;
  const next = {
    a: conic.a,
    b: conic.b,
    c: conic.c,
    d: 2 * conic.a * hh + conic.b * kk + conic.d,
    e: conic.b * hh + 2 * conic.c * kk + conic.e,
    f: conic.a * hh * hh + conic.b * hh * kk + conic.c * kk * kk + conic.d * hh + conic.e * kk + conic.f,
  };
  for (const [name, value] of Object.entries(next)) bounded(value, name, MAX_COEFFICIENT);
  return next;
}

function conicValue(conic: ConicCoefficients, point: RenderPoint): number {
  return conic.a * point.x * point.x + conic.b * point.x * point.y + conic.c * point.y * point.y + conic.d * point.x + conic.e * point.y + conic.f;
}

function conicScale(conic: ConicCoefficients, point: RenderPoint): number {
  return Math.max(
    1,
    Math.abs(conic.a * point.x * point.x),
    Math.abs(conic.b * point.x * point.y),
    Math.abs(conic.c * point.y * point.y),
    Math.abs(conic.d * point.x),
    Math.abs(conic.e * point.y),
    Math.abs(conic.f),
  );
}

function readConic(value: unknown, context: AnalyticLineEvaluationContext): ConicCoefficients {
  if (!isRecord(value)) invalid("conic", "conic must be {a, b, c, d, e, f}");
  const names = ["a", "b", "c", "d", "e", "f"] as const;
  const extra = Object.keys(value).filter((name) => !(names as readonly string[]).includes(name));
  if (extra.length > 0) invalid("conic", `conic does not accept ${extra.join(", ")}`);
  const conic = {} as ConicCoefficients;
  for (const name of names) {
    if (!has(value, name)) invalid("conic", `conic requires ${name}`);
    conic[name] = readCoefficient(value[name], "conic", context);
  }
  if (conic.a === 0 && conic.b === 0 && conic.c === 0) invalid("conic", "a conic target requires a quadratic term; use target line for ax+by+c=0");
  return conic;
}

function circleFromCenter(center: RenderPoint, radius: number): { d: number; e: number; f: number } {
  return { d: -2 * center.x, e: -2 * center.y, f: center.x * center.x + center.y * center.y - radius * radius };
}

function readCircle(value: unknown, context: AnalyticLineEvaluationContext): { center: RenderPoint; radius: number; equation: { d: number; e: number; f: number } } {
  if (!isRecord(value)) invalid("circle", "circle must be {center, radius} or {d, e, f}");
  const keys = Object.keys(value);
  const centerForm = keys.length === 2 && keys.includes("center") && keys.includes("radius");
  const equationForm = keys.length === 3 && keys.every((key) => key === "d" || key === "e" || key === "f");
  if (centerForm) {
    const center = readPoint(value.center, "circle", context);
    const radius = readNumber(value.radius, "circle", context, MAX_LENGTH);
    if (!(radius > MIN_LENGTH) || radius > MAX_LENGTH) invalid("circle", "circle radius must be positive and finite");
    return { center, radius, equation: circleFromCenter(center, radius) };
  }
  if (equationForm) {
    const d = readCoefficient(value.d, "circle", context);
    const e = readCoefficient(value.e, "circle", context);
    const f = readCoefficient(value.f, "circle", context);
    const center = checkedPoint({ x: -d / 2, y: -e / 2 }, "circle");
    const radiusSquared = center.x * center.x + center.y * center.y - f;
    if (!(radiusSquared > 0)) invalid("circle", "circle equation has no positive finite radius");
    const radius = Math.sqrt(radiusSquared);
    if (!(radius > MIN_LENGTH) || radius > MAX_LENGTH) invalid("circle", "circle radius must be positive and finite");
    return { center, radius, equation: { d, e, f } };
  }
  return invalid("circle", "circle must be {center, radius} or {d, e, f}");
}

function translationRecord(h: number, k: number, direction: TranslationDirection): AnalyticLineRecord["translation"] {
  return { h, k, direction, linear: [1, 0, 0, 1], examScope: SHIFT_SCOPE };
}

function axisTranslation(inputs: Record<string, unknown>, context: AnalyticLineEvaluationContext): AnalyticLineGeometry[] {
  assertKeys(inputs, ["h", "k", "direction", "target"], ["point", "line", "circle", "conic", "witness"], "axis_translation");
  const direction = inputs.direction;
  if (direction !== "toNew" && direction !== "toOld") invalid("direction", "translation direction must be toNew or toOld");
  const target = inputs.target;
  if (target !== "point" && target !== "line" && target !== "circle" && target !== "conic") {
    invalid("target", "translation target must be point, line, circle, or conic");
  }
  const h = readCoefficient(inputs.h, "h", context);
  const k = readCoefficient(inputs.k, "k", context);
  const translation = translationRecord(h, k, direction);
  const base = { topic: TOPICS.translation, worldUnits: true as const, translation };
  if (target === "point") {
    if (has(inputs, "line") || has(inputs, "circle") || has(inputs, "conic") || has(inputs, "witness")) {
      invalid("input", "point translation accepts only the point");
    }
    if (!has(inputs, "point")) invalid("point", "point translation requires point");
    const source = readPoint(inputs.point, "point", context);
    const image = shiftPoint(source, h, k, direction);
    const roundTrip = shiftPoint(image, h, k, direction === "toNew" ? "toOld" : "toNew");
    if (!near(roundTrip.x, source.x, Math.abs(source.x)) || !near(roundTrip.y, source.y, Math.abs(source.y))) {
      invalid("geometry", "reverse translation did not recover the source point");
    }
    return [emitPoint(image, base)];
  }
  if (target === "line") {
    if (has(inputs, "point") || has(inputs, "circle") || has(inputs, "conic") || has(inputs, "witness")) {
      invalid("input", "line translation accepts only the line");
    }
    if (!has(inputs, "line")) invalid("line", "line translation requires line");
    const source = readLine(inputs.line, "line", context);
    const image = shiftLine(source, h, k, direction);
    const witness = pointOnLine(source);
    const moved = shiftPoint(witness, h, k, direction);
    if (!satisfiesLine(image, moved)) invalid("geometry", "translated line failed incidence of a shifted point");
    const roundTrip = shiftLine(image, h, k, direction === "toNew" ? "toOld" : "toNew");
    const back = normalizeLine(roundTrip);
    const original = normalizeLine(source);
    if (!near(back.a, original.a, 1) || !near(back.b, original.b, 1) || !near(back.c, original.c, 1)) {
      invalid("geometry", "reverse translation did not recover the source line");
    }
    return [linePath(image, null, { ...base, coefficients: image, normalized: normalizeLine(image), slope: slopeOf(image), slopeDefined: slopeOf(image) !== null, direction: directionOf(image) })];
  }
  if (target === "circle") {
    if (has(inputs, "point") || has(inputs, "line") || has(inputs, "conic") || has(inputs, "witness")) {
      invalid("input", "circle translation accepts only the circle");
    }
    if (!has(inputs, "circle")) invalid("circle", "circle translation requires circle");
    const source = readCircle(inputs.circle, context);
    const center = shiftPoint(source.center, h, k, direction);
    const fromCenter = circleFromCenter(center, source.radius);
    const fromSubstitution = shiftConic({ a: 1, b: 0, c: 1, d: source.equation.d, e: source.equation.e, f: source.equation.f }, h, k, direction);
    if (Math.abs(fromSubstitution.a - 1) > METRIC_TOLERANCE || Math.abs(fromSubstitution.b) > METRIC_TOLERANCE || Math.abs(fromSubstitution.c - 1) > METRIC_TOLERANCE) {
      invalid("geometry", "translation changed the circle quadratic part");
    }
    if (!near(fromCenter.d, fromSubstitution.d, 1) || !near(fromCenter.e, fromSubstitution.e, 1) || !near(fromCenter.f, fromSubstitution.f, 1)) {
      invalid("geometry", "center translation and equation substitution disagree");
    }
    const rim = shiftPoint({ x: source.center.x + source.radius, y: source.center.y }, h, k, direction);
    if (!near(pointSeparation(rim, center), source.radius, source.radius)) invalid("geometry", "translation changed the circle radius");
    return [{
      kind: "circle",
      center,
      radius: source.radius,
      analyticLine: { ...base, circleEquation: fromCenter, distance: source.radius },
    }];
  }
  if (has(inputs, "point") || has(inputs, "line") || has(inputs, "circle")) invalid("input", "conic translation accepts conic and witness");
  if (!has(inputs, "conic") || !has(inputs, "witness")) invalid("witness", "conic translation requires conic and witness");
  const source = readConic(inputs.conic, context);
  const witness = readPoint(inputs.witness, "witness", context);
  if (Math.abs(conicValue(source, witness)) > METRIC_TOLERANCE * conicScale(source, witness)) {
    invalid("witness", "witness must lie on the source conic");
  }
  const image = shiftConic(source, h, k, direction);
  const moved = shiftPoint(witness, h, k, direction);
  if (Math.abs(conicValue(image, moved)) > METRIC_TOLERANCE * conicScale(image, moved)) {
    invalid("geometry", "translated witness left the translated conic");
  }
  return [emitPoint(moved, { ...base, conic: image })];
}

function lineFromPoints(p: RenderPoint, q: RenderPoint): LineCoefficients {
  if (pointsIdentical(p, q)) invalid("q", "coincident points do not determine a direction");
  const a = q.y - p.y;
  const b = p.x - q.x;
  const c = -a * p.x - b * p.y;
  const line = assertLine({ a, b, c }, "q");
  if (!satisfiesLine(line, p) || !satisfiesLine(line, q)) invalid("geometry", "two-point line missed an endpoint");
  return line;
}

function relationsOf(first: RenderPoint, second: RenderPoint): { parallel: boolean; perpendicular: boolean; sameSense: boolean; angleRadians: number } {
  const firstLength = Math.hypot(first.x, first.y);
  const secondLength = Math.hypot(second.x, second.y);
  if (!(firstLength > 0) || !(secondLength > 0)) invalid("coefficients", "zero direction");
  const crossAbs = Math.abs(cross(first, second));
  const dotAbs = Math.abs(dot(first, second));
  const scale = firstLength * secondLength;
  const angleRadians = Math.atan2(crossAbs, dotAbs);
  if (!(angleRadians >= 0) || angleRadians > Math.PI / 2 + 1e-12) invalid("geometry", "acute angle left [0, pi/2]");
  return {
    parallel: crossAbs <= METRIC_TOLERANCE * scale,
    perpendicular: dotAbs <= METRIC_TOLERANCE * scale,
    sameSense: dot(first, second) > 0,
    angleRadians,
  };
}

function lineRelation(inputs: Record<string, unknown>, context: AnalyticLineEvaluationContext): AnalyticLineGeometry[] {
  rejectUnknown(inputs, "line_relation");
  const mode = inputs.mode;
  if (mode !== "slope" && mode !== "relations") invalid("mode", "line relation mode must be slope or relations");
  const displayLength = readDisplayLength(inputs, context);
  if (mode === "slope") {
    if (has(inputs, "other") || has(inputs, "r") || has(inputs, "s")) invalid("input", "slope mode does not accept a second line");
    const fromLine = has(inputs, "line");
    const fromPoints = has(inputs, "p") || has(inputs, "q");
    if (fromLine === fromPoints) invalid("input", "slope mode requires a line or two points");
    if (fromPoints && (!has(inputs, "p") || !has(inputs, "q"))) invalid("q", "slope from points requires both p and q");
    const line = fromLine
      ? readLine(inputs.line, "line", context)
      : lineFromPoints(readPoint(inputs.p, "p", context), readPoint(inputs.q, "q", context));
    const slope = slopeOf(line);
    const direction = fromLine ? directionOf(line) : {
      x: readPoint(inputs.q, "q", context).x - readPoint(inputs.p, "p", context).x,
      y: readPoint(inputs.q, "q", context).y - readPoint(inputs.p, "p", context).y,
    };
    const analyticLine: AnalyticLineRecord = {
      topic: TOPICS.slope,
      worldUnits: true,
      displayLength,
      coefficients: line,
      normalized: normalizeLine(line),
      slope,
      slopeDefined: slope !== null,
      direction,
    };
    if (slope !== null && !Number.isFinite(slope)) invalid("slope", "vertical lines never acquire a finite slope");
    if (!fromLine && displayLength === null) {
      const p = readPoint(inputs.p, "p", context);
      const q = readPoint(inputs.q, "q", context);
      return [{ kind: "path", points: [p, q], directed: true, analyticLine }];
    }
    return [linePath(line, displayLength, analyticLine)];
  }
  const coefficientPair = has(inputs, "line") || has(inputs, "other");
  const pointPair = has(inputs, "p") || has(inputs, "q") || has(inputs, "r") || has(inputs, "s");
  if (coefficientPair === pointPair) invalid("input", "relations mode requires two lines or two point-pairs");
  let firstLine: LineCoefficients;
  let secondLine: LineCoefficients;
  let firstDirection: RenderPoint;
  let secondDirection: RenderPoint;
  let finiteSegment: [RenderPoint, RenderPoint] | null = null;
  if (coefficientPair) {
    if (!has(inputs, "line") || !has(inputs, "other")) invalid("other", "relations mode requires line and other");
    firstLine = readLine(inputs.line, "line", context);
    secondLine = readLine(inputs.other, "other", context);
    firstDirection = directionOf(firstLine);
    secondDirection = directionOf(secondLine);
  } else {
    if (!has(inputs, "p") || !has(inputs, "q") || !has(inputs, "r") || !has(inputs, "s")) invalid("s", "point relations require p, q, r, and s");
    const p = readPoint(inputs.p, "p", context);
    const q = readPoint(inputs.q, "q", context);
    const r = readPoint(inputs.r, "r", context);
    const s = readPoint(inputs.s, "s", context);
    firstLine = lineFromPoints(p, q);
    secondLine = lineFromPoints(r, s);
    firstDirection = { x: q.x - p.x, y: q.y - p.y };
    secondDirection = { x: s.x - r.x, y: s.y - r.y };
    finiteSegment = displayLength === null ? [p, q] : segmentToward(p, q, displayLength);
  }
  const relation = relationsOf(firstDirection, secondDirection);
  const coincidentLines = relation.parallel && satisfiesLine(secondLine, pointOnLine(firstLine));
  const analyticLine: AnalyticLineRecord = {
    topic: TOPICS.slope,
    worldUnits: true,
    displayLength,
    coefficients: firstLine,
    normalized: normalizeLine(firstLine),
    slope: slopeOf(firstLine),
    slopeDefined: slopeOf(firstLine) !== null,
    direction: firstDirection,
    otherDirection: secondDirection,
    parallel: relation.parallel,
    perpendicular: relation.perpendicular,
    coincidentLines,
    sameSense: relation.sameSense,
    angleRadians: relation.parallel ? 0 : relation.angleRadians,
    angleConvention: "acute",
  };
  if (analyticLine.slope !== null && !Number.isFinite(analyticLine.slope)) invalid("slope", "vertical lines never acquire a finite slope");
  if (finiteSegment && displayLength === null) {
    return [{ kind: "path", points: finiteSegment, directed: true, analyticLine }];
  }
  if (finiteSegment && displayLength !== null) {
    return [{ kind: "path", points: finiteSegment, directed: true, analyticLine }];
  }
  return [linePath(firstLine, displayLength, analyticLine)];
}

function interceptRecord(line: LineCoefficients): Pick<AnalyticLineRecord, "xIntercept" | "yIntercept" | "xAxisCoincident" | "yAxisCoincident" | "throughOrigin" | "coefficients" | "normalized" | "slope" | "slopeDefined"> {
  const xAxisCoincident = line.a === 0 && line.c === 0;
  const yAxisCoincident = line.b === 0 && line.c === 0;
  let xIntercept: RenderPoint | null;
  if (line.a !== 0) xIntercept = checkedPoint({ x: -line.c / line.a, y: 0 }, "geometry");
  else xIntercept = null;
  let yIntercept: RenderPoint | null;
  if (line.b !== 0) yIntercept = checkedPoint({ x: 0, y: -line.c / line.b }, "geometry");
  else yIntercept = null;
  if (xIntercept && !satisfiesLine(line, xIntercept)) invalid("geometry", "x-intercept missed the line");
  if (yIntercept && !satisfiesLine(line, yIntercept)) invalid("geometry", "y-intercept missed the line");
  if (xIntercept === null && line.a !== 0) invalid("geometry", "a nonzero a must not drop a finite x-intercept");
  if (yIntercept === null && line.b !== 0) invalid("geometry", "a nonzero b must not drop a finite y-intercept");
  return {
    coefficients: line,
    normalized: normalizeLine(line),
    slope: slopeOf(line),
    slopeDefined: slopeOf(line) !== null,
    xIntercept,
    yIntercept,
    xAxisCoincident,
    yAxisCoincident,
    throughOrigin: line.c === 0,
  };
}

function lineIntercepts(inputs: Record<string, unknown>, context: AnalyticLineEvaluationContext): AnalyticLineGeometry[] {
  assertKeys(inputs, ["a", "b", "c"], ["displayLength"], "line_intercepts");
  const line = readFlatLine(inputs, context);
  const displayLength = readDisplayLength(inputs, context);
  const intercepts = interceptRecord(line);
  const analyticLine: AnalyticLineRecord = { topic: TOPICS.intercepts, worldUnits: true, displayLength, ...intercepts };
  if (displayLength === null && intercepts.xIntercept && intercepts.yIntercept && !pointsIdentical(intercepts.xIntercept, intercepts.yIntercept)) {
    return [{ kind: "path", points: [intercepts.xIntercept, intercepts.yIntercept], infinite: true, directed: true, analyticLine }];
  }
  return [linePath(line, displayLength, analyticLine)];
}

function lineEquation(inputs: Record<string, unknown>, context: AnalyticLineEvaluationContext): AnalyticLineGeometry[] {
  rejectUnknown(inputs, "line_equation");
  const form = inputs.form;
  if (form !== "general" && form !== "pointSlope" && form !== "twoPoint" && form !== "intercept" && form !== "normal") {
    invalid("form", "line form must be general, pointSlope, twoPoint, intercept, or normal");
  }
  const displayLength = readDisplayLength(inputs, context);
  let line: LineCoefficients;
  if (form === "general") {
    assertKeys(inputs, ["form", "a", "b", "c"], ["displayLength"], "line_equation");
    line = readFlatLine(inputs, context);
  } else if (form === "pointSlope") {
    assertKeys(inputs, ["form", "point", "slope"], ["displayLength"], "line_equation");
    const point = readPoint(inputs.point, "point", context);
    if (inputs.slope === null) line = assertLine({ a: 1, b: 0, c: -point.x }, "slope");
    else {
      const slope = readCoefficient(inputs.slope, "slope", context);
      line = assertLine({ a: slope, b: -1, c: -slope * point.x + point.y }, "slope");
    }
    if (!satisfiesLine(line, point)) invalid("geometry", "point-slope line missed its point");
  } else if (form === "twoPoint") {
    assertKeys(inputs, ["form", "p", "q"], ["displayLength"], "line_equation");
    const p = readPoint(inputs.p, "p", context);
    const q = readPoint(inputs.q, "q", context);
    if (pointsIdentical(p, q)) invalid("q", "identical two-point inputs do not determine a line");
    line = lineFromPoints(p, q);
  } else if (form === "intercept") {
    assertKeys(inputs, ["form", "xIntercept", "yIntercept"], ["displayLength"], "line_equation");
    const xIntercept = readCoefficient(inputs.xIntercept, "xIntercept", context);
    const yIntercept = readCoefficient(inputs.yIntercept, "yIntercept", context);
    if (xIntercept === 0 || yIntercept === 0) invalid("xIntercept", "intercept form cannot divide by a zero intercept");
    line = assertLine({ a: yIntercept, b: xIntercept, c: -xIntercept * yIntercept }, "xIntercept");
  } else {
    assertKeys(inputs, ["form", "normal"], ["displayLength"], "line_equation");
    if (!isRecord(inputs.normal)) invalid("normal", "normal form requires {alpha, p}");
    const extra = Object.keys(inputs.normal).filter((key) => key !== "alpha" && key !== "p");
    if (extra.length > 0 || !has(inputs.normal, "alpha") || !has(inputs.normal, "p")) invalid("normal", "normal form accepts only alpha and signed p");
    const alpha = readCoefficient(inputs.normal.alpha, "normal", context);
    const signed = readCoefficient(inputs.normal.p, "normal", context);
    const a = Math.cos(alpha);
    const b = Math.sin(alpha);
    if (!(Math.hypot(a, b) > 0)) invalid("normal", "zero normal");
    line = assertLine({ a, b, c: -signed }, "normal");
  }
  const slope = slopeOf(line);
  if (slope !== null && !Number.isFinite(slope)) invalid("slope", "vertical lines never acquire a finite slope");
  return [linePath(line, displayLength, {
    topic: TOPICS.equation,
    worldUnits: true,
    displayLength,
    form,
    coefficients: line,
    normalized: normalizeLine(line),
    slope,
    slopeDefined: slope !== null,
    direction: directionOf(line),
  })];
}

function solvePair(first: LineCoefficients, second: LineCoefficients): PairStatus {
  const det = first.a * second.b - first.b * second.a;
  const scale = lineScale(first) * lineScale(second);
  if (Math.abs(det) <= METRIC_TOLERANCE * scale) {
    return satisfiesLine(second, pointOnLine(first)) ? { kind: "coincident" } : { kind: "parallel" };
  }
  const x = (-first.c * second.b + first.b * second.c) / det;
  const y = (-first.a * second.c + first.c * second.a) / det;
  const point = checkedPoint({ x, y }, "geometry");
  if (!satisfiesLine(first, point) || !satisfiesLine(second, point)) invalid("geometry", "intersection failed line incidence");
  return { kind: "point", point };
}

function coefficientDeterminant(lines: readonly [LineCoefficients, LineCoefficients, LineCoefficients]): number {
  const [first, second, third] = lines;
  return first.a * (second.b * third.c - third.b * second.c)
    - first.b * (second.a * third.c - third.a * second.c)
    + first.c * (second.a * third.b - third.a * second.b);
}

function lineIntersectionAngle(inputs: Record<string, unknown>, context: AnalyticLineEvaluationContext): AnalyticLineGeometry[] {
  assertKeys(inputs, ["first", "second"], ["displayLength"], "line_intersection_angle");
  const displayLength = readDisplayLength(inputs, context);
  const first = readLine(inputs.first, "first", context);
  const second = readLine(inputs.second, "second", context);
  const firstDirection = directionOf(first);
  const secondDirection = directionOf(second);
  if (!(Math.hypot(firstDirection.x, firstDirection.y) > 0) || !(Math.hypot(secondDirection.x, secondDirection.y) > 0)) {
    invalid("coefficients", "zero direction");
  }
  const relation = relationsOf(firstDirection, secondDirection);
  const solved = solvePair(first, second);
  const coincident = solved.kind === "coincident";
  const parallel = solved.kind === "parallel" || coincident;
  const angleRadians = parallel ? 0 : relation.angleRadians;
  const analyticLine: AnalyticLineRecord = {
    topic: TOPICS.angle,
    worldUnits: true,
    displayLength,
    direction: firstDirection,
    otherDirection: secondDirection,
    angleRadians,
    angleConvention: "acute",
    relation: coincident ? "coincident" : parallel ? "parallel" : "intersecting",
    intersection: solved.kind === "point" ? solved.point : null,
    parallel,
    coincidentLines: coincident,
    coefficients: first,
    normalized: normalizeLine(first),
  };
  if (solved.kind === "point") return [emitPoint(solved.point, analyticLine)];
  return [linePath(first, displayLength, analyticLine)];
}

function concurrenceReason(lines: readonly [LineCoefficients, LineCoefficients, LineCoefficients]): "pairwise-distinct" | "parallel" | "coincident" {
  const pairs: Array<[LineCoefficients, LineCoefficients]> = [[lines[0], lines[1]], [lines[0], lines[2]], [lines[1], lines[2]]];
  const solved = pairs.map(([left, right]) => solvePair(left, right));
  if (solved.every((status) => status.kind === "coincident")) return "coincident";
  if (solved.some((status) => status.kind === "parallel")) return "parallel";
  if (solved.some((status) => status.kind === "coincident")) return "parallel";
  return "pairwise-distinct";
}

function lineConcurrence(inputs: Record<string, unknown>, context: AnalyticLineEvaluationContext): AnalyticLineGeometry[] {
  assertKeys(inputs, ["first", "second", "third"], [], "line_concurrence");
  const lines = [
    readLine(inputs.first, "first", context),
    readLine(inputs.second, "second", context),
    readLine(inputs.third, "third", context),
  ] as [LineCoefficients, LineCoefficients, LineCoefficients];
  const determinant = coefficientDeterminant(lines);
  const pair = solvePair(lines[0], lines[1]);
  let common: RenderPoint | null = null;
  if (pair.kind === "point") {
    if (satisfiesLine(lines[2], pair.point)) common = pair.point;
  } else if (pair.kind === "coincident") {
    const withThird = solvePair(lines[0], lines[2]);
    if (withThird.kind === "point" && satisfiesLine(lines[1], withThird.point)) common = withThird.point;
  }
  if (common) {
    for (const line of lines) {
      if (!satisfiesLine(line, common)) invalid("geometry", "refusing a common point that misses a line");
    }
    return [emitPoint(common, {
      topic: TOPICS.concurrence,
      worldUnits: true,
      concurrent: true,
      concurrenceReason: "unique",
      determinant,
      commonPoint: common,
      intersection: common,
    })];
  }
  return [linePath(lines[0], null, {
    topic: TOPICS.concurrence,
    worldUnits: true,
    concurrent: false,
    concurrenceReason: concurrenceReason(lines),
    determinant,
    commonPoint: null,
    intersection: null,
    coefficients: lines[0],
    normalized: normalizeLine(lines[0]),
  })];
}

/** One incidence decision for source programs, distance operators and foot validation. */
export function certifiedPointLineProjection(point: RenderPoint, line: LineCoefficients): { signedDistance: number; distance: number; foot: RenderPoint } {
  const scale = lineScale(line);
  if (!(scale > 0) || !Number.isFinite(scale)) invalid("geometry", "invalid projection normal");
  const residual = exactBinary64LineResidual(line, point);
  if (residual === 0) return { signedDistance: 0, distance: 0, foot: { ...point } };
  const signedDistance = residual / scale, distance = Math.abs(signedDistance);
  if (!(distance > MIN_LENGTH) || !Number.isFinite(distance)) invalid("geometry", "nonzero source distance is below supported geometry precision");
  const foot = checkedPoint({ x: point.x - signedDistance * line.a / scale, y: point.y - signedDistance * line.b / scale }, "geometry");
  const step = { x: point.x - foot.x, y: point.y - foot.y };
  const tolerance = METRIC_TOLERANCE * distance;
  if (Math.abs(Math.hypot(step.x, step.y) - distance) > tolerance
    || lineResidual(line, foot) > tolerance
    || Math.abs(dot(step, directionOf(line))) > tolerance * scale) invalid("geometry", "projection foot exceeds supported geometry precision");
  return { signedDistance, distance, foot };
}

function pointLineDistance(inputs: Record<string, unknown>, context: AnalyticLineEvaluationContext): AnalyticLineGeometry[] {
  assertKeys(inputs, ["point", "a", "b", "c"], ["displayLength"], "point_line_distance");
  const point = readPoint(inputs.point, "point", context);
  const line = readFlatLine(inputs, context);
  const displayLength = readDisplayLength(inputs, context);
  const { signedDistance, distance: formula, foot } = certifiedPointLineProjection(point, line);
  const direction = directionOf(line);
  const onLine = formula === 0;
  const analyticLine: AnalyticLineRecord = {
    topic: TOPICS.pointDistance,
    worldUnits: true,
    displayLength,
    distance: onLine ? 0 : formula,
    signedDistance: onLine ? 0 : signedDistance,
    foot: onLine ? point : foot,
    coefficients: line,
    normalized: normalizeLine(line),
    direction,
  };
  if (onLine) {
    if (displayLength !== null) invalid("displayLength", "a point on the line has no foot segment to rescale");
    return [emitPoint(point, analyticLine)];
  }
  const drawn = displayLength === null ? formula : displayLength;
  if (!(drawn > MIN_LENGTH)) invalid("geometry", "foot segment is below drawable resolution");
  const [start, end] = segmentToward(point, foot, drawn);
  return [{ kind: "path", points: [start, end], directed: true, analyticLine }];
}

/** World-coordinate line constructions. A display length changes only the drawn segment. */
export function evaluateAnalyticLineConstruction(
  operator: string,
  inputs: Record<string, unknown>,
  context: AnalyticLineEvaluationContext,
): AnalyticLineGeometry[] {
  if (!isAnalyticLineOperator(operator)) invalid("operator", `unsupported analytic line operator ${operator}`);
  if (!isRecord(inputs)) invalid("inputs", `${operator} inputs must be an object`);
  rejectUnknown(inputs, operator);
  if (operator === "coordinate_distance") return coordinateDistance(inputs, context);
  if (operator === "section_point") return sectionPoint(inputs, context);
  if (operator === "axis_translation") return axisTranslation(inputs, context);
  if (operator === "line_relation") return lineRelation(inputs, context);
  if (operator === "line_intercepts") return lineIntercepts(inputs, context);
  if (operator === "line_equation") return lineEquation(inputs, context);
  if (operator === "line_intersection_angle") return lineIntersectionAngle(inputs, context);
  if (operator === "line_concurrence") return lineConcurrence(inputs, context);
  if (operator === "point_line_distance") return pointLineDistance(inputs, context);
  return invalid("operator", `unsupported analytic line operator ${operator}`);
}

export function analyticLineConstructionOutputLabels(operator: string, outputs: readonly unknown[]): string[] {
  if (!isAnalyticLineOperator(operator)) throw new Error("analytic line labels require an analytic line operator");
  return outputs.map((output) => {
    if (!isRecord(output) || !isAnalyticLineRecord(output.analyticLine)) throw new Error("analytic line label metadata is missing");
    return analyticLineLabel(output.analyticLine);
  });
}
function isAnalyticLineRecord(value: unknown): value is AnalyticLineRecord {
  return isRecord(value) && value.worldUnits === true;
}
function sameLineUpToScale(first: LineCoefficients, second: LineCoefficients): boolean {
  const scale = Math.max(1, Math.hypot(first.a, first.b, first.c) * Math.hypot(second.a, second.b, second.c));
  const tolerance = 1e-9 * scale;
  return Math.abs(first.a * second.b - first.b * second.a) <= tolerance &&
    Math.abs(first.a * second.c - first.c * second.a) <= tolerance &&
    Math.abs(first.b * second.c - first.c * second.b) <= tolerance;
}
function compactAnalyticNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (rounded === 0 && value !== 0) return String(value);
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
/** "=" only when the shown digits are the value; a rounded value says "≈". */
function analyticValueLabel(symbol: string, value: number): string {
  const shown = compactAnalyticNumber(value);
  return `${symbol}${Number(shown) === value ? "=" : "≈"}${shown}`;
}
function analyticLineLabel(record: AnalyticLineRecord): string {
  if (typeof record.distance === "number") return analyticValueLabel("d", record.distance);
  if (typeof record.signedDistance === "number") return analyticValueLabel("d", record.signedDistance);
  if (typeof record.angleRadians === "number") return analyticValueLabel("angle", record.angleRadians);
  if (record.concurrent === true) return "concurrent";
  if (record.concurrent === false) return "not concurrent";
  if (record.slopeDefined === false) return "vertical";
  if (typeof record.slope === "number") return analyticValueLabel("m", record.slope);
  if (record.section) {
    // Short words: the caller prefixes the point's identity ("P (between)")
    // and the whole label must stay within 16 characters.
    if (record.coincidentPoints) return "coincident";
    if (record.section.mode === "midpoint") return "midpoint";
    if (record.section.parameter === 0 || record.section.parameter === 1) return "endpoint";
    return record.section.parameter > 0 && record.section.parameter < 1
      ? "between" : "outside";
  }
  if (record.translation) return "translated";
  if (record.perpendicular === true) return "perpendicular";
  if (record.parallel === true) return "parallel";
  return "line";
}

function entityKinds(geometry: AnalyticLineGeometry): readonly string[] {
  if (geometry.kind === "point") return ["point"];
  if (geometry.kind === "circle") return ["circle"];
  if (geometry.infinite) return ["line"];
  return ["segment", "vector"];
}

function validationNumber(value: unknown, document: SceneDocument, seen = new Set<string>(), depth = 0): number {
  if (depth > 32) invalid("number", "numeric reference depth exceeds 32");
  if (typeof value === "number") return bounded(value, "number");
  if (isRecord(value) && "value" in value) {
    if (typeof value.unit === "string" && /px|pixel|board/i.test(value.unit)) invalid("number", "a board-pixel length cannot change a world-coordinate metric");
    return validationNumber(value.value, document, seen, depth + 1);
  }
  if (typeof value !== "string" || !value.trim()) invalid("number", "number must be a finite literal or quantity reference");
  const quantity = document.quantities.find((candidate) => candidate.id === value);
  if (!quantity) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) invalid("number", "number must be a finite literal or quantity reference");
    return bounded(parsed, "number");
  }
  if (seen.has(value)) invalid("number", "cyclic quantity reference");
  seen.add(value);
  return validationNumber(quantity.value, document, seen, depth + 1);
}

/** Structural failures become fatal issues. A thrown input error must not look like a valid document. */
export function validateAnalyticLineConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  const operator = construction.operator;
  if (!isAnalyticLineOperator(operator)) return;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const add = (key: string, message: string, actual?: unknown): void => {
    issues.push({
      code: `invalid_${operator}_${key}`,
      message,
      severity: "fatal",
      path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`,
      entityIds: outputs.filter((id) => typeof id === "string"),
      actual,
    });
  };
  if (!isRecord(construction.inputs)) {
    add("inputs", `${operator} inputs must be an object`, construction.inputs);
    return;
  }
  if (outputs.length !== 1 || typeof outputs[0] !== "string" || !outputs[0].trim()) {
    add("outputs", `${operator} requires exactly one output id`, construction.outputs);
  }
  const visiting = new Set<string>();
  const memo = new Map<string, unknown>();
  const context: AnalyticLineEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      if (typeof value !== "string") invalid("point", "validation point references must be entity ids");
      return resolvePoint(value);
    },
    geometry(value) {
      if (typeof value !== "string") return undefined;
      return resolveGeometry(value);
    },
  };
  function resolveGeometry(id: string): unknown {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id) || visiting.size >= 32) invalid("reference", "geometry references must be bounded and acyclic");
    const producer = constructionByOutput.get(id);
    const entity = document.entities.find(candidate => candidate.id === id);
    if (!producer || !entity || producer.outputs.length !== 1) invalid("reference", `${id} must reference one constructed geometry`);
    visiting.add(id);
    try {
      const result = producer.operator === "point" && entity.kind === "point"
        ? { kind: "point", point: checkedPoint({ x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) }, "point") }
        : isAnalyticLineOperator(producer.operator)
          ? evaluateAnalyticLineConstruction(producer.operator, producer.inputs, context)[0]
          : undefined;
      if (!result) throw new UnresolvedAnalyticLine();
      memo.set(id, result);
      return result;
    } finally { visiting.delete(id); }
  }
  function resolvePoint(id: string): RenderPoint {
    if (visiting.has(id) || visiting.size > 32) invalid("reference", "point references must be acyclic");
    const producer = constructionByOutput.get(id);
    const entity = document.entities.find((candidate) => candidate.id === id);
    if (!producer || !entity) invalid("reference", `${id} must reference a constructed point`);
    if (producer.operator !== "point" || entity.kind !== "point") throw new UnresolvedAnalyticLine();
    visiting.add(id);
    try {
      return checkedPoint({
        x: validationNumber(producer.inputs.x, document),
        y: validationNumber(producer.inputs.y, document),
      }, "point");
    } finally { visiting.delete(id); }
  }
  try {
    const produced = evaluateAnalyticLineConstruction(operator, construction.inputs, context);
    const geometry = produced[0];
    if (!geometry || produced.length !== 1) {
      add("outputs", `${operator} must certify one geometry`, produced.length);
      return;
    }
    if (operator === "point_line_distance" && geometry.kind === "path") {
      const endpoint = geometry.points.at(-1);
      const foot = geometry.analyticLine.foot;
      if (!endpoint || !foot || pointSeparation(endpoint, foot) > 64 * Number.EPSILON * Math.max(1, Math.hypot(foot.x, foot.y))) {
        add("displayLength", "a scene distance connector must end at its certified perpendicular foot");
      }
    }
    if (operator === "point_line_distance") {
      // The distance must be measured to a line the scene actually draws: the
      // same scalar distance from another line is a different figure.
      const measured = geometry.analyticLine.coefficients;
      const drawn = document.constructions.some((candidate) => {
        if (candidate === construction || !["line_equation", "line_intercepts", "line_relation"].includes(candidate.operator) || !isRecord(candidate.inputs)) return false;
        try {
          return evaluateAnalyticLineConstruction(candidate.operator, candidate.inputs, context).some((line) => {
            const coefficients = line.kind === "path" && line.infinite ? line.analyticLine.coefficients : undefined;
            return Boolean(measured && coefficients && sameLineUpToScale(measured, coefficients));
          });
        } catch {
          return false;
        }
      });
      if (!drawn) add("a", "point_line_distance must measure to a drawn certified infinite line with the same coefficients up to scale");
    }
    if (geometry.kind === "path" && geometry.infinite && geometry.analyticLine.coefficients) {
      for (const projection of document.constructions.filter(row => row.operator === "project" && (row.inputs.line ?? row.inputs.onto) === outputs[0])) {
        try {
          const source = readPoint(projection.inputs.point ?? projection.inputs.source, "point", context);
          const expected = certifiedPointLineProjection(source, geometry.analyticLine.coefficients);
          // Check the actual inherited endpoint-based project calculation too.
          const [a, b] = geometry.points;
          if (!a || !b) throw new Error("missing projection line endpoints");
          const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy;
          const t = ((source.x - a.x) * dx + (source.y - a.y) * dy) / denominator;
          const actual = { x: a.x + t * dx, y: a.y + t * dy };
          const tolerance = expected.distance === 0 ? 0 : METRIC_TOLERANCE * expected.distance;
          if (!Number.isFinite(actual.x) || !Number.isFinite(actual.y) || pointSeparation(actual, expected.foot) > tolerance) throw new Error("drawn foot exceeds supported geometry precision");
        } catch (error) {
          issues.push({ code: "invalid_project_geometry", severity: "fatal", path: `constructions/${projection.id}`, message: error instanceof Error ? error.message : "uncertifiable projection foot" });
        }
      }
    }
    const actualKind = document.entities.find((entity) => entity.id === outputs[0])?.kind;
    if (!entityKinds(geometry).includes(actualKind ?? "")) {
      add("output_kind", `${operator} output must use entity kind ${entityKinds(geometry).join(" or ")}`, actualKind);
    }
  } catch (error) {
    if (error instanceof UnresolvedAnalyticLine) return;
    const key = error instanceof AnalyticLineInputError ? error.key : "geometry";
    add(key, error instanceof Error ? error.message : "invalid analytic line construction", construction.inputs[key]);
  }
}

export function validateEvaluatedAnalyticLineLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  try {
    const authorities: PublicationClaimAuthority[] = outputs.map((output) => {
    if (!isRecord(output) || !isAnalyticLineRecord(output.analyticLine)) throw new Error("Missing typed analytic-line label authority");
    const meta = output.analyticLine;
    const values: Record<string, number | readonly [number, number]> = {};
    const put = (names: string[], value: number | null | undefined): void => { if (typeof value === "number") for (const name of names) values[name] = value; };
    put(["d", "distance"], meta.distance); put(["signedDistance"], meta.signedDistance);
    put(["m", "slope"], meta.slope); put(["angle", "angleRadians"], meta.angleRadians);
    if (meta.coefficients) { put(["a"], meta.coefficients.a); put(["b"], meta.coefficients.b); put(["c"], meta.coefficients.c); }
    if (output.kind === "point" && isRecord(output.point) && typeof output.point.x === "number" && typeof output.point.y === "number") {
      put(["x"], output.point.x); put(["y"], output.point.y); values.P = [output.point.x, output.point.y];
    }
    // section_point and point_line_distance retain the existing specialized validator.
    return values;
    });
    const equations=outputs.map(output=>isRecord(output) && output.kind==="path" && output.infinite===true && isAnalyticLineRecord(output.analyticLine)?output.analyticLine.coefficients:undefined);
    validatePublicationDerivedClaims(construction, index, document, authorities, issues, equations);
  } catch (error) {
    issues.push({ code: "invalid_publication_derived_label", severity: "fatal", message: error instanceof Error ? error.message : "Invalid typed label authority", path: `constructions[${index}].outputs` });
  }
}
