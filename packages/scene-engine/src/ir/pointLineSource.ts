import { evaluateAnalyticLineConstruction, type AnalyticLineEvaluationContext } from "../compile/analyticLineGeometry";
import type { SceneDocument, SceneIssue } from "../types";

/**
 * Source lineage for `point_line_distance`.
 *
 * A matching scalar distance does not prove the figure drew the source line
 * and the source point: two different lines can sit at the same distance from
 * a point. This guard binds the operator's (a, b, c) and point to the complete
 * question by value, and binds the drawn line entity to the same coefficients.
 *
 * Source literals are read as mathematical notation only: coordinate pairs
 * `(x0, y0)` with an optional point name, the word "origin", and linear
 * equations in x and y. Nothing here selects a topic or a drawing. A line the
 * source states in any other way (through two points, by slope in words, as
 * an intersection) is not bindable and the scene declines.
 */

type Point = { x: number; y: number };
type Line = { a: number; b: number; c: number };
/** `origin` marks the synthetic O for the word "origin": a figure may label it O or any free name. */
type SourcePoint = Point & { name?: string; origin?: true };

export interface PointLineSourceLiterals {
  lines: Line[];
  points: SourcePoint[];
  /** An equation-like run touched letters or symbols the linear reader does not model. */
  unreadEquation: boolean;
}

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d*)?|\.\d+))?`;
const POINT_PAIR = new RegExp(String.raw`(?:\b([A-Z][A-Za-z]?\d?'?)\s*(?:=\s*)?)?\(\s*(${NUMBER})\s*,\s*(${NUMBER})\s*\)`, "g");
const ORIGIN = /\borigin\b/i;
const RUN_CHARS = /[0-9xy.+\-*/=() ]/;
const BAD_NEIGHBOUR = /[A-Za-z0-9^_\\{}[\]|'′²³√§¤]/;
const RELATIVE = 1e-9;

export function readPointLineSourceLiterals(question: unknown): PointLineSourceLiterals | null {
  if (typeof question !== "string" || question.length > 4096) return null;
  const text = question
    .replace(/[−–—]/g, "-")
    .replace(/[·×]/g, "*")
    .replace(/\s+/g, " ");
  const points: SourcePoint[] = [];
  for (const match of text.matchAll(POINT_PAIR)) {
    const x = readNumberText(match[2]!);
    const y = readNumberText(match[3]!);
    if (x === null || y === null) continue;
    points.push(match[1] ? { name: match[1], x, y } : { x, y });
  }
  if (ORIGIN.test(text)) points.push({ name: "O", x: 0, y: 0, origin: true });

  // Words (§) and single letters other than x and y (¤) are masked, so
  // "by 2x+3y=6" reads the equation and "f(x)=2x" or "kx+y=3" is refused,
  // never truncated.
  const masked = text
    .replace(/[A-Za-z]{2,}/g, (word) => "§".repeat(word.length))
    .replace(/[A-Za-z]/g, (letter) => (letter === "x" || letter === "y" ? letter : "¤"));
  const lines: Line[] = [];
  let unreadEquation = false;
  let index = 0;
  while (index < masked.length) {
    if (!RUN_CHARS.test(masked[index]!)) { index += 1; continue; }
    let end = index;
    while (end < masked.length && RUN_CHARS.test(masked[end]!)) end += 1;
    const raw = masked.slice(index, end);
    const start = index + (raw.length - raw.trimStart().length);
    // A sentence full stop after an equation is punctuation, not a decimal.
    const run = raw.trim().replace(/[.\s]+$/, "");
    const before = masked[start - 1];
    const after = masked[start + run.length];
    index = end;
    if (!run.includes("=")) continue;
    if (!/[xy]/.test(run)) continue;
    // Across a space, a lone letter ("k x+y=3") or a run that opens with an
    // operator ("kx + y = 3") still belongs to the expression before it.
    const previous = masked.slice(0, start).trimEnd().at(-1);
    const next = masked.slice(start + run.length).trimStart()[0];
    const touched = (before !== undefined && BAD_NEIGHBOUR.test(before)) ||
      (after !== undefined && BAD_NEIGHBOUR.test(after)) ||
      previous === "¤" || next === "¤" ||
      (/^[+\-*/=]/.test(run) && previous !== undefined && BAD_NEIGHBOUR.test(previous));
    const line = touched ? null : parseLinearEquation(run);
    if (line) lines.push(line);
    else unreadEquation = true;
  }
  return { lines, points, unreadEquation };
}

export function validatePointLineSourceInputs(document: SceneDocument, question: unknown): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const distances = document.constructions.flatMap((construction, index) =>
    construction.operator === "point_line_distance" ? [{ construction, index }] : [],
  );
  if (distances.length === 0) return [];
  const source = readPointLineSourceLiterals(question);
  const issues: SceneIssue[] = [];
  if (!source || source.lines.length === 0) {
    return [{
      code: "point_line_source_unsupported",
      severity: "fatal",
      path: "source.question",
      message: "point_line_distance requires the source to state its line as a linear equation in x and y; a line given only through points, words or an intersection is not bound here",
    }];
  }
  // Roles are bound by value only when they are unique: with two stated
  // points, two different lines, or an equation the reader cannot model, the
  // figure could measure the wrong pair at a plausible distance. Decline.
  const distinctPoints = source.points.filter((candidate, index) => source.points.findIndex((other) => samePoint(other, candidate)) === index);
  const distinctLines = source.lines.filter((candidate, index) => source.lines.findIndex((other) => proportional(other, candidate)) === index);
  if (distinctPoints.length > 1 || distinctLines.length > 1 || source.unreadEquation) {
    return [{
      code: "point_line_source_ambiguous",
      severity: "fatal",
      path: "source.question",
      actual: { points: distinctPoints.length, lines: distinctLines.length, unreadEquation: source.unreadEquation },
      message: "point_line_distance declines a source that states several points, several lines or an unread equation: which pair is measured cannot be bound by value",
    }];
  }
  const context = documentContext(document);
  const drawnLines = drawnLineCoefficients(document, context);
  for (const { construction, index } of distances) {
    const path = `constructions[${index}].inputs`;
    let line: Line;
    let point: Point;
    try {
      line = {
        a: context.number(construction.inputs.a),
        b: context.number(construction.inputs.b),
        c: context.number(construction.inputs.c),
      };
      point = resolvePointInput(construction.inputs.point, context);
    } catch {
      issues.push({
        code: "point_line_source_input_unsupported",
        severity: "fatal",
        path,
        message: "point_line_distance inputs must be finite unitless coefficients and a literal or directly constructed world point",
      });
      continue;
    }
    if (!(Math.hypot(line.a, line.b) > 0)) continue; // the compiler rejects a=b=0 with its own issue
    if (!source.lines.some((candidate) => proportional(candidate, line))) {
      issues.push({
        code: "point_line_source_line_mismatch",
        severity: "fatal",
        path,
        expected: source.lines,
        actual: line,
        message: "point_line_distance coefficients are not a multiple of any line equation stated in the source; a matching distance does not bind the line",
      });
    }
    if (!drawnLines.some((candidate) => proportional(candidate, line))) {
      issues.push({
        code: "point_line_drawn_line_mismatch",
        severity: "fatal",
        path,
        message: "point_line_distance must measure to the same line the scene draws; no drawn line_equation or line_intercepts output has these coefficients",
      });
    }
    const named = pointName(construction.inputs.point, document);
    const identity = sourcePointIdentity(named, point, source.points);
    if (identity) {
      issues.push({
        code: "point_line_source_point_mismatch",
        severity: "fatal",
        path,
        expected: source.points,
        actual: named ? { name: named, ...point } : point,
        message: identity,
      });
    }
  }
  return issues;
}

/**
 * Identity by coordinates always, and by name whenever the figure names the
 * point: a source name must keep its own coordinates, and a name the source
 * does not use may only label an unnamed stated pair (or the origin), never
 * rename a point the source already names.
 */
function sourcePointIdentity(named: string | undefined, point: Point, points: readonly SourcePoint[]): string | null {
  const same = points.filter((candidate) => samePoint(candidate, point));
  if (same.length === 0) return "point_line_distance point is not a coordinate pair stated in the source";
  if (!named) return null;
  const sourceNamed = points.filter((candidate) => candidate.name === named);
  if (sourceNamed.length > 0) {
    return sourceNamed.some((candidate) => samePoint(candidate, point))
      ? null
      : `point_line_distance point ${named} does not have the coordinates the source gives ${named}`;
  }
  if (same.some((candidate) => candidate.name === undefined || candidate.origin)) return null;
  return `point_line_distance labels the source point ${same.map((candidate) => candidate.name).join(" or ")} as ${named}, a name the source does not use`;
}

function documentContext(document: SceneDocument): AnalyticLineEvaluationContext {
  const quantities = new Map<string, number | null>();
  for (const quantity of document.quantities) {
    const unitless = quantity.unit === undefined || quantity.unit === "" || quantity.unit === "1";
    quantities.set(quantity.id, unitless && typeof quantity.value === "number" && Number.isFinite(quantity.value) ? quantity.value : null);
  }
  const number = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const quantity = quantities.get(value);
      if (typeof quantity === "number") return quantity;
      const literal = readNumberText(value);
      if (literal !== null) return literal;
    }
    throw new Error("unbound number");
  };
  const geometry = (value: unknown): unknown => {
    if (typeof value !== "string") throw new Error("unbound geometry");
    const producers = document.constructions.filter((construction) => construction.outputs.includes(value));
    if (producers.length !== 1 || producers[0]!.operator !== "point") throw new Error("unbound point");
    const inputs = producers[0]!.inputs;
    if (inputs.coordinateSpace !== undefined && inputs.coordinateSpace !== "world") throw new Error("non-world point");
    return { kind: "point", point: { x: number(inputs.x), y: number(inputs.y) } };
  };
  return {
    number,
    geometry,
    point: (value: unknown) => {
      const resolved = geometry(value) as { point: Point };
      return resolved.point;
    },
  };
}

function resolvePointInput(value: unknown, context: AnalyticLineEvaluationContext): Point {
  if (typeof value === "string") return context.point(value);
  if (Array.isArray(value) && value.length === 2) return { x: context.number(value[0]), y: context.number(value[1]) };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).every((key) => key === "x" || key === "y")) return { x: context.number(record.x), y: context.number(record.y) };
  }
  throw new Error("unbound point");
}

function drawnLineCoefficients(document: SceneDocument, context: AnalyticLineEvaluationContext): Line[] {
  const lines: Line[] = [];
  for (const construction of document.constructions) {
    if (construction.operator !== "line_equation" && construction.operator !== "line_intercepts") continue;
    try {
      for (const geometry of evaluateAnalyticLineConstruction(construction.operator, construction.inputs, context)) {
        const coefficients = geometry.kind === "path" && geometry.infinite ? geometry.analyticLine.coefficients : undefined;
        if (coefficients) lines.push(coefficients);
      }
    } catch {
      // An unevaluable producer draws nothing this guard can bind.
    }
  }
  return lines;
}

function pointName(input: unknown, document: SceneDocument): string | undefined {
  if (typeof input !== "string") return undefined;
  const entity = document.entities.find((candidate) => candidate.id === input);
  const label = typeof entity?.label === "string" ? entity.label.trim() : "";
  if (/^[A-Z][A-Za-z]?\d?'?$/.test(label)) return label;
  return /^[A-Z][A-Za-z]?\d?'?$/.test(input) ? input : undefined;
}

function proportional(first: Line, second: Line): boolean {
  const scale = Math.max(1, Math.hypot(first.a, first.b, first.c) * Math.hypot(second.a, second.b, second.c));
  return Math.abs(first.a * second.b - first.b * second.a) <= RELATIVE * scale &&
    Math.abs(first.a * second.c - first.c * second.a) <= RELATIVE * scale &&
    Math.abs(first.b * second.c - first.c * second.b) <= RELATIVE * scale;
}

function samePoint(first: Point, second: Point): boolean {
  const scale = Math.max(1, Math.hypot(first.x, first.y));
  return Math.abs(first.x - second.x) <= RELATIVE * scale && Math.abs(first.y - second.y) <= RELATIVE * scale;
}

function readNumberText(text: string): number | null {
  const trimmed = text.replace(/\s+/g, "");
  if (!new RegExp(`^${NUMBER}$`).test(trimmed)) return null;
  const [numerator, denominator] = trimmed.split("/");
  const value = denominator === undefined ? Number(numerator) : Number(numerator) / Number(denominator);
  return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null;
}

/** Linear polynomial c0 + cx·x + cy·y. */
type Linear = { x: number; y: number; k: number };

/**
 * Recursive-descent reader for one linear equation in x and y with numbers,
 * + - * /, parentheses and implicit products ("3x", "2(x-1)"). Any product of
 * two non-constant factors, division by a non-constant, or a=b=0 is refused.
 */
export function parseLinearEquation(text: string): Line | null {
  const sides = text.split("=");
  if (sides.length !== 2) return null;
  const left = parseLinearExpression(sides[0]!);
  const right = parseLinearExpression(sides[1]!);
  if (!left || !right) return null;
  const line = { a: left.x - right.x, b: left.y - right.y, c: left.k - right.k };
  if (!(Math.hypot(line.a, line.b) > 0) || ![line.a, line.b, line.c].every(Number.isFinite)) return null;
  return line;
}

function parseLinearExpression(text: string): Linear | null {
  const matched = text.replace(/\s+/g, "").match(/\d+(?:\.\d*)?|\.\d+|[xy+\-*/()]/g);
  if (!matched || matched.join("") !== text.replace(/\s+/g, "")) return null;
  const tokens: string[] = matched;
  let position = 0;
  const peek = () => tokens[position];
  const constant = (value: Linear) => value.x === 0 && value.y === 0;
  const scale = (value: Linear, factor: number): Linear => ({ x: value.x * factor, y: value.y * factor, k: value.k * factor });
  const multiply = (first: Linear, second: Linear): Linear | null => {
    if (constant(first)) return scale(second, first.k);
    if (constant(second)) return scale(first, second.k);
    return null;
  };
  function expression(): Linear | null {
    let value = term();
    while (value && (peek() === "+" || peek() === "-")) {
      const sign = tokens[position++] === "+" ? 1 : -1;
      const next = term();
      if (!next) return null;
      value = { x: value.x + sign * next.x, y: value.y + sign * next.y, k: value.k + sign * next.k };
    }
    return value;
  }
  function term(): Linear | null {
    let value = unary();
    while (value) {
      const token = peek();
      if (token === "*" || token === "/") {
        position += 1;
        const next = unary();
        if (!next) return null;
        if (token === "*") value = multiply(value, next);
        else {
          if (!constant(next) || next.k === 0) return null;
          value = scale(value, 1 / next.k);
        }
      } else if (token === "x" || token === "y" || token === "(" || (token !== undefined && /^[\d.]/.test(token))) {
        // Implicit product: "3x", "2(x-1)", "(x+1)2" is refused by the digit-after-paren check below.
        if (/^[\d.]/.test(token) && !constant(value)) return null;
        const next = unary();
        if (!next) return null;
        value = multiply(value, next);
      } else break;
    }
    return value;
  }
  function unary(): Linear | null {
    if (peek() === "-") { position += 1; const value = unary(); return value ? scale(value, -1) : null; }
    if (peek() === "+") { position += 1; return unary(); }
    return primary();
  }
  function primary(): Linear | null {
    const token = tokens[position++];
    if (token === undefined) return null;
    if (token === "x") return { x: 1, y: 0, k: 0 };
    if (token === "y") return { x: 0, y: 1, k: 0 };
    if (token === "(") {
      const value = expression();
      if (tokens[position++] !== ")") return null;
      return value;
    }
    if (/^[\d.]/.test(token)) {
      const value = Number(token);
      return Number.isFinite(value) ? { x: 0, y: 0, k: value } : null;
    }
    return null;
  }
  const value = expression();
  return value && position === tokens.length ? value : null;
}
