import { parseMathExpression } from "../math/expression";
import { evaluateKinematicsConstruction } from "./kinematicsGeometry";
import { evaluateWavesConstruction } from "./wavesGeometry";
import { evaluateElasticityConstruction } from "./elasticityGeometry";
import { evaluateInductionConstruction } from "./inductionGeometry";
import { evaluateDistributedFieldsConstruction } from "./distributedFieldsGeometry";
import { evaluateHarmonicMotionConstruction } from "./harmonicMotionGeometry";
import { evaluateFluidConstruction } from "./fluidGeometry";
import { evaluateThermodynamicsConstruction } from "./thermodynamicsGeometry";
import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const CALCULUS_OPERATORS = ["curve_anchor", "curve_secant", "curve_derivative"] as const;
export interface CalculusAnchorDefinition { curveId: string; parameter: number }
export interface CalculusDerivativeDefinition { curveId: string; parameter: number; derivative: RenderPoint; parameterScale: number }
export interface CalculusCurveDefinition {
  curveKind: "function" | "parametric" | "polar";
  parameterMin: number; parameterMax: number;
  evaluate(parameter: number): RenderPoint;
  derivative?(parameter: number): RenderPoint;
}
export type CalculusGeometry =
  | { kind: "point"; point: RenderPoint; calculusAnchor?: CalculusAnchorDefinition; calculusDerivative?: CalculusDerivativeDefinition }
  | { kind: "path"; points: RenderPoint[]; directed?: boolean; infinite?: boolean; calculusDerivative?: CalculusDerivativeDefinition };
export interface CalculusEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
const MAX_COORDINATE = 1e12;
const MAX_SCALE = 1e9;
const MIN_LENGTH = 1e-6;
const MAX_REPLAY_DEPTH = 32;
const MAX_REPLAY_CONSTRUCTIONS = 4096;
const INPUT_KEYS: Readonly<Record<string, readonly string[]>> = {
  curve_anchor: ["curve", "at"], curve_secant: ["curve", "first", "second", "span"], curve_derivative: ["curve", "at", "parameterScale"],
};
class CalculusInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new CalculusInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function bounded(value: number, key: string, cap = MAX_COORDINATE): number { if (!Number.isFinite(value) || Math.abs(value) > cap) invalid(key, `${key} requires a finite number with magnitude at most ${cap}`); return value; }
function scalar(value: unknown, key: string, context: CalculusEvaluationContext, cap = MAX_COORDINATE, depth = 0): number {
  if (depth > 32) return invalid(key, "numeric reference depth exceeds32");
  if (isRecord(value) && "value" in value) {
    if (Object.keys(value).some((field) => field !== "value" && field !== "unit")) invalid(key, "calculus numeric wrapper accepts only value and unit");
    if (value.unit !== undefined && (typeof value.unit !== "string" || !value.unit.trim())) invalid(key, "calculus numeric wrapper unit must be a nonempty string");
    return scalar(value.value, key, context, cap, depth + 1);
  }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return invalid(key, `${key} must be a numeric literal or quantity reference`);
  try { return bounded(context.number(value), key, cap); }
  catch (error) { if (error instanceof CalculusInputError) throw error; return invalid(key, `${key} requires a finite numeric value`); }
}
function point(value: unknown, key: string): RenderPoint {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") return invalid(key, `${key} must contain finite x,y coordinates`);
  return { x: bounded(value.x, key), y: bounded(value.y, key) };
}
function curveReference(value: unknown, context: CalculusEvaluationContext): CalculusCurveDefinition {
  if (typeof value !== "string") return invalid("curve", "curve must reference analytic sampled-curve geometry");
  const geometry = context.geometry(value);
  if (!isRecord(geometry) || !["path", "point"].includes(String(geometry.kind)) || !isRecord(geometry.sampledCurve)) return invalid("curve", "curve must retain analytic sampledCurve metadata");
  if (["space", "spaceLine", "spacePlane", "spaceSegment", "spaceFrameId", "electricField", "conic", "markedAngleRadians", "vectorDefinition"].some((key) => geometry[key] !== undefined)) invalid("curve", "calculus cannot flatten protected world, physical, or angle geometry");
  const sampled = geometry.sampledCurve;
  if (!["function", "parametric", "polar"].includes(String(sampled.curveKind)) || typeof sampled.evaluate !== "function" || typeof sampled.parameterMin !== "number" || typeof sampled.parameterMax !== "number") return invalid("curve", "curve metadata must include a bounded domain and exact evaluation function");
  const parameterMin = bounded(sampled.parameterMin, "curve"); const parameterMax = bounded(sampled.parameterMax, "curve");
  if (!(parameterMin < parameterMax) || !Number.isFinite(parameterMax - parameterMin)) invalid("curve", "curve requires a finite increasing parameter interval");
  return sampled as unknown as CalculusCurveDefinition;
}
function parameter(value: unknown, key: string, curve: CalculusCurveDefinition, context: CalculusEvaluationContext): number {
  const result = scalar(value, key, context);
  if (result < curve.parameterMin || result > curve.parameterMax) invalid(key, `${key} lies outside the verified curve domain`);
  return result;
}
function checkedInputs(operator: string, inputs: Record<string, unknown>): void {
  if (!isRecord(inputs)) invalid("fields", "calculus inputs must be an object");
  const keys = INPUT_KEYS[operator]; if (!keys) return invalid("operator", `unsupported calculus operator ${operator}`);
  const extra = Object.keys(inputs).filter((key) => !keys.includes(key)); if (extra.length) invalid("fields", `unsupported calculus inputs: ${extra.join(", ")}`);
}

/** Analytic curve evaluation is authoritative; sampled display chords and finite differences are never used here. */
export function evaluateCalculusConstruction(operator: string, inputs: Record<string, unknown>, context: CalculusEvaluationContext): CalculusGeometry[] {
  checkedInputs(operator, inputs);
  const curve = curveReference(inputs.curve, context);
  const curveId = inputs.curve as string;
  if (operator === "curve_anchor") {
    const at = parameter(inputs.at, "at", curve, context);
    return [{ kind: "point", point: point(curve.evaluate(at), "geometry"), calculusAnchor: { curveId, parameter: at } }];
  }
  if (operator === "curve_secant") {
    const first = parameter(inputs.first, "first", curve, context); const second = parameter(inputs.second, "second", curve, context);
    if (!(Math.abs(second - first) > Number.EPSILON * 8 * Math.max(1, Math.abs(first), Math.abs(second)))) invalid("second", "secant parameters must be distinct at numeric precision");
    const a = point(curve.evaluate(first), "geometry"); const b = point(curve.evaluate(second), "geometry");
    const dx = b.x - a.x; const dy = b.y - a.y; const chord = Math.hypot(dx, dy);
    if (!(chord > MIN_LENGTH)) invalid("geometry", "secant requires noncoincident curve endpoints");
    if (inputs.span === undefined) return [{ kind: "path", infinite: true, points: [a, b] }];
    const span = scalar(inputs.span, "span", context, MAX_SCALE);
    if (!(span >= chord)) invalid("span", "secant span must contain both endpoint anchors");
    const center = { x: a.x + dx / 2, y: a.y + dy / 2 };
    const half = { x: dx / chord * span / 2, y: dy / chord * span / 2 };
    const start = point({ x: center.x - half.x, y: center.y - half.y }, "geometry"); const end = point({ x: center.x + half.x, y: center.y + half.y }, "geometry");
    if (Math.hypot((end.x - start.x) - 2 * half.x, (end.y - start.y) - 2 * half.y) > span * 1e-7) invalid("geometry", "secant span cannot retain its endpoint vector at placement precision");
    return [{ kind: "path", infinite: true, points: [start, end] }];
  }
  const at = parameter(inputs.at, "at", curve, context);
  const parameterScale = scalar(inputs.parameterScale, "parameterScale", context, MAX_SCALE);
  if (!(parameterScale > 0)) invalid("parameterScale", "derivative parameterScale must be positive");
  if (typeof curve.derivative !== "function") return invalid("curve", "curve_derivative requires an analytic derivative callback; finite differences cannot certify exact vectors");
  const origin = point(curve.evaluate(at), "geometry"); const derivative = point(curve.derivative(at), "derivative");
  const calculusDerivative = { curveId, parameter: at, derivative, parameterScale };
  if (derivative.x === 0 && derivative.y === 0) return [{ kind: "point", point: origin, calculusAnchor: { curveId, parameter: at }, calculusDerivative }];
  const delta = { x: derivative.x * parameterScale, y: derivative.y * parameterScale };
  const end = point({ x: origin.x + delta.x, y: origin.y + delta.y }, "geometry"); const magnitude = Math.hypot(delta.x, delta.y);
  if (!(magnitude > MIN_LENGTH) || !(Math.hypot(end.x - origin.x, end.y - origin.y) > MIN_LENGTH)) invalid("geometry", "nonzero derivative cannot be rendered as a zero or invisible vector");
  if (Math.hypot((end.x - origin.x) - delta.x, (end.y - origin.y) - delta.y) > magnitude * 1e-7) invalid("geometry", "derivative placement cannot preserve its exact scaled vector at numeric precision");
  return [{ kind: "path", directed: true, points: [origin, end], calculusDerivative }];
}

/** Only a matching curve identity permits exact parameter-pinned incidence; other 2D relations retain their own proof. */
export function calculusAnchorResidual(pointGeometry: unknown, targetGeometry: unknown, targetId?: string): number | null {
  if (!isRecord(pointGeometry) || !isRecord(pointGeometry.calculusAnchor)) return null;
  const anchor = pointGeometry.calculusAnchor;
  if (typeof anchor.curveId !== "string" || typeof anchor.parameter !== "number") return Infinity;
  if (targetId === undefined || anchor.curveId !== targetId) return null;
  try {
    const curve = curveReference(targetId, { number: Number, point: () => point(pointGeometry.point, "point"), geometry: () => targetGeometry });
    if (anchor.parameter < curve.parameterMin || anchor.parameter > curve.parameterMax) return Infinity;
    const expected = point(curve.evaluate(anchor.parameter), "curve"); const actual = point(pointGeometry.point, "point");
    return Math.hypot(actual.x - expected.x, actual.y - expected.y);
  } catch { return Infinity; }
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<string>(), depth = 0): number {
  if (depth > 32) return invalid("number", "numeric reference depth exceeds32");
  if (typeof value === "number") return bounded(value, "number");
  if (isRecord(value) && "value" in value) return validationNumber(value.value, document, seen, depth + 1);
  if (typeof value !== "string" || !value.trim() || seen.has(value)) return invalid("number", "number requires a finite literal or acyclic quantity reference");
  const quantity = document.quantities.find((quantity) => quantity.id === value); if (!quantity) return bounded(Number(value), "number");
  seen.add(value); return validationNumber(quantity.value, document, seen, depth + 1);
}
function parameterizedExpression(value: unknown, name: "t" | "theta") {
  if (typeof value !== "string" || /\bx\b/.test(value)) return invalid("curve", `${name} expression must use its declared parameter`);
  return parseMathExpression(value.replace(new RegExp(`\\b${name}\\b`, "g"), "x"));
}
const UNIT_ALIASES: Readonly<Record<string, string>> = { "1": "1", dimensionless: "1", unit: "1", units: "1", rad: "rad", radian: "rad", radians: "rad", s: "s", sec: "s", second: "s", seconds: "s", ms: "ms", millisecond: "ms", milliseconds: "ms", m: "m", meter: "m", meters: "m", metre: "m", metres: "m", cm: "cm", centimeter: "cm", centimeters: "cm", centimetre: "cm", centimetres: "cm", mm: "mm", millimeter: "mm", millimeters: "mm", millimetre: "mm", millimetres: "mm", km: "km", um: "um", "µm": "um", "μm": "um", nm: "nm", ft: "ft", in: "in" };
function normalizedUnit(value: string): string { return value.trim().replace(/[A-Za-z]{4,}/g, (word) => word.toLowerCase()); }
function scalarUnits(value: unknown, document: SceneDocument, seen = new Set<string>(), depth = 0): string[] {
  if (depth > 32) return invalid("units", "unit reference depth exceeds32");
  if (isRecord(value)) {
    if (value.unit !== undefined && (typeof value.unit !== "string" || !value.unit.trim())) invalid("units", "known calculus quantity units must be nonempty strings");
    return [...(typeof value.unit === "string" ? [UNIT_ALIASES[normalizedUnit(value.unit)] ?? invalid("units", `unsupported calculus quantity unit ${value.unit}`)] : []), ...("value" in value ? scalarUnits(value.value, document, seen, depth + 1) : [])];
  }
  if (typeof value !== "string") return [];
  const quantity = document.quantities.find((quantity) => quantity.id === value); if (!quantity) return [];
  if (seen.has(value)) return invalid("units", "quantity unit provenance must be acyclic");
  seen.add(value); return scalarUnits(quantity, document, seen, depth + 1);
}
function validateUnits(construction: SceneConstruction, document: SceneDocument, byOutput: Map<string, SceneConstruction>, geometry: unknown): void {
  const producer = typeof construction.inputs.curve === "string" ? byOutput.get(construction.inputs.curve) : undefined;
  if (!producer) return;
  const inputs = producer.inputs;
  const parameterKeys = producer.operator === "function_curve" ? [inputs.xMin ?? inputs.x_min, inputs.xMax ?? inputs.x_max]
    : producer.operator === "polar_curve" ? [inputs.thetaMin ?? inputs.parameterMin, inputs.thetaMax ?? inputs.parameterMax]
      : [inputs.tMin ?? inputs.parameterMin, inputs.tMax ?? inputs.parameterMax];
  const parameterUnits = new Set(parameterKeys.flatMap((value) => scalarUnits(value, document)));
  const wave = ["harmonic_wave", "wave_superposition"].includes(producer.operator);
  const thermodynamic = ["polytropic_process", "isochoric_process"].includes(producer.operator);
  if (wave) {
    if (!isRecord(geometry) || !isRecord(geometry.waveDefinition) || !isRecord(geometry.waveDefinition.sourceUnits)) invalid("units", "wave calculus requires verified source-position units");
    const declared = geometry.waveDefinition.sourceUnits.position;
    parameterUnits.add(declared === null ? "1" : typeof declared === "string" ? UNIT_ALIASES[normalizedUnit(declared)] ?? invalid("units", "wave position unit is not supported") : invalid("units", "wave source-position unit metadata is invalid"));
  }
  if (thermodynamic || producer.operator === "elastic_profile") parameterUnits.add("1");
  if (producer.operator === "flux_process" && isRecord(inputs.units) && typeof inputs.units.time === "string") parameterUnits.add(UNIT_ALIASES[inputs.units.time] ?? invalid("units", "flux source time unit is not supported"));
  if (producer.operator === "flux_sinusoid" && isRecord(inputs.units) && typeof inputs.units.time === "string") parameterUnits.add(UNIT_ALIASES[inputs.units.time] ?? invalid("units", "sinusoid source time unit is not supported"));
  if (producer.operator === "harmonic_motion" && typeof inputs.timeUnit === "string") parameterUnits.add(UNIT_ALIASES[inputs.timeUnit] ?? invalid("units", "harmonic source time unit is not supported"));
  if (producer.operator === "hydrostatic_profile" && typeof inputs.depthUnit === "string") parameterUnits.add(UNIT_ALIASES[inputs.depthUnit] ?? invalid("units", "hydrostatic depth unit is not supported"));
  if (producer.operator === "constant_acceleration_trajectory" && isRecord(inputs.units) && typeof inputs.units.time === "string") parameterUnits.add(UNIT_ALIASES[inputs.units.time] ?? invalid("units", "trajectory time unit is not supported"));
  if (producer.operator === "polar_curve" && [...parameterUnits].some((unit) => unit !== "rad" && unit !== "1")) invalid("units", "polar parameters must be radians or dimensionless");
  if (producer.operator === "polar_curve") parameterUnits.delete("1");
  if (parameterUnits.size > 1) invalid("units", "curve domain endpoints must use one common parameter scale");
  const expected = parameterUnits.values().next().value as string | undefined ?? (producer.operator === "polar_curve" ? "rad" : "1");
  const keys = construction.operator === "curve_secant" ? ["first", "second"] : construction.operator === "curve_derivative" ? ["at", "parameterScale"] : ["at"];
  for (const key of keys) for (const unit of scalarUnits(construction.inputs[key], document)) if (unit !== expected && !(producer.operator === "polar_curve" && unit === "1")) invalid("units", `${key} must use the curve's parameter scale ${expected}`);
  if (construction.inputs.span !== undefined) {
    const worldUnit = producer.operator === "function_curve" ? expected : producer.operator === "constant_acceleration_trajectory" && isRecord(inputs.units) && typeof inputs.units.length === "string" ? UNIT_ALIASES[inputs.units.length] ?? invalid("units", "unsupported trajectory length unit") : "1";
    for (const unit of scalarUnits(construction.inputs.span, document)) if (unit !== worldUnit) invalid("units", `secant span must use the curve's coordinate scale ${worldUnit}`);
  }
}

function analyticReplayContext(document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>): CalculusEvaluationContext {
  const cache = new Map<SceneConstruction, readonly unknown[]>(); const visiting = new Set<SceneConstruction>();
  const context: CalculusEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      if (typeof value === "string") {
        const producer = constructionByOutput.get(value);
        if (producer?.operator !== "point") return invalid("point", "trajectory point source must reference a constructed point");
        return { x: scalar(producer.inputs.x, "x", context), y: scalar(producer.inputs.y, "y", context) };
      }
      if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], "point", context), y: scalar(value[1], "point", context) };
      if (isRecord(value)) return { x: scalar(value.x, "point", context), y: scalar(value.y, "point", context) };
      return invalid("point", "trajectory point source is invalid");
    },
    geometry(value) {
      const producer = typeof value === "string" ? constructionByOutput.get(value) : undefined;
      if (!producer) return undefined;
      const outputIndex = producer.outputs.indexOf(value as string);
      if (outputIndex < 0) invalid("curve", "referenced curve must be an output of its producer");
      const cached = cache.get(producer); if (cached) return cached[outputIndex];
      if (visiting.has(producer) || visiting.size >= MAX_REPLAY_DEPTH) invalid("curve", "analytic curve dependencies must be acyclic and have bounded depth");
      if (cache.size + visiting.size >= MAX_REPLAY_CONSTRUCTIONS) invalid("curve", "analytic curve replay exceeds the bounded construction count");
      visiting.add(producer);
      try {
        const replay = (): readonly unknown[] => {
          const inputs = producer.inputs;
          if (producer.operator === "point") return [{ kind: "point", point: { x: scalar(inputs.x, "x", context), y: scalar(inputs.y, "y", context) } }];
          if (producer.operator === "constant_acceleration_trajectory") return evaluateKinematicsConstruction(producer.operator, inputs, context);
          if (["harmonic_wave", "wave_superposition"].includes(producer.operator)) return evaluateWavesConstruction(producer.operator, inputs, context);
          if (producer.operator === "elastic_profile") return evaluateElasticityConstruction(producer.operator, inputs, context);
          if (producer.operator === "flux_process") return evaluateInductionConstruction(producer.operator, inputs, context);
          if (producer.operator === "flux_sinusoid") return evaluateDistributedFieldsConstruction(producer.operator, inputs, context);
          if (producer.operator === "harmonic_motion") return evaluateHarmonicMotionConstruction(producer.operator, inputs, context);
          if (producer.operator === "hydrostatic_profile") return evaluateFluidConstruction(producer.operator, inputs, context);
          if (["polytropic_process", "isochoric_process"].includes(producer.operator)) return evaluateThermodynamicsConstruction(producer.operator, inputs, context);
          if (producer.operator === "function_curve") {
            if (typeof inputs.expression !== "string") return invalid("curve", "function curve requires its source expression");
            const expression = parseMathExpression(inputs.expression);
            const parameterMin = scalar(inputs.xMin ?? inputs.x_min, "curve", context); const parameterMax = scalar(inputs.xMax ?? inputs.x_max, "curve", context);
            expression.assertContinuousOn(parameterMin, parameterMax);
            return [{ kind: "path", sampledCurve: { curveKind: "function", parameterMin, parameterMax, evaluate: (x: number) => ({ x, y: expression.evaluate(x) }), derivative: (x: number) => ({ x: 1, y: expression.derivative(x) }) } }];
          }
          if (producer.operator === "parametric_curve") {
            if (inputs.parameter !== undefined && inputs.parameter !== "t") return invalid("curve", "parametric curve parameter must be t");
            const x = parameterizedExpression(inputs.xExpression, "t"); const y = parameterizedExpression(inputs.yExpression, "t");
            const parameterMin = scalar(inputs.tMin ?? inputs.parameterMin, "curve", context); const parameterMax = scalar(inputs.tMax ?? inputs.parameterMax, "curve", context);
            x.assertContinuousOn(parameterMin, parameterMax); y.assertContinuousOn(parameterMin, parameterMax);
            return [{ kind: "path", sampledCurve: { curveKind: "parametric", parameterMin, parameterMax, evaluate: (t: number) => ({ x: x.evaluate(t), y: y.evaluate(t) }), derivative: (t: number) => ({ x: x.derivative(t), y: y.derivative(t) }) } }];
          }
          if (producer.operator === "polar_curve") {
            if (inputs.parameter !== undefined && inputs.parameter !== "theta") return invalid("curve", "polar curve parameter must be theta in radians");
            const radius = parameterizedExpression(inputs.radiusExpression, "theta");
            const parameterMin = scalar(inputs.thetaMin ?? inputs.parameterMin, "curve", context); const parameterMax = scalar(inputs.thetaMax ?? inputs.parameterMax, "curve", context);
            radius.assertContinuousOn(parameterMin, parameterMax);
            return [{ kind: "path", sampledCurve: { curveKind: "polar", parameterMin, parameterMax, evaluate: (theta: number) => ({ x: radius.evaluate(theta) * Math.cos(theta), y: radius.evaluate(theta) * Math.sin(theta) }), derivative: (theta: number) => ({ x: radius.derivative(theta) * Math.cos(theta) - radius.evaluate(theta) * Math.sin(theta), y: radius.derivative(theta) * Math.sin(theta) + radius.evaluate(theta) * Math.cos(theta) }) } }];
          }
          return [];
        };
        const outputs = replay();
        if (outputs.length && outputs.length !== producer.outputs.length) invalid("curve", "analytic source output arity does not match its evaluated geometry");
        cache.set(producer, outputs); return outputs[outputIndex];
      } finally { visiting.delete(producer); }
    },
  };
  return context;
}

export function validateCalculusConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const add = (key: string, message: string): void => { issues.push({ code: `invalid_${construction.operator}_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}` }); };
  const outputIds = Array.isArray(construction.outputs) ? construction.outputs : [];
  if (outputIds.length !== 1 || typeof outputIds[0] !== "string" || !outputIds[0].trim()) add("outputs", "calculus construction requires exactly one output");
  const context = analyticReplayContext(document, constructionByOutput);
  try {
    validateUnits(construction, document, constructionByOutput, context.geometry(construction.inputs.curve));
    const result = evaluateCalculusConstruction(construction.operator, construction.inputs, context)[0]!;
    const expectedKind = result.kind === "point" ? "point" : result.directed ? "vector" : "line";
    if (document.entities.find((entity) => entity.id === outputIds[0])?.kind !== expectedKind) add("output_kind", `calculus output must use entity kind ${expectedKind}`);
  } catch (error) { add(error instanceof CalculusInputError ? error.key : "inputs", error instanceof Error ? error.message : "invalid calculus construction"); }
}

/** Legacy tangent/normal lines share the exact replay authority without widening function-only assertions. */
export function validateAnalyticLineConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const add = (key: string, message: string): void => { issues.push({ code: `invalid_${construction.operator}_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}` }); };
  try {
    if (!["tangent_line", "normal_line"].includes(construction.operator)) invalid("operator", "analytic line validation requires tangent_line or normal_line");
    if (construction.outputs.length !== 1 || typeof construction.outputs[0] !== "string" || !construction.outputs[0].trim()) invalid("outputs", "analytic line requires exactly one output");
    if (!["line", "segment", "polyline"].includes(document.entities.find((entity) => entity.id === construction.outputs[0])?.kind ?? "")) invalid("output_kind", "analytic line output must use a line, segment, or polyline entity");
    if (!isRecord(construction.inputs)) invalid("fields", "analytic line inputs must be an object");
    if (Object.keys(construction.inputs).some((key) => !["curve", "target", "at", "parameter", "atX", "span"].includes(key))) invalid("fields", "analytic lines accept only curve, parameter, and span inputs");
    const inputs = { curve: construction.inputs.curve ?? construction.inputs.target, at: construction.inputs.at ?? construction.inputs.parameter ?? construction.inputs.atX };
    const normalized = { ...construction, inputs };
    const context = analyticReplayContext(document, constructionByOutput);
    const geometry = context.geometry(inputs.curve);
    validateUnits(normalized, document, constructionByOutput, geometry);
    const curve = curveReference(inputs.curve, context);
    const at = parameter(inputs.at, "at", curve, context);
    if (!(at > curve.parameterMin && at < curve.parameterMax)) invalid("at", "analytic line parameter must be strictly inside the curve domain");
    if (typeof curve.derivative !== "function") invalid("curve", "analytic line requires an exact derivative callback");
    const origin = point(curve.evaluate(at), "curve"); const derivative = point(curve.derivative(at), "curve");
    const magnitude = Math.hypot(derivative.x, derivative.y);
    if (!(magnitude >= MIN_LENGTH)) invalid("curve", "analytic line requires a finite nonzero derivative at placement precision");
    const span = construction.inputs.span === undefined ? bounded(Math.max(curve.parameterMax - curve.parameterMin, 1) * 0.5, "span", MAX_SCALE) : scalar(construction.inputs.span, "span", context, MAX_SCALE);
    if (!(span > MIN_LENGTH)) invalid("span", "analytic line span must be positive and visible at placement precision");
    for (const unit of scalarUnits(construction.inputs.span, document)) if (unit !== "1") invalid("span", "analytic line span is a dimensionless display length");
    const direction = construction.operator === "normal_line" ? { x: -derivative.y / magnitude, y: derivative.x / magnitude } : { x: derivative.x / magnitude, y: derivative.y / magnitude };
    const a = point({ x: origin.x - direction.x * span / 2, y: origin.y - direction.y * span / 2 }, "geometry");
    const b = point({ x: origin.x + direction.x * span / 2, y: origin.y + direction.y * span / 2 }, "geometry");
    if (Math.hypot((b.x - a.x) - direction.x * span, (b.y - a.y) - direction.y * span) > span * 1e-7) invalid("geometry", "analytic line cannot retain its derivative direction at placement precision");
  } catch (error) { add(error instanceof CalculusInputError ? error.key : "inputs", error instanceof Error ? error.message : "invalid analytic line construction"); }
}
