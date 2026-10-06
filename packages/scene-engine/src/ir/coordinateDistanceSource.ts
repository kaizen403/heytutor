import type { SceneDocument, SceneIssue } from "../types";

type Point = { x: number; y: number };

const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?";
const NAME = "[a-z][a-z0-9]{0,7}";
const PAIR_QUESTION = new RegExp(
  `^In (?:the )?Cartesian coordinates,\\s*(${NAME})\\s*=\\s*\\(\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\)\\s*[,;]\\s*(${NAME})\\s*=\\s*\\(\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\)\\s*\\.\\s*(?:Show|Find|Calculate|Compute) (?:the )?distance (?:([a-z])([a-z])|between (${NAME}) and (${NAME}))[.?]?$`,
  "i",
);
const SCALAR = new RegExp(`^${NUMBER}$`, "i");

export function validateCoordinateDistanceSourceInputs(
  document: SceneDocument,
  question: unknown,
): SceneIssue[] {
  const distances = document.constructions.flatMap((construction, index) =>
    construction.operator === "coordinate_distance" ? [{ construction, index }] : [],
  );
  if (distances.length === 0 || document.visualDecision.mode !== "scene") return [];
  const source = parseSourcePair(question);
  if (!source) {
    return [{
      code: "coordinate_source_unsupported",
      severity: "fatal",
      path: "source.question",
      message: "coordinate_distance requires a complete supported affirmative Cartesian two-point source; surrounding discourse, other clauses, units and models are unsupported",
    }];
  }
  const quantities = new Map<string, number | null>();
  const quantityIds = new Set<string>();
  for (const quantity of document.quantities) {
    const id = plainDataRecord(quantity) ? own(quantity, "id") : undefined;
    if (typeof id !== "string" || quantityIds.has(id)) {
      return [{ code: "coordinate_source_input_unsupported", severity: "fatal", path: "quantities", message: "Source coordinate quantities require plain data records with unique own ids" }];
    }
    quantityIds.add(id);
    const value = own(quantity, "value");
    const unit = own(quantity, "unit");
    if (!bounded(value) || unit !== undefined && unit !== "" && unit !== "1") {
      quantities.set(id, null);
      continue;
    }
    quantities.set(id, value);
  }
  const issues: SceneIssue[] = [];
  const points = [...source.values()];
  for (const { construction, index } of distances) {
    const a = resolvePoint(own(construction.inputs, "a"), document, quantities, source);
    const b = resolvePoint(own(construction.inputs, "b"), document, quantities, source);
    if (!a || !b) {
      issues.push({
        code: "coordinate_source_input_unsupported",
        severity: "fatal",
        path: `constructions[${index}].inputs`,
        message: "Cartesian source inputs must resolve from finite unitless coordinates or directly named point/quantity data; unproved expressions, frames, units and point producers are unsupported",
      });
    } else if (!(same(a, points[0]!) && same(b, points[1]!) || same(a, points[1]!) && same(b, points[0]!))) {
      issues.push({
        code: "coordinate_source_mismatch",
        severity: "fatal",
        path: `constructions[${index}].inputs`,
        message: "coordinate_distance endpoint coordinates disagree with the complete source; matching a scalar value or distance is not sufficient",
      });
    }
  }
  return issues;
}

function parseSourcePair(question: unknown): Map<string, Point> | null {
  if (typeof question !== "string" || question.length > 2048) return null;
  const match = PAIR_QUESTION.exec(question.trim().replace(/\s+/g, " "));
  if (!match || match[1] === match[4]) return null;
  const coordinates = [match[2], match[3], match[5], match[6]].map(Number);
  if (!coordinates.every(bounded)) return null;
  const requested = [match[7] ?? match[9], match[8] ?? match[10]];
  if (requested[0] === requested[1] || !requested.every((id) => id === match[1] || id === match[4])) return null;
  return new Map([
    [match[1]!, { x: coordinates[0]!, y: coordinates[1]! }],
    [match[4]!, { x: coordinates[2]!, y: coordinates[3]! }],
  ]);
}

function resolvePoint(
  input: unknown,
  document: SceneDocument,
  quantities: Map<string, number | null>,
  source: Map<string, Point>,
): Point | null {
  if (typeof input === "string") {
    const expected = source.get(input);
    const producers = document.constructions.filter((construction) => construction.outputs.includes(input));
    if (!expected || producers.length !== 1 || producers[0]!.operator !== "point") return null;
    const inputs = producers[0]!.inputs;
    const frame = own(inputs, "coordinateSpace");
    if (frame !== undefined && frame !== "world") return null;
    const point = resolvePoint(inputs, document, quantities, source);
    return point && same(point, expected) ? point : null;
  }
  let x: unknown;
  let y: unknown;
  if (Array.isArray(input)) {
    if (Object.getPrototypeOf(input) !== Array.prototype || input.length !== 2 || Reflect.ownKeys(input).length !== 3) return null;
    x = own(input, "0");
    y = own(input, "1");
  } else if (plainDataRecord(input)) {
    if (Object.keys(input).some((key) => !["x", "y", "coordinateSpace"].includes(key))) return null;
    const frame = own(input, "coordinateSpace");
    if (frame !== undefined && frame !== "world") return null;
    x = own(input, "x");
    y = own(input, "y");
  } else return null;
  const nx = resolveNumber(x, quantities);
  const ny = resolveNumber(y, quantities);
  return nx !== null && ny !== null ? { x: nx, y: ny } : null;
}

function resolveNumber(input: unknown, quantities: Map<string, number | null>): number | null {
  if (bounded(input)) return input;
  if (typeof input === "string") {
    if (quantities.has(input)) return quantities.get(input) ?? null;
    if (SCALAR.test(input) && bounded(Number(input))) return Number(input);
  }
  if (plainDataRecord(input) && Object.keys(input).length === 1 && Object.hasOwn(input, "value")) {
    const value = own(input, "value");
    if (bounded(value)) return value;
    if (typeof value === "string" && quantities.has(value)) return quantities.get(value) ?? null;
  }
  return null;
}

function bounded(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12 && (value === 0 || Math.abs(value) >= 1e-12);
}

function same(first: Point, second: Point): boolean {
  return first.x === second.x && first.y === second.y;
}

function own(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function plainDataRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every((key) =>
    typeof key === "string" && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"),
  );
}
