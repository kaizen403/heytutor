import assert from "node:assert/strict";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { compileSceneDocument, validateSceneDocument, validateTurnPlanV3, type SceneDocument } from "@heytutor/scene-engine";
import { auditOriginalMassSourceGivens } from "../../../../packages/scene-engine/src/physics/atomicMassSource";
import { scene, pt } from "../../../../packages/scene-engine/scripts/probes/evaluationCompileProbes";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const question = "Draw a labelled circle and its centre.";
const point = pt("origin", 0, 0, "centre", "O");
function circle(label = "circle"): SceneDocument {
  const document = validateSceneDocument(scene(question,
    [point.entity, { id: "disk", kind: "circle", role: "circle", label }],
    [point.construction, { id: "make_disk", operator: "circle", inputs: { center: "origin", radius: 2 }, outputs: ["disk"] }])).document;
  assert(document);
  return document;
}
let checks = 0;
for (const [unit, text] of [
  ["g", "12 g:"], ["g", "12 g"], ["g", "12g:"], ["g", "12 g]"],
  ["g", "$12 g$"], ["g", "12 \\mathrm{g}"], ["g", "12 \\text{g}"],
  ["g", "\\(12 g\\)"], ["g", "[12 g]"], ["g", "12 g}"],
  ["g", "12 g!"], ["g", "12 g?"], ["g", "12 g—"],
  ["kg", "12 kg:"], ["u", "12 u:"], ["g", "M=12 g:"],
  ["g", "(m=12)"], ["g", "12 grams"], ["kg", "12 kilogram:"], ["kg", "12 kilograms"],
  ["u", "12 Da"],
] as const) for (const surface of ["entity", "annotation", "construction"] as const) {
  const plan = createFallbackTurnPlanV3(question);
  plan.givens = [{ id: "m", symbol: "m", value: 12, unit, provenance: "given" }];
  assert(validateTurnPlanV3(plan, question).valid);
  const document = circle(surface === "entity" ? text : "circle");
  if (surface === "annotation") document.annotations.push({ id: "mass_ink", kind: "callout", targetIds: ["disk"], text });
  if (surface === "construction") {
    document.entities.push({ id: "mass_ink", kind: "label", role: "label", label: text });
    document.constructions.push({ id: "make_mass_ink", operator: "label", inputs: { target: "disk", text }, outputs: ["mass_ink"] });
    document.requiredEntityIds.push("mass_ink");
    document.revealGroups[0]!.entityIds.push("mass_ink");
  }
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, `${surface}/${text}: the candidate reaches actual renderable ink: ${JSON.stringify(compiled.report)}`);
  assert(auditOriginalMassSourceGivens(document, plan).issues.some(issue => issue.code === "atomic_mass_source_unbound" && issue.severity === "fatal"), `${surface}/${text}`);
  const candidate = validateProductionSceneCandidate({ candidate: { ...document }, question, turnPlan: plan });
  assert(!candidate.valid && candidate.errors.some(issue => issue.code === "atomic_mass_source_unbound"), `${surface}/${text}: actual admission`);
  const selected = selectProductionScene({ question, turnPlan: plan, problemIR: null, candidateValidation: candidate, policy: { preferPlanner: true } });
  assert(!selected.representation?.renderScene.primitives.some(primitive => primitive.kind === "label" && /12/.test(primitive.text ?? "")), `${surface}/${text}: no invented mass reaches final ink`);
  checks++;
}
{
  const plan = createFallbackTurnPlanV3(question);
  plan.givens = [{ id: "m", symbol: "m", value: 12, unit: "g", provenance: "given" }];
  const document = circle();
  assert.deepEqual(auditOriginalMassSourceGivens(document, plan).issues, []);
  const candidate = validateProductionSceneCandidate({ candidate: { ...document }, question, turnPlan: plan });
  assert(candidate.valid, "unused unrelated planner context preserves ordinary admission");
  const selected = selectProductionScene({ question, turnPlan: plan, problemIR: null, candidateValidation: candidate, policy: { preferPlanner: true } });
  assert(selected.representation, "the unchanged ordinary circle remains available");
  checks++;
}
console.log(`native mass display: ${checks} actual admission/final-selection controls pass; no provider calls`);
