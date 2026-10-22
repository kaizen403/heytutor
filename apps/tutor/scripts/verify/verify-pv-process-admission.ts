import assert from "node:assert/strict";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { conceptualPvDocument, physicalPvDocument, pvTurnPlan } from "../../../../packages/scene-engine/scripts/verify/fixtures/pv-process-cases";
import type { SceneDocument } from "@heytutor/scene-engine";

const question = "Plot the named ideal-gas processes: A is 200 kPa and 1 L; B is 100 kPa and 2 L; C is 50 kPa and 2 L. A to B is isothermal; A to C is reversible adiabatic with gamma 2.";
const source = physicalPvDocument(); const turnPlan = pvTurnPlan(source, question);
let checks = 0;
function admission(document: SceneDocument, expected: boolean, reason: string): void {
  for (const yieldPolicy of [undefined, "verified_parts"] as const) {
    const result = validateProductionSceneCandidate({ candidate: JSON.parse(JSON.stringify(document)), question, turnPlan, yieldPolicy });
    assert.equal(result.valid, expected, `${reason}: ${JSON.stringify(result.errors)}`); checks++;
  }
}
admission(source, true, "known quantity references retain source agreement");
const literals = structuredClone(source);
(literals.constructions[0]!.inputs.states as Record<string, unknown>[])[0]!.pressure = 200;
admission(literals, false, "physical literals cannot bypass source agreement");
const changedQuantity = structuredClone(source); changedQuantity.quantities[0]!.value = 900;
admission(changedQuantity, false, "physical reference values must match the plan");
const wrapped = structuredClone(source);
for (const quantity of wrapped.quantities.filter((candidate) => ["pa", "pb", "pc"].includes(candidate.id))) {
  const original = quantity.id; quantity.id = `evil_${original}`; quantity.value = { value: Number(quantity.value) * 4.5, unit: "kPa" };
  for (const state of wrapped.constructions[0]!.inputs.states as Record<string, unknown>[]) if (state.pressure === original) state.pressure = quantity.id;
}
admission(wrapped, false, "unmatched object-valued quantities cannot launder physical states past plan agreement");
for (const value of ["900", { value: "900", unit: "kPa" }, { value: { value: 900, unit: "kPa" }, unit: "kPa" }]) {
  const document = structuredClone(wrapped); document.quantities[0]!.value = value;
  admission(document, false, "nested/string numeric wrappers never become physical authority");
}
for (const change of [
  (d: SceneDocument) => { (d.constructions[0]!.inputs.states as Record<string, unknown>[])[0]!.pressure = "missing"; },
  (d: SceneDocument) => { delete d.quantities[0]!.unit; },
  (d: SceneDocument) => { d.quantities[0]!.unit = "Pa"; },
  (d: SceneDocument) => { d.quantities.find((quantity) => quantity.id === "gamma")!.unit = "kPa"; },
  (d: SceneDocument) => { d.entities[0]!.label = "gamma=1.4"; },
  (d: SceneDocument) => { d.annotations.push({ id: "wrong", kind: "label", targetIds: ["plot"], text: "W=999 J" }); },
]) { const document = physicalPvDocument(); change(document); admission(document, false, "missing/unit-mismatched references and claims fail closed"); }
const conceptual = conceptualPvDocument();
const conceptQuestion = "Compare an isobaric ideal-gas process schematically between named states.";
assert.equal(validateProductionSceneCandidate({ candidate: { ...conceptual }, question: conceptQuestion, turnPlan: pvTurnPlan(conceptual, conceptQuestion) }).valid, true);
async function persistence(): Promise<void> {
  for (const [document, prompt] of [[source, question], [conceptual, conceptQuestion]] as const) {
    document.source.question = prompt;
    const plan = pvTurnPlan(document, prompt);
    const selected = selectProductionScene({ question: prompt, turnPlan: plan, problemIR: null, candidate: { ...document }, policy: { preferPlanner: true } });
    assert.ok(selected.representation && selected.representation.sceneDocument.constructions.some((construction) => construction.operator === "pv_process"), `native plot must survive actual selection: ${selected.reason}`); checks++;
    const representation = selected.representation;
    if (document === conceptual) assert.equal(representation.tier, "qualitative_verified", "a conceptual plot never becomes exact physical authority");
    const payload = { question: prompt, visualStatus: "validated" as const, sceneDocument: representation.sceneDocument, segments: [],
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: representation.tier, nonMetric: representation.nonMetric, diagramResultStatus: "ready", turnPlan: plan } };
    const saved = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify(payload)));
    assert.ok(saved.ok, `source-validated plot must save: ${!saved.ok && saved.error}`); checks++;
    const forged = structuredClone(payload); forged.sceneDocument.entities[0]!.label = "W=999 J";
    assert.equal((await canonicalizeTurnSceneMetadata(forged)).ok, false, "save revalidates sealed output claims rather than trusting ready/tier flags"); checks++;
  }
  console.log(`P-V production admission/selection/save: ${checks + 1} checks passed`);
}
void persistence().catch((error) => { console.error(error); process.exitCode = 1; });
