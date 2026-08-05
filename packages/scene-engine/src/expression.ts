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
  const normalized = source.trim();
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
  const normalized = source.trim();
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
