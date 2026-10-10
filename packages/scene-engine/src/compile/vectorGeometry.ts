import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const VECTOR_OPERATORS = ["vector_sum", "vector_scale", "vector_projection"] as const;
export interface ExactVectorComponent { numerator: string; denominator: string }
export interface VectorDefinition {
  operation: "sum" | "scale" | "projection";
  origin: RenderPoint;
  components: RenderPoint;
  exactComponents: { x: ExactVectorComponent; y: ExactVectorComponent };
  magnitude: number;
  zero: boolean;
  sourceIds: string[];
  scaleFactor?: number;
  projection?: { onto: RenderPoint; coefficient: number; dotProduct: number };
}
export type VectorGeometry =
  | { kind: "point"; point: RenderPoint; vectorDefinition: VectorDefinition }
  | { kind: "path"; points: RenderPoint[]; directed: true; vectorDefinition: VectorDefinition };
export interface VectorEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry(value: unknown): unknown;
}
const MAX_COORDINATE = 1e12;
const MAX_FACTOR = 1e6;
const MAX_VECTORS = 32;
const MAX_EXACT_BITS = 8192;
const POSITION_RELATIVE_ERROR = 1e-10;
type Rational = { n: bigint; d: bigint };
type Components = { x: Rational; y: Rational };
class VectorInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new VectorInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void {
  const unexpected = Object.keys(value).filter((name) => !allowed.includes(name));
  if (unexpected.length) invalid(key, `unsupported vector inputs or metadata: ${unexpected.join(", ")}`);
}
function bounded(value: number, key: string, maximum = MAX_COORDINATE): number {
  if (!Number.isFinite(value) || Math.abs(value) > maximum) invalid(key, `${key} must be finite with magnitude at most ${maximum}`);
  return value;
}
function scalar(value: unknown, key: string, context: VectorEvaluationContext, depth = 0): number {
  if (depth > 32) invalid(key, "numeric scalar nesting exceeds 32");
  if (isRecord(value)) {
    keys(value, ["value", "unit"], key);
    if (value.unit !== undefined && (typeof value.unit !== "string" || !["1", "unit", "units", "dimensionless"].includes(value.unit.trim()))) invalid(key, "vector scale factor must be dimensionless");
    return scalar(value.value, key, context, depth + 1);
  }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, `${key} must be a finite scalar or quantity reference`);
  try { return bounded(context.number(value), key, MAX_FACTOR); }
  catch (error) { if (error instanceof VectorInputError) throw error; return invalid(key, `${key} must resolve to a bounded finite scalar`); }
}
function checkedPoint(value: unknown, key: string): RenderPoint {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") invalid(key, `${key} must be a finite 2D point`);
  return { x: bounded(value.x, key), y: bounded(value.y, key) };
}
function originPoint(value: unknown, context: VectorEvaluationContext): RenderPoint {
  if (typeof value === "string" && value.trim()) {
    const geometry = context.geometry(value);
    if (geometry !== undefined) {
      if (!isRecord(geometry) || geometry.kind !== "point") invalid("origin", "origin must reference a constructed 2D point");
      keys(geometry, ["kind", "point"], "origin");
    }
    return checkedPoint(context.point(value), "origin");
  }
  const coordinate = (item: unknown, depth = 0): number => {
    if (depth > 32) invalid("origin", "origin scalar nesting exceeds 32");
    if (isRecord(item) && "value" in item) { keys(item, ["value", "unit"], "origin"); return coordinate(item.value, depth + 1); }
    if (typeof item !== "number" && (typeof item !== "string" || !item.trim())) invalid("origin", "origin coordinates must be finite scalar values");
    return bounded(context.number(item), "origin");
  };
  if (Array.isArray(value) && value.length === 2) return { x: coordinate(value[0]), y: coordinate(value[1]) };
  if (isRecord(value)) { keys(value, ["x", "y"], "origin"); return { x: coordinate(value.x), y: coordinate(value.y) }; }
  return invalid("origin", "origin requires an explicit point reference or two coordinates");
}
function gcd(a: bigint, b: bigint): bigint { let x = a < 0n ? -a : a; let y = b; while (y) { const remainder = x % y; x = y; y = remainder; } return x; }
function rational(n: bigint, d: bigint): Rational {
  if (d === 0n) invalid("geometry", "vector arithmetic denominator cannot be zero");
  if (n === 0n) return { n: 0n, d: 1n };
  const divisor = gcd(n, d < 0n ? -d : d);
  const result = { n: n / divisor * (d < 0n ? -1n : 1n), d: (d < 0n ? -d : d) / divisor };
  if (result.n.toString(2).length > MAX_EXACT_BITS || result.d.toString(2).length > MAX_EXACT_BITS) invalid("geometry", "exact vector composition exceeds the bounded verification capacity");
  return result;
}
const bits = new DataView(new ArrayBuffer(8));
function exact(value: number): Rational {
  if (value === 0) return { n: 0n, d: 1n };
  bits.setFloat64(0, value);
  const word = bits.getBigUint64(0);
  const exponent = Number((word >> 52n) & 2047n);
  const significand = (word & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const power = exponent ? exponent - 1075 : -1074;
  const numerator = word >> 63n ? -significand : significand;
  return power >= 0 ? rational(numerator << BigInt(power), 1n) : rational(numerator, 1n << BigInt(-power));
}
function add(a: Rational, b: Rational): Rational { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
function multiply(a: Rational, b: Rational): Rational { return rational(a.n * b.n, a.d * b.d); }
function subtract(a: Rational, b: Rational): Rational { return add(a, { n: -b.n, d: b.d }); }
function numeric(value: Rational, key: string, maximum = MAX_COORDINATE): number {
  if (value.n === 0n) return 0;
  const n = value.n < 0n ? -value.n : value.n;
  let exponent = n.toString(2).length - value.d.toString(2).length;
  if (exponent >= 0 ? n < value.d << BigInt(exponent) : n << BigInt(-exponent) < value.d) exponent -= 1;
  const shift = exponent < -1022 ? 1074 : 52 - exponent;
  const numerator = shift >= 0 ? n << BigInt(shift) : n;
  const denominator = shift >= 0 ? value.d : value.d << BigInt(-shift);
  let mantissa = numerator / denominator;
  const remainder = numerator % denominator;
  if (2n * remainder > denominator || 2n * remainder === denominator && mantissa % 2n === 1n) mantissa += 1n;
  const result = Number(mantissa) * 2 ** -shift * (value.n < 0n ? -1 : 1);
  if (result === 0) invalid(key, "a nonzero exact vector value underflows numerical authority");
  return bounded(result, key, maximum);
}
function serialize(value: Rational): ExactVectorComponent { return { numerator: value.n.toString(), denominator: value.d.toString() }; }
function deserialize(value: unknown): Rational {
  if (!isRecord(value)) invalid("vector", "vector exact components must retain rational authority");
  keys(value, ["numerator", "denominator"], "vector");
  const integer = (raw: unknown): bigint => {
    if (typeof raw !== "string" || !raw || raw.length > 2500) invalid("vector", "exact vector integers must be bounded canonical decimal strings");
    const digits = raw[0] === "-" ? raw.slice(1) : raw;
    if (!digits || [...digits].some((character) => character < "0" || character > "9")) invalid("vector", "exact vector integers must be canonical decimal strings");
    const parsed = BigInt(raw);
    if (parsed.toString() !== raw) invalid("vector", "exact vector integers must be canonical decimal strings");
    return parsed;
  };
  const n = integer(value.numerator);
  const d = integer(value.denominator);
  if (!(d > 0n)) invalid("vector", "exact vector denominator must be positive");
  const result = rational(n, d);
  if (result.n !== n || result.d !== d) invalid("vector", "exact vector components must be reduced");
  return result;
}
function sourceComponents(value: unknown, context: VectorEvaluationContext): Components {
  if (typeof value !== "string" || !value.trim()) invalid("vector", "vector inputs must reference verified vector entities");
  const source = context.geometry(value);
  if (!isRecord(source) || source.kind !== "path" && source.kind !== "point") invalid("vector", "vector reference must resolve to a directed finite vector or verified zero marker");
  keys(source, ["kind", "points", "point", "directed", "closed", "infinite", "vectorDefinition", "calculusDerivative", "calculusAnchor"], "vector");
  if (source.infinite !== undefined && source.infinite !== false || source.closed !== undefined && source.closed !== false) invalid("vector", "infinite rays and closed paths are not free vectors");
  let components: Components;
  if (source.calculusDerivative !== undefined) {
    const derivative = source.calculusDerivative;
    if (!isRecord(derivative)) invalid("vector", "analytic derivative metadata is missing");
    keys(derivative, ["curveId", "parameter", "derivative", "parameterScale"], "vector");
    if (typeof derivative.curveId !== "string" || typeof derivative.parameter !== "number" || !Number.isFinite(derivative.parameter)
      || typeof derivative.parameterScale !== "number" || !(derivative.parameterScale > 0)) invalid("vector", "analytic derivative requires bounded source identity and scale");
    const curve = context.geometry(derivative.curveId);
    if (!isRecord(curve) || curve.kind !== "path" || !isRecord(curve.sampledCurve)) invalid("vector", "analytic source is not an ordinary mathematical curve");
    keys(curve, ["kind", "points", "sampledCurve"], "vector");
    const sample = curve.sampledCurve;
    if (typeof sample.evaluate !== "function" || typeof sample.derivative !== "function") invalid("vector", "exact analytic callbacks are required");
    if (typeof sample.parameterMin !== "number" || typeof sample.parameterMax !== "number" || !Number.isFinite(sample.parameterMin) || !Number.isFinite(sample.parameterMax)
      || derivative.parameter < sample.parameterMin || derivative.parameter > sample.parameterMax) invalid("vector", "analytic derivative must remain inside its verified parameter domain");
    const origin = checkedPoint(sample.evaluate(derivative.parameter), "vector");
    const evaluated = checkedPoint(sample.derivative(derivative.parameter), "vector");
    const declared = checkedPoint(derivative.derivative, "vector");
    if (evaluated.x !== declared.x || evaluated.y !== declared.y) invalid("vector", "analytic derivative contradicts its source callback");
    const dx = bounded(evaluated.x * derivative.parameterScale, "vector");
    const dy = bounded(evaluated.y * derivative.parameterScale, "vector");
    if (dx === 0 && dy === 0) {
      const point = checkedPoint(source.point, "vector");
      if (source.kind !== "point" || point.x !== origin.x || point.y !== origin.y) invalid("vector", "zero analytic marker contradicts its verified origin");
    } else {
      if (source.kind !== "path" || source.directed !== true || !Array.isArray(source.points) || source.points.length !== 2) invalid("vector", "nonzero analytic derivative requires a directed arrow");
      const start = checkedPoint(source.points[0], "vector"); const end = checkedPoint(source.points[1], "vector");
      if (start.x !== origin.x || start.y !== origin.y || Math.hypot(end.x - start.x - dx, end.y - start.y - dy) > POSITION_RELATIVE_ERROR * Math.hypot(dx, dy)) invalid("vector", "analytic arrow placement contradicts its derivative");
    }
    components = { x: exact(dx), y: exact(dy) };
  } else if (source.vectorDefinition !== undefined) {
    const definition = source.vectorDefinition;
    if (!isRecord(definition) || !isRecord(definition.exactComponents)) invalid("vector", "vector definition metadata is malformed");
    keys(definition, ["operation", "origin", "components", "exactComponents", "magnitude", "zero", "sourceIds", "scaleFactor", "projection"], "vector");
    keys(definition.exactComponents, ["x", "y"], "vector");
    if (!["sum", "scale", "projection"].includes(String(definition.operation)) || !Array.isArray(definition.sourceIds) || definition.sourceIds.length < 1 || definition.sourceIds.length > MAX_VECTORS || definition.sourceIds.some((id) => typeof id !== "string" || !id.trim())) invalid("vector", "vector definition must retain its bounded operation and source identity");
    components = { x: deserialize(definition.exactComponents.x), y: deserialize(definition.exactComponents.y) };
    const rendered = checkedPoint(definition.components, "vector");
    if (rendered.x !== numeric(components.x, "vector") || rendered.y !== numeric(components.y, "vector") || definition.zero !== (components.x.n === 0n && components.y.n === 0n) || definition.magnitude !== Math.hypot(rendered.x, rendered.y)) invalid("vector", "vector metadata contradicts its exact components");
    const origin = checkedPoint(definition.origin, "vector");
    if (definition.zero) {
      const point = checkedPoint(source.point, "vector");
      if (source.kind !== "point" || point.x !== origin.x || point.y !== origin.y) invalid("vector", "zero vector marker contradicts its origin");
    } else {
      if (source.kind !== "path" || source.directed !== true || !Array.isArray(source.points) || source.points.length !== 2) invalid("vector", "nonzero vector must retain a directed two-point arrow");
      const start = checkedPoint(source.points[0], "vector"); const end = checkedPoint(source.points[1], "vector");
      if (start.x !== origin.x || start.y !== origin.y || end.x !== origin.x + rendered.x || end.y !== origin.y + rendered.y) invalid("vector", "vector arrow contradicts its mathematical components");
    }
  } else {
    if (source.kind !== "path" || source.directed !== true || !Array.isArray(source.points) || source.points.length !== 2) invalid("vector", "ordinary vector sources must be directed two-point arrows");
    const start = checkedPoint(source.points[0], "vector"); const end = checkedPoint(source.points[1], "vector");
    components = { x: subtract(exact(end.x), exact(start.x)), y: subtract(exact(end.y), exact(start.y)) };
    for (const axis of ["x", "y"] as const) {
      const displacement = numeric(components[axis], "vector");
      if (displacement !== 0 && Math.abs(displacement) <= 16 * Number.EPSILON * Math.max(Math.abs(start[axis]), Math.abs(end[axis]))) invalid("vector", "source vector displacement is ill-conditioned at its coordinate scale");
    }
    if (components.x.n === 0n && components.y.n === 0n) invalid("vector", "ordinary zero-length arrows need verified zero-vector metadata");
  }
  return components;
}
function vectorMark(operation: VectorDefinition["operation"], origin: RenderPoint, exactComponents: Components, sourceIds: string[], extra: Partial<Pick<VectorDefinition, "scaleFactor" | "projection">> = {}): VectorGeometry {
  const components = { x: numeric(exactComponents.x, "geometry"), y: numeric(exactComponents.y, "geometry") };
  const zero = exactComponents.x.n === 0n && exactComponents.y.n === 0n;
  const vectorDefinition: VectorDefinition = { operation, origin, components, exactComponents: { x: serialize(exactComponents.x), y: serialize(exactComponents.y) }, magnitude: Math.hypot(components.x, components.y), zero, sourceIds: [...sourceIds], ...extra };
  if (zero) return { kind: "point", point: { ...origin }, vectorDefinition };
  const end = checkedPoint({ x: origin.x + components.x, y: origin.y + components.y }, "origin");
  for (const axis of ["x", "y"] as const) {
    const recovered = end[axis] - origin[axis];
    if (components[axis] !== 0 && (recovered === 0 || Math.abs(recovered - components[axis]) > POSITION_RELATIVE_ERROR * Math.abs(components[axis]))) invalid("origin", "vector placement cannot retain its mathematical components at numerical precision");
  }
  return { kind: "path", points: [{ ...origin }, end], directed: true, vectorDefinition };
}

/** Free-vector arithmetic uses verified components; fitting or source translation cannot rescale a result. */
export function evaluateVectorConstruction(operator: string, inputs: Record<string, unknown>, context: VectorEvaluationContext): VectorGeometry[] {
  if (operator === "vector_sum") {
    keys(inputs, ["vectors", "origin"]);
    if (!Array.isArray(inputs.vectors) || inputs.vectors.length < 1 || inputs.vectors.length > MAX_VECTORS) invalid("vectors", `vector_sum requires 1 to ${MAX_VECTORS} explicit vector references`);
    const vectors = inputs.vectors.map((value) => sourceComponents(value, context));
    const result = vectors.reduce<Components>((sum, vector) => ({ x: add(sum.x, vector.x), y: add(sum.y, vector.y) }), { x: exact(0), y: exact(0) });
    return [vectorMark("sum", originPoint(inputs.origin, context), result, inputs.vectors as string[])];
  }
  if (operator === "vector_scale") {
    keys(inputs, ["vector", "factor", "origin"]);
    const vector = sourceComponents(inputs.vector, context);
    const factor = scalar(inputs.factor, "factor", context);
    return [vectorMark("scale", originPoint(inputs.origin, context), { x: multiply(vector.x, exact(factor)), y: multiply(vector.y, exact(factor)) }, [inputs.vector as string], { scaleFactor: factor })];
  }
  if (operator === "vector_projection") {
    keys(inputs, ["vector", "onto", "origin"]);
    const vector = sourceComponents(inputs.vector, context);
    const onto = sourceComponents(inputs.onto, context);
    const denominator = add(multiply(onto.x, onto.x), multiply(onto.y, onto.y));
    if (denominator.n === 0n) invalid("onto", "projection requires a nonzero target vector");
    const dot = add(multiply(vector.x, onto.x), multiply(vector.y, onto.y));
    const coefficient = rational(dot.n * denominator.d, dot.d * denominator.n);
    const projection = { onto: { x: numeric(onto.x, "onto"), y: numeric(onto.y, "onto") }, coefficient: numeric(coefficient, "onto"), dotProduct: numeric(dot, "geometry", 2 * MAX_COORDINATE ** 2) };
    return [vectorMark("projection", originPoint(inputs.origin, context), { x: multiply(coefficient, onto.x), y: multiply(coefficient, onto.y) }, [inputs.vector as string, inputs.onto as string], { projection })];
  }
  return invalid("operator", `unsupported vector operator ${operator}`);
}
const LENGTH_UNITS: Readonly<Record<string, string>> = {
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m", cm: "cm", centimeter: "cm", centimeters: "cm", centimetre: "cm", centimetres: "cm",
  mm: "mm", millimeter: "mm", millimetre: "mm", km: "km", kilometer: "km", kilometre: "km", um: "um", "µm": "um", "μm": "um", nm: "nm",
  in: "in", inch: "in", inches: "in", ft: "ft", foot: "ft", feet: "ft", yd: "yd", yard: "yd", yards: "yd",
  "1": "unit", unit: "unit", units: "unit", dimensionless: "unit",
};
const DIMENSIONLESS_UNITS = new Set(["1", "unit", "units", "dimensionless"]);
const PROTECTED_POINT_PRODUCERS = new Set(["space_point", "space_project", "space_intersection", "space_closest_points", "solid_anchor", "electric_field", "field_components"]);
class DeferredVectorGeometry extends VectorInputError { constructor() { super("geometry", "derived input geometry will be checked during compilation"); } }
function validationNumber(value: unknown, document: SceneDocument, ancestors = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || ancestors.has(value)) invalid("quantity", "numeric quantity references must be acyclic and have depth at most 32");
  if (typeof value === "number") return bounded(value, "quantity");
  if (isRecord(value) && "value" in value) { ancestors.add(value); return validationNumber(value.value, document, ancestors, depth + 1); }
  if (typeof value === "string" && value.trim()) {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) { ancestors.add(value); return validationNumber(quantity.value, document, ancestors, depth + 1); }
    return bounded(Number(value), "quantity");
  }
  return invalid("quantity", "vector numeric inputs must resolve to finite values");
}
function scalarUnits(value: unknown, document: SceneDocument, ancestors = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || ancestors.has(value)) invalid("units", "quantity unit references must be acyclic and have depth at most 32");
  if (isRecord(value)) {
    ancestors.add(value);
    if (value.unit !== undefined && (typeof value.unit !== "string" || !value.unit.trim())) invalid("units", "known units must be nonempty strings");
    return [...(typeof value.unit === "string" ? [value.unit.trim()] : []), ...(value.value !== undefined ? scalarUnits(value.value, document, ancestors, depth + 1) : [])];
  }
  if (typeof value === "string") {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) { ancestors.add(value); return scalarUnits(quantity, document, ancestors, depth + 1); }
  }
  return [];
}
function sourceIds(operator: string, inputs: Record<string, unknown>): string[] {
  if (operator === "vector_sum") {
    keys(inputs, ["vectors", "origin"]);
    if (!Array.isArray(inputs.vectors) || inputs.vectors.length < 1 || inputs.vectors.length > MAX_VECTORS) invalid("vectors", `vector_sum requires 1 to ${MAX_VECTORS} explicit references`);
    if (inputs.vectors.some((value) => typeof value !== "string" || !value.trim())) invalid("vectors", "vector_sum inputs must be vector entity IDs");
    return inputs.vectors as string[];
  }
  if (operator !== "vector_scale" && operator !== "vector_projection") invalid("operator", `unsupported vector operator ${operator}`);
  keys(inputs, operator === "vector_scale" ? ["vector", "factor", "origin"] : ["vector", "onto", "origin"]);
  const references = operator === "vector_scale" ? [inputs.vector] : [inputs.vector, inputs.onto];
  if (references.some((value) => typeof value !== "string" || !value.trim())) invalid("vector", "vector inputs must be nonempty entity IDs");
  return references as string[];
}
function first(inputs: Record<string, unknown>, names: readonly string[]): unknown { for (const name of names) if (inputs[name] !== undefined) return inputs[name]; return undefined; }

/** Checks only typed length-bearing inputs; angle, time, and enum fields are never inferred as coordinates. */
export function validateVectorConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const addIssue = (key: string, message: string, actual?: unknown): void => {
    issues.push({ code: `invalid_${construction.operator}_${key}`, severity: "fatal", message, path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`, actual });
  };
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  if (outputs.length !== 1 || typeof outputs[0] !== "string" || !outputs[0].trim()) addIssue("outputs", "vector arithmetic requires exactly one output entity");
  if (document.entities.find((entity) => entity.id === outputs[0])?.kind !== "vector") addIssue("output_kind", "vector arithmetic must produce a vector entity");
  if (!isRecord(construction.inputs)) { addIssue("fields", "vector inputs must be an object"); return; }
  const inputs = construction.inputs;
  const knownUnits = new Set<string>();
  const length = (value: unknown): void => {
    for (const unit of scalarUnits(value, document)) {
      if (unit.length > 80) invalid("units", "vector unit strings exceed the bounded compatibility contract");
      knownUnits.add(LENGTH_UNITS[unit] ?? unit);
    }
  };
  const visited = new Set<string>();
  const collectPointUnits = (value: unknown, depth = 0): void => {
    if (depth > 32) invalid("units", "point unit provenance exceeds depth 32");
    if (Array.isArray(value)) { length(value[0]); length(value[1]); return; }
    if (isRecord(value)) { length(value.x); length(value.y); return; }
    if (typeof value !== "string") return;
    const producer = constructionByOutput.get(value);
    if (!producer || document.entities.find((entity) => entity.id === value)?.kind !== "point" || PROTECTED_POINT_PRODUCERS.has(producer.operator)) invalid("origin", "vector positions require constructed physical 2D points");
    if (visited.has(value)) return;
    visited.add(value);
    if (producer.operator === "point") { length(producer.inputs.x); length(producer.inputs.y); }
    else if (producer.operator === "affine_point") { collectPointUnits(producer.inputs.point, depth + 1); collectPointUnits(producer.inputs.translation, depth + 1); }
    else if (producer.operator === "triangle_center") for (const key of ["a", "b", "c"]) collectPointUnits(producer.inputs[key], depth + 1);
    else if (producer.operator === "triangle_from_sides" || producer.operator === "triangle_from_sas" || producer.operator === "triangle_from_asa") {
      for (const key of ["sideAB", "sideBC", "sideCA"]) length(producer.inputs[key]);
      if (producer.inputs.origin !== undefined) collectPointUnits(producer.inputs.origin, depth + 1);
    } else if (producer.operator === "conic_anchor") {
      const conic = typeof producer.inputs.conic === "string" ? constructionByOutput.get(producer.inputs.conic) : undefined;
      if (conic?.operator === "conic") {
        for (const key of ["a", "b", "p"]) length(conic.inputs[key]);
        collectPointUnits(first(conic.inputs, ["center", "vertex"]), depth + 1);
      }
    }
  };
  const collectVectorUnits = (id: string, depth = 0): void => {
    if (depth > 32) invalid("units", "vector unit provenance exceeds depth 32");
    const producer = constructionByOutput.get(id);
    if (!producer || document.entities.find((entity) => entity.id === id)?.kind !== "vector") invalid("vector", "vector arithmetic requires constructed vector entities");
    if (visited.has(id)) return;
    visited.add(id);
    if (producer.operator === "vector") {
      length(producer.inputs.length);
      collectPointUnits(first(producer.inputs, ["start", "from", "a", "origin"]), depth + 1);
      const end = first(producer.inputs, ["end", "to", "b"]);
      if (end !== undefined) collectPointUnits(end, depth + 1);
      if (isRecord(producer.inputs.direction)) { length(producer.inputs.direction.x ?? producer.inputs.direction.dx); length(producer.inputs.direction.y ?? producer.inputs.direction.dy); }
    } else if ((VECTOR_OPERATORS as readonly string[]).includes(producer.operator)) {
      for (const source of sourceIds(producer.operator, producer.inputs)) collectVectorUnits(source, depth + 1);
      collectPointUnits(producer.inputs.origin, depth + 1);
      if (producer.operator === "vector_scale") for (const unit of scalarUnits(producer.inputs.factor, document)) if (!DIMENSIONLESS_UNITS.has(unit)) invalid("factor_unit", "vector scale factor must be dimensionless");
    } else if (producer.operator === "affine_path" && typeof producer.inputs.path === "string") {
      collectVectorUnits(producer.inputs.path, depth + 1);
      if (producer.inputs.translation !== undefined) collectPointUnits(producer.inputs.translation, depth + 1);
    } else if (producer.operator === "curve_derivative") {
      knownUnits.add("unit");
      const curve = typeof producer.inputs.curve === "string" ? constructionByOutput.get(producer.inputs.curve) : undefined;
      if (!curve || !["function_curve", "parametric_curve", "polar_curve"].includes(curve.operator)) invalid("vector", "physical analytic derivatives cannot be reinterpreted as free vectors");
      const allowed = curve.operator === "function_curve" ? ["expression", "variable", "xMin", "xMax", "x_min", "x_max", "samples"]
        : curve.operator === "parametric_curve" ? ["parameter", "xExpression", "yExpression", "tMin", "tMax", "parameterMin", "parameterMax", "samples"]
        : ["parameter", "radiusExpression", "thetaMin", "thetaMax", "parameterMin", "parameterMax", "samples"];
      keys(curve.inputs, allowed, "vector");
      for (const value of [producer.inputs.at, producer.inputs.parameterScale, ...["xMin", "xMax", "x_min", "x_max", "tMin", "tMax", "thetaMin", "thetaMax", "parameterMin", "parameterMax", "samples"].map((key) => curve.inputs[key])]) {
        for (const unit of scalarUnits(value, document)) if (!DIMENSIONLESS_UNITS.has(unit) && !["rad", "radian", "radians"].includes(unit)) invalid("units", "ordinary analytic derivative composition requires dimensionless mathematical parameters");
      }
    } else invalid("vector", "physical, 3D, ray, and region constructions cannot be reinterpreted as free vectors");
  };
  const evaluating = new Set<string>();
  const context: VectorEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      if (typeof value !== "string") return originPoint(value, context);
      const producer = constructionByOutput.get(value);
      if (!producer || document.entities.find((entity) => entity.id === value)?.kind !== "point" || PROTECTED_POINT_PRODUCERS.has(producer.operator)) invalid("origin", "vector positions require constructed physical 2D points");
      if (producer.operator !== "point") throw new DeferredVectorGeometry();
      return { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) };
    },
    geometry(value) {
      if (typeof value !== "string") return undefined;
      const producer = constructionByOutput.get(value);
      if (!producer) return undefined;
      if (evaluating.has(value)) invalid("vector", "vector construction dependencies must be acyclic");
      if (producer.operator === "point") return { kind: "point", point: context.point(value) };
      if ((VECTOR_OPERATORS as readonly string[]).includes(producer.operator)) {
        evaluating.add(value);
        try { return evaluateVectorConstruction(producer.operator, producer.inputs, context)[0]; }
        finally { evaluating.delete(value); }
      }
      if (producer.operator === "vector" && producer.inputs.direction === undefined && first(producer.inputs, ["end", "to", "b"]) !== undefined) {
        return { kind: "path", directed: true, points: [context.point(first(producer.inputs, ["start", "from", "a", "origin"])), context.point(first(producer.inputs, ["end", "to", "b"]))] };
      }
      throw new DeferredVectorGeometry();
    },
  };
  try {
    const references = sourceIds(construction.operator, inputs);
    references.forEach((id) => collectVectorUnits(id));
    collectPointUnits(inputs.origin);
    if (knownUnits.size > 1) invalid("units", "vector sources and origin must use one compatible coordinate unit; source scales are not silently converted");
    if (construction.operator === "vector_scale") {
      scalar(inputs.factor, "factor", context);
      for (const unit of scalarUnits(inputs.factor, document)) if (!DIMENSIONLESS_UNITS.has(unit)) invalid("factor_unit", "vector scale factor must be dimensionless");
    }
    if (typeof inputs.origin !== "string") originPoint(inputs.origin, context);
    evaluateVectorConstruction(construction.operator, inputs, context);
  } catch (error) {
    if (error instanceof DeferredVectorGeometry) return;
    addIssue(error instanceof VectorInputError ? error.key : "geometry", error instanceof Error ? error.message : "vector inputs are invalid");
  }
}
