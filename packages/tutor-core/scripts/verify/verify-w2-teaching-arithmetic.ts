import assert from "node:assert/strict";
import {
  admitTeachingArithmetic,
  checkTeachingArithmeticRow,
  evaluateTeachingArithmetic,
  type TeachingArithmeticRow,
} from "../../src/text/teachingArithmetic";

// Frozen independent decimal/fraction oracles; never computed by the guard.
const correct = [
  "2.513^2 = 6.315", "6.316 / 0.8 = 7.895",
  "2.25+4-4.5-8+2.75 = -3.5", "1/3 ≈ 0.333", "pi ≈ 3.14",
  "2.51² ≈ 6.30", "0.1+0.2 = 0.3", "0.3-0.2-0.1 = 0",
  "-2^2 = -4", "(-2)^2 = 4", "2^-3 = 0.125", "2^3^2 = 512",
  "10^8/10^14 = 10^-6", "8.99e9 * -6e-12 = -0.05394",
  "(0.2*20+0.01*100)/0.01 = 500", "2(3+4) = 14",
  "(2+3)(4-1) = 15", "2pi ≈ 6.28", "3×10⁻³ = 0.003",
  String.raw`\frac{1}{\frac{1}{6}+\frac{1}{3}} = 2`,
  String.raw`\frac{-3}{4}+\frac{1}{2} = -0.25`,
  String.raw`$\left(2+3\right)\cdot 4 = 20$`,
  String.raw`2^{3} = 8`, String.raw`\pi \approx 3.142`,
  "1/3=0.333=0.3333", "result = 2+3 = 5",
  "1.005 = 1.01", "-1.005 = -1.01", "3.596e10*5 = 1.8e11",
  "2.513² = (6.315)", String.raw`2.513^{2} = {6.315}`,
  "0.0049=0.00", "(1/2)pi≈1.571", "1.235e-10≈1.24e-10",
  "1.23e20+4.56e20=5.79e20", "2(3)4=24", "2^3≈8^1",
];
const wrong: [string, number][] = [
  ["2.513^2 = 6.316", 6.315169], ["6.316/0.8 = 7.896", 7.895],
  ["2.25+4-4.5-8+2.75 = 0", -3.5], ["2.51² ≈ 6.32", 6.3001],
  ["1/3 ≈ 0.334", 1/3], ["pi ≈ 3.15", Math.PI],
  ["2+3 = 6", 5], ["1/3 = 0", 1/3], ["2+2=4.001", 4],
  ["-2^2 = 4", -4], ["2^-3 = 8", .125], ["0.1+0.2=0.31", .3],
  ["1.005=1.00", 1.005], ["-1.005=-1.00", -1.005],
  ["3.596e10*5=1.8e10", 1.798e11], ["2+3=5=6", 5],
  ["0.005=0.00", .005], ["0.005=0.004", .005],
  ["1.235e-10≈1.23e-10", 1.235e-10],
];
const unsupported = [
  "k = 1.38e-23 J/K, T = 300 K", "1 MeV = 10^6 eV",
  "r = 0.5 mm = 5e-4 m", "1 N = 10^5 dyn", "τ = 8000/0.01 = 800 kPa",
  "d = 1000*5 = 5 km", "t = 60*25 = 1.5 ks", "v=100/2=50 m/s",
  "0.01 V = 0.01*100+0.2*20", "E=3.596e10*5=1.8e10 N/C",
  "t = sqrt(2h/g)", "1/f=1/15-1/20=1/60", "x+2=3",
  "2+3=5, 4+5=9", "2+3=5;4+5=9", "2+3=5\n4+5=9",
  "2 m + 3 m = 5 m", "2++*3=5", "2+=2", "(2+3=5", "2 3=6",
  "1/0=0", "0^0=1", "(-1)^0.5=1", "1e999=0", "1e-999=0",
  "6/2(1+2)=9", "1/2pi=0.159", "2+3==5", "2+3=", "=5",
  String.raw`\frac{1}{}=0`, String.raw`\unknown{2}=2`,
  "2**3=8", "2%3=2", "Infinity=1", "NaN=0", "alert(1)=1",
  "2+3", "", "9^999=1", "(".repeat(40)+"1"+")".repeat(40)+"=1",
  "1+".repeat(200)+"1=201", "9".repeat(1100)+"=0",
  "pi=pi", "2–3=1", "9999999999999999999999999999999999999999^64=0",
  "2^".repeat(40)+"2=0", "a=2+3=5 metres", "pi≈22/7", "1/3≈333/1000",
];
let checks = 0;
for (const row of correct) {
  assert.equal(checkTeachingArithmeticRow(row).verdict, "correct", row);
  checks++;
}
for (const [row, expected] of wrong) {
  const result = checkTeachingArithmeticRow(row);
  assert.equal(result.verdict, "false", row);
  if (result.verdict === "false") {
    assert.ok(Math.abs(result.proof.expected - expected) < 1e-12 * Math.max(1, Math.abs(expected)), row);
    assert.ok(result.proof.expectedExact.length > 0, row);
    assert.equal(result.proof.row, row);
  }
  checks++;
}
for (const row of unsupported) {
  assert.equal(checkTeachingArithmeticRow(row).verdict, "unsupported", row);
  checks++;
}

const binding = { scopeId: "turn:stone:step:2", roleId: "acceleration" };
const computed: TeachingArithmeticRow = { text: "a = (8.99e9/0.25)(5)", binding };
assert.equal(checkTeachingArithmeticRow(computed).verdict, "supported");
const restated: TeachingArithmeticRow = { text: "a = 1.8e10", binding };
const bound = checkTeachingArithmeticRow(restated, [computed]);
assert.equal(bound.verdict, "false");
if (bound.verdict === "false") {
  assert.equal(bound.proof.expected, 1.798e11);
  assert.equal(bound.proof.sourceRow, computed.text);
}
assert.equal(checkTeachingArithmeticRow({ text: "a=1.8e11", binding }, [computed]).verdict, "correct");
// A spelling coincidence is never enough to substitute a symbol.
assert.equal(checkTeachingArithmeticRow("a=1.8e10", [computed]).verdict, "unsupported");
assert.equal(checkTeachingArithmeticRow(restated, [computed.text]).verdict, "unsupported");
assert.equal(checkTeachingArithmeticRow({ ...restated, binding: { ...binding, scopeId: "other" } }, [computed]).verdict, "unsupported");
assert.equal(checkTeachingArithmeticRow({ ...restated, binding: { ...binding, roleId: "force" } }, [computed]).verdict, "unsupported");
assert.equal(checkTeachingArithmeticRow({ text: "b=1.8e10", binding }, [computed]).verdict, "unsupported");
assert.equal(checkTeachingArithmeticRow(restated, [computed, { text: "a=x", binding }]).verdict, "unsupported");
assert.equal(checkTeachingArithmeticRow(restated, [computed, ...Array<string>(6).fill("unrelated")]).verdict, "unsupported");
assert.equal(checkTeachingArithmeticRow({ text: "a=1.8e10 N/C", binding }, [computed]).verdict, "unsupported");
assert.equal(checkTeachingArithmeticRow("2.513^2=6.315", ["2.513^2=6.316"]).verdict, "correct");
checks += 12;

const batch = admitTeachingArithmetic(["2+3=5", "2.513^2=6.316", "x+2=3"]);
assert.equal(batch.admitted, false);
assert.equal(batch.falseRows.length, 1);
assert.ok(batch.retryProof?.includes("6.315169"));
assert.ok(batch.retryProof?.includes("2.513^2=6.316"));
assert.equal(admitTeachingArithmetic(["x+2=3"]).admitted, true);
assert.equal(admitTeachingArithmetic([computed, restated]).admitted, false);
assert.equal(admitTeachingArithmetic([restated], [computed]).admitted, false);
assert.equal(admitTeachingArithmetic(Array<string>(65).fill("2+3=5")).admitted, false);
assert.equal(checkTeachingArithmeticRow("2+3=5", Array<string>(33).fill("row")).verdict, "unsupported");
checks += 9;

// Deterministic adversarial syntax samples must terminate and never throw.
for (let i = 0; i < 128; i++) {
  const row = `${"(-".repeat(i)}2${")".repeat(i)}=x, 1=2`;
  assert.equal(checkTeachingArithmeticRow(row).verdict, "unsupported");
  checks++;
}
const exact = evaluateTeachingArithmetic("2.513^2");
assert.equal(exact.verdict, "supported");
if (exact.verdict === "supported") assert.equal(exact.expectedExact, "6315169/1000000");
checks++;

const frozenRows = Object.freeze([
  Object.freeze({ text: "a=2+3", binding: Object.freeze({ scopeId: "pure", roleId: "a" }) }),
  Object.freeze({ text: "a=6", binding: Object.freeze({ scopeId: "pure", roleId: "a" }) }),
]);
const before = JSON.stringify(frozenRows);
assert.equal(admitTeachingArithmetic(frozenRows).admitted, false);
assert.equal(JSON.stringify(frozenRows), before);
assert.doesNotThrow(() => JSON.stringify(admitTeachingArithmetic(frozenRows)));
checks += 3;

// Bounded integer holdout/mutations have a separate elementary oracle.
for (let a = -12; a <= 12; a++) {
  for (let b = -12; b <= 12; b++) {
    const sum = a + b;
    assert.equal(checkTeachingArithmeticRow(`${a}+(${b})=${sum}`).verdict, "correct");
    assert.equal(checkTeachingArithmeticRow(`${a}+(${b})=${sum + 1}`).verdict, "false");
    checks += 2;
  }
}
console.log(`verify-w2-teaching-arithmetic: ${checks} checks passed (${correct.length} correct, ${wrong.length} false, ${unsupported.length} unsupported frozen rows; binding, admission and bounds)`);
