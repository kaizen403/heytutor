/** Bounded duplicate-premise gate for the full captured AP IR and Plan. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ProblemIR, TurnPlanV3 } from "../../src/index";

const mode = process.argv.includes("--esm") ? "built ESM" : "source";
const engine = mode === "built ESM" ? await import("../../dist/index.js") : await import("../../src/index");
const fixture = JSON.parse(readFileSync(new URL("../../fixtures/source/finite-progression-actual-w3-20261006.json", import.meta.url), "utf8"));
const question: string = fixture.question;
const problem = fixture.normalizedProblemIR as ProblemIR;
const plan = fixture.actualPlan as TurnPlanV3;
let checks = 0;
function check(value: unknown, message: string): asserts value { checks++; assert.ok(value, message); }
function equal(actual: unknown, expected: unknown, message: string): void {
  checks++;
  assert.deepEqual(structuredClone(actual), structuredClone(expected), message);
}

const admitted = engine.finiteProgressionSourceProgram(question, problem, plan);
check(admitted.status === "ok", `captured AP must remain admissible: ${admitted.status === "declined" ? admitted.reason : ""}`);
if (admitted.status !== "ok") throw new Error(admitted.reason);
equal(admitted.problem, problem, "preserve every actual fact and the full IR");
equal(admitted.plan, plan, "preserve both actual Plan quantities and the full Plan");
equal(admitted.plan.unknowns.map(quantity => quantity.id), ["progression_result_0", "progression_result_1"], "retain actual unknown IDs");
equal(admitted.plan.derived.map(quantity => quantity.value), [62, 670], "retain both actual derived scalars");
equal(admitted.bindings.map(binding => binding.ask.value), [62, 670], "source-derived answers remain intact");

for (const sourceId of ["fModel", "fFirst", "fDiff"]) {
  const duplicate = structuredClone(problem);
  const original = duplicate.facts.find(fact => fact.id === sourceId)!;
  const duplicateId = `duplicate_${sourceId}`;
  duplicate.facts.push({...structuredClone(original), id: duplicateId});
  duplicate.representationIntents[0]!.evidenceFactIds.push(duplicateId);
  const result = engine.finiteProgressionSourceProgram(question, duplicate, plan);
  check(result.status === "declined", `${sourceId}: identical complete asserted premise under a new ID must decline`);
  if (result.status === "declined") check(/duplicate|repeated|same asserted/i.test(result.reason), `${sourceId}: explicit duplicate-premise rejection (${result.reason})`);
  equal(duplicate.facts.find(fact => fact.id === sourceId), original, `${sourceId}: source fact remains complete`);
  check(duplicate.facts.some(fact => fact.id === duplicateId), `${sourceId}: the attack retains its duplicate fact; no input pruning`);
}

console.log(`${mode}: ${checks} duplicate-premise checks PASS; actual AP capture retained`);
