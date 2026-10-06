import { motionSymbolKey } from "./motionPlanAgreement";
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

/** L, T and angle exponents travel with the exact role polynomial. */
export type MotionDimensions = readonly [number, number, number];
export interface DimensionalMotionFormula {
  formula: MotionFormula;
  dimensions: MotionDimensions;
}
export interface MotionAlgebraRole {
  formula: MotionFormula;
  dimension: "length" | "time" | "velocity" | "angle";
  si: number;
  bases: string[];
  sourceText?: string;
}
export function motionDimensions(
  dimension: MotionAlgebraRole["dimension"],
): MotionDimensions {
  return dimension === "length"
    ? [1, 0, 0]
    : dimension === "time"
      ? [0, 1, 0]
      : dimension === "velocity"
        ? [1, -1, 0]
        : [0, 0, 1];
}
export const sameMotionDimensions = (
  a: MotionDimensions,
  b: MotionDimensions,
): boolean => a.every((value, index) => value === b[index]);
export function sameDimensionalMotionFormula(
  a: DimensionalMotionFormula,
  b: DimensionalMotionFormula,
): boolean {
  return (
    sameMotionDimensions(a.dimensions, b.dimensions) &&
    sameMotionFormula(a.formula, b.formula)
  );
}
export function motionRoleFormula(
  role: MotionAlgebraRole,
): DimensionalMotionFormula {
  return {
    formula: role.formula,
    dimensions: motionDimensions(role.dimension),
  };
}
/** Traverse the complete original tree before conversion recognition or
 * candidate enumeration. An empty left candidate set must not hide a right
 * child or a conversion coefficient's own fields. Caller data is snapshotted. */
export function validateMotionArithmeticShape(root: ExpressionNodeIR): void {
  let count = 0;
  const visit = (node: ExpressionNodeIR, depth: number): void => {
    if (++count > 128 || depth > 24)
      throw Error("motion AST exceeds node/depth budget");
    const fields =
      node.kind === "number"
        ? ["kind", "value"]
        : node.kind === "variable"
          ? ["kind", "name"]
          : node.kind === "unary"
            ? ["kind", "operator", "operand"]
            : node.kind === "binary"
              ? ["kind", "operator", "left", "right"]
              : [];
    if (
      !fields.length ||
      Object.keys(node).some((key) => !fields.includes(key))
    )
      throw Error("unsupported original AST fields");
    if (node.kind === "number" && !Number.isFinite(node.value))
      throw Error("nonfinite motion literal");
    if (node.kind === "variable" && typeof node.name !== "string")
      throw Error("unsupported motion variable");
    if (node.kind === "unary") {
      if (!["+", "-"].includes(node.operator))
        throw Error("unsupported unary motion operator");
      visit(node.operand, depth + 1);
    }
    if (node.kind === "binary") {
      if (!["+", "-", "*", "/"].includes(node.operator))
        throw Error("unsupported binary motion operator");
      visit(node.left, depth + 1);
      visit(node.right, depth + 1);
    }
  };
  visit(root, 0);
}
/** Named operands have exactly one source role. Numeric substitution clauses
 * may have several source roles; every admissible interpretation retains its
 * dimensions. IR supplies primitive literals only; prose may also substitute
 * already-proved derived roles. No arbitrary constants or numeric folding. */
export function motionFormulations(
  node: ExpressionNodeIR,
  roles: ReadonlyMap<string, MotionAlgebraRole>,
  literals: readonly MotionAlgebraRole[],
  evidence?: ReadonlySet<string>,
): DimensionalMotionFormula[] {
  const near = (a: number, b: number) =>
    Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const admitted = (role: MotionAlgebraRole) =>
    !evidence || role.bases.every((base) => evidence.has(base));
  const candidates: DimensionalMotionFormula[] = [];
  const add = (value: DimensionalMotionFormula) => {
    if (candidates.some((other) => sameDimensionalMotionFormula(value, other)))
      return;
    candidates.push(value);
    if (candidates.length > 64)
      throw Error("ambiguous motion formulation exceeds budget");
  };
  if (node.kind === "variable") {
    const role = roles.get(motionSymbolKey(node.name));
    return role && admitted(role) ? [motionRoleFormula(role)] : [];
  }
  if (node.kind === "number") {
    for (const role of literals) {
      if (!admitted(role)) continue;
      if (near(node.value, role.si)) add(motionRoleFormula(role));
      else if (
        role.dimension === "velocity" &&
        role.si < 0 &&
        near(node.value, -role.si)
      )
        add({
          formula: motionOperation("*", motionConstant(-1), role.formula),
          dimensions: motionDimensions(role.dimension),
        });
    }
    return candidates;
  }
  if (
    node.kind === "binary" &&
    node.operator === "/" &&
    node.left.kind === "binary" &&
    node.left.operator === "*" &&
    node.left.left.kind === "number" &&
    node.left.right.kind === "number" &&
    node.left.right.value === 1000 &&
    node.right.kind === "number" &&
    node.right.value === 3600
  ) {
    for (const role of literals)
      if (
        admitted(role) &&
        role.dimension === "velocity" &&
        /km\/h|kmph/i.test(role.sourceText ?? "") &&
        near((node.left.left.value * 1000) / 3600, Math.abs(role.si))
      )
        add({
          formula:
            role.si < 0
              ? motionOperation("*", motionConstant(-1), role.formula)
              : role.formula,
          dimensions: motionDimensions("velocity"),
        });
  }
  if (node.kind === "unary")
    return motionFormulations(node.operand, roles, literals, evidence).map(
      (value) => ({
        ...value,
        formula:
          node.operator === "-"
            ? motionOperation("*", motionConstant(-1), value.formula)
            : value.formula,
      }),
    );
  if (node.kind === "binary") {
    // Enumerate both children independently, after the separate shape pass.
    const left = motionFormulations(node.left, roles, literals, evidence),
      right = motionFormulations(node.right, roles, literals, evidence);
    for (const a of left)
      for (const b of right) {
        if (
          (node.operator === "+" || node.operator === "-") &&
          !sameMotionDimensions(a.dimensions, b.dimensions)
        )
          continue;
        if (node.operator === "/" && !b.formula.numerator.size) continue;
        const dimensions: MotionDimensions =
          node.operator === "+" || node.operator === "-"
            ? a.dimensions
            : [
                a.dimensions[0] +
                  (node.operator === "/" ? -1 : 1) * b.dimensions[0],
                a.dimensions[1] +
                  (node.operator === "/" ? -1 : 1) * b.dimensions[1],
                a.dimensions[2] +
                  (node.operator === "/" ? -1 : 1) * b.dimensions[2],
              ];
        add({
          formula: motionOperation(node.operator, a.formula, b.formula),
          dimensions,
        });
      }
  }
  return candidates;
}
