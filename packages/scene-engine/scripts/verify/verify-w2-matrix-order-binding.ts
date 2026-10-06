import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ProblemIR } from "../../src/ir/problemIR";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { prepareMatrixLiteralSourceAuthority } from "../../src/ir/matrixLiteralSource";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import { verifyTurnPlanAgainstSolver } from "../../src/ir/solverAuthority";
import { validateTurnPlanV3 } from "../../src/contracts/contractsV3";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/w2-section-matrix/${name}.json`, import.meta.url), "utf8"));
}

const questionIR = fixture("matrix-case1-actual-normalized-ir") as ProblemIR;
const planFixture = fixture("matrix-case1-actual-plan") as TurnPlanV3;
const orderRequest = (problem: ProblemIR) => problem.solveRequests.find((request) => request.id === "srOrder")!;
const capture = (mutate: (problem: ProblemIR) => void) => {
  const problem = structuredClone(questionIR);
  mutate(problem);
  return problem;
};
const binding = (turnPlanQuantityId: string, symbol: string, evidenceFactIds: string[], unit?: string) => ({
  turnPlanQuantityId, symbol, evidenceFactIds, ...(unit === undefined ? {} : { unit }),
});

const reviewNegatives: Array<[string, ProblemIR]> = [
  ["row request bound to column", capture((problem) => { orderRequest(problem).resultBinding = binding("colsA", "colsA", ["fStateOrder"]); })],
  ["unrelated plan target", capture((problem) => { orderRequest(problem).resultBinding = binding("a13", "order", ["fStateOrder"]); })],
  ["physical unit on tuple order", capture((problem) => { orderRequest(problem).resultBinding = binding("order", "order", ["fStateOrder"], "m"); })],
  ["given matrix fact used as requested evidence", capture((problem) => { orderRequest(problem).resultBinding = binding("order", "order", ["fMatrixGiven"]); })],
];
for (const [name, problem] of reviewNegatives) {
  assert.equal(prepareMatrixLiteralSourceAuthority(questionIR.question, planFixture, problem), null, name);
}

const aliasFalse = capture((problem) => {
  // eOrderRows and colsA are individually valid aliases, but their roles conflict.
  orderRequest(problem).resultBinding = binding("rowsA", "colsA", ["fStateOrder"]);
});
assert.equal(prepareMatrixLiteralSourceAuthority(questionIR.question, planFixture, aliasFalse), null, "cross-role target/symbol alias declines");
const orderTargetOnCell = capture((problem) => {
  problem.solveRequests.find((request) => request.id === "srA13")!.resultBinding = binding("rowsA", "a13", ["fWriteElements"]);
});
assert.equal(prepareMatrixLiteralSourceAuthority(questionIR.question, planFixture, orderTargetOnCell), null, "order quantity cannot bind a requested cell");

const duplicateAndCrossRole = capture((problem) => {
  orderRequest(problem).resultBinding = binding("rowsA", "rowsA", ["fStateOrder"]);
  problem.solveRequests.push({ id: "srOrderCols", kind: "evaluate", expressionId: "eOrderCols",
    resultBinding: binding("rowsA", "rowsA", ["fStateOrder"]) });
});
assert.equal(prepareMatrixLiteralSourceAuthority(questionIR.question, planFixture, duplicateAndCrossRole), null, "duplicate cross-axis quantity binding declines");

const tupleInput = capture((problem) => {
  orderRequest(problem).resultBinding = binding("order", "order", ["fStateOrder"]);
});
const tupleSnapshot = structuredClone(tupleInput);
const tuplePrepared = prepareMatrixLiteralSourceAuthority(questionIR.question, planFixture, tupleInput);
assert(tuplePrepared, "source-owned unitless tuple binding is split into row and column components");
assert.deepEqual(tupleInput, tupleSnapshot, "preparation does not mutate submitted IR");
assert.deepEqual(orderRequest(tuplePrepared.problemIR).resultBinding, binding("rowsA", "rowsA", ["fStateOrder"]));
const tupleColumn = tuplePrepared.problemIR.solveRequests.find((request) => request.id === "solve_colsA")!;
assert.deepEqual(tupleColumn.resultBinding, binding("colsA", "colsA", ["fStateOrder"]));

const axisInput = capture((problem) => {
  orderRequest(problem).resultBinding = binding("rowsA", "rowsA", ["fStateOrder"]);
});
const axisPrepared = prepareMatrixLiteralSourceAuthority(questionIR.question, planFixture, axisInput);
assert(axisPrepared, "compatible row-axis binding is accepted");
assert.deepEqual(orderRequest(axisPrepared.problemIR).resultBinding, binding("rowsA", "rowsA", ["fStateOrder"]), "existing axis binding and evidence are preserved");
assert.deepEqual(axisPrepared.problemIR.entities, questionIR.entities, "all 20 source entities remain intact");
assert.deepEqual(axisPrepared.problemIR.facts, questionIR.facts, "all source facts remain intact");
assert.deepEqual(axisPrepared.problemIR.representationIntents, questionIR.representationIntents, "source intents remain intact");
assert.deepEqual(axisPrepared.problemIR.constraints, questionIR.constraints, "source constraints remain intact");

const pristineSnapshot = structuredClone(questionIR);
const prepared = prepareMatrixLiteralSourceAuthority(questionIR.question, planFixture, questionIR);
assert(prepared, "unbound captured full IR remains admissible");
assert.deepEqual(questionIR, pristineSnapshot, "full-IR preparation leaves caller input unchanged");
assert.deepEqual(prepared.problemIR.entities, questionIR.entities);
assert.deepEqual(prepared.problemIR.facts, questionIR.facts);
assert.deepEqual(prepared.problemIR.representationIntents, questionIR.representationIntents);
assert.deepEqual(prepared.problemIR.constraints, questionIR.constraints);
assert.equal(prepared.problemIR.entities.length, 20);
assert.equal(prepared.problemIR.solveRequests.length, questionIR.solveRequests.length + 1);
assert(validateTurnPlanV3(prepared.plan, questionIR.question).valid);
const solver = new LocalDeterministicSolverProvider();
const solved = await solver.solve(prepared.problemIR);
assert.equal(solved.status, "solved");
assert.deepEqual(solved.values.map((value) => value.approximate), [3, 19, 35, -5, 12, 2.5, 4]);
assert.equal(verifyTurnPlanAgainstSolver(prepared.problemIR, solved, prepared.plan, questionIR.question).status, "verified");

console.log("w2-matrix-order-binding: 4 review negatives, alias/cross-role negatives, tuple and axis positives, input preservation, 20-entity full-IR solver authority passed (offline only)");
