/**
 * Native chemistry figures certify their own numbers from the deterministic
 * source: VSEPR and Lewis counts from the regenerated structure graph, and
 * periodic trend values from the element table. A plan scalar or claim that
 * names a role and matches is certified, one that contradicts the source
 * rejects the figure, and a numeric plan value with an unknown role declines.
 *
 * Positive rows mirror recorded short asks (Kimi K3 Fast) that drew nothing
 * before: shape of NH3, Lewis CO2, Lewis ammonia, electronegativity down
 * group 17, ionisation energy across period 2. The radius row stays refused:
 * its plan quotes metallic radii (Na 186 pm) and ranks Cl above Ar, both
 * false against the covalent table the graph plots.
 */
import assert from "node:assert/strict";
import { certifyChemistrySourceDocument, vseprPlanConflict } from "../../src/chemistry";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { SceneDocument } from "../../src/types";

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks++;
  assert.ok(condition, message);
}

function q(symbol: string, value: number, unit: string | undefined, sourceText: string, provenance: "given" | "derived" = "derived"): TurnPlanQuantityV3 {
  return { id: `q_${symbol.replace(/\W+/g, "_")}`, symbol, value, ...(unit ? { unit } : {}), sourceText, provenance } as TurnPlanQuantityV3;
}

function plan(question: string, parts: { givens?: TurnPlanQuantityV3[]; derived?: TurnPlanQuantityV3[]; claims?: Array<[string, string | boolean]> } = {}): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, visualRequirement: "required", unknowns: [], lawIds: [], assumptions: [],
    givens: parts.givens ?? [], derived: parts.derived ?? [],
    qualitativeClaims: (parts.claims ?? []).map(([claim, expected], index) => ({ id: `c${index + 1}`, claim, expected })),
  } as TurnPlanV3;
}

function figure(question: string, family: string): SceneDocument {
  const scene = synthesizeFamilyScene({ question, families: [family], turnPlan: plan(question) });
  check(scene?.family === family, `${question}: native ${family} figure regenerates`);
  return scene.document;
}

function status(document: SceneDocument, question: string, turnPlan: TurnPlanV3 | null): string {
  return certifyChemistrySourceDocument(document, question, turnPlan).status;
}

function codes(document: SceneDocument, question: string, turnPlan: TurnPlanV3): string[] {
  const result = certifyChemistrySourceDocument(document, question, turnPlan);
  return result.status === "rejected" ? result.issues.map((issue) => issue.code ?? "") : [];
}

// VSEPR: shape of NH3.
const nh3 = "shape of NH3 molecule";
const nh3Shape = figure(nh3, "chem_vsepr");
const nh3Givens = [
  q("N valence electrons", 5, "electrons", "Nitrogen has 5 valence electrons", "given"),
  q("H atoms bonded", 3, "atoms", "Three hydrogen atoms bonded to nitrogen", "given"),
];
const nh3Angle = q("bond angle", 107, "degrees", "Approximately 107 degrees due to lone pair repulsion");
const nh3Claims: Array<[string, string]> = [
  ["NH3 has a trigonal pyramidal molecular shape", "trigonal pyramidal"],
  ["Bond angle is approximately 107 degrees, less than ideal tetrahedral 109.5 degrees due to lone pair-bond pair repulsion", "107 degrees"],
];
const nh3Plan = plan(nh3, { givens: nh3Givens, derived: [nh3Angle], claims: nh3Claims });
check(status(nh3Shape, nh3, nh3Plan) === "certified", "NH3: valence 5, 3 bonded H and the sole species' 107° angle certify the shape graph");
check(status(nh3Shape, nh3, plan(nh3, { givens: [q("N valence electrons", 3, "electrons", "Nitrogen has 3 valence electrons", "given")] })) === "rejected",
  "NEGATIVE: N with 3 valence electrons rejects the NH3 figure");
check(status(nh3Shape, nh3, plan(nh3, { givens: [q("H atoms bonded", 4, "atoms", "Four hydrogen atoms bonded to nitrogen", "given")] })) === "rejected",
  "NEGATIVE: 4 bonded H on NH3 rejects the figure");
check(status(nh3Shape, nh3, plan(nh3, { derived: [q("bond angle", 109.5, "degrees", "tetrahedral angle")] })) === "rejected",
  "NEGATIVE: a 109.5° NH3 bond angle rejects the figure");
check(status(nh3Shape, nh3, plan(nh3, { derived: [q("dipole moment", 1.47, "D", "measured dipole")] })) === "rejected",
  "NEGATIVE: an unknown derived role declines the NH3 figure");
// Save admission runs vseprPlanConflict beside the certificate.
check(vseprPlanConflict(nh3, nh3Plan) === null, "NH3: the ideal tetrahedral 109.5° reference angle is not a shape claim");
check(vseprPlanConflict(nh3, plan(nh3, { claims: [["NH3 is tetrahedral", true]] })) !== null,
  "NEGATIVE: a real tetrahedral shape claim for NH3 still conflicts (only reference angles are exempt)");
check(vseprPlanConflict(nh3, plan(nh3, { claims: [["NH3 has a tetrahedral molecular shape", "tetrahedral (109.5°)"]] })) !== null,
  "NEGATIVE: a tetrahedral shape claim followed by its angle still conflicts");
check(status(nh3Shape, nh3, plan(nh3, { derived: [q("Total valence electrons", 8, "electrons", "5 + 3(1) = 8")] })) === "certified",
  "NH3: 8 total valence electrons certifies against the formula");
check(status(nh3Shape, nh3, plan(nh3, { derived: [q("Total valence electrons", 9, "electrons", "5 + 3 + 1")] })) === "rejected",
  "NEGATIVE: 9 total valence electrons rejects the NH3 figure");
const vseprCo2 = "shape of CO2 molecule";
const co2Shape = figure(vseprCo2, "chem_vsepr");
check(status(co2Shape, vseprCo2, plan(vseprCo2, { derived: [q("lone pairs on C", 2, "pairs", "carbon lone pairs")] })) === "rejected",
  "NEGATIVE: 2 lone pairs on CO2's carbon rejects the VSEPR figure");

// Lewis: CO2 and ammonia, the recorded plans.
const co2 = "lewis structure of CO2";
const co2Lewis = figure(co2, "chem_lewis");
const co2Plan = plan(co2, {
  givens: [
    q("C valence electrons", 4, "electrons", "Carbon is in group 14", "given"),
    q("O valence electrons", 6, "electrons", "Oxygen is in group 16", "given"),
    q("O count", 2, undefined, "CO2 has two oxygen atoms", "given"),
  ],
  derived: [
    q("Total valence electrons", 16, "electrons", "4 + 2(6) = 16"),
    q("Bonding electrons", 8, "electrons", "2 double bonds × 4 electrons = 8"),
    q("Lone pair electrons", 8, "electrons", "16 - 8 = 8; 4 lone pairs × 2 electrons = 8"),
    q("Formal charge on C", 0, undefined, "4 - 0 - (8/2) = 0"),
    q("Formal charge on each O", 0, undefined, "6 - 4 - (4/2) = 0"),
  ],
  claims: [
    ["The Lewis structure of CO2 is O=C=O with two lone pairs on each oxygen atom", "O=C=O, each O has 2 lone pairs"],
    ["All formal charges are zero, making this the most stable Lewis structure", "FC(C)=0, FC(O)=0"],
  ],
});
check(status(co2Lewis, co2, co2Plan) === "certified", "Lewis CO2: every recorded role-bearing scalar matches the regenerated structure");
const co2Certificate = certifyChemistrySourceDocument(co2Lewis, co2, co2Plan);
check(co2Certificate.status === "certified" && co2Certificate.quantities.map((entry) => `${entry.id}=${String(entry.value)}`).join(",") === "sigma_bonds=2,pi_bonds=2,lone_pairs=4",
  "Lewis CO2: the certificate carries the graph's own sigma, pi and lone-pair counts");
check(codes(co2Lewis, co2, plan(co2, { derived: [q("Lone pairs on C", 2, "pairs", "two lone pairs on carbon")] })).includes("lewis_plan_fact_unverified"),
  "NEGATIVE: 2 lone pairs on CO2's carbon rejects the Lewis figure");
check(codes(co2Lewis, co2, plan(co2, { claims: [["Carbon has two lone pairs", "C has 2 lone pairs"]] })).includes("lewis_plan_claim_conflict"),
  "NEGATIVE: a claim of two lone pairs on carbon rejects the Lewis figure");
check(status(co2Lewis, co2, plan(co2, { derived: [q("Formal charge on each O", -1, undefined, "6 - 6 - 1")] })) === "rejected",
  "NEGATIVE: a nonzero formal charge on CO2's oxygens rejects the figure");
check(status(co2Lewis, co2, plan(co2, { derived: [q("C=O bond enthalpy", 799, "kJ/mol", "bond energy")] })) === "rejected",
  "NEGATIVE: an unknown derived role declines the Lewis figure");
check(status(co2Lewis, co2, plan(co2, { derived: [q("Lone pairs in H2O", 2, "pairs", "water")] })) === "rejected",
  "NEGATIVE: a scalar naming another species cannot certify against CO2");

const ammonia = "lewis dot structure of ammonia";
const nh3Lewis = figure(ammonia, "chem_lewis");
const ammoniaPlan = plan(ammonia, {
  givens: [
    q("N valence electrons", 5, "electrons", "Nitrogen is in Group 15", "given"),
    q("H valence electrons", 1, "electrons", "Hydrogen has 1 valence electron", "given"),
    q("H atoms", 3, "atoms", "Ammonia formula NH3", "given"),
  ],
  derived: [
    q("Total valence electrons", 8, "electrons", "5 + 3(1) = 8"),
    q("Bonding pairs", 3, "pairs", "3 N-H bonds = 3 pairs"),
    q("Lone pairs on N", 1, "pairs", "(8 - 6)/2 = 1"),
  ],
  claims: [["Ammonia (NH3) has 8 total valence electrons", "5 from N + 3×1 from H = 8"], ["Nitrogen has one lone pair of electrons", "1 lone pair on N"]],
});
check(status(nh3Lewis, ammonia, ammoniaPlan) === "certified", "Lewis ammonia: the recorded plan certifies by species and atom");
check(status(nh3Lewis, ammonia, plan(ammonia, { claims: [["Ammonia has 10 total valence electrons", "10"]] })) === "rejected",
  "NEGATIVE: a wrong total valence electron claim rejects the Lewis figure");

// Periodic: electronegativity down group 17, ionisation energy across period 2.
const en = "electronegativity down group 17";
const enGraph = figure(en, "chem_periodic");
check(status(enGraph, en, plan(en, { claims: [["Electronegativity decreases down Group 17", "F > Cl > Br > I"]] })) === "certified",
  "periodic EN: a plan that omits the table values and ranks F > Cl > Br > I certifies the graph");
check(status(enGraph, en, plan(en, { derived: [q("electronegativity of F", 4.0, undefined, "Pauling")] })) === "certified",
  "periodic EN: F 4.0 agrees with the table's 3.98 at its written precision");
check(status(enGraph, en, plan(en, { claims: [["Electronegativity increases down Group 17", "I > Br > Cl > F"]] })) === "rejected",
  "NEGATIVE: a reversed electronegativity ranking rejects the graph");
const ie = "ionisation energy trend across period 2";
const ieGraph = figure(ie, "chem_periodic");
const iePlan = plan(ie, { claims: [
  ["First ionisation energy generally increases across Period 2 from Li to Ne due to increasing nuclear charge and decreasing atomic radius.", "Li < B < Be < C < O < N < F < Ne (general increase with two exceptions)"],
  ["Approximate first ionisation energies (kJ/mol): Li 520, Be 900, B 801, C 1086, N 1402, O 1314, F 1681, Ne 2081.", true],
] });
check(status(ieGraph, ie, iePlan) === "certified", "periodic IE: the recorded ranking and approximate values agree with the table");
check(status(ieGraph, ie, plan(ie, { claims: [["First ionisation energies (kJ/mol): Li 520, Be 1200", true]] })) === "rejected",
  "NEGATIVE: a first ionisation energy of Be the table contradicts rejects the graph");
check(status(ieGraph, ie, plan(ie, { derived: [q("Zeff of Li", 1.3, undefined, "Slater")] })) === "rejected",
  "NEGATIVE: an unknown derived role declines the periodic graph");
check(status(ieGraph, ie, plan(ie, { derived: [q("second ionisation energy of Li", 7298, "kJ/mol", "IE2")] })) === "rejected",
  "NEGATIVE: a property the table does not hold declines the periodic graph");

const radius = "trend of atomic radius in period 3";
const radiusGraph = figure(radius, "chem_periodic");
check(status(radiusGraph, radius, plan(radius)) === "certified", "periodic radius: a plan with no values certifies the covalent radius graph");
check(status(radiusGraph, radius, plan(radius, { derived: [q("atomic radius of Na", 186, "pm", "metallic radius quoted in NCERT")] })) === "rejected",
  "NEGATIVE: a radius for Na that disagrees with the table (186 vs 166 pm) rejects the graph");
check(status(radiusGraph, radius, plan(radius, { derived: [q("atomic radius of Na", 1.66, "Å", "covalent")] })) === "certified",
  "periodic radius: 1.66 Å converts to the table's 166 pm");
check(status(radiusGraph, radius, plan(radius, { claims: [["Atomic radius decreases across Period 3 from Na to Ar (Na > Mg > Al > Si > P > S > Cl > Ar).", "decreases left to right"]] })) === "rejected",
  "NEGATIVE: the recorded ranking Cl > Ar contradicts the covalent table (102 < 106 pm) and keeps the refusal");
check(status(radiusGraph, radius, plan(radius, { claims: [["Approximate atomic radii (pm): Na 186, Mg 160", true]] })) === "rejected",
  "NEGATIVE: the recorded metallic radii keep the radius graph refused");

// Graph tampering: the certificate never certifies a document the question does not regenerate.
const tamperedLewis = structuredClone(co2Lewis);
tamperedLewis.quantities.find((entry) => entry.id === "lone_pairs")!.value = 2;
check(status(tamperedLewis, co2, co2Plan) !== "certified", "a Lewis document with an edited count earns no certificate");
const tamperedTrend = structuredClone(radiusGraph);
tamperedTrend.quantities[0]!.value = 186;
check(status(tamperedTrend, radius, plan(radius)) !== "certified", "a trend document with an edited table value earns no certificate");
check(status(co2Lewis, "lewis structure of SO2", co2Plan) !== "certified", "a CO2 graph does not certify against another question");

// Mutation control: one changed plan value flips each certified row, and the
// mutation really changed the plan.
for (const [label, document, question, base] of [
  ["NH3 shape", nh3Shape, nh3, nh3Plan], ["Lewis CO2", co2Lewis, co2, co2Plan], ["Lewis ammonia", nh3Lewis, ammonia, ammoniaPlan],
] as const) {
  const mutated = structuredClone(base);
  const target = mutated.derived[0] ?? mutated.givens[0]!;
  target.value += 1;
  check(JSON.stringify(mutated) !== JSON.stringify(base), `mutation control (${label}): the plan changed`);
  check(status(document, question, base) === "certified" && status(document, question, mutated) === "rejected",
    `mutation control (${label}): certified before, rejected after one plan value moves by 1`);
}
const mutatedIe = structuredClone(iePlan);
mutatedIe.qualitativeClaims[1]!.claim = mutatedIe.qualitativeClaims[1]!.claim.replace("Ne 2081", "Ne 2481");
check(mutatedIe.qualitativeClaims[1]!.claim !== iePlan.qualitativeClaims[1]!.claim && status(ieGraph, ie, mutatedIe) === "rejected",
  "mutation control (IE period 2): one claimed table value moved, the graph is rejected");

console.log(`verify-chemistry-plan-scalar-certification: ${checks} checks passed`);
