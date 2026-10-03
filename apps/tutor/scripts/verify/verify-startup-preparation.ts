import assert from "node:assert/strict";
import { type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { turnPlanNeedsNumericAuthority } from "../../features/tutor-session/lib/scene/diagramGeneration";

const question = "Derive the formula for the range of a projectile on level ground, and show why 45° gives the maximum range.";
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question,
  givens: [],
  unknowns: [{ id: "range", symbol: "R" }],
  derived: [],
  qualitativeClaims: [
    { id: "range", claim: "R = u^2 sin(2 theta) / g", expected: "u^2 sin(2 theta) / g", relatedQuantityIds: ["range"] },
    { id: "maximum_angle", claim: "The stated 45 degree launch angle maximizes range", expected: "45 degrees" },
  ],
  lawIds: ["constant-acceleration"],
  assumptions: ["Air resistance is negligible"],
  visualRequirement: "required",
};

const fast = selectFastVerifiedRepresentation({ question, turnPlan: plan });
assert(fast, "a source-grounded projectile diagram must not require scene-model rounds");
assert.equal(fast.validationReport.valid, true);
assert.equal(fast.tier, "qualitative_verified");
assert.equal(fast.nonMetric, true);
assert(fast.renderScene.primitives.some((primitive) => primitive.kind === "label"));
assert.equal(turnPlanNeedsNumericAuthority(question, plan), true,
  "numeric source facts must not bypass formulation when the model omits numeric fields");
assert.equal(turnPlanNeedsNumericAuthority("Derive the formula for projectile range on level ground.", plan), false,
  "a purely symbolic relation without numeric source inputs need not request numeric formulation");
assert.equal(turnPlanNeedsNumericAuthority(question, {
  ...plan, derived: [{ id: "range", symbol: "R", value: 45, unit: "m", provenance: "derived" }],
}), true, "a numeral belonging to an angle must not authorize an invented distance");
assert.equal(turnPlanNeedsNumericAuthority("Calculate 2 + 3.", {
  ...plan, question: "Calculate 2 + 3.", derived: [{ id: "sum", symbol: "sum", value: 3, provenance: "derived" }],
}), true, "a number occurring in an arithmetic question is not its answer authority");
for (const numericalQuestion of [
  "What is 2 + 3?", "Explain how to solve x^2 - 5x + 6 = 0.", "Derive an expression for 2 + 3.",
  "Derive the formula for projectile range and give the value for u = 20 m/s and theta = 30 degrees.",
  "Derive the formula for projectile range and give the value for a speed of 20 m/s at an angle of 30 degrees.",
]) {
  assert.equal(turnPlanNeedsNumericAuthority(numericalQuestion, {
    ...plan,
    question: numericalQuestion,
    unknowns: [{ id: "sum", symbol: "sum" }],
    derived: [],
    qualitativeClaims: [{ id: "positive", claim: "The result is positive", expected: true, relatedQuantityIds: ["sum"] }],
  }), true, "an explanation verb or a qualitative claim cannot bypass a numerical solve");
}
assert.equal(turnPlanNeedsNumericAuthority(question, {
  ...plan, derived: [{ id: "range", symbol: "R", value: 12345, unit: "m", provenance: "derived" }],
}), true, "an unstated numeric result must still go through the independent solver");
assert.equal(turnPlanNeedsNumericAuthority(question, {
  ...plan, givens: [{ id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given" }],
}), true, "numeric givens must retain independent solver authority");
assert.equal(turnPlanNeedsNumericAuthority(question, {
  ...plan, unknowns: [...plan.unknowns, { id: "electric_charge", symbol: "q", unit: "C" }],
}), true, "an unanswered unknown must not skip solver formulation");

assert.equal(selectFastVerifiedRepresentation({ question, turnPlan: { ...plan, visualRequirement: "none" } }), null,
  "a text-only lesson must not build an unsolicited diagram");
assert.equal(selectFastVerifiedRepresentation({ question: "Explain a philosophical argument about fairness.", turnPlan: { ...plan, question: "Explain a philosophical argument about fairness." } }), null,
  "an unsupported source must still use the normal planner rather than a generic shortcut");
assert.equal(selectFastVerifiedRepresentation({
  question,
  turnPlan: { ...plan, givens: [{ id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given" }] },
}), null, "an invented measurement cannot enter the fast path");
assert.equal(selectFastVerifiedRepresentation({
  question,
  turnPlan: { ...plan, derived: [{ id: "range", symbol: "R", value: 12345, unit: "m", provenance: "derived" }] },
}), null, "a qualitative shortcut cannot replace an unstated numerical solution");

console.log("verify-startup-preparation: deterministic startup remains verified, relevant and honest about numeric authority");
