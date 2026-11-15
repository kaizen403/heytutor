import assert from "node:assert/strict";
import { synthesizeFamilyScene } from "../../src/index";

for (const question of [
  "Derive the formula for the range of a projectile on level ground.",
  "Explain a boat moving downstream and then upstream.",
  "Explain how a boat should head upstream to cross a river straight across.",
]) {
  const result = synthesizeFamilyScene({ question });
  assert(result, `the named apparatus must compile: ${question}`);
  assert.equal(result.validationReport.valid, true);
  assert.equal(result.tier, "qualitative_verified");
  assert.equal(result.document.quantities.length, 0, "display scales must not become claimed numeric quantities");
  const texts = result.renderScene.primitives.flatMap((primitive) =>
    typeof primitive.text === "string" ? [primitive.text] : []);
  assert(texts.length > 0);
  assert(!texts.some((text) => /=\s*\d/.test(text)), "unstated speeds, ranges and headings must remain symbolic");
}

// The old startup stem named a topic but never stated the boat's own motion.
// Keep its refusal alongside explicit motion so a stock direction cannot leak in.
for (const question of [
  "Explain a river boat problem with upstream and downstream motion.",
  "A boat moves downstream at 8 m/s. Explain the velocities.",
  "A boat moves upstream toward the far bank. Explain the velocities.",
]) {
  assert.equal(synthesizeFamilyScene({ question }), null,
    `ambiguous motion, ground speed or crossing geometry must not authorize a stock along-stream figure: ${question}`);
}

const numeric = synthesizeFamilyScene({ question: "A projectile is launched at 20 m/s and 30 degrees on level ground." });
assert(numeric);
assert(numeric.document.quantities.some((quantity) => quantity.id === "u" && quantity.value === 20),
  "source-grounded numeric quantities must retain their authority");
console.log("verify-startup-symbolic-geometry: display scales stay internal while source-grounded values remain numeric");
