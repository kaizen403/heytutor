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
  | { kind: "number"; value: number; literal?: string; constant?: "pi" | "e" }
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

/** Source-only exact decimal/identity reading; ordinary geometry evaluation is unchanged. */
export function evaluateSourceMathExpression(source: string, x: number): number {
  // Native evaluation first retains every existing grammar, range and work limit.
  const native = evaluateMathExpression(source, x);
  const root = new Parser(tokenize(normalizePlainMathSource(source).trim()), new Set(["x"])).parse();
  const budget = { remaining: MAX_EVALUATION_STEPS };
  const exact = exactFraction(root, x, budget);
  if (exact) {
    if (exact.n === 0n) return 0;
    const numerator = Number(exact.n); const denominator = Number(exact.d);
    if (Number.isFinite(numerator) && Number.isFinite(denominator)) {
      return checked(numerator / denominator, "exact source result");
    }
  }
  const piMultiple = exactPiMultiple(root, x, budget);
  return piMultiple?.n === 0n ? 0 : native;
}

type Fraction = { n: bigint; d: bigint };
const MAX_EXACT_BITS = 4096;

function fraction(n: bigint, d = 1n): Fraction | null {
  if (d === 0n) return null;
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n; let b = d;
  while (b !== 0n) { const remainder = a % b; a = b; b = remainder; }
  if (a !== 0n) { n /= a; d /= a; }
  return n.toString(2).length <= MAX_EXACT_BITS && d.toString(2).length <= MAX_EXACT_BITS ? { n, d } : null;
}

function decimalFraction(literal: string): Fraction | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(literal);
  if (!match || !(match[2] || match[3])) return null;
  const decimal = match[3] ?? "";
  const exponent = Number(match[4] ?? 0) - decimal.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) return null;
  const coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${match[2] || "0"}${decimal}`);
  return exponent >= 0 ? fraction(coefficient * 10n ** BigInt(exponent)) : fraction(coefficient, 10n ** BigInt(-exponent));
}

function exactStep(budget: { remaining: number }): boolean { return --budget.remaining >= 0; }
function sameExpression(a: ExpressionNode, b: ExpressionNode): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function combineFractions(a: Fraction, b: Fraction, operator: BinaryOperator): Fraction | null {
  switch (operator) {
    case "+": return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
    case "-": return fraction(a.n * b.d - b.n * a.d, a.d * b.d);
    case "*": return fraction(a.n * b.n, a.d * b.d);
    case "/": return fraction(a.n * b.d, a.d * b.n);
    case "^": {
      if (b.d !== 1n || b.n < -32n || b.n > 32n) return null;
      const power = b.n < 0n ? -b.n : b.n;
      return b.n < 0n ? fraction(a.d ** power, a.n ** power) : fraction(a.n ** power, a.d ** power);
    }
  }
}

function exactFraction(node: ExpressionNode, x: number, budget: { remaining: number }): Fraction | null {
  if (!exactStep(budget)) return null;
  if (node.kind === "number") return node.constant ? null : decimalFraction(node.literal ?? String(node.value));
  if (node.kind === "variable") return decimalFraction(String(x));
  if (node.kind === "unary") {
    const value = exactFraction(node.value, x, budget);
    return value ? fraction(node.operator === "-" ? -value.n : value.n, value.d) : null;
  }
  if (node.kind === "binary") {
    if (node.operator === "-" && sameExpression(node.left, node.right)) return fraction(0n);
    // Native rounding can hide a negative radicand; prove the exact domain too.
    if (node.left.kind === "function" && node.left.name === "sqrt") {
      if (node.operator === "*" && sameExpression(node.left, node.right)) {
        const argument = exactFraction(node.left.argument, x, budget);
        return argument && argument.n >= 0n ? argument : null;
      }
      if (node.operator === "^") {
        const exponent = exactFraction(node.right, x, budget);
        if (exponent?.n === 2n && exponent.d === 1n) {
          const argument = exactFraction(node.left.argument, x, budget);
          return argument && argument.n >= 0n ? argument : null;
        }
      }
    }
    const left = exactFraction(node.left, x, budget); const right = exactFraction(node.right, x, budget);
    return left && right ? combineFractions(left, right, node.operator) : null;
  }
  if (node.name === "sin" || node.name === "cos" || node.name === "tan") {
    const multiple = exactPiMultiple(node.argument, x, budget);
    if (!multiple) return null;
    if (multiple.d === 1n) {
      return node.name === "cos" ? fraction(multiple.n % 2n === 0n ? 1n : -1n) : fraction(0n);
    }
    if (node.name !== "tan" && (2n * multiple.n) % multiple.d === 0n) {
      const quarter = (2n * multiple.n / multiple.d % 4n + 4n) % 4n;
      return node.name === "cos" ? fraction(0n) : fraction(quarter === 1n ? 1n : -1n);
    }
    return null;
  }
  const argument = exactFraction(node.argument, x, budget);
  if (!argument) return null;
  if (node.name === "abs") return fraction(argument.n < 0n ? -argument.n : argument.n, argument.d);
  if (argument.n === 0n && (node.name === "sqrt" || node.name === "asin" || node.name === "atan")) return fraction(0n);
  if (argument.n === 0n && node.name === "exp") return fraction(1n);
  if (argument.n === argument.d && (node.name === "log" || node.name === "ln" || node.name === "acos")) return fraction(0n);
  return null;
}

/** Prove only rational multiples of the symbolic pi constant, not nearby decimals. */
function exactPiMultiple(node: ExpressionNode, x: number, budget: { remaining: number }): Fraction | null {
  if (!exactStep(budget)) return null;
  if (node.kind === "number") {
    if (node.constant === "pi") return fraction(1n);
    const value = node.constant ? null : decimalFraction(node.literal ?? String(node.value));
    return value?.n === 0n ? value : null;
  }
  if (node.kind === "variable") return x === 0 ? fraction(0n) : null;
  if (node.kind === "unary") {
    const value = exactPiMultiple(node.value, x, budget);
    return value ? fraction(node.operator === "-" ? -value.n : value.n, value.d) : null;
  }
  if (node.kind !== "binary") return null;
  if (node.operator === "+" || node.operator === "-") {
    const left = exactPiMultiple(node.left, x, budget); const right = exactPiMultiple(node.right, x, budget);
    return left && right ? combineFractions(left, right, node.operator) : null;
  }
  if (node.operator === "*" || node.operator === "/") {
    const left = exactPiMultiple(node.left, x, budget); const right = exactFraction(node.right, x, budget);
    if (left && right) return combineFractions(left, right, node.operator);
    if (node.operator === "*") {
      const other = exactPiMultiple(node.right, x, budget); const coefficient = exactFraction(node.left, x, budget);
      return other && coefficient ? combineFractions(other, coefficient, "*") : null;
    }
  }
  return null;
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
      if (token.value === "pi") return { kind: "number", value: Math.PI, constant: "pi" };
      if (token.value === "e") return { kind: "number", value: Math.E, constant: "e" };
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
