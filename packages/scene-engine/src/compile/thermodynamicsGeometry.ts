import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const THERMODYNAMICS_OPERATORS = ["polytropic_process", "isochoric_process", "process_state"] as const;
export type ThermodynamicsOperator = (typeof THERMODYNAMICS_OPERATORS)[number];
export type PressureUnit = "Pa" | "kPa" | "bar";
export type VolumeUnit = "m^3" | "L" | "cm^3";
export interface ThermodynamicProcessDefinition {
  kind: "polytropic" | "isochoric";
  exponent: number | null;
  pressureStart: number;
  pressureEnd: number;
  volumeStart: number;
  volumeEnd: number;
  pressureStartSI: number;
  pressureEndSI: number;
  volumeStartSI: number;
  volumeEndSI: number;
  pressureUnit: PressureUnit;
  volumeUnit: VolumeUnit;
  workJ: number;
  renderedEquation: string;
  origin: RenderPoint;
  pressureScale: number;
  volumeScale: number;
  samples: number;
}
export interface ThermodynamicStateDefinition {
  processId: string;
  at: number;
  pressureSI: number;
  volumeSI: number;
  pressureSource: number;
  volumeSource: number;
  pressureUnit: PressureUnit;
  volumeUnit: VolumeUnit;
}
export type ThermodynamicsGeometry =
  | { kind: "point"; point: RenderPoint; thermodynamicState: ThermodynamicStateDefinition; calculusAnchor: { curveId: string; parameter: number } }
  | { kind: "path"; points: RenderPoint[]; physicalProcess: ThermodynamicProcessDefinition;
    sampledCurve: { curveKind: "parametric"; parameterMin: 0; parameterMax: 1; evaluate(at: number): RenderPoint; derivative(at: number): RenderPoint } };
export interface ThermodynamicsEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
const MAX_SOURCE = 1e12;
const MAX_PHYSICAL = 1e15;
const MAX_SAMPLES = 513;
const MIN_LENGTH = 1e-6;
const RELATIVE_ERROR = 64 * Number.EPSILON;
const INPUT_KEYS = {
  polytropic_process: ["pressureStart", "volumeStart", "volumeEnd", "exponent", "pressureUnit", "volumeUnit", "origin", "pressureScale", "volumeScale", "samples"],
  isochoric_process: ["volume", "pressureStart", "pressureEnd", "pressureUnit", "volumeUnit", "origin", "pressureScale", "volumeScale", "samples"],
  process_state: ["process", "at"],
} as const;
class ThermodynamicsInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new ThermodynamicsInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isOperator(operator: string): operator is ThermodynamicsOperator { return (THERMODYNAMICS_OPERATORS as readonly string[]).includes(operator); }
function inputKeys(inputs: Record<string, unknown>, allowed: readonly string[], key = "input"): void { for (const name of Object.keys(inputs)) if (!allowed.includes(name)) invalid(key, `thermodynamics construction does not accept ${name}`); }
function scalar(value: unknown, key: string, context: ThermodynamicsEvaluationContext, positive = false): number {
  try { const result = context.number(value); if (!Number.isFinite(result) || Math.abs(result) > MAX_SOURCE || positive && !(result > 0)) invalid(key, `${key} must be finite${positive ? " and positive" : ""} with magnitude no greater than ${MAX_SOURCE}`); return result; }
  catch (error) { if (error instanceof ThermodynamicsInputError) throw error; return invalid(key, `${key} must resolve to a finite number`); }
}
function checkedPhysical(value: number, key: string): number { if (!(value > 0) || !Number.isFinite(value) || value > MAX_PHYSICAL) invalid(key, `${key} must remain positive and finite within SI bounds`); return value; }
function originInput(value: unknown, context: ThermodynamicsEvaluationContext): RenderPoint {
  if (value === undefined) return { x: 0, y: 0 };
  if (isRecord(value)) inputKeys(value, ["x", "y"], "origin");
  if (!(Array.isArray(value) && value.length === 2) && !(isRecord(value) && "x" in value && "y" in value)) invalid("origin", "origin must be an inline 2D display point");
  try { return checkedPoint(context.point(value)); } catch (error) { if (error instanceof ThermodynamicsInputError) throw error; return invalid("origin", "origin must resolve to finite display coordinates"); }
}
function checkedPoint(point: RenderPoint): RenderPoint { if (![point.x, point.y].every((value) => Number.isFinite(value) && Math.abs(value) <= MAX_SOURCE)) invalid("precision", "PV display coordinates exceed finite bounds"); return { x: point.x, y: point.y }; }
function logRatio(end: number, start: number): number { const relative = (end - start) / start; return Number.isFinite(relative) && Math.abs(relative) < 0.5 ? Math.log1p(relative) : Math.log(end) - Math.log(start); }
function pressureAt(model: ThermodynamicProcessDefinition, volume: number): number {
  if (model.kind === "isochoric") invalid("process", "isochoric pressure uses its explicit pressure parameter");
  return checkedPhysical(model.pressureStart * Math.exp(-model.exponent! * logRatio(volume, model.volumeStart)), "pressure");
}
function workIntegral(pressureSI: number, startSI: number, logR: number, exponent: number): number {
  const x = (1 - exponent) * logR;
  const relativeIntegral = x === 0 ? 1 : Math.expm1(x) / x;
  let magnitude = Math.abs(pressureSI * startSI * logR * relativeIntegral);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    const logRelative = x === 0 ? 0 : x > 50 ? x + Math.log1p(-Math.exp(-x)) - Math.log(x) : Math.log(Math.abs(Math.expm1(x))) - Math.log(Math.abs(x));
    magnitude = Math.exp(Math.log(pressureSI) + Math.log(startSI) + Math.log(Math.abs(logR)) + logRelative);
  }
  if (!(magnitude > 0) || !Number.isFinite(magnitude) || magnitude > MAX_PHYSICAL) invalid("work", "nonzero PV work is unresolved or exceeds finite SI bounds");
  return Math.sign(logR) * magnitude;
}
function readProcess(operator: "polytropic_process" | "isochoric_process", inputs: Record<string, unknown>, context: ThermodynamicsEvaluationContext): ThermodynamicProcessDefinition {
  const pressureUnit = typeof inputs.pressureUnit === "string" ? pressureCanonical(inputs.pressureUnit) : undefined;
  const volumeUnit = typeof inputs.volumeUnit === "string" ? volumeCanonical(inputs.volumeUnit) : undefined;
  if (!pressureUnit) invalid("pressureUnit", "pressureUnit must declare Pa, kPa, or bar"); if (!volumeUnit) invalid("volumeUnit", "volumeUnit must declare m^3, L, or cm^3");
  const pressureStart = scalar(inputs.pressureStart, "pressureStart", context, true);
  const volumeStart = scalar(operator === "isochoric_process" ? inputs.volume : inputs.volumeStart, "volumeStart", context, true);
  const volumeEnd = operator === "isochoric_process" ? volumeStart : scalar(inputs.volumeEnd, "volumeEnd", context, true);
  const exponent = operator === "polytropic_process" ? scalar(inputs.exponent, "exponent", context) : null;
  if (exponent !== null && Math.abs(exponent) > 64) invalid("exponent", "explicit exponent magnitude must be no greater than 64");
  const logarithm = operator === "polytropic_process" ? logRatio(volumeEnd, volumeStart) : 0;
  if (operator === "polytropic_process" && Math.abs(logarithm) <= RELATIVE_ERROR) invalid("domain", "volume endpoints must be distinct at physical precision");
  const pressureEnd = operator === "isochoric_process" ? scalar(inputs.pressureEnd, "pressureEnd", context, true) : checkedPhysical(pressureStart * Math.exp(-exponent! * logarithm), "pressureEnd");
  if (operator === "isochoric_process" && Math.abs(pressureEnd - pressureStart) <= RELATIVE_ERROR * Math.max(pressureStart, pressureEnd)) invalid("domain", "isochoric pressure endpoints must be distinct at physical precision");
  const pressureStartSI = checkedPhysical(pressureStart * PRESSURE_FACTORS[pressureUnit], "pressureStartSI");
  const pressureEndSI = checkedPhysical(pressureEnd * PRESSURE_FACTORS[pressureUnit], "pressureEndSI");
  const volumeStartSI = checkedPhysical(volumeStart * VOLUME_FACTORS[volumeUnit], "volumeStartSI"); const volumeEndSI = checkedPhysical(volumeEnd * VOLUME_FACTORS[volumeUnit], "volumeEndSI");
  const pressureScale = scalar(inputs.pressureScale, "pressureScale", context, true); const volumeScale = scalar(inputs.volumeScale, "volumeScale", context, true);
  const samples = inputs.samples === undefined ? 65 : scalar(inputs.samples, "samples", context);
  if (!Number.isInteger(samples) || samples < 3 || samples > MAX_SAMPLES) invalid("samples", `samples must be an integer from 3 to ${MAX_SAMPLES}`);
  checkSourceUnits(operator, inputs, pressureUnit, volumeUnit);
  const workJ = operator === "isochoric_process" ? 0 : workIntegral(pressureStartSI, volumeStartSI, logarithm, exponent!);
  return { kind: operator === "isochoric_process" ? "isochoric" : "polytropic", exponent, pressureStart, pressureEnd, volumeStart, volumeEnd,
    pressureStartSI, pressureEndSI, volumeStartSI, volumeEndSI, pressureUnit, volumeUnit, workJ,
    renderedEquation: operator === "isochoric_process" ? "V=constant" : `P=P0(V0/V)^${exponent}`, origin: originInput(inputs.origin, context), pressureScale, volumeScale, samples };
}
function physicalState(model: ThermodynamicProcessDefinition, at: number): Omit<ThermodynamicStateDefinition, "processId"> {
  if (!Number.isFinite(at) || at < 0 || at > 1) invalid("at", "process parameter must lie from 0 to 1");
  const volumeSource = model.kind === "isochoric" || at === 0 ? model.volumeStart : at === 1 ? model.volumeEnd : (1 - at) * model.volumeStart + at * model.volumeEnd;
  const pressureSource = at === 0 ? model.pressureStart : at === 1 ? model.pressureEnd : model.kind === "isochoric" ? (1 - at) * model.pressureStart + at * model.pressureEnd : pressureAt(model, volumeSource);
  return { at, pressureSource, volumeSource, pressureSI: checkedPhysical(pressureSource * PRESSURE_FACTORS[model.pressureUnit], "pressureSI"), volumeSI: checkedPhysical(volumeSource * VOLUME_FACTORS[model.volumeUnit], "volumeSI"), pressureUnit: model.pressureUnit, volumeUnit: model.volumeUnit };
}
function displayState(model: ThermodynamicProcessDefinition, at: number): RenderPoint {
  const state = physicalState(model, at); const local = { x: state.volumeSource * model.volumeScale, y: state.pressureSource * model.pressureScale };
  if (!(local.x > 0) || !(local.y > 0)) invalid("precision", "positive physical pressure and volume cannot underflow to zero on a display axis");
  const point = checkedPoint({ x: model.origin.x + local.x, y: model.origin.y + local.y });
  for (const axis of ["x", "y"] as const) if (Math.abs((point[axis] - model.origin[axis]) - local[axis]) > Math.abs(local[axis]) * 1e-8) invalid("precision", "PV display translation cannot preserve the physical values");
  return point;
}
function changingAxes(model: ThermodynamicProcessDefinition): readonly ("x" | "y")[] {
  return model.kind === "isochoric" ? ["y"] : model.exponent === 0 ? ["x"] : ["x", "y"];
}
function scaledChange(value: number, scale: number): number {
  const result = value * scale;
  if (value === 0 || result === 0 || !Number.isFinite(result)) invalid("precision", "a physically changing PV axis cannot collapse or underflow at numeric precision");
  return result;
}
function assertDisplayChanges(model: ThermodynamicProcessDefinition, points: readonly RenderPoint[]): void {
  const axes = changingAxes(model);
  for (const axis of axes) if (!(Math.abs(points.at(-1)![axis] - points[0]![axis]) > MIN_LENGTH)) invalid("precision", "every physically changing PV axis must remain visible at display precision");
  for (let index = 1; index < points.length; index++) {
    const before = physicalState(model, (index - 1) / (points.length - 1)); const after = physicalState(model, index / (points.length - 1));
    for (const axis of axes) {
      const physicalDelta = axis === "x" ? after.volumeSource - before.volumeSource : after.pressureSource - before.pressureSource;
      const expected = scaledChange(physicalDelta, axis === "x" ? model.volumeScale : model.pressureScale);
      const actual = points[index]![axis] - points[index - 1]![axis];
      if (Math.abs(actual - expected) > Math.abs(expected) * 1e-8) invalid("precision", "each changing PV axis must retain the source change after display scaling and translation");
    }
  }
}
/** Raw display scales never change the normalized physical state or SI work. */
export function evaluateThermodynamicsConstruction(operator: string, inputs: Record<string, unknown>, context: ThermodynamicsEvaluationContext): ThermodynamicsGeometry[] {
  if (!isOperator(operator)) invalid("operator", `unsupported thermodynamics operator ${operator}`); inputKeys(inputs, INPUT_KEYS[operator]);
  if (operator === "process_state") {
    const model = processReference(inputs.process, context); const at = scalar(inputs.at, "at", context);
    for (const unit of sourceUnits(inputs.at)) if (!["1", "dimensionless", "unit", "units"].includes(unit.trim().toLowerCase())) invalid("units", "process at must be dimensionless");
    const state = physicalState(model, at);
    return [{ kind: "point", point: displayState(model, at), thermodynamicState: { processId: String(inputs.process), ...state }, calculusAnchor: { curveId: String(inputs.process), parameter: at } }];
  }
  const model = readProcess(operator, inputs, context);
  const points = Array.from({ length: model.samples }, (_, index) => displayState(model, index / (model.samples - 1)));
  assertDisplayChanges(model, points);
  const span = Math.hypot(Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)), Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)));
  if (span <= MIN_LENGTH) invalid("precision", "PV process is indistinguishable from a point at display precision");
  return [{ kind: "path", points, physicalProcess: model, sampledCurve: { curveKind: "parametric", parameterMin: 0, parameterMax: 1, evaluate: (at) => displayState(model, at), derivative(at) {
    const state = physicalState(model, at); const dVolume = model.volumeEnd - model.volumeStart;
    const dPressure = model.kind === "isochoric" ? model.pressureEnd - model.pressureStart : -model.exponent! * state.pressureSource * dVolume / state.volumeSource;
    const axes = changingAxes(model);
    return checkedPoint({ x: axes.includes("x") ? scaledChange(dVolume, model.volumeScale) : 0, y: axes.includes("y") ? scaledChange(dPressure, model.pressureScale) : 0 });
  } } }];
}
function labelMetadata(geometry: unknown): { process?: ThermodynamicProcessDefinition; state?: ThermodynamicStateDefinition } | null {
  if (!isRecord(geometry)) return null;
  if (isRecord(geometry.physicalProcess) && typeof geometry.physicalProcess.workJ === "number") return { process: geometry.physicalProcess as unknown as ThermodynamicProcessDefinition };
  if (isRecord(geometry.thermodynamicState) && typeof geometry.thermodynamicState.pressureSI === "number" && typeof geometry.thermodynamicState.volumeSI === "number") return { state: geometry.thermodynamicState as unknown as ThermodynamicStateDefinition };
  return null;
}
function workLabel(workJ: number): string {
  const rounded = Number(workJ.toPrecision(3));
  const compact = rounded.toString(); const value = compact.length > 10 ? rounded.toExponential().replace("e+", "e") : compact;
  return `W=${value} J`;
}
function workRequested(text: unknown): boolean { return typeof text === "string" && /^\s*W(?:\s*=|\s*$)/i.test(text); }
export function thermodynamicsGeometryLabel(geometry: unknown, requestedText?: unknown): string | null {
  const metadata = labelMetadata(geometry); if (!metadata) return null;
  const label = metadata.process ? workRequested(requestedText) ? workLabel(metadata.process.workJ) : metadata.process.renderedEquation : `P=${Number(metadata.state!.pressureSource.toPrecision(3))} ${metadata.state!.pressureUnit}`;
  return typeof label === "string" && label.length <= 16 ? label : metadata.process ? workRequested(requestedText) ? "W" : "PV" : "P";
}
function checkLabel(text: unknown, geometry: unknown): void {
  if (text === undefined) return; const metadata = labelMetadata(geometry);
  if (typeof text !== "string") invalid("label", "PV labels must be mathematical source/process text or verified quantities");
  const allowed = metadata?.process ? ["W", "PV"] : metadata?.state ? ["P", "V", "PV"] : [];
  if (allowed.includes(text) || text === thermodynamicsGeometryLabel(geometry)) return;
  if (metadata?.process) {
    // The compact computed label has its own canonical authority, independent of the source-law default.
    if (text === workLabel(metadata.process.workJ)) return;
    const match = /^\s*W\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(J|kJ|joules?|kilojoules?)\s*$/i.exec(text.replaceAll("−", "-"));
    if (match) {
      const authority = annotationAuthority(geometry, match[2]!); const actual = Number(match[1]) * authority.factor;
      if (Number.isFinite(actual) && Math.abs(actual - authority.expected) <= RELATIVE_ERROR * Math.abs(authority.expected)) return;
    }
  }
  invalid("label", "PV labels must use the supplied process law, computed state text, or independently verified work");
}
function annotationAuthority(geometry: unknown, unit: string): { expected: number; factor: number; quantity: string } {
  const metadata = labelMetadata(geometry); const normalized = unit.trim().toLowerCase();
  if (metadata?.process) {
    const factor = ["j", "joule", "joules"].includes(normalized) ? 1 : ["kj", "kilojoule", "kilojoules"].includes(normalized) ? 1000 : null;
    if (factor === null) invalid("label", "PV process magnitude annotations must reference computed SI work");
    return { expected: metadata.process.workJ, factor, quantity: "work" };
  }
  const pressure = pressureCanonical(unit); const volume = volumeCanonical(unit);
  if (metadata?.state && pressure) return { expected: metadata.state.pressureSI, factor: PRESSURE_FACTORS[pressure], quantity: "pressure" };
  if (metadata?.state && volume) return { expected: metadata.state.volumeSI, factor: VOLUME_FACTORS[volume], quantity: "volume" };
  return invalid("label", "PV state annotations must reference its computed pressure or volume");
}
/** Independently guards every textual or quantity result against evaluated SI authority. */
export function validateEvaluatedThermodynamicsLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  if (!isOperator(construction.operator)) return;
  const add = (message: string): void => { issues.push({ code: `invalid_${construction.operator}_label`, message, severity: "fatal", path: `constructions[${index}].outputs` }); };
  for (const [outputIndex, id] of (Array.isArray(construction.outputs) ? construction.outputs : []).entries()) {
    const geometry = outputs[outputIndex];
    try {
      if (!labelMetadata(geometry)) invalid("label", "PV result is missing computed physical authority");
      checkLabel(document.entities.find((entity) => entity.id === id)?.label, geometry);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(id) || annotation.kind !== "label" && annotation.kind !== "callout") continue;
        checkLabel(annotation.text, geometry);
        if (annotation.quantityId !== undefined) {
          const units = sourceUnits(annotation.quantityId, document); if (!units.length) invalid("label", "PV quantity annotation must declare the physical unit");
          const authorities = units.map((unit) => annotationAuthority(geometry, unit)); const first = authorities[0]!;
          if (authorities.some((authority) => authority.factor !== first.factor || authority.quantity !== first.quantity)) invalid("label", "PV annotation has conflicting nested units");
          const actual = validationNumber(annotation.quantityId, document) * first.factor;
          if (!Number.isFinite(actual) || Math.abs(actual - first.expected) > RELATIVE_ERROR * Math.abs(first.expected)) invalid("label", "PV annotation contradicts the computed physical value");
        }
      }
      for (const labelConstruction of document.constructions) if (labelConstruction.operator === "label" && (labelConstruction.inputs.target ?? labelConstruction.inputs.at ?? labelConstruction.inputs.point) === id) checkLabel(labelConstruction.inputs.text, geometry);
    } catch (error) { add(error instanceof Error ? error.message : "PV result label is invalid"); }
  }
}
export function validateThermodynamicsConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const { operator, inputs } = construction; if (!isOperator(operator)) return;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const add = (key: string, message: string, actual?: unknown): void => { issues.push({ code: `invalid_${operator}_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`, entityIds: outputs, actual }); };
  if (outputs.length !== 1 || typeof outputs[0] !== "string" || !outputs[0].trim()) add("outputs", `${operator} requires exactly one output`, construction.outputs);
  const expectedKind = operator === "process_state" ? "point" : "polyline";
  if (document.entities.find((entity) => entity.id === outputs[0])?.kind !== expectedKind) add("output_kind", `${operator} output must be a ${expectedKind}`);
  if (!isRecord(inputs)) { add("inputs", "PV construction inputs must be an object"); return; }
  const context: ThermodynamicsEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      if (Array.isArray(value) && value.length === 2 && value.every((coordinate) => typeof coordinate === "number")) return { x: value[0] as number, y: value[1] as number };
      if (isRecord(value) && typeof value.x === "number" && typeof value.y === "number") return { x: value.x, y: value.y }; throw new Error("invalid inline display point");
    },
    geometry(value) {
      const producer = typeof value === "string" ? constructionByOutput.get(value) : undefined;
      if (!producer || producer.operator !== "polytropic_process" && producer.operator !== "isochoric_process" || document.entities.find((entity) => entity.id === value)?.kind !== "polyline") invalid("process", "process_state requires a computed PV process");
      const model = readProcess(producer.operator, producer.inputs, context); checkSourceUnits(producer.operator, producer.inputs, model.pressureUnit, model.volumeUnit, document);
      return evaluateThermodynamicsConstruction(producer.operator, producer.inputs, context)[0];
    },
  };
  try {
    if (operator !== "process_state") { const model = readProcess(operator, inputs, context); checkSourceUnits(operator, inputs, model.pressureUnit, model.volumeUnit, document); }
    else for (const unit of sourceUnits(inputs.at, document)) if (!["1", "dimensionless", "unit", "units"].includes(unit.trim().toLowerCase())) invalid("units", "process at must be dimensionless");
    validateEvaluatedThermodynamicsLabels(construction, index, document, evaluateThermodynamicsConstruction(operator, inputs, context), issues);
  } catch (error) { add(error instanceof ThermodynamicsInputError ? error.key : "inputs", error instanceof Error ? error.message : "PV construction is invalid"); }
}
function processReference(value: unknown, context: ThermodynamicsEvaluationContext): ThermodynamicProcessDefinition {
  if (typeof value !== "string" || !value.trim()) invalid("process", "process_state requires a computed PV process reference");
  let geometry: unknown; try { geometry = context.geometry(value); } catch { return invalid("process", "process_state requires a computed PV process reference"); }
  if (!isRecord(geometry) || geometry.kind !== "path" || !isRecord(geometry.physicalProcess)) invalid("process", "reference does not carry a computed physical PV model");
  const source = geometry.physicalProcess;
  if (source.kind !== "polytropic" && source.kind !== "isochoric") invalid("process", "PV model kind is unsupported");
  const model = readProcess(source.kind === "polytropic" ? "polytropic_process" : "isochoric_process", {
    pressureStart: source.pressureStart, pressureEnd: source.pressureEnd, volume: source.volumeStart, volumeStart: source.volumeStart, volumeEnd: source.volumeEnd, exponent: source.exponent,
    pressureUnit: source.pressureUnit, volumeUnit: source.volumeUnit, pressureScale: source.pressureScale, volumeScale: source.volumeScale, samples: source.samples, origin: source.origin,
  }, context);
  for (const key of ["pressureStartSI", "pressureEndSI", "volumeStartSI", "volumeEndSI", "workJ"] as const) if (source[key] !== model[key]) invalid("process", "PV physical metadata contradicts its source model");
  return model;
}
const PRESSURE_FACTORS: Readonly<Record<PressureUnit, number>> = { Pa: 1, kPa: 1000, bar: 100000 };
const VOLUME_FACTORS: Readonly<Record<VolumeUnit, number>> = { "m^3": 1, L: 0.001, "cm^3": 0.000001 };
function pressureCanonical(unit: string): PressureUnit | undefined { const units: Readonly<Record<string, PressureUnit>> = { pa: "Pa", pascal: "Pa", pascals: "Pa", kpa: "kPa", kilopascal: "kPa", kilopascals: "kPa", bar: "bar", bars: "bar" }; return units[unit.trim().toLowerCase()]; }
function volumeCanonical(unit: string): VolumeUnit | undefined { const units: Readonly<Record<string, VolumeUnit>> = { "m^3": "m^3", "m³": "m^3", l: "L", liter: "L", liters: "L", litre: "L", litres: "L", "cm^3": "cm^3", "cm³": "cm^3" }; return units[unit.trim().toLowerCase()]; }
function sourceUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) return []; seen.add(value);
  const record = typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : isRecord(value) ? value : undefined;
  if (!record) return []; const units = typeof record.unit === "string" && record.unit.trim() ? [record.unit] : [];
  return "value" in record ? [...units, ...sourceUnits(record.value, document, seen, depth + 1)] : units;
}
function checkSourceUnits(operator: string, inputs: Record<string, unknown>, pressureUnit: PressureUnit, volumeUnit: VolumeUnit, document?: SceneDocument): void {
  for (const key of operator === "isochoric_process" ? ["pressureStart", "pressureEnd"] : ["pressureStart"]) for (const unit of sourceUnits(inputs[key], document)) if (pressureCanonical(unit) !== pressureUnit) invalid("units", `${key} must use the declared pressure scale`);
  for (const key of operator === "isochoric_process" ? ["volume"] : ["volumeStart", "volumeEnd"]) for (const unit of sourceUnits(inputs[key], document)) if (volumeCanonical(unit) !== volumeUnit) invalid("units", `${key} must use the declared volume scale`);
  for (const key of ["exponent", "pressureScale", "volumeScale", "samples"]) for (const unit of sourceUnits(inputs[key], document)) if (!["1", "dimensionless", "unit", "units"].includes(unit.trim().toLowerCase())) invalid("units", `${key} must be a dimensionless construction parameter`);
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("quantity", "cyclic or overdeep thermodynamic numeric source");
  if (typeof value === "number" && Number.isFinite(value)) return value; seen.add(value);
  if (isRecord(value) && "value" in value) return validationNumber(value.value, document, seen, depth + 1);
  if (typeof value === "string" && value.trim()) { const quantity = document.quantities.find((candidate) => candidate.id === value); if (quantity) return validationNumber(quantity.value, document, seen, depth + 1); const number = Number(value); if (Number.isFinite(number)) return number; }
  return invalid("quantity", "thermodynamic numeric input must resolve to a finite value");
}
