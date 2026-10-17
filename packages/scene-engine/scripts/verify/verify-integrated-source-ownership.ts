import assert from "node:assert/strict";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { applySourceQuantityAuthority } from "../../src/ir/sourceQuantityAuthority";
import { applyOpticsSourceAuthority } from "../../src/physics/opticsSourceAuthority";

const question = "A ball is projected from the top of a 45 m cliff with a speed of 20 m/s at 30° above the horizontal. Take g = 10 m/s^2. Find the time taken to reach the highest point and the vertical component of the initial velocity.";
const base: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [],
  derived: [
    { id: "t", symbol: "t", value: 1, unit: "s", provenance: "derived", sourceText: "Time to highest point t = u sin(theta) / g = 1 s" },
    { id: "v_y", symbol: "v_y", value: 10, unit: "m/s", provenance: "derived", sourceText: "Initial vertical component v_y = u sin(theta) = 10 m/s" },
  ], qualitativeClaims: [], assumptions: [], lawIds: [], visualRequirement: "required",
};
const preserved = applySourceQuantityAuthority(base, null, question);
assert.deepEqual(preserved.plan.derived, base.derived, "apex time and initial velocity keep their source roles");
assert.equal(preserved.outcomes.flatMap(outcome => outcome.corrections).length, 0, "a different ballistic event supplies no correction");
const landing = structuredClone(base);
landing.question = question.replace("Find the time taken to reach the highest point and the vertical component of the initial velocity.", "Find total flight time and vertical landing velocity.");
landing.derived[0]!.sourceText = "Total flight time t = 1 s";
landing.derived[1]!.sourceText = "Vertical landing velocity v_y = 10 m/s";
const corrected = applySourceQuantityAuthority(landing, null, landing.question).plan;
assert.ok(Math.abs(corrected.derived[0]!.value - (1 + Math.sqrt(10))) < 1e-8, "proven total flight time is corrected");
assert.ok(Math.abs(corrected.derived[1]!.value + Math.sqrt(1000)) < 1e-8, "proven landing velocity is corrected");
for (const q of base.derived) delete q.sourceText;
assert.deepEqual(applySourceQuantityAuthority(base, null, question).plan.derived, base.derived, "bare symbols cannot establish the ballistic event");

const mirror = "A 4 cm tall object is placed 30 cm in front of a concave mirror with focal length 20 cm. Using the standard Cartesian sign convention, determine the image position.";
for (const [unit, oldValue, expected] of [["m", -0.6, -0.6], ["cm", -50, -60], ["mm", -500, -600]] as const) {
  const plan: TurnPlanV3 = { ...base, question: mirror,
    unknowns: [{ id: "v_img", symbol: "v_img", unit }],
    derived: [{ id: "v_img", symbol: "v_img", unit, value: oldValue, provenance: "derived", dependsOn: [], sourceText: `v_img = ${oldValue} ${unit}` }],
  };
  const result = applyOpticsSourceAuthority(mirror, plan)!.plan;
  const value = result.derived.find(q => q.id === "v_img");
  assert.ok(value, "retain the solver-bound quantity identifier");
  assert.equal(value.symbol, "v_img");
  assert.equal(value.unit, unit);
  assert.ok(Math.abs(value.value - expected) < 1e-8);
  assert.deepEqual(result.unknowns, plan.unknowns, "unknown and result retain the same binding");
}
console.log("Integrated source ownership: apex/initial/unknown roles preserved, flight/landing controls corrected, three mirror unit bindings pass");
