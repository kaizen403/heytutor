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
  "Draw the structure of glycine in strongly acidic solution.",
  "What form does alanine take at physiological pH? Draw it.",
  "Draw the protonated form of aniline.",
  "Draw protonated ethanol.",
  "Draw the conjugate acid of aniline.",
  "Draw the conjugate base of phenol.",
  "Draw the anion of phenol.",
  "Draw the enolate of acetone.",
  "Draw the sodium salt of benzoic acid.",
  "Draw deprotonated acetic acid.",
  "Draw the carboxylate of glycine.",
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
  "What is the structure of glycine? Why does it have a high melting point?",
  "Draw the structure of acetic acid.",
  "Draw the structure of aniline.",
  "Draw the structure of phenol.",
  "Draw the structure of acetone.",
  "Draw the structure of benzoic acid.",
]) {
  check(`a plain structure still draws: ${question}`, () => assert.equal(synthesizeFamilyScene({ question })?.family, "chem_organic"));
}

console.log(`verify-chemistry-charged-form-declines: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
