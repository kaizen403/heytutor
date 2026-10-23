/**
 * The question's own spelling of an equation bound to a plotted curve. A curve
 * may carry "y = x^2" or "f(x) = |x|" only when the ProblemIR function
 * expression bound to that curve and the equation its evidence quote writes
 * agree at every sample point. A computed coordinate, intercept, area or root
 * is never an equation the question writes, so none can be a label.
 */
import { expressionToSafeSource, type ExpressionNodeIR } from "../ir/problemIR";
import { parseMathExpression } from "../math/expression";
import type { FloorFacts } from "./facts";

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

function variablesOf(root: ExpressionNodeIR): string[] {
  switch (root.kind) {
    case "variable": return [root.name];
    case "unary": return variablesOf(root.operand);
    case "binary": return [...variablesOf(root.left), ...variablesOf(root.right)];
    case "call": return variablesOf(root.argument);
    default: return [];
  }
}

/** A ProblemIR function expression as the audited one-variable expression language, or null. */
export function functionSource(root: ExpressionNodeIR): { source: string; variable: string } | null {
  const names = [...new Set(variablesOf(root))];
  if (names.length !== 1) return null;
  try {
    return { source: expressionToSafeSource(root, names[0]!), variable: names[0]! };
  } catch {
    return null;
  }
}

/** Labels at most 16 characters long: the question's spelling, closed up when needed. */
export function compactLabel(text: string): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 16) return trimmed;
  const closed = trimmed.replace(/\s+/g, "");
  return closed.length <= 16 ? closed : null;
}

/**
 * The question's own spellings of the function equations bound to one curve
 * entity: a ProblemIR function expression citing a fact the curve also cites,
 * whose quote writes "y = …" or "f(x) = …" with the same values.
 */
export function boundEquationSpellings(facts: FloorFacts, entityId: string): string[] {
  const problem = facts.problem;
  const entity = problem?.entities.find((candidate) => candidate.id === entityId);
  if (!problem || !entity || (entity.kind !== "curve" && entity.kind !== "line")) return [];
  const spellings: string[] = [];
  for (const expression of problem.expressions) {
    if (expression.valueType !== "function" || !expression.evidenceFactIds.some((id) => entity.evidenceFactIds.includes(id))) continue;
    const plotted = functionSource(expression.root);
    if (!plotted || plotted.variable !== "x") continue;
    for (const factId of expression.evidenceFactIds) {
      const quote = problem.facts.find((fact) => fact.id === factId)?.evidence.quote ?? "";
      for (const stated of statedFunctions(quote)) {
        const label = compactLabel(stated.spelling);
        if (label && sameFunction(stated.body, plotted.source)) spellings.push(label);
      }
    }
  }
  return [...new Set(spellings)];
}
