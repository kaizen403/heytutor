import type { ExpressionNodeIR } from "../ir/problemIR";
/** Formal rational functions over source roles. Cross products prove algebraic
 * equality; numeric agreement alone is never evidence for an IR formulation. */
type Polynomial = Map<string, number>;
export interface MotionFormula {
  numerator: Polynomial;
  denominator: Polynomial;
}
const polynomial = (name: string, value = 1): Polynomial => new Map([[name, value]]);
export const motionConstant = (value: number): MotionFormula => ({ numerator: polynomial("", value), denominator: polynomial("", 1) });
export const motionVariable = (name: string): MotionFormula => ({ numerator: polynomial(name), denominator: polynomial("", 1) });
function sum(a: Polynomial, b: Polynomial, sign = 1): Polynomial {
  const out = new Map(a);
  for (const [key, value] of b) {
    const coefficient = (out.get(key) ?? 0) + sign * value;
    if (!Number.isSafeInteger(coefficient))
      throw Error("motion coefficient exceeds exact integer budget");
    out.set(key, coefficient);
  }
  for (const [key, value] of out)
    if (value === 0)
      out.delete(key);
  return out;
}
function product(a: Polynomial, b: Polynomial): Polynomial {
  const out: Polynomial = new Map();
  for (const [ak, av] of a)
    for (const [bk, bv] of b) {
      const key = [ak, bk].filter(Boolean).join("*").split("*").sort().join("*");
      const coefficient = (out.get(key) ?? 0) + av * bv;
      if (!Number.isSafeInteger(coefficient))
        throw Error("motion coefficient exceeds exact integer budget");
      out.set(key, coefficient);
      if (out.size > 128)
        throw Error("motion formulation exceeds polynomial budget");
    }
  for (const [key,value] of out) if(value===0) out.delete(key);
  return out;
}
export function motionOperation(op: string, a: MotionFormula, b: MotionFormula): MotionFormula {
  if (op === "+" || op === "-")
    return { numerator: sum(product(a.numerator, b.denominator), product(b.numerator, a.denominator), op === "+" ? 1 : -1), denominator: product(a.denominator, b.denominator) };
  if (op === "*")
    return { numerator: product(a.numerator, b.numerator), denominator: product(a.denominator, b.denominator) };
  if (op === "/" && b.numerator.size)
    return { numerator: product(a.numerator, b.denominator), denominator: product(a.denominator, b.numerator) };
  throw Error("unsupported motion formulation operator");
}
export function sameMotionFormula(a: MotionFormula, b: MotionFormula): boolean {
  return sum(product(a.numerator, b.denominator), product(b.numerator, a.denominator), -1).size === 0;
}
/** Small arithmetic parser shared by prose and IR. No eval or free functions. */
export function readMotionArithmetic(text: string): ExpressionNodeIR {
  const tokens = text.match(/[A-Za-z][A-Za-z0-9_]*|(?:\d+(?:\.\d+)?|\.\d+)|[()+*/-]/g) ?? [];
  if (tokens.join("") !== text.replace(/\s/g, ""))
    throw Error("unsupported motion arithmetic text");
  if (tokens.length > 128)
    throw Error("motion prose exceeds arithmetic budget");
  let index = 0;
  const primary = (): ExpressionNodeIR => {
    const token = tokens[index++];
    if (token === "+" || token === "-")
      return { kind: "unary", operator: token, operand: primary() };
    if (token === "(") {
      const result = expression();
      if (tokens[index++] !== ")")
        throw Error("unclosed arithmetic");
      return result;
    }
    if (token && /^\d|^\./.test(token))
      return { kind: "number", value: Number(token) };
    if (token && /^[A-Za-z]/.test(token))
      return { kind: "variable", name: token };
    throw Error("missing arithmetic operand");
  };
  const term = (): ExpressionNodeIR => {
    let left = primary();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index++] as "*" | "/";
      left = { kind: "binary", operator, left, right: primary() };
    }
    return left;
  };
  const expression = (): ExpressionNodeIR => {
    let left = term();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++] as "+" | "-";
      left = { kind: "binary", operator, left, right: term() };
    }
    return left;
  };
  const result = expression();
  if (index !== tokens.length)
    throw Error("arithmetic residue");
  return result;
}
export function evaluateMotionArithmetic(node: ExpressionNodeIR, variables: ReadonlyMap<string, number>): number {
  switch (node.kind) {
    case "number": return node.value;
    case "variable": {
      const value = variables.get(node.name);
      if (value === undefined)
        throw Error("unbound motion variable");
      return value;
    }
    case "unary": return (node.operator === "-" ? -1 : 1) * evaluateMotionArithmetic(node.operand, variables);
    case "binary": {
      const a = evaluateMotionArithmetic(node.left, variables), b = evaluateMotionArithmetic(node.right, variables);
      const value = node.operator === "+" ? a + b : node.operator === "-" ? a - b : node.operator === "*" ? a * b : node.operator === "/" ? a / b : NaN;
      if (!Number.isFinite(value))
        throw Error("undefined motion arithmetic");
      return value;
    }
    default: throw Error("unsupported motion arithmetic node");
  }
}
