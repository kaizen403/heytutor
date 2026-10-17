import assert from "node:assert/strict";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { compileSceneDocument } from "@heytutor/scene-engine";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

let checks = 0;
for (const question of [
  "Graph -2x+3y<6. Mark P=(0,0), Q=(3,0).",
  "Represent x<=-2 or x>3 on a number line.",
  "Graph x+y=6 and x-y=2 and find their intersection.",
  "Maximize Z=3x+2y subject to x>=0, y>=0, x+y<=8 and x<=5. Show the feasible region and the optimal point.",
]) {
  const turnPlan = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const };
  const selected = selectVerifiedRepresentation({ question, turnPlan, preferPlanner: true });
  assert.equal(selected.figureSource, "linear_source"); checks++;
  assert(selected.renderScene.primitives.some(p => p.kind === "label" && p.text?.trim())); checks++;
  const live = selectProductionScene({ question, turnPlan, problemIR: null, fastRepresentation: selected });
  assert(live.representation && live.hasReadableInk); checks++;
  // A provenance tag is not permission to admit an actually unlabeled scene.
  const unlabeled = { ...selected, renderScene: { ...selected.renderScene,
    primitives: selected.renderScene.primitives.filter(p => p.kind !== "label" && p.kind !== "dimension") } };
  const refused = selectProductionScene({ question, turnPlan, problemIR: null, fastRepresentation: unlabeled });
  assert.equal(refused.representation, null); checks++;
  assert.equal(refused.reason, "representation carries no readable label"); checks++;
  // Whole-source proof still precedes label eligibility.
  const changed = structuredClone(selected.sceneDocument);
  const call = changed.constructions[0]!;
  if (call.operator === "number_line_set") call.inputs.expression = { inequality: "x>=999" };
  else if (call.operator === "linear_system") call.inputs.equations = ["x+y=99", "x-y=2"];
  else if (call.operator === "linear_half_plane") call.inputs.inequality = "-2x+3y<=6";
  else call.inputs.constraints = ["x>=0", "y>=0", "x+y<=99", "x<=5"];
  assert.equal(compileSceneDocument(changed).ok, false); checks++;
  assert.equal(validateProductionSceneCandidate({ question, turnPlan, candidate: changed as unknown as Record<string, unknown> }).valid, false); checks++;
}
const question = "Maximize Z=3x+2y subject to x>=0,y>=0,x+y<=8,x<=5. Show the feasible region and optimal point.";
const turnPlan = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const,
  derived: [{ id: "objective", symbol: "Z", value: 999, unit: "1", provenance: "derived" as const }] };
const declined = selectProductionScene({ question, turnPlan, problemIR: null });
assert.equal(declined.representation, null); checks++;
assert.match(declined.selectionReason, /linear_source_plan_value_mismatch/); checks++;
assert.equal(declined.reason, declined.selectionReason, "Text-only authority refusal must retain its cause rather than claim a built figure lacks labels"); checks++;
console.log(`linear readable admission: ${checks} live ownership/label/refusal-attribution checks passed`);
