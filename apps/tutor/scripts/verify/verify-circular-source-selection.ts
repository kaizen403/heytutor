import assert from "node:assert/strict";
import { FIGURE_SOURCES, LocalDeterministicSolverProvider, validateProblemIR, verifyTurnPlanAgainstSolver, type TurnPlanV3 } from "@heytutor/scene-engine";
import { normalizeProblemIRModelOutput } from "@heytutor/tutor-core";
import { decideDiagramStrategy, diagramStrategyAllowsFigureSource } from "../../features/tutor-session/lib/scene/diagramStrategy";
import { selectProductionScene, type ProductionSceneSelectionInput } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { getSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";

async function main() {
// Synthetic numeric source, through the live strict policy and selection.
const question = "A 4 kg body moves in a circle of radius 2 m at 5 m/s. Find its centripetal force.";
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
  givens: [["m",4,"kg"],["r",2,"m"],["v",5,"m/s"]].map(([id,value,unit]) => ({ id: String(id), symbol: String(id), value: Number(value), unit: String(unit), provenance: "given" as const })),
  unknowns: [{ id: "F", symbol: "F_c", unit: "N" }],
  derived: [{ id: "F", symbol: "F_c", value: 50, unit: "N", provenance: "derived", dependsOn: ["m","r","v"] }],
  lawIds: ["centripetal force F_c = mv²/r"], assumptions: [], qualitativeClaims: [],
};
const compact = {
  facts: [
    { id: "mass", kind: "given", statement: "mass", quote: "4 kg body" },
    { id: "radius", kind: "given", statement: "radius", quote: "radius 2 m" },
    { id: "speed", kind: "given", statement: "speed", quote: "at 5 m/s" },
    { id: "force", kind: "requested", statement: "centripetal force", quote: "Find its centripetal force" },
  ], entities: [], constraints: [], representationIntents: [],
  expressions: [{ id: "eF", valueType: "scalar", expr: "4*5^2/2", evidenceFactIds: ["mass","radius","speed"] }],
  solveRequests: [{ id: "sF", kind: "evaluate", expressionId: "eF", resultBinding: { turnPlanQuantityId: "F", symbol: "F_c", unit: "N", evidenceFactIds: ["force"] } }],
};
const problemIR = validateProblemIR(normalizeProblemIRModelOutput(compact, question, plan), question).problem!;
assert.ok(problemIR);
const solverResult = await new LocalDeterministicSolverProvider().solve(problemIR);
assert.equal(verifyTurnPlanAgainstSolver(problemIR, solverResult, plan, question).status, "verified");
const strict = decideDiagramStrategy({ assignedStrategy: "strict", chemistryLane: false, codeLesson: false, dsa: false, doubt: false, subject: "physics" });
const policy = { preferPlanner: true, allowedFigureSources: FIGURE_SOURCES.filter(source => diagramStrategyAllowsFigureSource(strict, source)) };
const input: ProductionSceneSelectionInput = { question, turnPlan: plan, problemIR, solverAuthority: { problemIR, solverResult }, policy,
  candidateValidation: { valid: false, errors: [{ code: "invalid_candidate", message: "synthetic rejected candidate", severity: "fatal" }] } };
const selected = selectProductionScene(input);
assert.equal(selected.visualStatus, "validated", selected.reason);
assert.equal(selected.representation?.figureSource, "circular_source");
assert.equal(selected.representation.tier, "qualitative_verified", "display geometry never earns exact tier");
assert.equal(selected.representation.nonMetric, true);
assert.equal(selected.saveFailure, null);
assert.equal(selected.candidateValidation?.valid, false, "invalid planner geometry remains invalid");
assert.ok(selected.representation.renderScene.primitives.length >= 11);
assert.ok(!selected.representation.renderScene.primitives.some(p => p.text?.includes("50")), "requested answer stays out of the setup");
for (const controls of [
  { solverAuthority: null }, { problemIR: null }, { solverAuthorityBlocked: true },
  { candidateValidation: null }, { candidateValidation: { valid: true, errors: [] } },
  { turnPlan: { ...plan, derived: [{ ...plan.derived[0]!, value: 51 }] } },
  { question: question.replace("radius 2 m", "radius 3 m") },
  { question: question + " Its speed increases with time." },
  { policy: { preferPlanner: true, allowedFigureSources: ["planner"] as const } },
  { fastRepresentation: { ...selected.representation, figureSource: "circular_source" as const } },
]) assert.equal(selectProductionScene({ ...input, ...controls }).representation, null, `must decline ${Object.keys(controls)}`);
for (const source of ["archetype", "family", "last_resort"] as const) assert.equal(diagramStrategyAllowsFigureSource(strict, source), false);
const representation = selected.representation;
const presentation = buildVerifiedDiagramPresentation(representation.sceneDocument, representation.renderScene);
const saved = await canonicalizeTurnSceneMetadata({
  question, sceneDocument: representation.sceneDocument, validationReport: representation.validationReport, visualStatus: "validated",
  sceneArtifacts: {
    schemaVersion: "scene-artifacts/v3", turnPlan: plan, problemIR, solverResult,
    representationTier: representation.tier, nonMetric: representation.nonMetric,
    figureSource: representation.figureSource, candidates: [], diagramResultStatus: "ready",
  },
  segments: presentation.introSegments.map((segment, orderIndex) => ({
    orderIndex, narration: segment.narration, spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }),
  })),
});
assert.ok(saved.ok, saved.ok ? "" : saved.error);
assert.equal((saved.value.sceneArtifacts as { figureSource: string }).figureSource, "circular_source");
assert.ok(restoreVerifiedPresentationFromTurn({ question, sceneDocument: saved.value.sceneDocument, sceneArtifacts: saved.value.sceneArtifacts }));
console.log("circular source selection: source/plan/solver-certified qualitative program survives strict; incomplete, stale, forged and broad fallback controls decline");

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
