import assert from "node:assert/strict";
import { pruneDeadSceneEntities, SCENE_ENGINE_VERSION, validateCircuitTerminalClosure, validateTurnPlanSceneProofs, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { capacitorCircuit, capacitorDrawnTwice, capacitorPlan, capacitorQuestion, capacitorRectanglePlates, freeCapacitorPlates } from "../../../../packages/scene-engine/scripts/verify/fixtures/capacitor-circuit";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { liveSceneSaveFailure, sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";

let checks = 0;
async function save(document: SceneDocument, question = capacitorQuestion, plan: TurnPlanV3 | null = capacitorPlan) {
  const before = structuredClone(document);
  const result = await canonicalizeTurnSceneMetadata({
    question, sceneDocument: document, sceneEngineVersion: SCENE_ENGINE_VERSION,
    visualStatus: "validated", segments: [],
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", diagramResultStatus: "ready",
      representationTier: "qualitative_verified", nonMetric: true,
      turnPlan: plan, figureSource: "planner",
    },
  });
  assert.deepEqual(document, before, "server admission must not mutate the submitted graph"); checks++;
  return result;
}
function candidate(kind: string): SceneDocument {
  const document = ["plates", "touching", "perpendicular", "collinear"].includes(kind) ? freeCapacitorPlates() : capacitorCircuit();
  if (kind === "touching") document.constructions.find(({ id }) => id === "make_plate2")!.inputs = { start: [3, 1.2], end: [5, 1.2] };
  if (kind === "perpendicular") document.constructions.find(({ id }) => id === "make_plate2")!.inputs = { start: [4, 0.5], end: [4, 1.5] };
  if (kind === "collinear") document.constructions.find(({ id }) => id === "make_plate2")!.inputs = { start: [5, 1.2], end: [7, 1.2] };
  if (kind === "missing_return") {
    document.constructions = document.constructions.filter(({ id }) => id !== "make_bottom");
    document.entities = document.entities.filter(({ id }) => id !== "bottom");
    document.requiredEntityIds = document.requiredEntityIds.filter((id) => id !== "bottom");
    document.revealGroups[0]!.entityIds = [...document.requiredEntityIds];
  }
  if (kind === "unjoined_port") {
    document.entities.push({ id: "C2", kind: "point", role: "node" });
    document.constructions.push({ id: "make_C2", operator: "point", inputs: { x: 4, y: 2, coordinateSpace: "world" }, outputs: ["C2"] });
    document.requiredEntityIds.push("C2"); document.revealGroups[0]!.entityIds.push("C2");
    document.constructions.find(({ id }) => id === "make_top")!.inputs.end = "C2";
  }
  if (kind === "zero_span") document.constructions.find(({ id }) => id === "make_capacitor")!.inputs.end = "C";
  return pruneDeadSceneEntities({ ...structuredClone(document) }) as unknown as SceneDocument;
}

async function main() {
  for (const document of [capacitorCircuit(), candidate("plates"), candidate("missing_return"), candidate("unjoined_port")]) {
    assert.deepEqual(validateCircuitTerminalClosure(document, capacitorQuestion, capacitorPlan),
      validateTurnPlanSceneProofs(document, capacitorPlan).filter((issue) => issue.code === "source_loop_not_closed"),
      "public terminal closure is the same proof used by production plan admission"); checks++;
  }
  const native = capacitorCircuit();
  assert.equal((await save(native)).ok, true, "native closed capacitor loop survives qualitative persistence"); checks++;
  for (const kind of ["plates", "touching", "perpendicular", "collinear", "missing_return", "unjoined_port", "zero_span"]) {
    const result = await save(candidate(kind));
    assert.equal(result.ok, false, `${kind}: forged qualitative ready save must not bypass the terminal closure proof`); checks++;
    if (["plates", "missing_return", "unjoined_port"].includes(kind) && !result.ok) {
      assert.equal(result.code, "scene_admission_failed", kind);
      assert.match(result.error, /source_loop_not_closed/); checks += 2;
    }
  }
  for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
    const input = { document: candidate("missing_return"), question: capacitorQuestion, turnPlan: capacitorPlan, tier };
    assert.match(sceneSaveAdmissionFailure(input) ?? "", /source_loop_not_closed/);
    assert.match(liveSceneSaveFailure(input) ?? "", /source_loop_not_closed/); checks += 2;
  }
  for (const kind of ["K", "N", "recorded"] as const) {
    const result = await save(capacitorDrawnTwice(kind));
    assert.equal(result.ok, false, `${kind}: a forged ready save cannot keep a capacitor drawn twice`); checks++;
    for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
      const input = { document: capacitorDrawnTwice(kind), question: capacitorQuestion, turnPlan: capacitorPlan, tier };
      assert.match(sceneSaveAdmissionFailure(input) ?? "", /capacitor_depicted_twice/, `${kind} ${tier}: saved admission refuses the double draw`);
      assert.match(liveSceneSaveFailure(input) ?? "", /capacitor_depicted_twice/, `${kind} ${tier}: live save refuses the double draw`); checks += 2;
    }
  }
  assert.equal((await save(capacitorRectanglePlates())).ok, false, "a forged ready save cannot keep rectangle plates beside the capacitor symbol"); checks++;
  for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
    assert.match(liveSceneSaveFailure({ document: capacitorRectanglePlates(), question: capacitorQuestion, turnPlan: capacitorPlan, tier }) ?? "", /capacitor_depicted_twice/); checks++;
  }
  const withoutPlan = await save(candidate("missing_return"), capacitorQuestion, null);
  assert.equal(withoutPlan.ok, false, "a qualitative payload without a plan still needs declared source terminals to close"); checks++;

  for (const question of [
    "Sketch an OPEN CIRCUIT with a battery and capacitor.",
    "Sketch a battery and capacitor: the switch is open.",
    "Sketch a disconnected circuit with a battery and capacitor.",
  ]) {
    const document = candidate("missing_return"); document.source.question = question;
    const plan = { ...capacitorPlan, question };
    assert.equal((await save(document, question, plan)).ok, true, "source-declared open circuits retain existing policy"); checks++;
  }
  const openByFact = candidate("missing_return");
  const openPlan = { ...capacitorPlan, assumptions: ["The switch is open."] };
  assert.equal((await save(openByFact, capacitorQuestion, openPlan)).ok, true, "existing authoritative plan open-state facts remain supported"); checks++;

  const forgedQuestion = candidate("missing_return"); forgedQuestion.source.question = "An open circuit.";
  const forgedPlanQuestion = { ...capacitorPlan, question: "An open circuit." };
  assert.match(sceneSaveAdmissionFailure({ document: forgedQuestion, question: capacitorQuestion, turnPlan: forgedPlanQuestion, tier: "qualitative_verified" }) ?? "", /source_loop_not_closed/,
    "the actual question, not document or plan question metadata, supplies source wording"); checks++;
  console.log(`Circuit terminal save: ${checks} checks passed; native/open controls preserved, malformed qualitative payloads refused`);

}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
