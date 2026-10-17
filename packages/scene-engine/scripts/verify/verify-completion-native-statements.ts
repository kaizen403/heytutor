import assert from "node:assert/strict";
import { compileSceneDocument, completeSceneDocument, validateTurnPlanV3, type SceneDocument, type TurnPlanV3 } from "../../src/index";

function fixture(anchor: string, text: string, owner = "body") {
  const question = "Show body B with its given mass m = 7.5 kg.";
  const quantity = { id: "mass", symbol: "m", value: 7.5, unit: "kg", provenance: "given" as const };
  const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [quantity], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "source-bound body" }, quantities: [quantity],
    entities: [{ id: "O", kind: "point", role: "center" }, { id: "other", kind: "point", role: "another body" },
      { id: "body", kind: "rectangle", role: "body", label: "B" }, { id: "old", kind: "label", role: "existing statement", label: text }],
    constructions: [
      { id: "make_O", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
      { id: "make_other", operator: "point", inputs: { x: 4, y: 3, coordinateSpace: "world" }, outputs: ["other"] },
      { id: "make_body", operator: "rectangle", inputs: { center: "O", width: 2, height: 1 }, outputs: ["body"] },
      { id: "make_old", operator: "label", inputs: { [anchor]: owner, text }, outputs: ["old"] },
    ], annotations: [{ id: "binding", kind: "callout", quantityId: "mass", targetIds: ["body"] }], relations: [], assertions: [],
    requiredEntityIds: ["body", "old"], revealGroups: [{ id: "setup", entityIds: ["O", "other", "body", "old"], dependsOn: [], narrationCue: "Show the bodies." }], teachingTimeline: [],
  };
  return { document, turnPlan };
}

let passed = 0;
for (const anchor of ["target", "at", "point"]) for (const text of ["m = 7.50 kg", "m=7.500e0kg"]) {
  const { document, turnPlan } = fixture(anchor, text);
  assert.ok(validateTurnPlanV3(turnPlan, turnPlan.question).valid);
  const baseline = compileSceneDocument(document);
  assert.ok(baseline.ok && baseline.renderScene, JSON.stringify(baseline.report.issues));
  assert.ok(baseline.renderScene.primitives.some(p => p.entityId === "old" && p.kind === "label" && p.text === text));
  const result = completeSceneDocument(document, { enabled: true, turnPlan, baseRenderScene: baseline.renderScene });
  assert.deepEqual(result.additions, [], `${anchor}: owner-bound native statement already covers m despite decimal formatting`);
  assert.equal(result.document, document, "deduplication preserves the original native statement and document");
  passed++;
}
for (const [text, owner] of [["M = 7.50 kg", "body"], ["m = 7.50 kg", "other"]]) {
  const { document, turnPlan } = fixture("target", text!, owner);
  const baseline = compileSceneDocument(document);
  assert.ok(baseline.ok && baseline.renderScene, JSON.stringify(baseline.report.issues));
  const result = completeSceneDocument(document, { enabled: true, turnPlan, baseRenderScene: baseline.renderScene });
  assert.equal(result.additions.length, 1, "another symbol or another owner cannot cover this source quantity");
  assert.deepEqual(result.additions[0]!.targetIds, ["body"]);
  assert.equal(result.additions[0]!.text, "m = 7.5 kg");
  passed++;
}
console.log(`completion-native-statements: ${passed}/8 passed`);
