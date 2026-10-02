import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const FLUID_OPERATORS = ["hydrostatic_profile", "hydrostatic_state", "buoyancy"] as const;
export interface HydrostaticProfileDefinition {
  surfacePressure: number; density: number; gravity: number; depthMin: number; depthMax: number;
  pressureUnit: string; densityUnit: string; gravityUnit: string; depthUnit: string;
  surfacePressureSI: number; densitySI: number; gravitySI: number; pressureGradientSI: number;
  origin: RenderPoint; depthScale: number; pressureScale: number; samples: number;
}
export interface HydrostaticStateDefinition { profileId: string; depth: number; depthSI: number; pressureSource: number; pressureSI: number; pressureUnit: string; depthUnit: string }
export interface BuoyancyDefinition {
  density: number; gravity: number; displacedVolume: number; densityUnit: string; gravityUnit: string; volumeUnit: string;
  densitySI: number; gravitySI: number; displacedVolumeSI: number; forceSI: number; zero: boolean;
  origin: RenderPoint; direction: RenderPoint | null; displayMagnitude: number; displayLength?: number; displayScale?: number;
}
export type FluidGeometry =
  | { kind: "path"; points: RenderPoint[]; hydrostaticProfile: HydrostaticProfileDefinition; sampledCurve: { curveKind: "parametric"; parameterMin: number; parameterMax: number; evaluate(depth: number): RenderPoint; derivative(depth: number): RenderPoint } }
  | { kind: "point"; point: RenderPoint; hydrostaticState: HydrostaticStateDefinition; calculusAnchor: { curveId: string; parameter: number } }
  | { kind: "point"; point: RenderPoint; buoyancyDefinition: BuoyancyDefinition }
  | { kind: "path"; points: RenderPoint[]; directed: true; buoyancyDefinition: BuoyancyDefinition };
export interface FluidEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
class FluidInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new FluidInputError(key, message); }
const MAX_SOURCE = 1e12;
const MAX_SI = 1e15;
const MAX_DISPLAY = 1e9;
const MAX_SAMPLES = 513;
const MIN_LENGTH = 1e-6;
const RELATIVE_ERROR = 64 * Number.EPSILON;
type Unit = { canonical: string; factor: number };
const UNITS: Readonly<Record<string, Readonly<Record<string, Unit>>>> = {
  force: { N: { canonical: "N", factor: 1 }, kN: { canonical: "kN", factor: 1000 }, mN: { canonical: "mN", factor: 0.001 } },
  pressure: { Pa: { canonical: "Pa", factor: 1 }, kPa: { canonical: "kPa", factor: 1000 }, bar: { canonical: "bar", factor: 1e5 } },
  density: { "kg/m^3": { canonical: "kg/m^3", factor: 1 }, "g/cm^3": { canonical: "g/cm^3", factor: 1000 }, "kg/L": { canonical: "kg/L", factor: 1000 }, "kg/l": { canonical: "kg/L", factor: 1000 }, "g/mL": { canonical: "g/mL", factor: 1000 }, "g/ml": { canonical: "g/mL", factor: 1000 } },
  gravity: { "m/s^2": { canonical: "m/s^2", factor: 1 }, "cm/s^2": { canonical: "cm/s^2", factor: 0.01 } },
  depth: { m: { canonical: "m", factor: 1 }, cm: { canonical: "cm", factor: 0.01 }, mm: { canonical: "mm", factor: 0.001 }, km: { canonical: "km", factor: 1000 } },
  volume: { "m^3": { canonical: "m^3", factor: 1 }, L: { canonical: "L", factor: 0.001 }, l: { canonical: "L", factor: 0.001 }, "cm^3": { canonical: "cm^3", factor: 1e-6 }, mL: { canonical: "mL", factor: 1e-6 }, ml: { canonical: "mL", factor: 1e-6 } },
};
const INPUT_KEYS: Readonly<Record<string, readonly string[]>> = {
  hydrostatic_profile: ["surfacePressure", "density", "gravity", "depthMin", "depthMax", "pressureUnit", "densityUnit", "gravityUnit", "depthUnit", "origin", "depthScale", "pressureScale", "samples"],
  hydrostatic_state: ["profile", "depth"],
  buoyancy: ["density", "gravity", "displacedVolume", "densityUnit", "gravityUnit", "volumeUnit", "origin", "displayLength", "displayScale"],
};
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fields(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void { if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) invalid(key, "fluid construction contains unsupported fields"); }
function finite(value: number, key: string, cap = MAX_SOURCE): number { if (!Number.isFinite(value) || Math.abs(value) > cap) invalid(key, `${key} must remain finite with magnitude at most ${cap}`); return value; }
function preserveNumericLiteral(value: unknown, key: string): void {
  if (typeof value !== "string") return;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE][+-]?\d+)?$/.exec(value.trim());
  if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) invalid(key, "nonzero source literals cannot underflow to a certified zero");
}
function scalar(value: unknown, key: string, context: FluidEvaluationContext, cap = MAX_SOURCE, depth = 0): number {
  if (depth > 32) return invalid(key, "fluid numeric references exceed depth32");
  if (isRecord(value)) { fields(value, ["value", "unit"], key); return scalar(value.value, key, context, cap, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, "fluid scalars require a literal, numeric string, or quantity reference");
  preserveNumericLiteral(value, key);
  try { return finite(context.number(value), key, cap); } catch (error) { if (error instanceof FluidInputError) throw error; return invalid(key, "fluid scalar must resolve to a finite number"); }
}
function normalizedUnit(value: string): string { return value.trim().replaceAll("³", "^3").replaceAll("²", "^2"); }
function unit(value: unknown, kind: string): Unit { const found = typeof value === "string" ? UNITS[kind]?.[normalizedUnit(value)] : undefined; if (!found) invalid(`${kind}Unit`, `a supported ${kind} unit must be explicitly declared`); return found; }
function product(a: number, b: number, key: string, cap = MAX_SI): number { const result = finite(a * b, key, cap); if (a !== 0 && b !== 0 && result === 0) invalid(key, "nonzero physical products cannot underflow to zero"); return result; }
function sourceUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) invalid("units", "fluid unit references must be acyclic and bounded");
  const record = isRecord(value) ? value : typeof value === "string" ? document?.quantities.find((q) => q.id === value) : undefined;
  if (!record) return [];
  if (record.unit !== undefined && (typeof record.unit !== "string" || !record.unit.trim())) invalid("units", "known fluid units must be nonempty strings");
  seen.add(value); return [...(typeof record.unit === "string" ? [record.unit] : []), ...("value" in record ? sourceUnits(record.value, document, seen, depth + 1) : [])];
}
function dimensionless(value: unknown, document?: SceneDocument): void { for (const declared of sourceUnits(value, document)) if (!["1", "unit", "units", "dimensionless"].includes(normalizedUnit(declared))) invalid("units", "display scales and sample counts must be dimensionless"); }
function matchUnits(value: unknown, kind: string, declared: unknown, document?: SceneDocument): void { const expected = unit(declared, kind); for (const actual of sourceUnits(value, document)) if (unit(actual, kind).factor !== expected.factor) invalid("units", "known fluid quantities must use their explicitly declared common source scale"); }
function checkUnits(operator: string, inputs: Record<string, unknown>, document?: SceneDocument): void {
  if (operator === "hydrostatic_state") return;
  matchUnits(inputs.density, "density", inputs.densityUnit, document); matchUnits(inputs.gravity, "gravity", inputs.gravityUnit, document);
  if (operator === "hydrostatic_profile") { matchUnits(inputs.surfacePressure, "pressure", inputs.pressureUnit, document); for (const key of ["depthMin", "depthMax"]) matchUnits(inputs[key], "depth", inputs.depthUnit, document); }
  else matchUnits(inputs.displacedVolume, "volume", inputs.volumeUnit, document);
  for (const key of ["depthScale", "pressureScale", "samples", "displayLength", "displayScale"]) if (inputs[key] !== undefined) dimensionless(inputs[key], document);
  if (inputs.origin !== undefined) { const values = Array.isArray(inputs.origin) ? inputs.origin : isRecord(inputs.origin) ? [inputs.origin.x, inputs.origin.y] : []; values.forEach((value) => dimensionless(value, document)); }
}
function origin(value: unknown, context: FluidEvaluationContext): RenderPoint {
  if (value === undefined) return { x: 0, y: 0 };
  if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], "origin", context), y: scalar(value[1], "origin", context) };
  if (isRecord(value)) { fields(value, ["x", "y"], "origin"); return { x: scalar(value.x, "origin", context), y: scalar(value.y, "origin", context) }; }
  return invalid("origin", "fluid origins are inline 2D display points; physical or projected geometry is not reinterpreted");
}
function positive(value: number, key: string): number { if (!(value > 0)) invalid(key, `${key} must be positive`); return value; }
function nonnegative(value: number, key: string): number { if (value < 0) invalid(key, `${key} must be nonnegative`); return value; }
function readProfile(inputs: Record<string, unknown>, context: FluidEvaluationContext): HydrostaticProfileDefinition {
  const pressure = unit(inputs.pressureUnit, "pressure"); const density = unit(inputs.densityUnit, "density"); const gravity = unit(inputs.gravityUnit, "gravity"); const depth = unit(inputs.depthUnit, "depth");
  const surfacePressure = nonnegative(scalar(inputs.surfacePressure, "surfacePressure", context), "surfacePressure");
  const rho = positive(scalar(inputs.density, "density", context), "density"); const g = positive(scalar(inputs.gravity, "gravity", context), "gravity");
  const depthMin = nonnegative(scalar(inputs.depthMin, "depthMin", context), "depthMin"); const depthMax = scalar(inputs.depthMax, "depthMax", context);
  if (!(depthMax > depthMin) || depthMax - depthMin <= RELATIVE_ERROR * Math.max(Math.abs(depthMin), Math.abs(depthMax))) invalid("domain", "hydrostatic depth endpoints must be increasing and distinct at physical precision");
  const depthScale = positive(scalar(inputs.depthScale, "depthScale", context, MAX_DISPLAY), "depthScale"); const pressureScale = positive(scalar(inputs.pressureScale, "pressureScale", context, MAX_DISPLAY), "pressureScale");
  const samples = inputs.samples === undefined ? 17 : scalar(inputs.samples, "samples", context, MAX_SAMPLES);
  if (!Number.isInteger(samples) || samples < 2) invalid("samples", "hydrostatic sample count must be an integer from2 to513");
  const densitySI = positive(product(rho, density.factor, "densitySI"), "densitySI"); const gravitySI = positive(product(g, gravity.factor, "gravitySI"), "gravitySI");
  return { surfacePressure, density: rho, gravity: g, depthMin, depthMax, pressureUnit: pressure.canonical, densityUnit: density.canonical, gravityUnit: gravity.canonical, depthUnit: depth.canonical,
    surfacePressureSI: product(surfacePressure, pressure.factor, "surfacePressureSI"), densitySI, gravitySI, pressureGradientSI: positive(product(densitySI, gravitySI, "pressureGradientSI"), "pressureGradientSI"), origin: origin(inputs.origin, context), depthScale, pressureScale, samples };
}
function pressureState(model: HydrostaticProfileDefinition, depth: number): Omit<HydrostaticStateDefinition, "profileId"> {
  if (depth < model.depthMin || depth > model.depthMax) invalid("depth", "hydrostatic state depth must lie in its verified profile domain");
  const depthSI = product(depth, unit(model.depthUnit, "depth").factor, "depthSI"); const head = product(model.pressureGradientSI, depthSI, "pressureHeadSI");
  const pressureSI = finite(model.surfacePressureSI + head, "pressureSI", MAX_SI);
  if (head !== 0 && pressureSI === model.surfacePressureSI) invalid("precision", "the supplied hydrostatic pressure increase cannot disappear at physical precision");
  const pressureSource = product(pressureSI, 1 / unit(model.pressureUnit, "pressure").factor, "pressureSource");
  return { depth, depthSI, pressureSource, pressureSI, pressureUnit: model.pressureUnit, depthUnit: model.depthUnit };
}
function displayState(model: HydrostaticProfileDefinition, depth: number): RenderPoint {
  const state = pressureState(model, depth);
  const delta = { x: product(depth, model.depthScale, "depthScale", MAX_SOURCE), y: product(state.pressureSource, model.pressureScale, "pressureScale", MAX_SOURCE) };
  const result = { x: finite(model.origin.x + delta.x, "geometry"), y: finite(model.origin.y + delta.y, "geometry") };
  for (const axis of ["x", "y"] as const) if (Math.abs(result[axis] - model.origin[axis] - delta[axis]) > Math.abs(delta[axis]) * 1e-8) invalid("precision", "fluid display translation cannot preserve the source coordinate");
  return result;
}
function profilePath(model: HydrostaticProfileDefinition): FluidGeometry {
  const slope = positive(product(model.pressureGradientSI, unit(model.depthUnit, "depth").factor / unit(model.pressureUnit, "pressure").factor, "sourceGradient"), "sourceGradient");
  const derivative = { x: model.depthScale, y: positive(product(slope, model.pressureScale, "derivative", MAX_SOURCE), "derivative") };
  const points = Array.from({ length: model.samples }, (_, i) => displayState(model, i === model.samples - 1 ? model.depthMax : model.depthMin + (model.depthMax - model.depthMin) * i / (model.samples - 1)));
  for (const axis of ["x", "y"] as const) {
    if (!(points.at(-1)![axis] - points[0]![axis] > MIN_LENGTH)) invalid("precision", "every changing hydrostatic display axis must remain visible");
    for (let i = 1; i < points.length; i++) {
      const parameterDelta = (model.depthMax - model.depthMin) / (model.samples - 1); const expected = product(parameterDelta, derivative[axis], "precision", MAX_SOURCE);
      if (Math.abs(points[i]![axis] - points[i - 1]![axis] - expected) > Math.abs(expected) * 1e-8) invalid("precision", "hydrostatic samples cannot preserve source changes at display precision");
    }
  }
  return { kind: "path", points, hydrostaticProfile: model, sampledCurve: { curveKind: "parametric", parameterMin: model.depthMin, parameterMax: model.depthMax, evaluate: (d) => displayState(model, finite(d, "depth")), derivative(d) { pressureState(model, finite(d, "depth")); return { ...derivative }; } } };
}
function profileReference(value: unknown, context: FluidEvaluationContext): HydrostaticProfileDefinition {
  if (typeof value !== "string" || !value.trim()) invalid("profile", "hydrostatic state requires a constructed profile reference");
  const geometry = context.geometry(value);
  if (!isRecord(geometry) || geometry.kind !== "path" || !isRecord(geometry.hydrostaticProfile)) invalid("profile", "profile reference must retain its hydrostatic physical metadata");
  fields(geometry, ["kind", "points", "hydrostaticProfile", "sampledCurve"], "profile");
  const source = geometry.hydrostaticProfile;
  const model = readProfile(Object.fromEntries(INPUT_KEYS.hydrostatic_profile!.map((key) => [key, source[key]])), context);
  for (const key of ["surfacePressureSI", "densitySI", "gravitySI", "pressureGradientSI"]) if (source[key] !== model[key as keyof HydrostaticProfileDefinition]) invalid("profile", "hydrostatic physical metadata contradicts its explicit source values");
  return model;
}
/** Exact SI derivations remain separate from chosen display scales and apparatus drawings. */
export function evaluateFluidConstruction(operator: string, inputs: Record<string, unknown>, context: FluidEvaluationContext): FluidGeometry[] {
  const allowed = INPUT_KEYS[operator]; if (!allowed) invalid("operator", `unsupported fluid operator ${operator}`); fields(inputs, allowed); checkUnits(operator, inputs);
  if (operator === "hydrostatic_profile") return [profilePath(readProfile(inputs, context))];
  if (operator === "hydrostatic_state") {
    const model = profileReference(inputs.profile, context); matchUnits(inputs.depth, "depth", model.depthUnit);
    const depth = scalar(inputs.depth, "depth", context); const state = pressureState(model, depth);
    return [{ kind: "point", point: displayState(model, depth), hydrostaticState: { profileId: String(inputs.profile), ...state }, calculusAnchor: { curveId: String(inputs.profile), parameter: depth } }];
  }
  if ((inputs.displayLength === undefined) === (inputs.displayScale === undefined)) invalid("display", "buoyancy requires exactly one explicit displayLength or displayScale");
  const rho = positive(scalar(inputs.density, "density", context), "density"); const g = positive(scalar(inputs.gravity, "gravity", context), "gravity"); const volume = nonnegative(scalar(inputs.displacedVolume, "displacedVolume", context), "displacedVolume");
  const density = unit(inputs.densityUnit, "density"); const gravity = unit(inputs.gravityUnit, "gravity"); const volumeUnit = unit(inputs.volumeUnit, "volume");
  const densitySI = positive(product(rho, density.factor, "densitySI"), "densitySI"); const gravitySI = positive(product(g, gravity.factor, "gravitySI"), "gravitySI"); const displacedVolumeSI = product(volume, volumeUnit.factor, "displacedVolumeSI");
  const forceSI = product(product(densitySI, gravitySI, "densityGravity"), displacedVolumeSI, "forceSI"); const zero = volume === 0;
  const at = origin(inputs.origin, context);
  const displayLength = inputs.displayLength === undefined ? undefined : positive(scalar(inputs.displayLength, "displayLength", context, MAX_DISPLAY), "displayLength");
  const displayScale = inputs.displayScale === undefined ? undefined : positive(scalar(inputs.displayScale, "displayScale", context, MAX_DISPLAY), "displayScale");
  const displayMagnitude = zero ? 0 : displayLength ?? product(forceSI, displayScale!, "displayScale", MAX_DISPLAY);
  const buoyancyDefinition: BuoyancyDefinition = { density: rho, gravity: g, displacedVolume: volume, densityUnit: density.canonical, gravityUnit: gravity.canonical, volumeUnit: volumeUnit.canonical,
    densitySI, gravitySI, displacedVolumeSI, forceSI, zero, origin: at, direction: zero ? null : { x: 0, y: 1 }, displayMagnitude, ...(displayLength === undefined ? { displayScale } : { displayLength }) };
  if (zero) return [{ kind: "point", point: at, buoyancyDefinition }];
  if (!(displayMagnitude > MIN_LENGTH)) invalid("display", "nonzero buoyancy must have a visible display vector");
  const end = { x: at.x, y: finite(at.y + displayMagnitude, "geometry") };
  if (Math.abs(end.y - at.y - displayMagnitude) > displayMagnitude * 1e-8) invalid("precision", "buoyancy placement cannot preserve its display length");
  return [{ kind: "path", points: [at, end], directed: true, buoyancyDefinition }];
}
type Claim = { symbol: string; kind: string; expected: number; defaultUnit: string };
function labelAuthority(geometry: unknown): { defaultLabel: string; claims: Claim[] } | null {
  if (!isRecord(geometry)) return null;
  const claim = (symbol: string, kind: string, expected: number, defaultUnit: string): Claim => ({ symbol, kind, expected: finite(expected, "label", MAX_SI), defaultUnit });
  if (isRecord(geometry.hydrostaticProfile)) {
    const model = geometry.hydrostaticProfile as unknown as HydrostaticProfileDefinition;
    return { defaultLabel: "p=p0+rho*g*d", claims: [claim("p0", "pressure", model.surfacePressureSI, model.pressureUnit), claim("rho", "density", model.densitySI, model.densityUnit), claim("g", "gravity", model.gravitySI, model.gravityUnit), claim("d_min", "depth", product(model.depthMin, unit(model.depthUnit, "depth").factor, "label"), model.depthUnit), claim("d_max", "depth", product(model.depthMax, unit(model.depthUnit, "depth").factor, "label"), model.depthUnit), claim("dp/dd", "gradient", model.pressureGradientSI, "Pa/m")] };
  }
  if (isRecord(geometry.hydrostaticState)) {
    const state = geometry.hydrostaticState as unknown as HydrostaticStateDefinition;
    return { defaultLabel: "p(d)", claims: [claim("p", "pressure", state.pressureSI, state.pressureUnit), claim("d", "depth", state.depthSI, state.depthUnit)] };
  }
  if (isRecord(geometry.buoyancyDefinition)) {
    const force = geometry.buoyancyDefinition as unknown as BuoyancyDefinition;
    return { defaultLabel: "F_b", claims: [claim("F_b", "force", force.forceSI, "N"), claim("rho", "density", force.densitySI, force.densityUnit), claim("g", "gravity", force.gravitySI, force.gravityUnit), claim("V", "volume", force.displacedVolumeSI, force.volumeUnit)] };
  }
  return null;
}
function claimUnit(value: string, kind: string): Unit {
  if (kind !== "gradient") return unit(value, kind);
  const match = /^([^/]+)\/([^/]+)$/.exec(value.trim()); if (!match) invalid("label", "pressure gradients require an explicit pressure/depth unit");
  const pressure = unit(match[1], "pressure"); const depth = unit(match[2], "depth"); return { canonical: `${pressure.canonical}/${depth.canonical}`, factor: pressure.factor / depth.factor };
}
function equalPhysical(actual: number, expected: number): boolean { return Number.isFinite(actual) && Math.abs(actual - expected) <= RELATIVE_ERROR * Math.abs(expected); }
function compactClaim(claim: Claim, selectedUnit: string): string {
  const scale = claimUnit(selectedUnit, claim.kind); const value = Number(product(claim.expected, 1 / scale.factor, "label").toPrecision(4));
  return `${claim.symbol}=${value} ${scale.canonical}`;
}
function checkedText(text: unknown, geometry: unknown): { claim: Claim; selectedUnit: string } | null {
  const authority = labelAuthority(geometry); if (!authority) invalid("label", "fluid result is missing computed physical authority");
  if (text === undefined) return null;
  if (typeof text !== "string") invalid("label", "fluid labels must use mathematical source text or verified quantities");
  if (text === authority.defaultLabel || authority.claims.some((claim) => text === claim.symbol)) return null;
  const match = /^\s*([A-Za-z_][A-Za-z_0-9]*|dp\/dd)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([^\s]+)\s*$/.exec(text.replaceAll("−", "-"));
  const claim = match && authority.claims.find((entry) => entry.symbol === match[1]);
  if (match && claim) {
    preserveNumericLiteral(match[2], "label");
    const selectedUnit = match[3]!; const scale = claimUnit(selectedUnit, claim.kind);
    if (equalPhysical(product(Number(match[2]), scale.factor, "label"), claim.expected) || text.trim() === compactClaim(claim, selectedUnit)) return { claim, selectedUnit };
  }
  return invalid("label", "fluid numeric labels must agree with independently computed physical values and units");
}
/** The initial label describes the supplied law; only explicitly requested numeric text exposes an answer. */
export function fluidGeometryLabel(geometry: unknown, requestedText?: unknown): string | null {
  const authority = labelAuthority(geometry); if (!authority) return null;
  const requested = checkedText(requestedText, geometry); const text = requested ? compactClaim(requested.claim, requested.selectedUnit) : typeof requestedText === "string" ? requestedText : authority.defaultLabel;
  return text.length <= 16 ? text : requested?.claim.symbol ?? authority.defaultLabel;
}
function annotationAuthority(geometry: unknown, declared: string, text: unknown): { claim: Claim; factor: number } {
  const authority = labelAuthority(geometry); if (!authority) invalid("label", "fluid result is missing computed physical authority");
  const requested = checkedText(text, geometry); const explicit = requested?.claim ?? authority.claims.find((claim) => claim.symbol === text);
  const candidates = authority.claims.filter((claim) => !explicit || explicit.symbol === claim.symbol).flatMap((claim) => {
    try { return [{ claim, factor: claimUnit(declared, claim.kind).factor }]; } catch { return []; }
  });
  if (candidates.length !== 1) invalid("label", "fluid quantity annotations require an unambiguous physical quantity and compatible unit");
  return candidates[0]!;
}
/** Guards output labels, annotations, and separately constructed label ink before rendering. */
export function validateEvaluatedFluidLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  if (!(FLUID_OPERATORS as readonly string[]).includes(construction.operator)) return;
  for (const [outputIndex, id] of (Array.isArray(construction.outputs) ? construction.outputs : []).entries()) {
    const geometry = outputs[outputIndex];
    try {
      if (!labelAuthority(geometry)) invalid("label", "fluid result is missing computed physical authority");
      checkedText(document.entities.find((entity) => entity.id === id)?.label, geometry);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(id) || annotation.kind !== "label" && annotation.kind !== "callout") continue;
        checkedText(annotation.text, geometry);
        if (annotation.quantityId !== undefined) {
          const declared = sourceUnits(annotation.quantityId, document); if (!declared.length) invalid("label", "fluid quantity annotations require explicit physical units");
          const authorities = declared.map((value) => annotationAuthority(geometry, value, annotation.text)); const first = authorities[0]!;
          if (authorities.some((entry) => entry.claim.symbol !== first.claim.symbol || entry.factor !== first.factor)) invalid("label", "fluid annotation contains conflicting nested units");
          if (!equalPhysical(product(validationNumber(annotation.quantityId, document), first.factor, "label"), first.claim.expected)) invalid("label", "fluid quantity annotation contradicts its computed physical value");
        }
      }
      for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) checkedText(label.inputs.text, geometry);
    } catch (error) { issues.push({ code: `invalid_${construction.operator}_label`, message: error instanceof Error ? error.message : "invalid fluid label", severity: "fatal", path: `constructions[${index}].outputs`, entityIds: [id] }); }
  }
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("quantity", "fluid numeric references must be acyclic and bounded");
  if (typeof value === "number" && Number.isFinite(value)) return value; seen.add(value);
  if (isRecord(value)) { fields(value, ["value", "unit"], "quantity"); return validationNumber(value.value, document, seen, depth + 1); }
  if (typeof value === "string" && value.trim()) { const quantity = document.quantities.find((entry) => entry.id === value); if (quantity) return validationNumber(quantity.value, document, seen, depth + 1); preserveNumericLiteral(value, "quantity"); const numeric = Number(value); if (Number.isFinite(numeric)) return numeric; }
  return invalid("quantity", "fluid numeric inputs must resolve to finite values");
}
export function validateFluidConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const { operator, inputs } = construction; if (!(FLUID_OPERATORS as readonly string[]).includes(operator)) return;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const add = (key: string, message: string): void => { issues.push({ code: `invalid_${operator}_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`, entityIds: outputs }); };
  if (outputs.length !== 1 || typeof outputs[0] !== "string" || !outputs[0].trim()) add("outputs", `${operator} requires exactly one output`);
  if (!isRecord(inputs)) { add("inputs", "fluid inputs must be an object"); return; }
  const context: FluidEvaluationContext = {
    number: (value) => validationNumber(value, document),
    point: (value) => origin(value, context),
    geometry(value) {
      const producer = typeof value === "string" ? constructionByOutput.get(value) : undefined;
      if (!producer || producer.operator !== "hydrostatic_profile" || producer.outputs.length !== 1 || producer.outputs[0] !== value || document.entities.find((entity) => entity.id === value)?.kind !== "polyline") invalid("profile", "hydrostatic state requires one verified hydrostatic profile output");
      checkUnits(producer.operator, producer.inputs, document);
      return evaluateFluidConstruction(producer.operator, producer.inputs, context)[0];
    },
  };
  try {
    checkUnits(operator, inputs, document);
    if (operator === "hydrostatic_state") matchUnits(inputs.depth, "depth", profileReference(inputs.profile, context).depthUnit, document);
    const evaluated = evaluateFluidConstruction(operator, inputs, context);
    const expectedKind = operator === "hydrostatic_profile" ? "polyline" : evaluated[0]?.kind === "point" ? "point" : "vector";
    if (document.entities.find((entity) => entity.id === outputs[0])?.kind !== expectedKind) add("output_kind", `${operator} output must be a ${expectedKind} for its independently computed result`);
    validateEvaluatedFluidLabels(construction, index, document, evaluated, issues);
  } catch (error) { add(error instanceof FluidInputError ? error.key : "inputs", error instanceof Error ? error.message : "invalid fluid construction"); }
}
