import assert from "node:assert/strict";
import { checkTeachingArithmeticRow, admitTeachingArithmetic } from "../../src/text/teachingArithmetic";
for (const row of [String.raw`2 \frac{1}{2}=2.5`, String.raw`-2\frac{1}{2}=-2.5`, String.raw`3\dfrac{1}{4}=3.25`, String.raw`2\frac{1}{2}=1`]) {
  assert.equal(checkTeachingArithmeticRow(row).verdict, "unsupported", row);
  const admitted = admitTeachingArithmetic([row]);
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.retryProof, undefined);
}
for (const row of [String.raw`2*\frac{1}{2}=1`, String.raw`2+\frac{1}{2}=2.5`, String.raw`\frac{1}{2}\frac{2}{3}=1/3`, "2(3+4)=14"]) {
  assert.equal(checkTeachingArithmeticRow(row).verdict, "correct", row);
}
assert.equal(checkTeachingArithmeticRow(String.raw`2*\frac{1}{2}=2.5`).verdict, "false");
console.log("W2 mixed-number abstention: 4 ambiguous and 5 explicit/unambiguous controls passed");
