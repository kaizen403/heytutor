import assert from "node:assert/strict";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { incompleteConstraintCases, incompleteConstraintCandidate, uncertaintyControls, unprovedSignCases, unprovedMathTailCases, unprovedScopeCases } from "../../../../packages/scene-engine/scripts/verify/fixtures/linear-incomplete-source-constraints";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
let checks = 0;
const failures: string[] = [];
for (const [restricted, rows] of [[true, [...incompleteConstraintCases, ...unprovedSignCases, ...unprovedMathTailCases, ...unprovedScopeCases]], [false, uncertaintyControls]] as const) for (const row of rows) for (const preferPlanner of [undefined, true]) {
  checks++;
  try {
    const turnPlan = { ...createFallbackTurnPlanV3(row.question), visualRequirement: "required" as const };
    const candidate = incompleteConstraintCandidate(row);
    const selected = selectProductionScene({ question: row.question, turnPlan, problemIR: null, candidate: candidate as unknown as Record<string, unknown>, policy: { preferPlanner } });
    if (restricted) {
      assert.equal(selected.candidateValidation?.valid, false, "incomplete planner must decline");
      assert(selected.candidateValidation?.errors.some(issue => issue.code === "linear_source_mismatch"));
      assert(!selected.representation?.sceneDocument.constructions.some(item => ["number_line_set", "linear_half_plane", "linear_feasible_region", "linear_system"].includes(item.operator)), "an unsure reader cannot replace the rejected planner with its own partial linear figure");
    } else {
      assert.equal(selected.candidateValidation?.valid, true, "unknown prose alone must not veto a planner that owns the source predicates");
      assert.equal(selected.visualStatus, "validated");
    }
  } catch (error) { failures.push(`${row.id}/${preferPlanner ? "strict" : "default"}: ${String(error)}`); }
}
console.log(`Production incomplete-source admission: ${checks - failures.length}/${checks}`);
assert.equal(failures.length, 0, failures.join("\n"));
