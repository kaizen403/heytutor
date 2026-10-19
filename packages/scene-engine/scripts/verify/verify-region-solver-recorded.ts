import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { validateLinearSourcePlan } from "../../src/compile/linearSourceAgreement";
import { buildLinearSourceDocument } from "../../src/compile/linearRegionSource";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateTurnPlanV3, type TurnPlanV3 } from "../../src/contracts/contractsV3";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import { LocalDeterministicSolverProvider, type SolverResult } from "../../src/ir/solver";
import { reconcileTurnPlanWithSolver, verifyTurnPlanAgainstSolver } from "../../src/ir/solverAuthority";

interface RecordedContract {
  rowId: string;
  captureSha256: string;
  originalMetadata: true;
  expected: "verified" | "incomplete" | "source_rejected";
  turnPlan: TurnPlanV3;
  problemIR: ProblemIR;
  solverResult: SolverResult;
}

// Complete original ProblemIR, TurnPlan and solver result from five frozen lab
// captures. These are source/authority contracts, never runtime templates.
const records: RecordedContract[] = JSON.parse(readFileSync(new URL("./fixtures/region-solver-recorded.json", import.meta.url), "utf8"));
const provider = new LocalDeterministicSolverProvider();
let checks = 0;
const sourceRejected = (plan: TurnPlanV3) => validateLinearSourcePlan(plan.question, plan).some(issue => issue.severity === "fatal");

async function audit(record: RecordedContract, mutate?: (problem: ProblemIR, plan: TurnPlanV3) => void) {
  const problem = structuredClone(record.problemIR), plan = structuredClone(record.turnPlan);
  mutate?.(problem, plan);
  assert.ok(validateProblemIR(problem, plan.question).valid, `${record.rowId}: mutation must reach the real solver seam`);
  const planValidation = validateTurnPlanV3(plan, plan.question);
  assert.ok(planValidation.valid, `${record.rowId}: mutation must preserve a valid plan: ${JSON.stringify(planValidation.issues)}`); checks += 2;
  const result = await provider.solve(problem);
  assert.equal(result.status, "solved", JSON.stringify(result.issues)); checks++;
  return { problem, plan, result, audit: verifyTurnPlanAgainstSolver(problem, result, plan, plan.question) };
}

for (const record of records) {
  assert.equal(record.originalMetadata, true);
  assert.match(record.captureSha256, /^[a-f0-9]{64}$/);
  assert.equal(record.problemIR.question, record.turnPlan.question); checks += 3;
  const before = JSON.stringify(record);
  const replay = await audit(record);
  assert.deepEqual(replay.result, record.solverResult, "The provider's set/scalar result and proofs must remain unchanged"); checks++;
  const source = buildLinearSourceDocument(record.turnPlan.question);
  assert.ok(source, `${record.rowId}: source proof must exist independently of audit status`);
  assert.ok(compileSceneDocument(source).ok, `${record.rowId}: complete source figure must compile`); checks += 2;
  if (record.expected === "source_rejected") {
    assert.ok(sourceRejected(record.turnPlan), `${record.rowId}: actual wrong scalar must remain blocked by source agreement`); checks++;
  } else {
    assert.equal(replay.audit.status, record.expected, `${record.rowId}: ${JSON.stringify(replay.audit.issues)}`);
    assert.equal(sourceRejected(record.turnPlan), false); checks += 2;
    assert.equal(replay.result.values[0]?.valueType, "set", "Exact source projection must not rewrite provider output"); checks++;
    assert.ok(replay.audit.bindings.filter(binding => Array.isArray(record.solverResult.values.find(value => value.requestId === binding.requestId)?.approximate))
      .every(binding => typeof binding.approximate === "number" && binding.selection), "Each set-to-scalar projection needs retained source evidence"); checks++;
    if (record.expected === "incomplete") {
      assert.deepEqual(replay.audit.issues.map(issue => issue.code), ["unbound_unknown"]);
      assert.ok(!record.turnPlan.derived.some(quantity => quantity.id === "s"), "The incomplete S is symbolic, not a finite scalar"); checks += 2;
    }
    for (const quantity of record.turnPlan.derived) {
      const wrong = structuredClone(record.turnPlan);
      wrong.derived.find(item => item.id === quantity.id)!.value += 1;
      const wrongAudit = verifyTurnPlanAgainstSolver(record.problemIR, replay.result, wrong, wrong.question);
      assert.ok(sourceRejected(wrong) || wrongAudit.status === "contradiction", `${record.rowId}: stale ${quantity.symbol} cannot cross scene authority`); checks++;
    }
  }
  assert.equal(JSON.stringify(record), before, "Replaying a capture cannot rewrite its source/plan/proofs"); checks++;
}

for (const record of records.filter(item => item.expected === "verified")) {
  const companion = record.problemIR.solveRequests.find(request => request.kind === "evaluate")!;
  const companionId = companion.resultBinding!.turnPlanQuantityId;
  const partial = await audit(record, (problem, plan) => {
    problem.solveRequests = problem.solveRequests.filter(request => request.id !== companion.id);
    plan.unknowns = plan.unknowns.filter(quantity => quantity.id !== companionId);
    plan.derived = plan.derived.filter(quantity => quantity.id !== companionId);
    plan.qualitativeClaims = [];
  });
  assert.notEqual(partial.audit.status, "verified", "A tuple-only single scalar request remains refused"); checks++;
  const wrongCompanion = await audit(record, (problem, plan) => {
    const request = problem.solveRequests.find(item => item.id === companion.id)!;
    if (request.kind !== "evaluate") throw new Error("Expected recorded evaluate companion");
    problem.expressions.find(expression => expression.id === request.expressionId)!.root = { kind: "number", value: 99 };
    const quantity = plan.derived.find(item => item.id === companionId)!;
    quantity.value = 99; delete quantity.sourceText; plan.qualitativeClaims = [];
  });
  assert.notEqual(wrongCompanion.audit.status, "verified", "A matching wrong companion cannot authorize tuple scalar projection");
  assert.ok(sourceRejected(wrongCompanion.plan)); checks += 2;
  const original = await audit(record);
  const forged = structuredClone(original.result);
  const set = forged.values.find(value => value.valueType === "set")!;
  set.approximate = [99]; set.exact = [{ kind: "integer", value: "99" }];
  assert.notEqual(verifyTurnPlanAgainstSolver(original.problem, forged, original.plan, original.plan.question).status, "verified", "A forged singleton is never source authority"); checks++;
}

const union = records.find(record => record.expected === "incomplete")!;
const staleSet = structuredClone(union.turnPlan);
staleSet.derived.push({ id: "s", symbol: "S", value: 99, provenance: "derived" });
assert.equal(verifyTurnPlanAgainstSolver(union.problemIR, union.solverResult, staleSet, staleSet.question).status, "contradiction", "Incomplete symbolic S cannot shelter a stale finite scalar"); checks++;
for (const value of [99, -1]) {
  const pruned = await audit(union, (_, plan) => {
    plan.unknowns = plan.unknowns.filter(quantity => quantity.id === "s");
    plan.derived.push({ id: "s", symbol: "S", value, provenance: "derived" });
  });
  assert.equal(pruned.audit.status, "contradiction", "Intermediate boundary quantities cannot hide the unproved finite requested set claim"); checks++;
}
const irrelevant = await audit(union, (problem, plan) => {
  plan.derived.push({ id: "s", symbol: "S", value: 99, provenance: "derived" });
  problem.expressions.push({ id: "unprovedSetScalar", valueType: "scalar", root: { kind: "number", value: 99 }, evidenceFactIds: ["fSet"] });
  problem.solveRequests.push({ id: "unrelatedSetAnswer", kind: "evaluate", expressionId: "unprovedSetScalar", resultBinding: { turnPlanQuantityId: "s", symbol: "S", evidenceFactIds: ["fSet"] } });
});
assert.equal(irrelevant.audit.status, "contradiction", "A matching scalar binding id cannot certify the whole source set"); checks++;
const prunedIrrelevant = structuredClone(irrelevant.plan);
prunedIrrelevant.unknowns = prunedIrrelevant.unknowns.filter(quantity => quantity.id === "s");
assert.equal(verifyTurnPlanAgainstSolver(irrelevant.problem, irrelevant.result, prunedIrrelevant, prunedIrrelevant.question).status, "contradiction", "A matching evaluate binding cannot bypass source-role refusal by moving boundaries to intermediates"); checks++;
assert.equal(reconcileTurnPlanWithSolver(irrelevant.plan, irrelevant.problem, irrelevant.result).derived.find(quantity => quantity.id === "s")!.value, 99, "Reconciliation cannot manufacture whole-set scalar authority"); checks++;
const boundaryAsSet = await audit(union, (problem, plan) => {
  plan.derived.push({ id: "s", symbol: "S", value: -1, provenance: "derived" });
  const leftBoundary = structuredClone(problem.solveRequests[0]!);
  leftBoundary.id = "boundaryForgedAsSet";
  leftBoundary.resultBinding = { turnPlanQuantityId: "s", symbol: "S", evidenceFactIds: ["fBounds"] };
  problem.solveRequests.push(leftBoundary);
});
assert.deepEqual(boundaryAsSet.result.values.at(-1)!.approximate, [-1], "This negative uses a genuine exact source boundary, not a made-up number");
assert.equal(boundaryAsSet.audit.status, "contradiction", "The source's named solution set S cannot inherit a boundary's scalar certificate"); checks += 2;
const uncertain = await audit(union, (_, plan) => { plan.derived[0]!.value = 99; delete plan.derived[0]!.sourceText; plan.derived[0]!.uncertainty = 1000; });
assert.equal(uncertain.audit.status, "contradiction", "Planner uncertainty cannot enlarge an exact boundary certificate"); checks++;
const correctedBoundary = reconcileTurnPlanWithSolver(uncertain.plan, uncertain.problem, uncertain.result);
assert.equal(correctedBoundary.derived[0]!.value, -1, "A genuine explicitly proved scalar boundary remains safely reconcilable");
assert.equal(verifyTurnPlanAgainstSolver(uncertain.problem, uncertain.result, correctedBoundary, correctedBoundary.question).status, "incomplete", "Only the symbolic set unknown remains after exact boundary reconciliation"); checks += 2;
console.log(`recorded region solver contracts: ${checks} passed (3 corrected metadata contracts, 2 source-rejected wrong scalar controls)`);
