/**
 * A mass on an electrolytic cell comes only from the reviewed reader for a stem
 * naming an electrode. Any other stem gets the true cell with no mass. That path
 * used to work a mass from the element table, printing 1.19 g for a stated
 * "Cu = 63.5 g/mol" (1.18 g) and the same again at 80% efficiency.
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
const massLabels = (labels: readonly string[]) => labels.filter((text) => /\d\s*g$/.test(text));

const COPPER = "Aqueous CuSO4 is electrolysed by a 2.0 A current for 30 minutes.";
const ASK = "Find the mass of copper deposited.";

// No electrode named: the cell still draws, true, and carries no number.
for (const question of [
  `${COPPER} ${ASK}`,
  `${COPPER} Cu = 63.5 g mol^-1 and F = 96500 C mol^-1. ${ASK}`,
  `${COPPER} Cu = 63.5 g/mol. ${ASK}`,
  `${COPPER} Molar mass of copper is 63.5 g/mol. ${ASK}`,
  `${COPPER} Atomic mass of Cu = 63.5. ${ASK}`,
  "Aqueous CuSO4 is electrolysed by a 2.0 A current for 30 minutes at 80% current efficiency. Find the mass of copper deposited.",
  `${COPPER} Only half of the current deposits copper. ${ASK}`,
  `${COPPER} Zn = 65 g/mol. ${ASK}`,
  `${COPPER} A 5 ohm resistor is in series. ${ASK}`,
  `${COPPER} The leads also run through some resistors. ${ASK}`,
  "Aqueous CuSO4 is electrolysed by a 2.0 A current for 30 minutes, then 1.0 A for 10 minutes. Find the mass of copper deposited.",
  "Aqueous CuSO4 is electrolysed by a 2.0 A current for 1 Hour 30 min. Find the mass of copper deposited.",
  "Aqueous AgNO3 is electrolysed by a current of 0.5 A for 10 minutes. Ag = 108 g/mol. Find the mass of silver deposited.",
  "Molten NaCl is electrolysed by a current of 5 A for 1 hour. Find the mass of sodium deposited.",
  "Find the mass of Cu deposited by electrolysis of CuSO4 solution (molar mass = 159.5 g/mol) with 2 A for 30 min.",
]) {
  check(`a true cell with no mass: ${question}`, () => {
    const labels = labelsOf(question);
    assert.ok(labels, "the cell itself should still draw");
    assert.deepEqual(massLabels(labels), []);
  });
}

// The electrode reader is untouched. Worked here from the fixture's values, never from the figure.
const worked = (metal: string, electrons: number, ampere: number, seconds: number, molarMass?: number) =>
  `m(${metal})=${Number((((molarMass ?? elementBySymbol(metal)!.mass) * ampere * seconds) / (electrons * 96500)).toPrecision(3))} g`;
for (const [question, label] of [
  ["A current of 2.0 A is passed through an aqueous solution of CuSO4 for 30 minutes using inert electrodes. What mass of copper is deposited at the cathode?", worked("Cu", 2, 2, 1800)],
  ["A current of 1 A passes through aqueous CuSO4 for 20 minutes with inert electrodes. Find the mass of copper deposited at the cathode. Molar mass of Cu = 63.5 g/mol; F = 96500 C/mol.", worked("Cu", 2, 1, 1200, 63.5)],
  ["Aqueous copper sulphate is electrolysed with inert electrodes using a current of 3 A for 10 min. Calculate the mass of copper deposited. Molar mass of Cu = 64 g/mol; F = 96500 C/mol.", worked("Cu", 2, 3, 600, 64)],
] as const) {
  check(`the electrode reader keeps its mass: ${question}`, () => assert.deepEqual(massLabels(labelsOf(question) ?? []), [label]));
}

console.log(`verify-chemistry-stated-deposit-mass: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
