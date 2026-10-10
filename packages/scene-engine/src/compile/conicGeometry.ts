import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const CONIC_OPERATORS = ["conic", "conic_anchor", "conic_directrix", "conic_asymptotes", "conic_tangent"] as const;
const MIN_LENGTH = 1e-6;
const MAX_SAMPLES = 513;
const TWO_PI = 2 * Math.PI;

type ConicFrame = { origin: RenderPoint; rotationRad: number; parameterMin: number; parameterMax: number };
/** Parameters remain in world units; fitting the board never changes their metric identity. */
export type ConicDefinition = ConicFrame & (
  | { kind: "ellipse"; a: number; b: number }
  | { kind: "hyperbola"; a: number; b: number }
  | { kind: "parabola"; p: number }
);
export type ConicGeometry =
  | { kind: "point"; point: RenderPoint }
  | { kind: "path"; points: RenderPoint[]; infinite?: boolean }
  | { kind: "compound"; paths: RenderPoint[][]; terminals: [RenderPoint, RenderPoint]; conic?: ConicDefinition };

export interface ConicEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry?(value: unknown): unknown;
}

class ConicInputError extends Error {
  constructor(readonly key: string, message: string) { super(message); }
}
function invalid(key: string, message: string): never { throw new ConicInputError(key, message); }
function numberInput(inputs: Record<string, unknown>, key: string, context: ConicEvaluationContext): number {
  try {
    const value = context.number(inputs[key]);
    if (!Number.isFinite(value)) invalid(key, `${key} must resolve to a finite number`);
    return value;
  } catch (error) {
    if (error instanceof ConicInputError) throw error;
    return invalid(key, `${key} must resolve to a finite number`);
  }
}
function lengthInput(inputs: Record<string, unknown>, key: string, context: ConicEvaluationContext): number {
  const value = numberInput(inputs, key, context);
  if (!(value > MIN_LENGTH)) invalid(key, `${key} must be greater than ${MIN_LENGTH}`);
  return value;
}
function sideInput(inputs: Record<string, unknown>, key: string, context: ConicEvaluationContext): 1 | -1 {
  const value = numberInput(inputs, key, context);
  if (value !== 1 && value !== -1) invalid(key, `${key} must be 1 or -1`);
  return value;
}
function finitePoint(point: RenderPoint, key: string): RenderPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) invalid(key, `${key} must resolve to a finite point`);
  return point;
}
function pointInput(inputs: Record<string, unknown>, key: string, context: ConicEvaluationContext): RenderPoint {
  try { return finitePoint(context.point(inputs[key]), key); }
  catch (error) {
    if (error instanceof ConicInputError) throw error;
    return invalid(key, `${key} must reference a constructed point or finite inline point`);
  }
}
/** Dimensionless default drawn range for hyperbola and parabola parameters. */
const DEFAULT_PARAMETER_HALF_RANGE = 1.5;

function readDefinition(inputs: Record<string, unknown>, context: ConicEvaluationContext): ConicDefinition {
  const kind = inputs.kind;
  if (kind !== "ellipse" && kind !== "hyperbola" && kind !== "parabola") invalid("kind", "conic kind must be ellipse, hyperbola, or parabola");
  const origin = pointInput(inputs, kind === "parabola" ? "vertex" : "center", context);
  const rotationDeg = inputs.rotationDeg === undefined ? 0 : numberInput(inputs, "rotationDeg", context);
  const rotationRad = (rotationDeg % 360) * Math.PI / 180;
  if (kind === "ellipse") {
    const a = lengthInput(inputs, "a", context);
    const b = lengthInput(inputs, "b", context);
    if (a < b) invalid("a", "ellipse a is the semimajor axis and must be at least b");
    return { kind, origin, rotationRad, a, b, parameterMin: 0, parameterMax: TWO_PI };
  }
  // tMin and tMax only choose how much of the curve is drawn; every anchor,
  // focus and directrix is derived from a, b, p. So both may be omitted
  // together for a default window, but one bound alone stays an error.
  const rangeOmitted = inputs.tMin === undefined && inputs.tMax === undefined;
  const parameterMin = rangeOmitted ? -DEFAULT_PARAMETER_HALF_RANGE : numberInput(inputs, "tMin", context);
  const parameterMax = rangeOmitted ? DEFAULT_PARAMETER_HALF_RANGE : numberInput(inputs, "tMax", context);
  if (!(parameterMin < parameterMax) || !Number.isFinite(parameterMax - parameterMin)) invalid("domain", "conic requires a finite tMin < tMax interval");
  if (kind === "hyperbola") {
    // Beyond this range cancellation makes x²/a²-y²/b²=1 numerically unverifiable.
    if (Math.max(Math.abs(parameterMin), Math.abs(parameterMax)) > 12) invalid("domain", "hyperbola tMin and tMax must be within -12 and 12 for numerical verification");
    return { kind, origin, rotationRad, parameterMin, parameterMax, a: lengthInput(inputs, "a", context), b: lengthInput(inputs, "b", context) };
  }
  const p = numberInput(inputs, "p", context);
  if (!(Math.abs(p) > MIN_LENGTH)) invalid("p", `parabola signed focal parameter p must have magnitude greater than ${MIN_LENGTH}`);
  return { kind, origin, rotationRad, parameterMin, parameterMax, p };
}
function conicReference(inputs: Record<string, unknown>, context: ConicEvaluationContext): ConicDefinition {
  const target = context.geometry?.(inputs.conic);
  if (!isRecord(target) || target.kind !== "compound" || !isRecord(target.conic) ||
    !["ellipse", "hyperbola", "parabola"].includes(String(target.conic.kind))) {
    return invalid("reference", "conic must reference geometry produced by the conic operator");
  }
  return target.conic as ConicDefinition;
}
function transform(conic: ConicDefinition, point: RenderPoint): RenderPoint {
  const cosine = Math.cos(conic.rotationRad);
  const sine = Math.sin(conic.rotationRad);
  return finitePoint({ x: conic.origin.x + cosine * point.x - sine * point.y, y: conic.origin.y + sine * point.x + cosine * point.y }, "geometry");
}
function curvePoint(conic: ConicDefinition, parameter: number, branch: 1 | -1): RenderPoint {
  if (conic.kind === "ellipse") return transform(conic, { x: conic.a * Math.cos(parameter), y: conic.b * Math.sin(parameter) });
  if (conic.kind === "hyperbola") return transform(conic, { x: branch * conic.a * Math.cosh(parameter), y: conic.b * Math.sinh(parameter) });
  return transform(conic, { x: conic.p * parameter ** 2, y: 2 * conic.p * parameter });
}
function focalDistance(conic: Exclude<ConicDefinition, { kind: "parabola" }>): number {
  // a*sqrt((1-b/a)(1+b/a)) avoids overflow in a²-b² and cancellation near a=b.
  const c = conic.kind === "ellipse"
    ? conic.a * Math.sqrt((1 - conic.b / conic.a) * (1 + conic.b / conic.a))
    : Math.hypot(conic.a, conic.b);
  if (!Number.isFinite(c)) invalid("geometry", "conic focal distance is not representable");
  return c;
}
function parameterInput(inputs: Record<string, unknown>, conic: ConicDefinition, context: ConicEvaluationContext): number {
  const at = numberInput(inputs, "at", context);
  if (at < conic.parameterMin || at > conic.parameterMax) invalid("at", "at must lie within the conic's rendered parameter interval");
  return at;
}
function branchInput(inputs: Record<string, unknown>, conic: ConicDefinition, context: ConicEvaluationContext): 1 | -1 {
  if (conic.kind === "hyperbola") return sideInput(inputs, "branch", context);
  if (inputs.branch !== undefined) invalid("branch", "branch is only valid for a hyperbola");
  return 1;
}
function focalSide(inputs: Record<string, unknown>, conic: ConicDefinition, context: ConicEvaluationContext): 1 | -1 {
  if (conic.kind !== "parabola") return sideInput(inputs, "side", context);
  if (inputs.side !== undefined) invalid("side", "a parabola has one vertex, focus, and directrix; omit side");
  return 1;
}
function inputKeys(inputs: Record<string, unknown>, allowed: string[]): void {
  const unexpected = Object.keys(inputs).filter((key) => !allowed.includes(key));
  if (unexpected.length) invalid("fields", `unsupported conic inputs: ${unexpected.join(", ")}`);
}
function verifyPath(path: RenderPoint[]): void {
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (!Number.isFinite(distance) || !(distance > 0)) invalid("geometry", "conic contains a non-finite or numerically indistinguishable segment");
  }
}
function lineFromLocal(conic: ConicDefinition, localPoint: RenderPoint, direction: RenderPoint, span: number): Extract<ConicGeometry, { kind: "path" }> {
  const magnitude = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(magnitude) || !(magnitude > 0)) invalid("geometry", "conic line direction is numerically degenerate");
  const dx = (direction.x / magnitude) * (span / 2);
  const dy = (direction.y / magnitude) * (span / 2);
  const points = [transform(conic, { x: localPoint.x - dx, y: localPoint.y - dy }), transform(conic, { x: localPoint.x + dx, y: localPoint.y + dy })];
  verifyPath(points);
  return { kind: "path", points, infinite: true };
}

/** Length-scaled analytic incidence residual; polyline chords are never the authority. */
export function conicPointResidual(conic: ConicDefinition, point: RenderPoint): number {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return Infinity;
  const cosine = Math.cos(conic.rotationRad);
  const sine = Math.sin(conic.rotationRad);
  const dx = point.x - conic.origin.x;
  const dy = point.y - conic.origin.y;
  const x = cosine * dx + sine * dy;
  const y = -sine * dx + cosine * dy;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
  if (conic.kind === "ellipse") return Math.abs(Math.hypot(x / conic.a, y / conic.b) - 1) * Math.min(conic.a, conic.b);
  const parameter = conic.kind === "hyperbola" ? Math.asinh(y / conic.b) : y / (2 * conic.p);
  if (!Number.isFinite(parameter)) return Infinity;
  if (parameter < conic.parameterMin || parameter > conic.parameterMax) {
    // A point on an unrendered continuation cannot satisfy incidence with this scene mark.
    const branches: Array<1 | -1> = conic.kind === "hyperbola" ? [1, -1] : [1];
    return Math.min(...branches.flatMap((branch) => [conic.parameterMin, conic.parameterMax].map((at) => {
      const endpoint = curvePoint(conic, at, branch);
      return Math.hypot(endpoint.x - point.x, endpoint.y - point.y);
    })));
  }
  const expectedX = conic.kind === "hyperbola" ? conic.a * Math.cosh(parameter) : conic.p * parameter ** 2;
  const residualX = Math.abs((conic.kind === "hyperbola" ? Math.abs(x) : x) - expectedX);
  const slope = conic.kind === "hyperbola" ? (conic.a / conic.b) * Math.tanh(parameter) : parameter;
  const residual = residualX / Math.hypot(1, slope);
  return Number.isFinite(residual) ? residual : Infinity;
}

/** No guessed coefficients: every mark is derived from one typed conic definition. */
export function evaluateConicConstruction(operator: string, inputs: Record<string, unknown>, context: ConicEvaluationContext): ConicGeometry[] {
  if (operator === "conic") {
    const conic = readDefinition(inputs, context);
    inputKeys(inputs, ["kind", "rotationDeg", "samples", ...(conic.kind === "ellipse" ? ["center", "a", "b"] : conic.kind === "hyperbola" ? ["center", "a", "b", "tMin", "tMax"] : ["vertex", "p", "tMin", "tMax"])]);
    const samples = inputs.samples === undefined ? 129 : numberInput(inputs, "samples", context);
    if (!Number.isInteger(samples) || samples < 17 || samples > MAX_SAMPLES) invalid("samples", `conic samples must be an integer from 17 to ${MAX_SAMPLES}`);
    const branches: Array<1 | -1> = conic.kind === "hyperbola" ? [1, -1] : [1];
    const paths = branches.map((branch) => Array.from({ length: samples }, (_, i) => curvePoint(conic, conic.parameterMin + (conic.parameterMax - conic.parameterMin) * i / (samples - 1), branch)));
    if (conic.kind === "ellipse") paths[0]![samples - 1] = { ...paths[0]![0]! };
    for (const path of paths) verifyPath(path);
    return [{ kind: "compound", paths, terminals: [curvePoint(conic, conic.parameterMin, 1), curvePoint(conic, conic.parameterMax, 1)], conic }];
  }
  const conic = conicReference(inputs, context);
  if (operator === "conic_anchor") {
    const feature = inputs.feature;
    inputKeys(inputs, ["conic", "feature", ...(feature === "curve_point" ? ["at", ...(conic.kind === "hyperbola" ? ["branch"] : [])] : feature === "center" ? [] : [...(conic.kind === "parabola" ? [] : ["side"]), ...(feature === "latus_rectum_endpoint" ? ["transverseSide"] : [])])]);
    if (feature === "curve_point") return [{ kind: "point", point: curvePoint(conic, parameterInput(inputs, conic, context), branchInput(inputs, conic, context)) }];
    if (feature === "center") {
      if (conic.kind === "parabola") invalid("feature", "a parabola has no center; request its vertex");
      return [{ kind: "point", point: { ...conic.origin } }];
    }
    if (feature !== "vertex" && feature !== "co_vertex" && feature !== "focus" && feature !== "latus_rectum_endpoint") invalid("feature", "unsupported conic landmark");
    if (feature === "co_vertex" && conic.kind === "parabola") invalid("feature", "a parabola has no co_vertex");
    const side = focalSide(inputs, conic, context);
    let local: RenderPoint;
    if (feature === "vertex") local = { x: conic.kind === "parabola" ? 0 : side * conic.a, y: 0 };
    else if (feature === "co_vertex" && conic.kind !== "parabola") local = { x: 0, y: side * conic.b };
    else if (feature === "focus") local = { x: conic.kind === "parabola" ? conic.p : side * focalDistance(conic), y: 0 };
    else {
      const transverseSide = sideInput(inputs, "transverseSide", context);
      local = conic.kind === "parabola"
        ? { x: conic.p, y: transverseSide * 2 * Math.abs(conic.p) }
        : { x: side * focalDistance(conic), y: transverseSide * (conic.b / conic.a) * conic.b };
    }
    return [{ kind: "point", point: transform(conic, local) }];
  }
  if (operator === "conic_directrix") {
    inputKeys(inputs, ["conic", "span", ...(conic.kind === "parabola" ? [] : ["side"])]);
    const side = focalSide(inputs, conic, context);
    let x: number;
    if (conic.kind === "parabola") x = -conic.p;
    else {
      const c = focalDistance(conic);
      if (c === 0) invalid("reference", "a circle has no finite directrix");
      x = side * (conic.a / c) * conic.a;
    }
    return [lineFromLocal(conic, { x, y: 0 }, { x: 0, y: 1 }, lengthInput(inputs, "span", context))];
  }
  if (operator === "conic_asymptotes") {
    inputKeys(inputs, ["conic", "span"]);
    if (conic.kind !== "hyperbola") invalid("reference", "only a hyperbola has these two straight-line asymptotes");
    const span = lengthInput(inputs, "span", context);
    const paths = [1, -1].map((side) => lineFromLocal(conic, { x: 0, y: 0 }, { x: conic.a, y: side * conic.b }, span).points);
    return [{ kind: "compound", paths, terminals: [paths[0]![0]!, paths[0]![1]!] }];
  }
  if (operator === "conic_tangent") {
    inputKeys(inputs, ["conic", "at", "span", ...(conic.kind === "hyperbola" ? ["branch"] : [])]);
    const at = parameterInput(inputs, conic, context);
    const branch = branchInput(inputs, conic, context);
    const span = lengthInput(inputs, "span", context);
    if (conic.kind === "ellipse") return [lineFromLocal(conic, { x: conic.a * Math.cos(at), y: conic.b * Math.sin(at) }, { x: -conic.a * Math.sin(at), y: conic.b * Math.cos(at) }, span)];
    if (conic.kind === "hyperbola") return [lineFromLocal(conic, { x: branch * conic.a * Math.cosh(at), y: conic.b * Math.sinh(at) }, { x: branch * conic.a * Math.sinh(at), y: conic.b * Math.cosh(at) }, span)];
    return [lineFromLocal(conic, { x: conic.p * at ** 2, y: 2 * conic.p * at }, { x: at, y: 1 }, span)];
  }
  return invalid("operator", `unsupported conic operator ${operator}`);
}

/** Structural validation is independent of the compiler and uses the same finite input contract. */
export function validateConicConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  const { operator, inputs } = construction;
  const add = (key: string, message: string, actual?: unknown): void => {
    const field = key === "reference" ? "conic" : key;
    issues.push({ code: `invalid_${operator}_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${field}`}`, actual });
  };
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  if (outputs.length !== 1 || typeof outputs[0] !== "string") add("outputs", `${operator} must produce exactly one entity`, construction.outputs);
  const expectedKind = operator === "conic_anchor" ? "point" : operator === "conic_tangent" || operator === "conic_directrix" ? "line" : "polyline";
  const outputKind = document.entities.find((entity) => entity.id === outputs[0])?.kind;
  if (outputKind && outputKind !== expectedKind) add("output_kind", `${operator} must produce entity kind ${expectedKind}`, outputKind);
  const conicProducer = operator === "conic" ? construction : typeof inputs.conic === "string" ? constructionByOutput.get(inputs.conic) : undefined;
  const baseUnit = conicProducer?.operator === "conic"
    ? scalarUnit(conicProducer.inputs[conicProducer.inputs.kind === "parabola" ? "p" : "a"], document)
    : undefined;
  const lengthKeys = operator === "conic" ? inputs.kind === "parabola" ? ["p"] : ["a", "b"] : operator === "conic_anchor" ? [] : ["span"];
  for (const key of lengthKeys) {
    const unit = scalarUnit(inputs[key], document);
    if (unit && (!LENGTH_UNITS.has(unit) || baseUnit && LENGTH_UNITS.get(unit) !== LENGTH_UNITS.get(baseUnit))) add(`${key}_unit`, `${key} must use a compatible length unit; conic parameters are not automatically converted`, unit);
  }
  if (operator === "conic") {
    const originKey = inputs.kind === "parabola" ? "vertex" : "center";
    const originProducer = typeof inputs[originKey] === "string" ? constructionByOutput.get(inputs[originKey] as string) : undefined;
    if (originProducer?.operator === "point") for (const key of ["x", "y"]) {
      const unit = scalarUnit(originProducer.inputs[key], document);
      if (unit && (!LENGTH_UNITS.has(unit) || baseUnit && LENGTH_UNITS.get(unit) !== LENGTH_UNITS.get(baseUnit))) add(`${originKey}_unit`, `${originKey} coordinates must use the same length unit as the conic`, unit);
    }
    const rotationUnit = scalarUnit(inputs.rotationDeg, document);
    if (rotationUnit && !DEGREE_UNITS.has(rotationUnit)) add("rotationDeg_unit", "rotationDeg must be expressed in degrees", rotationUnit);
    for (const key of inputs.kind === "ellipse" ? [] : ["tMin", "tMax"]) {
      const unit = scalarUnit(inputs[key], document);
      if (unit && unit !== "1" && unit !== "dimensionless") add(`${key}_unit`, `${key} is a dimensionless conic parameter`, unit);
    }
  }
  if ((operator === "conic_anchor" && inputs.feature === "curve_point") || operator === "conic_tangent") {
    const unit = scalarUnit(inputs.at, document);
    if (unit && unit !== "1" && unit !== "dimensionless" && !(conicProducer?.inputs.kind === "ellipse" && RADIAN_UNITS.has(unit))) add("at_unit", "at is dimensionless (radians for an ellipse)", unit);
  }
  const structuralContext: ConicEvaluationContext = {
    number(value) {
      const result = validationNumber(value, document);
      if (result === null) throw new Error("non-numeric input");
      return result;
    },
    point(value) {
      if (typeof value === "string") {
        const producer = constructionByOutput.get(value);
        const entity = document.entities.find((entity) => entity.id === value);
        if (!producer || entity?.kind !== "point") throw new Error("not a constructed point");
        if (producer.operator === "point") return { x: structuralContext.number(producer.inputs.x), y: structuralContext.number(producer.inputs.y) };
        return { x: 0, y: 0 };
      }
      if (Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "number" && Number.isFinite(item))) return { x: value[0] as number, y: value[1] as number };
      if (isRecord(value) && typeof value.x === "number" && typeof value.y === "number") return finitePoint({ x: value.x, y: value.y }, "center");
      throw new Error("not a point");
    },
    geometry(value) {
      const producer = typeof value === "string" ? constructionByOutput.get(value) : undefined;
      if (producer?.operator !== "conic") return undefined;
      try { return { kind: "compound", conic: readDefinition(producer.inputs, structuralContext) }; }
      catch (error) {
        if (!(error instanceof ConicInputError)) throw error;
        // The conic reports its own field. Pointing this consumer at that field
        // sent repairs to the wrong construction (tMin added to asymptotes).
        return invalid("reference", `conic ${String(value)} is invalid (${error.key}); fix that conic construction, not this ${operator}`);
      }
    },
  };
  try { evaluateConicConstruction(operator, inputs, structuralContext); }
  catch (error) {
    const key = error instanceof ConicInputError ? error.key : "inputs";
    add(key, error instanceof Error ? error.message : `${operator} inputs are invalid`, inputs[key]);
  }
}
const LENGTH_UNITS = new Map([
  ["m", "m,meter,meters,metre,metres"], ["cm", "cm,centimeter,centimeters,centimetre,centimetres"],
  ["mm", "mm,millimeter,millimeters,millimetre,millimetres"], ["km", "km,kilometer,kilometers,kilometre,kilometres"],
  ["µm", "µm,um"], ["nm", "nm"], ["in", "in,inch,inches"], ["ft", "ft,foot,feet"], ["yd", "yd,yard,yards"],
  ["unit", "unit,units,1,dimensionless"],
].flatMap(([canonical, aliases]) => aliases!.split(",").map((alias) => [alias, canonical!] as const)));
const DEGREE_UNITS = new Set(["deg", "degree", "degrees", "°"]);
const RADIAN_UNITS = new Set(["rad", "radian", "radians"]);
function normalizedUnit(value: string): string { return value.trim().replace(/[A-Za-z]{4,}/g, (word) => word.toLowerCase()); }
function scalarUnit(value: unknown, document: SceneDocument, seen = new Set<string>(), depth = 0): string | undefined {
  if (depth > 32) return undefined;
  if (isRecord(value)) {
    if (typeof value.unit === "string" && value.unit.trim()) return normalizedUnit(value.unit);
    if ("value" in value) return scalarUnit(value.value, document, seen, depth + 1);
  }
  if (typeof value !== "string" || seen.has(value)) return undefined;
  const quantity = document.quantities.find((quantity) => quantity.id === value);
  if (!quantity) return undefined;
  seen.add(value);
  return scalarUnit(quantity, document, seen, depth + 1);
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<string>(), depth = 0): number | null {
  if (depth > 32) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (isRecord(value) && "value" in value) return validationNumber(value.value, document, seen, depth + 1);
  if (typeof value !== "string" || seen.has(value)) return null;
  const quantity = document.quantities.find((quantity) => quantity.id === value);
  if (!quantity) return value.trim().length > 0 && Number.isFinite(Number(value)) ? Number(value) : null;
  seen.add(value);
  return validationNumber(quantity.value, document, seen, depth + 1);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
