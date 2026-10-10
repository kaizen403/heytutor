import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import type { CalculusAnchorDefinition, CalculusCurveDefinition } from "./calculusGeometry";

export const DISTRIBUTED_FIELDS_OPERATORS = [
  "line_charge_field",
  "gauss_flux",
  "wire_field",
  "loop_field",
  "flux_sinusoid",
  "sinusoid_state",
] as const;

/**
 * DCP-06: fields beyond explicit point sources and affine uniform laws.
 * Every distribution, surface, current, and time law below is an explicit
 * stated model with integration bounds. Nothing is guessed: a uniform line
 * needs its endpoints and density, a Gaussian surface its center, radius,
 * enclosed charge and permittivity, a wire its current and permeability,
 * and a varying flux its sinusoidal law and domain. Unsupported shapes
 * (nonuniform densities, off-center loop points, multi-tone flux) decline.
 */

/** Uniform finite line charge; the drawn arrow length never certifies E. */
export interface LineChargeFieldDefinition {
  mode: "schematic" | "si";
  start: RenderPoint;
  end: RenderPoint;
  at: RenderPoint;
  chargeDensity: number;
  totalCharge: number;
  components: RenderPoint;
  magnitude: number;
  unit: "normalized" | "N/C";
  k: number;
  displayLength: number;
  zero: boolean;
  direction: RenderPoint | null;
}

/** Spherical Gaussian surface cross-section with its enclosed-charge flux. */
export interface GaussFluxDefinition {
  model: "spherical";
  mode: "schematic" | "si";
  center: RenderPoint;
  radius: number;
  enclosedCharge: number;
  epsilon0: number;
  flux: number;
  fluxUnit: "normalized" | "V*m";
  fluxAt: RenderPoint;
}

/** Straight-wire Biot-Savart field: planar around a piercing wire, or a
 * page-normal glyph for an in-plane finite segment. Glyph lengths certify
 * nothing; the sign convention is fixed in the operator contract. */
export interface WireFieldDefinition {
  model: "infinite_wire" | "finite_segment";
  mode: "schematic" | "si";
  at: RenderPoint;
  anchor: RenderPoint | { start: RenderPoint; end: RenderPoint };
  current: number;
  mu0: number;
  components: { x: number; y: number; z: number };
  magnitude: number;
  unit: "normalized" | "T";
  displayLength: number;
  zero: boolean;
  pageNormal: "out" | "in" | null;
  direction: RenderPoint | null;
}

/** Circular loop field at its center only; axial and off-axis points need a
 * genuine 3D operator and are declined rather than projected. */
export interface LoopFieldDefinition {
  mode: "schematic" | "si";
  center: RenderPoint;
  radius: number;
  current: number;
  mu0: number;
  axialField: number;
  unit: "normalized" | "T";
  displayLength: number;
  zero: boolean;
  pageNormal: "out" | "in" | null;
}

/** Sinusoidal uniform field crossed with a fixed oriented area. Flux and emf
 * keep SI authority; display scales never become physical measurements. */
export interface SinusoidalFluxDefinition {
  model: "uniform_sinusoidal";
  axis: { x: number; y: number; z: number };
  b0: number;
  b1: number;
  angularFrequency: number;
  frequencyUnit: "rad/s" | "rad/ms";
  phase: number;
  phaseUnit: "rad";
  areaVector: { x: number; y: number; z: number };
  turns: number;
  sourceUnits: { field: "T" | "mT"; area: "m^2" | "cm^2"; time: "s" | "ms" };
  fluxUnit: "Wb" | "mWb";
  couplingSI: { offset: number; amplitude: number };
  omegaSI: number;
  tMin: number;
  tMax: number;
  origin: RenderPoint;
  timeScale: number;
  fluxScale: number;
  samples: number;
}

export interface SinusoidStateDefinition {
  processId: string;
  process: SinusoidalFluxDefinition;
  sourceTime: number;
  timeSI: number;
  fluxSI: number;
  emfSI: number;
  component: "flux" | "emf";
}

export type DistributedFieldsGeometry =
  | { kind: "point"; point: RenderPoint; lineChargeField: LineChargeFieldDefinition }
  | { kind: "path"; points: RenderPoint[]; directed: true; lineChargeField: LineChargeFieldDefinition }
  | { kind: "circle"; center: RenderPoint; radius: number; gaussFlux: GaussFluxDefinition }
  | { kind: "point"; point: RenderPoint; gaussFlux: GaussFluxDefinition }
  | { kind: "point"; point: RenderPoint; wireField: WireFieldDefinition }
  | { kind: "path"; points: RenderPoint[]; directed: true; wireField: WireFieldDefinition }
  | { kind: "multi_path"; paths: RenderPoint[][]; wireField: WireFieldDefinition }
  | { kind: "point"; point: RenderPoint; loopField: LoopFieldDefinition }
  | { kind: "multi_path"; paths: RenderPoint[][]; loopField: LoopFieldDefinition }
  | { kind: "path"; points: RenderPoint[]; sinusoidalFlux: SinusoidalFluxDefinition; sampledCurve: CalculusCurveDefinition }
  | { kind: "point"; point: RenderPoint; sinusoidState: SinusoidStateDefinition; calculusAnchor?: CalculusAnchorDefinition };

export interface DistributedFieldsEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry(value: unknown): unknown;
}

const MAX_SCALAR_DEPTH = 32;
const MAX_SOURCE = 1e12;
const MAX_COORDINATE = 1e12;
const MAX_TIME = 1e9;
const MAX_SAMPLES = 1025;
const MAX_CYCLES = 32;
const MIN_DISPLAY = 1e-6;
const RELATIVE_ERROR = 64 * Number.EPSILON;
/** Observation points closer than this, relative to the source span, cannot
 * resolve the transverse component; exact axial placement stays supported. */
const AXIS_RESOLVE = 1e-9;

class DistributedFieldsInputError extends Error {
  constructor(readonly key: string, message: string) { super(message); }
}
function invalid(key: string, message: string): never { throw new DistributedFieldsInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function inputKeys(inputs: Record<string, unknown>, allowed: readonly string[], key = "fields"): void {
  const unexpected = Object.keys(inputs).filter((name) => !allowed.includes(name));
  if (unexpected.length) invalid(key, `unsupported distributed-field inputs: ${unexpected.join(", ")}`);
}
function bounded(value: number, key: string, cap = MAX_SOURCE): number {
  if (!Number.isFinite(value) || Math.abs(value) > cap) invalid(key, `${key} must be finite within ${cap}`);
  return value === 0 ? 0 : value;
}
function preserveLiteral(value: unknown, key: string): void {
  const match = typeof value === "string" && /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE][+-]?\d+)?$/.exec(value.trim());
  if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) invalid(key, "a nonzero distributed-field source literal cannot become certified zero");
}
function scalarValue(value: unknown, key: string, context: DistributedFieldsEvaluationContext, cap = MAX_SOURCE, seen = new Set<unknown>(), depth = 0): number {
  if (depth > MAX_SCALAR_DEPTH || seen.has(value)) invalid(key, "scalar wrappers must be acyclic within depth 32");
  if (isRecord(value)) { inputKeys(value, ["value", "unit"], key); seen.add(value); return scalarValue(value.value, key, context, cap, seen, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, `${key} requires an explicit finite scalar`);
  preserveLiteral(value, key);
  try { return bounded(context.number(value), key, cap); }
  catch (error) { if (error instanceof DistributedFieldsInputError) throw error; return invalid(key, `${key} requires a finite source value`); }
}
function finitePoint(point: RenderPoint, key: string): RenderPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) invalid(key, `${key} must resolve to finite planar coordinates`);
  return { x: point.x, y: point.y };
}
function pointValue(value: unknown, key: string, context: DistributedFieldsEvaluationContext): RenderPoint {
  if (isRecord(value)) {
    inputKeys(value, ["x", "y"], key);
    return finitePoint({ x: scalarValue(value.x, `${key}.x`, context, MAX_COORDINATE), y: scalarValue(value.y, `${key}.y`, context, MAX_COORDINATE) }, key);
  }
  if (Array.isArray(value)) {
    if (value.length !== 2) invalid(key, `${key} must contain exactly two coordinates`);
    return finitePoint({ x: scalarValue(value[0], `${key}.x`, context, MAX_COORDINATE), y: scalarValue(value[1], `${key}.y`, context, MAX_COORDINATE) }, key);
  }
  if (typeof value !== "string" || !value.trim()) invalid(key, `${key} must reference a point or supply two coordinates`);
  try {
    const geometry = context.geometry(value);
    if (isRecord(geometry) && (geometry.space !== undefined || geometry.spaceFrameId !== undefined || geometry.world3D !== undefined)) invalid(key, "distributed fields require physical 2D points; projected 3D positions need a separate operator");
    return finitePoint(context.point(value), key);
  }
  catch (error) {
    if (error instanceof DistributedFieldsInputError) throw error;
    return invalid(key, `${key} must reference a constructed finite point`);
  }
}

const LENGTH_UNITS = new Map<string, number>([
  ["m", 1], ["meter", 1], ["meters", 1], ["metre", 1], ["metres", 1],
  ["cm", 1e-2], ["centimeter", 1e-2], ["centimetre", 1e-2], ["mm", 1e-3], ["millimeter", 1e-3], ["millimetre", 1e-3],
  ["km", 1e3], ["kilometer", 1e3], ["kilometre", 1e3], ["µm", 1e-6], ["μm", 1e-6], ["um", 1e-6], ["nm", 1e-9],
]);
const CHARGE_UNITS = new Map<string, number>([
  ["C", 1], ["coulomb", 1], ["coulombs", 1], ["mC", 1e-3], ["millicoulomb", 1e-3],
  ["µC", 1e-6], ["μC", 1e-6], ["uC", 1e-6], ["microcoulomb", 1e-6], ["nC", 1e-9], ["nanocoulomb", 1e-9], ["pC", 1e-12], ["picocoulomb", 1e-12],
]);
const DENSITY_UNITS = new Map<string, number>([
  ["C/m", 1], ["mC/m", 1e-3], ["uC/m", 1e-6], ["µC/m", 1e-6], ["μC/m", 1e-6], ["nC/m", 1e-9], ["pC/m", 1e-12],
  ["C/cm", 100], ["mC/cm", 0.1],
]);
const CURRENT_UNITS = new Map<string, number>([
  ["A", 1], ["ampere", 1], ["amperes", 1], ["mA", 1e-3], ["uA", 1e-6], ["µA", 1e-6], ["μA", 1e-6], ["nA", 1e-9],
]);
const DIMENSIONLESS_UNITS = new Set(["1", "unit", "units", "dimensionless", "normalized"]);
const COULOMB_COEFFICIENT_UNITS = new Set(["N*m^2/C^2", "N m^2/C^2", "N·m²/C²", "N m²/C²", "N*m²/C²", "N·m^2/C^2"]);
const PERMITTIVITY_UNITS = new Set(["F/m", "C^2/(N*m^2)", "C^2/N/m^2"]);
const PERMEABILITY_UNITS = new Set(["H/m", "N/A^2", "T*m/A"]);

function declaredFactor(value: unknown, key: string, units: Map<string, number>, required: boolean): number {
  if (value === undefined && !required) return 1;
  if (typeof value !== "string" || !units.has(value.trim())) invalid(key, `${key} must declare a supported unit`);
  return units.get(value.trim())!;
}
function scalarUnits(value: unknown, key: string, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > MAX_SCALAR_DEPTH || seen.has(value)) invalid(key, `${key} contains a cyclic or overdeep quantity reference`);
  if (isRecord(value)) {
    seen.add(value);
    const unit = value.unit;
    if (unit !== undefined && (typeof unit !== "string" || !unit.trim())) invalid(key, `${key} unit must be a nonempty unit string`);
    return [...(typeof unit === "string" ? [unit.trim()] : []), ...scalarUnits(value.value, key, document, seen, depth + 1)];
  }
  if (typeof value === "string" && document) {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) { seen.add(value); return scalarUnits(quantity, key, document, seen, depth + 1); }
  }
  return [];
}
function modeValue(inputs: Record<string, unknown>): "schematic" | "si" {
  if (inputs.mode !== "schematic" && inputs.mode !== "si") invalid("mode", "distributed fields require explicit schematic or si mode");
  return inputs.mode;
}
function displayLengthValue(value: unknown, context: DistributedFieldsEvaluationContext): number {
  const length = scalarValue(value, "displayLength", context);
  if (!(length > 0) || !(length >= MIN_DISPLAY)) invalid("displayLength", "displayLength must be a positive display length of at least 1e-6");
  return length;
}
function checkSchematicConstant(value: number, key: string, mode: "schematic" | "si", expectedSchematic: number): void {
  if (mode === "schematic" ? value !== expectedSchematic : !(value > 0)) invalid(key, `${key} must be exactly ${expectedSchematic} in schematic mode and positive in SI mode`);
}

/** Finite uniform line charge E-field. With foot distances a (to start) and
 * b (to end) along the wire unit u and perpendicular distance r:
 * E_perp = kλ(b/Rb − a/Ra)/r, E_par = kλ(1/Rb − 1/Ra).
 * Exact axial placement (r = 0) uses the axial limit; near-axial points
 * that cannot resolve the transverse direction fail closed. */
function lineChargeDefinition(inputs: Record<string, unknown>, context: DistributedFieldsEvaluationContext): LineChargeFieldDefinition {
  inputKeys(inputs, ["start", "end", "at", "chargeDensity", "mode", "k", "displayLength", "lengthUnit", "densityUnit"]);
  const mode = modeValue(inputs);
  const k = scalarValue(inputs.k, "k", context);
  checkSchematicConstant(k, "k", mode, 1);
  if (mode === "schematic" && inputs.lengthUnit !== undefined) invalid("lengthUnit", "lengthUnit must be omitted in schematic mode");
  if (mode === "schematic" && inputs.densityUnit !== undefined) invalid("densityUnit", "densityUnit must be omitted in schematic mode");
  const lengthFactor = declaredFactor(inputs.lengthUnit, "lengthUnit", LENGTH_UNITS, mode === "si");
  const densityFactor = declaredFactor(inputs.densityUnit, "densityUnit", DENSITY_UNITS, mode === "si");
  const displayLength = displayLengthValue(inputs.displayLength, context);
  const start = pointValue(inputs.start, "start", context);
  const end = pointValue(inputs.end, "end", context);
  const at = pointValue(inputs.at, "at", context);
  const chargeDensity = scalarValue(inputs.chargeDensity, "chargeDensity", context);
  const spanX = end.x - start.x;
  const spanY = end.y - start.y;
  const length = Math.hypot(spanX, spanY);
  if (!Number.isFinite(length) || !(length > 0)) invalid("end", "line charge endpoints must be finitely separated");
  const unit = { x: spanX / length, y: spanY / length };
  const relX = at.x - start.x;
  const relY = at.y - start.y;
  const along = relX * unit.x + relY * unit.y;
  const perpX = relX - along * unit.x;
  const perpY = relY - along * unit.y;
  const r = Math.hypot(perpX, perpY);
  const a = -along;
  const b = length - along;
  if (!Number.isFinite(r) || !Number.isFinite(a) || !Number.isFinite(b)) invalid("at", "line charge observation geometry is non-finite");
  if (r === 0 && a <= 0 && b >= 0) invalid("at", "the observation point must not lie on the charged segment");
  const radiusA = Math.hypot(r, a);
  const radiusB = Math.hypot(r, b);
  if (!(radiusA > 0) || !(radiusB > 0)) invalid("at", "the observation point must be separated from both endpoints");
  if (r > 0 && r < AXIS_RESOLVE * Math.max(radiusA, radiusB)) invalid("at", "the observation point is too close to the wire axis to resolve the transverse field; place it exactly on the axis instead");
  const lambdaSI = mode === "si" ? chargeDensity * densityFactor : chargeDensity;
  const scaleSI = mode === "si" ? lengthFactor : 1;
  if (!Number.isFinite(lambdaSI) || !Number.isFinite(scaleSI) || !(scaleSI > 0)) invalid("chargeDensity", "charge density or length unit conversion is non-finite");
  if (chargeDensity !== 0 && lambdaSI === 0) invalid("chargeDensity", "a nonzero charge density cannot underflow its unit conversion");
  const physicalR = r * scaleSI;
  const physicalA = radiusA * scaleSI;
  const physicalB = radiusB * scaleSI;
  let perp = 0;
  let parallel = 0;
  if (lambdaSI !== 0) {
    if (r === 0) {
      parallel = k * lambdaSI * (1 / Math.abs(b * scaleSI) - 1 / Math.abs(a * scaleSI));
    } else {
      perp = k * lambdaSI * ((b * scaleSI / physicalB - a * scaleSI / physicalA) / physicalR);
      parallel = k * lambdaSI * (1 / physicalB - 1 / physicalA);
    }
  }
  if (!Number.isFinite(perp) || !Number.isFinite(parallel)) invalid("chargeDensity", "line charge field overflows finite numeric authority");
  const normal = r === 0 ? { x: -unit.y, y: unit.x } : { x: perpX / r, y: perpY / r };
  const components = { x: perp * normal.x + parallel * unit.x, y: perp * normal.y + parallel * unit.y };
  if (!Number.isFinite(components.x) || !Number.isFinite(components.y)) invalid("chargeDensity", "line charge field components are non-finite");
  const magnitude = Math.hypot(components.x, components.y);
  if (!Number.isFinite(magnitude)) invalid("chargeDensity", "line charge field magnitude is non-finite");
  if (lambdaSI !== 0) {
    const authority = Math.abs(k * lambdaSI) / Math.max(physicalA, physicalB);
    if (!(magnitude > RELATIVE_ERROR * authority)) invalid("chargeDensity", "nonzero line charge field is unresolved within floating error");
  }
  const zero = magnitude === 0;
  if (lambdaSI === 0 && !zero) invalid("chargeDensity", "zero charge density must certify a zero field");
  return {
    mode, start, end, at, chargeDensity, totalCharge: chargeDensity * length, components, magnitude,
    unit: mode === "si" ? "N/C" : "normalized", k, displayLength, zero,
    direction: zero ? null : { x: components.x / magnitude, y: components.y / magnitude },
  };
}
function lineChargeMark(field: LineChargeFieldDefinition): DistributedFieldsGeometry {
  if (field.zero || !field.direction) return { kind: "point", point: { ...field.at }, lineChargeField: field };
  const end = finitePoint({ x: field.at.x + field.direction.x * field.displayLength, y: field.at.y + field.direction.y * field.displayLength }, "displayLength");
  if (end.x === field.at.x && end.y === field.at.y) invalid("displayLength", "the display vector is numerically indistinguishable");
  return { kind: "path", points: [{ ...field.at }, end], directed: true, lineChargeField: field };
}

/** Gauss's law for an explicit spherical surface: flux = Qenc/eps0. The
 * circle is an honest 2D cross-section, not a 3D rendering; enclosure of a
 * drawn charge is proved with `inside`, never assumed from this operator. */
function gaussFluxDefinition(inputs: Record<string, unknown>, context: DistributedFieldsEvaluationContext): GaussFluxDefinition {
  inputKeys(inputs, ["model", "center", "radius", "enclosedCharge", "epsilon0", "mode", "chargeUnit", "lengthUnit", "epsilonUnit", "fluxAt"]);
  if (inputs.model !== "spherical") invalid("model", "gauss_flux requires the explicit spherical surface model");
  const mode = modeValue(inputs);
  checkDeclaredConstantUnit(inputs, "epsilonUnit", PERMITTIVITY_UNITS, mode);
  const center = pointValue(inputs.center, "center", context);
  const radius = scalarValue(inputs.radius, "radius", context);
  if (!(radius > 0)) invalid("radius", "gaussian surface radius must be positive");
  const enclosedCharge = scalarValue(inputs.enclosedCharge, "enclosedCharge", context);
  const epsilon0 = scalarValue(inputs.epsilon0, "epsilon0", context);
  checkSchematicConstant(epsilon0, "epsilon0", mode, 1);
  declaredFactor(inputs.lengthUnit, "lengthUnit", LENGTH_UNITS, mode === "si");
  const chargeFactor = declaredFactor(inputs.chargeUnit, "chargeUnit", CHARGE_UNITS, mode === "si");
  const flux = mode === "si" ? (enclosedCharge * chargeFactor) / epsilon0 : enclosedCharge / epsilon0;
  if (!Number.isFinite(flux)) invalid("enclosedCharge", "gaussian flux overflows finite numeric authority");
  if (enclosedCharge !== 0 && flux === 0) invalid("enclosedCharge", "a nonzero enclosed charge cannot certify zero flux");
  const fluxAt = inputs.fluxAt === undefined ? { ...center } : pointValue(inputs.fluxAt, "fluxAt", context);
  return { model: "spherical", mode, center, radius, enclosedCharge, epsilon0, flux, fluxUnit: mode === "si" ? "V*m" : "normalized", fluxAt };
}
function gaussFluxMarks(definition: GaussFluxDefinition): DistributedFieldsGeometry[] {
  return [
    { kind: "circle", center: { ...definition.center }, radius: definition.radius, gaussFlux: definition },
    { kind: "point", point: { ...definition.fluxAt }, gaussFlux: definition },
  ];
}

/** Straight-wire Biot-Savart fields. Infinite wire (piercing the page at
 * `wire`, current +z out of page): B = mu0 I (−ry, rx) / 2πr².
 * Finite in-plane segment (current start→end for +I): Bz =
 * mu0 I (s2/R2 − s1/R1) / 4πr, drawn as a page-normal glyph. Axial
 * off-segment points certify exact zero; on-segment points reject. */
function wireFieldDefinition(inputs: Record<string, unknown>, context: DistributedFieldsEvaluationContext): WireFieldDefinition {
  inputKeys(inputs, ["model", "wire", "start", "end", "at", "current", "mu0", "mode", "currentUnit", "lengthUnit", "muUnit", "displayLength"]);
  const model = inputs.model;
  if (model !== "infinite_wire" && model !== "finite_segment") invalid("model", "wire_field requires the explicit infinite_wire or finite_segment model");
  const mode = modeValue(inputs);
  checkDeclaredConstantUnit(inputs, "muUnit", PERMEABILITY_UNITS, mode);
  const current = scalarValue(inputs.current, "current", context);
  const mu0 = scalarValue(inputs.mu0, "mu0", context);
  checkSchematicConstant(mu0, "mu0", mode, 1);
  const lengthFactor = declaredFactor(inputs.lengthUnit, "lengthUnit", LENGTH_UNITS, mode === "si");
  const currentFactor = declaredFactor(inputs.currentUnit, "currentUnit", CURRENT_UNITS, mode === "si");
  const displayLength = displayLengthValue(inputs.displayLength, context);
  const at = pointValue(inputs.at, "at", context);
  const currentSI = mode === "si" ? current * currentFactor : current;
  if (!Number.isFinite(currentSI)) invalid("current", "current unit conversion is non-finite");
  if (current !== 0 && currentSI === 0) invalid("current", "a nonzero current cannot underflow its unit conversion");
  const scaleSI = mode === "si" ? lengthFactor : 1;
  if (model === "infinite_wire") {
    if (inputs.start !== undefined || inputs.end !== undefined) invalid("model", "infinite_wire takes a piercing wire point, not segment endpoints");
    const wire = pointValue(inputs.wire, "wire", context);
    const rx = at.x - wire.x;
    const ry = at.y - wire.y;
    const r = Math.hypot(rx, ry);
    if (!Number.isFinite(r) || !(r > 0)) invalid("at", "the observation point must be finitely separated from the wire");
    const physicalR = r * scaleSI;
    const coefficient = currentSI === 0 ? 0 : (mu0 * currentSI) / (2 * Math.PI * physicalR * physicalR);
    if (!Number.isFinite(coefficient)) invalid("current", "wire field overflows finite numeric authority");
    const components = { x: coefficient * (-ry), y: coefficient * rx, z: 0 };
    if (!Number.isFinite(components.x) || !Number.isFinite(components.y)) invalid("current", "wire field components are non-finite");
    const magnitude = Math.hypot(components.x, components.y);
    if (!Number.isFinite(magnitude)) invalid("current", "wire field magnitude is non-finite");
    if (currentSI !== 0 && !(magnitude > RELATIVE_ERROR * Math.abs(coefficient) * r)) invalid("current", "nonzero wire field is unresolved within floating error");
    const zero = magnitude === 0;
    return {
      model, mode, at, anchor: wire, current, mu0, components, magnitude,
      unit: mode === "si" ? "T" : "normalized", displayLength, zero, pageNormal: null,
      direction: zero ? null : { x: components.x / magnitude, y: components.y / magnitude },
    };
  }
  if (inputs.wire !== undefined) invalid("model", "finite_segment takes in-plane start/end points, not a piercing wire point");
  const start = pointValue(inputs.start, "start", context);
  const end = pointValue(inputs.end, "end", context);
  const spanX = end.x - start.x;
  const spanY = end.y - start.y;
  const length = Math.hypot(spanX, spanY);
  if (!Number.isFinite(length) || !(length > 0)) invalid("end", "wire segment endpoints must be finitely separated");
  const unit = { x: spanX / length, y: spanY / length };
  const along = (at.x - start.x) * unit.x + (at.y - start.y) * unit.y;
  const perpX = (at.x - start.x) - along * unit.x;
  const perpY = (at.y - start.y) - along * unit.y;
  const r = Math.hypot(perpX, perpY);
  const s1 = -along;
  const s2 = length - along;
  if (!Number.isFinite(r)) invalid("at", "wire observation geometry is non-finite");
  if (r === 0 && s1 <= 0 && s2 >= 0) invalid("at", "the observation point must not lie on the current segment");
  if (currentSI === 0 || r === 0) {
    const anchor = { start, end };
    return {
      model, mode, at, anchor, current, mu0, components: { x: 0, y: 0, z: 0 }, magnitude: 0,
      unit: mode === "si" ? "T" : "normalized", displayLength, zero: true, pageNormal: null, direction: null,
    };
  }
  const radius1 = Math.hypot(r, s1);
  const radius2 = Math.hypot(r, s2);
  if (r < AXIS_RESOLVE * Math.max(radius1, radius2)) invalid("at", "the observation point is too close to the wire axis to resolve the field; place it exactly on the axis instead");
  const physicalR = r * scaleSI;
  const field = (mu0 * currentSI * ((s2 * scaleSI / (radius2 * scaleSI)) - (s1 * scaleSI / (radius1 * scaleSI)))) / (4 * Math.PI * physicalR);
  if (!Number.isFinite(field)) invalid("current", "wire field overflows finite numeric authority");
  if (field === 0) invalid("current", "nonzero finite-segment field is unresolved within floating error");
  return {
    model, mode, at, anchor: { start, end }, current, mu0, components: { x: 0, y: 0, z: field }, magnitude: Math.abs(field),
    unit: mode === "si" ? "T" : "normalized", displayLength, zero: false,
    pageNormal: field > 0 ? "out" : "in", direction: null,
  };
}

/** Page-normal glyph matching the Lorentz-force convention: ring plus center
 * dot for out-of-page, ring plus cross for into-page. */
function pageNormalGlyph(origin: RenderPoint, displayLength: number, sign: 1 | -1): RenderPoint[][] {
  const radius = displayLength / 2;
  const move = (x: number, y: number): RenderPoint => {
    const result = finitePoint({ x: origin.x + x, y: origin.y + y }, "geometry");
    if (Math.hypot((result.x - origin.x) - x, (result.y - origin.y) - y) > radius * 1e-8) invalid("precision", "page-normal glyph placement is unresolved at numeric precision");
    return result;
  };
  const ring = (ringRadius: number, samples: number): RenderPoint[] =>
    Array.from({ length: samples + 1 }, (_, index) => index === samples ? move(ringRadius, 0)
      : move(ringRadius * Math.cos(2 * Math.PI * index / samples), ringRadius * Math.sin(2 * Math.PI * index / samples)));
  return [ring(radius, 64), ...(sign > 0 ? [ring(radius / 20, 16)] : [
    [move(-radius / 2, -radius / 2), move(radius / 2, radius / 2)],
    [move(-radius / 2, radius / 2), move(radius / 2, -radius / 2)],
  ])];
}
function wireFieldMark(field: WireFieldDefinition): DistributedFieldsGeometry {
  if (field.zero) return { kind: "point", point: { ...field.at }, wireField: field };
  if (field.pageNormal) return { kind: "multi_path", paths: pageNormalGlyph(field.at, field.displayLength, field.pageNormal === "out" ? 1 : -1), wireField: field };
  if (!field.direction) invalid("current", "planar wire field requires a resolved direction");
  const end = finitePoint({ x: field.at.x + field.direction.x * field.displayLength, y: field.at.y + field.direction.y * field.displayLength }, "displayLength");
  if (end.x === field.at.x && end.y === field.at.y) invalid("displayLength", "the display vector is numerically indistinguishable");
  return { kind: "path", points: [{ ...field.at }, end], directed: true, wireField: field };
}

/** Circular loop at its center: Bz = mu0 I / 2R. Positive current produces
 * out-of-page field; the loop outline itself is drawn separately as an
 * engine circle through the same center and radius. */
function loopFieldDefinition(inputs: Record<string, unknown>, context: DistributedFieldsEvaluationContext): LoopFieldDefinition {
  inputKeys(inputs, ["center", "radius", "current", "mu0", "mode", "currentUnit", "lengthUnit", "muUnit", "displayLength"]);
  const mode = modeValue(inputs);
  checkDeclaredConstantUnit(inputs, "muUnit", PERMEABILITY_UNITS, mode);
  const center = pointValue(inputs.center, "center", context);
  const radius = scalarValue(inputs.radius, "radius", context);
  if (!(radius > 0)) invalid("radius", "loop radius must be positive");
  const current = scalarValue(inputs.current, "current", context);
  const mu0 = scalarValue(inputs.mu0, "mu0", context);
  checkSchematicConstant(mu0, "mu0", mode, 1);
  const lengthFactor = declaredFactor(inputs.lengthUnit, "lengthUnit", LENGTH_UNITS, mode === "si");
  const currentFactor = declaredFactor(inputs.currentUnit, "currentUnit", CURRENT_UNITS, mode === "si");
  const displayLength = displayLengthValue(inputs.displayLength, context);
  const currentSI = mode === "si" ? current * currentFactor : current;
  const radiusSI = mode === "si" ? radius * lengthFactor : radius;
  if (!Number.isFinite(currentSI) || !Number.isFinite(radiusSI) || !(radiusSI > 0)) invalid("current", "loop current or radius conversion is non-finite");
  if (current !== 0 && currentSI === 0) invalid("current", "a nonzero current cannot underflow its unit conversion");
  const axialField = currentSI === 0 ? 0 : (mu0 * currentSI) / (2 * radiusSI);
  if (!Number.isFinite(axialField)) invalid("current", "loop field overflows finite numeric authority");
  if (currentSI !== 0 && axialField === 0) invalid("current", "nonzero loop field is unresolved within floating error");
  return {
    mode, center, radius, current, mu0, axialField, unit: mode === "si" ? "T" : "normalized",
    displayLength, zero: axialField === 0, pageNormal: axialField === 0 ? null : axialField > 0 ? "out" : "in",
  };
}
function loopFieldMark(field: LoopFieldDefinition): DistributedFieldsGeometry {
  if (field.zero || !field.pageNormal) return { kind: "point", point: { ...field.center }, loopField: field };
  return { kind: "multi_path", paths: pageNormalGlyph(field.center, field.displayLength, field.pageNormal === "out" ? 1 : -1), loopField: field };
}

const AXES = ["x", "y", "z"] as const;
const FIELD_DENOMINATOR = { T: 1, mT: 1000 } as const;
const AREA_DENOMINATOR = { "m^2": 1, "cm^2": 10000 } as const;
const TIME_DENOMINATOR = { s: 1, ms: 1000 } as const;
const FLUX_DENOMINATOR = { Wb: 1, mWb: 1000 } as const;

type Vector3 = { x: number; y: number; z: number };
function vector3(value: unknown, key: string, context: DistributedFieldsEvaluationContext): Vector3 {
  if (!Array.isArray(value) || value.length !== 3) invalid(key, `${key} requires three explicit Cartesian components, including zeros`);
  return { x: scalarValue(value[0], `${key}.x`, context), y: scalarValue(value[1], `${key}.y`, context), z: scalarValue(value[2], `${key}.z`, context) };
}
function unitKey<K extends string>(value: unknown, supported: Readonly<Record<K, number>>, key: string): K {
  if (typeof value !== "string" || !Object.hasOwn(supported, value.trim())) invalid(key, `${key} requires an explicit supported unit`);
  return value.trim() as K;
}
function sinusoidUnits(inputs: Record<string, unknown>): SinusoidalFluxDefinition["sourceUnits"] {
  if (!isRecord(inputs.units)) invalid("units", "flux_sinusoid requires field, area, and time units");
  inputKeys(inputs.units, ["field", "area", "time"], "units");
  return {
    field: unitKey(inputs.units.field, FIELD_DENOMINATOR, "fieldUnit"),
    area: unitKey(inputs.units.area, AREA_DENOMINATOR, "areaUnit"),
    time: unitKey(inputs.units.time, TIME_DENOMINATOR, "timeUnit"),
  };
}
function checkSinusoidUnits(inputs: Record<string, unknown>, document?: SceneDocument, process?: SinusoidalFluxDefinition): void {
  const check = (value: unknown, allowed: readonly string[]): void => {
    for (const actual of scalarUnits(value, "units", document)) if (!allowed.includes(actual)) invalid("units", `sinusoid source unit ${actual} contradicts its declared physical scale`);
  };
  for (const name of ["timeScale", "fluxScale", "turns", "samples"]) check(inputs[name], ["1", "dimensionless", "unit", "units"]);
  const checkPlacement = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach((entry) => check(entry, ["1", "dimensionless", "unit", "units"]));
    else if (isRecord(value)) { check(value.x, ["1", "dimensionless", "unit", "units"]); check(value.y, ["1", "dimensionless", "unit", "units"]); }
  };
  checkPlacement(inputs.origin);
  checkPlacement(inputs.emfAt);
  if (inputs.axis === undefined) {
    if (process) check(inputs.time, [process.sourceUnits.time]);
    return;
  }
  const units = sinusoidUnits(inputs);
  for (const name of ["b0", "b1"]) check(inputs[name], [units.field]);
  check(inputs.angularFrequency, [`rad/${units.time}`]);
  check(inputs.phase, ["rad"]);
  for (const value of (Array.isArray(inputs.areaVector) ? inputs.areaVector as unknown[] : [])) check(value, [units.area]);
  for (const value of (Array.isArray(inputs.axis) ? inputs.axis as unknown[] : [])) check(value, ["1", "dimensionless", "unit", "units"]);
  check(inputs.tMin, [units.time]);
  check(inputs.tMax, [units.time]);
}
function sinusoidPlacement(value: unknown, key: string, context: DistributedFieldsEvaluationContext, fallback: RenderPoint = { x: 0, y: 0 }): RenderPoint {
  if (value === undefined) return { ...fallback };
  if (Array.isArray(value) && value.length === 2) return { x: scalarValue(value[0], `${key}.x`, context), y: scalarValue(value[1], `${key}.y`, context) };
  if (isRecord(value)) { inputKeys(value, ["x", "y"], key); return { x: scalarValue(value.x, `${key}.x`, context), y: scalarValue(value.y, `${key}.y`, context) }; }
  return invalid(key, "sinusoid display placement requires explicit inline 2D coordinates");
}

/** Uniform sinusoidal field B(t) = (b0 + b1 sin(wt + p)) axis with a fixed
 * oriented area. Flux Phi(t) = N (axis.A) s(t); emf = −dPhi/dt. The
 * transcendental evaluations are deterministic IEEE doubles; the gate
 * cross-checks them against numeric differentiation and closed-form
 * quarter-period values rather than a second copy of this code. */
function sinusoidDefinition(inputs: Record<string, unknown>, context: DistributedFieldsEvaluationContext): SinusoidalFluxDefinition {
  inputKeys(inputs, ["model", "axis", "b0", "b1", "angularFrequency", "frequencyUnit", "phase", "phaseUnit", "areaVector", "turns", "tMin", "tMax", "units", "fluxUnit", "origin", "timeScale", "fluxScale", "samples"]);
  checkSinusoidUnits(inputs);
  if (inputs.model !== "uniform_sinusoidal") invalid("model", "flux_sinusoid requires the explicit uniform_sinusoidal field model");
  const axis = vector3(inputs.axis, "axis", context);
  const axisNorm = Math.hypot(axis.x, axis.y, axis.z);
  if (!Number.isFinite(axisNorm) || Math.abs(axisNorm - 1) > 1e-9) invalid("axis", "sinusoid axis must be an explicit unit direction");
  const b0 = scalarValue(inputs.b0, "b0", context);
  const b1 = scalarValue(inputs.b1, "b1", context);
  const angularFrequency = scalarValue(inputs.angularFrequency, "angularFrequency", context);
  if (!(angularFrequency >= 0)) invalid("angularFrequency", "angular frequency must be an explicit nonnegative rate");
  const sourceUnits = sinusoidUnits(inputs);
  const frequencyUnit = inputs.frequencyUnit;
  if (frequencyUnit !== "rad/s" && frequencyUnit !== "rad/ms") invalid("frequencyUnit", "frequencyUnit must be rad/s or rad/ms");
  if (frequencyUnit !== `rad/${sourceUnits.time}`) invalid("frequencyUnit", "frequencyUnit must use the declared source-time scale");
  if (inputs.phaseUnit !== "rad") invalid("phaseUnit", "sinusoid phase must be declared in radians");
  const phase = scalarValue(inputs.phase, "phase", context);
  const areaVector = vector3(inputs.areaVector, "areaVector", context);
  const areaNorm = Math.hypot(areaVector.x, areaVector.y, areaVector.z);
  if (!Number.isFinite(areaNorm) || !(areaNorm > 0)) invalid("areaVector", "oriented area must be a nonzero explicit vector");
  const turns = scalarValue(inputs.turns, "turns", context);
  if (!Number.isInteger(turns) || turns < 1 || turns > 1e6) invalid("turns", "turns must be an explicit integer 1..1000000");
  const tMin = scalarValue(inputs.tMin, "tMin", context, MAX_TIME);
  const tMax = scalarValue(inputs.tMax, "tMax", context, MAX_TIME);
  if (!(tMin < tMax)) invalid("time", "sinusoid process requires a strictly increasing finite source-time domain");
  const timeScale = inputs.timeScale === undefined ? 1 : scalarValue(inputs.timeScale, "timeScale", context);
  const fluxScale = inputs.fluxScale === undefined ? 1 : scalarValue(inputs.fluxScale, "fluxScale", context);
  if (!(timeScale > 0) || !(fluxScale > 0) || !Number.isFinite(timeScale * (tMax - tMin)) || timeScale * (tMax - tMin) <= MIN_DISPLAY) invalid("scale", "sinusoid display scales must be positive with a resolved time interval");
  const samples = inputs.samples === undefined ? 65 : scalarValue(inputs.samples, "samples", context);
  if (!Number.isInteger(samples) || samples < 17 || samples > MAX_SAMPLES) invalid("samples", "sinusoid sampling requires 17..1025 points");
  const cycles = (angularFrequency * (tMax - tMin)) / (2 * Math.PI);
  if (!Number.isFinite(cycles) || cycles < 0) invalid("angularFrequency", "sinusoid cycle count is non-finite");
  if (cycles > MAX_CYCLES) invalid("angularFrequency", `sinusoid domain spans more than ${MAX_CYCLES} cycles; narrow the domain instead of undersampling`);
  if (cycles > 0 && samples - 1 < 32 * cycles) invalid("samples", "sinusoid sampling needs at least 32 intervals per cycle");
  const fluxUnit = inputs.fluxUnit === undefined ? "Wb" : unitKey(inputs.fluxUnit, FLUX_DENOMINATOR, "fluxUnit");
  const coupling = axis.x * areaVector.x + axis.y * areaVector.y + axis.z * areaVector.z;
  if (!Number.isFinite(coupling)) invalid("areaVector", "axis-area coupling is non-finite");
  const denominator = FIELD_DENOMINATOR[sourceUnits.field] * AREA_DENOMINATOR[sourceUnits.area];
  const scaled = (turns * coupling) / denominator;
  if (!Number.isFinite(scaled)) invalid("areaVector", "sinusoid coupling overflows finite numeric authority");
  const offset = scaled * b0;
  const amplitude = scaled * b1;
  if (!Number.isFinite(offset) || !Number.isFinite(amplitude)) invalid("b0", "sinusoid flux coefficients overflow finite numeric authority");
  const omegaSI = angularFrequency * TIME_DENOMINATOR[sourceUnits.time];
  if (!Number.isFinite(omegaSI)) invalid("angularFrequency", "angular frequency conversion is non-finite");
  return {
    model: "uniform_sinusoidal", axis, b0, b1, angularFrequency, frequencyUnit, phase, phaseUnit: "rad",
    areaVector, turns, sourceUnits, fluxUnit, couplingSI: { offset, amplitude }, omegaSI,
    tMin, tMax, origin: sinusoidPlacement(inputs.origin, "origin", context), timeScale, fluxScale, samples,
  };
}
function sinusoidSnapshot(model: SinusoidalFluxDefinition, time: number): { fluxSI: number; emfSI: number; timeSI: number } {
  if (!(time >= model.tMin) || !(time <= model.tMax)) invalid("time", "sinusoid state time lies outside the verified source-time domain");
  const angle = model.angularFrequency * time + model.phase;
  if (!Number.isFinite(angle)) invalid("time", "sinusoid phase evaluation is non-finite");
  const fluxSI = model.couplingSI.offset + model.couplingSI.amplitude * Math.sin(angle);
  const emfSI = -model.couplingSI.amplitude * model.omegaSI * Math.cos(angle);
  if (!Number.isFinite(fluxSI) || !Number.isFinite(emfSI)) invalid("time", "sinusoid flux or emf evaluation is non-finite");
  return { fluxSI, emfSI, timeSI: time / TIME_DENOMINATOR[model.sourceUnits.time] };
}
function sinusoidMapped(model: SinusoidalFluxDefinition, time: number, fluxSI: number): RenderPoint {
  const dx = model.timeScale * time;
  const dy = model.fluxScale * fluxSI * FLUX_DENOMINATOR[model.fluxUnit];
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) invalid("geometry", "sinusoid placement is non-finite");
  const result = finitePoint({ x: model.origin.x + dx, y: model.origin.y + dy }, "geometry");
  for (const axis of ["x", "y"] as const) {
    const delta = axis === "x" ? dx : dy;
    if (delta !== 0 && (result[axis] === model.origin[axis] || Math.abs((result[axis] - model.origin[axis]) - delta) > Math.abs(delta) * 1e-8)) invalid("precision", "sinusoid placement cannot retain source-time or flux displacement");
  }
  return result;
}
function sinusoidProcessGeometry(model: SinusoidalFluxDefinition): DistributedFieldsGeometry {
  const evaluate = (time: number): RenderPoint => {
    if (!Number.isFinite(time)) invalid("time", "sinusoid evaluation requires a finite source time");
    return sinusoidMapped(model, time, sinusoidSnapshot(model, time).fluxSI);
  };
  const derivative = (time: number): RenderPoint => {
    const value = sinusoidSnapshot(model, time);
    const slope = (-value.emfSI * model.fluxScale * FLUX_DENOMINATOR[model.fluxUnit]) / TIME_DENOMINATOR[model.sourceUnits.time];
    if (!Number.isFinite(slope)) invalid("time", "sinusoid derivative evaluation is non-finite");
    return { x: model.timeScale, y: slope };
  };
  let previous = -Infinity;
  const points = Array.from({ length: model.samples }, (_, index) => {
    const time = index === model.samples - 1 ? model.tMax : model.tMin + (model.tMax - model.tMin) * index / (model.samples - 1);
    if (!(time > previous)) invalid("precision", "source-time samples cannot collapse at floating precision");
    previous = time;
    return evaluate(time);
  });
  return { kind: "path", points, sinusoidalFlux: model, sampledCurve: { curveKind: "parametric", parameterMin: model.tMin, parameterMax: model.tMax, evaluate, derivative } };
}

const numericContext: DistributedFieldsEvaluationContext = {
  number: Number,
  point: () => invalid("point", "source model metadata cannot use point references"),
  geometry: () => undefined,
};
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((entry, index) => same(a[index], entry));
  if (isRecord(b)) return isRecord(a) && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([key, entry]) => same(a[key], entry));
  return a === b;
}
function verifiedSinusoidDefinition(value: unknown): SinusoidalFluxDefinition {
  if (!isRecord(value)) invalid("process", "sinusoid references require typed process metadata");
  const asArray = (entry: unknown): number[] => {
    if (!isRecord(entry)) invalid("process", "sinusoid source metadata requires Cartesian vectors");
    inputKeys(entry, AXES, "process");
    if (AXES.some((axis) => typeof entry[axis] !== "number")) invalid("process", "sinusoid source metadata must retain numerical vectors");
    return AXES.map((axis) => entry[axis] as number);
  };
  const model = sinusoidDefinition({
    model: value.model, axis: asArray(value.axis), b0: value.b0, b1: value.b1,
    angularFrequency: value.angularFrequency, frequencyUnit: value.frequencyUnit, phase: value.phase, phaseUnit: value.phaseUnit,
    areaVector: asArray(value.areaVector), turns: value.turns, tMin: value.tMin, tMax: value.tMax,
    units: value.sourceUnits, fluxUnit: value.fluxUnit, origin: value.origin,
    timeScale: value.timeScale, fluxScale: value.fluxScale, samples: value.samples,
  }, numericContext);
  if (!same(value, model)) invalid("process", "sinusoid metadata contradicts its explicit source laws and SI coefficients");
  return model;
}
function verifiedSinusoidProcess(value: unknown): SinusoidalFluxDefinition {
  if (!isRecord(value) || value.kind !== "path") invalid("process", "sinusoid_state requires a verified flux_sinusoid curve");
  inputKeys(value, ["kind", "points", "sinusoidalFlux", "sampledCurve"], "process");
  const model = verifiedSinusoidDefinition(value.sinusoidalFlux);
  const expected = sinusoidProcessGeometry(model);
  if (!("sinusoidalFlux" in expected) || !same(value.points, expected.points) || !isRecord(value.sampledCurve)
    || value.sampledCurve.curveKind !== "parametric" || value.sampledCurve.parameterMin !== model.tMin || value.sampledCurve.parameterMax !== model.tMax
    || typeof value.sampledCurve.evaluate !== "function" || typeof value.sampledCurve.derivative !== "function") invalid("process", "sinusoid curve geometry must retain its analytic source-time identity");
  inputKeys(value.sampledCurve, ["curveKind", "parameterMin", "parameterMax", "evaluate", "derivative"], "process");
  for (const time of [model.tMin, (model.tMin + model.tMax) / 2, model.tMax]) {
    const actual = value.sampledCurve as unknown as CalculusCurveDefinition;
    if (!same(actual.evaluate(time), expected.sampledCurve.evaluate(time)) || !same(actual.derivative!(time), expected.sampledCurve.derivative!(time))) invalid("process", "sinusoid curve callbacks contradict its source-derived law");
  }
  return model;
}

/** Every distribution, surface, current, and time law is explicit; no stem
 * classification or guessed arrangement. */
export function evaluateDistributedFieldsConstruction(operator: string, inputs: Record<string, unknown>, context: DistributedFieldsEvaluationContext): DistributedFieldsGeometry[] {
  if (operator === "line_charge_field") return [lineChargeMark(lineChargeDefinition(inputs, context))];
  if (operator === "gauss_flux") return gaussFluxMarks(gaussFluxDefinition(inputs, context));
  if (operator === "wire_field") return [wireFieldMark(wireFieldDefinition(inputs, context))];
  if (operator === "loop_field") return [loopFieldMark(loopFieldDefinition(inputs, context))];
  if (operator === "flux_sinusoid") return [sinusoidProcessGeometry(sinusoidDefinition(inputs, context))];
  if (operator === "sinusoid_state") {
    inputKeys(inputs, ["process", "time", "emfAt"]);
    if (typeof inputs.process !== "string" || !inputs.process.trim()) invalid("process", "sinusoid_state requires an explicit flux_sinusoid ID");
    const time = scalarValue(inputs.time, "time", context, MAX_TIME);
    const model = verifiedSinusoidProcess(context.geometry(inputs.process));
    checkSinusoidUnits(inputs, undefined, model);
    const values = sinusoidSnapshot(model, time);
    const state = { processId: inputs.process, process: model, sourceTime: time, ...values };
    return [
      { kind: "point", point: sinusoidMapped(model, time, values.fluxSI), sinusoidState: { ...state, component: "flux" }, calculusAnchor: { curveId: inputs.process, parameter: time } },
      { kind: "point", point: sinusoidPlacement(inputs.emfAt, "emfAt", context, model.origin), sinusoidState: { ...state, component: "emf" } },
    ];
  }
  return invalid("operator", `unsupported distributed-field operator ${operator}`);
}

function compactNumber(value: number): string {
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  return magnitude >= 0.001 && magnitude < 10000 ? Number(value.toPrecision(3)).toString() : value.toExponential(1).replace("e+", "e");
}
function isFinitePoint(value: unknown): value is RenderPoint {
  return isRecord(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y);
}
function checkLineChargeGeometry(output: unknown): LineChargeFieldDefinition {
  if (!isRecord(output) || !isRecord(output.lineChargeField)) invalid("outputs", "line charge result metadata is malformed");
  const field = output.lineChargeField as unknown as LineChargeFieldDefinition;
  if (!isFinitePoint(field.at) || !isFinitePoint(field.components) || typeof field.magnitude !== "number" || field.magnitude !== Math.hypot(field.components.x, field.components.y)) invalid("outputs", "line charge field metadata is inconsistent");
  return field;
}
function checkWireGeometry(output: unknown): WireFieldDefinition {
  if (!isRecord(output) || !isRecord(output.wireField)) invalid("outputs", "wire result metadata is malformed");
  return output.wireField as unknown as WireFieldDefinition;
}
function checkLoopGeometry(output: unknown): LoopFieldDefinition {
  if (!isRecord(output) || !isRecord(output.loopField)) invalid("outputs", "loop result metadata is malformed");
  return output.loopField as unknown as LoopFieldDefinition;
}
function checkGaussGeometries(outputs: readonly unknown[]): GaussFluxDefinition {
  if (outputs.length !== 2) invalid("outputs", "gauss_flux requires its surface and flux outputs");
  const [surface, anchor] = outputs;
  if (!isRecord(surface) || surface.kind !== "circle" || !isRecord(surface.gaussFlux)) invalid("outputs", "gauss surface geometry is malformed");
  if (!isRecord(anchor) || anchor.kind !== "point" || !isRecord(anchor.gaussFlux)) invalid("outputs", "gauss flux anchor geometry is malformed");
  if (!same(surface.gaussFlux, anchor.gaussFlux)) invalid("outputs", "gauss surface and flux outputs must share one verified definition");
  return surface.gaussFlux as unknown as GaussFluxDefinition;
}
function verifiedSinusoidStates(outputs: readonly unknown[]): SinusoidStateDefinition[] {
  if (outputs.length !== 2) invalid("outputs", "sinusoid_state requires ordered flux and emf outputs");
  return outputs.map((output, index) => {
    if (!isRecord(output) || output.kind !== "point" || !isRecord(output.sinusoidState)) invalid("outputs", "sinusoid outputs require typed point/scalar-anchor geometry");
    inputKeys(output, index === 0 ? ["kind", "point", "sinusoidState", "calculusAnchor"] : ["kind", "point", "sinusoidState"], "outputs");
    const state = output.sinusoidState;
    inputKeys(state, ["processId", "process", "sourceTime", "timeSI", "fluxSI", "emfSI", "component"], "outputs");
    if (typeof state.processId !== "string" || !state.processId.trim() || typeof state.sourceTime !== "number" || state.component !== (index === 0 ? "flux" : "emf")) invalid("outputs", "sinusoid output order and source-time identity must be preserved");
    const model = verifiedSinusoidDefinition(state.process);
    const values = sinusoidSnapshot(model, state.sourceTime as number);
    const expected: SinusoidStateDefinition = { processId: state.processId as string, process: model, sourceTime: state.sourceTime as number, ...values, component: index === 0 ? "flux" : "emf" };
    if (!same(state, expected)) invalid("outputs", "sinusoid state metadata contradicts its flux law and signed Lenz derivative");
    if (index === 0 && (!same(output.point, sinusoidMapped(model, state.sourceTime as number, values.fluxSI)) || !same(output.calculusAnchor, { curveId: state.processId, parameter: state.sourceTime }))) invalid("outputs", "sinusoid flux point must have exact process incidence");
    if (index === 1) {
      const placed = sinusoidPlacement(output.point, "emfAt", numericContext);
      if (!same(placed, output.point)) invalid("outputs", "emf anchor must retain finite display coordinates");
      const first = outputs[0];
      if (!isRecord(first) || !isRecord(first.sinusoidState) || !same({ ...state, component: "flux" }, first.sinusoidState)) invalid("outputs", "flux/emf state outputs must share one verified source snapshot");
    }
    return expected;
  });
}

type AllowedLabel = { symbol: string; numeric?: string };
function lineChargeLabels(output: unknown): AllowedLabel {
  const field = checkLineChargeGeometry(output);
  if (field.mode === "si") return { symbol: "E", numeric: `E=${compactNumber(field.magnitude)} N/C` };
  return field.magnitude === 0 ? { symbol: "E=0 schematic", numeric: "E=0 schematic" } : { symbol: "E schematic" };
}
function wireLabels(output: unknown): AllowedLabel {
  const field = checkWireGeometry(output);
  const glyph = field.pageNormal ? field.pageNormal === "out" ? " ⊙" : " ⊗" : "";
  if (field.model === "finite_segment") {
    if (field.mode === "si") {
      const value = field.components.z;
      return { symbol: `Bz${glyph}`, numeric: `Bz=${compactNumber(value)} T${glyph}` };
    }
    return field.zero ? { symbol: "Bz=0 schematic", numeric: "Bz=0 schematic" } : { symbol: `Bz schematic${glyph}` };
  }
  if (field.mode === "si") return { symbol: "B", numeric: `|B|=${compactNumber(field.magnitude)} T` };
  return field.zero ? { symbol: "B=0 schematic", numeric: "B=0 schematic" } : { symbol: "B schematic" };
}
function loopLabels(output: unknown): AllowedLabel {
  const field = checkLoopGeometry(output);
  const glyph = field.pageNormal ? field.pageNormal === "out" ? " ⊙" : " ⊗" : "";
  if (field.mode === "si") return { symbol: `Bz${glyph}`, numeric: `Bz=${compactNumber(field.axialField)} T${glyph}` };
  return field.zero ? { symbol: "Bz=0 schematic", numeric: "Bz=0 schematic" } : { symbol: `Bz schematic${glyph}` };
}
function gaussLabels(outputs: readonly unknown[]): AllowedLabel[] {
  const definition = checkGaussGeometries(outputs);
  const flux = definition.mode === "si"
    ? { symbol: "Phi", numeric: `Phi=${compactNumber(definition.flux)} V*m` }
    : definition.flux === 0
      ? { symbol: "Phi=0 schematic", numeric: "Phi=0 schematic" }
      : { symbol: "Phi schematic" };
  return [{ symbol: "S" }, flux];
}
function sinusoidLabels(operator: string, outputs: readonly unknown[]): AllowedLabel[] {
  if (operator === "flux_sinusoid") {
    if (outputs.length !== 1) invalid("outputs", "flux_sinusoid requires one complete evaluated output");
    verifiedSinusoidProcess(outputs[0]);
    return [{ symbol: "Phi(t)" }];
  }
  if (operator !== "sinusoid_state") invalid("operator", "sinusoid labels require a supported operator");
  return verifiedSinusoidStates(outputs).map((state) => state.component === "flux"
    ? { symbol: "Phi(t)", numeric: `Phi=${compactNumber(state.fluxSI)} Wb` }
    : { symbol: "emf(t)", numeric: `emf=${compactNumber(state.emfSI)} V` });
}
function allowedLabels(operator: string, outputs: readonly unknown[]): AllowedLabel[] {
  if (operator === "line_charge_field") {
    if (outputs.length !== 1) invalid("outputs", "line_charge_field requires one complete evaluated output");
    return [lineChargeLabels(outputs[0])];
  }
  if (operator === "wire_field") {
    if (outputs.length !== 1) invalid("outputs", "wire_field requires one complete evaluated output");
    return [wireLabels(outputs[0])];
  }
  if (operator === "loop_field") {
    if (outputs.length !== 1) invalid("outputs", "loop_field requires one complete evaluated output");
    return [loopLabels(outputs[0])];
  }
  if (operator === "gauss_flux") return gaussLabels(outputs);
  return sinusoidLabels(operator, outputs);
}

/** The compiler owns these labels; model-supplied numerical result labels
 * cannot pair with verified ink unless they match exactly. */
export function distributedFieldsConstructionOutputLabels(operator: string, outputs: readonly unknown[], requestedTexts?: readonly unknown[]): string[] {
  const labels = allowedLabels(operator, outputs);
  if (requestedTexts !== undefined && requestedTexts.length !== labels.length) invalid("outputs", "distributed-field label count must match every evaluated output");
  return labels.map((label, index) => {
    const requested = requestedTexts?.[index];
    if (requested !== undefined && requested !== label.symbol && requested !== label.numeric) invalid("label", "distributed-field labels must use their symbolic state or verified signed SI scalar");
    return requested === label.numeric && label.numeric !== undefined ? label.numeric : label.symbol;
  });
}

function checkDeclaredConstantUnit(inputs: Record<string, unknown>, key: "muUnit" | "epsilonUnit", allowed: ReadonlySet<string>, mode: "schematic" | "si"): void {
  const value = inputs[key];
  if (mode === "schematic") {
    if (value !== undefined) invalid(key, `${key} must be omitted in schematic mode`);
    return;
  }
  if (typeof value !== "string" || !allowed.has(value.trim())) invalid(key, `${key} must declare a supported SI unit`);
}

/** Source-unit authority: every known quantity wrapper must use the declared
 * scale; mixed scales are never silently reinterpreted. */
function checkDocumentSourceUnits(operator: string, inputs: Record<string, unknown>, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>): void {
  const mode = inputs.mode;
  const schematic = mode === "schematic";
  const declaredLength = typeof inputs.lengthUnit === "string" ? inputs.lengthUnit.trim() : undefined;
  const compare = (value: unknown, key: string, units: Map<string, number>, declared: string | undefined): void => {
    for (const unit of scalarUnits(value, key, document)) {
      if (schematic && declared === undefined && DIMENSIONLESS_UNITS.has(unit)) continue;
      if (declared === undefined || !units.has(unit) || units.get(unit) !== units.get(declared)) invalid(`${key}_unit`, `${key} must use the declared unit scale; mixed source scales are not silently reinterpreted`);
    }
  };
  const inheritedLengths = (value: unknown, key: string, ancestors = new Set<string>(), depth = 0): void => {
    if (depth > MAX_SCALAR_DEPTH) invalid(`${key}_unit`, "derived source length-unit dependencies exceed the verification bound");
    if (typeof value === "string" && constructionByOutput.has(value)) {
      if (ancestors.has(value)) invalid(`${key}_unit`, "derived source length-unit dependencies are cyclic");
      const producer = constructionByOutput.get(value)!;
      if (producer.operator === "point") {
        compare(producer.inputs.x, `${key}.x`, LENGTH_UNITS, declaredLength);
        compare(producer.inputs.y, `${key}.y`, LENGTH_UNITS, declaredLength);
        return;
      }
      const next = new Set([...ancestors, value]);
      for (const [name, item] of Object.entries(producer.inputs)) {
        if (["kind", "feature", "mode", "axis", "component", "label", "model"].includes(name)) continue;
        inheritedLengths(item, key, next, depth + 1);
      }
      return;
    }
    if (scalarUnits(value, key, document).some((unit) => LENGTH_UNITS.has(unit))) { compare(value, key, LENGTH_UNITS, declaredLength); return; }
    if (Array.isArray(value)) for (const item of value) inheritedLengths(item, key, ancestors, depth + 1);
    else if (isRecord(value)) for (const [name, item] of Object.entries(value)) if (name !== "unit") inheritedLengths(item, key, ancestors, depth + 1);
  };
  const coordinates = (value: unknown, key: string): void => {
    if (isRecord(value)) { compare(value.x, `${key}.x`, LENGTH_UNITS, declaredLength); compare(value.y, `${key}.y`, LENGTH_UNITS, declaredLength); }
    else if (Array.isArray(value)) { compare(value[0], `${key}.x`, LENGTH_UNITS, declaredLength); compare(value[1], `${key}.y`, LENGTH_UNITS, declaredLength); }
    else if (typeof value === "string") {
      const producer = constructionByOutput.get(value);
      if (producer?.operator === "point") { compare(producer.inputs.x, `${key}.x`, LENGTH_UNITS, declaredLength); compare(producer.inputs.y, `${key}.y`, LENGTH_UNITS, declaredLength); }
      else if (producer) inheritedLengths(value, key);
    }
  };
  const constantUnits = (value: unknown, key: string, allowed: ReadonlySet<string>): void => {
    for (const unit of scalarUnits(value, key, document)) {
      if (schematic ? !DIMENSIONLESS_UNITS.has(unit) : !allowed.has(unit)) invalid(`${key}_unit`, `${key} uses a unit outside its declared physical scale`);
    }
  };
  if (operator === "line_charge_field") {
    coordinates(inputs.start, "start");
    coordinates(inputs.end, "end");
    coordinates(inputs.at, "at");
    compare(inputs.displayLength, "displayLength", LENGTH_UNITS, declaredLength);
    compare(inputs.chargeDensity, "chargeDensity", DENSITY_UNITS, typeof inputs.densityUnit === "string" ? inputs.densityUnit.trim() : undefined);
    constantUnits(inputs.k, "k", COULOMB_COEFFICIENT_UNITS);
  } else if (operator === "gauss_flux") {
    coordinates(inputs.center, "center");
    compare(inputs.radius, "radius", LENGTH_UNITS, declaredLength);
    compare(inputs.enclosedCharge, "enclosedCharge", CHARGE_UNITS, typeof inputs.chargeUnit === "string" ? inputs.chargeUnit.trim() : undefined);
    constantUnits(inputs.epsilon0, "epsilon0", PERMITTIVITY_UNITS);
    if (typeof inputs.fluxAt === "string") coordinates(inputs.fluxAt, "fluxAt");
  } else if (operator === "wire_field" || operator === "loop_field") {
    if (operator === "wire_field" && inputs.model === "infinite_wire") coordinates(inputs.wire, "wire");
    if (operator === "wire_field" && inputs.model === "finite_segment") { coordinates(inputs.start, "start"); coordinates(inputs.end, "end"); }
    if (operator === "wire_field") coordinates(inputs.at, "at");
    if (operator === "loop_field") { coordinates(inputs.center, "center"); compare(inputs.radius, "radius", LENGTH_UNITS, declaredLength); }
    compare(inputs.displayLength, "displayLength", LENGTH_UNITS, declaredLength);
    compare(inputs.current, "current", CURRENT_UNITS, typeof inputs.currentUnit === "string" ? inputs.currentUnit.trim() : undefined);
    constantUnits(inputs.mu0, "mu0", PERMEABILITY_UNITS);
  } else {
    checkSinusoidUnits(inputs, document);
    if (operator === "sinusoid_state" && typeof inputs.process === "string") {
      const producer = constructionByOutput.get(inputs.process);
      if (producer?.operator === "flux_sinusoid") {
        const context: DistributedFieldsEvaluationContext = {
          number: (value) => validationNumber(value, document),
          point: () => invalid("placement", "sinusoid only accepts explicit inline display placement"),
          geometry: () => undefined,
        };
        checkSinusoidUnits(inputs, document, sinusoidDefinition(producer.inputs, context));
      }
    }
  }
}

function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > MAX_SCALAR_DEPTH || seen.has(value)) invalid("quantity", "distributed-field quantity references must be acyclic within depth 32");
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

function checkNumericAnnotation(construction: SceneConstruction, outputId: string, document: SceneDocument, expected: number, units: readonly string[], label: AllowedLabel): void {
  const checkText = (text: unknown): void => {
    if (text !== undefined && text !== label.symbol && text !== label.numeric) invalid("label", "distributed-field result labels must use their symbol or verified SI scalar");
  };
  checkText(document.entities.find((entity) => entity.id === outputId)?.label);
  for (const annotation of document.annotations) {
    if (!annotation.targetIds.includes(outputId) || !["label", "callout", "badge"].includes(annotation.kind)) continue;
    checkText(annotation.text);
    if (annotation.quantityId === undefined) continue;
    const declared = scalarUnits(annotation.quantityId, "annotation", document);
    if (!declared.length || declared.some((unit) => !units.includes(unit)) || declared.some((unit) => unit !== declared[0])) invalid("label", "distributed-field scalar annotation must declare a consistent physical unit scale");
    const actual = validationNumber(annotation.quantityId, document);
    const scaled = declared[0] === "mWb" || declared[0] === "mV" || declared[0] === "mV*m" ? actual / 1000 : actual;
    const tolerance = 128 * Number.EPSILON * Math.max(Math.abs(expected), Math.abs(scaled));
    if (Math.abs(scaled - expected) > tolerance && !(expected === 0 && scaled === 0)) invalid("label", "distributed-field annotation contradicts its source-derived physical value");
  }
  for (const other of document.constructions) {
    if (other.operator === "label" && (other.inputs.target ?? other.inputs.at ?? other.inputs.point) === outputId) checkText(other.inputs.text);
  }
}

/** Rechecks result labels against actual compiled geometry, including derived source points. */
export function validateEvaluatedDistributedFieldsLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  try {
    const labels = allowedLabels(construction.operator, outputs);
    const expectedScalars = ((): (number | null)[] => {
      if (construction.operator === "line_charge_field") return [checkLineChargeGeometry(outputs[0]).magnitude];
      if (construction.operator === "wire_field") {
        const field = checkWireGeometry(outputs[0]);
        return [field.model === "finite_segment" ? field.components.z : field.magnitude];
      }
      if (construction.operator === "loop_field") return [checkLoopGeometry(outputs[0]).axialField];
      if (construction.operator === "gauss_flux") return [null, checkGaussGeometries(outputs).flux];
      if (construction.operator === "sinusoid_state") {
        const states = verifiedSinusoidStates(outputs);
        return [states[0]!.fluxSI, states[1]!.emfSI];
      }
      return [null];
    })();
    const expectedUnits: readonly string[][] = construction.operator === "line_charge_field" ? [["N/C"]]
      : construction.operator === "wire_field" || construction.operator === "loop_field" ? [["T"]]
      : construction.operator === "gauss_flux" ? [[], ["V*m", "mV*m"]]
      : construction.operator === "sinusoid_state" ? [["Wb", "mWb"], ["V", "mV"]]
      : [[]];
    for (const [outputIndex, outputId] of construction.outputs.entries()) {
      const label = labels[outputIndex]!;
      const expected = expectedScalars[outputIndex];
      if (expected === null || expected === undefined) {
        const checkText = (text: unknown): void => {
          if (text !== undefined && text !== label.symbol && text !== label.numeric) invalid("label", "distributed-field labels must use their engine-assigned symbol");
        };
        checkText(document.entities.find((entity) => entity.id === outputId)?.label);
        for (const annotation of document.annotations) {
          if (!annotation.targetIds.includes(outputId)) continue;
          checkText(annotation.text);
          if (annotation.quantityId !== undefined) invalid("label", "a surface or process curve carries no single scalar annotation");
        }
        for (const other of document.constructions) {
          if (other.operator === "label" && (other.inputs.target ?? other.inputs.at ?? other.inputs.point) === outputId) checkText(other.inputs.text);
        }
        continue;
      }
      checkNumericAnnotation(construction, outputId, document, expected, expectedUnits[outputIndex]!, label);
    }
  } catch (error) {
    issues.push({ code: `invalid_${construction.operator}_label`, severity: "fatal", message: error instanceof Error ? error.message : "distributed-field result labels are invalid", path: `constructions[${index}].outputs` });
  }
}

class DeferredDistributedPoint extends DistributedFieldsInputError {
  constructor() { super("point", "derived point coordinates will be verified during compilation"); }
}

/** Validates the same authority contract before any partial construction can render. */
export function validateDistributedFieldsConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const { operator, inputs } = construction;
  const add = (key: string, message: string, actual?: unknown): void => {
    issues.push({ code: `invalid_${operator}_${key}`, severity: "fatal", message, path: `constructions[${index}].${key === "outputs" || key === "output_kind" || key === "label" ? "outputs" : `inputs.${key}`}`, actual });
  };
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const expectedKinds = operator === "gauss_flux" ? ["circle", "label"]
    : operator === "sinusoid_state" ? ["point", "label"]
    : operator === "flux_sinusoid" ? ["polyline"]
    : ["vector"];
  if (outputs.length !== expectedKinds.length || outputs.some((output) => typeof output !== "string" || !output.trim()) || new Set(outputs).size !== expectedKinds.length) add("outputs", `${operator} requires exactly ${expectedKinds.length} distinct output entities`, construction.outputs);
  outputs.forEach((output, outputIndex) => {
    const entity = document.entities.find((candidate) => candidate.id === output);
    if (!entity || entity.kind !== expectedKinds[outputIndex]) add("output_kind", `${operator} output ${outputIndex} must be a ${expectedKinds[outputIndex]} entity`, entity?.kind);
  });
  if (!isRecord(inputs)) { add("fields", "distributed-field construction inputs must be an object"); return; }
  const context: DistributedFieldsEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      if (typeof value !== "string") return pointValue(value, "point", context);
      const producer = constructionByOutput.get(value);
      const entity = document.entities.find((candidate) => candidate.id === value);
      if (!producer || entity?.kind !== "point") invalid("point", "distributed-field source and observation references must name constructed point entities");
      if (producer.operator !== "point") throw new DeferredDistributedPoint();
      return { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) };
    },
    geometry(value) {
      if (typeof value !== "string") return undefined;
      const producer = constructionByOutput.get(value);
      if (!producer) return undefined;
      if (operator === "sinusoid_state") {
        if (producer.operator !== "flux_sinusoid" || document.entities.find((entity) => entity.id === value)?.kind !== "polyline") invalid("process", "sinusoid_state must reference a flux_sinusoid curve");
        checkSinusoidUnits(producer.inputs, document);
        return evaluateDistributedFieldsConstruction(producer.operator, producer.inputs, context)[0];
      }
      if (document.entities.find((entity) => entity.id === value)?.kind === "point") return { kind: "point", point: context.point(value) };
      return undefined;
    },
  };
  try {
    if (operator === "gauss_flux" || operator === "wire_field" || operator === "loop_field") {
      const mode = modeValue(inputs);
      if (operator === "gauss_flux") checkDeclaredConstantUnit(inputs, "epsilonUnit", PERMITTIVITY_UNITS, mode);
      else checkDeclaredConstantUnit(inputs, "muUnit", PERMEABILITY_UNITS, mode);
    }
    checkDocumentSourceUnits(operator, inputs, document, constructionByOutput);
    const evaluated = evaluateDistributedFieldsConstruction(operator, inputs, context);
    validateEvaluatedDistributedFieldsLabels(construction, index, document, evaluated, issues);
  } catch (error) {
    if (error instanceof DeferredDistributedPoint) return;
    add(error instanceof DistributedFieldsInputError ? error.key : "fields", error instanceof Error ? error.message : "distributed-field inputs are invalid");
  }
}
