/**
 * Newman projections through the live selection path with the fallback plan, the asks
 * that must never get one, and organic boards dev saved resuming unchanged.
 *
 *   tsx scripts/verify/verify-chemistry-newman-selection.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SceneDocument, TurnPlanV3 } from "@heytutor/scene-engine";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { admitStoredScene } from "../../lib/scene/sceneAdmission";

let passed = 0;
let failed = 0;
function check(id: string, run: () => void): void {
  try {
    run();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const select = (question: string) => selectProductionScene({
  question, turnPlan: { ...createFallbackTurnPlanV3(question), subject: "chemistry" } as TurnPlanV3, problemIR: null,
  exactFigureSource: "planner", solverAuthorityBlocked: false, solverAuthority: null, requiredRetryEnabled: true,
  completionEnabled: false, blockFlowEligible: false,
});
const conformers = (document: SceneDocument | undefined) => (document?.revealGroups ?? []).filter((group) => group.id.startsWith("conformer_")).length;

for (const [question, panels] of [
  ["Draw the Newman projection of butane.", 4],
  ["Looking along the C2–C3 bond of butane, draw the anti and gauche conformations. Which is more stable?", 4],
  ["Draw the eclipsed conformation of ethane.", 2],
  ["newman projection of ethane staggered", 2],
  ["Draw the Newman projection of propane.", 2],
  ["Draw the Newman projection of ethanol.", 2],
] as const) {
  check(`selection draws the Newman figure: ${question}`, () => {
    const result = select(question);
    assert.equal(result.representation?.family, "chem_organic", String(result.reason ?? ""));
    assert.equal(conformers(result.representation?.sceneDocument), panels);
  });
}

for (const question of [
  "Draw the Newman projection along the C1–C2 bond of butane.", "Draw the Newman projection of hexane.",
  "Draw the Newman projections of ethane and propane.", "Draw the Newman projection of cyclohexane.",
  "What is the boiling point of butane?", "Draw the structure of butane.", "Draw butane, not as a Newman projection.",
  "Draw the chair conformation of cyclohexane.",
]) {
  check(`selection never draws a Newman figure: ${question}`, () => {
    assert.equal(conformers(select(question).representation?.sceneDocument), 0);
  });
}

// Organic boards dev admitted on recorded plans still pass their next resume save and full admission.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/chemistry-newman-dev-organic-boards.json", import.meta.url), "utf8")) as {
  boards: Array<{ question: string; turnPlan: TurnPlanV3; document: SceneDocument; tier: "exact_verified" | "qualitative_verified" | "question_representation" }>;
};
assert.ok(fixture.boards.length >= 3);
for (const board of fixture.boards) {
  check(`dev's organic board resumes: ${board.question.slice(0, 60)}`, () => {
    assert.equal(sceneSaveAdmissionFailure({ document: board.document, question: board.question, turnPlan: board.turnPlan, tier: board.tier }), null);
    const admitted = admitStoredScene({ sceneDocument: board.document, sceneQuestion: board.question, turnPlan: board.turnPlan, submittedTier: board.tier });
    assert.ok(admitted.ok, "full stored admission refused");
  });
}

console.log(`verify-chemistry-newman-selection: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
