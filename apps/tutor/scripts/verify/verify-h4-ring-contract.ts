import assert from "node:assert/strict";
import { type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { buildSceneDocumentPlannerPrompt, inferSceneCapabilities, normalizeSceneDocumentModelOutput, planSceneDocument, repairSceneDocument, selectConstructionInputContracts } from "@heytutor/tutor-core";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

async function main(): Promise<void> {
  let checks = 0;
  const failures: string[] = [];
  const check = (value: unknown, message: string) => { checks++; if (!value) failures.push(message); };
  const question = "Show the axial electric field of a uniformly charged ring with radius 3 m, charge 2 C, axial distance 4 m and explicit physical k=5 N*m^2/C^2.";
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
  const ids = ["O", "frame", "center", "ring", "at", "E"];
  const scene: SceneDocument = {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-grounded ring model" }, source: { question }, quantities: [],
    entities: ids.map((id, index) => ({ id, kind: ["point", "polyline", "point", "polyline", "point", "vector"][index]!, role: ["origin", "world frame", "ring center", "charged ring", "axial observation", "electric field"][index]! })),
    constructions: [
      { id: "origin", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
      { id: "frame_make", operator: "space_frame", inputs: { origin: "O", axisLength: 2 }, outputs: ["frame"] },
      { id: "center_make", operator: "space_point", inputs: { frame: "frame", x: 0, y: 0, z: 0 }, outputs: ["center"] },
      { id: "ring_make", operator: "charged_ring_axial_field", inputs: { frame: "frame", center: "center", radius: 3, charge: 2, axialDistance: 4, k: 5, displayLength: 0.5, units: { charge: "C", length: "m" } }, outputs: ["ring", "at", "E"] },
    ], relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "g", entityIds: ids, dependsOn: [], narrationCue: "ring and axial field" }], teachingTimeline: [],
  };
  const production = (document: SceneDocument) => {
    const sceneQuestion = String(document.source.question);
    return validateProductionSceneCandidate({ candidate: normalizeSceneDocumentModelOutput(document as unknown as Record<string, unknown>, sceneQuestion), question: sceneQuestion, turnPlan: { ...plan, question: sceneQuestion } });
  };
  const positive = production(scene);
  check(positive.valid, `source-grounded ring survives production: ${JSON.stringify(positive.errors)}`);
  check(positive.value?.renderScene.primitives.some((mark) => mark.entityId === "ring" && mark.kind === "polyline" && mark.points.length >= 65), "whole ring belongs to its native producer");
  check(positive.value?.renderScene.primitives.some((mark) => mark.entityId === "E" && mark.text?.includes("0.32 N/C")), "independent 3-4-5 oracle yields physical E=0.32 N/C");
  const incorrect = structuredClone(scene); incorrect.entities[5]!.label = "E=999 N/C";
  const incorrectResult = production(incorrect);
  check(!incorrectResult.valid, "false numeric field label rejects before publication");
  const correctClaim = structuredClone(scene); correctClaim.entities[5]!.label = "E≈0.32 N/C";
  check(production(correctClaim).valid, "correct rounded physical claim survives original-claim validation");
  const wrongUnit = structuredClone(scene); wrongUnit.entities[5]!.label = "E=0.32 N";
  check(!production(wrongUnit).valid, "incorrect field claim units reject before pruning");
  const callout = structuredClone(scene); callout.annotations = [{ id: "claim", kind: "callout", targetIds: ["E"], text: "E=999 N/C" }];
  check(!production(callout).valid, "false owned field callout rejects before pruning");
  callout.quantities = [{ id: "wrong_E", symbol: "E", value: 999, unit: "N/C" }]; callout.annotations[0]!.quantityId = "wrong_E";
  check(!production(callout).valid, "false field quantity-linked callout cannot be erased");
  const zero = structuredClone(scene); zero.constructions[3]!.inputs.axialDistance = 0;
  zero.source.question = question.replace("axial distance 4 m", "axial distance 0 m");
  const zeroResult = production(zero);
  check(zeroResult.valid && !zeroResult.value?.renderScene.primitives.some((mark) => mark.entityId === "E" && mark.kind === "vector"), "zero axial field has no invented arrow");
  const metric = structuredClone(scene); metric.assertions = [{ id: "metric", predicate: "equal_length", entities: ["E", "E"], expected: true, severity: "fatal" }];
  check(!production(metric).valid, "field display length cannot prove physical length");
  const offAxis = structuredClone(scene); offAxis.constructions[3]!.inputs.at = [1, 0, 4];
  check(!production(offAxis).valid, "unsupported off-axis input rejects rather than approximates");
  const caps = inferSceneCapabilities(question, { turnPlan: plan });
  for (const operator of ["charged_ring_axial_field", "space_frame", "space_point"]) check(caps.constructionOperators.includes(operator), "existing field family offers the complete native ring chain");
  check(buildSceneDocumentPlannerPrompt(question, caps).includes("charged_ring_axial_field:"), "canonical model reaches the scoped field prompt");
  for (const detailed of [undefined, []] as const) {
    const contract = selectConstructionInputContracts(["charged_ring_axial_field"], detailed);
    check(contract.includes("frame:") && contract.includes("center:") && contract.includes("units:") && contract.includes("axialDistance"), "full/compact schema preserves source authority");
    check(contract.includes("ring polyline,observation point,field vector") && contract.includes("zero:point"), "full/compact contract preserves ordered output and zero semantics");
  }
  const requests: Array<{ messages: Array<{ content: string }> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(scene) } }] }), { status: 200 });
  };
  try {
    await planSceneDocument(question, { proxyUrl: "http://planner.test", timeoutMs: 2000 });
    await repairSceneDocument(question, scene as unknown as Record<string, unknown>, [{ code: "invalid_ring_units", message: "Retain physical source units.", severity: "fatal" }], { proxyUrl: "http://planner.test", timeoutMs: 2000 });
  } finally { globalThis.fetch = originalFetch; }
  check(requests.length === 2, "real initial/repair transports exercised without provider calls");
  requests.forEach((request, index) => {
    const prompt = request.messages.map((message) => message.content).join("\n");
    check(prompt.length <= (index === 0 ? 24_500 : 27_000), "unchanged initial/repair budget");
    check(prompt.includes("charged_ring_axial_field:") && prompt.includes("zero:point"), "native ring schema survives actual transport");
  });
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(`H4 ring contract: ${checks} production/offer/transport checks passed`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
