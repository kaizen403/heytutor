/**
 * A scene candidate that passes per-candidate validation must either be the
 * figure drawn or leave a recorded reason. Production (15 Oct 2026): the
 * planner restated a messy stem (a bullet, LaTeX) in source.question, final
 * selection required the exact asked text, and a valid figure vanished with
 * no issue code. Synthetic stems only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeSceneDocumentModelOutput } from "@heytutor/tutor-core";
import { FIGURE_SOURCES, type FigureSource, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { extractArtifactSummary } from "../../lib/admin/outcome";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { selectVerifiedRepresentationExplained } from "../../features/tutor-session/lib/scene/representationFallback";
import {
  VALID_CANDIDATE_DROPPED,
  selectProductionScene,
  validCandidateDropDegradation,
  validateProductionSceneCandidate,
  type ProductionSceneSelection,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";

const asked = "• A 4 kg crate is dragged across a rough floor by a horizontal pull of 20 N. If the coefficient of " +
  "kinetic friction (\\mu _{k}) between the crate and the floor is 0.25, what is the acceleration of the crate? (Take g = 10 m/s^2)";
const reworded = "A 4 kg crate is pulled across a rough floor with a horizontal force of 20 N. The coefficient of kinetic " +
  "friction is 0.25 and g = 10 m/s². What is the acceleration of the crate?";
const otherQuestion = "A 6 kg box is pushed along a rough floor by a horizontal force of 30 N. The coefficient of kinetic " +
  "friction is 0.25 and g = 10 m/s². Find the acceleration of the box.";

const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question: asked, visualRequirement: "required",
  givens: [
    { id: "m", symbol: "m", value: 4, unit: "kg", provenance: "given", sourceText: "m = 4" },
    { id: "F", symbol: "F", value: 20, unit: "N", provenance: "given", sourceText: "F = 20" },
    { id: "mu", symbol: "μₖ", value: 0.25, provenance: "given", sourceText: "mu = 0.25" },
    { id: "g", symbol: "g", value: 10, unit: "m/s²", provenance: "given", sourceText: "g = 10" },
  ],
  unknowns: [{ id: "a", symbol: "a", unit: "m/s²" }],
  derived: [
    { id: "a", symbol: "a", value: 2.5, unit: "m/s²", provenance: "derived", dependsOn: ["F", "fr", "m"],
      sourceText: "a = (F − fₖ)/m = (20 − 10)/4 = 2.5 m/s²" },
    { id: "fr", symbol: "fₖ", value: 10, unit: "N", provenance: "derived", dependsOn: ["mu", "m", "g"],
      sourceText: "fₖ = μₖmg = 0.25 × 4 × 10 = 10 N" },
  ],
  qualitativeClaims: [], lawIds: ["kinetic-friction-law", "newtons-second-law"], assumptions: [],
};

/** A planner response as the model wrote it: the stem restated in its own words. */
const plannerOutput = (question: string): Record<string, unknown> => ({
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "planner visual decision" },
  source: { question },
  quantities: [
    { id: "m", symbol: "m", value: 4, unit: "kg", provenance: "given" },
    { id: "F", symbol: "F", value: 20, unit: "N", provenance: "given" },
    { id: "mu", symbol: "μₖ", value: 0.25, provenance: "given" },
    { id: "g", symbol: "g", value: 10, unit: "m/s²", provenance: "given" },
    { id: "a", symbol: "a", value: 2.5, unit: "m/s²", provenance: "derived", dependsOn: ["F", "fr", "m"] },
    { id: "fr", symbol: "fₖ", value: 10, unit: "N", provenance: "derived", dependsOn: ["mu", "m", "g"] },
  ],
  entities: [
    { id: "surfaceLeft", kind: "point", role: "helper point" },
    { id: "surfaceRight", kind: "point", role: "helper point" },
    { id: "surface", kind: "segment", role: "surface" },
    { id: "bodyCenter", kind: "point", role: "helper point" },
    { id: "body", kind: "rectangle", role: "body", label: "m = 4 kg" },
    { id: "forceTip", kind: "point", role: "helper point" },
    { id: "pull", kind: "vector", role: "applied force", label: "F = 20 N" },
  ],
  constructions: [
    { id: "c1", operator: "point", inputs: { x: -3, y: 0, coordinateSpace: "world" }, outputs: ["surfaceLeft"] },
    { id: "c2", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["surfaceRight"] },
    { id: "c3", operator: "segment", inputs: { start: "surfaceLeft", end: "surfaceRight" }, outputs: ["surface"] },
    { id: "c4", operator: "point", inputs: { x: 0, y: 0.5, coordinateSpace: "world" }, outputs: ["bodyCenter"] },
    { id: "c5", operator: "rectangle", inputs: { center: "bodyCenter", width: 2, height: 1 }, outputs: ["body"] },
    { id: "c6", operator: "point", inputs: { x: 2, y: 0.5, coordinateSpace: "world" }, outputs: ["forceTip"] },
    { id: "c7", operator: "vector", inputs: { start: "bodyCenter", end: "forceTip" }, outputs: ["pull"] },
  ],
  relations: [], assertions: [],
  annotations: [
    { id: "muLabel", kind: "label", targetIds: ["surface"], text: "μₖ = 0.25", quantityId: "mu" },
    { id: "gLabel", kind: "label", targetIds: ["body"], text: "g = 10 m/s²", quantityId: "g" },
  ],
  requiredEntityIds: ["body", "surface", "pull", "surfaceLeft", "surfaceRight", "bodyCenter", "forceTip"],
  revealGroups: [{ id: "setup", entityIds: ["surfaceLeft", "surfaceRight", "surface", "bodyCenter", "body", "forceTip", "pull"],
    dependsOn: [], narrationCue: "reveal scene" }],
  teachingTimeline: [],
});

const strictPolicy = { preferPlanner: true, allowedFigureSources: ["planner", "verified_recovery", "text_only"] as FigureSource[] };
const currentPolicy = { preferPlanner: false, allowedFigureSources: [...FIGURE_SOURCES] };
const select = (candidate: Record<string, unknown>, policy: typeof strictPolicy,
  exactFigureSource: "planner" | "verified_recovery" = "planner"): ProductionSceneSelection => {
  const candidateValidation = validateProductionSceneCandidate({ candidate: structuredClone(candidate), question: asked, turnPlan: plan });
  return selectProductionScene({ question: asked, turnPlan: plan, problemIR: null, candidateValidation,
    exactFigureSource, requiredRetryEnabled: true, policy });
};
const labels = (selection: ProductionSceneSelection) => selection.representation?.renderScene.primitives.flatMap((primitive) =>
  (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text ? [primitive.text] : []) ?? [];

// 1. The parse boundary writes the asked question into a fresh candidate.
const parsed = normalizeSceneDocumentModelOutput(plannerOutput(reworded), asked) as Record<string, unknown>;
assert.equal((parsed.source as SceneDocument["source"]).question, asked,
  "a fresh planner candidate must carry the asked question, not the planner's restatement");

// 2. That candidate validates and is drawn, strict and current alike.
for (const [name, policy] of [["strict", strictPolicy], ["current", currentPolicy]] as const) {
  const drawn = select(parsed, policy);
  assert(drawn.candidateValidation?.valid, `${name}: the reworded fixture must validate`);
  assert(drawn.representation, `${name}: a valid planner figure was dropped: ${drawn.reason}`);
  assert.equal(drawn.representation.figureSource, "planner", `${name}: the planner figure must be the one drawn`);
  assert.equal(drawn.visualStatus, "validated");
  assert.equal(drawn.droppedCandidate, null, `${name}: a drawn candidate records no drop`);
  assert(labels(drawn).includes("F = 20 N") && labels(drawn).includes("m = 4 kg"), `${name}: the drawn figure keeps its labels`);
}

// 3. Without the parse boundary the selector still refuses the restated
// question, but it can no longer do so silently: the drop names itself and
// leaves a degradation with its own issue code.
const unparsed = plannerOutput(reworded);
const silent = select(unparsed, strictPolicy);
assert(silent.candidateValidation?.valid, "the validator does not compare source.question, so this candidate is valid");
assert.equal(silent.representation, null);
assert.equal(silent.droppedCandidate?.code, "source_question_mismatch");
assert.equal(silent.droppedCandidate?.replacedBy, null);
const degradation = validCandidateDropDegradation(silent, 2);
assert.deepEqual(degradation, {
  attemptedTier: "exact_verified", reason: VALID_CANDIDATE_DROPPED,
  issueCodes: [VALID_CANDIDATE_DROPPED, "source_question_mismatch"], candidateCount: 2,
}, "a valid candidate that left the board must leave a degradation");

// 4. A recovered or persisted scene keeps its own question, and one drawn for
// another question is still refused.
const recovered = plannerOutput(otherQuestion);
for (const [name, policy] of [["strict", strictPolicy], ["current", currentPolicy]] as const) {
  const refused = select(recovered, policy, "verified_recovery");
  assert.notEqual(refused.representation?.figureSource, "verified_recovery",
    `${name}: a recovered scene from a different question must never be drawn`);
  assert.equal(refused.droppedCandidate?.code, "source_question_mismatch", `${name}: the refusal names itself`);
}
const recoveredValidation = validateProductionSceneCandidate({ candidate: structuredClone(recovered), question: asked, turnPlan: plan });
assert(recoveredValidation.valid && recoveredValidation.value);
const direct = selectVerifiedRepresentationExplained({ question: asked, turnPlan: plan, preferPlanner: true,
  exact: { sceneDocument: recoveredValidation.value.document, renderScene: recoveredValidation.value.renderScene,
    validationReport: recoveredValidation.value.report },
  exactFigureSource: "verified_recovery" });
assert.notEqual(direct.selected.figureSource, "verified_recovery");
assert.equal(direct.exactDecline?.code, "source_question_mismatch");
const recoverySource = readFileSync(resolve(process.cwd(), "features/tutor-session/lib/scene/verifiedSceneRecovery.ts"), "utf8");
assert(!recoverySource.includes("normalizeSceneDocumentModelOutput"),
  "recovered scenes must not pass through the planner parse boundary that rewrites source.question");

// 5. Parity: every valid scene candidate is drawn or leaves a recorded reason.
const sweep: Array<[string, Record<string, unknown>]> = [["parsed", parsed], ["unparsed", unparsed], ["recovered", recovered]];
let checked = 0;
for (const [name, candidate] of sweep) {
  for (const policy of [strictPolicy, currentPolicy]) {
    for (const source of ["planner", "verified_recovery"] as const) {
      const selection = select(candidate, policy, source);
      if (!selection.candidateValidation?.valid) continue;
      checked += 1;
      const drawn = selection.representation?.figureSource === source;
      assert(drawn || selection.droppedCandidate,
        `${name}/${source}: a valid candidate was neither drawn nor given a recorded reason (${selection.reason})`);
      if (selection.droppedCandidate && !(selection.droppedCandidate.preferred && selection.droppedCandidate.replacedBy)) {
        assert(validCandidateDropDegradation(selection, 1)?.issueCodes.includes(selection.droppedCandidate.code),
          `${name}/${source}: a drop that is not a drawn preference must leave a degradation`);
      }
    }
  }
}
assert.equal(checked, 12, "every sweep case must exercise a valid candidate");

// 6. The reason is saved, read by the admin fails page, and wired in both consumers.
async function verifyPersistenceAndWiring(): Promise<void> {
  const saved = await canonicalizeTurnSceneMetadata({
    question: asked, visualStatus: "retry_required",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", turnPlan: plan, candidates: [], diagramResultStatus: "retry_required",
      degradation: degradation!,
    },
    segments: [],
  });
  assert(saved.ok, "a dropped-candidate degradation must persist");
  assert.equal(saved.value.sceneArtifacts?.degradation?.reason, VALID_CANDIDATE_DROPPED);
  assert.deepEqual(saved.value.sceneArtifacts?.degradation?.issueCodes, [VALID_CANDIDATE_DROPPED, "source_question_mismatch"]);
  const summary = extractArtifactSummary(saved.value.sceneArtifacts);
  assert.equal(summary?.degradationReason, VALID_CANDIDATE_DROPPED, "the admin fails page must read the new reason");
  assert(summary?.issueCodes.includes("source_question_mismatch"));

  const hook = readFileSync(resolve(process.cwd(), "features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
  const selectionAt = hook.indexOf("const sceneSelection = measureSceneSelection(tel, \"final\"");
  const dropAt = hook.indexOf("validCandidateDropDegradation(sceneSelection, result?.candidates.length ?? 0)");
  const artifactsAt = hook.indexOf("degradation: exactDegradation,");
  assert(selectionAt > 0 && dropAt > selectionAt && artifactsAt > dropAt,
    "the live hook must turn a dropped candidate into the saved degradation after final selection");
  const between = hook.slice(dropAt, artifactsAt);
  assert(between.includes("exactDegradation = droppedDegradation"), "the live hook must save the drop degradation");
  assert(between.includes("console.warn(\"[diagram] a valid figure candidate was dropped at selection\""),
    "the live hook must report the drop to Sentry");
  assert(between.includes("tel.mark(\"verified-scene-candidate-dropped\""), "the live hook must trace the drop");
  const lab = readFileSync(resolve(process.cwd(), "scripts/lecture-lab/lecturePipeline.ts"), "utf8");
  assert(lab.includes("validCandidateDropDegradation(sceneSelection, result?.candidates.length ?? 0)") &&
    lab.includes("run.diagram.droppedCandidate = sceneSelection.droppedCandidate;"),
  "the lab must record the same drop as the live hook");
}

void verifyPersistenceAndWiring().then(() => {
  console.log(`valid candidate parity: parse boundary, reworded stem drawn, silent drop recorded, recovered guard, ${checked} sweep cases and wiring pass`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
