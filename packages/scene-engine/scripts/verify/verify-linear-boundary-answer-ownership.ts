import assert from "node:assert/strict";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { ExpressionNodeIR, ProblemIR } from "../../src/ir/problemIR";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import { reconcileTurnPlanWithSolver, verifyTurnPlanAgainstSolver } from "../../src/ir/solverAuthority";

const number = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const x: ExpressionNodeIR = { kind: "variable", name: "x" };
const subtract = (left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator: "-", left, right });
const question = "On a number line, solve x > 2 and x < 5. Find the left boundary, right boundary, and interval length.";
const evidence = (quote: string) => ({ source: "question" as const, start: question.indexOf(quote), end: question.indexOf(quote) + quote.length, quote });
const problem: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "boundedIntervalAndLength", question,
  facts: [
    { id: "lower", kind: "given", statement: "x > 2", evidence: evidence("x > 2") },
    { id: "upper", kind: "given", statement: "x < 5", evidence: evidence("x < 5") },
    { id: "boundaries", kind: "requested", statement: "Find the interval boundaries", evidence: evidence("Find the left boundary, right boundary") },
    { id: "length", kind: "requested", statement: "Find the interval length", evidence: evidence("interval length") },
  ],
  entities: [], representationIntents: [],
  expressions: [
    { id: "x", valueType: "scalar", root: x, evidenceFactIds: ["lower", "upper"] },
    { id: "two", valueType: "scalar", root: number(2), evidenceFactIds: ["lower"] },
    { id: "five", valueType: "scalar", root: number(5), evidenceFactIds: ["upper"] },
    { id: "leftRoot", valueType: "function", root: subtract(x, number(2)), evidenceFactIds: ["lower"] },
    { id: "rightRoot", valueType: "function", root: subtract(x, number(5)), evidenceFactIds: ["upper"] },
    { id: "lengthValue", valueType: "scalar", root: subtract(number(5), number(2)), evidenceFactIds: ["lower", "upper"] },
  ],
  constraints: [
    { id: "lowerConstraint", kind: "inequality", leftExpressionId: "x", rightExpressionId: "two", relation: ">", evidenceFactIds: ["lower"] },
    { id: "upperConstraint", kind: "inequality", leftExpressionId: "x", rightExpressionId: "five", relation: "<", evidenceFactIds: ["upper"] },
  ],
  solveRequests: [
    { id: "findLeft", kind: "roots", expressionId: "leftRoot", variable: "x", domain: { min: -10, max: 10 }, resultBinding: { turnPlanQuantityId: "left", symbol: "left boundary", evidenceFactIds: ["boundaries"] } },
    { id: "findRight", kind: "roots", expressionId: "rightRoot", variable: "x", domain: { min: -10, max: 10 }, resultBinding: { turnPlanQuantityId: "right", symbol: "right boundary", evidenceFactIds: ["boundaries"] } },
    { id: "findLength", kind: "evaluate", expressionId: "lengthValue", resultBinding: { turnPlanQuantityId: "length", symbol: "L", evidenceFactIds: ["length"] } },
  ],
};
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [],
  unknowns: [{ id: "left", symbol: "left boundary" }, { id: "right", symbol: "right boundary" }, { id: "length", symbol: "L" }],
  derived: [
    { id: "left", symbol: "left boundary", value: 2, provenance: "derived" },
    { id: "right", symbol: "right boundary", value: 5, provenance: "derived" },
    { id: "length", symbol: "L", value: 3, provenance: "derived" },
  ],
  qualitativeClaims: [], lawIds: [], assumptions: [],
};
const result = await new LocalDeterministicSolverProvider().solve(problem);
assert.equal(result.status, "solved", JSON.stringify(result.issues));
for (const boundaryOnly of [false, true]) {
  const isolatedProblem = structuredClone(problem), isolatedPlan = structuredClone(plan);
  isolatedProblem.solveRequests = isolatedProblem.solveRequests.filter(request => (request.id !== "findLength") === boundaryOnly);
  isolatedPlan.unknowns = isolatedPlan.unknowns.filter(quantity => (quantity.id !== "length") === boundaryOnly);
  isolatedPlan.derived = isolatedPlan.derived.filter(quantity => (quantity.id !== "length") === boundaryOnly);
  const isolatedResult = await new LocalDeterministicSolverProvider().solve(isolatedProblem);
  assert.equal(verifyTurnPlanAgainstSolver(isolatedProblem, isolatedResult, isolatedPlan, question).status, "verified", `${boundaryOnly ? "Boundaries" : "Length"} alone already has independent authority`);
}
const before = JSON.stringify({ problem, plan, result });
const audit = verifyTurnPlanAgainstSolver(problem, result, plan, question);
console.log(JSON.stringify({ status: audit.status, issues: audit.issues, bindings: audit.bindings }));
assert.equal(audit.status, "verified", "Independently evaluated interval length must survive genuine boundary projections");
assert.equal(audit.bindings.find(binding => binding.quantityId === "length")?.approximate, 3);
assert.equal(audit.bindings.filter(binding => binding.selection?.kind === "unique_source_linear_boundary").length, 2);
assert.equal(JSON.stringify({ problem, plan, result }), before, "Authority preserves the original provider set values and request metadata");
const stale = structuredClone(plan); stale.derived[2]!.value = 99;
assert.equal(verifyTurnPlanAgainstSolver(problem, result, stale, question).status, "contradiction");
assert.equal(reconcileTurnPlanWithSolver(stale, problem, result).derived[2]!.value, 3, "Independent scalar reconciliation remains deterministic");

const namedProblem = structuredClone(problem), namedPlan = structuredClone(plan);
namedProblem.question = namedPlan.question = question.replace("solve x", "draw the solution set S of x");
for (const fact of namedProblem.facts) {
  const start = namedProblem.question.indexOf(fact.evidence.quote);
  fact.evidence = { ...fact.evidence, start, end: start + fact.evidence.quote.length };
}
const namedResult = await new LocalDeterministicSolverProvider().solve(namedProblem);
assert.equal(verifyTurnPlanAgainstSolver(namedProblem, namedResult, namedPlan, namedPlan.question).status, "verified", "A named whole set may coexist with its independently proved length");
for (const symbol of ["S", "solution set", "solution interval"]) {
  const wholeProblem = structuredClone(namedProblem), wholePlan = structuredClone(namedPlan);
  wholeProblem.solveRequests[2]!.resultBinding!.symbol = symbol;
  wholePlan.unknowns[2]!.symbol = wholePlan.derived[2]!.symbol = symbol;
  wholePlan.derived[2]!.value = 99;
  const wholeResult = await new LocalDeterministicSolverProvider().solve(wholeProblem);
  const refused = verifyTurnPlanAgainstSolver(wholeProblem, wholeResult, wholePlan, wholePlan.question);
  assert.equal(refused.status, "contradiction", "A native arithmetic result cannot represent a whole set or interval");
  assert.ok(refused.issues.some(issue => issue.code === "unproved_source_boundary_scalar"));
  assert.equal(reconcileTurnPlanWithSolver(wholePlan, wholeProblem, wholeResult).derived[2]!.value, 99, "Reconciliation cannot supply a finite whole-set answer");
}
const wrongTarget = structuredClone(namedProblem);
wrongTarget.facts.push({ id: "wholeSet", kind: "requested", statement: "Draw the whole source set", evidence: {
  source: "question", start: wrongTarget.question.indexOf("draw the solution set S"), end: wrongTarget.question.indexOf("draw the solution set S") + "draw the solution set S".length, quote: "draw the solution set S",
} });
wrongTarget.solveRequests[2]!.resultBinding!.evidenceFactIds = ["wholeSet"];
assert.equal(verifyTurnPlanAgainstSolver(wrongTarget, await new LocalDeterministicSolverProvider().solve(wrongTarget), namedPlan, namedPlan.question).status, "contradiction", "Renaming a set answer to L cannot turn whole-set evidence into scalar evidence");
for (const fault of ["given-only evidence", "missing binding", "duplicate binding", "wrong symbol", "wrong unit"]) {
  const changed = structuredClone(problem);
  const request = changed.solveRequests[2]!;
  if (fault === "given-only evidence") request.resultBinding!.evidenceFactIds = ["lower"];
  if (fault === "missing binding") delete request.resultBinding;
  if (fault === "duplicate binding") changed.solveRequests.push({ ...request, id: "alsoLength" });
  if (fault === "wrong symbol") request.resultBinding!.symbol = "invented";
  if (fault === "wrong unit") request.resultBinding!.unit = "cm";
  assert.equal(verifyTurnPlanAgainstSolver(changed, await new LocalDeterministicSolverProvider().solve(changed), plan, question).status, "contradiction", `${fault} cannot preserve scalar authority beside boundary certificates`);
}
console.log("linear boundary answer ownership: 25 checks passed");
