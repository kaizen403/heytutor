import { validatePublicationDerivedClaims, type PublicationClaimAuthority } from "./publicationDerivedClaims";
import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

/**
 * CH-07a rigid-mass operators. Inertia and continuous centres come from a
 * composite Simpson density integral. Textbook closed forms are not returned
 * from here; the verifier owns those oracles.
 */
export const RIGID_MASS_OPERATORS = [
  "centre_of_mass",
  "com_motion",
  "point_mass_inertia",
  "simple_body_inertia",
  "axes_theorem",
] as const;

export type RigidMassOperator = (typeof RIGID_MASS_OPERATORS)[number];

const LINE_INTERVALS = 128;
const RADIAL_INTERVALS = 48;
const ANGULAR_INTERVALS = 128;
const AXIAL_INTERVALS = 32;
const QUADRATURE_TOLERANCE = 1e-6;
const MAX_PARTS = 16;
const MAX_FORCES = 16;
const CAP_SEGMENTS = 48;
const MAX_SCALAR_DEPTH = 32;

const LENGTH_CANON = new Map<string, string>([
  ["m", "m"], ["meter", "m"], ["meters", "m"], ["metre", "m"], ["metres", "m"],
  ["cm", "cm"], ["centimeter", "cm"], ["centimetre", "cm"],
  ["mm", "mm"], ["millimeter", "mm"], ["millimetre", "mm"],
  ["km", "km"], ["kilometer", "km"], ["kilometre", "km"],
]);

const TOPIC_ID: Record<RigidMassOperator, string> = {
  centre_of_mass: "physics|5|centre-of-mass",
  com_motion: "physics|5|motion-of-centre-of-mass",
  point_mass_inertia: "physics|5|moment-of-inertia-and-radius-of-gyration",
  simple_body_inertia: "physics|5|moments-of-inertia-for-simple-objects",
  axes_theorem: "physics|5|axes-theorems",
};

const EXAM_SCOPE = {
  centre_of_mass: { main: "listed", advanced: "listed", neet: "listed" },
  com_motion: { main: "application", advanced: "listed", neet: "application" },
  point_mass_inertia: { main: "listed", advanced: "application", neet: "listed" },
  simple_body_inertia: { main: "listed", advanced: "listed", neet: "listed" },
  axes_theorem: { main: "listed", advanced: "listed", neet: "listed" },
} as const;

export interface RigidMassQuadrature {
  method: "composite_simpson";
  intervals: number;
  step: number;
  tolerance: number;
}

export interface RigidMassRecord {
  operator: RigidMassOperator;
  topicId: string;
  examScope: { main: "listed" | "application"; advanced: "listed" | "application"; neet: "listed" | "application" };
  mass: number;
  lengthUnit: string;
  displayLength: number;
  mark: "body" | "hole" | "mass" | "centre" | "acceleration" | "offset" | "lamina";
  reduction?: "weighted_sum" | "mass_integral" | "external_force_sum" | "parallel_axis" | "perpendicular_axis";
  centre?: RenderPoint;
  centreRelative?: RenderPoint;
  axisOrigin?: RenderPoint;
  axisThrough?: RenderPoint;
  axis?: { orientation: string; place?: string; end?: string };
  inertia?: number;
  kSquared?: number;
  radiusOfGyration?: number;
  acceleration?: RenderPoint;
  externalForceSum?: RenderPoint;
  quadrature?: RigidMassQuadrature;
  theorem?: "parallel" | "perpendicular";
  iCom?: number;
  ix?: number;
  iy?: number;
  offsetDistance?: number;
  holeMass?: number;
  positiveMass?: number;
  bodyKind?: string;
  requestedKind?: string;
  partKind?: string;
  lamina?: boolean;
}

export type RigidMassGeometry =
  | { kind: "point"; point: RenderPoint; rigidMass: RigidMassRecord }
  | { kind: "path"; points: RenderPoint[]; directed?: boolean; closed?: boolean; rigidMass: RigidMassRecord }
  | { kind: "circle"; center: RenderPoint; radius: number; rigidMass: RigidMassRecord }
  | { kind: "multi_path"; paths: RenderPoint[][]; rigidMass: RigidMassRecord };

export interface RigidMassEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry(value: unknown): unknown;
}

type BodyKind = "point" | "uniform_rod" | "thin_ring" | "disc" | "solid_cylinder" | "solid_sphere" | "thin_spherical_shell";
type Dist = (x: number, y: number, z: number) => number;

interface NormalizedPart {
  requested: string;
  kind: BodyKind;
  mass: number;
  hole: boolean;
  center: RenderPoint;
  length: number;
  radius: number;
  height: number;
  angle: number;
}

interface Moments {
  mass: number;
  mx: number;
  my: number;
  inertia: number;
}

interface Sample {
  centre: RenderPoint;
  inertia: number;
  quadrature?: RigidMassQuadrature;
}

const BODY_KINDS = new Map<string, BodyKind>([
  ["point", "point"],
  ["uniform_rod", "uniform_rod"],
  ["thin_ring", "thin_ring"],
  ["hoop", "thin_ring"],
  ["disc", "disc"],
  ["solid_cylinder", "solid_cylinder"],
  ["solid_sphere", "solid_sphere"],
  ["thin_spherical_shell", "thin_spherical_shell"],
]);

const PLANAR_LAMINA = new Set(["planar_lamina", "disc", "thin_ring", "hoop", "uniform_rod"]);

export class RigidMassInputError extends Error {
  constructor(readonly key: string, message: string) {
    super(message);
    this.name = "RigidMassInputError";
  }
}

function invalid(key: string, message: string): never {
  throw new RigidMassInputError(key, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOperator(operator: string): operator is RigidMassOperator {
  return (RIGID_MASS_OPERATORS as readonly string[]).includes(operator);
}

function inputKeys(inputs: Record<string, unknown>, allowed: readonly string[], key = "fields"): void {
  const unexpected = Object.keys(inputs).filter((name) => !allowed.includes(name));
  if (unexpected.length > 0) invalid(key, `unsupported inputs: ${unexpected.join(", ")}`);
}

function numberValue(value: unknown, key: string, context: RigidMassEvaluationContext): number {
  let scalar = value;
  const seen = new Set<unknown>();
  for (let depth = 0; isRecord(scalar); depth += 1) {
    if (depth >= MAX_SCALAR_DEPTH || seen.has(scalar) || !("value" in scalar)) invalid(key, `${key} must be a finite scalar`);
    inputKeys(scalar, ["value", "unit"], key);
    if ("unit" in scalar && (typeof scalar.unit !== "string" || !scalar.unit.trim())) invalid(key, `${key} unit must be a nonempty string`);
    seen.add(scalar);
    scalar = scalar.value;
  }
  if (typeof scalar !== "number" && typeof scalar !== "string") invalid(key, `${key} must be a finite scalar`);
  if (typeof scalar === "string" && !scalar.trim()) invalid(key, `${key} must be a finite scalar`);
  let number: number;
  try {
    number = context.number(scalar);
  } catch (error) {
    if (error instanceof RigidMassInputError) throw error;
    return invalid(key, `${key} must resolve to a finite number`);
  }
  if (!Number.isFinite(number)) invalid(key, `${key} must resolve to a finite number`);
  return number;
}

function positive(value: number, key: string): number {
  if (!(value > 0)) invalid(key, `${key} must be positive and finite`);
  return value;
}

function finitePoint(point: RenderPoint, key: string): RenderPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) invalid(key, `${key} must resolve to a finite point`);
  return { x: point.x, y: point.y };
}

function readPoint(value: unknown, key: string, context: RigidMassEvaluationContext): RenderPoint {
  if (isRecord(value)) {
    inputKeys(value, ["x", "y"], key);
    return finitePoint({ x: numberValue(value.x, `${key}.x`, context), y: numberValue(value.y, `${key}.y`, context) }, key);
  }
  if (Array.isArray(value)) {
    if (value.length !== 2) invalid(key, `${key} must contain exactly two coordinates`);
    return finitePoint({ x: numberValue(value[0], `${key}.x`, context), y: numberValue(value[1], `${key}.y`, context) }, key);
  }
  if (typeof value !== "string" || !value.trim()) invalid(key, `${key} must be a finite point`);
  const found = context.geometry(value);
  if (isRecord(found) && ("space" in found || "world3D" in found || "spaceFrameId" in found)) {
    invalid(key, "rigid-mass geometry uses the declared planar metric, not a projected 3D point");
  }
  try {
    return finitePoint(context.point(value), key);
  } catch (error) {
    if (error instanceof RigidMassInputError) throw error;
    return invalid(key, `${key} must resolve to a finite point`);
  }
}

function collectUnits(value: unknown, out: string[], depth = 0): void {
  if (depth > MAX_SCALAR_DEPTH || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectUnits(item, out, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.unit === "string") out.push(record.unit);
  for (const [key, item] of Object.entries(record)) {
    if (key !== "unit") collectUnits(item, out, depth + 1);
  }
}

function metricOf(inputs: Record<string, unknown>): string {
  const embedded: string[] = [];
  collectUnits(inputs, embedded);
  const declared = inputs.lengthUnit;
  if (declared === undefined) {
    for (const unit of embedded) {
      if (LENGTH_CANON.get(unit.trim()) !== "m") invalid("lengthUnit", "a non-metre length unit must be declared as lengthUnit");
    }
    return "m";
  }
  if (typeof declared !== "string" || !LENGTH_CANON.has(declared.trim())) invalid("lengthUnit", "lengthUnit must name the world length metric");
  const canon = LENGTH_CANON.get(declared.trim())!;
  for (const unit of embedded) {
    if (LENGTH_CANON.get(unit.trim()) !== canon) invalid("lengthUnit", "embedded length units must match the declared metric; values are not silently converted");
  }
  return canon;
}

function simpsonWeight(index: number, intervals: number): number {
  if (index === 0 || index === intervals) return 1;
  return index % 2 === 0 ? 2 : 4;
}

function declaredQuadrature(intervals: number, step: number): RigidMassQuadrature {
  return { method: "composite_simpson", intervals, step, tolerance: QUADRATURE_TOLERANCE };
}

function emptyMoments(): Moments {
  return { mass: 0, mx: 0, my: 0, inertia: 0 };
}

function accumulate(moments: Moments, x: number, y: number, dm: number, dist2: number): void {
  moments.mass += dm;
  moments.mx += x * dm;
  moments.my += y * dm;
  moments.inertia += dist2 * dm;
}

function finishSample(part: NormalizedPart, moments: Moments, quadrature: RigidMassQuadrature, key: string): Sample {
  const scale = Math.max(1, Math.abs(part.mass));
  if (!Number.isFinite(moments.mass) || Math.abs(moments.mass - part.mass) > QUADRATURE_TOLERANCE * scale) {
    invalid(key, `density quadrature missed the supplied mass (recovered ${moments.mass}, supplied ${part.mass})`);
  }
  if (!Number.isFinite(moments.mx) || !Number.isFinite(moments.my) || !Number.isFinite(moments.inertia)) {
    invalid(key, "mass quadrature is non-finite");
  }
  const centre = { x: moments.mx / moments.mass, y: moments.my / moments.mass };
  if (!Number.isFinite(centre.x) || !Number.isFinite(centre.y)) invalid(key, "centre quadrature is non-finite");
  return { centre, inertia: moments.inertia, quadrature };
}

function sampleRod(part: NormalizedPart, dist2: Dist, key: string): Sample {
  const moments = emptyMoments();
  const intervals = LINE_INTERVALS;
  const step = part.length / intervals;
  const lambda = part.mass / part.length;
  const along = Math.cos(part.angle);
  const across = Math.sin(part.angle);
  const start = -part.length / 2;
  for (let index = 0; index <= intervals; index += 1) {
    const t = start + index * step;
    const dm = lambda * (step / 3) * simpsonWeight(index, intervals);
    const x = part.center.x + t * along;
    const y = part.center.y + t * across;
    accumulate(moments, x, y, dm, dist2(x, y, 0));
  }
  return finishSample(part, moments, declaredQuadrature(intervals, step), key);
}

function sampleRing(part: NormalizedPart, dist2: Dist, key: string): Sample {
  const moments = emptyMoments();
  const intervals = ANGULAR_INTERVALS;
  const step = (2 * Math.PI) / intervals;
  const lambda = part.mass / (2 * Math.PI);
  for (let index = 0; index <= intervals; index += 1) {
    const theta = index * step;
    const dm = lambda * (step / 3) * simpsonWeight(index, intervals);
    const x = part.center.x + part.radius * Math.cos(theta);
    const y = part.center.y + part.radius * Math.sin(theta);
    accumulate(moments, x, y, dm, dist2(x, y, 0));
  }
  return finishSample(part, moments, declaredQuadrature(intervals, step), key);
}

function sampleDisc(part: NormalizedPart, dist2: Dist, key: string): Sample {
  const moments = emptyMoments();
  const radial = RADIAL_INTERVALS;
  const angular = ANGULAR_INTERVALS;
  const hr = part.radius / radial;
  const ht = (2 * Math.PI) / angular;
  const sigma = part.mass / (Math.PI * part.radius * part.radius);
  for (let i = 0; i <= radial; i += 1) {
    const r = i * hr;
    const wr = simpsonWeight(i, radial);
    for (let j = 0; j <= angular; j += 1) {
      const theta = j * ht;
      const dm = sigma * r * wr * simpsonWeight(j, angular) * hr * ht / 9;
      const x = part.center.x + r * Math.cos(theta);
      const y = part.center.y + r * Math.sin(theta);
      accumulate(moments, x, y, dm, dist2(x, y, 0));
    }
  }
  return finishSample(part, moments, declaredQuadrature(angular, Math.min(hr, ht)), key);
}

function sampleCylinder(part: NormalizedPart, dist2: Dist, key: string): Sample {
  const moments = emptyMoments();
  const radial = RADIAL_INTERVALS;
  const angular = ANGULAR_INTERVALS;
  const axial = AXIAL_INTERVALS;
  const hr = part.radius / radial;
  const ht = (2 * Math.PI) / angular;
  const hz = part.height / axial;
  const rho = part.mass / (Math.PI * part.radius * part.radius * part.height);
  const z0 = -part.height / 2;
  for (let i = 0; i <= radial; i += 1) {
    const r = i * hr;
    const wr = simpsonWeight(i, radial);
    for (let j = 0; j <= angular; j += 1) {
      const theta = j * ht;
      const wt = simpsonWeight(j, angular);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      for (let k = 0; k <= axial; k += 1) {
        const z = z0 + k * hz;
        const dm = rho * r * wr * wt * simpsonWeight(k, axial) * hr * ht * hz / 27;
        const x = part.center.x + r * cos;
        const y = part.center.y + r * sin;
        accumulate(moments, x, y, dm, dist2(x, y, z));
      }
    }
  }
  return finishSample(part, moments, declaredQuadrature(angular, Math.min(hr, ht, hz)), key);
}

function sampleSphere(part: NormalizedPart, dist2: Dist, key: string): Sample {
  const moments = emptyMoments();
  const radial = RADIAL_INTERVALS;
  const polar = ANGULAR_INTERVALS;
  const angular = ANGULAR_INTERVALS;
  const hr = part.radius / radial;
  const hp = Math.PI / polar;
  const ht = (2 * Math.PI) / angular;
  const rho = part.mass / ((4 / 3) * Math.PI * part.radius ** 3);
  for (let i = 0; i <= radial; i += 1) {
    const r = i * hr;
    const wr = simpsonWeight(i, radial);
    const r2 = r * r;
    for (let j = 0; j <= polar; j += 1) {
      const phi = j * hp;
      const wp = simpsonWeight(j, polar);
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      for (let k = 0; k <= angular; k += 1) {
        const theta = k * ht;
        const dm = rho * r2 * sinPhi * wr * wp * simpsonWeight(k, angular) * hr * hp * ht / 27;
        const x = part.center.x + r * sinPhi * Math.cos(theta);
        const y = part.center.y + r * sinPhi * Math.sin(theta);
        accumulate(moments, x, y, dm, dist2(x, y, r * cosPhi));
      }
    }
  }
  return finishSample(part, moments, declaredQuadrature(polar, Math.min(hr, hp, ht)), key);
}

function sampleShell(part: NormalizedPart, dist2: Dist, key: string): Sample {
  const moments = emptyMoments();
  const polar = ANGULAR_INTERVALS;
  const angular = ANGULAR_INTERVALS;
  const hp = Math.PI / polar;
  const ht = (2 * Math.PI) / angular;
  const sigma = part.mass / (4 * Math.PI * part.radius * part.radius);
  const area = part.radius * part.radius;
  for (let j = 0; j <= polar; j += 1) {
    const phi = j * hp;
    const wp = simpsonWeight(j, polar);
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let k = 0; k <= angular; k += 1) {
      const theta = k * ht;
      const dm = sigma * area * sinPhi * wp * simpsonWeight(k, angular) * hp * ht / 9;
      const x = part.center.x + part.radius * sinPhi * Math.cos(theta);
      const y = part.center.y + part.radius * sinPhi * Math.sin(theta);
      accumulate(moments, x, y, dm, dist2(x, y, part.radius * cosPhi));
    }
  }
  return finishSample(part, moments, declaredQuadrature(polar, Math.min(hp, ht)), key);
}

function samplePart(part: NormalizedPart, dist2: Dist, key: string): Sample {
  if (part.kind === "point") {
    return { centre: { ...part.center }, inertia: part.mass * dist2(part.center.x, part.center.y, 0) };
  }
  if (part.kind === "uniform_rod") return sampleRod(part, dist2, key);
  if (part.kind === "thin_ring") return sampleRing(part, dist2, key);
  if (part.kind === "disc") return sampleDisc(part, dist2, key);
  if (part.kind === "solid_cylinder") return sampleCylinder(part, dist2, key);
  if (part.kind === "solid_sphere") return sampleSphere(part, dist2, key);
  return sampleShell(part, dist2, key);
}

function aboutPoint(through: RenderPoint): Dist {
  return (x, y) => {
    const dx = x - through.x;
    const dy = y - through.y;
    return dx * dx + dy * dy;
  };
}

function aboutDiameter(part: NormalizedPart): Dist {
  if (part.kind === "solid_sphere" || part.kind === "thin_spherical_shell") return aboutPoint(part.center);
  const cy = part.center.y;
  return (_x, y, z) => {
    const dy = y - cy;
    return dy * dy + z * z;
  };
}

function endpoint(part: NormalizedPart, which: "negative" | "positive"): RenderPoint {
  const sign = which === "positive" ? 1 : -1;
  const half = part.length / 2;
  return {
    x: part.center.x + sign * half * Math.cos(part.angle),
    y: part.center.y + sign * half * Math.sin(part.angle),
  };
}

function assertPhysicalTotal(parts: readonly NormalizedPart[], key: string): void {
  if (parts.length < 1 || parts.length > MAX_PARTS) invalid(key, `expected 1 to ${MAX_PARTS} mass parts`);
  let total = 0;
  let positive = 0;
  let hole = 0;
  for (const part of parts) {
    total += part.mass;
    if (part.hole) hole += part.mass;
    else positive += part.mass;
  }
  if (!Number.isFinite(total) || !(total > 0)) {
    if (positive > 0 && -hole > positive) invalid(key, "a hole larger than the remaining mass is not a physical body");
    invalid(key, "total mass must be positive");
  }
}

interface CombinedMass {
  mass: number;
  centre: RenderPoint;
  inertia: number;
  quadrature?: RigidMassQuadrature;
  holeMass: number;
  positiveMass: number;
}

function combine(parts: readonly NormalizedPart[], distFor: (part: NormalizedPart) => Dist, key: string, wantInertia: boolean): CombinedMass {
  assertPhysicalTotal(parts, key);
  let mass = 0;
  let mx = 0;
  let my = 0;
  let inertia = 0;
  let holeMass = 0;
  let positiveMass = 0;
  let step = Number.POSITIVE_INFINITY;
  let intervals = 0;
  let integrated = false;
  for (const part of parts) {
    const sample = samplePart(part, wantInertia ? distFor(part) : () => 0, key);
    mass += part.mass;
    mx += part.mass * sample.centre.x;
    my += part.mass * sample.centre.y;
    inertia += sample.inertia;
    if (part.hole) holeMass += part.mass;
    else positiveMass += part.mass;
    if (sample.quadrature) {
      integrated = true;
      step = Math.min(step, sample.quadrature.step);
      intervals = Math.max(intervals, sample.quadrature.intervals);
    }
  }
  if (wantInertia) {
    if (!Number.isFinite(inertia)) invalid(key, "inertia quadrature is non-finite");
    if (inertia < 0) {
      if (Math.abs(inertia) <= 1e-9 * Math.max(1, mass)) inertia = 0;
      else invalid(key, "the signed mass distribution does not have a positive moment about the stated axis");
    }
  }
  const centre = { x: mx / mass, y: my / mass };
  if (!Number.isFinite(centre.x) || !Number.isFinite(centre.y)) invalid(key, "centre of mass is non-finite");
  return {
    mass,
    centre,
    inertia: wantInertia ? inertia : 0,
    quadrature: integrated ? declaredQuadrature(intervals, step) : undefined,
    holeMass,
    positiveMass,
  };
}

function gyration(inertia: number, mass: number): { kSquared: number; radiusOfGyration: number } {
  const kSquared = inertia / mass;
  if (!Number.isFinite(kSquared) || kSquared < 0) invalid("mass", "radius of gyration is undefined for this mass distribution");
  return { kSquared, radiusOfGyration: Math.sqrt(kSquared) };
}

function canonicalKind(value: unknown, key: string): { requested: string; kind: BodyKind } {
  if (typeof value !== "string" || !value.trim()) invalid(key, "mass distribution is unspecified");
  const requested = value.trim();
  const kind = BODY_KINDS.get(requested);
  if (!kind) invalid(key, "mass distribution is unspecified; name uniform_rod, thin_ring, hoop, disc, solid_cylinder, solid_sphere, or thin_spherical_shell");
  return { requested, kind };
}

function partKeyList(kind: BodyKind): readonly string[] {
  if (kind === "point") return ["kind", "mass", "at", "hole"];
  if (kind === "uniform_rod") return ["kind", "mass", "length", "center", "angle", "hole"];
  if (kind === "solid_cylinder") return ["kind", "mass", "radius", "height", "center", "hole"];
  return ["kind", "mass", "radius", "center", "hole"];
}

function operatorKeyList(kind: BodyKind): readonly string[] {
  const common = ["kind", "axis", "displayLength", "lengthUnit"];
  if (kind === "uniform_rod") return [...common, "mass", "length", "center", "angle"];
  if (kind === "solid_cylinder") return [...common, "mass", "radius", "height", "center"];
  return [...common, "mass", "radius", "center"];
}

function readHole(source: Record<string, unknown>): boolean {
  if (source.hole === undefined) return false;
  if (typeof source.hole !== "boolean") invalid("hole", "hole must be a boolean");
  return source.hole;
}

function readPartMass(source: Record<string, unknown>, hole: boolean, key: string, context: RigidMassEvaluationContext): number {
  const mass = numberValue(source.mass, key, context);
  if (hole) {
    if (!(mass < 0)) invalid(key, "a hole subtracts mass; its mass must be negative");
    return mass;
  }
  if (!(mass > 0)) invalid(key, "mass must be positive unless the part is an explicit hole");
  return mass;
}

function readAngle(source: Record<string, unknown>, context: RigidMassEvaluationContext): number {
  if (source.angle === undefined) return 0;
  return numberValue(source.angle, "angle", context);
}

function parsePart(value: unknown, key: string, context: RigidMassEvaluationContext): NormalizedPart {
  if (!isRecord(value)) invalid(key, "each mass part must be an object");
  const { requested, kind } = canonicalKind(value.kind, `${key}.kind`);
  inputKeys(value, partKeyList(kind), key);
  const hole = readHole(value);
  const mass = readPartMass(value, hole, `${key}.mass`, context);
  if (kind === "point") {
    return { requested, kind, mass, hole, center: readPoint(value.at, `${key}.at`, context), length: 0, radius: 0, height: 0, angle: 0 };
  }
  const center = readPoint(value.center, `${key}.center`, context);
  const length = kind === "uniform_rod" ? positive(numberValue(value.length, `${key}.length`, context), `${key}.length`) : 0;
  const radius = kind === "uniform_rod" ? 0 : positive(numberValue(value.radius, `${key}.radius`, context), `${key}.radius`);
  const height = kind === "solid_cylinder" ? positive(numberValue(value.height, `${key}.height`, context), `${key}.height`) : 0;
  const angle = kind === "uniform_rod" ? readAngle(value, context) : 0;
  return { requested, kind, mass, hole, center, length, radius, height, angle };
}

function readPartList(value: unknown, key: string, context: RigidMassEvaluationContext): NormalizedPart[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PARTS) invalid(key, `expected 1 to ${MAX_PARTS} mass parts`);
  return value.map((item, index) => parsePart(item, `${key}[${index}]`, context));
}

function readMassItems(value: unknown, context: RigidMassEvaluationContext): NormalizedPart[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PARTS) invalid("masses", `expected 1 to ${MAX_PARTS} point masses`);
  return value.map((item, index) => {
    const key = `masses[${index}]`;
    if (!isRecord(item)) invalid(key, "each point mass needs mass and at");
    inputKeys(item, ["mass", "at", "hole"], key);
    const hole = readHole(item);
    return {
      requested: "point",
      kind: "point",
      mass: readPartMass(item, hole, `${key}.mass`, context),
      hole,
      center: readPoint(item.at, `${key}.at`, context),
      length: 0,
      radius: 0,
      height: 0,
      angle: 0,
    };
  });
}

function readSingleBody(inputs: Record<string, unknown>, context: RigidMassEvaluationContext): NormalizedPart {
  if (inputs.kind === "point") invalid("kind", "point masses use point_mass_inertia");
  const { requested, kind } = canonicalKind(inputs.kind, "kind");
  if (kind === "point") invalid("kind", "point masses use point_mass_inertia");
  inputKeys(inputs, operatorKeyList(kind));
  const mass = readPartMass(inputs, false, "mass", context);
  const center = readPoint(inputs.center, "center", context);
  const length = kind === "uniform_rod" ? positive(numberValue(inputs.length, "length", context), "length") : 0;
  const radius = kind === "uniform_rod" ? 0 : positive(numberValue(inputs.radius, "radius", context), "radius");
  const height = kind === "solid_cylinder" ? positive(numberValue(inputs.height, "height", context), "height") : 0;
  const angle = kind === "uniform_rod" ? readAngle(inputs, context) : 0;
  return { requested, kind, mass, hole: false, center, length, radius, height, angle };
}

function assertSimpleAxis(part: NormalizedPart, orientation: string, place: string): void {
  if (part.kind === "uniform_rod") {
    if (orientation !== "perpendicular_to_length") invalid("axis", "a uniform rod needs an axis perpendicular to its length");
    if (place !== "centre" && place !== "end") invalid("axis", "a rod axis must pass through the centre or an end");
    return;
  }
  if (place !== "centre") invalid("axis", "this axis must pass through the body centre");
  if (part.kind === "thin_ring" || part.kind === "disc") {
    if (orientation !== "perpendicular_to_plane" && orientation !== "diameter") invalid("axis", "a ring or disc axis is the centre perpendicular to the plane, or a diameter");
    return;
  }
  if (part.kind === "solid_cylinder") {
    if (orientation !== "symmetry" && orientation !== "diameter") invalid("axis", "a solid cylinder axis is the symmetry axis or a diameter through the centre");
    return;
  }
  if (part.kind === "solid_sphere" || part.kind === "thin_spherical_shell") {
    if (orientation !== "diameter") invalid("axis", "a solid sphere or thin spherical shell is taken about a diameter");
    return;
  }
  invalid("kind", "mass distribution is unspecified");
}

interface ParsedAxis {
  orientation: string;
  place: string;
  end?: "negative" | "positive";
  through: RenderPoint;
}

function parseSingleAxis(value: unknown, part: NormalizedPart): ParsedAxis {
  if (!isRecord(value)) invalid("axis", "the inertia axis is required");
  inputKeys(value, ["orientation", "place", "end"], "axis");
  if (typeof value.orientation !== "string" || !value.orientation.trim()) invalid("axis", "the inertia axis needs an orientation");
  if (typeof value.place !== "string" || !value.place.trim()) invalid("axis", "the inertia axis needs a place");
  const orientation = value.orientation.trim();
  const place = value.place.trim();
  assertSimpleAxis(part, orientation, place);
  let end: "negative" | "positive" | undefined;
  if (value.end !== undefined) {
    if (value.end !== "negative" && value.end !== "positive") invalid("axis", "end must be negative or positive");
    if (place !== "end") invalid("axis", "end is only meaningful for an end axis");
    end = value.end;
  }
  if (place === "end" && end === undefined) invalid("axis", "an end axis must name the negative or positive end");
  const through = place === "centre" ? { ...part.center } : endpoint(part, end!);
  return { orientation, place, end, through };
}

function parseCompositeAxis(value: unknown, context: RigidMassEvaluationContext): ParsedAxis {
  if (!isRecord(value)) invalid("axis", "the inertia axis is required");
  inputKeys(value, ["orientation", "through"], "axis");
  if (value.orientation !== "perpendicular_to_plane") invalid("axis", "a composite body is integrated about one shared axis perpendicular to the plane");
  return { orientation: "perpendicular_to_plane", place: "centre", through: readPoint(value.through, "axis.through", context) };
}

function closeLoop(points: readonly RenderPoint[]): RenderPoint[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || (first.x === last.x && first.y === last.y)) return [...points];
  return [...points, { ...first }];
}

function cylinderPaths(part: NormalizedPart): RenderPoint[][] {
  const cx = part.center.x;
  const cy = part.center.y;
  const radius = part.radius;
  const half = part.height / 2;
  const side = closeLoop([
    { x: cx - radius, y: cy - half },
    { x: cx + radius, y: cy - half },
    { x: cx + radius, y: cy + half },
    { x: cx - radius, y: cy + half },
  ]);
  const cap: RenderPoint[] = [];
  for (let index = 0; index < CAP_SEGMENTS; index += 1) {
    const theta = (2 * Math.PI * index) / CAP_SEGMENTS;
    cap.push({ x: cx + radius * Math.cos(theta), y: cy + half + radius * Math.sin(theta) });
  }
  return [side, closeLoop(cap)];
}

function drawPart(part: NormalizedPart, rigidMass: RigidMassRecord): RigidMassGeometry {
  const record: RigidMassRecord = {
    ...rigidMass,
    mark: part.hole ? "hole" : part.kind === "point" ? "mass" : "body",
    partKind: part.requested,
  };
  if (part.kind === "point") return { kind: "point", point: { ...part.center }, rigidMass: record };
  if (part.kind === "uniform_rod") return { kind: "path", points: [endpoint(part, "negative"), endpoint(part, "positive")], rigidMass: record };
  if (part.kind === "solid_cylinder") return { kind: "multi_path", paths: cylinderPaths(part), rigidMass: record };
  return { kind: "circle", center: { ...part.center }, radius: part.radius, rigidMass: record };
}

function baseRecord(operator: RigidMassOperator, mass: number, lengthUnit: string, displayLength: number, mark: RigidMassRecord["mark"]): RigidMassRecord {
  return {
    operator,
    topicId: TOPIC_ID[operator],
    examScope: { ...EXAM_SCOPE[operator] },
    mass,
    lengthUnit,
    displayLength,
    mark,
  };
}

function displayLengthOf(inputs: Record<string, unknown>, context: RigidMassEvaluationContext): number {
  return positive(numberValue(inputs.displayLength, "displayLength", context), "displayLength");
}

function evaluateCentre(inputs: Record<string, unknown>, context: RigidMassEvaluationContext): RigidMassGeometry[] {
  inputKeys(inputs, ["parts", "axis", "displayLength", "lengthUnit"]);
  const lengthUnit = metricOf(inputs);
  const displayLength = displayLengthOf(inputs, context);
  if (!isRecord(inputs.axis)) invalid("axis", "the source axis origin is required");
  inputKeys(inputs.axis, ["origin"], "axis");
  const origin = readPoint(inputs.axis.origin, "axis.origin", context);
  const parts = readPartList(inputs.parts, "parts", context);
  const combined = combine(parts, () => () => 0, "parts", false);
  const record: RigidMassRecord = {
    ...baseRecord("centre_of_mass", combined.mass, lengthUnit, displayLength, "centre"),
    reduction: combined.quadrature ? "mass_integral" : "weighted_sum",
    centre: combined.centre,
    centreRelative: { x: combined.centre.x - origin.x, y: combined.centre.y - origin.y },
    axisOrigin: origin,
    holeMass: combined.holeMass,
    positiveMass: combined.positiveMass,
    quadrature: combined.quadrature,
    bodyKind: parts.length === 1 ? parts[0]!.kind : "composite",
  };
  return [
    ...parts.map((part) => drawPart(part, record)),
    { kind: "point", point: { ...combined.centre }, rigidMass: { ...record, mark: "centre" } },
  ];
}

function readId(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(key, `${key} must be a nonempty id`);
  return value.trim();
}

interface Force {
  id: string;
  fx: number;
  fy: number;
}

function readExternalForces(value: unknown, context: RigidMassEvaluationContext): Force[] {
  if (!Array.isArray(value) || value.length > MAX_FORCES) invalid("externalForces", "externalForces must be an explicit list");
  const ids = new Set<string>();
  return value.map((item, index) => {
    const key = `externalForces[${index}]`;
    if (!isRecord(item)) invalid(key, "each external force needs id, fx, and fy");
    if ("internal" in item) invalid("externalForces", "a force marked internal cannot be added to the external sum");
    inputKeys(item, ["id", "fx", "fy"], key);
    const id = readId(item.id, `${key}.id`);
    if (ids.has(id)) invalid("externalForces", "force ids must be unique");
    ids.add(id);
    return { id, fx: numberValue(item.fx, `${key}.fx`, context), fy: numberValue(item.fy, `${key}.fy`, context) };
  });
}

function readInternalPairs(value: unknown, context: RigidMassEvaluationContext): Array<{ id?: string; members: [Force, Force] }> {
  if (!Array.isArray(value) || value.length > MAX_FORCES) invalid("internalPairs", "internalPairs must be an explicit list");
  const ids = new Set<string>();
  return value.map((item, index) => {
    const key = `internalPairs[${index}]`;
    if (!isRecord(item)) invalid(key, "each internal pair needs two cancelling members");
    inputKeys(item, ["id", "members"], key);
    let id: string | undefined;
    if (item.id !== undefined) {
      id = readId(item.id, `${key}.id`);
      if (ids.has(id)) invalid("internalPairs", "force ids must be unique");
      ids.add(id);
    }
    if (!Array.isArray(item.members) || item.members.length !== 2) invalid("internalPairs", "an internal pair has exactly two members");
    const members = item.members.map((member, memberIndex) => {
      const memberKey = `${key}.members[${memberIndex}]`;
      if (!isRecord(member)) invalid(memberKey, "each member needs id, fx, and fy");
      inputKeys(member, ["id", "fx", "fy"], memberKey);
      const memberId = readId(member.id, `${memberKey}.id`);
      if (ids.has(memberId)) invalid("internalPairs", "force ids must be unique");
      ids.add(memberId);
      return { id: memberId, fx: numberValue(member.fx, `${memberKey}.fx`, context), fy: numberValue(member.fy, `${memberKey}.fy`, context) };
    });
    const [first, second] = members;
    if (!first || !second) invalid("internalPairs", "an internal pair has exactly two members");
    const scale = 1 + Math.abs(first.fx) + Math.abs(first.fy) + Math.abs(second.fx) + Math.abs(second.fy);
    if (Math.abs(first.fx + second.fx) > 1e-9 * scale || Math.abs(first.fy + second.fy) > 1e-9 * scale) {
      invalid("internalPairs", "an internal pair must cancel");
    }
    return { id, members: [first, second] };
  });
}

function evaluateMotion(inputs: Record<string, unknown>, context: RigidMassEvaluationContext): RigidMassGeometry[] {
  inputKeys(inputs, ["mass", "com", "externalForces", "internalPairs", "displayLength", "lengthUnit"]);
  const lengthUnit = metricOf(inputs);
  const displayLength = displayLengthOf(inputs, context);
  const mass = numberValue(inputs.mass, "mass", context);
  if (!(mass > 0)) invalid("mass", "mass must be positive");
  const com = readPoint(inputs.com, "com", context);
  const external = readExternalForces(inputs.externalForces, context);
  const pairs = readInternalPairs(inputs.internalPairs, context);
  const internalIds = new Set<string>();
  for (const pair of pairs) {
    if (pair.id) internalIds.add(pair.id);
    internalIds.add(pair.members[0].id);
    internalIds.add(pair.members[1].id);
  }
  for (const force of external) {
    if (internalIds.has(force.id)) invalid("externalForces", "a force marked internal cannot also be added to the external sum");
  }
  let fx = 0;
  let fy = 0;
  for (const force of external) {
    fx += force.fx;
    fy += force.fy;
  }
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) invalid("externalForces", "external force components must be finite");
  const acceleration = { x: fx / mass, y: fy / mass };
  if (!Number.isFinite(acceleration.x) || !Number.isFinite(acceleration.y)) invalid("externalForces", "centre acceleration is non-finite");
  const record: RigidMassRecord = {
    ...baseRecord("com_motion", mass, lengthUnit, displayLength, "acceleration"),
    reduction: "external_force_sum",
    centre: com,
    acceleration,
    externalForceSum: { x: fx, y: fy },
  };
  const magnitude = Math.hypot(acceleration.x, acceleration.y);
  if (magnitude === 0) return [{ kind: "point", point: com, rigidMass: record }];
  const end = {
    x: com.x + (acceleration.x / magnitude) * displayLength,
    y: com.y + (acceleration.y / magnitude) * displayLength,
  };
  if (!Number.isFinite(end.x) || !Number.isFinite(end.y) || (end.x === com.x && end.y === com.y)) {
    invalid("displayLength", "the acceleration marker is numerically indistinguishable or non-finite");
  }
  return [{ kind: "path", points: [com, end], directed: true, rigidMass: record }];
}

function evaluatePoints(inputs: Record<string, unknown>, context: RigidMassEvaluationContext): RigidMassGeometry[] {
  inputKeys(inputs, ["masses", "axis", "displayLength", "lengthUnit"]);
  const lengthUnit = metricOf(inputs);
  const displayLength = displayLengthOf(inputs, context);
  if (!isRecord(inputs.axis)) invalid("axis", "the inertia axis is required");
  inputKeys(inputs.axis, ["through", "orientation"], "axis");
  if (inputs.axis.orientation !== "perpendicular_to_plane") invalid("axis", "point-mass inertia needs an axis perpendicular to the plane");
  const through = readPoint(inputs.axis.through, "axis.through", context);
  const parts = readMassItems(inputs.masses, context);
  const combined = combine(parts, () => aboutPoint(through), "masses", true);
  const spin = gyration(combined.inertia, combined.mass);
  const record: RigidMassRecord = {
    ...baseRecord("point_mass_inertia", combined.mass, lengthUnit, displayLength, "mass"),
    reduction: "weighted_sum",
    centre: combined.centre,
    axisThrough: through,
    axis: { orientation: "perpendicular_to_plane" },
    inertia: combined.inertia,
    holeMass: combined.holeMass,
    positiveMass: combined.positiveMass,
    ...spin,
  };
  return parts.map((part) => drawPart(part, record));
}

function distanceFor(part: NormalizedPart, axis: ParsedAxis): Dist {
  if (axis.orientation === "diameter") return aboutDiameter(part);
  return aboutPoint(axis.through);
}

function evaluateSimple(inputs: Record<string, unknown>, context: RigidMassEvaluationContext): RigidMassGeometry[] {
  const lengthUnit = metricOf(inputs);
  const displayLength = displayLengthOf(inputs, context);
  let parts: NormalizedPart[];
  let axis: ParsedAxis;
  if (inputs.kind === "composite") {
    inputKeys(inputs, ["kind", "parts", "axis", "displayLength", "lengthUnit"]);
    parts = readPartList(inputs.parts, "parts", context);
    if (!parts.some((part) => part.kind !== "point")) invalid("parts", "simple body inertia integrates a distributed mass; point masses use point_mass_inertia");
    axis = parseCompositeAxis(inputs.axis, context);
  } else {
    const body = readSingleBody(inputs, context);
    parts = [body];
    axis = parseSingleAxis(inputs.axis, body);
  }
  const combined = combine(parts, (part) => distanceFor(part, axis), "parts", true);
  if (!combined.quadrature) invalid("parts", "simple body inertia integrates a distributed mass; point masses use point_mass_inertia");
  const spin = gyration(combined.inertia, combined.mass);
  const sole = parts.length === 1 ? parts[0] : undefined;
  const record: RigidMassRecord = {
    ...baseRecord("simple_body_inertia", combined.mass, lengthUnit, displayLength, "body"),
    reduction: "mass_integral",
    centre: combined.centre,
    axisThrough: axis.through,
    axis: { orientation: axis.orientation, place: axis.place, end: axis.end },
    inertia: combined.inertia,
    quadrature: combined.quadrature,
    holeMass: combined.holeMass,
    positiveMass: combined.positiveMass,
    bodyKind: sole ? sole.kind : "composite",
    requestedKind: sole ? sole.requested : "composite",
    ...spin,
  };
  return parts.map((part) => drawPart(part, record));
}

interface Vec3 { x: number; y: number; z: number }

function readVec3(value: unknown, key: string, context: RigidMassEvaluationContext): Vec3 {
  if (!isRecord(value)) invalid(key, `${key} must be a 3-vector`);
  inputKeys(value, ["x", "y", "z"], key);
  return {
    x: numberValue(value.x, `${key}.x`, context),
    y: numberValue(value.y, `${key}.y`, context),
    z: numberValue(value.z, `${key}.z`, context),
  };
}

function unitVec(value: Vec3, key: string): Vec3 {
  const norm = Math.hypot(value.x, value.y, value.z);
  if (!(norm > 0) || !Number.isFinite(norm)) invalid(key, `${key} must be a finite nonzero direction`);
  return { x: value.x / norm, y: value.y / norm, z: value.z / norm };
}

function directionsParallel(a: Vec3, b: Vec3): boolean {
  const cross = Math.hypot(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  return cross <= 1e-8;
}

function evaluateParallel(inputs: Record<string, unknown>, context: RigidMassEvaluationContext): RigidMassGeometry[] {
  inputKeys(inputs, ["theorem", "mass", "iCom", "axisDirection", "shiftedDirection", "offset", "parallel", "displayLength", "lengthUnit"]);
  const lengthUnit = metricOf(inputs);
  const displayLength = displayLengthOf(inputs, context);
  const mass = numberValue(inputs.mass, "mass", context);
  if (!(mass > 0)) invalid("mass", "mass must be positive");
  const iCom = numberValue(inputs.iCom, "iCom", context);
  if (!Number.isFinite(iCom) || iCom < 0) invalid("iCom", "I_com must be a nonnegative finite inertia");
  if (inputs.parallel !== true) invalid("parallel", "a non-parallel offset cannot use the parallel-axis theorem");
  const axisDirection = unitVec(readVec3(inputs.axisDirection, "axisDirection", context), "axisDirection");
  const shiftedDirection = unitVec(readVec3(inputs.shiftedDirection, "shiftedDirection", context), "shiftedDirection");
  if (!directionsParallel(axisDirection, shiftedDirection)) invalid("shiftedDirection", "a non-parallel offset labelled as parallel does not satisfy the parallel-axis theorem");
  const offset = readVec3(inputs.offset, "offset", context);
  const along = offset.x * axisDirection.x + offset.y * axisDirection.y + offset.z * axisDirection.z;
  const px = offset.x - along * axisDirection.x;
  const py = offset.y - along * axisDirection.y;
  const pz = offset.z - along * axisDirection.z;
  const offsetDistance = Math.hypot(px, py, pz);
  if (!Number.isFinite(offsetDistance)) invalid("offset", "the parallel offset is non-finite");
  const inertia = iCom + mass * offsetDistance * offsetDistance;
  if (!Number.isFinite(inertia)) invalid("offset", "parallel-axis inertia is non-finite");
  const record: RigidMassRecord = {
    ...baseRecord("axes_theorem", mass, lengthUnit, displayLength, "offset"),
    reduction: "parallel_axis",
    theorem: "parallel",
    iCom,
    inertia,
    offsetDistance,
    ...gyration(inertia, mass),
  };
  if (offsetDistance === 0) return [{ kind: "point", point: { x: 0, y: 0 }, rigidMass: record }];
  const planar = Math.hypot(px, py);
  const raw = planar > 0 ? { x: px, y: py } : { x: 0, y: pz };
  const norm = Math.hypot(raw.x, raw.y);
  return [{
    kind: "path",
    directed: true,
    points: [{ x: 0, y: 0 }, { x: (raw.x / norm) * displayLength, y: (raw.y / norm) * displayLength }],
    rigidMass: record,
  }];
}

function evaluatePerpendicular(inputs: Record<string, unknown>, context: RigidMassEvaluationContext): RigidMassGeometry[] {
  inputKeys(inputs, ["theorem", "mass", "lamina", "bodyKind", "ix", "iy", "displayLength", "lengthUnit"]);
  const lengthUnit = metricOf(inputs);
  const displayLength = displayLengthOf(inputs, context);
  const mass = numberValue(inputs.mass, "mass", context);
  if (!(mass > 0)) invalid("mass", "mass must be positive");
  if (typeof inputs.bodyKind !== "string" || !inputs.bodyKind.trim()) invalid("bodyKind", "perpendicular-axis theorem requires a declared body");
  const bodyKind = inputs.bodyKind.trim();
  if (!PLANAR_LAMINA.has(bodyKind)) invalid("bodyKind", "perpendicular-axis theorem applies only to a declared planar lamina, not a solid sphere or solid cylinder");
  if (inputs.lamina !== true) invalid("lamina", "perpendicular-axis theorem requires the body to be declared a planar lamina");
  const ix = numberValue(inputs.ix, "ix", context);
  const iy = numberValue(inputs.iy, "iy", context);
  if (!Number.isFinite(ix) || ix < 0 || !Number.isFinite(iy) || iy < 0) invalid("ix", "planar moments must be nonnegative and finite");
  const inertia = ix + iy;
  const half = displayLength / 2;
  const record: RigidMassRecord = {
    ...baseRecord("axes_theorem", mass, lengthUnit, displayLength, "lamina"),
    reduction: "perpendicular_axis",
    theorem: "perpendicular",
    bodyKind,
    lamina: true,
    ix,
    iy,
    inertia,
    ...gyration(inertia, mass),
  };
  return [{
    kind: "path",
    closed: true,
    points: [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half },
    ],
    rigidMass: record,
  }];
}

function evaluateAxes(inputs: Record<string, unknown>, context: RigidMassEvaluationContext): RigidMassGeometry[] {
  if (inputs.theorem === "parallel") return evaluateParallel(inputs, context);
  if (inputs.theorem === "perpendicular") return evaluatePerpendicular(inputs, context);
  invalid("theorem", "axes theorem must be parallel or perpendicular");
}

/** Explicit masses, axes, and densities only. displayLength scales markers, not I, k, or a_com. */
export function evaluateRigidMassConstruction(operator: string, inputs: Record<string, unknown>, context: RigidMassEvaluationContext): RigidMassGeometry[] {
  if (!isRecord(inputs)) invalid("fields", "rigid mass inputs must be an object");
  if (operator === "centre_of_mass") return evaluateCentre(inputs, context);
  if (operator === "com_motion") return evaluateMotion(inputs, context);
  if (operator === "point_mass_inertia") return evaluatePoints(inputs, context);
  if (operator === "simple_body_inertia") return evaluateSimple(inputs, context);
  if (operator === "axes_theorem") return evaluateAxes(inputs, context);
  return invalid("operator", `unsupported rigid mass operator ${operator}`);
}

export function rigidMassConstructionOutputLabels(operator: string, outputs: readonly unknown[]): string[] {
  if (!(RIGID_MASS_OPERATORS as readonly string[]).includes(operator)) throw new Error("rigid mass labels require a rigid mass operator");
  return outputs.map((output) => {
    if (!isRecord(output) || !isRigidMassRecord(output.rigidMass)) throw new Error("rigid mass label metadata is missing");
    return rigidMassLabel(output.rigidMass);
  });
}
function isRigidMassRecord(value: unknown): value is RigidMassRecord {
  return isRecord(value) && typeof value.operator === "string" && typeof value.mark === "string";
}
function compactRigidNumber(value: number, places = 3): string {
  const scale = 10 ** places;
  const rounded = Math.round(value * scale) / scale;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
function rigidMassLabel(record: RigidMassRecord): string {
  if (record.mark === "centre" && record.centre) return `COM ${compactRigidNumber(record.centre.x, 2)},${compactRigidNumber(record.centre.y, 2)}`;
  if (record.mark === "acceleration" && record.acceleration) {
    return record.acceleration.x === 0 && record.acceleration.y === 0
      ? "a=0"
      : `a=(${compactRigidNumber(record.acceleration.x)}, ${compactRigidNumber(record.acceleration.y)})`;
  }
  if (record.mark === "hole") return "hole";
  if (typeof record.inertia === "number") return `I=${compactRigidNumber(record.inertia)}`;
  return record.mark;
}

export function rigidMassEntityKind(geometry: RigidMassGeometry): "point" | "segment" | "vector" | "circle" | "polygon" | "polyline" {
  if (geometry.kind === "point") return "point";
  if (geometry.kind === "circle") return "circle";
  if (geometry.kind === "multi_path") return "polyline";
  if (geometry.directed === true) return "vector";
  if (geometry.closed === true) return "polygon";
  return "segment";
}

function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > MAX_SCALAR_DEPTH || seen.has(value)) invalid("quantity", "cyclic or overdeep numeric quantity reference");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("quantity", "a numeric input must resolve to a finite scalar");
    return value;
  }
  if (isRecord(value) && "value" in value) {
    seen.add(value);
    return validationNumber(value.value, document, seen, depth + 1);
  }
  if (typeof value === "string" && value.trim()) {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) {
      seen.add(value);
      return validationNumber(quantity.value, document, seen, depth + 1);
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return invalid("quantity", "a numeric input must resolve to a finite scalar");
}

function issueKey(key: string): string {
  const head = key.split(/[.[]/)[0];
  return head && head.length > 0 ? head : "fields";
}

/** Pushes fatal issues for an invalid rigid-mass construction. A clean issue list means the document passed this operator. */
export function validateRigidMassConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  if (!isOperator(construction.operator)) return;
  const operator = construction.operator;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const add = (key: string, message: string, actual?: unknown): void => {
    issues.push({
      code: `invalid_${operator}_${issueKey(key)}`,
      severity: "fatal",
      message,
      path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${issueKey(key)}`}`,
      entityIds: outputs.filter((id): id is string => typeof id === "string"),
      actual,
    });
  };
  if (!isRecord(construction.inputs)) {
    add("fields", "rigid mass inputs must be an object", construction.inputs);
    return;
  }
  let structureFailed = false;
  if (outputs.length < 1 || outputs.some((id) => typeof id !== "string" || !id.trim()) || new Set(outputs).size !== outputs.length) {
    add("outputs", `${operator} requires distinct output entities`, construction.outputs);
    structureFailed = true;
  }
  const context: RigidMassEvaluationContext = {
    number(value) {
      return validationNumber(value, document);
    },
    point(value) {
      if (typeof value !== "string" || !value.trim()) invalid("point", "a point reference must name a constructed point");
      const producer = constructionByOutput.get(value);
      const entity = document.entities.find((candidate) => candidate.id === value);
      if (!producer || producer.operator !== "point" || entity?.kind !== "point") invalid("point", "a point reference must name a constructed point");
      return { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) };
    },
    geometry(value) {
      return typeof value === "string" ? constructionByOutput.get(value) : undefined;
    },
  };
  try {
    const evaluated = evaluateRigidMassConstruction(operator, construction.inputs, context);
    if (structureFailed) return;
    if (outputs.length !== evaluated.length) {
      add("outputs", `${operator} requires exactly ${evaluated.length} distinct output entities`, construction.outputs);
      return;
    }
    evaluated.forEach((geometry, outputIndex) => {
      const id = outputs[outputIndex];
      const entity = typeof id === "string" ? document.entities.find((candidate) => candidate.id === id) : undefined;
      const expected = rigidMassEntityKind(geometry);
      if (!entity || entity.kind !== expected) add("output_kind", `${operator} output must be a ${expected} entity`, entity?.kind);
    });
  } catch (error) {
    add(error instanceof RigidMassInputError ? error.key : "fields", error instanceof Error ? error.message : "rigid mass inputs are invalid");
  }
}

export function validateEvaluatedRigidMassLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  try {
    const authorities: PublicationClaimAuthority[] = outputs.map((output) => {
    if (!isRecord(output) || !isRigidMassRecord(output.rigidMass) || output.rigidMass.operator !== construction.operator) throw new Error("Missing typed rigid-mass label authority");
    const meta = output.rigidMass;
    const values: Record<string, number | readonly [number, number]> = {};
    const put = (names: string[], value: number | undefined): void => { if (value !== undefined) for (const name of names) values[name] = value; };
    put(["mass", "M"], meta.mass); put(["I", "inertia"], meta.inertia); put(["kSquared", "k^2"], meta.kSquared); put(["k", "radiusOfGyration"], meta.radiusOfGyration);
    if (meta.mark === "centre" && meta.centre) { values.COM = [meta.centre.x, meta.centre.y]; put(["x", "xCOM"], meta.centre.x); put(["y", "yCOM"], meta.centre.y); }
    if (meta.mark === "acceleration" && meta.acceleration) { values.a = [meta.acceleration.x, meta.acceleration.y]; put(["ax"], meta.acceleration.x); put(["ay"], meta.acceleration.y); if (meta.acceleration.x === 0 && meta.acceleration.y === 0) values.a = 0; }
    put(["iCom"], meta.iCom); put(["ix"], meta.ix); put(["iy"], meta.iy); put(["offsetDistance"], meta.offsetDistance);
    return values;
    });
    validatePublicationDerivedClaims(construction, index, document, authorities, issues);
  } catch (error) {
    issues.push({ code: "invalid_publication_derived_label", severity: "fatal", message: error instanceof Error ? error.message : "Invalid typed label authority", path: `constructions[${index}].outputs` });
  }
}
