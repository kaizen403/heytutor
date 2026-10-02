import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const MAGNETIC_OPERATORS = ["magnetic_force", "magnetic_components"] as const;
export interface MagneticVector { x: number; y: number; z: number }
export interface MagneticForceDefinition {
  charge: number; velocity: MagneticVector; magneticField: MagneticVector;
  components: MagneticVector; magnitude: number; unit: "N";
  origin: RenderPoint; displayLength: number; zero: boolean;
  pageNormal: "out" | "in" | null; component?: "x" | "y" | "z";
}
export type MagneticGeometry =
  | { kind: "point"; point: RenderPoint; magneticForce: MagneticForceDefinition }
  | { kind: "path"; points: RenderPoint[]; directed: true; magneticForce: MagneticForceDefinition }
  | { kind: "multi_path"; paths: RenderPoint[][]; magneticForce: MagneticForceDefinition };
export interface MagneticEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }

const MAX_SOURCE = 1e12;
const MAX_FORCE = 1e12;
const MAX_COORDINATE = 1e12;
const MIN_DISPLAY = 1e-6;
const AXES = ["x", "y", "z"] as const;
class MagneticInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new MagneticInputError(key, message); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void {
  if (Object.keys(value).some((name) => !allowed.includes(name))) invalid(key, `unsupported magnetic ${key} fields`);
}
function bounded(value: number, key: string, cap = MAX_SOURCE): number {
  if (!Number.isFinite(value) || Math.abs(value) > cap) invalid(key, `${key} must be finite with magnitude at most ${cap}`);
  return value === 0 ? 0 : value;
}
function preserveLiteral(value: unknown, key: string): void { const match = typeof value === "string" && /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE][+-]?\d+)?$/.exec(value.trim()); if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) invalid(key, "a nonzero magnetic source literal cannot become certified zero"); }
function scalar(value: unknown, key: string, context: MagneticEvaluationContext, depth = 0): number {
  if (depth > 32) invalid(key, "magnetic scalar nesting exceeds depth 32");
  if (record(value)) { keys(value, ["value", "unit"], key); return scalar(value.value, key, context, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, `${key} requires a finite scalar or quantity reference`);
  preserveLiteral(value, key);
  try { return bounded(context.number(value), key); }
  catch (error) { if (error instanceof MagneticInputError) throw error; return invalid(key, `${key} requires a finite scalar value`); }
}
function vector(value: unknown, key: string, context: MagneticEvaluationContext): MagneticVector {
  if (!Array.isArray(value) || value.length !== 3) invalid(key, `${key} requires three explicit Cartesian components`);
  return { x: scalar(value[0], `${key}.x`, context), y: scalar(value[1], `${key}.y`, context), z: scalar(value[2], `${key}.z`, context) };
}
function point(value: unknown, key: string): RenderPoint {
  if (!record(value) || typeof value.x !== "number" || typeof value.y !== "number") invalid(key, `${key} requires finite 2D coordinates`);
  return { x: bounded(value.x, key, MAX_COORDINATE), y: bounded(value.y, key, MAX_COORDINATE) };
}
function origin(value: unknown, context: MagneticEvaluationContext): RenderPoint {
  if (value === undefined) return { x: 0, y: 0 };
  if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], "origin.x", context), y: scalar(value[1], "origin.y", context) };
  if (record(value)) { keys(value, ["x", "y"], "origin"); return { x: scalar(value.x, "origin.x", context), y: scalar(value.y, "origin.y", context) }; }
  if (typeof value !== "string" || !value.trim()) invalid("origin", "magnetic origin must be an inline or constructed 2D placement point");
  const geometry = context.geometry(value);
  if (!record(geometry) || geometry.kind !== "point" || Object.keys(geometry).some((key) => !["kind", "point", "calculusAnchor", "opticalImage", "opticalFocus"].includes(key))) invalid("origin", "magnetic placement cannot reinterpret world or normalized physical metadata");
  return point(context.point(value), "origin");
}
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  C: "C", coulomb: "C", coulombs: "C", "m/s": "m/s", "meter/second": "m/s", "metre/second": "m/s",
  T: "T", tesla: "T", teslas: "T", N: "N", newton: "N", newtons: "N",
  "1": "1", unit: "1", units: "1", dimensionless: "1",
};
function canonicalUnit(value: unknown): string | undefined { return typeof value === "string" ? UNIT_ALIASES[value.trim()] : undefined; }
function sourceUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) invalid("units", "magnetic source units must be acyclic with depth at most 32");
  if (record(value)) keys(value, ["value", "unit"], "quantity");
  const entry = typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : record(value) ? value : undefined;
  if (!entry) return [];
  seen.add(value);
  if (entry.unit !== undefined && (typeof entry.unit !== "string" || !entry.unit.trim())) invalid("units", "known magnetic source units must be nonempty strings");
  return [...(typeof entry.unit === "string" ? [entry.unit] : []), ...("value" in entry ? sourceUnits(entry.value, document, seen, depth + 1) : [])];
}
function checkUnits(inputs: Record<string, unknown>, document?: SceneDocument): void {
  const check = (value: unknown, expected: string): void => { for (const actual of sourceUnits(value, document)) if (canonicalUnit(actual) !== expected) invalid("units", `magnetic source unit ${actual} must match SI ${expected}; no conversion is inferred`); };
  check(inputs.displayLength, "1");
  if (inputs.charge === undefined) return;
  if (!record(inputs.units)) invalid("units", "magnetic_force requires explicit charge, velocity, and magneticField SI unit declarations");
  keys(inputs.units, ["charge", "velocity", "magneticField"], "units");
  for (const [key, expected] of [["charge", "C"], ["velocity", "m/s"], ["magneticField", "T"]]) {
    if (canonicalUnit(inputs.units[key!]) !== expected) invalid("units", `${key} must explicitly declare SI ${expected}`);
    const values = key === "charge" ? [inputs.charge] : Array.isArray(inputs[key!]) ? inputs[key!] as unknown[] : [];
    values.forEach((value) => check(value, expected!));
  }
}
type Exact = { n: bigint; e: number };
const bits = new DataView(new ArrayBuffer(8));
function exact(value: number): Exact {
  if (value === 0) return { n: 0n, e: 0 };
  bits.setFloat64(0, value); const raw = bits.getBigUint64(0); const exponent = Number((raw >> 52n) & 2047n);
  const magnitude = (raw & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  return { n: raw >> 63n ? -magnitude : magnitude, e: exponent ? exponent - 1075 : -1074 };
}
function add(a: Exact, b: Exact): Exact { const e = Math.min(a.e, b.e); return { n: (a.n << BigInt(a.e - e)) + (b.n << BigInt(b.e - e)), e }; }
function product(a: Exact, b: Exact): Exact { return { n: a.n * b.n, e: a.e + b.e }; }
function negative(value: Exact): Exact { return { n: -value.n, e: value.e }; }
function numeric(value: Exact): number {
  if (value.n === 0n) return 0;
  const magnitude = value.n < 0n ? -value.n : value.n;
  const shift = Math.max(0, magnitude.toString(2).length - 53, -1074 - value.e);
  let mantissa = magnitude >> BigInt(shift);
  if (shift > 0) {
    const remainder = magnitude - (mantissa << BigInt(shift)); const half = 1n << BigInt(shift - 1);
    if (remainder > half || remainder === half && mantissa % 2n === 1n) mantissa += 1n;
  }
  const result = Number(mantissa) * 2 ** (value.e + shift) * (value.n < 0n ? -1 : 1);
  if (result === 0) invalid("precision", "a nonzero Lorentz component underflows numeric authority");
  if (Number.isFinite(result)) {
    const error = add(exact(result), negative(value));
    const errorMagnitude = error.n < 0n ? -error.n : error.n;
    const exponent = Math.min(error.e + 46, value.e);
    if ((errorMagnitude << BigInt(error.e + 46 - exponent)) > (magnitude << BigInt(value.e - exponent))) invalid("precision", "Lorentz component rounding cannot retain relative numeric authority");
  }
  return bounded(result, "force", MAX_FORCE);
}
function lorentz(charge: number, velocity: MagneticVector, magneticField: MagneticVector): MagneticVector {
  const component = (a: keyof MagneticVector, b: keyof MagneticVector): number => numeric(product(exact(charge), add(product(exact(velocity[a]), exact(magneticField[b])), negative(product(exact(velocity[b]), exact(magneticField[a]))))));
  return { x: component("y", "z"), y: component("z", "x"), z: component("x", "y") };
}
function forceMagnitude(components: MagneticVector): number {
  const scale = Math.max(Math.abs(components.x), Math.abs(components.y), Math.abs(components.z));
  if (scale === 0) return 0;
  const normalized = Math.hypot(components.x / scale, components.y / scale, components.z / scale);
  const magnitude = bounded(scale * normalized, "force", MAX_FORCE);
  if (magnitude === 0 || Math.abs(magnitude / scale - normalized) > 64 * Number.EPSILON * normalized) invalid("precision", "Lorentz magnitude cannot retain its component norm at numeric precision");
  return magnitude;
}
function displayLength(value: unknown, context: MagneticEvaluationContext): number {
  const length = scalar(value, "displayLength", context);
  if (!(length > MIN_DISPLAY)) invalid("displayLength", "magnetic displayLength must exceed 1e-6");
  return length;
}
function forceDefinition(inputs: Record<string, unknown>, context: MagneticEvaluationContext): MagneticForceDefinition {
  keys(inputs, ["charge", "velocity", "magneticField", "units", "origin", "displayLength"]);
  checkUnits(inputs);
  const charge = scalar(inputs.charge, "charge", context); const velocity = vector(inputs.velocity, "velocity", context); const magneticField = vector(inputs.magneticField, "magneticField", context);
  const components = lorentz(charge, velocity, magneticField); const magnitude = forceMagnitude(components);
  if (components.z !== 0 && (components.x !== 0 || components.y !== 0)) invalid("force", "mixed planar and page-normal forces require a 3D force operator; no component is projected away");
  const length = displayLength(inputs.displayLength, context);
  return { charge, velocity, magneticField, components, magnitude, unit: "N", origin: origin(inputs.origin, context), displayLength: length, zero: magnitude === 0, pageNormal: components.z === 0 ? null : components.z > 0 ? "out" : "in" };
}
function selected(definition: MagneticForceDefinition): MagneticVector {
  return definition.component === undefined ? definition.components : { x: definition.component === "x" ? definition.components.x : 0, y: definition.component === "y" ? definition.components.y : 0, z: definition.component === "z" ? definition.components.z : 0 };
}
function forceMark(definition: MagneticForceDefinition): MagneticGeometry {
  const force = selected(definition);
  if (force.x === 0 && force.y === 0 && force.z === 0) return { kind: "point", point: { ...definition.origin }, magneticForce: definition };
  if (force.z !== 0) {
    const radius = definition.displayLength / 2;
    const move = (x: number, y: number): RenderPoint => {
      const result = point({ x: definition.origin.x + x, y: definition.origin.y + y }, "geometry");
      if (Math.hypot((result.x - definition.origin.x) - x, (result.y - definition.origin.y) - y) > radius * 1e-8) invalid("precision", "page-normal glyph placement is unresolved at numeric precision");
      return result;
    };
    const ring = (r: number, samples: number): RenderPoint[] => Array.from({ length: samples + 1 }, (_, index) => index === samples ? move(r, 0) : move(r * Math.cos(2 * Math.PI * index / samples), r * Math.sin(2 * Math.PI * index / samples)));
    const paths = [ring(radius, 64), ...(force.z > 0 ? [ring(radius / 20, 16)] : [
      [move(-radius / 2, -radius / 2), move(radius / 2, radius / 2)], [move(-radius / 2, radius / 2), move(radius / 2, -radius / 2)],
    ])];
    return { kind: "multi_path", paths, magneticForce: definition };
  }
  const delta = { x: force.x / definition.magnitude * definition.displayLength, y: force.y / definition.magnitude * definition.displayLength };
  if (force.x !== 0 && delta.x === 0 || force.y !== 0 && delta.y === 0 || !(Math.hypot(delta.x, delta.y) > MIN_DISPLAY)) invalid("precision", "nonzero Lorentz components cannot underflow or collapse in display geometry");
  const tip = point({ x: definition.origin.x + delta.x, y: definition.origin.y + delta.y }, "geometry");
  for (const axis of ["x", "y"] as const) if (delta[axis] !== 0 && (tip[axis] === definition.origin[axis] || Math.abs((tip[axis] - definition.origin[axis]) - delta[axis]) > Math.abs(delta[axis]) * 1e-8)) invalid("precision", "force placement cannot retain its computed direction at numeric precision");
  return { kind: "path", points: [{ ...definition.origin }, tip], directed: true, magneticForce: definition };
}
function evaluatedDefinition(value: unknown): MagneticForceDefinition {
  if (!record(value) || !record(value.magneticForce)) invalid("force", "magnetic force references require typed source-derived geometry");
  const raw = value.magneticForce;
  keys(raw, ["charge", "velocity", "magneticField", "components", "magnitude", "unit", "origin", "displayLength", "zero", "pageNormal", "component"], "force");
  const readVector = (key: string): MagneticVector => {
    const entry = raw[key]; if (!record(entry)) invalid("force", "magnetic metadata requires three numerical components"); keys(entry, AXES, "force");
    if (AXES.some((axis) => typeof entry[axis] !== "number")) invalid("force", "magnetic metadata components must be numerical");
    return { x: bounded(entry.x as number, "force"), y: bounded(entry.y as number, "force"), z: bounded(entry.z as number, "force") };
  };
  if (typeof raw.charge !== "number" || typeof raw.displayLength !== "number" || raw.unit !== "N") invalid("force", "magnetic metadata must retain SI source and display authority");
  const components = lorentz(bounded(raw.charge, "force"), readVector("velocity"), readVector("magneticField"));
  const actual = readVector("components"); const magnitude = forceMagnitude(components);
  if (AXES.some((axis) => components[axis] !== actual[axis]) || raw.magnitude !== magnitude || raw.zero !== (magnitude === 0) || raw.pageNormal !== (components.z === 0 ? null : components.z > 0 ? "out" : "in") || raw.component !== undefined && !AXES.includes(raw.component as typeof AXES[number])) invalid("force", "magnetic metadata contradicts q(v×B) source authority");
  if (components.z !== 0 && (components.x !== 0 || components.y !== 0)) invalid("force", "mixed planar/page-normal force metadata is unsupported");
  const definition: MagneticForceDefinition = { charge: raw.charge, velocity: readVector("velocity"), magneticField: readVector("magneticField"), components, magnitude, unit: "N", origin: point(raw.origin, "force"), displayLength: displayLength(raw.displayLength, { number: Number, point: () => ({ x: 0, y: 0 }), geometry: () => undefined }), zero: magnitude === 0, pageNormal: raw.pageNormal as MagneticForceDefinition["pageNormal"], ...(raw.component === undefined ? {} : { component: raw.component as typeof AXES[number] }) };
  const expected = forceMark(definition);
  const same = (a: unknown, b: unknown): boolean => {
    if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((value, index) => same(a[index], value));
    if (record(b)) return record(a) && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([key, value]) => same(a[key], value));
    return a === b;
  };
  if (!same(value, expected)) invalid("force", "magnetic geometry or protected metadata contradicts its verified source model");
  return definition;
}

/** Exact binary cross-product authority is independent of normalized glyph/arrow lengths.
 * A one-axis resultant coincides with its nonzero component at an inherited displayLength.
 * A scene requiring both marks must explicitly choose a distinct component displayLength;
 * the global duplicate-geometry guard remains authoritative.
 */
export function evaluateMagneticConstruction(operator: string, inputs: Record<string, unknown>, context: MagneticEvaluationContext): MagneticGeometry[] {
  if (operator === "magnetic_force") return [forceMark(forceDefinition(inputs, context))];
  if (operator === "magnetic_components") {
    keys(inputs, ["force", "displayLength"]); checkUnits(inputs);
    if (typeof inputs.force !== "string" || !inputs.force.trim()) invalid("force", "magnetic_components requires an explicit computed force entity ID");
    const definition = evaluatedDefinition(context.geometry(inputs.force));
    if (definition.component !== undefined) invalid("force", "magnetic_components requires a complete Lorentz resultant");
    const length = inputs.displayLength === undefined ? definition.displayLength : displayLength(inputs.displayLength, context);
    return AXES.map((component) => forceMark({ ...definition, origin: { ...definition.origin }, displayLength: length, component }));
  }
  return invalid("operator", `unsupported magnetic operator ${operator}`);
}
function compact(value: number): string { return value === 0 ? "0" : Math.abs(value) >= 0.001 && Math.abs(value) < 10000 ? Number(value.toPrecision(3)).toString() : value.toExponential(1).replace("e+", "e"); }
function resultLabel(definition: MagneticForceDefinition): { symbol: string; plain: string; numeric: string; allowed: readonly string[] } {
  const axis = definition.component;
  const symbol = axis ? `F${axis}` : "F";
  const value = axis ? definition.components[axis] : definition.pageNormal ? definition.components.z : definition.magnitude;
  const numericSymbol = axis ? symbol : definition.pageNormal ? "Fz" : "|F|";
  const glyph = (axis === "z" || axis === undefined) && definition.pageNormal ? definition.pageNormal === "out" ? " ⊙" : " ⊗" : "";
  const plain = `${symbol}${glyph}`; const numeric = `${numericSymbol}=${compact(value)} N${glyph}`;
  return { symbol, plain, numeric, allowed: [symbol, plain, numeric, ...(axis === undefined && definition.pageNormal ? ["Fz", `Fz${glyph}`] : [])] };
}
function checkResultText(text: unknown, definition: MagneticForceDefinition): void {
  if (text !== undefined && !resultLabel(definition).allowed.includes(text as string)) invalid("label", "magnetic result labels must use their quantity symbol or the verified computed SI value");
}
export function magneticConstructionOutputLabels(operator: string, outputs: readonly unknown[], requestedTexts?: readonly unknown[]): string[] {
  const count = operator === "magnetic_force" ? 1 : operator === "magnetic_components" ? 3 : 0;
  if (!count || outputs.length !== count || requestedTexts !== undefined && requestedTexts.length !== count) invalid("outputs", "magnetic labels require every ordered evaluated output");
  return outputs.map((output, index) => {
    const definition = evaluatedDefinition(output); const axis = operator === "magnetic_components" ? AXES[index] : undefined;
    if (definition.component !== axis) invalid("outputs", "magnetic components must retain their ordered Cartesian identities");
    const requested = requestedTexts?.[index]; checkResultText(requested, definition);
    const label = resultLabel(definition);
    return requested === label.numeric ? label.numeric : label.plain;
  });
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("quantity", "magnetic scalar quantity references must be acyclic and bounded");
  if (typeof value === "number") return bounded(value, "quantity");
  if (record(value) && "value" in value) { keys(value, ["value", "unit"], "quantity"); seen.add(value); return validationNumber(value.value, document, seen, depth + 1); }
  if (typeof value === "string" && value.trim()) {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) { seen.add(value); return validationNumber(quantity.value, document, seen, depth + 1); }
    preserveLiteral(value, "quantity"); return bounded(Number(value), "quantity");
  }
  return invalid("quantity", "magnetic values must resolve to finite scalar numbers");
}
function signedChargeSymbol(text: unknown): 1 | -1 | null {
  if (typeof text !== "string") return null;
  const label = text.trim(); const sign = label[0] === "+" ? 1 : label[0] === "-" || label[0] === "−" ? -1 : null;
  if (sign === null) return null;
  const symbol = label.slice(1).trim();
  return symbol[0]?.toLowerCase() === "q" && [...symbol.slice(1)].every((character) => character === "_" || character >= "0" && character <= "9" || character >= "a" && character <= "z" || character >= "A" && character <= "Z") ? sign : null;
}
function chargeSourceId(value: unknown, document: SceneDocument, depth = 0): string | undefined {
  if (depth > 32) return undefined;
  if (record(value)) return chargeSourceId(value.value, document, depth + 1);
  return typeof value === "string" && document.quantities.some((quantity) => quantity.id === value) ? value : undefined;
}
function checkSourceChargeClaims(construction: SceneConstruction, document: SceneDocument): void {
  if (construction.operator !== "magnetic_force" || typeof construction.inputs.origin !== "string") return;
  const id = construction.inputs.origin; const charge = validationNumber(construction.inputs.charge, document);
  const checkSign = (text: unknown): void => { const sign = signedChargeSymbol(text); if (sign !== null && Math.sign(charge) !== sign) invalid("label", "source particle charge sign label contradicts the supplied charge"); };
  checkSign(document.entities.find((entity) => entity.id === id)?.label);
  for (const annotation of document.annotations) {
    if (!annotation.targetIds.includes(id)) continue;
    checkSign(annotation.text);
    if (annotation.quantityId === undefined) continue;
    const units = sourceUnits(annotation.quantityId, document);
    if (signedChargeSymbol(annotation.text) === null && !units.some((unit) => canonicalUnit(unit) === "C" || ["mC", "uC", "μC", "nC", "pC", "kC", "MC"].includes(unit))) continue;
    if (!units.length || units.some((unit) => canonicalUnit(unit) !== "C")) invalid("label", "source particle charge annotations must declare compatible SI coulombs");
    const expectedId = chargeSourceId(construction.inputs.charge, document);
    if (expectedId !== undefined ? annotation.quantityId !== expectedId : validationNumber(annotation.quantityId, document) !== charge) invalid("label", "source particle charge annotation is bound to a different supplied charge quantity");
  }
  for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) checkSign(label.inputs.text);
}
export function validateEvaluatedMagneticLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  try {
    checkSourceChargeClaims(construction, document);
    magneticConstructionOutputLabels(construction.operator, outputs);
    for (const [outputIndex, id] of construction.outputs.entries()) {
      const definition = evaluatedDefinition(outputs[outputIndex]);
      const checkText = (text: unknown): void => { checkResultText(text, definition); };
      checkText(document.entities.find((entity) => entity.id === id)?.label);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(id) || !["label", "callout", "badge"].includes(annotation.kind)) continue;
        checkText(annotation.text);
        if (annotation.quantityId !== undefined) {
          const units = sourceUnits(annotation.quantityId, document);
          if (!units.length || units.some((actual) => canonicalUnit(actual) !== "N")) invalid("label", "magnetic force annotations must declare newtons");
          const actual = validationNumber(annotation.quantityId, document);
          const expected = definition.component ? definition.components[definition.component] : definition.pageNormal ? definition.components.z : definition.magnitude;
          if (Math.abs(actual - expected) > 64 * Number.EPSILON * Math.abs(expected)) invalid("label", "magnetic annotation contradicts its source-derived SI force");
        }
      }
      for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) checkText(label.inputs.text);
    }
  } catch (error) { issues.push({ code: `invalid_${construction.operator}_label`, severity: "fatal", message: error instanceof Error ? error.message : "magnetic output labels are invalid", path: `constructions[${index}].outputs` }); }
}
class DeferredMagneticOrigin extends MagneticInputError { constructor() { super("origin", "constructed 2D placement coordinates are checked after compilation"); } }
export function validateMagneticConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const add = (key: string, message: string): void => { issues.push({ code: `invalid_${construction.operator}_${key}`, severity: "fatal", message, path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}` }); };
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : []; const count = construction.operator === "magnetic_force" ? 1 : 3;
  if (outputs.length !== count || outputs.some((id) => typeof id !== "string" || !id.trim()) || new Set(outputs).size !== count) add("outputs", `magnetic construction requires ${count} distinct outputs`);
  for (const id of outputs) if (document.entities.find((entity) => entity.id === id)?.kind !== "vector") add("output_kind", "magnetic outputs must be vector entities; zero values render as points");
  if (!record(construction.inputs)) { add("fields", "magnetic inputs must be an object"); return; }
  const context: MagneticEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      if (typeof value !== "string") return origin(value, context);
      const producer = constructionByOutput.get(value);
      if (!producer || document.entities.find((entity) => entity.id === value)?.kind !== "point") invalid("origin", "magnetic origins require constructed 2D placement points");
      if (["space_point", "space_project", "space_intersection", "space_closest_points", "solid_anchor", "electric_field", "field_components", "trajectory_state", "magnetic_force", "magnetic_components", "wave_sample", "process_state"].includes(producer.operator)) invalid("origin", "magnetic origins cannot discard protected world or physical display metadata");
      if (producer.operator !== "point") throw new DeferredMagneticOrigin();
      return { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) };
    },
    geometry(value) {
      if (typeof value !== "string") return undefined;
      const producer = constructionByOutput.get(value);
      if (!producer) return undefined;
      if (document.entities.find((entity) => entity.id === value)?.kind === "point") return { kind: "point", point: context.point(value) };
      if (producer.operator !== "magnetic_force" || document.entities.find((entity) => entity.id === value)?.kind !== "vector") invalid("force", "magnetic components must reference a magnetic_force resultant");
      checkUnits(producer.inputs, document);
      return evaluateMagneticConstruction(producer.operator, producer.inputs, context)[0];
    },
  };
  try {
    checkUnits(construction.inputs, document);
    checkSourceChargeClaims(construction, document);
    if (construction.operator === "magnetic_components" && construction.inputs.displayLength !== undefined) displayLength(construction.inputs.displayLength, context);
    validateEvaluatedMagneticLabels(construction, index, document, evaluateMagneticConstruction(construction.operator, construction.inputs, context), issues);
  } catch (error) { if (!(error instanceof DeferredMagneticOrigin)) add(error instanceof MagneticInputError ? error.key : "inputs", error instanceof Error ? error.message : "magnetic inputs are invalid"); }
}
