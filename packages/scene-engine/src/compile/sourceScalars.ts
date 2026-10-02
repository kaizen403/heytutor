import type { RenderPoint, SceneDocument } from "../types";

export class SourceInputError extends Error {
  constructor(readonly key: string, message: string) { super(message); }
}

export function invalid(key: string, message: string): never {
  throw new SourceInputError(key, message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void {
  if (Object.keys(value).some((name) => !allowed.includes(name))) invalid(key, `unsupported ${key} fields`);
}

export function bounded(value: number, key: string, cap = 1e12): number {
  if (!Number.isFinite(value) || Math.abs(value) > cap) invalid(key, `${key} must be finite with magnitude at most ${cap}`);
  return value === 0 ? 0 : value;
}

export function preserveLiteral(value: unknown, key: string): void {
  const match = typeof value === "string" && /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE][+-]?\d+)?$/.exec(value.trim());
  if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) invalid(key, "a nonzero literal cannot become certified zero");
}

export interface SourceContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry(value: unknown): unknown;
}

export function scalar(value: unknown, key: string, context: SourceContext, cap = 1e12, depth = 0): number {
  if (depth > 32) invalid(key, `${key} nesting exceeds depth 32`);
  if (isRecord(value)) {
    rejectUnknownKeys(value, ["value", "unit"], key);
    return scalar(value.value, key, context, cap, depth + 1);
  }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) invalid(key, `${key} requires a finite scalar or quantity reference`);
  preserveLiteral(value, key);
  try { return bounded(context.number(value), key, cap); }
  catch (error) {
    if (error instanceof SourceInputError) throw error;
    return invalid(key, `${key} requires a finite scalar value`);
  }
}

export function pair(value: unknown, key: string, context: SourceContext, cap = 1e12): RenderPoint {
  const values = pairValues(value, key);
  return {
    x: scalar(values[0], `${key}.x`, context, cap),
    y: scalar(values[1], `${key}.y`, context, cap),
  };
}

export function pairValues(value: unknown, key: string): [unknown, unknown] {
  if (Array.isArray(value) && value.length === 2) return [value[0], value[1]];
  if (isRecord(value)) {
    rejectUnknownKeys(value, ["x", "y"], key);
    if ("x" in value && "y" in value) return [value.x, value.y];
  }
  return invalid(key, `${key} requires explicit [x,y] components`);
}

export function triple(value: unknown, key: string, context: SourceContext, cap = 1e12): { x: number; y: number; z: number } {
  if (!Array.isArray(value) || value.length !== 3) invalid(key, `${key} requires three explicit Cartesian components`);
  return {
    x: scalar(value[0], `${key}.x`, context, cap),
    y: scalar(value[1], `${key}.y`, context, cap),
    z: scalar(value[2], `${key}.z`, context, cap),
  };
}

export function placement(value: unknown, key: string, context: SourceContext): RenderPoint {
  if (value === undefined) return { x: 0, y: 0 };
  if (Array.isArray(value) || isRecord(value)) return pair(value, key, context);
  if (typeof value !== "string" || !value.trim()) invalid(key, `${key} must be an inline point or a constructed point id`);
  try { return pointOf(context.point(value), key); }
  catch (error) {
    if (error instanceof SourceInputError) throw error;
    return invalid(key, `${key} requires a constructed 2D point`);
  }
}

export function pointOf(value: unknown, key: string): RenderPoint {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") invalid(key, `${key} requires finite 2D coordinates`);
  return { x: bounded(value.x, key), y: bounded(value.y, key) };
}

export function hypot2(value: RenderPoint): number {
  const scale = Math.max(Math.abs(value.x), Math.abs(value.y));
  if (scale === 0) return 0;
  const normalized = Math.hypot(value.x / scale, value.y / scale);
  const magnitude = scale * normalized;
  if (!Number.isFinite(magnitude) || magnitude > 1e12) invalid("precision", "vector magnitude exceeds finite authority");
  return magnitude === 0 ? 0 : magnitude;
}

export function unit2(value: RenderPoint, key: string): RenderPoint {
  const length = hypot2(value);
  if (!(length > 0)) invalid(key, `${key} must be a nonzero direction`);
  return { x: value.x / length, y: value.y / length };
}

export function add2(a: RenderPoint, b: RenderPoint, key: string): RenderPoint {
  const x = a.x + b.x;
  const y = a.y + b.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) invalid(key, `${key} exceeds finite arithmetic`);
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

export function scale2(value: RenderPoint, factor: number, key: string): RenderPoint {
  const x = value.x * factor;
  const y = value.y * factor;
  if (!Number.isFinite(x) || !Number.isFinite(y)) invalid(key, `${key} exceeds finite arithmetic`);
  if (value.x !== 0 && x === 0 || value.y !== 0 && y === 0) invalid(key, `${key} underflows a nonzero component`);
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

export function canonicalUnit(value: unknown, aliases: Readonly<Record<string, string>>): string | undefined {
  return typeof value === "string" ? aliases[value.trim()] : undefined;
}

export function sourceUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) invalid("units", "source units must be acyclic with depth at most 32");
  if (isRecord(value)) rejectUnknownKeys(value, ["value", "unit"], "quantity");
  const entry = typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : isRecord(value) ? value : undefined;
  if (!entry) return [];
  seen.add(value);
  if (entry.unit !== undefined && (typeof entry.unit !== "string" || !entry.unit.trim())) invalid("units", "known source units must be nonempty strings");
  return [...(typeof entry.unit === "string" ? [entry.unit] : []), ...("value" in entry ? sourceUnits(entry.value, document, seen, depth + 1) : [])];
}

export function requireUnits(value: unknown, expected: string, aliases: Readonly<Record<string, string>>, document?: SceneDocument): void {
  for (const actual of sourceUnits(value, document)) {
    if (canonicalUnit(actual, aliases) !== expected) invalid("units", `source unit ${actual} must match ${expected}; no conversion is inferred`);
  }
}

export function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) invalid("quantity", "scalar quantity references must be acyclic and bounded");
  if (typeof value === "number") return bounded(value, "quantity");
  if (isRecord(value) && "value" in value) {
    rejectUnknownKeys(value, ["value", "unit"], "quantity");
    seen.add(value);
    return validationNumber(value.value, document, seen, depth + 1);
  }
  if (typeof value === "string" && value.trim()) {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) {
      seen.add(value);
      return validationNumber(quantity.value, document, seen, depth + 1);
    }
    preserveLiteral(value, "quantity");
    return bounded(Number(value), "quantity");
  }
  return invalid("quantity", "values must resolve to finite scalar numbers");
}

export function compactNumber(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  return abs >= 0.001 && abs < 10000 ? Number(value.toPrecision(6)).toString() : value.toExponential(3).replace("e+", "e");
}
