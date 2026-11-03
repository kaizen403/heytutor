/**
 * A plan writes "bond angle = 107 degrees" for "shape of NH3 molecule" and names no
 * species beside it, because only one is being asked about. That refused the figure as
 * ambiguous. With one species drawn it is not ambiguous. The value must still equal the
 * one the engine computes for that species, and two species stay ambiguous.
 *
 *   tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-chemistry-vsepr-single-species-scalar.ts
 */
import assert from "node:assert/strict";
import "../../src/chemistry/families";
import { certifyVseprSourceDocument } from "../../src/chemistry/sourceEvidence";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { createFallbackTurnPlanV3 } from "../../../../packages/tutor-core/src/planners/turnPlannerV3";

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

function issues(question: string, scalars: Scalar[]): string[] {
  const scene = synthesizeFamilyScene({ question });
  assert.equal(scene?.family, "chem_vsepr");
  const plan: TurnPlanV3 = { ...createFallbackTurnPlanV3(question), subject: "chemistry" };
  plan.derived = scalars.map((scalar, index) => ({ id: `d${index}`, provenance: "derived", dependsOn: [], ...scalar })) as TurnPlanV3["derived"];
  const result = certifyVseprSourceDocument(scene.document, question, plan);
  assert.notEqual(result.status, "not_applicable");
  return result.status === "rejected" ? result.issues.map((issue) => issue.code) : [];
}

const ANGLE = (value: number, sourceText = "due to lone pair repulsion"): Scalar => ({ symbol: "bond angle", value, unit: "degrees", sourceText });

for (const [question, scalars] of [
  ["shape of NH3 molecule", [ANGLE(107)]],
  ["shape of NH3 molecule", [{ symbol: "lone pairs", value: 1, unit: "" }]],
  ["shape of NH3 molecule", [{ symbol: "bond pairs", value: 3, unit: "" }]],
  ["shape of NH3 molecule", [{ symbol: "steric number", value: 4, unit: "" }]],
  ["shape of H2O", [ANGLE(104.5), { symbol: "lone pairs", value: 2, unit: "" }]],
  ["geometry of CH4", [ANGLE(109.5)]],
] as Array<[string, Scalar[]]>) {
  check(`one species, the right value: ${question} ${scalars.map((scalar) => scalar.symbol).join(", ")}`, () => assert.deepEqual(issues(question, scalars), []));
}

for (const [question, scalars] of [
  ["shape of NH3 molecule", [ANGLE(109.5)]],
  ["shape of NH3 molecule", [ANGLE(120)]],
  ["shape of NH3 molecule", [{ symbol: "lone pairs", value: 2, unit: "" }]],
  ["shape of NH3 molecule", [{ symbol: "steric number", value: 3, unit: "" }]],
  ["shape of H2O", [ANGLE(107)]],
  ["shape of NH3 molecule", [{ symbol: "bond angle of H2O", value: 107, unit: "degrees" }]],
  ["shape of NH3 molecule", [{ symbol: "bond angle", value: 107, unit: "degrees", sourceText: "the angle in H2O" }]],
  ["shape of NH3 molecule", [{ symbol: "bond angle", value: 107, unit: "pm" }]],
  ["shape of NH3 molecule", [{ symbol: "unnamed", value: 107, unit: "degrees" }]],
  ["Use VSEPR to predict the shapes of SF4 and XeF4.", [{ symbol: "lone pairs", value: 1, unit: "" }]],
  ["Compare the shapes of NH3 and H2O.", [ANGLE(107)]],
  ["Compare the shapes of NH3 and H2O.", [{ symbol: "lone pairs", value: 1, unit: "" }]],
] as Array<[string, Scalar[]]>) {
  check(`still refused: ${question} ${JSON.stringify(scalars[0])}`, () => assert.ok(issues(question, scalars).includes("vsepr_plan_fact_unverified")));
}

// A target that is named keeps working as before.
for (const [question, scalars] of [
  ["Compare the shapes of NH3 and H2O.", [{ symbol: "NH3 bond angle", value: 107, unit: "degrees" }, { symbol: "H2O bond angle", value: 104.5, unit: "degrees" }]],
  ["shape of NH3 molecule", [{ symbol: "N valence electrons", value: 5, unit: "electrons", sourceText: "Nitrogen has 5 valence electrons" }]],
] as Array<[string, Scalar[]]>) {
  check(`a named target still certifies: ${question}`, () => assert.deepEqual(issues(question, scalars), []));
}

console.log(`verify-chemistry-vsepr-single-species-scalar: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
