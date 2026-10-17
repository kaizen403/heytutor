/** Exact synthetic captured formulation, replayed through the live solver boundary. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applySourceQuantityAuthority,
  LocalDeterministicSolverProvider,
  reconcileTurnPlanWithSolver,
  type ProblemIR,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { planAndSolveProblemV1 } from "@heytutor/tutor-core";
import { verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import { refreshSolverAuthorityForPlan } from "../../features/tutor-session/lib/turn/refreshSolverAuthority";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

async function main() {
  const problem: ProblemIR = JSON.parse(
    readFileSync(
      new URL("./fixtures/physics-audit/incline-problem.json", import.meta.url),
      "utf8",
    ),
  );
  const fixture: { question: string; turnPlan: TurnPlanV3 } = JSON.parse(
    readFileSync(
      new URL("./fixtures/physics-audit/incline.json", import.meta.url),
      "utf8",
    ),
  );
  const original = JSON.stringify(problem);
  const arithmetic = await new LocalDeterministicSolverProvider().solve(
    problem,
  );
  assert.equal(
    arithmetic.status,
    "solved",
    "original bug was a wrong physical model with valid arithmetic",
  );
  let requests = 0;
  const authority = await planAndSolveProblemV1(
    fixture.question,
    fixture.turnPlan,
    {
      proxyUrl: "http://fixture.invalid/api/chat",
      timeoutMs: 5000,
      fetchImpl: async () => {
        requests++;
        return Response.json({ choices: [{ message: { content: original } }] });
      },
    },
  );
  assert(
    authority,
    "captured planner response must pass the actual live formulation boundary",
  );
  assert.equal(requests, 1, "deterministic correction needs no paid retry");
  const plan = applySourceQuantityAuthority(
    reconcileTurnPlanWithSolver(
      fixture.turnPlan,
      authority.problemIR,
      authority.solverResult,
    ),
    authority.problemIR,
    fixture.question,
  ).plan;
  const refreshed = refreshSolverAuthorityForPlan(
    authority,
    plan,
    fixture.question,
  );
  assert.equal(
    refreshed.audit.status,
    "verified",
    JSON.stringify(refreshed.audit.issues),
  );
  assert(
    Math.abs(
      plan.derived.find((q) => q.id === "a")!.value - 4.692820323027551,
    ) < 1e-8,
  );
  assert(
    Math.abs(
      plan.derived.find((q) => q.id === "T")!.value - 15.921539030917348,
    ) < 1e-8,
  );
  const selected = selectProductionScene({
    question: fixture.question,
    turnPlan: plan,
    problemIR: authority.problemIR,
    policy: {
      preferPlanner: true,
      allowVerifiedSourceRecovery: true,
      allowedFigureSources: ["planner", "verified_recovery", "text_only"],
    },
  });
  assert(selected.representation, selected.reason);
  assert.equal(
    selected.representation.sceneDocument.source.sourceModel,
    "coupled_incline",
  );
  const representation = selected.representation;
  const presentation = buildVerifiedDiagramPresentation(
    representation.sceneDocument,
    representation.renderScene,
    { figureFamily: representation.family },
  );
  assert(verifiedDiagramHasDrawableInk(presentation.diagram));
  const saved = await canonicalizeTurnSceneMetadata({
    question: fixture.question,
    sceneDocument: representation.sceneDocument,
    visualStatus: "validated",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3",
      turnPlan: plan,
      problemIR: authority.problemIR,
      solverResult: authority.solverResult,
      figureSource: representation.figureSource,
      representationTier: representation.tier,
      nonMetric: representation.nonMetric,
      diagramResultStatus: "ready",
    },
    segments: [],
  });
  assert(saved.ok, saved.ok ? "saved" : saved.error);
  assert.equal(
    JSON.stringify(problem),
    original,
    "captured input stays immutable",
  );
  console.log(
    "PASS captured incline pipeline: wrong model → source force balance → solved → reconciled → verified → board commands → saved",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
