import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const STATISTICS_OPERATORS = ["histogram", "frequency_polygon", "cumulative_frequency"] as const;

export interface StatisticsContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
}

export type StatisticsGeometry =
  | { kind: "path"; points: RenderPoint[]; closed?: boolean }
  | { kind: "multi_path"; paths: RenderPoint[][] };

type StatisticsOperator = typeof STATISTICS_OPERATORS[number];
type HeightMode = "frequency" | "density";
type Bin = { lower: number; upper: number; frequency: number; width: number };
const MAX_BINS = 128;

class StatisticsInputError extends Error {
  constructor(readonly code: string, readonly inputPath: string, message: string) {
    super(message);
  }
}

/** Derive every mark from supplied class boundaries and frequencies. */
export function evaluateStatisticsConstruction(
  operator: string,
  inputs: Record<string, unknown>,
  context: StatisticsContext,
): StatisticsGeometry[] {
  if (!STATISTICS_OPERATORS.some((supported) => supported === operator)) {
    throw new StatisticsInputError("invalid_statistics_operator", "", `Unsupported statistics operator ${operator}`);
  }
  const supportedOperator = operator as StatisticsOperator;
  const allowedInputs = new Set(["bins", "origin", "xScale", "yScale",
    supportedOperator === "cumulative_frequency" ? "direction" : "heightMode"]);
  for (const key of Object.keys(inputs)) {
    if (!allowedInputs.has(key)) fail("invalid_statistics_input", key, `Unsupported ${operator} input ${key}`);
  }
  const bins = resolveBins(inputs.bins, supportedOperator, context);
  const xScale = inputs.xScale === undefined ? 1 : number(inputs.xScale, context, "invalid_statistics_scale", "xScale");
  const yScale = inputs.yScale === undefined ? 1 : number(inputs.yScale, context, "invalid_statistics_scale", "yScale");
  if (!(xScale > 0) || !(yScale > 0)) fail("invalid_statistics_scale", "", "Statistics xScale and yScale must be positive finite numbers");
  let origin: RenderPoint = { x: 0, y: 0 };
  if (inputs.origin !== undefined) {
    try {
      origin = context.point(inputs.origin);
    } catch {
      fail("invalid_statistics_origin", "origin", "Statistics origin must be a finite point or constructed point reference");
    }
    if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
      fail("invalid_statistics_origin", "origin", "Statistics origin must have finite x and y coordinates");
    }
  }
  const point = (x: number, y: number): RenderPoint => {
    const result = { x: origin.x + x * xScale, y: origin.y + y * yScale };
    if (!Number.isFinite(result.x) || !Number.isFinite(result.y)) {
      fail("invalid_statistics_geometry", "", "Statistics coordinates must remain finite after scaling and translation");
    }
    return result;
  };
  // Reject transformations that lose a class interval to floating-point rounding.
  for (const bin of bins) {
    if (!(point(bin.lower, 0).x < point(bin.upper, 0).x)) {
      fail("invalid_statistics_geometry", "", "Statistics transform must preserve every positive class width");
    }
  }

  if (supportedOperator === "cumulative_frequency") {
    if (inputs.direction !== "less_than" && inputs.direction !== "greater_than") {
      fail("invalid_statistics_direction", "direction", "cumulative_frequency direction must be less_than or greater_than");
    }
    const cumulative = new Array<number>(bins.length + 1).fill(0);
    if (inputs.direction === "less_than") {
      for (let index = 0; index < bins.length; index += 1) {
        cumulative[index + 1] = addFrequency(cumulative[index]!, bins[index]!.frequency);
      }
    } else {
      // Suffix sums avoid subtraction residuals at the final zero boundary.
      for (let index = bins.length - 1; index >= 0; index -= 1) {
        cumulative[index] = addFrequency(cumulative[index + 1]!, bins[index]!.frequency);
      }
    }
    const boundaries = [bins[0]!.lower, ...bins.map((bin) => bin.upper)];
    const points = boundaries.map((boundary, index) => point(boundary, cumulative[index]!));
    for (let index = 0; index < bins.length; index += 1) {
      if (bins[index]!.frequency > 0 && points[index]!.y === points[index + 1]!.y) {
        fail("invalid_statistics_geometry", "", "Statistics transform must preserve every positive cumulative increment");
      }
    }
    return [{ kind: "path", points }];
  }

  if (inputs.heightMode !== "frequency" && inputs.heightMode !== "density") {
    fail("invalid_statistics_height_mode", "heightMode", `${operator} heightMode must be frequency or density`);
  }
  const heightMode: HeightMode = inputs.heightMode;
  if (supportedOperator === "histogram" && heightMode === "frequency" &&
    bins.some((bin) => !equalWidths(bin.width, bins[0]!.width))) {
    fail("invalid_statistics_height_mode", "heightMode", "Unequal-width histogram classes require density heights so bar area represents frequency");
  }
  const heights = bins.map((bin) => {
    const height = heightMode === "density" ? bin.frequency / bin.width : bin.frequency;
    if (!Number.isFinite(height) || (bin.frequency > 0 && !(point(bin.lower, height).y > origin.y))) {
      fail("invalid_statistics_geometry", "", "Statistics heights must remain finite and preserve positive frequencies");
    }
    return height;
  });
  if (supportedOperator === "frequency_polygon") {
    return [{ kind: "path", points: bins.map((bin, index) => point(bin.lower + bin.width / 2, heights[index]!)) }];
  }
  return [{
    kind: "multi_path",
    paths: bins.map((bin, index) => {
      const lower = point(bin.lower, 0);
      const upper = point(bin.upper, 0);
      if (bin.frequency === 0) return [lower, upper];
      // multi_path has no closed flag. The repeated endpoint preserves each
      // rectangle's complete boundary through compilation and live rendering.
      return [lower, upper, point(bin.upper, heights[index]!), point(bin.lower, heights[index]!), { ...lower }];
    }),
  }];
}

export function validateStatisticsConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const output = outputs[0];
  const outputKind = document.entities.find((entity) => entity.id === output)?.kind;
  if (outputs.length !== 1 || outputKind !== "polyline") {
    issues.push({
      code: "invalid_statistics_output", message: `${construction.operator} must produce exactly one polyline entity`,
      severity: "fatal", path: `constructions[${index}].outputs`, entityIds: output ? [output] : undefined,
    });
  }
  try {
    evaluateStatisticsConstruction(construction.operator, construction.inputs, {
      number: (value) => validationNumber(value, document),
      point: (value) => validationPoint(value, document, constructionByOutput),
    });
  } catch (error) {
    issues.push({
      code: error instanceof StatisticsInputError ? error.code : "invalid_statistics_input",
      message: error instanceof Error ? error.message : String(error), severity: "fatal",
      path: `constructions[${index}].inputs${error instanceof StatisticsInputError && error.inputPath ? `.${error.inputPath}` : ""}`,
      entityIds: outputs,
    });
  }
}

function resolveBins(value: unknown, operator: StatisticsOperator, context: StatisticsContext): Bin[] {
  const minimum = operator === "frequency_polygon" ? 2 : 1;
  if (!Array.isArray(value) || value.length < minimum || value.length > MAX_BINS) {
    fail("invalid_statistics_bins", "bins", `${operator} requires ${minimum} to ${MAX_BINS} explicitly supplied class bins`);
  }
  const bins = value.map((entry, index): Bin => {
    const path = `bins[${index}]`;
    if (!isRecord(entry) || Object.keys(entry).some((key) => !["lower", "upper", "frequency"].includes(key))) {
      fail("invalid_statistics_bins", path, "Each class bin must contain only lower, upper, and frequency");
    }
    const lower = number(entry.lower, context, "invalid_statistics_bins", `${path}.lower`);
    const upper = number(entry.upper, context, "invalid_statistics_bins", `${path}.upper`);
    const frequency = number(entry.frequency, context, "invalid_statistics_bins", `${path}.frequency`);
    const width = upper - lower;
    if (!(width > 0) || !Number.isFinite(width) || frequency < 0) {
      fail("invalid_statistics_bins", path, "Class bins require finite lower < upper and nonnegative finite frequencies");
    }
    return { lower, upper, frequency, width };
  });
  for (let index = 1; index < bins.length; index += 1) {
    if (bins[index]!.lower !== bins[index - 1]!.upper) {
      fail("invalid_statistics_bins", `bins[${index}].lower`, "Class bins must be ordered and contiguous; supply missing intervals with explicit zero frequencies");
    }
  }
  return bins;
}

function nonzeroLiteralUnderflows(value: unknown, resolved: number): boolean {
  if (typeof value !== "string" || resolved !== 0) return false;
  const literal = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:e[+-]?\d+)?$/i.exec(value.trim());
  return literal !== null && /[1-9]/.test(literal[1]!);
}
function number(value: unknown, context: StatisticsContext, code: string, path: string, depth = 0): number {
  if (depth > 64) fail(code, path, "Statistics numeric value nesting exceeds the supported depth");
  if (isRecord(value) && "value" in value) return number(value.value, context, code, path, depth + 1);
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && value.trim() === "")) {
    fail(code, path, "Statistics values must be finite numbers, numeric strings, quantity references, or value wrappers");
  }
  let resolved: number;
  try { resolved = context.number(value); }
  catch { fail(code, path, `Statistics value ${String(value)} is not a finite numeric value or resolvable quantity`); }
  if (!Number.isFinite(resolved)) fail(code, path, "Statistics values must resolve to finite numbers");
  if (nonzeroLiteralUnderflows(value, resolved)) fail(code, path, "Nonzero statistics numeric literals cannot underflow to zero");
  return resolved;
}

function validationNumber(value: unknown, document: SceneDocument, seen = new Set<string>(), depth = 0): number {
  if (depth > 64) throw new Error("Statistics quantity nesting exceeds the supported depth");
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isRecord(value) && "value" in value) return validationNumber(value.value, document, seen, depth + 1);
  if (typeof value === "string" && value.trim() !== "") {
    if (seen.has(value)) throw new Error("Cyclic statistics quantity reference");
    const quantity = document.quantities.find((entry) => entry.id === value);
    if (quantity) {
      seen.add(value);
      return validationNumber(quantity.value, document, seen, depth + 1);
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      if (nonzeroLiteralUnderflows(value, parsed)) throw new Error("Nonzero statistics quantity literals cannot underflow to zero");
      return parsed;
    }
  }
  throw new Error("Unresolved statistics numeric value");
}

function validationPoint(value: unknown, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>): RenderPoint {
  if (typeof value === "string") {
    const producer = constructionByOutput.get(value);
    if (!producer || document.entities.find((entity) => entity.id === value)?.kind !== "point") {
      throw new Error("Statistics origin must reference a constructed point");
    }
    if (producer.operator === "point") return {
      x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document),
    };
    // Derived point coordinates are checked again by the compiler's resolver.
    return { x: 0, y: 0 };
  }
  if (Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return { x: value[0] as number, y: value[1] as number };
  }
  if (isRecord(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y)) {
    return { x: value.x, y: value.y };
  }
  throw new Error("Statistics origin is not a finite point");
}

function addFrequency(total: number, frequency: number): number {
  const result = total + frequency;
  if (!Number.isFinite(result) || (frequency > 0 && !(result > total))) {
    fail("invalid_statistics_geometry", "bins", "Cumulative sums must remain finite and retain every positive frequency");
  }
  return result;
}

function equalWidths(first: number, second: number): boolean {
  return Math.abs(first - second) <= Number.EPSILON * 16 * Math.max(first, second);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(code: string, path: string, message: string): never { throw new StatisticsInputError(code, path, message); }
