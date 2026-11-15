/** Compilation alone cannot let a planner replace requested function graphs. */
import assert from "node:assert/strict";
import { compileSceneDocument, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { admitStoredScene } from "../../lib/scene/sceneAdmission";

const question = "A curve y=x^2 and the line y=4 enclose a region. Sketch the region, then find its area using integration.";
const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [{ id: "area", symbol: "A", unit: "square units" }], derived: [{ id: "area_value", symbol: "A", value: 32 / 3, unit: "square units", provenance: "derived" }], qualitativeClaims: [], lawIds: ["area_between_curves"], assumptions: [] };
function unrelated(source: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "mechanically valid segment" }, source: { question: source, exact: true }, quantities: [],
    entities: [{ id: "a", kind: "point", role: "endpoint", label: "A" }, { id: "b", kind: "point", role: "endpoint", label: "B" }, { id: "ab", kind: "segment", role: "segment", label: "AB" }],
    constructions: [{ id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] }, { id: "make_b", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] }, { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] }],
    relations: [], assertions: [{ id: "exists_ab", predicate: "exists", entities: ["ab"], expected: true, severity: "fatal" }], annotations: [], requiredEntityIds: ["a", "b", "ab"], revealGroups: [{ id: "setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "Draw AB." }], teachingTimeline: [],
  };
}
function graph(source: string, bodies: string[], labels: string[], axes = true): SceneDocument {
  const ids = bodies.map((_body, index) => `curve_${index}`);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "declared function plot" }, source: { question: source }, quantities: [],
    entities: [...(axes ? [{ id: "axes", kind: "axes", role: "Cartesian axes" }] : []), ...ids.map((id, index) => ({ id, kind: "polyline", role: "function curve", label: labels[index]! }))],
    constructions: [...(axes ? [{ id: "make_axes", operator: "axes", inputs: { xMin: -2, xMax: 2, yMin: -1, yMax: 5 }, outputs: ["axes"] }] : []), ...ids.map((id, index) => ({ id: `make_${id}`, operator: "function_curve", inputs: { expression: bodies[index]!, variable: "x", xMin: -2, xMax: 2, samples: 65 }, outputs: [id] }))],
    relations: [], assertions: [], annotations: [], requiredEntityIds: [...(axes ? ["axes"] : []), ...ids],
    revealGroups: [{ id: "setup", entityIds: [...(axes ? ["axes"] : []), ...ids], dependsOn: [], narrationCue: "Draw the requested functions." }], teachingTimeline: [],
  };
}
async function main() {
  const document = unrelated(question);
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, "the regression must pass mechanical compilation first");
  const validation = validateProductionSceneCandidate({ question, turnPlan: plan, candidate: { ...document } });
  assert.equal(validation.valid, false, "an unrelated segment cannot satisfy the source's requested curves");
  assert(validation.errors.some(issue => issue.code === "source_function_inventory_unmet"));
  const exact = { sceneDocument: document, renderScene: compiled.renderScene, validationReport: compiled.report };
  const selected = selectVerifiedRepresentation({ question, turnPlan: plan, exact });
  assert(!selected.sceneDocument.entities.some(entity => entity.id === "ab"), "lower-level exact selection rechecks the source inventory");
  const live = selectProductionScene({ question, turnPlan: plan, problemIR: null, candidateValidation: validation, requiredRetryEnabled: true });
  assert(!live.representation?.sceneDocument.entities.some(entity => entity.id === "ab"));
  for (const retainedPlan of [plan, null]) {
    for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
      assert.match(sceneSaveAdmissionFailure({ question, document, turnPlan: retainedPlan, tier }) ?? "", /source_function_inventory_unmet/, "source obligations survive missing planner metadata and all tiers");
    }
    const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: document, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: retainedPlan, representationTier: "question_representation", nonMetric: true, diagramResultStatus: "ready" }, segments: [] });
    assert(!saved.ok, "canonical save must refuse the unrelated compiled figure");
  }
  for (const source of [question, "Plot y=x^2 and y=4.", "Sketch the graph of y=x^2.", "Find the area of the region bounded by y=4-x^2 and the x axis", "Sketch y=x^2 and its tangent at x=1."]) {
    const ownPlan = { ...plan, question: source, unknowns: [], derived: [] };
    const native = selectVerifiedRepresentation({ question: source, turnPlan: ownPlan });
    assert.equal(native.sceneDocument.visualDecision.mode, "scene");
    assert(native.sceneDocument.constructions.some(construction => construction.operator === "function_curve"));
    assert.equal(sceneSaveAdmissionFailure({ question: source, document: native.sceneDocument, turnPlan: ownPlan, tier: native.tier }), null, "complete source-owned curves retain their live/save authority");
    const saved = await canonicalizeTurnSceneMetadata({ question: source, sceneDocument: native.sceneDocument, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: ownPlan, representationTier: native.tier, nonMetric: native.nonMetric, diagramResultStatus: "ready" }, segments: [] });
    assert(saved.ok, saved.ok ? "" : saved.error);
    assert(saved.value.sceneDocument);
    assert.equal(sceneSaveAdmissionFailure({ question: source, document: JSON.parse(JSON.stringify(saved.value.sceneDocument)), turnPlan: ownPlan, tier: native.tier }), null);
    const reopened = admitStoredScene({ sceneDocument: JSON.parse(JSON.stringify(saved.value.sceneDocument)), sceneQuestion: source, turnPlan: ownPlan, submittedTier: native.tier });
    assert(reopened.ok, reopened.ok ? "" : reopened.message);
    if (source === "Sketch the graph of y=x^2.") {
      const partial = structuredClone(native.sceneDocument);
      partial.source.question = question;
      const partialCompile = compileSceneDocument(partial);
      assert(partialCompile.ok && partialCompile.renderScene, "a correct single curve remains geometrically valid");
      const partialAdmission = validateProductionSceneCandidate({ question, turnPlan: plan, candidate: { ...partial } });
      assert(!partialAdmission.valid && partialAdmission.errors.some(issue => issue.code === "source_function_inventory_unmet"), "one correct curve cannot replace the complete requested pair");
      assert.match(sceneSaveAdmissionFailure({ question, document: partial, turnPlan: null, tier: native.tier }) ?? "", /source_function_inventory_unmet/);
    }
  }
  const segmentQuestion = "Show A=(0,0) and B=(3,0), joined by segment AB.";
  const segmentPlan = { ...plan, question: segmentQuestion, unknowns: [], derived: [], lawIds: [] };
  const segment = unrelated(segmentQuestion);
  assert(validateProductionSceneCandidate({ question: segmentQuestion, turnPlan: segmentPlan, candidate: { ...segment } }).valid, "a source-matching segment remains valid");
  assert.equal(sceneSaveAdmissionFailure({ question: segmentQuestion, document: segment, turnPlan: segmentPlan, tier: "question_representation" }), null);
  const quotedQuestion = segmentQuestion + ' The quoted text "plot y=x^2" is an example, not a requested graph.';
  const quotedSegment = unrelated(quotedQuestion);
  assert(validateProductionSceneCandidate({ question: quotedQuestion, turnPlan: { ...segmentPlan, question: quotedQuestion }, candidate: { ...quotedSegment } }).valid, "quoted equations cannot create a graph obligation for the requested segment");
  for (const source of ["Sketch y=x^2 and its normal at x=1.", question + " A=32/3."]) {
    const doc = unrelated(source);
    const ownPlan = { ...segmentPlan, question: source };
    const live = selectProductionScene({ question: source, turnPlan: ownPlan, problemIR: null, candidate: { ...doc }, requiredRetryEnabled: true, policy: { preferPlanner: true, allowedFigureSources: ["planner"] } });
    assert.notEqual(live.visualStatus, "validated", "other requested marks or unrelated scalar equalities cannot hide the source curves");
    const saved = await canonicalizeTurnSceneMetadata({ question: source, sceneDocument: doc, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: ownPlan, representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready" }, segments: [] });
    assert(!saved.ok);
  }
  for (const [source, body, label] of [
    ["Plot f(x)=x^2.", "x^2", "f(x)=x^2"], ["Plot y=x^2.", "x^2", "C: y=x^2"],
    ["Plot y=x*x.", "x*x", "y=x^2"], ["Plot y=x^2.", "x^2", "y-x^2=0"],
  ]) {
    const ownPlan = { ...segmentPlan, question: source! };
    const doc = graph(source!, [body!], [label!]);
    assert(compileSceneDocument(doc, { figureConsistency: true }).ok, "the complete equation label is supported by the compiler");
    assert(validateProductionSceneCandidate({ question: source!, turnPlan: ownPlan, candidate: { ...doc } }).valid, label);
    const saved = await canonicalizeTurnSceneMetadata({ question: source!, sceneDocument: doc, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: ownPlan, representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready" }, segments: [] });
    assert(saved.ok, saved.ok ? "" : saved.error);
  }
  for (const source of ["Sketch a segment AB lying on y=0, with endpoints at (0,0) and (3,0).", "An electron at y=0 is in a region containing a rightward electric field. Sketch the electric field vector E and the force vector F."]) {
    const doc = unrelated(source);
    if (source.startsWith("An electron")) {
      doc.entities = [{ id: "q", kind: "point", role: "electron", label: "electron" }, { id: "E", kind: "vector", role: "electric field", label: "E" }, { id: "F", kind: "vector", role: "electric force", label: "F" }];
      doc.constructions = [{ id: "make_q", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["q"] }, ...[["E", 1], ["F", -1]].map(([id, direction]) => ({ id: `make_${id}`, operator: "vector", inputs: { start: "q", direction: [direction, 0], length: 2 }, outputs: [String(id)] }))];
      doc.assertions = []; doc.requiredEntityIds = ["q", "E", "F"]; doc.revealGroups[0]!.entityIds = ["q", "E", "F"];
    }
    const ownPlan = { ...segmentPlan, question: source };
    assert(validateProductionSceneCandidate({ question: source, turnPlan: ownPlan, candidate: { ...doc } }).valid, "a position or segment constraint does not request a full function plot");
    assert.equal(sceneSaveAdmissionFailure({ question: source, document: doc, turnPlan: ownPlan, tier: "qualitative_verified" }), null);
  }
  const wrongBodies = graph("Plot y=x^2 and y=4.", ["x", "0"], ["y=x^2", "y=4"], false);
  assert(compileSceneDocument(wrongBodies).ok, "the axes-free regression must reach source admission");
  const wrongPlan = { ...segmentPlan, question: String(wrongBodies.source.question) };
  assert(!validateProductionSceneCandidate({ question: wrongPlan.question, turnPlan: wrongPlan, candidate: { ...wrongBodies } }).valid, "labels cannot vouch for wrong curve bodies when axes are absent");
  assert.match(sceneSaveAdmissionFailure({ question: wrongPlan.question, document: wrongBodies, turnPlan: null, tier: "qualitative_verified" }) ?? "", /source_function_inventory_unmet/);
  console.log("planner function inventory: production selection, exact selection, all-tier/no-plan save, native curves and JSON reopen controls passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
