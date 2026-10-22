import assert from "node:assert/strict";
import { validatePvSourceBinding, type SceneDocument } from "@heytutor/scene-engine";
import { validateProductionSceneCandidate, selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { conceptualPvDocument, physicalPvDocument, pvTurnPlan } from "../../../../packages/scene-engine/scripts/verify/fixtures/pv-process-cases";

const physicalQuestion = "Plot ideal-gas processes: A is 200 kPa and 1 L; B is 100 kPa and 2 L; C is 50 kPa and 2 L. A to B is isothermal; A to C is reversible adiabatic with gamma 2.";
const singleQuestion = "Show an isothermal ideal gas expansion from A at 200 kPa and 1 L to B at 100 kPa and 2 L.";
function singlePhysical(): SceneDocument {
  const document = physicalPvDocument();
  (document.constructions[0]!.inputs.states as unknown[]).pop();
  (document.constructions[0]!.inputs.processes as unknown[]).pop();
  return document;
}
function conceptIsotherm(): SceneDocument {
  const document = conceptualPvDocument();
  document.constructions[0]!.inputs.states = [{ id: "A", pressure: 1, volume: 1 }, { id: "B", pressure: 0.5, volume: 2 }];
  document.constructions[0]!.inputs.processes = [{ kind: "isotherm", from: "A", to: "B" }];
  return document;
}
let checks = 0;
async function check(document: SceneDocument, question: string, expected: boolean, label: string): Promise<void> {
  const plan = pvTurnPlan(document, question);
  // A submitted question field cannot override the request source.
  document.source.question = expected ? question : "Compare an isobaric ideal gas process schematically.";
  assert.equal(validatePvSourceBinding(document, question, plan).length === 0, expected, label); checks++;
  for (const yieldPolicy of [undefined, "verified_parts"] as const) {
    const validation = validateProductionSceneCandidate({ candidate: { ...document }, question, turnPlan: plan, yieldPolicy });
    assert.equal(validation.valid, expected, `${label}: ${JSON.stringify(validation.errors)}`); checks++;
    const selected = selectProductionScene({ candidate: { ...document }, question, turnPlan: plan, problemIR: null, candidateValidation: validation,
      policy: { preferPlanner: true, allowedFigureSources: ["planner"] }, completionEnabled: false, requiredRetryEnabled: false });
    assert.equal(Boolean(selected.representation?.sceneDocument.constructions.some((construction) => construction.operator === "pv_process") && selected.sourceAllowed && !selected.saveFailure), expected, label); checks++;
  }
  const savedDocument = structuredClone(document); savedDocument.source.question = question;
  const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: savedDocument, visualStatus: "validated", segments: [],
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", diagramResultStatus: "ready", representationTier: "qualitative_verified", nonMetric: true, turnPlan: plan } });
  assert.equal(saved.ok, expected, `${label}: ${!saved.ok && saved.error}`); checks++;
}
async function main(): Promise<void> {
  await check(physicalPvDocument(), physicalQuestion, true, "explicit state/law/gamma bindings");
  await check(singlePhysical(), singleQuestion, true, "law before named source states");
  await check(physicalPvDocument(), physicalQuestion.replace("100 kPa and 2 L", "100000 Pa and 0.002 m^3"), true, "source units normalize to SI without reassigning identities");
  await check(conceptualPvDocument(), "Compare an isobaric ideal gas process schematically.", true, "bounded conceptual law");
  await check(conceptIsotherm(), "Show an isothermal ideal gas expansion schematically from A to B.", true, "concept direction");

  const swapped = singlePhysical();
  const states = swapped.constructions[0]!.inputs.states as Record<string, unknown>[];
  [states[0]!.pressure, states[1]!.pressure] = [states[1]!.pressure, states[0]!.pressure];
  [states[0]!.volume, states[1]!.volume] = [states[1]!.volume, states[0]!.volume];
  await check(structuredClone(swapped), singleQuestion.replace("expansion", "process"), false, "named-state value proof is independent of expansion direction");
  await check(swapped, singleQuestion, false, "self-consistent curve with wrong A/B source identities");
  const wrongLaw = singlePhysical();
  (wrongLaw.constructions[0]!.inputs.states as Record<string, unknown>[])[1]!.pressure = "pa";
  (wrongLaw.constructions[0]!.inputs.processes as Record<string, unknown>[])[0]!.kind = "isobar";
  await check(wrongLaw, singleQuestion, false, "plan-supported values cannot replace requested law");
  const reversed = singlePhysical();
  const edge = (reversed.constructions[0]!.inputs.processes as Record<string, unknown>[])[0]!;
  [edge.from, edge.to] = [edge.to, edge.from];
  await check(reversed, singleQuestion, false, "reverse named process is not the requested expansion");
  await check(conceptualPvDocument(), "Show an isothermal ideal gas expansion schematically from A to B.", false, "concept cannot substitute another law");
  await check(conceptIsotherm(), singleQuestion, false, "concept cannot discard explicit physical states");
  await check(conceptualPvDocument(), "Show a schematic without an isobaric process from A to B.", false, "absence of a process is not a positive law statement");
  const compression = conceptIsotherm();
  (compression.constructions[0]!.inputs.processes as Record<string, unknown>[])[0]!.from = "B";
  (compression.constructions[0]!.inputs.processes as Record<string, unknown>[])[0]!.to = "A";
  await check(compression, "Show an isothermal ideal gas expansion schematically from B to A.", false, "named paths also retain source volume direction");
  for (const question of [
    physicalQuestion.replace("gamma 2", "gamma 3"),
    physicalQuestion.replace("with gamma 2", ""),
    physicalQuestion.replace("reversible adiabatic", "irreversible adiabatic"),
    physicalQuestion.replace("reversible adiabatic", "adiabatic"),
    physicalQuestion.replace("ideal-gas", "van der Waals gas"),
    physicalQuestion.replace("ideal-gas", "gas"),
    physicalQuestion.replace("A is 200", "A is not at 200"),
    physicalQuestion + " A is 400 kPa and 1 L.",
    physicalQuestion.replace("A to B is isothermal", "A to B is not isothermal"),
    physicalQuestion.replace("A to B is isothermal", "If A to B were isothermal"),
    physicalQuestion.replace("A to B is isothermal", "A to B is either isothermal or isobaric"),
    physicalQuestion.replace("A to B is isothermal", "A to B is non-isothermal"),
    physicalQuestion.replace("A to B is isothermal", "B to A is isothermal"),
    physicalQuestion.replace("with gamma 2", "") + " An unrelated process X to Y has gamma 2.",
    physicalQuestion.replace("with gamma 2", "for an ideal gas, while unrelated X to Y has gamma 2"),
    physicalQuestion.replace("A to B is isothermal", "It is false that A to B is isothermal"),
    physicalQuestion.replace("A to B is isothermal", "Disprove the claim that A to B is isothermal"),
    physicalQuestion.replace("A is 200", "A student incorrectly asserts that A is 200"),
  ]) await check(physicalPvDocument(), question, false, "unsupported, ambiguous or contradictory source is not mathematical authority");
  const contradictoryPlan = pvTurnPlan(conceptualPvDocument(), "Compare an isobaric process schematically.");
  contradictoryPlan.lawIds = ["ideal_gas_isothermal"];
  assert.ok(validatePvSourceBinding(conceptualPvDocument(), contradictoryPlan.question, contradictoryPlan).some((issue) => issue.code === "pv_source_unproved")); checks++;
  console.log(`P-V source binding: ${checks} source/production/selection/server checks passed`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
