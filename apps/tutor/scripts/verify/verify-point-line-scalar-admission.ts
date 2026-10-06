// Sub17 point-line scalar admission controls, ported from the HEY83 private
// scratch gate with its frozen positive fixture vendored beside it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type SceneArtifactsV3, type SceneDocument } from "@heytutor/scene-engine";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

const directory = __dirname;

async function main(): Promise<void> {
const results: Array<Record<string, unknown>> = [];
for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
  for (const control of ["positive", "mutated", "missing", "wrong-quantity", "wrong-target", "ambiguous-target", "unitless-text", "unitless-bound-wrong-label", "duplicate-link", "missing-binding", "missing-solver", "given-fact-binding", "derived-only", "wrong-binding-unit", "component", "given-distance", "duplicate-binding", "absent-plan"] as const) {
    const original = JSON.parse(readFileSync(join(directory, "fixtures/point-line/annotation-link-positive.json"), "utf8"));
    const submitted: SubmittedTurnSceneMetadata = structuredClone(original.submitted);
    const scene = submitted.sceneDocument as SceneDocument;
    const artifacts = submitted.sceneArtifacts as SceneArtifactsV3;
    artifacts.representationTier = tier;
    artifacts.nonMetric = tier !== "exact_verified";
    scene.source.representationTier = tier;
    scene.source.nonMetric = tier !== "exact_verified";
    if (["mutated", "wrong-quantity", "unitless-text"].includes(control)) scene.constructions[2]!.inputs.c = -50;
    if (control === "missing") { scene.quantities = []; scene.annotations = []; }
    if (control === "wrong-quantity") scene.quantities[0]!.value = 10;
    if (control === "wrong-target") scene.annotations[0]!.targetIds = ["line"];
    if (control === "ambiguous-target") scene.annotations[0]!.targetIds = ["distance", "line"];
    if (control === "unitless-text") { scene.quantities = []; scene.annotations = []; scene.entities[2]!.label = "d=10"; }
    if (control === "unitless-bound-wrong-label") scene.entities[2]!.label = "d=10";
    if (control === "duplicate-link") scene.annotations.push({ ...scene.annotations[0]!, id: "second_link" });
    if (control === "missing-binding") delete artifacts.problemIR!.solveRequests[0]!.resultBinding;
    if (control === "missing-solver") { artifacts.problemIR = null; artifacts.solverResult = null; }
    if (control === "absent-plan") { artifacts.turnPlan = null; artifacts.problemIR = null; artifacts.solverResult = null; }
    if (control === "given-fact-binding") artifacts.problemIR!.facts[2]!.kind = "given";
    if (control === "derived-only") artifacts.turnPlan!.unknowns = [];
    if (control === "wrong-binding-unit") { artifacts.turnPlan!.unknowns = []; artifacts.problemIR!.solveRequests[0]!.resultBinding!.unit = "m"; }
    if (control === "duplicate-binding") {
      artifacts.problemIR!.solveRequests.push({ ...artifacts.problemIR!.solveRequests[0]!, id: "duplicate_request" });
      artifacts.solverResult!.values.push({ ...artifacts.solverResult!.values[0]!, id: "duplicate_value", requestId: "duplicate_request" });
      artifacts.solverResult!.proofs.push({ ...artifacts.solverResult!.proofs[0]!, id: "duplicate_proof", requestId: "duplicate_request" });
    }
    if (control === "given-distance") {
      const question = "Given P(0,0), line 3x+4y-25=0 and perpendicular distance d=5, show the given figure.";
      submitted.question = question; scene.source.question = question; artifacts.turnPlan!.question = question;
      artifacts.turnPlan!.givens.push({ id: "distanceValue", symbol: "d", value: 5, provenance: "given", sourceText: "d=5" });
      artifacts.turnPlan!.unknowns = []; artifacts.turnPlan!.derived = []; artifacts.problemIR = null; artifacts.solverResult = null;
    }
    if (control === "component") {
      scene.constructions = [scene.constructions[1]!]; scene.entities = [scene.entities[1]!]; scene.quantities = []; scene.annotations = [];
      scene.requiredEntityIds = ["P"]; scene.revealGroups[0]!.entityIds = ["P"];
      artifacts.problemIR = null; artifacts.solverResult = null;
    }
    const canonical = await canonicalizeTurnSceneMetadata(submitted);
    assert.equal(canonical.ok, ["positive", "derived-only", "component", "given-distance"].includes(control), `${tier}/${control}: ${canonical.ok ? "accepted" : canonical.error}`);
    const name = `${tier}-${control}`;
    results.push({ name, ok: canonical.ok, error: canonical.ok ? null : canonical.error });
  }
}
const question = "M=[[1,2],[3,4]]. Show M.";
const matrix: SceneDocument = {
  schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-given native M" }, source: { question, representationTier: "question_representation", nonMetric: true },
  quantities: [], entities: [{ id: "M", kind: "matrix_array", label: "M", role: "source matrix" }], constructions: [{ id: "make_M", operator: "matrix_array", inputs: { entries: [[1, 2], [3, 4]], origin: [0, 0], displayScale: 1 }, outputs: ["M"] }],
  relations: [], assertions: [], annotations: [], requiredEntityIds: ["M"], revealGroups: [{ id: "matrix", entityIds: ["M"], dependsOn: [], narrationCue: "Show the given M." }], teachingTimeline: [],
};
const nativeM = await canonicalizeTurnSceneMetadata({ question, sceneDocument: matrix, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: "question_representation", nonMetric: true, diagramResultStatus: "ready" }, segments: [] });
assert.ok(nativeM.ok, JSON.stringify(nativeM));
results.push({ name: "native-M-source-given-without-plan-or-solver", ok: nativeM.ok });
console.log(`point-line scalar admission: ${results.length} canonical controls passed (in-memory canonicalization only; not a student save, reopen or replay)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
