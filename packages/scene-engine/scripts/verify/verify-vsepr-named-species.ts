/**
 * VSEPR reads a chemical name through the shared name authority, inside a
 * molecular shape frame only.
 *
 *   positives  "why is water bent", "sp3 hybridisation in methane": the
 *              VSEPR figure of the named molecule, read as chemistry
 *   declines   multi-centre names (ethane, ethene, ethyne, acetylene,
 *              hydrazine, hydrogen peroxide) never become a one-centre shape
 *   controls   physics and maths stems that name water, methane or ammonia
 *              stay out of chemistry; organic and Lewis structure asks keep
 *              their family; a request that also writes formulas keeps the
 *              alias contract
 *   mutation   two mutant frame readers (every name, and no name) must turn
 *              the frame checks red, so the controls and positives are live
 */
import assert from "node:assert/strict";
import "../../src/chemistry/families";
import { isChemistryStem } from "../../src/chemistry/classify";
import { namedSpeciesMentions, type NamedSpeciesMention } from "../../src/chemistry/namedSpecies";
import { inferChemistryFamilies, isChemistryQuestion } from "../../src/chemistry/router";
import { vseprSpecies } from "../../src/chemistry/vsepr";
import { framedNamedSpecies } from "../../src/chemistry/vseprNamedSpecies";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

type Framer = (text: string) => NamedSpeciesMention[];

const POSITIVES: ReadonlyArray<{ question: string; formulas: string[]; labels: string[] }> = [
  { question: "why is water bent", formulas: ["H2O"], labels: ["H_2O", "sp^3", "bent"] },
  { question: "sp3 hybridisation in methane", formulas: ["CH4"], labels: ["CH_4", "sp^3", "tetrahedral"] },
  { question: "shape of ammonia", formulas: ["NH3"], labels: ["NH_3", "trig. pyramidal"] },
  { question: "hybridisation of carbon in methane", formulas: ["CH4"], labels: ["CH_4", "sp^3"] },
  { question: "hybridisation of oxygen in water", formulas: ["H2O"], labels: ["H_2O", "sp^3"] },
  { question: "Explain why carbon dioxide is linear.", formulas: ["CO2"], labels: ["CO_2", "sp", "linear"] },
  { question: "What is the geometry of boron trifluoride?", formulas: ["BF3"], labels: ["BF_3", "sp^2", "trig. planar"] },
  { question: "Why does ammonia have a pyramidal shape?", formulas: ["NH3"], labels: ["NH_3", "trig. pyramidal"] },
  { question: "What is the bond angle in water?", formulas: ["H2O"], labels: ["H_2O", "104.5°"] },
  { question: "Compare the shapes of water and ammonia.", formulas: ["H2O", "NH3"], labels: ["H_2O", "NH_3"] },
  { question: "The shape of the water molecule", formulas: ["H2O"], labels: ["H_2O", "bent"] },
];

/** Multi-centre or unsupported names: no single-centre VSEPR figure. */
const DECLINES = [
  "hybridisation of carbon in ethane",
  "shape of ethene",
  "hybridisation of carbon in ethyne",
  "hybridisation of carbon in acetylene",
  "shape of hydrazine",
  "geometry of hydrogen peroxide",
  "Show the shapes of water and SF4.",
  "Explain the molecular shapes of HCN and water.",
];

/** Physics and maths stems that name the species: never chemistry, never a frame. */
const NOT_CHEMISTRY = [
  "Water flows through a horizontal pipe of diameter 4 cm at 2 m/s. Find the pressure drop.",
  "How much heat is needed to raise the temperature of 2 kg of water from 20 C to 80 C?",
  "A bucket of water is rotated in a vertical circle of radius 1 m. Find the minimum speed at the top.",
  "What is the shape of the water surface in a vessel rotating about its vertical axis?",
  "Find the angle of a water jet leaving a hose at 10 m/s so that it reaches 5 m.",
  "A bent tube contains water. Find the pressure at the bend 20 cm below the surface.",
  "A cylinder holds ammonia gas at a pressure of 3 atm and 300 K. Find the pressure at 450 K at constant volume.",
  "The density of water is 1000 kg/m3. Find the buoyant force on a 2 m3 block fully submerged.",
  "A water molecule has a dipole moment of 6.2 x 10^-30 C m. Find the maximum torque in a field of 10^5 N/C.",
  "what is the shape of a water droplet",
];

/** Stems already chemistry on main for other reasons: still no VSEPR frame or figure. */
const OTHER_CHEMISTRY_NO_FRAME = [
  "Methane is used as a fuel. If 1 kg of methane releases 55 MJ, how much energy do 3 kg release?",
  "Find the geometry of the region where water flows",
];

/** Structure asks keep their family. */
const STRUCTURE_ASKS: ReadonlyArray<[string, string]> = [
  ["structure of methane", "chem_organic"],
  ["draw methane", "chem_organic"],
  ["draw the structure of ethanol", "chem_organic"],
  ["lewis dot structure of ammonia", "chem_lewis"],
];

const FRAME_POSITIVES = POSITIVES.map((row) => row.question);
const FRAME_CONTROLS = [...NOT_CHEMISTRY, ...OTHER_CHEMISTRY_NO_FRAME, ...STRUCTURE_ASKS.map(([question]) => question)];

interface Row { id: string; passed: boolean; error: string | null }

function frameChecks(framer: Framer): Row[] {
  const rows: Row[] = [];
  const check = (id: string, test: () => void) => {
    try { test(); rows.push({ id, passed: true, error: null }); }
    catch (error) { rows.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }); }
  };
  for (const question of FRAME_POSITIVES) {
    check(`frame/positive/${question}`, () => assert.ok(framer(question).length > 0, "a shape frame must own the name"));
  }
  for (const question of FRAME_CONTROLS) {
    check(`frame/control/${question}`, () => assert.deepEqual(framer(question), [], "no shape frame owns this name"));
  }
  return rows;
}

function labelsOf(question: string): string[] {
  const scene = synthesizeFamilyScene({ question });
  return scene ? scene.renderScene.primitives.filter((p) => p.kind === "label" && p.text).map((p) => p.text!) : [];
}

const rows: Row[] = frameChecks(framedNamedSpecies);
function check(id: string, test: () => void): void {
  try { test(); rows.push({ id, passed: true, error: null }); }
  catch (error) { rows.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}

for (const row of POSITIVES) {
  check(`positive/${row.question}`, () => {
    assert.deepEqual(vseprSpecies(row.question).map((item) => item.formula).sort(), [...row.formulas].sort());
    assert.ok(isChemistryStem(row.question), "a named species in a shape frame is chemistry subject evidence");
    assert.ok(isChemistryQuestion(row.question));
    assert.equal(inferChemistryFamilies(row.question)[0], "chem_vsepr");
    const scene = synthesizeFamilyScene({ question: row.question });
    assert.equal(scene?.family, "chem_vsepr");
    assert.equal(scene?.document.source.chemistryFamily, "chem_vsepr");
    const labels = labelsOf(row.question);
    for (const label of row.labels) assert.ok(labels.includes(label), `missing ${label} in ${labels.join(" | ")}`);
  });
}
for (const question of DECLINES) {
  check(`decline/${question}`, () => {
    assert.deepEqual(vseprSpecies(question), []);
    assert.ok(!inferChemistryFamilies(question).includes("chem_vsepr"));
    assert.notEqual(synthesizeFamilyScene({ question })?.family, "chem_vsepr");
  });
}
for (const question of NOT_CHEMISTRY) {
  check(`control/not-chemistry/${question}`, () => {
    assert.equal(isChemistryQuestion(question), false);
    assert.deepEqual(inferChemistryFamilies(question), []);
    assert.deepEqual(vseprSpecies(question), []);
  });
}
for (const question of OTHER_CHEMISTRY_NO_FRAME) {
  check(`control/no-frame/${question}`, () => {
    assert.deepEqual(vseprSpecies(question), []);
    assert.ok(!inferChemistryFamilies(question).includes("chem_vsepr"));
  });
}
for (const [question, family] of STRUCTURE_ASKS) {
  check(`control/structure/${question}`, () => {
    assert.ok(!inferChemistryFamilies(question).includes("chem_vsepr"));
    assert.equal(synthesizeFamilyScene({ question })?.family, family);
  });
}

// Mutation: a reader that owns every name (the naive fix) must fail the
// controls, and one that owns none (main before this gate) the positives.
const mutants: ReadonlyArray<[string, Framer, string]> = [
  ["every-name", (text) => namedSpeciesMentions(text.toLowerCase()), "frame/control/"],
  ["no-name", () => [], "frame/positive/"],
];
for (const [name, framer, mustFail] of mutants) {
  const mutated = frameChecks(framer);
  const red = mutated.filter((row) => !row.passed);
  check(`mutation/${name}`, () => {
    assert.ok(red.length > 0, "the mutant must turn the gate red");
    assert.ok(red.every((row) => row.id.startsWith(mustFail)), `only ${mustFail} rows go red`);
    assert.ok(red.length >= (mustFail === "frame/positive/" ? FRAME_POSITIVES.length : 5), `too few red rows: ${red.length}`);
  });
}

for (const row of rows) if (!row.passed) console.log(`FAIL ${row.id}: ${row.error}`);
const failed = rows.filter((row) => !row.passed).length;
console.log(`verify-vsepr-named-species: ${rows.length - failed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
