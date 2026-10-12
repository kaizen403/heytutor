import assert from "node:assert/strict";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { compileSceneDocument } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";

const question = "Find the point of intersection of the lines 2x+y=7 and x-y=2.";
const base = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const };
const plan = { ...base, unknowns: [{ id: "x", symbol: "x" }, { id: "y", symbol: "y" }],
  derived: [{ id: "x", symbol: "x", value: 3, provenance: "derived" as const }, { id: "y", symbol: "y", value: 1, provenance: "derived" as const }] };
let checks = 0;
const selected = selectVerifiedRepresentation({ question, turnPlan: plan });
assert.equal(selected.figureSource, "linear_source"); checks++;
assert.equal(liveSceneSaveFailure({ question, turnPlan: plan, document: selected.sceneDocument, tier: selected.tier }), null); checks++;
assert(selectProductionScene({ question, turnPlan: plan, fastRepresentation: selected, problemIR: null }).representation); checks++;
const compiled = compileSceneDocument(selected.sceneDocument);
assert(compiled.ok && compiled.renderScene);
assert.equal(selectVerifiedRepresentation({ question, turnPlan: plan, preferPlanner: true,
  exact: { sceneDocument: selected.sceneDocument, renderScene: compiled.renderScene, validationReport: compiled.report } }).figureSource,
"planner", "A usable planner scene must precede a source-reader fallback"); checks++;
const stale = structuredClone(plan); stale.derived[0]!.value = 4;
assert.equal(selectVerifiedRepresentation({ question, turnPlan: stale }).figureSource, "text_only"); checks++;
assert.match(liveSceneSaveFailure({ question, turnPlan: stale, document: selected.sceneDocument, tier: selected.tier }) ?? "", /linear_source_plan_value_mismatch/); checks++;
const changed = structuredClone(selected.sceneDocument);
changed.constructions[0]!.inputs.equations = ["2x+y=8", "x-y=2"];
assert.equal(selectProductionScene({ question, turnPlan: plan, candidate: changed as unknown as Record<string, unknown>, problemIR: null }).candidateValidation?.valid, false); checks++;
const regionOnly = "Maximize Z=3x+2y subject to x>=0,y>=0,x+y<=8,x<=5. Show feasible region.";
const lpPlan = { ...createFallbackTurnPlanV3(regionOnly), visualRequirement: "required" as const,
  unknowns: [{ id: "z", symbol: "Z" }], derived: [
    { id: "z", symbol: "Z", value: 21, provenance: "derived" as const },
    { id: "intermediate_x", symbol: "x", value: 5, provenance: "derived" as const },
    { id: "intermediate_y", symbol: "y", value: 3, provenance: "derived" as const },
  ] };
const region = selectVerifiedRepresentation({ question: regionOnly, turnPlan: lpPlan });
assert.equal(region.figureSource, "linear_source", "Correct intermediate coordinates cannot veto a region-only request"); checks++;
assert.equal(liveSceneSaveFailure({ question: regionOnly, turnPlan: lpPlan, document: region.sceneDocument, tier: region.tier }), null); checks++;
for (const source of [
  "Find the angle between the lines x-y=0 and x+y=0.",
  "Find the distance between the parallel lines 3x+4y=7 and 3x+4y=12.",
  "Find the bisectors of the angles between the lines x+y-1=0 and x-y+1=0.",
  "Find the intersection of y=2x+1 and y=-x+4, and the tangent of the acute angle between them.",
]) {
  const turnPlan = { ...createFallbackTurnPlanV3(source), visualRequirement: "required" as const };
  const representation = selectVerifiedRepresentation({ question: source, turnPlan });
  assert.notEqual(representation.figureSource, "linear_source", "A source solution-set figure cannot replace requested line geometry"); checks++;
  assert(!representation.reason.includes("linear_source_plan_"), "Unsupported native roles do not veto the existing planner pipeline"); checks++;
}
console.log(`Live linear source plan admission: ${checks} checks passed`);
