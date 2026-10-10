import type { Vec3 } from "../math/space";
import type { SceneDocument, SceneIssue } from "../types";

/**
 * Source binding for drawn planes.
 *
 * A `plane` construction carries its own coefficients, so nothing about a
 * correct label or a correct answer proves the figure drew the stated plane:
 * `{a:-2, b:1, c:4}` (that is -2x + y + 4z = 0) can sit under the label
 * `2x−y+z=4`. This guard binds a drawn plane to a stated equation by value.
 *
 * Equations are read as notation only: linear equations in x, y and z with
 * numbers, + - * /, brackets and implicit products, and the vector form
 * `r·(ai + bj + ck) = d`. Anything else (a sphere, a family `x + λy = 1`, a
 * symmetric line `(x-1)/2 = y/3 = z`, a parametric `x = 1 + 2t`) is never read
 * as a plane.
 *
 * A plane is bound only where its identity is explicit, so a figure that adds
 * a plane of its own is never failed for not being a stated one:
 *
 * (a) its entity label, or an annotation that targets it and no other plane,
 *     states one plane equation: the plane must be that equation;
 * (c) its label is a name the question gives an equation (`π₁: x + y + z = 1`):
 *     the plane must be that named equation;
 * (b) otherwise, only when the question states exactly one plane equation,
 *     reads every equation-like run it holds, never speaks of a plane it does
 *     not state (`the plane through P`, `the xy-plane`), and the scene draws
 *     exactly one plane: that plane must be the stated one.
 *
 * An unlabelled plane in any other scene (a derived plane, a helper plane, a
 * symbolic representative) is not checked here. A cartesian plane matches when
 * (a, b, c, d) is one nonzero multiple of the equation; a point,u,v plane when
 * u×v is parallel to the equation's normal and its point satisfies it.
 */

/** ax + by + cz = d, the convention of the `plane` operator. */
export interface PlaneEquation { a: number; b: number; c: number; d: number }
export interface StatedPlaneEquation extends PlaneEquation {
  /** Offsets in the normalized text the reader returns. */
  start: number;
  end: number;
  /** A name written as `π₁:` or `P ≡` right before the equation. */
  name?: string;
}
export interface PlaneEquationReading {
  text: string;
  equations: StatedPlaneEquation[];
  /** An equation-like run touched letters or symbols the linear reader does not model. */
  unreadEquation: boolean;
}
export interface PlaneSourceStatement extends PlaneEquationReading {
  distinct: PlaneEquation[];
  names: ReadonlyMap<string, PlaneEquation>;
  /** The question speaks of a plane that no stated equation fixes. */
  unanchoredPlaneMention: boolean;
}
export interface PlaneSourceContext {
  number(value: unknown): number;
  /** The compiled world plane of an output, for the point,u,v form. */
  plane(id: string): { point: Vec3; normal: Vec3 } | undefined;
}

const RUN_CHARS = /[0-9xyz.+\-*/=() ]/;
const BAD_NEIGHBOUR = /[A-Za-z0-9^_\\{}[\]|'′√§¤²³¹⁰-₟Ͱ-Ͽ]/u;
/** A lone letter across a space still belongs to the expression: `k x + y = 3`, `λ y`. */
const LONE_LETTER = /[¤Ͱ-Ͽ]/u;
const NAME = String.raw`[A-Za-zͰ-Ͽ][A-Za-z0-9₀-₉_']{0,3}`;
const NAME_BEFORE = new RegExp(String.raw`(?:^|[^A-Za-z0-9_Ͱ-Ͽ])(${NAME})\s*[:≡]\s*$`, "u");
const NAME_IN_LABEL = new RegExp(String.raw`^\s*(${NAME})\s*(?:[:≡].*)?$`, "u");
const PLANE_WORD = /\bplanes?\b/gi;
const ANCHOR_GAP = new RegExp(
  String.raw`^\s*(?:(?:given\s+by|defined\s+by|represented\s+by|whose\s+equation\s+is|(?:with|having|of)\s+(?:the\s+)?equation|is|:|≡)\s*)?(?:${NAME}\s*[:≡]\s*)?$`,
  "iu",
);
const NUMBER = String.raw`(?:\d+(?:\.\d*)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d*)?|\.\d+))?`;
const VECTOR_FORM = new RegExp(String.raw`(?<![A-Za-z])r\s*[*.]\s*\(([^()=]*)\)\s*=\s*([+-]?\s*${NUMBER})`, "g");
const RELATIVE = 1e-9;
const MAX_TEXT = 4096;

function normalizeNotation(text: string): string {
  return text
    .replace(/[−‒–—﹣－]/g, "-")
    .replace(/[·⋅∙×]/g, "*")
    .replace(/\u{1D465}/gu, "x").replace(/\u{1D466}/gu, "y").replace(/\u{1D467}/gu, "z")
    .replace(/î/g, "i").replace(/ĵ/g, "j")
    .replace(/\\vec\s*\{?\s*r\s*\}?/g, "r")
    .replace(/r\s*→/g, "r")
    .replace(/[̂⃗⃑]/g, "")
    .replace(/\s+/g, " ");
}

/** Every plane equation a text states, in reading order. */
export function readPlaneEquations(input: string): PlaneEquationReading | null {
  if (typeof input !== "string" || input.length > MAX_TEXT) return null;
  const text = normalizeNotation(input);
  const equations: StatedPlaneEquation[] = [];
  let unreadEquation = false;
  let scan = text;
  for (const match of text.matchAll(VECTOR_FORM)) {
    const start = match.index!;
    const end = start + match[0].length;
    scan = scan.slice(0, start) + ";".repeat(end - start) + scan.slice(end);
    const inner = match[1]!;
    const normal = /^[0-9ijk.+\-*/ ]+$/.test(inner) ? parseLinearExpression(inner.replace(/i/g, "x").replace(/j/g, "y").replace(/k/g, "z")) : null;
    const d = readNumberText(match[2]!);
    if (!normal || normal.k !== 0 || d === null || !(Math.hypot(normal.x, normal.y, normal.z) > 0)) { unreadEquation = true; continue; }
    equations.push(withName(text, { a: normal.x, b: normal.y, c: normal.z, d, start, end }));
  }

  // Words (§) and single letters other than x, y and z (¤) are masked, so
  // "plane 2x - y + z = 4" reads the equation while "kx + y = 3" and
  // "f(x) = 2x" are refused, never truncated.
  const masked = scan
    .replace(/[A-Za-z]{2,}/g, (word) => "§".repeat(word.length))
    .replace(/[A-Za-z]/g, (letter) => (letter === "x" || letter === "y" || letter === "z" ? letter : "¤"));
  let index = 0;
  while (index < masked.length) {
    if (!RUN_CHARS.test(masked[index]!)) { index += 1; continue; }
    let end = index;
    while (end < masked.length && RUN_CHARS.test(masked[end]!)) end += 1;
    const raw = masked.slice(index, end);
    const start = index + (raw.length - raw.trimStart().length);
    // A sentence full stop after an equation is punctuation, not a decimal.
    const run = raw.trim().replace(/[.\s]+$/, "");
    index = end;
    if (!run.includes("=")) continue;
    // "x² + y² + z² = 9" leaves "= 9" after a power: an unread equation, never skipped.
    if (!/[xyz]/.test(run)) {
      if (/^=/.test(run) && /[\u00B2\u00B3\u00B9\u2070-\u209F^)]/u.test(masked.slice(0, start).trimEnd().at(-1) ?? "")) unreadEquation = true;
      continue;
    }
    // A chain `(x-1)/2 = y/3 = z` or `x = y = z` states a line, not a plane.
    if (run.split("=").length > 2) continue;
    const before = masked[start - 1];
    const after = masked[start + run.length];
    const previous = masked.slice(0, start).trimEnd().at(-1);
    const next = masked.slice(start + run.length).trimStart()[0];
    // A run that opens with an operator after a word continues that word
    // ("kx + y = 3"), except a minus glued to a number or bracket after a
    // space ("the plane -2x + y + 4z = 0").
    const unaryStart = /^-[\d.(]/.test(run) && before === " ";
    const touched = (before !== undefined && BAD_NEIGHBOUR.test(before)) ||
      (after !== undefined && BAD_NEIGHBOUR.test(after)) ||
      (previous !== undefined && LONE_LETTER.test(previous)) ||
      (next !== undefined && LONE_LETTER.test(next)) ||
      (/^[+\-*/=]/.test(run) && !unaryStart && previous !== undefined && BAD_NEIGHBOUR.test(previous));
    const equation = touched ? null : parsePlaneEquation(run);
    if (equation) equations.push(withName(text, { ...equation, start, end: start + run.length }));
    else unreadEquation = true;
  }
  equations.sort((first, second) => first.start - second.start);
  return { text, equations, unreadEquation };
}

/** The plane equations a question states, their names and whether it speaks of any other plane. */
export function readPlaneSourceStatement(question: unknown): PlaneSourceStatement | null {
  if (typeof question !== "string") return null;
  const reading = readPlaneEquations(question);
  if (!reading) return null;
  const distinct = distinctEquations(reading.equations);
  const named = new Map<string, PlaneEquation[]>();
  for (const equation of reading.equations) {
    if (equation.name) named.set(equation.name, [...(named.get(equation.name) ?? []), equation]);
  }
  // A name that two different equations claim names neither.
  const names = new Map([...named].flatMap(([name, equations]) => distinctEquations(equations).length === 1 ? [[name, equations[0]!] as const] : []));
  let unanchoredPlaneMention = false;
  for (const match of reading.text.matchAll(PLANE_WORD)) {
    const after = match.index! + match[0].length;
    const next = reading.equations.find((equation) => equation.start >= after);
    if (!next || !ANCHOR_GAP.test(reading.text.slice(after, next.start))) unanchoredPlaneMention = true;
  }
  return { ...reading, distinct, names, unanchoredPlaneMention };
}

interface PlaneClaim { equation: PlaneEquation; via: string }
type ResolvedPlane =
  | { form: "cartesian"; tuple: PlaneEquation }
  | { form: "point"; point: Vec3; normal: Vec3 };

/**
 * Run after the constructions so a point,u,v plane on a derived point is read
 * from its compiled world geometry; a plane whose construction failed already
 * carries its own fatal issue and is skipped here.
 */
export function validatePlaneSourceBinding(document: SceneDocument, context: PlaneSourceContext): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const planes = document.constructions.flatMap((construction, index) =>
    construction.operator === "plane" && construction.outputs.length === 1 ? [{ construction, index, id: construction.outputs[0]! }] : []);
  if (planes.length === 0) return [];
  const planeIds = new Set(planes.map((plane) => plane.id));
  const statement = readPlaneSourceStatement(document.source.question);
  const singleStated = statement && statement.distinct.length === 1 && !statement.unreadEquation &&
    !statement.unanchoredPlaneMention && planes.length === 1 ? statement.distinct[0]! : null;
  const issues: SceneIssue[] = [];
  for (const { construction, index, id } of planes) {
    const resolved = resolvePlane(construction.inputs, id, context);
    if (!resolved) continue;
    const entity = document.entities.find((candidate) => candidate.id === id);
    const texts: Array<{ text: string; via: string }> = [];
    if (typeof entity?.label === "string") texts.push({ text: entity.label, via: `label "${entity.label}"` });
    for (const annotation of document.annotations) {
      if (typeof annotation.text !== "string" || !annotation.targetIds.includes(id)) continue;
      if (annotation.targetIds.filter((target) => planeIds.has(target)).length !== 1) continue;
      texts.push({ text: annotation.text, via: `annotation ${annotation.id} "${annotation.text}"` });
    }
    const claims: PlaneClaim[] = [];
    for (const { text, via } of texts) {
      const stated = distinctEquations(readPlaneEquations(text)?.equations ?? []);
      // A text that states two different planes names neither.
      if (stated.length === 1) claims.push({ equation: stated[0]!, via });
      const name = NAME_IN_LABEL.exec(normalizeNotation(text))?.[1];
      const named = name ? statement?.names.get(normalizeName(name)) : undefined;
      if (named) claims.push({ equation: named, via: `${via}, the name the question gives ${formatEquation(named)}` });
    }
    if (claims.length === 0 && singleStated) claims.push({ equation: singleStated, via: "the one plane equation the question states" });
    for (const claim of claims) {
      if (planeMatches(resolved, claim.equation)) continue;
      issues.push({
        code: "plane_source_mismatch",
        severity: "fatal",
        path: `constructions[${index}].inputs`,
        entityIds: [id],
        expected: claim.equation,
        actual: resolved.form === "cartesian" ? resolved.tuple : { point: resolved.point, normal: resolved.normal },
        message: `${id} draws ${describePlane(resolved)} but ${claim.via} states ${formatEquation(claim.equation)}; a plane must be the equation it is bound to`,
      });
    }
  }
  return issues;
}

function resolvePlane(inputs: Record<string, unknown>, id: string, context: PlaneSourceContext): ResolvedPlane | null {
  try {
    if (inputs.a !== undefined && inputs.b !== undefined && inputs.c !== undefined) {
      const tuple = {
        a: context.number(inputs.a),
        b: context.number(inputs.b),
        c: context.number(inputs.c),
        d: inputs.d === undefined ? 0 : context.number(inputs.d),
      };
      return [tuple.a, tuple.b, tuple.c, tuple.d].every(Number.isFinite) && Math.hypot(tuple.a, tuple.b, tuple.c) > 0 ? { form: "cartesian", tuple } : null;
    }
  } catch {
    return null;
  }
  const compiled = context.plane(id);
  return compiled ? { form: "point", point: compiled.point, normal: compiled.normal } : null;
}

function planeMatches(plane: ResolvedPlane, equation: PlaneEquation): boolean {
  if (plane.form === "cartesian") return proportional(plane.tuple, equation);
  const normal = Math.hypot(equation.a, equation.b, equation.c);
  const length = Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z);
  if (!(normal > 0) || !(length > 0)) return false;
  const n = { x: equation.a / normal, y: equation.b / normal, z: equation.c / normal };
  const m = { x: plane.normal.x / length, y: plane.normal.y / length, z: plane.normal.z / length };
  const sine = Math.hypot(n.y * m.z - n.z * m.y, n.z * m.x - n.x * m.z, n.x * m.y - n.y * m.x);
  const offset = n.x * plane.point.x + n.y * plane.point.y + n.z * plane.point.z - equation.d / normal;
  const scale = Math.max(1, Math.hypot(plane.point.x, plane.point.y, plane.point.z), Math.abs(equation.d / normal));
  return sine <= RELATIVE * 10 && Math.abs(offset) <= RELATIVE * 10 * scale;
}

/** One nonzero scale: every 2x2 minor of the two 4-tuples vanishes. */
function proportional(first: PlaneEquation, second: PlaneEquation): boolean {
  const p = [first.a, first.b, first.c, first.d];
  const q = [second.a, second.b, second.c, second.d];
  const scale = Math.max(1, Math.hypot(...p) * Math.hypot(...q));
  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      if (Math.abs(p[i]! * q[j]! - p[j]! * q[i]!) > RELATIVE * scale) return false;
    }
  }
  return true;
}

function distinctEquations(equations: readonly PlaneEquation[]): PlaneEquation[] {
  return equations.filter((candidate, index) => equations.findIndex((other) => proportional(other, candidate)) === index)
    .map(({ a, b, c, d }) => ({ a, b, c, d }));
}

function withName<T extends PlaneEquation & { start: number; end: number }>(text: string, equation: T): T & { name?: string } {
  const name = NAME_BEFORE.exec(text.slice(0, equation.start))?.[1];
  return name ? { ...equation, name: normalizeName(name) } : equation;
}

function normalizeName(name: string): string {
  return name.replace(/[₀-₉]/g, (digit) => String(digit.charCodeAt(0) - 0x2080)).replace(/[_{}]/g, "");
}

function describePlane(plane: ResolvedPlane): string {
  if (plane.form === "cartesian") return formatEquation(plane.tuple);
  const { point, normal } = plane;
  return `the plane through (${[point.x, point.y, point.z].map(formatNumber).join(", ")}) with normal (${[normal.x, normal.y, normal.z].map(formatNumber).join(", ")})`;
}

function formatEquation({ a, b, c, d }: PlaneEquation): string {
  const terms = [[a, "x"], [b, "y"], [c, "z"]] as const;
  const left = terms.filter(([value]) => value !== 0).map(([value, variable], position) => {
    const sign = value < 0 ? (position === 0 ? "-" : " - ") : (position === 0 ? "" : " + ");
    const magnitude = Math.abs(value) === 1 ? "" : formatNumber(Math.abs(value));
    return `${sign}${magnitude}${variable}`;
  }).join("");
  return `${left} = ${formatNumber(d)}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
}

function readNumberText(text: string): number | null {
  const trimmed = text.replace(/\s+/g, "");
  if (!new RegExp(String.raw`^[+-]?${NUMBER}$`).test(trimmed)) return null;
  const sign = trimmed.startsWith("-") ? -1 : 1;
  const [numerator, denominator] = trimmed.replace(/^[+-]/, "").split("/");
  const value = sign * (denominator === undefined ? Number(numerator) : Number(numerator) / Number(denominator));
  return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null;
}

/** Linear polynomial k + x·X + y·Y + z·Z. */
type Linear = { x: number; y: number; z: number; k: number };

/**
 * One linear equation in x, y and z: numbers, + - * /, brackets and implicit
 * products ("3x", "2(x-1)"). A product of two non-constant factors, division
 * by a non-constant, or a zero normal is refused.
 */
export function parsePlaneEquation(text: string): PlaneEquation | null {
  const sides = normalizeNotation(text).split("=");
  if (sides.length !== 2) return null;
  const left = parseLinearExpression(sides[0]!);
  const right = parseLinearExpression(sides[1]!);
  if (!left || !right) return null;
  const equation = { a: left.x - right.x, b: left.y - right.y, c: left.z - right.z, d: right.k - left.k };
  if (!(Math.hypot(equation.a, equation.b, equation.c) > 0) || ![equation.a, equation.b, equation.c, equation.d].every(Number.isFinite)) return null;
  // -0 reads as 0, so a stated tuple prints and compares cleanly.
  return { a: equation.a + 0, b: equation.b + 0, c: equation.c + 0, d: equation.d + 0 };
}

function parseLinearExpression(text: string): Linear | null {
  const compact = text.replace(/\s+/g, "");
  const matched = compact.match(/\d+(?:\.\d*)?|\.\d+|[xyz+\-*/()]/g);
  if (!matched || matched.join("") !== compact) return null;
  const tokens: string[] = matched;
  let position = 0;
  const peek = () => tokens[position];
  const constant = (value: Linear) => value.x === 0 && value.y === 0 && value.z === 0;
  const scale = (value: Linear, factor: number): Linear => ({ x: value.x * factor, y: value.y * factor, z: value.z * factor, k: value.k * factor });
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
      value = { x: value.x + sign * next.x, y: value.y + sign * next.y, z: value.z + sign * next.z, k: value.k + sign * next.k };
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
      } else if (token === "x" || token === "y" || token === "z" || token === "(" || (token !== undefined && /^[\d.]/.test(token))) {
        // Implicit product "3x", "2(x-1)"; a number after a variable ("x2") is refused.
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
    if (token === "x") return { x: 1, y: 0, z: 0, k: 0 };
    if (token === "y") return { x: 0, y: 1, z: 0, k: 0 };
    if (token === "z") return { x: 0, y: 0, z: 1, k: 0 };
    if (token === "(") {
      const value = expression();
      if (tokens[position++] !== ")") return null;
      return value;
    }
    if (/^[\d.]/.test(token)) {
      const value = Number(token);
      return Number.isFinite(value) ? { x: 0, y: 0, z: 0, k: value } : null;
    }
    return null;
  }
  const value = expression();
  return value && position === tokens.length ? value : null;
}
