/**
 * The mass on an electrolytic cell comes from the student's own numbers. A stated
 * molar mass wins over the element table, a stem stating none keeps the table, and
 * anything the reader cannot own leaves the cell with no mass at all. It used to
 * print 1.19 g for "Cu = 63.5 g/mol" (1.18 g) and the same for 80% efficiency.
 *
 *   tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-chemistry-stated-deposit-mass.ts
 */
import assert from "node:assert/strict";
import "../../src/chemistry/families";
import { elementBySymbol } from "../../src/chemistry/elements";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

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

const labelsOf = (question: string): string[] | null => {
  const scene = synthesizeFamilyScene({ question });
  if (!scene || scene.family !== "chem_electrochem") return null;
  return scene.renderScene.primitives.filter((p) => p.kind === "label" && p.text).map((p) => p.text!);
};
const massLabels = (labels: readonly string[]) => labels.filter((text) => /^(?:m\()?[A-Z][a-z]?\)?(?::|=)\s*[\d.]+\s*g$/.test(text));

/** The law, worked here from the fixture's values, never from the figure. */
function expectedMass(metal: string, electrons: number, ampere: number, seconds: number, molarMass?: number, faraday = 96500): string {
  const grams = (molarMass ?? elementBySymbol(metal)!.mass) * ampere * seconds / (electrons * faraday);
  return `${metal}: ${Number(grams.toPrecision(3))} g`;
}

const COPPER = "Aqueous CuSO4 is electrolysed by a 2.0 A current for 30 minutes.";
const ASK = "Find the mass of copper deposited.";

// A stated value with its unit wins. Worked values are 1.18 g, where the table's 63.546 gave 1.19 g.
for (const [question, label] of [
  [`${COPPER} Cu = 63.5 g mol^-1 and F = 96500 C mol^-1. ${ASK}`, expectedMass("Cu", 2, 2, 1800, 63.5)],
  [`${COPPER} Cu = 63.5 g/mol. ${ASK}`, expectedMass("Cu", 2, 2, 1800, 63.5)],
  [`${COPPER} Molar mass of copper is 63.5 g/mol. Find the mass deposited of copper.`, expectedMass("Cu", 2, 2, 1800, 63.5)],
  [`${COPPER} Molar mass of Cu is 64 g/mol. ${ASK}`, expectedMass("Cu", 2, 2, 1800, 64)],
  ["Aqueous AgNO3 is electrolysed by a current of 0.5 A for 10 minutes. Ag = 108 g/mol. Find the mass of silver deposited.", expectedMass("Ag", 1, 0.5, 600, 108)],
] as const) {
  check(`stated value wins: ${question}`, () => assert.deepEqual(massLabels(labelsOf(question) ?? []), [label]));
}
check("the stated copper value really differs from the table's", () => {
  assert.notEqual(expectedMass("Cu", 2, 2, 1800, 63.5), expectedMass("Cu", 2, 2, 1800));
});

// A stem stating no molar mass keeps the table value.
for (const [question, label] of [
  [`${COPPER} ${ASK}`, expectedMass("Cu", 2, 2, 1800)],
  ["Aqueous CuCl2 is electrolysed by a 2.0 A current for 30 minutes. Find the mass of copper deposited.", expectedMass("Cu", 2, 2, 1800)],
  ["Molten NaCl is electrolysed by a current of 5 A for 1 hour. Find the mass of sodium deposited.", expectedMass("Na", 1, 5, 3600)],
  ["Aqueous AgNO3 is electrolysed by a current of 0.5 A for 10 minutes. Find the mass of silver deposited.", expectedMass("Ag", 1, 0.5, 600)],
  [`${COPPER} F = 96500 C/mol. ${ASK}`, expectedMass("Cu", 2, 2, 1800)],
] as const) {
  check(`no stated mass keeps the table: ${question}`, () => assert.deepEqual(massLabels(labelsOf(question) ?? []), [label]));
}

// Anything unread leaves a true cell with no number on it.
for (const question of [
  `${COPPER} Cu = 63.5. ${ASK}`,
  `${COPPER} Cu = 64. ${ASK}`,
  `${COPPER} Atomic mass of Cu = 63.5. ${ASK}`,
  `${COPPER} (At. mass of Cu is 63.5 u). How much copper is deposited?`,
  "Aqueous CuSO4 is electrolysed by a 2.0 A current for 30 minutes at 80% current efficiency. Find the mass of copper deposited.",
  `${COPPER} Only half of the current deposits copper. ${ASK}`,
  `${COPPER} Some of the current is lost. ${ASK}`,
  `${COPPER} Zn = 65 g/mol. ${ASK}`,
  "Aqueous AgNO3 is electrolysed by a 2.0 A current for 30 minutes. Cu = 63.5 g/mol. Find the mass of silver deposited.",
  `${COPPER} A 5 ohm resistor is in series. ${ASK}`,
  `${COPPER} The leads also run through some resistors. ${ASK}`,
  "Aqueous CuSO4 is electrolysed by a 2.0 A current for 30 minutes, then 1.0 A for 10 minutes. Find the mass of copper deposited.",
  "Aqueous CuSO4 is electrolysed by a 2.0 A current for 30 minutes and 10 minutes. Find the mass of copper deposited.",
  "Aqueous CuSO4 is electrolysed by a 2.0 A current and a 1.0 A current for 30 minutes. Find the mass of copper deposited.",
  "Aqueous CuSO4 is electrolysed by two amperes for 30 minutes. Find the mass of copper deposited.",
  "Aqueous CuSO4 is electrolysed by a 2.0 A current for half an hour. Find the mass of copper deposited.",
  "Aqueous CuSO4 is not electrolysed by a 2.0 A current for 30 minutes. Find the mass of copper deposited.",
  `${COPPER} Cu = 63.5 g/mol and Cu = 64 g/mol. ${ASK}`,
  "Molten NaCl is electrolysed by a current of 5 A for 1 hour. Na = 23. Find the mass of sodium deposited.",
  `${COPPER} Find the mass of the anode deposited.`,
]) {
  check(`no mass on the cell: ${question}`, () => {
    const labels = labelsOf(question);
    assert.ok(labels, "the cell itself should still draw");
    assert.deepEqual(massLabels(labels), []);
  });
}

// The electrode path keeps its reviewed readings, and a qualifier now stops it too.
const ELECTRODES = "A current of 2.0 A is passed through aqueous CuSO4 for 30 minutes using inert electrodes.";
const AT_CATHODE = "What mass of copper is deposited at the cathode?";
check("electrode path still reads a plain stem", () => {
  assert.ok(massLabels(labelsOf(`${ELECTRODES} ${AT_CATHODE}`) ?? []).length === 1, "no mass");
});
for (const question of [
  `${ELECTRODES} Only half of the current deposits copper. ${AT_CATHODE}`,
  `${ELECTRODES} Some of the current is lost as heat. ${AT_CATHODE}`,
  `${ELECTRODES} A third of the charge goes to a side reaction. ${AT_CATHODE}`,
  "A current of 2.0 A is passed through aqueous CuSO4 for 30 minutes using inert electrodes at 80% current efficiency. What mass of copper is deposited at the cathode?",
]) {
  check(`no figure with a mass: ${question}`, () => assert.deepEqual(massLabels(labelsOf(question) ?? []), []));
}

console.log(`verify-chemistry-stated-deposit-mass: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
