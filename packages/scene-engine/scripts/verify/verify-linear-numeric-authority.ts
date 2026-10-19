import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { validateLinearSourcePlan } from "../../src/compile/linearSourceAgreement";
import { buildLinearSourceDocument } from "../../src/compile/linearRegionSource";
import { compileSceneDocument } from "../../src/compile/compiler";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import { verifyTurnPlanAgainstSolver } from "../../src/ir/solverAuthority";
import type { ProblemIR } from "../../src/ir/problemIR";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";

// Original bounded IR and complete plans retained by the offline capture.
// No grades, model responses, screenshots or experiment outcomes are fixtures.
const records: Array<{ rowId: string; rep: number; turnPlan: TurnPlanV3; problemIR?: ProblemIR }> = JSON.parse(readFileSync(new URL("./fixtures/linear-numeric-authority-recorded.json", import.meta.url), "utf8"));
const provider = new LocalDeterministicSolverProvider();
let checks = 0;
for (const record of records) {
  const document = buildLinearSourceDocument(record.turnPlan.question);
  assert.ok(document, `${record.rowId}: complete original source must be supported`);
  assert.ok(compileSceneDocument(document).ok, `${record.rowId}: source figure must compile`); checks += 2;
  const result = record.problemIR ? await provider.solve(record.problemIR) : null;
  const rejectedNumericPlan = (wrong: TurnPlanV3) => validateLinearSourcePlan(wrong.question, wrong).some(issue => issue.severity === "fatal")
    || record.problemIR && result && verifyTurnPlanAgainstSolver(record.problemIR, result, wrong, wrong.question).status !== "verified";
  const before = JSON.stringify(record.turnPlan);
  assert.deepEqual(validateLinearSourcePlan(record.turnPlan.question, record.turnPlan), [], `${record.rowId} r${record.rep}: native numeric roles`); checks++;
  assert.equal(JSON.stringify(record.turnPlan), before, "Agreement cannot rewrite the retained plan"); checks++;
  for (const answer of record.turnPlan.derived.filter(quantity => record.turnPlan.unknowns.some(unknown => unknown.id === quantity.id))) {
    const wrong = structuredClone(record.turnPlan);
    wrong.derived.find(quantity => quantity.id === answer.id)!.value += 1;
    assert.ok(rejectedNumericPlan(wrong), `${record.rowId}: wrong ${answer.symbol} cannot pair with a correct figure`); checks++;
    const unprovedBinding = structuredClone(record.turnPlan);
    unprovedBinding.unknowns.find(quantity => quantity.id === answer.id)!.symbol = "unrelated";
    const unprovedBefore = JSON.stringify(unprovedBinding);
    assert.deepEqual(validateLinearSourcePlan(unprovedBinding.question, unprovedBinding), [],
      `${record.rowId}: an unproved declared role cannot veto the correct proved derived coordinate with the same id`); checks++;
    assert.equal(JSON.stringify(unprovedBinding), unprovedBefore); checks++;
    const wrongDerived = structuredClone(unprovedBinding);
    wrongDerived.derived.find(quantity => quantity.id === answer.id)!.value += 1;
    assert.ok(rejectedNumericPlan(wrongDerived), `${record.rowId}: role uncertainty must not hide a wrong proved coordinate`); checks++;
    const wrongUnit = structuredClone(record.turnPlan);
    wrongUnit.unknowns.find(quantity => quantity.id === answer.id)!.unit = "cm";
    assert.ok(rejectedNumericPlan(wrongUnit), `${record.rowId}: unknown units must remain proved`); checks++;
  }
  if (record.problemIR && result) {
    assert.equal(result.status, "solved");
    const audit = verifyTurnPlanAgainstSolver(record.problemIR, result, record.turnPlan, record.turnPlan.question);
    assert.equal(audit.status, record.problemIR.solveRequests.length ? "verified" : "not_applicable", `${record.rowId}: ${JSON.stringify(audit.issues)}`); checks += 2;
  }
}

function plan(question: string, values: Array<[string, number]>): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: values.map(([symbol], index) => ({ id: `q${index}`, symbol })), derived: values.map(([symbol, value], index) => ({ id: `q${index}`, symbol, value, provenance: "derived" })), qualitativeClaims: [], lawIds: [], assumptions: [] };
}
function accepted(question: string, values: Array<[string, number]>) {
  assert.ok(buildLinearSourceDocument(question), "A role proof cannot pass because the source reader declined the stem");
  assert.deepEqual(validateLinearSourcePlan(question, plan(question, values)), []); checks += 2;
}
function refused(question: string, values: Array<[string, number]>) {
  assert.ok(buildLinearSourceDocument(question), "A negative role check must reach native source agreement");
  assert.ok(validateLinearSourcePlan(question, plan(question, values)).some(issue => issue.severity === "fatal"), `${question}: ${JSON.stringify(values)}`); checks += 2;
}
const lpp = "Maximize Z=3x+2y subject to x>=0,y>=0,x+y<=8 and x<=5. Show the feasible region and all corners.";
accepted(lpp, [["maximum Z", 21], ["Z_max", 21], ["optimal x", 5], ["y at maximum", 3], ["x*", 5]]);
accepted(lpp.replace("Maximize", "Minimize"), [["minimum Z", 0], ["Z_min", 0], ["x at minimum", 0], ["y*", 0]]);
accepted(lpp.replace("3x+2y", "6x+4y"), [["Z_max", 42], ["optimal x", 5], ["optimal y", 3]]);
for (const values of [[["Z_min", 0]], [["minimum Z", 0]], [["x at minimum", 0]], [["optimal x", 3]], [["Z_max", 999]]] as Array<Array<[string, number]>>) refused(lpp, values);
for (const values of [[["x", 5]], [["answer", 21]], [["maximum Q", 21]]] as Array<Array<[string, number]>>) accepted(lpp, values);
// Unjoined roles are delegated, not certified. Actual stale source-bound
// values and original IR binding/unit mutations above still must refuse.
refused(lpp.replace("x+y<=8", "x+y<=9"), [["Z_max", 21]]);
refused(lpp.replace("3x+2y", "x+y"), [["optimal x", 5]]);
refused("Maximize Z=x subject to x>=0,y>=0,x<1 and y<=1. Show the feasible region.", [["Z_max", 1], ["x*", 1]]);
refused("Maximize Z=x+y subject to x>=0 and y>=0. Show the feasible region.", [["maximum Z", 99], ["optimal x", 99]]);
refused("Maximize Z=x+y subject to x>=2,x<=1 and y>=0. Show the feasible region.", [["Z_max", 0]]);
const parallel = "Graph the system 3x=9 and x=-1. How many solutions does the system have?";
accepted(parallel, [["number of solutions", 0]]); refused(parallel, [["number of solutions", 1]]);
assert.equal(buildLinearSourceDocument(parallel.replace("How many solutions does the system have?", "Find twice the number of solutions of the system.")), null, "Transformed requests stay outside the native figure reader"); checks++;
const coincident = "Use the graphs of 2y=-6 and -5y=15 to determine the number of solutions of the system and describe them.";
accepted(coincident, [["y", -3]]); refused(coincident, [["x", 0]]); refused(coincident, [["number of solutions", 0]]); refused(coincident, [["y", 3]]);
const vertical = records.find(record => record.rowId.includes("vertical-line-system"))!.turnPlan.question;
accepted(vertical, [["P_x", 2.5], ["x_P", 2.5], ["intersection y-coordinate", 4.75], ["L2 x-intercept coordinate", -7], ["number of solutions", 1]]);
accepted(vertical, [["Q_x", 2.5]]);
for (const values of [[["L1 y-intercept", 3.5]], [["L2 x-intercept", 7]], [["number of solutions", 0]]] as Array<Array<[string, number]>>) refused(vertical, values);
const coefficient = records.find(record => record.rowId.includes("lpp07"))!.turnPlan;
for (const mutate of [(p: TurnPlanV3) => { p.givens[0]!.value = 3; }, (p: TurnPlanV3) => { p.givens[0]!.sourceText = "Coefficient of y in Z=x+3y"; }, (p: TurnPlanV3) => { p.givens[0]!.sourceText = "Z=2"; }]) {
  const wrong = structuredClone(coefficient); mutate(wrong);
  assert.ok(validateLinearSourcePlan(wrong.question, wrong).some(issue => issue.severity === "fatal"), "A finite unbounded objective cannot hide as a given/coefficient"); checks++;
}

const ray = records.find(record => record.rowId.includes("negative-strict-ray") && record.rep === 2)!;
const union = records.find(record => record.rowId.includes("separated-boolean-union") && record.rep === 2)!;
async function refusedBinding(record: typeof ray, mutate: (problem: ProblemIR, turnPlan: TurnPlanV3) => void, forge?: (result: Awaited<ReturnType<typeof provider.solve>>) => void) {
  const problem = structuredClone(record.problemIR!), turnPlan = structuredClone(record.turnPlan);
  mutate(problem, turnPlan);
  const result = await provider.solve(problem); forge?.(result);
  assert.notEqual(verifyTurnPlanAgainstSolver(problem, result, turnPlan, turnPlan.question).status, "verified", "Unsupported set selection must remain refused"); checks++;
}
for (const relation of ["<", ">="] as const) await refusedBinding(ray, problem => { const constraint = problem.constraints[0]!; if (constraint.kind === "inequality") constraint.relation = relation; });
await refusedBinding(ray, (_, p) => { p.derived[0]!.value = 2; });
await refusedBinding(ray, problem => { problem.solveRequests[0]!.resultBinding!.unit = "cm"; });
await refusedBinding(ray, problem => { delete problem.solveRequests[0]!.resultBinding; });
await refusedBinding(ray, problem => { for (const fact of problem.facts) if (fact.kind === "requested") fact.kind = "given"; });
await refusedBinding(ray, problem => { problem.facts.find(fact => fact.id === "fInequality")!.evidence.quote = "x>-2"; });
await refusedBinding(ray, () => {}, result => { result.values[0]!.approximate = [2]; result.values[0]!.exact = [{ kind: "integer", value: "2" }]; });
await refusedBinding(ray, () => {}, result => { result.values[0]!.approximate = [-2, 2]; result.values[0]!.exact = [{ kind: "integer", value: "-2" }, { kind: "integer", value: "2" }]; });
await refusedBinding(ray, () => {}, result => { delete result.values[0]!.exact; });
await refusedBinding(union, (problem, p) => { problem.solveRequests[0]!.resultBinding!.symbol = p.unknowns[0]!.symbol = p.derived[0]!.symbol = "right boundary"; });
await refusedBinding(union, problem => { const constraint = problem.constraints[1]!; if (constraint.kind === "inequality") constraint.relation = ">"; });
await refusedBinding(ray, problem => { const constraint = structuredClone(problem.constraints[0]!); constraint.id = "extra"; if (constraint.kind === "inequality") constraint.relation = "<="; problem.constraints.push(constraint); });
await refusedBinding(union, problem => { const request = problem.solveRequests[0]!; if (request.kind === "roots") request.domain = { min: 0, max: 10 }; });
const sys = records.find(record => record.rowId.includes("sys06"))!;
await refusedBinding(sys, problem => { const fact = problem.facts.find(item => item.id === "fPoint")!; const start = problem.question.indexOf("intersection"); fact.evidence = { source: "question", start, end: start + "intersection".length, quote: "intersection" }; });
console.log(`Linear numeric authority gate passed: ${checks} checks`);
