/**
 * Pure admission for teaching WRITE text, before either ink or segment TTS.
 * This checks arithmetic, not source truth, units, algebra or spoken prose.
 *
 * Literals on the LHS are exact as printed (no inferred measurement error).
 * Decimal/scientific RHS literals round to their printed last place, with ties
 * away from zero; bare integer equality is exact. Approximation also permits
 * integer rounding. Thus 2.513²=6.315 passes, =6.316 fails, and 2.51²≈6.30
 * passes. No percentage tolerance, eval, symbol substitution or ink correction.
 * Approximate expression answers without printed literal precision abstain
 * unless exactly equal (e.g. pi≈22/7 has no declared rounding place).
 * Chains compare each answer to the original computation, never a rounded
 * intermediate. Cross-row comparison requires caller-bound scope AND role,
 * identical labels, a fresh numeric computation, and no intervening rebinding.
 */
export const TEACHING_ARITHMETIC_LIMITS = Object.freeze({
  rowCharacters: 1024, tokens: 256, depth: 32, exponent: 64,
  literalDigits: 40, scientificExponent: 100, rationalDigits: 256,
  segmentRows: 64, priorRows: 32, restatementDistance: 6, chainSides: 8,
});

export interface TeachingArithmeticBinding {
  /** Explicit same quantity/step scope from the caller, never inferred from ink. */
  scopeId: string;
  roleId: string;
}
export type TeachingArithmeticRow = string | {
  text: string;
  binding?: TeachingArithmeticBinding;
};
export interface TeachingArithmeticProof {
  row: string;
  left: string;
  right: string;
  relation: "=" | "≈";
  expected: number;
  expectedExact: string;
  expectedBounds: { lower: string; upper: string };
  claimed: number;
  roundedExpected?: string;
  sourceRow?: string;
}
export type TeachingArithmeticEvaluation = {
  verdict: "supported";
  expected: number;
  expectedExact: string;
  expectedBounds: { lower: string; upper: string };
} | { verdict: "unsupported"; reason: string };
export type TeachingArithmeticVerdict =
  | { verdict: "correct"; supported: true; row: string; proofs: TeachingArithmeticProof[] }
  | { verdict: "false"; supported: true; row: string; proof: TeachingArithmeticProof }
  | { verdict: "supported"; supported: true; row: string; evaluation: Extract<TeachingArithmeticEvaluation, { verdict: "supported" }> }
  | { verdict: "unsupported"; supported: false; row: string; reason: string };
export interface TeachingArithmeticAdmission {
  /** False only for proved false arithmetic or an oversized segment. */
  admitted: boolean;
  verdicts: TeachingArithmeticVerdict[];
  falseRows: Extract<TeachingArithmeticVerdict, { verdict: "false" }>[];
  retryProof?: string;
  reason?: string;
}

class Unsupported extends Error {}
type Rational = { n: bigint; d: bigint };
type Interval = { lo: Rational; hi: Rational };
const ZERO: Rational = { n: 0n, d: 1n };
const ONE: Rational = { n: 1n, d: 1n };
const abs = (n: bigint) => n < 0n ? -n : n;
function rational(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new Unsupported("division by zero");
  if (d < 0n) { n = -n; d = -d; }
  let a = abs(n), b = d;
  while (b !== 0n) { const remainder = a % b; a = b; b = remainder; }
  n /= a; d /= a;
  if (abs(n).toString().length > TEACHING_ARITHMETIC_LIMITS.rationalDigits ||
      d.toString().length > TEACHING_ARITHMETIC_LIMITS.rationalDigits) {
    throw new Unsupported("rational complexity limit");
  }
  return { n, d };
}
const cmp = (a: Rational, b: Rational) => {
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
};
const add = (a: Rational, b: Rational) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const neg = (a: Rational) => ({ n: -a.n, d: a.d });
const mul = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d);
const divide = (a: Rational, b: Rational) => rational(a.n * b.d, a.d * b.n);
const point = (a: Rational): Interval => ({ lo: a, hi: a });
const exact = (i: Interval) => cmp(i.lo, i.hi) === 0;
const fractionText = (a: Rational) => a.d === 1n ? String(a.n) : `${a.n}/${a.d}`;
const numeric = (a: Rational) => Number(a.n) / Number(a.d);
const midpoint = (i: Interval) => divide(add(i.lo, i.hi), rational(2n));
function intervalProduct(a: Interval, b: Interval): Interval {
  const values = [mul(a.lo, b.lo), mul(a.lo, b.hi), mul(a.hi, b.lo), mul(a.hi, b.hi)];
  values.sort(cmp);
  return { lo: values[0], hi: values[3] };
}
function intervalDivide(a: Interval, b: Interval): Interval {
  if (cmp(b.lo, ZERO) <= 0 && cmp(b.hi, ZERO) >= 0) {
    throw new Unsupported("divisor is zero or not bounded away from zero");
  }
  return intervalProduct(a, { lo: divide(ONE, b.hi), hi: divide(ONE, b.lo) });
}
function power(a: Interval, b: Interval): Interval {
  if (!exact(b) || b.lo.d !== 1n || abs(b.lo.n) > BigInt(TEACHING_ARITHMETIC_LIMITS.exponent)) {
    throw new Unsupported("only bounded integer powers are supported");
  }
  const exponent = Number(b.lo.n);
  if (exponent === 0) {
    if (cmp(a.lo, ZERO) <= 0 && cmp(a.hi, ZERO) >= 0) throw new Unsupported("zero to zero power");
    return point(ONE);
  }
  if (exponent < 0) return intervalDivide(point(ONE), power(a, point(rational(BigInt(-exponent)))));
  const raise = (v: Rational) => rational(v.n ** BigInt(exponent), v.d ** BigInt(exponent));
  const ends = [raise(a.lo), raise(a.hi)].sort(cmp);
  if (exponent % 2 === 0 && cmp(a.lo, ZERO) <= 0 && cmp(a.hi, ZERO) >= 0) ends[0] = ZERO;
  return { lo: ends[0], hi: ends[1] };
}

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function decimal(text: string): { value: Rational; quantum: Rational; rounded: boolean } {
  const [mantissa, exponentText] = text.toLowerCase().split("e");
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > TEACHING_ARITHMETIC_LIMITS.scientificExponent) {
    throw new Unsupported("scientific exponent limit");
  }
  const digits = mantissa.replace(".", "");
  if (digits.length > TEACHING_ARITHMETIC_LIMITS.literalDigits) throw new Unsupported("literal digit limit");
  const places = mantissa.includes(".") ? mantissa.length - mantissa.indexOf(".") - 1 : 0;
  const shift = exponent - places;
  const quantum = shift >= 0 ? rational(10n ** BigInt(shift)) : rational(1n, 10n ** BigInt(-shift));
  return { value: mul(rational(BigInt(digits)), quantum), quantum, rounded: places > 0 || exponentText !== undefined };
}
// Consecutive decimal bounds contain pi; no model or supplied planner scalar.
const PI: Interval = {
  lo: rational(314159265358979323846264338327950288n, 10n ** 35n),
  hi: rational(314159265358979323846264338327950289n, 10n ** 35n),
};
const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5",
  "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+",
};
function normalize(source: string): string {
  if (source.length > TEACHING_ARITHMETIC_LIMITS.rowCharacters) throw new Unsupported("row character limit");
  if (/[,;\n\r]/.test(source)) throw new Unsupported("multiple rows, comma or separator");
  let text = source.trim();
  if (text.startsWith("$$") && text.endsWith("$$")) text = text.slice(2, -2);
  else if (text.startsWith("$") && text.endsWith("$")) text = text.slice(1, -1);
  else if (text.startsWith("\\(") && text.endsWith("\\)")) text = text.slice(2, -2);
  else if (text.startsWith("\\[") && text.endsWith("\\]")) text = text.slice(2, -2);
  return text.replace(/\\(?:left|right)(?=[(){}])/g, "")
    .replace(/\\(?:cdot|times)\b/g, "*").replace(/\\div\b/g, "/")
    .replace(/\\(?:approx|simeq)\b/g, "≈").replace(/\\pi\b|π/g, "pi")
    .replace(/\\[,! ]/g, " ").replace(/−/g, "-")
    .replace(/[×·]/g, "*").replace(/÷/g, "/")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (run) => `^(${[...run].map((c) => SUPERSCRIPTS[c]).join("")})`);
}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) { index++; continue; }
    const rest = source.slice(index);
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (match) { tokens.push(match[0]); index += match[0].length; }
    else if (rest.startsWith("pi")) { tokens.push("pi"); index += 2; }
    else {
      const frac = /^\\(?:frac|dfrac|tfrac)\b/.exec(rest);
      if (frac) { tokens.push("frac"); index += frac[0].length; }
      else if ("+-*/^(){}".includes(source[index])) { tokens.push(source[index++]); }
      else throw new Unsupported("symbol, unit or unsupported syntax");
    }
    if (tokens.length > TEACHING_ARITHMETIC_LIMITS.tokens) throw new Unsupported("token limit");
  }
  return tokens;
}

class Parser {
  private at = 0;
  private depth = 0;
  operations = 0;
  constructor(private readonly tokens: string[]) {}
  private peek() { return this.tokens[this.at]; }
  private take() { return this.tokens[this.at++]; }
  private nested<T>(read: () => T): T {
    if (++this.depth > TEACHING_ARITHMETIC_LIMITS.depth) throw new Unsupported("expression depth limit");
    try { return read(); } finally { this.depth--; }
  }
  parse(): Interval {
    const result = this.sum();
    if (this.at !== this.tokens.length) throw new Unsupported("unconsumed or adjacent tokens");
    return result;
  }
  private sum(): Interval {
    let result = this.product();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.take(), rhs = this.product();
      result = op === "+" ? { lo: add(result.lo, rhs.lo), hi: add(result.hi, rhs.hi) }
        : { lo: add(result.lo, neg(rhs.hi)), hi: add(result.hi, neg(rhs.lo)) };
      this.operations++;
    }
    return result;
  }
  private product(): Interval {
    let result = this.unary(), divided = false;
    while (true) {
      const token = this.peek();
      const implicit = token === "(" || token === "{" || token === "pi" || token === "frac" ||
        (NUMBER.test(token ?? "") && [")", "}"].includes(this.tokens[this.at - 1]));
      if (token !== "*" && token !== "/" && !implicit) break;
      if (implicit && token === "frac" && /^\d+$/.test(this.tokens[this.at - 1] ?? ""))
        throw new Unsupported("integer/fraction juxtaposition can denote a mixed number");
      if (implicit && divided) throw new Unsupported("ambiguous division and implicit multiplication");
      if (!implicit) this.take();
      const rhs = this.unary();
      result = token === "/" ? intervalDivide(result, rhs) : intervalProduct(result, rhs);
      divided ||= token === "/";
      this.operations++;
    }
    return result;
  }
  private unary(): Interval {
    return this.nested(() => {
      if (this.peek() === "+" || this.peek() === "-") {
        const sign = this.take(), value = this.unary();
        return sign === "-" ? { lo: neg(value.hi), hi: neg(value.lo) } : value;
      }
      let result = this.atom();
      if (this.peek() === "^") { this.take(); result = power(result, this.unary()); this.operations++; }
      return result;
    });
  }
  private group(open: string): Interval {
    if (this.take() !== open) throw new Unsupported("fraction requires braced arguments");
    const result = this.nested(() => this.sum());
    if (this.take() !== (open === "(" ? ")" : "}")) throw new Unsupported("unbalanced grouping");
    return result;
  }
  private atom(): Interval {
    const token = this.peek();
    if (token === "(" || token === "{") return this.group(token);
    this.take();
    if (token === "pi") return PI;
    if (token === "frac") {
      const numerator = this.group("{"), denominator = this.group("{");
      this.operations++;
      return intervalDivide(numerator, denominator);
    }
    if (NUMBER.test(token ?? "")) return point(decimal(token).value);
    throw new Unsupported("missing operand or malformed syntax");
  }
}
function expression(source: string) {
  const parser = new Parser(tokenize(source));
  return { interval: parser.parse(), operations: parser.operations };
}
function evaluation(interval: Interval): Extract<TeachingArithmeticEvaluation, { verdict: "supported" }> {
  return {
    verdict: "supported", expected: numeric(midpoint(interval)),
    expectedExact: exact(interval) ? fractionText(interval.lo) : `[${fractionText(interval.lo)}, ${fractionText(interval.hi)}]`,
    expectedBounds: { lower: fractionText(interval.lo), upper: fractionText(interval.hi) },
  };
}
function unsupportedReason(error: unknown): string {
  // Only our own parse/complexity errors are part of the supported contract.
  if (error instanceof Unsupported) return error.message;
  throw error;
}
export function evaluateTeachingArithmetic(source: string): TeachingArithmeticEvaluation {
  try { return evaluation(expression(normalize(source)).interval); }
  catch (error) { return { verdict: "unsupported", reason: unsupportedReason(error) }; }
}

function roundUnits(value: Rational, quantum: Rational): bigint {
  const scaled = divide(value, quantum), n = abs(scaled.n);
  const units = n / scaled.d + (2n * (n % scaled.d) >= scaled.d ? 1n : 0n);
  return scaled.n < 0n ? -units : units;
}
function printedLiteral(source: string) {
  let tokens = tokenize(source), negative = false;
  // Parentheses/braces and unary signs do not erase a literal's precision.
  while (tokens.length > 1) {
    if (tokens[0] === "+" || tokens[0] === "-") {
      if (tokens[0] === "-") negative = !negative;
      tokens = tokens.slice(1);
      continue;
    }
    if (tokens[0] !== "(" && tokens[0] !== "{") return undefined;
    let depth = 0, encloses = true;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === "(" || tokens[i] === "{") depth++;
      if (tokens[i] === ")" || tokens[i] === "}") depth--;
      if (depth === 0 && i !== tokens.length - 1) { encloses = false; break; }
    }
    if (!encloses) return undefined;
    tokens = tokens.slice(1, -1);
  }
  if (tokens.length !== 1 || !NUMBER.test(tokens[0])) return undefined;
  const literal = decimal(tokens[0]);
  return { ...literal, value: negative ? neg(literal.value) : literal.value };
}
function compareAnswer(expected: Interval, source: string, relation: "=" | "≈", claimed: Interval) {
  const literal = printedLiteral(source);
  if (literal && (literal.rounded || relation === "≈")) {
    const lower = roundUnits(expected.lo, literal.quantum), upper = roundUnits(expected.hi, literal.quantum);
    if (lower !== upper) throw new Unsupported("expected interval crosses a rounding boundary");
    const rounded = mul(rational(lower), literal.quantum);
    return { correct: cmp(rounded, literal.value) === 0, roundedExpected: String(numeric(rounded)) };
  }
  if (exact(expected) && exact(claimed) && cmp(expected.lo, claimed.lo) === 0) return { correct: true };
  if (relation === "≈") throw new Unsupported("approximate expression answer has no printed precision");
  if (exact(expected) && exact(claimed)) return { correct: false };
  if (cmp(expected.hi, claimed.lo) < 0 || cmp(claimed.hi, expected.lo) < 0) return { correct: false };
  throw new Unsupported("interval equality cannot be proved");
}

const rowText = (row: TeachingArithmeticRow) => typeof row === "string" ? row : row.text;
const rowBinding = (row: TeachingArithmeticRow) => typeof row === "string" ? undefined : row.binding;
function validBinding(binding: TeachingArithmeticBinding | undefined): binding is TeachingArithmeticBinding {
  return !!binding && binding.scopeId.length <= 128 && binding.roleId.length <= 128 &&
    binding.scopeId.trim().length > 0 && binding.roleId.trim().length > 0;
}
function equation(row: string) {
  const text = normalize(row), sides = text.split(/[=≈]/).map((part) => part.trim());
  const relations = (text.match(/[=≈]/g) ?? []) as ("=" | "≈")[];
  if (sides.length < 2 || sides.some((s) => !s) || sides.length > TEACHING_ARITHMETIC_LIMITS.chainSides) {
    throw new Unsupported("missing equality, empty side or chain limit");
  }
  let label: string | undefined;
  if (sides[0] !== "pi" && /^(?:[A-Za-z][A-Za-z0-9_]*|\|[A-Za-z][A-Za-z0-9_]*\|)$/.test(sides[0])) {
    label = sides.shift(); relations.shift();
  }
  const expressions = sides.map(expression); // Parse the entire row before judging any subclaim.
  return { label, sides, relations, expressions };
}

/** Unsupported rows are explicit abstentions. Only `false` proves a contradiction. */
export function checkTeachingArithmeticRow(
  row: TeachingArithmeticRow,
  priorRows: readonly TeachingArithmeticRow[] = [],
): TeachingArithmeticVerdict {
  const text = rowText(row);
  try {
    if (priorRows.length > TEACHING_ARITHMETIC_LIMITS.priorRows) throw new Unsupported("prior row limit");
    const parsed = equation(text);
    let expected = parsed.expressions[0].interval;
    let left = parsed.sides[0], sourceRow: string | undefined;
    if (parsed.expressions.length === 1) {
      const current = rowBinding(row);
      if (parsed.expressions[0].operations > 0) {
        return { verdict: "supported", supported: true, row: text, evaluation: evaluation(expected) };
      }
      if (!parsed.label || !validBinding(current)) throw new Unsupported("unbound symbolic assignment");
      for (let i = priorRows.length - 1; i >= Math.max(0, priorRows.length - TEACHING_ARITHMETIC_LIMITS.restatementDistance); i--) {
        const previous = priorRows[i], binding = rowBinding(previous);
        if (!validBinding(binding) || binding.scopeId !== current.scopeId || binding.roleId !== current.roleId) continue;
        const prior = equation(rowText(previous));
        if (prior.label !== parsed.label || prior.expressions.length !== 1 || prior.expressions[0].operations === 0) {
          throw new Unsupported("latest role binding is not a fresh numeric computation");
        }
        expected = prior.expressions[0].interval; left = prior.sides[0]; sourceRow = rowText(previous);
        break;
      }
      if (sourceRow === undefined) throw new Unsupported("no fresh computation with matching role and scope");
    }
    const proofs: TeachingArithmeticProof[] = [];
    const start = sourceRow ? 0 : 1;
    for (let i = start; i < parsed.expressions.length; i++) {
      const relation = sourceRow ? (normalize(text).includes("≈") ? "≈" : "=") : parsed.relations[i - 1];
      const comparison = compareAnswer(expected, parsed.sides[i], relation, parsed.expressions[i].interval);
      const { expected: value, expectedExact, expectedBounds } = evaluation(expected);
      const proof: TeachingArithmeticProof = {
        row: text, left, right: parsed.sides[i], relation,
        expected: value, expectedExact, expectedBounds,
        claimed: numeric(midpoint(parsed.expressions[i].interval)),
        ...(comparison.roundedExpected === undefined ? {} : { roundedExpected: comparison.roundedExpected }),
        ...(sourceRow === undefined ? {} : { sourceRow }),
      };
      proofs.push(proof);
      if (!comparison.correct) return { verdict: "false", supported: true, row: text, proof };
    }
    return { verdict: "correct", supported: true, row: text, proofs };
  } catch (error) {
    return { verdict: "unsupported", supported: false, row: text, reason: unsupportedReason(error) };
  }
}

/** Call on the complete buffered segment BEFORE scheduling any WRITE or TTS.
 * On false, discard/retry the whole segment using retryProof; never replace ink
 * while playing the old speech. `admitted` does not certify unsupported rows.
 * Caller supplies only previously admitted rows from this same turn/step.
 */
export function admitTeachingArithmetic(
  rows: readonly TeachingArithmeticRow[], priorRows: readonly TeachingArithmeticRow[] = [],
): TeachingArithmeticAdmission {
  if (rows.length > TEACHING_ARITHMETIC_LIMITS.segmentRows || priorRows.length > TEACHING_ARITHMETIC_LIMITS.priorRows) {
    return { admitted: false, verdicts: [], falseRows: [], reason: "segment or prior row limit; split the buffer" };
  }
  const history = [...priorRows];
  const verdicts: TeachingArithmeticVerdict[] = [];
  for (const row of rows) {
    const result = checkTeachingArithmeticRow(row, history);
    verdicts.push(result);
    history.push(row);
    if (history.length > TEACHING_ARITHMETIC_LIMITS.priorRows) history.shift();
  }
  const falseRows = verdicts.filter((v): v is Extract<TeachingArithmeticVerdict, { verdict: "false" }> => v.verdict === "false");
  const retryProof = falseRows.length === 0 ? undefined : falseRows.map(({ proof }) =>
    `False WRITE row: ${JSON.stringify(proof.row)}. Independently computed ${proof.left} = ${proof.expected} ` +
    `(exact/bounds: ${proof.expectedExact})${proof.roundedExpected === undefined ? "" : `; at the printed RHS precision: ${proof.roundedExpected}`}. ` +
    `Discard and regenerate the complete segment's narration and WRITE together.`).join("\n");
  return { admitted: falseRows.length === 0, verdicts, falseRows, ...(retryProof === undefined ? {} : { retryProof }) };
}
