/** Bounded source semantics; indexed terms and real branches stay in the existing operator. */
import { evaluateIndexedProgressionConstruction, type ExactProgressionValue, type IndexedProgressionGeometry, type ProgressionKind } from "../compile/indexedProgressionGeometry";
import { evaluateFiniteProgressionSets } from "./finiteProgressionSets";
import type { ExpressionNodeIR, QuestionSourceEvidence } from "../ir/problemIR";

export interface ProgressionSourceRole {
  role: string;
  evidence: QuestionSourceEvidence;
  root: ExpressionNodeIR;
}
export interface ProgressionSourceAsk extends ProgressionSourceRole {
  symbol: string;
  index: number;
  kind: "term" | "sum";
  branch: number;
  exact: ExactProgressionValue;
  value: number;
}
export interface FiniteProgressionSource {
  question: string;
  kind: ProgressionKind;
  operation: "indexed_progression" | "progression_recover" | "progression_insert";
  sequence: string;
  cumulative: { sequence: string; first: string } | null;
  inputs: Record<string, unknown>;
  roles: ProgressionSourceRole[];
  asks: ProgressionSourceAsk[];
  geometry: IndexedProgressionGeometry;
}
export type FiniteProgressionReading = { status: "ok"; source: FiniteProgressionSource } | { status: "declined"; reason: string };
const literal = String.raw`[+\-]?(?:\d+(?:\.\d+)?|\.\d+)(?:/\d+)?`;
const num = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const binary = (operator: "+" | "-" | "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });

function literalRoot(text: string): ExpressionNodeIR {
  const [a, b] = text.split("/");
  if (b !== undefined && Number(b) === 0) throw new Error("zero source denominator");
  return b === undefined ? num(Number(a)) : binary("/", num(Number(a)), num(Number(b)));
}
function evidence(question: string, quote: string): QuestionSourceEvidence {
  const start = question.indexOf(quote);
  if (start < 0 || question.indexOf(quote, start + 1) >= 0) throw new Error("source role span is missing or ambiguous");
  return { source: "question", start, end: start + quote.length, quote };
}
function rational(n: bigint, d: bigint): ExactProgressionValue {
  if (d === 0n) throw new Error("zero denominator");
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d;
  while (b) [a, b] = [b, a % b];
  const divisor = a || 1n;
  if (n.toString(2).length > 4096 || d.toString(2).length > 4096) throw new Error("sum capacity exceeds4096 bits");
  return { numerator: String(n / divisor), denominator: String(d / divisor) };
}
/** Only aggregation is new here. No term recurrence, root search, or CRT implementation. */
function add(a: ExactProgressionValue, b: ExactProgressionValue): ExactProgressionValue {
  return rational(BigInt(a.numerator) * BigInt(b.denominator) + BigInt(b.numerator) * BigInt(a.denominator), BigInt(a.denominator) * BigInt(b.denominator));
}
const zero: ExactProgressionValue = { numerator: "0", denominator: "1" };
function numeric(exact: ExactProgressionValue): number {
  const value = Number(exact.numerator) / Number(exact.denominator);
  if (!Number.isFinite(value) || Math.abs(value) > 1e12 || value === 0 && exact.numerator !== "0") throw new Error("finite aggregate exceeds numeric capacity");
  return value;
}
function indexCount(n: number): void {
  // Reuse bounded AP-set authority for the finite ordinal domain, including the empty sum.
  const domain = evaluateFiniteProgressionSets({ model: "integer_ap_sets", operation: "intersection", sets: [{ first: 1, step: 1, count: n }, { first: 1, step: 1, count: 64 }] });
  if (domain.cardinality !== n) throw new Error("source index is outside0..64");
}
function termRoot(kind: ProgressionKind, first: ExpressionNodeIR, parameter: ExpressionNodeIR, n: ExpressionNodeIR): ExpressionNodeIR {
  const offset = binary("-", n, num(1));
  return kind === "arithmetic" ? binary("+", first, binary("*", offset, parameter)) : binary("*", first, binary("^", parameter, offset));
}
function sumRoot(kind: ProgressionKind, first: ExpressionNodeIR, parameter: ExpressionNodeIR, n: number, unitRatio: boolean): ExpressionNodeIR {
  if (n === 0) return num(0);
  if (kind === "arithmetic") return binary("/", binary("*", num(n), binary("+", binary("*", num(2), first), binary("*", binary("-", num(n), num(1)), parameter))), num(2));
  return unitRatio ? binary("*", num(n), first) : binary("/", binary("*", first, binary("-", num(1), binary("^", parameter, num(n)))), binary("-", num(1), parameter));
}
function cumulativeRoot(first: ExpressionNodeIR, a: ExpressionNodeIR, d: ExpressionNodeIR, n: number, sum: boolean): ExpressionNodeIR {
  const offset = binary("-", num(n), num(1));
  const pair = binary("*", offset, binary("-", num(n), num(2)));
  if (sum && n === 0) return num(0);
  return sum
    ? binary("+", binary("+", binary("*", num(n), first), binary("/", binary("*", binary("*", a, num(n)), offset), num(2))), binary("/", binary("*", binary("*", d, num(n)), pair), num(6)))
    : binary("+", binary("+", first, binary("*", offset, a)), binary("/", binary("*", d, pair), num(2)));
}

/** Complete bounded algebra/prose grammar, never a chapter, ID, or metadata router. */
export function readFiniteProgressionSource(question: string): FiniteProgressionReading {
  try {
    if (typeof question !== "string" || question.length > 8192) throw new Error("source must be a bounded complete string");
    const direct = new RegExp(`^Let ([A-Za-z])_n be an? (arithmetic|geometric) progression with \\1_1 = (${literal}) and common (difference|ratio) (${literal})\\. `).exec(question);
    const recovery = /^(Recover (arithmetic|geometric) progression ([A-Za-z])_n from ([\s\S]+?)(?:, using (positive|negative|all_real) ratio branches)?\. )/.exec(question);
    const insertion = new RegExp(`^(Insert (\\d+) (arithmetic|geometric) means between (${literal}) and (${literal})(?:, using (positive|negative|all_real) ratio branches)?\\. )`).exec(question);
    let kind: ProgressionKind, sequence: string, inputs: Record<string, unknown>, prefix: string;
    let operation: FiniteProgressionSource["operation"] = "indexed_progression";
    const roles: ProgressionSourceRole[] = [];
    const role = (name: string, quote: string, root: ExpressionNodeIR): void => { roles.push({ role: name, evidence: evidence(question, quote), root }); };
    if (direct) {
      prefix = direct[0]; sequence = direct[1]!; kind = direct[2] as ProgressionKind;
      if (direct[4] !== (kind === "arithmetic" ? "difference" : "ratio")) throw new Error("AP difference and GP ratio roles disagree");
      inputs = { kind, first: direct[3]!, [kind === "arithmetic" ? "difference" : "ratio"]: direct[5]! };
      role("model", prefix.trim(), termRoot(kind, literalRoot(direct[3]!), literalRoot(direct[5]!), { kind: "variable", name: "n" }));
      role("first", `${sequence}_1 = ${direct[3]}`, literalRoot(direct[3]!));
      role("parameter", `common ${direct[4]} ${direct[5]}`, literalRoot(direct[5]!));
    } else if (recovery) {
      prefix = recovery[1]!; kind = recovery[2] as ProgressionKind; sequence = recovery[3]!; operation = "progression_recover";
      const observations = recovery[4]!.split(" and ").map((part, i) => {
        const match = new RegExp(`^${sequence}_(\\d+) = (${literal})$`).exec(part);
        if (!match) throw new Error("unsupported or incomplete indexed observation");
        role(`observation_${i}`, part, literalRoot(match[2]!));
        return { index: Number(match[1]), value: match[2]! };
      });
      inputs = { kind, observations, ...(recovery[5] ? { branch: recovery[5] } : {}) };
      role("model", prefix.trim(), { kind: "variable", name: "n" });
    } else if (insertion) {
      prefix = insertion[1]!; kind = insertion[3] as ProgressionKind; sequence = "a"; operation = "progression_insert";
      inputs = { kind, first: insertion[4]!, last: insertion[5]!, insertions: Number(insertion[2]), ...(insertion[6] ? { branch: insertion[6] } : {}) };
      role("model", prefix.trim(), { kind: "variable", name: "n" });
      role("first", `between ${insertion[4]}`, literalRoot(insertion[4]!));
      role("last", `and ${insertion[5]}`, literalRoot(insertion[5]!));
      role("insertions", `Insert ${insertion[2]}`, num(Number(insertion[2])));
    } else throw new Error("complete explicit finite progression source is unsupported; no guessed coefficients");
    let rest = question.slice(prefix.length);
    let cumulative: FiniteProgressionSource["cumulative"] = null;
    if (rest.startsWith("Let ")) {
      const relation = new RegExp(`^Let ([A-Za-z])_n satisfy \\1_1 = (${literal}) and \\1_\\(n\\+1\\) - \\1_n = ${sequence}_n for n >= 1\\. `).exec(rest);
      if (!relation || operation !== "indexed_progression" || kind !== "arithmetic" || relation[1] === sequence) throw new Error("unsupported mixed or cumulative relation");
      cumulative = { sequence: relation[1]!, first: relation[2]! };
      role("cumulative_first", `${cumulative.sequence}_1 = ${cumulative.first}`, literalRoot(cumulative.first));
      role("cumulative_relation", relation[0].trim(), binary("-", { kind: "variable", name: `${cumulative.sequence}_next` }, { kind: "variable", name: `${cumulative.sequence}_n` }));
      role("domain", "n >= 1", num(1));
      rest = rest.slice(relation[0].length);
    }
    if (!rest.startsWith("Find ") || !rest.endsWith(".")) throw new Error("complete finite asks are required");
    const askedSequence = cumulative?.sequence ?? sequence;
    const tokens = rest.slice(5, -1).split(", ");
    if (!tokens.length || tokens.length > 16 || new Set(tokens).size !== tokens.length) throw new Error("asks must be unique and bounded to16");
    let askOffset = question.length - rest.length + 5;
    const parsed = tokens.map((token) => {
      const term = new RegExp(`^${askedSequence}_(\\d+)(?:\\[(positive|negative)\\])?$`).exec(token);
      const sum = new RegExp(`^sum_\\{k=1\\}\\^(\\d+) ${askedSequence}_k(?:\\[(positive|negative)\\])?$`).exec(token);
      const match = term ?? sum;
      if (!match) throw new Error("unsupported/infinite/noninteger ask or leftover source clause");
      const index = Number(match[1]); indexCount(index);
      if (term && index === 0) throw new Error("terms start at1; only empty sums use0");
      const start = askOffset;
      askOffset += token.length + 2;
      return { token, start, index, kind: term ? "term" as const : "sum" as const, sign: match[2] };
    });
    const max = Math.max(1, ...parsed.map((ask) => ask.index));
    const evaluate = (indices: number[]) => evaluateIndexedProgressionConstruction(operation, { ...inputs, ...(operation !== "progression_insert" ? { indices } : {}), origin: [0, 0], displayScale: 1 }, { scalar() { throw new Error("no planner scalar authority"); } })[0]!;
    const visible = [...new Set([...parsed.filter((ask) => ask.kind === "term").map((ask) => ask.index), ...(operation === "progression_recover" ? (inputs.observations as Array<{ index: number }>).map((observation) => observation.index) : [])])].sort((a, b) => a - b);
    const geometry = evaluate(visible.length ? visible : [1]);
    const observedIndices = operation === "progression_recover" ? (inputs.observations as Array<{ index: number }>).map((observation) => observation.index) : [];
    const chunkSize = 16 - observedIndices.length;
    if (operation === "progression_recover" && chunkSize < 1) throw new Error("recovery aggregation needs room for every source observation");
    const width = operation === "progression_recover" ? chunkSize : 16;
    const enumerated = Array.from({ length: Math.ceil(max / width) }, (_, chunk) => evaluate([...new Set([...observedIndices, ...Array.from({ length: Math.min(width, max - chunk * width) }, (_, i) => chunk * width + i + 1)])].sort((a, b) => a - b)));
    const asks = parsed.map((ask): ProgressionSourceAsk => {
      const solutions = geometry.indexedProgression.solutions;
      const branch = ask.sign ? solutions.findIndex((solution) => (BigInt(solution.parameter.numerator) < 0n ? "negative" : "positive") === ask.sign) : solutions.length === 1 ? 0 : -1;
      if (branch < 0 || solutions.length === 1 && ask.sign) throw new Error("every real branch needs an explicit source ask");
      let running = zero, result = zero;
      let cumulativeTerm = cumulative ? evaluateIndexedProgressionConstruction("indexed_progression", { kind: "arithmetic", first: cumulative.first, difference: 0, indices: [1], origin: [0, 0], displayScale: 1 }, { scalar() { throw new Error("unresolved source"); } })[0]!.indexedProgression.solutions[0]!.terms[0]!.exactValue : zero;
      const terms = operation === "progression_insert" ? solutions[branch]!.terms : enumerated.flatMap((table) => table.indexedProgression.solutions[branch]!.terms);
      for (let i = 1; i <= ask.index; i++) {
        const term = terms.find((item) => item.index === i);
        if (!term) throw new Error("source ask exceeds complete insertion table");
        result = cumulative ? cumulativeTerm : term.exactValue;
        running = add(running, result);
        if (cumulative) cumulativeTerm = add(cumulativeTerm, term.exactValue);
      }
      const exact = ask.kind === "sum" ? running : result;
      const first = operation === "progression_recover" ? literalRoot((inputs.observations as Array<{ value: string }>)[0]!.value) : literalRoot(String(inputs.first));
      let parameter: ExpressionNodeIR;
      let sourceFirst = first;
      if (operation === "progression_insert") {
        const quotient = binary("/", literalRoot(String(inputs.last)), first);
        const negativeQuotient = Number(String(inputs.first).split("/")[0]) * Number(String(inputs.last).split("/")[0]) < 0;
        const magnitude: ExpressionNodeIR = negativeQuotient ? { kind: "unary", operator: "-", operand: quotient } : quotient;
        parameter = kind === "arithmetic" ? binary("/", binary("-", literalRoot(String(inputs.last)), first), num(Number(inputs.insertions) + 1)) : binary("^", magnitude, binary("/", num(1), num(Number(inputs.insertions) + 1)));
        if (kind === "geometric" && BigInt(solutions[branch]!.parameter.numerator) < 0n) parameter = { kind: "unary", operator: "-", operand: parameter };
      } else if (operation === "progression_recover") {
        const observations = [...inputs.observations as Array<{ index: number; value: string }>].sort((a, b) => a.index - b.index);
        const [a, b] = observations;
        if (!a || !b) throw new Error("two observations required");
        const quotient = binary("/", literalRoot(b.value), literalRoot(a.value));
        const negativeQuotient = Number(a.value.split("/")[0]) * Number(b.value.split("/")[0]) < 0;
        const magnitude: ExpressionNodeIR = negativeQuotient ? { kind: "unary", operator: "-", operand: quotient } : quotient;
        parameter = kind === "arithmetic" ? binary("/", binary("-", literalRoot(b.value), literalRoot(a.value)), num(b.index - a.index)) : binary("^", magnitude, binary("/", num(1), num(b.index - a.index)));
        if (kind === "geometric" && BigInt(solutions[branch]!.parameter.numerator) < 0n) parameter = { kind: "unary", operator: "-", operand: parameter };
        sourceFirst = kind === "arithmetic" ? binary("-", literalRoot(a.value), binary("*", num(a.index - 1), parameter)) : binary("/", literalRoot(a.value), binary("^", parameter, num(a.index - 1)));
      } else parameter = literalRoot(String(kind === "arithmetic" ? inputs.difference : inputs.ratio));
      const root = cumulative ? cumulativeRoot(literalRoot(cumulative.first), first, parameter, ask.index, ask.kind === "sum") : ask.kind === "term" ? termRoot(kind, sourceFirst, parameter, num(ask.index)) : sumRoot(kind, sourceFirst, parameter, ask.index, solutions[branch]!.parameter.numerator === solutions[branch]!.parameter.denominator);
      const start = ask.start;
      return { role: `ask_${asksKey(ask.token)}`, symbol: ask.token, evidence: { source: "question", start, end: start + ask.token.length, quote: ask.token }, root, index: ask.index, kind: ask.kind, branch, exact, value: numeric(exact) };
    });
    if (geometry.indexedProgression.solutions.some((_, branch) => !asks.some((ask) => ask.branch === branch))) throw new Error("source requests omit a real signed branch");
    return { status: "ok", source: { question, kind, operation, sequence, cumulative, inputs, roles, asks, geometry } };
  } catch (error) { return { status: "declined", reason: error instanceof Error ? error.message : "unsupported source" }; }
}
function asksKey(token: string): string { return token.replace(/[^A-Za-z0-9]/g, "_"); }
