import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const AFFINE_OPERATORS = ["affine_point", "affine_path"] as const;
export type AffineGeometry =
  | { kind: "point"; point: RenderPoint }
  | { kind: "path"; points: RenderPoint[]; closed?: boolean; directed?: boolean; infinite?: boolean };
export interface AffineEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry(value: unknown): unknown;
}
type Matrix = readonly [number, number, number, number];
type Transform = { matrix: Matrix; translation: RenderPoint; inverse: boolean; determinant: number; relativeDeterminant: number };
const MAX_COEFFICIENT = 1e6;
const MAX_COORDINATE = 1e12;
const MAX_POINTS = 4096;
const MIN_EDGE = 1e-6;
const MIN_RELATIVE_DETERMINANT = 1e-10;
class AffineInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
function invalid(key: string, message: string): never { throw new AffineInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function bounded(value: number, key: string, maximum = MAX_COORDINATE): number {
  if (!Number.isFinite(value) || Math.abs(value) > maximum) invalid(key, `${key} must be finite with magnitude at most ${maximum}`);
  return value;
}
function scalar(value: unknown, key: string, context: AffineEvaluationContext, maximum = MAX_COORDINATE, depth = 0): number {
  if (depth > 32) return invalid(key, "numeric reference depth exceeds 32");
  if (isRecord(value) && "value" in value) return scalar(value.value, key, context, maximum, depth + 1);
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return invalid(key, `${key} requires a numeric literal or quantity reference`);
  try { return bounded(context.number(value), key, maximum); }
  catch (error) { if (error instanceof AffineInputError) throw error; return invalid(key, `${key} requires a finite bounded number`); }
}
function checkedPoint(value: unknown, key: string): RenderPoint {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") return invalid(key, `${key} must contain finite x and y coordinates`);
  return { x: bounded(value.x, key), y: bounded(value.y, key) };
}
function inlinePoint(value: unknown, key: string, context: AffineEvaluationContext): RenderPoint {
  if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], key, context), y: scalar(value[1], key, context) };
  if (isRecord(value) && Object.keys(value).every((name) => name === "x" || name === "y")) return { x: scalar(value.x, key, context), y: scalar(value.y, key, context) };
  return invalid(key, `${key} must be [x,y] or {x,y}`);
}
function readTransform(inputs: Record<string, unknown>, context: AffineEvaluationContext): Transform {
  const extra = Object.keys(inputs).filter((key) => !["point", "path", "matrix", "translation", "inverse"].includes(key));
  if (extra.length) invalid("fields", `unsupported affine inputs: ${extra.join(", ")}`);
  if (!Array.isArray(inputs.matrix) || inputs.matrix.length !== 2 || inputs.matrix.some((row) => !Array.isArray(row) || row.length !== 2)) return invalid("matrix", "matrix must be an explicit 2x2 array");
  const values = inputs.matrix.flat().map((value) => scalar(value, "matrix", context, MAX_COEFFICIENT));
  const matrix: Matrix = [values[0]!, values[1]!, values[2]!, values[3]!];
  const scale = Math.max(...matrix.map(Math.abs));
  const [a, b, c, d] = matrix;
  const relativeDeterminant = scale === 0 ? 0 : (a / scale) * (d / scale) - (b / scale) * (c / scale);
  const determinant = a * d - b * c;
  if (inputs.inverse !== undefined && typeof inputs.inverse !== "boolean") return invalid("inverse", "inverse must be a boolean");
  const inverse = inputs.inverse === true;
  if (inverse && !(Math.abs(relativeDeterminant) > MIN_RELATIVE_DETERMINANT)) return invalid("matrix", "inverse requires a numerically nonsingular 2x2 matrix");
  const translation = inputs.translation === undefined ? { x: 0, y: 0 } : inlinePoint(inputs.translation, "translation", context);
  return { matrix, translation, inverse, determinant, relativeDeterminant };
}
function linearMatrix(transform: Transform): Matrix {
  if (!transform.inverse) return transform.matrix;
  const [a, b, c, d] = transform.matrix;
  const result: Matrix = [d / transform.determinant, -b / transform.determinant, -c / transform.determinant, a / transform.determinant];
  for (const value of result) bounded(value, "matrix", MAX_COEFFICIENT);
  return result;
}
function imagePoint(point: RenderPoint, transform: Transform): RenderPoint {
  const [a, b, c, d] = linearMatrix(transform);
  const x = transform.inverse ? point.x - transform.translation.x : point.x;
  const y = transform.inverse ? point.y - transform.translation.y : point.y;
  return checkedPoint({ x: a * x + b * y + (transform.inverse ? 0 : transform.translation.x), y: c * x + d * y + (transform.inverse ? 0 : transform.translation.y) }, "geometry");
}
function sourceGeometry(value: unknown, kind: "point" | "path", context: AffineEvaluationContext): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return invalid(kind, `affine_${kind} requires a constructed ${kind} reference`);
  const geometry = context.geometry(value);
  if (!isRecord(geometry) || geometry.kind !== kind) return invalid(kind, `affine_${kind} requires ${kind} geometry`);
  const allowed = kind === "point" ? ["kind", "point"] : ["kind", "points", "closed", "directed", "infinite"];
  if (Object.keys(geometry).some((key) => !allowed.includes(key))) return invalid(kind, "affine transformation cannot discard analytic, physical, angle, or 3D metadata");
  return geometry;
}
function areaTwice(points: RenderPoint[]): number {
  const origin = points[0]!;
  return points.slice(1, -1).reduce((sum, p, index) => {
    const q = points[index + 2]!;
    return sum + (p.x - origin.x) * (q.y - origin.y) - (p.y - origin.y) * (q.x - origin.x);
  }, 0);
}
function regionArea(points: RenderPoint[]): number {
  if (points.length < 3) return invalid("path", "closed path requires at least three vertices");
  const origin = points[0]!;
  const scale = Math.max(...points.map((point) => Math.hypot(point.x - origin.x, point.y - origin.y)));
  const area = areaTwice(points);
  if (!(scale > MIN_EDGE) || !Number.isFinite(area) || !(Math.abs(area) / scale / scale > MIN_RELATIVE_DETERMINANT)) invalid("geometry", "closed path must retain numerically verifiable region rank and area");
  return area;
}
function pathImage(source: Record<string, unknown>, transform: Transform): Extract<AffineGeometry, { kind: "path" }> {
  if (!Array.isArray(source.points) || source.points.length < 2 || source.points.length > MAX_POINTS) return invalid("path", `path requires 2 to ${MAX_POINTS} finite vertices`);
  for (const key of ["closed", "directed", "infinite"]) if (source[key] !== undefined && typeof source[key] !== "boolean") invalid("path", `path ${key} must be boolean`);
  const points = source.points.map((point) => checkedPoint(point, "path"));
  const result = points.map((point) => imagePoint(point, transform));
  const closed = source.closed === true;
  const duplicatedClosure = closed && points[0]!.x === points.at(-1)!.x && points[0]!.y === points.at(-1)!.y;
  const vertexCount = duplicatedClosure ? points.length - 1 : points.length;
  const edgeCount = closed ? vertexCount : vertexCount - 1;
  const [a, b, c, d] = linearMatrix(transform);
  for (let i = 0; i < edgeCount; i += 1) {
    const next = (i + 1) % vertexCount;
    const dx = points[next]!.x - points[i]!.x; const dy = points[next]!.y - points[i]!.y;
    const expected = { x: a * dx + b * dy, y: c * dx + d * dy };
    const actual = { x: result[next]!.x - result[i]!.x, y: result[next]!.y - result[i]!.y };
    const span = Math.hypot(expected.x, expected.y);
    if (!(Math.hypot(dx, dy) > MIN_EDGE) || !(span > MIN_EDGE) || !(Math.hypot(actual.x, actual.y) > MIN_EDGE)) invalid("geometry", "affine transformation collapses a path edge");
    if (Math.hypot(actual.x - expected.x, actual.y - expected.y) > span * 1e-7) invalid("geometry", "affine placement cannot preserve transformed edge vectors at numeric precision");
  }
  if (closed) {
    if (!(Math.abs(transform.relativeDeterminant) > MIN_RELATIVE_DETERMINANT)) invalid("matrix", "closed-region affine transformation requires full rank");
    const originalArea = regionArea(points.slice(0, vertexCount));
    const actualArea = regionArea(result.slice(0, vertexCount));
    const expectedArea = originalArea * (transform.inverse ? 1 / transform.determinant : transform.determinant);
    if (Math.abs(actualArea - expectedArea) > Math.abs(expectedArea) * 1e-7) invalid("geometry", "affine placement cannot preserve determinant area and orientation at numeric precision");
  }
  return { kind: "path", points: result, ...(source.closed === undefined ? {} : { closed: source.closed as boolean }), ...(source.directed === undefined ? {} : { directed: source.directed as boolean }), ...(source.infinite === undefined ? {} : { infinite: source.infinite as boolean }) };
}

/** Composition is expressed by referencing earlier affine outputs; translation is applied after the matrix. */
export function evaluateAffineConstruction(operator: string, inputs: Record<string, unknown>, context: AffineEvaluationContext): AffineGeometry[] {
  if (!(AFFINE_OPERATORS as readonly string[]).includes(operator)) return invalid("operator", `unsupported affine operator ${operator}`);
  const transform = readTransform(inputs, context);
  if (operator === "affine_point") {
    if (inputs.path !== undefined) return invalid("fields", "affine_point does not accept path");
    const source = sourceGeometry(inputs.point, "point", context);
    return [{ kind: "point", point: imagePoint(checkedPoint(source.point, "point"), transform) }];
  }
  if (inputs.point !== undefined) return invalid("fields", "affine_path does not accept point");
  return [pathImage(sourceGeometry(inputs.path, "path", context), transform)];
}

const PATH_KINDS = new Set(["segment", "line", "ray", "vector", "polyline", "polygon", "rectangle"]);
const PROTECTED_PRODUCERS = new Set(["space_frame", "space_point", "space_line", "plane", "space_project", "space_intersection", "space_closest_points", "space_segment", "space_vector", "space_cross", "space_angle_mark", "space_right_angle_mark", "solid_anchor", "electric_field", "field_components", "conic", "conic_anchor", "conic_directrix", "conic_asymptotes", "conic_tangent", "function_curve", "parametric_curve", "polar_curve", "implicit_curve", "mark_angle"]);
const LENGTH_UNITS: Readonly<Record<string, string>> = {
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m", cm: "cm", centimeter: "cm", centimeters: "cm", centimetre: "cm", centimetres: "cm",
  mm: "mm", millimeter: "mm", millimeters: "mm", millimetre: "mm", millimetres: "mm", km: "km", kilometer: "km", kilometers: "km", kilometre: "km", kilometres: "km",
  um: "um", "µm": "um", "μm": "um", nm: "nm", in: "in", inch: "in", inches: "in", ft: "ft", foot: "ft", feet: "ft", yd: "yd", yard: "yd", yards: "yd",
  unit: "unit", units: "unit", "1": "unit", dimensionless: "unit",
};
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<string>(), depth = 0): number {
  if (depth > 32) return invalid("number", "numeric reference depth exceeds 32");
  if (typeof value === "number") return bounded(value, "number");
  if (isRecord(value) && "value" in value) return validationNumber(value.value, document, seen, depth + 1);
  if (typeof value !== "string" || !value.trim() || seen.has(value)) return invalid("number", "number must be a finite literal or acyclic quantity reference");
  const quantity = document.quantities.find((quantity) => quantity.id === value);
  if (!quantity) return bounded(Number(value), "number");
  seen.add(value); return validationNumber(quantity.value, document, seen, depth + 1);
}
function normalizedUnit(value: string): string { return value.trim().replace(/[A-Za-z]{4,}/g, (word) => word.toLowerCase()); }
function scalarUnits(value: unknown, document: SceneDocument, seen = new Set<string>(), depth = 0): string[] {
  if (depth > 32) return invalid("units", "unit provenance depth exceeds 32");
  if (isRecord(value)) return [...(typeof value.unit === "string" && value.unit.trim() ? [normalizedUnit(value.unit)] : []), ...("value" in value ? scalarUnits(value.value, document, seen, depth + 1) : [])];
  if (typeof value !== "string") return [];
  const quantity = document.quantities.find((quantity) => quantity.id === value);
  if (!quantity) return [];
  if (seen.has(value)) return invalid("units", "quantity units must have acyclic provenance");
  seen.add(value); return scalarUnits(quantity, document, seen, depth + 1);
}

/** Exact sources replay; other eligible 2D sources defer coordinate feasibility to compilation, never invented coordinates. */
export function validateAffineConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  if (!(AFFINE_OPERATORS as readonly string[]).includes(construction.operator)) return;
  const add = (key: string, message: string, actual?: unknown): void => { issues.push({ code: `invalid_${construction.operator}_${key}`, message, severity: "fatal", path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`, actual }); };
  const outputIds = Array.isArray(construction.outputs) ? construction.outputs : [];
  if (outputIds.length !== 1 || typeof outputIds[0] !== "string") add("outputs", "affine construction requires exactly one output", construction.outputs);
  const key = construction.operator === "affine_point" ? "point" : "path";
  const sourceId = construction.inputs[key];
  const sourceEntity = document.entities.find((entity) => entity.id === sourceId);
  const expectedKind = key === "point" ? "point" : sourceEntity?.kind;
  if (document.entities.find((entity) => entity.id === outputIds[0])?.kind !== expectedKind) add("output_kind", "affine output must match its source entity kind");
  const cache = new Map<string, AffineGeometry | null>();
  const visiting = new Set<string>();
  const lengths: string[] = [];
  const context: AffineEvaluationContext = {
    number(value) { return validationNumber(value, document); },
    point(value) {
      const result = resolve(value);
      if (!result || result.kind !== "point") return invalid("point", "point coordinates are deferred to the compiler");
      return result.point;
    },
    geometry(value) { return resolve(value) ?? undefined; },
  };
  function point(value: unknown): RenderPoint | null {
    if (typeof value !== "string") return inlinePoint(value, "point", context);
    const result = resolve(value);
    if (result && result.kind !== "point") return invalid("point", "source vertex must reference a point");
    return result?.kind === "point" ? result.point : null;
  }
  function resolve(value: unknown): AffineGeometry | null {
    if (typeof value !== "string") return invalid("reference", "affine source requires a constructed entity reference");
    if (cache.has(value)) return cache.get(value)!;
    if (visiting.has(value) || visiting.size >= 64) return invalid("reference", "affine source dependencies must be acyclic with depth at most 64");
    const producer = constructionByOutput.get(value); const entity = document.entities.find((entity) => entity.id === value);
    if (!producer || !entity || entity.kind !== "point" && !PATH_KINDS.has(entity.kind)) return invalid("reference", "affine source must be constructed 2D point or path geometry");
    if (PROTECTED_PRODUCERS.has(producer.operator)) return invalid("reference", "affine source cannot discard protected 3D, physical, or analytic metadata");
    visiting.add(value);
    try {
      const input = producer.inputs;
      let result: AffineGeometry | null = null;
      if (producer.operator === "point") result = { kind: "point", point: { x: scalar(input.x, "x", context), y: scalar(input.y, "y", context) } };
      else if ((AFFINE_OPERATORS as readonly string[]).includes(producer.operator)) {
        const transform = readTransform(input, context);
        linearMatrix(transform);
        const source = resolve(input[producer.operator === "affine_point" ? "point" : "path"]);
        if (source) result = evaluateAffineConstruction(producer.operator, input, context)[0]!;
      } else if (["polygon", "polyline"].includes(producer.operator)) {
        const values = input.points ?? input.vertices;
        if (!Array.isArray(values) || values.length < 2 || values.length > MAX_POINTS) return invalid("path", "source path point count is invalid");
        const points = values.map(point);
        if (points.every((p): p is RenderPoint => p !== null)) result = { kind: "path", points, closed: producer.operator === "polygon" };
      } else if (["segment", "line", "ray", "vector"].includes(producer.operator)) {
        const start = input.start ?? input.from ?? input.a ?? input.origin;
        const end = input.end ?? input.to ?? input.b;
        if (start !== undefined && end !== undefined && input.direction === undefined) {
          const a = point(start); const b = point(end);
          if (a && b) result = { kind: "path", points: [a, b], ...(producer.operator === "line" || producer.operator === "ray" ? { infinite: true } : {}), ...(producer.operator === "ray" || producer.operator === "vector" ? { directed: true } : {}) };
        }
      }
      cache.set(value, result); return result;
    } finally { visiting.delete(value); }
  }
  function gatherSource(value: unknown, seen: Set<string>, depth = 0): void {
    if (depth > 64) return invalid("reference", "affine source provenance exceeds depth64");
    if (typeof value === "string" && constructionByOutput.has(value)) {
      if (seen.has(value)) return invalid("reference", "affine source provenance must be acyclic");
      const producer = constructionByOutput.get(value)!;
      if (PROTECTED_PRODUCERS.has(producer.operator)) return invalid("reference", "affine source has protected metric provenance");
      const next = new Set(seen); next.add(value);
      const lengthKeys = producer.operator === "point" ? ["x", "y"] : producer.operator === "rectangle" ? ["width", "height"] : producer.operator.startsWith("triangle_from_") ? ["sideAB", "sideBC", "sideCA"] : [];
      for (const lengthKey of lengthKeys) lengths.push(...scalarUnits(producer.inputs[lengthKey], document));
      if ((AFFINE_OPERATORS as readonly string[]).includes(producer.operator)) gatherTranslation(producer.inputs.translation);
      for (const [inputKey, input] of Object.entries(producer.inputs)) if (!["matrix", "kind", "feature", "mode", "inverse"].includes(inputKey)) gatherSource(input, next, depth + 1);
    } else if (Array.isArray(value)) for (const item of value) gatherSource(item, seen, depth + 1);
    else if (isRecord(value)) {
      for (const coordinate of ["x", "y"]) if (value[coordinate] !== undefined) lengths.push(...scalarUnits(value[coordinate], document));
      for (const item of Object.values(value)) gatherSource(item, seen, depth + 1);
    }
  }
  function gatherTranslation(value: unknown): void {
    const values = Array.isArray(value) ? value : isRecord(value) ? [value.x, value.y] : [];
    for (const scalar of values) lengths.push(...scalarUnits(scalar, document));
  }
  try {
    const transform = readTransform(construction.inputs, context); linearMatrix(transform);
    if (construction.inputs[key === "point" ? "path" : "point"] !== undefined) invalid("fields", `affine_${key} accepts only its ${key} reference`);
    if (!sourceEntity || (key === "point" ? sourceEntity.kind !== "point" : !PATH_KINDS.has(sourceEntity.kind))) invalid(key, `affine_${key} requires a compatible constructed ${key}`);
    for (const row of construction.inputs.matrix as unknown[][]) for (const value of row) for (const unit of scalarUnits(value, document)) if (unit !== "1" && unit !== "dimensionless") invalid("units", "matrix coefficients must be dimensionless");
    gatherTranslation(construction.inputs.translation); gatherSource(sourceId, new Set());
    const normalizedUnits = new Set(lengths.map((unit) => LENGTH_UNITS[unit] ?? invalid("units", `coordinate and translation quantity unit ${unit} is not a supported length scale`)));
    if (normalizedUnits.size > 1) invalid("units", "affine source coordinates and translations must share one common length scale");
    const source = resolve(sourceId);
    if (source) evaluateAffineConstruction(construction.operator, construction.inputs, context);
    else if (key === "path" && (sourceEntity.kind === "polygon" || sourceEntity.kind === "rectangle") && !(Math.abs(transform.relativeDeterminant) > MIN_RELATIVE_DETERMINANT)) invalid("matrix", "closed-region transformation must have full rank");
  } catch (error) { add(error instanceof AffineInputError ? error.key : "inputs", error instanceof Error ? error.message : "invalid affine construction"); }
}
