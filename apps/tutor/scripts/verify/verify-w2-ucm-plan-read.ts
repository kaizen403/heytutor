import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProblemIRModelOutput } from "../../../../packages/tutor-core/src/planners/problemPlannerV1";
import { validateProblemIR, applySourceQuantityAuthority, synthesizeFamilyScene } from "@heytutor/scene-engine";
import { rawStoredTurnSourceIssues } from "../../lib/scene/storedSceneSource";
import { liveSceneSaveFailure, sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
let checks = 0;
for (const name of ["car", "stone", "clockwise"]) {
  const c = JSON.parse(readFileSync(new URL(`../../../../packages/scene-engine/scripts/verify/fixtures/w2-ucm-live-20261006/w2-ucm-${name}.json`, import.meta.url), "utf8"));
  const checked = validateProblemIR(normalizeProblemIRModelOutput(c.rawIRs[0], c.question, c.canonicalPlan), c.question);
  assert.ok(checked.problem);
  const problem = checked.problem;
  const plan = applySourceQuantityAuthority(c.canonicalPlan, problem, c.question).plan;
  const scene = synthesizeFamilyScene({ question: c.question, turnPlan: plan, problemIR: problem });
  assert.ok(scene);
  for (const variant of ["control", "extraForce", "stale", "noPlan"] as const) {
    const actualPlan = structuredClone(plan);
    if (variant === "extraForce") actualPlan.unknowns.push({ id: "extraForce", symbol: "F", unit: "N" });
    if (variant === "stale") actualPlan.derived[0]!.value += 1;
    const retainedPlan = variant === "noPlan" ? null : actualPlan;
    const admission: Parameters<typeof liveSceneSaveFailure>[0] = { document: scene.document, question: c.question, turnPlan: retainedPlan, problemIR: problem, tier: "qualitative_verified" as const };
    const stored: Parameters<typeof restoreVerifiedDiagramFromTurn>[0] = { question: c.question, sceneDocument: scene.document, sceneArtifacts: { turnPlan: retainedPlan, problemIR: problem, representationTier: "qualitative_verified" as const } };
    const expected = variant === "control";
    assert.equal(liveSceneSaveFailure(admission) === null, expected, `${name}/${variant}/live`);
    assert.equal(sceneSaveAdmissionFailure(admission) === null, expected, `${name}/${variant}/save`);
    assert.equal(rawStoredTurnSourceIssues(scene.document, stored).every(row => row.severity !== "fatal"), expected, `${name}/${variant}/read`);
    assert.equal(restoreVerifiedDiagramFromTurn(stored) !== null, expected, `${name}/${variant}/restore`);
    checks += 4;
  }
}
console.log(`${checks} actual UCM plan live/save/read/restore checks passed`);
