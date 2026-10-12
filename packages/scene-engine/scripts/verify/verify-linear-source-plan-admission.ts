import assert from "node:assert/strict";
import { validateLinearSourcePlan } from "../../src/compile/linearSourceAgreement";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";

function plan(question: string, values: Array<[string, number]>): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [],
    unknowns: values.map(([symbol], i) => ({ id: `answer${i}`, symbol })),
    derived: values.map(([symbol, value], i) => ({ id: `answer${i}`, symbol, value, provenance: "derived" })),
    qualitativeClaims: [], lawIds: [], assumptions: [] };
}
let checks = 0;
for (const [question, values] of [
  ["Find the point of intersection of the lines 2x + y = 7 and x - y = 2.", [["x", 3], ["y", 1]]],
  ["Draw the graphs of 2x+y=7 and x-y=2 and find where they meet.", [["x", 3], ["y", 1]]],
  ["Find the angle between the lines x-y=0 and x+y=0.", [["theta", 90]]],
  ["Find the distance between the parallel lines 3x+4y=7 and 3x+4y=12.", [["d", 1]]],
  ["Find the bisectors of the angles between the lines x+y-1=0 and x-y+1=0.", [["answer", 1]]],
  ["Graph x+y=6 and x-y=2 and find their intersection.", [["answer", 4]]],
] as Array<[string, Array<[string, number]>]>) {
  const candidate = plan(question, values), before = JSON.stringify(candidate);
  assert.deepEqual(validateLinearSourcePlan(question, candidate), [], `An unproved reader role must not veto the planner: ${question}`);
  assert.equal(JSON.stringify(candidate), before); checks += 2;
}
const lp = "Maximize Z=3x+2y subject to x>=0,y>=0,x+y<=8,x<=5. Show feasible region and find the optimal point.";
const intersection = "Find the point of intersection of the lines 2x + y = 7 and x - y = 2.";
assert(validateLinearSourcePlan(intersection, plan(intersection, [["x", 4], ["y", 1]])).some(issue => issue.severity === "fatal"), "A complete direct intersection query still proves its original coordinates"); checks++;
for (const [symbol, value] of [["Z", 999], ["x", 999], ["y", 999]] as Array<[string, number]>) {
  assert(validateLinearSourcePlan(lp, plan(lp, [[symbol, value]])).some(issue => issue.severity === "fatal")); checks++;
}
assert.deepEqual(validateLinearSourcePlan(lp, plan(lp, [["Z", 21], ["x", 5], ["y", 3]])), []); checks++;
const unsupported = plan(lp, [["perimeter", 20]]);
assert.deepEqual(validateLinearSourcePlan(lp, unsupported), [], "No native perimeter role means existing planner/solver checks own it"); checks++;
const renamed = plan(lp, [["Z", 21]]); renamed.derived[0]!.symbol = "unrelated";
assert(validateLinearSourcePlan(lp, renamed).some(issue => issue.severity === "fatal"), "A proved requested source role cannot be renamed away"); checks++;
for (const question of [
  "Maximize Z=x subject to x>=0,y>=0,x<1 and y<=1. Show feasible region.",
  "Maximize Z=x+y subject to x>=0 and y>=0. Show feasible region.",
  "Solve the pair x+y=6 and 2x+2y=14 by the graphical method.",
]) {
  assert(validateLinearSourcePlan(question, plan(question, [[question.startsWith("Solve") ? "x" : "Z", 1]])).some(issue => issue.severity === "fatal"), "A source-proved non-finite role still refuses finite values"); checks++;
}
console.log(`Linear source plan admission: ${checks} checks passed`);
