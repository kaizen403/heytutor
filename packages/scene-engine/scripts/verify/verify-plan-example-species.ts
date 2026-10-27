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
  ["explain molecules with two lone pairs", "NH3", "NH3 has one lone pair on N and is trigonal pyramidal", "a one lone pair example for a two lone pair ask"],
  ["difference between sp2 and sp3 hybridisation", "BF3", "BF3 is sp2 and trigonal planar", "one example for two named hybridisations"],
  ["explain dipole moment in molecules", "NH3", "NH3 is sp3 and trigonal pyramidal", "a bare shape for a dipole ask"],
  ["explain the tetrahedral molecular shape", "NH3", "NH3 is sp3 and trigonal pyramidal", "a pyramidal example for a tetrahedral shape ask"],
  ["explain tetrahedral molecular shape and electron geometry using vsepr", "NH3", "NH3 is sp3 and trigonal pyramidal", "a pyramidal example when the tetrahedral shape is asked beside electron geometry"],
  ["explain the tetrahedral electron geometry and shape", "NH3", "NH3 is sp3 and trigonal pyramidal", "a pyramidal example when shape is asked beside electron geometry"],
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
  ["explain molecules with two lone pairs", "H2O", "H2O is bent with two lone pairs on O"],
  // Every word of these is read or puts no condition on the species.
  ["what is a lone pair", "NH3", "NH3 is sp3 and trigonal pyramidal with one lone pair"],
  ["what is a lone pair in vsepr theory", "NH3", "NH3 is sp3 and trigonal pyramidal with one lone pair"],
  ["explain molecules with no lone pairs", "CH4", "CH4 is sp3 and tetrahedral with no lone pairs"],
  ["what is a see-saw shape in vsepr theory", "SF4", "SF4 is sp3d and see-saw with one lone pair"],
  ["what is sp^3d^2 hybridisation?", "SF6", "SF6 is sp3d2 and octahedral"],
  ["What is sp³ hybridisation?", "CH4", "CH4 is sp3 and tetrahedral"],
  ["shapes of molecules by vsepr", "CH4", "CH4 is sp3 and tetrahedral"],
  ["explain trigonal-planar molecular shape using vsepr", "BF3", "BF3 is sp2 hybridised and trigonal planar"],
  ["explain shapes of molecules with two-lone-pairs", "H2O", "H2O is bent with two lone pairs on O"],
];
for (const [question, formula, claim] of ON_TOPIC) {
  const built = buildPlanExampleDocument(question, plan(question, [{ formula, claim }]));
  check(built.status === "built", `${question} with ${formula} draws: ${built.status === "declined" ? built.reason : built.status}`);
}

// The example must fit the whole question, not only the words the reader
// understands. Each example below is true of itself; each question carries a
// word the reader does not read (a negation, a property, a substance, a
// count it does not bind, a hybridisation it cannot map), so it declines.
const CO2 = "CO2 is sp hybridised and linear";
const CH4 = "CH4 is sp3 and tetrahedral with no lone pairs";
const H2O = "H2O is bent with two lone pairs on O";
const BF3 = "BF3 is sp2 hybridised and trigonal planar";
const SF6 = "SF6 is sp3d2 and octahedral";
const NH3 = "NH3 is sp3 and trigonal pyramidal with one lone pair";
const UNREAD: Array<[string, string, string]> = [
  ["explain the shape of nonlinear molecules", "CO2", CO2],
  ["explain why some molecules are not linear", "CO2", CO2],
  ["what is a lone pair", "CH4", CH4],
  ["explain the shape of molecules without lone pairs", "H2O", H2O],
  ["explain dsp2 hybridisation", "XeF4", "XeF4 is sp3d2 and square planar"],
  ["explain the shape of polar molecules", "CO2", CO2],
  ["what shape has a bond angle of 120", "CH4", CH4],
  ["explain sp3 hybridisation in ice", "CH4", CH4],
  ["explain sp2 hybridisation in graphite", "BF3", BF3],
  ["explain the shape of non planar molecules", "BF3", BF3],
  ["explain the shape of non-linear molecules", "CO2", CO2],
  ["explain the shape of a molecule with a single lone pair", "CH4", CH4],
  ["explain the shape of molecules with lone pairs", "CH4", CH4],
  ["how do lone pairs change bond angle", "CH4", CH4],
  ["explain the shape of a molecule with four bond pairs and one lone pair", "NH3", NH3],
  ["explain the shape of a molecule with three bond pairs", "CH4", CH4],
  ["explain the shape of a molecule with 5 electron domains", "CH4", CH4],
  ["explain the shape of molecules with an expanded octet", "CH4", CH4],
  ["explain the shape of electron deficient molecules", "CH4", CH4],
  ["explain the shape of odd electron molecules", "CH4", CH4],
  ["explain the shape of nonpolar molecules", "H2O", H2O],
  ["explain the shape of a diatomic molecule", "CO2", CO2],
  ["explain the shape of triatomic molecules", "CH4", CH4],
  ["explain the shape of a hydride", "SF6", SF6],
  ["explain the shape of interhalogen compounds", "XeF4", "XeF4 is sp3d2 and square planar"],
  ["explain hybridisation in coordination compounds", "SF6", SF6],
  ["why is the bond angle smaller than tetrahedral", "CH4", CH4],
  ["explain sp2 hybridisation in aldehydes", "BF3", BF3],
  ["explain sp hybridisation in alkynes", "CO2", CO2],
  ["explain sp3 hybridisation in diamond", "SiH4", "SiH4 is sp3 and tetrahedral"],
  ["explain d2sp3 hybridisation", "SF6", SF6],
  ["explain sp3d3 hybridisation", "IF7", "IF7 is sp3d3 and pentagonal bipyramidal"],
  ["explain distorted tetrahedral shape", "CH4", CH4],
  // Both readers see one separator: a hyphen is a space to each, and any
  // other separator is a word neither reads.
  ["explain trigonal-planar molecular geometry using vsepr", "CH4", CH4],
  ["explain two-lone-pair geometry", "NH3", NH3],
  ["explain trigonal, planar molecular geometry using vsepr", "CH4", CH4],
  ["explain trigonal (planar) molecular geometry using vsepr", "CH4", CH4],
  ["explain trigonal_planar molecular geometry using vsepr", "CH4", CH4],
];
for (const [question, formula, claim] of UNREAD) {
  const turnPlan = plan(question, [{ formula, claim }]);
  const built = buildPlanExampleDocument(question, turnPlan);
  const scene = synthesizeFamilyScene({ question, turnPlan });
  check(built.status === "declined" && scene?.document.source.figureProvenance !== "plan_example",
    `declines ${formula} for a question with an unread word (${question}): ${built.status}`);
}

// The reader binds a shape word to the molecular shape only, a lone pair
// phrase to one count, and no article to anything. So any electron
// arrangement or geometry word, a comparison, a second lone pair phrase, a
// definite article and a yes or no ask decline, true example or not. Each row
// below drew on 891dd2b33.
const XEF2 = "XeF2 is sp3d and linear with three lone pairs";
const XEF4 = "XeF4 is sp3d2 and square planar with two lone pairs";
const CLF3 = "ClF3 is sp3d and T-shaped with two lone pairs";
const SF4 = "SF4 is sp3d and see-saw with one lone pair";
const CUT: Array<[string, string, string]> = [
  // (a) an electron arrangement checked against the molecular shape.
  ["what is a linear arrangement in vsepr theory", "XeF2", XEF2],
  ["explain the linear geometry of electron pairs", "XeF2", XEF2],
  ["why are electron pairs in some molecules linear", "XeF2", XEF2],
  ["explain linear domains in vsepr theory", "XeF2", XEF2],
  ["explain the linear domain arrangement in vsepr theory", "XeF2", XEF2],
  ["explain the linear geometry of domains in vsepr theory", "XeF2", XEF2],
  ["what is the linear arrangement of pairs in vsepr theory", "XeF2", XEF2],
  ["what is the linear vsepr arrangement", "XeF2", XEF2],
  ["explain the square planar geometry of electron pairs", "XeF4", XEF4],
  ["explain the square planar arrangement in vsepr theory", "XeF4", XEF4],
  ["explain the square planar vsepr arrangement", "XeF4", XEF4],
  ["explain the bent geometry of electron pairs", "H2O", H2O],
  ["what is the bent pair arrangement in vsepr theory", "H2O", H2O],
  ["explain the t shaped geometry of electron pairs", "ClF3", CLF3],
  ["explain the t shaped arrangement in vsepr theory", "ClF3", CLF3],
  ["explain the see saw geometry of electron pairs", "SF4", SF4],
  ["what is linear electron pair geometry in vsepr theory", "XeF2", XEF2],
  // (a) a comparison of electron geometry and molecular shape.
  ["difference between electron geometry and molecular geometry", "CH4", CH4],
  ["difference between electron geometry and molecular geometry", "CO2", CO2],
  ["explain the electron geometry and molecular geometry", "CH4", CH4],
  ["explain electron geometry and molecular shape", "CO2", CO2],
  // (a) draws lost to the cut: true examples, but the words are not read.
  ["difference between electron geometry and molecular geometry", "NH3", NH3],
  ["explain the tetrahedral electron geometry of molecules", "NH3", NH3],
  ["explain tetrahedral molecular shape and electron geometry using vsepr", "CH4", CH4],
  ["what does octahedral molecular geometry look like", "SF6", SF6],
  ["explain trigonal-planar molecular geometry using vsepr", "BF3", BF3],
  ["explain two-lone-pair geometry", "H2O", H2O],
  ["how do lone pairs change bond angle", "NH3", NH3],
  ["how do lone pairs change bond angle", "XeF2", XEF2],
  // (b) two lone pair phrases, one of them "no lone pairs".
  ["what is a lone pair in molecules with no lone pairs", "CH4", CH4],
  ["difference between molecules with lone pairs and molecules with no lone pairs", "CH4", CH4],
  ["explain molecules with lone pairs and molecules with no lone pairs", "CH4", CH4],
  ["what is a lone pair in molecules with two lone pairs", "H2O", H2O],
  // (c) a definite article: a molecule, or its property, the question never names.
  ["what is the shape of the molecule", "CH4", CH4],
  ["what is the shape of the molecule", "NH3", NH3],
  ["what is the hybridisation of the molecule", "CH4", CH4],
  ["what is the bond angle of the molecule", "CH4", CH4],
  ["what are the shapes of the molecules", "CH4", CH4],
  ["what is the bond angle", "CH4", CH4],
  ["what is the hybridisation", "CH4", CH4],
  // A conjunction or a yes or no ask the reader does not answer.
  ["explain sp3 hybridisation and tetrahedral shape", "CH4", CH4],
  ["are linear molecules sp", "CO2", CO2],
  ["is sp3 hybridisation tetrahedral", "CH4", CH4],
  ["does sp3 hybridisation mean tetrahedral shape", "CH4", CH4],
  ["are bent molecules sp3 in vsepr theory", "H2O", H2O],
];
for (const [question, formula, claim] of CUT) {
  const turnPlan = plan(question, [{ formula, claim }]);
  const built = buildPlanExampleDocument(question, turnPlan);
  const scene = synthesizeFamilyScene({ question, turnPlan });
  check(built.status === "declined" && scene?.document.source.figureProvenance !== "plan_example",
    `declines ${formula} for a question whose words are not all read (${question}): ${built.status}`);
}

// A singular "lone pair" is the count one, with or without "a". A singular
// "molecule" needs "a" or "an" as its own article (only a shape or
// hybridisation may sit between them); an article on another noun does not
// count.
const SO2 = "SO2 is sp2 and bent with one lone pair";
const ONE_LONE_PAIR_AND_BARE_MOLECULE: Array<[string, string, string]> = [
  ["explain bent molecules with a lone pair", "H2O", H2O],
  ["why do molecules with a lone pair look bent", "H2O", H2O],
  ["explain linear molecules with a lone pair", "XeF2", XEF2],
  ["what is a molecule with a lone pair", "H2O", H2O],
  ["describe a molecule with a lone pair", "ClF3", CLF3],
  ["explain square planar molecules with a lone pair", "XeF4", XEF4],
  ["what is a lone pair", "H2O", H2O],
  ["what is shape of molecule", "CH4", CH4],
  ["what is hybridisation of molecule", "CH4", CH4],
  ["what is bond angle of molecule", "NH3", NH3],
  ["explain shape of molecule", "H2O", H2O],
  ["explain linear molecules with lone pair", "XeF2", XEF2],
  ["what is a bent molecule with lone pair", "H2O", H2O],
  ["explain bent molecules with lone pair", "H2O", H2O],
  ["what is a bond angle of molecule", "NH3", NH3],
  ["what is a shape of molecule", "CH4", CH4],
  ["explain a shape of molecule", "H2O", H2O],
  ["explain a hybridisation of molecule", "CH4", CH4],
  ["what is a shape of molecule with a lone pair", "NH3", NH3],
];
for (const [question, formula, claim] of ONE_LONE_PAIR_AND_BARE_MOLECULE) {
  const turnPlan = plan(question, [{ formula, claim }]);
  const built = buildPlanExampleDocument(question, turnPlan);
  const scene = synthesizeFamilyScene({ question, turnPlan });
  check(built.status === "declined" && scene?.document.source.figureProvenance !== "plan_example",
    `declines ${formula} for (${question}): ${built.status}`);
}
for (const [question, formula, claim] of [
  ["explain bent molecules with a lone pair", "SO2", SO2],
  ["explain bent molecules with lone pair", "SO2", SO2],
  ["what is a lone pair", "NH3", NH3],
  ["what is a linear molecule", "CO2", CO2],
  ["what is a t shaped molecule", "ClF3", CLF3],
  ["what is a bent molecule with one lone pair", "SO2", SO2],
] as const) {
  const built = buildPlanExampleDocument(question, plan(question, [{ formula, claim }]));
  check(built.status === "built", `${question} with ${formula} draws: ${built.status === "declined" ? built.reason : built.status}`);
}

// The caption is drawn whole or the example declines: board text is cut to
// one label's length, and a cut caption names another species or drops a charge.
for (const [question, formula, claim] of [
  ["explain sp3 hybridisation", "CH2Cl2", "CH2Cl2 is sp3 and tetrahedral"],
  ["explain sp3 hybridisation", "SO2Cl2", "SO2Cl2 is sp3 and tetrahedral"],
  ["explain sp3d hybridisation", "XeO2F2", "XeO2F2 is sp3d and see-saw"],
  ["explain sp3d hybridisation", "PCl3F2", "PCl3F2 is sp3d and trigonal bipyramidal"],
  ["explain hybridisation", "SO4^2-", "SO4^2- is sp3 and tetrahedral"],
  ["explain sp2 hybridisation", "CO3^2-", "CO3^2- is sp2 and trigonal planar"],
  ["explain hybridisation", "NH₄⁺", "NH₄⁺ is sp3 and tetrahedral"],
] as const) {
  const turnPlan = plan(question, [{ formula, claim }]);
  const built = buildPlanExampleDocument(question, turnPlan);
  const scene = synthesizeFamilyScene({ question, turnPlan });
  check(built.status === "declined" && scene?.document.source.figureProvenance !== "plan_example",
    `declines ${formula}, whose caption does not fit one label: ${built.status === "built" ? built.source.caption : built.status}`);
}
for (const [question, formula, claim] of [
  ["explain hybridisation", "CH2F2", "CH2F2 is sp3 and tetrahedral"],
  ["explain hybridisation", "POCl3", "POCl3 is sp3 and tetrahedral"],
  ["explain sp3d2 hybridisation", "XeOF4", "XeOF4 is sp3d2 and square pyramidal"],
] as const) {
  const turnPlan = plan(question, [{ formula, claim }]);
  const scene = synthesizeFamilyScene({ question, turnPlan });
  const built = buildPlanExampleDocument(question, turnPlan);
  const drawn = scene?.renderScene.primitives.filter((primitive) => primitive.kind === "label" && /^example: /.test(primitive.text ?? "")).map((primitive) => primitive.text) ?? [];
  check(built.status === "built" && drawn.length === 1 && drawn[0] === built.source.caption,
    `${formula} draws its whole caption: ${built.status === "built" ? `${built.source.caption} drawn ${JSON.stringify(drawn)}` : built.status === "declined" ? built.reason : built.status}`);
}

// Notation: subscripts and explicit charges are read; a charge the parser
// would have to guess or cannot read whole declines.
const NOTATION: Array<[string, string, string, string]> = [
  ["what is sp2 hybridisation", "BF₃", "BF₃ is sp2 and trigonal planar", "BF3"],
  ["explain hybridisation", "NH₄⁺", "NH₄⁺ is sp3 and tetrahedral", "NH4^(+)"],
  ["explain hybridisation", "SO4^2-", "SO4^2- is sp3 and tetrahedral", "SO4^2-"],
];
for (const [question, formula, claim, recorded] of NOTATION) {
  const reading = readPlanExample(question, plan(question, [{ formula, claim }]));
  check(reading.status === "accepted" && reading.source.formula === recorded,
    `${formula} reads as ${recorded}: ${reading.status === "declined" ? reading.reason : reading.status === "accepted" ? reading.source.formula : "none"}`);
}
const bf3 = buildPlanExampleDocument("what is sp2 hybridisation", plan("what is sp2 hybridisation", [{ formula: "BF₃", claim: "BF₃ is sp2 and trigonal planar" }]));
check(bf3.status === "built" && bf3.document.source.exampleSpecies === "BF3", `BF₃ builds as BF3: ${bf3.status}`);
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
console.log(`verify-plan-example-species: schema, ${DRAW.length + ON_TOPIC.length + 10} example draws, ${DECLINE.length + OFF_TOPIC.length + UNREAD.length + CUT.length + ONE_LONE_PAIR_AND_BARE_MOLECULE.length + 15} declines, charge reader`);
