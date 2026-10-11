/** Real-source regressions for coordinator #137 re-review; no model calls. */
import assert from "node:assert/strict";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";

let checks = 0;
const failures: string[] = [];
function labels(document: SceneDocument | null): string[] {
  assert.ok(document, "expected a source-grounded scene");
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, "scene must compile");
  const text = compiled.renderScene.primitives.flatMap(mark => mark.text ? [mark.text] : []);
  assert.ok(!text.some(label => /NaN|Infinity/.test(label)));
  return text;
}
function check(name: string, run: () => void): void {
  try { run(); checks++; } catch (error) { failures.push(name + ": " + String(error)); }
}
const sourceHcStems = [
  "Light of wavelength 300 nm falls on a metal of work function 2.0 eV. Take hc = 1240 eV nm. Find the stopping potential in volts.",
  "The work function of a metal is 2.0 eV. Light has wavelength 300 nm. Using hc=1240 eV nm, calculate the photoelectron kinetic energy.",
  "For the photoelectric effect, work function is 2.0 eV and wavelength is 300 nm. Given hc is 1240 eV nm, find maximum kinetic energy.",
  "The work function of sodium is 2 eV; wavelength is 300 nm. Find the stopping potential using hc = 1.240e3 eV nm.",
  "In the photoelectric effect light wavelength is 300 nm. The work function of the metal is 2 eV. Take hc = 1240 eV nm and calculate Kmax.",
  "For a metal the work function is 2 eV. Incident light wavelength is 300 nm. The product hc = 1240 eV nm is given. Determine the kinetic energy.",
];
for (const question of sourceHcStems) check("source hc supplies its wavelength law: " + question, () => {
  const direct = labels(buildAtomicRadiationScene(question, [], false));
  assert.ok(direct.includes("K=2.13 eV"));
  const synthesis = synthesizeFamilyScene({ question });
  assert.ok(synthesis);
  assert.equal(synthesis.document.source.chemistryFamily, "chem_orbital");
  assert.ok(labels(synthesis.document).includes("K=2.13 eV"));
});
for (const hc of ["4e- eV nm", "1e999 eV nm", "unknown", "-1240 eV nm", "0 eV nm", "1240 kg", "1240 eV nm/s", "1240 eV nm; hc=1200 eV nm"])
  check("supplied damaged hc never becomes a fixed product: " + hc, () => {
    const question = `Light of wavelength 300 nm falls on a metal. Its work function is 2.0 eV. Take hc=${hc}. Find photoelectron kinetic energy.`;
    assert.equal(buildAtomicRadiationScene(question, [], false), null);
  });
check("SI source hc converts value and unit together", () => {
  const question = "For the photoelectric effect, wavelength is 300 nm and work function is 2 eV. Take hc=1.9864458571489286e-25 J m. Find kinetic energy.";
  assert.ok(labels(buildAtomicRadiationScene(question, [], false)).includes("K=2.13 eV"));
});
check("hc is not allowed to contradict explicitly stated h", () => {
  const question = "For the photoelectric effect, wavelength is 300 nm and work function is 2 eV. h=6.62607015e-34 J s and hc=1240 eV nm. Find kinetic energy.";
  assert.equal(buildAtomicRadiationScene(question, [], false), null);
});
for (const subject of ["a metal", "the metal", "sodium", "the sodium", "potassium"])
  check("whole work-function owner: " + subject, () => {
    const question = `In the photoelectric effect the work function of ${subject} is 4.0 eV. Photons of energy 2.0 eV are incident. Are electrons emitted?`;
    const direct = labels(buildAtomicRadiationScene(question, [], false));
    assert.ok(direct.includes("no emission"));
    assert.ok(!direct.some(label => label.startsWith("K=")));
    const synthesis = synthesizeFamilyScene({ question });
    assert.ok(synthesis);
    assert.ok(labels(synthesis.document).includes("no emission"));
  });
const hessStems = [
  "Using Hess's law, step 1 has ΔH = -394 kJ as written. Step 2 has ΔH = -283 kJ and is reversed. Draw the enthalpy sum.",
  "Using Hess's law, step 1 is the enthalpy of combustion and has ΔH = -394 kJ as written. Step 2 is the enthalpy of formation and has ΔH = -283 kJ and is reversed. Draw the enthalpy sum.",
  "For Hess's law step 1: ΔH=-394 kJ. Step 2: ΔH=-283 kJ reversed. Find total enthalpy.",
  "Draw the Hess sum. Step 1 has ΔH = -394000 J. Step 2 has ΔH = -283 kJ and is reversed.",
  "Apply Hess law: Step 1 has ΔH = -394 kJ. Step 2 has ΔH = -283000 J and is reversed. Draw the sum.",
];
for (const question of hessStems) check("Hess enthalpies belong to their own original steps: " + question, () => {
  const direct = labels(buildThermoGraphScene(question, [], false));
  assert.ok(direct.includes("net=-111 kJ"));
  assert.ok(direct.includes("-394 kJ"));
  assert.ok(direct.includes("rev +283 kJ"));
  const synthesis = synthesizeFamilyScene({ question });
  assert.ok(synthesis);
  assert.ok(labels(synthesis.document).includes("net=-111 kJ"));
});
check("Hess factor is independently source-grounded", () => {
  const question = "Using Hess's law, step 1 has ΔH = -100 kJ multiplied by 2. Step 2 has ΔH = +30 kJ as written. Draw the enthalpy sum.";
  assert.ok(labels(buildThermoGraphScene(question, [], false)).includes("net=-170 kJ"));
});
for (const value of ["4e- kJ", "1e999 kJ", "unknown", "20 kg", "20 kJ/mol"])
  check("step-owned invalid enthalpy cannot bypass validation: " + value, () => {
    const question = `Using Hess's law, step 1 has ΔH=-394 kJ. Step 2 has ΔH=${value} and is reversed. Draw the enthalpy sum.`;
    assert.equal(buildThermoGraphScene(question, [], false), null);
  });
console.log(`verify-chemistry-rereview-photoelectric-hess: ${checks} checks passed / ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
