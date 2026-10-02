import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import type { CalculusAnchorDefinition, CalculusCurveDefinition } from "./calculusGeometry";

export const INDUCTION_OPERATORS = ["flux_process", "induction_state"] as const;
export interface InductionVector { x: number; y: number; z: number }
export interface FluxProcessDefinition {
  model: "uniform_affine"; B0: InductionVector; fieldRate: InductionVector;
  areaVector: InductionVector; areaRate: InductionVector; turns: number;
  sourceUnits: { field: "T" | "mT"; area: "m^2" | "cm^2"; time: "s" | "ms" };
  fluxUnit: "Wb" | "mWb"; coefficientsSI: { constant: number; linear: number; quadratic: number };
  tMin: number; tMax: number; origin: RenderPoint; timeScale: number; fluxScale: number; samples: number;
}
export interface InductionStateDefinition {
  processId: string; process: FluxProcessDefinition; sourceTime: number; timeSI: number;
  fluxSI: number; emfSI: number; component: "flux" | "emf";
}
export type InductionGeometry =
  | { kind: "path"; points: RenderPoint[]; fluxProcess: FluxProcessDefinition; sampledCurve: CalculusCurveDefinition }
  | { kind: "point"; point: RenderPoint; inductionState: InductionStateDefinition; calculusAnchor?: CalculusAnchorDefinition };
export interface InductionEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
const AXES = ["x", "y", "z"] as const; const MAX_SOURCE = 1e12; const MAX_PHYSICAL = 1e36; const MAX_TIME = 1e9; const MAX_SAMPLES = 1025;
const FIELD_DENOMINATOR = { T: 1, mT: 1000 } as const; const AREA_DENOMINATOR = { "m^2": 1, "cm^2": 10000 } as const; const TIME_DENOMINATOR = { s: 1, ms: 1000 } as const;
const FLUX_DENOMINATOR = { Wb: 1, mWb: 1000 } as const;
class InductionInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new InductionInputError(key, message); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void { if (Object.keys(value).some((name) => !allowed.includes(name))) invalid(key, `unsupported induction ${key} fields`); }
function finite(value: number, key: string, cap = MAX_SOURCE): number { if (!Number.isFinite(value) || Math.abs(value) > cap) invalid(key, `${key} must be finite within ${cap}`); return value === 0 ? 0 : value; }
function preserveLiteral(value: unknown, key: string): void { const match = typeof value === "string" && /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE][+-]?\d+)?$/.exec(value.trim()); if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) invalid(key, "a nonzero induction source literal cannot become certified zero"); }
function scalar(value: unknown, key: string, context: InductionEvaluationContext, cap = MAX_SOURCE, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid(key, "induction scalar wrappers must be acyclic within depth 32");
  if (record(value)) { keys(value, ["value", "unit"], key); seen.add(value); return scalar(value.value, key, context, cap, seen, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, `${key} requires an explicit finite scalar`);
  preserveLiteral(value, key);
  try { return finite(context.number(value), key, cap); } catch (error) { if (error instanceof InductionInputError) throw error; return invalid(key, `${key} requires a finite source value`); }
}
function vector(value: unknown, key: string, context: InductionEvaluationContext): InductionVector {
  if (!Array.isArray(value) || value.length !== 3) invalid(key, `${key} requires three explicit Cartesian components, including zeros`);
  return { x: scalar(value[0], `${key}.x`, context), y: scalar(value[1], `${key}.y`, context), z: scalar(value[2], `${key}.z`, context) };
}
function sourceUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) invalid("units", "induction source units must be acyclic within depth 32");
  if (record(value)) keys(value, ["value", "unit"], "quantity");
  const entry = typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : record(value) ? value : undefined;
  if (!entry) return [];
  seen.add(value);
  if (entry.unit !== undefined && (typeof entry.unit !== "string" || !entry.unit.trim())) invalid("units", "known induction units must be nonempty strings");
  return [...(typeof entry.unit === "string" ? [entry.unit.trim()] : []), ...("value" in entry ? sourceUnits(entry.value, document, seen, depth + 1) : [])];
}
function unit<K extends string>(value: unknown, supported: Readonly<Record<K, number>>, key: string): K { if (typeof value !== "string" || !Object.hasOwn(supported, value.trim())) invalid(key, `${key} requires an explicit supported unit`); return value.trim() as K; }
function declaredUnits(inputs: Record<string, unknown>): FluxProcessDefinition["sourceUnits"] {
  if (!record(inputs.units)) invalid("units", "flux_process requires field, area, and time units"); keys(inputs.units, ["field", "area", "time"], "units");
  return { field: unit(inputs.units.field, FIELD_DENOMINATOR, "fieldUnit"), area: unit(inputs.units.area, AREA_DENOMINATOR, "areaUnit"), time: unit(inputs.units.time, TIME_DENOMINATOR, "timeUnit") };
}
function checkUnits(inputs: Record<string, unknown>, document?: SceneDocument, process?: FluxProcessDefinition): void {
  const check = (value: unknown, allowed: readonly string[]): void => { for (const actual of sourceUnits(value, document)) if (!allowed.includes(actual)) invalid("units", `induction source unit ${actual} contradicts its declared physical scale`); };
  for (const name of ["timeScale", "fluxScale", "turns", "samples"]) check(inputs[name], ["1", "dimensionless", "unit", "units"]);
  const checkPlacement = (value: unknown): void => { if (Array.isArray(value)) value.forEach((entry) => check(entry, ["1", "dimensionless", "unit", "units"])); else if (record(value)) { check(value.x, ["1", "dimensionless", "unit", "units"]); check(value.y, ["1", "dimensionless", "unit", "units"]); } };
  checkPlacement(inputs.origin); checkPlacement(inputs.emfAt);
  if (inputs.B0 === undefined) { if (process) check(inputs.time, [process.sourceUnits.time]); return; }
  const units = declaredUnits(inputs);
  for (const [name, expected] of [["B0", units.field], ["fieldRate", `${units.field}/${units.time}`], ["areaVector", units.area], ["areaRate", `${units.area}/${units.time}`]] as const) if (Array.isArray(inputs[name])) for (const value of inputs[name] as unknown[]) check(value, [expected]);
  check(inputs.tMin, [units.time]); check(inputs.tMax, [units.time]);
}
function placement(value: unknown, key: string, context: InductionEvaluationContext, defaultPoint: RenderPoint = { x: 0, y: 0 }): RenderPoint {
  if (value === undefined) return { ...defaultPoint };
  if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], `${key}.x`, context), y: scalar(value[1], `${key}.y`, context) };
  if (record(value)) { keys(value, ["x", "y"], key); return { x: scalar(value.x, `${key}.x`, context), y: scalar(value.y, `${key}.y`, context) }; }
  return invalid(key, "induction display placement requires explicit inline 2D coordinates");
}
type Exact = { n: bigint; e: number }; type Polynomial = { constant: Exact; linear: Exact; quadratic: Exact };
const bits = new DataView(new ArrayBuffer(8));
function exact(value: number): Exact {
  if (value === 0) return { n: 0n, e: 0 }; bits.setFloat64(0, value); const raw = bits.getBigUint64(0); const exponent = Number((raw >> 52n) & 2047n);
  return { n: (raw >> 63n ? -1n : 1n) * ((raw & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n)), e: exponent ? exponent - 1075 : -1074 };
}
function add(a: Exact, b: Exact): Exact { const e = Math.min(a.e, b.e); return { n: (a.n << BigInt(a.e - e)) + (b.n << BigInt(b.e - e)), e }; }
function multiply(a: Exact, b: Exact): Exact { return { n: a.n * b.n, e: a.e + b.e }; }
function negative(value: Exact): Exact { return { n: -value.n, e: value.e }; }
function dot(a: InductionVector, b: InductionVector): Exact { return AXES.reduce((sum, axis) => add(sum, multiply(exact(a[axis]), exact(b[axis]))), exact(0)); }
function ratio(a: Exact, b: Exact, key: string, cap = MAX_PHYSICAL): number {
  if (b.n === 0n) invalid(key, "induction denominator must be nonzero"); if (a.n === 0n) return 0;
  const sign = (a.n < 0n) !== (b.n < 0n) ? -1 : 1; const n = a.n < 0n ? -a.n : a.n; const d = b.n < 0n ? -b.n : b.n;
  let h = n.toString(2).length - d.toString(2).length; if (h >= 0 ? n < (d << BigInt(h)) : (n << BigInt(-h)) < d) h--;
  const quantum = Math.max(h + a.e - b.e - 52, -1074); const shift = a.e - b.e - quantum;
  const numerator = shift >= 0 ? n << BigInt(shift) : n; const denominator = shift < 0 ? d << BigInt(-shift) : d;
  let q = numerator / denominator; const remainder = numerator % denominator; if (2n * remainder > denominator || 2n * remainder === denominator && q % 2n === 1n) q++;
  const result = finite(sign * Number(q) * 2 ** quantum, key, cap); const error = numerator - q * denominator;
  if (result === 0 || ((error < 0n ? -error : error) << 45n) > numerator) invalid("precision", "a nonzero induction value underflows or loses relative numeric accuracy");
  return result;
}
function coefficients(model: Pick<FluxProcessDefinition, "B0" | "fieldRate" | "areaVector" | "areaRate" | "turns">): Polynomial {
  const turns = exact(model.turns);
  return { constant: multiply(turns, dot(model.B0, model.areaVector)), linear: multiply(turns, add(dot(model.fieldRate, model.areaVector), dot(model.B0, model.areaRate))), quadratic: multiply(turns, dot(model.fieldRate, model.areaRate)) };
}
function sourceLaw(base: InductionVector, rate: InductionVector, time: number): InductionVector { return Object.fromEntries(AXES.map((axis) => [axis, ratio(add(exact(base[axis]), multiply(exact(rate[axis]), exact(time))), exact(1), "source law")])) as unknown as InductionVector; }
function areaCertificate(model: Pick<FluxProcessDefinition, "areaVector" | "areaRate" | "tMin" | "tMax">): void {
  const norm0 = dot(model.areaVector, model.areaVector); const normRate = dot(model.areaRate, model.areaRate); const cross = dot(model.areaVector, model.areaRate);
  const normAt = (time: number): Exact => { const area = sourceLaw(model.areaVector, model.areaRate, time); return dot(area, area); };
  const first = normAt(model.tMin); const last = normAt(model.tMax); if (first.n === 0n || last.n === 0n) invalid("areaVector", "oriented area must stay nonzero throughout the process domain");
  let minimum = ratio(first, exact(1), "area norm"); const lastValue = ratio(last, exact(1), "area norm"); minimum = Math.min(minimum, lastValue);
  if (normRate.n !== 0n && add(negative(cross), negative(multiply(normRate, exact(model.tMin)))).n >= 0n && add(negative(cross), negative(multiply(normRate, exact(model.tMax)))).n <= 0n) {
    const gram = add(multiply(norm0, normRate), negative(multiply(cross, cross)));
    if (gram.n <= 0n) invalid("areaVector", "oriented area vanishes inside the supplied affine process interval");
    minimum = ratio(gram, normRate, "minimum area norm");
  }
  if (minimum <= (128 * Number.EPSILON) ** 2 * Math.max(ratio(first, exact(1), "area norm"), lastValue)) invalid("precision", "area nonvanishing is ill-conditioned relative to the source-law scale");
}
function snapshot(model: FluxProcessDefinition, time: number): { fluxSI: number; emfSI: number; timeSI: number } {
  if (time < model.tMin || time > model.tMax) invalid("time", "induction state time lies outside the verified source-time domain");
  const c = coefficients(model); const t = exact(time); const denominator = exact(FIELD_DENOMINATOR[model.sourceUnits.field] * AREA_DENOMINATOR[model.sourceUnits.area]);
  const fluxSI = ratio(add(add(c.constant, multiply(c.linear, t)), multiply(c.quadratic, multiply(t, t))), denominator, "flux");
  const emfSI = ratio(negative(multiply(add(c.linear, multiply(exact(2), multiply(c.quadratic, t))), exact(TIME_DENOMINATOR[model.sourceUnits.time]))), denominator, "emf");
  return { fluxSI, emfSI, timeSI: ratio(t, exact(TIME_DENOMINATOR[model.sourceUnits.time]), "time") };
}
function mapped(model: FluxProcessDefinition, time: number, fluxSI: number): RenderPoint {
  const dx = ratio(multiply(exact(model.timeScale), exact(time)), exact(1), "geometry", MAX_SOURCE);
  const dy = ratio(multiply(multiply(exact(model.fluxScale), exact(fluxSI)), exact(FLUX_DENOMINATOR[model.fluxUnit])), exact(1), "geometry", MAX_SOURCE);
  const result = { x: finite(model.origin.x + dx, "geometry"), y: finite(model.origin.y + dy, "geometry") };
  for (const axis of ["x", "y"] as const) { const delta = axis === "x" ? dx : dy; if (delta !== 0 && (result[axis] === model.origin[axis] || Math.abs((result[axis] - model.origin[axis]) - delta) > Math.abs(delta) * 1e-8)) invalid("precision", "induction placement cannot retain source-time or flux displacement"); }
  return result;
}
function definition(inputs: Record<string, unknown>, context: InductionEvaluationContext): FluxProcessDefinition {
  keys(inputs, ["model", "B0", "fieldRate", "areaVector", "areaRate", "turns", "tMin", "tMax", "units", "fluxUnit", "origin", "timeScale", "fluxScale", "samples"]); checkUnits(inputs);
  if (inputs.model !== "uniform_affine") invalid("model", "induction requires the explicit uniform_affine field and oriented-area model");
  const B0 = vector(inputs.B0, "B0", context); const fieldRate = vector(inputs.fieldRate, "fieldRate", context); const areaVector = vector(inputs.areaVector, "areaVector", context); const areaRate = vector(inputs.areaRate, "areaRate", context);
  const turns = scalar(inputs.turns, "turns", context); if (!Number.isInteger(turns) || turns < 1 || turns > 1e6) invalid("turns", "turns must be an explicit integer 1..1000000");
  const tMin = scalar(inputs.tMin, "tMin", context, MAX_TIME); const tMax = scalar(inputs.tMax, "tMax", context, MAX_TIME); if (!(tMin < tMax)) invalid("time", "flux process requires a strictly increasing finite source-time domain");
  const timeScale = inputs.timeScale === undefined ? 1 : scalar(inputs.timeScale, "timeScale", context); const fluxScale = inputs.fluxScale === undefined ? 1 : scalar(inputs.fluxScale, "fluxScale", context);
  if (!(timeScale > 0) || !(fluxScale > 0) || !Number.isFinite(timeScale * (tMax - tMin)) || timeScale * (tMax - tMin) <= 1e-6) invalid("scale", "induction display scales must be positive with a resolved time interval");
  const samples = inputs.samples === undefined ? 65 : scalar(inputs.samples, "samples", context); if (!Number.isInteger(samples) || samples < 17 || samples > MAX_SAMPLES) invalid("samples", "quadratic flux sampling requires 17..1025 points");
  const sourceUnits = declaredUnits(inputs); const fluxUnit = inputs.fluxUnit === undefined ? "Wb" : unit(inputs.fluxUnit, FLUX_DENOMINATOR, "fluxUnit");
  const model: FluxProcessDefinition = { model: "uniform_affine", B0, fieldRate, areaVector, areaRate, turns, sourceUnits, fluxUnit, coefficientsSI: { constant: 0, linear: 0, quadratic: 0 }, tMin, tMax, origin: placement(inputs.origin, "origin", context), timeScale, fluxScale, samples };
  areaCertificate(model); sourceLaw(B0, fieldRate, tMin); sourceLaw(B0, fieldRate, tMax);
  const c = coefficients(model); const denominator = exact(FIELD_DENOMINATOR[sourceUnits.field] * AREA_DENOMINATOR[sourceUnits.area]); const timeDenominator = exact(TIME_DENOMINATOR[sourceUnits.time]);
  model.coefficientsSI = { constant: ratio(c.constant, denominator, "coefficient"), linear: ratio(multiply(c.linear, timeDenominator), denominator, "coefficient"), quadratic: ratio(multiply(c.quadratic, multiply(timeDenominator, timeDenominator)), denominator, "coefficient") };
  return model;
}
function processGeometry(model: FluxProcessDefinition): InductionGeometry {
  const evaluate = (time: number): RenderPoint => mapped(model, finite(time, "time", MAX_TIME), snapshot(model, time).fluxSI);
  const derivative = (time: number): RenderPoint => { const value = snapshot(model, finite(time, "time", MAX_TIME)); return { x: model.timeScale, y: ratio(multiply(multiply(exact(-value.emfSI), exact(model.fluxScale)), exact(FLUX_DENOMINATOR[model.fluxUnit])), exact(TIME_DENOMINATOR[model.sourceUnits.time]), "derivative", MAX_SOURCE) }; };
  let previous = -Infinity;
  const points = Array.from({ length: model.samples }, (_, index) => { const time = index === model.samples - 1 ? model.tMax : model.tMin + (model.tMax - model.tMin) * index / (model.samples - 1); if (!(time > previous)) invalid("precision", "source-time samples cannot collapse at floating precision"); previous = time; return evaluate(time); });
  return { kind: "path", points, fluxProcess: model, sampledCurve: { curveKind: "parametric", parameterMin: model.tMin, parameterMax: model.tMax, evaluate, derivative } };
}
const numericContext: InductionEvaluationContext = { number: Number, point: () => invalid("point", "source model metadata cannot use point references"), geometry: () => undefined };
function same(a: unknown, b: unknown): boolean { if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((entry, index) => same(a[index], entry)); if (record(b)) return record(a) && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([key, entry]) => same(a[key], entry)); return a === b; }
function verifiedDefinition(value: unknown): FluxProcessDefinition {
  if (!record(value)) invalid("process", "induction references require typed process metadata");
  const asArray = (entry: unknown): number[] => { if (!record(entry)) invalid("process", "induction source metadata requires Cartesian vectors"); keys(entry, AXES, "process"); if (AXES.some((axis) => typeof entry[axis] !== "number")) invalid("process", "induction source metadata must retain numerical vectors"); return AXES.map((axis) => entry[axis] as number); };
  const model = definition({ model: value.model, B0: asArray(value.B0), fieldRate: asArray(value.fieldRate), areaVector: asArray(value.areaVector), areaRate: asArray(value.areaRate), turns: value.turns, tMin: value.tMin, tMax: value.tMax, units: value.sourceUnits, fluxUnit: value.fluxUnit, origin: value.origin, timeScale: value.timeScale, fluxScale: value.fluxScale, samples: value.samples }, numericContext);
  if (!same(value, model)) invalid("process", "induction metadata contradicts its explicit source laws and SI polynomial"); return model;
}
function verifiedProcess(value: unknown): FluxProcessDefinition {
  if (!record(value) || value.kind !== "path") invalid("process", "induction_state requires a verified flux_process curve"); keys(value, ["kind", "points", "fluxProcess", "sampledCurve"], "process");
  const model = verifiedDefinition(value.fluxProcess); const expected = processGeometry(model);
  if (!("fluxProcess" in expected) || !same(value.points, expected.points) || !record(value.sampledCurve) || value.sampledCurve.curveKind !== "parametric" || value.sampledCurve.parameterMin !== model.tMin || value.sampledCurve.parameterMax !== model.tMax || typeof value.sampledCurve.evaluate !== "function" || typeof value.sampledCurve.derivative !== "function") invalid("process", "induction curve geometry must retain its analytic source-time identity");
  keys(value.sampledCurve, ["curveKind", "parameterMin", "parameterMax", "evaluate", "derivative"], "process");
  for (const time of [model.tMin, (model.tMin + model.tMax) / 2, model.tMax]) if (!same(value.sampledCurve.evaluate(time), expected.sampledCurve.evaluate(time)) || !same(value.sampledCurve.derivative(time), expected.sampledCurve.derivative!(time))) invalid("process", "induction curve callbacks contradict its source-derived polynomial");
  return model;
}
export function evaluateInductionConstruction(operator: string, inputs: Record<string, unknown>, context: InductionEvaluationContext): InductionGeometry[] {
  if (operator === "flux_process") return [processGeometry(definition(inputs, context))];
  if (operator === "induction_state") {
    keys(inputs, ["process", "time", "emfAt"]); if (typeof inputs.process !== "string" || !inputs.process.trim()) invalid("process", "induction_state requires an explicit flux_process ID");
    const time = scalar(inputs.time, "time", context, MAX_TIME); const model = verifiedProcess(context.geometry(inputs.process)); checkUnits(inputs, undefined, model);
    const values = snapshot(model, time); const state = { processId: inputs.process, process: model, sourceTime: time, ...values };
    return [{ kind: "point", point: mapped(model, time, values.fluxSI), inductionState: { ...state, component: "flux" }, calculusAnchor: { curveId: inputs.process, parameter: time } }, { kind: "point", point: placement(inputs.emfAt, "emfAt", context, model.origin), inductionState: { ...state, component: "emf" } }];
  }
  return invalid("operator", `unsupported induction operator ${operator}`);
}
function verifiedStates(outputs: readonly unknown[]): InductionStateDefinition[] {
  if (outputs.length !== 2) invalid("outputs", "induction_state requires ordered flux and emf outputs");
  return outputs.map((output, index) => {
    if (!record(output) || output.kind !== "point" || !record(output.inductionState)) invalid("outputs", "induction outputs require typed point/scalar-anchor geometry"); keys(output, index === 0 ? ["kind", "point", "inductionState", "calculusAnchor"] : ["kind", "point", "inductionState"], "outputs");
    const state = output.inductionState; keys(state, ["processId", "process", "sourceTime", "timeSI", "fluxSI", "emfSI", "component"], "outputs");
    if (typeof state.processId !== "string" || !state.processId.trim() || typeof state.sourceTime !== "number" || state.component !== (index === 0 ? "flux" : "emf")) invalid("outputs", "induction output order and source-time identity must be preserved");
    const model = verifiedDefinition(state.process); const values = snapshot(model, finite(state.sourceTime, "time", MAX_TIME));
    const expected: InductionStateDefinition = { processId: state.processId, process: model, sourceTime: state.sourceTime, ...values, component: index === 0 ? "flux" : "emf" };
    if (!same(state, expected)) invalid("outputs", "induction state metadata contradicts its flux law and signed Lenz derivative");
    if (index === 0 && (!same(output.point, mapped(model, state.sourceTime, values.fluxSI)) || !same(output.calculusAnchor, { curveId: state.processId, parameter: state.sourceTime }))) invalid("outputs", "induction flux point must have exact process incidence");
    if (index === 1) { const p = placement(output.point, "emfAt", numericContext); if (!same(p, output.point)) invalid("outputs", "emf anchor must retain finite display coordinates"); const first = outputs[0]; if (!record(first) || !record(first.inductionState) || !same({ ...state, component: "flux" }, first.inductionState)) invalid("outputs", "flux/emf state outputs must share one verified source snapshot"); }
    return expected;
  });
}
function compact(value: number): string { return value === 0 ? "0" : Math.abs(value) >= 0.001 && Math.abs(value) < 10000 ? Number(value.toPrecision(3)).toString() : value.toExponential(1).replace("e+", "e"); }
function allowedLabels(operator: string, outputs: readonly unknown[]): Array<{ symbol: string; numeric?: string }> {
  if (operator === "flux_process") { if (outputs.length !== 1) invalid("outputs", "flux_process requires one complete evaluated output"); verifiedProcess(outputs[0]); return [{ symbol: "Phi(t)" }]; }
  if (operator !== "induction_state") invalid("operator", "induction labels require a supported operator");
  return verifiedStates(outputs).map((state) => state.component === "flux" ? { symbol: "Phi(t)", numeric: `Phi=${compact(state.fluxSI)} Wb` } : { symbol: "emf(t)", numeric: `emf=${compact(state.emfSI)} V` });
}
export function inductionConstructionOutputLabels(operator: string, outputs: readonly unknown[], requestedTexts?: readonly unknown[]): string[] {
  const labels = allowedLabels(operator, outputs); if (requestedTexts !== undefined && requestedTexts.length !== labels.length) invalid("outputs", "induction label count must match every evaluated output");
  return labels.map((label, index) => { const requested = requestedTexts?.[index]; if (requested !== undefined && requested !== label.symbol && requested !== label.numeric) invalid("label", "induction labels must use their symbolic state or verified signed SI scalar"); return requested === label.numeric && label.numeric !== undefined ? label.numeric : label.symbol; });
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("quantity", "induction quantity references must be acyclic within depth 32");
  if (record(value)) { keys(value, ["value", "unit"], "quantity"); seen.add(value); return validationNumber(value.value, document, seen, depth + 1); }
  if (typeof value === "string") { const quantity = document.quantities.find((entry) => entry.id === value); if (quantity) { seen.add(value); return validationNumber(quantity.value, document, seen, depth + 1); } }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid("quantity", "induction requires explicit numeric source values"); preserveLiteral(value, "quantity"); return finite(Number(value), "quantity");
}
export function validateEvaluatedInductionLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  try {
    const labels = allowedLabels(construction.operator, outputs); const states = construction.operator === "induction_state" ? verifiedStates(outputs) : undefined;
    for (const [outputIndex, id] of construction.outputs.entries()) {
      const label = labels[outputIndex]!; const check = (text: unknown): void => { if (text !== undefined && text !== label.symbol && text !== label.numeric) invalid("label", "induction scalar labels contradict the verified source snapshot"); };
      check(document.entities.find((entity) => entity.id === id)?.label);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(id) || !["label", "callout", "badge"].includes(annotation.kind)) continue; check(annotation.text);
        if (annotation.quantityId === undefined) continue;
        if (!states) invalid("label", "a process curve has no single flux/emf scalar annotation without a state time");
        const state = states[outputIndex]!; const units = sourceUnits(annotation.quantityId, document); const actual = validationNumber(annotation.quantityId, document);
        const supported = state.component === "flux" ? ["Wb", "mWb"] : ["V", "mV"]; if (!units.length || units.some((unit) => !supported.includes(unit)) || units.some((unit) => unit !== units[0])) invalid("label", "induction scalar annotation must declare a consistent flux or emf unit scale");
        const expected = state.component === "flux" ? state.fluxSI : state.emfSI; const scaledActual = ratio(exact(actual), exact(units[0] === "mWb" || units[0] === "mV" ? 1000 : 1), "annotation");
        if (Math.abs(scaledActual - expected) > 128 * Number.EPSILON * Math.abs(expected)) invalid("label", "induction annotation contradicts its signed source-derived physical value");
      }
      for (const other of document.constructions) if (other.operator === "label" && (other.inputs.target ?? other.inputs.at ?? other.inputs.point) === id) check(other.inputs.text);
    }
  } catch (error) { issues.push({ code: `invalid_${construction.operator}_label`, severity: "fatal", message: error instanceof Error ? error.message : "induction labels are invalid", path: `constructions[${index}].outputs` }); }
}
export function validateInductionConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const add = (key: string, message: string): void => { issues.push({ code: `invalid_${construction.operator}_${key}`, severity: "fatal", message, path: `constructions[${index}].${key === "outputs" ? key : `inputs.${key}`}` }); };
  const expected = construction.operator === "flux_process" ? ["polyline"] : ["point", "label"];
  if (construction.outputs.length !== expected.length || new Set(construction.outputs).size !== expected.length || construction.outputs.some((id, outputIndex) => document.entities.find((entity) => entity.id === id)?.kind !== expected[outputIndex])) add("outputs", "induction outputs must be one polyline or ordered flux point/emf scalar label entities");
  if (!record(construction.inputs)) { add("fields", "induction inputs must be an object"); return; }
  const context: InductionEvaluationContext = {
    number(value) { return validationNumber(value, document); }, point: () => invalid("placement", "induction only accepts explicit inline display placement"),
    geometry(value) { if (typeof value !== "string") return undefined; const producer = constructionByOutput.get(value); if (!producer || producer.operator !== "flux_process" || document.entities.find((entity) => entity.id === value)?.kind !== "polyline") invalid("process", "induction_state must reference a flux_process curve"); checkUnits(producer.inputs, document); return evaluateInductionConstruction(producer.operator, producer.inputs, context)[0]; },
  };
  try {
    checkUnits(construction.inputs, document);
    if (construction.operator === "induction_state" && typeof construction.inputs.process === "string") { const producer = constructionByOutput.get(construction.inputs.process); if (producer?.operator === "flux_process") checkUnits(construction.inputs, document, definition(producer.inputs, context)); }
    validateEvaluatedInductionLabels(construction, index, document, evaluateInductionConstruction(construction.operator, construction.inputs, context), issues);
  } catch (error) { add(error instanceof InductionInputError ? error.key : "inputs", error instanceof Error ? error.message : "induction construction is invalid"); }
}
