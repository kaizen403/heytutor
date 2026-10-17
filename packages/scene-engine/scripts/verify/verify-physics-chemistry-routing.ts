/** Physical words or OCR fragments must not masquerade as chemical apparatus. */
import assert from "node:assert/strict";
import "../../src/index";
import { inferChemistryFamilies, isChemistryQuestion } from "../../src/chemistry";
import { claimsChemicalThermodynamics } from "../../src/chemistry/chemicalThermodynamics";
import { isLewisStem } from "../../src/chemistry/lewis";
import { isSharedPhotoelectricEmissionStem, buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { attemptArchetypeScene } from "../../src/archetypes";
const probes = [
  ["kirchhoff", "wlefeettiex ferandh Kirchhoff ke niyam likhiye an arent fara. Using Kirchhoff's rules calculate the current in each branch of the circuit and explain the figure. qwrt zxcv pqrs."],
  ["collision", "A 2 kg ball moving at 6 m/s collides head-on with a 4 kg ball at rest and sticks to it. Find the common velocity."],
] as const;
for (const [name, question] of probes) {
  assert.deepEqual(inferChemistryFamilies(question), [], name);
  assert.equal(isChemistryQuestion(question), false, name);
  const attempt = attemptArchetypeScene({ question });
  assert(attempt.scene, `${name}: ${attempt.declined}`);
}
for (const token of ["Cp", "Cv", "C_p", "C_v"]) {
  assert.equal(claimsChemicalThermodynamics(`For one mole of ideal gas ${token} = 20 J/mol/K. Find the heat for a 10 K temperature change.`), true);
}
assert.equal(isLewisStem("Draw the head-on overlap of two p orbitals forming a sigma bond."), true);
assert.equal(isLewisStem("Show head-on orbital overlap and sideways overlap in covalent bonds."), true);
assert.equal(isLewisStem("Draw the Lewis electron-dot structure of H2O and show lone pairs."), true);
const emission = "The work function of a metal is 2.0 eV. Light of wavelength 400 nm falls on it. Find the maximum kinetic energy of the photoelectrons.";
assert.equal(isSharedPhotoelectricEmissionStem(emission), true);
assert(attemptArchetypeScene({ question: emission }).scene, "physics emission geometry is a legitimate shared apparatus");
assert(buildAtomicRadiationScene(emission, [], false), "existing chemistry atomic-radiation builder remains available");
assert.equal(isSharedPhotoelectricEmissionStem(emission + " Draw the electronic configuration and orbital boxes of the metal."), false);
console.log("PASS physics/chemistry routing: OCR capacity fragments and head-on collisions stay physics; chemistry heat/overlap retained");
