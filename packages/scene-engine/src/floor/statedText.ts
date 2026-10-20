/**
 * Is a board text something the question itself states? Either its compact
 * spelling occurs in the question, or it is an explicit equation y = f(x)
 * whose right side is the question's own f(x) (checked by evaluation, so
 * "y=abs(x)" is the question's "f(x) = |x|" and "y=x^2" its "y = x²"). A
 * coordinate the engine computed, an intercept, an area, a solved root: none
 * of these is stated, so none passes.
 */
import { parseMathExpression } from "../math/expression";

export function compactMath(text: string): string {
  return text
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/×|·|⋅/g, "*")
    .replace(/\s+/g, "")
    .replace(/\*/g, "")
    .replace(/[.,;:]+$/g, "");
}

const SAMPLES = [-2.7, -1.3, -0.4, 0.35, 0.9, 1.7, 2.6];

/** Written algebra to the audited expression language: implicit products ("3x", "2(x+1)", ")(") made explicit. */
function explicitProducts(body: string): string {
  return body
    .replace(/\s+/g, "")
    .replace(/(\d)(?=[a-z(])/gi, "$1*")
    .replace(/\)(?=[\da-z(])/gi, ")*")
    .replace(/\bx(?=\()/g, "x*");
}

function sameFunction(first: string, second: string): boolean {
  try {
    const a = parseMathExpression(explicitProducts(first)), b = parseMathExpression(explicitProducts(second));
    let compared = 0;
    for (const x of SAMPLES) {
      let left: number, right: number;
      try { left = a.evaluate(x); right = b.evaluate(x); } catch { continue; }
      if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
      if (Math.abs(left - right) > 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))) return false;
      compared += 1;
    }
    return compared >= 4;
  } catch {
    return false;
  }
}

/** Right sides of explicit equations the question writes: y = …, f(x) = …, g(x) = …. */
export function statedFunctionBodies(question: string): string[] {
  return statedFunctions(question).map((stated) => stated.body);
}

/** Each explicit equation the question writes, with its own spelling for the board. */
export function statedFunctions(question: string): Array<{ body: string; spelling: string }> {
  const text = question.replace(/[−–—]/g, "-").replace(/²/g, "^2").replace(/³/g, "^3");
  const bodies: Array<{ body: string; spelling: string }> = [];
  for (const match of text.matchAll(/(?:\by|\b[fgh]\s*\(\s*x\s*\))\s*=\s*([^=,;:?]+?)(?=$|[,;:?]|\s+(?:and|for|is|on|at|between|from|where|with|then|find|show|has|over|in)\b|\.\s|\.$)/gi)) {
    const body = match[1]!.trim().replace(/\|([^|]+)\|/g, "abs($1)");
    if (body) bodies.push({ body, spelling: match[0].trim().replace(/\s+/g, " ") });
  }
  return bodies;
}

/** The question's own spelling of an equation label the engine wrote in code form ("y=abs(x)" → "f(x) = |x|"). */
export function questionSpelling(text: string, question: string): string | null {
  const equation = text.match(/^\s*(?:y|[fgh]\s*\(\s*x\s*\))\s*=\s*(.+?)\s*\.?\s*$/i);
  if (!equation) return null;
  const body = equation[1]!.replace(/\|([^|]+)\|/g, "abs($1)");
  return statedFunctions(question).find((stated) => sameFunction(body, stated.body))?.spelling ?? null;
}

/** Occurs in the question with no digit or decimal point glued to either end, so "2" never matches inside "x^2" or "12". */
function occursAsWritten(compact: string, question: string): boolean {
  const haystack = compactMath(question);
  if (!/\p{L}/u.test(compact) && compact.replace(/[^\p{N}]/gu, "").length < 2) return false;
  for (let index = haystack.indexOf(compact); index >= 0; index = haystack.indexOf(compact, index + 1)) {
    const before = haystack[index - 1] ?? "", after = haystack[index + compact.length] ?? "";
    if (/[\d.]/.test(compact[0]!) && /[\d.^]/.test(before)) continue;
    if (/[\d.]/.test(compact[compact.length - 1]!) && /[\d.]/.test(after)) continue;
    return true;
  }
  return false;
}

export function statedInQuestion(text: string, question: string): boolean {
  const compact = compactMath(text);
  if (!compact) return true;
  if (occursAsWritten(compact, question)) return true;
  const equation = text.match(/^\s*(?:y|[fgh]\s*\(\s*x\s*\))\s*=\s*(.+?)\s*\.?\s*$/i);
  if (!equation) return false;
  const body = equation[1]!.replace(/\|([^|]+)\|/g, "abs($1)");
  return statedFunctionBodies(question).some((stated) => sameFunction(body, stated));
}
