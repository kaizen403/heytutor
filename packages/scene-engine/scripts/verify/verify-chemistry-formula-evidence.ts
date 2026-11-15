/** Repeating a school acronym cannot turn a biology lesson into chemistry. */
import assert from "node:assert/strict";
import { chemistryEvidence, isChemistryStem } from "../../src/chemistry/classify";
import { inferChemistryFamilies, isChemistryQuestion } from "../../src/chemistry";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

// Synthetic wording: CBSC parses as C, B, S, C, but its second mention is
// still the same ambiguous token, not independent chemical evidence.
const nonchemistry = [
  "CBSC CBSC",
  "Teach class 10 CBSC biology and explain heredity for the CBSC board.",
  "Teach class 10 CBSC biology and explain heredity for the CBSC board, CBSC exam and CBSC lesson.",
  "A label reads NaCl. Copy the label NaCl onto a second card.",
];
let checks = 0;
for (const question of nonchemistry) {
  assert(chemistryEvidence(question).formulas.length >= 2, "fixture must exercise repeated parseable tokens");
  assert.equal(isChemistryStem(question), false, "repeated formula-shaped prose must not establish chemistry");
  assert.equal(isChemistryQuestion(question), false, "chemistry families must not reclaim the biology/card prompt");
  assert.deepEqual(inferChemistryFamilies(question), []);
  assert.equal(synthesizeFamilyScene({ question }), null, "ambiguous prose supplies no chemical figure");
  checks++;
}

for (const question of [
  "Compare NaCl and KBr.",
  "Compare NaCl, KBr and NaCl.",
  "Compare HCl and HBr.",
  "Compare NH4+ and NO3-.",
  "NaCl has an ionic lattice. Explain the ionic bond in NaCl.",
  "Draw the Lewis structure of H2O and explain the lone pairs in H2O.",
  "The reaction is first order. The reaction is 50% complete in 120 minutes; find the time for 90% decomposition.",
]) {
  assert.equal(isChemistryStem(question), true, "independent species and explicit chemical roles retain chemistry");
  assert.equal(isChemistryQuestion(question), true);
  checks++;
}
console.log(`verify-chemistry-formula-evidence: ${checks} cases passed`);
