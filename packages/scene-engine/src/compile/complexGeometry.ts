import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
export const COMPLEX_OPERATORS = ["complex_point", "complex_transform", "complex_roots"] as const;
export interface ComplexNumberDefinition {
  real: number; imaginary: number; magnitude: number; argument: number | null;
  origin: RenderPoint; displayScale: number; operation: "point" | "transform" | "root";
  unit: "1"; accuracy: "binary_exact" | "analytic_certified";
  exactComponents: { real: { numerator: string; denominator: string }; imaginary: { numerator: string; denominator: string } };
  sourceId?: string; degree?: number; rootIndex?: number;
}
export interface ComplexEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
export type ComplexGeometry = { kind: "point"; point: RenderPoint; complexNumber: ComplexNumberDefinition };
const INPUT_KEYS: Readonly<Record<string, readonly string[]>> = { complex_point: ["real", "imaginary", "origin", "displayScale"], complex_transform: ["source", "multiplier", "addend", "origin", "displayScale"], complex_roots: ["source", "degree", "origin", "displayScale"] };
const MAX_VALUE = 1e12;
const MAX_BITS = 8192;
const ERROR = 64 * Number.EPSILON;
const ROOT_ERROR = 1e-10;
type Rational = { n: bigint; d: bigint };
class ComplexInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
class DeferredComplexGeometry extends Error {}
function fail(key: string, message: string): never { throw new ComplexInputError(key, message); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void { for (const name of Object.keys(value)) if (!allowed.includes(name)) fail(key, `complex construction does not accept ${name}`); }
function bounded(value: number, key: string): number { if (!Number.isFinite(value) || Math.abs(value) > MAX_VALUE) fail(key, `${key} must remain finite with magnitude no greater than ${MAX_VALUE}`); return value === 0 ? 0 : value; }
function preserveLiteral(value: unknown, key: string): void {
  if (typeof value !== "string") return;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:e[+-]?\d+)?$/i.exec(value.trim());
  if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) fail(key, "nonzero complex numeric literals cannot underflow to certified zero");
}
const SCALAR_UNITS = new Set(["1", "unit", "units", "unitless", "dimensionless", "scalar"]);
function checkUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): void {
  if (depth > 32 || seen.has(value)) fail("units", "complex source quantity is cyclic or exceeds depth32");
  const quantity = typeof value === "string" ? document?.quantities.find((candidate) => candidate.id === value) : record(value) ? value : undefined;
  if (!quantity) return;
  seen.add(value);
  if (quantity.unit !== undefined && (typeof quantity.unit !== "string" || !SCALAR_UNITS.has(quantity.unit.trim().toLowerCase()))) fail("units", "complex components and display values must be dimensionless, never physical measurements");
  if ("value" in quantity) checkUnits(quantity.value, document, seen, depth + 1);
}
function number(value: unknown, key: string, context: ComplexEvaluationContext, depth = 0): number {
  if (depth > 32) fail(key, "complex numeric wrappers exceed depth32");
  if (record(value)) { keys(value, ["value", "unit"], key); checkUnits(value); return number(value.value, key, context, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) fail(key, `${key} must be a finite literal or numeric quantity reference`);
  preserveLiteral(value, key);
  try { return bounded(context.number(value), key); } catch (error) { if (error instanceof ComplexInputError) throw error; return fail(key, `${key} must resolve to a finite number`); }
}
function components(value: unknown, key: string, context: ComplexEvaluationContext): { real: number; imaginary: number } {
  if (!record(value)) fail(key, `${key} must declare real and imaginary components`); keys(value, ["real", "imaginary"], key);
  return { real: number(value.real, `${key}.real`, context), imaginary: number(value.imaginary, `${key}.imaginary`, context) };
}
function origin(value: unknown, context: ComplexEvaluationContext): RenderPoint {
  if (value === undefined) return { x: 0, y: 0 };
  if (typeof value === "string") {
    const geometry = context.geometry(value);
    if (!record(geometry) || geometry.kind !== "point" || Object.keys(geometry).some((name) => !["kind", "point", "complexNumber"].includes(name))) fail("origin", "complex origin must be an ordinary planar display point or computed complex point");
    if (geometry.complexNumber !== undefined) source(value, context);
  } else if (Array.isArray(value) && value.length === 2) return { x: number(value[0], "origin.x", context), y: number(value[1], "origin.y", context) };
  else if (record(value) && "x" in value && "y" in value) { keys(value, ["x", "y"], "origin"); return { x: number(value.x, "origin.x", context), y: number(value.y, "origin.y", context) }; }
  else fail("origin", "origin requires a planar point reference or two display coordinates");
  try { const point = context.point(value); return { x: bounded(point.x, "origin"), y: bounded(point.y, "origin") }; }
  catch (error) { if (error instanceof ComplexInputError || error instanceof DeferredComplexGeometry) throw error; return fail("origin", "origin must resolve to finite planar display coordinates"); }
}
function gcd(a: bigint, b: bigint): bigint { let x = a < 0n ? -a : a; let y = b; while (y) { const remainder = x % y; x = y; y = remainder; } return x; }
function rational(n: bigint, d: bigint): Rational {
  if (!(d > 0n)) fail("precision", "exact complex denominator must be positive");
  if (n === 0n) return { n: 0n, d: 1n }; const divisor = gcd(n, d); const result = { n: n / divisor, d: d / divisor };
  if ((result.n < 0n ? -result.n : result.n).toString(2).length > MAX_BITS || result.d.toString(2).length > MAX_BITS) fail("precision", "exact complex authority exceeds bounded bit capacity"); return result;
}
const bits = new DataView(new ArrayBuffer(8));
function exact(value: number): Rational {
  if (value === 0) return { n: 0n, d: 1n }; bits.setFloat64(0, value); const word = bits.getBigUint64(0); const exponent = Number((word >> 52n) & 2047n);
  const significand = (word & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n); const power = exponent ? exponent - 1075 : -1074; const n = word >> 63n ? -significand : significand;
  return power >= 0 ? rational(n << BigInt(power), 1n) : rational(n, 1n << BigInt(-power));
}
function add(a: Rational, b: Rational): Rational { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
function multiply(a: Rational, b: Rational): Rational { return rational(a.n * b.n, a.d * b.d); }
function negative(a: Rational): Rational { return { n: -a.n, d: a.d }; }
function exactPower(real: Rational, imaginary: Rational, degree: number): { real: Rational; imaginary: Rational } {
  let result = { real: exact(1), imaginary: exact(0) };
  for (let index = 0; index < degree; index++) result = { real: add(multiply(result.real, real), negative(multiply(result.imaginary, imaginary))), imaginary: add(multiply(result.real, imaginary), multiply(result.imaginary, real)) };
  return result;
}
function equalRational(a: Rational, b: Rational): boolean { return a.n === b.n && a.d === b.d; }
function numeric(value: Rational): number {
  if (value.n === 0n) return 0; const n = value.n < 0n ? -value.n : value.n; let exponent = n.toString(2).length - value.d.toString(2).length;
  if (exponent >= 0 ? n < value.d << BigInt(exponent) : n << BigInt(-exponent) < value.d) exponent--;
  const shift = exponent < -1022 ? 1074 : 52 - exponent; const numerator = shift >= 0 ? n << BigInt(shift) : n; const denominator = shift >= 0 ? value.d : value.d << BigInt(-shift);
  let mantissa = numerator / denominator; const remainder = numerator % denominator; if (2n * remainder > denominator || 2n * remainder === denominator && mantissa % 2n === 1n) mantissa++;
  const result = Number(mantissa) * 2 ** -shift * (value.n < 0n ? -1 : 1); if (result === 0) fail("precision", "nonzero exact complex component underflows numerical authority"); return bounded(result, "complex");
}
function serialized(value: Rational): { numerator: string; denominator: string } { return { numerator: value.n.toString(), denominator: value.d.toString() }; }
function deserialized(value: unknown): Rational {
  if (!record(value)) fail("source", "complex source must retain exact component authority"); keys(value, ["numerator", "denominator"], "source");
  const integer = (value: unknown): bigint => { if (typeof value !== "string" || value.length > 2500 || !/^-?(?:0|[1-9]\d*)$/.test(value)) fail("source", "complex exact component integer is malformed"); const result = BigInt(value); if (result.toString() !== value) fail("source", "complex exact component integer must be canonical"); return result; };
  const n = integer(value.numerator); const d = integer(value.denominator); const result = rational(n, d); if (result.n !== n || result.d !== d) fail("source", "complex exact components must remain reduced"); return result;
}
function display(real: number, imaginary: number, placement: RenderPoint, scale: number): RenderPoint {
  const x = real * scale; const y = imaginary * scale;
  if (real !== 0 && x === 0 || imaginary !== 0 && y === 0 || ![x, y].every(Number.isFinite)) fail("precision", "complex display scaling cannot erase nonzero components");
  const point = { x: bounded(placement.x + x, "display"), y: bounded(placement.y + y, "display") };
  for (const axis of ["x", "y"] as const) { const delta = axis === "x" ? x : y; if (delta !== 0 && Math.abs((point[axis] - placement[axis]) - delta) > 1e-8 * Math.abs(delta)) fail("precision", "complex placement cannot retain its scaled component at coordinate precision"); }
  return point;
}
function metrics(real: number, imaginary: number): { magnitude: number; argument: number | null } {
  if (real === 0 && imaginary === 0) return { magnitude: 0, argument: null };
  const magnitude = bounded(Math.hypot(real, imaginary), "magnitude");
  if (!(magnitude > 0) || Math.abs(Math.hypot(real / magnitude, imaginary / magnitude) - 1) > ROOT_ERROR) fail("precision", "complex modulus cannot retain its mathematical value at numerical precision");
  const argument = Math.atan2(imaginary, real);
  if (imaginary !== 0 && argument === 0) fail("precision", "a nonzero complex argument cannot underflow to certified zero");
  return { magnitude, argument };
}
function output(real: Rational, imaginary: Rational, placement: RenderPoint, scale: number, definition: Pick<ComplexNumberDefinition, "operation" | "accuracy" | "sourceId" | "degree" | "rootIndex">): ComplexGeometry {
  const r = numeric(real); const i = numeric(imaginary); const { magnitude, argument } = metrics(r, i);
  return { kind: "point", point: display(r, i, placement, scale), complexNumber: { ...definition, real: r, imaginary: i, magnitude, argument, origin: { ...placement }, displayScale: scale, unit: "1", exactComponents: { real: serialized(real), imaginary: serialized(imaginary) } } };
}
function source(value: unknown, context: ComplexEvaluationContext): { definition: ComplexNumberDefinition; real: Rational; imaginary: Rational } {
  if (typeof value !== "string" || !value.trim()) fail("source", "complex source requires one computed complex point reference");
  const geometry = context.geometry(value); if (!record(geometry) || geometry.kind !== "point" || !record(geometry.complexNumber) || Object.keys(geometry).some((key) => !["kind", "point", "complexNumber"].includes(key))) fail("source", "source does not carry exclusively computed mathematical complex authority"); const definition = geometry.complexNumber;
  keys(definition, ["real", "imaginary", "magnitude", "argument", "origin", "displayScale", "operation", "unit", "accuracy", "exactComponents", "sourceId", "degree", "rootIndex"], "source");
  if (definition.unit !== "1" || !["point", "transform", "root"].includes(String(definition.operation)) || !["binary_exact", "analytic_certified"].includes(String(definition.accuracy)) || !record(definition.exactComponents) || !record(definition.origin)) fail("source", "complex metadata must retain dimensionless mathematical identity");
  keys(definition.exactComponents, ["real", "imaginary"], "source"); keys(definition.origin, ["x", "y"], "source");
  if (definition.operation !== "point" && (typeof definition.sourceId !== "string" || !definition.sourceId.trim()) || definition.operation === "root" && (typeof definition.degree !== "number" || !Number.isInteger(definition.degree) || definition.degree < 2 || definition.degree > 12 || typeof definition.rootIndex !== "number" || !Number.isInteger(definition.rootIndex) || definition.rootIndex < 0 || definition.rootIndex >= definition.degree)) fail("source", "complex source operation identity is malformed");
  const real = deserialized(definition.exactComponents.real); const imaginary = deserialized(definition.exactComponents.imaginary); const r = numeric(real); const i = numeric(imaginary);
  const { magnitude, argument } = metrics(r, i);
  if (definition.real !== r || definition.imaginary !== i || definition.magnitude !== magnitude || definition.argument !== argument) fail("source", "complex source metadata contradicts its exact components");
  if (typeof definition.displayScale !== "number" || !(definition.displayScale > 0) || definition.displayScale > MAX_VALUE || typeof definition.origin.x !== "number" || typeof definition.origin.y !== "number") fail("source", "complex source display identity is invalid");
  const point = display(r, i, { x: bounded(definition.origin.x, "source"), y: bounded(definition.origin.y, "source") }, definition.displayScale);
  if (!record(geometry.point) || geometry.point.x !== point.x || geometry.point.y !== point.y) fail("source", "complex display point contradicts its mathematical components");
  return { definition: definition as unknown as ComplexNumberDefinition, real, imaginary };
}
/** Exact binary rational transforms avoid cancellation ambiguity; analytic roots independently certify their defining equation. */
export function evaluateComplexConstruction(operator: string, inputs: Record<string, unknown>, context: ComplexEvaluationContext): ComplexGeometry[] {
  const allowed = INPUT_KEYS[operator]; if (!allowed) fail("operator", `unsupported complex operator ${operator}`); keys(inputs, allowed);
  const scale = number(inputs.displayScale, "displayScale", context); if (!(scale > 0)) fail("displayScale", "complex displayScale must be explicit and positive"); const placement = origin(inputs.origin, context);
  if (operator === "complex_point") return [output(exact(number(inputs.real, "real", context)), exact(number(inputs.imaginary, "imaginary", context)), placement, scale, { operation: "point", accuracy: "binary_exact" })];
  const input = source(inputs.source, context);
  if (operator === "complex_transform") {
    const multiplier = components(inputs.multiplier, "multiplier", context); const addend = components(inputs.addend, "addend", context); const a = exact(multiplier.real); const b = exact(multiplier.imaginary);
    const realTerms = [multiply(a, input.real), negative(multiply(b, input.imaginary)), exact(addend.real)];
    const imaginaryTerms = [multiply(a, input.imaginary), multiply(b, input.real), exact(addend.imaginary)];
    const real = realTerms.reduce(add); const imaginary = imaginaryTerms.reduce(add);
    const zeroMultiplier = a.n === 0n && b.n === 0n;
    if (input.definition.accuracy === "analytic_certified" && !zeroMultiplier) {
      const uncertainty = ROOT_ERROR * Math.hypot(multiplier.real, multiplier.imaginary) * input.definition.magnitude;
      for (const [component, terms] of [[real, realTerms], [imaginary, imaginaryTerms]] as const) if (terms.filter((term) => term.n !== 0n).length > 1 && Math.abs(numeric(component)) <= uncertainty) fail("precision", "transform cancellation cannot resolve an analytic root's component uncertainty");
    }
    return [output(real, imaginary, placement, scale, { operation: "transform", accuracy: zeroMultiplier ? "binary_exact" : input.definition.accuracy, sourceId: inputs.source as string })];
  }
  const degree = number(inputs.degree, "degree", context); if (!Number.isInteger(degree) || degree < 2 || degree > 12) fail("degree", "complex root degree must be an integer from2 to12");
  if (input.definition.argument === null) fail("source", "complex_roots requires a nonzero source");
  const radius = Math.exp(Math.log(input.definition.magnitude) / degree); if (!(radius > 0) || !Number.isFinite(radius)) fail("precision", "complex root radius must retain finite nonzero authority");
  const roots = Array.from({ length: degree }, (_, rootIndex) => {
    const angle = (input.definition.argument! + 2 * Math.PI * rootIndex) / degree;
    // Axis roots have an exact integer quarter-turn proof. Using that proof
    // avoids treating sin(pi)'s floating residue as a mathematical component.
    const quarterTurn = input.real.n === 0n ? input.imaginary.n > 0n ? 1 : -1 : input.imaginary.n === 0n ? input.real.n > 0n ? 0 : 2 : null;
    const quadrantal = quarterTurn !== null && (quarterTurn + 4 * rootIndex) % degree === 0 ? ((quarterTurn + 4 * rootIndex) / degree % 4 + 4) % 4 : null;
    const unit = quadrantal === null ? { real: Math.cos(angle), imaginary: Math.sin(angle) } : [{ real: 1, imaginary: 0 }, { real: 0, imaginary: 1 }, { real: -1, imaginary: 0 }, { real: 0, imaginary: -1 }][quadrantal]!;
    const real = radius * unit.real; const imaginary = radius * unit.imaginary;
    // Powers are checked after normalizing to the unit circle, avoiding tiny
    // absolute residuals that could incorrectly certify an erased source.
    let power = { real: 1, imaginary: 0 }; const unitReal = real / radius; const unitImaginary = imaginary / radius;
    for (let index = 0; index < degree; index++) power = { real: power.real * unitReal - power.imaginary * unitImaginary, imaginary: power.real * unitImaginary + power.imaginary * unitReal };
    const residual = Math.hypot(power.real - input.definition.real / input.definition.magnitude, power.imaginary - input.definition.imaginary / input.definition.magnitude);
    if (!Number.isFinite(residual) || residual > ROOT_ERROR || Math.abs(degree * Math.log(radius) - Math.log(input.definition.magnitude)) > ROOT_ERROR) fail("precision", "analytic complex root does not certify its source equation");
    const exactReal = exact(real); const exactImaginary = exact(imaginary); const exactEquation = exactPower(exactReal, exactImaginary, degree);
    const accuracy = input.definition.accuracy === "binary_exact" && equalRational(exactEquation.real, input.real) && equalRational(exactEquation.imaginary, input.imaginary) ? "binary_exact" : "analytic_certified";
    return output(exactReal, exactImaginary, placement, scale, { operation: "root", accuracy, sourceId: inputs.source as string, degree, rootIndex });
  });
  for (let index = 0; index < degree; index++) for (let next = index + 1; next < degree; next++) if (Math.hypot(roots[index]!.point.x - roots[next]!.point.x, roots[index]!.point.y - roots[next]!.point.y) <= 1e-6) fail("precision", "distinct complex roots collapse at display precision");
  return roots;
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) fail("scalar", "complex quantity is cyclic or exceeds depth32");
  checkUnits(value, document);
  if (typeof value === "number") return bounded(value, "scalar");
  if (record(value)) { keys(value, ["value", "unit"], "scalar"); seen.add(value); return validationNumber(value.value, document, seen, depth + 1); }
  if (typeof value !== "string" || !value.trim()) fail("scalar", "complex values require finite numeric sources");
  const quantities = document.quantities.filter((candidate) => candidate.id === value);
  if (quantities.length > 1) fail("scalar", "complex numeric reference is ambiguous");
  if (quantities.length === 1) { seen.add(value); return validationNumber(quantities[0]!.value, document, seen, depth + 1); }
  preserveLiteral(value, "scalar");
  return bounded(Number(value), "scalar");
}
function pointProducer(id: unknown, document: SceneDocument, byOutput: Map<string, SceneConstruction>, key: string): SceneConstruction {
  if (typeof id !== "string" || !id.trim()) fail(key, `${key} requires a constructed point reference`);
  const entities = document.entities.filter((candidate) => candidate.id === id);
  const producers = document.constructions.filter((candidate) => candidate.outputs.includes(id));
  const producer = byOutput.get(id);
  if (entities.length !== 1 || entities[0]!.kind !== "point" || producers.length !== 1 || !producer || producer !== producers[0]) fail(key, `${key} must name one unambiguous constructed point`);
  return producer;
}
function schema(construction: SceneConstruction, document: SceneDocument, byOutput: Map<string, SceneConstruction>): void {
  const { operator, inputs } = construction;
  if (!record(inputs)) fail("inputs", "complex inputs must be an object");
  const allowed = INPUT_KEYS[operator]; if (!allowed) fail("operator", "requires a computed complex operator"); keys(inputs, allowed);
  const context: ComplexEvaluationContext = { number: (value) => validationNumber(value, document), point: () => { throw new DeferredComplexGeometry(); }, geometry: () => { throw new DeferredComplexGeometry(); } };
  const scale = number(inputs.displayScale, "displayScale", context); if (!(scale > 0)) fail("displayScale", "complex displayScale must be explicit and positive");
  let count = 1;
  if (operator === "complex_point") { number(inputs.real, "real", context); number(inputs.imaginary, "imaginary", context); }
  else {
    const producer = pointProducer(inputs.source, document, byOutput, "source");
    if (!(COMPLEX_OPERATORS as readonly string[]).includes(producer.operator)) fail("source", "source must carry computed mathematical complex authority");
    if (operator === "complex_transform") { components(inputs.multiplier, "multiplier", context); components(inputs.addend, "addend", context); }
    else { count = number(inputs.degree, "degree", context); if (!Number.isInteger(count) || count < 2 || count > 12) fail("degree", "complex root degree must be an integer from2 to12"); }
  }
  if (!Array.isArray(construction.outputs) || construction.outputs.length !== count || construction.outputs.some((id) => typeof id !== "string" || !id.trim()) || new Set(construction.outputs).size !== count) fail("outputs", `${operator} requires exactly ${count} distinct point output ids`);
  for (const id of construction.outputs) pointProducer(id, document, byOutput, "outputs");
  if (inputs.origin !== undefined) {
    if (typeof inputs.origin === "string") pointProducer(inputs.origin, document, byOutput, "origin");
    else origin(inputs.origin, context);
  }
}
/** Schema checks never substitute guessed positions for unevaluated point origins. */
export function validateComplexConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  if (!(COMPLEX_OPERATORS as readonly string[]).includes(construction.operator)) return;
  const resolving = new Set<string>(); const cache = new Map<string, unknown>(); let resolvedCount = 0;
  const context: ComplexEvaluationContext = {
    number: (value) => validationNumber(value, document),
    point(value) {
      const geometry = context.geometry(value);
      if (!record(geometry) || geometry.kind !== "point" || !record(geometry.point) || typeof geometry.point.x !== "number" || typeof geometry.point.y !== "number") fail("origin", "complex origin must be a planar point");
      return { x: geometry.point.x, y: geometry.point.y };
    },
    geometry(value) {
      const producer = pointProducer(value, document, constructionByOutput, "reference"); const id = value as string;
      if (cache.has(id)) return cache.get(id);
      if (resolving.has(id) || resolving.size >= 32 || ++resolvedCount > 4096) fail("reference", "complex dependency is cyclic or exceeds its bounded capacity");
      resolving.add(id);
      try {
        if (producer.operator === "point") {
          const geometry = { kind: "point", point: { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) } };
          cache.set(id, geometry); return geometry;
        }
        if (!(COMPLEX_OPERATORS as readonly string[]).includes(producer.operator)) throw new DeferredComplexGeometry();
        schema(producer, document, constructionByOutput);
        const geometries = evaluateComplexConstruction(producer.operator, producer.inputs, context);
        producer.outputs.forEach((outputId, outputIndex) => cache.set(outputId, geometries[outputIndex])); return cache.get(id);
      } finally { resolving.delete(id); }
    },
  };
  try { schema(construction, document, constructionByOutput); const evaluated = evaluateComplexConstruction(construction.operator, construction.inputs, context); validateEvaluatedComplexLabels(construction, index, document, evaluated, issues); }
  catch (error) {
    if (error instanceof DeferredComplexGeometry) return;
    const key = error instanceof ComplexInputError ? error.key : "inputs";
    issues.push({ code: `invalid_${construction.operator}_${key}`, severity: "fatal", message: error instanceof Error ? error.message : "invalid complex construction", path: `constructions[${index}].${key === "outputs" ? key : `inputs.${key}`}`, entityIds: construction.outputs });
  }
}
function definition(geometry: unknown): ComplexNumberDefinition | null {
  if (!record(geometry) || geometry.kind !== "point" || !record(geometry.complexNumber)) return null;
  const value = geometry.complexNumber;
  if (value.unit !== "1" || typeof value.real !== "number" || typeof value.imaginary !== "number" || typeof value.magnitude !== "number" || value.argument !== null && typeof value.argument !== "number" || ![value.real, value.imaginary, value.magnitude].every(Number.isFinite)) return null;
  return value as unknown as ComplexNumberDefinition;
}
function compactNumber(value: number): string { return String(Number(value.toPrecision(3))); }
/** Derived answers stay symbolic until a supplied numeric label has been verified. */
export function complexGeometryLabel(geometry: unknown, requestedText?: unknown): string | null {
  const value = definition(geometry); if (!value) return null;
  if (typeof requestedText === "string" && requestedText.trim() && requestedText.length <= 16) return requestedText;
  if (value.operation === "transform") return "mz+b";
  if (value.operation === "root") return `w${value.rootIndex}`;
  const real = compactNumber(value.real); const imaginary = compactNumber(Math.abs(value.imaginary));
  const rounded = Number(real) !== value.real || Number(imaginary) !== Math.abs(value.imaginary);
  const label = `z${rounded ? "≈" : "="}${real}${value.imaginary < 0 ? "−" : "+"}${imaginary}i`;
  return label.length <= 16 ? label : "z";
}
const NUMERIC_TOKEN = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?";
type ClaimPart = "real" | "imaginary" | "magnitude" | "argument";
function claimPart(symbol: string): ClaimPart | null {
  const key = symbol.toLowerCase().replace(/\s/g, "");
  if (/^(?:re|real|x)(?:\([^()]+\))?$/.test(key)) return "real";
  if (/^(?:im|imag|imaginary|y)(?:\([^()]+\))?$/.test(key)) return "imaginary";
  if (/^(?:mod|modulus|magnitude|abs)(?:\([^()]+\))?$/.test(key) || /^\|[^|]+\|$/.test(key)) return "magnitude";
  if (/^(?:arg|argument|phase)(?:\([^()]+\))?$/.test(key)) return "argument";
  return null;
}
function closeClaim(actual: number, expected: number, token: string, approximate: boolean, resolutionScale = 1): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  if (actual === expected) return true;
  if (actual === 0 || expected === 0) return false;
  const scale = Math.max(Math.abs(actual), Math.abs(expected));
  const relative = Math.abs(actual / scale - expected / scale);
  if (relative <= ERROR) return true;
  if (!approximate) return false;
  const [mantissa, exponentText] = token.toLowerCase().split("e");
  const decimals = mantissa!.split(".")[1]?.length ?? 0;
  const resolution = 10 ** ((exponentText ? Number(exponentText) : 0) - decimals) * resolutionScale;
  return Number.isFinite(resolution) && resolution > 0 && Math.abs(actual - expected) <= Math.min(0.5 * resolution, 0.05 * Math.abs(expected));
}
function scalarClaim(part: ClaimPart, token: string, unit: string, approximate: boolean, value: ComplexNumberDefinition): void {
  preserveLiteral(token, "label");
  let claimed = Number(token); let resolutionScale = 1; const expected = value[part];
  if (expected === null) fail("label", "zero complex numbers have no defined argument");
  const normalized = unit.trim().toLowerCase();
  if (part === "argument") {
    if (["deg", "degree", "degrees", "°"].includes(normalized)) { resolutionScale = Math.PI / 180; const converted = claimed * resolutionScale; if (claimed !== 0 && converted === 0) fail("label", "complex argument label conversion underflows"); claimed = converted; }
    else if (normalized && !["rad", "radian", "radians", "1"].includes(normalized)) fail("label", "complex arguments require explicit radians or degrees");
  } else if (normalized && !SCALAR_UNITS.has(normalized)) fail("label", "complex value labels must remain dimensionless");
  if (!closeClaim(claimed, expected, token, approximate, resolutionScale)) fail("label", "complex numeric label contradicts its evaluated mathematical value");
}
function checkLabel(text: unknown, value: ComplexNumberDefinition): void {
  if (text === undefined) return;
  if (typeof text !== "string" || !text.trim()) fail("label", "complex labels require nonempty text or a symbolic identifier");
  const normalized = text.trim().replace(/−/g, "-").replace(/\u2212/g, "-");
  if (/^(?:[+-]?infinity|nan)$/i.test(normalized)) fail("label", "complex labels cannot claim a nonfinite value");
  // Digits in identifiers are legitimate; arithmetic claims must have a
  // supported scalar or complex shape before they can display a number.
  if (!/[=≈]/.test(normalized) && !/^[-+\d.(]/.test(normalized)) {
    if (/\d/.test(normalized) && !/^[\p{L}_][\p{L}\p{N}_]*(?:\([^()]*\))?$/u.test(normalized) && !/^(?:Re|Im|arg)\([^()]+\)$/i.test(normalized)) fail("label", "numeric complex claims require an evaluated component, modulus, argument, or complex value");
    return;
  }
  const equation = normalized.match(/^(.+?)\s*([=≈])\s*(.+)$/);
  const symbol = equation?.[1]?.trim() ?? "z"; const body = equation?.[3]?.trim() ?? normalized; const approximate = equation?.[2] === "≈";
  const part = claimPart(symbol);
  if (part) {
    const match = body.match(new RegExp(`^(${NUMERIC_TOKEN})\\s*([^\\d]*)$`, "i")); if (!match) fail("label", "complex scalar label must provide one numeric value with compatible units");
    scalarClaim(part, match[1]!, match[2]!, approximate, value); return;
  }
  if (!/^(?:z|w|w\d+|[\p{L}_][\p{L}\p{N}_]*(?:\([^()]*\))?)$/u.test(symbol)) fail("label", "complex numeric label must name its computed mathematical value");
  const tuple = body.match(new RegExp(`^\\(\\s*(${NUMERIC_TOKEN})\\s*,\\s*(${NUMERIC_TOKEN})\\s*\\)$`, "i"));
  if (tuple) { scalarClaim("real", tuple[1]!, "1", approximate, value); scalarClaim("imaginary", tuple[2]!, "1", approximate, value); return; }
  const compact = body.replace(/\s/g, "");
  const cartesian = compact.match(new RegExp(`^(${NUMERIC_TOKEN})([+-])(${NUMERIC_TOKEN.replace("[+-]?", "")})?i$`, "i"));
  const imaginaryOnly = compact.match(new RegExp(`^([+-]?(?:${NUMERIC_TOKEN.replace("[+-]?", "")})?)i$`, "i"));
  const realOnly = compact.match(new RegExp(`^(${NUMERIC_TOKEN})$`, "i"));
  let realToken: string; let imaginaryToken: string;
  if (cartesian) { realToken = cartesian[1]!; imaginaryToken = `${cartesian[2]}${cartesian[3] ?? "1"}`; }
  else if (imaginaryOnly) { realToken = "0"; imaginaryToken = imaginaryOnly[1] === "" || imaginaryOnly[1] === "+" ? "1" : imaginaryOnly[1] === "-" ? "-1" : imaginaryOnly[1]!; }
  else if (realOnly) { realToken = realOnly[1]!; imaginaryToken = "0"; }
  else fail("label", "complex numeric label must declare computed real and imaginary components");
  scalarClaim("real", realToken, "1", approximate, value); scalarClaim("imaginary", imaginaryToken, "1", approximate, value);
}
function checkQuantity(id: unknown, value: ComplexNumberDefinition, document: SceneDocument): void {
  if (typeof id !== "string") fail("label", "complex annotation quantity must reference a source scalar");
  const quantities = document.quantities.filter((quantity) => quantity.id === id); if (quantities.length !== 1) fail("label", "complex annotation quantity must be unambiguous");
  const quantity = quantities[0]!; const part = typeof quantity.symbol === "string" ? claimPart(quantity.symbol) : null;
  if (!part) fail("label", "complex scalar annotation must explicitly name a real, imaginary, modulus, or argument quantity");
  if (part === "argument") {
    // Angle quantities use angular units rather than the component scalar units.
    if (quantity.unit !== undefined && typeof quantity.unit !== "string") fail("label", "complex argument quantity units must be declared as angular text");
    const unit = typeof quantity.unit === "string" ? quantity.unit : "rad";
    if (typeof quantity.value !== "number" && (typeof quantity.value !== "string" || !quantity.value.trim() || !Number.isFinite(Number(quantity.value)))) fail("label", "complex argument annotation requires a finite explicit angular value");
    scalarClaim(part, String(quantity.value), unit, false, value);
  } else scalarClaim(part, String(validationNumber(id, document)), "1", false, value);
}
/** Every visible claim is checked against evaluated mathematics before render. */
export function validateEvaluatedComplexLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  if (!(COMPLEX_OPERATORS as readonly string[]).includes(construction.operator)) return;
  construction.outputs.forEach((id, outputIndex) => {
    const value = definition(outputs[outputIndex]);
    try {
      if (!value) fail("label", "complex output has no evaluated mathematical authority");
      checkLabel(document.entities.find((entity) => entity.id === id)?.label, value);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(id) || !["label", "callout", "badge"].includes(annotation.kind)) continue;
        checkLabel(annotation.text, value); if (annotation.quantityId !== undefined) checkQuantity(annotation.quantityId, value, document);
      }
      for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) checkLabel(label.inputs.text, value);
    } catch (error) { issues.push({ code: "invalid_complex_label", severity: "fatal", message: error instanceof Error ? error.message : "invalid complex label", path: `constructions[${index}].outputs[${outputIndex}]`, entityIds: [id] }); }
  });
}
