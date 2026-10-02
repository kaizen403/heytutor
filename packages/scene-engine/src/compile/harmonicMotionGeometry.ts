import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const HARMONIC_MOTION_OPERATORS = ["harmonic_motion", "harmonic_state"] as const;
export type HarmonicObservable = "position" | "velocity" | "acceleration";
export interface HarmonicMotionDefinition {
  amplitude: number; equilibrium: number; angularFrequency: number; phase: number; phaseUnit: "rad";
  tMin: number; tMax: number; lengthUnit: string; timeUnit: string; frequencyUnit: string; quantity: HarmonicObservable;
  amplitudeSI: number; equilibriumSI: number; angularFrequencySI: number; angularFrequencySourceTime: number;
  origin: RenderPoint; timeScale: number; ordinateScale: number; samples: number; zeroAmplitude: boolean;
}
export interface HarmonicStateDefinition {
  motionId: string; time: number; timeSI: number; phase: number;
  positionSource: number; velocitySource: number; accelerationSource: number; displacementSI: number;
  positionSI: number; velocitySI: number; accelerationSI: number;
  quantity: HarmonicObservable; ordinateSource: number; ordinateSI: number;
  lengthUnit: string; timeUnit: string; ordinateUnit: string;
}
export type HarmonicMotionGeometry =
  | { kind: "path"; points: RenderPoint[]; harmonicMotion: HarmonicMotionDefinition; sampledCurve: { curveKind: "parametric"; parameterMin: number; parameterMax: number; evaluate(time: number): RenderPoint; derivative(time: number): RenderPoint } }
  | { kind: "point"; point: RenderPoint; harmonicState: HarmonicStateDefinition; calculusAnchor: { curveId: string; parameter: number } };
export interface HarmonicMotionEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
const MAX_SOURCE = 1e12;
const MAX_SI = 1e15;
const MAX_DISPLAY = 1e9;
const MAX_PHASE = 1e6;
const MAX_SAMPLES = 2049;
const MIN_LENGTH = 1e-6;
const RELATIVE_ERROR = 64 * Number.EPSILON;
const KEYS = {
  harmonic_motion: ["amplitude", "equilibrium", "angularFrequency", "phase", "phaseUnit", "tMin", "tMax", "lengthUnit", "timeUnit", "frequencyUnit", "quantity", "origin", "timeScale", "ordinateScale", "samples"],
  harmonic_state: ["motion", "time"],
} as const;
class HarmonicInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new HarmonicInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fields(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void { if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) invalid(key, "harmonic motion contains unsupported fields"); }
function finite(value: number, key: string, cap = MAX_SOURCE): number { if (!Number.isFinite(value) || Math.abs(value) > cap) invalid(key, `${key} must remain finite with magnitude at most ${cap}`); return value; }
function preserveLiteral(value: unknown, key: string): void { const match = typeof value === "string" && /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE][+-]?\d+)?$/.exec(value.trim()); if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) invalid(key, "nonzero source literals cannot underflow to a certified zero"); }
function scalar(value: unknown, key: string, context: HarmonicMotionEvaluationContext, cap = MAX_SOURCE, depth = 0): number {
  if (depth > 32) invalid(key, "harmonic numeric references exceed depth32");
  if (isRecord(value)) { fields(value, ["value", "unit"], key); return scalar(value.value, key, context, cap, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, "harmonic scalars require a literal, numeric string, or quantity reference");
  preserveLiteral(value, key); try { return finite(context.number(value), key, cap); } catch (error) { if (error instanceof HarmonicInputError) throw error; return invalid(key, "harmonic scalar must resolve to a finite number"); }
}
type Unit = { canonical: string; factor: number };
const UNITS: Readonly<Record<string, Readonly<Record<string, Unit>>>> = {
  length: { m: { canonical: "m", factor: 1 }, cm: { canonical: "cm", factor: 0.01 }, mm: { canonical: "mm", factor: 0.001 }, km: { canonical: "km", factor: 1000 } },
  time: { s: { canonical: "s", factor: 1 }, ms: { canonical: "ms", factor: 0.001 } },
  frequency: { "rad/s": { canonical: "rad/s", factor: 1 }, "rad/ms": { canonical: "rad/ms", factor: 1000 } },
  phase: { rad: { canonical: "rad", factor: 1 } },
};
function normalizedUnit(value: string): string { return value.trim().replaceAll("²", "^2"); }
function unit(value: unknown, kind: string): Unit { const found = typeof value === "string" ? UNITS[kind]?.[normalizedUnit(value)] : undefined; if (!found) invalid("units", `harmonic motion requires a supported explicit ${kind} unit`); return found; }
function product(a: number, b: number, key: string, cap = MAX_SI): number { const result = finite(a * b, key, cap); if (a !== 0 && b !== 0 && result === 0) invalid(key, "nonzero harmonic products cannot underflow to zero"); return result === 0 ? 0 : result; }
function positive(value: number, key: string): number { if (!(value > 0)) invalid(key, `${key} must be positive`); return value; }
function origin(value: unknown, context: HarmonicMotionEvaluationContext): RenderPoint {
  if (value === undefined) return { x: 0, y: 0 };
  if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], "origin", context), y: scalar(value[1], "origin", context) };
  if (isRecord(value)) { fields(value, ["x", "y"], "origin"); return { x: scalar(value.x, "origin", context), y: scalar(value.y, "origin", context) }; }
  return invalid("origin", "harmonic origins must be inline 2D display coordinates");
}
function sourceUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) invalid("units", "harmonic unit provenance must be acyclic and bounded");
  const record = isRecord(value) ? value : typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : undefined;
  if (!record) return [];
  if (record.unit !== undefined && (typeof record.unit !== "string" || !record.unit.trim())) invalid("units", "known harmonic units must be nonempty strings");
  seen.add(value); return [...(typeof record.unit === "string" ? [record.unit] : []), ...("value" in record ? sourceUnits(record.value, document, seen, depth + 1) : [])];
}
function matchUnits(value: unknown, kind: string, declared: unknown, document?: SceneDocument): void { const expected = unit(declared, kind); for (const actual of sourceUnits(value, document)) if (unit(actual, kind).factor !== expected.factor) invalid("units", "quantity-bound harmonic values must use their declared common source scale"); }
function dimensionless(value: unknown, document?: SceneDocument): void { for (const actual of sourceUnits(value, document)) if (!["1", "dimensionless", "unit", "units"].includes(normalizedUnit(actual))) invalid("units", "harmonic display scales and samples must be dimensionless"); }
function checkUnits(operator: string, inputs: Record<string, unknown>, document?: SceneDocument): void {
  if (operator === "harmonic_state") return;
  for (const key of ["amplitude", "equilibrium"]) matchUnits(inputs[key], "length", inputs.lengthUnit, document);
  for (const key of ["tMin", "tMax"]) matchUnits(inputs[key], "time", inputs.timeUnit, document);
  matchUnits(inputs.angularFrequency, "frequency", inputs.frequencyUnit, document); matchUnits(inputs.phase, "phase", inputs.phaseUnit, document);
  for (const key of ["timeScale", "ordinateScale", "samples"]) if (inputs[key] !== undefined) dimensionless(inputs[key], document);
  const coordinates = Array.isArray(inputs.origin) ? inputs.origin : isRecord(inputs.origin) ? [inputs.origin.x, inputs.origin.y] : []; coordinates.forEach((coordinate) => dimensionless(coordinate, document));
}
/** Compensated product/sum preserves a small phase residual before trigonometry. */
function phaseAt(model: HarmonicMotionDefinition, time: number): number {
  const a = model.angularFrequencySourceTime; const b = time; const high = product(a, b, "phase", MAX_PHASE);
  const split = 134217729; const ac = split * a; const bc = split * b; const ah = ac - (ac - a); const bh = bc - (bc - b); const al = a - ah; const bl = b - bh;
  const productError = ((ah * bh - high) + ah * bl + al * bh) + al * bl;
  const sum = high + model.phase; const virtual = sum - high; const sumError = (high - (sum - virtual)) + (model.phase - virtual);
  const low = productError + sumError; const result = finite(sum + low, "phase", MAX_PHASE);
  if (result === 0 && (sum !== 0 || low !== 0) || result !== 0 && Math.abs(result) <= RELATIVE_ERROR * (Math.abs(high) + Math.abs(model.phase))) invalid("precision", "near-cancelled phase is unresolved at harmonic numeric authority");
  return result;
}
function readMotion(inputs: Record<string, unknown>, context: HarmonicMotionEvaluationContext): HarmonicMotionDefinition {
  const length = unit(inputs.lengthUnit, "length"); const time = unit(inputs.timeUnit, "time"); const frequency = unit(inputs.frequencyUnit, "frequency"); unit(inputs.phaseUnit, "phase");
  const amplitude = scalar(inputs.amplitude, "amplitude", context); if (amplitude < 0) invalid("amplitude", "harmonic amplitude must be nonnegative");
  const equilibrium = scalar(inputs.equilibrium, "equilibrium", context); const angularFrequency = positive(scalar(inputs.angularFrequency, "angularFrequency", context), "angularFrequency"); const phase = scalar(inputs.phase, "phase", context, MAX_PHASE);
  const tMin = scalar(inputs.tMin, "tMin", context); const tMax = scalar(inputs.tMax, "tMax", context);
  if (!(tMax > tMin) || tMax - tMin <= RELATIVE_ERROR * Math.max(Math.abs(tMin), Math.abs(tMax))) invalid("domain", "harmonic time endpoints must be increasing and distinguishable");
  if (!["position", "velocity", "acceleration"].includes(String(inputs.quantity))) invalid("quantity", "harmonic graph requires an explicit position, velocity, or acceleration observable");
  const quantity = inputs.quantity as HarmonicObservable;
  const angularFrequencySI = positive(product(angularFrequency, frequency.factor, "angularFrequencySI"), "angularFrequencySI"); const angularFrequencySourceTime = positive(product(angularFrequencySI, time.factor, "angularFrequencySourceTime"), "angularFrequencySourceTime");
  const amplitudeSI = product(amplitude, length.factor, "amplitudeSI"); const equilibriumSI = product(equilibrium, length.factor, "equilibriumSI");
  if (amplitude > 0 && (equilibrium + amplitude === equilibrium || equilibrium - amplitude === equilibrium)) invalid("precision", "position oscillations cannot disappear inside the equilibrium offset");
  const timeScale = positive(scalar(inputs.timeScale, "timeScale", context, MAX_DISPLAY), "timeScale"); const ordinateScale = positive(scalar(inputs.ordinateScale, "ordinateScale", context, MAX_DISPLAY), "ordinateScale");
  let derivativeEnvelope = amplitude;
  for (let order = 0; order < (quantity === "position" ? 1 : quantity === "velocity" ? 2 : 3); order++) derivativeEnvelope = product(derivativeEnvelope, angularFrequencySourceTime, "derivativeEnvelope");
  product(derivativeEnvelope, ordinateScale, "derivativeEnvelope", MAX_SOURCE);
  const phaseSpan = product(angularFrequencySourceTime, tMax - tMin, "phaseSpan", 2 * MAX_PHASE); const minimum = amplitude === 0 ? 2 : Math.ceil(phaseSpan / (2 * Math.PI) * 32) + 1;
  const samples = inputs.samples === undefined ? Math.max(33, minimum) : scalar(inputs.samples, "samples", context, MAX_SAMPLES);
  if (!Number.isInteger(samples) || samples < minimum || samples > MAX_SAMPLES) invalid("samples", `harmonic samples require at least ${minimum} points and at most ${MAX_SAMPLES}, with32 intervals per cycle`);
  const model: HarmonicMotionDefinition = { amplitude, equilibrium, angularFrequency, phase, phaseUnit: "rad", tMin, tMax, lengthUnit: length.canonical, timeUnit: time.canonical, frequencyUnit: frequency.canonical, quantity, amplitudeSI, equilibriumSI, angularFrequencySI, angularFrequencySourceTime, origin: origin(inputs.origin, context), timeScale, ordinateScale, samples, zeroAmplitude: amplitude === 0 };
  phaseAt(model, tMin); phaseAt(model, tMax); return model;
}
function stateAt(model: HarmonicMotionDefinition, time: number): Omit<HarmonicStateDefinition, "motionId"> {
  finite(time, "time"); if (time < model.tMin || time > model.tMax) invalid("time", "harmonic state must remain inside its source-time domain");
  const theta = phaseAt(model, time); const cosine = Math.cos(theta); const sine = Math.sin(theta); const w = model.angularFrequencySourceTime;
  const displacementSource = product(model.amplitude, cosine, "displacementSource"); const velocitySource = -product(product(model.amplitude, w, "velocityAmplitude"), sine, "velocitySource"); const accelerationSource = -product(product(product(model.amplitude, w, "velocityAmplitude"), w, "accelerationAmplitude"), cosine, "accelerationSource");
  const positionSource = finite(model.equilibrium + displacementSource, "positionSource", MAX_SI);
  if (Math.abs(positionSource - model.equilibrium - displacementSource) > RELATIVE_ERROR * model.amplitude) invalid("precision", "physical equilibrium addition cannot preserve the harmonic displacement");
  if (!model.zeroAmplitude && model.equilibrium !== 0 && displacementSource !== 0 && Math.abs(positionSource) <= RELATIVE_ERROR * (Math.abs(model.equilibrium) + Math.abs(displacementSource)) && !(theta === 0 && model.equilibrium === -model.amplitude)) invalid("precision", "uncertified near-cancellation of equilibrium and harmonic displacement cannot become a zero position");
  const displacementSI = product(model.amplitudeSI, cosine, "displacementSI"); const positionSI = finite(model.equilibriumSI + displacementSI, "positionSI", MAX_SI);
  if (Math.abs(positionSI - model.equilibriumSI - displacementSI) > RELATIVE_ERROR * model.amplitudeSI) invalid("precision", "SI position cannot preserve the physical oscillation around equilibrium");
  const velocitySI = -product(product(model.amplitudeSI, model.angularFrequencySI, "velocityAmplitudeSI"), sine, "velocitySI"); const accelerationSI = -product(product(product(model.amplitudeSI, model.angularFrequencySI, "velocityAmplitudeSI"), model.angularFrequencySI, "accelerationAmplitudeSI"), cosine, "accelerationSI");
  const ordinateSource = model.quantity === "position" ? positionSource : model.quantity === "velocity" ? velocitySource : accelerationSource; const ordinateSI = model.quantity === "position" ? positionSI : model.quantity === "velocity" ? velocitySI : accelerationSI;
  const ordinateUnit = model.quantity === "position" ? model.lengthUnit : `${model.lengthUnit}/${model.timeUnit}${model.quantity === "acceleration" ? "^2" : ""}`;
  return { time, timeSI: product(time, unit(model.timeUnit, "time").factor, "timeSI"), phase: theta, positionSource, velocitySource, accelerationSource, displacementSI, positionSI, velocitySI, accelerationSI, quantity: model.quantity, ordinateSource, ordinateSI, lengthUnit: model.lengthUnit, timeUnit: model.timeUnit, ordinateUnit };
}
function mappedPoint(model: HarmonicMotionDefinition, time: number): RenderPoint {
  const state = stateAt(model, time); const local = { x: product(time, model.timeScale, "timeScale", MAX_SOURCE), y: product(state.ordinateSource, model.ordinateScale, "ordinateScale", MAX_SOURCE) };
  const result = { x: finite(model.origin.x + local.x, "geometry"), y: finite(model.origin.y + local.y, "geometry") };
  const sourceEnvelope = model.quantity === "position" ? model.amplitude : model.quantity === "velocity" ? product(model.amplitude, model.angularFrequencySourceTime, "envelope") : product(product(model.amplitude, model.angularFrequencySourceTime, "envelope"), model.angularFrequencySourceTime, "envelope");
  const envelope = product(sourceEnvelope, model.ordinateScale, "envelope", MAX_SOURCE); const timeSpan = product(model.tMax - model.tMin, model.timeScale, "timeSpan", MAX_SOURCE);
  const tolerances = { x: Math.max(Math.abs(local.x), timeSpan) * 1e-8, y: Math.max(Math.abs(local.y), envelope) * 1e-8 };
  for (const axis of ["x", "y"] as const) if (Math.abs(result[axis] - model.origin[axis] - local[axis]) > tolerances[axis]) invalid("precision", "harmonic display translation cannot retain its source coordinate");
  if (!model.zeroAmplitude) {
    const baseline = model.quantity === "position" ? finite(model.origin.y + product(model.equilibrium, model.ordinateScale, "baseline", MAX_SOURCE), "baseline") : model.origin.y;
    const expected = model.quantity === "position" ? product(product(model.amplitude, Math.cos(state.phase), "displacementSource"), model.ordinateScale, "ordinateScale", MAX_SOURCE) : local.y;
    if (Math.abs(result.y - baseline - expected) > envelope * 1e-8) invalid("precision", "display ordinate cannot preserve the harmonic component independently of its equilibrium offset");
  }
  return result;
}
function motionReference(value: unknown, context: HarmonicMotionEvaluationContext): HarmonicMotionDefinition {
  if (typeof value !== "string" || !value.trim()) invalid("motion", "harmonic state requires a constructed harmonic motion reference");
  const geometry = context.geometry(value); if (!isRecord(geometry) || geometry.kind !== "path" || !isRecord(geometry.harmonicMotion)) invalid("motion", "motion reference must retain its source harmonic metadata"); fields(geometry, ["kind", "points", "harmonicMotion", "sampledCurve"], "motion");
  const source = geometry.harmonicMotion; const model = readMotion(Object.fromEntries(KEYS.harmonic_motion.map((key) => [key, source[key]])), context);
  for (const key of ["amplitudeSI", "equilibriumSI", "angularFrequencySI", "angularFrequencySourceTime", "zeroAmplitude"] as const) if (source[key] !== model[key]) invalid("motion", "harmonic metadata contradicts its explicit source model"); return model;
}
/** Analytic source-time derivatives keep physical q/v/a independent from the chosen display scales. */
export function evaluateHarmonicMotionConstruction(operator: string, inputs: Record<string, unknown>, context: HarmonicMotionEvaluationContext): HarmonicMotionGeometry[] {
  if (!(HARMONIC_MOTION_OPERATORS as readonly string[]).includes(operator)) invalid("operator", "unsupported harmonic motion operator"); fields(inputs, operator === "harmonic_motion" ? KEYS.harmonic_motion : KEYS.harmonic_state); checkUnits(operator, inputs);
  if (operator === "harmonic_state") { const model = motionReference(inputs.motion, context); matchUnits(inputs.time, "time", model.timeUnit); const time = scalar(inputs.time, "time", context); return [{ kind: "point", point: mappedPoint(model, time), harmonicState: { motionId: String(inputs.motion), ...stateAt(model, time) }, calculusAnchor: { curveId: String(inputs.motion), parameter: time } }]; }
  const model = readMotion(inputs, context); const points = Array.from({ length: model.samples }, (_, index) => mappedPoint(model, index === model.samples - 1 ? model.tMax : model.tMin + (model.tMax - model.tMin) * index / (model.samples - 1)));
  if (!(points.at(-1)!.x - points[0]!.x > MIN_LENGTH)) invalid("precision", "harmonic time-axis changes must remain visible");
  const expectedTimeStep = product((model.tMax - model.tMin) / (model.samples - 1), model.timeScale, "timeStep", MAX_SOURCE);
  for (let index = 1; index < points.length; index++) if (Math.abs(points[index]!.x - points[index - 1]!.x - expectedTimeStep) > expectedTimeStep * 1e-8) invalid("precision", "display sampling cannot preserve each physical time increment");
  if (!model.zeroAmplitude && !(Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)) > MIN_LENGTH)) invalid("precision", "nonzero harmonic oscillations cannot collapse to a constant display ordinate");
  return [{ kind: "path", points, harmonicMotion: model, sampledCurve: { curveKind: "parametric", parameterMin: model.tMin, parameterMax: model.tMax, evaluate: (time) => mappedPoint(model, time), derivative(time) {
    const state = stateAt(model, time); const rate = model.quantity === "position" ? state.velocitySource : model.quantity === "velocity" ? state.accelerationSource : product(product(product(product(model.amplitude, model.angularFrequencySourceTime, "jerkAmplitude"), model.angularFrequencySourceTime, "jerkAmplitude"), model.angularFrequencySourceTime, "jerkAmplitude"), Math.sin(state.phase), "jerkSource");
    return { x: model.timeScale, y: product(rate, model.ordinateScale, "derivative", MAX_SOURCE) };
  } } }];
}
type Claim = { symbol: string; kind: string; expected: number; defaultUnit: string };
function labelAuthority(geometry: unknown): { defaultLabel: string; claims: Claim[] } | null {
  if (!isRecord(geometry)) return null;
  const claim = (symbol: string, kind: string, expected: number, defaultUnit: string): Claim => ({ symbol, kind, expected: finite(expected, "label", MAX_SI), defaultUnit });
  const symbol = (observable: unknown): string => observable === "position" ? "q" : observable === "velocity" ? "v" : observable === "acceleration" ? "a" : invalid("label", "harmonic observable metadata is invalid");
  if (isRecord(geometry.harmonicMotion)) {
    const motion = geometry.harmonicMotion as unknown as HarmonicMotionDefinition;
    return { defaultLabel: `${symbol(motion.quantity)}(t)`, claims: [claim("A", "length", motion.amplitudeSI, motion.lengthUnit), claim("q0", "length", motion.equilibriumSI, motion.lengthUnit), claim("omega", "frequency", motion.angularFrequencySI, motion.frequencyUnit), claim("phi", "phase", motion.phase, "rad")] };
  }
  if (isRecord(geometry.harmonicState)) {
    const state = geometry.harmonicState as unknown as HarmonicStateDefinition;
    return { defaultLabel: `${symbol(state.quantity)}(t)`, claims: [claim("q", "length", state.positionSI, state.lengthUnit), claim("v", "velocity", state.velocitySI, `${state.lengthUnit}/${state.timeUnit}`), claim("a", "acceleration", state.accelerationSI, `${state.lengthUnit}/${state.timeUnit}^2`), claim("t", "time", state.timeSI, state.timeUnit)] };
  }
  return null;
}
function claimUnit(value: string, kind: string): Unit {
  if (kind !== "velocity" && kind !== "acceleration") return unit(value, kind);
  const match = /^([^/]+)\/([^/^]+)(\^2)?$/.exec(normalizedUnit(value)); if (!match || (kind === "acceleration") !== (match[3] !== undefined)) invalid("label", "harmonic derivatives require the matching length/time power unit");
  const length = unit(match[1], "length"); const time = unit(match[2], "time"); return { canonical: `${length.canonical}/${time.canonical}${kind === "acceleration" ? "^2" : ""}`, factor: length.factor / time.factor ** (kind === "acceleration" ? 2 : 1) };
}
function equalPhysical(actual: number, expected: number): boolean { return Number.isFinite(actual) && Math.abs(actual - expected) <= RELATIVE_ERROR * Math.abs(expected); }
function compactClaim(claim: Claim, declared: string): string { const scale = claimUnit(declared, claim.kind); return `${claim.symbol}=${Number(product(claim.expected, 1 / scale.factor, "label").toPrecision(4))} ${scale.canonical}`; }
function checkedText(text: unknown, geometry: unknown): { claim: Claim; declared: string } | null {
  const authority = labelAuthority(geometry); if (!authority) invalid("label", "harmonic output must retain physical source authority"); if (text === undefined) return null;
  if (typeof text !== "string") invalid("label", "harmonic labels must be mathematical source text or verified physical values");
  if (text === authority.defaultLabel || authority.claims.some((claim) => claim.symbol === text)) return null;
  const match = /^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([^\s]+)\s*$/.exec(text.replaceAll("−", "-")); const claim = match && authority.claims.find((entry) => entry.symbol === match[1]);
  if (match && claim) { preserveLiteral(match[2], "label"); const declared = match[3]!; const scale = claimUnit(declared, claim.kind); if (equalPhysical(product(Number(match[2]), scale.factor, "label"), claim.expected) || text.trim() === compactClaim(claim, declared)) return { claim, declared }; }
  return invalid("label", "harmonic numeric labels must agree with independently computed source quantities, states, and units");
}
/** Initial labels identify the source observable; numeric results appear only when explicitly requested. */
export function harmonicMotionGeometryLabel(geometry: unknown, requestedText?: unknown): string | null { const authority = labelAuthority(geometry); if (!authority) return null; const requested = checkedText(requestedText, geometry); const text = requested ? compactClaim(requested.claim, requested.declared) : typeof requestedText === "string" ? requestedText : authority.defaultLabel; return text.length <= 16 ? text : requested?.claim.symbol ?? authority.defaultLabel; }
function annotationAuthority(geometry: unknown, declared: string, text: unknown): { claim: Claim; factor: number } {
  const authority = labelAuthority(geometry); if (!authority) invalid("label", "harmonic output must retain physical source authority"); const requested = checkedText(text, geometry); const explicit = requested?.claim ?? authority.claims.find((claim) => claim.symbol === text);
  const candidates = authority.claims.filter((claim) => !explicit || explicit.symbol === claim.symbol).flatMap((claim) => { try { return [{ claim, factor: claimUnit(declared, claim.kind).factor }]; } catch { return []; } });
  if (candidates.length !== 1) invalid("label", "harmonic annotations require an unambiguous physical quantity and compatible unit"); return candidates[0]!;
}
export function validateEvaluatedHarmonicMotionLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  if (!(HARMONIC_MOTION_OPERATORS as readonly string[]).includes(construction.operator)) return;
  for (const [outputIndex, id] of (Array.isArray(construction.outputs) ? construction.outputs : []).entries()) {
    const geometry = outputs[outputIndex];
    try {
      if (!labelAuthority(geometry)) invalid("label", "harmonic output must retain physical source authority"); checkedText(document.entities.find((entity) => entity.id === id)?.label, geometry);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(id) || annotation.kind !== "label" && annotation.kind !== "callout") continue; checkedText(annotation.text, geometry);
        if (annotation.quantityId !== undefined) {
          const declared = sourceUnits(annotation.quantityId, document); if (!declared.length) invalid("label", "harmonic quantity annotations require explicit physical units");
          const authorities = declared.map((value) => annotationAuthority(geometry, value, annotation.text)); const first = authorities[0]!;
          if (authorities.some((entry) => entry.claim.symbol !== first.claim.symbol || entry.factor !== first.factor)) invalid("label", "harmonic annotation contains conflicting nested units");
          if (!equalPhysical(product(validationNumber(annotation.quantityId, document), first.factor, "label"), first.claim.expected)) invalid("label", "harmonic annotation contradicts its source-defined physical value");
        }
      }
      for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) checkedText(label.inputs.text, geometry);
    } catch (error) { issues.push({ code: `invalid_${construction.operator}_label`, message: error instanceof Error ? error.message : "invalid harmonic label", severity: "fatal", path: `constructions[${index}].outputs`, entityIds: [id] }); }
  }
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("quantity", "harmonic numeric references must be acyclic and bounded"); if (typeof value === "number" && Number.isFinite(value)) return value; seen.add(value);
  if (isRecord(value)) { fields(value, ["value", "unit"], "quantity"); return validationNumber(value.value, document, seen, depth + 1); }
  if (typeof value === "string" && value.trim()) { const quantity = document.quantities.find((entry) => entry.id === value); if (quantity) return validationNumber(quantity.value, document, seen, depth + 1); preserveLiteral(value, "quantity"); const numeric = Number(value); if (Number.isFinite(numeric)) return numeric; }
  return invalid("quantity", "harmonic numeric inputs must resolve to finite source values");
}
export function validateHarmonicMotionConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const { operator, inputs } = construction; if (!(HARMONIC_MOTION_OPERATORS as readonly string[]).includes(operator)) return;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const add = (key: string, message: string): void => { issues.push({ code: `invalid_${operator}_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`, entityIds: outputs }); };
  if (outputs.length !== 1 || typeof outputs[0] !== "string" || !outputs[0].trim()) add("outputs", `${operator} requires exactly one output`);
  const expectedKind = operator === "harmonic_motion" ? "polyline" : "point"; if (document.entities.find((entity) => entity.id === outputs[0])?.kind !== expectedKind) add("output_kind", `${operator} output must be a ${expectedKind}`);
  if (!isRecord(inputs)) { add("inputs", "harmonic construction inputs must be an object"); return; }
  const context: HarmonicMotionEvaluationContext = {
    number: (value) => validationNumber(value, document), point: (value) => origin(value, context),
    geometry(value) {
      const producer = typeof value === "string" ? constructionByOutput.get(value) : undefined;
      if (!producer || producer.operator !== "harmonic_motion" || producer.outputs.length !== 1 || producer.outputs[0] !== value || document.entities.find((entity) => entity.id === value)?.kind !== "polyline") invalid("motion", "harmonic state requires exactly one verified source motion output");
      checkUnits(producer.operator, producer.inputs, document); return evaluateHarmonicMotionConstruction(producer.operator, producer.inputs, context)[0];
    },
  };
  try { checkUnits(operator, inputs, document); if (operator === "harmonic_state") matchUnits(inputs.time, "time", motionReference(inputs.motion, context).timeUnit, document); validateEvaluatedHarmonicMotionLabels(construction, index, document, evaluateHarmonicMotionConstruction(operator, inputs, context), issues); }
  catch (error) { add(error instanceof HarmonicInputError ? error.key : "inputs", error instanceof Error ? error.message : "invalid harmonic construction"); }
}
