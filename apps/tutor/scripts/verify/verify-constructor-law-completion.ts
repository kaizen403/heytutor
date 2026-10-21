import assert from "node:assert/strict";
import { compileSceneDocument, SCENE_ENGINE_VERSION, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import type { SelectedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

globalThis.fetch = async () => { throw new Error("constructor-law-gate-network-forbidden"); };
const clone = <T>(value: T): T => structuredClone(value);
const question = "Show the constructed geometry inside its reference frame.";
const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [{ id: "construction", claim: "constructed incidence", expected: true }], lawIds: [], assumptions: [], visualRequirement: "required" };
// Authored geometry, never copied recorded question text.
const document: SceneDocument = {
  schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "authored projection law control" },
  source: { question, nonMetric: true }, quantities: [],
  entities: [
    { id: "center", kind: "point", role: "frame center" }, { id: "frame", kind: "rectangle", role: "reference frame" },
    ...["L", "R", "P", "foot"].map(id => ({ id, kind: "point", role: "constructed point", ...(id === "P" ? { label: "P" } : {}) })),
    { id: "base", kind: "segment", role: "reference line" }, { id: "drop", kind: "segment", role: "projecting segment" },
  ],
  constructions: [
    { id: "make_center", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["center"] },
    { id: "make_frame", operator: "rectangle", inputs: { center: "center", width: 8, height: 8 }, outputs: ["frame"] },
    ...[["L", -3, 0], ["R", 3, 0], ["P", 1, 2]].map(([id, x, y]) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [String(id)] })),
    { id: "make_base", operator: "segment", inputs: { start: "L", end: "R" }, outputs: ["base"] },
    { id: "make_foot", operator: "project", inputs: { point: "P", line: "base" }, outputs: ["foot"] },
    { id: "make_drop", operator: "segment", inputs: { start: "P", end: "foot" }, outputs: ["drop"] },
  ], relations: [], assertions: [], annotations: [], requiredEntityIds: ["center", "frame", "P", "base", "foot", "drop"],
  revealGroups: [{ id: "setup", entityIds: ["center", "frame", "L", "R", "P", "base", "foot", "drop"], dependsOn: [], narrationCue: "Show the construction." }], teachingTimeline: [],
};
const validated = validateProductionSceneCandidate({ candidate: clone(document) as unknown as Record<string, unknown>, question, turnPlan });
assert.ok(validated.valid && validated.value, JSON.stringify(validated.errors));
const selected: SelectedRepresentation = { tier: "qualitative_verified", nonMetric: true, figureSource: "planner", reason: "authored native baseline",
  sceneDocument: validated.value.document, renderScene: validated.value.renderScene, validationReport: validated.value.report };
const originalEnvironment = process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS;
const fixtures: Array<{ id: string; parent?: boolean; explicit?: boolean; env?: string; adopted: boolean }> = [
  { id: "constructor-setting-is-default-off", parent: true, adopted: false },
  { id: "constructor-environment-enables-only-with-parent", parent: true, env: "1", adopted: true },
  { id: "explicit-opt-in-overrides-environment-off", parent: true, explicit: true, env: "0", adopted: true },
  { id: "explicit-off-overrides-environment-on", parent: true, explicit: false, env: "1", adopted: false },
  { id: "environment-non-one-remains-off", parent: true, env: "true", adopted: false },
  { id: "missing-parent-blocks-explicit-and-environment-opt-in", explicit: true, env: "1", adopted: false },
  { id: "parent-off-blocks-explicit-and-environment-opt-in", parent: false, explicit: true, env: "1", adopted: false },
];
let oldCompletion: ReturnType<typeof selectProductionScene> | undefined;
async function main(): Promise<void> {
try {
  for (const fixture of fixtures) {
    if (fixture.env === undefined) delete process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS;
    else process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS = fixture.env;
    const before = clone({ selected, turnPlan });
    const result = selectProductionScene({ question, turnPlan, problemIR: null, fastRepresentation: selected,
      completionEnabled: fixture.parent, constructorLawsEnabled: fixture.explicit });
    assert.deepEqual({ selected, turnPlan }, before, "the stock app boundary retains caller-owned authority");
    assert.ok(result.representation && result.visualStatus === "validated", result.reason);
    assert.equal(result.completion?.adopted ?? false, fixture.adopted, `${fixture.id}: ${JSON.stringify(result.completion)}`);
    if (!fixture.adopted) {
      assert.deepEqual(result.representation, selected, "disabled profiles retain every native field exactly");
      if (fixture.parent !== true) assert.equal(result.completion, undefined, "parent-off never enters completion");
      else if (oldCompletion) assert.deepEqual(result, oldCompletion, "constructor-off is byte-equivalent to the original completion profile");
      else oldCompletion = clone(result);
    } else {
      const addition = result.completion!.additions;
      assert.equal(addition.length, 1); assert.equal(addition[0]!.kind, "right_angle");
      assert.deepEqual(addition[0]!.targetIds, ["base", "drop"]);
      for (const key of ["entities", "constructions", "annotations", "assertions", "requiredEntityIds"] as const)
        assert.deepEqual(result.representation.sceneDocument[key].slice(0, selected.sceneDocument[key].length), selected.sceneDocument[key], `app adoption retains the old ${key} prefix`);
      assert.equal(result.representation.sceneDocument.revealGroups.length, selected.sceneDocument.revealGroups.length);
      for (const group of selected.sceneDocument.revealGroups) {
        const adopted: SceneDocument["revealGroups"][number] = result.representation.sceneDocument.revealGroups.find(candidate => candidate.id === group.id)!;
        assert.deepEqual({ ...adopted, entityIds: adopted.entityIds.slice(0, group.entityIds.length) }, group, "app adoption appends only in an existing reveal group");
      }
      for (const prior of selected.renderScene.primitives)
        assert.deepEqual(result.representation.renderScene.primitives.find(next => next.id === prior.id), prior, "every old mark and label remains exact after app admission");
      const canonical = await canonicalizeTurnSceneMetadata({ question, sceneDocument: result.representation.sceneDocument,
        sceneEngineVersion: SCENE_ENGINE_VERSION, validationReport: result.representation.validationReport, visualStatus: "validated", segments: [],
        sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, problemIR: null, solverResult: null, solverAuthority: null,
          representationTier: result.representation.tier, nonMetric: true, figureSource: "planner", candidates: [], selectedCandidateId: null,
          selectionReason: "authored constructor-law control", diagramResultStatus: "ready", completion: result.completion } });
      assert.ok(canonical.ok, canonical.ok ? "" : canonical.error);
      const reopened = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify({ ...canonical.value, question })));
      assert.ok(reopened.ok, reopened.ok ? "" : reopened.error);
      assert.ok(reopened.value.sceneDocument, "reopened metadata retains its native document");
      const compiled = compileSceneDocument(reopened.value.sceneDocument);
      assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
      assert.deepEqual(compiled.renderScene, result.representation.renderScene, "canonical save and JSON reopen retain exact native ink");
    }
    console.log(`PASS ${fixture.id}`);
  }
} finally {
  if (originalEnvironment === undefined) delete process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS;
  else process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS = originalEnvironment;
}
console.log(`constructor-law-completion-app: ${fixtures.length}/${fixtures.length} passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
