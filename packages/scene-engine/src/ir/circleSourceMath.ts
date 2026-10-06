/** Bounded exact polynomial algebra. Never infer polynomial identity by sampling. */
import { parseMathExpression2D } from "../math/expression";
import type { ExpressionNodeIR } from "./problemIR";

export type CircleRational = { n: bigint; d: bigint };
export type CirclePolynomial = Map<string, CircleRational>;
export const exact = (n: bigint, d = 1n): CircleRational => {
  if (!d) throw new Error("zero denominator");
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d;
  while (b) [a, b] = [b, a % b];
  const gcd = a || 1n;
  const result = { n: n / gcd, d: d / gcd };
  if (String(result.n).length > 80 || String(result.d).length > 80) throw new Error("rational budget");
  return result;
};
export const plus = (a: CircleRational, b: CircleRational): CircleRational => exact(a.n * b.d + b.n * a.d, a.d * b.d);
export const times = (a: CircleRational, b: CircleRational): CircleRational => exact(a.n * b.n, a.d * b.d);
export const divide = (a: CircleRational, b: CircleRational): CircleRational => exact(a.n * b.d, a.d * b.n);
export const negate = (a: CircleRational): CircleRational => exact(-a.n, a.d);
export const sameExact = (a: CircleRational, b: CircleRational): boolean => a.n === b.n && a.d === b.d;
export const exactText = (a: CircleRational): string => a.d === 1n ? String(a.n) : `${a.n}/${a.d}`;
export const numeric = (a: CircleRational): number => {
  const value = Number(a.n) / Number(a.d);
  if (!Number.isFinite(value) || Math.abs(value) > 1e9 || (a.n !== 0n && Math.abs(value) < 1e-12)) throw new Error("unsupported precision");
  return value;
};
export function decimalExact(text: string): CircleRational {
  // JS AST numbers stringify small decimals with an exponent; source text
  // still uses the closed literal grammar (its tokenizer never admits e).
  const exponent = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))[eE]([+-]?\d+)$/.exec(text);
  if (exponent) {
    const power = Number(exponent[2]);
    if (!Number.isInteger(power) || Math.abs(power) > 12) throw new Error("literal exponent budget");
    const mantissa = decimalExact(exponent[1]!);
    const value = power < 0 ? divide(mantissa, exact(10n ** BigInt(-power))) : times(mantissa, exact(10n ** BigInt(power)));
    numeric(value);
    return value;
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error("unsupported literal");
  const [whole, fraction = ""] = text.replace(/^\+/, "").split(".");
  if (fraction.length > 12 || text.length > 24) throw new Error("literal precision");
  const value = exact(BigInt(`${whole === "" ? "0" : whole === "-" ? "-0" : whole}${fraction}`), 10n ** BigInt(fraction.length));
  numeric(value);
  return value;
}
const constant = (value: CircleRational): CirclePolynomial => new Map(value.n ? [["0,0", value]] : []);
export const coefficient = (p: CirclePolynomial, x: number, y: number): CircleRational => p.get(`${x},${y}`) ?? exact(0n);
export function addPolynomial(a: CirclePolynomial, b: CirclePolynomial, sign = 1): CirclePolynomial {
  const out = new Map(a);
  for (const [key, value] of b) {
    const next = plus(out.get(key) ?? exact(0n), sign === 1 ? value : negate(value));
    if (next.n) out.set(key, next); else out.delete(key);
  }
  return out;
}
function multiplyPolynomial(a: CirclePolynomial, b: CirclePolynomial): CirclePolynomial {
  let out: CirclePolynomial = new Map();
  for (const [ak, av] of a) for (const [bk, bv] of b) {
    const [ax, ay] = ak.split(",").map(Number), [bx, by] = bk.split(",").map(Number);
    const x = ax! + bx!, y = ay! + by!;
    if (x + y > 2) throw new Error("degree exceeds two");
    out = addPolynomial(out, new Map([[`${x},${y}`, times(av, bv)]]));
  }
  return out;
}
function binary(op: string, a: CirclePolynomial, b: CirclePolynomial): CirclePolynomial {
  if (op === "+" || op === "-") return addPolynomial(a, b, op === "+" ? 1 : -1);
  if (op === "*") return multiplyPolynomial(a, b);
  if (b.size > 1 || [...b.keys()].some(key => key !== "0,0")) throw new Error("nonconstant divisor/exponent");
  const v = coefficient(b, 0, 0);
  if (op === "/") {
    // Zero polynomials have no coefficients to iterate. Their divisor still
    // has to define a value before any cancellation can certify identity.
    if (!v.n) throw new Error("zero polynomial divisor");
    return new Map([...a].map(([key, value]) => [key, divide(value, v)]));
  }
  if (op !== "^" || v.d !== 1n || v.n < 0n || v.n > 2n) throw new Error("unsupported power");
  return v.n === 0n ? constant(exact(1n)) : v.n === 1n ? a : multiplyPolynomial(a, a);
}
/** AST roles remain structural even when coefficients have equal numeric values. */
export function polynomialOfIR(root: ExpressionNodeIR): CirclePolynomial {
  let count = 0;
  const visit = (node: ExpressionNodeIR, depth: number): CirclePolynomial => {
    if (++count > 128 || depth > 24) throw new Error("AST budget");
    if (node.kind === "number") return constant(decimalExact(String(node.value)));
    if (node.kind === "variable" && (node.name === "x" || node.name === "y")) return new Map([[node.name === "x" ? "1,0" : "0,1", exact(1n)]]);
    if (node.kind === "unary") return new Map([...visit(node.operand, depth + 1)].map(([key, value]) => [key, node.operator === "-" ? negate(value) : value]));
    if (node.kind === "binary") return binary(node.operator, visit(node.left, depth + 1), visit(node.right, depth + 1));
    throw new Error("unsupported polynomial node");
  };
  return visit(root, 0);
}
/** Reuse the engine's expression language for syntax, then reduce exact source literals. */
export function polynomialOfSource(raw: string): CirclePolynomial {
  let source = raw.replace(/[−–—]/g, "-").replace(/²/g, "^2").replace(/\s+/g, "");
  source = source.replace(/(\d)([xy(])/g, "$1*$2").replace(/([xy)])([xy(])/g, "$1*$2");
  parseMathExpression2D(source);
  const tokens = source.match(/\d+(?:\.\d*)?|\.\d+|[xy()+*/^-]/g) ?? [];
  if (tokens.join("") !== source || tokens.length > 128) throw new Error("source token budget");
  let position = 0;
  const take = (): string => tokens[position++] ?? "";
  const peek = (): string => tokens[position] ?? "";
  const parse = (minimum: number, depth: number): CirclePolynomial => {
    if (depth > 24) throw new Error("source depth");
    const token = take();
    let left: CirclePolynomial;
    if (token === "+" || token === "-") {
      const operand = parse(3, depth + 1);
      left = token === "+" ? operand : new Map([...operand].map(([k, v]) => [k, negate(v)]));
    } else if (token === "(") {
      left = parse(0, depth + 1);
      if (take() !== ")") throw new Error("unclosed expression");
    } else if (token === "x" || token === "y") left = new Map([[token === "x" ? "1,0" : "0,1", exact(1n)]]);
    else {
      const value = decimalExact(token);
      if (!sameExact(value, decimalExact(String(numeric(value))))) throw new Error("source literal loses written precision");
      left = constant(value);
    }
    const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
    while ((precedence[peek()] ?? -1) >= minimum) {
      const op = take(), level = precedence[op]!;
      left = binary(op, left, parse(op === "^" ? level : level + 1, depth + 1));
    }
    return left;
  };
  const result = parse(0, 0);
  if (position !== tokens.length) throw new Error("unconsumed expression");
  return result;
}
export function equivalentPolynomial(a: CirclePolynomial, b: CirclePolynomial, scaling = false): boolean {
  if (a.size !== b.size) return false;
  const first = [...b][0];
  const scale = scaling && first ? divide(a.get(first[0]) ?? exact(0n), first[1]) : exact(1n);
  return scale.n !== 0n && [...b].every(([key, value]) => sameExact(a.get(key) ?? exact(0n), times(value, scale)));
}
