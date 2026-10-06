import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ExactPolynomialRational } from "../../src/math/finitePolynomialExpansion";
import { expressionToSafeSource, validateProblemIR, type ExpressionNodeIR, type ProblemIR } from "../../src/ir/problemIR";
import { LocalDeterministicSolverProvider, validateSolverResult } from "../../src/ir/solver";
import { evaluateMathExpression } from "../../src/math/expression";
import { evaluateCombinatoricsConstruction } from "../../src/compile/combinatoricsGeometry";
import type { FiniteBinomialAuthority } from "../../src/compile/binomialExpansionGeometry";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument, SceneIssue } from "../../src/types";

const esm = process.argv.includes("--esm");
const kernel: typeof import("../../src/math/finitePolynomialExpansion") = esm
  ? await import(new URL("../../dist/w3-binomial/math/finitePolynomialExpansion.js", import.meta.url).href) : await import("../../src/math/finitePolynomialExpansion");
const program: typeof import("../../src/ir/finiteBinomialProgram") = esm
  ? await import(new URL("../../dist/w3-binomial/ir/finiteBinomialProgram.js", import.meta.url).href) : await import("../../src/ir/finiteBinomialProgram");
const geometryAPI: typeof import("../../src/compile/binomialExpansionGeometry") = esm
  ? await import(new URL("../../dist/w3-binomial/compile/binomialExpansionGeometry.js", import.meta.url).href) : await import("../../src/compile/binomialExpansionGeometry");
const { expandFinitePolynomial, exactPolynomialText, finitePolynomialCoefficient, parseFinitePolynomialExpression } = kernel;
const { admitFiniteBinomialProblem, finiteBinomialSourceDocument, readFiniteBinomialProgram, solveFiniteBinomialProblem, validateFiniteBinomialQuantities, validateFiniteBinomialSourceDocument } = program;
const { evaluateFiniteBinomialConstruction, finiteBinomialGeometryValue, finiteBinomialPrimitives, validateFiniteBinomialConstruction } = geometryAPI;

let checks = 0;
function check(condition: unknown, message: string): asserts condition { assert(condition, message); checks++; }
function equal(actual: unknown, expected: unknown, message: string): void { assert.deepEqual(actual, expected, message); checks++; }
function throws(action: () => unknown, message: string): void { assert.throws(action, message); checks++; }
const number = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const x: ExpressionNodeIR = { kind: "variable", name: "x" };
const bin = (operator: "+" | "-" | "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
const pow = (left: ExpressionNodeIR, exponent: number) => bin("^", left, number(exponent));
const rational = (n: number, d = 1): ExactPolynomialRational => ({ numerator: String(n), denominator: String(d) });
const resultAST = (value: ExactPolynomialRational) => value.denominator === "1" ? number(Number(value.numerator)) : bin("/", number(Number(value.numerator)), number(Number(value.denominator)));

/** Authored full-IR profile, not a captured live planner output. All six arrays retained. */
function problemFor(question: string, root: ExpressionNodeIR, expected?: ExactPolynomialRational): ProblemIR {
  const reading = readFiniteBinomialProgram(question);
  check(reading.status === "ok", `source admitted: ${question}`);
  const source = reading.source;
  const evidence = (quote: string) => { const start = question.indexOf(quote); return { source: "question" as const, quote, start, end: start + quote.length }; };
  return {
    schemaVersion: "problem-ir/v1", id: "full_polynomial_problem", question,
    facts: [
      { id: "stated_polynomial", kind: "given", statement: "The complete stated polynomial", evidence: evidence(source.expressionSource) },
      { id: "asked_output", kind: "requested", statement: "The complete requested expansion/coefficient role", evidence: evidence(source.requestSource) },
    ],
    entities: [{ id: "polynomial", kind: "other", label: "P(x)", evidenceFactIds: ["stated_polynomial"] }],
    expressions: [
      { id: "source_expression", valueType: "function", root, evidenceFactIds: ["stated_polynomial"] },
      ...(expected ? [{ id: "coefficient_expression", valueType: "scalar" as const, root: resultAST(expected), evidenceFactIds: ["asked_output"] }] : []),
    ],
    constraints: [], representationIntents: [{ id: "expansion_table", kind: "conceptual", entityIds: ["polynomial"], evidenceFactIds: ["stated_polynomial", "asked_output"] }],
    solveRequests: expected ? [{ id: "actual_coefficient_ask", kind: "evaluate", expressionId: "coefficient_expression", resultBinding: { turnPlanQuantityId: "actual_quantity_id", symbol: "c", unit: "1", evidenceFactIds: ["asked_output"] } }] : [],
  };
}

const cases = [
  { id: "authored-pascal", question: "Expand (1+x)^4.", root: pow(bin("+", number(1), x), 4), coefficients: ["1", "4", "6", "4", "1"] },
  { id: "authored-signed", question: "Coefficient of x^2 in the expansion of (2-3x)^4 is", root: pow(bin("-", number(2), bin("*", number(3), x)), 4), coefficients: ["16", "-96", "216", "-216", "81"], expected: rational(216) },
  { id: "authored-rational", question: "Expand (1/2+x/3)^3.", root: pow(bin("+", bin("/", number(1), number(2)), bin("/", x, number(3))), 3), coefficients: ["1/8", "1/4", "1/6", "1/27"] },
  { id: "authored-composite", question: "Coefficient of x^3 in the expansion of (1+x)^2(1-x)^3 is", root: bin("*", pow(bin("+", number(1), x), 2), pow(bin("-", number(1), x), 3)), coefficients: ["1", "-1", "-2", "2", "1", "-1"], expected: rational(2) },
];
const provider = new LocalDeterministicSolverProvider();
for (const item of cases) {
  const problem = problemFor(item.question, item.root, item.expected);
  check(validateProblemIR(problem, item.question).valid, `${item.id} original ProblemIR API`);
  equal(expandFinitePolynomial(item.root).terms.map(term => exactPolynomialText(term.coefficient)), item.coefficients, `${item.id} independent hand-expanded coefficients`);
  const admission = admitFiniteBinomialProblem(item.question, problem);
  check(admission.status === "ok", `${item.id} complete source/fullIR admission`);
  if (admission.status === "ok") equal(admission.problem, problem, "retained actual graph without reduced replacement");
  const document = finiteBinomialSourceDocument(item.question, problem);
  check(document, `${item.id} complete candidate`);
  equal(document.source.problemIR, problem, "full IR carried intact");
  equal(validateFiniteBinomialSourceDocument(document, item.question, problem), [], "independently recomputed document proof");
  const sourceAuthority: FiniteBinomialAuthority = { question: item.question, problemIR: problem };
  const construction = document.constructions[0]!;
  const geometries = evaluateFiniteBinomialConstruction(construction.operator, construction.inputs, sourceAuthority);
  equal(geometries.length, document.requiredEntityIds.length, "all source and output marks required");
  const issues: SceneIssue[] = [];
  validateFiniteBinomialConstruction(construction, 0, document, issues, sourceAuthority);
  equal(issues, [], "compiler-compatible validator API");
  const primitives = geometries.flatMap((geometry, i) => {
    const id = construction.outputs[i]!, group = document.revealGroups.find(group => group.entityIds.includes(id))!;
    return finiteBinomialPrimitives(geometry, id, group.id, sourceAuthority);
  });
  check(document.requiredEntityIds.every(id => primitives.some(mark => mark.entityId === id)), "complete source-owned ink");
  check(primitives.every(mark => mark.kind === "label" && mark.provenance?.nonmetric === true), "honest nonmetric table, no fake count topology/curve");
  const restored = JSON.parse(JSON.stringify(document)) as SceneDocument;
  equal(validateFiniteBinomialSourceDocument(restored, item.question, JSON.parse(JSON.stringify(problem))), [], "JSON save/read/restore source proof");
  const reordered = JSON.parse(JSON.stringify(restored, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value));
  equal(validateFiniteBinomialSourceDocument(reordered, item.question, problem), [], "JSONB-style key order has no authority effect");
  const result = solveFiniteBinomialProblem(item.question, problem);
  check(result && validateSolverResult(result, problem).valid, "original SolverResult API");
  const local = await provider.solve(problem);
  equal(local.status, "solved", "original solver agrees on retained closed result expressions");
  equal(local.values.map(v => v.approximate), result!.values.map(v => v.approximate), "independent existing solver cross-check");
  if (item.expected) {
    equal(document.quantities[0]!.id, "actual_quantity_id", "actual typed TurnPlan quantityID join");
    equal(geometries.map(g => finiteBinomialGeometryValue(g, sourceAuthority)).filter(v => v !== null), [Number(item.expected.numerator)], "selected source scalar output only");
  }
  for (const at of [-2, -1, 0, 1, 2]) {
    const coefficientValues = item.coefficients.map(value => { const [n, d = "1"] = value.split("/"); return Number(n) / Number(d); });
    const expanded = coefficientValues.reduce((sum, c, degree) => sum + c * at ** degree, 0);
    const existing = evaluateMathExpression(expressionToSafeSource(item.root, "x"), at);
    check(Math.abs(expanded - existing) < 1e-10 * Math.max(1, Math.abs(existing)), "existing expression parser independent substitution control");
  }
  console.log(`${item.id}: complete source/fullIR, exact oracle, normalized nonmetric ink, solver and JSON controls PASS`);
}

const native = JSON.parse(readFileSync(new URL("./w3-binomial/native2014P2Q43.json", import.meta.url), "utf8"));
const rawNative = native.question_options_and_source_answer_verbatim as string;
equal(createHash("sha256").update(rawNative).digest("hex"), native.verbatim_question_block_sha256, "native raw/OCR source block hash unchanged");
const nativeRoot = bin("*", bin("*", pow(bin("+", number(1), pow(x, 2)), 4), pow(bin("+", number(1), pow(x, 3)), 7)), pow(bin("+", number(1), pow(x, 4)), 12));
// Independent enumeration: 2a+3b+4c=11; exactly four admissible triples.
function choose(n: number, k: number): number {
  const factorial = (v: number) => { let result = 1; for (let i = 1; i <= v; i++) result *= i; return result; };
  return factorial(n) / factorial(k) / factorial(n - k);
}
const contributions: number[] = [];
for (let a = 0; a <= 4; a++) for (let b = 0; b <= 7; b++) for (let c = 0; c <= 12; c++) if (2 * a + 3 * b + 4 * c === 11) contributions.push(choose(4, a) * choose(7, b) * choose(12, c));
equal(contributions.sort((a, b) => a - b), [7, 140, 462, 504], "native independent factorial/triple oracle");
equal(contributions.reduce((a, b) => a + b), 1113, "native oracle1113 independently derived");
const nativeProblem = problemFor(rawNative, nativeRoot, rational(1113));
const nativeDocument = finiteBinomialSourceDocument(rawNative, nativeProblem);
check(nativeDocument, "native raw text full source-bound document");
equal(nativeDocument.source.question, rawNative, "raw native is never replaced by authored transcription");
const nativeAdmission = admitFiniteBinomialProblem(rawNative, nativeProblem);
check(nativeAdmission.status === "ok", "native fullIR source admission");
equal(readFiniteBinomialProgram(rawNative).status, "ok", "glyph-based OCR dialect parsed independently of ID");
const nativeResult = solveFiniteBinomialProblem(rawNative, nativeProblem);
check(nativeResult && validateSolverResult(nativeResult, nativeProblem).valid, "native original SolverResult validation");
equal(nativeResult!.values[0]!.exact, { kind: "integer", value: "1113" }, "native exact source convolution result");
equal((await provider.solve(nativeProblem)).values[0]!.approximate, 1113, "existing solver on complete retained IR");
const nativeAuthority = { question: rawNative, problemIR: nativeProblem };
const nativeConstruction = nativeDocument.constructions[0]!;
const nativeGeometry = evaluateFiniteBinomialConstruction(nativeConstruction.operator, nativeConstruction.inputs, nativeAuthority);
const nativeInk = nativeGeometry.flatMap((g, i) => finiteBinomialPrimitives(g, nativeConstruction.outputs[i]!, i ? "polynomial_coefficients" : "polynomial_source", nativeAuthority));
equal(nativeInk.filter(mark => mark.provenance?.selected).map(mark => mark.text), ["[1113]"], "native selected exponent11 exact mark");
equal(nativeGeometry.length, 13, "native full source header and all exponent0..11 rows");
equal(validateFiniteBinomialSourceDocument(JSON.parse(JSON.stringify(nativeDocument)), rawNative, JSON.parse(JSON.stringify(nativeProblem))), [], "native JSON source proof");
const incorrectKey = rawNative.replace("Answer (C)", "Answer (A)");
equal(solveFiniteBinomialProblem(incorrectKey, problemFor(incorrectKey, nativeRoot, rational(1113)))!.values[0]!.approximate, 1113, "source answer key is not authority");
console.log("native2014P2Q43: preserved raw/OCR + SHA256; independent contributions 7+140+462+504=1113; fullIR/solver/table/JSON PASS");

// Existing subset topology is an independent identity only, never expansion geometry.
for (let n = 0; n <= 4; n++) {
  const geometry = evaluateCombinatoricsConstruction("subset_lattice", { items: Array.from({ length: n }, (_, i) => `a${i}`), displayScale: 1 }, { number: v => Number(v), point: () => { throw new Error("unused"); }, geometry: () => { throw new Error("unused"); } });
  const counts = geometry[0]!.combinatoricsGraph;
  check(counts.kind === "subset_lattice", "existing lattice kind");
  if (counts.kind === "subset_lattice") equal(expandFinitePolynomial(pow(bin("+", number(1), x), n)).terms.map(term => Number(term.coefficient.numerator)), counts.rankCounts, "subset-rank identity independently agrees");
}
for (let n = 0; n <= 8; n++) {
  const counts = Array.from({ length: n + 1 }, () => 0);
  for (let mask = 0; mask < 2 ** n; mask++) counts[mask.toString(2).replace(/0/g, "").length]!++;
  equal(expandFinitePolynomial(pow(bin("+", number(1), x), n)).terms.map(term => Number(term.coefficient.numerator)), counts, "independent subset enumeration small-n oracle");
}
for (const [question, root, expected] of [
  ["Coefficient of x^3 in the expansion of (1+x^2)^0 is", pow(bin("+", number(1), pow(x, 2)), 0), rational(0)],
  ["Coefficient of x^0 in the expansion of (1-x)^0 is", pow(bin("-", number(1), x), 0), rational(1)],
] as const) check(solveFiniteBinomialProblem(question, problemFor(question, root, expected)), "zero exponent and absent coefficient controls");
equal(expandFinitePolynomial(parseFinitePolynomialExpression("(1+x)^2-(1+2x+x^2)")).terms, [{ exponent: 0, coefficient: rational(0) }], "exact cancellation");
equal(exactPolynomialText(finitePolynomialCoefficient(expandFinitePolynomial(parseFinitePolynomialExpression("(0.1+x)^2")), 1)), "1/5", "exact decimal coefficient");
equal(expandFinitePolynomial(parseFinitePolynomialExpression("(1+x)^64")).degree, 64, "kernel bounded power64 admitted");
equal(expandFinitePolynomial(parseFinitePolynomialExpression("x^64*x^64")).degree, 128, "kernel degree128 admitted");

const badSources = ["Expand (1+x)^-1.", "Expand (1+x)^0.5.", "Expand (1+x)^65.", "Expand x^64*x^64*x.", "Expand 1/(1-x).", "Expand (1+x)^n.", "Expand (1+y)^2.", "Expand sin(x).", "Expand (1+x", "Expand (1+x)^4 then add a hidden point.", "Coefficient of x^-2 in the expansion of (1+x)^4 is", "Coefficient of 2x^2 in the expansion of (1+x)^4 is", "Coefficient of x^16 in the expansion of (1+x)^4 is", "Expand (1+x)^16.", "Expand (1+x)^4 + 1e-999.", "Expand (1+x)^4 + 0.100000000000000001.", "Coefficient of x^2 in the expansion of (1+x)^4 is (A) 6 (B) 7 (C) 8 (D) 9 hidden clause", "Expand ((1+x)^-1)^0.", "Expand (1+x)^(1/2).", "Expand 0/0."];
for (const source of badSources) equal(readFiniteBinomialProgram(source).status, "declined", `fail closed source: ${source}`);
throws(() => finitePolynomialCoefficient(expandFinitePolynomial(number(1)), -1), "negative coefficient index rejected");
throws(() => finitePolynomialCoefficient(expandFinitePolynomial(number(1)), 129), "out-of-capacity coefficient index rejected");
throws(() => expandFinitePolynomial(pow(bin("+", number(1e12), x), 64)), "exact bit budget bounded");

const reference = problemFor(cases[1]!.question, cases[1]!.root, cases[1]!.expected);
const question = reference.question;
function rejectIR(name: string, mutate: (p: ProblemIR) => void): void {
  const problem = structuredClone(reference); mutate(problem);
  equal(admitFiniteBinomialProblem(question, problem).status, "declined", name);
  equal(finiteBinomialSourceDocument(question, problem), null, `${name}: atomic no candidate`);
  equal(solveFiniteBinomialProblem(question, problem), null, `${name}: no solver authority`);
}
rejectIR("missing actual quantity binding", p => { delete p.solveRequests[0]!.resultBinding; });
rejectIR("missing coefficient unit", p => { delete p.solveRequests[0]!.resultBinding!.unit; });
rejectIR("wrong physical unit", p => { p.solveRequests[0]!.resultBinding!.unit = "m"; });
rejectIR("missing source role", p => { p.expressions.shift(); });
rejectIR("missing requested role", p => { p.facts[1]!.kind = "given"; });
rejectIR("wrong AST sameanswer", p => { p.expressions[0]!.root = bin("+", p.expressions[0]!.root, x); });
rejectIR("wrong AST same polynomial", p => { p.expressions[0]!.root = bin("+", p.expressions[0]!.root, number(0)); });
rejectIR("wrong closed result", p => { p.expressions[1]!.root = number(215); });
rejectIR("hidden point entity", p => { p.entities.push({ id: "hidden_point", kind: "point", evidenceFactIds: ["stated_polynomial"] }); });
rejectIR("hidden expression", p => { p.expressions.push({ id: "hidden_scalar", valueType: "scalar", root: number(216), evidenceFactIds: ["asked_output"] }); });
rejectIR("hidden extra numeric ask", p => { p.solveRequests.push({ id: "extra_ask", kind: "evaluate", expressionId: "coefficient_expression", resultBinding: { ...p.solveRequests[0]!.resultBinding!, turnPlanQuantityId: "other_quantity" } }); });
rejectIR("unknown equation branch explicit gap", p => { p.constraints.push({ id: "uncovered_equation", kind: "equation", leftExpressionId: "source_expression", rightExpressionId: "coefficient_expression", evidenceFactIds: ["stated_polynomial"] }); });
rejectIR("unknown intent", p => { p.representationIntents[0]!.kind = "graph"; });
rejectIR("source span drift", p => { p.facts[0]!.evidence.start++; });
rejectIR("entity label forgery", p => { p.entities[0]!.label = "c=999"; });
rejectIR("binding symbol carries forged number", p => { p.solveRequests[0]!.resultBinding!.symbol = "c=999"; });
rejectIR("coefficient result with hidden variable", p => { p.expressions[1]!.root = bin("+", number(216), bin("-", x, x)); });
const changedId = structuredClone(reference); changedId.solveRequests[0]!.resultBinding!.turnPlanQuantityId = "parent_actual_id";
equal(finiteBinomialSourceDocument(question, changedId)!.quantities[0]!.id, "parent_actual_id", "binding does not infer quantityID from request or symbol");

const document = finiteBinomialSourceDocument(question, reference)!;
function rejectDocument(name: string, mutate: (d: SceneDocument) => void): void {
  const candidate = structuredClone(document); mutate(candidate);
  check(validateFiniteBinomialSourceDocument(candidate, question, reference).some(issue => issue.severity === "fatal"), name);
}
rejectDocument("missing output mark", d => { d.entities.pop(); });
rejectDocument("hidden ink entity", d => { d.entities.push({ id: "forged_point", kind: "point", role: "hidden" }); });
rejectDocument("unrequired result row", d => { d.requiredEntityIds.pop(); });
rejectDocument("numeric annotation forgery", d => { d.annotations.push({ id: "forged_label", kind: "label", targetIds: ["polynomial"], text: "216 m" }); });
rejectDocument("source-owned reveal tamper", d => { d.revealGroups[0]!.entityIds.push("polynomial_power_2"); });
rejectDocument("quantity unit mutation", d => { d.quantities[0]!.unit = "m"; });
rejectDocument("quantity exact mutation", d => { d.quantities[0]!.exact = rational(215); });
rejectDocument("quantityID substitution", d => { d.quantities[0]!.id = "surrogate"; });
rejectDocument("forged metadata flag", d => { d.source.authorityVerified = true; });
rejectDocument("reduced replacement IR", d => { (d.source.problemIR as ProblemIR).representationIntents = []; });
rejectDocument("omitted construction output", d => { d.constructions[0]!.outputs.pop(); });
rejectDocument("cyclic payload fails closed", d => { d.source.cycle = d; });
const badQuantities = structuredClone(document.quantities); badQuantities[0]!.value = 215;
check(validateFiniteBinomialQuantities(question, reference, badQuantities).some(issue => issue.severity === "fatal"), "callable quantity proof rejects stale plan scalar");
equal(validateFiniteBinomialQuantities(question, reference, [] ).length, 1, "quantity proof requires all requested quantities");
const authority = { question, problemIR: reference }, construction = document.constructions[0]!;
const geometries = evaluateFiniteBinomialConstruction(construction.operator, construction.inputs, authority);
throws(() => evaluateFiniteBinomialConstruction(construction.operator, { ...construction.inputs, coefficients: [216] }, authority), "model-authored coefficients refused");
throws(() => evaluateFiniteBinomialConstruction(construction.operator, construction.inputs, { question: "Expand (1+x)^4.", problemIR: reference }), "different caller source refused");
throws(() => finiteBinomialPrimitives({ ...geometries[0]!, kind: "finite_polynomial_source", expression: "x", scope: "metric", answer: "999" }, "polynomial", "polynomial_source", authority), "forged restored geometry refused");
throws(() => finiteBinomialPrimitives(geometries[1]!, "polynomial_power_2", "polynomial_coefficients", authority), "sameanswer wrong row owner refused");
throws(() => finiteBinomialPrimitives(geometries[1]!, "polynomial_power_0", "polynomial_source", authority), "wrong reveal group refused");
throws(() => finiteBinomialGeometryValue({ kind: "finite_polynomial_term", index: 2, selected: true, term: { exponent: 2, coefficient: rational(215) } }, authority), "forged physical output refused");
const invalid = structuredClone(document); invalid.constructions[0]!.outputs.pop();
const issues: SceneIssue[] = [];
validateFiniteBinomialConstruction(invalid.constructions[0]!, 0, invalid, issues, authority);
check(issues.some(issue => issue.severity === "fatal"), "validator catches incomplete output atomically");

// Historical unwired evidence remains in the worker log. Reviewed engine
// contract now requires the actual caller source, and complete normal ink.
for (const [candidate, sourceAuthority] of [[document, authority], [nativeDocument, nativeAuthority]] as const) {
  const compiled = compileSceneDocument(candidate, {sourceAuthority});
  equal(compiled.ok, true, "source-authorized real compiler accepts reviewed finite contract");
  check(compiled.renderScene && candidate.requiredEntityIds.every(id => compiled.renderScene!.primitives.some(p => p.entityId === id)), "every required source mark renders through normal compiler");
}
console.log(`Wave3 finite binomial foundations verified (${esm ? "built ESM" : "source"}): ${checks} checks; 4 authored core cases + preserved native2014P2Q43; READY=0 countdelta=0 (live/save/reopen acceptance pending)`);
