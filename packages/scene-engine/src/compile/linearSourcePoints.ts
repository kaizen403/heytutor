import { parseLinearAffine } from "../math/linearRegion";
import type { ExactRational } from "../math/exactRational";
import { Q_ZERO, serializeRational } from "../math/exactRational";

export interface LinearSourceReferencePoint {
  label: string;
  x: ExactRational;
  y: ExactRational;
}

/** Explicit source names for the intersection, independent of planner aliases. */
export function readLinearSourceIntersectionNames(question: string): Set<string> {
  const names = new Set<string>();
  for (const [pattern, explicit] of [
    [/\b(?:meets?|intersects?|cross(?:es)?)(?:\s+(?:each\s+other|one\s+another))?\s+at\s+(?:(?:the\s+)?point\s+)?([A-Za-z][A-Za-z0-9_]*)\b/gi, false],
    [/\bintersection(?:\s+point)?\s+(?:is\s+)?(?:named|called)\s+(?:(?:the\s+)?point\s+)?([A-Za-z][A-Za-z0-9_]*)\b/gi, true],
    [/\bintersection(?:\s+point)?\s+(?:is\s+)?at\s+(?:(?:the\s+)?point\s+)?([A-Za-z][A-Za-z0-9_]*)\b/gi, false],
    [/\b(?:point\s+of\s+intersection|intersection(?:\s+point)?)\s+(?:is\s+)?(?:point\s+)?([A-Za-z][A-Za-z0-9_]*)\b\s*(?=[,.;?!=]|$)/gi, false],
  ] as const) for (const match of question.matchAll(pattern)) {
    const name = match[1]!;
    if (explicit || /^(?:[A-Z]{1,3}|[A-Za-z]\d{1,3}|[A-Za-z]_[A-Za-z0-9_]+)$/.test(name)) names.add(name);
  }
  return names;
}

/** Original scalar tuple givens only; no planner coordinates or derived names. */
export function readLinearSourceReferencePoints(
  question: string,
  variables: readonly string[],
): { points: LinearSourceReferencePoint[]; maskedQuestion: string } {
  if (typeof question !== "string" || question.length > 8192)
    throw new Error("Source reference points require bounded original question text");
  const points: LinearSourceReferencePoint[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  const normalized = question
    .replace(/\\(?:left|right)/g, "")
    .replace(/\\(?:cdot|times)\b/g, "*")
    .replace(/\\frac\s*\{\s*([+-]?\d+)\s*\}\s*\{\s*([+-]?\d+)\s*\}/g, "($1/$2)")
    .replace(/[−–]/g, "-").replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/\$/g, "");
  if (variables.length === 1) {
    for (const match of normalized.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*/g)) {
      const label = match[1]!;
      if (variables.includes(label)) continue;
      const start = match.index! + match[0].length;
      const tail = normalized.slice(start);
      // Set builders, named-set operations and variable expressions remain
      // unmasked for the complete set grammar. Only literal scalar givens
      // can become independently owned positions on the number line.
      if (!/^[+\-\d.(]/.test(tail)) continue;
      if (tail.startsWith("(")) {
        let depth = 0, interval = false;
        for (const character of tail) {
          if (character === "(") depth++;
          if (character === "," && depth === 1 || character === "]" && depth === 1) { interval = true; break; }
          if (character === ")" && --depth === 0) break;
        }
        if (interval) continue;
      }
      const tokens = [...tail.matchAll(/(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[^\s]/g)];
      let end = 0;
      for (const token of tokens) {
        if (/^(?:\d|\.\d)/.test(token[0]) || /^[()+*/-]$/.test(token[0])) end = token.index! + token[0].length;
        else break;
      }
      const remainder = tail.slice(end);
      if (!end || !/^(?:\s*[,;:.?!]|\s+(?:and|with|in|on|for|whose|which|is|are|belongs|lies)\b|\s*$)/i.test(remainder))
        throw new Error(`Source position ${label} has an unsupported scalar operation`);
      const affine = parseLinearAffine(tail.slice(0, end), variables);
      if (affine.a.numerator !== "0" || affine.b.numerator !== "0") throw new Error(`Source position ${label} must be an exact scalar given`);
      const point = { label, x: affine.constant, y: serializeRational(Q_ZERO) };
      const previous = points.find(entry => entry.label === label);
      if (previous && JSON.stringify(previous.x) !== JSON.stringify(point.x)) throw new Error(`Source position ${label} has conflicting givens`);
      if (!previous) points.push(point);
      if (label.length > 32 || points.length > 16) throw new Error("Source positions exceed label or count bounds");
      spans.push({ start: match.index!, end: start + end });
    }
    let maskedQuestion = normalized;
    for (const span of spans.reverse()) maskedQuestion = maskedQuestion.slice(0, span.start) + " ".repeat(span.end - span.start) + maskedQuestion.slice(span.end);
    return { points, maskedQuestion };
  }
  for (const match of normalized.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*\(/g)) {
    const label = match[1]!;
    if (label.length > 32) throw new Error("Source point labels exceed 32 characters");
    const open = match.index! + match[0].length - 1;
    let depth = 1, end = open + 1;
    const commas: number[] = [];
    for (; end < normalized.length && depth > 0; end++) {
      const ch = normalized[end]!;
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 1) commas.push(end);
      if (depth > 24) throw new Error("Source point tuple nesting exceeds 24");
    }
    // A parenthesized scalar objective or affine equation is not a tuple.
    // Leave it entirely unmasked for the objective/affine source reader.
    if (commas.length === 0) continue;
    if (variables.includes(label)) throw new Error("An axis variable cannot be redefined as a source point");
    if (depth !== 0 || commas.length !== 1)
      throw new Error(`Source point ${label} requires one complete two-coordinate tuple`);
    if (variables.length !== 2 || variables[0] !== "x" || variables[1] !== "y")
      throw new Error("Source point tuples require the source-grounded coordinate order x then y; a reordered or custom axis mapping is unsupported");
    const tail = normalized.slice(end).trimStart();
    // Only a statement/list boundary or ordinary connecting prose can end an
    // exact point definition. An arbitrary token cannot terminate a tuple and
    // silently turn a continued vector expression into the original point.
    if (tail && !/^[,;:.?!'"`“”‘’]/.test(tail)
      && !/^(?:and|in|on|for|with|whose|which|is|are|satisfies|belongs|lies|does|do|to|then)\b/i.test(tail))
      throw new Error(`Source point ${label} has an unsupported tuple operation or continued equality`);
    const coordinate = (text: string): ExactRational => {
      const affine = parseLinearAffine(text, variables);
      if (affine.a.numerator !== "0" || affine.b.numerator !== "0")
        throw new Error(`Source point ${label} coordinates must be exact scalar givens`);
      return affine.constant;
    };
    const comma = commas[0]!;
    const point = {
      label,
      x: coordinate(normalized.slice(open + 1, comma)),
      y: coordinate(normalized.slice(comma + 1, end - 1)),
    };
    const previous = points.find((entry) => entry.label === label);
    if (previous && (JSON.stringify(previous.x) !== JSON.stringify(point.x) || JSON.stringify(previous.y) !== JSON.stringify(point.y)))
      throw new Error(`Source point ${label} has conflicting coordinate givens`);
    if (!previous) points.push(point);
    if (points.length > 16) throw new Error("Source reference points exceed 16 givens");
    spans.push({ start: match.index!, end });
  }
  let maskedQuestion = normalized;
  for (const span of spans.reverse())
    maskedQuestion = maskedQuestion.slice(0, span.start) + " ".repeat(span.end - span.start) + maskedQuestion.slice(span.end);
  return { points, maskedQuestion };
}
