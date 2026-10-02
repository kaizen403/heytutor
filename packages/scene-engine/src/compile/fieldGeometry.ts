import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const FIELD_OPERATORS = ["electric_field", "field_components"] as const;
const MAX_CHARGES = 32;
const MAX_SCALAR_DEPTH = 32;
const RELATIVE_ERROR = 64 * Number.EPSILON;

/** Physical components never describe the length of a fitted board arrow. */
export interface ElectricFieldDefinition {
  mode: "schematic" | "si";
  at: RenderPoint;
  components: RenderPoint;
  magnitude: number;
  unit: "normalized" | "N/C";
  k: number;
  displayLength: number;
  zero: boolean;
  direction: RenderPoint | null;
  contributions: Array<{ position: RenderPoint; charge: number; components: RenderPoint }>;
  component?: "x" | "y";
}
export type FieldGeometry =
  | { kind: "point"; point: RenderPoint; electricField: ElectricFieldDefinition }
  | { kind: "path"; points: RenderPoint[]; directed: true; electricField: ElectricFieldDefinition };
export interface FieldEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry(value: unknown): unknown;
}
class FieldInputError extends Error {
  constructor(readonly key: string, message: string) { super(message); }
}
function invalid(key: string, message: string): never { throw new FieldInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function inputKeys(inputs: Record<string, unknown>, allowed: readonly string[], key = "fields"): void {
  const unexpected = Object.keys(inputs).filter((name) => !allowed.includes(name));
  if (unexpected.length) invalid(key, `unsupported field inputs: ${unexpected.join(", ")}`);
}
function numberValue(value: unknown, key: string, context: FieldEvaluationContext): number {
  let scalar = value;
  const seen = new Set<unknown>();
  for (let depth = 0; isRecord(scalar); depth += 1) {
    if (depth >= MAX_SCALAR_DEPTH || seen.has(scalar) || !("value" in scalar)) invalid(key, `${key} must be a finite scalar or quantity reference`);
    inputKeys(scalar, ["value", "unit"], key);
    seen.add(scalar);
    scalar = scalar.value;
  }
  if (typeof scalar !== "number" && typeof scalar !== "string" || typeof scalar === "string" && !scalar.trim()) invalid(key, `${key} must be a finite scalar or quantity reference`);
  try {
    const number = context.number(scalar);
    if (!Number.isFinite(number)) invalid(key, `${key} must resolve to a finite number`);
    return number;
  } catch (error) {
    if (error instanceof FieldInputError) throw error;
    return invalid(key, `${key} must resolve to a finite number`);
  }
}
function finitePoint(point: RenderPoint, key: string): RenderPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) invalid(key, `${key} must resolve to a finite point`);
  return { x: point.x, y: point.y };
}
function pointValue(value: unknown, key: string, context: FieldEvaluationContext): RenderPoint {
  if (isRecord(value)) {
    inputKeys(value, ["x", "y"], key);
    return finitePoint({ x: numberValue(value.x, `${key}.x`, context), y: numberValue(value.y, `${key}.y`, context) }, key);
  }
  if (Array.isArray(value)) {
    if (value.length !== 2) invalid(key, `${key} must contain exactly two coordinates`);
    return finitePoint({ x: numberValue(value[0], `${key}.x`, context), y: numberValue(value[1], `${key}.y`, context) }, key);
  }
  if (typeof value !== "string" || !value.trim()) invalid(key, `${key} must reference a point or supply two coordinates`);
  try {
    const geometry = context.geometry(value);
    if (isRecord(geometry) && (geometry.space !== undefined || geometry.spaceFrameId !== undefined || geometry.world3D !== undefined)) invalid(key, "electric_field requires physical 2D points; projected 3D positions need a separate field operator");
    return finitePoint(context.point(value), key);
  }
  catch (error) {
    if (error instanceof FieldInputError) throw error;
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
const DIMENSIONLESS_UNITS = new Set(["1", "unit", "units", "dimensionless", "normalized"]);
const COULOMB_COEFFICIENT_UNITS = new Set(["N*m^2/C^2", "N m^2/C^2", "N·m²/C²", "N m²/C²", "N*m²/C²", "N·m^2/C^2"]);
function declaredUnit(value: unknown, key: string, units: Map<string, number>, required: boolean): number {
  if (value === undefined && !required) return 1;
  if (typeof value !== "string" || !units.has(value.trim())) invalid(key, `${key} must declare a supported ${key === "lengthUnit" ? "length" : "charge"} unit`);
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
function checkSourceUnits(inputs: Record<string, unknown>, document?: SceneDocument, constructionByOutput?: Map<string, SceneConstruction>): void {
  const compare = (value: unknown, key: string, kind: "length" | "charge"): void => {
    const declared = inputs[kind === "length" ? "lengthUnit" : "chargeUnit"];
    const units = kind === "length" ? LENGTH_UNITS : CHARGE_UNITS;
    for (const unit of scalarUnits(value, key, document)) {
      if (inputs.mode === "schematic" && declared === undefined && DIMENSIONLESS_UNITS.has(unit)) continue;
      if (typeof declared !== "string" || !units.has(unit) || units.get(unit) !== units.get(declared.trim())) invalid(`${key}_unit`, `${key} must use the declared ${kind} unit; mixed source scales are not silently reinterpreted`);
    }
  };
  const inheritedLengths = (value: unknown, key: string, ancestors = new Set<string>(), depth = 0): void => {
    if (depth > MAX_SCALAR_DEPTH) invalid(`${key}_unit`, "derived source length-unit dependencies exceed the verification bound");
    if (typeof value === "string" && constructionByOutput?.has(value)) {
      if (ancestors.has(value)) invalid(`${key}_unit`, "derived source length-unit dependencies are cyclic");
      const producer = constructionByOutput.get(value)!;
      if (producer.operator === "point") { compare(producer.inputs.x, `${key}.x`, "length"); compare(producer.inputs.y, `${key}.y`, "length"); return; }
      const next = new Set([...ancestors, value]);
      for (const [name, input] of Object.entries(producer.inputs)) if (!["kind", "feature", "mode", "axis", "component", "label"].includes(name)) inheritedLengths(input, key, next, depth + 1);
      return;
    }
    if (scalarUnits(value, key, document).some((unit) => LENGTH_UNITS.has(unit))) { compare(value, key, "length"); return; }
    if (Array.isArray(value)) for (const item of value) inheritedLengths(item, key, ancestors, depth + 1);
    else if (isRecord(value)) for (const [name, item] of Object.entries(value)) if (name !== "unit") inheritedLengths(item, key, ancestors, depth + 1);
  };
  const coordinates = (value: unknown, key: string): void => {
    if (isRecord(value)) { compare(value.x, `${key}.x`, "length"); compare(value.y, `${key}.y`, "length"); }
    else if (Array.isArray(value)) { compare(value[0], `${key}.x`, "length"); compare(value[1], `${key}.y`, "length"); }
    else if (typeof value === "string") {
      const producer = constructionByOutput?.get(value);
      if (producer?.operator === "point") { compare(producer.inputs.x, `${key}.x`, "length"); compare(producer.inputs.y, `${key}.y`, "length"); }
      else if (producer) inheritedLengths(value, key);
    }
  };
  coordinates(inputs.at, "at");
  compare(inputs.displayLength, "displayLength", "length");
  if (Array.isArray(inputs.charges)) for (const [index, source] of inputs.charges.entries()) if (isRecord(source)) {
    coordinates(source.position, `charges[${index}].position`);
    compare(source.charge, `charges[${index}].charge`, "charge");
  }
  for (const unit of scalarUnits(inputs.k, "k", document)) {
    if (inputs.mode === "si" ? !COULOMB_COEFFICIENT_UNITS.has(unit) : !DIMENSIONLESS_UNITS.has(unit)) invalid("k_unit", "k must be dimensionless in schematic mode or use N*m^2/C^2 in SI mode");
  }
}

// Exact dyadic arithmetic is used only to certify cancellation. It never rounds a
// small computed result to zero or replaces the independently evaluated field.
type Dyadic = { n: bigint; e: number };
const bitBuffer = new ArrayBuffer(8);
const bitView = new DataView(bitBuffer);
function dyadic(value: number): Dyadic {
  if (value === 0) return { n: 0n, e: 0 };
  bitView.setFloat64(0, value);
  const bits = bitView.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 2047n);
  const significand = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  return { n: bits >> 63n ? -significand : significand, e: exponent ? exponent - 1075 : -1074 };
}
function addExact(a: Dyadic, b: Dyadic): Dyadic {
  const e = Math.min(a.e, b.e);
  return { n: (a.n << BigInt(a.e - e)) + (b.n << BigInt(b.e - e)), e };
}
function multiplyExact(a: Dyadic, b: Dyadic): Dyadic { return { n: a.n * b.n, e: a.e + b.e }; }
function differenceExact(a: number, b: number): Dyadic { const right = dyadic(b); return addExact(dyadic(a), { n: -right.n, e: right.e }); }
function exactKey(value: Dyadic): string {
  let { n, e } = value;
  if (n === 0n) return "0";
  while (n % 2n === 0n) { n /= 2n; e += 1; }
  return `${n}:${e}`;
}
function certifiedComponents(at: RenderPoint, charges: Array<{ position: RenderPoint; charge: number }>): { x: boolean; y: boolean } {
  const radii = new Map<string, { x: Dyadic; y: Dyadic }>();
  for (const source of charges) {
    const dx = differenceExact(at.x, source.position.x);
    const dy = differenceExact(at.y, source.position.y);
    const radiusSquared = exactKey(addExact(multiplyExact(dx, dx), multiplyExact(dy, dy)));
    const existing = radii.get(radiusSquared) ?? { x: { n: 0n, e: 0 }, y: { n: 0n, e: 0 } };
    const charge = dyadic(source.charge);
    radii.set(radiusSquared, { x: addExact(existing.x, multiplyExact(charge, dx)), y: addExact(existing.y, multiplyExact(charge, dy)) });
  }
  return { x: [...radii.values()].every((sum) => sum.x.n === 0n), y: [...radii.values()].every((sum) => sum.y.n === 0n) };
}
function stableComponent(values: number[], certifiedZero: boolean, axis: string): number {
  if (certifiedZero) return 0;
  let sum = 0;
  let correction = 0;
  let absolute = 0;
  for (const value of [...values].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
    absolute += Math.abs(value);
  }
  const result = sum + correction;
  if (!Number.isFinite(result) || !Number.isFinite(absolute)) invalid("charges", "field superposition overflows finite numeric authority");
  if (Math.abs(result) <= RELATIVE_ERROR * absolute + MAX_CHARGES * Number.MIN_VALUE) invalid("charges", `${axis} component is unresolved within floating error; an exact zero has not been certified`);
  return result;
}
function fieldParameters(inputs: Record<string, unknown>, context: FieldEvaluationContext): {
  mode: "schematic" | "si"; k: number; lengthFactor: number; chargeFactor: number; displayLength: number;
  charges: Array<{ position: unknown; charge: number }>;
} {
  inputKeys(inputs, ["charges", "at", "mode", "k", "displayLength", "lengthUnit", "chargeUnit"]);
  if (inputs.mode !== "schematic" && inputs.mode !== "si") invalid("mode", "electric_field requires explicit schematic or si mode");
  const mode = inputs.mode;
  const k = numberValue(inputs.k, "k", context);
  if (!(k > 0) || mode === "schematic" && k !== 1) invalid("k", "k must be positive in SI mode and exactly 1 in schematic mode");
  const lengthFactor = declaredUnit(inputs.lengthUnit, "lengthUnit", LENGTH_UNITS, mode === "si");
  const chargeFactor = declaredUnit(inputs.chargeUnit, "chargeUnit", CHARGE_UNITS, mode === "si");
  checkSourceUnits(inputs);
  const displayLength = numberValue(inputs.displayLength, "displayLength", context);
  if (!(displayLength > 0)) invalid("displayLength", "displayLength must be positive");
  if (!Array.isArray(inputs.charges) || inputs.charges.length < 1 || inputs.charges.length > MAX_CHARGES) invalid("charges", `electric_field requires 1 to ${MAX_CHARGES} explicit point charges`);
  const charges = inputs.charges.map((item, index) => {
    const key = `charges[${index}]`;
    if (!isRecord(item)) invalid(key, "each charge requires position and charge");
    inputKeys(item, ["position", "charge"], key);
    return { position: item.position, charge: numberValue(item.charge, `${key}.charge`, context) };
  });
  return { mode, k, lengthFactor, chargeFactor, displayLength, charges };
}
function fieldDefinition(inputs: Record<string, unknown>, context: FieldEvaluationContext): ElectricFieldDefinition {
  const parameters = fieldParameters(inputs, context);
  const { mode, k, lengthFactor, chargeFactor, displayLength } = parameters;
  const at = pointValue(inputs.at, "at", context);
  const charges = parameters.charges.map((item, index) => ({ ...item, position: pointValue(item.position, `charges[${index}].position`, context) }));
  const contributions = charges.map(({ position, charge }, index) => {
    const dx = at.x - position.x;
    const dy = at.y - position.y;
    const radius = Math.hypot(dx, dy);
    if (!Number.isFinite(radius) || !(radius > 0)) invalid(`charges[${index}].position`, "the observation point must be finitely separated from every source charge");
    const physicalRadius = mode === "si" ? radius * lengthFactor : radius;
    const physicalCharge = mode === "si" ? charge * chargeFactor : charge;
    if (!Number.isFinite(physicalRadius) || !(physicalRadius > 0) || !Number.isFinite(physicalCharge) || charge !== 0 && physicalCharge === 0) invalid("charges", "charge or distance unit conversion overflows or underflows");
    const radialMagnitude = k * (physicalCharge / physicalRadius) / physicalRadius;
    if (!Number.isFinite(radialMagnitude) || charge !== 0 && radialMagnitude === 0) invalid("charges", "a point-charge field overflows or underflows finite numeric authority");
    const components = { x: radialMagnitude * (dx / radius), y: radialMagnitude * (dy / radius) };
    if (!Number.isFinite(components.x) || !Number.isFinite(components.y) || radialMagnitude !== 0 && (dx !== 0 && components.x === 0 || dy !== 0 && components.y === 0)) invalid("charges", "a field component overflows or underflows finite numeric authority");
    return { position, charge, components };
  });
  const certified = certifiedComponents(at, charges);
  const components = {
    x: stableComponent(contributions.map((item) => item.components.x), certified.x, "x"),
    y: stableComponent(contributions.map((item) => item.components.y), certified.y, "y"),
  };
  const magnitude = Math.hypot(components.x, components.y);
  if (!Number.isFinite(magnitude)) invalid("charges", "resultant field magnitude is non-finite");
  const zero = components.x === 0 && components.y === 0;
  return { mode, at, components, magnitude, unit: mode === "si" ? "N/C" : "normalized", k, displayLength, zero, direction: zero ? null : { x: components.x / magnitude, y: components.y / magnitude }, contributions };
}
function fieldMark(field: ElectricFieldDefinition, component?: "x" | "y"): FieldGeometry {
  const value = component ? field.components[component] : field.magnitude;
  const metadata = component ? { ...field, component } : field;
  if (value === 0) return { kind: "point", point: { ...field.at }, electricField: metadata };
  const direction = component ? { x: component === "x" ? field.components.x / field.magnitude : 0, y: component === "y" ? field.components.y / field.magnitude : 0 } : field.direction!;
  const end = finitePoint({ x: field.at.x + direction.x * field.displayLength, y: field.at.y + direction.y * field.displayLength }, "displayLength");
  if (end.x === field.at.x && end.y === field.at.y || !Number.isFinite(Math.hypot(end.x - field.at.x, end.y - field.at.y))) invalid("displayLength", "the display vector is numerically indistinguishable or non-finite");
  return { kind: "path", points: [{ ...field.at }, end], directed: true, electricField: metadata };
}
function isFinitePoint(value: unknown): value is RenderPoint {
  return isRecord(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y);
}
function isFieldDefinition(value: unknown): value is ElectricFieldDefinition {
  if (!isRecord(value) || value.mode !== "schematic" && value.mode !== "si" || !isFinitePoint(value.at) || !isFinitePoint(value.components) ||
    typeof value.magnitude !== "number" || !Number.isFinite(value.magnitude) || value.magnitude !== Math.hypot(value.components.x, value.components.y) ||
    value.unit !== (value.mode === "si" ? "N/C" : "normalized") || typeof value.k !== "number" || !Number.isFinite(value.k) || !(value.k > 0) || value.mode === "schematic" && value.k !== 1 ||
    typeof value.displayLength !== "number" || !Number.isFinite(value.displayLength) || !(value.displayLength > 0) ||
    value.zero !== (value.components.x === 0 && value.components.y === 0) || value.component !== undefined && value.component !== "x" && value.component !== "y" ||
    !Array.isArray(value.contributions) || value.contributions.length < 1 || value.contributions.length > MAX_CHARGES) return false;
  if (value.zero ? value.direction !== null : !isFinitePoint(value.direction) || value.direction.x !== value.components.x / value.magnitude || value.direction.y !== value.components.y / value.magnitude) return false;
  return value.contributions.every((source) => isRecord(source) && isFinitePoint(source.position) && typeof source.charge === "number" && Number.isFinite(source.charge) && isFinitePoint(source.components));
}
function isFieldGeometry(value: unknown): value is FieldGeometry {
  if (!isRecord(value) || !isFieldDefinition(value.electricField)) return false;
  const field = value.electricField;
  const component = field.component;
  const scalar = component ? field.components[component] : field.magnitude;
  if (scalar === 0) return value.kind === "point" && isFinitePoint(value.point) && value.point.x === field.at.x && value.point.y === field.at.y;
  if (value.kind !== "path" || value.directed !== true || !Array.isArray(value.points) || value.points.length !== 2 || !value.points.every(isFinitePoint)) return false;
  const [start, end] = value.points;
  if (!start || !end || start.x !== field.at.x || start.y !== field.at.y || start.x === end.x && start.y === end.y) return false;
  const direction = component ? { x: component === "x" ? field.components.x / field.magnitude : 0, y: component === "y" ? field.components.y / field.magnitude : 0 } : field.direction!;
  return end.x === field.at.x + direction.x * field.displayLength && end.y === field.at.y + direction.y * field.displayLength;
}

/** Every source and scalar is explicit; no stem classification or guessed charge arrangement. */
export function evaluateFieldConstruction(operator: string, inputs: Record<string, unknown>, context: FieldEvaluationContext): FieldGeometry[] {
  if (operator === "electric_field") return [fieldMark(fieldDefinition(inputs, context))];
  if (operator === "field_components") {
    inputKeys(inputs, ["field"]);
    if (typeof inputs.field !== "string" || !inputs.field.trim()) invalid("field", "field_components requires an electric_field entity reference");
    const target = context.geometry(inputs.field);
    if (!isFieldGeometry(target) || target.electricField.component !== undefined) invalid("field", "field must reference consistent resultant electric_field geometry");
    const field = target.electricField;
    return [fieldMark(field, "x"), fieldMark(field, "y")];
  }
  return invalid("operator", `unsupported field operator ${operator}`);
}

function compactNumber(value: number): string {
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  return magnitude >= 0.001 && magnitude < 10000 ? Number(value.toPrecision(3)).toString() : value.toExponential(1);
}
/** The compiler owns these labels; model-supplied numerical result labels cannot pair with verified ink. */
export function fieldConstructionOutputLabels(operator: string, outputs: readonly unknown[]): string[] {
  if (operator !== "electric_field" && operator !== "field_components" || outputs.length !== (operator === "electric_field" ? 1 : 2)) invalid("outputs", "field result labels require the operator's complete evaluated outputs");
  return outputs.map((output, index) => {
    if (!isFieldGeometry(output)) invalid("outputs", "field result label metadata or geometry is malformed or inconsistent");
    const field = output.electricField;
    const axis = operator === "field_components" ? index === 0 ? "x" : "y" : null;
    if (field.component !== (axis ?? undefined)) invalid("outputs", "field output components must retain their x/y identity");
    const symbol = axis ? `E${axis}` : "E";
    const value = axis ? field.components[axis] : field.magnitude;
    return field.mode === "si" ? `${symbol}=${compactNumber(value)} N/C` : value === 0 ? `${symbol}=0 schematic` : `${symbol} schematic`;
  });
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
function signedChargeSymbol(text: unknown): 1 | -1 | null {
  if (typeof text !== "string") return null;
  const label = text.trim();
  const sign = label[0] === "+" ? 1 : label[0] === "-" || label[0] === "−" ? -1 : null;
  if (sign === null) return null;
  const symbol = label.slice(1).trim();
  if (symbol[0]?.toLowerCase() !== "q") return null;
  // A charge variable may carry a numerical/letter subscript; no natural-language parsing.
  return [...symbol.slice(1)].every((character) => character === "_" || character >= "0" && character <= "9" || character >= "a" && character <= "z" || character >= "A" && character <= "Z") ? sign : null;
}
function sourceQuantityId(value: unknown, document: SceneDocument, depth = 0): string | undefined {
  if (depth > MAX_SCALAR_DEPTH) return undefined;
  if (isRecord(value)) return sourceQuantityId(value.value, document, depth + 1);
  return typeof value === "string" && document.quantities.some((quantity) => quantity.id === value) ? value : undefined;
}
function checkSourceChargeLabels(inputs: Record<string, unknown>, document: SceneDocument): void {
  if (!Array.isArray(inputs.charges)) return;
  for (const [index, source] of inputs.charges.entries()) {
    if (!isRecord(source) || typeof source.position !== "string") continue;
    const entity = document.entities.find((candidate) => candidate.id === source.position);
    const charge = validationNumber(source.charge, document);
    const checkSign = (text: unknown): void => {
      const sign = signedChargeSymbol(text);
      if (sign !== null && Math.sign(charge) !== sign) invalid(`charges[${index}].label`, "an explicit source charge sign label contradicts the supplied charge");
    };
    checkSign(entity?.label);
    for (const annotation of document.annotations) {
      if (!annotation.targetIds.includes(source.position)) continue;
      checkSign(annotation.text);
      if (typeof annotation.quantityId !== "string") continue;
      const signedSymbol = signedChargeSymbol(annotation.text);
      const units = scalarUnits(annotation.quantityId, `charges[${index}].annotation`, document);
      const clearlyCharge = units.some((unit) => CHARGE_UNITS.has(unit)) || signedSymbol !== null;
      if (!clearlyCharge) continue;
      for (const unit of units) if (CHARGE_UNITS.has(unit) && (typeof inputs.chargeUnit !== "string" || CHARGE_UNITS.get(unit) !== CHARGE_UNITS.get(inputs.chargeUnit.trim()))) invalid(`charges[${index}].annotation`, "a source charge annotation uses a different declared charge scale");
      const expectedId = sourceQuantityId(source.charge, document);
      if (expectedId !== undefined ? annotation.quantityId !== expectedId : validationNumber(annotation.quantityId, document) !== charge) invalid(`charges[${index}].annotation`, "a source charge annotation is bound to a different supplied charge quantity");
    }
  }
}
class DeferredFieldPoint extends FieldInputError {
  constructor() { super("point", "derived point coordinates will be verified during compilation"); }
}

/** Rechecks result labels against actual compiled geometry, including derived source points. */
export function validateEvaluatedFieldLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  const add = (message: string, actual?: unknown): void => {
    issues.push({ code: `invalid_${construction.operator}_label`, severity: "fatal", message, path: `constructions[${index}].outputs`, actual });
  };
  try {
    if (construction.operator === "electric_field") checkSourceChargeLabels(construction.inputs, document);
    const labels = fieldConstructionOutputLabels(construction.operator, outputs);
    for (const [outputIndex, output] of construction.outputs.entries()) {
      const label = labels[outputIndex];
      const entity = document.entities.find((candidate) => candidate.id === output);
      if (entity?.label !== undefined && entity.label !== label) add(`field output labels are computed by the engine; expected ${label}`, entity.label);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(output)) continue;
        if (annotation.quantityId !== undefined || annotation.text !== undefined && annotation.text !== label) add("field output annotations cannot supply independent numerical or textual results", annotation);
      }
    }
  } catch (error) { add(error instanceof Error ? error.message : "field result labels are invalid"); }
}

/** Validates the same authority contract before any partial construction can render. */
export function validateFieldConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const { operator, inputs } = construction;
  const add = (key: string, message: string, actual?: unknown): void => {
    issues.push({ code: `invalid_${operator}_${key}`, severity: "fatal", message, path: `constructions[${index}].${key === "outputs" || key === "output_kind" || key === "label" ? "outputs" : `inputs.${key}`}`, actual });
  };
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const count = operator === "field_components" ? 2 : 1;
  if (outputs.length !== count || outputs.some((output) => typeof output !== "string" || !output.trim()) || new Set(outputs).size !== count) add("outputs", `${operator} requires exactly ${count} distinct output entities`, construction.outputs);
  for (const output of outputs) {
    const entity = document.entities.find((candidate) => candidate.id === output);
    if (!entity || entity.kind !== "vector") add("output_kind", `${operator} outputs must be vector entities`, entity?.kind);
  }
  if (!isRecord(inputs)) { add("fields", "field construction inputs must be an object"); return; }
  const context: FieldEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      if (typeof value !== "string") return pointValue(value, "point", context);
      const producer = constructionByOutput.get(value);
      const entity = document.entities.find((candidate) => candidate.id === value);
      if (!producer || entity?.kind !== "point") invalid("point", "field source and observation references must name constructed point entities");
      if (producer.operator !== "point") throw new DeferredFieldPoint();
      return { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) };
    },
    geometry(value) {
      const producer = typeof value === "string" ? constructionByOutput.get(value) : undefined;
      if (producer?.operator !== "electric_field") return undefined;
      checkSourceUnits(producer.inputs, document, constructionByOutput);
      return evaluateFieldConstruction(producer.operator, producer.inputs, context)[0];
    },
  };
  try {
    const producer = operator === "electric_field" ? construction : typeof inputs.field === "string" ? constructionByOutput.get(inputs.field) : undefined;
    if (producer?.operator !== "electric_field") invalid("field", "field_components must reference an electric_field construction");
    checkSourceUnits(producer.inputs, document, constructionByOutput);
    const parameters = fieldParameters(producer.inputs, context);
    checkSourceChargeLabels(producer.inputs, document);
    const validatePoint = (value: unknown, key: string): void => {
      if (typeof value !== "string") { pointValue(value, key, context); return; }
      const source = constructionByOutput.get(value);
      if (!source || document.entities.find((entity) => entity.id === value)?.kind !== "point") invalid(key, `${key} must reference a constructed point entity`);
      if (source.operator === "point") finitePoint({ x: validationNumber(source.inputs.x, document), y: validationNumber(source.inputs.y, document) }, key);
    };
    validatePoint(producer.inputs.at, "at");
    parameters.charges.forEach((item, chargeIndex) => validatePoint(item.position, `charges[${chargeIndex}].position`));
    if (operator === "field_components") inputKeys(inputs, ["field"]);
    const evaluated = evaluateFieldConstruction(operator, inputs, context);
    validateEvaluatedFieldLabels(construction, index, document, evaluated, issues);
  } catch (error) {
    if (error instanceof DeferredFieldPoint) return;
    add(error instanceof FieldInputError ? error.key : "fields", error instanceof Error ? error.message : "field inputs are invalid");
  }
}
