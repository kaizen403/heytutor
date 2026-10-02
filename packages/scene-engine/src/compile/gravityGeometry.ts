import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const GRAVITY_OPERATORS = ["gravitational_field", "gravitational_force"] as const;
export interface GravitySource { position: RenderPoint; mass: number }
export interface GravityFieldDefinition {
  massUnit: "kg" | "g" | "mg"; lengthUnit: "m" | "cm" | "mm" | "km";
  sources: GravitySource[]; at: RenderPoint; G: number; components: RenderPoint;
  magnitude: number; potential: number; unit: "m/s^2"; direction: RenderPoint | null; zero: boolean;
  origin: RenderPoint; displayLength: number;
}
export interface GravityForceDefinition {
  field: GravityFieldDefinition; testMass: number; components: RenderPoint; magnitude: number;
  unit: "N"; direction: RenderPoint | null; zero: boolean; origin: RenderPoint; displayLength: number;
}
type GravityMetadata = { gravityField: GravityFieldDefinition } | { gravityForce: GravityForceDefinition };
export type GravityGeometry = GravityMetadata & (
  | { kind: "point"; point: RenderPoint }
  | { kind: "path"; points: RenderPoint[]; directed: true }
);
export interface GravityEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
const MAX_SOURCE = 1e36; const MAX_COORDINATE = 1e15; const MAX_SOURCES = 32; const ERROR = 128 * Number.EPSILON;
const MASS_UNITS = { kg: 1, g: 1e-3, mg: 1e-6 } as const;
const LENGTH_UNITS = { m: 1, cm: 1e-2, mm: 1e-3, km: 1e3 } as const;
const G_UNITS = ["m^3/(kg*s^2)", "m^3/kg/s^2", "N*m^2/kg^2", "N m^2/kg^2", "m³/(kg·s²)"];
const DIMENSIONLESS_UNITS = ["1", "dimensionless", "unit", "units"];
class GravityInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new GravityInputError(key, message); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void { if (Object.keys(value).some((key) => !allowed.includes(key))) invalid(key, `unsupported gravitational ${key} fields`); }
function finite(value: number, key: string, cap = MAX_SOURCE): number { if (!Number.isFinite(value) || Math.abs(value) > cap) invalid(key, `${key} must be finite within ${cap}`); return value === 0 ? 0 : value; }
function preserveLiteral(value: unknown, key: string): void { const match = typeof value === "string" && /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE][+-]?\d+)?$/.exec(value.trim()); if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) invalid(key, "a nonzero gravitational source literal cannot become certified zero"); }
function scalar(value: unknown, key: string, context: GravityEvaluationContext, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid(key, "gravitational scalar wrappers must be acyclic with depth at most 32");
  if (record(value)) { keys(value, ["value", "unit"], key); seen.add(value); return scalar(value.value, key, context, seen, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, `${key} requires an explicit numerical scalar`);
  preserveLiteral(value, key);
  try { return finite(context.number(value), key); } catch (error) { if (error instanceof GravityInputError) throw error; return invalid(key, `${key} requires a finite source value`); }
}
function sourceUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) invalid("units", "gravitational quantity units must be acyclic within depth 32");
  if (record(value)) keys(value, ["value", "unit"], "quantity");
  const entry = typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : record(value) ? value : undefined;
  if (!entry) return [];
  seen.add(value);
  if (entry.unit !== undefined && (typeof entry.unit !== "string" || !entry.unit.trim())) invalid("units", "known gravitational units must be nonempty strings");
  return [...(typeof entry.unit === "string" ? [entry.unit.trim()] : []), ...("value" in entry ? sourceUnits(entry.value, document, seen, depth + 1) : [])];
}
function unit<K extends string>(value: unknown, supported: Readonly<Record<K, number>>, key: string): K {
  if (typeof value !== "string" || !Object.hasOwn(supported, value.trim())) invalid(key, `${key} must declare a supported physical unit`);
  return value.trim() as K;
}
function length(value: unknown, context: GravityEvaluationContext): number { const result = scalar(value, "displayLength", context); if (!(result > 1e-6) || result > MAX_COORDINATE) invalid("displayLength", "normalized displayLength must exceed 1e-6 and fit the finite display bound"); return result; }
function finitePoint(value: unknown, key: string): RenderPoint {
  if (!record(value) || Object.keys(value).some((name) => name !== "x" && name !== "y") || typeof value.x !== "number" || typeof value.y !== "number") invalid(key, "gravity requires finite planar coordinates");
  return { x: finite(value.x, key, MAX_COORDINATE), y: finite(value.y, key, MAX_COORDINATE) };
}
function position(value: unknown, key: string, context: GravityEvaluationContext): RenderPoint {
  if (Array.isArray(value)) { if (value.length !== 2) invalid(key, "gravity requires exactly two physical coordinates"); return finitePoint({ x: scalar(value[0], key, context), y: scalar(value[1], key, context) }, key); }
  if (record(value)) { keys(value, ["x", "y"], key); return finitePoint({ x: scalar(value.x, key, context), y: scalar(value.y, key, context) }, key); }
  if (typeof value !== "string" || !value.trim()) invalid(key, "gravity position must be an inline or constructed 2D point");
  const geometry = context.geometry(value);
  if (!record(geometry) || geometry.kind !== "point" || Object.keys(geometry).some((name) => !["kind", "point", "calculusAnchor", "opticalImage", "opticalFocus"].includes(name))) invalid(key, "gravity cannot reinterpret world or normalized physical point metadata");
  return finitePoint(context.point(value), key);
}
type Exact = { n: bigint; e: number };
const bits = new DataView(new ArrayBuffer(8));
function exact(value: number): Exact {
  if (value === 0) return { n: 0n, e: 0 };
  bits.setFloat64(0, value); const raw = bits.getBigUint64(0); const exponent = Number((raw >> 52n) & 2047n);
  return { n: (raw >> 63n ? -1n : 1n) * ((raw & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n)), e: exponent ? exponent - 1075 : -1074 };
}
function add(a: Exact, b: Exact): Exact { const e = Math.min(a.e, b.e); return { n: (a.n << BigInt(a.e - e)) + (b.n << BigInt(b.e - e)), e }; }
function multiply(a: Exact, b: Exact): Exact { return { n: a.n * b.n, e: a.e + b.e }; }
function difference(a: number, b: number): Exact { const right = exact(b); return add(exact(a), { n: -right.n, e: right.e }); }
function exactKey(value: Exact): string { let { n, e } = value; if (n === 0n) return "0"; while (n % 2n === 0n) { n /= 2n; e++; } return `${n}:${e}`; }
/** Exact binary ratio rounding avoids intermediate products/reciprocals losing authority. */
function ratio(a: Exact, b: Exact, key: string): number {
  if (b.n === 0n) invalid(key, "gravitational ratios require nonzero denominators");
  if (a.n === 0n) return 0;
  const sign = (a.n < 0n) !== (b.n < 0n) ? -1 : 1; const n = a.n < 0n ? -a.n : a.n; const d = b.n < 0n ? -b.n : b.n;
  let h = n.toString(2).length - d.toString(2).length;
  if (h >= 0 ? n < (d << BigInt(h)) : (n << BigInt(-h)) < d) h--;
  const quantum = Math.max(h + a.e - b.e - 52, -1074); const shift = a.e - b.e - quantum;
  const numerator = shift >= 0 ? n << BigInt(shift) : n; const denominator = shift < 0 ? d << BigInt(-shift) : d;
  let quotient = numerator / denominator; const remainder = numerator % denominator;
  if (2n * remainder > denominator || 2n * remainder === denominator && quotient % 2n === 1n) quotient++;
  const result = finite(sign * Number(quotient) * 2 ** quantum, key);
  const error = numerator - quotient * denominator; const absoluteError = error < 0n ? -error : error;
  if (result === 0 || (absoluteError << 45n) > numerator) invalid("precision", "a nonzero gravitational value underflows or loses relative numeric accuracy");
  return result;
}
function scaled(value: number, factor: number, key: string): number { return ratio(multiply(exact(value), exact(factor)), exact(1), key); }
function certifiedZeros(at: RenderPoint, sources: readonly GravitySource[]): { x: boolean; y: boolean } {
  const radii = new Map<string, { x: Exact; y: Exact }>();
  for (const source of sources) {
    const dx = difference(at.x, source.position.x); const dy = difference(at.y, source.position.y);
    const key = exactKey(add(multiply(dx, dx), multiply(dy, dy))); const sum = radii.get(key) ?? { x: exact(0), y: exact(0) };
    radii.set(key, { x: add(sum.x, multiply(exact(source.mass), dx)), y: add(sum.y, multiply(exact(source.mass), dy)) });
  }
  return { x: [...radii.values()].every((value) => value.x.n === 0n), y: [...radii.values()].every((value) => value.y.n === 0n) };
}
function sum(values: readonly number[], certifiedZero: boolean, key: string): number {
  if (certifiedZero) return 0;
  let total = 0; let correction = 0; let absolute = 0;
  for (const value of [...values].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)) { const next = total + value; correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total; total = next; absolute += Math.abs(value); }
  const result = finite(total + correction, key);
  if (!Number.isFinite(absolute) || Math.abs(result) <= ERROR * absolute + MAX_SOURCES * Number.MIN_VALUE) invalid("precision", `${key} is unresolved within bounded floating error; zero is not certified`);
  return result;
}
function vectorProperties(components: RenderPoint): { magnitude: number; direction: RenderPoint | null; zero: boolean } {
  const scale = Math.max(Math.abs(components.x), Math.abs(components.y));
  if (scale === 0) return { magnitude: 0, direction: null, zero: true };
  const normalized = Math.hypot(components.x / scale, components.y / scale); const magnitude = finite(scale * normalized, "magnitude");
  if (magnitude === 0 || Math.abs(magnitude / scale - normalized) > ERROR * normalized) invalid("precision", "gravity vector norm loses numeric authority");
  const direction = { x: components.x / magnitude, y: components.y / magnitude };
  if (components.x !== 0 && direction.x === 0 || components.y !== 0 && direction.y === 0) invalid("precision", "gravity direction underflows");
  return { magnitude, direction, zero: false };
}
function checkUnits(inputs: Record<string, unknown>, document?: SceneDocument, byOutput?: Map<string, SceneConstruction>): void {
  const compare = (value: unknown, expected: readonly string[]): void => { for (const actual of sourceUnits(value, document)) if (!expected.includes(actual)) invalid("units", `gravitational source unit ${actual} conflicts with its explicit unit declaration`); };
  compare(inputs.displayLength, DIMENSIONLESS_UNITS);
  if (inputs.sources === undefined) { compare(inputs.testMass, [unit(inputs.massUnit, MASS_UNITS, "massUnit")]); return; }
  if (!record(inputs.units)) invalid("units", "gravitational_field requires mass, length, and G unit declarations");
  keys(inputs.units, ["mass", "length", "G"], "units"); const mass = unit(inputs.units.mass, MASS_UNITS, "massUnit"); const coordinate = unit(inputs.units.length, LENGTH_UNITS, "lengthUnit");
  if (typeof inputs.units.G !== "string" || !G_UNITS.includes(inputs.units.G.trim())) invalid("units", "G must explicitly declare SI m^3/(kg*s^2)");
  compare(inputs.G, G_UNITS);
  const coordinates = (value: unknown, seen = new Set<string>(), depth = 0): void => {
    if (depth > 32) invalid("units", "physical position dependencies exceed depth 32");
    if (Array.isArray(value)) { value.forEach((item) => compare(item, [coordinate])); return; }
    if (record(value)) { compare(value.x, [coordinate]); compare(value.y, [coordinate]); return; }
    if (typeof value !== "string" || !byOutput?.has(value)) return;
    if (seen.has(value)) invalid("units", "physical position dependencies must be acyclic");
    const producer = byOutput.get(value)!; const next = new Set([...seen, value]);
    if (producer.operator === "point") { compare(producer.inputs.x, [coordinate]); compare(producer.inputs.y, [coordinate]); return; }
    if (producer.operator === "triangle_center") { for (const name of ["a", "b", "c"]) coordinates(producer.inputs[name], next, depth + 1); return; }
    if (producer.operator === "conic") { coordinates(producer.inputs.origin, next, depth + 1); for (const name of producer.inputs.kind === "parabola" ? ["p"] : ["a", "b"]) compare(producer.inputs[name], [coordinate]); return; }
    if (producer.operator === "conic_anchor") { coordinates(producer.inputs.conic, next, depth + 1); return; }
    // Only known length-bearing dependency scalars are inherited: enum, time, and angle units do not become coordinates.
    const walk = (entry: unknown): void => {
      if (record(entry) && !("value" in entry)) { Object.values(entry).forEach(walk); return; }
      const units = sourceUnits(entry, document);
      if (units.some((known) => Object.hasOwn(LENGTH_UNITS, known))) { compare(entry, [coordinate]); return; }
      if (typeof entry === "string" && byOutput.has(entry)) coordinates(entry, next, depth + 1);
      else if (Array.isArray(entry)) entry.forEach(walk);
      else if (record(entry) && !("value" in entry)) Object.values(entry).forEach(walk);
    };
    Object.values(producer.inputs).forEach(walk);
  };
  coordinates(inputs.at);
  if (Array.isArray(inputs.sources)) for (const source of inputs.sources) if (record(source)) { compare(source.mass, [mass]); coordinates(source.position); }
}
function fieldParameters(inputs: Record<string, unknown>, context: GravityEvaluationContext): { sources: Array<{ position: unknown; mass: number }>; G: number; massUnit: GravityFieldDefinition["massUnit"]; lengthUnit: GravityFieldDefinition["lengthUnit"]; displayLength: number } {
  keys(inputs, ["sources", "at", "G", "units", "displayLength", "origin"]); checkUnits(inputs);
  const units = inputs.units as Record<string, unknown>; const massUnit = unit(units.mass, MASS_UNITS, "massUnit"); const lengthUnit = unit(units.length, LENGTH_UNITS, "lengthUnit");
  const G = scalar(inputs.G, "G", context); if (!(G > 0)) invalid("G", "G must be an explicit positive finite physical coefficient");
  if (!Array.isArray(inputs.sources) || inputs.sources.length < 1 || inputs.sources.length > MAX_SOURCES) invalid("sources", "gravity requires 1..32 explicit source point masses");
  const sources = inputs.sources.map((source, index) => { if (!record(source)) invalid("sources", "each source requires position and mass"); keys(source, ["position", "mass"], "sources"); const mass = scalar(source.mass, `sources[${index}].mass`, context); if (mass < 0) invalid("mass", "gravitational source masses must be nonnegative"); return { position: source.position, mass }; });
  return { sources, G, massUnit, lengthUnit, displayLength: length(inputs.displayLength, context) };
}
function computedField(inputs: Record<string, unknown>, context: GravityEvaluationContext): GravityFieldDefinition {
  const parameters = fieldParameters(inputs, context); const at = position(inputs.at, "at", context);
  const sources = parameters.sources.map((source, index) => ({ position: position(source.position, `sources[${index}].position`, context), mass: source.mass }));
  const contributions = sources.map((source) => {
    const dx = ratio(difference(at.x, source.position.x), exact(1), "distance.x"); const dy = ratio(difference(at.y, source.position.y), exact(1), "distance.y");
    const rawRadius = vectorProperties({ x: dx, y: dy }).magnitude; if (!(rawRadius > 0)) invalid("position", "observation must be finitely separated from every source mass");
    const radius = scaled(rawRadius, LENGTH_UNITS[parameters.lengthUnit], "radius"); const mass = scaled(source.mass, MASS_UNITS[parameters.massUnit], "mass");
    if (dx !== 0 && dx / rawRadius === 0 || dy !== 0 && dy / rawRadius === 0) invalid("precision", "a nonzero source direction underflows in the physical field computation");
    const gm = multiply(exact(parameters.G), exact(mass)); const radial = -ratio(gm, multiply(exact(radius), exact(radius)), "field");
    return { x: scaled(radial, dx / rawRadius, "field.x"), y: scaled(radial, dy / rawRadius, "field.y"), potential: -ratio(gm, exact(radius), "potential") };
  });
  const certified = certifiedZeros(at, sources); const components = { x: sum(contributions.map((value) => value.x), certified.x, "field.x"), y: sum(contributions.map((value) => value.y), certified.y, "field.y") };
  const potential = sum(contributions.map((value) => value.potential), sources.every((source) => source.mass === 0), "potential");
  return { sources, at, G: parameters.G, massUnit: parameters.massUnit, lengthUnit: parameters.lengthUnit, components, potential, unit: "m/s^2", ...vectorProperties(components), origin: inputs.origin === undefined ? { ...at } : position(inputs.origin, "origin", context), displayLength: parameters.displayLength };
}
function mark(definition: GravityFieldDefinition | GravityForceDefinition): GravityGeometry {
  const metadata = "G" in definition ? { gravityField: definition } : { gravityForce: definition };
  if (definition.zero) return { kind: "point", point: { ...definition.origin }, ...metadata };
  const delta = { x: definition.direction!.x * definition.displayLength, y: definition.direction!.y * definition.displayLength };
  const tip = finitePoint({ x: definition.origin.x + delta.x, y: definition.origin.y + delta.y }, "displayLength");
  for (const axis of ["x", "y"] as const) if (definition.components[axis] !== 0 && (delta[axis] === 0 || tip[axis] === definition.origin[axis] || Math.abs((tip[axis] - definition.origin[axis]) - delta[axis]) > Math.abs(delta[axis]) * 1e-8)) invalid("precision", "display placement cannot retain the gravitational direction");
  return { kind: "path", points: [{ ...definition.origin }, tip], directed: true, ...metadata };
}
const numericalContext: GravityEvaluationContext = { number: Number, point: () => invalid("point", "metadata cannot contain unresolved point IDs"), geometry: () => undefined };
function same(a: unknown, b: unknown): boolean { if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((entry, index) => same(a[index], entry)); if (record(b)) return record(a) && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([key, entry]) => same(a[key], entry)); return a === b; }
function verifiedField(value: unknown): GravityFieldDefinition {
  if (!record(value) || !record(value.gravityField)) invalid("field", "gravitational_force must consume source-derived gravitational_field geometry");
  const raw = value.gravityField;
  const computed = computedField({ sources: raw.sources, at: raw.at, G: raw.G, units: { mass: raw.massUnit, length: raw.lengthUnit, G: G_UNITS[0] }, displayLength: raw.displayLength, origin: raw.origin }, numericalContext);
  if (!same(value, mark(computed))) invalid("field", "gravity source geometry or metadata contradicts its physical authority");
  return computed;
}
function computedForce(inputs: Record<string, unknown>, context: GravityEvaluationContext): GravityForceDefinition {
  keys(inputs, ["field", "testMass", "massUnit", "displayLength", "origin"]); checkUnits(inputs);
  if (typeof inputs.field !== "string" || !inputs.field.trim()) invalid("field", "gravitational_force requires an explicit field entity ID");
  const massUnit = unit(inputs.massUnit, MASS_UNITS, "massUnit"); const rawMass = scalar(inputs.testMass, "testMass", context); if (rawMass < 0) invalid("testMass", "test mass must be nonnegative");
  const testMass = scaled(rawMass, MASS_UNITS[massUnit], "testMass"); const displayLength = inputs.displayLength === undefined ? undefined : length(inputs.displayLength, context);
  const field = verifiedField(context.geometry(inputs.field)); const components = { x: scaled(field.components.x, testMass, "force.x"), y: scaled(field.components.y, testMass, "force.y") };
  return { field, testMass, components, unit: "N", ...vectorProperties(components), origin: inputs.origin === undefined ? { ...field.origin } : position(inputs.origin, "origin", context), displayLength: displayLength ?? field.displayLength };
}
function verifiedResult(operator: string, outputs: readonly unknown[]): GravityFieldDefinition | GravityForceDefinition {
  if (outputs.length !== 1) invalid("outputs", "gravity constructions require their single complete evaluated output");
  if (operator === "gravitational_field") return verifiedField(outputs[0]);
  const output = outputs[0]; if (operator !== "gravitational_force" || !record(output) || !record(output.gravityForce)) invalid("outputs", "gravity result labels require correctly typed evaluated geometry");
  const raw = output.gravityForce; const field = verifiedField(mark(raw.field as GravityFieldDefinition));
  if (typeof raw.testMass !== "number" || raw.testMass < 0) invalid("force", "gravity force metadata must retain a nonnegative SI test mass");
  const components = { x: scaled(field.components.x, finite(raw.testMass, "testMass"), "force.x"), y: scaled(field.components.y, raw.testMass, "force.y") };
  const computed: GravityForceDefinition = { field, testMass: raw.testMass, components, unit: "N", ...vectorProperties(components), origin: finitePoint(raw.origin, "origin"), displayLength: length(raw.displayLength, numericalContext) };
  if (!same(output, mark(computed))) invalid("force", "gravity force geometry or metadata contradicts F=m*g");
  return computed;
}
export function evaluateGravityConstruction(operator: string, inputs: Record<string, unknown>, context: GravityEvaluationContext): GravityGeometry[] {
  if (operator === "gravitational_field") return [mark(computedField(inputs, context))];
  if (operator === "gravitational_force") return [mark(computedForce(inputs, context))];
  return invalid("operator", `unsupported gravity operator ${operator}`);
}
function compact(value: number): string { return value === 0 ? "0" : Math.abs(value) >= 0.001 && Math.abs(value) < 10000 ? Number(value.toPrecision(3)).toString() : value.toExponential(1).replace("e+", "e"); }
function labels(definition: GravityFieldDefinition | GravityForceDefinition): { symbol: string; numeric: string } { const symbol = "G" in definition ? "g" : "F"; return { symbol, numeric: `${symbol}=${compact(definition.magnitude)} ${definition.unit}` }; }
function checkText(text: unknown, definition: GravityFieldDefinition | GravityForceDefinition): void { const allowed = labels(definition); if (text !== undefined && text !== allowed.symbol && text !== allowed.numeric) invalid("label", "gravity labels must use their symbol or the verified computed SI magnitude"); }
export function gravityConstructionOutputLabels(operator: string, outputs: readonly unknown[], requestedTexts?: readonly unknown[]): string[] {
  if (requestedTexts !== undefined && requestedTexts.length !== 1) invalid("outputs", "gravity requested labels must match their one evaluated output");
  const definition = verifiedResult(operator, outputs); checkText(requestedTexts?.[0], definition); const label = labels(definition);
  return [requestedTexts?.[0] === label.numeric ? label.numeric : label.symbol];
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("quantity", "gravitational source quantity references must be bounded and acyclic");
  if (record(value)) { keys(value, ["value", "unit"], "quantity"); seen.add(value); return validationNumber(value.value, document, seen, depth + 1); }
  if (typeof value === "string") { const quantity = document.quantities.find((entry) => entry.id === value); if (quantity) { seen.add(value); return validationNumber(quantity.value, document, seen, depth + 1); } }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid("quantity", "gravity requires explicit scalar source values");
  preserveLiteral(value, "quantity"); return finite(Number(value), "quantity");
}
function sourceQuantityId(value: unknown, document: SceneDocument, depth = 0): string | undefined {
  if (depth > 32) return undefined;
  if (record(value)) return sourceQuantityId(value.value, document, depth + 1);
  return typeof value === "string" && document.quantities.some((quantity) => quantity.id === value) ? value : undefined;
}
function checkSourceClaims(construction: SceneConstruction, document: SceneDocument): void {
  if (construction.operator !== "gravitational_field" || !Array.isArray(construction.inputs.sources) || !record(construction.inputs.units)) return;
  const massUnit = unit(construction.inputs.units.mass, MASS_UNITS, "massUnit");
  for (const source of construction.inputs.sources) {
    if (!record(source) || typeof source.position !== "string") continue;
    const mass = validationNumber(source.mass, document); const expectedId = sourceQuantityId(source.mass, document);
    const checkMassText = (text: unknown): void => {
      if (typeof text !== "string") return;
      const label = text.trim();
      if (label.startsWith("m=") || label.startsWith("M=")) if (label !== `${label[0]}=${compact(mass)} ${massUnit}`) invalid("label", "source-mass numerical label contradicts its supplied mass and explicit unit scale");
    };
    checkMassText(document.entities.find((entity) => entity.id === source.position)?.label);
    for (const annotation of document.annotations) {
      if (!annotation.targetIds.includes(source.position)) continue;
      checkMassText(annotation.text);
      if (annotation.quantityId === undefined) continue;
      const units = sourceUnits(annotation.quantityId, document);
      if (!units.some((actual) => Object.hasOwn(MASS_UNITS, actual))) continue;
      if (units.some((actual) => actual !== massUnit)) invalid("label", "source mass annotation conflicts with its explicitly declared source unit scale");
      if (expectedId !== undefined ? annotation.quantityId !== expectedId : validationNumber(annotation.quantityId, document) !== mass) invalid("label", "source mass annotation is bound to a different supplied mass quantity");
    }
    for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === source.position) checkMassText(label.inputs.text);
  }
}
export function validateEvaluatedGravityLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  try {
    checkSourceClaims(construction, document);
    const definition = verifiedResult(construction.operator, outputs); const id = construction.outputs[0]!;
    checkText(document.entities.find((entity) => entity.id === id)?.label, definition);
    for (const annotation of document.annotations) {
      if (!annotation.targetIds.includes(id) || !["label", "callout", "badge"].includes(annotation.kind)) continue;
      checkText(annotation.text, definition);
      if (annotation.quantityId !== undefined) {
        const units = sourceUnits(annotation.quantityId, document);
        if (!units.length || units.some((unit) => unit !== definition.unit)) invalid("label", "gravity result annotations must declare the computed SI unit");
        const actual = validationNumber(annotation.quantityId, document); if (Math.abs(actual - definition.magnitude) > ERROR * Math.abs(definition.magnitude)) invalid("label", "gravity annotation contradicts its source-derived SI magnitude");
      }
    }
    for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) checkText(label.inputs.text, definition);
  } catch (error) { issues.push({ code: `invalid_${construction.operator}_label`, severity: "fatal", message: error instanceof Error ? error.message : "gravity output labels are invalid", path: `constructions[${index}].outputs` }); }
}
class DeferredGravityPoint extends GravityInputError { constructor() { super("position", "derived planar coordinates are checked at runtime"); } }
export function validateGravityConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const addIssue = (key: string, message: string): void => { issues.push({ code: `invalid_${construction.operator}_${key}`, severity: "fatal", message, path: `constructions[${index}].${key === "outputs" ? key : `inputs.${key}`}` }); };
  if (construction.outputs.length !== 1 || document.entities.find((entity) => entity.id === construction.outputs[0])?.kind !== "vector") addIssue("outputs", "gravity constructions require one vector entity; zero results render as markers");
  if (!record(construction.inputs)) { addIssue("fields", "gravity construction inputs must be an object"); return; }
  const context: GravityEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      if (typeof value !== "string") return position(value, "position", context);
      const producer = constructionByOutput.get(value);
      if (!producer || document.entities.find((entity) => entity.id === value)?.kind !== "point") invalid("position", "gravity physical positions require constructed 2D points");
      if (producer.operator !== "point") throw new DeferredGravityPoint();
      return finitePoint({ x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) }, "position");
    },
    geometry(value) {
      if (typeof value !== "string") return undefined;
      const producer = constructionByOutput.get(value); if (!producer) return undefined;
      if (document.entities.find((entity) => entity.id === value)?.kind === "point") return { kind: "point", point: context.point(value) };
      if (producer.operator !== "gravitational_field" || document.entities.find((entity) => entity.id === value)?.kind !== "vector") invalid("field", "gravity force sources must reference gravitational_field resultants");
      checkUnits(producer.inputs, document, constructionByOutput); return evaluateGravityConstruction(producer.operator, producer.inputs, context)[0];
    },
  };
  try {
    checkUnits(construction.inputs, document, constructionByOutput);
    checkSourceClaims(construction, document);
    if (construction.operator === "gravitational_force") { scalar(construction.inputs.testMass, "testMass", context); if (construction.inputs.displayLength !== undefined) length(construction.inputs.displayLength, context); }
    validateEvaluatedGravityLabels(construction, index, document, evaluateGravityConstruction(construction.operator, construction.inputs, context), issues);
  } catch (error) { if (!(error instanceof DeferredGravityPoint)) addIssue(error instanceof GravityInputError ? error.key : "inputs", error instanceof Error ? error.message : "gravity inputs are invalid"); }
}
