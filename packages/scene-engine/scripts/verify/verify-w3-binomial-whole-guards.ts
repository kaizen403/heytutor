import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ExpressionNodeIR, ProblemIR, SceneDocument, TurnPlanV3 } from "../../src/index";
import type { StoredTurn } from "../../../../apps/tutor/lib/boards/boardsClient";
import { liveSceneSaveFailure } from "../../../../apps/tutor/lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../../../apps/tutor/lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../../../apps/tutor/lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../../../apps/tutor/features/tutor-session/lib/scene/restoreVerifiedDiagram";

// Use fixtures/w3-binomial-whole-guards/gate.tsconfig.json: its app package
// aliases point explicitly at this tree's built public bundles in both modes.
// No DB, provider, browser or network calls.
const esm = process.argv.includes("--esm");
const engine: typeof import("../../src/index") = esm
  ? await import(new URL("../../dist/index.js", import.meta.url).href) : await import("../../src/index");
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/w3-binomial-whole-guards/${name}.json`, import.meta.url), "utf8"));
const records: Array<{ name: string; actual: unknown; expected: unknown; passed: boolean }> = [];
const inputs: Array<{ name: string; input: unknown; document: unknown }> = [];
function equal(name: string, actual: unknown, expected: unknown): void {
  let passed = true;
  try { assert.deepEqual(actual, expected); } catch { passed = false; }
  records.push({ name, actual, expected, passed });
}
const num = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const x = (): ExpressionNodeIR => ({ kind: "variable", name: "x" });
const bin = (operator: "+" | "-" | "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
const pow = (root: ExpressionNodeIR, n: number) => bin("^", root, num(n));
interface Case { question: string; problem: ProblemIR; plan: TurnPlanV3 }
function authored(question: string, expression: string, request: string, root: ExpressionNodeIR, k: number, numerator: number, denominator = 1): Case {
  const evidence = (quote: string) => { const start = question.indexOf(quote); return { source: "question" as const, start, end: start + quote.length, quote }; };
  const value = numerator / denominator;
  return { question, problem: {
    schemaVersion: "problem-ir/v1", id: "own_polynomial", question,
    facts: [{ id: "premise", kind: "given", statement: expression, evidence: evidence(expression) }, { id: "requested", kind: "requested", statement: request, evidence: evidence(request) }],
    entities: [{ id: "polynomial", kind: "other", label: "P(x)", evidenceFactIds: ["premise"] }],
    expressions: [{ id: "source", valueType: "function", root, evidenceFactIds: ["premise"] }, { id: "coefficient", valueType: "scalar", root: denominator === 1 ? num(numerator) : bin("/", num(numerator), num(denominator)), evidenceFactIds: ["requested"] }],
    constraints: [], representationIntents: [{ id: "scope", kind: "conceptual", entityIds: ["polynomial"], evidenceFactIds: ["premise", "requested"] }],
    solveRequests: [{ id: "actual_request", kind: "evaluate", expressionId: "coefficient", resultBinding: { turnPlanQuantityId: "actual_answer", symbol: `C_${k}`, unit: "1", evidenceFactIds: ["requested"] } }],
  }, plan: { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [{ id: "actual_answer", symbol: `C_${k}`, unit: "1" }], derived: [{ id: "actual_answer", symbol: `C_${k}`, unit: "1", value, provenance: "derived" }], qualitativeClaims: [], assumptions: [], lawIds: [], visualRequirement: "required" } };
}
function choose(n: number, k: number): number {
  if (k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = result * (n - i + 1) / i;
  return result;
}
async function seams(c: Case, document: SceneDocument) {
  const authority = { question: c.question, problemIR: c.problem, turnPlan: c.plan };
  const structural = engine.validateSceneDocument(document, { sourceAuthority: authority });
  const compiled = engine.compileSceneDocument(document, { sourceAuthority: authority });
  const solver = engine.solveFiniteBinomialProblem(c.question, c.problem);
  const artifacts = { schemaVersion: "scene-artifacts/v3", turnPlan: c.plan, problemIR: c.problem, solverResult: solver,
    solverAuthority: solver ? engine.verifyTurnPlanAgainstSolver(c.problem, solver, c.plan, c.question) : null,
    representationTier: "exact_verified", nonMetric: true, candidates: [], selectedCandidateId: null, selectionReason: "offline whole-input test", diagramResultStatus: "ready", proofObligations: [] };
  const turn: StoredTurn = { id: "offline", question: c.question, rawResponse: "", orderIndex: 0, speedMultiplier: 2, traceId: null, segments: [], sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated", sceneEngineVersion: null, validationReport: null };
  const saved = await canonicalizeTurnSceneMetadata({ question: c.question, sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated", segments: [] });
  const restored = restoreVerifiedPresentationFromTurn(JSON.parse(JSON.stringify(turn)));
  return { structural: !!structural.document && structural.report.valid, compile: compiled.ok, rendered: compiled.renderScene !== null,
    source: engine.validateSceneSourceAuthority(document, c.question, c.problem, c.plan).length === 0,
    live: liveSceneSaveFailure({ document, question: c.question, problemIR: c.problem, turnPlan: c.plan, tier: "exact_verified" }) === null,
    save: saved.ok, read: sourceCheckedStoredTurn(JSON.parse(JSON.stringify(turn))).visualStatus, restore: !!restored };
}
const accepted = { structural: true, compile: true, rendered: true, source: true, live: true, save: true, read: "validated", restore: true };
const rejected = { structural: false, compile: false, rendered: false, source: false, live: false, save: false, read: "retry_required", restore: false };
function early(name: string, c: Case, expectedCounts: number[], assumptions: string[] = [], claims = 0) {
  for (const full of [false, true]) {
    const actual = engine.applyFiniteBinomialAuthority(c.question, c.plan, full ? c.problem : undefined);
    equal(`${name} ${full ? "whole IR" : "question"} early rows`, actual ? [actual.plan.givens.length, actual.plan.derived.length, actual.plan.unknowns.length, actual.plan.qualitativeClaims.length] : null, [...expectedCounts, claims]);
    equal(`${name} ${full ? "whole IR" : "question"} early assumptions`, actual?.plan.assumptions, assumptions);
    if (full) equal(`${name} whole IR figure decision after withdrawal`, actual?.declineFigure, expectedCounts[1] === 0);
  }
}
const controls = fixture("coefficient-controls") as Array<{ name: string; expression: string; exponent: number; numerator: number; denominator: number; a?: number; b?: number; n?: number }>;
const roots = [pow(bin("-", num(3), bin("*", num(2), x())), 5), pow(bin("+", num(2), x()), 6), pow(bin("+", num(1), x()), 7), pow(bin("+", bin("/", num(1), num(2)), bin("/", x(), num(4))), 4), pow(bin("-", num(2), x()), 2)];
const cases: Array<{ name: string; c: Case }> = controls.map((row, i) => {
  const request = `Coefficient of x^${row.exponent} in the expansion of`, question = `${request} ${row.expression} is`;
  const independent = row.a === undefined ? choose(4, 2) * (1 / 2) ** 2 * (1 / 4) ** 2 : row.exponent > row.n! ? 0 : choose(row.n!, row.exponent) * row.a ** (row.n! - row.exponent) * row.b! ** row.exponent;
  equal(`${row.name} independent selection oracle`, independent, row.numerator / row.denominator);
  return { name: row.name, c: authored(question, row.expression, request, roots[i]!, row.exponent, row.numerator, row.denominator) };
});
const native = JSON.parse(readFileSync(new URL("./w3-binomial/native2014P2Q43.json", import.meta.url), "utf8"));
equal("preserved native raw hash", createHash("sha256").update(native.question_options_and_source_answer_verbatim).digest("hex"), native.verbatim_question_block_sha256);
let nativeAnswer = 0;
for (let a = 0; a <= 4; a++) for (let b = 0; b <= 7; b++) for (let d = 0; d <= 12; d++) if (2 * a + 3 * b + 4 * d === 11) nativeAnswer += choose(4, a) * choose(7, b) * choose(12, d);
equal("native independent factor selection", nativeAnswer, 1113);
cases.push({ name: "native-1113", c: authored(native.question_options_and_source_answer_verbatim, "(1 + 𝑥𝑥 2 )4 (1 + 𝑥𝑥 3 )7 (1 + 𝑥𝑥 4 )12", "Coefficient of 𝑥𝑥 11 in the expansion of", bin("*", bin("*", pow(bin("+", num(1), pow(x(), 2)), 4), pow(bin("+", num(1), pow(x(), 3)), 7)), pow(bin("+", num(1), pow(x(), 4)), 12)), 11, 1113) });
for (const { name, c } of cases) {
  const before = JSON.stringify(c), document = engine.finiteBinomialSourceDocument(c.question, c.problem);
  inputs.push({ name, input: c, document });
  equal(`${name} source document`, !!document, true);
  equal(`${name} source solver`, engine.solveFiniteBinomialProblem(c.question, c.problem)?.values[0]?.approximate, c.plan.derived[0]!.value);
  if (!document) continue;
  equal(`${name} all existing actual-Plan seams`, await seams(c, document), accepted);
  const compiled = engine.compileSceneDocument(document, { sourceAuthority: { question: c.question, problemIR: c.problem, turnPlan: c.plan } });
  const oracle = controls.find(row => row.name === name);
  const coefficientText = oracle && oracle.denominator !== 1 ? `${oracle.numerator}/${oracle.denominator}` : String(c.plan.derived[0]!.value);
  equal(`${name} selected rendered coefficient`, compiled.renderScene?.primitives.filter(p => p.provenance?.selected).map(p => p.text), [`[${coefficientText}]`]);
  early(name, c, [0, 1, 1]);
  for (const key of ["coefficient_positive", "coefficient_negative", "coefficient_zero"]) {
    const good = structuredClone(c), value = c.plan.derived[0]!.value;
    good.plan.qualitativeClaims = [{ id: "source_sign", claim: key, expected: key === "coefficient_positive" ? value > 0 : key === "coefficient_negative" ? value < 0 : value === 0, relatedQuantityIds: ["actual_answer"] }];
    equal(`${name} proved ${key} seams`, await seams(good, document), accepted);
    early(`${name} proved ${key}`, good, [0, 1, 1], [], 1);
    good.plan.qualitativeClaims[0]!.expected = !good.plan.qualitativeClaims[0]!.expected;
    equal(`${name} contradictory ${key}`, await seams(good, document), rejected);
    early(`${name} contradictory ${key}`, good, [0, 1, 1]);
  }
  const finite = structuredClone(c); finite.plan.assumptions = ["Finite algebraic expansion."];
  equal(`${name} source proved finite algebra`, await seams(finite, document), accepted);
  early(`${name} source proved finite algebra`, finite, [0, 1, 1], finite.plan.assumptions);
  const badAssumption = structuredClone(c); badAssumption.plan.assumptions = ["Every coefficient of this polynomial is negative."];
  equal(`${name} unsupported assumption`, await seams(badAssumption, document), rejected);
  early(`${name} unsupported assumption`, badAssumption, [0, 1, 1]);
  const uncertain = structuredClone(c); uncertain.plan.derived[0]!.uncertainty = 5;
  equal(`${name} uncertainty 5`, await seams(uncertain, document), rejected);
  early(`${name} uncertainty 5`, uncertain, [0, 0, 0]);
  const exact = structuredClone(c); exact.plan.derived[0]!.uncertainty = 0;
  equal(`${name} exact certainty zero`, await seams(exact, document), accepted);
  equal(`${name} immutable actual caller`, JSON.stringify(c), before);
}
const review = fixture("review-inputs") as { r3: Array<{ mutation: string; input: Case }>; r4: Array<{ mutation: string; input: Case }> };
for (const row of review.r3) {
  const c = row.input, before = JSON.stringify(c), document = engine.finiteBinomialSourceDocument(c.question, c.problem);
  inputs.push({ name: row.mutation, input: c, document });
  equal(`${row.mutation} actual regenerated admission`, engine.admitFiniteBinomialProblem(c.question, c.problem).status, "declined");
  equal(`${row.mutation} actual source document`, document, null);
  equal(`${row.mutation} actual source solver`, engine.solveFiniteBinomialProblem(c.question, c.problem), null);
  // Audit the old generated bad candidate too: reconstruct its original shape
  // from a fresh good document, retaining the complete mutated caller graph.
  const clean = structuredClone(c.problem);
  function remove(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(remove); return; }
    const object = value as Record<string, unknown>; delete object.extraObligations; Object.values(object).forEach(remove);
  }
  remove(clean); const candidate = engine.finiteBinomialSourceDocument(c.question, clean)!;
  candidate.source.problemIR = structuredClone(c.problem); candidate.constructions[0]!.inputs.problemIR = structuredClone(c.problem);
  equal(`${row.mutation} regenerated bad candidate seams`, await seams(c, candidate), rejected);
  const withdrawn = engine.applyFiniteBinomialAuthority(c.question, c.plan, c.problem);
  equal(`${row.mutation} full-IR withdrawal`, withdrawn ? [withdrawn.plan.derived.length, withdrawn.plan.unknowns.length, withdrawn.plan.qualitativeClaims.length, withdrawn.declineFigure] : null, [0, 0, 0, true]);
  equal(`${row.mutation} caller preserved`, JSON.stringify(c), before);
}
for (const row of review.r4) {
  const c = row.input, document = engine.finiteBinomialSourceDocument(c.question, c.problem)!;
  inputs.push({ name: row.mutation, input: c, document });
  equal(`${row.mutation} actual Plan issues`, engine.finiteBinomialPlanIssues(c.question, c.problem, c.plan).some(i => i.severity === "fatal"), true);
  equal(`${row.mutation} actual Plan lifecycle`, await seams(c, document), rejected);
  early(row.mutation, c, row.mutation === "uncertain-derived" ? [0, 0, 0] : [0, 1, 1]);
}
// Descendant leaves, expression wrapper and second fact/evidence prove that
// recursion covers more than the original seven first/root positions.
const base = cases[1]!.c;
const mutations: Array<[string, (p: ProblemIR) => object]> = [
  ["expression-wrapper", p => p.expressions[0]!], ["scalar-root", p => p.expressions[1]!.root],
  ["AST-number-child", p => (p.expressions[0]!.root as Extract<ExpressionNodeIR, { kind: "binary" }>).right],
  ["AST-variable-descendant", p => ((p.expressions[0]!.root as Extract<ExpressionNodeIR, { kind: "binary" }>).left as Extract<ExpressionNodeIR, { kind: "binary" }>).right],
  ["second-fact", p => p.facts[1]!], ["second-evidence", p => p.facts[1]!.evidence],
];
for (const [name, target] of mutations) {
  const c = structuredClone(base); Object.assign(target(c.problem), { extraObligations: ["Prove another coefficient"] });
  equal(`${name} recursive admission`, engine.admitFiniteBinomialProblem(c.question, c.problem).status, "declined");
  equal(`${name} recursive document`, engine.finiteBinomialSourceDocument(c.question, c.problem), null);
}
const unaryQuestion = "Coefficient of x^2 in the expansion of (+2+x)^6 is";
const unary = authored(unaryQuestion, "(+2+x)^6", "Coefficient of x^2 in the expansion of", pow(bin("+", { kind: "unary", operator: "+", operand: num(2) }, x()), 6), 2, 240);
equal("unary source control", engine.admitFiniteBinomialProblem(unary.question, unary.problem).status, "ok");
for (const depth of ["unary", "operand"]) {
  const c = structuredClone(unary);
  const node = ((c.problem.expressions[0]!.root as Extract<ExpressionNodeIR, { kind: "binary" }>).left as Extract<ExpressionNodeIR, { kind: "binary" }>).left as Extract<ExpressionNodeIR, { kind: "unary" }>;
  Object.assign(depth === "unary" ? node : node.operand, { hiddenSemanticRequest: "Prove all coefficients negative" });
  equal(`${depth} recursive unknown field`, engine.admitFiniteBinomialProblem(c.question, c.problem).status, "declined");
}
const legacyRequestField = structuredClone(base);
Object.assign(legacyRequestField.problem.solveRequests[0]!, { domain: { min: 0, max: 1 } });
equal("unused request-kind field", engine.admitFiniteBinomialProblem(base.question, legacyRequestField.problem).status, "declined");
for (const kind of ["unsupported-false-claim", "unbound-sign-claim", "hidden-claim-field", "compound-finite-assumption", "uncertain-given"]) {
  const c = structuredClone(base);
  if (kind === "compound-finite-assumption") c.plan.assumptions = ["Finite algebraic expansion. Every coefficient is negative."];
  else if (kind === "uncertain-given") c.plan.givens = [{ id: "n", symbol: "n", value: 6, unit: "1", provenance: "given", uncertainty: 5 }];
  else c.plan.qualitativeClaims = [{ id: "sign", claim: kind === "unsupported-false-claim" ? "all_coefficients_negative" : "coefficient_positive", expected: kind !== "unsupported-false-claim", ...(kind === "unbound-sign-claim" ? {} : { relatedQuantityIds: ["actual_answer"] }), ...(kind === "hidden-claim-field" ? { extraObligations: ["Prove all signs"] } : {}) }];
  equal(`${kind} guard`, engine.finiteBinomialPlanIssues(c.question, c.problem, c.plan).some(i => i.severity === "fatal"), true);
  equal(`${kind} seams`, await seams(c, engine.finiteBinomialSourceDocument(c.question, c.problem)!), rejected);
  early(kind, c, [0, 1, 1]);
}
const artifact = process.argv.find(a => a.startsWith("--artifact="))?.slice("--artifact=".length);
if (artifact) {
  mkdirSync(artifact, { recursive: true });
  writeFileSync(`${artifact}/${esm ? "esm" : "source"}.json`, JSON.stringify({ records, inputs }, null, 2));
}
const failures = records.filter(r => !r.passed);
console.log(JSON.stringify({ mode: esm ? "public ESM" : "source", checks: records.length, failures: failures.length, failed: failures }, null, 2));
if (failures.length) process.exitCode = 1;
