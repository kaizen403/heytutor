/** Public source regressions: reaction operators never supply ion activities. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildElectrochemScene, cellEmf, parseCellNotation } from "../../src/chemistry/electrochemistry";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";

const rows: Array<{id: string; question: string; passed: boolean; error?: string}> = [];
function check(id: string, question: string, test: () => void): void {
  try { test(); rows.push({id, question, passed: true}); console.log(`PASS ${id}`); }
  catch (error) { rows.push({id, question, passed: false, error: String(error)}); console.error(`FAIL ${id}: ${error}`); }
}
function near(actual: unknown, expected: number): void {
  assert.ok(typeof actual === "number" && Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= Math.max(Math.abs(expected) * 1e-10, 1e-14), `${actual} != ${expected}`);
}
function compiled(document: SceneDocument | null): SceneDocument {
  assert.ok(document, "source-grounded cell declined");
  const valid = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  assert.ok(valid.document, JSON.stringify(valid.report.issues));
  const result = compileSceneDocument(valid.document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.ok(result.renderScene.primitives.length > 0, "cell must draw");
  assert.ok(!result.renderScene.primitives.some(mark => /NaN|Infinity/.test(mark.text ?? "")));
  return document;
}
function quantities(document: SceneDocument, nonstandard: boolean): void {
  const standard = document.quantities.find(quantity => quantity.id === "E0_cell");
  near(standard?.value, 1.1); assert.equal(standard?.unit, "V");
  near(document.quantities.find(quantity => quantity.id === "n_electrons")?.value, 2);
  const gibbs = document.quantities.find(quantity => quantity.id === "dG0");
  near(gibbs?.value, -212.3); assert.equal(gibbs?.unit, "kJ/mol");
  const observed = document.quantities.find(quantity => quantity.id === "E_cell");
  if (nonstandard) { near(observed?.value, 1.0705); assert.equal(observed?.unit, "V"); }
  else assert.equal(observed, undefined, "bare reaction must not create a concentration or observed emf");
}
function positive(question: string, nonstandard = false): void {
  const spec = parseCellNotation(question); assert.ok(spec, "complete reaction must not be an unread activity");
  assert.equal(spec.anode.couple, "Zn2+/Zn"); assert.equal(spec.cathode.couple, "Cu2+/Cu");
  near(spec.temperatureK, 298); near(spec.statedE0, 1.1);
  assert.equal(spec.statedE, undefined, "standard emf remains standard");
  const emf = cellEmf(spec); assert.ok(emf); near(emf.e0, 1.1); near(emf.n, 2); near(emf.dG0kJ, -212.3);
  if (nonstandard) {
    near(spec.anode.concentrations["Zn2+"], .1); near(spec.cathode.concentrations["Cu2+"], .01);
    near(emf.q, 10); near(emf.factor, .0591); near(emf.e, 1.0705);
  } else {
    assert.deepEqual(spec.anode.concentrations, {}); assert.deepEqual(spec.cathode.concentrations, {});
    assert.equal(emf.e, null); assert.equal(emf.q, undefined);
  }
  quantities(compiled(buildElectrochemScene(question, [], false)), nonstandard);
  quantities(compiled(buildElectrochemScene(question, [], true)), nonstandard);
  const ordinary = synthesizeFamilyScene({question});
  assert.ok(ordinary?.renderScene, "ordinary compiler must draw the cell"); assert.equal(ordinary.family, "chem_electrochem");
  quantities(compiled(ordinary.document), nonstandard);
}
function declined(question: string): void {
  assert.equal(parseCellNotation(question), null, "supplied unread activity must not reach default 1 M");
  assert.equal(buildElectrochemScene(question, [], false), null);
  assert.equal(buildElectrochemScene(question, [], true), null, "schematic must preserve supplied-value refusal");
  assert.equal(synthesizeFamilyScene({question}), null, "ordinary compiler must preserve supplied-value refusal");
}

const publicQuestion = "The standard emf of the Daniell cell is 1.1 V. Calculate the standard Gibbs energy change and the equilibrium constant at 298 K for the cell reaction Zn(s) + Cu^2+(aq) → Zn^2+(aq) + Cu(s). (F = 96500 C mol^-1, R = 8.314 J K^-1 mol^-1)";
check("current public Daniell reaction: exact supplied F/R, standard emf and Gibbs quantity", publicQuestion, () => positive(publicQuestion));

const header = "Draw a Daniell cell. The standard emf is 1.1 V. At 298 K. ";
const reaction = "Cell reaction: Zn(s) + Cu2+(aq) → Zn2+(aq) + Cu(s).";
const reactions = [
  "Cell reaction: Zn(s) + Cu2+(aq) -> Zn2+(aq) + Cu(s).",
  "Cell reaction: Zn(s) + Cu²⁺(aq) → Zn²⁺(aq) + Cu(s).",
  "Cell reaction: 1 Zn(s) + 1 Cu2+(aq) ⇌ 1 Zn2+(aq) + 1 Cu(s).",
  "Cell reaction: Zn + Cu2+ → Zn2+ + Cu.",
  "Cell reaction: Zn(s) + Cu^(2+)(aq) ⟶ Zn^(2+)(aq) + Cu(s).",
];
reactions.forEach((text, index) => {
  const question = header + text;
  check(`bare original products/operators/charges ${index + 1}`, question, () => positive(question));
});

const halfReactions = [
  "Half reactions: Zn(s) → Zn2+(aq) + 2e-; Cu2+(aq) + 2e- → Cu(s).",
  "Half reactions: Zn(s) -> Zn2+(aq) + 2e^-; Cu2+(aq) + 2e^- -> Cu(s).",
  "Half reactions: Zn(s) → Zn²⁺(aq) + 2e⁻; Cu²⁺(aq) + 2e⁻ → Cu(s).",
  "Half reactions: Zn(s) → 2 e- + Zn2+(aq); 2 e- + Cu2+(aq) → Cu(s).",
  "Half reactions: Zn -> Zn2+ + 2e-; Cu2+ + 2e- -> Cu.",
];
halfReactions.forEach((text, index) => {
  const question = header + text;
  check(`complete half-reaction electron/coefficient owners ${index + 1}`, question, () => positive(question));
});

const activities = [
  "Zn2+ concentration is 0.1 M; Cu2+ concentration is 0.01 M.",
  "[Zn2+] = 0.1 M; [Cu2+] = 0.01 M.",
  "Zn2+(0.1 M); Cu2+(0.01 M).",
  "0.1 M Zn2+; 0.01 M Cu2+.",
  "Zn2+ concentration is +0.1 M; Zn2+ concentration is 0.1 M; Cu2+ = 0.01 M.",
  "Zn2+ concentration is 0.1 molar; Cu2+ concentration is 0.01 mol L-1.",
];
activities.forEach((text, index) => {
  const question = header + text + " " + reaction;
  check(`actual activities remain independent beside a bare reaction ${index + 1}`, question, () => positive(question, true));
});

for (const [index, owner] of ["concentration is", "activity is", "is", "=", ":"].entries()) {
  for (const [kind, material] of [["product", "+ Cu(s)"], ["electron", "+2e- -> Zn"]] as const) {
    const question = header + `Zn2+ ${owner} ${material}; Zn2+ concentration is 0.1 M; Cu2+ = 0.01 M. ` + reaction;
    check(`explicit ${kind} material cannot masquerade as bare reaction owner ${index + 1}`, question, () => declined(question));
  }
}

const damagedActivities = [
  "Zn2+ concentration is unknown M; Zn2+ concentration is 0.1 M; Cu2+ = 0.01 M.",
  "Zn2+ concentration is 0.1 M; Zn2+ concentration is unreadable; Cu2+ = 0.01 M.",
  "Zn2+ concentration is 0.1 M; Zn2+ concentration is 0.2 M; Cu2+ = 0.01 M.",
  "Zn2+ concentration is 0.1 kg; Zn2+ concentration is 0.1 M; Cu2+ = 0.01 M.",
  "Zn2+ concentration is 1e- M; Zn2+ concentration is 0.1 M; Cu2+ = 0.01 M.",
];
damagedActivities.forEach((text, index) => {
  const question = header + text + " " + reaction;
  check(`unread/conflicting genuine activity survives reaction exemption ${index + 1}`, question, () => declined(question));
});

const incompleteReactions = [
  "Cell reaction: Zn2+ + Xx(s) → Zn(s).",
  "Cell reaction: Zn2+ + Cu(s).",
  "Cell reaction: Zn2+ + unknown → Zn(s).",
  "Cell reaction: Zn2+ + Cu(s) → Xx(s).",
  "Cell reaction: Zn2+(aq)x + Cu(s) → Zn(s).",
  "Cell reaction: Zn2+ + Cu(s) → Zn(s) + unknown.",
];
incompleteReactions.forEach((text, index) => {
  const question = header + text;
  check(`incomplete or invalid original reaction cannot hide activity material ${index + 1}`, question, () => declined(question));
});

const incompatibleReactions = [
  "Cell reaction: Zn(s) + 2 Ag+(aq) → Zn2+(aq) + 2 Ag(s).",
  "Cell reaction: Mg(s) + Cu2+(aq) → Mg2+(aq) + Cu(s).",
  "Cell reaction: Fe(s) + Cu2+(aq) → Fe2+(aq) + Cu(s).",
  "Cell reaction: Zn(s) + Ni2+(aq) → Zn2+(aq) + Ni(s).",
  "Half reaction: Ag+(aq) + e- → Ag(s).",
];
incompatibleReactions.forEach((text, index) => {
  const question = header + text;
  check(`named cell cannot replace incompatible original reaction species ${index + 1}`, question, () => declined(question));
  const genericQuestion = "Draw a galvanic cell with its salt bridge. It is a Daniell cell. The standard emf is 1.1 V. At 298 K. " + text;
  check(`incompatible named reaction cannot escape through generic schematic ${index + 1}`, genericQuestion, () => declined(genericQuestion));
});

const reversedReactions = [
  "Cell reaction: Cu(s) + Zn2+(aq) → Cu2+(aq) + Zn(s).",
  "Cell reaction: Cu + Zn2+ -> Cu2+ + Zn.",
  "Cell reaction: Cu(s) + Zn²⁺(aq) ⟶ Cu²⁺(aq) + Zn(s).",
  "Cell reaction: 1 Cu(s) + 1 Zn2+(aq) → 1 Cu2+(aq) + 1 Zn(s).",
  "Cell reaction: Zn2+(aq) + Cu(s) → Zn(s) + Cu2+(aq).",
];
const scaledReactions = [
  "Cell reaction: 2 Zn(s) + 2 Cu2+(aq) → 2 Zn2+(aq) + 2 Cu(s).",
  "Cell reaction: 3 Zn + 3 Cu2+ -> 3 Zn2+ + 3 Cu.",
  "Cell reaction: 4 Zn(s) + 4 Cu²⁺(aq) ⟶ 4 Zn²⁺(aq) + 4 Cu(s).",
  "Cell reaction: 2 Cu2+(aq) + 2 Zn(s) → 2 Cu(s) + 2 Zn2+(aq).",
  "Half reaction: 2 Zn(s) → 2 Zn2+(aq) + 4e-.",
];
const unbalancedReactions = [
  "Cell reaction: Zn(s) + Cu2+(aq) → 2 Zn2+(aq) + Cu(s).",
  "Cell reaction: 2 Zn(s) + Cu2+(aq) → Zn2+(aq) + Cu(s).",
  "Cell reaction: Zn(s) + 2 Cu²⁺(aq) → Zn²⁺(aq) + Cu(s).",
  "Cell reaction: Zn(s) + Cu2+(aq) -> Zn2+(aq) + 2 Cu(s).",
  "Half reaction: Cu2+(aq) + e- → Cu(s).",
];
for (const [kind, examples] of [["reversed", reversedReactions], ["scaled", scaledReactions], ["unbalanced", unbalancedReactions]] as const) {
  examples.forEach((text, index) => {
    const question = header + text;
    check(`${kind} original reaction cannot retain stock positive emf/electron/Gibbs quantities ${index + 1}`, question, () => declined(question));
  });
}

const standardHalfReactions = [
  "Zn2+(aq) + 2e- → Zn(s), E° = -0.76 V; Cu2+(aq) + 2e- → Cu(s), E° = 0.34 V.",
  "Zn2+ + 2e- -> Zn, E° = -0.76 V; Cu2+ + 2e- -> Cu, E° = 0.34 V.",
  "Zn²⁺ + 2 e⁻ → Zn; E° = -0.76 V; Cu²⁺ + 2 e⁻ → Cu; E° = 0.34 V.",
  "Zn²⁺ + 2 e- → Zn; E° = -0.76 V; Cu²⁺ + 2 e- → Cu; E° = 0.34 V.",
  "Zn2+ + 2 e^- → Zn; E° = -0.76 V; Cu2+ + 2 e^- → Cu; E° = 0.34 V.",
];
standardHalfReactions.forEach((text, index) => {
  const question = header + text;
  check(`validated adjacent E° half-reaction role remains separate from cell direction ${index + 1}`, question, () => positive(question));
});

const summary = {total: rows.length, passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows};
const outIndex = process.argv.indexOf("--out");
if (outIndex >= 0 && process.argv[outIndex + 1]) writeFileSync(process.argv[outIndex + 1]!, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({total: summary.total, passed: summary.passed, failed: summary.failed}));
if (summary.failed) process.exitCode = 1;
