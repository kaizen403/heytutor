import { parseMathExpression } from "../math/expression";
import { SCENE_DOCUMENT_VERSION, type SceneDocument } from "../types";

export const CLOSED_FUNCTION_SOURCE_SCHEMA = "closed-function-source/v1" as const;
const MAX_QUESTION_LENGTH = 16_384;
const MAX_CLAUSES = 8;
const MAX_CLAUSE_LENGTH = 256;
const PLOT_REASON = "function curves copied from the submitted question";
const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;

export interface ClosedFunctionClause {
  name: string;
  expression: string;
  syntaxKey: string;
  label: string;
  sourceSpan: { start: number; end: number };
}
type Decline = { status: "declined"; reason: string };
export type ClosedFunctionClauses = { status: "none" } | Decline | {
  status: "read";
  clauses: ClosedFunctionClause[];
  /** Every character outside a complete definition remains for the request proof. */
  remainder: string;
};
export interface ClosedFunctionDisplay {
  xMin: number;
  xMax: number;
  yMin: -2;
  yMax: 4;
  samples: 65;
  expressionScale: 1;
  intervalOrigin: "question_interval" | "engine_display_window";
}
export type ClosedFunctionSource = { status: "none" } | Decline | {
  status: "read";
  clauses: ClosedFunctionClause[];
  display: ClosedFunctionDisplay;
};
export interface ClosedFunctionSourceProof {
  schema: typeof CLOSED_FUNCTION_SOURCE_SCHEMA;
  clauses: Array<Omit<ClosedFunctionClause, "syntaxKey"> & { entityId: string }>;
  display: ClosedFunctionDisplay;
}

/** Stop only at explicit clause/prose boundaries, never at an unread identifier. */
function expressionEnd(source: string, start: number): number {
  let depth = 0;
  let bar = false;
  for (let index = start; index < source.length; index++) {
    const character = source[index]!;
    if (depth === 0 && !bar) {
      if (/[,;!?]/.test(character) || character === "." && !/\d/.test(source[index + 1] ?? "") &&
        !(/\d/.test(source[index - 1] ?? "") && /^[eE][+-]?\d/.test(source.slice(index + 1)))) return index;
      if (/\s/.test(character) && /^\s+(?:is|are|and|but|on|over|for|at|with|where|in|from)\b/i.test(source.slice(index))) return index;
    }
    if (character === "|") bar = !bar;
    if (character === "(") depth++;
    if (character === ")") depth--;
  }
  return source.length;
}

/** Exam notation repair is applied to the WHOLE clause before the complete parser. */
function parsedClause(raw: string): { expression: string; syntaxKey: string } {
  if (!raw.trim() || raw.length > MAX_CLAUSE_LENGTH) throw new Error("Function clause exceeds its complete expression bound");
  let source = raw.trim().replace(/[−–—]/g, "-").replace(/π/g, "pi");
  source = source.replace(/\|([^|]*)\|/g, (_whole, inner: string) => {
    if (!inner.trim()) throw new Error("Empty or nested absolute-value bars are unsupported");
    return `abs(${inner})`;
  });
  if (source.includes("|")) throw new Error("Absolute-value bars must be balanced");
  source = source.replace(/\b(sin|cos|tan|sqrt|ln|log|exp)\s+(\d+(?:\.\d+)?)\s*x\b/gi,
    (_whole, fn: string, coefficient: string) => `${fn.toLowerCase()}(${coefficient}*x)`);
  source = source.replace(/\b(sin|cos|tan|sqrt|ln|log|exp)\s+x\b/gi,
    (_whole, fn: string) => `${fn.toLowerCase()}(x)`);
  source = source.replace(/(\d)\s*x\b/g, "$1*x");
  // Retain token-separating whitespace until parsing: "1 2" must not become 12.
  const parsed = parseMathExpression(source);
  return { expression: parsed.source.replace(/\s+/g, ""), syntaxKey: parsed.syntaxKey };
}

/** Recover all bounded named definitions; no prefix, deduplication or roster slicing. */
export function readClosedFunctionClauses(question: string): ClosedFunctionClauses {
  if (typeof question !== "string" || !question.trim() || question.length > MAX_QUESTION_LENGTH || question.includes("\0")) {
    return { status: "declined", reason: "Question exceeds the bounded function-source language" };
  }
  const declarations = /\b(?:([A-Za-z_][A-Za-z0-9_]*)\s*(['′]*)\s*\(\s*([^()]*)\s*\)|y)\s*=\s*/g;
  const clauses: ClosedFunctionClause[] = [];
  const named = new Set<string>();
  const remainder: string[] = [];
  let cursor = 0;
  try {
    for (const match of question.matchAll(declarations)) {
      const start = match.index!;
      if (!match[1] && /[-+*/^)0-9x]/i.test(question.slice(0, start).trimEnd().slice(-1))) continue;
      if (clauses.length >= MAX_CLAUSES) throw new Error("The complete named function roster exceeds its bound");
      const name = match[1] ?? "y";
      if (name.length > 16 || match[2] || match[1] && match[3]?.trim() !== "x" ||
        /^(?:x|sin|cos|tan|asin|acos|atan|sqrt|abs|ln|log|exp|pi|e)$/.test(name)) {
        throw new Error("Only unambiguous named one-variable definitions are supported");
      }
      if (match[1] && named.has(name)) throw new Error("Repeated named definitions are ambiguous");
      if (match[1]) named.add(name);
      const rhsStart = start + match[0].length;
      const end = expressionEnd(question, rhsStart);
      const parsed = parsedClause(question.slice(rhsStart, end));
      const left = match[1] ? `${name}(x)` : "y";
      clauses.push({ name, ...parsed, label: `${left}=${parsed.expression}`, sourceSpan: { start, end } });
      remainder.push(question.slice(cursor, start), "\0F");
      cursor = end;
    }
    if (!clauses.length) return { status: "none" };
    remainder.push(question.slice(cursor));
    return { status: "read", clauses, remainder: remainder.join("") };
  } catch (error) {
    return { status: "declined", reason: error instanceof Error ? error.message : "Unread function source" };
  }
}

function numericLiteral(source: string): number {
  // The same complete parser bounds signed/scientific literals too.
  return parseMathExpression(source).evaluate(0);
}

/**
 * The curve-only slice consumes all remaining request prose positively.
 * Property questions authorize the named graph, not a drawn derivative claim.
 * Tangents, regions, other relations and added shapes cannot fit this language.
 */
export function readClosedFunctionSource(question: string): ClosedFunctionSource {
  const reading = readClosedFunctionClauses(question);
  if (reading.status !== "read") return reading;
  try {
    let request = reading.remainder.replace(/[−–—]/g, "-");
    let interval: [number, number] | undefined;
    const ranges = [
      new RegExp(String.raw`\b(?:(?:on|over|for)\s+(?:(?:the\s+)?(?:closed\s+)?interval\s+)?(?:x\s*(?:in|∈)\s*)?|x\s*(?:in|∈)\s*)\[\s*(${NUMBER})\s*,\s*(${NUMBER})\s*\]`, "gi"),
      new RegExp(String.raw`\bfrom\s+x\s*=\s*(${NUMBER})\s+to\s+x\s*=\s*(${NUMBER})`, "gi"),
      new RegExp(String.raw`(?:(?:for|on)\s+)?(${NUMBER})\s*(?:≤|<=)\s*x\s*(?:≤|<=)\s*(${NUMBER})`, "gi"),
    ];
    for (const range of ranges) {
      request = request.replace(range, (_whole, low: string, high: string) => {
        if (interval) throw new Error("Multiple display intervals are outside the closed curve-only slice");
        interval = [numericLiteral(low), numericLiteral(high)];
        if (!(interval[0] < interval[1])) throw new Error("A closed source interval must increase");
        return "\0I";
      });
    }
    const points: number[] = [];
    request = request.replace(new RegExp(String.raw`\bat\s+x\s*=\s*(${NUMBER})`, "gi"), (_whole, value: string) => {
      points.push(numericLiteral(value));
      return "at \0P";
    });
    request = request.trim().replace(/\s+/g, " ").toLowerCase();
    const roster = String.raw`\x00f(?:\s*(?:,\s*(?:and\s+)?|;\s*|and\s+)\x00f)*`;
    const graph = new RegExp(String.raw`^(?:please\s+)?(?:plot|sketch|draw|graph|show)\s+(?:(?:the\s+)?graphs?\s+(?:of\s+)?)?(?:(?:the\s+)?functions?\s+)?${roster}(?:\s+\x00i)?[.!?]?$`);
    const property = String.raw`(?:is\s+)?(?:not\s+)?(?:continuous|differentiable)(?:\s+(?:at\s+\x00p|there|\x00i|for\s+all\s+real\s+x))?`;
    const derivatives = String.raw`(?:[,;]?\s*(?:and\s+)?(?:give|find|state|compute|determine|evaluate)\s+(?:the\s+)?(?:(?:left[- ]hand\s+and\s+right[- ]hand|right[- ]hand\s+and\s+left[- ]hand|one[- ]sided)\s+)?derivatives?(?:\s+(?:there|at\s+\x00p))?)?`;
    const properties = new RegExp(String.raw`^(?:(?:show|prove|demonstrate|verify)\s+that|(?:check|determine)\s+whether)\s+(?:the\s+function\s+)?\x00f\s+${property}(?:,?\s+(?:and|but)\s+${property})*${derivatives}[.!?]?$`);
    if (!graph.test(request) && !properties.test(request)) {
      throw new Error("The whole request is outside the closed curve-only language");
    }
    if (/\bthere\b/.test(request) && !points.length) throw new Error("A property location must be explicitly recovered");
    if (points.some(value => value !== points[0])) throw new Error("Several property locations require a richer source display");
    const center = points[0] ?? 0;
    const [xMin, xMax] = interval ?? [center - 2, center + 2];
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !(xMin < xMax) ||
      points.some(value => value < xMin || value > xMax)) throw new Error("The source display must contain its property location");
    return { status: "read", clauses: reading.clauses, display: {
      xMin, xMax, yMin: -2, yMax: 4, samples: 65, expressionScale: 1,
      intervalOrigin: interval ? "question_interval" : "engine_display_window",
    } };
  } catch (error) {
    return { status: "declined", reason: error instanceof Error ? error.message : "Unread function request" };
  }
}

/** Small expected structures bound traversal; accessors, extra keys and hidden transforms fail. */
function sameData(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (expected === null || typeof expected !== "object" || actual === null || typeof actual !== "object") return false;
  if (Array.isArray(actual) !== Array.isArray(expected) || Object.getOwnPropertySymbols(actual).length) return false;
  const prototype = Object.getPrototypeOf(actual);
  if (prototype !== (Array.isArray(actual) ? Array.prototype : Object.prototype) && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(actual);
  const expectedKeys = Reflect.ownKeys(expected);
  if (Reflect.ownKeys(descriptors).length !== expectedKeys.length) return false;
  return expectedKeys.every(key => {
    const descriptor = descriptors[key as string];
    return descriptor && Object.hasOwn(descriptor, "value") &&
      descriptor.enumerable === Object.getOwnPropertyDescriptor(expected, key)!.enumerable &&
      sameData(descriptor.value, Reflect.get(expected, key));
  });
}

/**
 * Prove the entire native roster and identity display against freshly recovered
 * source clauses. Submitted source flags/proof stamps never establish this fact.
 * The compiler/replay still owns geometry, guards and the final board transform.
 */
export function proveClosedFunctionSource(question: string, document: SceneDocument): ClosedFunctionSourceProof | null {
  const source = readClosedFunctionSource(question);
  if (source.status !== "read") return null;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(document))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(document);
    if (Reflect.ownKeys(document).some(key => typeof key !== "string" ||
      !["schemaVersion", "visualDecision", "source", "quantities", "entities", "constructions", "relations", "assertions", "annotations", "requiredEntityIds", "revealGroups", "teachingTimeline"].includes(key)) ||
      Object.values(descriptors).some(descriptor => !descriptor.enumerable || !Object.hasOwn(descriptor, "value"))) return null;
    const metadata = descriptors.source?.value;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(metadata))) return null;
    const metadataDescriptors = Object.getOwnPropertyDescriptors(metadata);
    if (Reflect.ownKeys(metadata).some(key => typeof key !== "string" ||
      !["question", "synthesizedFamily", "sourceModel", "closedFunctionSource", "representationTier", "nonMetric", "family"].includes(key)) ||
      Object.values(metadataDescriptors).some(descriptor => !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) ||
      metadataDescriptors.question?.value !== question.trim()) return null;
    const { xMin, xMax, yMin, yMax, samples } = source.display;
    const ids = ["axes", ...source.clauses.map((_clause, index) => `curve_${index + 1}`)];
    const expected = {
      schemaVersion: SCENE_DOCUMENT_VERSION,
      visualDecision: { mode: "scene", reason: PLOT_REASON },
      quantities: [],
      entities: [{ id: "axes", kind: "axes", role: "display axes" }, ...source.clauses.map((clause, index) => ({
        id: ids[index + 1]!, kind: "polyline", role: "explicit function graph", label: clause.label,
      }))],
      constructions: [{ id: "make_axes", operator: "axes", inputs: { xMin, xMax, yMin, yMax }, outputs: ["axes"] },
        ...source.clauses.map((clause, index) => ({ id: `make_${ids[index + 1]!}`, operator: "function_curve",
          inputs: { expression: clause.expression, variable: "x", xMin, xMax, samples }, outputs: [ids[index + 1]!] }))],
      relations: [],
      assertions: ids.map((id, index) => ({ id: `exists_${index + 1}`, predicate: "exists", entities: [id], expected: true, severity: "fatal" })),
      annotations: [],
      requiredEntityIds: ids,
      revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: PLOT_REASON }],
      teachingTimeline: [{ id: "reveal_setup", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: PLOT_REASON }],
    };
    const core = Object.fromEntries(Object.entries(descriptors).filter(([key]) => key !== "source").map(([key, descriptor]) => [key, descriptor.value]));
    if (!sameData(core, expected)) return null;
    for (const clause of source.clauses) {
      const parsed = parseMathExpression(clause.expression);
      if (parsed.syntaxKey !== clause.syntaxKey) return null;
      parsed.assertContinuousOn(xMin, xMax);
      parsed.evaluate(xMin);
      parsed.evaluate(xMax);
    }
    return { schema: CLOSED_FUNCTION_SOURCE_SCHEMA, display: source.display,
      clauses: source.clauses.map(({ name, expression, label, sourceSpan }, index) => ({
        name, expression, label, sourceSpan, entityId: ids[index + 1]!,
      })) };
  } catch { return null; }
}
