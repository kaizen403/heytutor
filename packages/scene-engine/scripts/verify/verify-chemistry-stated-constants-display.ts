/** Finite next-PR source gates: stated potentials, dissociation aliases and display precision. */
import assert from "node:assert/strict";
import { parseCellNotation, cellEmf, buildElectrochemScene } from "../../src/chemistry/electrochemistry";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { buildSolutionLessonScene } from "../../src/chemistry/solutionProperties";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";
let passed = 0; const failed: string[] = [];
function check(name: string, run: () => void): void {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed.push(name); console.error(`FAIL ${name}: ${error}`); }
}
function near(actual: unknown, expected: number): void {
  assert.ok(typeof actual === "number" && Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) < Math.max(1e-12, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
}
function compiled(document: SceneDocument | null, family: string) {
  assert.ok(document, "family declined"); assert.equal(document.source?.chemistryFamily, family);
  const valid = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  assert.ok(valid.document, JSON.stringify(valid.report.issues));
  const result = compileSceneDocument(valid.document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const labels = result.renderScene.primitives.flatMap(p => p.kind === "label" && p.text ? [p.text] : []);
  return { labels, text: [...labels, ...document.annotations.map(a => a.text ?? "")].join("\n"), document };
}
const cell = "Calculate the emf and draw the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. ";
const electrodeWordings = [
  "The standard electrode potential of zinc is −0.80 V and that of copper is +0.40 V.",
  "Reduction potential of Zn2+/Zn is -0.80 V and that of Cu2+/Cu is 0.40 V.",
  "E° values: Zn2+/Zn, −0.80 V; Cu2+/Cu, +0.40 V.",
  "E°Zn = −0.80 V and E°Cu = +0.40 V.",
  "The electrode potentials are −0.80 V for zinc and +0.40 V for copper.",
  "The standard reduction potentials are Zn = -0.80 V, Cu = +0.40 V.",
  "E°(zinc) was measured as −0.80 V; E°(copper) was measured as +0.40 V.",
  "The Cu2+/Cu standard potential comes to +0.40 V and the Zn2+/Zn standard potential comes to -0.80 V.",
  "For copper the reduction potential is +0.40 V; for zinc it is -0.80 V.",
  "The oxidation potential of zinc is +0.80 V; the reduction potential of copper is +0.40 V.",
  "The standard reduction potential for Cu²⁺/Cu equals +0.40 V while that for Zn²⁺/Zn equals -0.80 V.",
  "Electrode potentials: -0.80 V (Zn2+/Zn); +0.40 V (Cu2+/Cu).",
];
for (const [index, wording] of electrodeWordings.entries()) check(`electrode-owned-${index}`, () => {
  const question = cell + wording; const spec = parseCellNotation(question); assert.ok(spec, "owned source values must be supported");
  near(spec.anode.e0, -.8); near(spec.cathode.e0, .4);
  assert.equal(spec.anode.potentialSource, "stem"); assert.equal(spec.cathode.potentialSource, "stem");
  assert.equal(spec.statedE, undefined, "electrode potential is not observed emf");
  near(cellEmf(spec)?.e0, 1.2);
  const computedEmf = cellEmf(spec)?.e;
  assert.ok(typeof computedEmf === "number" && Number.isFinite(computedEmf), "finite computed emf required");
  assert.ok(Math.abs(computedEmf - 1.17045) <= .000051, "existing four-decimal emf precision");
  for (const half of [spec.anode, spec.cathode]) {
    assert.ok(half.potentialSourceSpan);
    assert.equal(question.slice(half.potentialSourceSpan.start, half.potentialSourceSpan.end), half.potentialSourceText);
    assert.match(half.potentialSourceText!, /V$/);
  }
  const result = compiled(buildElectrochemScene(question, [], false), "chem_electrochem");
  near(result.document.quantities.find(q => q.id === "E0_cell")?.value, 1.2);
  assert.ok(!result.text.includes("0.34 − (−0.76)"), "table values cannot replace source potentials");
});
for (const [index, wording] of [
  "Standard electrode potentials: Zn2+/Zn = unknown; Cu2+/Cu = +0.40 V.",
  "Standard electrode potentials: zinc = -0.80 V; copper = 1e- V.",
  "Standard electrode potentials: zinc = -800 mV; copper = +400 mV.",
  "Standard electrode potentials: -0.80 V and +0.40 V.",
  "Standard electrode potentials: Zn2+/Zn = -0.80 V; Cu2+/Cu = +0.40 V; Zn2+/Zn = -0.90 V.",
  "Standard electrode potentials: zinc and copper = -0.80 V.",
  "Standard electrode potential of zinc is –0.80 V and that of copper is +0.40 V.",
].entries()) check(`electrode-unread-or-ambiguous-${index}`, () => {
  assert.equal(parseCellNotation(cell + wording), null); assert.equal(buildElectrochemScene(cell + wording, [], false), null);
});
// Frozen source-review counterexample and generic same-element role controls.
for (const [index, question] of [
  "Draw the cell Fe|Fe2+||Fe3+,Fe2+|Pt. The standard electrode potential of iron is −0.80 V.",
  "Draw the cell Pt|Fe2+,Fe3+||Fe2+|Fe. E°Fe = -0.80 V.",
  "Draw the cell Cu|Cu+||Cu2+|Cu. The standard electrode potential of copper is +0.40 V.",
  "Draw the cell Fe|Fe2+||Fe3+,Fe2+|Pt. E°(Fe3+/Fe2+) = -0.80 V; the standard electrode potential of iron is -0.80 V.",
].entries()) check(`named-element-distinct-couples-${index}`, () => {
  assert.equal(parseCellNotation(question), null, "one named literal cannot specify two distinct redox couples");
  assert.equal(buildElectrochemScene(question, [], false), null);
  assert.equal(buildElectrochemScene(question, [], true), null);
});
check("same-element-explicit-couple-roles", () => {
  const question = "Draw the cell Fe|Fe2+||Fe3+,Fe2+|Pt. E°(Fe2+/Fe) = -0.80 V; E°(Fe3+/Fe2+) = +0.40 V.";
  const spec = parseCellNotation(question); assert.ok(spec);
  assert.notEqual(spec.anode.couple, spec.cathode.couple);
  near(spec.anode.e0, -.8); near(spec.cathode.e0, .4);
  assert.equal(spec.anode.potentialSource, "stem"); assert.equal(spec.cathode.potentialSource, "stem");
  assert.notDeepEqual(spec.anode.potentialSourceSpan, spec.cathode.potentialSourceSpan);
  near(cellEmf(spec)?.e0, 1.2);
  compiled(buildElectrochemScene(question, [], false), "chem_electrochem");
});
// Charge parentheses belong to the ion; the outer couple wrapper stays separate.
for (const [index, declaration] of [
  "E°(Fe^2+/Fe) = -0.80 V; E°(Fe^3+/Fe^2+) = +0.40 V.",
  "E°(Fe(2+)/Fe) = -0.80 V; E°(Fe(3+)/Fe(2+)) = +0.40 V.",
  "E°(Fe^(2+)/Fe) = -0.80 V; E°(Fe^(3+)/Fe^(2+)) = +0.40 V.",
].entries()) check(`same-element-balanced-charge-${index}`, () => {
  const question = "Draw the cell Fe|Fe2+||Fe3+,Fe2+|Pt. " + declaration;
  const spec = parseCellNotation(question); assert.ok(spec);
  near(spec.anode.e0, -.8); near(spec.cathode.e0, .4); near(cellEmf(spec)?.e0, 1.2);
  assert.equal(spec.anode.potentialSource, "stem"); assert.equal(spec.cathode.potentialSource, "stem");
  for (const half of [spec.anode, spec.cathode]) {
    assert.ok(half.potentialSourceSpan);
    assert.equal(question.slice(half.potentialSourceSpan.start, half.potentialSourceSpan.end), half.potentialSourceText);
  }
  compiled(buildElectrochemScene(question, [], false), "chem_electrochem");
});
check("broken-charge-parenthesis-declines", () => {
  const question = "Draw the cell Fe|Fe2+||Fe3+,Fe2+|Pt. E°(Fe^(2+/Fe) = -0.80 V; E°(Fe3+/Fe2+) = +0.40 V.";
  assert.equal(parseCellNotation(question), null);
  assert.equal(buildElectrochemScene(question, [], false), null);
});
check("same-couple-reuses-one-named-standard-role", () => {
  // Standard-potential ownership only: no concentration-cell emf is certified.
  const question = "Draw a concentration cell Fe|Fe2+||Fe2+|Fe. The standard electrode potential of iron is -0.80 V.";
  const spec = parseCellNotation(question); assert.ok(spec);
  assert.equal(spec.anode.couple, spec.cathode.couple);
  near(spec.anode.e0, -.8); near(spec.cathode.e0, -.8); near(cellEmf(spec)?.e0, 0);
  assert.equal(spec.anode.potentialSource, "stem"); assert.equal(spec.cathode.potentialSource, "stem");
  assert.deepEqual(spec.anode.potentialSourceSpan, spec.cathode.potentialSourceSpan);
});
check("electrode-stock-control", () => {
  const stock = parseCellNotation(cell); assert.ok(stock); near(cellEmf(stock)?.e0, 1.1);
});
check("electrode-observed-control", () => {
  const sourced = parseCellNotation(cell + "E°(Zn2+/Zn) = -0.8 V; E°(Cu2+/Cu) = 0.4 V; measured cell emf is 1.15 V.");
  assert.ok(sourced); near(sourced.statedE, 1.15); near(cellEmf(sourced)?.e0, 1.2);
});
check("electrode-standard-cell-control", () => {
  const question = cell + "E_cell^0 = 1.20 V.";
  const standard = parseCellNotation(question);
  if (!standard) assert.equal(buildElectrochemScene(question, [], false), null);
  else { near(cellEmf(standard)?.e0, 1.2); assert.equal(standard.statedE, undefined); }
});
const acid = "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. ";
const base = "50 mL of 0.1 M NH3 is titrated with 0.1 M HCl. ";
for (const [index, declaration] of [
  "Kₐ = 1 × 10^-5", "K(a) = 1e-5", "pKₐ = 5.0", "pK(a) is 5", "Kᵃ = 1e-5",
  "The acidity constant of acetic acid is 1 × 10^-5", "Acid ionization constant for CH3COOH = 1e-5",
].entries()) check(`acid-alias-${index}`, () => {
  const result = compiled(buildSolutionsGraphScene(acid + declaration + ". Draw the pH curve.", [], false), "chem_solutions");
  assert.ok(result.labels.includes("pH = pK_a = 5"), JSON.stringify(result.labels)); assert.ok(!result.text.includes("pK_a = 4.76"));
});
for (const [index, declaration] of [
  "Kᵦ = 1 × 10^-5", "K(b) = 1e-5", "pKᵦ = 5.0", "pK(b) = 5", "Kᵇ = 1e-5", "The basicity constant of ammonia is 1e-5", "Base dissociation constant for NH3 = 1e-5",
].entries()) check(`base-alias-${index}`, () => {
  const result = compiled(buildSolutionsGraphScene(base + declaration + ". Draw the pH curve.", [], false), "chem_solutions");
  assert.match(result.text, /pOH = pKb = 5, pH 9/); assert.ok(!result.text.includes("pKb = 4.75"));
});
for (const [index, declaration] of [
  "Kₐ = unknown", "K(a) = 1e-", "pKₐ = 5 M", "Kₐ(HF) = 1e-5", "Kᵦ = 1e-5", "Kₐ = 1e-5; pK(a) = 6", "Kₐ = unknown; Ka = 1e-5", "The acidity constant of formic acid is 1e-5",
].entries()) check(`acid-alias-unread-or-wrong-owner-${index}`, () => {
  assert.equal(buildSolutionsGraphScene(acid + declaration + ". Draw the pH curve.", [], false), null);
});
for (const [index, constant, pressure, concentration] of [
  [0, "3.4 × 10^-3", "2.5", "0.0085"], [1, "1.3 × 10^-3", "0.21", "2.73e-4"], [2, "1.3 × 10^-3", "4.6", "0.00598"], [3, "4.5e-3", "1", "0.0045"],
  [4, "9.9e-3", "1", "0.0099"], [5, "0.00101", "1", "0.00101"], [6, "0.000999", "1", "9.99e-4"], [7, "2.7e-3", "3", "0.0081"],
] as const) check(`henry-small-significant-${index}`, () => {
  const result = compiled(buildSolutionLessonScene(`Using c = kH p with kH = ${constant} mol/(L atm) for CO2 in water, find its dissolved concentration at partial pressure ${pressure} atm.`, [], false), "chem_solutions");
  assert.ok(result.labels.includes(`c=${concentration} mol/L`), JSON.stringify(result.labels));
  const expectedConstant = ["0.0034", "0.0013", "0.0013", "0.0045", "0.0099", "0.00101", "9.99e-4", "0.0027"][index];
  assert.ok(result.text.includes(`c = ${expectedConstant} × ${pressure} = ${concentration}`), result.text);
});
for (const [index, fraction, pressure] of [[0, ".0045", "0.81"], [1, ".0013", "0.234"], [2, ".0099", "1.782"], [3, ".00045", "0.081"], [4, ".00598", "1.076"]] as const) check(`henry-mole-fraction-${index}`, () => {
  const result = compiled(buildSolutionLessonScene(`Show Henry's law p = kH x for kH = 180 atm and x = ${fraction}.`, [], false), "chem_solutions");
  const fractionDisplay = index === 3 ? "4.5e-4" : String(Number(fraction));
  assert.ok(result.labels.includes(`x=${fractionDisplay}`), JSON.stringify(result.labels)); assert.ok(result.labels.includes(`p=${pressure} atm`), JSON.stringify(result.labels));
});
check("component-mole-fraction-caption", () => {
  const result = compiled(buildSolutionLessonScene("Find the mole fractions in a mixture of 0.0045 mol of A and 0.9955 mol of B.", [], false), "chem_solutions");
  assert.ok(result.labels.includes("xA=0.0045")); assert.ok(result.text.includes("= 0.0045 and"));
});
console.log(JSON.stringify({ passed, failed: failed.length, failures: failed, scope: "offline source only; three next-PR non-regressions" }));
process.exitCode = failed.length ? 1 : 0;
