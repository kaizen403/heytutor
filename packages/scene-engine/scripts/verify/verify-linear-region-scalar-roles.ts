import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ProblemIR } from "../../src/ir/problemIR";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import { verifyTurnPlanAgainstSolver } from "../../src/ir/solverAuthority";

const rows: Array<{ probeId: string; question: string; problemIR: ProblemIR; turnPlan: TurnPlanV3 }> = JSON.parse(readFileSync(new URL("./fixtures/linear-region-scalar-recordings.json", import.meta.url), "utf8"));
const provider = new LocalDeterministicSolverProvider();
let checks = 0;
for (const row of rows) {
  const result = await provider.solve(row.problemIR);
  const before = JSON.stringify({ problem: row.problemIR, plan: row.turnPlan, result });
  const audit = verifyTurnPlanAgainstSolver(row.problemIR, result, row.turnPlan, row.question);
  console.log(JSON.stringify({ probeId: row.probeId, status: audit.status, issues: audit.issues, selections: audit.bindings.map(binding => binding.selection) }));
  const boundary = row.probeId.includes("separated-boolean-union");
  assert.equal(audit.status, boundary ? "incomplete" : "verified");
  assert.equal(audit.bindings.filter(binding => binding.selection).length, boundary ? 2 : 1);
  if (boundary) assert.deepEqual(audit.issues.map(issue => issue.code), ["unbound_unknown"]);
  assert.equal(JSON.stringify({ problem: row.problemIR, plan: row.turnPlan, result }), before, "Projection never changes original metadata/provider output"); checks += 4;
  if (!boundary) {
    for (const mutate of [
      (problem: ProblemIR) => { problem.solveRequests = problem.solveRequests.filter(request => request.kind !== "evaluate"); },
      (problem: ProblemIR) => { const request = problem.solveRequests.find(request => request.kind === "evaluate")!; if (request.kind === "evaluate") problem.expressions.find(expression => expression.id === request.expressionId)!.root = { kind: "number", value: 999 }; },
      (problem: ProblemIR) => { problem.solveRequests.find(request => request.kind === "evaluate")!.resultBinding!.symbol = "y_invented"; },
    ]) {
      const problem = structuredClone(row.problemIR); mutate(problem);
      const negative = verifyTurnPlanAgainstSolver(problem, await provider.solve(problem), row.turnPlan, row.question);
      assert.notEqual(negative.status, "verified");
      assert(!negative.bindings.some(binding => binding.selection), "Incomplete/wrong tuple proof cannot select one scalar"); checks += 2;
    }
    const wrong = structuredClone(row.turnPlan);
    wrong.derived[0]!.value = wrong.derived[0]!.value! + 100;
    assert.equal(verifyTurnPlanAgainstSolver(row.problemIR, result, wrong, row.question).status, "contradiction"); checks++;
  } else {
    const changed = structuredClone(row.problemIR);
    const constraint = changed.constraints.find(constraint => constraint.kind === "inequality")!;
    if (constraint.kind === "inequality") constraint.relation = "<";
    const negative = verifyTurnPlanAgainstSolver(changed, await provider.solve(changed), row.turnPlan, row.question);
    assert.notEqual(negative.status, "verified");
    assert(!negative.bindings.some(binding => binding.selection), "Same roots never authorize a flipped original inequality"); checks += 2;
    const renamed = structuredClone(row.problemIR), plan = structuredClone(row.turnPlan);
    renamed.solveRequests[0]!.resultBinding!.symbol = plan.unknowns[0]!.symbol = plan.derived[0]!.symbol = "right boundary";
    const misbound = verifyTurnPlanAgainstSolver(renamed, await provider.solve(renamed), plan, row.question);
    assert.notEqual(misbound.status, "verified");
    assert(!misbound.bindings.find(binding => binding.requestId === renamed.solveRequests[0]!.id)?.selection, "An exact left endpoint cannot masquerade as the right boundary"); checks += 2;
  }
}
console.log(`linear region scalar source roles: ${checks} checks, ${rows.length} original full IR/TurnPlan captures`);
