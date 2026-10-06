import assert from "node:assert/strict";
import { synthesizeFamilyScene } from "../../src/index";

for (const question of [
  "Derive the formula for the range of a projectile on level ground.",
  "Explain a river boat problem with upstream and downstream motion.",
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

const numeric = synthesizeFamilyScene({ question: "A projectile is launched at 20 m/s and 30 degrees on level ground." });
assert(numeric);
assert(numeric.document.quantities.some((quantity) => quantity.id === "u" && quantity.value === 20),
  "source-grounded numeric quantities must retain their authority");
console.log("verify-startup-symbolic-geometry: display scales stay internal while source-grounded values remain numeric");
