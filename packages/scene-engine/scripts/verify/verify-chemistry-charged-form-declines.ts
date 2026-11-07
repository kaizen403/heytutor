/**
 * The organic figure draws a neutral molecule, so it must not answer an ask for a
 * charged form of that molecule. Every row here drew the neutral structure before.
 * Decline only: this gate never asks for a new figure.
 *
 *   tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-chemistry-charged-form-declines.ts
 */
import assert from "node:assert/strict";
import "../../src/chemistry/families";
import { buildOrganicScene } from "../../src/chemistry/organic";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";

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

for (const question of [
  "What is a zwitterion? Write the zwitterionic form of glycine.",
  "What is a zwitterion? Write the zwitterionic form of glycine and explain why amino acids have high melting points and are soluble in water.",
  "Draw the zwitterion of glycine.",
  "Draw the zwitterionic structure of alanine.",
  "Glycine exists as a zwitterion. Explain.",
  "Draw the dipolar ion of glycine.",
  "Draw the inner salt of glycine.",
  "Draw the internal salt of alanine.",
  "Draw glycine at its isoelectric point.",
  "Draw the structure of glycine at pH 7.",
  "What form does alanine take at physiological pH? Draw it.",
  "Draw the protonated form of aniline.",
  "Draw protonated ethanol.",
  "Draw the anion of phenol.",
  "Draw the sodium salt of benzoic acid.",
  "Draw deprotonated acetic acid.",
  "Glycine is an inner salt. Draw it.",
  "Alanine is an internal salt. Draw it.",
  "Draw the cation of aniline.",
]) {
  check(`no neutral structure for: ${question}`, () => {
    assert.equal(buildOrganicScene(question, [], false), null, "the organic figure drew");
    const scene = synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question });
    assert.equal(scene, null, `${scene?.family ?? ""} took the turn`);
  });
}

// A plain structure ask, and a stem naming the neutral compound, still draw.
for (const question of [
  "Draw the structure of glycine.",
  "Draw the structure of alanine.",
  "Draw the structure of acetic acid.",
  "Draw the structure of aniline.",
  "Draw the structure of phenol.",
  "Draw the structure of acetone.",
  "Draw the structure of benzoic acid.",
]) {
  check(`a plain structure still draws: ${question}`, () => assert.equal(synthesizeFamilyScene({ question })?.family, "chem_organic"));
}

// These conditions and reasons are no ask for another form, and they draw. Not every
// such wording does: "protonated", "deprotonated", "at pH" and "salt of" still decline
// a stem that uses them for a reason or a condition, a known cost stated beside the
// regex. The aniline row passes only because "protonation" is a noun. The pH and salt
// rows stop a later widening of "at pH" or "salt of" to any pH or any salt.
for (const question of [
  "Toluene on treatment with KMnO4 in acidic medium gives benzoic acid.",
  "Ethanol on treatment with K2Cr2O7 in acidic medium gives acetic acid.",
  "Why is p-nitrophenol more acidic than phenol? Compare their conjugate bases.",
  "Why is benzoic acid stronger than acetic acid? Explain using the carboxylate ion.",
  "Draw the structure of aniline. Why is it less basic after protonation?",
  "Draw the structure of acetic acid. What is the pH at half neutralisation?",
  "Draw the structure of glycine. Is it a salt?",
]) {
  check(`a condition or a reason still draws: ${question}`, () => assert.equal(synthesizeFamilyScene({ question })?.family, "chem_organic"));
}

console.log(`verify-chemistry-charged-form-declines: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
