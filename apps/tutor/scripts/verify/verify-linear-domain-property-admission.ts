import assert from "node:assert/strict";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import {
  coefficientPropertyCases, domainPropertyCandidate, unsupportedRationalCases,
} from "../../../../packages/scene-engine/scripts/verify/fixtures/linear-domain-property-roles";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const failures: string[] = [];
let checks = 0;
for (const [restricted, rows] of [[true, unsupportedRationalCases], [false, coefficientPropertyCases]] as const) {
  for (const row of rows) for (const preferPlanner of [undefined, true]) {
    checks++;
    try {
      const turnPlan = { ...createFallbackTurnPlanV3(row.question), visualRequirement: "required" as const };
      const candidate = domainPropertyCandidate(row);
      const selected = selectProductionScene({ question: row.question, turnPlan, problemIR: null,
        candidate: candidate as unknown as Record<string, unknown>, policy: { preferPlanner } });
      if (restricted) {
        assert.equal(selected.candidateValidation?.valid, false);
        assert(selected.candidateValidation?.errors.some(issue => issue.code === "linear_source_mismatch"));
        assert(!selected.representation?.sceneDocument.constructions.some(construction =>
          ["number_line_set", "linear_half_plane", "linear_feasible_region", "linear_system"].includes(construction.operator)),
        "an unproved rational domain cannot commit a continuous figure");
      } else {
        assert.equal(selected.candidateValidation?.valid, true, "coefficient properties cannot veto the planner");
        assert.equal(selected.visualStatus, "validated");
        assert(selected.representation && selected.representation.renderScene.primitives.length > 0);
      }
    } catch (error) { failures.push(`${row.id}/${preferPlanner ? "strict" : "default"}: ${String(error)}`); }
  }
}
console.log(`Production domain/property admission: ${checks - failures.length}/${checks}`);
assert.equal(failures.length, 0, failures.join("\n"));
