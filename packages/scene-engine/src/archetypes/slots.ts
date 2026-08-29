/**
 * Slot extraction — pulling the typed numbers and expressions a figure needs
 * out of the turn plan first and the question text second.
 *
 * Plan givens are the authority (they are validated copies of the stem);
 * stem numbers are used when the plan is absent or does not carry the slot.
 * Every value remembers where it came from so the tier rule can tell a
 * grounded figure from a display-scaled one.
 */
import type { SlotValue, Slots } from "./catalog";

export type SlotSource = "plan" | "stem" | "default";

export interface PlanQuantity {
  id: string;
  symbol: string;
  value: number;
  unit?: string;
  sourceText?: string;
}

export interface SlotBag {
  values: Slots;
  sources: Record<string, SlotSource>;
}

export function emptyBag(): SlotBag {
  return { values: {}, sources: {} };
}

export function setSlot(bag: SlotBag, key: string, value: SlotValue | null | undefined, source: SlotSource): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number" && !Number.isFinite(value)) return;
  if (Array.isArray(value) && value.length === 0) return;
  // Plan beats stem beats default; never downgrade a source.
  const rank: Record<SlotSource, number> = { plan: 3, stem: 2, default: 1 };
  const existing = bag.sources[key];
  if (existing && rank[existing] >= rank[source]) return;
  bag.values[key] = value;
  bag.sources[key] = source;
}

export function slotNumber(bag: SlotBag, key: string): number | null {
  const value = bag.values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function slotText(bag: SlotBag, key: string): string | null {
  const value = bag.values[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function slotNumbers(bag: SlotBag, key: string): number[] {
  const value = bag.values[key];
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

export function slotStrings(bag: SlotBag, key: string): string[] {
  const value = bag.values[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function isGrounded(bag: SlotBag, key: string): boolean {
  const source = bag.sources[key];
  return source === "plan" || source === "stem";
}

/* ------------------------------------------------------------------------- */
/* Plan quantities                                                            */
/* ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function collectPlanQuantities(turnPlan: unknown): PlanQuantity[] {
  if (!isRecord(turnPlan)) return [];
  const rows = [
    ...(Array.isArray(turnPlan.givens) ? turnPlan.givens : []),
    ...(Array.isArray(turnPlan.derived) ? turnPlan.derived : []),
  ];
  return rows.flatMap((row, index) => {
    if (!isRecord(row) || typeof row.value !== "number" || !Number.isFinite(row.value)) return [];
    const id = typeof row.id === "string" && row.id.trim() ? row.id : `q${index + 1}`;
    const symbol = typeof row.symbol === "string" && row.symbol.trim() ? row.symbol : id;
    return [{
      id,
      symbol,
      value: row.value,
      unit: typeof row.unit === "string" ? row.unit : undefined,
      sourceText: typeof row.sourceText === "string" ? row.sourceText : undefined,
    }];
  });
}

export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\(?:mathrm|text|operatorname)/g, "")
    .replace(/[_{}\\^\s-]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** First plan quantity whose id or symbol normalizes to one of the aliases. */
export function planQuantity(quantities: readonly PlanQuantity[], aliases: readonly string[]): PlanQuantity | null {
  const wanted = aliases.map(normalizeKey);
  return quantities.find((quantity) =>
    wanted.includes(normalizeKey(quantity.id)) || wanted.includes(normalizeKey(quantity.symbol))) ?? null;
}

export function planNumber(quantities: readonly PlanQuantity[], aliases: readonly string[]): number | null {
  return planQuantity(quantities, aliases)?.value ?? null;
}

/** All plan quantities whose unit or symbol looks like the given dimension. */
export function planNumbersByUnit(quantities: readonly PlanQuantity[], unitPattern: RegExp, symbolPattern?: RegExp): number[] {
  return quantities
    .filter((quantity) => (quantity.unit && unitPattern.test(quantity.unit)) || (symbolPattern && symbolPattern.test(quantity.symbol)))
    .map((quantity) => quantity.value);
}

/* ------------------------------------------------------------------------- */
/* Stem numbers                                                               */
/* ------------------------------------------------------------------------- */

const NUMBER = String.raw`(-?\d+(?:\.\d+)?(?:\s*[x×]\s*10\s*\^?\s*-?\d+|e-?\d+)?)`;

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s+/g, "").replace(/[x×]10\^?(-?\d+)/i, "e$1");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Text prepared for numeric extraction: unicode operators and superscripts folded. */
export function prepareStem(question: string): string {
  return question
    .replace(/[–—−]/g, "-")
    .replace(/⁻¹/g, "^-1")
    .replace(/⁻²/g, "^-2")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/µ/g, "μ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every number immediately followed by a unit that matches `unit`. */
export function numbersWithUnit(stem: string, unit: RegExp): number[] {
  const pattern = new RegExp(`${NUMBER}\\s*(?:${unit.source})(?![a-z])`, "gi");
  const values: number[] = [];
  for (const match of stem.matchAll(pattern)) {
    const value = parseNumber(match[1]!);
    if (value !== null) values.push(value);
  }
  return values;
}

export function firstNumberWithUnit(stem: string, unit: RegExp): number | null {
  return numbersWithUnit(stem, unit)[0] ?? null;
}

/** A number introduced by a phrase, e.g. "focal length (of)? 10 cm" or "f = 10 cm". */
export function numberAfter(stem: string, phrase: RegExp, unit?: RegExp): number | null {
  const tail = unit ? `\\s*(?:${unit.source})?` : "";
  const pattern = new RegExp(`(?:${phrase.source})[^0-9\\-]{0,24}${NUMBER}${tail}`, "i");
  const match = pattern.exec(stem);
  return match ? parseNumber(match[1]!) : null;
}

/** A number followed by a phrase, e.g. "30 cm from a concave mirror". */
export function numberBefore(stem: string, phrase: RegExp, unit?: RegExp): number | null {
  const tail = unit ? `\\s*(?:${unit.source})` : "";
  const pattern = new RegExp(`${NUMBER}${tail}\\s*(?:${phrase.source})`, "i");
  const match = pattern.exec(stem);
  return match ? parseNumber(match[1]!) : null;
}

export const UNIT = {
  speed: /m\s*\/\s*s|m\s*s\^-1|ms\^-1|km\s*\/\s*h|kmph|km\s*h\^-1/,
  accel: /m\s*\/\s*s\^2|m\s*s\^-2|ms\^-2/,
  metre: /m(?:etres?|eters?)?\b/,
  centimetre: /cm\b/,
  millimetre: /mm\b/,
  kilometre: /km\b/,
  kilogram: /kg\b/,
  gram: /g\b|grams?\b/,
  newton: /N\b|newtons?\b/,
  ohm: /Ω|ohms?\b|kΩ|k\s*ohms?\b/,
  kiloohm: /kΩ|k\s*ohms?\b/,
  volt: /V\b|volts?\b/,
  ampere: /A\b|amperes?\b|amp\b/,
  farad: /μF|uF|microfarad|pF|nF|F\b/,
  tesla: /T\b|tesla\b/,
  second: /s\b|sec(?:onds?)?\b/,
  degree: /°|deg(?:rees?)?\b/,
  ev: /eV\b/,
  nm: /nm\b/,
  hz: /Hz\b/,
  coulomb: /C\b|μC|uC|nC|coulombs?\b/,
  springConstant: /N\s*\/\s*m|N\s*m\^-1|Nm\^-1/,
};

export function firstAngle(stem: string): number | null {
  return firstNumberWithUnit(stem, UNIT.degree);
}

export function allAngles(stem: string): number[] {
  return numbersWithUnit(stem, UNIT.degree);
}

/** "coefficient of friction 0.4", "μ = 0.4", "mu = 0.4", "coefficient of kinetic friction is 0.4". */
export function frictionCoefficient(stem: string): number | null {
  return numberAfter(stem, /coefficient of (?:kinetic |static |sliding |limiting )?friction(?: between [^0-9]{0,40})?(?: is| of| =|:)?|\bμ\s*[=:]|\bmu\s*[=:]|μ_?[ks]\s*[=:]/);
}

/** Refractive index as "refractive index (of) 1.5", "n = 1.5", "μ = 1.5", "√3", "1.5" after 'index'. */
export function refractiveIndex(stem: string): number | null {
  if (/refractive index[^0-9]{0,30}(?:√3|root ?3|sqrt\(?3\)?)/i.test(stem) || /(?:μ|n)\s*=\s*(?:√3|root ?3)/i.test(stem)) return Math.sqrt(3);
  if (/refractive index[^0-9]{0,30}(?:√2|root ?2|sqrt\(?2\)?)/i.test(stem) || /(?:μ|n)\s*=\s*(?:√2|root ?2)/i.test(stem)) return Math.SQRT2;
  const direct = numberAfter(stem, /refractive index(?: of (?:the )?(?:glass|prism|material|medium|water|liquid))?(?: is| of| =|:)?|\bn\s*=|\bμ\s*=|\bmu\s*=/);
  if (direct !== null && direct >= 1 && direct < 4) return direct;
  return null;
}

/* ------------------------------------------------------------------------- */
/* Expressions                                                                */
/* ------------------------------------------------------------------------- */

const EXPRESSION_CHARS = /[0-9xty+\-*/^().\s]|sin|cos|tan|sqrt|abs|ln|log|exp|pi|e/;

/** Read a safe expression body starting at `start`, stopping at the first foreign token. */
export function readExpression(source: string, start = 0): string {
  const allowed = new Set(["x", "t", "pi", "e", "sin", "cos", "tan", "sqrt", "abs", "ln", "log", "exp"]);
  let index = start;
  while (index < source.length) {
    const character = source[index]!;
    if (/[0-9.+\-*/^()\s]/.test(character)) { index += 1; continue; }
    if (/[A-Za-z_]/.test(character)) {
      const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? "";
      if (!allowed.has(identifier.toLowerCase())) break;
      index += identifier.length;
      continue;
    }
    break;
  }
  return normalizeExpression(source.slice(start, index));
}

/** Make an exam-style expression safe for the engine's parser: explicit `*`, `^`, no unicode. */
export function normalizeExpression(raw: string): string {
  let source = raw
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/π/g, "pi")
    .replace(/\s+/g, "");
  source = source.replace(/\|([^|]+)\|/g, (_all, inner: string) => `abs(${inner})`);
  source = source.replace(/\b(sin|cos|tan|sqrt|ln|log|exp)(\d+(?:\.\d+)?)([xt])\b/gi, (_, fn: string, n: string, v: string) => `${fn.toLowerCase()}(${n}*${v})`);
  source = source.replace(/\b(sin|cos|tan|sqrt|ln|log|exp)([xt])\b/gi, (_, fn: string, v: string) => `${fn.toLowerCase()}(${v})`);
  source = source.replace(/([xt])(\d+)\b/g, "$1^$2");
  source = source.replace(/(\d)([xte(])/g, "$1*$2");
  source = source.replace(/([xt])\(/g, "$1*(");
  source = source.replace(/\)([xt0-9(])/g, ")*$1");
  source = source.replace(/([xt])([xt])\b/g, "$1*$2");
  return source.replace(/^\+/, "").replace(/[+\-*/^(.]+$/, "");
}

export function isSafeExpression(expression: string, variable: "x" | "t" = "x"): boolean {
  if (!expression) return false;
  const other = variable === "x" ? "t" : "x";
  if (new RegExp(`\\b${other}\\b`).test(expression)) return false;
  return EXPRESSION_CHARS.test(expression) && !/[^0-9xte+\-*/^().a-z]/i.test(expression);
}

/** Right-hand sides of `y = …`, `f(x) = …`, `F = …`, and `… = y`. */
export function explicitFunctions(question: string, lhs: RegExp = /\b(?:y|f\s*\(\s*x\s*\)|g\s*\(\s*x\s*\)|F|F\s*\(\s*x\s*\))\s*=\s*/g): string[] {
  const stem = prepareStem(question);
  const found: string[] = [];
  for (const match of stem.matchAll(lhs)) {
    const expression = readExpression(stem, (match.index ?? 0) + match[0].length);
    if (expression && isSafeExpression(expression) && /x/.test(expression) && !found.includes(expression)) found.push(expression);
  }
  for (const match of stem.matchAll(/([0-9x^+\-*/().]+)\s*=\s*y\b/g)) {
    const expression = normalizeExpression(match[1] ?? "");
    if (expression && isSafeExpression(expression) && /x/.test(expression) && !found.includes(expression)) found.push(expression);
  }
  return found.slice(0, 3);
}

/** `x = f(t)` in a kinematics stem; returned with `t` renamed to `x` for the curve operators. */
export function positionOfTime(question: string): string | null {
  const stem = prepareStem(question);
  const match = /(?:^|[^\w])(?:x|s)\s*=\s*/i.exec(stem);
  if (!match) return null;
  const expression = readExpression(stem, (match.index ?? 0) + match[0].length);
  if (!expression || !/\bt\b/.test(expression) || !isSafeExpression(expression, "t")) return null;
  return expression.replace(/\bt\b/g, "x");
}

/** Interval like "from x = 0 to x = 4", "between x = 1 and x = 3", "0 ≤ x ≤ 4", "[0, 4]". */
export function xInterval(question: string): [number, number] | null {
  const stem = prepareStem(question);
  const patterns = [
    /x\s*=\s*(-?\d+(?:\.\d+)?)\s*(?:m\b)?\s*(?:to|and|,)\s*x\s*=\s*(-?\d+(?:\.\d+)?)/i,
    /(-?\d+(?:\.\d+)?)\s*(?:≤|<=|<)\s*x\s*(?:≤|<=|<)\s*(-?\d+(?:\.\d+)?)/i,
    /\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(stem);
    if (!match) continue;
    const a = Number(match[1]);
    const b = Number(match[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a < b ? [a, b] : [b, a];
  }
  return null;
}

/** "at x = 2", "at the point where x = 1", "when x = 1", "at (1, 2)". */
export function pointOfInterestX(question: string): number | null {
  const stem = prepareStem(question);
  const match = /(?:at|where|when)\s+(?:the\s+point\s+(?:where\s+)?)?x\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(stem)
    ?? /at\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*-?\d+(?:\.\d+)?\s*\)/i.exec(stem);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** All (x, y) or (x, y, z) coordinate tuples in the stem. */
export function coordinateTuples(question: string): number[][] {
  const stem = prepareStem(question);
  const tuples: number[][] = [];
  for (const match of stem.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?))?\s*\)/g)) {
    const tuple = [match[1], match[2], match[3]].filter((item): item is string => item !== undefined).map(Number);
    if (tuple.every(Number.isFinite)) tuples.push(tuple);
  }
  return tuples;
}
