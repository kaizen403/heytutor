import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const ELASTICITY_OPERATORS = ["elastic_profile", "elastic_state"] as const;
export interface ElasticProfileDefinition {
  model: "linear_elastic"; youngModulus: number; modulusUnit: string; youngModulusSI: number;
  strainMin: number; strainMax: number; stressUnit: string;
  origin: RenderPoint; strainScale: number; stressScale: number; samples: number;
}
export interface ElasticStateDefinition {
  profileId: string; model: "linear_elastic"; strain: number; youngModulusSI: number;
  stressSI: number; stressSource: number; stressUnit: string; uniformBar: boolean;
  area?: number; areaUnit?: string; areaSI?: number; forceSI?: number;
  length?: number; lengthUnit?: string; lengthSI?: number; extensionSI?: number; finalLengthSI?: number;
  energyJ?: number;
}
export type ElasticityGeometry =
  | { kind: "path"; points: RenderPoint[]; elasticProfile: ElasticProfileDefinition; sampledCurve: { curveKind: "parametric"; parameterMin: number; parameterMax: number; evaluate(strain: number): RenderPoint; derivative(strain: number): RenderPoint } }
  | { kind: "point"; point: RenderPoint; elasticState: ElasticStateDefinition; calculusAnchor: { curveId: string; parameter: number } };
export interface ElasticityEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
const MAX_SOURCE = 1e12;
const MAX_SI = 1e15;
const MAX_STRAIN = 1e3;
const MAX_DISPLAY = 1e9;
const MAX_SAMPLES = 513;
const MIN_LENGTH = 1e-6;
const RELATIVE_ERROR = 64 * Number.EPSILON;
const INPUT_KEYS: Readonly<Record<string, readonly string[]>> = {
  elastic_profile: ["model", "youngModulus", "modulusUnit", "strainMin", "strainMax", "origin", "strainScale", "stressScale", "stressUnit", "samples"],
  elastic_state: ["profile", "strain", "area", "areaUnit", "length", "lengthUnit", "uniformBar"],
};
class ElasticityInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new ElasticityInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fields(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void { if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) invalid(key, "elastic construction contains unsupported fields"); }
function finite(value: number, key: string, cap = MAX_SOURCE): number { if (!Number.isFinite(value) || Math.abs(value) > cap) invalid(key, `${key} must remain finite with magnitude at most ${cap}`); return value === 0 ? 0 : value; }
function preserveLiteral(value: unknown, key: string): void { const match = typeof value === "string" && /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE][+-]?\d+)?$/.exec(value.trim()); if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) invalid(key, "nonzero elastic sources cannot underflow to zero"); }
function scalar(value: unknown, key: string, context: ElasticityEvaluationContext, cap = MAX_SOURCE, depth = 0): number {
  if (depth > 32) invalid(key, "elastic numeric references exceed depth32"); if (isRecord(value)) { fields(value, ["value", "unit"], key); return scalar(value.value, key, context, cap, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, "elastic scalars require a literal, numeric string, or quantity reference"); preserveLiteral(value, key); try { return finite(context.number(value), key, cap); } catch (error) { if (error instanceof ElasticityInputError) throw error; return invalid(key, "elastic scalar must resolve to a finite number"); }
}
function product(a: number, b: number, key: string, cap = MAX_SI): number { const result = finite(a * b, key, cap); if (a !== 0 && b !== 0 && result === 0) invalid(key, "nonzero elastic products cannot underflow to zero"); return result; }
function positive(value: number, key: string): number { if (!(value > 0)) invalid(key, `${key} must be positive`); return value; }
type Unit = { canonical: string; factor: number };
const UNITS: Readonly<Record<string, Readonly<Record<string, Unit>>>> = {
  stress: { pa: { canonical: "Pa", factor: 1 }, kpa: { canonical: "kPa", factor: 1000 }, mpa: { canonical: "MPa", factor: 1e6 }, gpa: { canonical: "GPa", factor: 1e9 } },
  area: { "m^2": { canonical: "m^2", factor: 1 }, "cm^2": { canonical: "cm^2", factor: 1e-4 }, "mm^2": { canonical: "mm^2", factor: 1e-6 } },
  length: { m: { canonical: "m", factor: 1 }, cm: { canonical: "cm", factor: 0.01 }, mm: { canonical: "mm", factor: 0.001 }, km: { canonical: "km", factor: 1000 } },
  force: { n: { canonical: "N", factor: 1 }, kn: { canonical: "kN", factor: 1000 } }, energy: { j: { canonical: "J", factor: 1 }, kj: { canonical: "kJ", factor: 1000 } },
};
function normalizedUnit(value: string): string { return value.trim().replaceAll("²", "^2"); }
function unit(value: unknown, kind: string): Unit { const found = typeof value === "string" ? Object.values(UNITS[kind] ?? {}).find((entry) => entry.canonical === normalizedUnit(value)) : undefined; if (!found) invalid("units", `elasticity requires a supported case-sensitive ${kind} unit`); return found; }
function sourceUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) invalid("units", "elastic unit provenance must be acyclic and bounded"); const record = isRecord(value) ? value : typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : undefined; if (!record) return [];
  if (record.unit !== undefined && (typeof record.unit !== "string" || !record.unit.trim())) invalid("units", "known elastic units must be nonempty strings"); seen.add(value); return [...(typeof record.unit === "string" ? [record.unit] : []), ...("value" in record ? sourceUnits(record.value, document, seen, depth + 1) : [])];
}
function dimensionless(value: unknown, document?: SceneDocument): void { for (const actual of sourceUnits(value, document)) if (!["1", "dimensionless", "unit", "units"].includes(normalizedUnit(actual))) invalid("units", "elastic strains and display/sampling parameters must be dimensionless"); }
function matches(value: unknown, kind: string, declared: unknown, document?: SceneDocument): void { const expected = unit(declared, kind); for (const actual of sourceUnits(value, document)) if (unit(actual, kind).factor !== expected.factor) invalid("units", "quantity-bound elastic sources must use their explicit common source scale"); }
function checkUnits(operator: string, inputs: Record<string, unknown>, document?: SceneDocument): void {
  if (operator === "elastic_profile") { matches(inputs.youngModulus, "stress", inputs.modulusUnit, document); for (const key of ["strainMin", "strainMax", "strainScale", "stressScale", "samples"]) if (inputs[key] !== undefined) dimensionless(inputs[key], document); const coordinates = Array.isArray(inputs.origin) ? inputs.origin : isRecord(inputs.origin) ? [inputs.origin.x, inputs.origin.y] : []; coordinates.forEach((coordinate) => dimensionless(coordinate, document)); }
  else { dimensionless(inputs.strain, document); if (inputs.area !== undefined) matches(inputs.area, "area", inputs.areaUnit, document); if (inputs.length !== undefined) matches(inputs.length, "length", inputs.lengthUnit, document); }
}
function origin(value: unknown, context: ElasticityEvaluationContext): RenderPoint { if (value === undefined) return { x: 0, y: 0 }; if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], "origin", context), y: scalar(value[1], "origin", context) }; if (isRecord(value)) { fields(value, ["x", "y"], "origin"); return { x: scalar(value.x, "origin", context), y: scalar(value.y, "origin", context) }; } return invalid("origin", "elastic display origins must be inline 2D coordinates"); }
function readProfile(inputs: Record<string, unknown>, context: ElasticityEvaluationContext): ElasticProfileDefinition {
  if (inputs.model !== "linear_elastic") invalid("model", "elastic_profile requires an explicitly supplied linear_elastic constitutive assumption"); const modulus = unit(inputs.modulusUnit, "stress"); const stress = unit(inputs.stressUnit ?? inputs.modulusUnit, "stress");
  const youngModulus = positive(scalar(inputs.youngModulus, "youngModulus", context), "youngModulus"); const youngModulusSI = positive(product(youngModulus, modulus.factor, "youngModulusSI"), "youngModulusSI"); const strainMin = scalar(inputs.strainMin, "strainMin", context, MAX_STRAIN); const strainMax = scalar(inputs.strainMax, "strainMax", context, MAX_STRAIN);
  if (!(strainMax > strainMin) || strainMax - strainMin <= RELATIVE_ERROR * Math.max(Math.abs(strainMin), Math.abs(strainMax))) invalid("domain", "elastic strain endpoints must be increasing and distinct at source precision");
  const strainScale = positive(scalar(inputs.strainScale, "strainScale", context, MAX_DISPLAY), "strainScale"); const stressScale = positive(scalar(inputs.stressScale, "stressScale", context, MAX_DISPLAY), "stressScale"); const samples = inputs.samples === undefined ? 17 : scalar(inputs.samples, "samples", context, MAX_SAMPLES); if (!Number.isInteger(samples) || samples < 2) invalid("samples", "elastic sample count must be an integer from2 to513");
  return { model: "linear_elastic", youngModulus, modulusUnit: modulus.canonical, youngModulusSI, strainMin, strainMax, stressUnit: stress.canonical, origin: origin(inputs.origin, context), strainScale, stressScale, samples };
}
function physicalStress(model: ElasticProfileDefinition, strain: number): { stressSI: number; stressSource: number } { finite(strain, "strain", MAX_STRAIN); if (strain < model.strainMin || strain > model.strainMax) invalid("strain", "elastic state strain must remain inside its verified source profile domain"); const stressSI = product(model.youngModulusSI, strain, "stressSI"); return { stressSI, stressSource: product(stressSI, 1 / unit(model.stressUnit, "stress").factor, "stressSource") }; }
function mappedPoint(model: ElasticProfileDefinition, strain: number): RenderPoint {
  const stress = physicalStress(model, strain); const local = { x: product(strain, model.strainScale, "strainScale", MAX_SOURCE), y: product(stress.stressSource, model.stressScale, "stressScale", MAX_SOURCE) }; const point = { x: finite(model.origin.x + local.x, "geometry"), y: finite(model.origin.y + local.y, "geometry") };
  for (const axis of ["x", "y"] as const) if (Math.abs(point[axis] - model.origin[axis] - local[axis]) > Math.abs(local[axis]) * 1e-8) invalid("precision", "elastic placement cannot retain its source strain/stress coordinate"); return point;
}
function profilePath(model: ElasticProfileDefinition): ElasticityGeometry {
  const derivative = { x: model.strainScale, y: product(product(model.youngModulusSI, 1 / unit(model.stressUnit, "stress").factor, "derivative"), model.stressScale, "derivative", MAX_SOURCE) }; const parameterStep = (model.strainMax - model.strainMin) / (model.samples - 1);
  const points = Array.from({ length: model.samples }, (_, index) => mappedPoint(model, index === model.samples - 1 ? model.strainMax : model.strainMin + parameterStep * index));
  for (const axis of ["x", "y"] as const) { if (!(points.at(-1)![axis] - points[0]![axis] > MIN_LENGTH)) invalid("precision", "both changing elastic display axes must remain visible"); const expected = product(parameterStep, derivative[axis], "precision", MAX_SOURCE); for (let index = 1; index < points.length; index++) if (Math.abs(points[index]![axis] - points[index - 1]![axis] - expected) > Math.abs(expected) * 1e-8) invalid("precision", "elastic sampling cannot retain source changes at display precision"); }
  return { kind: "path", points, elasticProfile: model, sampledCurve: { curveKind: "parametric", parameterMin: model.strainMin, parameterMax: model.strainMax, evaluate: (strain) => mappedPoint(model, strain), derivative(strain) { physicalStress(model, strain); return { ...derivative }; } } };
}
function profileReference(value: unknown, context: ElasticityEvaluationContext): ElasticProfileDefinition {
  if (typeof value !== "string" || !value.trim()) invalid("profile", "elastic state requires a verified source profile reference"); const geometry = context.geometry(value);
  if (!isRecord(geometry) || geometry.kind !== "path" || !isRecord(geometry.elasticProfile)) invalid("profile", "profile reference must retain its linear constitutive source metadata"); fields(geometry, ["kind", "points", "elasticProfile", "sampledCurve"], "profile"); const source = geometry.elasticProfile;
  const model = readProfile(Object.fromEntries(INPUT_KEYS.elastic_profile!.map((key) => [key, source[key]])), context); if (source.youngModulusSI !== model.youngModulusSI) invalid("profile", "elastic physical modulus contradicts its explicit source value"); return model;
}
function physicalState(inputs: Record<string, unknown>, model: ElasticProfileDefinition, context: ElasticityEvaluationContext): ElasticStateDefinition {
  const strain = scalar(inputs.strain, "strain", context, MAX_STRAIN); const stress = physicalStress(model, strain);
  if ((inputs.area === undefined) !== (inputs.areaUnit === undefined) || (inputs.length === undefined) !== (inputs.lengthUnit === undefined)) invalid("dimensions", "elastic area and length each require both an explicit value and its unit");
  if (inputs.uniformBar !== undefined && inputs.uniformBar !== true || (inputs.area !== undefined || inputs.length !== undefined) && inputs.uniformBar !== true) invalid("uniformBar", "load, extension, and energy require an explicitly supplied uniform uniaxial bar assumption");
  const state: ElasticStateDefinition = { profileId: String(inputs.profile), model: "linear_elastic", strain, youngModulusSI: model.youngModulusSI, ...stress, stressUnit: model.stressUnit, uniformBar: inputs.uniformBar === true };
  if (inputs.area !== undefined) { const declared = unit(inputs.areaUnit, "area"); state.area = positive(scalar(inputs.area, "area", context), "area"); state.areaUnit = declared.canonical; state.areaSI = positive(product(state.area, declared.factor, "areaSI"), "areaSI"); state.forceSI = product(stress.stressSI, state.areaSI, "forceSI"); }
  if (inputs.length !== undefined) { if (!(strain > -1)) invalid("strain", "a uniform physical bar must retain positive final length, requiring strain greater than -1"); const declared = unit(inputs.lengthUnit, "length"); state.length = positive(scalar(inputs.length, "length", context), "length"); state.lengthUnit = declared.canonical; state.lengthSI = positive(product(state.length, declared.factor, "lengthSI"), "lengthSI"); state.extensionSI = product(strain, state.lengthSI, "extensionSI"); state.finalLengthSI = positive(product(1 + strain, state.lengthSI, "finalLengthSI"), "finalLengthSI"); }
  if (state.forceSI !== undefined && state.extensionSI !== undefined) state.energyJ = product(product(state.forceSI, state.extensionSI, "energyJ", 2 * MAX_SI), 0.5, "energyJ"); return state;
}
export function evaluateElasticityConstruction(operator: string, inputs: Record<string, unknown>, context: ElasticityEvaluationContext): ElasticityGeometry[] {
  const keys = INPUT_KEYS[operator]; if (!keys) invalid("operator", "unsupported elasticity operator"); fields(inputs, keys); checkUnits(operator, inputs); if (operator === "elastic_profile") return [profilePath(readProfile(inputs, context))]; const model = profileReference(inputs.profile, context); const elasticState = physicalState(inputs, model, context); return [{ kind: "point", point: mappedPoint(model, elasticState.strain), elasticState, calculusAnchor: { curveId: String(inputs.profile), parameter: elasticState.strain } }];
}
type Claim = { symbol: string; kind: string; expected: number; defaultUnit: string };
function labelAuthority(geometry: unknown): { defaultLabel: string; claims: Claim[] } | null {
  if (!isRecord(geometry)) return null; const claim = (symbol: string, kind: string, expected: number, defaultUnit: string): Claim => ({ symbol, kind, expected: finite(expected, "label", MAX_SI), defaultUnit });
  if (isRecord(geometry.elasticProfile)) { const profile = geometry.elasticProfile as unknown as ElasticProfileDefinition; return { defaultLabel: "sigma=E*epsilon", claims: [claim("E", "stress", profile.youngModulusSI, profile.modulusUnit), claim("epsilon_min", "strain", profile.strainMin, "1"), claim("epsilon_max", "strain", profile.strainMax, "1")] }; }
  if (isRecord(geometry.elasticState)) { const state = geometry.elasticState as unknown as ElasticStateDefinition; const claims = [claim("sigma", "stress", state.stressSI, state.stressUnit), claim("epsilon", "strain", state.strain, "1")]; if (state.forceSI !== undefined) claims.push(claim("F", "force", state.forceSI, "N")); if (state.extensionSI !== undefined) claims.push(claim("deltaL", "length", state.extensionSI, "m")); if (state.energyJ !== undefined) claims.push(claim("U", "energy", state.energyJ, "J")); return { defaultLabel: "sigma(epsilon)", claims }; } return null;
}
function claimUnit(value: string, kind: string): Unit { if (kind !== "strain") return unit(value, kind); if (!["1", "dimensionless", "unit", "units"].includes(normalizedUnit(value))) invalid("label", "strain claims must be dimensionless"); return { canonical: "1", factor: 1 }; }
function equalPhysical(actual: number, expected: number): boolean { return Number.isFinite(actual) && Math.abs(actual - expected) <= RELATIVE_ERROR * Math.abs(expected); }
function compactClaim(claim: Claim, declared: string): string { const selected = claimUnit(declared, claim.kind); return `${claim.symbol}=${Number((claim.expected / selected.factor).toPrecision(4))} ${selected.canonical}`; }
function checkedText(text: unknown, geometry: unknown): { claim: Claim; declared: string } | null {
  const authority = labelAuthority(geometry); if (!authority) invalid("label", "elastic output is missing constitutive/state authority"); if (text === undefined) return null; if (typeof text !== "string") invalid("label", "elastic labels must use mathematical source text or verified physical values");
  if (text === authority.defaultLabel || authority.claims.some((claim) => claim.symbol === text)) return null;
  const match = /^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([^\s]+)\s*$/.exec(text.replaceAll("−", "-")); const claim = match && authority.claims.find((entry) => entry.symbol === match[1]);
  if (match && claim) { preserveLiteral(match[2], "label"); const declared = match[3]!; const selected = claimUnit(declared, claim.kind); if (equalPhysical(product(Number(match[2]), selected.factor, "label"), claim.expected) || text.trim() === compactClaim(claim, declared)) return { claim, declared }; } return invalid("label", "elastic labels must agree with the explicit constitutive law and independently derived physical state; missing bar dimensions cannot be inferred");
}
/** The initial scene shows the source law; computed results are exposed only by explicit verified requests. */
export function elasticityGeometryLabel(geometry: unknown, requestedText?: unknown): string | null { const authority = labelAuthority(geometry); if (!authority) return null; const requested = checkedText(requestedText, geometry); const text = requested ? compactClaim(requested.claim, requested.declared) : typeof requestedText === "string" ? requestedText : authority.defaultLabel; return text.length <= 16 ? text : requested?.claim.symbol ?? authority.defaultLabel; }
function annotationAuthority(geometry: unknown, declared: string, text: unknown): { claim: Claim; factor: number } {
  const authority = labelAuthority(geometry); if (!authority) invalid("label", "elastic annotations require constitutive/state authority"); const requested = checkedText(text, geometry); const explicit = requested?.claim ?? authority.claims.find((claim) => claim.symbol === text);
  const candidates = authority.claims.filter((claim) => !explicit || explicit.symbol === claim.symbol).flatMap((claim) => { try { return [{ claim, factor: claimUnit(declared, claim.kind).factor }]; } catch { return []; } }); if (candidates.length !== 1) invalid("label", "elastic quantity annotations require an unambiguous physical quantity and matching unit"); return candidates[0]!;
}
export function validateEvaluatedElasticityLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  if (!(ELASTICITY_OPERATORS as readonly string[]).includes(construction.operator)) return;
  for (const [outputIndex, id] of (Array.isArray(construction.outputs) ? construction.outputs : []).entries()) {
    const geometry = outputs[outputIndex];
    try {
      if (!labelAuthority(geometry)) invalid("label", "elastic output must retain its explicit constitutive/state authority"); checkedText(document.entities.find((entity) => entity.id === id)?.label, geometry);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(id)) continue; if (["label", "callout", "badge"].includes(annotation.kind)) checkedText(annotation.text, geometry);
        if (annotation.quantityId !== undefined) { const declared = sourceUnits(annotation.quantityId, document); if (!declared.length) invalid("label", "elastic quantity annotations require explicit physical units"); const authorities = declared.map((value) => annotationAuthority(geometry, value, annotation.text)); const first = authorities[0]!; if (authorities.some((entry) => entry.claim.symbol !== first.claim.symbol || entry.factor !== first.factor)) invalid("label", "elastic annotations contain conflicting nested units"); if (!equalPhysical(product(validationNumber(annotation.quantityId, document), first.factor, "label"), first.claim.expected)) invalid("label", "elastic annotation contradicts independently derived physical authority"); }
      }
      for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) checkedText(label.inputs.text, geometry);
    } catch (error) { issues.push({ code: `invalid_${construction.operator}_label`, message: error instanceof Error ? error.message : "invalid elastic label", severity: "fatal", path: `constructions[${index}].outputs`, entityIds: [id] }); }
  }
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("quantity", "elastic numeric references must be acyclic and bounded"); if (typeof value === "number" && Number.isFinite(value)) return value; seen.add(value);
  if (isRecord(value)) { fields(value, ["value", "unit"], "quantity"); return validationNumber(value.value, document, seen, depth + 1); } if (typeof value === "string" && value.trim()) { const quantity = document.quantities.find((entry) => entry.id === value); if (quantity) return validationNumber(quantity.value, document, seen, depth + 1); preserveLiteral(value, "quantity"); const numeric = Number(value); if (Number.isFinite(numeric)) return numeric; } return invalid("quantity", "elastic numeric sources must resolve to finite values");
}
export function validateElasticityConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const { operator, inputs } = construction; if (!(ELASTICITY_OPERATORS as readonly string[]).includes(operator)) return; const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const add = (key: string, message: string): void => { issues.push({ code: `invalid_${operator}_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`, entityIds: outputs }); };
  if (outputs.length !== 1 || typeof outputs[0] !== "string" || !outputs[0].trim()) add("outputs", `${operator} requires exactly one output`); const expected = operator === "elastic_profile" ? "polyline" : "point"; if (document.entities.find((entity) => entity.id === outputs[0])?.kind !== expected) add("output_kind", `${operator} output must be a ${expected}`);
  if (!isRecord(inputs)) { add("inputs", "elastic construction inputs must be an object"); return; }
  const context: ElasticityEvaluationContext = { number: (value) => validationNumber(value, document), point: () => invalid("point", "elasticity cannot reinterpret external geometry coordinates"), geometry(value) {
    const producer = typeof value === "string" ? constructionByOutput.get(value) : undefined; if (!producer || producer.operator !== "elastic_profile" || producer.outputs.length !== 1 || producer.outputs[0] !== value || document.entities.find((entity) => entity.id === value)?.kind !== "polyline") invalid("profile", "elastic_state requires one verified linear-elastic profile output"); checkUnits(producer.operator, producer.inputs, document); return evaluateElasticityConstruction(producer.operator, producer.inputs, context)[0];
  } };
  try { checkUnits(operator, inputs, document); validateEvaluatedElasticityLabels(construction, index, document, evaluateElasticityConstruction(operator, inputs, context), issues); }
  catch (error) { add(error instanceof ElasticityInputError ? error.key : "inputs", error instanceof Error ? error.message : "invalid elasticity construction"); }
}
