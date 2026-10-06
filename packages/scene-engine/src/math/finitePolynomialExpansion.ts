import type { ExpressionNodeIR } from "../ir/problemIR";

/** JSON-safe exact authority. No floating point enters convolution. */
export interface ExactPolynomialRational { numerator: string; denominator: string }
export interface FinitePolynomialTerm { exponent: number; coefficient: ExactPolynomialRational }
export interface FinitePolynomialExpansion { variable: string; degree: number; terms: FinitePolynomialTerm[] }
export const FINITE_POLYNOMIAL_LIMITS = Object.freeze({ degree: 128, power: 64, nodes: 128, depth: 24, bits: 1024, operations: 300000, sourceLength: 512 });
type Rational = { n: bigint; d: bigint };
const zero: Rational = { n: 0n, d: 1n }, one: Rational = { n: 1n, d: 1n };
function rational(n: bigint, d = 1n): Rational {
  if (!d) throw new Error("zero polynomial denominator");
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d;
  while (b) { const next = a % b; a = b; b = next; }
  const value = { n: n / a, d: d / a };
  if (value.n.toString(2).length > FINITE_POLYNOMIAL_LIMITS.bits || value.d.toString(2).length > FINITE_POLYNOMIAL_LIMITS.bits) throw new Error("exact polynomial bit capacity exceeded");
  return value;
}
function add(a: Rational, b: Rational): Rational { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
function multiply(a: Rational, b: Rational): Rational { return rational(a.n * b.n, a.d * b.d); }
function serialized(value: Rational): ExactPolynomialRational { return { numerator: String(value.n), denominator: String(value.d) }; }
function decimal(text: string): Rational {
  if (text.length > 350) throw new Error("polynomial literal too long");
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) throw new Error("invalid exact polynomial literal");
  const exponent = Number(match[3] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 300) throw new Error("decimal exponent outside polynomial capacity");
  const [whole, part = ""] = match[2]!.split(".");
  const n = BigInt((whole || "0") + part) * (match[1] === "-" ? -1n : 1n), shift = exponent - part.length;
  return shift >= 0 ? rational(n * 10n ** BigInt(shift)) : rational(n, 10n ** BigInt(-shift));
}
function readExact(value: ExactPolynomialRational): Rational {
  if (!value || Object.keys(value).sort().join(",") !== "denominator,numerator") throw new Error("malformed exact coefficient");
  for (const text of [value.numerator, value.denominator]) if (typeof text !== "string" || text.length > 320 || !/^-?(0|[1-9]\d*)$/.test(text) || String(BigInt(text)) !== text) throw new Error("noncanonical exact coefficient");
  const result = rational(BigInt(value.numerator), BigInt(value.denominator));
  if (String(result.n) !== value.numerator || String(result.d) !== value.denominator) throw new Error("unreduced exact coefficient");
  return result;
}
export function exactPolynomialText(value: ExactPolynomialRational): string {
  const exact = readExact(value);
  return exact.d === 1n ? String(exact.n) : `${exact.n}/${exact.d}`;
}
/** Numeric adapter for existing SceneDocument/SolverResult limits; rejects underflow. */
export function exactPolynomialNumber(value: ExactPolynomialRational): number {
  const exact = readExact(value), number = Number(exact.n) / Number(exact.d);
  if (!Number.isFinite(number) || Math.abs(number) > 1e12 || exact.n !== 0n && (number === 0 || Math.abs(number) < 1e-100)) throw new Error("coefficient outside scene numeric capacity");
  return number;
}

/** Expand the actual IR AST. Every branch is visited, including zero-powered bases. */
export function expandFinitePolynomial(root: ExpressionNodeIR, variable = "x"): FinitePolynomialExpansion {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(variable)) throw new Error("invalid polynomial variable");
  let nodes = 0, operations = 0;
  const tick = () => { if (++operations > FINITE_POLYNOMIAL_LIMITS.operations) throw new Error("polynomial convolution budget exceeded"); };
  const trim = (values: Rational[]) => { while (values.length > 1 && values.at(-1)!.n === 0n) values.pop(); return values; };
  const convolve = (a: Rational[], b: Rational[]): Rational[] => {
    if (a.length + b.length - 2 > FINITE_POLYNOMIAL_LIMITS.degree) throw new Error("polynomial degree capacity exceeded");
    const result = Array.from({ length: a.length + b.length - 1 }, () => zero);
    a.forEach((left, i) => b.forEach((right, j) => { tick(); result[i + j] = add(result[i + j]!, multiply(left, right)); }));
    return trim(result);
  };
  const visit = (node: ExpressionNodeIR, depth: number): Rational[] => {
    if (!node || ++nodes > FINITE_POLYNOMIAL_LIMITS.nodes || depth > FINITE_POLYNOMIAL_LIMITS.depth) throw new Error("polynomial AST capacity exceeded");
    switch (node.kind) {
      case "number":
        if (!Number.isFinite(node.value) || Math.abs(node.value) > 1e12) throw new Error("invalid polynomial number");
        return [decimal(String(node.value))];
      case "variable":
        if (node.name !== variable) throw new Error("unbound polynomial variable");
        return [zero, one];
      case "unary": {
        if (node.operator !== "+" && node.operator !== "-") throw new Error("unknown polynomial unary operator");
        const value = visit(node.operand, depth + 1);
        return node.operator === "-" ? value.map(v => ({ n: -v.n, d: v.d })) : value;
      }
      case "binary": {
        const a = visit(node.left, depth + 1), b = visit(node.right, depth + 1);
        switch (node.operator) {
          case "+": case "-": return trim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => {
            tick(); const right = b[i] ?? zero;
            return add(a[i] ?? zero, node.operator === "-" ? { n: -right.n, d: right.d } : right);
          }));
          case "*": return convolve(a, b);
          case "/":
            if (b.length !== 1 || !b[0]!.n) throw new Error("polynomial division requires a nonzero rational constant");
            return trim(a.map(v => { tick(); return rational(v.n * b[0]!.d, v.d * b[0]!.n); }));
          case "^": {
            if (b.length !== 1 || b[0]!.d !== 1n || b[0]!.n < 0n || b[0]!.n > BigInt(FINITE_POLYNOMIAL_LIMITS.power)) throw new Error("finite expansion requires bounded nonnegative integral powers");
            const n = Number(b[0]!.n);
            if ((a.length - 1) * n > FINITE_POLYNOMIAL_LIMITS.degree) throw new Error("polynomial degree capacity exceeded");
            let result = [one];
            for (let i = 0; i < n; i++) result = convolve(result, a);
            return result;
          }
          default: throw new Error("unknown polynomial binary operator");
        }
      }
      default: throw new Error("unsupported nonrational or infinite polynomial branch");
    }
  };
  const coefficients = visit(root, 0);
  return { variable, degree: coefficients.length - 1, terms: coefficients.map((value, exponent) => ({ exponent, coefficient: serialized(value) })) };
}
export function finitePolynomialCoefficient(expansion: FinitePolynomialExpansion, exponent: number): ExactPolynomialRational {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > FINITE_POLYNOMIAL_LIMITS.degree) throw new Error("coefficient exponent out of bounds");
  const term = expansion.terms.find(term => term.exponent === exponent);
  return term ? serialized(readExact(term.coefficient)) : serialized(zero);
}

/** Exact tree identity, deliberately stronger than equal answers or equal polynomials. */
export function finitePolynomialASTKey(root: ExpressionNodeIR): string {
  // Validate all branches and resource limits before recursively generating the key.
  expandFinitePolynomial(root);
  const visit = (node: ExpressionNodeIR): unknown => {
    switch (node.kind) {
      case "number": return ["number", serialized(decimal(String(node.value)))];
      case "variable": return ["variable", node.name];
      case "unary": return ["unary", node.operator, visit(node.operand)];
      case "binary": return ["binary", node.operator, visit(node.left), visit(node.right)];
      default: throw new Error("unsupported polynomial AST");
    }
  };
  return JSON.stringify(visit(root));
}

/** Complete arithmetic parser into the original ProblemIR AST, never eval. */
export function parseFinitePolynomialExpression(source: string): ExpressionNodeIR {
  if (!source.trim() || source.length > FINITE_POLYNOMIAL_LIMITS.sourceLength) throw new Error("polynomial source length out of bounds");
  const normalized = source.replace(/[−–]/g, "-").replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, text => "^" + [...text].map(c => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c)).join(""));
  const tokens: string[] = [];
  let position = 0;
  while (position < normalized.length) {
    const rest = normalized.slice(position), space = /^\s+/.exec(rest);
    if (space) { position += space[0].length; continue; }
    const token = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z][A-Za-z0-9_]*|^[()+\-*/^]/.exec(rest)?.[0];
    if (!token || tokens.length >= 128) throw new Error("unsupported polynomial token");
    tokens.push(token); position += token.length;
  }
  let at = 0, depth = 0;
  const binary = (operator: "+" | "-" | "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
  const primary = (): ExpressionNodeIR => {
    if (++depth > 32) throw new Error("polynomial parser depth exceeded");
    const token = tokens[at++]; let result: ExpressionNodeIR;
    if (token === "(") { result = sum(); if (tokens[at++] !== ")") throw new Error("unclosed polynomial group"); }
    else if (token && /^(?:\d|\.)/.test(token)) {
      const number = Number(token), exact = decimal(token), represented = decimal(String(number));
      if (!Number.isFinite(number) || exact.n !== represented.n || exact.d !== represented.d) throw new Error("polynomial literal loses exact source identity");
      result = { kind: "number", value: number };
    } else if (token === "x") result = { kind: "variable", name: "x" };
    else throw new Error("unsupported polynomial primary");
    depth--; return result;
  };
  const power = (): ExpressionNodeIR => { const left = primary(); return tokens[at] === "^" ? (at++, binary("^", left, unary())) : left; };
  const unary = (): ExpressionNodeIR => {
    if (tokens[at] === "+" || tokens[at] === "-") {
      if (++depth > 32) throw new Error("polynomial parser depth exceeded");
      const operator = tokens[at++] as "+" | "-", operand = unary(); depth--;
      return { kind: "unary", operator, operand };
    }
    return power();
  };
  const product = (): ExpressionNodeIR => {
    let value = unary();
    while (tokens[at] === "*" || tokens[at] === "/" || tokens[at] === "(" || tokens[at] === "x") {
      const explicit = tokens[at] === "*" || tokens[at] === "/";
      const operator = explicit ? tokens[at++] as "*" | "/" : "*";
      value = binary(operator, value, unary());
    }
    return value;
  };
  const sum = (): ExpressionNodeIR => {
    let value = product();
    while (tokens[at] === "+" || tokens[at] === "-") { const operator = tokens[at++] as "+" | "-"; value = binary(operator, value, product()); }
    return value;
  };
  const root = sum();
  if (at !== tokens.length) throw new Error("unconsumed polynomial source");
  expandFinitePolynomial(root);
  return root;
}
