import assert from "node:assert/strict";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { validateSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { getSegmentCommands } from "@heytutor/drawing";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { sourceCheckedStoredDocument, sourceCheckedStoredTurn, storedTurnSourceIssues } from "../../lib/scene/storedSceneSource";
import { selectProductionFastRepresentation } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";

const question = "Given v=10 m/s. Show v in m/s and km/h.";
const turnPlan = createFallbackTurnPlanV3(question);
const selected = selectProductionFastRepresentation({ question, turnPlan, problemIR: null });
assert(selected);
function stored(document: SceneDocument): StoredTurn {
  return { id: "native_stored_source", orderIndex: 0, question, rawResponse: "", speedMultiplier: 1,
    traceId: null, sceneDocument: document, sceneEngineVersion: null, validationReport: null,
    visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, problemIR: null,
      representationTier: selected!.tier, figureSource: "fast_family" }, segments: [] };
}
const accepted = sourceCheckedStoredDocument(selected.sceneDocument, stored(selected.sceneDocument));
assert(accepted);
const valid = stored(accepted);
assert.equal(storedTurnSourceIssues(selected.sceneDocument, valid).length, 0);
assert.equal(sourceCheckedStoredTurn(valid), valid, "an accepted unchanged scientific document retains the caller's turn reference");
const restored = restoreVerifiedPresentationFromTurn(valid);
assert(restored);
assert(!restored.introSegments.flatMap(getSegmentCommands).some(command => command.text?.includes("36 km/h")));
assert(restored.diagram.deferredAnnotations?.some(entry => entry.revealAfter === "teaching_complete" &&
  entry.commands.some(command => command.text?.includes("36 km/h"))), "valid conversions retain computed-answer deferral");
for (const variant of ["value", "unit", "label", "value_and_label", "no_retained_plan", "restated_source", "stale_ir_without_plan"] as const) {
  const document = structuredClone(selected.sceneDocument);
  const quantity = document.quantities.find(item => item.id === "value_1");
  const label = document.entities.find(entity => entity.id === "equivalent_rate");
  assert(quantity && label);
  if (["value", "value_and_label", "no_retained_plan"].includes(variant)) quantity.value = 37;
  if (variant === "unit") quantity.unit = "m/s";
  if (["label", "value_and_label", "no_retained_plan"].includes(variant)) label.label = "v=37 km/h";
  if (variant === "restated_source") document.source.question = "Given v=20 m/s. Show v in m/s and km/h.";
  const turn = stored(document);
  if (variant === "no_retained_plan") turn.sceneArtifacts = null;
  if (variant === "stale_ir_without_plan") {
    document.source.question = "A segment connects two marked points.";
    turn.sceneArtifacts = { problemIR: { schemaVersion: "problem-ir/v1", question: document.source.question } };
  }
  assert(storedTurnSourceIssues(document, turn).some(issue => issue.severity === "fatal" && issue.code.startsWith("source_observable_")), variant);
  assert.equal(sourceCheckedStoredTurn(turn).visualStatus, "retry_required", variant);
  assert.equal(restoreVerifiedPresentationFromTurn(turn), null, `${variant}: no stored false claim can become actual diagram or focus ink`);
}
const missingTiming = structuredClone(accepted);
delete missingTiming.source.answerLabelPrimitiveIds;
delete missingTiming.source.answerLabelEntityIds;
delete missingTiming.source.answerLabelAnnotationIds;
const toStage = stored(missingTiming), staged = sourceCheckedStoredTurn(toStage);
assert.notEqual(staged, toStage, "reconstructed source-proved timing requires a new turn");
assert.deepEqual(staged.sceneDocument, accepted, "reference preservation never restores submitted early-answer metadata");
const legacyQuestion = "A segment connects two marked points.";
const legacyDocument = validateSceneDocument({ schemaVersion: "scene-document/v2", source: { question: legacyQuestion },
  visualDecision: { mode: "scene", reason: "ordinary geometry" }, quantities: [],
  entities: [{ id: "a", kind: "point", role: "endpoint" }, { id: "b", kind: "point", role: "endpoint" }, { id: "edge", kind: "segment", role: "segment" }],
  constructions: [{ id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "make_b", operator: "point", inputs: { x: 1, y: 0 }, outputs: ["b"] },
    { id: "make_edge", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["edge"] }],
  relations: [], assertions: [], annotations: [{ id: "sense", kind: "sense", targetIds: ["edge"] }], requiredEntityIds: ["a", "b", "edge"],
  revealGroups: [{ id: "setup", entityIds: ["a", "b", "edge"], dependsOn: [], narrationCue: "setup" }],
  teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "setup" }] }).document;
assert(legacyDocument);
const legacy = { ...stored(legacyDocument), question: legacyQuestion, sceneArtifacts: null };
assert.equal(storedTurnSourceIssues(legacyDocument, legacy).length, 0);
assert.equal(sourceCheckedStoredTurn(legacy), legacy, "unrelated legacy geometry remains a no-op by reference");
assert(restoreVerifiedPresentationFromTurn(legacy));
const serializedLegacy = { ...legacy, sceneDocument: JSON.parse(JSON.stringify(legacyDocument)) };
assert.equal(sourceCheckedStoredTurn(serializedLegacy), serializedLegacy, "absent optional annotation style equals its normalized undefined field");
console.log("native stored source: seven actual generic read/direct-restore negatives including stale IR without a plan; valid conversions, changed answer staging and legacy reference identity pass");
