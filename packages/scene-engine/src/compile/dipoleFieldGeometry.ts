import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const DIPOLE_FIELD_OPERATORS = [
  "coulomb_pair",
  "point_charge_field",
  "field_lines",
  "dipole_field",
  "dipole_torque",
  "equipotential",
  "dipole_energy",
] as const;
export type DipoleOperator = (typeof DIPOLE_FIELD_OPERATORS)[number];

export interface ExamScope {
  "JEE Main 2026": "listed" | "application";
  "JEE Advanced 2026": "listed" | "application";
  "NEET-UG 2026": "listed" | "application";
}

/** Coulomb's constant is never implied. Display length is board scale only. */
export interface DipoleFieldMetadata {
  operator: DipoleOperator;
  topicId: string;
  exams: ExamScope;
  k: number | null;
  displayLength: number | null;
  quantitativeDensity: false;
  plane: "xy";
  components?: RenderPoint;
  magnitude?: number;
  forces?: [RenderPoint, RenderPoint];
  ideal?: RenderPoint | null;
  superposition?: RenderPoint;
  formula?: "2*k*p/r^3" | "k*p/r^3" | null;
  usedIdealFormula?: boolean;
  mode?: "finite" | "ideal";
  pureDipole?: boolean;
  p?: RenderPoint | null;
  d?: RenderPoint;
  center?: RenderPoint;
  r?: number;
  separation?: number;
  axis?: "axial" | "equatorial" | "off-axis" | "center";
  tau?: number;
  tauSense?: "out-of-page" | "into-page" | "zero";
  netForce?: RenderPoint;
  uniform?: true;
  U?: number;
  zeroConvention?: "perpendicular";
  alignment?: "parallel" | "antiparallel" | "perpendicular" | "oblique";
  minusDuDTheta?: number;
  V?: number;
  portion?: boolean;
  portionOf?: "perpendicular-bisector";
  closed?: boolean;
  samples?: Array<{ point: RenderPoint; potential: number; tangentDot: number }>;
  lines?: Array<{ startedAtChargeId: string | null; endedAtChargeId: string | null }>;
  exclusionRadius?: number;
}

export type DipoleGeometry =
  | { kind: "point"; point: RenderPoint; dipoleField: DipoleFieldMetadata }
  | { kind: "path"; points: RenderPoint[]; directed: true; dipoleField: DipoleFieldMetadata }
  | { kind: "circle"; center: RenderPoint; radius: number; dipoleField: DipoleFieldMetadata }
  | { kind: "multi_path"; paths: Array<{ points: RenderPoint[]; directed: boolean }>; dipoleField: DipoleFieldMetadata };

export interface DipoleFieldEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry(value: unknown): unknown;
}

const TOPIC: Record<DipoleOperator, { topicId: string; exams: ExamScope }> = {
  coulomb_pair: {
    topicId: "physics|11|coulombs-law-for-point-charges",
    exams: { "JEE Main 2026": "listed", "JEE Advanced 2026": "listed", "NEET-UG 2026": "listed" },
  },
  point_charge_field: {
    topicId: "physics|11|electric-field-for-point-charge",
    exams: { "JEE Main 2026": "listed", "JEE Advanced 2026": "listed", "NEET-UG 2026": "listed" },
  },
  field_lines: {
    topicId: "physics|11|electric-field-lines",
    exams: { "JEE Main 2026": "listed", "JEE Advanced 2026": "listed", "NEET-UG 2026": "listed" },
  },
  dipole_field: {
    topicId: "physics|11|electric-dipole-and-its-field",
    exams: { "JEE Main 2026": "listed", "JEE Advanced 2026": "application", "NEET-UG 2026": "listed" },
  },
  dipole_torque: {
    topicId: "physics|11|torque-on-electric-dipole",
    exams: { "JEE Main 2026": "listed", "JEE Advanced 2026": "application", "NEET-UG 2026": "listed" },
  },
  equipotential: {
    topicId: "physics|11|equipotential-surfaces",
    exams: { "JEE Main 2026": "listed", "JEE Advanced 2026": "application", "NEET-UG 2026": "listed" },
  },
  dipole_energy: {
    topicId: "physics|11|dipole-potential-energy-in-field",
    exams: { "JEE Main 2026": "listed", "JEE Advanced 2026": "listed", "NEET-UG 2026": "listed" },
  },
};

const INPUT_KEYS: Record<DipoleOperator, readonly string[]> = {
  coulomb_pair: ["charges", "k", "displayLength"],
  point_charge_field: ["charge", "at", "k", "displayLength"],
  field_lines: ["charges", "starts", "stepLength", "stepCount", "k", "exclusionRadius"],
  dipole_field: ["charges", "at", "mode", "k", "displayLength"],
  dipole_torque: ["p", "E", "at", "displayLength", "uniform", "nonuniform"],
  equipotential: ["source", "charge", "charges", "V", "k", "samples", "sampleDomain"],
  dipole_energy: ["p", "E", "at", "displayLength", "zeroConvention", "uniform", "nonuniform"],
};

const DENSITY_KEYS = ["density", "lineDensity", "quantitativeDensity", "linesPerCharge", "linesPerUnitArea"];
const GRADIENT_KEYS = ["gradient", "fieldGradient", "dE", "dEdx", "dEdy"];
const TEST_CHARGE_KEYS = ["testCharge", "test_charge", "qTest", "probeCharge"];
const MAX_SCALAR_DEPTH = 32;
const MAX_LINE_STEPS = 400;
const MAX_STARTS = 16;
const MAX_SAMPLES = 180;
const AXIS_TOLERANCE = 1e-8;
const ENERGY_ANGLE_STEP = 1e-6;
const IDEAL_SEPARATION_RATIO = 10;

class DipoleFieldInputError extends Error {
  constructor(readonly key: string, message: string) { super(message); }
}
function invalid(key: string, message: string): never { throw new DipoleFieldInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isOperator(operator: string): operator is DipoleOperator {
  return (DIPOLE_FIELD_OPERATORS as readonly string[]).includes(operator);
}
function rejectKeys(inputs: Record<string, unknown>, allowed: readonly string[], key = "fields"): void {
  const unexpected = Object.keys(inputs).filter((name) => !allowed.includes(name));
  if (unexpected.length) invalid(key, `unsupported dipole-field inputs: ${unexpected.join(", ")}`);
}
function copy(point: RenderPoint): RenderPoint { return { x: point.x, y: point.y }; }
function sub(a: RenderPoint, b: RenderPoint): RenderPoint { return { x: a.x - b.x, y: a.y - b.y }; }
function dot(a: RenderPoint, b: RenderPoint): number { return a.x * b.x + a.y * b.y; }
function crossZ(a: RenderPoint, b: RenderPoint): number { return a.x * b.y - a.y * b.x; }
function hypot(point: RenderPoint): number { return Math.hypot(point.x, point.y); }
function scale(point: RenderPoint, factor: number): RenderPoint { return { x: point.x * factor, y: point.y * factor }; }
function add(a: RenderPoint, b: RenderPoint): RenderPoint { return { x: a.x + b.x, y: a.y + b.y }; }

function numberValue(value: unknown, key: string, context: DipoleFieldEvaluationContext): number {
  let scalar = value;
  const seen = new Set<unknown>();
  for (let depth = 0; isRecord(scalar); depth += 1) {
    if (depth >= MAX_SCALAR_DEPTH || seen.has(scalar) || !("value" in scalar)) invalid(key, `${key} must be a finite scalar`);
    rejectKeys(scalar, ["value", "unit"], key);
    if (scalar.unit !== undefined) invalid(key, `${key} must be a bare number; this operator does not convert units or assume a Coulomb constant`);
    seen.add(scalar);
    scalar = scalar.value;
  }
  if (typeof scalar !== "number" && (typeof scalar !== "string" || !scalar.trim())) invalid(key, `${key} must be a finite scalar`);
  try {
    const number = context.number(scalar);
    if (!Number.isFinite(number)) invalid(key, `${key} must resolve to a finite number`);
    return number;
  } catch (error) {
    if (error instanceof DipoleFieldInputError) throw error;
    return invalid(key, `${key} must resolve to a finite number`);
  }
}
function finitePoint(point: RenderPoint, key: string): RenderPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1e12 || Math.abs(point.y) > 1e12) {
    invalid(key, `${key} must resolve to a finite planar point`);
  }
  return { x: point.x, y: point.y };
}
function pointValue(value: unknown, key: string, context: DipoleFieldEvaluationContext): RenderPoint {
  if (isRecord(value)) {
    rejectKeys(value, ["x", "y"], key);
    return finitePoint({ x: numberValue(value.x, `${key}.x`, context), y: numberValue(value.y, `${key}.y`, context) }, key);
  }
  if (Array.isArray(value)) {
    if (value.length !== 2) invalid(key, `${key} must contain exactly two coordinates`);
    return finitePoint({ x: numberValue(value[0], `${key}.x`, context), y: numberValue(value[1], `${key}.y`, context) }, key);
  }
  if (typeof value !== "string" || !value.trim()) invalid(key, `${key} must reference a point or supply two coordinates`);
  const geometry = context.geometry(value);
  if (isRecord(geometry) && (geometry.space !== undefined || geometry.spaceFrameId !== undefined || geometry.world3D !== undefined || geometry.projectedAngle !== undefined)) {
    invalid(key, "a projected angle or 3D position is not a planar field point");
  }
  try { return finitePoint(context.point(value), key); }
  catch (error) {
    if (error instanceof DipoleFieldInputError) throw error;
    return invalid(key, `${key} must reference a constructed finite point`);
  }
}
function positiveLength(value: unknown, key: string, context: DipoleFieldEvaluationContext): number {
  const length = numberValue(value, key, context);
  if (!(length > 0)) invalid(key, `${key} must be positive`);
  return length;
}
function coefficient(value: unknown, context: DipoleFieldEvaluationContext): number {
  const k = numberValue(value, "k", context);
  if (!(k > 0)) invalid("k", "k must be an explicit positive Coulomb coefficient");
  return k;
}
function displayScale(value: unknown, context: DipoleFieldEvaluationContext): number {
  return positiveLength(value, "displayLength", context);
}
interface SourceCharge { id?: string; position: RenderPoint; charge: number }
function chargeRecord(value: unknown, key: string, context: DipoleFieldEvaluationContext, named: boolean): SourceCharge {
  if (!isRecord(value)) invalid(key, `${key} requires position and charge`);
  rejectKeys(value, named ? ["id", "position", "charge"] : ["position", "charge"], key);
  const charge = numberValue(value.charge, `${key}.charge`, context);
  if (!Number.isFinite(charge) || charge === 0) invalid(`${key}.charge`, `${key}.charge must be a nonzero finite charge`);
  const position = pointValue(value.position, `${key}.position`, context);
  if (!named) return { position, charge };
  if (typeof value.id !== "string" || !value.id.trim()) invalid(`${key}.id`, `${key}.id must name the charge`);
  return { id: value.id.trim(), position, charge };
}
function chargeList(value: unknown, key: string, context: DipoleFieldEvaluationContext, named: boolean, count?: number): SourceCharge[] {
  if (!Array.isArray(value) || value.length < 1 || (count !== undefined && value.length !== count) || value.length > 32) {
    invalid(key, count === undefined ? `${key} must list 1 to 32 charges` : `${key} must list exactly ${count} charges`);
  }
  const charges = value.map((item, index) => chargeRecord(item, `${key}[${index}]`, context, named));
  if (named) {
    const ids = charges.map((item) => item.id);
    if (new Set(ids).size !== ids.length) invalid(key, "charge ids must be distinct");
  }
  return charges;
}
function separated(a: RenderPoint, b: RenderPoint, key: string): RenderPoint {
  const delta = sub(b, a);
  if (!(hypot(delta) > 0)) invalid(key, "coincident point charges have no finite separation");
  return delta;
}
function baseMetadata(operator: DipoleOperator, k: number | null, displayLength: number | null): DipoleFieldMetadata {
  return { operator, ...TOPIC[operator], k, displayLength, quantitativeDensity: false, plane: "xy" };
}
function arrow(origin: RenderPoint, vector: RenderPoint, displayLength: number, metadata: DipoleFieldMetadata): DipoleGeometry {
  const magnitude = hypot(vector);
  metadata.components = copy(vector);
  metadata.magnitude = magnitude;
  if (magnitude === 0) return { kind: "point", point: copy(origin), dipoleField: metadata };
  const direction = scale(vector, 1 / magnitude);
  const end = finitePoint({ x: origin.x + direction.x * displayLength, y: origin.y + direction.y * displayLength }, "displayLength");
  if (end.x === origin.x && end.y === origin.y) invalid("displayLength", "display arrow is numerically indistinguishable from its origin");
  return { kind: "path", points: [copy(origin), end], directed: true, dipoleField: metadata };
}
function fieldAt(charges: readonly SourceCharge[], at: RenderPoint, k: number): RenderPoint {
  let x = 0;
  let y = 0;
  for (const source of charges) {
    const delta = sub(at, source.position);
    const radius = hypot(delta);
    if (!(radius > 0)) invalid("at", "r=0 cannot produce a finite electric field");
    const factor = k * source.charge / (radius * radius * radius);
    if (!Number.isFinite(factor)) invalid("charges", "a point-charge field overflows finite numeric authority");
    x += factor * delta.x;
    y += factor * delta.y;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) invalid("charges", "electric field superposition is non-finite");
  return { x, y };
}
function potentialAt(charges: readonly SourceCharge[], at: RenderPoint, k: number): number {
  let potential = 0;
  for (const source of charges) {
    const radius = hypot(sub(at, source.position));
    if (!(radius > 0)) invalid("V", "potential is singular on a point charge");
    potential += k * source.charge / radius;
  }
  if (!Number.isFinite(potential)) invalid("V", "electric potential is non-finite");
  return potential;
}
function rejectDensityClaim(inputs: Record<string, unknown>): void {
  const claimed = DENSITY_KEYS.filter((key) => key in inputs);
  if (claimed.length) invalid("density", "field-line density is schematic; this packet does not accept a numeric density definition");
}
function rejectNonuniform(inputs: Record<string, unknown>): void {
  if (inputs.nonuniform === true || inputs.uniform === false || GRADIENT_KEYS.some((key) => key in inputs)) {
    invalid("nonuniform", "a nonuniform field or a supplied field gradient needs a separate force calculation and is rejected");
  }
  if (inputs.uniform !== undefined && inputs.uniform !== true) invalid("uniform", "dipole torque and energy accept only a uniform field");
  if (inputs.nonuniform !== undefined && inputs.nonuniform !== false) invalid("nonuniform", "a nonuniform field or a supplied field gradient needs a separate force calculation and is rejected");
}
function rejectProjectedAngle(inputs: Record<string, unknown>): void {
  if ("projectedAngle" in inputs || "worldAngle" in inputs || "viewAngle" in inputs) {
    invalid("projectedAngle", "a projected angle is not a substitute for E perpendicular to the contour in the same plane");
  }
}

function coulombPair(inputs: Record<string, unknown>, context: DipoleFieldEvaluationContext): DipoleGeometry[] {
  const charges = chargeList(inputs.charges, "charges", context, false, 2);
  const k = coefficient(inputs.k, context);
  const displayLength = displayScale(inputs.displayLength, context);
  const first = charges[0]!;
  const second = charges[1]!;
  const apart = separated(first.position, second.position, "charges");
  const radius = hypot(apart);
  const factor = k * first.charge * second.charge / (radius * radius * radius);
  if (!Number.isFinite(factor)) invalid("charges", "Coulomb force overflows finite numeric authority");
  const onSecond = scale(apart, factor);
  const onFirst = { x: -onSecond.x, y: -onSecond.y };
  const pair: [RenderPoint, RenderPoint] = [onFirst, onSecond];
  return [onFirst, onSecond].map((force, index) => {
    const metadata = baseMetadata("coulomb_pair", k, displayLength);
    metadata.forces = pair;
    const mark = arrow(charges[index]!.position, force, displayLength, metadata);
    return mark;
  });
}

function pointChargeField(inputs: Record<string, unknown>, context: DipoleFieldEvaluationContext): DipoleGeometry[] {
  if (TEST_CHARGE_KEYS.some((key) => key in inputs)) invalid("testCharge", "the electric field of a source charge does not accept a test charge");
  const source = chargeRecord(inputs.charge, "charge", context, false);
  const at = pointValue(inputs.at, "at", context);
  const k = coefficient(inputs.k, context);
  const displayLength = displayScale(inputs.displayLength, context);
  const field = fieldAt([source], at, k);
  const metadata = baseMetadata("point_charge_field", k, displayLength);
  return [arrow(at, field, displayLength, metadata)];
}

function nearest(point: RenderPoint, charges: readonly SourceCharge[]): { source: SourceCharge; distance: number } {
  let best = charges[0]!;
  let distance = hypot(sub(point, best.position));
  for (const source of charges.slice(1)) {
    const candidate = hypot(sub(point, source.position));
    if (candidate < distance) { best = source; distance = candidate; }
  }
  return { source: best, distance };
}
function closestOnSegment(point: RenderPoint, start: RenderPoint, end: RenderPoint): RenderPoint {
  const edge = sub(end, start);
  const lengthSquared = dot(edge, edge);
  if (lengthSquared === 0) return copy(start);
  const t = Math.min(1, Math.max(0, dot(sub(point, start), edge) / lengthSquared));
  return add(start, scale(edge, t));
}
function chargeTooClose(start: RenderPoint, end: RenderPoint, charges: readonly SourceCharge[], exclusion: number): SourceCharge | null {
  for (const source of charges) {
    if (hypot(sub(closestOnSegment(source.position, start, end), source.position)) < exclusion) return source;
  }
  return null;
}
function segmentIntersection(a: RenderPoint, b: RenderPoint, c: RenderPoint, d: RenderPoint): RenderPoint | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = crossZ({ x: rx, y: ry }, { x: sx, y: sy });
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const scaleBound = Math.hypot(rx, ry) * Math.hypot(sx, sy);
  if (Math.abs(denom) <= 1e-12 * (scaleBound + 1)) {
    if (Math.abs(crossZ({ x: qx, y: qy }, { x: rx, y: ry })) > 1e-9 * (Math.hypot(qx, qy) * Math.hypot(rx, ry) + 1)) return null;
    const lengthSquared = rx * rx + ry * ry;
    if (lengthSquared === 0) return null;
    const t0 = (qx * rx + qy * ry) / lengthSquared;
    const t1 = ((qx + sx) * rx + (qy + sy) * ry) / lengthSquared;
    const left = Math.max(Math.min(t0, t1), 0);
    const right = Math.min(Math.max(t0, t1), 1);
    if (right - left <= 1e-8) return null;
    const t = (left + right) / 2;
    return { x: a.x + t * rx, y: a.y + t * ry };
  }
  const t = crossZ({ x: qx, y: qy }, { x: sx, y: sy }) / denom;
  const u = crossZ({ x: qx, y: qy }, { x: rx, y: ry }) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + t * rx, y: a.y + t * ry };
}
function polylinesHit(left: readonly RenderPoint[], right: readonly RenderPoint[]): RenderPoint | null {
  for (let i = 0; i < left.length - 1; i += 1) {
    for (let j = 0; j < right.length - 1; j += 1) {
      const hit = segmentIntersection(left[i]!, left[i + 1]!, right[j]!, right[j + 1]!);
      if (hit) return hit;
    }
  }
  return null;
}
interface TracedLine { points: RenderPoint[]; startedAtChargeId: string | null; endedAtChargeId: string | null }
function traceLine(start: RenderPoint, charges: readonly SourceCharge[], k: number, stepLength: number, stepCount: number, exclusion: number): TracedLine {
  const launch = nearest(start, charges);
  if (!(launch.distance > 0)) invalid("starts", "a field line cannot start on top of a charge");
  if (launch.distance <= exclusion) invalid("starts", "a field line cannot start on top of a charge");
  const startedAtChargeId = launch.source.charge > 0 && launch.distance <= exclusion + stepLength ? launch.source.id ?? null : null;
  const points = [copy(start)];
  let current = copy(start);
  let endedAtChargeId: string | null = null;
  for (let step = 0; step < stepCount; step += 1) {
    const field = fieldAt(charges, current, k);
    const magnitude = hypot(field);
    if (!(magnitude > 0)) break;
    const direction = scale(field, 1 / magnitude);
    const next = { x: current.x + direction.x * stepLength, y: current.y + direction.y * stepLength };
    const alignment = dot(sub(next, current), direction) / stepLength;
    if (!(alignment > 1 - 1e-8)) invalid("starts", "a sample step does not follow the local field direction");
    const blocked = chargeTooClose(current, next, charges, exclusion);
    if (blocked) {
      if (blocked.charge < 0) endedAtChargeId = blocked.id ?? null;
      break;
    }
    points.push(finitePoint(next, "starts"));
    current = next;
  }
  if (points.length < 2) invalid("starts", "field line stopped before it could follow the local field");
  if (!startedAtChargeId && !endedAtChargeId) invalid("starts", "each field line must start at a positive charge or end at a negative charge");
  return { points, startedAtChargeId, endedAtChargeId };
}
function fieldLines(inputs: Record<string, unknown>, context: DipoleFieldEvaluationContext): DipoleGeometry[] {
  rejectDensityClaim(inputs);
  const charges = chargeList(inputs.charges, "charges", context, true);
  const k = coefficient(inputs.k, context);
  const stepLength = positiveLength(inputs.stepLength, "stepLength", context);
  const stepCount = numberValue(inputs.stepCount, "stepCount", context);
  if (!Number.isInteger(stepCount) || stepCount < 1 || stepCount > MAX_LINE_STEPS) invalid("stepCount", `stepCount must be an integer from 1 to ${MAX_LINE_STEPS}`);
  const exclusion = inputs.exclusionRadius === undefined ? stepLength : positiveLength(inputs.exclusionRadius, "exclusionRadius", context);
  if (!Array.isArray(inputs.starts) || inputs.starts.length < 1 || inputs.starts.length > MAX_STARTS) invalid("starts", `field lines require 1 to ${MAX_STARTS} start points`);
  for (let i = 0; i < charges.length; i += 1) {
    for (let j = i + 1; j < charges.length; j += 1) {
      if (hypot(sub(charges[i]!.position, charges[j]!.position)) <= exclusion * 2) invalid("exclusionRadius", "charge exclusion regions must not overlap");
    }
  }
  const lines = inputs.starts.map((start, index) => traceLine(pointValue(start, `starts[${index}]`, context), charges, k, stepLength, stepCount, exclusion));
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const hit = polylinesHit(lines[i]!.points, lines[j]!.points);
      if (hit && !charges.some((source) => hypot(sub(hit, source.position)) <= exclusion)) {
        invalid("starts", "distinct field lines cross away from a charge");
      }
    }
  }
  const metadata = baseMetadata("field_lines", k, null);
  metadata.exclusionRadius = exclusion;
  metadata.lines = lines.map((line) => ({ startedAtChargeId: line.startedAtChargeId, endedAtChargeId: line.endedAtChargeId }));
  return [{ kind: "multi_path", paths: lines.map((line) => ({ points: line.points, directed: true })), dipoleField: metadata }];
}

function dipoleMoment(charges: readonly SourceCharge[]): { pure: boolean; positive: SourceCharge; negative: SourceCharge; d: RenderPoint; p: RenderPoint | null; center: RenderPoint; separation: number } {
  const first = charges[0]!;
  const second = charges[1]!;
  const separation = hypot(separated(first.position, second.position, "charges"));
  const positive = first.charge > 0 ? first : second;
  const negative = first.charge > 0 ? second : first;
  const pure = first.charge === -second.charge;
  const d = pure ? sub(positive.position, negative.position) : sub(second.position, first.position);
  const center = { x: (first.position.x + second.position.x) / 2, y: (first.position.y + second.position.y) / 2 };
  const p = pure ? scale(d, Math.abs(positive.charge)) : null;
  return { pure, positive, negative, d, p, center, separation };
}
function axisOf(fromCenter: RenderPoint, d: RenderPoint): "axial" | "equatorial" | "off-axis" | "center" {
  const radius = hypot(fromCenter);
  const separation = hypot(d);
  if (radius === 0) return "center";
  const scaleBound = radius * separation;
  if (Math.abs(crossZ(fromCenter, d)) <= AXIS_TOLERANCE * scaleBound) return "axial";
  if (Math.abs(dot(fromCenter, d)) <= AXIS_TOLERANCE * scaleBound) return "equatorial";
  return "off-axis";
}
function dipoleField(inputs: Record<string, unknown>, context: DipoleFieldEvaluationContext): DipoleGeometry[] {
  if (inputs.mode !== "finite" && inputs.mode !== "ideal") invalid("mode", "dipole_field mode must be finite or ideal");
  const charges = chargeList(inputs.charges, "charges", context, false, 2);
  const at = pointValue(inputs.at, "at", context);
  const k = coefficient(inputs.k, context);
  const displayLength = displayScale(inputs.displayLength, context);
  const dipole = dipoleMoment(charges);
  const superposition = fieldAt(charges, at, k);
  const fromCenter = sub(at, dipole.center);
  const radius = hypot(fromCenter);
  const axis = axisOf(fromCenter, dipole.d);
  if (inputs.mode === "ideal") {
    if (!dipole.pure || !dipole.p) invalid("charges", "ideal dipole mode requires equal and opposite charges +q and -q");
    if (!(radius >= IDEAL_SEPARATION_RATIO * dipole.separation)) invalid("at", "ideal dipole mode requires r >= 10 |d|");
    if (axis !== "axial" && axis !== "equatorial") invalid("at", "ideal dipole mode reports only the axial and equatorial far field");
    const pMagnitude = hypot(dipole.p);
    const pHat = scale(dipole.p, 1 / pMagnitude);
    const ideal = axis === "axial"
      ? scale(pHat, 2 * k * pMagnitude / (radius * radius * radius))
      : scale(pHat, -k * pMagnitude / (radius * radius * radius));
    if (!Number.isFinite(ideal.x) || !Number.isFinite(ideal.y)) invalid("at", "ideal dipole field is non-finite");
    const metadata = baseMetadata("dipole_field", k, displayLength);
    metadata.mode = "ideal";
    metadata.pureDipole = true;
    metadata.superposition = copy(superposition);
    metadata.ideal = copy(ideal);
    metadata.usedIdealFormula = true;
    metadata.formula = axis === "axial" ? "2*k*p/r^3" : "k*p/r^3";
    metadata.p = copy(dipole.p);
    metadata.d = copy(dipole.d);
    metadata.center = copy(dipole.center);
    metadata.r = radius;
    metadata.separation = dipole.separation;
    metadata.axis = axis;
    return [arrow(at, ideal, displayLength, metadata)];
  }
  const metadata = baseMetadata("dipole_field", k, displayLength);
  metadata.mode = "finite";
  metadata.pureDipole = dipole.pure;
  metadata.superposition = copy(superposition);
  metadata.ideal = null;
  metadata.usedIdealFormula = false;
  metadata.formula = null;
  metadata.p = dipole.p ? copy(dipole.p) : null;
  metadata.d = copy(dipole.d);
  metadata.center = copy(dipole.center);
  metadata.r = radius;
  metadata.separation = dipole.separation;
  metadata.axis = axis;
  return [arrow(at, superposition, displayLength, metadata)];
}

function vectorPair(inputs: Record<string, unknown>, context: DipoleFieldEvaluationContext): { p: RenderPoint; E: RenderPoint; at: RenderPoint; displayLength: number } {
  rejectNonuniform(inputs);
  return {
    p: pointValue(inputs.p, "p", context),
    E: pointValue(inputs.E, "E", context),
    at: pointValue(inputs.at, "at", context),
    displayLength: displayScale(inputs.displayLength, context),
  };
}
function alignmentOf(p: RenderPoint, E: RenderPoint): "parallel" | "antiparallel" | "perpendicular" | "oblique" {
  const scaleBound = hypot(p) * hypot(E);
  if (scaleBound === 0) return "perpendicular";
  if (Math.abs(crossZ(p, E)) <= AXIS_TOLERANCE * scaleBound) return dot(p, E) >= 0 ? "parallel" : "antiparallel";
  if (Math.abs(dot(p, E)) <= AXIS_TOLERANCE * scaleBound) return "perpendicular";
  return "oblique";
}
function rotate(vector: RenderPoint, angle: number): RenderPoint {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: vector.x * cosine - vector.y * sine, y: vector.x * sine + vector.y * cosine };
}
function dipoleTorque(inputs: Record<string, unknown>, context: DipoleFieldEvaluationContext): DipoleGeometry[] {
  const { p, E, at, displayLength } = vectorPair(inputs, context);
  if (!(hypot(p) > 0)) invalid("p", "dipole torque requires a nonzero dipole moment");
  const tau = crossZ(p, E);
  if (!Number.isFinite(tau)) invalid("p", "dipole torque is non-finite");
  const metadata = baseMetadata("dipole_torque", null, displayLength);
  metadata.p = copy(p);
  metadata.tau = tau;
  metadata.tauSense = tau > 0 ? "out-of-page" : tau < 0 ? "into-page" : "zero";
  metadata.netForce = { x: 0, y: 0 };
  metadata.uniform = true;
  metadata.alignment = alignmentOf(p, E);
  return [arrow(at, p, displayLength, metadata)];
}
function dipoleEnergy(inputs: Record<string, unknown>, context: DipoleFieldEvaluationContext): DipoleGeometry[] {
  if (!("zeroConvention" in inputs)) invalid("zeroConvention", "dipole energy requires declared zeroConvention \"perpendicular\"");
  if (inputs.zeroConvention !== "perpendicular") invalid("zeroConvention", "dipole energy zeroConvention must be \"perpendicular\" so U=0 when p is perpendicular to E");
  const { p, E, at, displayLength } = vectorPair(inputs, context);
  if (!(hypot(p) > 0)) invalid("p", "dipole energy requires a nonzero dipole moment");
  const U = -dot(p, E);
  const tau = crossZ(p, E);
  const ahead = rotate(p, ENERGY_ANGLE_STEP);
  const behind = rotate(p, -ENERGY_ANGLE_STEP);
  const derivative = (-dot(ahead, E) - -dot(behind, E)) / (2 * ENERGY_ANGLE_STEP);
  const scaleBound = Math.max(1, hypot(p) * hypot(E));
  if (!Number.isFinite(U) || !Number.isFinite(derivative) || Math.abs(tau + derivative) > 1e-8 * scaleBound) {
    invalid("p", "tau = -dU/d theta does not hold for the declared perpendicular zero");
  }
  const metadata = baseMetadata("dipole_energy", null, displayLength);
  metadata.p = copy(p);
  metadata.U = U;
  metadata.tau = tau;
  metadata.minusDuDTheta = -derivative;
  metadata.zeroConvention = "perpendicular";
  metadata.uniform = true;
  metadata.alignment = alignmentOf(p, E);
  metadata.netForce = { x: 0, y: 0 };
  return [arrow(at, p, displayLength, metadata)];
}

interface SampleDomain { min: RenderPoint; max: RenderPoint }
function domainValue(value: unknown, context: DipoleFieldEvaluationContext): SampleDomain {
  if (!isRecord(value)) invalid("sampleDomain", "sampleDomain must be a bounded min/max box");
  rejectKeys(value, ["min", "max"], "sampleDomain");
  const min = pointValue(value.min, "sampleDomain.min", context);
  const max = pointValue(value.max, "sampleDomain.max", context);
  if (!(max.x > min.x) || !(max.y > min.y)) invalid("sampleDomain", "sampleDomain must have a positive finite area");
  return { min, max };
}
function clipLine(origin: RenderPoint, direction: RenderPoint, box: SampleDomain): [RenderPoint, RenderPoint] {
  const px = [-direction.x, direction.x, -direction.y, direction.y];
  const q = [origin.x - box.min.x, box.max.x - origin.x, origin.y - box.min.y, box.max.y - origin.y];
  let t0 = Number.NEGATIVE_INFINITY;
  let t1 = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 4; index += 1) {
    const component = px[index]!;
    const limit = q[index]!;
    if (Math.abs(component) <= 1e-15) {
      if (limit < 0) invalid("sampleDomain", "the bounded sample domain misses the dipole equipotential");
      continue;
    }
    const t = limit / component;
    if (component < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  if (!(t0 < t1) || !Number.isFinite(t0) || !Number.isFinite(t1)) invalid("sampleDomain", "the bounded sample domain misses the dipole equipotential");
  return [add(origin, scale(direction, t0)), add(origin, scale(direction, t1))];
}
function sampleCount(value: unknown, fallback: number, context: DipoleFieldEvaluationContext): number {
  if (value === undefined) return fallback;
  const count = numberValue(value, "samples", context);
  if (!Number.isInteger(count) || count < 12 || count > MAX_SAMPLES) invalid("samples", `samples must be an integer from 12 to ${MAX_SAMPLES}`);
  return count;
}
function normalizedDot(field: RenderPoint, tangent: RenderPoint): number {
  const scaleBound = hypot(field) * hypot(tangent);
  if (scaleBound === 0) invalid("V", "equipotential tangent or field vanished on the contour");
  return dot(field, tangent) / scaleBound;
}
function circleEquipotential(source: SourceCharge, V: number, k: number, count: number): DipoleGeometry {
  if (V === 0) invalid("V", "a point-charge equipotential V=0 is not a finite circle");
  const radius = k * source.charge / V;
  if (!(radius > 0) || !Number.isFinite(radius)) invalid("V", "point-charge equipotential requires V and q of the same sign");
  const samples = Array.from({ length: count }, (_, index) => {
    const angle = 2 * Math.PI * index / count;
    const radial = { x: Math.cos(angle), y: Math.sin(angle) };
    const point = add(source.position, scale(radial, radius));
    const tangent = { x: -radial.y, y: radial.x };
    const field = scale(radial, k * source.charge / (radius * radius));
    const potential = potentialAt([source], point, k);
    const tangentDot = normalizedDot(field, tangent);
    if (Math.abs(potential - V) > 1e-8 * Math.max(1, Math.abs(V)) || Math.abs(tangentDot) > 1e-8) {
      invalid("V", "point-charge circle is not an equipotential perpendicular to E");
    }
    return { point, potential, tangentDot };
  });
  const metadata = baseMetadata("equipotential", k, null);
  metadata.V = V;
  metadata.closed = true;
  metadata.portion = false;
  metadata.samples = samples;
  return { kind: "circle", center: copy(source.position), radius, dipoleField: metadata };
}
function dipoleContour(charges: readonly SourceCharge[], V: number, k: number, box: SampleDomain, count: number): DipoleGeometry {
  const dipole = dipoleMoment(charges);
  if (!dipole.pure) invalid("charges", "dipole equipotential requires equal and opposite charges");
  if (V === 0) {
    const direction = hypot(dipole.d) === 0 ? invalid("charges", "coincident point charges have no finite separation") : scale({ x: -dipole.d.y, y: dipole.d.x }, 1 / hypot(dipole.d));
    const [start, end] = clipLine(dipole.center, direction, box);
    const points = [start, end];
    const tangent = sub(end, start);
    const samples = [0, 0.5, 1].map((t) => {
      const point = add(start, scale(tangent, t));
      const field = fieldAt(charges, point, k);
      const potential = potentialAt(charges, point, k);
      const tangentDot = normalizedDot(field, tangent);
      if (Math.abs(potential) > 1e-8 || Math.abs(tangentDot) > 1e-6) invalid("V", "the bounded bisector portion is not a V=0 equipotential perpendicular to E");
      return { point, potential, tangentDot };
    });
    const metadata = baseMetadata("equipotential", k, null);
    metadata.V = 0;
    metadata.portion = true;
    metadata.portionOf = "perpendicular-bisector";
    metadata.closed = false;
    metadata.samples = samples;
    return { kind: "multi_path", paths: [{ points, directed: false }], dipoleField: metadata };
  }
  const enclosed = V > 0 ? dipole.positive : dipole.negative;
  if (enclosed.position.x <= box.min.x || enclosed.position.x >= box.max.x || enclosed.position.y <= box.min.y || enclosed.position.y >= box.max.y) {
    invalid("sampleDomain", "the charge enclosed by this equipotential must lie inside the sample domain");
  }
  const points = Array.from({ length: count }, (_, index) => {
    const angle = 2 * Math.PI * index / count;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const exit = rayExit(enclosed.position, direction, box);
    return add(enclosed.position, scale(direction, firstRadius(enclosed.position, direction, exit, charges, k, V)));
  });
  const samples = points.map((point, index) => {
    const previous = points[(index - 1 + count) % count]!;
    const next = points[(index + 1) % count]!;
    const tangent = sub(next, previous);
    const field = fieldAt(charges, point, k);
    const potential = potentialAt(charges, point, k);
    const tangentDot = normalizedDot(field, tangent);
    if (Math.abs(potential - V) > 1e-6 * Math.max(1, Math.abs(V)) || Math.abs(tangentDot) > 1e-2) {
      invalid("V", `dipole equipotential contour is not constant or E is not perpendicular to its tangent (V=${potential}, dot=${tangentDot})`);
    }
    return { point: copy(point), potential, tangentDot };
  });
  const metadata = baseMetadata("equipotential", k, null);
  metadata.V = V;
  metadata.portion = false;
  metadata.closed = true;
  metadata.samples = samples;
  return { kind: "multi_path", paths: [{ points, directed: false }], dipoleField: metadata };
}
function rayExit(origin: RenderPoint, direction: RenderPoint, box: SampleDomain): number {
  const hits = [direction.x > 0 ? (box.max.x - origin.x) / direction.x : direction.x < 0 ? (box.min.x - origin.x) / direction.x : Number.POSITIVE_INFINITY,
    direction.y > 0 ? (box.max.y - origin.y) / direction.y : direction.y < 0 ? (box.min.y - origin.y) / direction.y : Number.POSITIVE_INFINITY];
  const exit = Math.min(hits[0]!, hits[1]!);
  if (!(exit > 0) || !Number.isFinite(exit)) invalid("sampleDomain", "equipotential ray does not meet the sample domain");
  return exit * 0.999;
}
function firstRadius(origin: RenderPoint, direction: RenderPoint, rMax: number, charges: readonly SourceCharge[], k: number, target: number): number {
  const rMin = Math.min(1e-4, rMax * 1e-4);
  const valueAt = (radius: number): number => potentialAt(charges, add(origin, scale(direction, radius)), k);
  let previous = rMin;
  let previousValue = valueAt(previous);
  for (let step = 1; step <= 96; step += 1) {
    const radius = rMin * Math.pow(rMax / rMin, step / 96);
    let value: number;
    try { value = valueAt(radius); } catch { previous = radius; previousValue = Number.NaN; continue; }
    if (Number.isFinite(previousValue) && (previousValue - target) * (value - target) <= 0) {
      let lo = previous;
      let hi = radius;
      let loValue = previousValue;
      for (let iteration = 0; iteration < 80; iteration += 1) {
        const mid = (lo + hi) / 2;
        const midValue = valueAt(mid);
        if ((loValue - target) * (midValue - target) <= 0) hi = mid;
        else { lo = mid; loValue = midValue; }
      }
      return (lo + hi) / 2;
    }
    previous = radius;
    previousValue = value;
  }
  return invalid("sampleDomain", "dipole equipotential does not stay inside the supplied sample domain");
}
function equipotential(inputs: Record<string, unknown>, context: DipoleFieldEvaluationContext): DipoleGeometry[] {
  rejectProjectedAngle(inputs);
  rejectDensityClaim(inputs);
  const k = coefficient(inputs.k, context);
  const V = numberValue(inputs.V, "V", context);
  if (inputs.source === "point_charge") {
    if (inputs.charges !== undefined || inputs.sampleDomain !== undefined) invalid("source", "point-charge equipotential uses charge and V");
    return [circleEquipotential(chargeRecord(inputs.charge, "charge", context, false), V, k, sampleCount(inputs.samples, 16, context))];
  }
  if (inputs.source === "dipole") {
    if (inputs.charge !== undefined) invalid("source", "dipole equipotential uses the two dipole charges");
    if (V === 0 && inputs.sampleDomain === undefined) {
      invalid("V", "V=0 for a dipole is the entire perpendicular bisector; supply a bounded sampleDomain to draw a portion");
    }
    const box = domainValue(inputs.sampleDomain, context);
    return [dipoleContour(chargeList(inputs.charges, "charges", context, false, 2), V, k, box, sampleCount(inputs.samples, 48, context))];
  }
  return invalid("source", "equipotential source must be point_charge or dipole");
}

/** k is an explicit input. Display length never enters E, F, tau, U, or V. */
export function evaluateDipoleFieldConstruction(operator: string, inputs: Record<string, unknown>, context: DipoleFieldEvaluationContext): DipoleGeometry[] {
  if (!isOperator(operator)) invalid("operator", `unsupported dipole-field operator ${operator}`);
  if (!isRecord(inputs)) invalid("fields", "dipole-field inputs must be an object");
  if (TEST_CHARGE_KEYS.some((key) => key in inputs)) invalid("testCharge", "the electric field of a source charge does not accept a test charge");
  rejectProjectedAngle(inputs);
  rejectDensityClaim(inputs);
  if (GRADIENT_KEYS.some((key) => key in inputs)) rejectNonuniform(inputs);
  rejectKeys(inputs, INPUT_KEYS[operator]);
  if (operator === "coulomb_pair") return coulombPair(inputs, context);
  if (operator === "point_charge_field") return pointChargeField(inputs, context);
  if (operator === "field_lines") return fieldLines(inputs, context);
  if (operator === "dipole_field") return dipoleField(inputs, context);
  if (operator === "dipole_torque") return dipoleTorque(inputs, context);
  if (operator === "equipotential") return equipotential(inputs, context);
  return dipoleEnergy(inputs, context);
}

class DeferredDipolePoint extends DipoleFieldInputError {
  constructor() { super("point", "derived point coordinates will be verified during compilation"); }
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > MAX_SCALAR_DEPTH || seen.has(value)) invalid("quantity", "cyclic or overdeep numeric quantity reference");
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isRecord(value) && "value" in value) { seen.add(value); return validationNumber(value.value, document, seen, depth + 1); }
  if (typeof value === "string" && value.trim()) {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) { seen.add(value); return validationNumber(quantity.value, document, seen, depth + 1); }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return invalid("quantity", "a numeric input must resolve to a finite scalar");
}
function expectedEntityKind(operator: DipoleOperator, inputs: Record<string, unknown>): string {
  if (operator === "field_lines") return "polyline";
  if (operator === "equipotential") return inputs.source === "point_charge" ? "circle" : "polyline";
  return "vector";
}

export function dipoleConstructionOutputLabels(operator: string, outputs: readonly unknown[]): string[] {
  if (!isOperator(operator)) throw new Error("dipole labels require a dipole-field operator");
  return outputs.map((output, index) => {
    if (!isDipoleGeometry(output) || output.dipoleField.operator !== operator) throw new Error("dipole label metadata is missing or inconsistent");
    return dipoleLabel(output.dipoleField, index);
  });
}
function isDipoleGeometry(value: unknown): value is DipoleGeometry {
  return isRecord(value) && isRecord(value.dipoleField) && typeof value.dipoleField.operator === "string";
}
function compactDipoleNumber(value: number): string {
  if (!Number.isFinite(value)) return "invalid";
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
function dipoleLabel(meta: DipoleFieldMetadata, index: number): string {
  if (meta.operator === "coulomb_pair") {
    const force = meta.forces?.[index];
    return force ? `F=${compactDipoleNumber(Math.hypot(force.x, force.y))}` : "F";
  }
  if (meta.operator === "point_charge_field" || meta.operator === "dipole_field") {
    return meta.magnitude === undefined ? "E" : `E=${compactDipoleNumber(meta.magnitude)}`;
  }
  if (meta.operator === "dipole_torque") return meta.tau === undefined ? "tau" : `tau=${compactDipoleNumber(meta.tau)}`;
  if (meta.operator === "dipole_energy") return meta.U === undefined ? "U" : `U=${compactDipoleNumber(meta.U)}`;
  if (meta.operator === "field_lines") return "field lines";
  return meta.V === undefined ? "V" : `V=${compactDipoleNumber(meta.V)}`;
}

/** Fatal issues only. A thrown evaluation becomes a fatal issue and contributes no geometry. */
export function validateDipoleFieldConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  const { operator, inputs } = construction;
  if (!isOperator(operator)) return;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const add = (key: string, message: string, actual?: unknown): void => {
    issues.push({
      code: `invalid_${operator}_${key}`,
      message,
      severity: "fatal",
      path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`,
      entityIds: outputs.filter((id): id is string => typeof id === "string"),
      actual,
    });
  };
  const count = operator === "coulomb_pair" ? 2 : 1;
  if (outputs.length !== count || outputs.some((id) => typeof id !== "string" || !id.trim()) || new Set(outputs).size !== outputs.length) {
    add("outputs", `${operator} requires exactly ${count} distinct output entities`, construction.outputs);
  }
  if (!isRecord(inputs)) { add("fields", "dipole-field inputs must be an object", inputs); return; }
  const kind = expectedEntityKind(operator, inputs);
  for (const id of outputs) {
    const entity = document.entities.find((candidate) => candidate.id === id);
    if (entity?.kind !== kind) add("output_kind", `${operator} outputs must be ${kind} entities`, entity?.kind);
  }
  const context: DipoleFieldEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      if (typeof value !== "string") return pointValue(value, "point", context);
      const producer = constructionByOutput.get(value);
      const entity = document.entities.find((candidate) => candidate.id === value);
      if (!producer || entity?.kind !== "point") invalid("point", "dipole-field positions must name constructed point entities");
      if (producer.operator !== "point") throw new DeferredDipolePoint();
      return finitePoint({ x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) }, "point");
    },
    geometry(value) {
      if (typeof value !== "string") return undefined;
      const producer = constructionByOutput.get(value);
      const entity = document.entities.find((candidate) => candidate.id === value);
      if (!producer || entity?.kind !== "point" || producer.operator !== "point") return undefined;
      return { kind: "point", point: { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) } };
    },
  };
  try {
    evaluateDipoleFieldConstruction(operator, inputs, context);
  } catch (error) {
    if (error instanceof DeferredDipolePoint) return;
    add(error instanceof DipoleFieldInputError ? error.key : "fields", error instanceof Error ? error.message : "dipole-field inputs are invalid");
  }
}
