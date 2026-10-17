/** Public, synthetic regressions for subject evidence shared with physiology and general language. */
import assert from "node:assert/strict";
import "../../src/chemistry/families";
import { isChemistryStem } from "../../src/chemistry/classify";
import { inferChemistryFamilies, isChemistryQuestion } from "../../src/chemistry/router";

const NON_CHEMISTRY = [
  "Explain the complex sequence of events in neurons during an action potential: Na+ enters and K+ leaves the cell.",
  "Describe the CNS and synapses. Na+ and K+ cross the membrane during depolarisation and repolarisation.",
  "Explain complex nervous signalling with Na+ and K+ and describe electrical polarisation.",
  "A nerve cell uses Na+, K+ and Ca2+ during impulse transmission. Describe the membrane and synapse.",
  "Explain the complex algorithms in a computer network and how a server handles a request.",
  "Solve this complex problem using induction on positive integers.",
  "Na+ and K+ move through a magnetic field. Determine the direction of force on each particle.",
  "Explain an axon's resting potential using Na+ and K+. Na+ moves inward and K+ moves outward.",
];

const CHEMISTRY = [
  "Compare the molecular shapes of H2O and CO2.",
  "Compare NO3- and CO3^2-.",
  "Calculate the bond order of NO3- and the formal charge on its atoms.",
  "Compare the ionic radii of Na+ and K+.",
  "Find the electronic configuration and unpaired electrons in Fe3+.",
  "Find the spin only magnetic moment of [Fe(CN)6]3-.",
  "Describe the ligands in a coordination complex.",
  "Explain what a complex ion contains.",
  "A metal complex has an octahedral coordination geometry.",
  "Explain the shape of the d_z2 orbital.",
  "Compare the ionisation energy of Na+ and K+ and their electron configurations.",
  "Determine the hybridisation of NH3.",
];

for (const question of NON_CHEMISTRY) {
  assert.equal(isChemistryStem(question), false, `nonchemical context entered chemistry: ${question}`);
  assert.deepEqual(inferChemistryFamilies(question), [], `nonchemical context claimed a chemistry family: ${question}`);
  assert.equal(isChemistryQuestion(question), false, `live chemistry exemption claimed a nonchemical context: ${question}`);
}
for (const question of CHEMISTRY) {
  assert.equal(isChemistryStem(question), true, `chemical subject evidence was lost: ${question}`);
  assert.equal(isChemistryQuestion(question), true, `chemical context lost the chemistry lane: ${question}`);
}

console.log(`verify-chemistry-subject-context: ${NON_CHEMISTRY.length} nonchemical and ${CHEMISTRY.length} chemical synthetic cases passed`);
