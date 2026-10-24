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
const contradiction = plan("what is sp2 hybridisation", [{ formula: "BF3", claim: "BF3 is sp2 and trigonal planar" }],
  { qualitativeClaims: [{ id: "c1", claim: "BF3 has one lone pair on B", expected: true }] });
check(buildPlanExampleDocument("what is sp2 hybridisation", contradiction).status === "declined", "a plan claim contradicting the computed example declines");

// No default species: without the plan's own entry nothing is read.
check(readPlanExample("explain hybridisation", plan("explain hybridisation")).status === "none", "no plan example reads as none");
check(!questionNamesSpecies("explain vsepr theory") && !questionNamesSpecies("what is pH") && !questionNamesSpecies("what is sp2 hybridisation"), "topic asks name no species");
check(questionNamesSpecies("shape of NH3") && questionNamesSpecies("why is water bent") && questionNamesSpecies("hybridisation of carbon"), "species, names and elements are read as named");

if (failures) {
  console.error(`verify-plan-example-species: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`verify-plan-example-species: schema, ${DRAW.length} example draws with caption and save, ${DECLINE.length + 1} declines`);
