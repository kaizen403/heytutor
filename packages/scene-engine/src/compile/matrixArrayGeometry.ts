import type { RenderPoint, RenderPrimitive, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { captureMathSourceData, snapshotMathSourceData } from "./mathSourceData";

export const MATRIX_ARRAY_OPERATORS = ["matrix_array", "matrix_add", "matrix_scale", "matrix_product", "matrix_transpose"] as const;
export type MatrixArrayOperator = (typeof MATRIX_ARRAY_OPERATORS)[number];
export type MatrixArrayType = "rectangular" | "square" | "row" | "column" | "zero" | "identity" | "diagonal" | "symmetric" | "skew_symmetric" | "scalar" | "upper_triangular" | "lower_triangular";
export interface ExactMatrixEntry { numerator: string; denominator: string }
export interface MatrixArrayDefinition {
  operation: MatrixArrayOperator;
  rows: number;
  columns: number;
  entries: number[][];
  exactEntries: ExactMatrixEntry[][];
  types: MatrixArrayType[];
  sourceIds: string[];
  origin: RenderPoint;
  displayScale: number;
  nonmetric: true;
  /** Present only when a source cell or multiplier was written as an exact fraction. */
  notation?: "fraction";
}
export interface MatrixArrayGeometry { kind: "matrix_array"; matrixArray: MatrixArrayDefinition }
export interface MatrixArrayEvaluationContext {
  scalar(id: string): unknown;
  geometry(id: string): unknown;
}
type Rational = { n: bigint; d: bigint };
const MAX_ENTRY = 1e6;
const INPUT_KEYS: Readonly<Record<MatrixArrayOperator, readonly string[]>> = {
  matrix_array: ["entries", "claimedType", "origin", "displayScale"],
  matrix_add: ["left", "right", "claimedType", "origin", "displayScale"],
  matrix_scale: ["matrix", "scalar", "claimedType", "origin", "displayScale"],
  matrix_product: ["left", "right", "claimedType", "origin", "displayScale"],
  matrix_transpose: ["matrix", "claimedType", "origin", "displayScale"],
};
class MatrixArrayInputError extends Error {
  constructor(readonly key: string, message: string) { super(message); }
}
function fail(key: string, message: string): never { throw new MatrixArrayInputError(key, message); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, allowed: readonly string[], key: string): void {
  if (Object.keys(value).some((name) => !allowed.includes(name))) fail(key, "matrix arrays contain unsupported fields");
}
function operator(value: string): value is MatrixArrayOperator {
  return (MATRIX_ARRAY_OPERATORS as readonly string[]).includes(value);
}
function rational(n: bigint, d: bigint): Rational {
  if (d <= 0n) fail("entries", "matrix exact denominators must be positive");
  if (n === 0n) return { n: 0n, d: 1n };
  let a = n < 0n ? -n : n;
  let b = d;
  while (b) { const next = a % b; a = b; b = next; }
  const result = { n: n / a, d: d / a };
  if (result.n.toString(2).length > 8192 || result.d.toString(2).length > 8192) fail("entries", "matrix exact arithmetic exceeds its bounded capacity");
  return result;
}
function decimal(value: string, key: string): Rational {
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i.exec(value);
  if (!match || value.length > 512) fail(key, "matrix values require bounded decimal real literals");
  const exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1024) fail(key, "matrix literal exponent exceeds its bounded capacity");
  const [whole, fractional = ""] = match[2]!.split(".");
  const coefficient = BigInt((whole || "0") + fractional) * (match[1] === "-" ? -1n : 1n);
  const power = exponent - fractional.length;
  return power >= 0 ? rational(coefficient * 10n ** BigInt(power), 1n) : rational(coefficient, 10n ** BigInt(-power));
}
function decimalText(value: Rational): string {
  if (value.n === 0n) return "0";
  let denominator = value.d;
  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) { denominator /= 2n; twos++; }
  while (denominator % 5n === 0n) { denominator /= 5n; fives++; }
  if (denominator !== 1n) fail("entries", "matrix authority must retain finite decimal source arithmetic");
  const places = Math.max(twos, fives);
  const coefficient = (value.n < 0n ? -value.n : value.n) * 2n ** BigInt(places - twos) * 5n ** BigInt(places - fives);
  const digits = coefficient.toString().replace(/0+$/, "");
  const exponent = coefficient.toString().length - places - 1;
  const sign = value.n < 0n ? "-" : "";
  if (exponent >= 0 && exponent < 12) {
    const padded = digits.padEnd(exponent + 1, "0");
    return sign + padded.slice(0, exponent + 1) + (padded.length > exponent + 1 ? "." + padded.slice(exponent + 1) : "");
  }
  if (exponent < 0 && exponent >= -6) return sign + "0." + "0".repeat(-exponent - 1) + digits;
  return sign + digits[0] + (digits.length > 1 ? "." + digits.slice(1) : "") + "e" + exponent;
}
function finiteDecimal(value: Rational): boolean {
  let d = value.d;
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  return d === 1n;
}
function fractionText(value: Rational): string {
  return value.d === 1n ? value.n.toString() : `${value.n}/${value.d}`;
}
function numeric(value: Rational, key: string): number {
  if ((value.n < 0n ? -value.n : value.n) > BigInt(MAX_ENTRY) * value.d) fail(key, `matrix values must have magnitude at most ${MAX_ENTRY}`);
  // A repeating fraction keeps its exact authority in exactEntries; the numeric
  // mirror is the correctly rounded double (IEEE division of safe integers).
  const safe = (x: bigint) => x <= BigInt(Number.MAX_SAFE_INTEGER) && x >= -BigInt(Number.MAX_SAFE_INTEGER);
  const result = finiteDecimal(value) ? Number(decimalText(value))
    : safe(value.n) && safe(value.d) ? Number(value.n) / Number(value.d)
      : Number((value.n * 10n ** 21n) / value.d) / 1e21;
  if (!Number.isFinite(result) || value.n !== 0n && result === 0) fail(key, "nonzero matrix authority cannot underflow to a certified zero");
  return result === 0 ? 0 : result;
}
interface NotationFlags { fraction: boolean }
const FRACTION = /^([+-]?)(\d{1,12})\s*\/\s*(\d{1,12})$/;
function scalar(value: unknown, key: string, context: MatrixArrayEvaluationContext, seen = new Set<unknown>(), depth = 0, flags?: NotationFlags): Rational {
  if (depth > 32 || seen.has(value)) fail(key, "matrix scalar references are cyclic or exceed depth32");
  if (record(value)) {
    fields(value, ["value", "unit"], key);
    if (value.unit !== undefined && (typeof value.unit !== "string" || !["1", "dimensionless", "unitless", "scalar"].includes(value.unit.trim().toLowerCase()))) fail(key, "matrix algebra entries and placement must be dimensionless");
    seen.add(value);
    return scalar(value.value, key, context, seen, depth + 1, flags);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(key, "matrix values must be finite real numbers");
    const result = decimal(value.toString(), key);
    numeric(result, key);
    return result;
  }
  if (typeof value !== "string" || !value.trim()) fail(key, "matrix values require real literals or declared quantity references");
  const text = value.trim();
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    const result = decimal(text, key);
    numeric(result, key);
    return result;
  }
  const fraction = FRACTION.exec(text);
  if (fraction) {
    if (BigInt(fraction[3]!) === 0n) fail(key, "matrix fraction denominators must be nonzero");
    const result = rational(BigInt(fraction[2]!) * (fraction[1] === "-" ? -1n : 1n), BigInt(fraction[3]!));
    numeric(result, key);
    if (flags) flags.fraction = true;
    return result;
  }
  seen.add(value);
  let resolved: unknown;
  try { resolved = context.scalar(value); }
  catch { return fail(key, "matrix source quantity cannot be resolved"); }
  return scalar(resolved, key, context, seen, depth + 1, flags);
}
function matrix(value: unknown, key: string, context: MatrixArrayEvaluationContext, flags?: NotationFlags): Rational[][] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) fail(key, "matrix row count must be from1 through6");
  const rows = Array.from(value);
  const columns = Array.isArray(rows[0]) ? rows[0].length : 0;
  if (columns < 1 || columns > 6 || rows.some((row) => !Array.isArray(row) || row.length !== columns)) fail(key, "matrix entries must be a nonempty rectangular array with at most6 columns");
  return rows.map((row) => Array.from(row as unknown[]).map((entry) => scalar(entry, key, context, new Set(), 0, flags)));
}
function exactEntry(value: unknown): Rational {
  if (!record(value)) fail("matrix", "referenced matrix must retain exact entry authority");
  fields(value, ["numerator", "denominator"], "matrix");
  const integer = (raw: unknown): bigint => {
    if (typeof raw !== "string" || raw.length > 2500 || !/^-?(?:0|[1-9]\d*)$/.test(raw)) fail("matrix", "exact entries require bounded canonical integers");
    const result = BigInt(raw);
    if (result.toString() !== raw) fail("matrix", "exact entries require canonical integers");
    return result;
  };
  const n = integer(value.numerator);
  const d = integer(value.denominator);
  const result = rational(n, d);
  if (result.n !== n || result.d !== d) fail("matrix", "exact entries must be reduced");
  numeric(result, "matrix");
  return result;
}
function types(entries: Rational[][]): MatrixArrayType[] {
  const rows = entries.length;
  const columns = entries[0]!.length;
  const result: MatrixArrayType[] = [rows === columns ? "square" : "rectangular"];
  if (rows === 1) result.push("row");
  if (columns === 1) result.push("column");
  if (entries.every((row) => row.every((entry) => entry.n === 0n))) result.push("zero");
  if (rows !== columns) return result;
  if (entries.every((row, i) => row.every((entry, j) => entry.n === (i === j ? entry.d : 0n)))) result.push("identity");
  if (entries.every((row, i) => row.every((entry, j) => i === j || entry.n === 0n))) result.push("diagonal");
  if (entries.every((row, i) => row.every((entry, j) => entry.n * entries[j]![i]!.d === entries[j]![i]!.n * entry.d))) result.push("symmetric");
  if (entries.every((row, i) => row.every((entry, j) => entry.n * entries[j]![i]!.d === -entries[j]![i]!.n * entry.d))) result.push("skew_symmetric");
  // Appended after the original seven so earlier type tuples keep their order.
  // A scalar matrix is diagonal with one repeated diagonal value; triangular
  // types are square-only and allow any diagonal.
  if (result.includes("diagonal") && entries.every((row, i) => row[i]!.n === entries[0]![0]!.n && row[i]!.d === entries[0]![0]!.d)) result.push("scalar");
  if (entries.every((row, i) => row.every((entry, j) => j >= i || entry.n === 0n))) result.push("upper_triangular");
  if (entries.every((row, i) => row.every((entry, j) => j <= i || entry.n === 0n))) result.push("lower_triangular");
  return result;
}
function source(id: unknown, context: MatrixArrayEvaluationContext): { id: string; entries: Rational[][]; fraction: boolean } {
  if (typeof id !== "string" || !id.trim()) fail("matrix", "matrix operands must reference constructed matrix arrays");
  const geometry = context.geometry(id);
  if (!record(geometry) || geometry.kind !== "matrix_array" || !record(geometry.matrixArray)) fail("matrix", "matrix operand must retain nonmetric matrix-array authority");
  fields(geometry, ["kind", "matrixArray"], "matrix");
  const definition = geometry.matrixArray;
  fields(definition, ["operation", "rows", "columns", "entries", "exactEntries", "types", "sourceIds", "origin", "displayScale", "nonmetric", "notation"], "matrix");
  if (definition.notation !== undefined && definition.notation !== "fraction") fail("matrix", "matrix notation must be fraction when present");
  if (definition.nonmetric !== true || typeof definition.operation !== "string" || !operator(definition.operation)) fail("matrix", "matrix metadata cannot imply a geometric transform");
  const sourceCount = definition.operation === "matrix_array" ? 0 : definition.operation === "matrix_add" || definition.operation === "matrix_product" ? 2 : 1;
  if (!Array.isArray(definition.sourceIds) || definition.sourceIds.length !== sourceCount || definition.sourceIds.some((id) => typeof id !== "string" || !id.trim())) fail("matrix", "matrix source identities must retain their operation arity");
  if (!record(definition.origin)) fail("matrix", "matrix source placement is missing");
  fields(definition.origin, ["x", "y"], "matrix");
  if (typeof definition.origin.x !== "number" || typeof definition.origin.y !== "number" || !Number.isFinite(definition.origin.x) || !Number.isFinite(definition.origin.y) || Math.abs(definition.origin.x) > MAX_ENTRY || Math.abs(definition.origin.y) > MAX_ENTRY || typeof definition.displayScale !== "number" || !Number.isFinite(definition.displayScale) || definition.displayScale < 1e-6 || definition.displayScale > MAX_ENTRY) fail("matrix", "matrix source placement must retain bounded dimensionless coordinates");
  if (!Array.isArray(definition.exactEntries)) fail("matrix", "matrix exact entries are missing");
  const raw = Array.from(definition.exactEntries);
  if (raw.length < 1 || raw.length > 6 || !Array.isArray(raw[0]) || raw[0].length < 1 || raw[0].length > 6 || raw.some((row) => !Array.isArray(row) || row.length !== raw[0].length)) fail("matrix", "referenced exact entries must retain rectangular dimensions");
  const entries = raw.map((row) => Array.from(row as unknown[]).map(exactEntry));
  if (definition.rows !== entries.length || definition.columns !== entries[0]!.length || !Array.isArray(definition.entries) || definition.entries.length !== entries.length) fail("matrix", "matrix dimensions contradict exact entries");
  const values = definition.entries;
  if (entries.some((row, i) => !Array.isArray(values[i]) || values[i].length !== row.length || row.some((entry, j) => values[i][j] !== numeric(entry, "matrix")))) fail("matrix", "matrix numeric entries contradict exact authority");
  const classification = types(entries);
  const declaredTypes = definition.types;
  if (!Array.isArray(declaredTypes) || classification.length !== declaredTypes.length || classification.some((type, i) => declaredTypes[i] !== type)) fail("matrix", "matrix type claims contradict exact entries");
  return { id, entries, fraction: definition.notation === "fraction" };
}

/** The double a JSON plan would carry for this exact entry. */
export function matrixEntryDouble(entry: ExactMatrixEntry): number {
  return numeric(rational(BigInt(entry.numerator), BigInt(entry.denominator)), "entries");
}

export function evaluateMatrixArrayConstruction(operatorName: string, inputs: Record<string, unknown>, context: MatrixArrayEvaluationContext): MatrixArrayGeometry[] {
  const captured = captureMathSourceData(inputs, context);
  inputs = captured.data;
  context = captured.sources;
  if (!operator(operatorName)) fail("operator", `unsupported matrix-array operator ${operatorName}`);
  if (!record(inputs)) fail("inputs", "matrix inputs must be an object");
  fields(inputs, INPUT_KEYS[operatorName], "fields");
  let entries: Rational[][];
  const sourceIds: string[] = [];
  const flags: NotationFlags = { fraction: false };
  if (operatorName === "matrix_array") entries = matrix(inputs.entries, "entries", context, flags);
  else if (operatorName === "matrix_scale" || operatorName === "matrix_transpose") {
    const a = source(inputs.matrix, context);
    sourceIds.push(a.id);
    flags.fraction ||= a.fraction;
    if (operatorName === "matrix_transpose") entries = a.entries[0]!.map((_, j) => a.entries.map((row) => row[j]!));
    else {
      const factor = scalar(inputs.scalar, "scalar", context, new Set(), 0, flags);
      entries = a.entries.map((row) => row.map((entry) => rational(entry.n * factor.n, entry.d * factor.d)));
    }
  } else {
    const a = source(inputs.left, context);
    const b = source(inputs.right, context);
    sourceIds.push(a.id, b.id);
    flags.fraction ||= a.fraction || b.fraction;
    if (operatorName === "matrix_add") {
      if (a.entries.length !== b.entries.length || a.entries[0]!.length !== b.entries[0]!.length) fail("dimensions", "matrix addition requires equal dimensions");
      entries = a.entries.map((row, i) => row.map((entry, j) => rational(entry.n * b.entries[i]![j]!.d + b.entries[i]![j]!.n * entry.d, entry.d * b.entries[i]![j]!.d)));
    } else {
      if (a.entries[0]!.length !== b.entries.length) fail("dimensions", "matrix product requires left columns equal right rows");
      entries = a.entries.map((row) => b.entries[0]!.map((_, j) => row.reduce((sum, entry, k) => {
        const next = b.entries[k]![j]!;
        const n = entry.n * next.n;
        const d = entry.d * next.d;
        return rational(sum.n * d + n * sum.d, sum.d * d);
      }, { n: 0n, d: 1n })));
    }
  }
  const classification = types(entries);
  if (inputs.claimedType !== undefined && !classification.includes(inputs.claimedType as MatrixArrayType)) fail("claimedType", "matrix does not satisfy the stated type");
  if (!Array.isArray(inputs.origin) || inputs.origin.length !== 2) fail("origin", "matrix placement requires explicit [x,y] coordinates");
  const origin = { x: numeric(scalar(inputs.origin[0], "origin", context), "origin"), y: numeric(scalar(inputs.origin[1], "origin", context), "origin") };
  const displayScale = numeric(scalar(inputs.displayScale, "displayScale", context), "displayScale");
  if (displayScale < 1e-6) fail("displayScale", "matrix display scale must be explicit and at least1e-6");
  const geometry: MatrixArrayGeometry = { kind: "matrix_array", matrixArray: {
    operation: operatorName, rows: entries.length, columns: entries[0]!.length,
    entries: entries.map((row) => row.map((entry) => numeric(entry, "entries"))),
    exactEntries: entries.map((row) => row.map((entry) => ({ numerator: entry.n.toString(), denominator: entry.d.toString() }))),
    types: classification, sourceIds, origin, displayScale, nonmetric: true,
    ...(flags.fraction ? { notation: "fraction" as const } : {}),
  } };
  return [geometry];
}

export function matrixArrayPrimitives(geometry: MatrixArrayGeometry, entityId: string, groupId: string): RenderPrimitive[] {
  geometry = snapshotMathSourceData(geometry);
  const { entries } = source(entityId, { scalar() { return fail("scalar", "rendering cannot introduce scalar sources"); }, geometry() { return geometry; } });
  const definition = geometry.matrixArray;
  const at = definition.origin;
  const scale = definition.displayScale;
  if (!record(at) || !Number.isFinite(at.x) || !Number.isFinite(at.y) || Math.abs(at.x) > MAX_ENTRY || Math.abs(at.y) > MAX_ENTRY || !Number.isFinite(scale) || scale < 1e-6 || scale > MAX_ENTRY) fail("display", "matrix placement metadata must remain bounded and nonmetric");
  const labels = entries.map((row) => row.map((entry) => {
    // Fraction notation follows the source spelling: integers stay whole and
    // every other cell is its reduced exact fraction.
    if (definition.notation === "fraction") {
      const exact = fractionText(entry);
      if (exact.length <= 14) return exact;
      return `≈${numeric(entry, "entries").toPrecision(6).replace(/\.?0+(?=e|$)/, "")}`;
    }
    const text = decimalText(entry);
    if (text.length <= 14) return text;
    const [mantissa, power] = text.replace(/^-/, "").split("e");
    const [whole, fraction = ""] = mantissa!.split(".");
    const digits = (whole! + fraction).replace(/^0+/, "");
    let exponent = power === undefined ? whole !== "0" ? whole!.length - 1 : -fraction.search(/[1-9]/) - 1 : Number(power);
    let rounded = BigInt(digits.slice(0, 6));
    if (Number(digits[6]) >= 5) rounded++;
    if (rounded >= 1000000n) { rounded /= 10n; exponent++; }
    const significant = rounded.toString().replace(/0+$/, "");
    return `≈${entry.n < 0n ? "-" : ""}${significant[0]}${significant.length > 1 ? "." + significant.slice(1) : ""}e${exponent}`;
  }));
  const widths = Array.from({ length: definition.columns }, (_, j) => Math.max(...labels.map((row) => row[j]!.length)) * 0.7 + 1.5);
  const width = widths.reduce((sum, item) => sum + item, 0);
  const height = definition.rows * 2;
  const place = (x: number, y: number): RenderPoint => ({ x: at.x + scale * x, y: at.y - scale * y });
  const primitives: RenderPrimitive[] = [
    { id: `${entityId}_left`, entityId, groupId, kind: "polyline", points: [[0.4, -1.5], [0, -1.5], [0, height - 0.6], [0.4, height - 0.6]].map(([x, y]) => place(x!, y!)), provenance: { matrixNonmetric: true } },
    { id: `${entityId}_right`, entityId, groupId, kind: "polyline", points: [[width - 0.4, -1.5], [width, -1.5], [width, height - 0.6], [width - 0.4, height - 0.6]].map(([x, y]) => place(x!, y!)), provenance: { matrixNonmetric: true } },
  ];
  let x = 0;
  for (let j = 0; j < definition.columns; j++) {
    for (let i = 0; i < definition.rows; i++) primitives.push({
      id: `${entityId}_${i}_${j}`, entityId, groupId, kind: "label", points: [place(x + widths[j]! / 2, i * 2)], text: labels[i]![j],
      provenance: { matrixNonmetric: true, matrixCell: { row: i, column: j, exactValue: definition.exactEntries[i]![j], displayAccuracy: labels[i]![j]!.startsWith("≈") ? "rounded" : "exact" } },
    });
    x += widths[j]!;
  }
  if (primitives.some((primitive) => primitive.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1e12 || Math.abs(point.y) > 1e12))) fail("display", "matrix layout exceeds bounded coordinates");
  return primitives;
}

export function validateMatrixArrayConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  try {
    const captured = snapshotMathSourceData({ construction, document });
    construction = captured.construction;
    document = captured.document;
  } catch (error) {
    issues.push({ code: "invalid_math_source_data", message: error instanceof Error ? error.message : "mathematical source data cannot be captured", severity: "fatal", path: `constructions[${index}]` });
    return;
  }
  if (!operator(construction.operator)) return;
  const add = (key: string, message: string): void => {
    issues.push({ code: `invalid_${construction.operator}_${key}`, message, severity: "fatal", entityIds: construction.outputs,
      path: `constructions[${index}].${key === "outputs" ? "outputs" : `inputs.${key}`}` });
  };
  const initial = issues.length;
  if (!Array.isArray(construction.outputs) || construction.outputs.length !== 1 || typeof construction.outputs[0] !== "string" || !construction.outputs[0].trim()) add("outputs", "matrix array constructions require exactly one output id");
  else if (document.entities.filter((entity) => entity.id === construction.outputs[0] && entity.kind === "matrix_array").length !== 1 || document.constructions.filter((candidate) => candidate.outputs.includes(construction.outputs[0]!)).length !== 1) add("outputs", "matrix array output must identify one matrix_array entity and producer");
  if (issues.length !== initial) return;
  const cache = new Map<string, MatrixArrayGeometry>();
  const visiting = new Set<string>();
  const context: MatrixArrayEvaluationContext = {
    scalar(id) {
      const quantities = document.quantities.filter((quantity) => quantity.id === id);
      if (quantities.length !== 1) fail("scalar", "matrix quantity reference is missing or ambiguous");
      const quantity = quantities[0]!;
      return { value: quantity.value, unit: quantity.unit };
    },
    geometry(id) {
      if (cache.has(id)) return cache.get(id);
      const producer = snapshotMathSourceData(constructionByOutput.get(id));
      if (!producer || !operator(producer.operator) || producer.outputs.length !== 1 || producer.outputs[0] !== id || document.constructions.filter((candidate) => candidate.outputs.includes(id)).length !== 1 || document.entities.filter((entity) => entity.id === id && entity.kind === "matrix_array").length !== 1) fail("matrix", "matrix operand must have one matrix-array producer and entity");
      if (visiting.has(id) || visiting.size >= 32) fail("matrix", "matrix dependencies are cyclic or exceed depth32");
      visiting.add(id);
      const [geometry] = evaluateMatrixArrayConstruction(producer.operator, producer.inputs, context);
      visiting.delete(id);
      cache.set(id, geometry!);
      return geometry;
    },
  };
  try {
    const [geometry] = evaluateMatrixArrayConstruction(construction.operator, construction.inputs, context);
    matrixArrayPrimitives(geometry!, construction.outputs[0]!, "validation");
  } catch (error) {
    add(error instanceof MatrixArrayInputError ? error.key : "inputs", error instanceof Error ? error.message : "matrix construction cannot be verified");
  }
}
