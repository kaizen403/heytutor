import assert from "node:assert/strict";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { unprovedSetSymbolCases, setSymbolCandidate } from "../../../../packages/scene-engine/scripts/verify/fixtures/linear-unproved-set-symbols";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const failures: string[] = [];
let checks = 0;
for (const row of unprovedSetSymbolCases) {
  const turnPlan = { ...createFallbackTurnPlanV3(row.question), visualRequirement: "required" as const };
  for (const preferPlanner of [undefined, true]) {
    checks++;
    try {
      const candidate = setSymbolCandidate(row.question, row.shape);
      const selected = selectProductionScene({ question: row.question, turnPlan, problemIR: null,
        candidate: candidate as unknown as Record<string, unknown>, policy: { preferPlanner } });
      assert.equal(selected.candidateValidation?.valid, false, "continuous planner must be refused");
      assert(selected.candidateValidation?.errors.some(issue => issue.code === "linear_source_mismatch"),
        "refusal must prove the source-domain mismatch");
      assert(!selected.representation?.sceneDocument.constructions.some(construction =>
        ["number_line_set", "linear_half_plane", "linear_feasible_region", "linear_system"].includes(construction.operator)),
      "neither planner nor fallback may commit a continuous figure");
    } catch (error) { failures.push(`${row.id}/${preferPlanner ? "strict" : "default"}: ${String(error)}`); }
  }
}
console.log(`Production set-symbol domain admission: ${checks - failures.length}/${checks}`);
assert.equal(failures.length, 0, failures.join("\n"));
