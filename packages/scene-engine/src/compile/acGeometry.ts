import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const AC_OPERATORS = ["impedance", "impedance_combine", "phasor_response"] as const;
export type AcOperator = (typeof AC_OPERATORS)[number];
export interface AcComplex { real: number; imaginary: number }
export interface AcImpedanceDefinition {
  components: AcComplex;
  unit: "ohm";
  angularFrequency: number;
  sourceFrequency: { value: number; unit: "Hz" | "rad/s" };
  sourceKind: "resistor" | "inductor" | "capacitor" | "series" | "parallel";
  sourceIds: string[];
  origin: RenderPoint;
  displayScale: number;
  magnitude: number;
  phaseRad: number | null;
  zero: boolean;
}
export interface AcResponseDefinition {
  voltage: AcComplex;
  current: AcComplex;
  complexPower: AcComplex;
  realPower: number;
  reactivePower: number;
  powerFactor: number | null;
  convention: "rms";
}
export interface AcPhasorDefinition {
  quantity: "voltage" | "current";
  components: AcComplex;
  unit: "V" | "A";
  angularFrequency: number;
  origin: RenderPoint;
  displayScale: number;
  magnitude: number;
  phaseRad: number | null;
  zero: boolean;
  response: AcResponseDefinition;
}
export type AcGeometry =
  | { kind: "point"; point: RenderPoint; acImpedance?: AcImpedanceDefinition; acPhasor?: AcPhasorDefinition }
  | { kind: "path"; points: RenderPoint[]; directed: true; acImpedance?: AcImpedanceDefinition; acPhasor?: AcPhasorDefinition };
export interface AcEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
const MAX_VALUE = 1e12;
const MAX_SOURCES = 32;
const MIN_LENGTH = 1e-6;
const RELATIVE_ERROR = 64 * Number.EPSILON;
const INPUT_KEYS = {
  impedance: ["kind", "value", "unit", "frequency", "frequencyUnit", "displayScale", "origin"],
  impedance_combine: ["sources", "mode", "displayScale", "origin"],
  phasor_response: ["voltage", "voltageUnit", "convention", "impedance", "voltageScale", "currentScale", "origin"],
} as const;
class AcInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new AcInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isOperator(operator: string): operator is AcOperator { return (AC_OPERATORS as readonly string[]).includes(operator); }
function inputKeys(inputs: Record<string, unknown>, allowed: readonly string[], key = "input"): void {
  for (const name of Object.keys(inputs)) if (!allowed.includes(name)) invalid(key, `AC construction does not accept ${name}`);
}
function scalar(value: unknown, key: string, context: AcEvaluationContext, positive = false, depth = 0): number {
  if (depth > 32) invalid(key, "AC numeric wrappers exceed depth 32");
  if (isRecord(value)) {
    inputKeys(value, ["value", "unit"], key);
    return scalar(value.value, key, context, positive, depth + 1);
  }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, `${key} requires a finite numeric literal or quantity reference`);
  try {
    const result = context.number(value);
    if (!Number.isFinite(result) || Math.abs(result) > MAX_VALUE || positive && !(result > 0)) invalid(key, `${key} must be finite${positive ? " and positive" : ""} with magnitude no greater than ${MAX_VALUE}`);
    return result === 0 ? 0 : result;
  } catch (error) {
    if (error instanceof AcInputError) throw error;
    return invalid(key, `${key} must resolve to a finite number`);
  }
}
function checkedComplex(value: AcComplex, key: string): AcComplex {
  if (![value.real, value.imaginary, Math.hypot(value.real, value.imaginary)].every((component) => Number.isFinite(component) && Math.abs(component) <= MAX_VALUE)) invalid(key, `${key} complex value exceeds finite physical bounds`);
  return { real: value.real === 0 ? 0 : value.real, imaginary: value.imaginary === 0 ? 0 : value.imaginary };
}
function checkedProduct(a: number, b: number, key: string): number {
  const result = a * b;
  if (!Number.isFinite(result) || a !== 0 && b !== 0 && result === 0) invalid(key, `${key} has a nonzero product that overflows or underflows numeric authority`);
  return result === 0 ? 0 : result;
}
function originInput(value: unknown, context: AcEvaluationContext): RenderPoint {
  if (value === undefined) return { x: 0, y: 0 };
  if (isRecord(value)) inputKeys(value, ["x", "y"], "origin");
  if (!(Array.isArray(value) && value.length === 2) && !(isRecord(value) && "x" in value && "y" in value)) invalid("origin", "origin must be an explicit 2D display point");
  let point: RenderPoint;
  try { point = context.point(value); }
  catch { return invalid("origin", "origin must be a finite inline display point"); }
  if (![point.x, point.y].every((component) => Number.isFinite(component) && Math.abs(component) <= MAX_VALUE)) invalid("origin", "origin coordinates exceed finite display bounds");
  return { x: point.x, y: point.y };
}
function renderedVector(components: AcComplex, origin: RenderPoint, scale: number, metadata: Pick<AcGeometry, "acImpedance" | "acPhasor">): AcGeometry {
  if (components.real === 0 && components.imaginary === 0) return { kind: "point", point: { ...origin }, ...metadata };
  const displacement = { x: checkedProduct(components.real, scale, "displayScale"), y: checkedProduct(components.imaginary, scale, "displayScale") };
  const tip = { x: origin.x + displacement.x, y: origin.y + displacement.y };
  if (![tip.x, tip.y].every((component) => Number.isFinite(component) && Math.abs(component) <= MAX_VALUE) || Math.hypot(displacement.x, displacement.y) <= MIN_LENGTH) invalid("displayScale", "nonzero AC vector must remain finite and distinguishable at display precision");
  for (const axis of ["x", "y"] as const) if (displacement[axis] !== 0 && Math.abs((tip[axis] - origin[axis]) - displacement[axis]) > Math.abs(displacement[axis]) * 1e-8) invalid("precision", "display placement cannot preserve the physical vector components at numeric precision");
  return { kind: "path", points: [{ ...origin }, tip], directed: true, ...metadata };
}
function impedanceOutput(components: AcComplex, definition: Omit<AcImpedanceDefinition, "components" | "magnitude" | "phaseRad" | "zero">): AcGeometry {
  const physical = checkedComplex(components, "impedance");
  const zero = physical.real === 0 && physical.imaginary === 0;
  const acImpedance: AcImpedanceDefinition = { ...definition, components: physical, magnitude: Math.hypot(physical.real, physical.imaginary), phaseRad: zero ? null : Math.atan2(physical.imaginary, physical.real), zero };
  return renderedVector(physical, definition.origin, definition.displayScale, { acImpedance });
}

/** SI complex authority is independent of display scale and complex-plane placement. */
export function evaluateAcConstruction(operator: string, inputs: Record<string, unknown>, context: AcEvaluationContext): AcGeometry[] {
  if (!isOperator(operator)) invalid("operator", `unsupported AC operator ${operator}`);
  inputKeys(inputs, INPUT_KEYS[operator]);
  if (operator === "impedance") {
    if (inputs.kind !== "resistor" && inputs.kind !== "inductor" && inputs.kind !== "capacitor") invalid("kind", "impedance requires resistor, inductor, or capacitor kind");
    const requiredUnit = inputs.kind === "resistor" ? "ohm" : inputs.kind === "inductor" ? "H" : "F";
    if (canonicalUnit(inputs.unit) !== requiredUnit) invalid("unit", `${inputs.kind} value must declare SI ${requiredUnit}`);
    const frequencyUnit = canonicalUnit(inputs.frequencyUnit);
    if (frequencyUnit !== "Hz" && frequencyUnit !== "rad/s") invalid("frequencyUnit", "frequencyUnit must declare Hz or rad/s");
    const frequency = scalar(inputs.frequency, "frequency", context, true);
    const angularFrequency = frequencyUnit === "Hz" ? checkedProduct(2 * Math.PI, frequency, "frequency") : frequency;
    if (!Number.isFinite(angularFrequency) || angularFrequency > MAX_VALUE) invalid("frequency", "normalized angular frequency exceeds finite bounds");
    const value = scalar(inputs.value, "value", context);
    if (value < 0 || inputs.kind === "capacitor" && !(value > 0)) invalid("value", "component value must be nonnegative; capacitance must be strictly positive");
    checkUnit(inputs.value, "value", requiredUnit);
    checkUnit(inputs.frequency, "frequency", frequencyUnit);
    checkUnit(inputs.displayScale, "displayScale", "scalar");
    const reactiveProduct = inputs.kind === "resistor" ? 0 : checkedProduct(angularFrequency, value, "reactance");
    const components = inputs.kind === "resistor" ? { real: value, imaginary: 0 } : { real: 0, imaginary: inputs.kind === "inductor" ? reactiveProduct : checkedQuotient(-1, reactiveProduct, "reactance") };
    return [impedanceOutput(components, { unit: "ohm", angularFrequency, sourceFrequency: { value: frequency, unit: frequencyUnit }, sourceKind: inputs.kind, sourceIds: [], origin: originInput(inputs.origin, context), displayScale: scalar(inputs.displayScale, "displayScale", context, true) })];
  }
  if (operator === "impedance_combine") {
    if (inputs.mode !== "series" && inputs.mode !== "parallel") invalid("mode", "impedance_combine requires explicit series or parallel mode");
    if (!Array.isArray(inputs.sources) || inputs.sources.length < 1 || inputs.sources.length > MAX_SOURCES || inputs.sources.some((id) => typeof id !== "string") || new Set(inputs.sources).size !== inputs.sources.length) invalid("sources", `sources must contain 1 to ${MAX_SOURCES} distinct computed impedance ids`);
    const sources = inputs.sources.map((id) => impedanceReference(id, context));
    const first = sources[0]!;
    if (sources.some((source) => source.angularFrequency !== first.angularFrequency)) invalid("frequency", "impedances must describe the same normalized source frequency");
    const terms = inputs.mode === "series" ? sources.map((source) => source.components) : sources.map((source) => divide({ real: 1, imaginary: 0 }, source.components, "admittance"));
    const sum = { real: accurateSum(terms.map((term) => term.real)), imaginary: accurateSum(terms.map((term) => term.imaginary)) };
    const components = inputs.mode === "series" ? sum : divide({ real: 1, imaginary: 0 }, sum, "admittance");
    checkUnit(inputs.displayScale, "displayScale", "scalar");
    return [impedanceOutput(components, { unit: "ohm", angularFrequency: first.angularFrequency, sourceFrequency: { ...first.sourceFrequency }, sourceKind: inputs.mode, sourceIds: [...inputs.sources], origin: originInput(inputs.origin, context), displayScale: scalar(inputs.displayScale, "displayScale", context, true) })];
  }
  if (!isRecord(inputs.voltage)) invalid("voltage", "voltage requires explicit real and imaginary RMS components");
  inputKeys(inputs.voltage, ["real", "imaginary"], "voltage");
  if (canonicalUnit(inputs.voltageUnit) !== "V") invalid("voltageUnit", "voltageUnit must declare SI V");
  if (inputs.convention !== "rms") invalid("convention", "phasor_response requires explicit rms convention");
  const voltage = checkedComplex({ real: scalar(inputs.voltage.real, "voltage.real", context), imaginary: scalar(inputs.voltage.imaginary, "voltage.imaginary", context) }, "voltage");
  checkUnit(inputs.voltage.real, "voltage.real", "V"); checkUnit(inputs.voltage.imaginary, "voltage.imaginary", "V");
  const impedance = impedanceReference(inputs.impedance, context);
  const current = divide(voltage, impedance.components, "impedance");
  const currentSquared = current.real * current.real + current.imaginary * current.imaginary;
  if (!Number.isFinite(currentSquared) || currentSquared === 0 && (current.real !== 0 || current.imaginary !== 0)) invalid("power", "nonzero current magnitude squared overflows or underflows numeric authority");
  // Since I=V/Z, V*conj(I)=|I|²Z. This equivalent form preserves exact
  // zero reactive/active components under rotations without cancellation.
  const complexPower = checkedComplex({ real: checkedProduct(currentSquared, impedance.components.real, "power"), imaginary: checkedProduct(currentSquared, impedance.components.imaginary, "power") }, "power");
  const apparentPower = Math.hypot(complexPower.real, complexPower.imaginary);
  const response: AcResponseDefinition = { voltage, current, complexPower, realPower: complexPower.real, reactivePower: complexPower.imaginary, powerFactor: apparentPower === 0 ? null : complexPower.real / apparentPower, convention: "rms" };
  const origin = originInput(inputs.origin, context);
  return (["voltage", "current"] as const).map((quantity) => {
    const key = quantity === "voltage" ? "voltageScale" : "currentScale";
    const components = quantity === "voltage" ? voltage : current;
    const displayScale = scalar(inputs[key], key, context, true);
    checkUnit(inputs[key], key, "scalar");
    const zero = components.real === 0 && components.imaginary === 0;
    const acPhasor: AcPhasorDefinition = { quantity, components, unit: quantity === "voltage" ? "V" : "A", angularFrequency: impedance.angularFrequency, origin: { ...origin }, displayScale, magnitude: Math.hypot(components.real, components.imaginary), phaseRad: zero ? null : Math.atan2(components.imaginary, components.real), zero, response };
    return renderedVector(components, origin, displayScale, { acPhasor });
  });
}
function labelValue(geometry: unknown): { symbol: string; magnitude: number; unit: string } | null {
  if (!isRecord(geometry)) return null;
  if (isRecord(geometry.acImpedance) && typeof geometry.acImpedance.magnitude === "number") return { symbol: "Z", magnitude: geometry.acImpedance.magnitude, unit: "ohm" };
  if (isRecord(geometry.acPhasor) && typeof geometry.acPhasor.magnitude === "number") return { symbol: geometry.acPhasor.quantity === "voltage" ? "V" : "I", magnitude: geometry.acPhasor.magnitude, unit: String(geometry.acPhasor.unit) };
  return null;
}
/** These are magnitude labels: a complex phasor never becomes a scalar claim. */
export function acGeometryLabel(geometry: unknown): string | null {
  const value = labelValue(geometry);
  if (!value) return null;
  const label = `|${value.symbol}|=${Number(value.magnitude.toPrecision(3))} ${value.unit === "ohm" ? "Ω" : value.unit}`;
  return label.length <= 16 ? label : value.symbol;
}
export function validateAcDerivedLabel(label: unknown, geometry: unknown): void {
  if (label === undefined) return;
  const value = labelValue(geometry);
  if (!value || typeof label !== "string" || label !== value.symbol && label !== acGeometryLabel(geometry)) invalid("label", "AC value labels must use the computed magnitude label or its quantity symbol");
}
/** Runtime guards use actual evaluated geometry before any values or labels commit. */
export function validateEvaluatedAcLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  if (!isOperator(construction.operator)) return;
  const add = (message: string, actual?: unknown): void => { issues.push({ code: `invalid_${construction.operator}_label`, severity: "fatal", message, path: `constructions[${index}].outputs`, actual }); };
  for (const [outputIndex, id] of (Array.isArray(construction.outputs) ? construction.outputs : []).entries()) {
    const geometry = outputs[outputIndex];
    const expected = labelValue(geometry);
    if (!expected) { add("AC output has no computed quantity identity"); continue; }
    try {
      validateAcDerivedLabel(document.entities.find((entity) => entity.id === id)?.label, geometry);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(id) || annotation.kind !== "label" && annotation.kind !== "callout") continue;
        validateAcDerivedLabel(annotation.text, geometry);
        if (annotation.quantityId !== undefined) {
          const units = sourceUnits(annotation.quantityId, document);
          if (!units.length || units.some((unit) => canonicalUnit(unit) !== expected.unit)) invalid("label", "AC magnitude annotation must use the computed quantity's SI unit");
          const value = validationNumber(annotation.quantityId, document);
          if (Math.abs(value - expected.magnitude) > RELATIVE_ERROR * expected.magnitude) invalid("label", "AC annotation magnitude contradicts the evaluated physical value");
        }
      }
      for (const labelConstruction of document.constructions) {
        if (labelConstruction.operator === "label" && (labelConstruction.inputs.target ?? labelConstruction.inputs.at ?? labelConstruction.inputs.point) === id) validateAcDerivedLabel(labelConstruction.inputs.text, geometry);
      }
    } catch (error) { add(error instanceof Error ? error.message : "AC result label is invalid"); }
  }
}
export function validateAcConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const { operator, inputs } = construction;
  if (!isOperator(operator)) return;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const add = (key: string, message: string, actual?: unknown): void => { issues.push({ code: `invalid_${operator}_${key}`, severity: "fatal", message,
    path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`, entityIds: outputs, actual }); };
  const count = operator === "phasor_response" ? 2 : 1;
  if (outputs.length !== count || outputs.some((id) => typeof id !== "string" || !id.trim()) || new Set(outputs).size !== outputs.length) add("outputs", `${operator} requires exactly ${count} distinct outputs`, construction.outputs);
  for (const id of outputs) if (document.entities.find((entity) => entity.id === id)?.kind !== "vector") add("output_kind", "AC outputs must be vector entities (zero values render as markers)", id);
  if (!isRecord(inputs)) { add("inputs", "AC inputs must be an object"); return; }
  const resolving = new Set<string>();
  const cache = new Map<string, AcGeometry>();
  const context: AcEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      if (Array.isArray(value) && value.length === 2 && value.every((coordinate) => typeof coordinate === "number")) return { x: value[0] as number, y: value[1] as number };
      if (isRecord(value) && typeof value.x === "number" && typeof value.y === "number") return { x: value.x, y: value.y };
      throw new Error("invalid display point");
    },
    geometry(value) {
      if (typeof value !== "string") invalid("impedance", "impedance must reference a computed source");
      const cached = cache.get(value); if (cached) return cached;
      const producer = constructionByOutput.get(value);
      if (!producer || !["impedance", "impedance_combine"].includes(producer.operator) || document.entities.find((entity) => entity.id === value)?.kind !== "vector") invalid("impedance", "reference must name a computed impedance vector");
      if (resolving.has(value) || resolving.size >= MAX_SOURCES) invalid("sources", "impedance source chain is cyclic or exceeds its depth cap");
      resolving.add(value);
      try {
        checkConstructionUnits(producer.operator, producer.inputs, document);
        const geometry = evaluateAcConstruction(producer.operator, producer.inputs, context)[0]!;
        cache.set(value, geometry);
        return geometry;
      } finally { resolving.delete(value); }
    },
  };
  try {
    checkConstructionUnits(operator, inputs, document);
    const evaluated = evaluateAcConstruction(operator, inputs, context);
    validateEvaluatedAcLabels(construction, index, document, evaluated, issues);
  } catch (error) { add(error instanceof AcInputError ? error.key : "inputs", error instanceof Error ? error.message : "invalid AC input"); }
}

type ExactBinary = { significand: bigint; exponent: number };
const binaryBits = new DataView(new ArrayBuffer(8));
function exactBinary(value: number): ExactBinary {
  if (value === 0) return { significand: 0n, exponent: 0 };
  binaryBits.setFloat64(0, value);
  const bits = binaryBits.getBigUint64(0); const exponent = Number((bits >> 52n) & 2047n);
  const magnitude = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  return { significand: bits >> 63n ? -magnitude : magnitude, exponent: exponent ? exponent - 1075 : -1074 };
}
function exactZero(terms: readonly ExactBinary[]): boolean {
  const exponent = Math.min(...terms.map((term) => term.exponent));
  return terms.reduce((sum, term) => sum + (term.significand << BigInt(term.exponent - exponent)), 0n) === 0n;
}
function exactProduct(a: number, b: number): ExactBinary {
  const left = exactBinary(a); const right = exactBinary(b);
  return { significand: left.significand * right.significand, exponent: left.exponent + right.exponent };
}
function accurateSum(values: number[]): number {
  // Floating cancellation is zero only when the supplied binary values sum
  // exactly to zero. Compensation alone can lose a third, smaller remainder.
  if (exactZero(values.map(exactBinary))) return 0;
  let sum = 0; let compensation = 0; let absolute = 0;
  for (const value of values) {
    const next = sum + value;
    compensation += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next; absolute += Math.abs(value);
  }
  const result = sum + compensation;
  if (!Number.isFinite(result) || result === 0 || Math.abs(result) <= RELATIVE_ERROR * absolute) invalid("precision", "nonzero complex source sum is unresolved within numeric cancellation");
  return result;
}
function checkedQuotient(a: number, b: number, key: string): number {
  const result = a / b;
  if (!Number.isFinite(result) || a !== 0 && result === 0) invalid(key, `${key} has a nonzero quotient that overflows or underflows numeric authority`);
  return result === 0 ? 0 : result;
}
function divide(a: AcComplex, b: AcComplex, key: string): AcComplex {
  const scale = Math.max(Math.abs(b.real), Math.abs(b.imaginary));
  if (!(scale > 0) || !Number.isFinite(scale)) invalid(key, `${key} is singular; no finite complex result exists`);
  if (a.real === 0 && a.imaginary === 0) return { real: 0, imaginary: 0 };
  const real = checkedQuotient(b.real, scale, key); const imaginary = checkedQuotient(b.imaginary, scale, key);
  const denominator = real * real + imaginary * imaginary;
  const coordinate = (first: number, second: number, originalFirst: number, originalSecond: number): number => {
    if (exactZero([exactProduct(first, originalFirst), exactProduct(second, originalSecond)])) return 0;
    const normalized = accurateSum([checkedProduct(first, originalFirst / scale, key), checkedProduct(second, originalSecond / scale, key)]);
    if (normalized === 0) invalid(key, `${key} rounded a nonzero complex numerator to zero`);
    return checkedQuotient(checkedQuotient(normalized, denominator, key), scale, key);
  };
  return checkedComplex({ real: coordinate(a.real, a.imaginary, b.real, b.imaginary), imaginary: coordinate(a.imaginary, -a.real, b.real, b.imaginary) }, key);
}
function impedanceReference(value: unknown, context: AcEvaluationContext): AcImpedanceDefinition {
  if (typeof value !== "string" || !value.trim()) invalid("impedance", "requires a computed impedance reference");
  let geometry: unknown;
  try { geometry = context.geometry(value); } catch { return invalid("impedance", "requires a computed impedance reference"); }
  if (!isRecord(geometry) || !["path", "point"].includes(String(geometry.kind)) || !isRecord(geometry.acImpedance)) invalid("impedance", "reference does not carry physical complex impedance authority");
  const definition = geometry.acImpedance;
  if (!isRecord(definition.components) || typeof definition.components.real !== "number" || typeof definition.components.imaginary !== "number" || definition.unit !== "ohm" || typeof definition.angularFrequency !== "number" || !(definition.angularFrequency > 0) || definition.angularFrequency > MAX_VALUE || !isRecord(definition.sourceFrequency) || typeof definition.sourceFrequency.value !== "number" || !(definition.sourceFrequency.value > 0) || !["Hz", "rad/s"].includes(String(definition.sourceFrequency.unit))) invalid("impedance", "computed impedance metadata is incomplete");
  checkedComplex({ real: definition.components.real, imaginary: definition.components.imaginary }, "impedance");
  const normalized = definition.sourceFrequency.unit === "Hz" ? 2 * Math.PI * definition.sourceFrequency.value : definition.sourceFrequency.value;
  if (normalized !== definition.angularFrequency) invalid("frequency", "impedance source frequency contradicts normalized angular frequency");
  return definition as unknown as AcImpedanceDefinition;
}

function canonicalUnit(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  return UNIT_ALIASES.get(token) ?? UNIT_ALIASES.get(token.replace(/[A-Za-z]+/g, (word) => word.length >= 4 || ["ohm", "amp"].includes(word.toLowerCase()) ? word.toLowerCase() : word));
}
const UNIT_ALIASES = new Map([
  ["ohm", "ohm,ohms,Ω"], ["H", "H,henry,henries"], ["F", "F,farad,farads"],
  ["Hz", "Hz,hertz"], ["rad/s", "rad/s,radian/second,radians/second"], ["V", "V,volt,volts"], ["A", "A,amp,amps,ampere,amperes"],
  ["scalar", "1,unit,units,dimensionless"],
].flatMap(([canonical, aliases]) => aliases!.split(",").map((alias) => [alias, canonical!] as const)));
function sourceUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) return [];
  seen.add(value);
  const record = typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : isRecord(value) ? value : undefined;
  if (!record) return [];
  if (record.unit !== undefined && (typeof record.unit !== "string" || !record.unit.trim())) invalid("units", "known AC source units must be nonempty strings");
  const units = typeof record.unit === "string" && record.unit.trim() ? [record.unit] : [];
  return "value" in record ? [...units, ...sourceUnits(record.value, document, seen, depth + 1)] : units;
}
function checkUnit(value: unknown, key: string, unit: string, document?: SceneDocument): void {
  for (const actual of sourceUnits(value, document)) if (canonicalUnit(actual) !== unit) invalid("units", `${key} source unit ${actual} must use declared SI ${unit}; source quantities are not automatically converted`);
}
function checkConstructionUnits(operator: string, inputs: Record<string, unknown>, document: SceneDocument): void {
  if (operator === "impedance") {
    const unit = canonicalUnit(inputs.unit); const frequencyUnit = canonicalUnit(inputs.frequencyUnit);
    if (unit) checkUnit(inputs.value, "value", unit, document);
    if (frequencyUnit) checkUnit(inputs.frequency, "frequency", frequencyUnit, document);
  }
  if (operator === "phasor_response") {
    if (isRecord(inputs.voltage)) for (const key of ["real", "imaginary"]) checkUnit(inputs.voltage[key], `voltage.${key}`, "V", document);
    for (const key of ["voltageScale", "currentScale"]) checkUnit(inputs[key], key, "scalar", document);
  } else checkUnit(inputs.displayScale, "displayScale", "scalar", document);
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("quantity", "cyclic or overdeep AC numeric source");
  if (typeof value === "number" && Number.isFinite(value)) return value;
  seen.add(value);
  if (isRecord(value) && "value" in value) return validationNumber(value.value, document, seen, depth + 1);
  if (typeof value === "string" && value.trim()) {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) return validationNumber(quantity.value, document, seen, depth + 1);
    const number = Number(value); if (Number.isFinite(number)) return number;
  }
  return invalid("quantity", "AC numeric input must resolve to a finite source value");
}
