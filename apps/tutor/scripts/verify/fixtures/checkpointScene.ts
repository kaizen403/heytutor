/** Source fixture shared by the checkpoint VM and real Postgres gates.
 * The existing number-line persistence oracle is recomputed by the public
 * compiler/solver/canonicalizer; no engine output is hard-coded here.
 */
import assert from "node:assert/strict";
import { LocalDeterministicSolverProvider, compileSceneDocument, buildSolverAuthorityProjection,
  type ProblemIR, type SceneArtifactsV3, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { getSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../../lib/scene/turnScenePersistence";

export async function checkpointSceneFixture() {
  const arithmeticQuestion = "Use a number line to find 2+3.";
  const arithmeticPlan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3",
    question: arithmeticQuestion,
    givens: [
      { id: "two", symbol: "a", value: 2, provenance: "given", sourceText: "2" },
      { id: "three", symbol: "b", value: 3, provenance: "given", sourceText: "3" },
    ],
    unknowns: [{ id: "answer", symbol: "A" }],
    derived: [{
      id: "answer",
      symbol: "A",
      value: 5,
      provenance: "derived",
      sourceText: "2+3",
      dependsOn: ["two", "three"],
    }],
    qualitativeClaims: [],
    lawIds: [],
    assumptions: [],
    visualRequirement: "required",
  };
  const problemIR: ProblemIR = {
    schemaVersion: "problem-ir/v1",
    id: "arithmeticProblem",
    question: arithmeticQuestion,
    facts: [{
      id: "requestedAnswer",
      kind: "requested",
      statement: "Find the value of 2+3",
      evidence: { source: "question", start: 0, end: arithmeticQuestion.length, quote: arithmeticQuestion },
    }],
    entities: [],
    expressions: [{
      id: "sumExpression",
      valueType: "scalar",
      root: {
        kind: "binary",
        operator: "+",
        left: { kind: "number", value: 2 },
        right: { kind: "number", value: 3 },
      },
      evidenceFactIds: ["requestedAnswer"],
    }],
    constraints: [],
    representationIntents: [],
    solveRequests: [{
      id: "evaluateSum",
      kind: "evaluate",
      expressionId: "sumExpression",
      resultBinding: {
        turnPlanQuantityId: "answer",
        symbol: "A",
        evidenceFactIds: ["requestedAnswer"],
      },
    }],
  };
  const solverResult = await new LocalDeterministicSolverProvider().solve(problemIR);

  const exactDocument: SceneDocument = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "verified number-line construction" },
    source: { question: arithmeticQuestion, representationTier: "exact_verified", nonMetric: false },
    quantities: [
      { id: "two", value: 2 },
      { id: "three", value: 3 },
      { id: "answer", value: 5 },
    ],
    entities: [
      { id: "line_start", kind: "point", role: "number-line start" },
      { id: "line_end", kind: "point", role: "number-line end" },
      { id: "number_line", kind: "segment", role: "number line" },
      { id: "start_value", kind: "point", role: "starting value", label: "2" },
      { id: "sum_value", kind: "point", role: "sum", label: "5" },
      { id: "add_three", kind: "vector", role: "add three" },
    ],
    constructions: [
      { id: "make_line_start", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["line_start"] },
      { id: "make_line_end", operator: "point", inputs: { x: 6, y: 0, coordinateSpace: "world" }, outputs: ["line_end"] },
      { id: "make_number_line", operator: "segment", inputs: { start: "line_start", end: "line_end" }, outputs: ["number_line"] },
      { id: "make_start_value", operator: "point", inputs: { x: "two", y: 0, coordinateSpace: "world" }, outputs: ["start_value"] },
      { id: "make_sum_value", operator: "point", inputs: { x: "answer", y: 0, coordinateSpace: "world" }, outputs: ["sum_value"] },
      { id: "make_add_three", operator: "vector", inputs: { start: "start_value", end: "sum_value" }, outputs: ["add_three"] },
    ],
    relations: [],
    assertions: [
      { id: "start_on_line", predicate: "on", entities: ["start_value", "number_line"], expected: true, severity: "fatal" },
      { id: "sum_on_line", predicate: "on", entities: ["sum_value", "number_line"], expected: true, severity: "fatal" },
    ],
    annotations: [],
    requiredEntityIds: ["line_start", "line_end", "number_line", "start_value", "sum_value", "add_three"],
    revealGroups: [{
      id: "number_line_setup",
      entityIds: ["line_start", "line_end", "number_line", "start_value", "sum_value", "add_three"],
      dependsOn: [],
      narrationCue: "show addition on the number line",
    }],
    teachingTimeline: [{
      id: "show_number_line",
      action: "reveal",
      targetId: "number_line_setup",
      dependsOn: [],
      narrationIntent: "move three units from two to five",
    }],
  };
  const exactCompiled = compileSceneDocument(exactDocument);
  assert(exactCompiled.ok && exactCompiled.renderScene, "exact persistence fixture must compile");
  const exactPresentation = buildVerifiedDiagramPresentation(exactDocument, exactCompiled.renderScene);
  const exactArtifacts: SceneArtifactsV3 = {
    schemaVersion: "scene-artifacts/v3",
    turnPlan: arithmeticPlan,
    problemIR,
    solverResult,
    representationTier: "exact_verified",
    nonMetric: false,
    candidates: [],
    diagramResultStatus: "ready",
  };
  const metadata: SubmittedTurnSceneMetadata = {
    question: arithmeticQuestion, sceneDocument: exactDocument, sceneEngineVersion: "fixture-client-version",
    validationReport: {valid:true,issues:[]}, visualStatus:"validated", sceneArtifacts:exactArtifacts,
    segments: exactPresentation.introSegments.map((segment, orderIndex) => ({
      orderIndex, narration:segment.narration, spokenText:segment.narration,
      command:serializeSegmentCommands(getSegmentCommands(segment), {trustedDiagramGeometry:true}),
    })),
  };
  const accepted = await canonicalizeTurnSceneMetadata(metadata);
  assert(accepted.ok, `source fixture must canonicalize: ${accepted.ok ? "" : accepted.error}`);
  const artifacts = accepted.value.sceneArtifacts;
  assert(artifacts?.problemIR && artifacts.solverResult && artifacts.solverAuthority);
  const projection = buildSolverAuthorityProjection(artifacts.problemIR, artifacts.solverResult, artifacts.solverAuthority);
  return {question:arithmeticQuestion, metadata, projection};
}
