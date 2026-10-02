import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import type { CalculusAnchorDefinition } from "./calculusGeometry";

export const WAVES_OPERATORS = ["harmonic_wave", "wave_superposition", "wave_sample"] as const;
export interface WaveHarmonic { amplitude: number; waveNumber: number; angularFrequency: number; phase: number }
export interface WaveDefinition {
  harmonics: WaveHarmonic[];
  origin: RenderPoint;
  xScale: number; yScale: number; time: number; xMin: number; xMax: number; samples: number;
  sourceUnits: { position: string | null; time: string | null; amplitude: string | null };
  zeroCertified: boolean; depth: number; sourceIds: string[];
}
export interface WaveSampleDefinition { waveId: string; x: number; value: number; slope: number; time: number; sourceUnits: WaveDefinition["sourceUnits"] }
export interface WaveSampledCurve {
  curveKind: "parametric"; parameterMin: number; parameterMax: number;
  evaluate(x: number): RenderPoint; derivative(x: number): RenderPoint;
}
export type WavesGeometry =
  | { kind: "path"; points: RenderPoint[]; waveDefinition: WaveDefinition; sampledCurve: WaveSampledCurve }
  | { kind: "point"; point: RenderPoint; waveSample: WaveSampleDefinition; calculusAnchor: CalculusAnchorDefinition };
export interface WavesEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
const MAX_PARAMETER = 1e9;
const MAX_COORDINATE = 1e12;
const MAX_PHASE = 1e6;
const MAX_SAMPLES = 2049;
const MAX_HARMONICS = 32;
const MAX_SOURCES = 16;
const MAX_DEPTH = 16;
const POINTS_PER_CYCLE = 32;
const TWO_PI = 2 * Math.PI;
const PLACEMENT_TOLERANCE = 1e-8;
class WavesInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new WavesInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void {
  const extra = Object.keys(value).filter((name) => !allowed.includes(name));
  if (extra.length) invalid(key, `unsupported waves fields: ${extra.join(", ")}`);
}
function bounded(value: number, key: string, cap = MAX_PARAMETER): number {
  if (!Number.isFinite(value) || Math.abs(value) > cap) invalid(key, `${key} must be finite with magnitude at most ${cap}`);
  return value;
}
function scalar(value: unknown, key: string, context: WavesEvaluationContext, cap = MAX_PARAMETER, depth = 0): number {
  if (depth > 32) invalid(key, "wave scalar nesting exceeds depth 32");
  if (isRecord(value)) { keys(value, ["value", "unit"], key); return scalar(value.value, key, context, cap, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, `${key} requires a finite literal or quantity reference`);
  try { return bounded(context.number(value), key, cap); }
  catch (error) { if (error instanceof WavesInputError) throw error; return invalid(key, `${key} requires a finite numeric value`); }
}
function point(value: unknown, key: string): RenderPoint {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") invalid(key, `${key} requires finite 2D coordinates`);
  return { x: bounded(value.x, key, MAX_COORDINATE), y: bounded(value.y, key, MAX_COORDINATE) };
}
function origin(value: unknown, context: WavesEvaluationContext): RenderPoint {
  if (value === undefined) return { x: 0, y: 0 };
  if (typeof value === "string" && value.trim()) {
    const geometry = context.geometry(value);
    if (!isRecord(geometry) || geometry.kind !== "point" || ["space", "spaceFrameId", "world3D", "electricField", "vectorDefinition", "kinematicState", "kinematicTrajectory"].some((key) => geometry[key] !== undefined)) invalid("origin", "wave origins require verified 2D placement points");
    return point(context.point(value), "origin");
  }
  if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], "origin", context, MAX_COORDINATE), y: scalar(value[1], "origin", context, MAX_COORDINATE) };
  if (isRecord(value)) { keys(value, ["x", "y"], "origin"); return { x: scalar(value.x, "origin.x", context, MAX_COORDINATE), y: scalar(value.y, "origin.y", context, MAX_COORDINATE) }; }
  return invalid("origin", "wave origin must be [x,y], {x,y}, or a constructed point reference");
}
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  "1": "1", unit: "1", units: "1", dimensionless: "1", rad: "rad", radian: "rad", radians: "rad",
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m", cm: "cm", centimeter: "cm", centimetre: "cm", mm: "mm", millimeter: "mm", millimetre: "mm", km: "km", um: "um", "µm": "um", "μm": "um", nm: "nm",
  s: "s", sec: "s", second: "s", seconds: "s", ms: "ms", millisecond: "ms", milliseconds: "ms", us: "us", "µs": "us", "μs": "us", min: "min", minute: "min", minutes: "min", h: "h", hour: "h", hours: "h",
};
const POSITION_UNITS = new Set(["1", "m", "cm", "mm", "km", "um", "nm"]);
const TIME_UNITS = new Set(["1", "s", "ms", "us", "min", "h"]);
function unit(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 80) invalid(key, "wave unit declarations must be nonempty bounded unit strings");
  return UNIT_ALIASES[value.trim()] ?? value.trim();
}
function units(value: unknown): WaveDefinition["sourceUnits"] {
  if (value === undefined) return { position: null, time: null, amplitude: null };
  if (!isRecord(value)) invalid("units", "wave units require position, time, and amplitude declarations");
  keys(value, ["position", "time", "amplitude"], "units");
  const position = unit(value.position, "units.position"); const time = unit(value.time, "units.time"); const amplitude = unit(value.amplitude, "units.amplitude");
  if (!POSITION_UNITS.has(position) || !TIME_UNITS.has(time)) invalid("units", "wave position and time declarations require supported length/time or dimensionless units");
  return { position, time, amplitude };
}
function scalarUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) invalid("units", "wave scalar quantity/unit references must be acyclic with depth at most 32");
  if (isRecord(value)) {
    seen.add(value);
    if (value.unit !== undefined && (typeof value.unit !== "string" || !value.unit.trim())) invalid("units", "known wave quantity units must be nonempty strings");
    return [...(typeof value.unit === "string" ? [value.unit.trim()] : []), ...(value.value !== undefined ? scalarUnits(value.value, document, seen, depth + 1) : [])];
  }
  if (typeof value === "string" && document) {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) { seen.add(value); return scalarUnits(quantity, document, seen, depth + 1); }
  }
  return [];
}
function inverseUnit(actual: string, basis: string): boolean {
  if (basis === "1" && ["rad", "1"].includes(unit(actual, "units"))) return true;
  const base = actual.startsWith("rad/") ? actual.slice(4) : actual.startsWith("1/") ? actual.slice(2) : actual.endsWith("^-1") ? actual.slice(0, -3) : actual.endsWith("⁻¹") ? actual.slice(0, -2) : null;
  return base !== null && unit(base, "units") === basis;
}
function checkSourceUnits(inputs: Record<string, unknown>, source: WaveDefinition["sourceUnits"], document?: SceneDocument): void {
  const matches = (key: string, expected: string | null): void => {
    for (const actual of scalarUnits(inputs[key], document)) if (unit(actual, "units") !== (expected ?? "1")) invalid(`${key}_unit`, `${key} must use the declared source unit ${expected ?? "1"}; source scales are not converted`);
  };
  matches("amplitude", source.amplitude); matches("time", source.time); matches("xMin", source.position); matches("xMax", source.position);
  for (const key of ["waveNumber", "angularFrequency"]) {
    const basis = key === "waveNumber" ? source.position : source.time;
    for (const actual of scalarUnits(inputs[key], document)) if (!inverseUnit(actual, basis ?? "1")) invalid(`${key}_unit`, `${key} must be radians per declared ${key === "waveNumber" ? "position" : "time"} unit; frequency in Hz cannot be silently treated as angular frequency`);
  }
  for (const actual of scalarUnits(inputs.phase, document)) if (unit(actual, "units") !== "rad") invalid("phase_unit", "phase quantities must be expressed in radians");
  for (const key of ["xScale", "yScale", "samples"]) for (const actual of scalarUnits(inputs[key], document)) if (unit(actual, "units") !== "1") invalid(`${key}_unit`, `${key} is a dimensionless display/sampling parameter`);
}
type Exact = { n: bigint; e: number };
const floatBits = new DataView(new ArrayBuffer(8));
function exact(value: number): Exact {
  if (value === 0) return { n: 0n, e: 0 };
  floatBits.setFloat64(0, value);
  const bits = floatBits.getBigUint64(0); const exponent = Number((bits >> 52n) & 2047n);
  const significand = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  return { n: bits >> 63n ? -significand : significand, e: exponent ? exponent - 1075 : -1074 };
}
function add(a: Exact, b: Exact): Exact { const e = Math.min(a.e, b.e); return { n: (a.n << BigInt(a.e - e)) + (b.n << BigInt(b.e - e)), e }; }
function multiply(a: Exact, b: Exact): Exact { return { n: a.n * b.n, e: a.e + b.e }; }
function negate(value: Exact): Exact { return { n: -value.n, e: value.e }; }
function exactKey(value: Exact): string {
  let { n, e } = value;
  if (n === 0n) return "0";
  while (n % 2n === 0n) { n /= 2n; e += 1; }
  return `${n}:${e}`;
}
function numeric(value: Exact, key: string, cap = MAX_COORDINATE): number {
  if (value.n === 0n) return 0;
  const magnitude = value.n < 0n ? -value.n : value.n;
  const shift = Math.max(0, magnitude.toString(2).length - 53, -1074 - value.e);
  let mantissa = magnitude >> BigInt(shift);
  if (shift > 0) {
    const remainder = magnitude - (mantissa << BigInt(shift)); const halfway = 1n << BigInt(shift - 1);
    if (remainder > halfway || remainder === halfway && mantissa % 2n === 1n) mantissa += 1n;
  }
  const result = Number(mantissa) * 2 ** (value.e + shift) * (value.n < 0n ? -1 : 1);
  if (result === 0) invalid(key, "a nonzero wave value underflows numerical authority");
  return bounded(result, key, cap);
}
type ActiveHarmonic = Omit<WaveHarmonic, "amplitude"> & { amplitude: Exact };
function activeHarmonics(harmonics: readonly WaveHarmonic[]): ActiveHarmonic[] {
  const grouped = new Map<string, ActiveHarmonic>();
  for (const source of harmonics) {
    const first = [source.waveNumber, source.angularFrequency, source.phase].find((value) => value !== 0) ?? 0;
    if (first === 0 || source.amplitude === 0) continue;
    const sign = first < 0 ? -1 : 1;
    const waveNumber = sign * source.waveNumber; const angularFrequency = sign * source.angularFrequency; const phase = sign * source.phase;
    const key = `${waveNumber}:${angularFrequency}:${phase}`;
    const previous = grouped.get(key);
    grouped.set(key, { waveNumber, angularFrequency, phase, amplitude: add(previous?.amplitude ?? exact(0), exact(sign * source.amplitude)) });
  }
  return [...grouped.values()].filter((value) => value.amplitude.n !== 0n).sort((a, b) => a.waveNumber - b.waveNumber || a.angularFrequency - b.angularFrequency || a.phase - b.phase);
}
function phaseAt(harmonic: ActiveHarmonic, x: number, time: number): Exact {
  bounded(harmonic.waveNumber * x, "phase", MAX_PHASE); bounded(harmonic.angularFrequency * time, "phase", MAX_PHASE); bounded(harmonic.phase, "phase", MAX_PHASE);
  return add(add(multiply(exact(harmonic.waveNumber), exact(x)), negate(multiply(exact(harmonic.angularFrequency), exact(time)))), exact(harmonic.phase));
}
function physicalAt(active: readonly ActiveHarmonic[], x: number, time: number, required: "value" | "slope" | "both" = "both"): { value: number; slope: number } {
  type Contribution = { phase: Exact; kind: "sine" | "cosine"; coefficient: Exact };
  const values = new Map<string, Contribution>(); const slopes = new Map<string, Contribution>();
  const insert = (groups: Map<string, Contribution>, kind: Contribution["kind"], phase: Exact, coefficient: Exact): void => {
    const positive = phase.n < 0n ? negate(phase) : phase;
    const key = `${kind}/${exactKey(positive)}`;
    const signed = kind === "sine" && phase.n < 0n ? negate(coefficient) : coefficient;
    groups.set(key, { phase: positive, kind, coefficient: add(groups.get(key)?.coefficient ?? exact(0), signed) });
  };
  // Pair exact opposite snapshot offsets before trigonometry. The sum/difference
  // identities avoid losing stationary points to subtraction of large terms.
  const profiles = new Map<string, { waveNumber: number; offset: Exact; amplitude: Exact }>();
  for (const harmonic of active) {
    const offset = phaseAt(harmonic, 0, time);
    const key = `${harmonic.waveNumber}/${exactKey(offset)}`;
    const previous = profiles.get(key);
    profiles.set(key, { waveNumber: harmonic.waveNumber, offset, amplitude: add(previous?.amplitude ?? exact(0), harmonic.amplitude) });
  }
  const consumed = new Set<string>();
  for (const [key, profile] of profiles) {
    if (consumed.has(key) || profile.amplitude.n === 0n) continue;
    const oppositeKey = `${profile.waveNumber}/${exactKey(negate(profile.offset))}`;
    const opposite = profile.offset.n !== 0n ? profiles.get(oppositeKey) : undefined;
    const same = opposite && exactKey(profile.amplitude) === exactKey(opposite.amplitude);
    const reversed = opposite && exactKey(profile.amplitude) === exactKey(negate(opposite.amplitude));
    const base = multiply(exact(profile.waveNumber), exact(x));
    if (same || reversed) {
      const offset = numeric(profile.offset, "phase", 2 * MAX_PHASE);
      const coefficient = multiply(multiply(exact(2), profile.amplitude), exact(same ? Math.cos(offset) : Math.sin(offset)));
      const derivativeCoefficient = multiply(coefficient, exact(profile.waveNumber));
      insert(values, same ? "sine" : "cosine", base, coefficient);
      insert(slopes, same ? "cosine" : "sine", base, same ? derivativeCoefficient : negate(derivativeCoefficient));
      consumed.add(key); consumed.add(oppositeKey);
    } else {
      const phase = add(base, profile.offset);
      insert(values, "sine", phase, profile.amplitude);
      insert(slopes, "cosine", phase, multiply(profile.amplitude, exact(profile.waveNumber)));
    }
  }
  const sum = (groups: Map<string, Contribution>, cap: number): number => {
    let result = exact(0); let absolute = 0; let terms = 0;
    for (const group of groups.values()) {
      if (group.coefficient.n === 0n || group.kind === "sine" && group.phase.n === 0n) continue;
      const phase = numeric(group.phase, "phase", 3 * MAX_PHASE);
      const trig = group.kind === "sine" ? Math.sin(phase) : Math.cos(phase);
      const coefficient = numeric(group.coefficient, "amplitude", cap);
      const term = coefficient * trig;
      if (!Number.isFinite(term) || coefficient !== 0 && trig !== 0 && term === 0) invalid("precision", "wave evaluation overflows or underflows");
      result = add(result, exact(term)); absolute += Math.abs(term); terms += 1;
    }
    if (terms === 0) return 0;
    const value = numeric(result, "precision", cap);
    if (terms > 1 && Math.abs(value) <= 64 * Number.EPSILON * absolute) invalid("precision", "distinct harmonic contributions are unresolved within floating error; exact cancellation was not certified");
    return value;
  };
  return { value: required === "slope" ? 0 : sum(values, MAX_HARMONICS * MAX_PARAMETER), slope: required === "value" ? 0 : sum(slopes, MAX_HARMONICS * MAX_PARAMETER ** 2) };
}
function mappedPoint(model: WaveDefinition, x: number, value: number, amplitudeEnvelope: number): RenderPoint {
  const dx = model.xScale * x; const dy = model.yScale * value;
  const result = point({ x: model.origin.x + dx, y: model.origin.y + dy }, "geometry");
  const xTolerance = PLACEMENT_TOLERANCE * model.xScale * (model.xMax - model.xMin);
  const yTolerance = PLACEMENT_TOLERANCE * model.yScale * amplitudeEnvelope;
  if (Math.abs((result.x - model.origin.x) - dx) > xTolerance || Math.abs((result.y - model.origin.y) - dy) > yTolerance || x !== 0 && dx === 0 || value !== 0 && dy === 0) invalid("origin", "wave placement cannot retain source displacements at numeric precision");
  return result;
}
function physicalBounds(active: readonly ActiveHarmonic[], frame: Pick<WaveDefinition, "xMin" | "xMax" | "time" | "yScale">): { amplitudeEnvelope: number; maxWaveNumber: number; minimum: number } {
  let amplitudeEnvelope = 0; let slopeEnvelope = 0;
  for (const harmonic of active) {
    phaseAt(harmonic, frame.xMin, frame.time); phaseAt(harmonic, frame.xMax, frame.time);
    const amplitude = Math.abs(numeric(harmonic.amplitude, "amplitude", MAX_HARMONICS * MAX_PARAMETER));
    amplitudeEnvelope += amplitude; slopeEnvelope += amplitude * Math.abs(harmonic.waveNumber);
  }
  bounded(frame.yScale * amplitudeEnvelope, "yScale", MAX_COORDINATE); bounded(frame.yScale * slopeEnvelope, "yScale", MAX_COORDINATE);
  const maxWaveNumber = Math.max(0, ...active.map((harmonic) => Math.abs(harmonic.waveNumber)));
  const phaseSpan = maxWaveNumber * (frame.xMax - frame.xMin);
  const minimum = Math.max(17, Math.ceil(phaseSpan / TWO_PI * POINTS_PER_CYCLE) + 1);
  return { amplitudeEnvelope, maxWaveNumber, minimum };
}
function samplingCount(minimum: number, requestedSamples?: number): number {
  const samples = requestedSamples ?? Math.max(65, minimum);
  if (!Number.isInteger(samples) || samples < minimum || samples > MAX_SAMPLES) invalid("samples", `wave sampling requires an integer from ${minimum} to ${MAX_SAMPLES}; at least ${POINTS_PER_CYCLE} intervals per spatial cycle`);
  return samples;
}
function wavePath(model: WaveDefinition, requestedSamples?: number): Extract<WavesGeometry, { kind: "path" }> {
  const active = activeHarmonics(model.harmonics);
  model.zeroCertified = active.length === 0;
  const { amplitudeEnvelope, maxWaveNumber, minimum } = physicalBounds(active, model);
  const samples = samplingCount(minimum, requestedSamples);
  model.samples = samples;
  const evaluate = (x: number): RenderPoint => {
    if (!Number.isFinite(x) || x < model.xMin || x > model.xMax) invalid("x", "wave parameter must lie inside the verified physical domain");
    return mappedPoint(model, x, physicalAt(active, x, model.time, "value").value, amplitudeEnvelope);
  };
  const derivative = (x: number): RenderPoint => {
    if (!Number.isFinite(x) || x < model.xMin || x > model.xMax) invalid("x", "wave derivative parameter must lie inside the verified domain");
    return point({ x: model.xScale, y: model.yScale * physicalAt(active, x, model.time, "slope").slope }, "derivative");
  };
  let previous = -Infinity;
  const points = Array.from({ length: samples }, (_, index) => {
    const x = index === samples - 1 ? model.xMax : model.xMin + (model.xMax - model.xMin) * index / (samples - 1);
    if (!(x > previous)) invalid("domain", "wave sample parameters are indistinguishable at numeric precision");
    if (previous !== -Infinity && maxWaveNumber * (x - previous) > TWO_PI / POINTS_PER_CYCLE * (1 + 1e-12)) invalid("samples", "represented sample gaps violate the spatial anti-alias bound");
    previous = x;
    return evaluate(x);
  });
  for (let index = 1; index < points.length; index += 1) if (!(points[index]!.x > points[index - 1]!.x)) invalid("origin", "wave display x coordinates must remain numerically distinct");
  return { kind: "path", points, waveDefinition: model, sampledCurve: { curveKind: "parametric", parameterMin: model.xMin, parameterMax: model.xMax, evaluate, derivative } };
}
function waveReference(value: unknown, context: WavesEvaluationContext): WaveDefinition {
  if (typeof value !== "string" || !value.trim()) invalid("wave", "wave references require a verified harmonic or superposition entity ID");
  const geometry = context.geometry(value);
  if (!isRecord(geometry) || geometry.kind !== "path" || !isRecord(geometry.waveDefinition) || !isRecord(geometry.sampledCurve)) invalid("wave", "wave reference must retain its typed harmonic parameters and analytic sampled curve");
  keys(geometry, ["kind", "points", "waveDefinition", "sampledCurve"], "wave");
  const definition = geometry.waveDefinition;
  keys(definition, ["harmonics", "origin", "xScale", "yScale", "time", "xMin", "xMax", "samples", "sourceUnits", "zeroCertified", "depth", "sourceIds"], "wave");
  if (!Array.isArray(definition.harmonics) || definition.harmonics.length < 1 || definition.harmonics.length > MAX_HARMONICS) invalid("wave", "wave definition requires a bounded explicit harmonic list");
  const harmonics = definition.harmonics.map((value) => {
    if (!isRecord(value)) invalid("wave", "wave harmonic metadata is malformed");
    keys(value, ["amplitude", "waveNumber", "angularFrequency", "phase"], "wave");
    const read = (key: string, cap = MAX_PARAMETER): number => { if (typeof value[key] !== "number") invalid("wave", "wave parameters must retain numerical authority"); return bounded(value[key], "wave", cap); };
    return { amplitude: read("amplitude"), waveNumber: read("waveNumber"), angularFrequency: read("angularFrequency"), phase: read("phase", MAX_PHASE) };
  });
  const read = (key: string, cap = MAX_PARAMETER): number => { if (typeof definition[key] !== "number") invalid("wave", "wave frame metadata must be numerical"); return bounded(definition[key], "wave", cap); };
  const xMin = read("xMin"); const xMax = read("xMax"); const xScale = read("xScale"); const yScale = read("yScale");
  const samples = read("samples", MAX_SAMPLES); const depth = read("depth", MAX_DEPTH);
  if (!(xMin < xMax) || !(xScale > 0) || !(yScale > 0) || !Number.isInteger(samples) || samples < 17 || !Number.isInteger(depth) || depth < 1) invalid("wave", "wave frame/domain/sampling/depth metadata is invalid");
  if (!isRecord(definition.sourceUnits)) invalid("wave", "wave must retain source unit declarations");
  keys(definition.sourceUnits, ["position", "time", "amplitude"], "wave");
  const sourceUnits = definition.sourceUnits.position === null && definition.sourceUnits.time === null && definition.sourceUnits.amplitude === null ? { position: null, time: null, amplitude: null } : units(definition.sourceUnits);
  if (!Array.isArray(definition.sourceIds) || definition.sourceIds.length > MAX_SOURCES || definition.sourceIds.some((id) => typeof id !== "string" || !id.trim())) invalid("wave", "wave source identities are malformed");
  if (definition.zeroCertified !== (activeHarmonics(harmonics).length === 0)) invalid("wave", "wave zero certification contradicts its source parameters");
  const sampled = geometry.sampledCurve;
  if (sampled.curveKind !== "parametric" || sampled.parameterMin !== xMin || sampled.parameterMax !== xMax || typeof sampled.evaluate !== "function" || typeof sampled.derivative !== "function") invalid("wave", "wave analytic callback/domain metadata is inconsistent");
  if (!Array.isArray(geometry.points) || geometry.points.length !== samples) invalid("wave", "wave path sample count contradicts its definition");
  geometry.points.forEach((value) => point(value, "wave"));
  return { harmonics, origin: point(definition.origin, "wave"), xScale, yScale, time: read("time"), xMin, xMax, samples, sourceUnits, zeroCertified: definition.zeroCertified as boolean, depth, sourceIds: [...definition.sourceIds] as string[] };
}
function compatible(a: WaveDefinition, b: WaveDefinition): boolean {
  return a.xMin === b.xMin && a.xMax === b.xMax && a.time === b.time && a.origin.x === b.origin.x && a.origin.y === b.origin.y && a.xScale === b.xScale && a.yScale === b.yScale && a.sourceUnits.position === b.sourceUnits.position && a.sourceUnits.time === b.sourceUnits.time && a.sourceUnits.amplitude === b.sourceUnits.amplitude;
}

/** Physical parameters define the curve; display scales only transform its verified evaluation. */
export function evaluateWavesConstruction(operator: string, inputs: Record<string, unknown>, context: WavesEvaluationContext): WavesGeometry[] {
  if (operator === "harmonic_wave") {
    keys(inputs, ["amplitude", "waveNumber", "angularFrequency", "phase", "phaseUnit", "time", "xMin", "xMax", "samples", "origin", "xScale", "yScale", "units"]);
    if (unit(inputs.phaseUnit, "phaseUnit") !== "rad") invalid("phaseUnit", "harmonic phase must explicitly declare radians");
    const harmonic: WaveHarmonic = { amplitude: scalar(inputs.amplitude, "amplitude", context), waveNumber: scalar(inputs.waveNumber, "waveNumber", context), angularFrequency: scalar(inputs.angularFrequency, "angularFrequency", context), phase: scalar(inputs.phase, "phase", context, MAX_PHASE) };
    const time = scalar(inputs.time, "time", context); const xMin = scalar(inputs.xMin, "xMin", context); const xMax = scalar(inputs.xMax, "xMax", context);
    if (!(xMin < xMax) || !Number.isFinite(xMax - xMin)) invalid("domain", "wave domain must be finite with xMin < xMax");
    const xScale = inputs.xScale === undefined ? 1 : scalar(inputs.xScale, "xScale", context); const yScale = inputs.yScale === undefined ? 1 : scalar(inputs.yScale, "yScale", context);
    if (!(xScale > 0) || !(yScale > 0)) invalid("scale", "wave display scales must be positive");
    const sourceUnits = units(inputs.units);
    checkSourceUnits(inputs, sourceUnits);
    const samples = inputs.samples === undefined ? undefined : scalar(inputs.samples, "samples", context, MAX_SAMPLES);
    samplingCount(physicalBounds(activeHarmonics([harmonic]), { xMin, xMax, time, yScale }).minimum, samples);
    const model: WaveDefinition = { harmonics: [harmonic], origin: origin(inputs.origin, context), xScale, yScale, time, xMin, xMax, samples: 0, sourceUnits, zeroCertified: false, depth: 1, sourceIds: [] };
    return [wavePath(model, samples)];
  }
  if (operator === "wave_superposition") {
    keys(inputs, ["waves", "samples"]);
    if (!Array.isArray(inputs.waves) || inputs.waves.length < 1 || inputs.waves.length > MAX_SOURCES) invalid("waves", `wave_superposition requires 1 to ${MAX_SOURCES} explicit verified source waves`);
    const requestedSamples = inputs.samples === undefined ? undefined : scalar(inputs.samples, "samples", context, MAX_SAMPLES);
    if (requestedSamples !== undefined) samplingCount(17, requestedSamples);
    for (const actual of scalarUnits(inputs.samples)) if (unit(actual, "units") !== "1") invalid("samples_unit", "wave sampling counts are dimensionless");
    const sources = inputs.waves.map((value) => waveReference(value, context));
    const first = sources[0]!;
    if (sources.some((source) => !compatible(first, source))) invalid("waves", "superposition sources must share their physical domain, snapshot time, display frame/scales, and units");
    const harmonics = sources.flatMap((source) => source.harmonics).sort((a, b) => a.waveNumber - b.waveNumber || a.angularFrequency - b.angularFrequency || a.phase - b.phase || a.amplitude - b.amplitude);
    const depth = 1 + Math.max(...sources.map((source) => source.depth));
    if (harmonics.length > MAX_HARMONICS || depth > MAX_DEPTH) invalid("waves", "wave superposition exceeds the harmonic-count or composition-depth verification bound");
    const model: WaveDefinition = { ...first, origin: { ...first.origin }, sourceUnits: { ...first.sourceUnits }, harmonics, depth, sourceIds: [...inputs.waves as string[]].sort(), zeroCertified: false };
    const samples = requestedSamples ?? Math.max(...sources.map((source) => source.samples));
    return [wavePath(model, samples)];
  }
  if (operator === "wave_sample") {
    keys(inputs, ["wave", "x"]);
    const x = scalar(inputs.x, "x", context); const model = waveReference(inputs.wave, context);
    for (const actual of scalarUnits(inputs.x)) if (unit(actual, "units") !== (model.sourceUnits.position ?? "1")) invalid("x_unit", "sample x must use the wave's physical position scale");
    if (x < model.xMin || x > model.xMax) invalid("x", "wave sample must lie inside the verified physical domain");
    const active = activeHarmonics(model.harmonics); const physical = physicalAt(active, x, model.time);
    const amplitudeEnvelope = active.reduce((sum, harmonic) => sum + Math.abs(numeric(harmonic.amplitude, "amplitude", MAX_HARMONICS * MAX_PARAMETER)), 0);
    const waveId = inputs.wave as string;
    return [{ kind: "point", point: mappedPoint(model, x, physical.value, amplitudeEnvelope), calculusAnchor: { curveId: waveId, parameter: x }, waveSample: { waveId, x, value: physical.value, slope: physical.slope, time: model.time, sourceUnits: { ...model.sourceUnits } } }];
  }
  return invalid("operator", `unsupported waves operator ${operator}`);
}
function compactNumber(value: number): string { return value === 0 ? "0" : Math.abs(value) >= 0.001 && Math.abs(value) < 10000 ? Number(value.toPrecision(3)).toString() : value.toExponential(1); }
export function wavesConstructionOutputLabels(operator: string, outputs: readonly unknown[]): string[] {
  if (!(WAVES_OPERATORS as readonly string[]).includes(operator) || outputs.length !== 1 || !isRecord(outputs[0])) invalid("outputs", "waves labels require one complete evaluated output");
  const output = outputs[0];
  if (operator === "wave_sample") {
    if (output.kind !== "point" || !isRecord(output.waveSample) || typeof output.waveSample.value !== "number" || !Number.isFinite(output.waveSample.value) || !isRecord(output.calculusAnchor) || output.calculusAnchor.curveId !== output.waveSample.waveId || output.calculusAnchor.parameter !== output.waveSample.x) invalid("outputs", "wave sample labels require coherent engine-computed physical values and incidence metadata");
    point(output.point, "outputs");
    return [`y=${compactNumber(output.waveSample.value)}`];
  }
  if (output.kind !== "path" || !isRecord(output.waveDefinition) || !isRecord(output.sampledCurve) || typeof output.sampledCurve.evaluate !== "function" || typeof output.sampledCurve.derivative !== "function") invalid("outputs", "wave labels require typed analytic wave geometry");
  return [operator === "harmonic_wave" ? "y(x)" : "Σy(x)"];
}
export function validateEvaluatedWavesLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  const add = (message: string, actual?: unknown): void => { issues.push({ code: `invalid_${construction.operator}_label`, severity: "fatal", message, path: `constructions[${index}].outputs`, actual }); };
  try {
    const labels = wavesConstructionOutputLabels(construction.operator, outputs);
    for (const [outputIndex, output] of construction.outputs.entries()) {
      const entity = document.entities.find((candidate) => candidate.id === output);
      const label = labels[outputIndex];
      if (entity?.label !== undefined && entity.label !== label) add(`wave output labels are computed by the engine; expected ${label}`, entity.label);
      for (const annotation of document.annotations) if (annotation.targetIds.includes(output) && (annotation.quantityId !== undefined || annotation.text !== undefined && annotation.text !== label)) add("wave result annotations cannot introduce independent scalar or textual results", annotation);
    }
  } catch (error) { add(error instanceof Error ? error.message : "wave result labels are invalid"); }
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("quantity", "wave numeric quantity references must be acyclic and bounded");
  if (typeof value === "number") return bounded(value, "quantity", MAX_COORDINATE);
  if (isRecord(value) && "value" in value) { seen.add(value); return validationNumber(value.value, document, seen, depth + 1); }
  if (typeof value === "string" && value.trim()) {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) { seen.add(value); return validationNumber(quantity.value, document, seen, depth + 1); }
    return bounded(Number(value), "quantity", MAX_COORDINATE);
  }
  return invalid("quantity", "wave values must resolve to finite scalar numbers");
}
class DeferredWaveOrigin extends WavesInputError { constructor() { super("origin", "derived 2D origins will be checked against compiled geometry"); } }
export function validateWavesConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const add = (key: string, message: string): void => { issues.push({ code: `invalid_${construction.operator}_${key}`, severity: "fatal", message, path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}` }); };
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  if (outputs.length !== 1 || typeof outputs[0] !== "string" || !outputs[0].trim()) add("outputs", "wave constructions require exactly one output entity");
  const expectedKind = construction.operator === "wave_sample" ? "point" : "polyline";
  if (document.entities.find((entity) => entity.id === outputs[0])?.kind !== expectedKind) add("output_kind", `wave output must be entity kind ${expectedKind}`);
  if (!isRecord(construction.inputs)) { add("fields", "wave construction inputs must be an object"); return; }
  const sourceSpecification = (value: unknown, visited = new Set<string>()): { sourceUnits: WaveDefinition["sourceUnits"]; count: number; depth: number } => {
    if (typeof value !== "string" || !value.trim()) invalid("wave", "wave references require an explicit verified wave entity ID");
    if (visited.has(value) || visited.size >= MAX_DEPTH) invalid("waves", "wave source dependencies must be acyclic and bounded");
    const producer = constructionByOutput.get(value);
    if (!producer || document.entities.find((entity) => entity.id === value)?.kind !== "polyline") invalid("wave", "wave source must be a constructed harmonic or superposition polyline");
    if (producer.operator === "harmonic_wave") {
      const sourceUnits = units(producer.inputs.units); checkSourceUnits(producer.inputs, sourceUnits, document);
      return { sourceUnits, count: 1, depth: 1 };
    }
    if (producer.operator !== "wave_superposition" || !Array.isArray(producer.inputs.waves) || producer.inputs.waves.length < 1 || producer.inputs.waves.length > MAX_SOURCES) invalid("waves", "superposition sources require a bounded explicit wave-reference list");
    const next = new Set(visited).add(value);
    const children = producer.inputs.waves.map((source) => sourceSpecification(source, next));
    const count = children.reduce((sum, child) => sum + child.count, 0); const depth = 1 + Math.max(...children.map((child) => child.depth));
    if (count > MAX_HARMONICS || depth > MAX_DEPTH) invalid("waves", "wave source graph exceeds harmonic-count or depth bounds");
    const sourceUnits = children[0]!.sourceUnits;
    if (children.some((child) => child.sourceUnits.position !== sourceUnits.position || child.sourceUnits.time !== sourceUnits.time || child.sourceUnits.amplitude !== sourceUnits.amplitude)) invalid("units", "superposition source units must agree before evaluating their display origins");
    return { sourceUnits, count, depth };
  };
  const cache = new Map<string, WavesGeometry>(); const visiting = new Set<string>();
  const context: WavesEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      if (typeof value !== "string") return origin(value, context);
      const producer = constructionByOutput.get(value);
      if (!producer || document.entities.find((entity) => entity.id === value)?.kind !== "point" || ["space_point", "space_project", "space_intersection", "space_closest_points", "solid_anchor", "electric_field", "field_components"].includes(producer.operator)) invalid("origin", "wave origin references must identify verified 2D placement points");
      if (producer.operator !== "point") throw new DeferredWaveOrigin();
      return { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) };
    },
    geometry(value) {
      if (typeof value !== "string") return undefined;
      const producer = constructionByOutput.get(value);
      if (!producer) return undefined;
      if (document.entities.find((entity) => entity.id === value)?.kind === "point") return { kind: "point", point: context.point(value) };
      if (!["harmonic_wave", "wave_superposition"].includes(producer.operator) || document.entities.find((entity) => entity.id === value)?.kind !== "polyline") return undefined;
      if (visiting.has(value) || visiting.size >= MAX_DEPTH) invalid("waves", "wave dependencies must be acyclic and have bounded depth");
      const previous = cache.get(value); if (previous) return previous;
      visiting.add(value);
      try {
        if (producer.operator === "harmonic_wave") checkSourceUnits(producer.inputs, units(producer.inputs.units), document);
        const result = evaluateWavesConstruction(producer.operator, producer.inputs, context)[0]!;
        cache.set(value, result); return result;
      } finally { visiting.delete(value); }
    },
  };
  try {
    if (construction.operator === "harmonic_wave") checkSourceUnits(construction.inputs, units(construction.inputs.units), document);
    if (construction.operator === "wave_superposition") for (const actual of scalarUnits(construction.inputs.samples, document)) if (unit(actual, "units") !== "1") invalid("samples_unit", "wave sampling counts are dimensionless");
    if (construction.operator === "wave_superposition") sourceSpecification(outputs[0]);
    if (construction.operator === "wave_sample") {
      const { sourceUnits } = sourceSpecification(construction.inputs.wave);
      for (const actual of scalarUnits(construction.inputs.x, document)) if (unit(actual, "units") !== (sourceUnits.position ?? "1")) invalid("x_unit", "sample x must use the wave's physical position unit");
    }
    const evaluated = evaluateWavesConstruction(construction.operator, construction.inputs, context);
    if (construction.operator === "wave_sample") {
      const result = evaluated[0];
      if (result?.kind === "point") for (const actual of scalarUnits(construction.inputs.x, document)) if (unit(actual, "units") !== (result.waveSample.sourceUnits.position ?? "1")) invalid("x_unit", "sample x must use the wave's physical position unit");
    }
    validateEvaluatedWavesLabels(construction, index, document, evaluated, issues);
  } catch (error) {
    if (error instanceof DeferredWaveOrigin) return;
    add(error instanceof WavesInputError ? error.key : "inputs", error instanceof Error ? error.message : "wave inputs are invalid");
  }
}
