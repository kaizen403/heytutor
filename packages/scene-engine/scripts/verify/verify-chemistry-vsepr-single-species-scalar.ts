/**
 * Two readings refused the recorded plan for "shape of NH3 molecule", and neither fix
 * draws it alone. The plan writes "bond angle = 107 degrees" and names no species,
 * because only one is asked about: with one species drawn that is not ambiguous, and the
 * value must still equal the one computed for it. And it writes "less than the ideal
 * tetrahedral angle", which names a reference angle, not this molecule's shape.
 *
 *   tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-chemistry-vsepr-single-species-scalar.ts
 */
import assert from "node:assert/strict";
import "../../src/chemistry/families";
import { certifyVseprSourceDocument } from "../../src/chemistry/sourceEvidence";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { vseprPlanConflict } from "../../src/chemistry/vsepr";
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
  // A target named in words is a target, even with the right value.
  ["shape of NH3 molecule", [{ symbol: "bond angle of water", value: 107, unit: "degrees" }]],
  ["shape of NH3 molecule", [{ symbol: "bond angle of methane", value: 107, unit: "degrees" }]],
  ["shape of NH3 molecule", [{ symbol: "bond angle of silane", value: 107, unit: "degrees" }]],
  ["shape of NH3 molecule", [{ symbol: "bond angle", value: 107, unit: "degrees", sourceText: "the angle in water" }]],
  ["shape of NH3 molecule", [{ symbol: "bond angle", value: 107, unit: "degrees", sourceText: "as in carbon dioxide" }]],
  ["shape of NH3 molecule", [{ symbol: "bond angle", value: 107, unit: "degrees", sourceText: "the angle in H2O" }]],
  ["shape of NH3 molecule", [{ symbol: "bond angle", value: 107, unit: "pm" }]],
  ["shape of NH3 molecule", [{ symbol: "unnamed", value: 107, unit: "degrees" }]],
  ["Use VSEPR to predict the shapes of ClF3 and BrF5.", [{ symbol: "lone pairs", value: 1, unit: "" }]],
  ["Compare the shapes of NH3 and H2O.", [ANGLE(107)]],
  ["Compare the shapes of NH3 and H2O.", [{ symbol: "lone pairs", value: 1, unit: "" }]],
] as Array<[string, Scalar[]]>) {
  check(`still refused: ${question} ${JSON.stringify(scalars[0])}`, () => assert.ok(issues(question, scalars).includes("vsepr_plan_fact_unverified")));
}

// A target that is named keeps working as before.
for (const [question, scalars] of [
  ["Compare the shapes of NH3 and H2O.", [{ symbol: "NH3 bond angle", value: 107, unit: "degrees" }, { symbol: "H2O bond angle", value: 104.5, unit: "degrees" }]],
  ["shape of NH3 molecule", [{ symbol: "N valence electrons", value: 5, unit: "electrons", sourceText: "Nitrogen has 5 valence electrons" }]],
  ["shape of NH3 molecule", [{ symbol: "NH3 bond angle", value: 107, unit: "degrees", sourceText: "less than in methane" }]],
  ["shape of NH3 molecule", [{ symbol: "bond angle", value: 107, unit: "degrees", sourceText: "the angle in ammonia" }]],
] as Array<[string, Scalar[]]>) {
  check(`a named target still certifies: ${question}`, () => assert.deepEqual(issues(question, scalars), []));
}

// The other half of the same row: a shape word before an angle or a number names that
// reference, and it says nothing about this molecule's shape.
const conflict = (question: string, claim: string) => vseprPlanConflict(question, { ...createFallbackTurnPlanV3(question), subject: "chemistry", qualitativeClaims: [{ id: "c1", claim, expected: true }] } as unknown as TurnPlanV3);
for (const [question, claim] of [
  ["shape of NH3 molecule", "Bond angle is approximately 107 degrees, less than ideal tetrahedral 109.5 degrees due to lone pair-bond pair repulsion"],
  ["shape of NH3 molecule", "The bond angle is about 107 degrees, less than the ideal tetrahedral angle of 109.5 degrees."],
  ["shape of NH3 molecule", "The bond angle is smaller than the tetrahedral bond angle because of lone pair repulsion."],
  ["shape of H2O", "The H-O-H bond angle is about 104.5 degrees, less than the ideal tetrahedral angle of 109.5 degrees."],
  ["shape of H2O", "Lone pair repulsion compresses the angle below the tetrahedral value."],
  ["shape of NH3 molecule", "NH3 is trigonal pyramidal, with an angle below the tetrahedral 109.5 degrees."],
] as Array<[string, string]>) {
  check(`a reference angle is no shape claim: ${claim}`, () => assert.equal(conflict(question, claim), null));
}
for (const [question, claim] of [
  ["shape of NH3 molecule", "NH3 is tetrahedral."],
  ["shape of NH3 molecule", "NH3 has an ideal tetrahedral shape."],
  ["shape of NH3 molecule", "The molecular shape of NH3 is tetrahedral."],
  ["shape of NH3 molecule", "NH3 is tetrahedral with an angle of 107 degrees."],
  ["shape of H2O", "H2O is linear."],
  ["shape of H2O", "H2O is a tetrahedral molecule, with an angle below 109.5 degrees."],
  // A reference angle beside a wrong shape must not change how the wrong shape reads.
  ["shape of NH3 molecule", "NH3 has a tetrahedral molecular shape and an electron geometry with tetrahedral angles"],
  ["shape of NH3 molecule", "The molecular shape is tetrahedral and the electron geometry has a tetrahedral angle"],
  ["shape of NH3 molecule", "NH3 is trigonal planar, with an angle below the tetrahedral 109.5 degrees."],
  ["shape of NH3 molecule", "The molecular shape of NH3 is trigonal planar, with a planar angle of 120 degrees."],
] as Array<[string, string]>) {
  check(`a false shape claim still refuses: ${claim}`, () => assert.ok(conflict(question, claim)?.includes("contradicts")));
}

console.log(`verify-chemistry-vsepr-single-species-scalar: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
