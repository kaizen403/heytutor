/**
 * Chemistry topic asks that name no species draw only the plan's own example.
 *
 * Schema: exampleSpecies is optional; absent, null or [] is no example; one
 * well-formed {formula, claim} passes; anything else fails validation.
 * Family layer: the example draws only on a chemistry question that names no
 * species, only with a claim that states a checked, true fact, captioned
 * "example: <formula>", tier qualitative_verified, provenance plan_example,
 * and it regenerates for the save. Every other case declines.
 */
import { validateTurnPlanV3 } from "../../src/contracts/contractsV3";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { chargeReadWhole } from "../../src/chemistry/planExample";
import { buildPlanExampleDocument, certifyVseprSourceDocument, readPlanExample, questionNamesSpecies } from "../../src/chemistry";

let failures = 0;
const check = (ok: boolean, message: string) => {
  if (!ok) { failures++; console.error(`FAIL ${message}`); }
};

const plan = (question: string, exampleSpecies?: unknown, extra: Record<string, unknown> = {}) => ({
  schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [],
  lawIds: [], assumptions: [], visualRequirement: "optional",
  ...(exampleSpecies === undefined ? {} : { exampleSpecies }), ...extra,
});

// Schema.
const q = "what is sp2 hybridisation";
check(validateTurnPlanV3(plan(q), q).valid, "a plan without exampleSpecies stays valid");
check(validateTurnPlanV3(plan(q, null), q).valid && validateTurnPlanV3(plan(q, []), q).valid, "null and [] mean no example");
check(validateTurnPlanV3(plan(q, [{ formula: "BF3", claim: "BF3 is sp2" }]), q).valid, "one well-formed example is valid");
for (const [bad, label] of [
  ["BF3", "a bare string"], [{ formula: "BF3", claim: "x" }, "an object"], [[{ formula: "BF3" }], "no claim"],
  [[{ formula: "", claim: "c" }], "empty formula"], [[{ formula: "BF3", claim: "a" }, { formula: "CH4", claim: "b" }], "two examples"],
] as const) {
  const result = validateTurnPlanV3(plan(q, bad), q);
  check(!result.valid && result.issues.some((issue) => issue.code === "invalid_example_species"), `schema refuses ${label}`);
}

// Draws.
const DRAW: Array<[string, string, string]> = [
  ["what is sp2 hybridisation", "BF3", "BF3 is sp2 hybridised and trigonal planar"],
  ["explain hybridisation", "CH4", "CH4 is sp3 and tetrahedral"],
  ["explain vsepr theory", "H2O", "H2O is bent with two lone pairs on O"],
];
for (const [question, formula, claim] of DRAW) {
  const turnPlan = plan(question, [{ formula, claim }]);
  const scene = synthesizeFamilyScene({ question, turnPlan });
  check(scene !== null, `${question} with ${formula} draws`);
  if (!scene) continue;
  check(scene.family === "chem_vsepr" && scene.tier === "qualitative_verified" && scene.nonMetric, `${question}: VSEPR, qualitative_verified`);
  check(scene.document.source.figureProvenance === "plan_example" && scene.document.source.exampleSpecies === formula, `${question}: provenance plan_example records ${formula}`);
  const texts = scene.renderScene.primitives.filter((primitive) => primitive.kind === "label").map((primitive) => primitive.text ?? "");
  check(texts.some((text) => /^example: /.test(text) && text.replace(/_/g, "") === `example: ${formula}`), `${question}: caption "example: ${formula}" is drawn (${texts.join("; ")})`);
  check(certifyVseprSourceDocument(scene.document, question, turnPlan as never).status === "certified", `${question}: the save regenerates the example figure`);
  check(certifyVseprSourceDocument(scene.document, question, null).status === "rejected", `${question}: without its plan the example cannot be saved`);
  const swapped = plan(question, [{ formula: "NH3", claim: "NH3 is sp3 and trigonal pyramidal" }]);
  check(certifyVseprSourceDocument(scene.document, question, swapped as never).status === "rejected", `${question}: a plan naming another example cannot certify this figure`);
}

// Declines.
const DECLINE: Array<[string, unknown, string]> = [
  ["what is sp2 hybridisation", undefined, "no example in the plan"],
  ["what is sp2 hybridisation", [{ formula: "BF3", claim: "BF3 is sp3 and tetrahedral" }], "a wrong claim"],
  ["what is sp2 hybridisation", [{ formula: "BF3", claim: "BF3 is a common example" }], "a claim with no checkable fact"],
  ["what is sp2 hybridisation", [{ formula: "CH4", claim: "NH3 is sp3" }], "a claim about another species"],
  ["what is sp2 hybridisation", [{ formula: "Bf3x", claim: "Bf3x is sp2" }], "an unparseable formula"],
  ["what is sp2 hybridisation", [{ formula: "BF3 and CH4", claim: "BF3 is sp2" }], "two formulas in one entry"],
  ["hybridisation of carbon", [{ formula: "CH4", claim: "CH4 is sp3 and tetrahedral" }], "a question naming an element"],
  ["why is water bent", [{ formula: "NH3", claim: "NH3 is sp3 and trigonal pyramidal" }], "a question naming a species"],
  ["explain newton's third law", [{ formula: "BF3", claim: "BF3 is sp2 and trigonal planar" }], "a physics question"],
  ["what is pH", [{ formula: "HCl", claim: "HCl is a strong acid" }], "a topic no family with claim checks reads"],
];
for (const [question, example, label] of DECLINE) {
  const scene = synthesizeFamilyScene({ question, turnPlan: plan(question, example) });
  check(scene?.document.source.figureProvenance !== "plan_example", `declines ${label} (${question})`);
}
// The example must illustrate what the question names: an sp3 figure is not
// an answer to "what is sp2 hybridisation", however true it is of CH4.
const OFF_TOPIC: Array<[string, string, string, string]> = [
  ["what is sp2 hybridisation", "CH4", "CH4 is sp3 and tetrahedral", "an sp3 example for an sp2 ask"],
  ["what is sp3d2 hybridisation", "PCl5", "PCl5 is sp3d and trigonal bipyramidal", "an sp3d example for an sp3d2 ask"],
  ["explain sp hybridisation", "BF3", "BF3 is sp2 and trigonal planar", "an sp2 example for an sp ask"],
  ["why are some molecules linear", "BF3", "BF3 is sp2 and trigonal planar", "a trigonal planar example for a linear ask"],
  ["why are some molecules bent", "NH3", "NH3 is sp3 and trigonal pyramidal", "a pyramidal example for a bent ask"],
  ["what molecules have two lone pairs", "NH3", "NH3 has one lone pair on N and is trigonal pyramidal", "a one lone pair example for a two lone pair ask"],
  ["difference between sp2 and sp3 hybridisation", "BF3", "BF3 is sp2 and trigonal planar", "one example for two named hybridisations"],
  ["explain dipole moment in molecules", "NH3", "NH3 is sp3 and trigonal pyramidal", "a bare shape for a dipole ask"],
  ["which molecules have a tetrahedral molecular shape", "NH3", "NH3 is sp3 and trigonal pyramidal", "a pyramidal example for a tetrahedral shape ask"],
  ["explain tetrahedral molecular shape and electron geometry using vsepr", "NH3", "NH3 is sp3 and trigonal pyramidal", "a pyramidal example when the tetrahedral shape is asked beside electron geometry"],
  ["which molecules have a tetrahedral electron geometry and shape", "NH3", "NH3 is sp3 and trigonal pyramidal", "a pyramidal example when shape is asked beside electron geometry"],
];
for (const [question, formula, claim, label] of OFF_TOPIC) {
  const built = buildPlanExampleDocument(question, plan(question, [{ formula, claim }]));
  check(built.status === "declined", `declines ${label} (${question}, ${formula}): ${built.status}`);
}
const ON_TOPIC: Array<[string, string, string]> = [
  ["what is sp3d2 hybridisation", "SF6", "SF6 is sp3d2 and octahedral"],
  ["explain sp hybridisation", "CO2", "CO2 is sp hybridised and linear"],
  ["why are some molecules linear", "CO2", "CO2 is sp hybridised and linear"],
  ["why are some molecules bent", "H2O", "H2O is bent with two lone pairs on O"],
  ["what molecules have two lone pairs", "H2O", "H2O is bent with two lone pairs on O"],
  ["which molecules have a tetrahedral electron geometry", "NH3", "NH3 is sp3 and trigonal pyramidal with one lone pair"],
  ["explain tetrahedral molecular shape and electron geometry using vsepr", "CH4", "CH4 is sp3 and tetrahedral"],
];
for (const [question, formula, claim] of ON_TOPIC) {
  const built = buildPlanExampleDocument(question, plan(question, [{ formula, claim }]));
  check(built.status === "built", `${question} with ${formula} draws: ${built.status === "declined" ? built.reason : built.status}`);
}

// Notation: subscripts and explicit charges are read; a charge the parser
// would have to guess or cannot read whole declines.
const NOTATION: Array<[string, string, string, string]> = [
  ["what is sp2 hybridisation", "BF₃", "BF₃ is sp2 and trigonal planar", "BF3"],
  ["explain hybridisation", "NH₄⁺", "NH₄⁺ is sp3 and tetrahedral", "NH4^(+)"],
  ["explain hybridisation", "SO4^2-", "SO4^2- is sp3 and tetrahedral", "SO4^2-"],
];
for (const [question, formula, claim, recorded] of NOTATION) {
  const built = buildPlanExampleDocument(question, plan(question, [{ formula, claim }]));
  check(built.status === "built" && built.document.source.exampleSpecies === recorded,
    `${formula} reads as ${recorded}: ${built.status === "declined" ? built.reason : built.status === "built" ? built.document.source.exampleSpecies : "none"}`);
}
for (const formula of ["SO42-", "PO43-", "SO4-2", "NH4(+)", "SO4^-2", "NH4+-", "SO4^2-^", "S-O4", "NO2^(+)^"]) {
  check(!chargeReadWhole(formula), `the charge reader refuses ${formula}`);
}
for (const formula of ["BF3", "NH4+", "NO3-", "SO4^2-", "SO4^(2-)", "NH4^+", "[BF4]-"]) {
  check(chargeReadWhole(formula), `the charge reader reads ${formula} whole`);
}
for (const formula of ["SO4 2-", "SO42-", "SO4-2", "NH4(+)", "SO4^-2", "NH4+-", "NO2 minus"]) {
  const built = buildPlanExampleDocument("explain hybridisation", plan("explain hybridisation", [{ formula, claim: `${formula} is sp3 and tetrahedral` }]));
  check(built.status === "declined", `a charge not read whole declines (${formula}): ${built.status}`);
}

// The saved document keeps the student's own question, not the example stem.
const savedExample = buildPlanExampleDocument("explain hybridisation", plan("explain hybridisation", [{ formula: "CH4", claim: "CH4 is sp3 and tetrahedral" }]));
check(savedExample.status === "built" && savedExample.document.source.question === "explain hybridisation",
  `the example document records the question as asked (${savedExample.status === "built" ? savedExample.document.source.question : savedExample.status})`);

const contradiction = plan("what is sp2 hybridisation", [{ formula: "BF3", claim: "BF3 is sp2 and trigonal planar" }],
  { qualitativeClaims: [{ id: "c1", claim: "BF3 has one lone pair on B", expected: true }] });
check(buildPlanExampleDocument("what is sp2 hybridisation", contradiction).status === "declined", "a plan claim contradicting the computed example declines");

const general = plan("what is sp2 hybridisation", [{ formula: "BF3", claim: "BF3 is sp2 and trigonal planar" }],
  { qualitativeClaims: [{ id: "c1", claim: "Molecules with lone pairs on the central atom are bent rather than linear", expected: true },
    { id: "c2", claim: "sp2 bonds are shorter than sp3 bonds", expected: true },
    { id: "c3", claim: "Lone pairs repel bonding pairs (e.g. bent water, trigonal pyramidal ammonia, planar BF3)", expected: true }] });
check(buildPlanExampleDocument("what is sp2 hybridisation", general).status === "built", "a general topic claim, or one naming several species, does not decline the example");

// No default species: without the plan's own entry nothing is read.
check(readPlanExample("explain hybridisation", plan("explain hybridisation")).status === "none", "no plan example reads as none");
check(!questionNamesSpecies("explain vsepr theory") && !questionNamesSpecies("what is pH") && !questionNamesSpecies("what is sp2 hybridisation"), "topic asks name no species");
check(questionNamesSpecies("shape of NH3") && questionNamesSpecies("why is water bent") && questionNamesSpecies("hybridisation of carbon"), "species, names and elements are read as named");

if (failures) {
  console.error(`verify-plan-example-species: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`verify-plan-example-species: schema, ${DRAW.length + ON_TOPIC.length + NOTATION.length} example draws, ${DECLINE.length + OFF_TOPIC.length + 8} declines, charge reader`);
