/**
 * The Lewis and periodic families count their own computed quantities (bond and lone
 * pair counts from the structure they drew, values from the periodic table) as engine
 * derived, unless the plan states a number in the same unit. One resonance form never
 * stands for a species whose forms differ, and an all negative trend says which way
 * is more negative. Dev's saved boards still pass their resume save.
 *
 *   tsx scripts/verify/verify-chemistry-computed-quantities.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { synthesizeFamilyScene, synthesizeLastResortScene, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";

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

const plan = (question: string, givens: TurnPlanV3["givens"] = []): TurnPlanV3 =>
  ({ ...createFallbackTurnPlanV3(question), subject: "chemistry", givens } as TurnPlanV3);
const select = (question: string, turnPlan: TurnPlanV3) =>
  selectProductionScene({ question, turnPlan, problemIR: null, exactFigureSource: "planner", solverAuthorityBlocked: false,
    solverAuthority: null, requiredRetryEnabled: true, completionEnabled: false, blockFlowEligible: false });
const groupIds = (document: SceneDocument | null | undefined) => (document?.revealGroups ?? []).map((group) => group.id);
const labelText = (document: SceneDocument | null | undefined, id: string) => document?.entities.find((entity) => entity.id === id)?.label;
const caption = (document: SceneDocument | null | undefined) => document?.annotations.find((note) => note.id === "figure_caption")?.text ?? "";

// 1. Computed quantities draw through selection when the plan states no number in their unit.
for (const [question, family] of [
  ["Draw the Lewis structure of SF6.", "chem_lewis"],
  ["Draw the Lewis structure of NO2.", "chem_lewis"],
  ["Arrange Li, Na, K in increasing order of first ionisation energy.", "chem_periodic"],
  ["Arrange F, Cl, Br and I in increasing order of electronegativity.", "chem_periodic"],
] as const) {
  check(`computed quantities draw: ${question}`, () => {
    const result = select(question, plan(question));
    assert.equal(result.representation?.family, family, String(result.reason ?? ""));
    const sources = (result.representation?.sceneDocument.source as { slotSources?: Record<string, string> }).slotSources ?? {};
    assert.ok(Object.values(sources).length > 0 && Object.values(sources).every((value) => value === "computed"), "tagged computed, never stem");
  });
}

// 2. The plan's own numbers govern: a stated number of the same dimension, in any unit and
// under any id, refuses the computed figure. A unit nobody recognises governs everything.
const IE = "Arrange Li, Na, K in increasing order of first ionisation energy.";
const RADIUS = "Arrange Na, Mg and Al in increasing order of atomic radius.";
const EN = "Arrange F, Cl, Br and I in increasing order of electronegativity.";
const SF6 = "Draw the Lewis structure of SF6.";
for (const [label, question, id, unit, value] of [
  ["same unit", IE, "stated", "kJ/mol", 500],
  ["a plain count against counts", SF6, "stated", "", 7],
  ["nm against pm", RADIUS, "stated", "nm", 0.16],
  ["Å against pm", RADIUS, "stated", "Å", 1.6],
  ["angstrom against pm", RADIUS, "stated", "angstrom", 1.6],
  ["picometre against pm", RADIUS, "stated", "picometre", 160],
  ["J/mol against kJ/mol", IE, "stated", "J/mol", 496000],
  ["kJ mol^-1 against kJ/mol", IE, "stated", "kJ mol^-1", 496],
  ["kJ mol-1 against kJ/mol", IE, "stated", "kJ mol-1", 496],
  ["kJ mol with a Unicode minus against kJ/mol", IE, "stated", "kJ mol−1", 496],
  ["kJ·mol⁻¹ against kJ/mol", IE, "stated", "kJ·mol⁻¹", 496],
  ["kJ per mol against kJ/mol", IE, "stated", "kJ per mol", 496],
  ["kJ against kJ/mol", IE, "stated", "kJ", 496],
  ["kcal/mol against kJ/mol", IE, "stated", "kcal/mol", 118],
  ["eV against kJ/mol", IE, "stated", "eV", 5.1],
  ["another quantity id in the same dimension", IE, "first_ionisation_energy_of_sodium", "kJ/mol", 496],
  ["an unrecognised unit", IE, "stated", "kJ mol⁻¹", 496],
  ["Pauling against electronegativity", EN, "stated", "Pauling", 3.98],
  ["a plain number against electronegativity", EN, "stated", "", 3.98],
] as const) {
  check(`a plan number refuses, ${label}: ${question}`, () => {
    const givens = [{ id, symbol: "x", value, unit, provenance: "given" as const }];
    assert.equal(select(question, plan(question, givens)).representation, null);
  });
}

// A plan number of another dimension does not touch a computed value: these still draw.
for (const [label, question, unit, value, family] of [
  ["a temperature beside ionisation energies", IE, "K", 298, "chem_periodic"],
  ["a plain count beside radii", RADIUS, "", 3, "chem_periodic"],
  ["a bond length beside bond counts", SF6, "Å", 1.56, "chem_lewis"],
  ["a molar energy in kcal/mol beside bond counts", SF6, "kcal/mol", 78, "chem_lewis"],
  ["a time beside H2S, whose formula a reader could take for 2 s", "Draw the Lewis structure of H2S.", "s", 5, "chem_lewis"],
] as const) {
  check(`a plan number of another dimension still draws, ${label}: ${question}`, () => {
    const givens = [{ id: "stated", symbol: "x", value, unit, provenance: "given" as const }];
    assert.equal(select(question, plan(question, givens)).representation?.family, family);
  });
}

// The question's own stated values govern even with no plan givens: these draw on the bare
// family path, and selection refuses them. Decline only.
for (const question of [
  "The first ionisation enthalpies of Li, Na and K are 600, 450 and 350 kJ mol^-1. Arrange them in increasing order of ionisation enthalpy.",
  "The atomic radii of Li, Be, B and C are 1.52, 1.11, 0.88 and 0.77 Å. Arrange them in decreasing order of atomic radius.",
  "The electronegativities of F, Cl, Br and I are 4.0, 3.0, 2.8 and 2.5. Arrange them in increasing order of electronegativity.",
  "The electron gain enthalpies of F, Cl, Br and I are −333, −349, −325 and −296 kJ mol−1. Arrange them in order of electron gain enthalpy.",
]) {
  check(`a question that states its own values refuses with no plan givens: ${question}`, () => {
    assert.equal(synthesizeFamilyScene({ question })?.family, "chem_periodic", "the family path should draw it");
    assert.equal(select(question, plan(question)).representation, null);
  });
}

// 3. A species whose resonance forms carry different charges never draws one form alone.
check("N2O draws all its resonance forms", () => {
  const document = synthesizeFamilyScene({ question: "Draw the Lewis structure of N2O." })?.document;
  assert.deepEqual(groupIds(document).filter((id) => id.startsWith("form_")), ["form_1", "form_2", "form_3"]);
  assert.ok(!groupIds(document).includes("species_1"), "one form drawn as the species");
});
check("N2O asked which form is more stable draws all forms", () => {
  const document = synthesizeFamilyScene({ question: "Which Lewis structure of N2O is more stable?" })?.document;
  assert.ok(groupIds(document).includes("form_3") && !groupIds(document).includes("species_1"));
});
check("several species with one of unequal forms declines, and no family takes the turn", () => {
  const question = "Draw the Lewis structures of N2O and CO2.";
  const scene = synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question });
  assert.equal(scene, null, `${scene?.family ?? ""} took the turn`);
});
for (const question of ["Draw the Lewis structure of ozone O3.", "Draw the Lewis structure of the carbonate ion CO3 2-.", "Draw the Lewis structure of CO2."]) {
  check(`equal forms or none still draw one structure: ${question}`, () => {
    const document = synthesizeFamilyScene({ question })?.document;
    assert.ok(groupIds(document).includes("species_1"), "single structure");
  });
}

// A trend whose values do not all share one sign declines, and no other family takes the turn.
for (const question of [
  "Arrange the elements N, P, O and S in the order of increasing negative electron gain enthalpy.",
  "Arrange N, O, F and Ne in order of increasingly negative electron gain enthalpy.",
]) {
  check(`declines, no runner up: ${question}`, () => {
    const scene = synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question });
    assert.equal(scene, null, `${scene?.family ?? ""} took the turn`);
  });
}

// 4. An all negative trend names which way is more negative; others keep their wording.
for (const [question, title, lead] of [
  ["Arrange F, Cl, Br and I in order of increasingly negative electron gain enthalpy.", "← more negative", "ordered most negative first"],
  ["Arrange F, Cl, Br and I in decreasing order of electron gain enthalpy.", "more negative →", "ordered least negative first"],
  ["Arrange Na, Mg and Al in decreasing order of ionisation energy.", "decreasing order", "in decreasing order"],
  ["Arrange Li, Na, K in increasing order of first ionisation energy.", "increasing order", "in increasing order"],
] as const) {
  check(`trend wording: ${question}`, () => {
    const document = synthesizeFamilyScene({ question })?.document;
    assert.equal(labelText(document, "x_title"), title);
    assert.ok(caption(document).includes(lead), caption(document));
  });
}

// 5. Boards dev built and saved still pass their next resume save.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/chemistry-computed-quantities-dev-boards.json", import.meta.url), "utf8")) as {
  boards: Array<{ question: string; turnPlan: TurnPlanV3; document: SceneDocument }>;
};
for (const board of fixture.boards) {
  check(`dev's saved board resumes: ${board.question}`, () => {
    assert.equal(sceneSaveAdmissionFailure({ document: board.document, question: board.question, turnPlan: board.turnPlan, tier: "qualitative_verified" }), null);
  });
}

console.log(`verify-chemistry-computed-quantities: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
