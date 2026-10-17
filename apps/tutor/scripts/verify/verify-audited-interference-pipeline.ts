/** Authored film-interference capture through the actual solver, selection and save boundaries. No network. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applySourceQuantityAuthority, reconcileTurnPlanWithSolver, type ProblemIR, type TurnPlanV3 } from "@heytutor/scene-engine";
import { planAndSolveProblemV1 } from "@heytutor/tutor-core";
import { refreshSolverAuthorityForPlan } from "../../features/tutor-session/lib/turn/refreshSolverAuthority";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

async function main() {
  const problem: ProblemIR = JSON.parse(readFileSync(new URL("./fixtures/physics-audit/interference-problem.json", import.meta.url), "utf8"));
  const fixture: { question: string; turnPlan: TurnPlanV3 } = JSON.parse(readFileSync(new URL("./fixtures/physics-audit/interference.json", import.meta.url), "utf8"));
  const original = JSON.stringify(problem);
  let requests = 0;
  const authority = await planAndSolveProblemV1(fixture.question, fixture.turnPlan, {
    proxyUrl: "http://fixture.invalid/api/chat", timeoutMs: 5000,
    fetchImpl: async () => { requests++; return Response.json({ choices: [{ message: { content: original } }] }); },
  });
  assert(authority);
  assert.equal(requests, 1);
  assert.deepEqual(authority.problemIR.constraints, problem.constraints, "source canonicalization preserves the film incidence obligation");
  assert.deepEqual(authority.problemIR.entities.map(entity => entity.id), problem.entities.map(entity => entity.id));
  assert.equal(authority.problemIR.entities.find(entity => entity.id === "screen")!.label, "screen");
  const plan = applySourceQuantityAuthority(reconcileTurnPlanWithSolver(fixture.turnPlan, authority.problemIR,
    authority.solverResult), authority.problemIR, fixture.question).plan;
  const refreshed = refreshSolverAuthorityForPlan(authority, plan, fixture.question);
  assert.equal(refreshed.audit.status, "verified", JSON.stringify(refreshed.audit.issues));
  assert(Math.abs(plan.derived.find(quantity => quantity.id === "beta")!.value - 0.002) < 1e-10);
  assert(Math.abs(plan.derived.find(quantity => quantity.id === "dphi")!.value - 4 * Math.PI) < 1e-10);
  assert(Math.abs(plan.derived.find(quantity => quantity.id === "y0")!.value - 0.004) < 1e-10);
  const selected = selectProductionScene({ question: fixture.question, turnPlan: plan, problemIR: authority.problemIR,
    policy: { preferPlanner: true, allowVerifiedSourceRecovery: true, allowedFigureSources: ["planner", "verified_recovery", "text_only"] } });
  assert(selected.representation, selected.reason);
  const document = selected.representation.sceneDocument;
  assert.equal(document.source.archetype, "double_slit");
  assert(document.assertions.some(assertion => assertion.id === "film_covers_slit" && assertion.predicate === "on"));
  const saved = await canonicalizeTurnSceneMetadata({ question: fixture.question, sceneDocument: document,
    visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: plan,
      problemIR: authority.problemIR, solverResult: authority.solverResult,
      figureSource: selected.representation.figureSource, representationTier: selected.representation.tier,
      nonMetric: selected.representation.nonMetric, diagramResultStatus: "ready" }, segments: [] });
  assert(saved.ok, saved.ok ? "saved" : saved.error);
  assert.equal(JSON.stringify(problem), original);
  console.log("PASS captured interference pipeline: solved → source quantities preserve bindings → verified → film incidence proved → drawn → saved");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
