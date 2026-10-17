import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import { attemptArchetypeScene } from "../../src/archetypes";
import { formatResistorTree, readResistorTree } from "../../src/archetypes/resistorTree";
import { applyStatedCircuitAuthority, solveStatedResistorCircuit } from "../../src/ir/statedCircuitAuthority";

import type { TurnPlanV3 } from "../../src/contracts/contractsV3";

const question = "An ideal 18 V source is connected to a 2 ohm resistor in series with two parallel branches. One branch contains 6 ohm and 3 ohm resistors in series; the other contains an 18 ohm resistor. Draw the circuit, find the equivalent resistance, total current and current through each resistor, and explain the voltage drops.";
const attempt = attemptArchetypeScene({ question });
assert.ok(attempt.scene, `Audited circuit must compile: ${attempt.declined}`);
assert.equal(formatResistorTree(readResistorTree(question)!), "S(0,P(S(1,2),3))");
assert.equal(attempt.scene.document.constructions.filter((c) => c.operator === "symbol" && c.inputs.symbol === "resistor").length, 4);
const solved = solveStatedResistorCircuit(question);
assert.ok(solved);
assert.equal(solved.equivalentResistance.value, 8);
assert.equal(solved.sourceCurrent?.value, 2.25);
assert.deepEqual(solved.resistors.map((r) => r.current?.value), [2.25, 1.5, 1.5, 0.75]);
assert.deepEqual(solved.resistors.map((r) => r.voltage?.value), [4.5, 9, 4.5, 13.5]);
console.log("PASS circuit branch declaration compile + independently solved topology");

function verifyVariant(stem: string, tree: string, resistance: number): void {
  const parsed = readResistorTree(stem);
  assert.ok(parsed, stem);
  assert.equal(formatResistorTree(parsed), tree);
  const candidate = attemptArchetypeScene({ question: stem });
  assert.ok(candidate.scene, candidate.declined);
  assert.equal(candidate.scene.document.constructions.filter((c) => c.operator === "symbol" && c.inputs.symbol === "resistor").length, 4);
  const solution = solveStatedResistorCircuit(stem);
  assert.ok(solution);
  assert.ok(Math.abs(solution.equivalentResistance.value - resistance) < 1e-10);
  assert.equal(candidate.scene.validationReport.issues.filter((issue) => issue.severity === "fatal").length, 0);
}
verifyVariant(question.replace("18 V", "24 V").replace("2 ohm", "4 ohm"), "S(0,P(S(1,2),3))", 10);
verifyVariant(question.replace("current through each resistor", "current in each branch"), "S(0,P(S(1,2),3))", 8);
verifyVariant(question.replace("One branch", "The first branch").replace("the other contains", "the second branch has"), "S(0,P(S(1,2),3))", 8);
verifyVariant(question.replace("resistors in series;", "resistors in parallel;"), "S(0,P(1,2,3))", 3.8);
verifyVariant("A 12 V source is connected to two parallel branches. One branch contains 4 ohm and 8 ohm resistors in series; the other contains 6 ohm and 6 ohm resistors in series. Draw the circuit.", "P(S(0,1),S(2,3))", 6);
verifyVariant("A 12 V source is connected to a 3 ohm resistor in series with three parallel branches. The first branch contains a 4 ohm resistor; the second branch contains an 8 ohm resistor; the third branch contains an 8 ohm resistor. Draw the circuit.", "S(0,P(1,2,3))", 5);
for (const invalid of [
  question.replace("contains 6 ohm", "contains -6 ohm"),
  question.replace("One branch contains", "One branch may contain"),
  question.replace("the other contains", "the first branch contains"),
  question.replace("two parallel branches", "three parallel branches"),
  question.replace("resistors in series;", "resistors;"),
  question.replace("resistors in series;", "resistors not in series;"),
  question.replace("an 18 ohm resistor.", "an 18 ohm resistor and a switch."),
  question.replace("Draw the circuit", "Disconnect the second branch. Draw the circuit"),
  question.replace("Draw the circuit", "Draw the circuit with the other branch shorted"),
]) assert.equal(readResistorTree(invalid), null, `Must decline incomplete or ambiguous topology: ${invalid}`);
console.log("PASS changed values, changed branch topology, explicit branch names, and unsafe-declaration rejection");

const renderAt = process.argv.indexOf("--render");
if (renderAt >= 0) writeFileSync(process.argv[renderAt + 1]!, renderSceneSvg(attempt.scene.renderScene, { title: "Declared circuit topology", subtitle: "18 V; 2 ohm in series with (6 + 3) ohm parallel to 18 ohm", guides: false }));

const emptyPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], derived: [], unknowns: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
const recovered = applyStatedCircuitAuthority(question, emptyPlan);
assert.ok(recovered);
assert.deepEqual(recovered.plan.givens.filter(q => /^R\d$/.test(q.symbol)).map(q => q.value), [2, 6, 3, 18], "No planner: independently recover all source resistor inputs");
const conflicted = applyStatedCircuitAuthority(question, { ...emptyPlan, givens: [
  {id:"circuit_R1",symbol:"unrelated",value:12,unit:"s",provenance:"given"},
  {id:"wrong_R1",symbol:"R1",value:6,unit:"Ω",provenance:"given"},
] });
assert.ok(conflicted);
assert.ok(!conflicted.plan.givens.some(q => q.id === "wrong_R1"), "A value from another resistor cannot bind to R1");
assert.equal(conflicted.plan.givens.find(q => q.symbol === "R1")?.value, 2);
assert.equal(new Set([...conflicted.plan.givens, ...conflicted.plan.derived].map(q=>q.id)).size, conflicted.plan.givens.length+conflicted.plan.derived.length);
console.log("PASS missing source inputs, bound-role conflict withdrawal, and collision-safe recovery IDs");
