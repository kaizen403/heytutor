import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const ROTATION_OPERATORS = ["rotational_motion", "rotational_state", "planar_torque"] as const;
export interface RotationMotionDefinition {
  radius: number; angle: number; angleUnit: "rad"; angularVelocity: number; angularAcceleration: number;
  units: { length: string; time: string }; angularVelocityUnit: string; angularAccelerationUnit: string;
  radiusSI: number; angularVelocitySI: number; angularAccelerationSI: number;
  radialSource: RenderPoint; radialSI: RenderPoint; origin: RenderPoint; displayScale: number; displayAnchor: RenderPoint;
}
export interface RotationVectorDefinition {
  motionId: string; quantity: "velocity" | "tangential_acceleration" | "centripetal_acceleration" | "acceleration";
  componentsSI: RenderPoint; magnitudeSI: number; unit: "m/s" | "m/s^2"; zero: boolean;
  radialSI: RenderPoint; radiusSI: number; angularVelocitySI: number; angularAccelerationSI: number;
  origin: RenderPoint; displayLength: number;
}
export interface PlanarTorqueDefinition {
  leverArm: RenderPoint; force: RenderPoint; lengthUnit: string; forceUnit: "N";
  leverArmSI: RenderPoint; torqueSI: number; unit: "N*m"; zero: boolean; pageNormal: "out" | "in" | null;
  origin: RenderPoint; displayLength: number;
}
export type RotationGeometry =
  | { kind: "point"; point: RenderPoint; rotationalMotion: RotationMotionDefinition }
  | { kind: "point"; point: RenderPoint; rotationalVector: RotationVectorDefinition }
  | { kind: "path"; points: RenderPoint[]; directed: true; rotationalVector: RotationVectorDefinition }
  | { kind: "point"; point: RenderPoint; planarTorque: PlanarTorqueDefinition }
  | { kind: "multi_path"; paths: RenderPoint[][]; planarTorque: PlanarTorqueDefinition };
export interface RotationEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
const MAX_SOURCE = 1e12;
const MAX_SI = 1e15;
const MAX_DISPLAY = 1e9;
const MAX_ANGLE = 1e6;
const MIN_LENGTH = 1e-6;
const RELATIVE_ERROR = 64 * Number.EPSILON;
const INPUT_KEYS: Readonly<Record<string, readonly string[]>> = {
  rotational_motion: ["radius", "angle", "angleUnit", "angularVelocity", "angularAcceleration", "units", "angularVelocityUnit", "angularAccelerationUnit", "origin", "displayScale"],
  rotational_state: ["motion", "kind", "displayLength"], planar_torque: ["leverArm", "force", "lengthUnit", "forceUnit", "origin", "displayLength"],
};
class RotationInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new RotationInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fields(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void { if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) invalid(key, "rotational construction contains unsupported fields"); }
function finite(value: number, key: string, cap = MAX_SOURCE): number { if (!Number.isFinite(value) || Math.abs(value) > cap) invalid(key, `${key} must remain finite with magnitude at most ${cap}`); return value === 0 ? 0 : value; }
function preserveLiteral(value: unknown, key: string): void { const match = typeof value === "string" && /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE][+-]?\d+)?$/.exec(value.trim()); if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) invalid(key, "nonzero source literals cannot become a certified zero"); }
function scalar(value: unknown, key: string, context: RotationEvaluationContext, cap = MAX_SOURCE, depth = 0): number {
  if (depth > 32) invalid(key, "rotational numeric references exceed depth32"); if (isRecord(value)) { fields(value, ["value", "unit"], key); return scalar(value.value, key, context, cap, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, "rotation scalars require a literal, numeric string, or quantity reference"); preserveLiteral(value, key);
  try { return finite(context.number(value), key, cap); } catch (error) { if (error instanceof RotationInputError) throw error; return invalid(key, "rotation scalar must resolve to a finite number"); }
}
function product(a: number, b: number, key: string, cap = MAX_SI): number { return numeric(multiply(exact(a), exact(b)), key, cap); }
type Unit = { canonical: string; factor: number };
const UNITS: Readonly<Record<string, Readonly<Record<string, Unit>>>> = {
  length: { m: { canonical: "m", factor: 1 }, cm: { canonical: "cm", factor: 0.01 }, mm: { canonical: "mm", factor: 0.001 }, km: { canonical: "km", factor: 1000 } },
  time: { s: { canonical: "s", factor: 1 }, ms: { canonical: "ms", factor: 0.001 } }, phase: { rad: { canonical: "rad", factor: 1 } }, force: { n: { canonical: "N", factor: 1 } },
};
function normalizedUnit(value: string): string { return value.trim().replaceAll("²", "^2").replaceAll("·", "*"); }
function unit(value: unknown, kind: string): Unit { const found = typeof value === "string" ? Object.values(UNITS[kind] ?? {}).find((entry) => entry.canonical === normalizedUnit(value)) : undefined; if (!found) invalid("units", `rotation requires a supported case-sensitive ${kind} unit`); return found; }
function sourceUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) invalid("units", "rotational source units must be acyclic and bounded"); const record = isRecord(value) ? value : typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : undefined; if (!record) return [];
  if (record.unit !== undefined && (typeof record.unit !== "string" || !record.unit.trim())) invalid("units", "known rotational units must be nonempty strings"); seen.add(value); return [...(typeof record.unit === "string" ? [record.unit] : []), ...("value" in record ? sourceUnits(record.value, document, seen, depth + 1) : [])];
}
function matches(value: unknown, declared: string, document?: SceneDocument): void { for (const actual of sourceUnits(value, document)) if (normalizedUnit(actual) !== normalizedUnit(declared)) invalid("units", "quantity-bound rotational values must use the declared common source scale"); }
function dimensionless(value: unknown, document?: SceneDocument): void { for (const actual of sourceUnits(value, document)) if (!["1", "dimensionless", "unit", "units"].includes(normalizedUnit(actual))) invalid("units", "rotational display parameters must be dimensionless"); }
function motionUnits(inputs: Record<string, unknown>): RotationMotionDefinition["units"] {
  if (!isRecord(inputs.units)) invalid("units", "rotational motion requires explicit length and time units"); fields(inputs.units, ["length", "time"], "units"); const length = unit(inputs.units.length, "length").canonical; const time = unit(inputs.units.time, "time").canonical;
  if (typeof inputs.angularVelocityUnit !== "string" || normalizedUnit(inputs.angularVelocityUnit) !== `rad/${time}` || typeof inputs.angularAccelerationUnit !== "string" || normalizedUnit(inputs.angularAccelerationUnit) !== `rad/${time}^2`) invalid("units", "angular rates must explicitly use radians per declared source-time unit and its square"); return { length, time };
}
function checkUnits(operator: string, inputs: Record<string, unknown>, document?: SceneDocument): void {
  for (const key of ["displayLength", "displayScale"]) if (inputs[key] !== undefined) dimensionless(inputs[key], document);
  const coordinates = Array.isArray(inputs.origin) ? inputs.origin : isRecord(inputs.origin) ? [inputs.origin.x, inputs.origin.y] : []; coordinates.forEach((coordinate) => dimensionless(coordinate, document));
  if (operator === "rotational_motion") { const declared = motionUnits(inputs); matches(inputs.radius, declared.length, document); matches(inputs.angle, "rad", document); matches(inputs.angularVelocity, `rad/${declared.time}`, document); matches(inputs.angularAcceleration, `rad/${declared.time}^2`, document); }
  if (operator === "planar_torque") { const length = unit(inputs.lengthUnit, "length"); const force = unit(inputs.forceUnit, "force"); for (const [value, declared] of [[inputs.leverArm, length.canonical], [inputs.force, force.canonical]] as const) if (Array.isArray(value)) value.forEach((coordinate) => matches(coordinate, declared, document)); }
}
function inlinePoint(value: unknown, key: string, context: RotationEvaluationContext, optional = false): RenderPoint {
  if (value === undefined && optional) return { x: 0, y: 0 }; if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], key, context), y: scalar(value[1], key, context) };
  if (isRecord(value) && optional) { fields(value, ["x", "y"], key); return { x: scalar(value.x, key, context), y: scalar(value.y, key, context) }; } return invalid(key, "rotation requires explicit inline 2D coordinates; no geometry is reinterpreted");
}
function displayLength(value: unknown, context: RotationEvaluationContext): number { const result = scalar(value, "displayLength", context, MAX_DISPLAY); if (!(result > MIN_LENGTH)) invalid("displayLength", "rotational displayLength must be positive and visible"); return result; }
function placed(origin: RenderPoint, delta: RenderPoint, key: string): RenderPoint {
  const point = { x: finite(origin.x + delta.x, key), y: finite(origin.y + delta.y, key) }; const magnitude = Math.hypot(delta.x, delta.y);
  if (!(magnitude > MIN_LENGTH) || Math.hypot(point.x - origin.x - delta.x, point.y - origin.y - delta.y) > magnitude * 1e-8) invalid("precision", "rotational placement cannot retain its nonzero length and direction"); return point;
}
function readMotion(inputs: Record<string, unknown>, context: RotationEvaluationContext): RotationMotionDefinition {
  const units = motionUnits(inputs); unit(inputs.angleUnit, "phase"); const radius = scalar(inputs.radius, "radius", context); if (!(radius > 0)) invalid("radius", "rotational radius must be positive");
  const angle = scalar(inputs.angle, "angle", context, MAX_ANGLE); const angularVelocity = scalar(inputs.angularVelocity, "angularVelocity", context); const angularAcceleration = scalar(inputs.angularAcceleration, "angularAcceleration", context);
  const radiusSI = product(radius, unit(units.length, "length").factor, "radiusSI"); const timeFactor = unit(units.time, "time").factor; const angularVelocitySI = product(angularVelocity, 1 / timeFactor, "angularVelocitySI"); const angularAccelerationSI = product(angularAcceleration, 1 / timeFactor ** 2, "angularAccelerationSI");
  const radialSource = { x: product(radius, Math.cos(angle), "radialSource"), y: product(radius, Math.sin(angle), "radialSource") }; const radialSI = { x: product(radiusSI, Math.cos(angle), "radialSI"), y: product(radiusSI, Math.sin(angle), "radialSI") };
  const origin = inlinePoint(inputs.origin, "origin", context, true); const displayScale = scalar(inputs.displayScale, "displayScale", context, MAX_DISPLAY); if (!(displayScale > 0)) invalid("displayScale", "rotational motion requires an explicit positive radius display scale");
  const displayAnchor = placed(origin, { x: product(radialSource.x, displayScale, "displayScale", MAX_SOURCE), y: product(radialSource.y, displayScale, "displayScale", MAX_SOURCE) }, "geometry");
  return { radius, angle, angleUnit: "rad", angularVelocity, angularAcceleration, units, angularVelocityUnit: `rad/${units.time}`, angularAccelerationUnit: `rad/${units.time}^2`, radiusSI, angularVelocitySI, angularAccelerationSI, radialSource, radialSI, origin, displayScale, displayAnchor };
}
type Exact = { n: bigint; e: number };
const bits = new DataView(new ArrayBuffer(8));
function exact(value: number): Exact {
  if (value === 0) return { n: 0n, e: 0 }; bits.setFloat64(0, value); const raw = bits.getBigUint64(0); const exponent = Number((raw >> 52n) & 2047n); const magnitude = (raw & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n); return { n: raw >> 63n ? -magnitude : magnitude, e: exponent ? exponent - 1075 : -1074 };
}
function multiply(a: Exact, b: Exact): Exact { return { n: a.n * b.n, e: a.e + b.e }; }
function negative(value: Exact): Exact { return { n: -value.n, e: value.e }; }
function add(a: Exact, b: Exact): Exact { const e = Math.min(a.e, b.e); return { n: (a.n << BigInt(a.e - e)) + (b.n << BigInt(b.e - e)), e }; }
function magnitudeGreater(a: Exact, b: Exact): boolean { const e = Math.min(a.e, b.e); const an = a.n < 0n ? -a.n : a.n; const bn = b.n < 0n ? -b.n : b.n; return (an << BigInt(a.e - e)) > (bn << BigInt(b.e - e)); }
function numeric(value: Exact, key: string, cap = MAX_SI): number {
  if (value.n === 0n) return 0; const magnitude = value.n < 0n ? -value.n : value.n; const shift = Math.max(0, magnitude.toString(2).length - 53, -1074 - value.e); let mantissa = magnitude >> BigInt(shift);
  if (shift > 0) { const remainder = magnitude - (mantissa << BigInt(shift)); const half = 1n << BigInt(shift - 1); if (remainder > half || remainder === half && mantissa % 2n === 1n) mantissa += 1n; }
  const result = finite(Number(mantissa) * 2 ** (value.e + shift) * (value.n < 0n ? -1 : 1), key, cap); if (result === 0) invalid("precision", "a nonzero exact rotational component cannot underflow to zero");
  if (magnitudeGreater(add(exact(result), negative(value)), multiply(value, exact(RELATIVE_ERROR)))) invalid("precision", "rotational source products cannot retain sufficient relative physical precision"); return result;
}
function motionReference(value: unknown, context: RotationEvaluationContext): RotationMotionDefinition {
  if (typeof value !== "string" || !value.trim()) invalid("motion", "rotational state requires one verified physical motion reference"); const geometry = context.geometry(value);
  if (!isRecord(geometry) || geometry.kind !== "point" || !isRecord(geometry.rotationalMotion)) invalid("motion", "motion reference must retain source radius/rates and its verified anchor"); fields(geometry, ["kind", "point", "rotationalMotion"], "motion");
  const source = geometry.rotationalMotion; const model = readMotion(Object.fromEntries(INPUT_KEYS.rotational_motion!.map((key) => [key, source[key]])), context);
  const equal = (a: unknown, b: unknown): boolean => isRecord(b) ? isRecord(a) && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([key, value]) => equal(a[key], value)) : a === b;
  if (!equal(source, model) || !equal(geometry.point, model.displayAnchor)) invalid("motion", "rotational physical metadata or display anchor contradicts its explicit source model"); return model;
}
function vectorDefinition(model: RotationMotionDefinition, motionId: string, quantity: RotationVectorDefinition["quantity"], displayLength: number): RotationVectorDefinition {
  const x = exact(model.radialSI.x); const y = exact(model.radialSI.y); const omega = exact(model.angularVelocitySI); const alpha = exact(model.angularAccelerationSI); const omegaSquared = multiply(omega, omega);
  const v = { x: negative(multiply(omega, y)), y: multiply(omega, x) }; const at = { x: negative(multiply(alpha, y)), y: multiply(alpha, x) }; const ac = { x: negative(multiply(omegaSquared, x)), y: negative(multiply(omegaSquared, y)) };
  const selected = quantity === "velocity" ? v : quantity === "tangential_acceleration" ? at : quantity === "centripetal_acceleration" ? ac : { x: add(at.x, ac.x), y: add(at.y, ac.y) };
  const componentsSI = { x: numeric(selected.x, "componentsSI"), y: numeric(selected.y, "componentsSI") }; const scale = Math.max(Math.abs(componentsSI.x), Math.abs(componentsSI.y)); const magnitudeSI = scale === 0 ? 0 : product(scale, Math.hypot(componentsSI.x / scale, componentsSI.y / scale), "magnitudeSI");
  const zero = quantity === "tangential_acceleration" ? model.angularAccelerationSI === 0 : quantity === "acceleration" ? model.angularVelocitySI === 0 && model.angularAccelerationSI === 0 : model.angularVelocitySI === 0;
  if ((magnitudeSI === 0) !== zero) invalid("precision", "rotational zero must be independently certified from explicit source rates");
  return { motionId, quantity, componentsSI, magnitudeSI, unit: quantity === "velocity" ? "m/s" : "m/s^2", zero, radialSI: { ...model.radialSI }, radiusSI: model.radiusSI, angularVelocitySI: model.angularVelocitySI, angularAccelerationSI: model.angularAccelerationSI, origin: { ...model.displayAnchor }, displayLength };
}
function vectorMark(definition: RotationVectorDefinition): RotationGeometry {
  if (definition.zero) return { kind: "point", point: { ...definition.origin }, rotationalVector: definition };
  const scale = Math.max(Math.abs(definition.componentsSI.x), Math.abs(definition.componentsSI.y)); const scaled = { x: definition.componentsSI.x / scale, y: definition.componentsSI.y / scale }; const norm = Math.hypot(scaled.x, scaled.y); const delta = { x: scaled.x / norm * definition.displayLength, y: scaled.y / norm * definition.displayLength };
  if (definition.componentsSI.x !== 0 && delta.x === 0 || definition.componentsSI.y !== 0 && delta.y === 0) invalid("precision", "nonzero rotational directions cannot underflow during display normalization");
  if (Math.abs(Math.hypot(delta.x, delta.y) / definition.displayLength - 1) > RELATIVE_ERROR) invalid("precision", "rotational normalization must retain the requested display length");
  return { kind: "path", points: [{ ...definition.origin }, placed(definition.origin, delta, "geometry")], directed: true, rotationalVector: definition };
}
function torqueDefinition(inputs: Record<string, unknown>, context: RotationEvaluationContext): PlanarTorqueDefinition {
  const length = unit(inputs.lengthUnit, "length"); unit(inputs.forceUnit, "force"); const leverArm = inlinePoint(inputs.leverArm, "leverArm", context); const force = inlinePoint(inputs.force, "force", context);
  const leverArmSI = { x: product(leverArm.x, length.factor, "leverArmSI"), y: product(leverArm.y, length.factor, "leverArmSI") };
  const cross = add(multiply(exact(leverArm.x), exact(force.y)), negative(multiply(exact(leverArm.y), exact(force.x)))); const torqueSI = numeric(multiply(cross, exact(length.factor)), "torqueSI");
  return { leverArm, force, lengthUnit: length.canonical, forceUnit: "N", leverArmSI, torqueSI, unit: "N*m", zero: cross.n === 0n, pageNormal: torqueSI === 0 ? null : torqueSI > 0 ? "out" : "in", origin: inlinePoint(inputs.origin, "origin", context, true), displayLength: displayLength(inputs.displayLength, context) };
}
function torqueMark(definition: PlanarTorqueDefinition): RotationGeometry {
  if (definition.zero) return { kind: "point", point: { ...definition.origin }, planarTorque: definition };
  const radius = definition.displayLength / 2;
  const move = (x: number, y: number): RenderPoint => {
    const result = { x: finite(definition.origin.x + x, "geometry"), y: finite(definition.origin.y + y, "geometry") };
    if (Math.hypot(result.x - definition.origin.x - x, result.y - definition.origin.y - y) > radius * 1e-8) invalid("precision", "torque glyph placement cannot retain its page-normal sign"); return result;
  };
  const ring = (r: number, samples: number): RenderPoint[] => Array.from({ length: samples + 1 }, (_, index) => index === samples ? move(r, 0) : move(r * Math.cos(2 * Math.PI * index / samples), r * Math.sin(2 * Math.PI * index / samples)));
  const paths = [ring(radius, 64), ...(definition.pageNormal === "out" ? [ring(radius / 20, 16)] : [[move(-radius / 2, -radius / 2), move(radius / 2, radius / 2)], [move(-radius / 2, radius / 2), move(radius / 2, -radius / 2)]])];
  return { kind: "multi_path", paths, planarTorque: definition };
}
export function evaluateRotationConstruction(operator: string, inputs: Record<string, unknown>, context: RotationEvaluationContext): RotationGeometry[] {
  const keys = INPUT_KEYS[operator]; if (!keys) invalid("operator", "unsupported rotational operator"); fields(inputs, keys); checkUnits(operator, inputs);
  if (operator === "rotational_motion") { const rotationalMotion = readMotion(inputs, context); return [{ kind: "point", point: rotationalMotion.displayAnchor, rotationalMotion }]; }
  if (operator === "rotational_state") { const model = motionReference(inputs.motion, context); const length = displayLength(inputs.displayLength, context); if (!["velocity", "acceleration", "components"].includes(String(inputs.kind))) invalid("kind", "rotational state requires velocity, acceleration, or components"); const quantities: RotationVectorDefinition["quantity"][] = inputs.kind === "components" ? ["tangential_acceleration", "centripetal_acceleration"] : [inputs.kind as "velocity" | "acceleration"]; return quantities.map((quantity) => vectorMark(vectorDefinition(model, String(inputs.motion), quantity, length))); }
  return [torqueMark(torqueDefinition(inputs, context))];
}
type Claim = { symbol: string; kind: string; expected: number; defaultUnit: string };
function labelAuthority(geometry: unknown): { defaultLabel: string; claims: Claim[] } | null {
  if (!isRecord(geometry)) return null; const claim = (symbol: string, kind: string, expected: number, defaultUnit: string): Claim => ({ symbol, kind, expected: finite(expected, "label", MAX_SI), defaultUnit });
  if (isRecord(geometry.rotationalMotion)) { const motion = geometry.rotationalMotion as unknown as RotationMotionDefinition; return { defaultLabel: "r", claims: [claim("r", "length", motion.radiusSI, motion.units.length), claim("r_x", "length", motion.radialSI.x, motion.units.length), claim("r_y", "length", motion.radialSI.y, motion.units.length), claim("omega", "angular_velocity", motion.angularVelocitySI, motion.angularVelocityUnit), claim("alpha", "angular_acceleration", motion.angularAccelerationSI, motion.angularAccelerationUnit), claim("theta", "phase", motion.angle, "rad")] }; }
  if (isRecord(geometry.rotationalVector)) { const vector = geometry.rotationalVector as unknown as RotationVectorDefinition; const symbol = vector.quantity === "velocity" ? "v" : vector.quantity === "tangential_acceleration" ? "a_t" : vector.quantity === "centripetal_acceleration" ? "a_c" : "a"; const kind = vector.quantity === "velocity" ? "velocity" : "acceleration"; return { defaultLabel: symbol, claims: [claim(symbol, kind, vector.magnitudeSI, vector.unit), claim(`${symbol}x`, kind, vector.componentsSI.x, vector.unit), claim(`${symbol}y`, kind, vector.componentsSI.y, vector.unit)] }; }
  if (isRecord(geometry.planarTorque)) { const torque = geometry.planarTorque as unknown as PlanarTorqueDefinition; return { defaultLabel: "tau", claims: [claim("tau", "torque", torque.torqueSI, "N*m")] }; } return null;
}
function claimUnit(value: string, kind: string): Unit {
  if (["length", "phase"].includes(kind)) return unit(value, kind);
  if (kind === "torque") { const match = /^N\*([^*]+)$/.exec(normalizedUnit(value)); if (!match) invalid("label", "torque claims require a force-times-length unit"); const length = unit(match[1], "length"); return { canonical: `N*${length.canonical}`, factor: length.factor }; }
  const match = /^([^/]+)\/([^/^]+)(\^2)?$/.exec(normalizedUnit(value)); const squared = kind === "acceleration" || kind === "angular_acceleration"; if (!match || squared !== (match[3] !== undefined)) invalid("label", "rotation derivative claims require the matching time power");
  const angular = kind === "angular_velocity" || kind === "angular_acceleration"; const numerator = angular ? unit(match[1], "phase") : unit(match[1], "length"); const time = unit(match[2], "time"); return { canonical: `${numerator.canonical}/${time.canonical}${squared ? "^2" : ""}`, factor: numerator.factor / time.factor ** (squared ? 2 : 1) };
}
function equalPhysical(actual: number, expected: number): boolean { return Number.isFinite(actual) && Math.abs(actual - expected) <= RELATIVE_ERROR * Math.abs(expected); }
function compactClaim(claim: Claim, declared: string): string { const selected = claimUnit(declared, claim.kind); return `${claim.symbol}=${Number(product(claim.expected, 1 / selected.factor, "label", Number.MAX_VALUE).toPrecision(4))} ${selected.canonical}`; }
function checkedText(text: unknown, geometry: unknown): { claim: Claim; declared: string } | null {
  const authority = labelAuthority(geometry); if (!authority) invalid("label", "rotational output is missing physical source authority"); if (text === undefined) return null; if (typeof text !== "string") invalid("label", "rotation labels must be mathematical symbols or verified physical values");
  if (text === authority.defaultLabel || authority.claims.some((claim) => text === claim.symbol)) return null;
  const match = /^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([^\s]+)\s*$/.exec(text.replaceAll("−", "-")); const claim = match && authority.claims.find((entry) => entry.symbol === match[1]);
  if (match && claim) { preserveLiteral(match[2], "label"); const declared = match[3]!; const selected = claimUnit(declared, claim.kind); if (equalPhysical(product(Number(match[2]), selected.factor, "label"), claim.expected) || text.trim() === compactClaim(claim, declared)) return { claim, declared }; } return invalid("label", "rotation labels must agree with source-derived physical values and units; display lengths are not physical magnitudes");
}
export function rotationGeometryLabel(geometry: unknown, requestedText?: unknown): string | null { const authority = labelAuthority(geometry); if (!authority) return null; const requested = checkedText(requestedText, geometry); const text = requested ? compactClaim(requested.claim, requested.declared) : typeof requestedText === "string" ? requestedText : authority.defaultLabel; return text.length <= 16 ? text : requested?.claim.symbol ?? authority.defaultLabel; }
function annotationAuthority(geometry: unknown, declared: string, text: unknown): { claim: Claim; factor: number } {
  const authority = labelAuthority(geometry); if (!authority) invalid("label", "rotation annotations require computed physical authority"); const requested = checkedText(text, geometry); const explicit = requested?.claim ?? authority.claims.find((claim) => claim.symbol === text);
  const candidates = authority.claims.filter((claim) => !explicit || explicit.symbol === claim.symbol).flatMap((claim) => { try { return [{ claim, factor: claimUnit(declared, claim.kind).factor }]; } catch { return []; } });
  if (candidates.length !== 1) invalid("label", "rotation annotations require an unambiguous physical quantity and matching unit"); return candidates[0]!;
}
export function validateEvaluatedRotationLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  if (!(ROTATION_OPERATORS as readonly string[]).includes(construction.operator)) return;
  for (const [outputIndex, id] of (Array.isArray(construction.outputs) ? construction.outputs : []).entries()) {
    const geometry = outputs[outputIndex];
    try {
      if (!labelAuthority(geometry)) invalid("label", "rotational result must retain physical source authority"); checkedText(document.entities.find((entity) => entity.id === id)?.label, geometry);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(id)) continue; if (["label", "callout", "badge"].includes(annotation.kind)) checkedText(annotation.text, geometry);
        if (annotation.quantityId !== undefined) { const declared = sourceUnits(annotation.quantityId, document); if (!declared.length) invalid("label", "rotation quantity annotations require physical units"); const authorities = declared.map((value) => annotationAuthority(geometry, value, annotation.text)); const first = authorities[0]!;
          if (authorities.some((entry) => entry.claim.symbol !== first.claim.symbol || entry.factor !== first.factor)) invalid("label", "rotation annotation contains conflicting nested units"); if (!equalPhysical(product(validationNumber(annotation.quantityId, document), first.factor, "label"), first.claim.expected)) invalid("label", "rotation quantity annotation contradicts computed physical authority"); }
      }
      for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) checkedText(label.inputs.text, geometry);
    } catch (error) { issues.push({ code: `invalid_${construction.operator}_label`, message: error instanceof Error ? error.message : "invalid rotation label", severity: "fatal", path: `constructions[${index}].outputs`, entityIds: [id] }); }
  }
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("quantity", "rotation numeric references must be acyclic and bounded"); if (typeof value === "number" && Number.isFinite(value)) return value; seen.add(value);
  if (isRecord(value)) { fields(value, ["value", "unit"], "quantity"); return validationNumber(value.value, document, seen, depth + 1); } if (typeof value === "string" && value.trim()) { const quantity = document.quantities.find((entry) => entry.id === value); if (quantity) return validationNumber(quantity.value, document, seen, depth + 1); preserveLiteral(value, "quantity"); const numeric = Number(value); if (Number.isFinite(numeric)) return numeric; } return invalid("quantity", "rotation numeric sources must resolve to finite values");
}
export function validateRotationConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const { operator, inputs } = construction; if (!(ROTATION_OPERATORS as readonly string[]).includes(operator)) return; const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const add = (key: string, message: string): void => { issues.push({ code: `invalid_${operator}_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`, entityIds: outputs }); };
  if (!isRecord(inputs)) { add("inputs", "rotation construction inputs must be an object"); return; } const count = operator === "rotational_state" && inputs.kind === "components" ? 2 : 1;
  if (outputs.length !== count || outputs.some((output) => typeof output !== "string" || !output.trim()) || new Set(outputs).size !== outputs.length) add("outputs", `${operator} requires exactly ${count} distinct ordered outputs`);
  const context: RotationEvaluationContext = { number: (value) => validationNumber(value, document), point: () => invalid("point", "rotation cannot reinterpret external geometry coordinates"), geometry(value) {
    const producer = typeof value === "string" ? constructionByOutput.get(value) : undefined; if (!producer || producer.operator !== "rotational_motion" || producer.outputs.length !== 1 || producer.outputs[0] !== value || document.entities.find((entity) => entity.id === value)?.kind !== "point") invalid("motion", "rotational_state requires one verified source circular-position output"); checkUnits(producer.operator, producer.inputs, document); return evaluateRotationConstruction(producer.operator, producer.inputs, context)[0];
  } };
  try {
    checkUnits(operator, inputs, document); const evaluated = evaluateRotationConstruction(operator, inputs, context);
    evaluated.forEach((geometry, outputIndex) => { const expected = geometry.kind === "point" ? "point" : geometry.kind === "path" ? "vector" : "polyline"; if (document.entities.find((entity) => entity.id === outputs[outputIndex])?.kind !== expected) add("output_kind", `${operator} output ${outputIndex} must be a ${expected} for its independently computed physical result`); });
    validateEvaluatedRotationLabels(construction, index, document, evaluated, issues);
  } catch (error) { add(error instanceof RotationInputError ? error.key : "inputs", error instanceof Error ? error.message : "invalid rotation construction"); }
}
