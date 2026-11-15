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
  | { kind: "number"; value: number }
  | { kind: "variable"; name: VariableName }
  | { kind: "unary"; operator: UnaryOperator; value: ExpressionNode }
  | { kind: "binary"; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode }
  | { kind: "function"; name: FunctionName; argument: ExpressionNode };

type Token =
  | { kind: "number"; value: number; position: number }
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

/** Prove structural or bounded rational-polynomial identity. This never treats
 * agreement at sampled points as equality. Non-polynomial rewrites decline;
 * identical non-polynomial syntax retains its existing parser semantics. */
export function mathExpressionsEquivalent(left: string, right: string, options: { allowNonzeroScale?: boolean } = {}): boolean {
  try {
    const read = (source: string) => {
      if (source.length > MAX_EXPRESSION_LENGTH * 2 + 8) throw new Error("identity expression too long");
      return new Parser(tokenize(normalizePlainMathSource(source)), new Set<VariableName>(["x", "y"])).parse();
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
      if ((node.operator === "*" || node.operator === "/" || node.operator === "^") && r.kind === "number" && r.value === 1) return l;
      if (node.operator === "*" && l.kind === "number" && l.value === 1) return r;
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
    type Fraction = { n: bigint; d: bigint };
    type Polynomial = Map<string, Fraction>;
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
    const number = (value: number): Fraction => {
      if (!Number.isFinite(value)) throw new Error("nonfinite coefficient");
      const [mantissa, exponent = "0"] = String(value).split("e");
      const decimals = mantissa!.split(".")[1]?.length ?? 0;
      const scale = decimals - Number(exponent);
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
        if (u === "0,0" || v === "0,0") {
          put(result, u === "0,0" ? v : u, fraction(c.n * d.n, c.d * d.d));
          continue;
        }
        if (u.startsWith("function:") || v.startsWith("function:")) throw new Error("non-polynomial product");
        const [ux, uy] = u.split(",").map(Number), [vx, vy] = v.split(",").map(Number);
        const px = ux! + vx!, py = uy! + vy!;
        if (px + py > 16) throw new Error("identity degree limit");
        put(result, `${px},${py}`, fraction(c.n * d.n, c.d * d.d));
      }
      return result;
    };
    const functionAtoms = new Set<string>();
    const polynomial = (node: ExpressionNode): Polynomial => {
      step();
      if (node.kind === "number") return constant(number(node.value));
      if (node.kind === "variable") return new Map([[node.name === "x" ? "1,0" : "0,1", fraction(1n)]]);
      if (node.kind === "function") {
        // Rearranging identical function terms does not change their arguments
        // or domains. Only scalar arithmetic may combine these opaque terms.
        const key = `function:${JSON.stringify(node)}`;
        functionAtoms.add(key);
        return new Map([[key, fraction(1n)]]);
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
      if (!scalar) throw new Error("nonconstant divisor or exponent");
      if (node.operator === "/") {
        if (!scalar.n) throw new Error("zero divisor");
        return new Map([...x].map(([key, value]) => [key, fraction(value.n * scalar.d, value.d * scalar.n)]));
      }
      if (scalar.d !== 1n || scalar.n < 0n || scalar.n > 16n) throw new Error("unsupported polynomial power");
      let result = constant(fraction(1n));
      for (let i = 0; i < Number(scalar.n); i++) result = multiply(result, x);
      return result;
    };
    const x = polynomial(a), leftFunctions = new Set(functionAtoms);
    functionAtoms.clear();
    const y = polynomial(b);
    if (leftFunctions.size !== functionAtoms.size || [...leftFunctions].some(key => !functionAtoms.has(key))) return false;
    if (x.size !== y.size || [...x.keys()].some(key => !y.has(key))) return false;
    if (x.size === 0) return true;
    const key = x.keys().next().value!;
    const xc = options.allowNonzeroScale ? x.get(key)! : fraction(1n);
    const yc = options.allowNonzeroScale ? y.get(key)! : fraction(1n);
    return [...x].every(([term, value]) => {
      const other = y.get(term)!;
      return value.n * yc.n * other.d * xc.d === other.n * xc.n * value.d * yc.d;
    });
  } catch { return false; }
}

/** A bounded analytic degree proof, never a fit to sampled points. */
export function isAffineMathExpression(source: string): boolean {
  try {
    const parsed = parseMathExpression(source);
    const root = new Parser(tokenize(normalizePlainMathSource(source)), new Set<VariableName>(["x"])).parse();
    const degree = (node: ExpressionNode): number => {
      chargeExpressionSteps(1);
      if (node.kind === "number") return 0;
      if (node.kind === "variable") return 1;
      if (node.kind === "unary") return degree(node.value);
      if (node.kind === "function") return degree(node.argument) === 0 ? 0 : Infinity;
      const left = degree(node.left), right = degree(node.right);
      if (node.operator === "+" || node.operator === "-") return Math.max(left, right);
      if (node.operator === "*") return left + right;
      if (node.operator === "/") return right === 0 ? left : Infinity;
      if (right !== 0) return Infinity;
      const power = evaluateNode(node.right, { x: 0, y: 0 }, { remaining: MAX_EVALUATION_STEPS });
      return Number.isInteger(power) && power >= 0 && power <= 16 ? power === 0 ? 0 : left * power : Infinity;
    };
    const intercept = parsed.evaluate(0);
    if (degree(root) <= 1) return true;
    const slope = parsed.derivative(0);
    return mathExpressionsEquivalent(source, `(${slope})*x+(${intercept})`);
  } catch { return false; }
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

/** Read affine coefficients analytically, allowing Cartesian label products such
 * as 2x and 2(x-1). Functions require constant arguments; no sample fitting. */
export function parseAffineMathExpression2D(source: string): { x: number; y: number; constant: number } {
  if (typeof source !== "string" || !source.trim() || source.length > MAX_EXPRESSION_LENGTH) throw new Error("affine expression must be nonempty and within the expression length limit");
  // Preserve scientific literals and whole identifiers from the shared lexer.
  // Only this label reader admits adjacent atoms; executable curves stay strict.
  const tokens: Token[] = [];
  for (const token of tokenize(normalizePlainMathSource(source).trim())) {
    const previous = tokens.at(-1);
    const endsAtom = previous?.kind === "number" || previous?.kind === "rightParen" ||
      previous?.kind === "identifier" && ["x", "y", "pi", "e"].includes(previous.value);
    const startsAtom = token.kind === "number" || token.kind === "identifier" || token.kind === "leftParen";
    if (endsAtom && startsAtom) tokens.push({ kind: "operator", value: "*", position: token.position });
    tokens.push(token);
    if (tokens.length - (token.kind === "end" ? 1 : 0) > MAX_TOKENS) throw new Error(`affine expression exceeds ${MAX_TOKENS} tokens after implicit products`);
  }
  const root = new Parser(tokens, new Set<VariableName>(["x", "y"])).parse();
  type Affine = { x: number; y: number; constant: number };
  const coefficients = (x: number, y: number, constant: number): Affine => ({
    x: checked(x, "affine x coefficient"), y: checked(y, "affine y coefficient"), constant: checked(constant, "affine constant"),
  });
  const scalar = (value: Affine) => value.x === 0 && value.y === 0;
  const scale = (value: Affine, factor: number) => coefficients(value.x * factor, value.y * factor, value.constant * factor);
  let remaining = MAX_EVALUATION_STEPS;
  const read = (node: ExpressionNode): Affine => {
    chargeExpressionSteps(1);
    if (--remaining < 0) throw new Error("affine expression exceeded the operation budget");
    if (node.kind === "number") return coefficients(0, 0, node.value);
    if (node.kind === "variable") return coefficients(node.name === "x" ? 1 : 0, node.name === "y" ? 1 : 0, 0);
    if (node.kind === "unary") return scale(read(node.value), node.operator === "-" ? -1 : 1);
    if (node.kind === "function") {
      const argument = read(node.argument);
      if (!scalar(argument)) throw new Error("a function of a variable is not proved affine");
      return coefficients(0, 0, FUNCTIONS[node.name](argument.constant));
    }
    const left = read(node.left), right = read(node.right);
    if (node.operator === "+" || node.operator === "-") {
      const sign = node.operator === "-" ? -1 : 1;
      return coefficients(left.x + sign * right.x, left.y + sign * right.y, left.constant + sign * right.constant);
    }
    if (node.operator === "*") {
      if (scalar(left)) return scale(right, left.constant);
      if (scalar(right)) return scale(left, right.constant);
    } else if (node.operator === "/" && scalar(right) && right.constant !== 0) {
      return scale(left, 1 / right.constant);
    } else if (node.operator === "^" && scalar(right)) {
      if (right.constant === 0) return coefficients(0, 0, 1);
      if (right.constant === 1) return left;
      if (scalar(left)) return coefficients(0, 0, left.constant ** right.constant);
    }
    throw new Error("expression is not proved affine");
  };
  return read(root);
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
      if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_VALUE) {
        throw new Error(`numeric literal at position ${start} is outside the supported range`);
      }
      push({ kind: "number", value, position: start });
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
    if (token.kind === "number") return { kind: "number", value: token.value };
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
