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
 *
 * Charge rows: a regenerated figure is only the builder's reading of the
 * stem, and the Lewis and VSEPR builders read a spaced or sign first charge
 * (NO2 -, SO3 2-, O2 2-) as the neutral species. Those stems must earn no
 * certificate (not_applicable keeps the generic audit, which refuses them),
 * while charged species the builders read (NH4+, NO3^-, SO4^2-) and hyphens
 * (C-H, sp3-hybridised) still certify. A mutation removing the guards turns
 * the charge rows red.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { SceneDocument } from "../../src/types";

// The mutation check at the end reruns this gate on an edited copy of src.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const engineRoot = process.env.CHEM_SCALAR_ENGINE_ROOT ?? join(packageRoot, "src");
const mutant = process.env.CHEM_SCALAR_MUTANT === "1";
const { certifyChemistrySourceDocument, vseprPlanConflict } = await import(pathToFileURL(join(engineRoot, "chemistry", "index.ts")).href) as typeof import("../../src/chemistry");
const { synthesizeFamilyScene } = await import(pathToFileURL(join(engineRoot, "synthesize", "familyScene.ts")).href) as typeof import("../../src/synthesize/familyScene");

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
check(vseprPlanConflict(nh3, plan(nh3, { claims: [["The H-N-H angle is smaller than the tetrahedral 109.5 degrees", true]] })) === null,
  "NH3: a magnitude comparison with the tetrahedral angle is not a shape claim");
check(vseprPlanConflict(nh3, plan(nh3, { claims: [["NH3 is trigonal planar rather than pyramidal", true]] })) !== null,
  "NEGATIVE: a wrong shape before \"rather than\" still conflicts (the reference-angle skip covers magnitude comparisons only)");
check(vseprPlanConflict("shape of H2O", plan("shape of H2O", { claims: [["H2O is linear rather than bent", true]] })) !== null,
  "NEGATIVE: \"H2O is linear rather than bent\" still conflicts");
check(vseprPlanConflict("shape of H2O", plan("shape of H2O", { claims: [["The shape of H2O is nothing other than linear", true]] })) !== null,
  "NEGATIVE: a wrong shape right after a non-comparative \"than\" is not skipped as a reference angle");
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

// Review threads on #286: one fail closed rule. A scalar or claim certifies
// only when every count, unit, exponent, owner and expectation in it is read.
const lewisQ = (symbol: string, value: number, unit: string, sourceText: string) => plan(co2, { derived: [q(symbol, value, unit, sourceText)] });
check(status(co2Lewis, co2, lewisQ("lone pairs", 4, "pairs", "lone pairs on carbon")) === "rejected",
  "NEGATIVE: a lone-pair scalar whose source text names carbon is carbon's count (0), not the molecule's 4");
check(status(co2Lewis, co2, lewisQ("lone pairs", 4, "pairs", "lone pairs on the oxygen and carbon atoms")) === "rejected",
  "NEGATIVE: a lone-pair scalar naming two owners declines");
check(status(co2Lewis, co2, lewisQ("lone pairs", 4, "pairs", "total lone pairs in CO2")) === "certified",
  "Lewis CO2: an ownerless lone-pair total is the molecule's 4");
check(status(co2Lewis, co2, lewisQ("sigma bonds", 2, "bonds", "sigma bonds on carbon")) === "certified"
  && status(co2Lewis, co2, lewisQ("pi bonds", 1, "bonds", "pi bonds on carbon")) === "rejected",
  "Lewis CO2: a sigma or pi scalar owned by carbon is carbon's own count (2 sigma, 2 pi)");
const claimPlan = (question: string, claims: Array<[string, string | boolean]>) => plan(question, { claims });
check(status(co2Lewis, co2, claimPlan(co2, [["Carbon has two lone pairs", false]])) === "certified",
  "Lewis CO2: a claim the plan marks false is checked as false (carbon has no lone pairs)");
check(status(co2Lewis, co2, claimPlan(co2, [["Carbon has no lone pairs", false]])) === "rejected",
  "NEGATIVE: a true claim the plan marks false rejects the figure");
check(status(co2Lewis, co2, claimPlan(co2, [["CO2 has three sigma bonds", true]])) === "rejected",
  "NEGATIVE: three sigma bonds in CO2 rejects the figure (it draws two)");
check(status(co2Lewis, co2, claimPlan(co2, [["CO2 has two sigma bonds and two pi bonds", true]])) === "certified",
  "Lewis CO2: two sigma and two pi bonds certify");
check(status(co2Lewis, co2, claimPlan(co2, [["CO2 has 12 bonding electrons", true]])) === "rejected",
  "NEGATIVE: a wrong bonding electron count rejects the figure");
check(status(co2Lewis, co2, claimPlan(co2, [["Each C=O bond has a bond order of 3", true]])) === "rejected",
  "NEGATIVE: a count the reader cannot place (a bond order) declines the figure");
check(status(co2Lewis, co2, claimPlan(co2, [["All atoms achieve a complete octet", "C has 8 bonding electrons; each O has 4 bonding + 3 lone pair electrons"]])) === "rejected",
  "NEGATIVE: one wrong count inside a shared-noun list rejects the figure");
check(status(co2Lewis, co2, claimPlan(co2, [["All atoms achieve a complete octet", "C has 8 bonding electrons; each O has 4 bonding + 4 lone pair electrons"]])) === "certified",
  "Lewis CO2: the recorded octet claim reads every count by atom");
const ethene = "sigma and pi bonds in ethene";
const etheneLewis = figure(ethene, "chem_lewis");
{
  check(status(etheneLewis, ethene, claimPlan(ethene, [["The C=C double bond consists of one sigma bond (end-on overlap) and one pi bond", "1 sigma + 1 pi in double bond"]])) === "certified",
    "Lewis ethene: a double bond is one sigma and one pi bond");
  check(status(etheneLewis, ethene, claimPlan(ethene, [["The C=C double bond consists of two sigma bonds", true]])) === "rejected",
    "NEGATIVE: a double bond of two sigma bonds rejects the figure");
}
check(status(nh3Lewis, ammonia, claimPlan(ammonia, [["Nitrogen is the central atom bonded to three hydrogen atoms", "Three N-H single bonds using 8 electrons"]])) === "rejected",
  "NEGATIVE: three N-H bonds using 8 electrons rejects the figure");
check(status(co2Lewis, co2, claimPlan(co2, [["CO2 has 16 valence electrons", true]])) === "certified"
  && status(co2Lewis, co2, claimPlan(co2, [["CO2 has 18 valence electrons", true]])) === "rejected",
  "Lewis CO2: the molecule's valence electrons are its total (16)");
check(status(co2Lewis, co2, claimPlan(co2, [["Carbon forms four bonds", true]])) === "rejected",
  "NEGATIVE: a bond count over double bonds with no order word (bonds or bond pairs?) declines");
check(status(ieGraph, ie, plan(ie, { claims: [["There is a decrease from Be to B", "IE(B) > IE(Be)"]] })) === "rejected"
  && status(ieGraph, ie, plan(ie, { claims: [["There is a decrease from Be to B", "IE(Be) > IE(B)"]] })) === "certified",
  "periodic IE: a ranking in function notation is checked against the table");
check(status(co2Lewis, co2, claimPlan(co2, [["CO2 has eighteen total valence electrons", true]])) === "rejected"
  && status(co2Lewis, co2, claimPlan(co2, [["CO2 has 2.5 lone pairs on each oxygen", true]])) === "rejected",
  "NEGATIVE: a count written in a form the reader cannot read (eighteen, 2.5) declines instead of passing as prose");
check(status(co2Lewis, co2, claimPlan(co2, [["Carbon has a formal charge of 0", true]])) === "certified"
  && status(co2Lewis, co2, claimPlan(co2, [["Carbon has a formal charge of +1", true]])) === "rejected",
  "Lewis CO2: the article of \"a formal charge of 0\" is not a count");
check(status(ieGraph, ie, plan(ie, { claims: [["First ionisation energy of Li is 520 kJ/mol. The covalent radius of Li is 520 pm.", true]] })) === "rejected",
  "NEGATIVE: each value is read under its own clause's property (Li 520 pm is not Li's radius)");
check(status(ieGraph, ie, plan(ie, { claims: [["The first ionisation energy of Li is 520 pm", true]] })) === "rejected",
  "NEGATIVE: a unit the property is never written in declines the value");
check(vseprPlanConflict(nh3, plan(nh3, { claims: [["NH3 has an ideal tetrahedral molecular shape", true]] })) !== null,
  "NEGATIVE: \"ideal\" before a named molecular shape is a shape claim, not a reference angle");
check(vseprPlanConflict(nh3, plan(nh3, { claims: [["The angle is smaller than the ideal tetrahedral angle", true]] })) === null,
  "NH3: \"ideal tetrahedral angle\" stays a reference angle");
check(status(enGraph, en, plan(en, { claims: [["Pauling electronegativities: F 3.98, Cl 3.16", true]] })) === "certified",
  "periodic EN: the 1 inside 3.16 is not a second unit");
check(status(enGraph, en, plan(en, { claims: [["Fluorine is the most electronegative element in Group 17", "F has the highest electronegativity (Pauling value 3.98)"]] })) === "certified",
  "periodic EN: a clause naming one element and one value pairs them");
check(status(enGraph, en, plan(en, { claims: [["Fluorine is the most electronegative element in Group 17", "F has the highest electronegativity (Pauling value 4.5)"]] })) === "rejected",
  "NEGATIVE: a lone value paired with its only element is checked (F 4.5 against 3.98)");
check(status(enGraph, en, plan(en, { claims: [["Electronegativity falls by 0.8 from F to Cl", true]] })) === "rejected",
  "NEGATIVE: a number the reader cannot pair with an element declines the graph");
check(status(enGraph, en, plan(en, { claims: [["Electronegativity: F 2.50", false]] })) === "certified"
  && status(enGraph, en, plan(en, { claims: [["Electronegativity: F 3.98", false]] })) === "rejected",
  "periodic EN: a claim the plan marks false must be false against the table");
check(status(radiusGraph, radius, plan(radius, { claims: [["Covalent radii (pm): Na 166e3", true]] })) === "rejected",
  "NEGATIVE: an exponent is read with its mantissa (166e3 pm is not Na's 166 pm)");
check(status(radiusGraph, radius, plan(radius, { claims: [["Covalent radii (pm): Na 1.66e2", true]] })) === "certified",
  "periodic radius: 1.66e2 pm is Na's 166 pm");
check(status(ieGraph, ie, plan(ie, { claims: [["First ionisation energy (kJ/mol): Li 5.20e2", true]] })) === "certified",
  "periodic IE: Li 5.20e2 kJ/mol is the table's 520");
check(status(radiusGraph, radius, plan(radius, { claims: [["Covalent radii (pm): Na 166 × 10", true]] })) === "rejected",
  "NEGATIVE: a multiplier the reader cannot parse declines the graph");

// Graph tampering: the certificate never certifies a document the question does not regenerate.
const tamperedLewis = structuredClone(co2Lewis);
tamperedLewis.quantities.find((entry) => entry.id === "lone_pairs")!.value = 2;
check(status(tamperedLewis, co2, co2Plan) !== "certified", "a Lewis document with an edited count earns no certificate");
const tamperedTrend = structuredClone(radiusGraph);
tamperedTrend.quantities[0]!.value = 186;
check(status(tamperedTrend, radius, plan(radius)) !== "certified", "a trend document with an edited table value earns no certificate");
check(status(co2Lewis, "lewis structure of SO2", co2Plan) !== "certified", "a CO2 graph does not certify against another question");

// Charge written, builder dropped it: the regenerated figure is the neutral
// species, so it earns no certificate. Each row is checked and reported.
const CHARGE_DROPPED: ReadonlyArray<readonly [string, string, Array<[string, string | boolean]>]> = [
  ["lewis structure of NO2 -", "chem_lewis", [["The nitrite ion is bent", true]]],
  ["draw the lewis structure of NO2 -", "chem_lewis", [["Nitrite has resonance", true]]],
  ["lewis structure of NO2 -", "chem_lewis", []],
  ["lewis structure of O2 2-", "chem_lewis", []],
  ["shape of SO3 2-", "chem_vsepr", []],
  ["shape of NO2 -", "chem_vsepr", [["The nitrite ion is bent with a bond angle of about 115 degrees", true]]],
  ["hybridisation of NO2 -", "chem_vsepr", []],
];
const CHARGE_READ: ReadonlyArray<readonly [string, string]> = [
  ["lewis structure of NH4+", "chem_lewis"], ["lewis structure of NO3^-", "chem_lewis"], ["lewis structure of CN-", "chem_lewis"],
  ["shape of NH4+ ion", "chem_vsepr"], ["shape of SO4^2-", "chem_vsepr"], ["shape of NO2^-", "chem_vsepr"],
  ["lewis structure of CH4 showing each C-H bond", "chem_lewis"], ["shape of CH4 with sp3-hybridised carbon", "chem_vsepr"],
];
const chargeFailures: string[] = [];
for (const [question, family, claims] of CHARGE_DROPPED) {
  const turnPlan = plan(question, { claims });
  const got = status(figure(question, family), question, turnPlan);
  const name = `charge dropped (${question}${claims.length ? `, claim "${claims[0]![0]}"` : ""}): not_applicable`;
  console.log(`${got === "not_applicable" ? "PASS" : "FAIL"} ${name} (got ${got})`);
  if (got !== "not_applicable") chargeFailures.push(name);
}
for (const [question, family] of CHARGE_READ) {
  const got = status(figure(question, family), question, plan(question));
  const name = `charge read or hyphen (${question}): certified`;
  console.log(`${got === "certified" ? "PASS" : "FAIL"} ${name} (got ${got})`);
  if (got !== "certified") chargeFailures.push(name);
}
check(chargeFailures.length === 0, `charge rows failed: ${chargeFailures.join("; ")}`);

// Review round 3: a negation, a unit before a comparison sign and an atom
// owned total each certified a false explanation. Each must now decline,
// and the true reading beside it must still certify.
const ROUND3: ReadonlyArray<readonly [string, () => string, string]> = [
  ["negated Lewis count (CO2, not two lone pairs on each O)", () => status(co2Lewis, co2, plan(co2, { claims: [["There are not two lone pairs on each oxygen", true]] })), "rejected"],
  ["negated Lewis count with n't (CO2)", () => status(co2Lewis, co2, plan(co2, { claims: [["Each oxygen doesn't have two lone pairs", true]] })), "rejected"],
  ["count word no is not a negation (CO2, no lone pairs on carbon)", () => status(co2Lewis, co2, plan(co2, { claims: [["Carbon has no lone pairs", true]] })), "certified"],
  ["reversed ranking behind a Pauling unit (F 3.98 Pauling < Cl 3.16 Pauling)", () => status(enGraph, en, plan(en, { claims: [["Electronegativity: F 3.98 Pauling < Cl 3.16 Pauling", true]] })), "rejected"],
  ["unread comparison sign (F 3.98 units < Cl)", () => status(enGraph, en, plan(en, { claims: [["F 3.98 on the scale < Cl", true]] })), "rejected"],
  ["true ranking behind a Pauling unit (F 3.98 Pauling > Cl 3.16 Pauling)", () => status(enGraph, en, plan(en, { claims: [["Electronegativity: F 3.98 Pauling > Cl 3.16 Pauling", true]] })), "certified"],
  ["atom owned total (total valence electrons on N = 8 for NH3)", () => status(nh3Shape, nh3, plan(nh3, { derived: [q("total valence electrons on N", 8, "electrons", "5 + 3(1) = 8")] })), "rejected"],
  ["atom owned total in the source text (NH3)", () => status(nh3Shape, nh3, plan(nh3, { derived: [q("Total valence electrons", 8, "electrons", "total valence electrons around nitrogen")] })), "rejected"],
  ["molecule total still certifies (NH3 total valence 8)", () => status(nh3Shape, nh3, plan(nh3, { derived: [q("Total valence electrons", 8, "electrons", "5 + 3(1) = 8")] })), "certified"],
];
const round3Failures: string[] = [];
for (const [name, run, expected] of ROUND3) {
  const got = run();
  console.log(`${got === expected ? "PASS" : "FAIL"} round 3: ${name}: ${expected} (got ${got})`);
  if (got !== expected) round3Failures.push(name);
}
check(round3Failures.length === 0, `round 3 rows failed: ${round3Failures.join("; ")}`);

/** Run this gate on a copy of the engine with exact source edits. */
function runMutant(edits: ReadonlyArray<readonly [string, string, string]>): string {
  const scratch = join(packageRoot, "tmp", `chem-scalar-mutant-${process.pid}`);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  try {
    cpSync(join(packageRoot, "src"), join(scratch, "src"), { recursive: true });
    for (const [file, from, to] of edits) {
      const target = join(scratch, "src", file);
      const source = readFileSync(target, "utf8");
      assert.equal(source.split(from).length, 2, `the mutated text must appear exactly once in ${file}`);
      writeFileSync(target, source.replace(from, to));
      assert.notEqual(readFileSync(target, "utf8"), source, "the mutation must change the source");
    }
    const child = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(import.meta.url)], {
      cwd: packageRoot,
      env: { ...process.env, CHEM_SCALAR_ENGINE_ROOT: join(scratch, "src"), CHEM_SCALAR_MUTANT: "1" },
      encoding: "utf8",
      timeout: 300_000,
    });
    check(child.status !== 0, "the gate must fail on the mutant");
    return `${child.stdout}\n${child.stderr}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (!mutant) {
  const output = runMutant([
    [join("chemistry", "lewisSourceEvidence.ts"), "  if (!chargeMarkersCarried(question, [result.text])) return { status: \"not_applicable\" };\n", ""],
    [join("chemistry", "sourceEvidence.ts"),
      "    if (!chargeMarkersCarried(question, vseprSpecies(question).map((species) => species.formula))) return { status: \"not_applicable\" };\n", ""],
  ]);
  for (const [question, , claims] of CHARGE_DROPPED) {
    check(output.includes(`FAIL charge dropped (${question}${claims.length ? `, claim "${claims[0]![0]}"` : ""})`),
      `mutation control: without the charge guards, ${question} is certified again`);
  }
  for (const [question] of CHARGE_READ) {
    check(output.includes(`PASS charge read or hyphen (${question})`), `mutation control: ${question} still certifies without the guards`);
  }
}

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

console.log(`verify-chemistry-plan-scalar-certification: ${checks} checks passed${mutant ? " (mutant run)" : ""}`);
