import type { SceneConstruction, SceneDocument, SceneIssue } from "../types";
import type { KinematicStateDefinition, KinematicTrajectoryDefinition } from "./kinematicsGeometry";
import type { VectorDefinition } from "./vectorGeometry";
import type { CalculusDerivativeDefinition } from "./calculusGeometry";

const OPERATORS = new Set(["constant_acceleration_trajectory", "trajectory_state", "vector_sum", "vector_scale", "vector_projection", "curve_anchor", "curve_secant", "curve_derivative", "point_line_distance", "section_point"]);
const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const SCALAR = new RegExp(`^(${NUMBER})(?:\\s*([^\\d].*))?$`);
const PAIR = new RegExp(`^([([])\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*([)\\]])(?:\\s*(.*))?$`);
const EPSILON = 64 * Number.EPSILON;
type Dimension = { length: number; time: number; factor: number; identity?: string };
type Value = { raw: number; dimension: Dimension };
type Authority = { allowSource: boolean; values: Map<string, Value>; tuple?: [Value, Value]; tupleKeys: Set<string>; reserved: Set<string>; bare?: Value };
type Claim = { key: string; values: number[]; unit: string; approximate: boolean; tokens: string[] };
const UNITLESS: Dimension = { length: 0, time: 0, factor: 1 };
const LENGTH_FACTORS: Readonly<Record<string, number>> = { m: 1, meter: 1, meters: 1, metre: 1, metres: 1, cm: 0.01, centimeter: 0.01, centimeters: 0.01, centimetre: 0.01, centimetres: 0.01, mm: 0.001, millimeter: 0.001, millimeters: 0.001, millimetre: 0.001, millimetres: 0.001, km: 1000, kilometer: 1000, kilometers: 1000, kilometre: 1000, kilometres: 1000, um: 1e-6, "µm": 1e-6, "μm": 1e-6, micrometer: 1e-6, micrometers: 1e-6, nm: 1e-9, nanometer: 1e-9, nanometers: 1e-9, ft: 0.3048, foot: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254 };
const TIME_FACTORS: Readonly<Record<string, number>> = { s: 1, sec: 1, second: 1, seconds: 1, ms: 0.001, millisecond: 0.001, milliseconds: 0.001, us: 1e-6, "µs": 1e-6, "μs": 1e-6, microsecond: 1e-6, microseconds: 1e-6, min: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hour: 3600, hours: 3600 };
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(message: string): never { throw new Error(message); }
function key(value: string): string { return value.trim().replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (digit) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(digit))).replace(/_/g, "").replace(/\s+/g, "").toLowerCase(); }
function unit(value: string): Dimension {
  const normalized = value.trim().replace(/²/g, "^2").replace(/\s+/g, "").replace(/[A-Za-z]+/g, (word) => {
    const lower = word.toLowerCase();
    return word.length >= 4 && (LENGTH_FACTORS[lower] !== undefined || TIME_FACTORS[lower] !== undefined || ["unit", "units", "unitless", "dimensionless"].includes(lower)) ? lower : word;
  });
  if (["", "1", "unit", "units", "unitless", "dimensionless"].includes(normalized)) return UNITLESS;
  if (LENGTH_FACTORS[normalized] !== undefined) return { length: 1, time: 0, factor: LENGTH_FACTORS[normalized]! };
  if (TIME_FACTORS[normalized] !== undefined) return { length: 0, time: 1, factor: TIME_FACTORS[normalized]! };
  const compound = normalized.match(/^([^/]+)\/([^/^]+)(?:\^([12]))?$/);
  const unitlessNumerator = compound && ["1", "unit", "units", "dimensionless"].includes(compound[1]!);
  if (compound && (LENGTH_FACTORS[compound[1]!] !== undefined || unitlessNumerator) && TIME_FACTORS[compound[2]!] !== undefined) {
    const power = Number(compound[3] ?? 1);
    return { length: unitlessNumerator ? 0 : 1, time: -power, factor: (unitlessNumerator ? 1 : LENGTH_FACTORS[compound[1]!]!) / TIME_FACTORS[compound[2]!]! ** power };
  }
  if (normalized.length > 80) fail("Derived value label unit exceeds bounded compatibility capacity");
  // Other vector quantities (force, moment, etc.) retain the exact declared
  // unit identity. No conversion or equivalence is guessed for these units.
  return { length: 0, time: 0, factor: 1, identity: normalized };
}
function dimension(units: KinematicTrajectoryDefinition["sourceUnits"] | undefined, quantity: "position" | "velocity" | "acceleration" | "time"): Dimension {
  if (!units || units.length === null || units.time === null || units.length === "unit" && units.time === "unit") return UNITLESS;
  const length = unit(units.length); const time = unit(units.time);
  if (quantity === "time") return time;
  const power = quantity === "position" ? 0 : quantity === "velocity" ? 1 : 2;
  return { length: length.length, time: -power * time.time, factor: length.factor / time.factor ** power };
}
function vectorDimension(construction: SceneConstruction, vector: VectorDefinition, document: SceneDocument): Dimension {
  const byOutput = new Map(document.constructions.flatMap((producer) => producer.outputs.map((id) => [id, producer] as const)));
  const declared: Dimension[] = []; const visited = new Set<string>(); let count = 0;
  const scalar = (value: unknown): void => { quantityUnits(value, document).forEach((declaredUnit) => declared.push(unit(declaredUnit))); };
  const coordinates = (value: unknown, depth: number): void => {
    if (Array.isArray(value)) { scalar(value[0]); scalar(value[1]); }
    else if (record(value)) { scalar(value.x); scalar(value.y); }
    else if (typeof value === "string") visit(value, depth + 1);
  };
  const visit = (id: string, depth: number): void => {
    if (depth > 32 || ++count > 4096) fail("Vector unit provenance exceeds bounded verification capacity");
    if (visited.has(id)) return; visited.add(id);
    const producer = byOutput.get(id); if (!producer) return; const inputs = producer.inputs;
    if (producer.operator === "point") { scalar(inputs.x); scalar(inputs.y); return; }
    if (["vector", "line", "segment", "ray"].includes(producer.operator)) {
      scalar(inputs.length); for (const name of ["start", "end", "from", "to", "a", "b", "origin"]) if (inputs[name] !== undefined) coordinates(inputs[name], depth);
      if (record(inputs.direction)) { scalar(inputs.direction.x ?? inputs.direction.dx); scalar(inputs.direction.y ?? inputs.direction.dy); } return;
    }
    if (["vector_sum", "vector_scale", "vector_projection"].includes(producer.operator)) {
      const sources = producer.operator === "vector_sum" ? inputs.vectors : producer.operator === "vector_scale" ? [inputs.vector] : [inputs.vector, inputs.onto];
      if (Array.isArray(sources)) for (const source of sources) if (typeof source === "string") visit(source, depth + 1);
      coordinates(inputs.origin, depth); return;
    }
    if (producer.operator === "affine_point" || producer.operator === "affine_path") { coordinates(inputs.point ?? inputs.path, depth); coordinates(inputs.translation, depth); return; }
    if (["triangle_from_sides", "triangle_from_sas", "triangle_from_asa"].includes(producer.operator)) { for (const name of ["sideAB", "sideBC", "sideCA"]) scalar(inputs[name]); coordinates(inputs.origin, depth); return; }
    if (producer.operator === "triangle_center") { for (const name of ["a", "b", "c"]) coordinates(inputs[name], depth); return; }
    if (producer.operator === "conic_anchor") { if (typeof inputs.conic === "string") visit(inputs.conic, depth + 1); return; }
    if (producer.operator === "conic") { for (const name of ["a", "b", "p"]) scalar(inputs[name]); coordinates(inputs.center ?? inputs.vertex, depth); return; }
    if (["translate", "rotate", "reflect_point", "project", "midpoint"].includes(producer.operator)) { for (const name of ["point", "center", "a", "b", "line", "vector"]) coordinates(inputs[name], depth); }
  };
  vector.sourceIds.forEach((id) => visit(id, 0)); coordinates(construction.inputs.origin, 0);
  const first = declared[0]; if (!first) return UNITLESS;
  if (declared.some((value) => value.length !== first.length || value.time !== first.time || value.factor !== first.factor || value.identity !== first.identity)) fail("Vector coordinates and sources must use one declared unit scale");
  return first;
}
function put(authority: Authority, names: readonly string[], raw: number, dim = UNITLESS): void {
  if (!Number.isFinite(raw)) return;
  for (const name of names) authority.values.set(key(name), { raw, dimension: dim });
}
function tuple(authority: Authority, value: { x: number; y: number }, names: readonly string[], dim = UNITLESS): void {
  if (![value.x, value.y].every(Number.isFinite)) fail("Derived value metadata must retain finite components");
  authority.tuple = [{ raw: value.x, dimension: dim }, { raw: value.y, dimension: dim }];
  names.forEach((name) => authority.tupleKeys.add(key(name)));
}
function sourceCurve(construction: SceneConstruction, document: SceneDocument): SceneConstruction | undefined { return document.constructions.find((candidate) => candidate.outputs.includes(String(construction.inputs.curve))); }
function authorityFor(construction: SceneConstruction, geometry: unknown, document: SceneDocument): Authority {
  if (!record(geometry)) fail("Derived output is missing evaluated geometry");
  if (construction.operator === "point_line_distance") {
    if (!record(geometry.analyticLine) || geometry.analyticLine.worldUnits !== true || typeof geometry.analyticLine.distance !== "number" || !Number.isFinite(geometry.analyticLine.distance)) fail("Point-line labels require finite source-frame distance authority");
    const result: Authority = { allowSource: false, values: new Map(), tupleKeys: new Set(), reserved: new Set(["d", "distance", "length"]) };
    put(result, ["d", "distance", "length"], geometry.analyticLine.distance);
    result.bare = result.values.get("d");
    return result;
  }
  const reserved = construction.operator.startsWith("curve_")
    ? ["x", "y", "P", "r", "position", "dx/dt", "dy/dt", "dy/dx", "dC/dt", "derivative", "slope", "m", "magnitude", "mag"]
    : construction.operator.startsWith("vector_")
      ? ["x", "y", "vx", "vy", "rx", "ry", "v", "r", "a+b", "vector", "resultant", "magnitude", "mag"]
      : ["x", "y", "x0", "y0", "vx", "vy", "ax", "ay", "v0", "vx0", "vy0", "v0x", "v0y", "v", "a", "P", "r", "position", "velocity", "acceleration", "t", "time", "tMin", "tMax", "speed", "magnitude", "mag"];
  const result: Authority = { allowSource: true, values: new Map(), tupleKeys: new Set([""]), reserved: new Set(reserved.map(key)) };
  if (construction.operator === "section_point" && record(geometry.point) && typeof geometry.point.x === "number" && typeof geometry.point.y === "number" && record(geometry.analyticLine) && record(geometry.analyticLine.section)) {
    result.allowSource = false;
    const section = geometry.analyticLine.section;
    const label = document.entities.find((entity) => construction.outputs.includes(entity.id))?.label?.trim();
    const identity = /^([\p{L}][\p{L}\p{N}_'′]*)(?:\s*[=≈:]|$)/u.exec(label ?? "")?.[1];
    tuple(result, { x: geometry.point.x, y: geometry.point.y }, ["P", "r", "position", ...(identity ? [identity] : [])]);
    put(result, ["x"], geometry.point.x); put(result, ["y"], geometry.point.y);
    if (typeof section.m === "number") put(result, ["m"], section.m);
    if (typeof section.n === "number") put(result, ["n"], section.n);
    if (typeof section.parameter === "number") put(result, ["t", "parameter"], section.parameter);
    return result;
  }
  if (record(geometry.kinematicState)) {
    const state = geometry.kinematicState as unknown as KinematicStateDefinition;
    const position = dimension(state.sourceUnits, "position"); const velocity = dimension(state.sourceUnits, "velocity"); const acceleration = dimension(state.sourceUnits, "acceleration");
    put(result, ["x"], state.position.x, position); put(result, ["y"], state.position.y, position);
    put(result, ["t", "time"], state.time, dimension(state.sourceUnits, "time"));
    if (state.quantity === "position") tuple(result, state.position, ["P", "r", "position"], position);
    if (state.quantity === "velocity") {
      tuple(result, state.velocity, ["v", "velocity"], velocity); put(result, ["vx"], state.velocity.x, velocity); put(result, ["vy"], state.velocity.y, velocity);
      put(result, ["v", "|v|", "speed", "magnitude", "mag"], Math.hypot(state.velocity.x, state.velocity.y), velocity); result.bare = result.values.get("speed");
    }
    if (state.quantity === "acceleration") {
      tuple(result, state.acceleration, ["a", "acceleration"], acceleration); put(result, ["ax"], state.acceleration.x, acceleration); put(result, ["ay"], state.acceleration.y, acceleration);
      put(result, ["a", "|a|", "magnitude", "mag"], Math.hypot(state.acceleration.x, state.acceleration.y), acceleration); result.bare = result.values.get("|a|");
    }
    return result;
  }
  if (record(geometry.kinematicTrajectory)) {
    const model = geometry.kinematicTrajectory as unknown as KinematicTrajectoryDefinition;
    put(result, ["x0"], model.initialPosition.x, dimension(model.sourceUnits, "position")); put(result, ["y0"], model.initialPosition.y, dimension(model.sourceUnits, "position"));
    put(result, ["vx0", "v0x"], model.initialVelocity.x, dimension(model.sourceUnits, "velocity")); put(result, ["vy0", "v0y"], model.initialVelocity.y, dimension(model.sourceUnits, "velocity"));
    put(result, ["v0", "|v0|"], Math.hypot(model.initialVelocity.x, model.initialVelocity.y), dimension(model.sourceUnits, "velocity"));
    put(result, ["ax"], model.acceleration.x, dimension(model.sourceUnits, "acceleration")); put(result, ["ay"], model.acceleration.y, dimension(model.sourceUnits, "acceleration"));
    put(result, ["a", "|a|"], Math.hypot(model.acceleration.x, model.acceleration.y), dimension(model.sourceUnits, "acceleration"));
    put(result, ["tMin"], model.tMin, dimension(model.sourceUnits, "time")); put(result, ["tMax"], model.tMax, dimension(model.sourceUnits, "time"));
    return result;
  }
  if (record(geometry.vectorDefinition)) {
    const vector = geometry.vectorDefinition as unknown as VectorDefinition;
    const dim = vectorDimension(construction, vector, document);
    tuple(result, vector.components, ["v", "r", "a+b", "vector", "resultant"], dim);
    put(result, ["x", "vx", "rx"], vector.components.x, dim); put(result, ["y", "vy", "ry"], vector.components.y, dim);
    put(result, ["|v|", "|r|", "|a+b|", "magnitude", "mag"], vector.magnitude, dim);
    return result;
  }
  const producer = sourceCurve(construction, document);
  const protectedPhysicalCurve = producer && ["harmonic_wave", "wave_superposition", "polytropic_process", "isochoric_process", "hydrostatic_profile", "harmonic_motion", "flux_process", "elastic_profile"].includes(producer.operator);
  // Physical curve callbacks carry scaled display components. They are exact for
  // geometry, but cannot certify an unqualified physical slope/value claim.
  if (protectedPhysicalCurve) return { ...result, allowSource: false };
  const motionUnits = producer?.operator === "constant_acceleration_trajectory" && record(producer.inputs.units)
    ? { length: typeof producer.inputs.units.length === "string" ? producer.inputs.units.length : null, time: typeof producer.inputs.units.time === "string" ? producer.inputs.units.time : null } : undefined;
  if (record(geometry.calculusDerivative)) {
    const derivative = geometry.calculusDerivative as unknown as CalculusDerivativeDefinition;
    const dim = dimension(motionUnits, "velocity"); tuple(result, derivative.derivative, ["dC/dt", "derivative"], dim);
    put(result, ["dx/dt"], derivative.derivative.x, dim); put(result, ["dy/dt"], derivative.derivative.y, dim);
    if (derivative.derivative.x !== 0) put(result, ["dy/dx", "slope", "m"], derivative.derivative.y / derivative.derivative.x);
    return result;
  }
  if (construction.operator === "curve_anchor" && record(geometry.point) && typeof geometry.point.x === "number" && typeof geometry.point.y === "number") {
    const dim = dimension(motionUnits, "position"); tuple(result, { x: geometry.point.x, y: geometry.point.y }, ["P", "r", "position"], dim);
    put(result, ["x"], geometry.point.x, dim); put(result, ["y"], geometry.point.y, dim); return result;
  }
  if (construction.operator === "curve_secant" && Array.isArray(geometry.points) && record(geometry.points[0]) && record(geometry.points.at(-1))) {
    const first = geometry.points[0]; const last = geometry.points.at(-1)!;
    const dx = Number(last.x) - Number(first.x); const dy = Number(last.y) - Number(first.y);
    if (Number.isFinite(dx) && dx !== 0) put(result, ["dy/dx", "slope", "m"], dy / dx); return result;
  }
  return result;
}
/** Source binding uses the same coordinate grammar as compiled quantitative labels. */
export function readDerivedCoordinateLabelClaim(text: string): { name: string; values: [number, number]; unit: string } | null {
  const claim = parse(text);
  if (!claim || claim.values.length !== 2) return null;
  const normalized = text.trim();
  const separator = normalized.search(/[=≈:]/);
  return { name: separator < 0 ? "" : normalized.slice(0, separator).trim(), values: [claim.values[0]!, claim.values[1]!], unit: claim.unit };
}

function parse(text: unknown): Claim | null {
  if (text === undefined) return null;
  if (typeof text !== "string") fail("Derived labels must be text");
  const normalized = text.trim();
  if (/(?:\bNaN\b|\bInfinity\b|∞)/i.test(normalized)) fail("Derived quantitative labels must be finite");
  // Digits in an identifier or a symbolic function argument are identifiers,
  // not scalar claims. Equality/numeric tuples and bare numbers are claims.
  if (/^[\p{L}][\p{L}\p{N}_'′]*(?:\([^=,]*\))?$/u.test(normalized)) return null;
  if (!/[0-9]/.test(normalized) && !/(?:NaN|Infinity|∞)/i.test(normalized)) return null;
  const separator = normalized.search(/[=≈:]/); const name = separator < 0 ? "" : normalized.slice(0, separator);
  const right = separator < 0 ? normalized : normalized.slice(separator + 1).trim();
  const pair = right.match(PAIR);
  if (pair) {
    if (pair[1] === "(" ? pair[4] !== ")" : pair[4] !== "]") fail("Derived coordinate/component tuple delimiters must match");
    return { key: key(name), values: [Number(pair[2]), Number(pair[3])], unit: pair[5]?.trim() ?? "", approximate: normalized[separator] === "≈", tokens: [pair[2]!, pair[3]!] };
  }
  const scalar = right.match(SCALAR); if (scalar) return { key: key(name), values: [Number(scalar[1])], unit: scalar[2]?.trim() ?? "", approximate: normalized[separator] === "≈", tokens: [scalar[1]!] };
  return fail("Quantitative derived labels require a supported scalar/component claim with explicit meaning");
}
function preserveLiteral(value: unknown): void {
  const match = typeof value === "string" && /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE][+-]?\d+)?$/.exec(value.trim());
  if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) fail("A nonzero derived quantity literal cannot become certified zero");
}
function close(actual: number, expected: Value, declaredUnit: string, approximate = false, token = ""): void {
  preserveLiteral(token);
  const scale = declaredUnit ? unit(declaredUnit) : expected.dimension;
  if (scale.length !== expected.dimension.length || scale.time !== expected.dimension.time || scale.identity !== expected.dimension.identity) fail("Derived quantity label has incompatible physical dimensions");
  // Compare in the evaluated source scale: multiplying both tiny source
  // values into SI can underflow them to the same zero and erase a lie.
  const conversion = scale.factor === expected.dimension.factor ? 1 : scale.factor / expected.dimension.factor;
  const value = actual * conversion; const target = expected.raw;
  if (!(conversion > 0) || ![actual, conversion, value, target].every(Number.isFinite) || actual !== 0 && value === 0) fail("Derived value unit conversion must retain finite nonzero authority");
  let tolerance = EPSILON * Math.abs(target);
  if (approximate) {
    const [mantissa, exponent] = token.toLowerCase().split("e"); const decimals = mantissa?.split(".")[1]?.length ?? 0;
    tolerance += 0.5 * 10 ** (Number(exponent ?? 0) - decimals) * conversion;
  }
  if (actual === 0 && expected.raw !== 0 || Math.abs(value - target) > tolerance) fail("Derived value label contradicts its evaluated mathematical value");
}
function numberValue(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) fail("Derived annotation numeric source is cyclic or too deep");
  if (typeof value === "number" && Number.isFinite(value)) return value; seen.add(value);
  if (record(value) && "value" in value) return numberValue(value.value, document, seen, depth + 1);
  if (typeof value === "string" && value.trim()) { const quantity = document.quantities.find((candidate) => candidate.id === value); if (quantity) return numberValue(quantity.value, document, seen, depth + 1); preserveLiteral(value); const result = Number(value); if (Number.isFinite(result)) return result; }
  return fail("Derived annotation value must resolve to a finite source quantity");
}
function quantityUnits(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) fail("Derived annotation units are cyclic or too deep"); seen.add(value);
  const entry = typeof value === "string" ? document.quantities.find((candidate) => candidate.id === value) : record(value) ? value : undefined;
  if (!entry) return []; return [...(typeof entry.unit === "string" && entry.unit.trim() ? [entry.unit] : []), ...("value" in entry ? quantityUnits(entry.value, document, seen, depth + 1) : [])];
}
function sourceClaim(claim: Claim, document: SceneDocument): boolean {
  if (claim.values.length !== 1 || !claim.key) return false;
  const quantity = document.quantities.find((candidate) => key(candidate.id) === claim.key || typeof candidate.symbol === "string" && key(candidate.symbol) === claim.key);
  if (!quantity) return false;
  const units = quantityUnits(quantity, document);
  const expected = numberValue(quantity.value, document);
  if (units.length && units.some((value) => value.trim() !== units[0]!.trim())) fail("Source quantity label has conflicting nested units");
  if (!claim.unit) { close(claim.values[0]!, { raw: expected, dimension: UNITLESS }, "", claim.approximate, claim.tokens[0]); return true; }
  if (!units.length) fail("Source quantity claim invents undeclared physical units");
  try { close(claim.values[0]!, { raw: expected, dimension: unit(units[0]!) }, claim.unit, claim.approximate, claim.tokens[0]); }
  catch (error) { if (claim.unit.trim() !== units[0]!.trim()) throw error; close(claim.values[0]!, { raw: expected, dimension: UNITLESS }, "", claim.approximate, claim.tokens[0]); }
  return true;
}
function checkClaim(claim: Claim, authority: Authority, document: SceneDocument, allowSource: boolean): void {
  if (claim.values.length === 2) {
    if (!authority.tuple || !authority.tupleKeys.has(claim.key)) fail("Derived coordinate/component tuple has no unambiguous evaluated authority");
    claim.values.forEach((value, index) => close(value, authority.tuple![index]!, claim.unit, claim.approximate, claim.tokens[index])); return;
  }
  const value = claim.key ? authority.values.get(claim.key) : authority.bare;
  if (value) { close(claim.values[0]!, value, claim.unit, claim.approximate, claim.tokens[0]); return; }
  if (authority.reserved.has(claim.key) || authority.tupleKeys.has(claim.key) || /^\|.+\|$/.test(claim.key)) fail("A source quantity cannot replace unsupported derived coordinate/component/magnitude authority");
  if (allowSource && sourceClaim(claim, document)) return;
  fail("Derived scalar label needs an explicit supported component, magnitude, coordinate, or slope meaning");
}

/** Checks quantitative claims against evaluated mathematical metadata, without authoring labels. */
export function validateEvaluatedDerivedValueLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): boolean {
  if (!OPERATORS.has(construction.operator)) return false;
  construction.outputs.forEach((id, outputIndex) => {
    const add = (error: unknown, path: string): void => { issues.push({ code: "invalid_derived_value_label", message: error instanceof Error ? error.message : "Derived value label is invalid", severity: "fatal", path, entityIds: [id] }); };
    if (construction.operator === "point_line_distance") {
      const geometry = outputs[outputIndex];
      if (record(geometry) && geometry.kind === "path") {
        const endpoint = Array.isArray(geometry.points) ? geometry.points.at(-1) : undefined;
        const foot = record(geometry.analyticLine) ? geometry.analyticLine.foot : undefined;
        if (!record(endpoint) || !record(foot) || typeof endpoint.x !== "number" || typeof endpoint.y !== "number" || typeof foot.x !== "number" || typeof foot.y !== "number" || Math.hypot(endpoint.x - foot.x, endpoint.y - foot.y) > EPSILON * Math.max(1, Math.hypot(foot.x, foot.y))) add("A scene distance connector must end at its certified perpendicular foot", `constructions[${index}].inputs.displayLength`);
      }
    }
    const checkText = (text: unknown, path: string): void => {
      try { const claim = parse(text); if (claim) { const authority = authorityFor(construction, outputs[outputIndex], document); checkClaim(claim, authority, document, authority.allowSource); } } catch (error) { add(error, path); }
    };
    const entityIndex = document.entities.findIndex((entity) => entity.id === id); checkText(document.entities[entityIndex]?.label, `entities[${entityIndex}].label`);
    document.annotations.forEach((annotation, annotationIndex) => {
      if (!annotation.targetIds.includes(id) || !["label", "callout", "badge"].includes(annotation.kind)) return;
      checkText(annotation.text, `annotations[${annotationIndex}].text`);
      if (annotation.quantityId === undefined) return;
      try {
        const quantity = document.quantities.find((candidate) => candidate.id === annotation.quantityId); if (!quantity) fail("Derived quantity annotation must reference a known source quantity");
        const symbol = typeof quantity.symbol === "string" ? quantity.symbol : quantity.id;
        const declared = quantityUnits(quantity, document); const authority = authorityFor(construction, outputs[outputIndex], document);
        const value = authority.values.get(key(symbol)); if (!value) fail("Derived quantity annotation needs an unambiguous computed scalar meaning");
        const units = declared.length ? declared : [""];
        for (const declaredUnit of units) close(numberValue(quantity.value, document), value, declaredUnit);
      } catch (error) { add(error, `annotations[${annotationIndex}].quantityId`); }
    });
    document.constructions.forEach((label, labelIndex) => { if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) checkText(label.inputs.text, `constructions[${labelIndex}].inputs.text`); });
    if (outputs[outputIndex] === undefined) add("Derived result is unavailable", `constructions[${index}].outputs[${outputIndex}]`);
  });
  return true;
}
