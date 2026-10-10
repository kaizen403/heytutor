import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import { type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import {
  deriveSceneGate,
  selectProductionScene,
  validateProductionSceneCandidate,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";

const planFor = (question: string, visualRequirement: TurnPlanV3["visualRequirement"]): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, visualRequirement,
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
});

const matrix = "A=[[1,2],[3,4]] and B=[[0,1],[1,0]]. Find AB and BA.";
const matrixPlan = planFor(matrix, "none");
const capabilities = inferSceneCapabilities(matrix, { turnPlan: matrixPlan });
const frozenInput = JSON.stringify({ matrixPlan, capabilities });
const matrixGate = deriveSceneGate({ question: matrix, turnPlan: matrixPlan, problemIR: null,
  sceneCapabilities: capabilities, visualNeedDecision: null });
assert.equal(matrixGate.turnPlan.visualRequirement, "optional", "unavailable Jev reopens a bound source program");
assert.equal(matrixGate.shouldAttemptLlmScene, true, "a source program is admitted even without a family or archetype");
assert.deepEqual(matrixGate.request.constructionOperators, capabilities.constructionOperators);
const matrixSelected = selectProductionScene({ question: matrix, turnPlan: matrixPlan, problemIR: null,
  sceneCapabilities: capabilities, visualNeedDecision: null });
assert(matrixSelected.representation, matrixSelected.reason);
assert.equal(matrixSelected.visualStatus, "validated");
assert(matrixSelected.representation.sceneDocument.entities.some((entity) => entity.kind === "matrix_array"));
assert.equal(JSON.stringify({ matrixPlan, capabilities }), frozenInput, "the shared selection is pure and never mutates its inputs");
const veto = selectProductionScene({ question: matrix, turnPlan: matrixPlan, problemIR: null,
  sceneCapabilities: capabilities, visualNeedDecision: "none" });
assert.equal(veto.representation, null, "explicit none remains a no-figure decision");
assert.equal(veto.reason, "the question asks for no figure");
assert.equal(veto.gate.shouldAttemptLlmScene, false);

const question = "A 12 V battery is connected across a 4 Ω resistor. Find the current.";
const plan: TurnPlanV3 = { ...planFor(question, "required"), givens: [
  { id: "V", symbol: "V", value: 12, unit: "V", provenance: "given", sourceText: "12 V" },
  { id: "R", symbol: "R", value: 4, unit: "Ω", provenance: "given", sourceText: "4 Ω" },
] };
const circuitCaps = inferSceneCapabilities(question, { turnPlan: plan });
const selected = selectVerifiedRepresentation({ question, turnPlan: plan, families: circuitCaps.families });
const admitted = selectProductionScene({ question, turnPlan: plan, problemIR: null,
  sceneCapabilities: circuitCaps, fastRepresentation: selected });
assert.equal(admitted.representation, selected, "accepted fast geometry retains its identity and provenance");
assert.equal(admitted.selectionReason, selected.reason);
assert.equal(admitted.saveFailure, null);
const contradicted = selectProductionScene({ question, turnPlan: plan, problemIR: null,
  sceneCapabilities: circuitCaps, fastRepresentation: selected, solverAuthorityBlocked: true });
assert.equal(contradicted.representation, null, "a fast figure cannot bypass contradictory solver authority");
assert.equal(contradicted.reason, "solver_contradiction");
assert.equal(contradicted.visualStatus, "retry_required");
assert.equal(selectProductionScene({ question, turnPlan: plan, problemIR: null,
  sceneCapabilities: circuitCaps, fastRepresentation: selected, solverAuthorityBlocked: true,
  requiredRetryEnabled: false }).visualStatus, "text_only", "retry policy is an explicit pure input");
const suppressed = selectProductionScene({ question, turnPlan: plan, problemIR: null,
  sceneCapabilities: circuitCaps, fastRepresentation: selected,
  policy: { allowedFigureSources: ["planner", "verified_recovery", "text_only"] } });
assert.equal(suppressed.representation, null);
assert.equal(suppressed.sourceAllowed, false);
assert.equal(suppressed.saveFailure, null, "source suppression precedes save admission");
assert.equal(suppressed.selectionReason, `strict strategy suppressed ${selected.figureSource}`);

const malformed = validateProductionSceneCandidate({ candidate: { schemaVersion: "invalid" }, question, turnPlan: plan });
assert.equal(malformed.valid, false, "invalid documents cannot become exact candidates");
assert(malformed.errors.some((issue) => issue.severity === "fatal"));

const segmentQuestion = "Draw a labelled line segment AB.";
const segmentPlan = planFor(segmentQuestion, "required");
const candidate: SceneDocument = {
  schemaVersion: "scene-document/v2", source: { question: segmentQuestion },
  visualDecision: { mode: "scene", reason: "source-labelled segment" }, quantities: [],
  entities: [{ id: "a", kind: "point", role: "endpoint", label: "A" },
    { id: "b", kind: "point", role: "endpoint", label: "B" },
    { id: "ab", kind: "segment", role: "segment", label: "AB" }],
  constructions: [{ id: "pa", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "pb", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
    { id: "sab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] }],
  relations: [], assertions: [{ id: "exists", predicate: "exists", entities: ["ab"], expected: true, severity: "fatal" }],
  annotations: [], requiredEntityIds: ["a", "b", "ab"],
  revealGroups: [{ id: "setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "Draw AB." }],
  teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw AB." }],
};
const rawCandidate = candidate as unknown as Record<string, unknown>;
const validation = validateProductionSceneCandidate({ candidate: rawCandidate, question: segmentQuestion, turnPlan: segmentPlan });
assert(validation.valid && validation.value, JSON.stringify(validation.errors));
const plannerSelected = selectProductionScene({ question: segmentQuestion, turnPlan: segmentPlan, problemIR: null,
  candidateValidation: validation });
assert(plannerSelected.representation, plannerSelected.reason);
assert.equal(plannerSelected.representation.sceneDocument, validation.value.document,
  "accepted planner document identity survives selection for candidate provenance");
assert.equal(plannerSelected.representation.tier, "qualitative_verified", "existence proof never becomes exact");
const failedProof = validateProductionSceneCandidate({ candidate: { ...candidate,
  assertions: [{ ...candidate.assertions[0], expected: false }] }, question: segmentQuestion, turnPlan: segmentPlan });
assert.equal(failedProof.valid, false, "failed assertions are rejected before final save admission");
assert(failedProof.errors.some((issue) => issue.severity === "fatal"));

const chemistry = "Predict the hybridisation and shape of SF4 and XeF4.";
const chemGate = deriveSceneGate({ question: chemistry, turnPlan: planFor(chemistry, "required"), problemIR: null });
assert(chemGate.chemistryLane);
assert.equal(chemGate.shouldPlanExactScene, false);
assert.equal(chemGate.shouldAttemptLlmScene, false, "production chemistry still uses deterministic engine figures");

for (const consumer of ["features/tutor-session/hooks/turn/useQuestionHandler.ts", "scripts/lecture-lab/lecturePipeline.ts"]) {
  const source = readFileSync(resolve(process.cwd(), consumer), "utf8");
  assert(source.includes("selectProductionScene({"), `${consumer}: must call the same final decision`);
  assert(source.includes("deriveProductionSceneGate({"), `${consumer}: must call the same admission gate`);
  assert(source.includes("validateProductionSceneCandidate({"), `${consumer}: must share candidate validation`);
  assert(!source.includes("const selectedHasInk ="), `${consumer}: must not retain a divergent ink/save selection copy`);
}
const runner = readFileSync(resolve(process.cwd(), "scripts/lecture-lab/run.ts"), "utf8");
assert(runner.includes("figureSelectionPolicy: PRODUCTION_SCENE_SELECTION_VERSION"),
  "resume identity must distinguish old divergent lab admission from shared production selection");
console.log("production scene selection: visual need, source admission, purity, solver, source policy and both consumers pass");
