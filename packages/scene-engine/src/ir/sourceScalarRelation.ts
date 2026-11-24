import { sceneUnitSignature } from "../contracts/contractsV3";
import { readUnitDimensions } from "../contracts/planEquationDimensions";
import { sourceUnquotedText } from "../document/sourceRequestScope";
import { addRational, compareRational, divideRational, multiplyRational, negateRational, parseRational, Q_ONE, Q_ZERO, rational, type Rational } from "../math/exactRational";
import { certifyClosedSourceExpression, type ExactSolverValue } from "./solver";
import type { ExpressionNodeIR, ProblemIR, SolveRequest } from "./problemIR";

const NAME = "[A-Za-z][A-Za-z0-9_]*";
const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const SI = new Set(["kg", "m", "s", "A", "K", "mol", "cd", "N", "J", "W", "Pa", "V", "C", "F", "H", "T", "Wb", "Hz"]);
const FUNCTIONS = new Set(["sqrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan", "exp", "ln"]);
const ZERO = Array.from({ length: 7 }, () => Q_ZERO);
interface Span { start: number; end: number }
interface Input extends Span { name: string; value: number; literal: string; unit: string; dimensions: readonly Rational[] }
interface Parsed { root: ExpressionNodeIR; dimensions: readonly Rational[] }
interface Relation { symbol: string; rhs: string; inputSpans: Array<Span & { symbol: string; unit: string; value: number; literal: string }>; relation: Span; requested: Span; dimensions: readonly Rational[]; approximate: number; errorBound: number; exact?: ExactSolverValue }
export interface SourceScalarRelationCertificate {
  version: "source-scalar-relation/v1"; requestId: string; symbol: string; unit: string;
  approximate: number; errorBound: number; exact?: ExactSolverValue;
  evidence: { relation: Span; requested: Span; inputs: Relation["inputSpans"] };
}
export type SourceScalarRelationRead = { status: "not_applicable" } | { status: "unproved"; reason: string } |
  { status: "certified"; certificate: SourceScalarRelationCertificate };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const same = (a: readonly Rational[], b: readonly Rational[]) => a.every((value, index) => compareRational(value, b[index]!) === 0);
const scale = (a: readonly Rational[], q: Rational) => a.map(value => multiplyRational(value, q));
const plus = (a: readonly Rational[], b: readonly Rational[], q = Q_ONE) => a.map((value, i) => addRational(value, multiplyRational(b[i]!, q)));
function fail(message: string): never { throw new Error(message); }
function unit(raw: string): readonly Rational[] | null {
  if (raw.length > 96) return null;
  const tokens = raw.match(/[A-Za-z]+|\d+|[()*/^+-]/g) ?? [];
  if (tokens.join("") !== raw.replace(/\s/g, "") || tokens.length > 48 ||
      tokens.some(token => /^[A-Za-z]+$/.test(token) && !SI.has(token))) return null;
  return readUnitDimensions(raw, sceneUnitSignature);
}

/** Engine-owned bounded AST reader. Native math evaluates the completed AST;
 * this reader also retains dimensional identities, without core dependencies. */
function parseFormula(source: string, inputs: ReadonlyMap<string, Input>): Parsed {
  if (source.length > 256) fail("source formula text budget");
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[()*/^+-]/g) ?? [];
  if (tokens.join("") !== source.replace(/\s/g, "") || tokens.length > 128) fail("unsupported complete source formula");
  let index = 0, depth = 0, nodes = 0;
  const usedInputs = new Set<string>();
  const made = (root: ExpressionNodeIR, dimensions: readonly Rational[]): Parsed => {
    if (++nodes > 96) fail("source formula node budget"); return { root, dimensions };
  };
  const factor = (): Parsed => {
    if (++depth > 12) fail("source formula depth budget");
    const token = tokens[index++]; let value: Parsed;
    if (token === "+" || token === "-") { const inner = factor(); value = made({ kind: "unary", operator: token, operand: inner.root }, inner.dimensions); }
    else if (token === "(") { value = sum(); if (tokens[index++] !== ")") fail("unclosed source formula"); }
    else if (token && /^\d|^\./.test(token)) {
      const number = Number(token); if (!Number.isFinite(number) || Math.abs(number) > 1e12) fail("source coefficient range");
      if (compareRational(parseRational(token), parseRational(number)) !== 0) fail("source coefficient precision is not retained by the numeric AST");
      value = made({ kind: "number", value: number }, ZERO);
    } else if (token && FUNCTIONS.has(token)) {
      if (tokens[index++] !== "(") fail("source function call requires parentheses");
      const argument = sum(); if (tokens[index++] !== ")") fail("unclosed source function");
      if (!["sqrt", "abs"].includes(token) && !same(argument.dimensions, ZERO)) fail("source function requires a dimensionless argument");
      value = made({ kind: "call", function: token as Extract<ExpressionNodeIR, { kind: "call" }>["function"], argument: argument.root },
        token === "sqrt" ? scale(argument.dimensions, rational(1n, 2n)) : token === "abs" ? argument.dimensions : ZERO);
    } else if (token && inputs.has(token)) {
      usedInputs.add(token);
      const input = inputs.get(token)!; value = made({ kind: "number", value: input.value }, input.dimensions);
    } else return fail("source formula has an unbound operand");
    if (tokens[index] === "^") {
      index++;
      const grouped = tokens[index] === "("; if (grouped) index++;
      let sign = ""; if (["+", "-"].includes(tokens[index] ?? "")) sign = tokens[index++]!;
      const literal = tokens[index++]; if (!literal || !/^\d+$/.test(literal)) fail("source power requires a bounded rational constant");
      let exponent = parseRational(`${sign}${literal}`);
      if (grouped && tokens[index] === "/") { index++; const denominator = tokens[index++]; if (!denominator || !/^\d+$/.test(denominator)) fail("unsupported source power"); exponent = divideRational(exponent, parseRational(denominator)); }
      if (grouped && tokens[index++] !== ")" || exponent.n < -8n || exponent.n > 8n || exponent.d > 8n) fail("source power budget");
      const root: ExpressionNodeIR = exponent.d === 1n ? { kind: "number", value: Number(exponent.n) }
        : { kind: "binary", operator: "/", left: { kind: "number", value: Number(exponent.n) }, right: { kind: "number", value: Number(exponent.d) } };
      value = made({ kind: "binary", operator: "^", left: value.root, right: root }, scale(value.dimensions, exponent));
    }
    depth--; return value;
  };
  const product = (): Parsed => {
    let value = factor();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index++]! as "*" | "/", right = factor();
      value = made({ kind: "binary", operator, left: value.root, right: right.root }, plus(value.dimensions, right.dimensions, operator === "/" ? negateRational(Q_ONE) : Q_ONE));
    }
    return value;
  };
  const sum = (): Parsed => {
    let value = product();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++]! as "+" | "-", right = product();
      if (!same(value.dimensions, right.dimensions)) fail("source sum has inconsistent dimensions");
      value = made({ kind: "binary", operator, left: value.root, right: right.root }, value.dimensions);
    }
    return value;
  };
  const result = sum();
  if (index !== tokens.length) fail("unconsumed source formula");
  if (usedInputs.size !== inputs.size) fail("every declared input must occur in the source formula");
  return result;
}

function clauses(question: string): Array<Span & { text: string }> {
  const result: Array<Span & { text: string }> = []; let start = 0;
  for (const boundary of question.matchAll(/[;!?\n]|\.(?=\s|$)/g)) {
    result.push({ start, end: boundary.index!, text: question.slice(start, boundary.index) }); start = boundary.index! + 1;
  }
  result.push({ start, end: question.length, text: question.slice(start) }); return result.filter(value => value.text.trim());
}
/** Applicability is narrower than equation presence: measurements, including
 * unsupported units or unrelated prose, are not a variable-dependent law. Scope
 * is enforced only after finding a candidate law, so native/arithmetic requests
 * without a source relation retain their existing behavior. */
/** Parentheses may wrap a whole given in ordinary source notation. This
 * normalization is eligibility-only; the positive source grammar sees raw text. */
function eligibilityClause(raw: string): string | null {
  let text = raw.trim();
  for (let wrappers = 0; wrappers <= 12; wrappers++) {
    text = text.replace(/^(?:given|use)\s+(?=\()/i, "");
    if (!text.startsWith("(")) return text;
    let depth = 0, firstClose = -1;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === "(") depth++;
      else if (text[index] === ")") {
        if (--depth < 0) return null;
        if (depth === 0 && firstClose < 0) firstClose = index;
      }
    }
    if (depth !== 0) return null;
    if (firstClose !== text.length - 1) return text;
    if (wrappers === 12) return null;
    text = text.slice(1, -1).trim();
  }
  return null;
}

function hasVariableRelation(question: string, boundOutput: string): boolean {
  if (question.length > 8192) return question.includes("=");
  const statements = clauses(question);
  const names = new Set([...question.matchAll(new RegExp(`(${NAME})\\s*=`, "g"))].map(match => match[1]!));
  // This is conservative eligibility only, never proof: an unsupported
  // unit-like RHS on a requested/bound output must not fall through as math-only.
  const queryClauses = statements.filter(clause => /\b(?:find|calculate|determine|compute|evaluate|give)\b/i.test(clause.text));
  for (const clause of statements) {
    const text = eligibilityClause(clause.text);
    if (text === null) { if (clause.text.includes("=")) return true; continue; }
    for (const piece of text.split(/,\s*|\s+and\s+/i)) {
      const equal = piece.indexOf("=");
      if (equal < 0) continue;
      const leftText = piece.slice(0, equal);
      const functionTarget = /^\s*(?:(?:given|use)\s+)?([\p{L}][\p{L}\p{N}_]*)\s*\(/iu.exec(leftText);
      if (functionTarget) {
        let depth = 1, close = functionTarget[0].length;
        while (close < leftText.length && depth > 0) {
          const token = leftText[close++]!;
          if (token === "(") depth++; else if (token === ")") depth--;
        }
        if (depth === 0 && !leftText.slice(close).trim() && queryClauses.some(query =>
          new RegExp(`(?<![\\p{L}\\p{N}_])${escape(functionTarget[1]!)}\\s*\\(`, "u").test(query.text))) return true;
      }
      const rhs = piece.slice(equal + 1).trim().replace(/["'”’]+$/, "");
      const numeric = new RegExp(`^${NUMBER}`).exec(rhs);
      if (!numeric) return true;
      const rest = rhs.slice(numeric[0].length), tail = rest.trim();
      if (!tail) continue;
      // Source operators precede unit recognition: the legacy unit recognizer
      // tolerates leading '*' and '/', which must remain arithmetic here.
      if (/^[+*/^-]/.test(tail) || tail.startsWith("(") && !/^\s+/.test(rest)) return true;
      if (/^(?:[A-Za-zΩµμ%°(]|1(?:\s|\/|$))/.test(tail) && readUnitDimensions(tail, sceneUnitSignature)) continue;
      const operands = tail.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [];
      if (operands.some(name => names.has(name) || FUNCTIONS.has(name))) return true;
      const left = new RegExp(`(${NAME})\\s*$`).exec(leftText);
      if (!left) return true;
      const name = left[1]!;
      if (name === boundOutput || queryClauses.some(query =>
        new RegExp(`(?<![A-Za-z0-9_])${escape(name)}(?![A-Za-z0-9_])`).test(query.text))) return true;
      // Unknown measurement units remain inapplicable for unrelated givens;
      // operators after a numeric literal still identify unsupported source math.
      if (!/^[A-Za-z]+\b/.test(tail)) return true;
    }
  }
  return false;
}

function readRelation(question: string): Relation {
  if (question.length > 8192) fail("source question budget");
  if (sourceUnquotedText(question) !== question || question.includes("!") || /[<>!]=|==|[≠≈]|\\/.test(question)) fail("unsupported complete source relation context");
  const inputs: Input[] = [];
  const formulas: Array<Span & { name: string; rhs: string }> = [];
  const queries: Array<Span & { name: string; unit?: string }> = [];
  let assignments = 0;
  for (const clause of clauses(question)) {
    const query = new RegExp(`^\\s*(?:find|calculate|determine|compute|evaluate|give)\\s+(?:(?:the\\s+)?(?:numerical\\s+)?value\\s+of\\s+)?(${NAME})(?:\\s+in\\s+(.+?))?\\s*$`, "i").exec(clause.text);
    if (query) {
      queries.push({ name: query[1]!, ...(query[2] ? { unit: query[2] } : {}), start: clause.start, end: clause.end });
      continue;
    }
    if (question[clause.end] === "!" || question[clause.end] === "?") fail("source declarations require affirmative statement punctuation");
    // Only an owned declarative clause is accepted. No arbitrary English
    // prefix/suffix, reported law, qualifier, or transformed query is erased.
    const directive = /^\s*(?:(?:given|use)\s+)?/i.exec(clause.text)!;
    const body = clause.text.slice(directive[0].length);
    let offset = directive[0].length;
    const pieces = body.split(/,\s*|\s+and\s+/i);
    for (const piece of pieces) {
      if (++assignments > 24) fail("source assignment budget");
      const assignment = new RegExp(`^\\s*(${NAME})\\s*=\\s*(.+?)\\s*$`).exec(piece);
      if (!assignment) fail("source clause is outside the positive declaration/query grammar");
      const name = assignment[1]!, rhs = assignment[2]!;
      const span = { start: clause.start + offset, end: clause.start + offset + piece.length };
      const numeric = new RegExp(`^(${NUMBER})\\s+(.+)$`).exec(rhs);
      if (numeric) {
        const dimensions = unit(numeric[2]!);
        if (dimensions) {
          const value = Number(numeric[1]);
          if (!Number.isFinite(value) || Math.abs(value) > 1e12 || value !== 0 && Math.abs(value) < 2 ** -1022 ||
              value === 0 && /[1-9]/.test(numeric[1]!.split(/[eE]/)[0]!)) fail("source measurement range");
          if (compareRational(parseRational(numeric[1]!), parseRational(value)) !== 0) fail("source input precision is not retained by the numeric AST");
          inputs.push({ name, value, literal: numeric[1]!, unit: numeric[2]!, dimensions, ...span });
        } else formulas.push({ name, rhs, ...span });
      } else formulas.push({ name, rhs, ...span });
      offset += piece.length;
      if (offset < clause.text.length) {
        const separator = /^(?:,\s*|\s+and\s+)/i.exec(clause.text.slice(offset));
        if (!separator) fail("unsupported source declaration list");
        offset += separator[0].length;
      }
    }
  }
  if (queries.length !== 1 || formulas.length !== 1 || inputs.length < 1 || inputs.length > 12 ||
      new Set(inputs.map(input => input.name)).size !== inputs.length) fail("source needs one formula, one query, and unique scalar inputs");
  const formula = formulas[0]!, query = queries[0]!;
  if (query.name !== formula.name) fail("source formula output is not the identity requested by the source");
  if (inputs.some(input => input.name === formula.name)) fail("source input and output identities overlap");
  const parsed = parseFormula(formula.rhs, new Map(inputs.map(input => [input.name, input])));
  if (query.unit) {
    const dimensions = unit(query.unit);
    if (!dimensions || !same(dimensions, parsed.dimensions)) fail("source request unit contradicts the declared relation");
  }
  const scalar = certifyClosedSourceExpression(parsed.root);
  if (!Number.isFinite(scalar.approximate) || !Number.isFinite(scalar.errorBound) || scalar.errorBound < 0 ||
      scalar.approximate !== 0 && (Math.abs(scalar.approximate) < 2 ** -1022 || scalar.errorBound === 0) ||
      scalar.approximate === 0 && (scalar.errorBound > 0 || scalar.exact?.value !== "0") ||
      !scalar.exact && scalar.errorBound >= Math.abs(scalar.approximate)) fail("source relation has unresolved zero, range, or precision");
  return { symbol: formula.name, rhs: formula.rhs, relation: { start: formula.start, end: formula.end }, requested: query,
    inputSpans: inputs.map(input => ({ symbol: input.name, unit: input.unit, value: input.value, literal: input.literal, start: input.start, end: input.end })),
    dimensions: parsed.dimensions, ...scalar };
}

/** Case-sensitive, scale-preserving comparison for the bounded unprefixed-SI
 * subset. A dimensional match through a prefixed or unknown unit is refused. */
export function sourceScalarRelationUnitsAgree(first: string | undefined, second: string | undefined): boolean {
  if (!first || !second) return false;
  const a = unit(first), b = unit(second);
  return Boolean(a && b && same(a, b));
}

export type SourceScalarOutputRead = { status: "unproved"; reason: string; declaresOutputRelation: boolean } |
  { status: "certified"; output: Omit<SourceScalarRelationCertificate, "version" | "requestId"> };

/** Negative applicability only. A complete, recognized non-mass unit on a
 * literal declaration is not a derived mass relation merely because its unit
 * begins with kg. This grants no value, source-given or equation certificate. */
function literalNonMassDeclaration(clause: string, symbol: string): boolean {
  const assigned = new RegExp(`(?<![A-Za-z0-9_])${escape(symbol)}\\s*=`, "g");
  // Classify this declaration only. A second, even negated, occurrence cannot
  // erase a distinct variable-dependent assignment to the same output.
  if ([...clause.matchAll(assigned)].length !== 1) return false;
  const assignment = new RegExp(`(?<![A-Za-z0-9_])${escape(symbol)}\\s*=\\s*${NUMBER}\\s+(.+?)\\s*$`);
  const mass = readUnitDimensions("kg", sceneUnitSignature)!;
  return clause.split(/,\s*|\s+and\s+/i).some(part => {
    const match = assignment.exec(part);
    if (match && /\b(?:not|never|unless|if)\b[^,;]*$/i.test(part.slice(0, match.index))) return false;
    const dimensions = match && readUnitDimensions(match[1], sceneUnitSignature);
    return Boolean(dimensions && !same(dimensions, mass));
  });
}

/** Independently read a requested output from the original question. Neither a
 * candidate AST nor an IR/result binding participates in this source proof.
 * The existing complete grammar, SI subset and bounded evaluator are shared
 * with the IR-facing certifier below. */
export function readSourceScalarOutput(question: string, symbol: string, outputUnit: string): SourceScalarOutputRead {
  try {
    const relation = readRelation(question);
    if (symbol !== relation.symbol) fail("source output identity is not the requested symbol");
    const dimensions = unit(outputUnit);
    if (!dimensions || !same(dimensions, relation.dimensions)) fail("output unit is not the source-relation SI dimension");
    return { status: "certified", output: { symbol, unit: outputUnit, approximate: relation.approximate,
      errorBound: relation.errorBound, ...(relation.exact ? { exact: relation.exact } : {}),
      evidence: { relation: relation.relation, requested: { start: relation.requested.start, end: relation.requested.end }, inputs: relation.inputSpans } } };
  } catch (error) {
    // Negative eligibility only: an unproved output assignment must not borrow
    // an unrelated given literal. Reuse the existing clause/applicability reader;
    // this flag never certifies an output, formula, value or unit.
    const assigned = new RegExp(`(?<![A-Za-z0-9_])${escape(symbol)}\\s*=`);
    const declarations = question.length <= 8192 ? clauses(question).filter(clause => assigned.test(clause.text)) : [];
    return { status: "unproved", reason: error instanceof Error ? error.message : "source output is unsupported",
      declaresOutputRelation: question.length > 8192 || declarations.some(clause =>
        hasVariableRelation(clause.text, symbol) && !literalNonMassDeclaration(clause.text, symbol)) };
  }
}

/** Original input evidence from the same closed source relation. Dimensional
 * agreement here is scale-preserving because that reader accepts unprefixed
 * SI units only. This does not certify a submitted input value or AST. */
export function readSourceScalarInput(question: string, symbol: string, inputUnit: string):
  { status: "unproved"; reason: string } | { status: "certified"; input: Relation["inputSpans"][number] } {
  try {
    const relation = readRelation(question);
    const input = relation.inputSpans.find(item => item.symbol === symbol);
    if (!input || !sourceScalarRelationUnitsAgree(input.unit, inputUnit)) fail("source input identity or SI dimension is not the requested field");
    return { status: "certified", input };
  } catch (error) {
    return { status: "unproved", reason: error instanceof Error ? error.message : "original scalar input is unsupported" };
  }
}

/** Explicit source equations only. A model's inferred law or a matching number
 * supplies no source certificate. Native request contributors bypass this seam. */
export function certifySourceScalarRelation(problem: ProblemIR, request: SolveRequest, expectedQuestion?: string): SourceScalarRelationRead {
  if (request.kind !== "evaluate" || !request.resultBinding) return { status: "not_applicable" };
  if (!hasVariableRelation(problem.question, request.resultBinding.symbol)) return { status: "not_applicable" };
  if (expectedQuestion === undefined || problem.question !== expectedQuestion) return { status: "unproved", reason: "trusted original source question is required" };
  try {
    const relation = readRelation(problem.question);
    const binding = request.resultBinding;
    if (binding.symbol !== relation.symbol || !binding.unit) fail("source output identity is not the result binding");
    const actual = unit(binding.unit); if (!actual || !same(actual, relation.dimensions)) fail("result unit is not the source-relation SI dimension");
    const requested = binding.evidenceFactIds.map(id => problem.facts.find(fact => fact.id === id));
    if (!requested.length || requested.some(fact => !fact || fact.kind !== "requested" ||
      !problem.question.slice(relation.requested.start, Math.min(problem.question.length, relation.requested.end + 1)).includes(fact.evidence.quote) ||
      !new RegExp(`(?<![A-Za-z0-9_])${escape(relation.symbol)}(?![A-Za-z0-9_])`).test(fact.evidence.quote))) fail("result binding lacks original requested-output evidence");
    return { status: "certified", certificate: { version: "source-scalar-relation/v1", requestId: request.id,
      symbol: binding.symbol, unit: binding.unit, approximate: relation.approximate, errorBound: relation.errorBound,
      ...(relation.exact ? { exact: relation.exact } : {}),
      evidence: { relation: relation.relation, requested: { start: relation.requested.start, end: relation.requested.end }, inputs: relation.inputSpans } } };
  } catch (error) { return { status: "unproved", reason: error instanceof Error ? error.message : "source relation is unsupported" }; }
}
