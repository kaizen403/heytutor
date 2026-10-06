import type { ExpressionNodeIR } from "./problemIR";

/** Bounded proof of the planar projection laws. Roles remain indeterminates;
 * source numbers enter only closed display steps and matched source subtrees.
 * This is deliberately not a general symbolic algebra service. */
export type PlanarProofRole = "residual" | "norm" | "distance" | "x" | "y" | "foot" | "displacement" | "incidence";
type Node = ExpressionNodeIR;
type Rational = { n: bigint; d: bigint };
type Polynomial = Map<string, Rational>;
type Form = { numerator: Polynomial; denominator: Polynomial; dimension: number | null };
const LIMIT = { terms: 128, degree: 12, bits: 512, operations: 50000 };
const number = (value: number): Node => ({ kind: "number", value });
const variable = (name: string): Node => ({ kind: "variable", name });
const binary = (operator: "+" | "-" | "*" | "/" | "^", left: Node, right: Node): Node => ({ kind: "binary", operator, left, right });
const call = (fn: "abs" | "sqrt", argument: Node): Node => ({ kind: "call", function: fn, argument });
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 64 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
function rational(n: bigint, d = 1n): Rational {
  if (!d) throw new Error("zero denominator");
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d;
  while (b) { const next = a % b; a = b; b = next; }
  n /= a; d /= a;
  if (n.toString(2).length > LIMIT.bits || d.toString(2).length > LIMIT.bits) throw new Error("coefficient budget");
  return { n, d };
}
function decimal(text: string): Rational {
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || text.length > 100) throw new Error("decimal budget");
  const [whole, fraction = ""] = match[2]!.split(".");
  const power = Number(match[3] ?? 0) - fraction.length;
  if (!Number.isInteger(power) || Math.abs(power) > 100) throw new Error("decimal exponent budget");
  const n = BigInt((whole || "0") + fraction) * (match[1] === "-" ? -1n : 1n);
  return power >= 0 ? rational(n * 10n ** BigInt(power)) : rational(n, 10n ** BigInt(-power));
}
const add = (a: Rational, b: Rational) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const multiply = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d);
const constant = (value: Rational): Polynomial => value.n ? new Map([["", value]]) : new Map();
const one = () => constant(rational(1n));

/** Pure interface: prove an original equation chain for an audited geometric
 * role. Unsupported syntax, domains, dimensions or resource use return false. */
export function createPlanarArithmeticProof(source: {
  pointName: string; footName: string; point: { x: number; y: number }; line: { a: number; b: number; c: number };
  resultSymbols?: ReadonlyArray<{ symbol: string; role: "distance" | "x" | "y" }>;
}): { proves(text: string, role: PlanarProofRole): boolean } {
  const A = variable("A"), B = variable("B"), C = variable("C"), X = variable("X"), Y = variable("Y");
  const S = binary("+", binary("+", binary("*", A, X), binary("*", B, Y)), C);
  const N = binary("+", binary("^", A, number(2)), binary("^", B, number(2)));
  const fx = binary("-", X, binary("/", binary("*", A, S), N));
  const fy = binary("-", Y, binary("/", binary("*", B, S), N));
  const distance = binary("/", call("abs", S), call("sqrt", N));
  const aliases = new Map<string, Node>([
    ["a", A], ["b", B], ["c", C], ["s", S], ["n2", N],
    [`x_${source.pointName}`, X], [`y_${source.pointName}`, Y],
    [`x_${source.footName}`, fx], [`y_${source.footName}`, fy], ["d", distance], ["distance", distance],
  ]);
  // The caller supplies only result symbols already bound by the complete
  // typed IR audit. They resolve to laws, never to equal-valued numbers.
  for (const output of source.resultSymbols ?? []) aliases.set(output.symbol, output.role === "distance" ? distance : output.role === "x" ? fx : fy);
  const values = new Map([["A", source.line.a], ["B", source.line.b], ["C", source.line.c], ["X", source.point.x], ["Y", source.point.y]]);
  const dimensions = new Map([["A", 0], ["B", 0], ["C", 1], ["X", 1], ["Y", 1]]);
  let operations = 0;
  const tick = () => { if (++operations > LIMIT.operations) throw new Error("proof operation budget"); };
  const combine = (a: Polynomial, b: Polynomial, sign = 1): Polynomial => {
    const result = new Map(a);
    for (const [key, value] of b) {
      tick(); const sum = add(result.get(key) ?? rational(0n), { n: value.n * BigInt(sign), d: value.d });
      if (sum.n) result.set(key, sum); else result.delete(key);
    }
    if (result.size > LIMIT.terms) throw new Error("proof term budget");
    return result;
  };
  const product = (a: Polynomial, b: Polynomial): Polynomial => {
    const result: Polynomial = new Map();
    for (const [ka, va] of a) for (const [kb, vb] of b) {
      tick(); const key = [...ka, ...kb].sort().join("");
      if (key.length > LIMIT.degree) throw new Error("proof degree budget");
      const value = add(result.get(key) ?? rational(0n), multiply(va, vb));
      if (value.n) result.set(key, value); else result.delete(key);
      if (result.size > LIMIT.terms) throw new Error("proof term budget");
    }
    return result;
  };
  const evaluate = (node: Node): number => {
    tick();
    switch (node.kind) {
      case "number": return node.value;
      case "variable": { const value = values.get(node.name); if (value === undefined) throw new Error("unknown role"); return value; }
      case "unary": return (node.operator === "-" ? -1 : 1) * evaluate(node.operand);
      case "call": { const value = evaluate(node.argument); return node.function === "abs" ? Math.abs(value) : node.function === "sqrt" ? Math.sqrt(value) : NaN; }
      case "binary": {
        const a = evaluate(node.left), b = evaluate(node.right);
        switch (node.operator) { case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return a / b; case "^": return a ** b; }
      }
    }
    throw new Error("unsupported arithmetic");
  };
  const hasRole = (node: Node): boolean => {
    tick();
    return node.kind === "variable" || (node.kind === "binary" ? hasRole(node.left) || hasRole(node.right) : node.kind === "unary" ? hasRole(node.operand) : node.kind === "call" ? hasRole(node.argument) : false);
  };
  const compatible = (a: number | null, b: number | null) => a === null || b === null || a === b;
  const same = (a: Form, b: Form) => compatible(a.dimension, b.dimension) && combine(product(a.numerator, b.denominator), product(b.numerator, a.denominator), -1).size === 0;
  const exactValues = (() => {
    try {
      const result = new Map([...values].map(([name, value]) => [name, decimal(String(value))]));
      const residual = add(add(multiply(result.get("A")!, result.get("X")!), multiply(result.get("B")!, result.get("Y")!)), result.get("C")!);
      result.set("U", { n: residual.n < 0n ? -residual.n : residual.n, d: residual.d });
      return result;
    } catch { return null; }
  })();
  if (!exactValues) return { proves: () => false };
  const nonzeroAtSource = (polynomial: Polynomial): boolean => {
    const radical = [...polynomial.keys()].some(key => key.includes("V"));
    if (radical && polynomial.size !== 1) throw new Error("unsupported radical divisor domain");
    let sum = rational(0n);
    for (const [key, coefficient] of polynomial) {
      let value = coefficient;
      for (const role of key) {
        tick();
        // sqrt(N)>0 is already established from the nonzero source normal.
        if (role !== "V") value = multiply(value, exactValues.get(role)!);
      }
      sum = add(sum, value);
    }
    return sum.n !== 0n;
  };
  const memo = new Map<Node, Form>();
  const form = (node: Node): Form => {
    tick(); const saved = memo.get(node); if (saved) return saved;
    let result: Form;
    switch (node.kind) {
      case "number": result = { numerator: constant(decimal(String(node.value))), denominator: one(), dimension: null }; break;
      case "variable":
        if (!dimensions.has(node.name)) throw new Error("unknown role");
        result = { numerator: new Map([[node.name, rational(1n)]]), denominator: one(), dimension: dimensions.get(node.name)! }; break;
      case "unary": {
        const operand = form(node.operand);
        result = node.operator === "-" ? { ...operand, numerator: product(constant(rational(-1n)), operand.numerator) } : operand; break;
      }
      case "call": {
        if (!hasRole(node.argument)) {
          form(node.argument);
          const value = evaluate(node); if (!Number.isFinite(value)) throw new Error("closed function domain");
          result = { numerator: constant(decimal(String(value))), denominator: one(), dimension: null }; break;
        }
        // abs only the proved signed source residual; sqrt only the proved
        // positive normal norm. No arbitrary function becomes an opaque atom.
        const residual = node.function === "abs" && (matches(node.argument, S) || matches(node.argument, { kind: "unary", operator: "-", operand: S }));
        const norm = node.function === "sqrt" && matches(node.argument, N) && evaluate(N) > 0;
        if (!residual && !norm) throw new Error("unproved function operand");
        result = { numerator: new Map([[residual ? "U" : "V", rational(1n)]]), denominator: one(), dimension: residual ? 1 : 0 }; break;
      }
      case "binary": {
        const a = form(node.left), b = form(node.right);
        switch (node.operator) {
          case "+": case "-":
            if (!compatible(a.dimension, b.dimension)) throw new Error("sum dimension");
            result = { numerator: combine(product(a.numerator, b.denominator), product(b.numerator, a.denominator), node.operator === "+" ? 1 : -1), denominator: product(a.denominator, b.denominator), dimension: a.dimension ?? b.dimension }; break;
          case "*": result = { numerator: product(a.numerator, b.numerator), denominator: product(a.denominator, b.denominator), dimension: a.dimension === null && b.dimension === null ? null : (a.dimension ?? 0) + (b.dimension ?? 0) }; break;
          case "/": {
            // Rational identities are conditional on their original divisors
            // being defined at the exact source, checked before cancellation.
            const divisor = evaluate(node.right);
            if (!nonzeroAtSource(b.numerator) || !Number.isFinite(divisor) || divisor === 0) throw new Error("division domain");
            result = { numerator: product(a.numerator, b.denominator), denominator: product(a.denominator, b.numerator), dimension: a.dimension === null && b.dimension === null ? null : (a.dimension ?? 0) - (b.dimension ?? 0) }; break;
          }
          case "^": {
            const exponent = powerExponent(node.right);
            let numerator = one(), denominator = one();
            for (let i = 0; i < exponent; i++) { numerator = product(numerator, a.numerator); denominator = product(denominator, a.denominator); }
            result = { numerator, denominator, dimension: a.dimension === null ? null : a.dimension * exponent }; break;
          }
          default: throw new Error("unsupported operator");
        }
        break;
      }
      default: throw new Error("unsupported node");
    }
    memo.set(node, result); return result;
  };
  function powerExponent(node: Node): number {
    if (hasRole(node)) throw new Error("power role parameter");
    // Operator parameters use exact closed arithmetic, never display tolerance
    // or a rounded evaluation such as 2 + 1e-16 becoming the integer 2.
    const closed = form(node);
    const numerator = closed.numerator.get("") ?? rational(0n), denominator = closed.denominator.get("");
    if (!denominator) throw new Error("closed power denominator");
    const value = rational(numerator.n * denominator.d, numerator.d * denominator.n);
    if (value.d !== 1n || value.n < 0n || value.n > 4n) throw new Error("power budget");
    return Number(value.n);
  }
  const domains = new Map<Node, number>();
  function originalDomain(node: Node): number {
    tick(); const saved = domains.get(node); if (saved !== undefined) return saved;
    switch (node.kind) {
      case "number": break;
      case "variable": if (!values.has(node.name)) throw new Error("unknown role"); break;
      case "unary":
        if (node.operator !== "+" && node.operator !== "-") throw new Error("unsupported unary operator");
        originalDomain(node.operand); break;
      case "call": {
        const argument = originalDomain(node.argument);
        if (node.function !== "abs" && node.function !== "sqrt") throw new Error("unsupported function");
        if (node.function === "sqrt" && argument < 0) throw new Error("sqrt domain");
        break;
      }
      case "binary": {
        originalDomain(node.left); const right = originalDomain(node.right);
        if (node.operator === "^") powerExponent(node.right);
        else if (node.operator === "/") {
          if (right === 0 || !nonzeroAtSource(form(node.right).numerator)) throw new Error("division domain");
        } else if (node.operator !== "+" && node.operator !== "-" && node.operator !== "*") throw new Error("unsupported operator");
        break;
      }
      default: throw new Error("unsupported node");
    }
    const value = evaluate(node);
    if (!Number.isFinite(value)) throw new Error("original arithmetic domain");
    domains.set(node, value); return value;
  }
  function matches(actual: Node, expected: Node): boolean {
    tick(); originalDomain(actual);
    // Literal dimensions come from their matched source position. For
    // example the 1 in a*1 may be the audited x_P, but a role expression
    // equal to 1 at this point cannot take that position by value.
    if (!hasRole(actual)) { form(actual); return close(evaluate(actual), evaluate(expected)); }
    if (actual.kind === "binary" && expected.kind === "binary") {
      if (actual.operator === "^" && expected.operator === "^") return powerExponent(actual.right) === powerExponent(expected.right) && matches(actual.left, expected.left);
      if (actual.operator === expected.operator && matches(actual.left, expected.left) && matches(actual.right, expected.right)) return true;
      if (actual.operator === expected.operator && ["+", "*"].includes(actual.operator) && matches(actual.left, expected.right) && matches(actual.right, expected.left)) return true;
      if (["+", "-"].includes(actual.operator) && ["+", "-"].includes(expected.operator) && actual.operator !== expected.operator && matches(actual.left, expected.left)) return matches(actual.right, { kind: "unary", operator: "-", operand: expected.right });
    }
    if (actual.kind === "unary" && expected.kind === "unary" && actual.operator === expected.operator) return matches(actual.operand, expected.operand);
    if (actual.kind === "call" && expected.kind === "call" && actual.function === expected.function && matches(actual.argument, expected.argument)) return true;
    return same(form(actual), form(expected));
  }
  const parse = (text: string): Node => {
    const normalized = text.trim().replace(/\|([^|]+)\|/g, "abs($1)");
    if (!normalized || normalized.length > 256) throw new Error("source budget");
    const tokens: string[] = [], pattern = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z][A-Za-z0-9_]*'?)|([-+*/^()]))/y;
    let position = 0;
    while (position < normalized.length) {
      if (/^\s*$/.test(normalized.slice(position))) break;
      pattern.lastIndex = position; const match = pattern.exec(normalized);
      if (!match || tokens.length >= 128) throw new Error("token budget");
      tokens.push(match[1] ?? match[2] ?? match[3]!); position = pattern.lastIndex;
    }
    let at = 0;
    const enter = (depth: number) => { if (depth >= 24) throw new Error("depth budget"); return depth + 1; };
    const sum = (depth: number): Node => { let left = productNode(depth); while (tokens[at] === "+" || tokens[at] === "-") { const op = tokens[at++] as "+" | "-"; left = binary(op, left, productNode(depth)); } return left; };
    const productNode = (depth: number): Node => { let left = unary(depth); while (tokens[at] === "*" || tokens[at] === "/") { const op = tokens[at++] as "*" | "/"; left = binary(op, left, unary(depth)); } return left; };
    const unary = (depth: number): Node => {
      if (tokens[at] === "+" || tokens[at] === "-") { const operator = tokens[at++] as "+" | "-"; return { kind: "unary", operator, operand: unary(enter(depth)) }; }
      const left = primary(depth); return tokens[at] === "^" ? (at++, binary("^", left, unary(enter(depth)))) : left;
    };
    const primary = (depth: number): Node => {
      const token = tokens[at++]; if (!token) throw new Error("missing operand");
      if (token === "(" || token === "sqrt" || token === "abs") {
        if (token !== "(" && tokens[at++] !== "(") throw new Error("missing function argument");
        const argument = sum(enter(depth)); if (tokens[at++] !== ")") throw new Error("unclosed group");
        return token === "(" ? argument : call(token, argument);
      }
      if (/^(?:\d|\.)/.test(token)) {
        const exact = decimal(token), value = Number(token), represented = decimal(String(value));
        if (!Number.isFinite(value) || exact.n !== represented.n || exact.d !== represented.d) throw new Error("lossy literal");
        return number(value);
      }
      const role = aliases.get(token); if (!role) throw new Error("unbound operand"); return role;
    };
    const root = sum(0); if (at !== tokens.length) throw new Error("unconsumed arithmetic"); return root;
  };
  const tuple = (text: string): string[] | null => {
    if (!text.startsWith("(") || !text.endsWith(")")) return null;
    let depth = 0, comma = -1;
    for (let i = 1; i < text.length - 1; i++) { if (text[i] === "(") depth++; if (text[i] === ")") depth--; if (text[i] === "," && depth === 0) { if (comma !== -1) return null; comma = i; } }
    return comma > 0 ? [text.slice(1, comma), text.slice(comma + 1, -1)] : null;
  };
  const mathValue = (text: string): Node[] => {
    const trimmed = text.trim(), pair = tuple(trimmed);
    if (pair) return pair.map(parse);
    if (trimmed === source.footName) return [fx, fy];
    const affine = /^([A-Za-z][A-Za-z]?\d?'?)\s*-\s*\((.*)\)\s*\*\s*\(\s*a\s*,\s*b\s*\)$/.exec(trimmed);
    if (affine && affine[1] === source.pointName) { const scale = parse(affine[2]!); return [binary("-", X, binary("*", scale, A)), binary("-", Y, binary("*", scale, B))]; }
    const scaled = /^-\s*\((.*)\)\s*\*\s*\((.*)\)$/.exec(trimmed);
    if (scaled) { const pair = tuple(`(${scaled[2]})`); if (pair) { const scale: Node = { kind: "unary", operator: "-", operand: parse(scaled[1]!) }; return pair.map(part => binary("*", scale, parse(part))); } }
    return [parse(trimmed)];
  };
  const expected: Record<PlanarProofRole, Node[]> = { residual: [S], norm: [N], distance: [distance], x: [fx], y: [fy], foot: [fx, fy], displacement: [binary("*", {kind:"unary",operator:"-",operand:binary("/",S,N)}, A), binary("*", {kind:"unary",operator:"-",operand:binary("/",S,N)}, B)], incidence: [binary("+", binary("+", binary("*", A, fx), binary("*", B, fy)), C)] };
  return { proves(text, role) {
    operations = 0; memo.clear(); domains.clear();
    try {
      if (typeof text !== "string" || text.length > 1024 || ![...values.values()].every(Number.isFinite) || !Number.isFinite(evaluate(N)) || evaluate(N) <= 0) return false;
      const parts = text.split("="); if (parts.length < 2 || parts.length > 8) return false;
      const rows = parts.map(mathValue), target = expected[role];
      return rows.every(row => row.length === target.length && row.every((node, i) => matches(node, target[i]!)));
    } catch { return false; }
  } };
}
