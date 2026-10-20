import assert from "node:assert/strict";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { circularPlannerCases } from "../../../../packages/scene-engine/scripts/verify/fixtures/rotation-origin-source-cases";

let checks = 0;
for (const { question, variant, document, turnPlan } of circularPlannerCases()) {
  const result = validateProductionSceneCandidate({ candidate: { ...document }, question, turnPlan });
  assert.equal(result.valid, false, `${variant}: production must refuse unsupported circular laws`);
  assert.ok(result.errors?.some((issue) => issue.code === "ucm_source_unsupported" && issue.severity === "fatal"),
    `${variant}: production retains fatal numeric circular source authority`);
  checks += 2;
}
for (const { question, variant, document, turnPlan } of circularPlannerCases([""])) {
  const result = validateProductionSceneCandidate({ candidate: { ...document }, question, turnPlan });
  assert.equal(result.valid, variant === "plain program", "ordinary numeric circular admission stays unchanged");
  if (variant !== "plain program") assert.ok(result.errors?.some((issue) => issue.code === "ucm_source_mismatch"));
  checks += variant === "plain program" ? 1 : 2;
}
console.log(`Rotation source production admission: ${checks} checks passed (12 unsupported candidates).`);
