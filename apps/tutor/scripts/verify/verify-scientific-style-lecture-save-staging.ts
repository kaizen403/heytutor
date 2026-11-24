import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { getSegmentCommands, parseStoredSegmentCommands } from "@heytutor/drawing";
import { LocalDeterministicSolverProvider, validateProblemIR, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionNativeSourceRepresentation } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

async function main() {
  const question = "Solve x + y = 5 and x - y = 1. Plot both lines and label their intersection.";
  const turnPlan = createFallbackTurnPlanV3(question);
  turnPlan.visualRequirement = "required";
  const native = selectProductionNativeSourceRepresentation(question, turnPlan, null);
  assert(native);
  const save = async (sceneDocument: unknown, figureSource = "native_source") => canonicalizeTurnSceneMetadata({
    question, sceneDocument, visualStatus: "validated", segments: [],
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, problemIR: null, solverResult: null,
      representationTier: native.tier, nonMetric: native.nonMetric, figureSource, candidates: [], diagramResultStatus: "ready" },
  });
  const setupLabels = (value: Awaited<ReturnType<typeof save>>) => value.ok
    ? value.value.segments.flatMap(segment => parseStoredSegmentCommands(segment.command)).map(command => command.text)
    : [];
  for (const figureSource of ["native_source", "planner", "fast_family"]) {
    for (const variant of ["missing", "forged", "reordered"] as const) {
      const document = structuredClone(native.sceneDocument);
      document.source.unrelatedReviewNote = "cosmetic source data must never release computed labels";
      if (variant === "forged") document.source.answerLabelPrimitiveIds = ["made_up_answer"];
      else delete document.source.answerLabelPrimitiveIds;
      if (variant === "reordered") document.source = Object.fromEntries(Object.entries(document.source).reverse());
      const result = await save(document, figureSource);
      assert(result.ok, `${figureSource}/${variant}: ${!result.ok ? result.code : ""}`);
      assert(!setupLabels(result).includes("(3, 2)"), `${figureSource}/${variant}: optional metadata cannot promote an answer to setup`);
      const reopened = restoreVerifiedPresentationFromTurn({
        question,
        sceneDocument: document,
        sceneArtifacts: result.value.sceneArtifacts,
      });
      assert(reopened, `${figureSource}/${variant}: retained source plan permits direct reconstruction`);
      assert(!reopened.introSegments.flatMap(getSegmentCommands).some(command => command.text === "(3, 2)"),
        `${figureSource}/${variant}: direct restore cannot trust submitted answer timing`);
      assert(reopened.diagram.deferredAnnotations?.some(entry => entry.revealAfter === "teaching_complete" &&
        entry.commands.some(command => command.text === "(3, 2)")),
      `${figureSource}/${variant}: direct restore reconstructs the complete deferred answer`);
    }
  }
  const changed = structuredClone(native.sceneDocument);
  changed.constructions[0]!.inputs.equations = ["x+y=999", "x-y=1"];
  const refused = await save(changed);
  assert(!refused.ok, "a claimed native source must decline a scientific reconstruction mismatch");

  const rows = JSON.parse(readFileSync(new URL("../../../../packages/scene-engine/scripts/verify/fixtures/native-source-lecture.json", import.meta.url), "utf8")) as
    Array<{ name: string; question: string; turnPlan: TurnPlanV3; problemIR: unknown }>;
  const activity = rows.find(row => row.name === "an_v1_activity_and_decay_law_v1");
  assert(activity);
  const parsed = validateProblemIR(activity.problemIR, activity.question);
  assert(parsed.valid && parsed.problem);
  const solverResult = await new LocalDeterministicSolverProvider().solve(parsed.problem, {
    signal: new AbortController().signal, deadlineMs: Date.now() + 5_000,
  });
  assert.equal(solverResult.status, "solved");
  const activityNative = selectProductionNativeSourceRepresentation(activity.question, activity.turnPlan, parsed.problem);
  assert(activityNative, "the source, original plan and deterministic IR agree on activity and rate units");
  const activityMetadata = {
    question: activity.question, sceneDocument: activityNative.sceneDocument, visualStatus: "validated" as const, segments: [],
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: activity.turnPlan, problemIR: parsed.problem, solverResult,
      representationTier: activityNative.tier, nonMetric: activityNative.nonMetric, figureSource: "native_source", candidates: [], diagramResultStatus: "ready" },
  };
  const activitySaved = await canonicalizeTurnSceneMetadata(activityMetadata);
  assert(activitySaved.ok, !activitySaved.ok ? activitySaved.code : "");
  assert(activitySaved.value.sceneArtifacts);
  assert.deepEqual(activitySaved.value.sceneArtifacts.problemIR, parsed.problem, "save retains the canonical original IR with unit roles");
  const staleResult = structuredClone(activityMetadata);
  const scalar = staleResult.sceneArtifacts.solverResult.values.find(value => value.valueType === "scalar");
  assert(scalar && typeof scalar.approximate === "number");
  scalar.approximate += 1;
  assert(!(await canonicalizeTurnSceneMetadata(staleResult)).ok, "source-correct geometry cannot retain a stale solver result");
  console.log("scientific style save staging: 9 save/direct-restore timing mutations retain deferred answers; scientific mismatch and stale solver decline; original unit-bound IR survives save");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
