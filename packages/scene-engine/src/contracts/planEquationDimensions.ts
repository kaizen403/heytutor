import type { TurnPlanV3, TurnPlanValidationIssue } from "./contractsV3";
import { unwrapMathMarkup } from "@heytutor/drawing";
import {
  Q_ONE, Q_ZERO, addRational, divideRational, multiplyRational, negateRational,
  parseRational, rational, subtractRational, type Rational,
} from "../math/exactRational";

export type PlanEquationDimensionInput = Pick<TurnPlanV3, "givens" | "unknowns" | "qualitativeClaims">;
export type PlanUnitSignatureReader = (unit: unknown) => string | null;

// A refusal check, not a formula solver. Keep text, grammar and elimination bounded.
const LIMITS = { text: 1000, totalText: 8000, tokens: 192, depth: 16, symbols: 64, rows: 192, operations: 20000 };
const DIMENSION_COUNT = 7;
const ZERO_DIMENSIONS: readonly Rational[] = Array.from({ length: DIMENSION_COUNT }, () => Q_ZERO);
const PRESERVING_FUNCTIONS = new Set(["abs", "magnitude", "norm", "avg", "average", "mean", "rms", "peak"]);
const NAME = /^[\p{L}]+(?:_(?:[\p{L}]+|\d+))?$/u;
const SUBSCRIPTS: Readonly<Record<string, string>> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };
const SUPERSCRIPTS: Readonly<Record<string, string>> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-" };
const SAFE_LATEX = new Set([
  "frac", "dfrac", "tfrac", "sqrt", "left", "right", "displaystyle", "quad", "qquad",
  "mathrm", "mathbf", "mathit", "boldsymbol", "vec", "overline", "bar", "operatorname",
  "times", "cdot", "div", "langle", "rangle", "lvert", "rvert", "vert", "lVert", "rVert",
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "theta", "lambda", "mu", "pi",
  "rho", "sigma", "tau", "phi", "varphi", "omega", "Delta", "Omega", "Sigma", "Theta", "Phi", "Lambda",
]);

class UnsupportedEquation extends Error {}
class DimensionBudgetExceeded extends Error {}

/** SI dimensional definitions, in kg, m, s, A, K, mol, cd order; no scale factors. */
const SI_DIMENSIONS: Readonly<Record<string, readonly number[]>> = {
  kg: [1, 0, 0, 0, 0, 0, 0], m: [0, 1, 0, 0, 0, 0, 0], s: [0, 0, 1, 0, 0, 0, 0],
  A: [0, 0, 0, 1, 0, 0, 0], K: [0, 0, 0, 0, 1, 0, 0], mol: [0, 0, 0, 0, 0, 1, 0], cd: [0, 0, 0, 0, 0, 0, 1],
  N: [1, 1, -2, 0, 0, 0, 0], J: [1, 2, -2, 0, 0, 0, 0], eV: [1, 2, -2, 0, 0, 0, 0],
  W: [1, 2, -3, 0, 0, 0, 0], Pa: [1, -1, -2, 0, 0, 0, 0], Hz: [0, 0, -1, 0, 0, 0, 0],
  C: [0, 0, 1, 1, 0, 0, 0], V: [1, 2, -3, -1, 0, 0, 0], "Ω": [1, 2, -3, -2, 0, 0, 0],
  F: [-1, -2, 4, 2, 0, 0, 0], H: [1, 2, -2, -2, 0, 0, 0], T: [1, 0, -2, -1, 0, 0, 0],
  Wb: [1, 2, -2, -1, 0, 0, 0], L: [0, 3, 0, 0, 0, 0, 0], D: [0, -1, 0, 0, 0, 0, 0],
};

function canonicalMath(raw: string): string | null {
  if (raw.length > LIMITS.text) return null;
  for (const match of raw.matchAll(/\\([A-Za-z]+)/g)) if (!SAFE_LATEX.has(match[1]!)) return null;
  const markup = raw
    .replace(/\\langle\b/g, "⟨").replace(/\\rangle\b/g, "⟩")
    .replace(/\\(?:lvert|rvert|vert|lVert|rVert)\b/g, "|");
  return unwrapMathMarkup(markup)
    .replace(/[−–]/g, "-").replace(/µ/g, "μ")
    .replace(/[₀-₉]+/g, (group) => `_${[...group].map((char) => SUBSCRIPTS[char]).join("")}`)
    .replace(/_\{([^{}]+)\}/g, (_match, body: string) => `_${body.replace(/\s/g, "")}`)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (group) => `^(${[...group].map((char) => SUPERSCRIPTS[char]).join("")})`)
    .replace(/[×·⋅]/g, "*").replace(/÷/g, "/")
    .replace(/[{}]/g, (char) => char === "{" ? "(" : ")")
    .replace(/([\p{L}\d])(?:⃗|→)(?=$|[\s+*/^=)\]⟩>|])/gu, "$1")
    .replace(/`/g, "").trim();
}

function canonicalSymbol(raw: string): string | null {
  const name = canonicalMath(raw);
  return name && NAME.test(name) ? name : null;
}

function vectorAdd(a: readonly Rational[], b: readonly Rational[], sign = Q_ONE): Rational[] {
  return a.map((value, i) => addRational(value, multiplyRational(b[i]!, sign)));
}
function vectorScale(a: readonly Rational[], scale: Rational): Rational[] {
  return a.map((value) => multiplyRational(value, scale));
}
function sameDimensions(a: readonly Rational[], b: readonly Rational[]): boolean {
  return a.every((value, i) => subtractRational(value, b[i]!).n === 0n);
}

/** Read atomic unit signatures through the existing recognizer, preserving unit parentheses here. */
export function readUnitDimensions(raw: unknown, signatureReader: PlanUnitSignatureReader): readonly Rational[] | null {
  if (typeof raw !== "string" || raw.length > 128) return null;
  if (["", "1", "dimensionless", "unitless"].includes(raw.trim().toLowerCase())) return ZERO_DIMENSIONS;
  const text = raw.trim().replace(/[−–]/g, "-")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (group) => `^(${[...group].map((char) => SUPERSCRIPTS[char]).join("")})`)
    .replace(/[·⋅]/g, "*");
  const tokens = text.match(/[\p{L}Ωµμ%°]+|\d+|[()*/^+-]/gu) ?? [];
  if (tokens.length > 64 || tokens.join("") !== text.replace(/\s/g, "")) return null;
  let index = 0;
  let depth = 0;
  const atomic = (unit: string): readonly Rational[] => {
    if (["rad", "radian", "radians", "sr", "degree", "degrees", "°"].includes(unit)) return ZERO_DIMENSIONS;
    const signature = signatureReader(unit);
    if (signature === null) throw new UnsupportedEquation();
    let result: readonly Rational[] = ZERO_DIMENSIONS;
    for (const entry of signature ? signature.split("·") : []) {
      const match = /^([\p{L}Ωµμ]+)\^(-?\d+)$/u.exec(entry);
      const basis = match && SI_DIMENSIONS[match[1]!];
      if (!match || !basis || Math.abs(Number(match[2])) > 32) throw new UnsupportedEquation();
      result = vectorAdd(result, basis.map((value) => rational(BigInt(value))), rational(BigInt(match[2]!)));
    }
    return result;
  };
  const power = (): Rational => {
    const grouped = tokens[index] === "(";
    if (grouped) index++;
    let sign = 1n;
    if (tokens[index] === "-" || tokens[index] === "+") { if (tokens[index] === "-") sign = -1n; index++; }
    const token = tokens[index++];
    if (!token || !/^\d+$/.test(token) || Number(token) > 32) throw new UnsupportedEquation();
    let value = rational(sign * BigInt(token));
    if (grouped && tokens[index] === "/") {
      index++;
      const denominator = tokens[index++];
      if (!denominator || !/^\d+$/.test(denominator) || Number(denominator) < 1 || Number(denominator) > 32) throw new UnsupportedEquation();
      value = divideRational(value, rational(BigInt(denominator)));
    }
    if (grouped && tokens[index++] !== ")") throw new UnsupportedEquation();
    return value;
  };
  const factor = (): readonly Rational[] => {
    if (++depth > LIMITS.depth) throw new UnsupportedEquation();
    const token = tokens[index++];
    let value: readonly Rational[];
    if (token === "(") {
      value = product();
      if (tokens[index++] !== ")") throw new UnsupportedEquation();
    } else if (token === "1") value = ZERO_DIMENSIONS;
    else if (token && /^[\p{L}Ωµμ%°]+$/u.test(token)) value = atomic(token);
    else throw new UnsupportedEquation();
    if (tokens[index] === "^") { index++; value = vectorScale(value, power()); }
    depth--;
    return value;
  };
  const product = (): readonly Rational[] => {
    let value = factor();
    while (index < tokens.length && tokens[index] !== ")") {
      const operator = tokens[index];
      if (operator === "*" || operator === "/") index++;
      else if (!operator || !/^(?:[\p{L}Ωµμ%°]+|\(|1)$/u.test(operator)) throw new UnsupportedEquation();
      value = vectorAdd(value, factor(), operator === "/" ? negateRational(Q_ONE) : Q_ONE);
    }
    return value;
  };
  try {
    const result = product();
    return index === tokens.length ? result : null;
  } catch { return null; }
}

interface DimensionForm { constant: readonly Rational[]; variables: Map<string, Rational> }
interface Expression {
  form: DimensionForm;
  constraints: DimensionForm[];
  literalOnly: boolean;
  zero: boolean;
  bareSymbol?: string;
}
interface Token { kind: "number" | "name" | "operator"; text: string }

function emptyForm(): DimensionForm { return { constant: ZERO_DIMENSIONS, variables: new Map() }; }
function addForm(a: DimensionForm, b: DimensionForm, scale = Q_ONE): DimensionForm {
  const variables = new Map(a.variables);
  for (const [name, value] of b.variables) {
    const combined = addRational(variables.get(name) ?? Q_ZERO, multiplyRational(value, scale));
    if (combined.n === 0n) variables.delete(name); else variables.set(name, combined);
  }
  return { constant: vectorAdd(a.constant, b.constant, scale), variables };
}
function scaleForm(form: DimensionForm, scale: Rational): DimensionForm {
  const variables = new Map<string, Rational>();
  for (const [name, value] of form.variables) {
    const coefficient = multiplyRational(value, scale);
    if (coefficient.n !== 0n) variables.set(name, coefficient);
  }
  return { constant: vectorScale(form.constant, scale), variables };
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    if (/\s/.test(text[index]!)) { index++; continue; }
    const remainder = text.slice(index);
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(remainder);
    const name = /^(?:[A-Za-z]+|[\p{L}])(?:_(?:\d+|[\p{L}]+))?/u.exec(remainder);
    if (number) {
      if (number[0].length > 32) throw new UnsupportedEquation();
      tokens.push({ kind: "number", text: number[0] }); index += number[0].length;
    } else if (name && /^\p{L}/u.test(name[0])) {
      tokens.push({ kind: "name", text: name[0] }); index += name[0].length;
    } else if ("()+-*/^|⟨⟩<>[]".includes(text[index]!)) {
      tokens.push({ kind: "operator", text: text[index++]! });
    } else throw new UnsupportedEquation();
    if (tokens.length > LIMITS.tokens) throw new UnsupportedEquation();
  }
  return tokens;
}

class ExpressionReader {
  private index = 0;
  private depth = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly known: ReadonlyMap<string, readonly Rational[]>,
    private readonly names: ReadonlySet<string>,
    private readonly ambiguous: ReadonlySet<string>,
    private readonly unitSignature: PlanUnitSignatureReader,
  ) {}

  read(): Expression {
    const value = this.sum(new Set());
    if (this.index !== this.tokens.length) throw new UnsupportedEquation();
    return value;
  }
  private peek(): Token | undefined { return this.tokens[this.index]; }
  private sum(stops: ReadonlySet<string>): Expression {
    let left = this.product(stops);
    while (["+", "-"].includes(this.peek()?.text ?? "")) {
      this.index++;
      const right = this.product(stops);
      const constraints = [...left.constraints, ...right.constraints];
      if (left.zero) left = { ...right, constraints, bareSymbol: undefined };
      else if (right.zero) left = { ...left, constraints, bareSymbol: undefined };
      else {
        // A bare number added to a measurement may have an omitted unit.
        if (left.literalOnly !== right.literalOnly) throw new UnsupportedEquation();
        constraints.push(addForm(left.form, right.form, negateRational(Q_ONE)));
        left = { form: left.form, constraints, literalOnly: left.literalOnly && right.literalOnly, zero: false };
      }
    }
    return left;
  }
  private product(stops: ReadonlySet<string>): Expression {
    let left = this.power(stops);
    while (this.peek() && !stops.has(this.peek()!.text)) {
      const token = this.peek()!;
      const explicit = token.text === "*" || token.text === "/";
      const implicit = token.kind === "name" || token.kind === "number" || ["(", "[", "|", "⟨", "<"].includes(token.text);
      if (!explicit && !implicit) break;
      if (explicit) this.index++;
      else if (left.literalOnly && token.kind === "name") {
        // “5 m” may be a unit literal rather than five times a source variable m.
        const variableUnit = this.known.get(token.text);
        const literalUnit = readUnitDimensions(token.text, this.unitSignature);
        if (variableUnit && literalUnit && !sameDimensions(variableUnit, literalUnit)) throw new UnsupportedEquation();
      }
      const right = this.power(stops);
      if (token.text === "/" && right.zero) throw new UnsupportedEquation();
      left = {
        form: addForm(left.form, right.form, token.text === "/" ? negateRational(Q_ONE) : Q_ONE),
        constraints: [...left.constraints, ...right.constraints],
        literalOnly: left.literalOnly && right.literalOnly, zero: left.zero || (token.text !== "/" && right.zero),
      };
    }
    return left;
  }
  private power(stops: ReadonlySet<string>): Expression {
    let value = this.atom(stops);
    if (this.peek()?.text === "^") {
      this.index++;
      const exponent = this.exponent();
      if (value.zero && exponent.n <= 0n) throw new UnsupportedEquation();
      value = { ...value, form: scaleForm(value.form, exponent), bareSymbol: undefined };
    }
    return value;
  }
  private exponent(): Rational {
    const grouped = this.peek()?.text === "(";
    if (grouped) this.index++;
    let sign = Q_ONE;
    if (["-", "+"].includes(this.peek()?.text ?? "")) { if (this.peek()!.text === "-") sign = negateRational(Q_ONE); this.index++; }
    const token = this.tokens[this.index++];
    if (!token || token.kind !== "number") throw new UnsupportedEquation();
    let value = multiplyRational(sign, parseRational(token.text));
    if (grouped && this.peek()?.text === "/") {
      this.index++;
      const denominator = this.tokens[this.index++];
      if (!denominator || denominator.kind !== "number") throw new UnsupportedEquation();
      value = divideRational(value, parseRational(denominator.text));
    }
    if (grouped && this.tokens[this.index++]?.text !== ")") throw new UnsupportedEquation();
    if (value.n < -32n * value.d || value.n > 32n * value.d || value.d > 32n) throw new UnsupportedEquation();
    return value;
  }
  private atom(stops: ReadonlySet<string>): Expression {
    if (++this.depth > LIMITS.depth) throw new UnsupportedEquation();
    const token = this.tokens[this.index++];
    if (!token || stops.has(token.text)) throw new UnsupportedEquation();
    let value: Expression;
    if (token.text === "+" || token.text === "-") {
      value = { ...this.power(stops), bareSymbol: undefined };
    } else if (["(", "[", "|", "⟨", "<"].includes(token.text)) {
      const close = ({ "(": ")", "[": "]", "|": "|", "⟨": "⟩", "<": ">" } as Record<string, string>)[token.text]!;
      value = { ...this.sum(new Set([close])), bareSymbol: undefined };
      if (this.tokens[this.index++]?.text !== close) throw new UnsupportedEquation();
    } else if (token.kind === "number") {
      value = { form: emptyForm(), constraints: [], literalOnly: true, zero: parseRational(token.text).n === 0n };
    } else if (token.kind === "name") {
      if (this.ambiguous.has(token.text)) throw new UnsupportedEquation();
      const functionName = token.text.toLowerCase();
      if (this.peek()?.text === "(" && (PRESERVING_FUNCTIONS.has(functionName) || functionName === "sqrt")) {
        if (this.known.has(token.text)) throw new UnsupportedEquation();
        this.index++;
        value = { ...this.sum(new Set([")"])), bareSymbol: undefined };
        if (this.tokens[this.index++]?.text !== ")") throw new UnsupportedEquation();
        if (functionName === "sqrt") value = { ...value, form: scaleForm(value.form, rational(1n, 2n)) };
      } else {
        if (this.peek()?.text === "(") throw new UnsupportedEquation();
        if (!this.names.has(token.text) && !/^[\p{L}](?:_(?:[\p{L}]+|\d+))?$/u.test(token.text) && token.text !== "pi") throw new UnsupportedEquation();
        const dimensions = this.known.get(token.text);
        const numericConstant = !dimensions && (token.text === "π" || token.text === "pi");
        const form = dimensions ? { constant: dimensions, variables: new Map<string, Rational>() }
          : numericConstant ? emptyForm()
          : { constant: ZERO_DIMENSIONS, variables: new Map([[token.text, Q_ONE]]) };
        value = { form, constraints: [], literalOnly: numericConstant, zero: false, bareSymbol: numericConstant ? undefined : token.text };
      }
    } else throw new UnsupportedEquation();
    this.depth--;
    return value;
  }
}

interface ClaimText { path: string; clauses: string[] }

/** Only standalone algebra and bounded connective clauses, never equation substrings inside arbitrary prose. */
function clausesFromText(raw: string): string[] {
  if (/["“”]/.test(raw) || /\b(?:not|incorrect|false|wrong|counterexample|suppose|if|unless)\b/i.test(raw)) return [];
  const text = canonicalMath(raw);
  if (text === null) return [];
  const clauses: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if ("([⟨".includes(char)) depth++;
    else if (")]⟩".includes(char)) depth--;
    if (depth < 0 || depth > LIMITS.depth) return [];
    if (depth !== 0) continue;
    const decimalPoint = char === "." && /\d/.test(text[index + 1] ?? "") && (index === 0 || /[\d\s=+*/(-]/.test(text[index - 1]!));
    const connector = /^\s+(?:and|where)\s+/i.exec(text.slice(index));
    if (";,\n".includes(char) || char === "." && !decimalPoint || connector) {
      clauses.push(text.slice(start, index).trim());
      if (connector) index += connector[0].length - 1;
      start = index + 1;
    }
  }
  if (depth !== 0) return [];
  clauses.push(text.slice(start).trim());
  return clauses.filter(Boolean).map((clause) => clause.replace(/^where\s+/i, "").replace(/\s+for\s+[^=]*$/i, "").trim());
}

function averageReferent(clause: string, owner: string | null): string | null {
  const implicit = /^its\s+(?:(?:cycle|time)\s+)?average\s+(?:has\s+(?:a\s+)?magnitude\s+|(?:is|equals)\s+|=\s*)(.+)$/i.exec(clause);
  if (implicit && owner) return `avg(${owner}) = abs(${implicit[1]})`;
  const explicit = /^(?:the\s+)?(?:(?:cycle|time)\s+)?average\s+of\s+([\p{L}]+(?:_(?:[\p{L}]+|\d+))?)\s+(?:has\s+(?:a\s+)?magnitude\s+|(?:is|equals)\s+|=\s*)(.+)$/iu.exec(clause);
  return explicit ? `avg(${explicit[1]}) = abs(${explicit[2]})` : null;
}

/** Incremental exact linear consistency, with one dimension vector per untyped symbol. */
class DimensionConstraints {
  private readonly basis = new Map<string, DimensionForm>();
  private readonly symbols = new Set<string>();
  private rows = 0;
  private operations = 0;
  add(input: DimensionForm): boolean {
    if (++this.rows > LIMITS.rows) throw new DimensionBudgetExceeded();
    for (const key of input.variables.keys()) this.symbols.add(key);
    if (this.symbols.size > LIMITS.symbols) throw new DimensionBudgetExceeded();
    let row = input;
    for (const key of [...this.basis.keys()].sort()) {
      const coefficient = row.variables.get(key);
      if (!coefficient) continue;
      this.operations += row.variables.size + this.basis.get(key)!.variables.size + DIMENSION_COUNT;
      if (this.operations > LIMITS.operations) throw new DimensionBudgetExceeded();
      row = addForm(row, this.basis.get(key)!, negateRational(coefficient));
      for (const value of [...row.constant, ...row.variables.values()]) {
        if (value.n.toString(2).length > 512 || value.d.toString(2).length > 512) throw new DimensionBudgetExceeded();
      }
    }
    const pivot = [...row.variables.keys()].sort()[0];
    if (!pivot) return row.constant.every((value) => value.n === 0n);
    this.basis.set(pivot, scaleForm(row, divideRational(Q_ONE, row.variables.get(pivot)!)));
    return true;
  }
}

/**
 * Reject only demonstrably inconsistent supported qualitative equalities.
 * Missing/unknown units, ambiguous symbols, unsupported syntax and bounded-out
 * algebra stay unproved. An empty result does not certify a formula, a numeric
 * value or a unit conversion. The caller supplies its existing unit recognizer.
 */
export function validatePlanEquationDimensions(
  plan: PlanEquationDimensionInput,
  unitSignature: PlanUnitSignatureReader,
): TurnPlanValidationIssue[] {
  const known = new Map<string, readonly Rational[]>();
  const ambiguous = new Set<string>();
  const names = new Set<string>();
  const sources = new Map<string, string>();
  const declarations = new Map<string, readonly Rational[] | null>();
  for (const quantity of [...plan.givens, ...plan.unknowns]) {
    const symbol = canonicalSymbol(quantity.symbol);
    if (!symbol) continue;
    names.add(symbol);
    const dimensions = readUnitDimensions(quantity.unit, unitSignature);
    if (declarations.has(symbol)) {
      const previous = declarations.get(symbol);
      if (!dimensions || !previous || !sameDimensions(previous, dimensions)) ambiguous.add(symbol);
    } else declarations.set(symbol, dimensions);
    if (!dimensions) continue;
    if (known.has(symbol) && !sameDimensions(known.get(symbol)!, dimensions)) ambiguous.add(symbol);
    else { known.set(symbol, dimensions); sources.set(symbol, quantity.unit!); }
  }
  if (names.size > LIMITS.symbols || plan.qualitativeClaims.length > 64) return [];
  for (const symbol of ambiguous) { known.delete(symbol); sources.delete(symbol); }
  const texts: ClaimText[] = [];
  let totalText = 0;
  for (let i = 0; i < plan.qualitativeClaims.length; i++) {
    const claim = plan.qualitativeClaims[i]!;
    const field = typeof claim.expected === "string" ? "expected" : claim.expected === true ? "claim" : null;
    if (!field) continue;
    const raw = field === "expected" ? String(claim.expected) : claim.claim;
    totalText += raw.length;
    if (totalText > LIMITS.totalText) return [];
    const clauses = clausesFromText(raw);
    texts.push({ path: `qualitativeClaims[${i}].${field}`, clauses });
    for (const clause of clauses) {
      const lhs = clause.split("=")[0]!.trim();
      if (clause.includes("=") && NAME.test(lhs)) names.add(lhs);
    }
  }
  if (names.size > LIMITS.symbols) return [];
  const constraints = new DimensionConstraints();
  try {
    for (const text of texts) {
      let owner: string | null = null;
      for (const clause of text.clauses) {
        const equation = averageReferent(clause, owner) ?? clause;
        const members = equation.split("=").map((member) => member.trim());
        if (members.length < 2 || members.length > 8 || /[≈≠≤≥]/.test(equation)) { owner = null; continue; }
        let expressions: Expression[];
        try {
          expressions = members.map((member) => new ExpressionReader(tokenize(member), known, names, ambiguous, unitSignature).read());
          if (expressions.some((expression) => expression.literalOnly || expression.zero)) throw new UnsupportedEquation();
        } catch { owner = null; continue; }
        owner = expressions[0]!.bareSymbol ?? null;
        const rows = expressions.flatMap((expression) => expression.constraints);
        for (let i = 1; i < expressions.length; i++) rows.push(addForm(expressions[i - 1]!.form, expressions[i]!.form, negateRational(Q_ONE)));
        for (const row of rows) {
          if (constraints.add(row)) continue;
          const units = [...sources].slice(0, 6).map(([name, unit]) => `${name.slice(0, 32)}: ${unit.slice(0, 48)}`).join(", ");
          return [{
            code: "plan_equation_dimension_contradiction", path: text.path,
            message: `Supported equality ${equation.slice(0, 160)} conflicts with declared unit dimensions (${units}) and other supported equalities. Revise the qualitative algebra; dimensional consistency alone never proves a formula or conversion.`,
          }];
        }
      }
    }
  } catch { return []; }
  return [];
}
