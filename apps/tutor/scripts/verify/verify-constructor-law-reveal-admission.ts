import assert from "node:assert/strict";
import { compileSceneDocument, SCENE_ENGINE_VERSION, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import type { SelectedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

globalThis.fetch = async () => { throw new Error("private-reveal-gate-network-forbidden"); };
const question = "Show the projection construction in its existing second reveal.";
const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [{ id: "construction", claim: "native projected incidence", expected: true }], lawIds: [], assumptions: [], visualRequirement: "required" };
function fixture(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", source: { question, nonMetric: true },
    visualDecision: { mode: "scene", reason: "authored multi-reveal projection" }, quantities: [],
    entities: [{ id: "center", kind: "point", role: "frame center" }, { id: "frame", kind: "rectangle", role: "reference frame" },
      ...["L", "R", "P", "foot"].map(id => ({ id, kind: "point", role: "constructed point", ...(id === "P" ? { label: "P" } : {}) })),
      { id: "support", kind: "segment", role: "projection reference" }, { id: "drop", kind: "segment", role: "projection connector" }],
    constructions: [{ id: "center", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["center"] },
      { id: "frame", operator: "rectangle", inputs: { center: "center", width: 8, height: 8 }, outputs: ["frame"] },
      ...[["L", -3, 0], ["R", 3, 0], ["P", 1, 2]].map(([id, x, y]) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [String(id)] })),
      { id: "support", operator: "segment", inputs: { start: "L", end: "R" }, outputs: ["support"] },
      { id: "foot", operator: "project", inputs: { point: "P", line: "support" }, outputs: ["foot"] },
      { id: "drop", operator: "segment", inputs: { start: "P", end: "foot" }, outputs: ["drop"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["center", "frame", "L", "R", "P", "support", "foot", "drop"],
    revealGroups: [{ id: "setup", entityIds: ["center", "frame", "L", "R", "P"], dependsOn: [], narrationCue: "Show the initial point." },
      { id: "construction", entityIds: ["support", "foot", "drop"], dependsOn: ["setup"], narrationCue: "Show the projection." }], teachingTimeline: [],
  };
}
const tests: Array<{ id: string; adopted: boolean; enabled: boolean; edit?: (doc: SceneDocument) => void }> = [
  { id: "native-projection-preserves-later-foot-scope", adopted: true, enabled: true },
  { id: "constructor-off-keeps-original-completion-profile", adopted: false, enabled: false },
  { id: "separate-arm-scopes-do-not-join", adopted: false, enabled: true, edit: doc => {
    doc.revealGroups[1]!.entityIds = ["foot", "drop"]; doc.revealGroups[0]!.entityIds.push("support");
  } },
  { id: "unowned-helper-remains-deferred-with-guards-intact", adopted: false, enabled: true, edit: doc => {
    doc.requiredEntityIds = doc.requiredEntityIds.filter(id => id !== "foot"); doc.revealGroups[1]!.entityIds = ["support", "drop"];
  } },
];
async function main(): Promise<void> {
for (const test of tests) {
  const raw = fixture(); test.edit?.(raw);
  const validated = validateProductionSceneCandidate({ candidate: raw as unknown as Record<string, unknown>, question, turnPlan });
  assert(validated.valid && validated.value, `${test.id}: native baseline must admit`);
  const selected: SelectedRepresentation = { tier: "qualitative_verified", nonMetric: true, figureSource: "planner", reason: "authored projection baseline",
    sceneDocument: validated.value.document, renderScene: validated.value.renderScene, validationReport: validated.value.report };
  const before = structuredClone(selected);
  const result = selectProductionScene({ question, turnPlan, problemIR: null, fastRepresentation: selected, completionEnabled: true, constructorLawsEnabled: test.enabled });
  assert.deepEqual(selected, before, "app caller must remain unchanged");
  assert(result.representation && result.visualStatus === "validated");
  assert.equal(result.completion?.adopted ?? false, test.adopted, `${test.id}: ${JSON.stringify(result.completion)}`);
  if (!test.adopted) assert.deepEqual(result.representation, selected, `${test.id}: retain the original selected scene`);
  else {
    const additions = result.completion!.additions; assert.equal(additions.length, 1); assert.equal(additions[0]!.kind, "right_angle");
    const doc = result.representation.sceneDocument;
    assert.deepEqual(doc.revealGroups[0], selected.sceneDocument.revealGroups[0], "no existing later vertex is revealed in setup");
    assert.deepEqual(doc.revealGroups[1]!.entityIds.slice(0, 3), selected.sceneDocument.revealGroups[1]!.entityIds);
    assert.deepEqual(doc.revealGroups[1]!.entityIds.slice(3), [additions[0]!.id]);
    for (const prior of selected.renderScene.primitives) assert.deepEqual(result.representation.renderScene.primitives.find(p => p.id === prior.id), prior, "old ink is immutable");
    const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: doc, sceneEngineVersion: SCENE_ENGINE_VERSION,
      validationReport: result.representation.validationReport, visualStatus: "validated", segments: [],
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, problemIR: null, solverResult: null, solverAuthority: null,
        representationTier: result.representation.tier, nonMetric: true, figureSource: "planner", candidates: [], selectedCandidateId: null,
        selectionReason: "authored constructor-law scope control", diagramResultStatus: "ready", completion: result.completion } });
    assert(saved.ok, saved.ok ? "" : saved.error);
    const reopened = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify({ ...saved.value, question })));
    assert(reopened.ok && reopened.value.sceneDocument, reopened.ok ? "" : reopened.error);
    assert.deepEqual(reopened.value.sceneDocument.revealGroups, doc.revealGroups);
    const compiled = compileSceneDocument(reopened.value.sceneDocument); assert(compiled.ok && compiled.renderScene);
    assert.deepEqual(compiled.renderScene, result.representation.renderScene);
  }
}
// Legacy native marks retain the old first-group promotion for omitted/false.
for (const option of [undefined, false]) {
  const raw = fixture(); raw.entities.push({ id: "legacy", kind: "right_angle_mark", role: "existing native corner" });
  raw.constructions.push({ id: "legacy", operator: "right_angle_mark", inputs: { vertex: "foot", a: "R", b: "P", ...(option === undefined ? {} : { incidentLineArms: option }) }, outputs: ["legacy"] });
  raw.requiredEntityIds.push("legacy"); raw.revealGroups[1]!.entityIds.push("legacy");
  const result = validateProductionSceneCandidate({ candidate: raw as unknown as Record<string, unknown>, question, turnPlan });
  assert(result.valid && result.value);
  assert(result.value.document.revealGroups[0]!.entityIds.includes("foot"), "legacy promotion remains unchanged");
}
console.log(`constructor-law reveal admission: ${tests.length + 2}/${tests.length + 2} passed`);

}
main().catch(error => { console.error(error); process.exitCode = 1; });
