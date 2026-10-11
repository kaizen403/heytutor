import assert from "node:assert/strict";
import { type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { bindingFixture, normalizeAndAudit } from "../../../../packages/tutor-core/scripts/verify/verify-request50-binding-boundary";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

/** A synthetic qualitative setup, not a solved answer or historical F50 figure. */
function setupScene(question: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", source: { question },
    visualDecision: { mode: "scene", reason: "Show the requested labelled setup." }, quantities: [],
    entities: [
      { id: "a", kind: "point", role: "endpoint", label: "A" },
      { id: "b", kind: "point", role: "endpoint", label: "B" },
      { id: "ab", kind: "segment", role: "labelled segment", label: "AB" },
    ],
    constructions: [
      { id: "pa", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "pb", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
      { id: "segment", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
    ],
    relations: [], annotations: [],
    assertions: [{ id: "exists", predicate: "exists", entities: ["ab"], expected: true, severity: "fatal" }],
    requiredEntityIds: ["a", "b", "ab"],
    revealGroups: [{ id: "setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "Show AB." }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Show AB." }],
  };
}

function selectSetup(plan: TurnPlanV3, problem: Awaited<ReturnType<typeof normalizeAndAudit>>["problem"], blocked: boolean) {
  const candidate = setupScene(plan.question);
  const validation = validateProductionSceneCandidate({
    candidate: candidate as unknown as Record<string, unknown>, question: plan.question, turnPlan: plan,
  });
  assert(validation.valid && validation.value, `synthetic setup rejected: ${validation.errors.map((issue) => issue.code).join(",")}`);
  return selectProductionScene({
    question: plan.question, turnPlan: plan, problemIR: problem, candidateValidation: validation,
    solverAuthorityBlocked: blocked, policy: { preferPlanner: true, allowedFigureSources: ["planner"] },
  });
}

async function main(): Promise<void> {
  let cases = 0;
  for (const [name, fixture, expectedStatus] of [
    ["withdraw unsupported Unicode alias", bindingFixture("x", "xₘₐₓ"), "incomplete"],
    ["retain equivalent request formatting", bindingFixture("x_max", "x_max", "xₘₐₓ"), "verified"],
  ] as const) {
    const authority = await normalizeAndAudit(fixture);
    const blockedByAuthority = authority.audit.status === "contradiction";
    assert.equal(authority.audit.status, expectedStatus, name);
    const selected = selectSetup(authority.plan, authority.problem, blockedByAuthority);
    assert(selected.representation, `${name}: a valid independent setup is not blocked by an absent second opinion`);
    assert.equal(selected.representation.tier, "qualitative_verified", "setup geometry cannot become an exact requested answer");
    assert.equal(selected.saveFailure, null);
    const submission = {
      question: authority.plan.question, sceneDocument: selected.representation.sceneDocument,
      visualStatus: "validated" as const, segments: [],
      sceneArtifacts: {
        schemaVersion: "scene-artifacts/v3", diagramResultStatus: "ready", nonMetric: true,
        representationTier: selected.representation.tier, turnPlan: authority.plan,
        problemIR: authority.problem, solverResult: authority.result,
      },
    };
    const persisted = await canonicalizeTurnSceneMetadata(submission);
    assert(persisted.ok, `${name}: normalized artifacts must pass real server recomputation`);
    assert.equal(persisted.value.sceneArtifacts?.solverAuthority?.status, expectedStatus);
    assert.equal(persisted.value.sceneArtifacts?.solverAuthority?.bindings.length, expectedStatus === "verified" ? 1 : 0,
      "save cannot manufacture authority for the withdrawn identity");
    assert.equal(persisted.value.sceneArtifacts?.problemIR?.solveRequests.length, 1);
    assert.equal(Boolean(persisted.value.sceneArtifacts?.problemIR?.solveRequests[0]?.resultBinding), expectedStatus === "verified");
    const reopened = JSON.parse(JSON.stringify(persisted.value)) as typeof persisted.value;
    assert(restoreVerifiedPresentationFromTurn({
      question: authority.plan.question, sceneDocument: reopened.sceneDocument, sceneArtifacts: reopened.sceneArtifacts,
    }), `${name}: reopened setup is reconstructed from the server-accepted scene`);
    const recomputed = await canonicalizeTurnSceneMetadata({ ...reopened, question: authority.plan.question });
    assert(recomputed.ok, `${name}: reload roundtrip repeats the real solver and scene trust checks`);
    assert.equal(recomputed.value.sceneArtifacts?.solverAuthority?.status, expectedStatus);
    assert.deepEqual(recomputed.value.sceneArtifacts?.solverAuthority?.bindings, persisted.value.sceneArtifacts?.solverAuthority?.bindings);
    cases++;

    if (expectedStatus === "incomplete") {
      const stale = await canonicalizeTurnSceneMetadata({
        ...submission, sceneArtifacts: { ...submission.sceneArtifacts, problemIR: fixture.problem },
      });
      assert.equal(stale.ok, false, "retaining the raw rejected alias must fail independently at save");
      assert(!stale.ok && stale.code === "scene_solver_plan_contradiction");
      cases++;
    }
  }

  const numeric = bindingFixture();
  numeric.plan.derived[0]!.value = 3;
  const conflict = await normalizeAndAudit(numeric);
  assert.equal(conflict.audit.status, "contradiction");
  const blocked = selectSetup(conflict.plan, conflict.problem, true);
  assert.equal(blocked.representation, null, "genuine numeric disagreement still blocks production figure admission");
  assert.equal(blocked.reason, "solver_contradiction");
  const rejected = await canonicalizeTurnSceneMetadata({
    question: conflict.plan.question, sceneDocument: setupScene(conflict.plan.question), visualStatus: "validated", segments: [],
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", diagramResultStatus: "ready", representationTier: "qualitative_verified",
      nonMetric: true, turnPlan: conflict.plan, problemIR: conflict.problem, solverResult: conflict.result,
    },
  });
  assert(!rejected.ok && rejected.code === "scene_solver_plan_contradiction", "save recomputation still refuses genuine scalar disagreement");
  cases++;
  console.log(`verified Request 50 production binding admission: ${cases} synthetic cases; selection, normalized save/reopen/recomputation, stale raw alias refusal and true numeric contradiction refusal`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
