/**
 * The save audit runs the same two checks this change corrected, so a board drawn from
 * these plans must pass its next resume save, and a false plan must still be refused
 * there, each for its own reason. Boards dev saved keep passing, on the plan example path
 * too, which reads the same claims.
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

// A saved board whose plan is false is refused at the save, each for its own reason, as on dev.
const NH3 = "shape of NH3 molecule";
const board = JSON.parse(JSON.stringify(select(NH3, planFor(NH3, [], [])).representation!.sceneDocument));
check("the control: the same board on an empty plan saves", () => {
  assert.equal(sceneSaveAdmissionFailure({ document: board, question: NH3, turnPlan: planFor(NH3, [], []), tier: "qualitative_verified" }), null);
});
for (const [label, derived, claims, reason] of [
  ["wrong angle", [ANGLE(109.5)], [], /vsepr_plan_fact_unverified/],
  ["a nearby angle", [ANGLE(108)], [], /vsepr_plan_fact_unverified/],
  ["a scalar naming another species in words", [{ symbol: "bond angle of water", value: 107, unit: "degrees" }], [], /vsepr_plan_fact_unverified/],
  ["wrong shape", [], ["NH3 is tetrahedral."], /contradicts the source-derived/],
  ["wrong shape before a number", [], ["NH3 is tetrahedral 109.5 degrees"], /contradicts the source-derived/],
  ["wrong shape beside a reference angle", [], ["NH3 is a tetrahedral molecule, with an angle below 109.5 degrees."], /contradicts the source-derived/],
  ["a wrong shape beside a reference angle in one claim", [], ["NH3 has a tetrahedral molecular shape and an electron geometry with tetrahedral angles"], /contradicts the source-derived/],
] as Array<[string, Scalar[], string[], RegExp]>) {
  check(`a false plan is refused at the save for its own reason: ${label}`, () => {
    assert.match(sceneSaveAdmissionFailure({ document: board, question: NH3, turnPlan: planFor(NH3, derived, claims), tier: "qualitative_verified" }) ?? "", reason);
  });
}

// Rule 3 on the plan example path, which reads the same claims: boards dev saved still save.
for (const [question, formula, claim] of [
  ["what is vsepr theory", "BF3", "BF3 is trigonal planar 120 degrees"],
  ["what is vsepr theory", "CH4", "CH4 has tetrahedral bond angles of 109.5 degrees"],
  ["what is sp3 hybridisation", "CH4", "CH4 is tetrahedral 109.5 degrees"],
  ["what is sp3 hybridisation", "CH4", "CH4 has tetrahedral bond angles"],
  ["what is a tetrahedral molecule", "CH4", "CH4 has tetrahedral angles"],
  // The only fact is a comparison with the species' own true shape, and it stays a fact.
  ["what is sp3 hybridisation", "CH4", "The angle in CH4 does not fall below the tetrahedral 109.5 degrees"],
  ["what is vsepr theory", "CH4", "CH4 keeps its angle equal to, not less than the tetrahedral angle"],
  ["what is vsepr theory", "NH3", "The electron geometry of NH3 does not differ from the tetrahedral 109.5 degrees"],
] as Array<[string, string, string]>) {
  check(`a plan example board saves: ${question} ${claim}`, () => {
    const turnPlan = { ...planFor(question, [], []), exampleSpecies: [{ formula, claim }] } as unknown as TurnPlanV3;
    const selection = select(question, turnPlan);
    assert.equal(selection.representation?.family, "chem_vsepr", String(selection.reason));
    const document = JSON.parse(JSON.stringify(selection.representation!.sceneDocument));
    assert.equal(sceneSaveAdmissionFailure({ document, question, turnPlan, tier: "qualitative_verified" }), null);
  });
}

console.log(`verify-chemistry-vsepr-plan-facts-save: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
