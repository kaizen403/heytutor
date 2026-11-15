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
  | { kind: "number"; value: number; literal?: string }
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
  evaluate(x: number): number;
  derivative(x: number): number;
  assertContinuousOn(xMin: number, xMax: number): void;
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
      if (token.value === "pi") return { kind: "number", value: Math.PI };
      if (token.value === "e") return { kind: "number", value: Math.E };
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
