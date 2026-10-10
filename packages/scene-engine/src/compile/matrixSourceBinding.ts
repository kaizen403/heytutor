import type { SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { evaluateMatrixArrayConstruction, matrixEntryDouble, MATRIX_ARRAY_OPERATORS, type MatrixArrayGeometry } from "./matrixArrayGeometry";
import { snapshotMathSourceData } from "./mathSourceData";
import { parseMathExpression2D } from "../math/expression";

type Expression = { name: string } | { operation: string; operands: Expression[]; scalar?: string; scalarLiteral?: string; scalarName?: string };
interface MatrixSource {
  matrices: Map<string, MatrixArrayGeometry>;
  expressions: Map<string, Expression>;
  scalars: Map<string, string>;
  requests: Expression[];
  declaredTypes?: Map<string, Set<string>>;
  entryPrefixes?: Map<string, string>;
  unresolved?: string;
  literals?: Map<string, string[][]>;
}
const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?";
const NAME = "[A-Za-z][A-Za-z0-9_]{0,15}";
const MATRIX_NAME = "[A-Z][A-Za-z0-9_]{0,15}";
// Exact fractions p/q are source cells too; they are tried before decimals so
// 1/2 is never read as the decimal 1.
const CELL = `(?:[+-]?\\d{1,12}\\s*\\/\\s*\\d{1,12}|${NUMBER})`;
const LITERAL = new RegExp(`^${CELL}$`, "i");
const latexFraction = (cell: string): string => cell.replace(/^([+-]?)\s*\\[dt]?frac\s*\{\s*(\d{1,12})\s*\}\s*\{\s*(\d{1,12})\s*\}$/, "$1$2/$3");
const OPERATORS = new Set<string>(MATRIX_ARRAY_OPERATORS);
const WORDS = new Set("the a an matrix matrices has have with and of given let be is are show find calculate compute determine evaluate state its their type types order rows columns by in for whether classify classification real entries entry dimensions dimension respectively what which write identify element elements that also".split(" "));
// Closed type vocabulary shared by every source type clause. Multiword names
// normalize to the evaluator's snake_case identifiers.
const TYPE = "square|rectangular|row|column|zero|identity|scalar|diagonal|upper[- ]triangular|lower[- ]triangular|symmetric|skew[- ]symmetric";
const typeId = (text: string): string => text.toLowerCase().replace(/[- ]/g, "_");
const IMPLIED_TYPES: Readonly<Record<string, readonly string[]>> = {
  identity: ["identity", "scalar", "diagonal", "upper_triangular", "lower_triangular", "symmetric", "square"],
  scalar: ["scalar", "diagonal", "upper_triangular", "lower_triangular", "symmetric", "square"],
  diagonal: ["diagonal", "upper_triangular", "lower_triangular", "symmetric", "square"],
  upper_triangular: ["upper_triangular", "square"],
  lower_triangular: ["lower_triangular", "square"],
  symmetric: ["symmetric", "square"],
  skew_symmetric: ["skew_symmetric", "square"],
};

function fail(message: string): never { throw new Error(message); }
function literalGeometry(entries: unknown): MatrixArrayGeometry {
  return evaluateMatrixArrayConstruction("matrix_array", { entries, origin: [0, 0], displayScale: 1 }, {
    scalar() { return fail("Source matrix entries require explicit decimal literals"); },
    geometry() { return fail("Source literals cannot introduce matrix references"); },
  })[0]!;
}
function sameEntries(a: MatrixArrayGeometry, b: MatrixArrayGeometry): boolean {
  return JSON.stringify(a.matrixArray.exactEntries) === JSON.stringify(b.matrixArray.exactEntries);
}
function scalarGeometry(value: unknown): MatrixArrayGeometry { return literalGeometry([[value]]); }
function signature(expression: Expression): string {
  return "name" in expression ? `name:${expression.name}` : `${expression.operation}(${expression.scalar ?? ""};${expression.operands.map(signature).join(",")})`;
}
function matrixLiteral(text: string, start: number): { entries: string[][]; end: number } | null {
  const nested = /^\[\s*\[/.test(text.slice(start));
  if (nested) {
    let end = start;
    let depth = 0;
    for (; end < text.length; end++) {
      if (text[end] === "[") depth++;
      if (text[end] === "]" && --depth === 0) { end++; break; }
    }
    if (depth !== 0) fail("Source matrix brackets are incomplete");
    const body = text.slice(start, end);
    const rowPattern = new RegExp(`\\[\\s*(${CELL}(?:\\s*,\\s*${CELL})*)\\s*\\]`, "gi");
    const rows: string[][] = [];
    const residue = body.slice(1, -1).replace(rowPattern, (_, row: string) => { rows.push(row.split(",").map((entry) => entry.replace(/\s+/g, ""))); return "R"; });
    if (!/^\s*R(?:\s*,\s*R)*\s*$/.test(residue)) fail("Source matrix cells require bounded decimal literals");
    return { entries: rows, end };
  }
  const opening = /^\\begin\{(pmatrix|bmatrix|matrix|smallmatrix|array)\}(?:\{([clr]{1,6})\})?/.exec(text.slice(start));
  if (!opening) return null;
  if (opening[1] === "array" && !opening[2] || opening[1] !== "array" && opening[2]) fail("Unsupported source matrix environment");
  const closing = `\\end{${opening[1]}}`;
  const end = text.indexOf(closing, start + opening[0].length);
  if (end < 0) fail("Source matrix environment is incomplete");
  const rows = text.slice(start + opening[0].length, end).split(/\\\\/).map((row) => row.split("&").map((entry) => latexFraction(entry.trim()).replace(/\s+/g, "")));
  if (rows.some((row) => row.some((entry) => !LITERAL.test(entry)))) fail("Source matrix cells require bounded decimal literals");
  if (opening[2] && rows.some((row) => row.length !== opening[2]!.length)) fail("Source array column specification contradicts its cells");
  return { entries: rows, end: end + closing.length };
}

function parseExpression(text: string, start: number, source: MatrixSource): { expression: Expression; end: number } | null {
  let at = start;
  let depth = 0;
  const spaces = (): void => { while (/\s/.test(text[at] ?? "") && at < text.length) at++; };
  const atom = (): Expression | null => {
    if (++depth > 32) fail("Source expression exceeds depth32");
    spaces();
    let result: Expression | null = null;
    if (text[at] === "(") {
      at++;
      result = addition();
      spaces();
      if (!result || text[at++] !== ")") fail("Source algebra parentheses are incomplete");
    } else {
      const scalar = new RegExp(`^(${CELL})`, "i").exec(text.slice(at));
      const scalarName = new RegExp(`^(${NAME})`).exec(text.slice(at));
      const adjacentScalars = scalarName ? [...source.scalars.keys()].filter((name) => scalarName[1]!.startsWith(name) && source.expressions.has(scalarName[1]!.slice(name.length))) : [];
      if (adjacentScalars.length > 1) fail("Scalar-matrix adjacency is ambiguous");
      const scalarIdentity = scalarName && source.scalars.has(scalarName[1]!) ? scalarName[1]! : adjacentScalars[0];
      const factor = scalar?.[1] ?? (scalarIdentity ? source.scalars.get(scalarIdentity) : undefined);
      if (factor !== undefined) {
        at += scalar ? scalar[0].length : scalarIdentity!.length;
        spaces();
        if (text[at] === "*" || text[at] === "·") at++;
        const operand = atom();
        if (!operand) fail("Source scalar multiplication has no matrix operand");
        const exact = scalarGeometry(factor).matrixArray.exactEntries[0]![0]!;
        result = { operation: "matrix_scale", scalar: `${exact.numerator}/${exact.denominator}`, scalarLiteral: factor, ...(scalar ? {} : { scalarName: scalarIdentity! }), operands: [operand] };
      } else {
        const name = new RegExp(`^(${NAME})`).exec(text.slice(at))?.[1];
        if (name && source.expressions.has(name)) { at += name.length; result = source.expressions.get(name)!; }
        else if (name?.length === 2 && source.expressions.has(name[0]!) && source.expressions.has(name[1]!)) {
          at += 2;
          result = { operation: "matrix_product", operands: [source.expressions.get(name[0]!)!, source.expressions.get(name[1]!)!] };
        }
      }
    }
    if (result) {
      spaces();
      const transpose = /^(?:\^\s*(?:\{\s*(?:T|\\top)\s*\}|T|\\top)|['′ᵀ])/.exec(text.slice(at));
      if (transpose) { at += transpose[0].length; result = { operation: "matrix_transpose", operands: [result] }; }
    }
    depth--;
    return result;
  };
  const product = (): Expression | null => {
    let result = atom();
    if (!result) return null;
    while (true) {
      spaces();
      if (text[at] !== "*") break;
      at++;
      const next = atom();
      if (!next) fail("Source matrix product has no right operand");
      result = { operation: "matrix_product", operands: [result, next] };
    }
    return result;
  };
  const addition = (): Expression | null => {
    let result = product();
    if (!result) return null;
    while (true) {
      spaces();
      if (text[at] !== "+") break;
      at++;
      const next = product();
      if (!next) fail("Source matrix sum has no right operand");
      result = { operation: "matrix_add", operands: [result, next] };
    }
    return result;
  };
  const expression = addition();
  return expression ? { expression, end: at } : null;
}

function parseSource(question: string): MatrixSource {
  if (question.length > 8192) fail("Source matrix question exceeds8192 characters");
  let text = question.replace(/\$/g, "").replace(/\\(?:left|right)\s*[[\]()|]?/g, "").replace(/[−–]/g, "-").replace(/[×·]/g, "*");
  const source: MatrixSource = { matrices: new Map(), expressions: new Map(), scalars: new Map(), requests: [], declaredTypes: new Map(), literals: new Map() };
  const erase = (start: number, end: number): void => { text = text.slice(0, start) + " ".repeat(end - start) + text.slice(end); };
  const assignment = new RegExp(`\\b(${NAME})\\s*=\\s*`, "g");
  for (const match of text.matchAll(assignment)) {
    const literal = matrixLiteral(text, match.index! + match[0].length);
    if (!literal) continue;
    const name = match[1]!;
    if (source.expressions.has(name) || source.matrices.size >= 8) fail("Source matrix identities are repeated or exceed8");
    source.matrices.set(name, literalGeometry(literal.entries));
    source.literals!.set(name, literal.entries);
    source.expressions.set(name, { name });
    // Keep the name in place: "Is A=[[..]] symmetric?" still reads "Is A symmetric?".
    erase(match.index! + name.length, literal.end);
  }
  if (source.matrices.size === 0) fail("Source has no supported named matrix literals; symbolic/OCR premises require independent source proof");
  const scalarAssignment = new RegExp(`\\b(${NAME})\\s*=\\s*(${CELL})(?![\\w/]|\\.\\d)`, "gi");
  for (const match of text.matchAll(scalarAssignment)) {
    const name = match[1]!;
    if (source.expressions.has(name) || source.scalars.has(name)) fail("Source scalar identity is repeated or ambiguous");
    scalarGeometry(match[2]);
    source.scalars.set(name, match[2]!);
    erase(match.index!, match.index! + match[0].length);
  }
  for (const match of text.matchAll(assignment)) {
    const parsed = parseExpression(text, match.index! + match[0].length, source);
    if (!parsed || source.expressions.has(match[1]!) || source.scalars.has(match[1]!)) fail("Source assignment is unsupported or ambiguous");
    source.expressions.set(match[1]!, parsed.expression);
    source.requests.push(parsed.expression);
    erase(match.index!, parsed.end);
  }
  const dimensions = new RegExp(`\\b(${NAME})\\s+(?:has|is|of|with)\\s+(?:(?:a|order)\\s+)?(\\d+)\\s*(?:rows?\\s+and\\s+|[x*]\\s*)(\\d+)\\s*(?:columns?)?`, "gi");
  for (const match of text.matchAll(dimensions)) {
    const matrix = source.matrices.get(match[1]!);
    if (!matrix || matrix.matrixArray.rows !== Number(match[2]) || matrix.matrixArray.columns !== Number(match[3])) fail("Source matrix dimensions contradict its literal cells");
    erase(match.index! + match[1]!.length, match.index! + match[0].length);
  }
  const typePattern = new RegExp(`\\b(${TYPE})\\s+matrix\\s+(${NAME})\\b`, "gi");
  for (const match of text.matchAll(typePattern)) {
    const matrix = source.matrices.get(match[2]!);
    const type = typeId(match[1]!);
    const prefix = text.slice(0, match.index!).trim().split(/[.;?]/).at(-1) ?? "";
    if (!matrix || /\b(?:is|whether)\b/i.test(prefix)) fail("Interrogative source type clauses require supported explicit question syntax");
    if (!matrix.matrixArray.types.includes(type as typeof matrix.matrixArray.types[number])) fail("Source matrix type contradicts its literal cells");
    const declared = source.declaredTypes!.get(match[2]!) ?? new Set<string>();
    declared.add(type);
    source.declaredTypes!.set(match[2]!, declared);
    erase(match.index!, match.index! + match[0].length);
  }
  const declaredType = new RegExp(`\\b(${NAME})\\s+is\\s+(?:an?\\s+)?(${TYPE})(?:\\s+matrix)?(?!\\s+or\\b)`, "gi");
  for (const match of text.matchAll(declaredType)) {
    const matrix = source.matrices.get(match[1]!);
    const type = typeId(match[2]!);
    const tail = text.slice(match.index! + match[0].length).trim();
    if (!matrix) fail("Source type clause refers to an unknown matrix");
    if (!tail.startsWith("?")) {
      if (!matrix.matrixArray.types.includes(type as typeof matrix.matrixArray.types[number])) fail("Source matrix type contradicts its literal cells");
      const declared = source.declaredTypes!.get(match[1]!) ?? new Set<string>();
      declared.add(type);
      source.declaredTypes!.set(match[1]!, declared);
    }
    erase(match.index!, match.index! + match[0].length);
  }
  const predicate = new RegExp(`\\b(is|whether)\\s+(?:the\\s+)?(?:matrix\\s+)?(${NAME})\\s+(?:an?\\s+)?(${TYPE})(?:\\s+matrix)?(?:\\s+or\\s+(?:an?\\s+)?(?:${TYPE})(?:\\s+matrix)?)*`, "gi");
  for (const match of text.matchAll(predicate)) {
    if (!source.expressions.has(match[2]!)) fail("Source type question refers to an unknown matrix");
    const tail = text.slice(match.index! + match[0].length).trim();
    if (match[1]!.toLowerCase() === "is" && !tail.startsWith("?")) fail("Declarative source type clauses require an affirmative literal type witness");
    erase(match.index!, match.index! + match[0].length);
  }
  const proseOperation = new RegExp(`\\b(transpose|sum|product)\\s+of\\s+(${NAME})(?:\\s+and\\s+(${NAME}))?`, "gi");
  for (const match of text.matchAll(proseOperation)) {
    const a = source.expressions.get(match[2]!);
    const b = match[3] ? source.expressions.get(match[3]) : undefined;
    if (!a || (match[1]!.toLowerCase() !== "transpose" && !b) || match[1]!.toLowerCase() === "transpose" && b) fail("Source matrix operation has unsupported operands");
    source.requests.push({ operation: match[1]!.toLowerCase() === "transpose" ? "matrix_transpose" : match[1]!.toLowerCase() === "sum" ? "matrix_add" : "matrix_product", operands: b ? [a, b] : [a] });
    erase(match.index!, match.index! + match[0].length);
  }
  // Element requests such as a23, a_23 or a_{2,3} own one cell of a named
  // single-letter matrix. An index outside the literal order is a false premise.
  for (const [name, matrix] of source.matrices) {
    if (name.length !== 1 || source.expressions.has(name.toLowerCase()) && name.toLowerCase() !== name) continue;
    const element = new RegExp(`(?<![A-Za-z0-9_])${name.toLowerCase()}_?(?:\\{\\s*(\\d)\\s*,?\\s*(\\d)\\s*\\}|(\\d),?(\\d))(?![A-Za-z0-9_])`, "g");
    for (const match of text.matchAll(element)) {
      const row = Number(match[1] ?? match[3]);
      const column = Number(match[2] ?? match[4]);
      if (row < 1 || column < 1 || row > matrix.matrixArray.rows || column > matrix.matrixArray.columns) fail(`Requested element ${match[0]} lies outside the ${matrix.matrixArray.rows}x${matrix.matrixArray.columns} source matrix ${name}`);
      erase(match.index!, match.index! + match[0].length);
    }
  }
  const command = /\b(?:show|find|calculate|compute|determine|evaluate|write(?:\s+down)?|what\s+is)\s+(?:the\s+)?/gi;
  for (const match of text.matchAll(command)) {
    const parsed = parseExpression(text, match.index! + match[0].length, source);
    if (!parsed) continue;
    source.requests.push(parsed.expression);
    erase(match.index! + match[0].length, parsed.end);
    let end = parsed.end;
    let previous = parsed.expression;
    while (true) {
      const next = /^(?:\s*and\s+|\s*,\s*)/.exec(text.slice(end));
      if (!next) break;
      const start = end + next[0].length;
      const transpose = /^its\s+transpose\b/i.exec(text.slice(start));
      const requested = transpose
        ? { expression: { operation: "matrix_transpose", operands: [previous] } as Expression, end: start + transpose[0].length }
        : parseExpression(text, start, source);
      if (!requested) break;
      source.requests.push(requested.expression);
      erase(end, requested.end);
      previous = requested.expression;
      end = requested.end;
    }
  }
  const residual = text.replace(/[.,;:?!]/g, " ").trim();
  for (const word of residual.split(/\s+/).filter(Boolean)) {
    if (source.expressions.has(word) || source.scalars.has(word) || WORDS.has(word.toLowerCase())) continue;
    fail(`Unsupported or unowned matrix source obligation: ${word.slice(0, 64)}`);
  }
  if (source.expressions.size > 16 || source.requests.length > 16) fail("Source matrix expressions exceed16");
  return source;
}

function indexedSource(question: string): MatrixSource | null {
  const glyphs: Record<string, string> = { "": "=", "": "+", "": "*", "": "∈", "": "-" };
  const text = question.normalize("NFKC").replace(/[]/g, (glyph) => glyphs[glyph]!).replace(/[−–]/g, "-").replace(/[×·]/g, "*");
  const rule = new RegExp(String.raw`(${NAME})\s*=\s*\(\s*([A-Za-z][A-Za-z0-9]*)\s*\)\s*,\s*([A-Za-z])\s*,\s*([A-Za-z])\s*(?:∈|in)\s*\{\s*([0-9,\s]+)\}\s*,\s*(?:be|is)\s+(?:the\s+|a\s+)?([1-6])\s*\*\s*([1-6])\s+matrix\s+(?:such\s+that|where)\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*(${NUMBER})\s+if\s+([^,;]+?)\s+is\s+divisible\s+by\s+([^,;]+?)\s*[,;]\s*otherwise\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*(${NUMBER})\s*[.]`, "i");
  const match = rule.exec(text);
  if (!match) return null;
  const prefix = text.slice(0, match.index).trim();
  if (!/^(?:let|given|consider)(?:\s+the\s+matrix)?$/i.test(prefix)) fail("Indexed source premise cannot be conditional, quoted or negated");
  const [name, entry, rowVariable, columnVariable, domainText, rowCount, columnCount, repeatedEntry, yes, dividend, divisor, elseEntry, no] = match.slice(1) as string[];
  if (rowVariable === columnVariable || entry !== repeatedEntry || entry !== elseEntry || !entry!.endsWith(rowVariable! + columnVariable!)) fail("Indexed source row/column entry identities disagree");
  const domain = domainText!.split(",").map((value) => Number(value.trim()));
  if (domain.length !== Number(rowCount) || domain.length !== Number(columnCount) || domain.some((value, index) => value !== index + 1)) fail("Indexed source domains and dimensions must retain bounded one-based cell positions");
  const expression = (value: string) => {
    if (value.length > 128 || !/^[A-Za-z0-9+()\s-]+$/.test(value) || (value.match(/\d+/g) ?? []).some((number) => Number(number) > 1024)) fail("Indexed divisibility requires bounded integer affine expressions");
    const normalized = value.replace(/\b[A-Za-z]\b/g, (variable) => {
      if (variable === rowVariable) return "x";
      if (variable === columnVariable) return "y";
      return fail("Indexed source expression has an unbound variable");
    });
    return parseMathExpression2D(normalized, { juxtaposition: false });
  };
  const numerator = expression(dividend!);
  const denominator = expression(divisor!);
  const entries = domain.map((row) => domain.map((column) => {
    const a = numerator.evaluate(row, column);
    const b = denominator.evaluate(row, column);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b === 0) fail("Indexed source divisibility operands must be safe integers with nonzero divisor");
    return a % b === 0 ? yes! : no!;
  }));
  const tail = text.slice(match.index + match[0].length).trim();
  if (!tail.includes("?") || /\b(?:show|draw|calculate|compute|evaluate|find|determine)\b/i.test(tail)) fail("Unowned indexed source tasks cannot be hidden in a component representation");
  if (/\b(?:let|given|consider|define|suppose|assume|provided|supplied|instead|replace)\b/i.test(tail) || new RegExp(String.raw`\b${NAME}\s*=\s*(?:\[|\\begin\{(?:pmatrix|bmatrix|matrix|smallmatrix|array)\})`).test(tail)) fail("Unresolved source options cannot hide additional supplied or redefined matrix premises");
  for (const assignment of tail.matchAll(new RegExp(String.raw`\b(${NAME})\s*=\s*(${NUMBER})(?![\w.])`, "gi"))) {
    let depth = 0;
    for (const character of tail.slice(0, assignment.index)) {
      if (character === "{") depth++;
      if (character === "}") depth--;
    }
    if (depth <= 0) fail("Unresolved source options cannot hide additional scalar or matrix assignments outside an explicit set predicate");
  }
  return { matrices: new Map([[name!, literalGeometry(entries)]]), expressions: new Map([[name!, { name: name! }]]), scalars: new Map(), requests: [], entryPrefixes: new Map([[name!, entry!.slice(0, -2)]]), unresolved: question.slice(match.index + match[0].length), literals: new Map([[name!, entries]]) };
}

export function hasMatrixSourceProgram(question: string): boolean {
  try { parseSource(question); return true; }
  catch {
    try { return indexedSource(question) !== null; }
    catch { return false; }
  }
}

function cellRole(name: string, row: number, column: number, quantity: Record<string, unknown>, entryPrefix?: string): boolean {
  const roles = [`${name.toLowerCase()}${row + 1}${column + 1}`, `${name}${row + 1}${column + 1}`, `${name}_${row + 1}_${column + 1}`, `${name.toLowerCase()}_${row + 1}_${column + 1}`, `${name}_{${row + 1}${column + 1}}`];
  if (entryPrefix) roles.push(`${entryPrefix}${row + 1}${column + 1}`, `${entryPrefix}_${row + 1}_${column + 1}`, `${entryPrefix}_{${row + 1}${column + 1}}`);
  return roles.includes(String(quantity.id)) || typeof quantity.symbol === "string" && roles.includes(quantity.symbol);
}

export function validateMatrixSourceBinding(document: SceneDocument, authoritativeQuestion?: unknown, turnPlan?: unknown): SceneIssue[] {
  let captured: SceneDocument;
  let external: unknown;
  let plan: unknown;
  try { captured = snapshotMathSourceData(document); external = snapshotMathSourceData(authoritativeQuestion); plan = snapshotMathSourceData(turnPlan); }
  catch (error) { return [{ code: "matrix_source_input_unsupported", severity: "fatal", path: "source", message: error instanceof Error ? error.message : "Matrix source data cannot be captured" }]; }
  document = captured;
  const constructions = document.constructions.filter((construction) => OPERATORS.has(construction.operator));
  if (constructions.length === 0) {
    const sourceQuestion = external ?? document.source.question ?? (typeof plan === "object" && plan !== null && !Array.isArray(plan) ? (plan as Record<string, unknown>).question : undefined);
    if (document.visualDecision.mode !== "scene" || typeof sourceQuestion !== "string") return [];
    const syntax = sourceQuestion.normalize("NFKC").replace(//g, "=").replace(//g, "∈");
    // A matrix premise is named like a matrix (A, M, P1). A lowercase program
    // identifier such as points, grid, nums or edges = [[...]] is an array
    // input, not a matrix premise, and does not trip the guard.
    const namedPremise = new RegExp(String.raw`\b${MATRIX_NAME}\s*=\s*(?:\[\s*\[|\\begin\{(?:pmatrix|bmatrix|matrix|smallmatrix|array)\}|\(\s*${NAME}\s*\)\s*,\s*[A-Za-z]\s*,\s*[A-Za-z]\s*(?:∈|in)\s*\{)`).test(syntax);
    // The noun names a matrix whatever the identifier's case: "matrix a = [[..]]",
    // "the matrix m = ..", "let matrix b be [[..]]". A bare lowercase program
    // input (points, grid, edges = [[..]]) has no such noun and stays unguarded.
    const nounPremise = new RegExp(String.raw`\bmatri(?:x|ces)\s+${NAME}\s*(?:=|\bbe\b|\bis\b)\s*(?:\[\s*\[|\\begin\{(?:pmatrix|bmatrix|matrix|smallmatrix|array)\})`, "i").test(syntax);
    if (!namedPremise && !nounPremise && !hasMatrixSourceProgram(sourceQuestion)) return [];
    return [{ code: "matrix_source_missing_program", severity: "fatal", path: "constructions", message: "A source-owned matrix program cannot be replaced by generic diagram ink or omit every required source matrix" }];
  }
  const issue = (code: string, message: string, construction?: SceneConstruction): SceneIssue[] => [{ code, message, severity: "fatal", path: construction ? `constructions[${document.constructions.indexOf(construction)}].inputs` : "source.question", ...(construction ? { entityIds: construction.outputs } : {}) }];
  const stored = document.source.question;
  if (external !== undefined && typeof external !== "string") return issue("matrix_source_unsupported", "Authoritative matrix question must be a string");
  if (typeof external === "string" && stored !== undefined && stored !== external) return issue("matrix_source_question_mismatch", "Scene matrix question disagrees with the complete authoritative question");
  const planQuestion = typeof plan === "object" && plan !== null && !Array.isArray(plan) ? (plan as Record<string, unknown>).question : undefined;
  const question = external ?? stored ?? planQuestion;
  if (question === undefined && Object.keys(document.source).length === 0) return [];
  if (typeof question !== "string" || !question.trim()) return issue("matrix_source_unsupported", "Source-bearing matrices require a complete nonempty question");
  let source: MatrixSource;
  try { source = parseSource(question); }
  catch (error) {
    try {
      const indexed = indexedSource(question);
      if (!indexed) return issue("matrix_source_unsupported", error instanceof Error ? error.message : "Matrix source grammar is unsupported");
      source = indexed;
    } catch (indexedError) { return issue("matrix_source_unsupported", indexedError instanceof Error ? indexedError.message : "Indexed matrix source grammar is unsupported"); }
  }
  if (source.unresolved && (document.source.representationTier !== "question_representation" || document.source.nonMetric !== true)) return issue("matrix_source_partial_scope", "Only the indexed given matrix is source-proved; unresolved original options require an explicitly nonmetric question representation, never whole-question exact verification");
  if (document.constructions.some((construction) => !OPERATORS.has(construction.operator))) return issue("matrix_source_extra_geometry", "A complete matrix source program cannot certify unrelated candidate constructions");
  const sourceWitnesses = new Map(source.matrices);
  const witnessCache = new Map<Expression, MatrixArrayGeometry>();
  const witness = (expression: Expression): MatrixArrayGeometry => {
    if ("name" in expression) return source.matrices.get(expression.name) ?? fail("Source expression has no literal matrix witness");
    const cached = witnessCache.get(expression);
    if (cached) return cached;
    const inputs = expression.operation === "matrix_scale"
      ? { matrix: "operand0", scalar: expression.scalarLiteral }
      : expression.operation === "matrix_transpose"
        ? { matrix: "operand0" }
        : { left: "operand0", right: "operand1" };
    const result = evaluateMatrixArrayConstruction(expression.operation, { ...inputs, origin: [0, 0], displayScale: 1 }, {
      scalar() { return fail("Source expression cannot introduce unbound quantities"); },
      geometry(id) { return witness(expression.operands[id === "operand0" ? 0 : 1]!); },
    })[0]!;
    witnessCache.set(expression, result);
    return result;
  };
  try { for (const [name, expression] of source.expressions) sourceWitnesses.set(name, witness(expression)); }
  catch (error) { return issue("matrix_source_unsupported", error instanceof Error ? error.message : "Source matrix expression cannot be evaluated exactly"); }
  let planGivens: Record<string, unknown>[] = [];
  let planQuantities: Record<string, unknown>[] = [];
  if (plan !== undefined && plan !== null) {
    if (typeof plan !== "object" || Array.isArray(plan)) return issue("matrix_source_plan_unsupported", "Matrix source plan must retain an own-data plan record");
    const record = plan as Record<string, unknown>;
    if (record.question !== question || record.schemaVersion !== "turn-plan/v3" || !Array.isArray(record.givens) || !Array.isArray(record.derived)) return issue("matrix_source_plan_mismatch", "Matrix plan must retain the complete authoritative source question and quantity arrays");
    planGivens = record.givens as Record<string, unknown>[];
    planQuantities = [...planGivens, ...record.derived] as Record<string, unknown>[];
    for (const quantity of planQuantities) {
      if (typeof quantity !== "object" || quantity === null || Array.isArray(quantity) || typeof quantity.id !== "string") return issue("matrix_source_plan_unsupported", "Matrix plan quantities require own-data identities");
    }
  }
  const quantities = new Map<string, Record<string, unknown>>();
  for (const quantity of document.quantities) {
    if (quantities.has(quantity.id)) return issue("matrix_source_input_unsupported", "Matrix quantity identities must be unique");
    quantities.set(quantity.id, quantity);
  }
  try {
    for (const quantity of [...quantities.values(), ...planQuantities]) {
      const expected: string[] = [];
      let provenance = "given";
      for (const [name, matrix] of sourceWitnesses) {
        for (let row = 0; row < matrix.matrixArray.rows; row++) {
          for (let column = 0; column < matrix.matrixArray.columns; column++) {
            if (cellRole(name, row, column, quantity, source.entryPrefixes?.get(name))) {
              const entry = matrix.matrixArray.exactEntries[row]![column]!;
              expected.push(JSON.stringify([[entry]]));
              if (!source.matrices.has(name)) provenance = "derived";
            }
          }
        }
        for (const [role, value] of [[`rows${name}`, matrix.matrixArray.rows], [`cols${name}`, matrix.matrixArray.columns]] as const) {
          if (quantity.id === role || quantity.symbol === role) {
            expected.push(JSON.stringify(scalarGeometry(value).matrixArray.exactEntries));
            if (!source.matrices.has(name)) provenance = "derived";
          }
        }
      }
      for (const [name, value] of source.scalars) if (quantity.id === name || quantity.symbol === name) expected.push(JSON.stringify(scalarGeometry(value).matrixArray.exactEntries));
      if (expected.length === 0) {
        if (planGivens.includes(quantity) || quantity.provenance === "given") fail("Asserted given quantity has no source-role witness in the complete matrix question");
        continue;
      }
      if (expected.length > 1) fail("Quantity identity/symbol claims ambiguous source roles");
      // A planner may restate a source role it was asked for (a13 = 19) under
      // derived. Its value is recomputed exactly below, so an equal restatement
      // passes and a differing one still blocks; givens keep the quote rule.
      const plannerDerived = planQuantities.includes(quantity) && !planGivens.includes(quantity) && quantity.provenance === "derived";
      if (planQuantities.includes(quantity) && !plannerDerived && (quantity.provenance !== provenance || planGivens.includes(quantity) !== (provenance === "given") || typeof quantity.sourceText !== "string" || !quantity.sourceText.trim() || !question.includes(quantity.sourceText))) fail("Source-role plan quantities require the matching given/derived ownership and an actual unchanged source quote");
      const actual = evaluateMatrixArrayConstruction("matrix_array", { entries: [[{ value: quantity.value, unit: quantity.unit }]], origin: [0, 0], displayScale: 1 }, {
        scalar(ref) { const q = quantities.get(ref); if (!q) fail("Matrix quantity chain is missing"); return { value: q.value, unit: q.unit }; },
        geometry() { return undefined; },
      })[0]!;
      // A JSON plan cannot carry 1/3 exactly; its correctly rounded double is the
      // only number accepted for a repeating source fraction.
      const exact = JSON.parse(expected[0]!)[0][0] as { numerator: string; denominator: string };
      const repeatingDouble = typeof quantity.value === "number" && !terminates(exact.denominator) && quantity.value === matrixEntryDouble(exact);
      if (JSON.stringify(actual.matrixArray.exactEntries) !== expected[0] && !repeatingDouble) fail("Declared matrix cell, dimension or multiplier quantity contradicts its source role");
    }
  } catch (error) { return issue("matrix_source_quantity_mismatch", error instanceof Error ? error.message : "Matrix quantity role cannot be proved"); }
  const cache = new Map<string, { geometry: MatrixArrayGeometry; expression: Expression }>();
  const active = new Set<string>();
  let current: SceneConstruction | undefined;
  const identity = (construction: SceneConstruction): string | undefined => {
    const id = construction.outputs[0]!;
    const entity = document.entities.find((candidate) => candidate.id === id);
    const names = [id, entity?.label].filter((name): name is string => typeof name === "string" && source.expressions.has(name));
    if (new Set(names).size > 1) fail("Matrix output id and label claim different source identities");
    if (construction.operator === "matrix_array" && entity?.label !== undefined && entity.label !== names[0]) fail("Source literal matrix label must retain its named source identity");
    return names[0];
  };
  const evaluate = (id: string): { geometry: MatrixArrayGeometry; expression: Expression } => {
    if (cache.has(id)) return cache.get(id)!;
    if (active.has(id) || active.size >= 32) fail("Matrix source dependencies are cyclic or exceed depth32");
    const producers = constructions.filter((construction) => construction.outputs.includes(id));
    if (producers.length !== 1 || producers[0]!.outputs.length !== 1) fail("Matrix source operands need one named matrix producer");
    const construction = producers[0]!;
    current = construction;
    active.add(id);
    const name = identity(construction);
    let expression: Expression;
    if (construction.operator === "matrix_array") {
      if (!name || !source.matrices.has(name)) fail("Literal matrix output has no unambiguous source identity");
      const entries = construction.inputs.entries;
      if (!Array.isArray(entries)) fail("Source matrix entries are missing");
      const bindEntry = (value: unknown, row: number, column: number, seen = new Set<string>(), depth = 0): void => {
        if (depth > 32) fail("Matrix cell wrappers exceed depth32");
        if (typeof value === "object" && value !== null && !Array.isArray(value)) { bindEntry((value as Record<string, unknown>).value, row, column, seen, depth + 1); return; }
        if (typeof value !== "string" || LITERAL.test(value.trim())) return;
        if (seen.has(value)) fail("Matrix cell quantity references are cyclic");
        const quantity = quantities.get(value);
        if (!quantity || !cellRole(name!, row, column, quantity, source.entryPrefixes?.get(name!))) fail("Matrix quantity reference does not own this source matrix cell position");
        seen.add(value);
        bindEntry(quantity.value, row, column, seen, depth + 1);
      };
      entries.forEach((row, i) => { if (!Array.isArray(row)) fail("Source matrix rows are missing"); row.forEach((value, j) => bindEntry(value, i, j)); });
      expression = { name };
    } else {
      const operand = (key: string): Expression => {
        const value = construction.inputs[key];
        if (typeof value !== "string") fail("Source matrix operand must retain a named producer");
        return evaluate(value).expression;
      };
      if (construction.operator === "matrix_add" || construction.operator === "matrix_product") expression = { operation: construction.operator, operands: [operand("left"), operand("right")] };
      else if (construction.operator === "matrix_transpose") expression = { operation: construction.operator, operands: [operand("matrix")] };
      else {
        const bindScalar = (value: unknown, seen = new Set<string>(), depth = 0): void => {
          if (depth > 32) fail("Source scalar wrappers exceed depth32");
          if (typeof value === "object" && value !== null && !Array.isArray(value)) { bindScalar((value as Record<string, unknown>).value, seen, depth + 1); return; }
          if (typeof value !== "string" || LITERAL.test(value.trim())) return;
          const quantity = quantities.get(value);
          const role = source.scalars.has(value) ? value : typeof quantity?.symbol === "string" && source.scalars.has(quantity.symbol) ? quantity.symbol : undefined;
          if (!quantity || !role || seen.has(value)) fail("Scalar reference does not own a declared source multiplier");
          const actual = scalarGeometry({ value: quantity.value, unit: quantity.unit });
          if (!sameEntries(actual, scalarGeometry(source.scalars.get(role)))) fail("Scalar reference contradicts its source multiplier");
          seen.add(value);
          bindScalar(quantity.value, seen, depth + 1);
        };
        bindScalar(construction.inputs.scalar);
        const factor = evaluateMatrixArrayConstruction("matrix_array", { entries: [[construction.inputs.scalar]], origin: [0, 0], displayScale: 1 }, { scalar(ref) { const q = quantities.get(ref); if (!q) fail("Scalar quantity is missing"); return { value: q.value, unit: q.unit }; }, geometry() { return undefined; } })[0]!.matrixArray.exactEntries[0]![0]!;
        expression = { operation: "matrix_scale", scalar: `${factor.numerator}/${factor.denominator}`, operands: [operand("matrix")] };
      }
      const label = document.entities.find((entity) => entity.id === id)?.label;
      if (label !== undefined && !source.expressions.has(label)) {
        const parsed = parseExpression(label, 0, source);
        if (!parsed || parsed.end !== label.length || signature(parsed.expression) !== signature(expression)) fail("Matrix result label has no matching source expression identity");
      }
      const expected = name ? source.expressions.get(name) : undefined;
      // An unnamed result must be a requested expression or one of its own
      // operand steps; (A+B)^T needs A+B on the way, never an unrelated BA.
      if (expected ? signature(expected) !== signature(expression) : !source.requests.some((request) => containsExpression(request, signature(expression)))) fail("Matrix operation, operand order, scalar or transpose disagrees with the requested source expression");
    }
    const geometry = evaluateMatrixArrayConstruction(construction.operator, construction.inputs, {
      scalar(ref) { const q = quantities.get(ref); if (!q) fail("Matrix source quantity is missing"); return { value: q.value, unit: q.unit }; },
      geometry(ref) { return evaluate(ref).geometry; },
    })[0]!;
    if (construction.operator === "matrix_array" && !sameEntries(geometry, source.matrices.get(name!)!)) fail("Matrix dimensions or exact cell values disagree with the named source matrix");
    const declared = name ? source.declaredTypes?.get(name) : undefined;
    if (declared && construction.inputs.claimedType !== undefined) {
      const claimed = construction.inputs.claimedType;
      const implied = typeof claimed !== "string" ? [] : IMPLIED_TYPES[claimed] ?? [claimed];
      if ([...declared].some((type) => !implied.includes(type))) fail("Matrix candidate omits or weakens a declared source type obligation");
    }
    const result = { geometry, expression };
    active.delete(id);
    cache.set(id, result);
    return result;
  };
  try {
    for (const construction of constructions) { current = construction; evaluate(construction.outputs[0]!); }
    const actual = [...cache.values()].map((value) => signature(value.expression));
    for (const name of source.matrices.keys()) if (!actual.includes(signature({ name }))) fail("Scene omits a declared source matrix witness");
    for (const request of source.requests) if (!actual.includes(signature(request))) fail("Scene omits a requested source matrix operation");
    if (plan !== undefined && plan !== null) {
      const claims = (plan as Record<string, unknown>).qualitativeClaims;
      if (!Array.isArray(claims)) fail("Source matrix plan requires a qualitative claim array");
      const predicate = new RegExp(`^(${NAME}) is (?:an? )?(${TYPE}|skew_symmetric|upper_triangular|lower_triangular)(?: matrix)?(?: with (\\d+) rows and (\\d+) columns)?$`, "i");
      for (const claim of claims) {
        if (typeof claim !== "object" || claim === null || typeof claim.claim !== "string") fail("Matrix plan qualitative claims require own-data text");
        const match = predicate.exec(claim.claim.trim());
        if (!match) continue;
        const matrix = sourceWitnesses.get(match[1]!);
        if (!matrix) fail("Matrix plan type claim has no source matrix identity");
        const type = typeId(match[2]!);
        const actual = matrix.matrixArray.types.includes(type as typeof matrix.matrixArray.types[number]) && (match[3] === undefined || matrix.matrixArray.rows === Number(match[3]) && matrix.matrixArray.columns === Number(match[4]));
        if (claim.expected !== actual) fail("Matrix plan type or dimension claim contradicts the actual source tuple");
      }
    }
    return source.unresolved ? [{ code: "matrix_source_component_only", severity: "warning", path: "source.question", entityIds: [...source.matrices.keys()], message: "The indexed given matrix and its cell roles are source-verified; all original subsequent options remain present and unverified by this question representation" }] : [];
  } catch (error) { return issue("matrix_source_mismatch", error instanceof Error ? error.message : "Matrix source binding cannot be proved", current); }
}

function terminates(denominator: string): boolean {
  let d = BigInt(denominator);
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  return d === 1n;
}

function containsExpression(expression: Expression, wanted: string): boolean {
  return signature(expression) === wanted || !("name" in expression) && expression.operands.some((operand) => containsExpression(operand, wanted));
}

function expressionText(expression: Expression, context: "sum" | "product" | "atom" = "sum"): string {
  if ("name" in expression) return expression.name;
  const [left, right] = expression.operands;
  let text: string;
  if (expression.operation === "matrix_transpose") text = `${expressionText(left!, "atom")}^T`;
  // A named multiplier keeps its source name (kA). A bare number beside a
  // matrix name would read as a quantity with a unit (2A as two amperes), so
  // a literal multiplier is written with a product dot (2·A).
  else if (expression.operation === "matrix_scale") text = expression.scalarName ? `${expression.scalarName}${expressionText(left!, "atom")}` : `${(expression.scalarLiteral ?? "").replace(/\.$/, "")}·${expressionText(left!, "atom")}`;
  else if (expression.operation === "matrix_product") {
    const a = expressionText(left!, "product");
    const b = expressionText(right!, "atom");
    text = "name" in left! && "name" in right! && a.length === 1 && b.length === 1 ? `${a}${b}` : `${a}*${b}`;
  } else text = `${expressionText(left!, "sum")}+${expressionText(right!, "product")}`;
  const binds = expression.operation === "matrix_add" ? 0 : expression.operation === "matrix_product" ? 1 : 2;
  const needs = context === "atom" ? 2 : context === "product" ? 1 : 0;
  return binds < needs ? `(${text})` : text;
}

/**
 * Draw a complete matrix source program from the question alone. Every source
 * literal keeps its exact source spelling, every requested expression keeps its
 * operand order, and the result must pass the same source binding a planner
 * candidate faces. Anything the binding cannot prove returns null, never a
 * partial table.
 */
export function buildMatrixSourceDocument(question: string, turnPlan?: unknown): SceneDocument | null {
  let source: MatrixSource;
  try { source = parseSource(question); }
  catch {
    // An indexed rule premise (native M = (aij)) is drawn as its source-proved
    // component only, in an explicitly nonmetric question representation.
    try { const indexed = indexedSource(question); if (!indexed) return null; source = indexed; }
    catch { return null; }
  }
  if (!source.literals) return null;
  const entities: SceneDocument["entities"] = [];
  const constructions: SceneConstruction[] = [];
  const revealGroups: SceneDocument["revealGroups"] = [];
  const built = new Map<string, string>();
  const namedExpression = new Map([...source.expressions].filter(([name]) => !source.matrices.has(name)).map(([name, expression]) => [signature(expression), name]));
  let unnamed = 0;
  const place = (id: string, label: string, operator: string, inputs: Record<string, unknown>, role: string): string => {
    entities.push({ id, kind: "matrix_array", label, role });
    constructions.push({ id: `make_${id}`, operator, inputs: { ...inputs, origin: [0, 0], displayScale: 1 }, outputs: [id] });
    revealGroups.push({ id: `show_${id}`, entityIds: [id], dependsOn: revealGroups.length > 0 ? [revealGroups.at(-1)!.id] : [], narrationCue: `matrix ${label}` });
    return id;
  };
  const build = (expression: Expression): string => {
    const key = signature(expression);
    const existing = built.get(key);
    if (existing) return existing;
    let id: string;
    if ("name" in expression) {
      const literal = source.literals!.get(expression.name);
      if (!literal) throw new Error("named source expression has no literal witness");
      id = place(expression.name, expression.name, "matrix_array", { entries: literal.map((row) => [...row]) }, `source matrix ${expression.name}`);
    } else {
      const operands = expression.operands.map(build);
      const name = namedExpression.get(key);
      const inputs = expression.operation === "matrix_scale" ? { matrix: operands[0], scalar: expression.scalarLiteral }
        : expression.operation === "matrix_transpose" ? { matrix: operands[0] }
          : { left: operands[0], right: operands[1] };
      const label = name ?? expressionText(expression);
      let resultId = name;
      while (resultId === undefined || !name && source.expressions.has(resultId)) resultId = `R${++unnamed}`;
      id = place(resultId, label, expression.operation, inputs, name ? `source expression ${name}` : `requested ${label}`);
    }
    built.set(key, id);
    return id;
  };
  try {
    for (const name of source.matrices.keys()) build({ name });
    for (const expression of source.expressions.values()) build(expression);
    for (const request of source.requests) build(request);
  } catch { return null; }
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "The question supplies a complete named matrix source program" },
    source: { question, representationTier: source.unresolved ? "question_representation" : "qualitative_verified", nonMetric: true },
    quantities: [], entities, constructions, relations: [], assertions: [], annotations: [],
    requiredEntityIds: entities.map((entity) => entity.id), revealGroups, teachingTimeline: [],
  };
  return validateMatrixSourceBinding(document, question, turnPlan).some((issue) => issue.severity === "fatal") ? null : document;
}
