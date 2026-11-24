import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { getSegmentCommands, remainingDeferredAnnotations, takeDeferredAnnotations } from "@heytutor/drawing";
import { validateProblemIR, type TurnPlanV3 } from "@heytutor/scene-engine";
import { buildSourceCertifiedScientificScene } from "../../../../packages/scene-engine/src/synthesize/sourceCertifiedScientificScene";
import { selectProductionFastRepresentation, selectProductionNativeSourceRepresentation,
  selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

const question = "Solve x + y = 5 and x - y = 1. Plot both lines and label their intersection.";
const turnPlan = createFallbackTurnPlanV3(question);
const selected = selectProductionNativeSourceRepresentation(question, turnPlan, null);
assert(selected?.figureSource === "native_source");
assert.equal(selectProductionFastRepresentation({ question, turnPlan, families: [] }), null,
  "the new acquisition is explicitly opt-in");
const input = { question, turnPlan, problemIR: null, policy: { allowedFigureSources: ["native_source" as const], preferPlanner: false } };
assert(selectProductionScene({ ...input, fastRepresentation: selected }).representation, "fresh source replay remains drawable");
let checks = 3;
for (const mutate of [
  (value: typeof selected) => { value.renderScene.primitives.find(item => item.points.length)!.points[0]!.x += 123; },
  (value: typeof selected) => { value.sceneDocument.entities[0]!.role = "forged physical owner"; },
  (value: typeof selected) => { value.tier = value.tier === "exact_verified" ? "qualitative_verified" : "exact_verified"; },
  (value: typeof selected) => { value.nonMetric = !value.nonMetric; },
  (value: typeof selected) => { value.sceneDocument.source.answerLabelPrimitiveIds = []; },
]) {
  const forged = structuredClone(selected);
  mutate(forged);
  const result = selectProductionScene({ ...input, fastRepresentation: forged });
  assert.equal(result.representation, null, "failed native source replay cannot fall through to caller geometry/timing"); checks++;
}
const intersection = selected.renderScene.primitives.find(primitive => primitive.kind === "label" && primitive.text?.includes("3, 2"));
assert(intersection);
assert(Array.isArray(selected.sceneDocument.source.answerLabelPrimitiveIds) && selected.sceneDocument.source.answerLabelPrimitiveIds.includes(intersection.id),
  "the native guide's conservative answer timing survives a sparse accepted plan"); checks += 2;
const forgedStyle = structuredClone(selected.sceneDocument);
forgedStyle.source.scientificStyle = { schema: "scientific-style-lecture/v1", paletteId: "teal", sampleHash: "a".repeat(64) };
const candidate = validateProductionSceneCandidate({ question, turnPlan, problemIR: null, candidate: { ...forgedStyle } });
assert(candidate.valid && candidate.value);
assert.equal(candidate.value.document.source.scientificStyle, undefined, "a candidate cannot grant itself server-owned styling"); checks += 2;

const rows = JSON.parse(readFileSync(new URL("../../../../packages/scene-engine/scripts/verify/fixtures/native-source-lecture.json", import.meta.url), "utf8")) as
  Array<{ name: string; question: string; turnPlan: TurnPlanV3; problemIR: unknown }>;
for (const row of rows) {
  const native = selectProductionNativeSourceRepresentation(row.question, row.turnPlan, row.problemIR);
  assert(native);
  if (row.name.includes("rutherford")) {
    const encounter = native.sceneDocument.constructions.find(construction => construction.operator === "rutherford_scattering");
    assert(encounter);
    assert.deepEqual([encounter.inputs.projectileCharge, encounter.inputs.targetCharge], ["qAlpha", "qNucleus"]);
    assert.equal(native.sceneDocument.quantities.find(quantity => quantity.id === "qAlpha")?.unit, "e");
    assert.equal(native.sceneDocument.quantities.find(quantity => quantity.id === "qNucleus")?.unit, "e");
    assert.equal(encounter.inputs.impactParameter, undefined);
    assert.equal((encounter.inputs.resultBindings as Record<string, unknown>).closestApproach, "rMin");
    const proposed = buildSourceCertifiedScientificScene(row.question, row.turnPlan);
    assert(proposed && !proposed.document.quantities.some(quantity => quantity.id === "rMin" || quantity.id === "b")); checks += 6;
  }
  const parsedIr = validateProblemIR(row.problemIR, row.question);
  assert(row.problemIR === null || parsedIr.valid, `${row.name}: the captured ProblemIR must stay valid`);
  const result = selectProductionScene({ question: row.question, turnPlan: row.turnPlan, problemIR: parsedIr.problem,
    fastRepresentation: native, policy: { allowedFigureSources: ["native_source"], preferPlanner: false } });
  assert(result.representation, `${row.name}: ${result.reason}`);
  assert.equal(result.saveFailure, null); checks += 3;
}
const conversionQuestion = "Given v=10 m/s. Show v in m/s and km/h.";
const conversionPlan = createFallbackTurnPlanV3(conversionQuestion);
const alternative = selectProductionFastRepresentation({ question: conversionQuestion, turnPlan: conversionPlan, problemIR: null });
assert(alternative?.figureSource === "fast_family", "a complete independent unit-conversion source remains an ordinary verified alternative");
const presentation = buildVerifiedDiagramPresentation(alternative.sceneDocument, alternative.renderScene,
  { originalQuestion: conversionQuestion, turnPlan: conversionPlan });
assert(!presentation.introSegments.flatMap(getSegmentCommands).some(command => command.text === "v=36 km/h"));
const diagram = structuredClone(presentation.diagram);
assert(!takeDeferredAnnotations(diagram, { entityIds: alternative.sceneDocument.requiredEntityIds }).some(command => command.text === "v=36 km/h"),
  "ordinary family lowering cannot make a computed conversion focus-revealable");
assert(remainingDeferredAnnotations(diagram).some(command => command.text === "v=36 km/h"), "the computed conversion remains available after teaching"); checks += 4;
for (const mutate of [
  (document: typeof alternative.sceneDocument) => { document.quantities.find(quantity => quantity.id === "value_1")!.value = 37; },
  (document: typeof alternative.sceneDocument) => { document.quantities.find(quantity => quantity.id === "value_1")!.unit = "Bq"; },
  (document: typeof alternative.sceneDocument) => { document.entities.find(entity => entity.id === "equivalent_rate")!.label = "v=37 km/h"; },
]) {
  const forged = structuredClone(alternative.sceneDocument); mutate(forged);
  assert(!validateProductionSceneCandidate({ question: conversionQuestion, turnPlan: conversionPlan, problemIR: null, candidate: { ...forged } }).valid,
    "source-proved conversion values and units cannot authorize a forged quantity or label"); checks++;
}
console.log(`native source lecture admission: ${checks} checks passed; no provider calls`);
