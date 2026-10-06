import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { finiteProgressionSourceProgram, finiteProgressionSourceTablePrimitives, validateFiniteProgressionSourceDocument, type ProgressionTablePlacement } from "../../src/ir/finiteProgressionSourceProgram";
import { readFiniteProgressionSource } from "../../src/math/finiteProgressionSource";
import { evaluateIndexedProgressionConstruction, indexedProgressionPrimitives } from "../../src/compile/indexedProgressionGeometry";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import { validateProblemIR, type ProblemIR, type ExpressionNodeIR } from "../../src/ir/problemIR";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { SceneDocument } from "../../src/types";

interface Case {
  id: string; classification: string; question: string; problem: ProblemIR; plan: TurnPlanV3;
  expected: number[]; kind: "arithmetic" | "geometric"; first: number; parameter: number | null; cumulativeFirst: number | null;
}
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/w3-progression-source/authored-cases.json", import.meta.url), "utf8")) as { cases: Case[] };
// At the foundation pin these Plans omitted resolved derived roles. The normal
// engine requires complete V3 Plans; the authored caller supplies its frozen
// expected values under the same unknown IDs, just as the actual planner does.
for (const c of fixtures.cases) c.plan.derived = c.plan.unknowns.map((quantity, i) => ({...quantity, value: c.expected[i]!, provenance: "derived"}));
const placement: ProgressionTablePlacement = { origin: [0, 0], displayScale: 1 };
let checks = 0;
function check(value: unknown, message: string): asserts value { checks++; if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void { check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`); }
const clone = <T>(value: T): T => structuredClone(value);
const n = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const bin = (operator: "+" | "-" | "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
function rejectsSource(question: string, message: string): void { check(readFiniteProgressionSource(question).status === "declined", message); }
function rejectsIR(c: Case, mutate: (ir: ProblemIR, plan: TurnPlanV3) => void, message: string): void {
  const ir = clone(c.problem), plan = clone(c.plan); mutate(ir, plan);
  check(finiteProgressionSourceProgram(c.question, ir, plan, placement).status === "declined", message);
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  return value;
}

const sharedGaps = new Set<string>();
for (const c of fixtures.cases) {
  check(c.classification.startsWith("authored"), "readable fixtures are never relabeled native");
  check(validateProblemIR(c.problem, c.question).valid, `${c.id} full actual IR is typed`);
  const result = finiteProgressionSourceProgram(c.question, c.problem, c.plan, placement);
  check(result.status === "ok", `${c.id}: ${result.status === "declined" ? result.reason : ""}`);
  equal(result.problem, c.problem, "retain all submitted entities/facts/expressions/constraints/intents/requests");
  equal(result.plan, c.plan, "retain actual plan rather than a private projection");
  equal(result.bindings.map((binding) => binding.ask.value), c.expected, `${c.id} independent frozen expectations`);
  if (c.parameter !== null) {
    // Independent direct recurrence, with no production formulas/operator/CRT.
    let a = BigInt(c.first), t = BigInt(c.cumulativeFirst ?? 0), sum = 0n;
    const terms: bigint[] = [], sums: bigint[] = [];
    for (let i = 1; i <= 64; i++) {
      const value = c.cumulativeFirst === null ? a : t;
      terms.push(value); sum += value; sums.push(sum);
      t += a;
      a = c.kind === "arithmetic" ? a + BigInt(c.parameter) : a * BigInt(c.parameter);
    }
    result.bindings.forEach(({ ask }) => {
      const expected = ask.index === 0 ? 0n : (ask.kind === "term" ? terms : sums)[ask.index - 1]!;
      check(BigInt(ask.exact.numerator) === expected * BigInt(ask.exact.denominator), "direct recurrence/aggregation oracle");
    });
  } else {
    result.bindings.forEach(({ ask }) => check(ask.value * ask.value === 2 * 8, "independent signed geometric mean product identity"));
  }
  const solver = await new LocalDeterministicSolverProvider().solve(c.problem);
  check(solver.status === "solved", `${c.id} actual standard solver solved admitted AST`);
  solver.values.forEach((value, i) => check(typeof value.approximate === "number" && Math.abs(value.approximate - c.expected[i]!) < 1e-9, "standard solver independently evaluates audited AST"));
  check(result.bindings.every((binding) => c.plan.unknowns.some((quantity) => quantity.id === binding.quantityId && quantity.symbol === binding.symbol && quantity.unit === binding.unit)), "actual plan IDs/symbols/units, no invented bindings");
  check(result.document.requiredEntityIds.every((id) => result.document.revealGroups.some((group) => group.entityIds.includes(id))), "every required result is revealed");
  result.bindings.forEach((binding, i) => {
    const entity = result.document.entities.find((entity) => entity.id === `result_${i}`)!;
    check(entity.provenance?.quantityId === binding.quantityId && result.document.quantities.some((quantity) => quantity.id === binding.quantityId && quantity.unit === binding.unit && quantity.value === binding.ask.value), "every result label has actual numeric quantity authority");
  });
  const construction = result.document.constructions[0]!;
  const geometry = evaluateIndexedProgressionConstruction(construction.operator, construction.inputs, { scalar() { throw new Error("source must not use planner scalars"); } })[0]!;
  const primitives = indexedProgressionPrimitives(geometry, "progression", "terms");
  const named = finiteProgressionSourceTablePrimitives(result.document, c.question, c.problem, c.plan, placement);
  check(named.filter((primitive) => primitive.text?.endsWith("_n")).every((primitive) => primitive.text === "a_n"), "table preserves source sequence a_n; native difference sequence must not be mislabeled T_n");
  if (!result.source.cumulative) result.bindings.filter(({ ask }) => ask.kind === "term").forEach(({ ask, quantityId, unit }) => {
    check(named.some((primitive) => primitive.id === `progression_${ask.branch}_value_${ask.index}` && primitive.provenance?.quantityId === quantityId && primitive.provenance?.unit === unit), "requested indexed value ink has its actual plan quantity ID and unit");
  });
  check(primitives.every((primitive) => ["label", "point"].includes(primitive.kind) && primitive.provenance?.nonmetric === true), "delegated output is nonmetric with no continuous curve");
  check(geometry.indexedProgression.solutions.every((solution) => solution.terms.every((term) => primitives.some((primitive) => primitive.provenance?.index === term.index))), "all declared indexed terms/branches survive delegated rendering");
  equal(validateFiniteProgressionSourceDocument(result.document, c.question, c.problem, c.plan, placement), [], "same source proof callable before compile/live/save");
  const restored = JSON.parse(JSON.stringify(result.document)) as SceneDocument;
  equal(validateFiniteProgressionSourceDocument(restored, c.question, c.problem, c.plan, placement), [], "same source proof callable on JSON read/restore");
  equal(validateFiniteProgressionSourceDocument(reverseKeys(restored) as SceneDocument, c.question, c.problem, c.plan, placement), [], "JSONB key order has no authority");
  for (const mutate of [
    (d: SceneDocument) => { d.requiredEntityIds.pop(); },
    (d: SceneDocument) => { d.revealGroups[1]!.entityIds.pop(); },
    (d: SceneDocument) => { d.teachingTimeline.pop(); },
    (d: SceneDocument) => { d.entities.find((entity) => entity.id === "result_0")!.label = "forged=999"; },
    (d: SceneDocument) => { d.constructions[0]!.inputs.kind = d.constructions[0]!.inputs.kind === "geometric" ? "arithmetic" : "geometric"; },
    (d: SceneDocument) => { d.quantities.at(-1)!.unit = "m"; },
    (d: SceneDocument) => { d.source.problemIR = { schemaVersion: "problem-ir/v1" }; },
    (d: SceneDocument) => { d.annotations.push({ id: "forgery", kind: "callout", targetIds: ["progression"], text: "T=999" }); },
    (d: SceneDocument) => { d.entities.push({ id: "fakeCurve", kind: "polyline", role: "continuous interpolation" }); },
    (d: SceneDocument) => { d.constructions[0]!.inputs.first = "99"; },
  ]) { const changed = clone(restored); mutate(changed); check(validateFiniteProgressionSourceDocument(changed, c.question, c.problem, c.plan, placement).length > 0, "atomic source proof rejects persisted payload mutation"); }
  const compiled = compileSceneDocument(result.document, {sourceAuthority: {question: c.question, problemIR: c.problem, turnPlan: c.plan}});
  if (!compiled.ok) compiled.report.issues.forEach((issue) => sharedGaps.add(issue.code));
  check(compiled.ok && compiled.renderScene, `normal progression compiler failed: ${compiled.report.issues.map(issue => issue.code)}`);
  check(compiled.renderScene!.primitives.every((primitive) => primitive.kind === "point" || primitive.kind === "label"), "parent wired discrete path emits no continuum");
  console.log(`${c.id}: ${result.bindings.map(({ ask }) => `${ask.symbol}=${ask.value}`).join("; ")}`);
}

const base = fixtures.cases[0]!;
const broadRequest = clone(base.problem);
const requestStart = base.question.indexOf("Find ");
for (const fact of broadRequest.facts.filter((fact) => fact.kind === "requested")) fact.evidence = { source: "question", start: requestStart, end: base.question.length, quote: base.question.slice(requestStart) };
check(finiteProgressionSourceProgram(base.question, broadRequest, base.plan, placement).status === "ok", "actual IR may preserve complete requested sentence evidence");
const nativeCase = fixtures.cases[3]!;
rejectsIR(nativeCase, (ir) => { ir.entities[1]!.evidenceFactIds = ["modelFact"]; }, "cumulative entity cannot borrow the AP source role");
rejectsIR(nativeCase, (ir) => { ir.expressions.find((expression) => expression.id === "actualRecurrenceDifference")!.root = bin("-", { kind: "variable", name: "T_n" }, { kind: "variable", name: "T_next" }); }, "recurrence orientation is source authority");
rejectsIR(nativeCase, (ir) => { const domain = ir.constraints.find((constraint) => constraint.id === "actualDomainConstraint")!; if (domain.kind === "inequality") domain.relation = ">"; }, "strict domain change cannot replace source n>=1");
rejectsIR(nativeCase, (ir) => { const at = ir.constraints.findIndex((constraint) => constraint.id === "actualDomainConstraint"); const domain = ir.constraints[at]!; if (domain.kind === "inequality") ir.constraints[at] = { id: domain.id, kind: "equation", leftExpressionId: domain.leftExpressionId, rightExpressionId: domain.rightExpressionId, evidenceFactIds: domain.evidenceFactIds }; }, "source n>=1 is not equality n=1");
for (const [index, falseOption] of [[0, 1604], [3, 35610]] as const) rejectsIR(nativeCase, (_ir, plan) => {
  plan.derived[index]!.value = falseOption;
}, "false native option cannot become scalar authority");
for (const [mutate, message] of [
  [(ir: ProblemIR) => { ir.expressions[0]!.root = n(3); }, "same-answer constant is not source term AST"],
  [(ir: ProblemIR) => { ir.expressions[0]!.root = bin("+", n(2), n(1)); }, "same-answer unrelated arithmetic is not source AST"],
  [(ir: ProblemIR) => { ir.expressions[1]!.root = clone(ir.expressions[0]!.root); }, "role-swapped requested AST"],
  [(ir: ProblemIR) => { ir.solveRequests.pop(); }, "omitted solve ask"],
  [(ir: ProblemIR) => { ir.entities.push({ id: "extraBody", kind: "body", evidenceFactIds: ["modelFact"] }); }, "extra actual body cannot be projected away"],
  [(ir: ProblemIR) => { ir.representationIntents[0]!.kind = "graph"; }, "false continuum intent"],
  [(ir: ProblemIR) => { ir.constraints[0]!.kind = "inequality" as "equation"; }, "unsupported actual constraint"],
  [(ir: ProblemIR) => { ir.expressions.push({ id: "unrelated", valueType: "scalar", root: n(42), evidenceFactIds: ["modelFact"] }); }, "extra actual expression"],
  [(ir: ProblemIR) => { ir.facts[0]!.evidence.quote = "common difference 99"; }, "forged source quote"],
  [(ir: ProblemIR) => { ir.facts[0]!.evidence.start++; }, "source offsets do not address quote"],
  [(ir: ProblemIR) => { ir.facts[0]!.kind = "assumption"; }, "model assumption is not a source given"],
  [(ir: ProblemIR) => { ir.solveRequests[0]!.resultBinding!.turnPlanQuantityId = "inventedId"; }, "invented plan binding"],
  [(ir: ProblemIR) => { ir.solveRequests[0]!.resultBinding!.unit = "m"; }, "binding dimensional mismatch"],
  [(ir: ProblemIR) => { ir.solveRequests[0]!.resultBinding!.symbol = "other"; }, "binding symbol mismatch"],
  [(_ir: ProblemIR, plan: TurnPlanV3) => { plan.derived[0]!.value = 999; }, "stale numeric authority"],
  [(_ir: ProblemIR, plan: TurnPlanV3) => { plan.givens[0]!.value = 99; }, "stale source coefficient"],
  [(_ir: ProblemIR, plan: TurnPlanV3) => { plan.unknowns.push({ id: "extra", symbol: "x", unit: "1" }); }, "omitted actual plan unknown"],
  [(_ir: ProblemIR, plan: TurnPlanV3) => { plan.givens[1]!.sourceText = "a_1 = 3"; }, "source coefficient role swap"],
] as Array<[(ir: ProblemIR, plan: TurnPlanV3) => void, string]>) rejectsIR(base, mutate, message);

for (const question of [
  base.question + " Draw a continuous curve.", base.question.replace("a_2", "a_2.5"), base.question.replace("a_2", "a_65"),
  base.question.replace("a_2", "a_0"), base.question.replace("3 and", "sqrt(3) and"), base.question.replace("difference -2", "ratio -2"),
  "Let a_n be a geometric progression. Find a_4.", "Let a_n be an geometric progression with a_1 = 2 and common ratio -1. Find sum_{k=1}^infinity a_k.",
  "Insert 1 geometric means between 2 and 3, using all_real ratio branches. Find a_2[positive], a_2[negative].",
  "Insert 1 geometric means between 2 and 8, using all_real ratio branches. Find a_2[positive].",
  "Recover geometric progression a_n from a_1 = 2 and a_3 = 8. Find a_2.",
]) rejectsSource(question, "unsupported/noninteger/irrational/missing/sign/continuum source declines");

const observed = readFiniteProgressionSource("Recover geometric progression a_n from a_1 = 2 and a_3 = 8 and a_2 = -4, using all_real ratio branches. Find a_1, a_2, a_3.");
check(observed.status === "ok", "exact existing recovery contract accepts real signed observation filtering");
equal(observed.source.asks.map((ask) => ask.value), [2, -4, 8], "independent recovered signed terms");
equal(observed.source.geometry.indexedProgression.observations.map((observation) => observation.index).sort(), [1, 2, 3], "every observation retained");
const recoveryQuestion = observed.source.question;
const recoveryIR = clone(base.problem), recoveryPlan = clone(base.plan);
recoveryIR.question = recoveryPlan.question = recoveryQuestion;
recoveryPlan.givens = []; recoveryPlan.unknowns = recoveryPlan.unknowns.slice(0, 3);
recoveryPlan.derived = recoveryPlan.unknowns.map((quantity, i) => ({...quantity, value: [2, -4, 8][i]!, provenance: "derived"}));
recoveryIR.facts = recoveryIR.facts.slice(0, 4);
const modelEnd = recoveryQuestion.indexOf(" Find ");
recoveryIR.facts[0]!.evidence = { source: "question", start: 0, end: modelEnd, quote: recoveryQuestion.slice(0, modelEnd) };
const recoveredParameter: ExpressionNodeIR = { kind: "unary", operator: "-", operand: bin("^", { kind: "unary", operator: "-", operand: bin("/", n(-4), n(2)) }, bin("/", n(1), n(1))) };
recoveryIR.expressions = recoveryIR.expressions.slice(0, 3);
recoveryIR.constraints = []; recoveryIR.solveRequests = recoveryIR.solveRequests.slice(0, 3);
recoveryIR.expressions.forEach((expression, i) => {
  expression.root = bin("*", bin("/", n(2), bin("^", recoveredParameter, n(0))), bin("^", recoveredParameter, bin("-", n(i + 1), n(1))));
  const quote = `a_${i + 1}`, start = recoveryQuestion.indexOf(quote, modelEnd);
  recoveryIR.facts[i + 1]!.evidence = { source: "question", start, end: start + quote.length, quote };
});
const recoveryAdmission = finiteProgressionSourceProgram(recoveryQuestion, recoveryIR, recoveryPlan, placement);
check(recoveryAdmission.status === "ok", `full actual recovery IR: ${recoveryAdmission.status === "declined" ? recoveryAdmission.reason : ""}`);
equal(recoveryAdmission.bindings.map(({ ask }) => ask.value), [2, -4, 8], "full-IR observed signed branch admission");
rejectsIR({ ...base, question: recoveryQuestion, problem: recoveryIR, plan: recoveryPlan }, (ir) => { ir.expressions[1]!.root = n(-4); }, "same-answer observation literal cannot replace recovered term dependency AST");
const insertionCase = fixtures.cases[4]!;
const insertionPlan = clone(insertionCase.plan);
insertionPlan.givens = [
  { id: "actualEndpointFirst", symbol: "a_1", unit: "1", value: 2, provenance: "given", sourceText: "between 2" },
  { id: "actualEndpointLast", symbol: "a_3", unit: "1", value: 8, provenance: "given", sourceText: "and 8" },
  { id: "actualInsertionCount", symbol: "m", unit: "1", value: 1, provenance: "given", sourceText: "Insert 1" },
];
check(finiteProgressionSourceProgram(insertionCase.question, insertionCase.problem, insertionPlan, placement).status === "ok", "actual first/last/count quantities keep distinct insertion source roles");
const tinyQuestion = "Let a_n be an arithmetic progression with a_1 = 0.0000000000003 and common difference 0. Find a_1.";
const tinyStart = tinyQuestion.indexOf("Find "), tinyAsk = tinyQuestion.lastIndexOf("a_1");
const tinyIR: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "tinyActualProblem", question: tinyQuestion,
  facts: [
    { id: "modelFact", kind: "given", statement: "stated AP", evidence: { source: "question", start: 0, end: tinyStart - 1, quote: tinyQuestion.slice(0, tinyStart - 1) } },
    { id: "askFact0", kind: "requested", statement: "compute a_1", evidence: { source: "question", start: tinyAsk, end: tinyAsk + 3, quote: "a_1" } },
  ], entities: [{ id: "actualSequenceEntity", kind: "other", label: "a_n", evidenceFactIds: ["modelFact"] }],
  expressions: [{ id: "sourceExpression0", valueType: "scalar", root: bin("+", n(3e-13), bin("*", bin("-", n(1), n(1)), n(0))), evidenceFactIds: ["askFact0"] }],
  constraints: [], representationIntents: [], solveRequests: [clone(base.problem.solveRequests[0]!)],
};
const tinyPlan: TurnPlanV3 = { ...clone(base.plan), question: tinyQuestion, givens: [], unknowns: [clone(base.plan.unknowns[0]!)], derived: [{...base.plan.unknowns[0]!, value: 3e-13, provenance: "derived"}] };
check(finiteProgressionSourceProgram(tinyQuestion, tinyIR, tinyPlan, placement).status === "ok", "small nonzero decimal source admits without an absolute tolerance floor");
const tinyStalePlan = clone(tinyPlan);
tinyStalePlan.derived = [{ ...tinyStalePlan.unknowns.pop()!, value: 0, provenance: "derived" }];
check(finiteProgressionSourceProgram(tinyQuestion, tinyIR, tinyStalePlan, placement).status === "declined", "small source nonzero cannot be certified as stale zero");
rejectsSource("Recover geometric progression a_n from a_1 = 2 and a_3 = 8 and a_2 = -5, using all_real ratio branches. Find a_1, a_2, a_3.", "contradictory observation rejects");
const recoveredAP = readFiniteProgressionSource("Recover arithmetic progression a_n from a_2 = 1 and a_5 = -5 and a_9 = -13. Find a_1, a_9, sum_{k=1}^20 a_k.");
check(recoveredAP.status === "ok", "recovery enumerates finite sums while retaining distant observations in each existing-operator call");
equal(recoveredAP.source.asks.map((ask) => ask.value), [3, -13, -320], "independent recovered AP and sum");
for (const [question, expected] of [
  ["Let a_n be an arithmetic progression with a_1 = 1/2 and common difference -1/4. Find a_4, sum_{k=1}^4 a_k.", [-0.25, 0.5]],
  ["Let a_n be a geometric progression with a_1 = 2 and common ratio 0. Find a_1, a_4, sum_{k=1}^4 a_k.", [2, 0, 2]],
  ["Let a_n be a geometric progression with a_1 = 2 and common ratio -1. Find a_64, sum_{k=1}^64 a_k.", [-2, 0]],
  ["Let a_n be an arithmetic progression with a_1 = 3 and common difference 0. Find a_64, sum_{k=1}^0 a_k.", [3, 0]],
] as Array<[string, number[]]>) {
  const result = readFiniteProgressionSource(question);
  check(result.status === "ok", "rational/zero/alternating/maximum-bound degeneracy control");
  equal(result.source.asks.map((ask) => ask.value), expected, "independently supplied edge expectations");
}

const native = JSON.parse(readFileSync(new URL("./fixtures/w3-progression-source/native-sources.json", import.meta.url), "utf8")) as { cases: Array<{ native_id: string; question_options_and_source_answer_verbatim: string; verbatim_question_block_sha256: string }> };
for (const c of native.cases) {
  equal(createHash("sha256").update(c.question_options_and_source_answer_verbatim).digest("hex"), c.verbatim_question_block_sha256, "raw native OCR/PDF-extract block preserved byte-for-byte");
  rejectsSource(c.question_options_and_source_answer_verbatim, `${c.native_id} raw OCR/native multi-option contract not silently reinterpreted`);
}
equal(fixtures.cases[3]!.expected, [1504, 10510, 3454, 35615], "native options A/D are false; independent recurrence is authoritative");
let getterCalls = 0;
const hostile = Object.defineProperty(clone(base.problem), "entities", { get() { getterCalls++; return []; } });
check(finiteProgressionSourceProgram(base.question, hostile, base.plan, placement).status === "declined" && getterCalls === 0, "own-data capture declines accessor without execution");
console.log(`shared compiler measurement: ${[...sharedGaps].sort().join(", ") || "wired"}; actual external question/fullIR/Plan required`);
console.log(`Wave3 progression source passed (${fixtures.cases.length} authored source cases, ${checks} checks); READY=0 accepted=0; parent/student/lifecycle pending`);
