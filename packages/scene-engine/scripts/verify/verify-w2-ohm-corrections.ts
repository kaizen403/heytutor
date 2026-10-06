import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindStatedCircuitProblem, checkStatedCircuitProblemBinding } from "../../src/ir/statedCircuitProblemBinding";
import { applyStatedCircuitAuthority, readCircuitLiterals, readStatedCircuitProblemSource } from "../../src/ir/statedCircuitAuthority";
import { compileSceneDocument } from "../../src/compile/compiler";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import type { ProblemIR } from "../../src/ir/problemIR";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/w2-ohm/${name}.json`, import.meta.url), "utf8"));
const meters = fixture<ProblemIR>("w1-ohm-meters-normalized-problem-ir");
const tree = fixture<ProblemIR>("w1-ohm-tree-normalized-problem-ir");
const treePlan = fixture<TurnPlanV3>("w1-ohm-tree-captured-planning-plan");
let checks = 0, failures = 0;
function check(name: string, run: () => void) {
  checks++;
  try { run(); console.log(`ok ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}`, error); }
}
const strict = (plan: TurnPlanV3) => applyStatedCircuitAuthority(plan.question, plan, { requireBoundClaims: true })!;
function rejectIR(name: string, base: ProblemIR, edit: (problem: ProblemIR) => void) {
  check(name, () => {
    const problem = structuredClone(base), original = bindStatedCircuitProblem(base.question, base)!.document;
    edit(problem);
    const snapshot = structuredClone(problem);
    assert.equal(bindStatedCircuitProblem(problem.question, problem), null);
    assert.ok(checkStatedCircuitProblemBinding(problem.question, problem, original).some(row => row.severity === "fatal"));
    assert.deepEqual(problem, snapshot, "retain the actual full invalid IR for the caller's fallback/stop");
  });
}
function rejectPlan(name: string, edit: (plan: TurnPlanV3) => void, withdrawn: string[]) {
  check(name, () => {
    const plan = structuredClone(treePlan); edit(plan);
    const snapshot = structuredClone(plan), result = strict(plan);
    assert.ok(result);
    for (const id of withdrawn) {
      assert.ok(!result.plan.derived.some(row => row.id === id), `withdraw ${id}`);
      assert.ok(!result.plan.unknowns.some(row => row.id === id), `withdraw unknown ${id}`);
      assert.ok(!result.plan.qualitativeClaims.some(row => row.relatedQuantityIds?.includes(id)), `withdraw claim linked to ${id}`);
    }
    assert.deepEqual(plan, snapshot);
  });
}
// The exact independent review mutations, including numeric coincidences.
rejectIR("F1-short-wire", meters, p => { p.question = p.question.replace("Find", "The resistor is shorted by a wire. Find"); });
rejectIR("F1-second-cell", meters, p => { p.question = p.question.replace("Find", "Another cell is connected in series with the first cell. Find"); });
rejectIR("F1-meter-target-source", meters, p => { p.question = p.question.replace("Find", "The voltmeter is across the ammeter. Find"); });
rejectIR("F2-extra-fact", meters, p => { p.facts[0]!.statement += " The resistor is shorted by a wire."; });
rejectIR("F2-negated-topology", tree, p => { p.facts.find(row => row.id === "fSeries")!.statement = "The 2 ohm and 4 ohm resistors are not connected in series."; });
rejectIR("F2-contradictory-request", tree, p => { p.facts.find(row => row.id === "fReq")!.statement = "Find the equivalent resistance and the total power."; });
rejectIR("F2-meter-target-fact", meters, p => { const fact = p.facts.find(row => row.id === "fIdealVoltmeter")!; fact.kind = "given"; fact.statement = "The voltmeter is across the cell."; });
rejectIR("F3-Req-leaf-role", tree, p => { p.solveRequests[0]!.resultBinding!.symbol = "R1"; });
rejectPlan("F3-strict-leaf-role", p => { p.derived.find(row => row.id === "Req")!.symbol = "R1"; }, ["Req", "Itot"]);
rejectPlan("F3-strict-request-role", p => { const row = p.derived.find(row => row.id === "Itot")!; row.symbol = "I1"; row.value = 1; }, ["Itot"]);
rejectPlan("F4-current-dependencies", p => { p.derived.find(row => row.id === "Itot")!.dependsOn = ["R1"]; }, ["Itot"]);
rejectPlan("F4-voltage-dependencies", p => { p.derived.push({ id: "wrongV", symbol: "V1", unit: "V", value: 2, provenance: "derived", dependsOn: ["R3"] }); }, ["wrongV"]);
check("F5-valid-transitive-parallel", () => {
  const plan = structuredClone(treePlan);
  plan.derived.find(row => row.id === "Req")!.symbol = "R_parallel";
  plan.unknowns.find(row => row.id === "Req")!.symbol = "R_parallel";
  const result = strict(plan);
  assert.equal(result.plan.derived.find(row => row.id === "Req")?.value, 2);
  assert.equal(result.plan.derived.find(row => row.id === "Itot")?.value, 3);
  assert.equal(result.plan.derived.find(row => row.id === "Rs")?.value, 6);
  assert.deepEqual(result.plan.qualitativeClaims, treePlan.qualitativeClaims);
});

for (const extra of [
  "The resistor is disconnected.", "The cell is reversed.", "The ammeter is in parallel with the resistor.",
  "Another resistor is in series.", "A wire bypasses the resistor.", "The voltmeter loads the circuit.",
  "The resistor is not connected to the cell.", "The circuit has a second branch.", "The current changes with time.",
  "The wire is 2 m long.", "A capacitor is connected across the resistor.",
]) rejectIR(`complete source rejects ${extra}`, meters, p => { p.question = p.question.replace("Find", `${extra} Find`); });
for (const extra of ["and the cell is reversed", "but the wire shorts it", "and an extra resistor is present"]) {
  rejectIR(`inline source residual ${extra}`, meters, p => { p.question = p.question.replace(". Find", ` ${extra}. Find`); });
  rejectIR(`complete given rejects ${extra}`, meters, p => { p.facts[0]!.statement = `The resistor has resistance 10 ohm ${extra}.`; });
}
rejectIR("fact resistance polarity", meters, p => { p.facts[0]!.statement = "The resistor does not have resistance 10 ohm."; });
rejectIR("fact source voltage polarity", meters, p => { p.facts[1]!.statement = "The cell does not provide 5 V."; });
rejectIR("fact ordinal belongs to the source actor", tree, p => { p.facts[0]!.statement = "The third resistor has resistance 2 ohm."; });
rejectIR("fact topology cannot name a partial source group", tree, p => { p.facts.find(row => row.id === "fSeries")!.statement = "The 2 ohm and 3 ohm resistors are connected in series."; });
rejectIR("fact source target group kind", tree, p => { p.facts.find(row => row.id === "fAcross")!.statement = "The series combination is across the 6 V cell."; });
rejectIR("request cannot append a second assertion", tree, p => { p.facts.find(row => row.id === "fReq")!.statement += " The cell is shorted."; });
rejectIR("source request cannot omit its second result", tree, p => { p.facts = p.facts.filter(row => row.id !== "fItot"); p.solveRequests = p.solveRequests.filter(row => row.id !== "srItot"); });
rejectIR("given unit cannot gain a prefix", meters, p => { p.facts[0]!.statement = "The resistor has resistance 10 kohm."; });
rejectIR("wrong canonical AST with same scalar", tree, p => { p.expressions.find(row => row.id === "exprReq")!.root = { kind: "binary", operator: "/", left: { kind: "binary", operator: "+", left: { kind: "number", value: 2 }, right: { kind: "number", value: 4 } }, right: { kind: "number", value: 3 } }; });

rejectIR("group kind does not mean all leaves share that connection", tree, p => { const fact = p.facts.find(row => row.id === "fSeries")!; fact.statement = "The resistors are connected in parallel."; fact.evidence.quote = "connected in parallel"; });
rejectIR("flat fact must retain every leaf in that connection", tree, p => { const fact = p.facts.find(row => row.id === "fSeries")!; fact.statement = "The 2 ohm and 4 ohm and 3 ohm resistors are connected in parallel."; fact.evidence.quote = "connected in parallel"; });
check("independent reverse nested tree and parallel subtotal", () => {
  const plan = structuredClone(treePlan);
  plan.question = "A 2 ohm resistor and a 4 ohm resistor are connected in parallel, and this combination is connected in series with a 3 ohm resistor across a 13 V cell. Find the equivalent resistance and the total current.";
  plan.givens.find(row => row.id === "V")!.value = 13;
  plan.derived.find(row => row.id === "Rs")!.symbol = "R_parallel";
  plan.derived.find(row => row.id === "Itot")!.sourceText = "I_total = 13/(13/3) = 3 A";
  plan.qualitativeClaims = [];
  const source = readStatedCircuitProblemSource(plan.question);
  assert.ok(source);
  assert.equal(source.solution.equivalentResistance.exact, "13/3");
  assert.equal(source.solution.sourceCurrent?.exact, "3");
  assert.deepEqual(source.solution.resistors.map(row => row.current?.value), [2, 1, 3]);
  assert.deepEqual(source.solution.resistors.map(row => row.voltage?.value), [4, 4, 9]);
  const result = strict(plan);
  assert.equal(result.plan.derived.find(row => row.id === "Rs")?.value, 1.33333);
  assert.equal(result.plan.derived.find(row => row.id === "Req")?.value, 4.33333);
  assert.equal(result.plan.derived.find(row => row.id === "Itot")?.value, 3);
});

for (const suffix of ["parallel", "and parallel", "and connected in parallel", "with another resistor", "series"]) check(`tree-reader residual suffix ${suffix}`, () => {
  const question = `A 8 ohm resistor and a 7 ohm resistor are connected in series ${suffix} across a 30 V cell. Find the total current.`;
  assert.equal(readStatedCircuitProblemSource(question), null);
});

for (const [name, edit, withdrawn] of [
  ["missing current dependencies", (p: TurnPlanV3) => { delete p.derived.find(row => row.id === "Itot")!.dependsOn; }, ["Itot"]],
  ["wrong current subtree despite coincident leaf", (p: TurnPlanV3) => { p.derived.find(row => row.id === "Itot")!.dependsOn = ["V", "R1"]; }, ["Itot"]],
  ["request unknown and row identities conflict", (p: TurnPlanV3) => { p.unknowns.find(row => row.id === "Itot")!.symbol = "I1"; }, ["Itot"]],
  ["wrong voltage dependency owner", (p: TurnPlanV3) => { p.derived.push({ id: "badV", symbol: "V1", unit: "V", value: 2, provenance: "derived", dependsOn: ["Itot", "R1"] }); }, ["badV"]],
  ["wrong power dimension", (p: TurnPlanV3) => { p.derived.push({ id: "badP", symbol: "P_total", unit: "W", value: 18, provenance: "derived", dependsOn: ["Req", "Itot"] }); }, ["badP"]],
  ["given owner cannot be inferred from coincidence", (p: TurnPlanV3) => { p.givens.find(row => row.id === "R1")!.symbol = "Req"; }, ["Rs", "Req", "Itot"]],
  ["wrong transitive parallel kind", (p: TurnPlanV3) => { p.derived.find(row => row.id === "Req")!.symbol = "R_series"; }, ["Req", "Itot"]],
  ["duplicate resistance leaf", (p: TurnPlanV3) => { p.derived.find(row => row.id === "Rs")!.dependsOn = ["R1", "R1"]; }, ["Rs", "Req", "Itot"]],
  ["dangling resistance reference", (p: TurnPlanV3) => { p.derived.find(row => row.id === "Rs")!.dependsOn = ["R1", "absent"]; }, ["Rs", "Req", "Itot"]],
  ["current voltage dependency cycle", (p: TurnPlanV3) => { p.derived.find(row => row.id === "Itot")!.dependsOn = ["loopV", "Req"]; p.derived.push({ id: "loopV", symbol: "V_source", unit: "V", value: 6, provenance: "derived", dependsOn: ["Itot", "Req"] }); }, ["Itot", "loopV"]],
] as const) rejectPlan(name, edit, [...withdrawn]);

/** Independent authored full IR: actual source literals, all physical bodies,
 * grouping evidence and complete asks. No reduced surrogate of either capture.
 */
function core(question: string): ProblemIR {
  const problem: ProblemIR = { schemaVersion: "problem-ir/v1", id: "independent", question, facts: [], entities: [], expressions: [], constraints: [], representationIntents: [], solveRequests: [] };
  for (const [i, literal] of readCircuitLiterals(question).entries()) {
    const noun = literal.dimension === "resistance" ? "resistor" : "cell";
    const text = question.slice(literal.start, literal.end);
    const quote = `${text} ${noun}`;
    problem.facts.push({ id: `f${i}`, kind: "given", statement: noun === "resistor" ? `The resistor has resistance ${text}.` : `The cell provides ${text}.`, evidence: { source: "question", quote, start: literal.start, end: literal.start + quote.length } });
    problem.entities.push({ id: `e${i}`, kind: "component", label: quote, evidenceFactIds: [`f${i}`] });
    problem.expressions.push({ id: `x${i}`, valueType: "scalar", root: { kind: "number", value: literal.value }, evidenceFactIds: [`f${i}`] });
  }
  const topology = /connected in (series|parallel)/.exec(question);
  if (topology) problem.facts.push({ id: "topology", kind: "given", statement: `The resistors are ${topology[0]}.`, evidence: { source: "question", quote: topology[0], start: topology.index, end: topology.index + topology[0].length } });
  const start = question.indexOf("Find");
  problem.facts.push({ id: "ask", kind: "requested", statement: question.slice(start), evidence: { source: "question", quote: question.slice(start), start, end: question.length } });
  problem.representationIntents.push({ id: "network", kind: "network", entityIds: problem.entities.map(row => row.id), evidenceFactIds: problem.facts.filter(row => row.kind === "given").map(row => row.id) });
  return problem;
}
for (const [question, resistance, current, drops, branchCurrents] of [
  ["A 13 ohm resistor is connected across a 26 V cell. Find the current.", "13", "2", [26], [2]],
  ["A 8 ohm resistor and a 7 ohm resistor are connected in series across a 30 V cell. Find the equivalent resistance and the total current.", "15", "2", [16, 14], [2, 2]],
  ["A 6 ohm resistor and a 9 ohm resistor are connected in parallel across an 18 V cell. Find the equivalent resistance and the total current.", "18/5", "5", [18, 18], [3, 2]],
  ["A 10 kohm resistor is connected across a 5 V cell. Find the current.", "10000", "1/2000", [5], [.0005]],
] as const) check(`independent normal ${question}`, () => {
  const problem = core(question), snapshot = structuredClone(problem), binding = bindStatedCircuitProblem(question, problem);
  assert.ok(binding);
  assert.equal(binding.problem, problem);
  assert.deepEqual(problem, snapshot);
  assert.equal(binding.solution.equivalentResistance.exact, resistance);
  assert.equal(binding.solution.sourceCurrent?.exact, current);
  assert.deepEqual(binding.solution.resistors.map(row => row.voltage?.value), [...drops]);
  assert.deepEqual(binding.solution.resistors.map(row => row.current?.value), [...branchCurrents]);
  assert.equal(checkVisualObligations(deriveVisualObligations(problem), binding.document).satisfied, true);
  assert.equal(compileSceneDocument(binding.document).ok, true);
  assert.deepEqual(checkStatedCircuitProblemBinding(question, problem, binding.document), []);
});
for (const problem of [meters, tree]) check(`original full IR ${problem.id}`, () => {
  const snapshot = structuredClone(problem), binding = bindStatedCircuitProblem(problem.question, problem);
  assert.ok(binding);
  assert.equal(binding.problem, problem);
  assert.deepEqual(problem, snapshot);
  assert.equal(binding.factBindings.length, problem.facts.length);
  assert.equal(binding.entityBindings.length, problem.entities.length);
  assert.equal(binding.expressionBindings.length, problem.expressions.length);
  assert.equal(checkVisualObligations(deriveVisualObligations(problem), binding.document).satisfied, true);
  assert.equal(compileSceneDocument(binding.document).ok, true);
  assert.deepEqual(checkStatedCircuitProblemBinding(problem.question, problem, binding.document), []);
});
check("positive explicit meter connection facts", () => {
  const problem = structuredClone(meters);
  const ammeter = problem.facts.find(row => row.id === "fIdealAmmeter")!;
  ammeter.kind = "given"; ammeter.statement = "The ammeter is in series with the resistor.";
  const voltmeter = problem.facts.find(row => row.id === "fIdealVoltmeter")!;
  voltmeter.kind = "given"; voltmeter.statement = "The voltmeter is across the resistor.";
  assert.ok(bindStatedCircuitProblem(problem.question, problem));
});
check("positive single current dependencies", () => {
  const plan = fixture<TurnPlanV3>("w1-ohm-meters-captured-plan");
  assert.equal(strict(plan).plan.derived.find(row => row.id === "I")?.value, .5);
});
check("positive source-parallel branch current and its voltage", () => {
  const plan = structuredClone(treePlan);
  plan.derived.push({ id: "branchI", symbol: "I3", unit: "A", value: 9, provenance: "derived", dependsOn: ["V", "R3"] });
  plan.derived.push({ id: "branchV", symbol: "V3", unit: "V", value: 9, provenance: "derived", dependsOn: ["branchI", "R3"] });
  plan.derived.push({ id: "totalP", symbol: "P_total", unit: "W", value: 9, provenance: "derived", dependsOn: ["V", "Itot"] });
  const result = strict(plan);
  assert.equal(result.plan.derived.find(row => row.id === "branchI")?.value, 2);
  assert.equal(result.plan.derived.find(row => row.id === "branchV")?.value, 6);
  assert.equal(result.plan.derived.find(row => row.id === "totalP")?.value, 18);
});
check("positive series voltage follows source current through the same load", () => {
  const plan: TurnPlanV3 = { ...structuredClone(treePlan), question: "A 8 ohm resistor and a 7 ohm resistor are connected in series across a 30 V cell. Find the total current.", givens: [
    { id: "R1", symbol: "R1", unit: "ohm", value: 8, provenance: "given" }, { id: "R2", symbol: "R2", unit: "ohm", value: 7, provenance: "given" }, { id: "V", symbol: "V", unit: "V", value: 30, provenance: "given" },
  ], unknowns: [{ id: "Itot", symbol: "I_total", unit: "A" }], derived: [
    { id: "Req", symbol: "Req", unit: "ohm", value: 15, provenance: "derived", dependsOn: ["R1", "R2"] },
    { id: "Itot", symbol: "I_total", unit: "A", value: 2, provenance: "derived", dependsOn: ["V", "Req"] },
    { id: "drop", symbol: "V1", unit: "V", value: 16, provenance: "derived", dependsOn: ["Itot", "R1"] },
  ], qualitativeClaims: [] };
  assert.equal(strict(plan).plan.derived.find(row => row.id === "drop")?.value, 16);
});
for (const question of [
  "A 10 ohm resistor is connected across a 250 mV cell. Find the current.",
  "A 1/2 ohm resistor is connected across a 3 V cell. Find the current.",
  "A 10 ohm resistor is connected across a 5 V cell. Find the power.",
  "A cell of emf 6 V and internal resistance 1 ohm is connected to a 3 ohm resistor. Find the current.",
  "A 2 ohm resistor in series with a 4 ohm resistor in parallel with a 3 ohm resistor across a 6 V cell. Find the total current.",
  "Draw a labelled diagram for series and parallel combinations of resistors.",
]) check(`explicit scope decline ${question}`, () => { assert.equal(readStatedCircuitProblemSource(question), null); });
console.log(`W2 Ohm corrections: ${checks} checks, ${failures} failures; offline only, READY 0 / accepted 0.`);
process.exitCode = failures ? 1 : 0;
