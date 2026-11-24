import { exactBinary64 } from "./exactBinary64";
import {
  Q_ONE, Q_ZERO, addRational, compareRational,
  divideRational, exactRationalToNumber, multiplyRational, negateRational,
  parseRational, rational, serializeRational,
  type Rational,
} from "./exactRational";

import { chargeExpressionSteps } from "../compile/figureWork";

const MAX_EXPRESSION_LENGTH = 256;
const MAX_TOKENS = 128;
// Recursive-descent precedence layers consume several stack levels for each
// explicit AST node. Keep this above ProblemIR's 24-node-depth ceiling while
// the independent token and evaluation budgets continue to bound work.
const MAX_PARSE_DEPTH = 128;
const MAX_EVALUATION_STEPS = 512;
const MAX_ABSOLUTE_VALUE = 1e12;

type BinaryOperator = "+" | "-" | "*" | "/" | "^";
type UnaryOperator = "+" | "-";
type FunctionName = keyof typeof FUNCTIONS;

type VariableName = "x" | "y";

type ExpressionNode =
  | { kind: "number"; value: number; literal?: string; exactConstant?: "pi" | "e" }
  | { kind: "variable"; name: VariableName }
  | { kind: "unary"; operator: UnaryOperator; value: ExpressionNode }
  | { kind: "binary"; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode }
  | { kind: "function"; name: FunctionName; argument: ExpressionNode };

type Token =
  | { kind: "number"; value: number; literal: string; position: number }
  | { kind: "identifier"; value: string; position: number }
  | { kind: "operator"; value: BinaryOperator; position: number }
  | { kind: "leftParen"; position: number }
  | { kind: "rightParen"; position: number }
  | { kind: "end"; position: number };

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
} as const;

export interface ParsedMathExpression {
  readonly source: string;
  /** Structural identity after the parser's documented notation normalization. */
  readonly syntaxKey: string;
  evaluate(x: number): number;
  derivative(x: number): number;
  secondDerivative(x: number): number;
  /**
   * Value and analytic derivatives with conservative ABSOLUTE error bounds.
   * x is the exact supplied binary64, decimal tokens are source rationals,
   * and pi/e keep their symbolic identities. An unresolved zero has a nonzero
   * bound; domain, precision or work-budget failures throw. Both objects freeze.
   */
  certifiedJetAt(x: number): CertifiedMathJet;
  /** Source-rational outward bounds over the whole closed domain, never sampled bounds. */
  intervalBoundsOn(xMin: number, xMax: number): { low: number; high: number };
  assertContinuousOn(xMin: number, xMax: number): void;
}

export interface CertifiedMathJet {
  readonly value: number;
  readonly derivative: number;
  readonly secondDerivative: number;
  readonly errorBounds: Readonly<{ value: number; derivative: number; secondDerivative: number }>;
  /** Present only when the value is algebraically proved to be k*pi/2. */
  readonly exactQuarterTurns?: number;
}

export interface ParsedMathExpression2D {
  readonly source: string;
  evaluate(x: number, y: number): number;
  assertContinuousOn(xMin: number, xMax: number, yMin: number, yMax: number): void;
}

/** Preserve lexer token boundaries while spelling implicit products out.
 * In particular, `2 e + 1` and the single number token `2e+1` differ. */
export function normalizeMathProductNotation(value: string, options: { allowConstantParentheses?: boolean } = {}): string {
  if (value.length > MAX_EXPRESSION_LENGTH * 2 + 8) throw new Error("expression notation too long");
  const source = normalizePlainMathSource(value), tokens = tokenize(source);
  let result = "";
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index]!, previous = tokens[index - 1];
    if (previous?.kind === "number" && token.kind === "number") throw new Error("separate number tokens need an operator");
    if (previous?.kind === "identifier" && (token.kind === "identifier" || token.kind === "number" ||
        token.kind === "leftParen" && ["pi", "e"].includes(previous.value) && !options.allowConstantParentheses)) throw new Error("ambiguous identifier product needs an operator");
    const ends = previous && ["number", "identifier", "rightParen"].includes(previous.kind);
    const starts = ["number", "identifier", "leftParen"].includes(token.kind);
    const call = previous?.kind === "identifier" && token.kind === "leftParen" && !["x", "y", "pi", "e"].includes(previous.value);
    if (ends && starts && !call) result += "*";
    result += source.slice(token.position, tokens[index + 1]!.position).trim();
  }
  return result;
}

/** Prove structural or bounded rational-polynomial identity. This never treats
 * agreement at sampled points as equality. Identical non-polynomial subtrees remain opaque terms;
 * their domains are retained rather than canceled against missing terms. */
export function mathExpressionsEquivalent(left: string, right: string, options: { allowNonzeroScale?: boolean } = {}): boolean {
  try {
    const read = (source: string) => {
      if (source.length > MAX_EXPRESSION_LENGTH * 2 + 8) throw new Error("identity expression too long");
      return new Parser(tokenize(normalizePlainMathSource(source)), new Set<VariableName>(["x", "y"])).parse();
    };
    const one = (node: ExpressionNode) => {
      if (node.kind !== "number" || node.value !== 1) return false;
      const value = rationalPolynomials([node]).values[0]!.get("0,0");
      return value !== undefined && value.n === value.d;
    };
    const simplify = (node: ExpressionNode): ExpressionNode => {
      if (node.kind === "unary") {
        const value = simplify(node.value);
        if (node.operator === "+") return value;
        if (value.kind === "unary" && value.operator === "-") return value.value;
        return { ...node, value };
      }
      if (node.kind === "function") return { ...node, argument: simplify(node.argument) };
      if (node.kind !== "binary") return node;
      const l = simplify(node.left), r = simplify(node.right);
      if ((node.operator === "+" || node.operator === "-") && r.kind === "number" && r.value === 0) return l;
      if (node.operator === "+" && l.kind === "number" && l.value === 0) return r;
      if ((node.operator === "*" || node.operator === "/" || node.operator === "^") && one(r)) return l;
      if (node.operator === "*" && one(l)) return r;
      return { ...node, left: l, right: r };
    };
    const relationBase = (node: ExpressionNode): ExpressionNode => {
      if (!options.allowNonzeroScale) return node;
      if (node.kind === "unary") return relationBase(node.value);
      if (node.kind === "binary" && (node.operator === "*" || node.operator === "/") && node.right.kind === "number" && node.right.value !== 0) return relationBase(node.left);
      if (node.kind === "binary" && node.operator === "*" && node.left.kind === "number" && node.left.value !== 0) return relationBase(node.right);
      return node;
    };
    const a = relationBase(simplify(read(left))), b = relationBase(simplify(read(right)));
    if (JSON.stringify(a) === JSON.stringify(b)) return true;
    if (options.allowNonzeroScale && a.kind === "binary" && b.kind === "binary" && a.operator === "-" && b.operator === "-" &&
        JSON.stringify(a.left) === JSON.stringify(b.right) && JSON.stringify(a.right) === JSON.stringify(b.left)) return true;
    const [x, y] = rationalPolynomials([a, b], true).values as [Polynomial, Polynomial];
    if (x.size !== y.size || [...x.keys()].some(key => !y.has(key))) return false;
    if (x.size === 0) return true;
    const key = x.keys().next().value!;
    const xc = options.allowNonzeroScale ? x.get(key)! : { n: 1n, d: 1n };
    const yc = options.allowNonzeroScale ? y.get(key)! : { n: 1n, d: 1n };
    return [...x].every(([term, value]) => {
      const other = y.get(term)!;
      return value.n * yc.n * other.d * xc.d === other.n * xc.n * value.d * yc.d;
    });
  } catch { return false; }
}

type Fraction = { n: bigint; d: bigint };
type Polynomial = Map<string, Fraction>;
type ConstantInterval = { lo: number; hi: number };

/** Shared exact coefficient algebra; all consumers retain its work limits. */
function rationalPolynomials(roots: readonly ExpressionNode[], retainOpaqueTerms = false) {
  const constantAtoms = new Map<number, ExpressionNode>();
  const constantRanges = new Map<number, ConstantInterval>();
  const atoms = new Map<string, number>();
  const domains: Set<string>[] = [];
  let domain: Set<string>;
  let remaining = 16_384;
  const step = () => { chargeExpressionSteps(1); if (--remaining < 0) throw new Error("identity work limit"); };
  const fraction = (n: bigint, d = 1n): Fraction => {
    step();
    if (d === 0n || n.toString(2).length > 2048 || d.toString(2).length > 2048) throw new Error("identity coefficient limit");
    if (d < 0n) { n = -n; d = -d; }
    let x = n < 0n ? -n : n, y = d;
    while (y) { const remainder = x % y; x = y; y = remainder; }
    return { n: n / x, d: d / x };
  };
  const number = (value: number, literal = String(value)): Fraction => {
    if (!Number.isFinite(value)) throw new Error("nonfinite coefficient");
    const [mantissa, exponent = "0"] = literal.toLowerCase().split("e");
    const decimals = mantissa!.split(".")[1]?.length ?? 0;
    const scale = decimals - Number(exponent);
    if (!Number.isSafeInteger(scale) || Math.abs(scale) > 616) throw new Error("identity literal scale limit");
    return fraction(BigInt(mantissa!.replace(".", "")) * 10n ** BigInt(Math.max(0, -scale)), 10n ** BigInt(Math.max(0, scale)));
  };
  const constant = (value: Fraction): Polynomial => value.n === 0n ? new Map() : new Map([["0,0", value]]);
  const put = (poly: Polynomial, key: string, value: Fraction) => {
    const old = poly.get(key);
    const sum = old ? fraction(old.n * value.d + value.n * old.d, old.d * value.d) : value;
    if (sum.n) poly.set(key, sum); else poly.delete(key);
    if (poly.size > 128) throw new Error("identity term limit");
  };
  const multiply = (x: Polynomial, y: Polynomial): Polynomial => {
    const result: Polynomial = new Map();
    for (const [u, c] of x) for (const [v, d] of y) {
      step();
      const left = u.split(",").map(Number), right = v.split(",").map(Number);
      const powers = Array.from({ length: Math.max(left.length, right.length) }, (_, i) => (left[i] ?? 0) + (right[i] ?? 0));
      if (powers.reduce((sum, power) => sum + power, 0) > 16) throw new Error("identity degree limit");
      while (powers.length > 2 && powers.at(-1) === 0) powers.pop();
      put(result, powers.join(","), fraction(c.n * d.n, c.d * d.d));
    }
    return result;
  };
  const atomKey = (node: ExpressionNode) => JSON.stringify(node, (_key, value: unknown) => {
    if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "number" || !("literal" in value) || typeof value.literal !== "string") return value;
    // Canonicalize the decimal token itself, never its rounded Number value.
    // Thus 2.0 and 2e0 agree while 1.0000000000000000001 remains distinct.
    const [mantissa, exponent = "0"] = value.literal.toLowerCase().split("e");
    const decimals = mantissa!.split(".")[1]?.length ?? 0;
    const digits = mantissa!.replace(".", "").replace(/^0+/u, "");
    const trailing = /0+$/u.exec(digits)?.[0].length ?? 0;
    const literal = digits ? `${digits.slice(0, digits.length - trailing)}e${Number(exponent) - decimals + trailing}` : "0";
    return { ...value, literal };
  });
  const adjacent = (value: number, up: boolean): number => {
    if (!Number.isFinite(value)) throw new Error("nonfinite constant bound");
    if (value === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    let bits = view.getBigUint64(0);
    bits += (value > 0) === up ? 1n : -1n;
    view.setBigUint64(0, bits);
    const result = view.getFloat64(0);
    if (!Number.isFinite(result)) throw new Error("constant bound outside numeric range");
    return result;
  };
  const binaryFraction = (value: number): Fraction => {
    if (value === 0) return { n: 0n, d: 1n };
    const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
    const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
    const mantissa = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
    const power = exponent ? exponent - 1075 : -1074;
    const sign = bits >> 63n ? -1n : 1n;
    return { n: sign * mantissa * (power > 0 ? 1n << BigInt(power) : 1n), d: power < 0 ? 1n << BigInt(-power) : 1n };
  };
  const fractionBounds = (value: Fraction, scale: Fraction = { n: 1n, d: 1n }): ConstantInterval => {
    step();
    let n = value.n * scale.d, d = value.d * scale.n;
    if (d === 0n) throw new Error("zero constant scale");
    if (d < 0n) { n = -n; d = -d; }
    if (n === 0n) return { lo: 0, hi: 0 };
    const abs = (v: bigint) => v < 0n ? -v : v;
    const sn = Math.max(0, abs(n).toString(2).length - 53), sd = Math.max(0, d.toString(2).length - 53);
    const estimate = (n < 0n ? -1 : 1) * Number(abs(n) >> BigInt(sn)) / Number(d >> BigInt(sd)) * 2 ** (sn - sd);
    if (!Number.isFinite(estimate)) throw new Error("constant fraction outside numeric range");
    const compare = (candidate: number) => {
      step(); const f = binaryFraction(candidate); const delta = n * f.d - f.n * d;
      return delta < 0n ? -1 : delta > 0n ? 1 : 0;
    };
    let lo = estimate, hi = estimate;
    const direction = compare(estimate);
    if (direction === 0) return { lo, hi };
    for (let i = 0; i < 4; i++) {
      if (direction > 0) { hi = adjacent(hi, true); if (compare(hi) <= 0) return { lo, hi }; lo = hi; }
      else { lo = adjacent(lo, false); if (compare(lo) >= 0) return { lo, hi }; hi = lo; }
    }
    throw new Error("constant fraction enclosure failed");
  };
  const outward = (values: number[]): ConstantInterval => {
    step();
    if (values.some(value => !Number.isFinite(value))) throw new Error("nonfinite constant interval");
    return { lo: adjacent(Math.min(...values), false), hi: adjacent(Math.max(...values), true) };
  };
  const addIntervals = (a: ConstantInterval, b: ConstantInterval) => a.lo === 0 && a.hi === 0 ? b : b.lo === 0 && b.hi === 0 ? a : outward([a.lo + b.lo, a.hi + b.hi]);
  const multiplyIntervals = (a: ConstantInterval, b: ConstantInterval): ConstantInterval => {
    if (a.lo === 0 && a.hi === 0 || b.lo === 0 && b.hi === 0) return { lo: 0, hi: 0 };
    if (a.lo === 1 && a.hi === 1) return b;
    if (b.lo === 1 && b.hi === 1) return a;
    return outward([a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi]);
  };
  const powerInterval = (base: ConstantInterval, exponent: ConstantInterval, integer: boolean): ConstantInterval => {
    if (exponent.lo === 1 && exponent.hi === 1) return base;
    if (!integer && base.lo < 0 || base.lo <= 0 && base.hi >= 0 && exponent.lo <= 0) throw new Error("unproved constant power domain");
    const values = [base.lo ** exponent.lo, base.lo ** exponent.hi, base.hi ** exponent.lo, base.hi ** exponent.hi];
    if (integer && exponent.lo === exponent.hi && exponent.lo > 0 && exponent.lo % 2 === 0 && base.lo <= 0 && base.hi >= 0) values.push(0);
    if (base.lo <= 1 && base.hi >= 1 || exponent.lo <= 0 && exponent.hi >= 0) values.push(1);
    return outward(values);
  };
  const exactCache = new WeakMap<ExpressionNode, Fraction | null>();
  const exactConstant = (node: ExpressionNode): Fraction | null => {
    step();
    if (exactCache.has(node)) return exactCache.get(node)!;
    let result: Fraction | null = null;
    if (node.kind === "number") result = number(node.value, node.literal);
    else if (node.kind === "unary") {
      const value = exactConstant(node.value); if (value) result = fraction(node.operator === "-" ? -value.n : value.n, value.d);
    } else if (node.kind === "binary") {
      const a = exactConstant(node.left), b = exactConstant(node.right);
      if (a && b) {
        if (node.operator === "+" || node.operator === "-") result = fraction(a.n * b.d + (node.operator === "+" ? b.n : -b.n) * a.d, a.d * b.d);
        else if (node.operator === "*") result = fraction(a.n * b.n, a.d * b.d);
        else if (node.operator === "/") result = fraction(a.n * b.d, a.d * b.n);
        else if (b.d === 1n && b.n >= -16n && b.n <= 16n) {
          const power = b.n < 0n ? -b.n : b.n;
          result = b.n < 0n ? fraction(a.d ** power, a.n ** power) : fraction(a.n ** power, a.d ** power);
        }
      }
    }
    exactCache.set(node, result); return result;
  };
  const intervalCache = new WeakMap<ExpressionNode, ConstantInterval>();
  const constantInterval = (node: ExpressionNode): ConstantInterval => {
    step();
    const cached = intervalCache.get(node); if (cached) return cached;
    const exact = exactConstant(node);
    if (exact) { const result = fractionBounds(exact); intervalCache.set(node, result); return result; }
    let result: ConstantInterval;
    if (node.kind === "variable" || node.kind === "number") throw new Error("unproved constant expression");
    if (node.kind === "unary") {
      const value = constantInterval(node.value); result = node.operator === "-" ? { lo: -value.hi, hi: -value.lo } : value;
    } else if (node.kind === "binary") {
      const a = constantInterval(node.left), b = constantInterval(node.right);
      if (node.operator === "+") result = addIntervals(a, b);
      else if (node.operator === "-") result = addIntervals(a, { lo: -b.hi, hi: -b.lo });
      else if (node.operator === "*") result = multiplyIntervals(a, b);
      else if (node.operator === "/") {
        if (b.lo <= 0 && b.hi >= 0) throw new Error("unproved nonzero constant divisor");
        result = outward([a.lo / b.lo, a.lo / b.hi, a.hi / b.lo, a.hi / b.hi]);
      } else result = powerInterval(a, b, exactConstant(node.right)?.d === 1n);
    } else {
      const a = constantInterval(node.argument), fn = FUNCTIONS[node.name];
      if (node.name === "sqrt" && a.lo < 0 || ["log", "ln"].includes(node.name) && a.lo <= 0 || ["asin", "acos"].includes(node.name) && (a.lo < -1 || a.hi > 1)) throw new Error("unproved constant function domain");
      if (["sin", "cos", "tan"].includes(node.name)) {
        const center = a.lo + (a.hi - a.lo) / 2, radius = Math.max(center - a.lo, a.hi - center);
        if (node.name === "tan") {
          const lowerCos = Math.abs(Math.cos(center)) - radius - 4 * Number.EPSILON;
          if (lowerCos <= 0) throw new Error("unproved tangent domain");
          const width = radius / (lowerCos * lowerCos), middle = fn(center);
          result = outward([middle - width, middle + width]);
        } else {
          const middle = fn(center); result = outward([Math.max(-1, middle - radius), Math.min(1, middle + radius)]);
          // Rounding cannot widen the proved sine/cosine codomain. Retaining
          // that invariant lets enclosing inverse functions check their domain.
          result.lo = Math.max(-1, result.lo); result.hi = Math.min(1, result.hi);
        }
      } else if (node.name === "abs") result = outward([a.lo <= 0 && a.hi >= 0 ? 0 : Math.min(Math.abs(a.lo), Math.abs(a.hi)), Math.max(Math.abs(a.lo), Math.abs(a.hi))]);
      else result = outward([fn(a.lo), fn(a.hi)]);
      if (["sqrt", "abs", "exp"].includes(node.name)) result.lo = Math.max(0, result.lo);
    }
    intervalCache.set(node, result); return result;
  };
  const opaque = (node: ExpressionNode, constant = false): Polynomial => {
    if (!retainOpaqueTerms && !constant) throw new Error("non-polynomial identity");
    const key = atomKey(node);
    domain.add(key);
    let index = atoms.get(key);
    if (index === undefined) { index = atoms.size + 2; atoms.set(key, index); }
    if (atoms.size > 64) throw new Error("identity opaque term limit");
    if (constant) {
      constantAtoms.set(index, node);
      if (!retainOpaqueTerms) {
        const range = constantInterval(node), value = evaluateNode(node, { x: 0, y: 0 }, { remaining: MAX_EVALUATION_STEPS });
        if (value < range.lo || value > range.hi) throw new Error("constant evaluation escaped its enclosure");
        constantRanges.set(index, range);
      }
    }
    const powers = Array<number>(index + 1).fill(0); powers[index] = 1;
    return new Map([[powers.join(","), fraction(1n)]]);
  };
  const polynomial = (node: ExpressionNode): Polynomial => {
    step();
    if (node.kind === "number") return constant(number(node.value, node.literal));
    if (node.kind === "variable") return new Map([[node.name === "x" ? "1,0" : "0,1", fraction(1n)]]);
    if (node.kind === "function") {
      const argument = polynomial(node.argument);
      if (expressionDegree(node.argument) !== 0) return opaque(node);
      // Validate a constant's domain, but never turn a rounded function result
      // into an exact coefficient. Only these rational identities reduce.
      evaluateNode(node, { x: 0, y: 0 }, { remaining: MAX_EVALUATION_STEPS });
      const value = argument.size === 0 ? fraction(0n) : argument.size === 1 ? argument.get("0,0") : undefined;
      if (value && node.name === "abs") return constant(fraction(value.n < 0n ? -value.n : value.n, value.d));
      if (value?.n === 0n && ["sin", "tan", "asin", "atan", "sqrt"].includes(node.name)) return constant(fraction(0n));
      if (value?.n === 0n && ["cos", "exp"].includes(node.name)) return constant(fraction(1n));
      if (value && value.n === value.d && ["log", "ln", "acos"].includes(node.name)) return constant(fraction(0n));
      if (value && value.n === value.d && node.name === "sqrt") return constant(fraction(1n));
      return opaque(node, true);
    }
    if (node.kind === "unary") return new Map([...polynomial(node.value)].map(([key, value]) => [key, fraction(node.operator === "-" ? -value.n : value.n, value.d)]));
    const x = polynomial(node.left), y = polynomial(node.right);
    if (node.operator === "+" || node.operator === "-") {
      const result = new Map(x);
      for (const [key, value] of y) put(result, key, fraction(node.operator === "-" ? -value.n : value.n, value.d));
      return result;
    }
    if (node.operator === "*") return multiply(x, y);
    const scalar = y.size === 0 ? fraction(0n) : y.size === 1 ? y.get("0,0") : undefined;
    if (!scalar) {
      const reciprocalFits = [...x.keys()].every(key => key.split(",").reduce((sum, power) => sum + Number(power), 0) < 16);
      if (node.operator === "/" && expressionDegree(node.right) === 0 && (!retainOpaqueTerms || reciprocalFits)) {
        const inverse: ExpressionNode = { kind: "binary", operator: "/", left: { kind: "number", value: 1 }, right: node.right };
        evaluateNode(inverse, { x: 0, y: 0 }, { remaining: MAX_EVALUATION_STEPS });
        return multiply(x, opaque(inverse, true));
      }
      const constant = expressionDegree(node) === 0;
      if (constant) evaluateNode(node, { x: 0, y: 0 }, { remaining: MAX_EVALUATION_STEPS });
      return opaque(node, constant);
    }
    if (node.operator === "/") {
      if (!scalar.n) throw new Error("zero divisor");
      return new Map([...x].map(([key, value]) => [key, fraction(value.n * scalar.d, value.d * scalar.n)]));
    }
    const constantBase = x.size === 0 || x.size === 1 && x.has("0,0");
    if (scalar.d !== 1n || scalar.n < -16n || scalar.n > 16n || scalar.n < 0n && !constantBase) {
      if (constantBase) evaluateNode(node, { x: 0, y: 0 }, { remaining: MAX_EVALUATION_STEPS });
      return opaque(node, constantBase);
    }
    let result = constant(fraction(1n));
    const exponent = Number(scalar.n < 0n ? -scalar.n : scalar.n);
    for (let i = 0; i < exponent; i++) result = multiply(result, x);
    if (scalar.n < 0n) {
      const value = result.get("0,0");
      if (!value?.n) throw new Error("negative power of zero");
      return constant(fraction(value.d, value.n));
    }
    return result;
  };
  const result = roots.map(root => { domain = new Set(); domains.push(domain); return polynomial(root); });
  if (retainOpaqueTerms && domains.some(set => set.size !== domains[0]!.size || [...set].some(key => !domains[0]!.has(key)))) throw new Error("identity would discard an opaque domain");
  return { values: result, constants: constantAtoms, ranges: constantRanges, fractionBounds, binaryFraction, addIntervals, multiplyIntervals, powerInterval };
}

/** A bounded analytic degree proof, never a fit to sampled points. */
export function isAffineMathExpression(source: string): boolean {
  try {
    const parsed = parseMathExpression(source);
    const root = new Parser(tokenize(normalizePlainMathSource(source)), new Set<VariableName>(["x"])).parse();
    const intercept = parsed.evaluate(0);
    if (expressionDegree(root) <= 1) return true;
    const slope = parsed.derivative(0);
    return mathExpressionsEquivalent(source, `(${slope})*x+(${intercept})`);
  } catch { return false; }
}

/** A complete Cartesian line, normalized before floating-point geometry.
 * Degree and coefficient expressions use exact symbolic algebra, never point
 * probes. Finite constant atoms are evaluated only after the affine proof.
 * A nonzero coefficient that cannot survive conversion refuses the relation. */
export function cartesianLineCoefficients(lhs: string, rhs: string): { x: number; y: number; constant: number; uncertainty?: { x: number; y: number; constant: number } } | null {
  try {
    // In a Cartesian label, known constants may multiply a parenthesized
    // factor (e.g. 2e(x)); source-function notation keeps its stricter default.
    const notation = (side: string) => normalizeMathProductNotation(side, { allowConstantParentheses: true });
    const source = `(${notation(lhs)})-(${notation(rhs)})`;
    if (source.length > MAX_EXPRESSION_LENGTH * 2 + 8) return null;
    const root = new Parser(tokenize(normalizePlainMathSource(source)), new Set<VariableName>(["x", "y"])).parse();
    const algebra = rationalPolynomials([root]);
    const constants = algebra.constants;
    let coefficients = algebra.values[0]!;
    // A common, proved-nonzero constant factor does not change a relation's
    // zero set. Cancel it symbolically before numerical normalization.
    for (const index of constants.keys()) {
      const range = algebra.ranges.get(index)!;
      if (range.lo <= 0 && range.hi >= 0 || coefficients.size === 0) continue;
      const common = Math.min(...[...coefficients.keys()].map(key => Number(key.split(",")[index] ?? 0)));
      if (!common) continue;
      coefficients = new Map([...coefficients].map(([key, value]) => {
        const powers = key.split(",").map(Number); powers[index]! -= common;
        while (powers.length > 2 && powers.at(-1) === 0) powers.pop();
        return [powers.join(","), value];
      }));
    }
    const hasConstantTerms = [...coefficients.keys()].some(key => key.split(",").slice(2).some(power => Number(power) !== 0));
    // Prove degree before evaluating any constant. A rounded value must never
    // erase a surviving x^2, xy or other nonlinear symbolic term.
    if ([...coefficients.keys()].some(key => {
      const powers = key.split(",").map(Number);
      return powers[0]! + powers[1]! > 1 || powers.slice(2).some((power, i) => power !== 0 && !constants.has(i + 2));
    })) return null;
    const zero: Fraction = { n: 0n, d: 1n };
    const a = coefficients.get("1,0") ?? zero, b = coefficients.get("0,1") ?? zero;
    const abs = (value: bigint) => value < 0n ? -value : value;
    let scale = abs(a.n) * b.d >= abs(b.n) * a.d ? a : b;
    if (hasConstantTerms) for (const [key, value] of coefficients) {
      const [x, y] = key.split(",").map(Number);
      if (x! + y! === 1 && abs(value.n) * scale.d > abs(scale.n) * value.d) scale = value;
    }
    if (scale.n === 0n) return null;
    const ratio = (value: Fraction): number => {
      if (value.n === 0n) return 0;
      const n = value.n * scale.d, d = value.d * scale.n;
      const shiftN = Math.max(0, abs(n).toString(2).length - 53), shiftD = Math.max(0, abs(d).toString(2).length - 53);
      const result = ((n < 0n) !== (d < 0n) ? -1 : 1) * Number(abs(n) >> BigInt(shiftN)) / Number(abs(d) >> BigInt(shiftD)) * 2 ** (shiftN - shiftD);
      if (!Number.isFinite(result) || result === 0) throw new Error("line coefficient outside numeric range");
      return result;
    };
    const resultWithBounds = (values: number[], ranges: ConstantInterval[]) => {
      const errors = ranges.map((range, i) => {
        const error = Math.max(Math.abs(values[i]! - range.lo), Math.abs(range.hi - values[i]!));
        return error === 0 ? 0 : error * (1 + 4 * Number.EPSILON) + Number.MIN_VALUE;
      });
      if (errors.some(error => !Number.isFinite(error))) throw new Error("unbounded line coefficient uncertainty");
      return { x: values[0]!, y: values[1]!, constant: values[2]!, ...(errors.some(error => error > 0) ? { uncertainty: { x: errors[0]!, y: errors[1]!, constant: errors[2]! } } : {}) };
    };
    if (!hasConstantTerms) {
      const terms = [a, b, coefficients.get("0,0") ?? zero];
      return resultWithBounds(terms.map(ratio), terms.map(value => algebra.fractionBounds(value, scale)));
    }
    const values = new Map<number, number>();
    const groups: number[][] = [[], [], []];
    const ranges: ConstantInterval[] = [{ lo: 0, hi: 0 }, { lo: 0, hi: 0 }, { lo: 0, hi: 0 }];
    for (const [key, coefficient] of coefficients) {
      const powers = key.split(",").map(Number);
      let range = algebra.fractionBounds(coefficient, scale);
      let term = Math.max(range.lo, Math.min(range.hi, ratio(coefficient)));
      for (let index = 2; index < powers.length; index++) if (powers[index]) {
        let value = values.get(index);
        if (value === undefined) {
          value = evaluateNode(constants.get(index)!, { x: 0, y: 0 }, { remaining: MAX_EVALUATION_STEPS });
          values.set(index, value);
        }
        term *= value ** powers[index]!;
        range = algebra.multiplyIntervals(range, algebra.powerInterval(algebra.ranges.get(index)!, { lo: powers[index]!, hi: powers[index]! }, true));
      }
      if (!Number.isFinite(term) || term === 0) throw new Error("constant line coefficient outside numeric range");
      const group = powers[0] ? 0 : powers[1] ? 1 : 2;
      ranges[group] = groups[group]!.length ? algebra.addIntervals(ranges[group]!, range) : range;
      groups[group]!.push(term);
    }
    const evaluated = groups.map((terms, index) => {
      let sum = 0, correction = 0, magnitude = 0;
      for (const term of terms) {
        const adjusted = term - correction, next = sum + adjusted;
        correction = (next - sum) - adjusted; sum = next; magnitude += Math.abs(term);
      }
      if (!Number.isFinite(sum) || !Number.isFinite(magnitude) || terms.length > 0 && sum === 0) throw new Error("unbounded or lost nonzero constant coefficient");
      const cancellation = terms.some(term => term > 0) && terms.some(term => term < 0);
      const range = ranges[index]!;
      if (cancellation && Math.max(Math.abs(sum - range.lo), Math.abs(range.hi - sum)) > Math.abs(sum) * 1e-8) throw new Error("unproved cancellation between constant coefficients");
      return sum;
    });
    const norm = Math.max(Math.abs(evaluated[0]!), Math.abs(evaluated[1]!));
    if (!Number.isFinite(norm) || norm === 0) return null;
    const normalized = evaluated.map(value => {
      const result = value / norm;
      if (!Number.isFinite(result) || value !== 0 && result === 0) throw new Error("line coefficient outside numeric range");
      return result;
    });
    // The nominal floating scale is fixed for every coefficient; enclose its
    // reciprocal directly rather than treating it as a source expression.
    const normalizer = algebra.fractionBounds({ n: 1n, d: 1n }, algebra.binaryFraction(norm));
    // Keep coefficient enclosures for the compiler's point/direction residual.
    // An absolute intercept cutoff would reject accurate large-offset lines.
    return resultWithBounds(normalized, ranges.map(range => algebra.multiplyIntervals(range, normalizer)));
  } catch { return null; }
}

function expressionDegree(node: ExpressionNode): number {
  chargeExpressionSteps(1);
  if (node.kind === "number") return 0;
  if (node.kind === "variable") return 1;
  if (node.kind === "unary") return expressionDegree(node.value);
  if (node.kind === "function") return expressionDegree(node.argument) === 0 ? 0 : Infinity;
  const left = expressionDegree(node.left), right = expressionDegree(node.right);
  if (node.operator === "+" || node.operator === "-") return Math.max(left, right);
  if (node.operator === "*") return left + right;
  if (node.operator === "/") return right === 0 ? left : Infinity;
  if (right !== 0) return Infinity;
  const power = evaluateNode(node.right, { x: 0, y: 0 }, { remaining: MAX_EVALUATION_STEPS });
  return Number.isInteger(power) && power >= 0 && power <= 16 ? power === 0 ? 0 : left * power : Infinity;
}

/** Parse the intentionally small, side-effect-free language used by function_curve. */
export function parseMathExpression(source: string): ParsedMathExpression {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error("expression must be a non-empty string");
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`expression exceeds ${MAX_EXPRESSION_LENGTH} characters`);
  }
  const normalized = normalizePlainMathSource(source).trim();
  const root = new Parser(tokenize(normalized), new Set(["x"])).parse();
  return {
    source: normalized,
    syntaxKey: JSON.stringify(root),
    evaluate(x: number): number {
      if (!Number.isFinite(x) || Math.abs(x) > MAX_ABSOLUTE_VALUE) {
        throw new Error("x must be finite and within the supported numeric range");
      }
      const budget = { remaining: MAX_EVALUATION_STEPS };
      return checked(evaluateNode(root, { x, y: 0 }, budget), "expression result");
    },
    derivative(x: number): number {
      assertSupportedVariable(x, "x");
      return evaluateDerivative(root, x, { remaining: MAX_EVALUATION_STEPS }).derivative;
    },
    secondDerivative(x: number): number {
      assertSupportedVariable(x, "x");
      return evaluateCertifiedJet(root, x, { remaining: MAX_CERTIFIED_STEPS }).second.value;
    },
    certifiedJetAt(x: number): CertifiedMathJet {
      assertSupportedVariable(x, "x");
      const jet = evaluateCertifiedJet(root, x, { remaining: MAX_CERTIFIED_STEPS });
      const quarterTurns = exactQuarterTurns(jet.value.exact);
      return Object.freeze({
        value: jet.value.value,
        derivative: jet.first.value,
        secondDerivative: jet.second.value,
        errorBounds: Object.freeze({
          value: certifiedError(jet.value),
          derivative: certifiedError(jet.first),
          secondDerivative: certifiedError(jet.second),
        }),
        ...(quarterTurns === undefined ? {} : { exactQuarterTurns: quarterTurns }),
      });
    },
    intervalBoundsOn(xMin: number, xMax: number): Interval {
      assertSupportedVariable(xMin, "x");
      assertSupportedVariable(xMax, "x");
      if (xMin > xMax) throw new Error("function bounds require xMin <= xMax");
      return Object.freeze(evaluateCertifiedRange(root, { low: xMin, high: xMax }, { remaining: MAX_CERTIFIED_STEPS }).bounds);
    },
    assertContinuousOn(xMin: number, xMax: number): void {
      if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !(xMin < xMax)) {
        throw new Error("continuous function domain requires finite xMin < xMax");
      }
      evaluateInterval(
        root,
        { x: { low: xMin, high: xMax }, y: { low: 0, high: 0 } },
        { remaining: MAX_EVALUATION_STEPS },
      );
    },
  };
}

/** Parse the same bounded language for an implicit relation F(x, y) = 0. */
export function parseMathExpression2D(source: string): ParsedMathExpression2D {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error("expression must be a non-empty string");
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`expression exceeds ${MAX_EXPRESSION_LENGTH} characters`);
  }
  const normalized = normalizePlainMathSource(source).trim();
  const root = new Parser(tokenize(normalized), new Set(["x", "y"])).parse();
  return {
    source: normalized,
    evaluate(x: number, y: number): number {
      assertSupportedVariable(x, "x");
      assertSupportedVariable(y, "y");
      return checked(
        evaluateNode(root, { x, y }, { remaining: MAX_EVALUATION_STEPS }),
        "expression result",
      );
    },
    assertContinuousOn(xMin: number, xMax: number, yMin: number, yMax: number): void {
      if (
        !Number.isFinite(xMin) || !Number.isFinite(xMax) || !(xMin < xMax) ||
        !Number.isFinite(yMin) || !Number.isFinite(yMax) || !(yMin < yMax)
      ) {
        throw new Error("continuous implicit domain requires finite xMin < xMax and yMin < yMax");
      }
      [xMin, xMax].forEach((value) => assertSupportedVariable(value, "x"));
      [yMin, yMax].forEach((value) => assertSupportedVariable(value, "y"));
      evaluateInterval(
        root,
        { x: { low: xMin, high: xMax }, y: { low: yMin, high: yMax } },
        { remaining: MAX_EVALUATION_STEPS },
      );
    },
  };
}

export function evaluateMathExpression(source: string, x: number): number {
  return parseMathExpression(source).evaluate(x);
}

const MAX_LINEAR_CORNERS = 256;

/**
 * Where a function built only from x, numbers, + and -, scaling by a number
 * and abs can bend on [xMin, xMax]: sorted, with both ends, and the function
 * is straight between neighbours. Null for any other expression, whose
 * straightness no set of samples proves.
 */
export function piecewiseLinearCorners(source: string, xMin: number, xMax: number): number[] | null {
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !(xMin < xMax)) return null;
  const root = new Parser(tokenize(normalizePlainMathSource(source).trim()), new Set(["x"])).parse();
  const at = (node: ExpressionNode, x: number) => evaluateNode(node, { x, y: 0 }, { remaining: MAX_EVALUATION_STEPS });
  const constant = (node: ExpressionNode): number | null => {
    const free = (n: ExpressionNode): boolean => n.kind === "number" || (n.kind === "unary" ? free(n.value) : n.kind === "function" ? free(n.argument) : n.kind === "binary" && free(n.left) && free(n.right));
    return free(node) ? at(node, xMin) : null;
  };
  const merge = (a: number[], b: number[]) => [...new Set([...a, ...b])].sort((p, q) => p - q);
  const corners = (node: ExpressionNode): number[] | null => {
    if (constant(node) !== null || node.kind === "variable") return [xMin, xMax];
    if (node.kind === "unary") return corners(node.value);
    if (node.kind === "function") {
      if (node.name !== "abs") return null;
      const inner = corners(node.argument);
      if (!inner) return null;
      const zeros: number[] = [];
      for (let index = 1; index < inner.length; index += 1) {
        const a = inner[index - 1]!, b = inner[index]!;
        const va = at(node.argument, a), vb = at(node.argument, b);
        if (va === 0) zeros.push(a);
        if (vb === 0) zeros.push(b);
        if (Math.sign(va) * Math.sign(vb) < 0) zeros.push(a + (b - a) * va / (va - vb));
      }
      return merge(inner, zeros);
    }
    if (node.kind !== "binary") return null;
    const left = constant(node.left), right = constant(node.right);
    let result: number[] | null;
    if (node.operator === "+" || node.operator === "-") {
      const a = corners(node.left), b = a && corners(node.right);
      result = a && b ? merge(a, b) : null;
    } else if (node.operator === "*") result = left !== null ? corners(node.right) : right !== null ? corners(node.left) : null;
    else if (node.operator === "/") result = right !== null && right !== 0 ? corners(node.left) : null;
    else result = right === 1 ? corners(node.left) : null;
    return result && result.length <= MAX_LINEAR_CORNERS ? result : null;
  };
  return corners(root);
}

const SUPERSCRIPT_POWERS: Readonly<Record<string, string>> = {
  "⁰": "^0", "¹": "^1", "²": "^2", "³": "^3", "⁴": "^4",
  "⁵": "^5", "⁶": "^6", "⁷": "^7", "⁸": "^8", "⁹": "^9",
};

function normalizePlainMathSource(source: string): string {
  let normalized = source.replaceAll(/[−–—]/g, "-");
  for (const [glyph, power] of Object.entries(SUPERSCRIPT_POWERS)) {
    normalized = normalized.replaceAll(glyph, power);
  }
  return normalized;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const push = (token: Token): void => {
    tokens.push(token);
    if (tokens.length > MAX_TOKENS) throw new Error(`expression exceeds ${MAX_TOKENS} tokens`);
  };
  while (index < source.length) {
    const character = source[index]!;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(character)) {
      const start = index;
      const match = source.slice(index).match(/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/);
      if (!match) throw new Error(`invalid number at position ${start}`);
      const value = Number(match[0]);
      if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_VALUE || value === 0 && /[1-9]/.test(match[0].split(/[eE]/u)[0]!)) {
        throw new Error(`numeric literal at position ${start} is outside the supported range`);
      }
      push({ kind: "number", value, literal: match[0], position: start });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const start = index;
      const match = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
      push({ kind: "identifier", value: match[0], position: start });
      index += match[0].length;
      continue;
    }
    if (character === "(" || character === ")") {
      push({ kind: character === "(" ? "leftParen" : "rightParen", position: index });
      index += 1;
      continue;
    }
    if (["+", "-", "*", "/", "^"].includes(character)) {
      push({ kind: "operator", value: character as BinaryOperator, position: index });
      index += 1;
      continue;
    }
    throw new Error(`unsupported character '${character}' at position ${index}`);
  }
  tokens.push({ kind: "end", position: source.length });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly variables: ReadonlySet<VariableName>,
  ) {}

  parse(): ExpressionNode {
    const expression = this.parseAdditive(0);
    const trailing = this.peek();
    if (trailing.kind !== "end") {
      throw new Error(`unexpected token at position ${trailing.position}; multiplication must be explicit`);
    }
    return expression;
  }

  private parseAdditive(depth: number): ExpressionNode {
    this.checkDepth(depth);
    let node = this.parseMultiplicative(depth + 1);
    while (this.isOperator("+") || this.isOperator("-")) {
      const operator = (this.consume() as Extract<Token, { kind: "operator" }>).value;
      node = { kind: "binary", operator, left: node, right: this.parseMultiplicative(depth + 1) };
    }
    return node;
  }

  private parseMultiplicative(depth: number): ExpressionNode {
    this.checkDepth(depth);
    let node = this.parseUnary(depth + 1);
    while (this.isOperator("*") || this.isOperator("/")) {
      const operator = (this.consume() as Extract<Token, { kind: "operator" }>).value;
      node = { kind: "binary", operator, left: node, right: this.parseUnary(depth + 1) };
    }
    return node;
  }

  private parseUnary(depth: number): ExpressionNode {
    this.checkDepth(depth);
    if (this.isOperator("+") || this.isOperator("-")) {
      const operator = (this.consume() as Extract<Token, { kind: "operator" }>).value as UnaryOperator;
      return { kind: "unary", operator, value: this.parseUnary(depth + 1) };
    }
    return this.parsePower(depth + 1);
  }

  private parsePower(depth: number): ExpressionNode {
    this.checkDepth(depth);
    const left = this.parsePrimary(depth + 1);
    if (!this.isOperator("^")) return left;
    this.consume();
    return { kind: "binary", operator: "^", left, right: this.parseUnary(depth + 1) };
  }

  private parsePrimary(depth: number): ExpressionNode {
    this.checkDepth(depth);
    const token = this.consume();
    if (token.kind === "number") return { kind: "number", value: token.value, literal: token.literal };
    if (token.kind === "leftParen") {
      const value = this.parseAdditive(depth + 1);
      const closing = this.consume();
      if (closing.kind !== "rightParen") throw new Error(`expected ')' at position ${closing.position}`);
      return value;
    }
    if (token.kind === "identifier") {
      if ((token.value === "x" || token.value === "y") && this.variables.has(token.value)) {
        return { kind: "variable", name: token.value };
      }
      if (token.value === "pi") return { kind: "number", value: Math.PI, exactConstant: "pi" };
      if (token.value === "e") return { kind: "number", value: Math.E, exactConstant: "e" };
      if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, token.value)) {
        throw new Error(`unknown identifier '${token.value}' at position ${token.position}`);
      }
      const opening = this.consume();
      if (opening.kind !== "leftParen") throw new Error(`function ${token.value} requires parentheses`);
      const argument = this.parseAdditive(depth + 1);
      const closing = this.consume();
      if (closing.kind !== "rightParen") throw new Error(`expected ')' at position ${closing.position}`);
      return { kind: "function", name: token.value as FunctionName, argument };
    }
    throw new Error(`expected a number, x, or function at position ${token.position}`);
  }

  private isOperator(value: BinaryOperator): boolean {
    const token = this.peek();
    return token.kind === "operator" && token.value === value;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private consume(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private checkDepth(depth: number): void {
    if (depth > MAX_PARSE_DEPTH) throw new Error(`expression exceeds maximum nesting depth ${MAX_PARSE_DEPTH}`);
  }
}

function evaluateNode(
  node: ExpressionNode,
  variables: Record<VariableName, number>,
  budget: { remaining: number },
): number {
  budget.remaining -= 1;
  chargeExpressionSteps(1);
  if (budget.remaining < 0) throw new Error("expression evaluation exceeded the operation budget");
  switch (node.kind) {
    case "number": return node.value;
    case "variable": return variables[node.name];
    case "unary": {
      const value = evaluateNode(node.value, variables, budget);
      return checked(node.operator === "-" ? -value : value, "unary operation");
    }
    case "function": {
      const argument = evaluateNode(node.argument, variables, budget);
      return checked(FUNCTIONS[node.name](argument), `${node.name} result`);
    }
    case "binary": {
      const left = evaluateNode(node.left, variables, budget);
      const right = evaluateNode(node.right, variables, budget);
      switch (node.operator) {
        case "+": return checked(left + right, "addition result");
        case "-": return checked(left - right, "subtraction result");
        case "*": return checked(left * right, "multiplication result");
        case "/": return checked(left / right, "division result");
        case "^": return checked(left ** right, "power result");
      }
    }
  }
}

function checked(value: number, description: string): number {
  if (!Number.isFinite(value)) throw new Error(`${description} is not finite`);
  if (Math.abs(value) > MAX_ABSOLUTE_VALUE) throw new Error(`${description} exceeds the supported numeric range`);
  return value;
}

type Dual = { value: number; derivative: number; constant: boolean };
/** Forward-mode chain rule on the parser's AST; no sampled differences or new expression grammar. */
function evaluateDerivative(node: ExpressionNode, x: number, budget: { remaining: number }): Dual {
  budget.remaining -= 1;
  chargeExpressionSteps(1);
  if (budget.remaining < 0) throw new Error("expression derivative exceeded the operation budget");
  const dual = (value: number, derivative: number, constant: boolean): Dual => ({ value: checked(value, "derivative expression value"), derivative: checked(derivative, "analytic derivative"), constant });
  if (node.kind === "number") return dual(node.value, 0, true);
  if (node.kind === "variable") return dual(x, 1, false);
  if (node.kind === "unary") {
    const a = evaluateDerivative(node.value, x, budget);
    const sign = node.operator === "-" ? -1 : 1;
    return dual(sign * a.value, sign * a.derivative, a.constant);
  }
  if (node.kind === "binary") {
    const a = evaluateDerivative(node.left, x, budget); const b = evaluateDerivative(node.right, x, budget);
    const constant = a.constant && b.constant;
    switch (node.operator) {
      case "+": return dual(a.value + b.value, a.derivative + b.derivative, constant);
      case "-": return dual(a.value - b.value, a.derivative - b.derivative, constant);
      case "*": return dual(a.value * b.value, a.derivative * b.value + a.value * b.derivative, constant);
      case "/": return dual(a.value / b.value, (a.derivative - (a.value / b.value) * b.derivative) / b.value, constant);
      case "^": {
        const value = checked(a.value ** b.value, "derivative power value");
        if (constant) return dual(value, 0, true);
        if (b.constant) {
          if (b.value === 0) return dual(value, 0, true);
          if (a.value <= 0 && !Number.isInteger(b.value)) throw new Error("fractional-power derivative requires a strictly positive base");
          return dual(value, b.value * a.value ** (b.value - 1) * a.derivative, false);
        }
        if (!(a.value > 0)) throw new Error("variable-power derivative requires a strictly positive base");
        return dual(value, value * (b.derivative * Math.log(a.value) + b.value * a.derivative / a.value), false);
      }
    }
  }
  const argument = evaluateDerivative(node.argument, x, budget);
  const value = checked(FUNCTIONS[node.name](argument.value), "derivative function value");
  if (argument.constant) return dual(value, 0, true);
  let factor: number;
  switch (node.name) {
    case "sin": factor = Math.cos(argument.value); break;
    case "cos": factor = -Math.sin(argument.value); break;
    case "tan": {
      const cosine = Math.cos(argument.value);
      if (!(Math.abs(cosine) > 1e-12)) throw new Error("tan derivative is undefined at its pole");
      factor = 1 / cosine / cosine; break;
    }
    case "asin":
    case "acos":
      if (!(Math.abs(argument.value) < 1)) throw new Error(`${node.name} derivative requires argument strictly within (-1,1)`);
      factor = (node.name === "acos" ? -1 : 1) / Math.sqrt((1 - argument.value) * (1 + argument.value)); break;
    case "atan": factor = 1 / (1 + argument.value * argument.value); break;
    case "sqrt":
      if (!(argument.value > 0)) throw new Error("sqrt derivative requires a strictly positive argument");
      factor = 0.5 / value; break;
    case "abs":
      if (argument.value === 0) throw new Error("abs derivative cannot be certified at its cusp");
      factor = Math.sign(argument.value); break;
    case "exp": factor = value; break;
    case "log":
    case "ln": factor = 1 / argument.value; break;
  }
  return dual(value, factor * argument.derivative, false);
}

function assertSupportedVariable(value: number, name: VariableName): void {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_VALUE) {
    throw new Error(`${name} must be finite and within the supported numeric range`);
  }
}

type Interval = { low: number; high: number };

function evaluateInterval(
  node: ExpressionNode,
  variables: Record<VariableName, Interval>,
  budget: { remaining: number },
): Interval {
  budget.remaining -= 1;
  chargeExpressionSteps(1);
  if (budget.remaining < 0) throw new Error("expression interval analysis exceeded the operation budget");
  switch (node.kind) {
    case "number": return { low: node.value, high: node.value };
    case "variable": return variables[node.name];
    case "unary": {
      const value = evaluateInterval(node.value, variables, budget);
      return node.operator === "-" ? interval(-value.high, -value.low, "unary interval") : value;
    }
    case "function": return functionInterval(node.name, evaluateInterval(node.argument, variables, budget));
    case "binary": {
      const left = evaluateInterval(node.left, variables, budget);
      const right = evaluateInterval(node.right, variables, budget);
      switch (node.operator) {
        case "+": return interval(left.low + right.low, left.high + right.high, "addition interval");
        case "-": return interval(left.low - right.high, left.high - right.low, "subtraction interval");
        case "*": return extrema([
          left.low * right.low,
          left.low * right.high,
          left.high * right.low,
          left.high * right.high,
        ], "multiplication interval");
        case "/": {
          if (containsZero(right)) throw new Error("division denominator may be zero in the requested domain");
          return extrema([
            left.low / right.low,
            left.low / right.high,
            left.high / right.low,
            left.high / right.high,
          ], "division interval");
        }
        case "^": return powerInterval(node.right, left, right);
      }
    }
  }
}

function functionInterval(name: FunctionName, argument: Interval): Interval {
  switch (name) {
    case "sin":
    case "cos": return { low: -1, high: 1 };
    case "tan": {
      const firstPole = Math.ceil((argument.low - Math.PI / 2) / Math.PI);
      const lastPole = Math.floor((argument.high - Math.PI / 2) / Math.PI);
      if (firstPole <= lastPole) throw new Error("tan crosses an asymptote in the requested domain");
      return extrema([Math.tan(argument.low), Math.tan(argument.high)], "tan interval");
    }
    case "asin":
      if (argument.low < -1 || argument.high > 1) throw new Error("asin argument leaves [-1, 1] in the requested domain");
      return interval(Math.asin(argument.low), Math.asin(argument.high), "asin interval");
    case "acos":
      if (argument.low < -1 || argument.high > 1) throw new Error("acos argument leaves [-1, 1] in the requested domain");
      return interval(Math.acos(argument.high), Math.acos(argument.low), "acos interval");
    case "atan": return interval(Math.atan(argument.low), Math.atan(argument.high), "atan interval");
    case "sqrt":
      if (argument.low < 0) throw new Error("sqrt argument may be negative in the requested domain");
      return interval(Math.sqrt(argument.low), Math.sqrt(argument.high), "sqrt interval");
    case "abs": {
      const low = containsZero(argument) ? 0 : Math.min(Math.abs(argument.low), Math.abs(argument.high));
      return interval(low, Math.max(Math.abs(argument.low), Math.abs(argument.high)), "abs interval");
    }
    case "exp": return interval(Math.exp(argument.low), Math.exp(argument.high), "exp interval");
    case "log":
    case "ln":
      if (argument.low <= 0) throw new Error(`${name} argument may be non-positive in the requested domain`);
      return interval(Math.log(argument.low), Math.log(argument.high), `${name} interval`);
  }
}

function powerInterval(exponentNode: ExpressionNode, base: Interval, exponent: Interval): Interval {
  if (exponentNode.kind === "number") {
    const value = exponentNode.value;
    if (Number.isInteger(value)) {
      if (value < 0 && containsZero(base)) throw new Error("negative power may divide by zero in the requested domain");
      if (value % 2 === 0) {
        const low = containsZero(base)
          ? value < 0 ? Infinity : 0
          : Math.min(base.low ** value, base.high ** value);
        return interval(low, Math.max(base.low ** value, base.high ** value), "power interval");
      }
      return extrema([base.low ** value, base.high ** value], "power interval");
    }
    if (base.low < 0 || (base.low === 0 && value < 0)) {
      throw new Error("fractional power leaves the real finite domain");
    }
    return extrema([base.low ** value, base.high ** value], "power interval");
  }
  if (base.low <= 0) throw new Error("variable powers require a strictly positive base on the requested domain");
  return extrema([
    base.low ** exponent.low,
    base.low ** exponent.high,
    base.high ** exponent.low,
    base.high ** exponent.high,
    1,
  ], "power interval");
}

function containsZero(value: Interval): boolean {
  return value.low <= 0 && value.high >= 0;
}

function extrema(values: number[], description: string): Interval {
  return interval(Math.min(...values), Math.max(...values), description);
}

function interval(low: number, high: number, description: string): Interval {
  return { low: checked(low, description), high: checked(high, description) };
}

const MAX_CERTIFIED_STEPS = 8192;
const MAX_EXACT_TERMS = 32;
const MAX_EXACT_POWER = 128;
type CertifiedBudget = { remaining: number };
// A small Laurent polynomial in the retained constants. It proves algebraic
// cancellations without asserting any unproved relation between pi and e.
type ExactForm = ReadonlyMap<string, Rational>;
type CertifiedScalar = { value: number; bounds: Interval; exact?: ExactForm };
type CertifiedJet = { value: CertifiedScalar; first: CertifiedScalar; second: CertifiedScalar; constant: boolean };

function certifiedStep(budget: CertifiedBudget): void {
  chargeExpressionSteps(1);
  if (--budget.remaining < 0) throw new Error("certified expression exceeded the operation budget");
}

function binaryRational(value: number): Rational {
  const dyadic = exactBinary64(value);
  return dyadic.power >= 0 ? rational(dyadic.n << BigInt(dyadic.power)) : rational(dyadic.n, 1n << BigInt(-dyadic.power));
}

/** Adjacent binary64 endpoints; no relative-epsilon estimate or zero snapping. */
function adjacent(value: number, up: boolean): number {
  if (!Number.isFinite(value)) throw new Error("certified arithmetic is not finite");
  if (value === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
  const data = new DataView(new ArrayBuffer(8));
  data.setFloat64(0, value);
  data.setBigUint64(0, data.getBigUint64(0) + ((value > 0) === up ? 1n : -1n));
  const result = data.getFloat64(0);
  if (!Number.isFinite(result)) throw new Error("certified arithmetic overflows binary64");
  return result;
}

function rationalBounds(q: Rational): Interval {
  const value = exactRationalToNumber(serializeRational(q));
  const comparison = compareRational(binaryRational(value), q);
  return { low: comparison > 0 ? adjacent(value, false) : value, high: comparison < 0 ? adjacent(value, true) : value };
}

// Rational brackets for the mathematical constants (the final digit bounds
// are strict); these also cover the rounded Math.PI/Math.E central estimates.
// pi follows Machin's atan series, e its factorial series, ln(2) the positive
// 2*atanh(1/3) series. Bounds, rather than a libm-accuracy assumption, carry truth.
function constantBounds(lower: string, upper: string): Interval {
  return { low: rationalBounds(parseRational(lower)).low, high: rationalBounds(parseRational(upper)).high };
}
const CERTIFIED_PI = constantBounds("3.14159265358979323846264338327950288419716939937510", "3.14159265358979323846264338327950288419716939937511");
const CERTIFIED_E = constantBounds("2.71828182845904523536028747135266249775724709369995", "2.71828182845904523536028747135266249775724709369996");
const CERTIFIED_LN2 = constantBounds("0.69314718055994530941723212145817656807550013436025", "0.69314718055994530941723212145817656807550013436026");
const pointBounds = (value: number): Interval => ({ low: value, high: value });
const boundMagnitude = (a: Interval): number => Math.max(Math.abs(a.low), Math.abs(a.high));

function boundsAdd(a: Interval, b: Interval): Interval {
  return { low: adjacent(a.low + b.low, false), high: adjacent(a.high + b.high, true) };
}
function boundsNegate(a: Interval): Interval { return { low: -a.high, high: -a.low }; }
function boundsSubtract(a: Interval, b: Interval): Interval { return boundsAdd(a, boundsNegate(b)); }
function boundsMultiply(a: Interval, b: Interval): Interval {
  const products = [a.low * b.low, a.low * b.high, a.high * b.low, a.high * b.high];
  const operands = [[a.low, b.low], [a.low, b.high], [a.high, b.low], [a.high, b.high]];
  if (products.some((value, index) => value === 0 && operands[index]![0] !== 0 && operands[index]![1] !== 0)) {
    throw new Error("certified product underflows binary64");
  }
  return { low: adjacent(Math.min(...products), false), high: adjacent(Math.max(...products), true) };
}
function boundsDivide(a: Interval, b: Interval): Interval {
  if (containsZero(b)) throw new Error("certified denominator may be zero");
  const quotients = [a.low / b.low, a.low / b.high, a.high / b.low, a.high / b.high];
  if (quotients.some((value, index) => value === 0 && (index < 2 ? a.low : a.high) !== 0)) {
    throw new Error("certified quotient underflows binary64");
  }
  return { low: adjacent(Math.min(...quotients), false), high: adjacent(Math.max(...quotients), true) };
}
function boundsIntegerPower(a: Interval, power: number, budget: CertifiedBudget): Interval {
  let result = pointBounds(1); let factor = a; let exponent = Math.abs(power);
  while (exponent > 0) {
    certifiedStep(budget);
    if (exponent % 2 === 1) result = boundsMultiply(result, factor);
    exponent = Math.floor(exponent / 2);
    if (exponent) factor = boundsMultiply(factor, factor);
  }
  return power < 0 ? boundsDivide(pointBounds(1), result) : result;
}

function makeExact(q: Rational, pi = 0, e = 0): ExactForm {
  return q.n === 0n ? new Map() : new Map([[`${pi},${e}`, q]]);
}
function exactRationalPart(form: ExactForm | undefined): Rational | undefined {
  if (!form) return undefined;
  return form.size === 0 ? Q_ZERO : form.size === 1 ? form.get("0,0") : undefined;
}
function sameForm(a: ExactForm | undefined, b: ExactForm | undefined): boolean {
  return !!a && !!b && a.size === b.size && [...a].every(([key, value]) => {
    const other = b.get(key); return other !== undefined && compareRational(value, other) === 0;
  });
}
function formAdd(a: ExactForm, b: ExactForm, subtract: boolean, budget: CertifiedBudget): ExactForm {
  const result = new Map(a);
  for (const [key, value] of b) {
    certifiedStep(budget);
    const next = addRational(result.get(key) ?? Q_ZERO, subtract ? negateRational(value) : value);
    if (next.n === 0n) result.delete(key); else result.set(key, next);
  }
  if (result.size > MAX_EXACT_TERMS) throw new Error("certified symbolic expression exceeds the term budget");
  return result;
}
function formMultiply(a: ExactForm, b: ExactForm, budget: CertifiedBudget): ExactForm {
  const result = new Map<string, Rational>();
  for (const [aKey, aQ] of a) for (const [bKey, bQ] of b) {
    certifiedStep(budget);
    const [aPi, aE] = aKey.split(",").map(Number); const [bPi, bE] = bKey.split(",").map(Number);
    const pi = aPi! + bPi!; const e = aE! + bE!;
    if (Math.abs(pi) > MAX_EXACT_POWER || Math.abs(e) > MAX_EXACT_POWER) throw new Error("certified symbolic power exceeds capacity");
    const key = `${pi},${e}`; const q = addRational(result.get(key) ?? Q_ZERO, multiplyRational(aQ, bQ));
    if (q.n === 0n) result.delete(key); else result.set(key, q);
    if (result.size > MAX_EXACT_TERMS) throw new Error("certified symbolic expression exceeds the term budget");
  }
  return result;
}
function formDivide(a: ExactForm, b: ExactForm, budget: CertifiedBudget): ExactForm | undefined {
  if (sameForm(a, b)) return makeExact(Q_ONE);
  if (b.size !== 1) return undefined;
  const [key, q] = [...b][0]!; const [pi, e] = key.split(",").map(Number);
  return formMultiply(a, makeExact(divideRational(Q_ONE, q), -pi!, -e!), budget);
}
function scalarFromBounds(bounds: Interval, value: number): CertifiedScalar {
  checked(bounds.low, "certified lower bound"); checked(bounds.high, "certified upper bound");
  checked(value, "certified expression value");
  if (bounds.low > bounds.high) throw new Error("invalid certified interval");
  if (value === 0 && !containsZero(bounds)) throw new Error("certified nonzero value underflows binary64");
  return { value: value === 0 ? 0 : value, bounds };
}
function scalarFromForm(form: ExactForm, budget: CertifiedBudget): CertifiedScalar {
  const q = exactRationalPart(form);
  if (q) return { ...scalarFromBounds(rationalBounds(q), exactRationalToNumber(serializeRational(q))), exact: form };
  let bounds: Interval | undefined; let value = 0;
  for (const [key, coefficient] of form) {
    certifiedStep(budget);
    const [pi, e] = key.split(",").map(Number);
    let term = rationalBounds(coefficient);
    if (pi) term = boundsMultiply(term, boundsIntegerPower(CERTIFIED_PI, pi, budget));
    if (e) term = boundsMultiply(term, boundsIntegerPower(CERTIFIED_E, e, budget));
    bounds = bounds ? boundsAdd(bounds, term) : term;
    value += exactRationalToNumber(serializeRational(coefficient)) * Math.PI ** pi! * Math.E ** e!;
  }
  return { ...scalarFromBounds(bounds ?? pointBounds(0), value), exact: form };
}
const CERTIFIED_ZERO: CertifiedScalar = { value: 0, bounds: pointBounds(0), exact: makeExact(Q_ZERO) };
const CERTIFIED_ONE: CertifiedScalar = { value: 1, bounds: pointBounds(1), exact: makeExact(Q_ONE) };
function certifiedNumber(value: number, budget: CertifiedBudget): CertifiedScalar { return scalarFromForm(makeExact(binaryRational(value)), budget); }
function certifiedNegate(a: CertifiedScalar): CertifiedScalar {
  return { value: a.value === 0 ? 0 : -a.value, bounds: boundsNegate(a.bounds), exact: a.exact && new Map([...a.exact].map(([key, q]) => [key, negateRational(q)])) };
}
function certifiedAdd(a: CertifiedScalar, b: CertifiedScalar, budget: CertifiedBudget, subtract = false): CertifiedScalar {
  certifiedStep(budget);
  if (subtract && (a === b || sameForm(a.exact, b.exact))) return CERTIFIED_ZERO;
  if (a.exact && b.exact) return scalarFromForm(formAdd(a.exact, b.exact, subtract, budget), budget);
  if (b.exact?.size === 0) return a;
  if (a.exact?.size === 0) return subtract ? certifiedNegate(b) : b;
  return scalarFromBounds(subtract ? boundsSubtract(a.bounds, b.bounds) : boundsAdd(a.bounds, b.bounds), subtract ? a.value - b.value : a.value + b.value);
}
function certifiedMultiply(a: CertifiedScalar, b: CertifiedScalar, budget: CertifiedBudget): CertifiedScalar {
  certifiedStep(budget);
  if (a.exact?.size === 0 || b.exact?.size === 0) return CERTIFIED_ZERO;
  if (a.exact && b.exact) return scalarFromForm(formMultiply(a.exact, b.exact, budget), budget);
  return scalarFromBounds(boundsMultiply(a.bounds, b.bounds), a.value * b.value);
}
function certifiedDivide(a: CertifiedScalar, b: CertifiedScalar, budget: CertifiedBudget): CertifiedScalar {
  certifiedStep(budget);
  if (containsZero(b.bounds)) throw new Error("certified denominator may be zero");
  if (a.exact?.size === 0) return CERTIFIED_ZERO;
  const form = a.exact && b.exact && formDivide(a.exact, b.exact, budget);
  if (form) return scalarFromForm(form, budget);
  return scalarFromBounds(boundsDivide(a.bounds, b.bounds), a.value / b.value);
}
function certifiedError(a: CertifiedScalar): number {
  const error = Math.max(Math.abs(a.value - a.bounds.low), Math.abs(a.bounds.high - a.value));
  return error === 0 ? 0 : checked(adjacent(error, true), "certified absolute error");
}

function cardinalTrig(form: ExactForm | undefined, cosine: boolean): Rational | undefined {
  const turns = exactQuarterTurns(form);
  if (turns === undefined) return undefined;
  const quarter = (turns % 4 + 4) % 4;
  return rational(BigInt((cosine ? [1, 0, -1, 0] : [0, 1, 0, -1])[quarter]!));
}
function exactQuarterTurns(form: ExactForm | undefined): number | undefined {
  if (!form) return undefined;
  const q = form.size === 0 ? Q_ZERO : form.size === 1 ? form.get("1,0") : undefined;
  if (!q || (2n * q.n) % q.d !== 0n) return undefined;
  const turns = Number(2n * q.n / q.d);
  return Number.isSafeInteger(turns) ? turns : undefined;
}

// Remainders are upper bounds, so a positive remainder below the subnormal
// grid rounds UP to MIN_VALUE. Expression values themselves never get this
// treatment: their nonzero underflow is rejected by the arithmetic above.
function positiveUpperProduct(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  const value = a * b;
  return value === 0 ? Number.MIN_VALUE : adjacent(value, true);
}
function positiveUpperQuotient(a: number, b: number): number {
  if (a === 0) return 0;
  const value = a / b;
  return value === 0 ? Number.MIN_VALUE : adjacent(value, true);
}
function factorialRemainder(radius: number, degree: number, budget: CertifiedBudget): number {
  let result = 1;
  for (let index = 1; index <= degree; index++) {
    certifiedStep(budget);
    result = positiveUpperQuotient(positiveUpperProduct(result, radius), index);
  }
  return result;
}
function symmetricRemainder(value: Interval, error: number): Interval {
  return error === 0 ? value : boundsAdd(value, { low: -error, high: error });
}

function boundedTrig(a: Interval, cosine: boolean, budget: CertifiedBudget): Interval {
  const cycles = Math.round((a.low / 2 + a.high / 2) / (2 * Math.PI));
  const reduced = cycles === 0 ? a : boundsSubtract(a, boundsMultiply(pointBounds(2 * cycles), CERTIFIED_PI));
  const radius = boundMagnitude(reduced);
  if (radius > 4) return { low: -1, high: 1 };
  if (radius < 1e-4) {
    const square = positiveUpperProduct(radius, radius);
    return cosine ? symmetricRemainder(pointBounds(1), positiveUpperQuotient(square, 2))
      : symmetricRemainder(reduced, positiveUpperQuotient(positiveUpperProduct(square, radius), 6));
  }
  const square = boundsMultiply(reduced, reduced);
  let term = cosine ? pointBounds(1) : reduced; let sum = term; let terms = 0;
  for (let index = 1; index <= 20; index++) {
    certifiedStep(budget);
    const degree = 2 * index + (cosine ? 0 : 1);
    term = boundsNegate(boundsDivide(boundsMultiply(term, square), pointBounds(degree * (degree - 1))));
    sum = boundsAdd(sum, term); terms = index;
    if (boundMagnitude(term) < 1e-22) break;
  }
  // Taylor at zero: every real derivative of sin/cos has magnitude <= 1.
  const result = symmetricRemainder(sum, factorialRemainder(radius, 2 * terms + (cosine ? 2 : 3), budget));
  return { low: Math.max(-1, result.low), high: Math.min(1, result.high) };
}

function boundedSqrtPoint(value: number, budget: CertifiedBudget): Interval {
  if (value < 0) throw new Error("certified sqrt argument is negative");
  if (value === 0) return pointBounds(0);
  const source = binaryRational(value);
  const compareSquare = (candidate: number): number => {
    certifiedStep(budget);
    return compareRational(multiplyRational(binaryRational(candidate), binaryRational(candidate)), source);
  };
  const candidate = Math.sqrt(value);
  if (!(candidate > 0 && Number.isFinite(candidate))) throw new Error("certified sqrt underflows or is nonfinite");
  const comparison = compareSquare(candidate);
  if (comparison === 0) return pointBounds(candidate);
  let low = comparison < 0 ? candidate : adjacent(candidate, false);
  let high = comparison > 0 ? candidate : adjacent(candidate, true);
  // Validate the bracket with exact squares; libm is only an initial estimate.
  for (let index = 0; index < 64; index++) {
    const lower = compareSquare(low); const upper = compareSquare(high);
    if (lower <= 0 && upper >= 0) return { low, high };
    if (lower > 0) low = adjacent(low, false);
    if (upper < 0) high = adjacent(high, true);
  }
  throw new Error("sqrt estimate could not be certified within the operation budget");
}
function boundedSqrt(a: Interval, budget: CertifiedBudget): Interval {
  if (a.low < 0) throw new Error("certified sqrt argument may be negative");
  return { low: boundedSqrtPoint(a.low, budget).low, high: boundedSqrtPoint(a.high, budget).high };
}

function boundedExp(a: Interval, budget: CertifiedBudget): Interval {
  if (a.low > 28) throw new Error("certified exp exceeds the supported numeric range");
  if (a.high < -746) throw new Error("certified exp underflows binary64");
  const power = Math.max(0, Math.ceil(Math.log2(Math.max(1, boundMagnitude(a)))) + 1);
  const reduced = boundsDivide(a, pointBounds(2 ** power));
  const radius = boundMagnitude(reduced);
  let sum: Interval;
  if (radius < 1e-8) {
    sum = symmetricRemainder(boundsAdd(pointBounds(1), reduced), positiveUpperProduct(2, positiveUpperProduct(radius, radius)));
  } else {
    let term = pointBounds(1); sum = term;
    for (let index = 1; index <= 22; index++) {
      certifiedStep(budget);
      term = boundsDivide(boundsMultiply(term, reduced), pointBounds(index));
      sum = boundsAdd(sum, term);
    }
    // |reduced| < 1, hence exp(|reduced|) < 3 in the Lagrange remainder.
    sum = symmetricRemainder(sum, positiveUpperProduct(3, factorialRemainder(radius, 23, budget)));
  }
  for (let index = 0; index < power; index++) { certifiedStep(budget); sum = boundsMultiply(sum, sum); }
  if (!(sum.low > 0)) throw new Error("certified exp positive value exceeds available precision");
  return sum;
}

function boundedLogPoint(value: number, budget: CertifiedBudget): Interval {
  if (!(value > 0)) throw new Error("certified log argument must be strictly positive");
  if (value === 1) return pointBounds(0);
  let exponent = Math.floor(Math.log2(value)); let scale = 2 ** exponent; let mantissa = value / scale;
  for (let index = 0; index < 4 && !(mantissa >= 1 && mantissa <= 2); index++) {
    certifiedStep(budget);
    exponent += mantissa < 1 ? -1 : 1; scale = 2 ** exponent; mantissa = value / scale;
  }
  if (!(mantissa >= 1 && mantissa <= 2 && Number.isFinite(scale) && scale > 0)) throw new Error("certified log range reduction failed");
  const exactlyScaled = compareRational(multiplyRational(binaryRational(mantissa), binaryRational(scale)), binaryRational(value)) === 0;
  const m = exactlyScaled ? pointBounds(mantissa) : boundsDivide(pointBounds(value), pointBounds(scale));
  let logMantissa = pointBounds(0);
  if (mantissa !== 1) {
    const z = boundsDivide(boundsSubtract(m, pointBounds(1)), boundsAdd(m, pointBounds(1)));
    const square = boundsMultiply(z, z); let term = z; let sum = z;
    for (let index = 1; index < 24; index++) {
      certifiedStep(budget);
      term = boundsMultiply(term, square);
      sum = boundsAdd(sum, boundsDivide(term, pointBounds(2 * index + 1)));
    }
    const radius = boundMagnitude(z);
    let tail = radius;
    for (let index = 0; index < 24; index++) { certifiedStep(budget); tail = positiveUpperProduct(tail, positiveUpperProduct(radius, radius)); }
    const denominator = adjacent(49 * adjacent(1 - positiveUpperProduct(radius, radius), false), false);
    const remainder = positiveUpperQuotient(positiveUpperProduct(2, tail), denominator);
    logMantissa = symmetricRemainder(boundsMultiply(pointBounds(2), sum), remainder);
  }
  return exponent === 0 ? logMantissa : boundsAdd(logMantissa, boundsMultiply(pointBounds(exponent), CERTIFIED_LN2));
}
function boundedLog(a: Interval, budget: CertifiedBudget): Interval {
  return { low: boundedLogPoint(a.low, budget).low, high: boundedLogPoint(a.high, budget).high };
}

function boundedAtanPoint(value: number, budget: CertifiedBudget): Interval {
  if (value === 0) return pointBounds(0);
  if (value < 0) return boundsNegate(boundedAtanPoint(-value, budget));
  const reciprocal = value > 1;
  let z = reciprocal ? boundsDivide(pointBounds(1), pointBounds(value)) : pointBounds(value);
  // atan(z)=2*atan(z/(1+sqrt(1+z^2))). Two reductions put |z|<0.2.
  for (let index = 0; index < 2; index++) {
    certifiedStep(budget);
    z = boundsDivide(z, boundsAdd(pointBounds(1), boundedSqrt(boundsAdd(pointBounds(1), boundsMultiply(z, z)), budget)));
  }
  const square = boundsMultiply(z, z); let term = z; let sum = z;
  for (let index = 1; index < 18; index++) {
    certifiedStep(budget);
    term = boundsNegate(boundsMultiply(term, square));
    sum = boundsAdd(sum, boundsDivide(term, pointBounds(2 * index + 1)));
  }
  let remainder = boundMagnitude(z);
  for (let index = 0; index < 18; index++) { certifiedStep(budget); remainder = positiveUpperProduct(remainder, positiveUpperProduct(boundMagnitude(z), boundMagnitude(z))); }
  const result = boundsMultiply(pointBounds(4), symmetricRemainder(sum, positiveUpperQuotient(remainder, 37)));
  return reciprocal ? boundsSubtract(boundsDivide(CERTIFIED_PI, pointBounds(2)), result) : result;
}
function boundedAtan(a: Interval, budget: CertifiedBudget): Interval {
  return { low: boundedAtanPoint(a.low, budget).low, high: boundedAtanPoint(a.high, budget).high };
}
function boundedAsinPoint(value: number, budget: CertifiedBudget): Interval {
  if (Math.abs(value) > 1) throw new Error("certified asin argument leaves [-1,1]");
  if (Math.abs(value) === 1) return value < 0 ? boundsNegate(boundsDivide(CERTIFIED_PI, pointBounds(2))) : boundsDivide(CERTIFIED_PI, pointBounds(2));
  if (value === 0) return pointBounds(0);
  // The identity is valid on the whole real principal asin domain.
  const denominator = boundedSqrt(boundsMultiply(boundsSubtract(pointBounds(1), pointBounds(value)), boundsAdd(pointBounds(1), pointBounds(value))), budget);
  return boundedAtan(boundsDivide(pointBounds(value), denominator), budget);
}

function boundedFunction(name: FunctionName, a: Interval, budget: CertifiedBudget): Interval {
  switch (name) {
    case "sin": return boundedTrig(a, false, budget);
    case "cos": return boundedTrig(a, true, budget);
    case "sqrt": return boundedSqrt(a, budget);
    case "exp": return boundedExp(a, budget);
    case "log":
    case "ln": return boundedLog(a, budget);
    case "atan": return boundedAtan(a, budget);
    case "asin": return { low: boundedAsinPoint(a.low, budget).low, high: boundedAsinPoint(a.high, budget).high };
    case "acos": return boundsSubtract(boundsDivide(CERTIFIED_PI, pointBounds(2)), { low: boundedAsinPoint(a.low, budget).low, high: boundedAsinPoint(a.high, budget).high });
    case "abs": return { low: containsZero(a) ? 0 : Math.min(Math.abs(a.low), Math.abs(a.high)), high: boundMagnitude(a) };
    case "tan": return boundsDivide(boundedTrig(a, false, budget), boundedTrig(a, true, budget));
  }
}

function certifiedFunctionValue(name: FunctionName, a: CertifiedScalar, budget: CertifiedBudget): CertifiedScalar {
  certifiedStep(budget);
  const q = exactRationalPart(a.exact);
  if (name === "sin" || name === "cos") {
    const cardinal = cardinalTrig(a.exact, name === "cos");
    if (cardinal) return scalarFromForm(makeExact(cardinal), budget);
  }
  if (name === "exp" && q?.d === 1n && q.n >= -BigInt(MAX_EXACT_POWER) && q.n <= BigInt(MAX_EXACT_POWER)) {
    return scalarFromForm(makeExact(Q_ONE, 0, Number(q.n)), budget);
  }
  if (name === "log" || name === "ln") {
    if (q && compareRational(q, Q_ONE) === 0) return CERTIFIED_ZERO;
    if (sameForm(a.exact, makeExact(Q_ONE, 0, 1))) return CERTIFIED_ONE;
  }
  if (name === "abs") {
    if (a.bounds.low >= 0) return a;
    if (a.bounds.high <= 0) return certifiedNegate(a);
  }
  if (name === "sqrt" && q) {
    const candidate = Math.sqrt(a.value);
    if (Number.isFinite(candidate) && compareRational(multiplyRational(binaryRational(candidate), binaryRational(candidate)), q) === 0) {
      return certifiedNumber(candidate, budget);
    }
  }
  if ((name === "atan" || name === "asin") && q?.n === 0n) return CERTIFIED_ZERO;
  if (name === "atan" && q && q.d === 1n && (q.n === 1n || q.n === -1n)) return scalarFromForm(makeExact(rational(q.n, 4n), 1), budget);
  if (name === "acos" && q?.n === 0n) return scalarFromForm(makeExact(rational(1n, 2n), 1), budget);
  if (name === "tan") return certifiedDivide(certifiedFunctionValue("sin", a, budget), certifiedFunctionValue("cos", a, budget), budget);
  return scalarFromBounds(boundedFunction(name, a.bounds, budget), FUNCTIONS[name](a.value));
}

function certifiedJetMultiply(a: CertifiedJet, b: CertifiedJet, budget: CertifiedBudget): CertifiedJet {
  const mul = (left: CertifiedScalar, right: CertifiedScalar) => certifiedMultiply(left, right, budget);
  const add = (left: CertifiedScalar, right: CertifiedScalar) => certifiedAdd(left, right, budget);
  return {
    value: mul(a.value, b.value),
    first: add(mul(a.first, b.value), mul(a.value, b.first)),
    second: add(add(mul(a.second, b.value), mul(certifiedNumber(2, budget), mul(a.first, b.first))), mul(a.value, b.second)),
    constant: a.constant && b.constant,
  };
}
function certifiedJetDivide(a: CertifiedJet, b: CertifiedJet, budget: CertifiedBudget): CertifiedJet {
  const mul = (left: CertifiedScalar, right: CertifiedScalar) => certifiedMultiply(left, right, budget);
  const sub = (left: CertifiedScalar, right: CertifiedScalar) => certifiedAdd(left, right, budget, true);
  const div = (left: CertifiedScalar, right: CertifiedScalar) => certifiedDivide(left, right, budget);
  const value = div(a.value, b.value);
  const first = div(sub(a.first, mul(value, b.first)), b.value);
  const second = div(sub(sub(a.second, mul(certifiedNumber(2, budget), mul(first, b.first))), mul(value, b.second)), b.value);
  return { value, first, second, constant: a.constant && b.constant };
}
function certifiedJetConstant(value: CertifiedScalar): CertifiedJet {
  return { value, first: CERTIFIED_ZERO, second: CERTIFIED_ZERO, constant: true };
}
function certifiedJetFunction(name: FunctionName, a: CertifiedJet, budget: CertifiedBudget): CertifiedJet {
  const mul = (left: CertifiedScalar, right: CertifiedScalar) => certifiedMultiply(left, right, budget);
  const add = (left: CertifiedScalar, right: CertifiedScalar) => certifiedAdd(left, right, budget);
  const sub = (left: CertifiedScalar, right: CertifiedScalar) => certifiedAdd(left, right, budget, true);
  const div = (left: CertifiedScalar, right: CertifiedScalar) => certifiedDivide(left, right, budget);
  const fn = (n: FunctionName, v: CertifiedScalar) => certifiedFunctionValue(n, v, budget);
  const value = fn(name, a.value);
  if (a.constant) return certifiedJetConstant(value);
  let factor: CertifiedScalar; let secondFactor = CERTIFIED_ZERO;
  const two = certifiedNumber(2, budget);
  switch (name) {
    case "sin": factor = fn("cos", a.value); secondFactor = certifiedNegate(value); break;
    case "cos": factor = certifiedNegate(fn("sin", a.value)); secondFactor = certifiedNegate(value); break;
    case "tan": {
      const cosine = fn("cos", a.value);
      factor = div(CERTIFIED_ONE, mul(cosine, cosine)); secondFactor = mul(two, mul(value, factor)); break;
    }
    case "asin":
    case "acos": {
      if (!(a.value.bounds.low > -1 && a.value.bounds.high < 1)) throw new Error(`${name} certified derivative requires (-1,1)`);
      const denominator = mul(sub(CERTIFIED_ONE, a.value), add(CERTIFIED_ONE, a.value));
      factor = div(name === "acos" ? certifiedNegate(CERTIFIED_ONE) : CERTIFIED_ONE, fn("sqrt", denominator));
      secondFactor = div(mul(factor, a.value), denominator); break;
    }
    case "atan": {
      factor = div(CERTIFIED_ONE, add(CERTIFIED_ONE, mul(a.value, a.value)));
      secondFactor = certifiedNegate(mul(two, mul(a.value, mul(factor, factor)))); break;
    }
    case "sqrt":
      if (!(a.value.bounds.low > 0)) throw new Error("sqrt certified derivative requires a strictly positive argument");
      factor = div(CERTIFIED_ONE, mul(two, value));
      secondFactor = certifiedNegate(div(CERTIFIED_ONE, mul(certifiedNumber(4, budget), mul(a.value, value)))); break;
    case "abs":
      if (containsZero(a.value.bounds)) throw new Error("abs certified derivative cannot cross its cusp");
      factor = a.value.bounds.low > 0 ? CERTIFIED_ONE : certifiedNegate(CERTIFIED_ONE); break;
    case "exp": factor = value; secondFactor = value; break;
    case "log":
    case "ln": factor = div(CERTIFIED_ONE, a.value); secondFactor = certifiedNegate(mul(factor, factor)); break;
  }
  return { value, first: mul(factor, a.first), second: add(mul(secondFactor, mul(a.first, a.first)), mul(factor, a.second)), constant: false };
}
function certifiedJetIntegerPower(a: CertifiedJet, exponent: number, budget: CertifiedBudget): CertifiedJet {
  let result = certifiedJetConstant(CERTIFIED_ONE); let factor = a; let remaining = Math.abs(exponent);
  while (remaining > 0) {
    certifiedStep(budget);
    if (remaining % 2 === 1) result = certifiedJetMultiply(result, factor, budget);
    remaining = Math.floor(remaining / 2);
    if (remaining) factor = certifiedJetMultiply(factor, factor, budget);
  }
  return exponent < 0 ? certifiedJetDivide(certifiedJetConstant(CERTIFIED_ONE), result, budget) : result;
}

/** Forward-mode order-two chain rule, with one shared absolute certificate. */
function evaluateCertifiedJet(node: ExpressionNode, x: number, budget: CertifiedBudget): CertifiedJet {
  certifiedStep(budget);
  if (node.kind === "number") {
    const form = node.exactConstant === "pi" ? makeExact(Q_ONE, 1) : node.exactConstant === "e" ? makeExact(Q_ONE, 0, 1) : makeExact(node.literal !== undefined ? parseRational(node.literal) : binaryRational(node.value));
    return certifiedJetConstant(scalarFromForm(form, budget));
  }
  if (node.kind === "variable") return { value: certifiedNumber(x, budget), first: CERTIFIED_ONE, second: CERTIFIED_ZERO, constant: false };
  if (node.kind === "unary") {
    const a = evaluateCertifiedJet(node.value, x, budget);
    return node.operator === "+" ? a : { value: certifiedNegate(a.value), first: certifiedNegate(a.first), second: certifiedNegate(a.second), constant: a.constant };
  }
  if (node.kind === "function") return certifiedJetFunction(node.name, evaluateCertifiedJet(node.argument, x, budget), budget);
  const a = evaluateCertifiedJet(node.left, x, budget); const b = evaluateCertifiedJet(node.right, x, budget);
  switch (node.operator) {
    case "+":
    case "-": return {
      value: certifiedAdd(a.value, b.value, budget, node.operator === "-"),
      first: certifiedAdd(a.first, b.first, budget, node.operator === "-"),
      second: certifiedAdd(a.second, b.second, budget, node.operator === "-"), constant: a.constant && b.constant,
    };
    case "*": return certifiedJetMultiply(a, b, budget);
    case "/": return certifiedJetDivide(a, b, budget);
    case "^": {
      const q = b.constant && exactRationalPart(b.value.exact);
      if (q && q.d === 1n) {
        if (q.n < -BigInt(MAX_EXACT_POWER) || q.n > BigInt(MAX_EXACT_POWER)) throw new Error("certified integer power exceeds capacity");
        return certifiedJetIntegerPower(a, Number(q.n), budget);
      }
      if (a.constant && b.constant && a.value.exact?.size === 0 && b.value.bounds.low > 0) return certifiedJetConstant(CERTIFIED_ZERO);
      if (!(a.value.bounds.low > 0)) throw new Error("certified noninteger power requires a strictly positive base");
      return certifiedJetFunction("exp", certifiedJetMultiply(b, certifiedJetFunction("log", a, budget), budget), budget);
    }
  }
}

// Range evaluation shares the point certificate's constant algebra and outward
// function enclosures. Keeping the coefficients of x symbolically prevents
// floating cancellation (and interval dependency) from manufacturing a sign.
type CertifiedPolynomial = ReadonlyMap<number, ExactForm>;
type CertifiedRange = { bounds: Interval; polynomial?: CertifiedPolynomial };
type RationalBounds = { low: Rational; high: Rational };

function polynomialConstant(form: ExactForm): CertifiedPolynomial {
  return form.size === 0 ? new Map() : new Map([[0, form]]);
}
function polynomialConstantForm(polynomial: CertifiedPolynomial | undefined): ExactForm | undefined {
  if (!polynomial) return undefined;
  return polynomial.size === 0 ? makeExact(Q_ZERO) : polynomial.size === 1 ? polynomial.get(0) : undefined;
}
function checkPolynomialCapacity(polynomial: CertifiedPolynomial): void {
  if ([...polynomial.values()].reduce((size, form) => size + form.size, 0) > MAX_EXACT_TERMS) throw new Error("certified polynomial exceeds the term budget");
}
function polynomialAdd(a: CertifiedPolynomial, b: CertifiedPolynomial, subtract: boolean, budget: CertifiedBudget): CertifiedPolynomial {
  const result = new Map(a);
  for (const [degree, coefficient] of b) {
    certifiedStep(budget);
    const next = formAdd(result.get(degree) ?? makeExact(Q_ZERO), coefficient, subtract, budget);
    if (next.size === 0) result.delete(degree); else result.set(degree, next);
  }
  checkPolynomialCapacity(result);
  return result;
}
function polynomialMultiply(a: CertifiedPolynomial, b: CertifiedPolynomial, budget: CertifiedBudget): CertifiedPolynomial {
  const result = new Map<number, ExactForm>();
  for (const [aDegree, aCoefficient] of a) for (const [bDegree, bCoefficient] of b) {
    certifiedStep(budget);
    const degree = aDegree + bDegree;
    if (degree > MAX_EXACT_POWER) throw new Error("certified polynomial degree exceeds capacity");
    const coefficient = formAdd(result.get(degree) ?? makeExact(Q_ZERO), formMultiply(aCoefficient, bCoefficient, budget), false, budget);
    if (coefficient.size === 0) result.delete(degree); else result.set(degree, coefficient);
    checkPolynomialCapacity(result);
  }
  return result;
}
function polynomialDivide(a: CertifiedPolynomial, b: CertifiedPolynomial, budget: CertifiedBudget): CertifiedPolynomial | undefined {
  if (a.size === b.size && [...a].every(([degree, form]) => sameForm(form, b.get(degree)))) return polynomialConstant(makeExact(Q_ONE));
  const denominator = polynomialConstantForm(b);
  if (!denominator) return undefined;
  const result = new Map<number, ExactForm>();
  for (const [degree, form] of a) {
    certifiedStep(budget);
    const quotient = formDivide(form, denominator, budget);
    if (!quotient) return undefined;
    if (quotient.size !== 0) result.set(degree, quotient);
  }
  return result;
}
function polynomialPower(a: CertifiedPolynomial, exponent: number, budget: CertifiedBudget): CertifiedPolynomial {
  let result = polynomialConstant(makeExact(Q_ONE)); let factor = a; let remaining = exponent;
  while (remaining > 0) {
    certifiedStep(budget);
    if (remaining % 2 === 1) result = polynomialMultiply(result, factor, budget);
    remaining = Math.floor(remaining / 2);
    if (remaining) factor = polynomialMultiply(factor, factor, budget);
  }
  return result;
}
function rationalPower(q: Rational, exponent: number, budget: CertifiedBudget): Rational {
  let result = Q_ONE; let factor = q; let remaining = Math.abs(exponent);
  while (remaining > 0) {
    certifiedStep(budget);
    if (remaining % 2 === 1) result = multiplyRational(result, factor);
    remaining = Math.floor(remaining / 2);
    if (remaining) factor = multiplyRational(factor, factor);
  }
  return exponent < 0 ? divideRational(Q_ONE, result) : result;
}
function rationalRangePower(a: Interval, exponent: number, budget: CertifiedBudget): RationalBounds {
  if (exponent < 0 && containsZero(a)) throw new Error("certified negative power may divide by zero");
  const left = rationalPower(binaryRational(a.low), exponent, budget); const right = rationalPower(binaryRational(a.high), exponent, budget);
  const low = compareRational(left, right) < 0 ? left : right; const high = compareRational(left, right) > 0 ? left : right;
  return { low: exponent > 0 && exponent % 2 === 0 && containsZero(a) ? Q_ZERO : low, high };
}
function rationalRangeMultiply(a: RationalBounds, b: RationalBounds, budget: CertifiedBudget): RationalBounds {
  const products: Rational[] = [];
  for (const left of [a.low, a.high]) for (const right of [b.low, b.high]) { certifiedStep(budget); products.push(multiplyRational(left, right)); }
  return {
    low: products.reduce((low, value) => compareRational(low, value) <= 0 ? low : value),
    high: products.reduce((high, value) => compareRational(high, value) >= 0 ? high : value),
  };
}
function rangeFromRationals(bounds: RationalBounds): Interval {
  return { low: rationalBounds(bounds.low).low, high: rationalBounds(bounds.high).high };
}
function polynomialAt(polynomial: CertifiedPolynomial, x: number, budget: CertifiedBudget): ExactForm {
  let result = makeExact(Q_ZERO);
  for (const [degree, form] of polynomial) {
    certifiedStep(budget);
    result = formAdd(result, formMultiply(form, makeExact(rationalPower(binaryRational(x), degree, budget)), budget), false, budget);
  }
  return result;
}
function rangeFromBounds(bounds: Interval, polynomial?: CertifiedPolynomial): CertifiedRange {
  checked(bounds.low, "certified interval lower bound"); checked(bounds.high, "certified interval upper bound");
  if (bounds.low > bounds.high) throw new Error("invalid certified expression interval");
  return { bounds, polynomial };
}
function intersectRange(a: CertifiedRange, b: Interval): CertifiedRange {
  // Both are whole-domain certificates. Preserve the polynomial identity while
  // retaining tighter structural proofs, such as the nonnegativity of a square.
  return rangeFromBounds({ low: Math.max(a.bounds.low, b.low), high: Math.min(a.bounds.high, b.high) }, a.polynomial);
}
function rangeFromPolynomial(polynomial: CertifiedPolynomial, x: Interval, budget: CertifiedBudget): CertifiedRange {
  if (x.low === x.high) return rangeFromBounds(scalarFromForm(polynomialAt(polynomial, x.low, budget), budget).bounds, polynomial);
  let bounds: RationalBounds = { low: Q_ZERO, high: Q_ZERO };
  for (const [degree, coefficient] of polynomial) {
    certifiedStep(budget);
    const q = exactRationalPart(coefficient);
    const coefficientBounds = q ? { low: q, high: q } : (() => {
      const value = scalarFromForm(coefficient, budget).bounds;
      return { low: binaryRational(value.low), high: binaryRational(value.high) };
    })();
    const term = rationalRangeMultiply(coefficientBounds, rationalRangePower(x, degree, budget), budget);
    bounds = { low: addRational(bounds.low, term.low), high: addRational(bounds.high, term.high) };
  }
  return rangeFromBounds(rangeFromRationals(bounds), polynomial);
}
function rangeConstantForm(a: CertifiedRange, x: Interval, budget: CertifiedBudget): ExactForm | undefined {
  return polynomialConstantForm(a.polynomial) ?? (x.low === x.high && a.polynomial ? polynomialAt(a.polynomial, x.low, budget) : undefined);
}
function certifiedRangeFunction(name: FunctionName, a: CertifiedRange, x: Interval, budget: CertifiedBudget): CertifiedRange {
  const constant = rangeConstantForm(a, x, budget);
  if (constant) {
    const value = certifiedFunctionValue(name, scalarFromForm(constant, budget), budget);
    return rangeFromBounds(value.bounds, value.exact ? polynomialConstant(value.exact) : undefined);
  }
  if (name === "exp") {
    // Monotonic endpoint certificates avoid range dependency in the Taylor
    // reconstruction and preserve exp(0)=1 at a closed-domain boundary.
    const low = certifiedFunctionValue("exp", certifiedNumber(a.bounds.low, budget), budget).bounds.low;
    const high = certifiedFunctionValue("exp", certifiedNumber(a.bounds.high, budget), budget).bounds.high;
    return rangeFromBounds({ low, high });
  }
  return rangeFromBounds(boundedFunction(name, a.bounds, budget));
}
function evaluateCertifiedRange(node: ExpressionNode, x: Interval, budget: CertifiedBudget): CertifiedRange {
  certifiedStep(budget);
  if (node.kind === "number") {
    const form = node.exactConstant === "pi" ? makeExact(Q_ONE, 1) : node.exactConstant === "e" ? makeExact(Q_ONE, 0, 1) : makeExact(node.literal !== undefined ? parseRational(node.literal) : binaryRational(node.value));
    return rangeFromPolynomial(polynomialConstant(form), x, budget);
  }
  if (node.kind === "variable") return rangeFromPolynomial(new Map([[1, makeExact(Q_ONE)]]), x, budget);
  if (node.kind === "unary") {
    const value = evaluateCertifiedRange(node.value, x, budget);
    if (node.operator === "+") return value;
    return value.polynomial ? rangeFromPolynomial(polynomialAdd(new Map(), value.polynomial, true, budget), x, budget) : rangeFromBounds(boundsNegate(value.bounds));
  }
  if (node.kind === "function") return certifiedRangeFunction(node.name, evaluateCertifiedRange(node.argument, x, budget), x, budget);
  const a = evaluateCertifiedRange(node.left, x, budget); const b = evaluateCertifiedRange(node.right, x, budget);
  switch (node.operator) {
    case "+":
    case "-": {
      const bounds = node.operator === "-" ? boundsSubtract(a.bounds, b.bounds) : boundsAdd(a.bounds, b.bounds);
      return a.polynomial && b.polynomial ? intersectRange(rangeFromPolynomial(polynomialAdd(a.polynomial, b.polynomial, node.operator === "-", budget), x, budget), bounds) : rangeFromBounds(bounds);
    }
    case "*": {
      if (a.polynomial && b.polynomial) {
        const polynomial = polynomialMultiply(a.polynomial, b.polynomial, budget);
        const result = rangeFromPolynomial(polynomial, x, budget);
        return polynomial.size === 0 ? result : intersectRange(result, boundsMultiply(a.bounds, b.bounds));
      }
      return rangeFromBounds(boundsMultiply(a.bounds, b.bounds));
    }
    case "/": {
      if (containsZero(b.bounds)) throw new Error("certified interval denominator may be zero");
      const polynomial = a.polynomial && b.polynomial && polynomialDivide(a.polynomial, b.polynomial, budget);
      return polynomial ? intersectRange(rangeFromPolynomial(polynomial, x, budget), boundsDivide(a.bounds, b.bounds)) : rangeFromBounds(boundsDivide(a.bounds, b.bounds));
    }
    case "^": {
      const exponentForm = rangeConstantForm(b, x, budget); const exponent = exactRationalPart(exponentForm);
      if (exponent?.d === 1n) {
        if (exponent.n < -BigInt(MAX_EXACT_POWER) || exponent.n > BigInt(MAX_EXACT_POWER)) throw new Error("certified interval integer power exceeds capacity");
        const power = Number(exponent.n);
        if (power < 0 && containsZero(a.bounds)) throw new Error("certified interval negative power may divide by zero");
        if (a.polynomial) {
          const positive = polynomialPower(a.polynomial, Math.abs(power), budget);
          const polynomial = power < 0 ? polynomialDivide(polynomialConstant(makeExact(Q_ONE)), positive, budget) : positive;
          if (polynomial) return intersectRange(rangeFromPolynomial(polynomial, x, budget), rangeFromRationals(rationalRangePower(a.bounds, power, budget)));
        }
        return rangeFromBounds(rangeFromRationals(rationalRangePower(a.bounds, power, budget)));
      }
      if (exponent && compareRational(exponent, rational(1n, 2n)) === 0) return certifiedRangeFunction("sqrt", a, x, budget);
      if (polynomialConstantForm(a.polynomial)?.size === 0 && b.bounds.low > 0) return rangeFromPolynomial(new Map(), x, budget);
      if (!(a.bounds.low > 0)) throw new Error("certified interval noninteger power requires a strictly positive base");
      const logarithm = boundedLog(a.bounds, budget);
      const product = rangeFromRationals(rationalRangeMultiply(
        { low: binaryRational(b.bounds.low), high: binaryRational(b.bounds.high) },
        { low: binaryRational(logarithm.low), high: binaryRational(logarithm.high) }, budget,
      ));
      return certifiedRangeFunction("exp", rangeFromBounds(product), x, budget);
    }
  }
}
