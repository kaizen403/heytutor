/**
 * The save audit runs the same two checks this change corrected, so a board drawn from
 * these plans must pass its next resume save, and a false plan must still be refused
 * there. Figures dev built keep passing, since this change only stops two misreadings.
 *
 *   tsx --tsconfig tsconfig.json scripts/verify/verify-chemistry-vsepr-plan-facts-save.ts
 */
import assert from "node:assert/strict";
import { type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";

let failed = 0;
let passed = 0;
function check(id: string, run: () => void): void {
  try {
    run();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type Scalar = { symbol: string; value: number; unit: string; sourceText?: string };
function planFor(question: string, derived: Scalar[], claims: string[]): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], qualitativeClaims: claims.map((claim, index) => ({ id: `c${index}`, claim, expected: true })),
    derived: derived.map((scalar, index) => ({ id: `d${index}`, provenance: "derived", dependsOn: [], ...scalar })),
    lawIds: [], assumptions: [], visualRequirement: "required",
  } as unknown as TurnPlanV3;
}

function select(question: string, turnPlan: TurnPlanV3) {
  return selectProductionScene({ question, turnPlan, problemIR: null, candidate: null, requiredRetryEnabled: true } as Parameters<typeof selectProductionScene>[0]);
}

const ANGLE = (value: number): Scalar => ({ symbol: "bond angle", value, unit: "degrees", sourceText: "due to lone pair repulsion" });
const REFERENCE = "The bond angle is less than the ideal tetrahedral angle of 109.5 degrees.";

for (const [question, derived, claims] of [
  ["shape of NH3 molecule", [ANGLE(107)], [REFERENCE, "NH3 has a trigonal pyramidal molecular shape"]],
  ["shape of H2O", [ANGLE(104.5)], [REFERENCE, "H2O is bent"]],
  // Dev saved these already.
  ["shape of NH3 molecule", [], ["NH3 has a trigonal pyramidal molecular shape"]],
  ["geometry of CH4", [{ symbol: "CH4 bond angle", value: 109.5, unit: "degrees" }], ["CH4 is tetrahedral"]],
] as Array<[string, Scalar[], string[]]>) {
  check(`draws, and its next resume save passes: ${question} ${claims[0]}`, () => {
    const turnPlan = planFor(question, derived, claims);
    const selection = select(question, turnPlan);
    assert.equal(selection.representation?.family, "chem_vsepr", String(selection.reason));
    const document = JSON.parse(JSON.stringify(selection.representation!.sceneDocument));
    assert.equal(sceneSaveAdmissionFailure({ document, question, turnPlan, tier: "qualitative_verified" }), null);
  });
}

// A saved board whose plan is false is refused at the save, as on dev.
const NH3 = "shape of NH3 molecule";
const board = JSON.parse(JSON.stringify(select(NH3, planFor(NH3, [], [])).representation!.sceneDocument));
for (const [label, derived, claims] of [
  ["wrong angle", [ANGLE(109.5)], []],
  ["wrong shape", [], ["NH3 is tetrahedral."]],
  ["a scalar naming another species in words", [{ symbol: "bond angle of water", value: 107, unit: "degrees" }], []],
  ["a wrong shape beside a reference angle in one claim", [], ["NH3 has a tetrahedral molecular shape and an electron geometry with tetrahedral angles"]],
  ["wrong shape beside a reference angle", [], ["NH3 is a tetrahedral molecule, with an angle below 109.5 degrees."]],
] as Array<[string, Scalar[], string[]]>) {
  check(`a false plan is still refused at the save: ${label}`, () => {
    assert.match(sceneSaveAdmissionFailure({ document: board, question: NH3, turnPlan: planFor(NH3, derived, claims), tier: "qualitative_verified" }) ?? "", /./);
  });
}

console.log(`verify-chemistry-vsepr-plan-facts-save: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
