import assert from "node:assert/strict";
import { compileSceneDocument, SCENE_ENGINE_VERSION, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import type { SelectedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

globalThis.fetch = async () => { throw new Error("constructor-retention-gate-network-forbidden"); };
const clone = <T>(value: T): T => structuredClone(value);
function fixture(withGiven: boolean): { document: SceneDocument; turnPlan: TurnPlanV3 } {
  const question = "Show the given incidence angle i and the native projection in its declared reveal scope.";
  const givens: TurnPlanV3["givens"] = withGiven ? [{ id: "incidence", symbol: "i", value: 35, unit: "°", provenance: "given" }] : [];
  const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens, unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "authored independent completion and constructor owners" }, quantities: givens.map(given => ({ ...given })),
    entities: [{ id: "center", kind: "point", role: "frame center" }, { id: "frame", kind: "rectangle", role: "reference frame" },
      ...["L", "R", "P", "foot"].map(id => ({ id, kind: "point", role: "constructed point" })),
      { id: "contact", kind: "point", role: "constructed optical contact" }, { id: "surface", kind: "line", role: "flat interface" },
      { id: "incoming", kind: "ray", role: "incoming ray" }, { id: "normal", kind: "line", role: "native normal" }, { id: "outgoing", kind: "ray", role: "outgoing ray" },
      { id: "arc", kind: "angle_mark", role: "given incidence", label: "i" }, { id: "support", kind: "segment", role: "projection reference" }, { id: "drop", kind: "segment", role: "projection connector" }],
    constructions: [{ id: "center", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["center"] },
      { id: "frame", operator: "rectangle", inputs: { center: "center", width: 8, height: 8 }, outputs: ["frame"] },
      ...[["L", -3, 0], ["R", 3, 0], ["P", 1, 2]].map(([id, x, y]) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [String(id)] })),
      { id: "contact", operator: "point", inputs: { x: -2, y: -2, coordinateSpace: "world" }, outputs: ["contact"] },
      { id: "surface", operator: "line", inputs: { start: "contact", direction: [1, 0] }, outputs: ["surface"] },
      { id: "bundle", operator: "refract_at", inputs: { point: "contact", surface: "surface", incidentAngleDeg: withGiven ? "incidence" : 35, n1: 1, n2: 1.5, span: 1.5 }, outputs: ["incoming", "normal", "outgoing"] },
      { id: "arc", operator: "angle_mark", inputs: { vertex: "contact", a: "incoming", b: "normal", radius: .45 }, outputs: ["arc"] },
      { id: "support", operator: "segment", inputs: { start: "L", end: "R" }, outputs: ["support"] },
      { id: "foot", operator: "project", inputs: { point: "P", line: "support" }, outputs: ["foot"] },
      { id: "drop", operator: "segment", inputs: { start: "P", end: "foot" }, outputs: ["drop"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["center", "frame", "L", "R", "P", "contact", "surface", "incoming", "normal", "outgoing", "arc", "support", "drop"],
    // The existing unowned helper remains outside this scope repair. A native
    // law proposal may fail admission, but cannot remove the given-angle label.
    revealGroups: [{ id: "setup", entityIds: ["center", "frame", "L", "R", "P", "contact", "surface", "incoming", "normal", "outgoing", "arc"], dependsOn: [], narrationCue: "Show the source incidence." },
      { id: "projection", entityIds: ["support", "drop"], dependsOn: ["setup"], narrationCue: "Show the existing strokes." }], teachingTimeline: [],
  };
  return { document, turnPlan };
}
async function main(): Promise<void> {
  const previous = process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS;
  let passed = 0;
  try {
    for (const withGiven of [true, false]) {
      const { document, turnPlan } = fixture(withGiven), question = turnPlan.question;
      const admitted = validateProductionSceneCandidate({ candidate: document as unknown as Record<string, unknown>, question, turnPlan });
      assert(admitted.valid && admitted.value, `authored native baseline: ${JSON.stringify(admitted.errors)}`);
      const selected: SelectedRepresentation = { tier: "exact_verified", nonMetric: false, figureSource: "planner", reason: "authored native baseline",
        sceneDocument: admitted.value.document, renderScene: admitted.value.renderScene, validationReport: admitted.value.report };
      const input = { question, turnPlan, problemIR: null, fastRepresentation: selected, completionEnabled: true };
      const untouched = clone({ selected, turnPlan });
      process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS = "0";
      const original = selectProductionScene({ ...input, constructorLawsEnabled: false });
      assert(original.representation && original.visualStatus === "validated");
      assert.equal(original.completion?.adopted, withGiven, `the original completion profile must ${withGiven ? "add the given label" : "remain empty"}: ${JSON.stringify(original.completion)}`);
      assert.deepEqual(original.completion?.additions.map(addition => addition.kind), withGiven ? ["given_angle"] : []);
      if (withGiven) assert.deepEqual(original.completion?.additions[0]?.quantityIds, ["incidence"]);
      const profiles = [
        { id: "explicit-constructor-retry", env: "0", explicit: true },
        { id: "environment-constructor-retry", env: "1", explicit: undefined },
      ];
      for (const profile of profiles) {
        process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS = profile.env;
        const result = selectProductionScene({ ...input, constructorLawsEnabled: profile.explicit });
        assert.deepEqual({ selected, turnPlan }, untouched, "speculative retries cannot mutate the baseline or plan");
        assert.deepEqual(result.representation, original.representation, `${profile.id}: retain the exact original completion scene, proofs and all ink`);
        assert.equal(result.completion?.adopted, withGiven);
        assert.deepEqual(result.completion?.additions, original.completion?.additions, "report only the actually selected original additions");
        assert.match(result.completion?.rejection ?? "", /^constructor extension rejected; original completion profile retained: /);
        assert.match(result.completion?.rejection ?? "", /completion admission changed existing document information/);
        assert.equal((result.completion?.rejection?.match(/constructor extension rejected/g) ?? []).length, 1, "retry is bounded even while the environment stays on");
        assert(result.completion?.skipped.some(skip => skip.code === "constructor_extension_rejected" && skip.entityIds?.includes("support") && skip.entityIds.includes("drop")));
        assert(!result.representation!.sceneDocument.constructions.some(c => c.operator === "right_angle_mark"), "no rejected constructor fragment or orphan mark survives");
        const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: result.representation!.sceneDocument,
          sceneEngineVersion: SCENE_ENGINE_VERSION, validationReport: result.representation!.validationReport, visualStatus: "validated", segments: [],
          sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, problemIR: null, solverResult: null, solverAuthority: null,
            representationTier: result.representation!.tier, nonMetric: false, figureSource: "planner", candidates: [], selectedCandidateId: null,
            selectionReason: "authored retained completion profile", diagramResultStatus: "ready", completion: result.completion } });
        assert(saved.ok, saved.ok ? "" : saved.error);
        const reopened = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify({ ...saved.value, question })));
        assert(reopened.ok && reopened.value.sceneDocument, reopened.ok ? "" : reopened.error);
        assert.deepEqual(reopened.value.sceneDocument, original.representation!.sceneDocument);
        assert.deepEqual(reopened.value.sceneArtifacts?.completion, result.completion, "persist the rejected extension diagnostic alongside actual original adoption");
        const compiled = compileSceneDocument(reopened.value.sceneDocument); assert(compiled.ok && compiled.renderScene);
        assert.deepEqual(compiled.renderScene, original.representation!.renderScene);
        passed++;
      }
      for (const env of [undefined, "1"]) {
        if (env === undefined) delete process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS;
        else process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS = env;
        assert.deepEqual(selectProductionScene({ ...input, constructorLawsEnabled: false }), original, "explicit false retains exact original behavior even with env on");
        if (env === undefined) assert.deepEqual(selectProductionScene(input), original, "default-off behavior is unchanged");
        const off = selectProductionScene({ ...input, completionEnabled: false, constructorLawsEnabled: true });
        assert.deepEqual(off.representation, selected); assert.equal(off.completion, undefined);
        passed++;
      }
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS;
    else process.env.NEXT_PUBLIC_SCENE_COMPLETION_CONSTRUCTOR_LAWS = previous;
  }
  console.log(`constructor-law retained original completion: ${passed}/8 profiles passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
