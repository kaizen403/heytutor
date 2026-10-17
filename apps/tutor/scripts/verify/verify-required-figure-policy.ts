import assert from "node:assert/strict";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { deriveSceneGate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { applySourceVisualDemand, requiredFigurePolicyEnabled, sourceVisualDemand } from "../../features/tutor-session/lib/scene/requiredFigurePolicy";
import { readFileSync } from "node:fs";

const question = "Explain how resistance changes with temperature.";
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [{ id: "c1", claim: "relation", expected: "Resistance increases with temperature over a limited range." }],
  lawIds: [], assumptions: [], visualRequirement: "none",
};
const rescued = deriveSceneGate({ question, turnPlan: plan, problemIR: null,
  visualNeedDecision: null, requiredFigurePolicyEnabled: true });
assert.equal(rescued.turnPlan.visualRequirement, "optional", "a meaningful explanatory relationship must not be voted no-visual");
assert.equal(rescued.shouldPlanExactScene, true);
assert.equal(rescued.shouldAttemptLlmScene, true, "generic checked operators can serve an explanatory relation without a named family");
assert.equal(rescued.waitForRequiredScenePeers, false, "a helpful optional relation must not extend a decline wait");
assert.equal(plan.visualRequirement, "none", "source plan must remain immutable");
const off = deriveSceneGate({ question, turnPlan: plan, problemIR: null,
  visualNeedDecision: null, requiredFigurePolicyEnabled: false });
assert.equal(off.turnPlan.visualRequirement, "none");
assert.equal(off.shouldAttemptLlmScene, false);
assert.equal(off.waitForRequiredScenePeers, false);
assert.strictEqual(applySourceVisualDemand(plan, sourceVisualDemand(question, plan), false), plan);

for (const textOnly of [
  "Define a conservative force in one sentence.", "What is the SI unit of resistance?",
  "Who introduced the uncertainty principle?", "Factor x^2 - 9.", "Solve 3x + 7 = 19.",
  "State the definition of half-life in one sentence.", "Define the term circuit without drawing anything.",
  "Give the etymology of the word geometry.", "Simplify (a+b)^2 - (a-b)^2 algebraically.",
  "What does R stand for in Ohm's law?", "State the units of amplitude, period and frequency.",
  "Give a brief history of ray optics, without a diagram.",
  "Evaluate the limit as x approaches 2 of (x^2 - 4)/(x - 2).",
  "Find (2i + j) × (i - 2j).", "Explain the definition of force.",
  "Define a scatter plot in one sentence.",
  "Explain how a resistor works, but do not draw anything.",
  "Explain how the terms change in (a+b)^2 = a^2 + 2ab + b^2.",
  "Explain the difference between the two expressions x+1 and x-1.",
  "Explain how to simplify x^2 times x^3 by increasing the exponent.",
]) {
  const p = { ...plan, question: textOnly };
  assert.equal(sourceVisualDemand(textOnly, p), null, textOnly);
  assert.strictEqual(applySourceVisualDemand(p, sourceVisualDemand(textOnly, p), true), p, textOnly);
}
for (const explicitTextOnly of ["Define a scatter plot in one sentence.",
  "Explain how a resistor works, but do not draw anything.", "Give a history of the circuit."]) {
  const p = { ...plan, question: explicitTextOnly, visualRequirement: "required" as const };
  const gate = deriveSceneGate({ question: explicitTextOnly, turnPlan: p, problemIR: null,
    visualNeedDecision: null, requiredFigurePolicyEnabled: true });
  assert.equal(gate.turnPlan.visualRequirement, "none", explicitTextOnly);
  assert.equal(gate.shouldAttemptLlmScene, false, explicitTextOnly);
  assert.equal(gate.waitForRequiredScenePeers, false, explicitTextOnly);
}
for (const spatial of [
  "A particle follows x(t) = 0.04 cos(5πt) m. Find its positions at t = 0 and 0.1 s.",
  "Find the angle between two intersecting planes.",
  "Explain the forces acting on a block on an incline.",
  "Trace the rays through a glass prism.",
  "Sketch the graph of y = x^2.",
  "Define a normal force and draw the forces on a block.",
  "Could you plot y = x^2?",
  "What is the mean distance between two planes?",
  "Find the angle between two planes using the definition of a normal.",
]) {
  const p = { ...plan, question: spatial };
  const gate = deriveSceneGate({ question: spatial, turnPlan: p, problemIR: null,
    visualNeedDecision: null, requiredFigurePolicyEnabled: true });
  assert.equal(gate.turnPlan.visualRequirement, "required", spatial);
  assert.equal(gate.waitForRequiredScenePeers, true, spatial);
}
for (const explanatory of [
  "Explain conservative and non-conservative forces.",
  "Explain radioactive decay and half-life.", "Explain exponential growth and decay.",
  "Explain how pressure varies with depth.",
]) {
  const p = { ...plan, question: explanatory };
  assert.equal(applySourceVisualDemand(p, sourceVisualDemand(explanatory, p), true).visualRequirement, "optional", explanatory);
}
assert.equal(applySourceVisualDemand(plan, sourceVisualDemand(question, plan), true, "none").visualRequirement, "none",
  "an explicit advisory no-visual is not unavailability");
const requiredPlan = { ...plan, visualRequirement: "required" as const };
assert.strictEqual(applySourceVisualDemand(requiredPlan, null, true), requiredPlan);
const noVisual = deriveSceneGate({ question, turnPlan: plan, problemIR: null,
  visualNeedDecision: "none", requiredFigurePolicyEnabled: true });
const finalNoVisual = deriveSceneGate({ question, turnPlan: noVisual.turnPlan, problemIR: null,
  visualNeedDecision: "none", requiredFigurePolicyEnabled: true });
assert.equal(noVisual.turnPlan.visualRequirement, "none");
assert.equal(finalNoVisual.turnPlan.visualRequirement, "none", "final admission must retain the advisory used before the picker");
const oldFlag = process.env.NEXT_PUBLIC_REQUIRED_FIGURE_POLICY;
try {
  delete process.env.NEXT_PUBLIC_REQUIRED_FIGURE_POLICY;
  assert.equal(requiredFigurePolicyEnabled(), false);
  process.env.NEXT_PUBLIC_REQUIRED_FIGURE_POLICY = "1";
  assert.equal(requiredFigurePolicyEnabled(), true, "read after local environment loading, not at import");
} finally {
  if (oldFlag === undefined) delete process.env.NEXT_PUBLIC_REQUIRED_FIGURE_POLICY;
  else process.env.NEXT_PUBLIC_REQUIRED_FIGURE_POLICY = oldFlag;
}
for (const file of ["features/tutor-session/hooks/turn/useQuestionHandler.ts", "scripts/lecture-lab/lecturePipeline.ts"]) {
  const source = readFileSync(file, "utf8");
  assert.ok(source.includes("waitForRequiredScenePeers: gate.waitForRequiredScenePeers"), `${file} must use the shared gate's required-only decision`);
  assert.ok(source.includes("deriveProductionSceneGate({"), `${file} must use shared admission`);
  assert.ok(source.includes(file.startsWith("features/") ? "visualNeedDecision: evaluatedVisualNeed" : "visualNeedDecision: assessment.decision"),
    `${file} must retain the advisory through final admission`);
}
console.log("Required figure policy verified");
