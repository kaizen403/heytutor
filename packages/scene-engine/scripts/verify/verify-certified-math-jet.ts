import { strict as assert } from "node:assert";
import { parseMathExpression } from "../../src/math/expression";

let checks = 0;
const fields = ["value", "derivative", "secondDerivative"] as const;
function exact(source: string, x: number, expected: readonly [number, number, number]): void {
  const jet = parseMathExpression(source).certifiedJetAt(x);
  for (const [index, field] of fields.entries()) {
    assert.equal(jet[field], expected[index], `${source} ${field}`);
    assert.equal(jet.errorBounds[field], 0, `${source} ${field} is proved exact`);
    checks += 2;
  }
  assert.ok(Object.isFrozen(jet) && Object.isFrozen(jet.errorBounds));
  checks += 1;
}

exact("2*x^3-3*x^2", 1, [-1, 0, 6]);
exact("x/(1+x*x)", 1, [0.5, 0, -0.5]);
exact("(1/3)*x*3-x", 1, [0, 0, 0]);
exact("0.1*x+0.2*x-0.3*x", 1, [0, 0, 0]);
exact("(1e10+x)-1e10", 0.1, [0.1, 1, 0]);
exact("pi-pi+e-e", 1, [0, 0, 0]);
exact("ln(e)-1", 1, [0, 0, 0]);
exact("x^0", 0, [1, 0, 0]);
exact("x^1", 0, [0, 1, 0]);
exact("x^2", 0, [0, 0, 2]);
exact("x^3", 0, [0, 0, 0]);
exact("abs(x)", -2, [2, -1, 0]);
exact("sqrt(0)", 1, [0, 0, 0]);
const cardinal = parseMathExpression("pi*sin(pi*x/2)").certifiedJetAt(1);
assert.equal(cardinal.derivative, 0);
assert.equal(cardinal.errorBounds.derivative, 0);
assert.ok(cardinal.errorBounds.value > 0 && cardinal.errorBounds.secondDerivative > 0);
assert.equal(cardinal.exactQuarterTurns, 2);
checks += 4;

for (let quarter = -8; quarter <= 8; quarter++) {
  const angle = parseMathExpression("pi*x/2").certifiedJetAt(quarter);
  assert.equal(angle.exactQuarterTurns, quarter);
  const expectedCos = [1, 0, -1, 0][(quarter % 4 + 4) % 4]!;
  const expectedSin = [0, 1, 0, -1][(quarter % 4 + 4) % 4]!;
  const cos = parseMathExpression("cos(pi*x/2)").certifiedJetAt(quarter);
  const sin = parseMathExpression("sin(pi*x/2)").certifiedJetAt(quarter);
  assert.equal(cos.value, expectedCos); assert.equal(cos.errorBounds.value, 0);
  assert.equal(sin.value, expectedSin); assert.equal(sin.errorBounds.value, 0);
  if (expectedCos === 0) { assert.equal(sin.derivative, 0); assert.equal(sin.errorBounds.derivative, 0); }
  if (expectedSin === 0) { assert.equal(cos.derivative, 0); assert.equal(cos.errorBounds.derivative, 0); }
  checks += 7;
}

for (const time of [0.999, 1, 1.001]) {
  const jet = parseMathExpression("pi*sin(pi*x/2)").certifiedJetAt(time);
  if (time < 1) assert.ok(jet.derivative - jet.errorBounds.derivative > 0);
  if (time === 1) { assert.equal(jet.derivative, 0); assert.equal(jet.errorBounds.derivative, 0); }
  if (time > 1) assert.ok(jet.derivative + jet.errorBounds.derivative < 0);
  assert.ok(jet.secondDerivative + jet.errorBounds.secondDerivative < 0);
  checks += time === 1 ? 3 : 2;
}

// Closed-form analytic oracles; no finite differences or reuse of the parser's
// derivative machinery. One ulp allows the rounded oracle's own last bit.
for (const [source, x, expected] of [
  ["x*x*sin(x)", 0.5, [0.25 * Math.sin(0.5), Math.sin(0.5) + 0.25 * Math.cos(0.5), 1.75 * Math.sin(0.5) + 2 * Math.cos(0.5)]],
  ["sin(x^2)", 0, [0, 0, 2]],
  ["cos(2*x)", 0.5, [Math.cos(1), -2 * Math.sin(1), -4 * Math.cos(1)]],
  ["exp(2*x)", 0.5, [Math.E, 2 * Math.E, 4 * Math.E]],
  ["log(x)", 2, [Math.log(2), 0.5, -0.25]],
  ["ln(1+x^2)", 1, [Math.log(2), 1, 0]],
  ["sqrt(x)", 4, [2, 0.25, -0.03125]],
  ["tan(x)", 0.5, [Math.tan(0.5), 1 / Math.cos(0.5) ** 2, 2 * Math.tan(0.5) / Math.cos(0.5) ** 2]],
  ["atan(x)", 1, [Math.PI / 4, 0.5, -0.5]],
  ["asin(x)", 0.5, [Math.PI / 6, 2 / Math.sqrt(3), 4 / (3 * Math.sqrt(3))]],
  ["acos(x)", 0.5, [Math.PI / 3, -2 / Math.sqrt(3), -4 / (3 * Math.sqrt(3))]],
  ["x^x", 1, [1, 1, 2]],
  ["(1+x)^0.5", 3, [2, 0.25, -0.03125]],
] as const) {
  const jet = parseMathExpression(source).certifiedJetAt(x);
  for (const [index, field] of fields.entries()) {
    const oracle = expected[index]!;
    assert.ok(Number.isFinite(jet.errorBounds[field]) && jet.errorBounds[field] >= 0);
    assert.ok(Math.abs(jet[field] - oracle) <= jet.errorBounds[field] + Number.EPSILON * Math.abs(oracle), `${source} ${field}: ${jet[field]} ± ${jet.errorBounds[field]} != ${oracle}`);
    assert.ok(jet.errorBounds[field] <= 1e-10 * Math.max(1, Math.abs(oracle)), `${source} ${field} has a useful bound`);
    checks += 3;
  }
}

const roundedPi = String(Math.PI);
assert.notEqual(parseMathExpression("pi").syntaxKey, parseMathExpression(roundedPi).syntaxKey);
assert.notEqual(parseMathExpression("e").syntaxKey, parseMathExpression(String(Math.E)).syntaxKey);
for (const source of [`${roundedPi}/2`, `${roundedPi}*sin(${roundedPi}*x/2)`]) {
  const jet = parseMathExpression(source).certifiedJetAt(1);
  assert.equal(jet.exactQuarterTurns, undefined, `${source} cannot impersonate a symbolic pi angle`);
  assert.ok(jet.errorBounds.value > 0);
  checks += 2;
}
const nearStop = parseMathExpression(`${roundedPi}*sin(${roundedPi}*x/2)`).certifiedJetAt(1);
assert.ok(nearStop.derivative !== 0 || nearStop.errorBounds.derivative !== 0, "decimal pi must never become a proved stop");
assert.ok(Math.abs(nearStop.derivative) <= nearStop.errorBounds.derivative, "the near-cardinal sign is unresolved");
const roundedConstantDifference = parseMathExpression(`pi-${roundedPi}`).certifiedJetAt(0);
assert.ok(roundedConstantDifference.value !== 0 || roundedConstantDifference.errorBounds.value > 0);
const expCancellation = parseMathExpression("exp(1e-20)-1").certifiedJetAt(0);
assert.ok(expCancellation.value !== 0 || expCancellation.errorBounds.value > 0, "a rounded cancellation needs an absolute uncertainty");
checks += 6;

// Numeric x stays the exact binary64 input, while 0.1 is a source rational.
const binaryDecimalResidual = parseMathExpression("x-0.1").certifiedJetAt(0.1);
assert.ok(binaryDecimalResidual.value > binaryDecimalResidual.errorBounds.value);
assert.equal(binaryDecimalResidual.value, 5.551115123125783e-18);
assert.equal(binaryDecimalResidual.derivative, 1); assert.equal(binaryDecimalResidual.errorBounds.derivative, 0);
const shiftedSquare = parseMathExpression("x^2-0.2*x+0.01").certifiedJetAt(0.1);
assert.ok(shiftedSquare.value > shiftedSquare.errorBounds.value);
assert.ok(shiftedSquare.derivative > shiftedSquare.errorBounds.derivative);
const binaryNotSourceThird = parseMathExpression("sin(3*pi*x)").certifiedJetAt(1 / 3);
assert.ok(binaryNotSourceThird.value !== 0 || binaryNotSourceThird.errorBounds.value > 0, "a rounded third cannot prove a cardinal trig value");
checks += 7;

for (const [source, x] of [
  ["abs(x)", 0], ["sqrt(x)", 0], ["asin(x)", 1], ["acos(x)", -1],
  ["tan(pi*x/2)", 1], ["tan(x)", Math.PI / 2], ["1/x", 0],
  ["1/(pi-3.141592653589793)", 1], ["x^x", 0], ["log(x)", -1],
  ["sqrt(x)", -1], ["asin(x)", 2], ["acos(x)", -2], ["x^0.5", -1],
  ["1e-300*x", 1e-300], ["1e-300*1e-300", 1], ["x^128", 0.001],
  ["exp(-1000)", 0], ["exp(1000)", 0], ["x^200", 1], ["1e12*x", 2],
] as const) {
  assert.throws(() => parseMathExpression(source).certifiedJetAt(x), `${source} at ${x} must fail closed`);
  checks++;
}
for (const x of [NaN, Infinity, -Infinity, 1e13]) {
  assert.throws(() => parseMathExpression("x").certifiedJetAt(x)); checks++;
}
for (const source of ["1e-400", "x+".repeat(100), "(".repeat(50) + "x" + ")".repeat(50), "pi+e+1".repeat(50)]) {
  assert.throws(() => parseMathExpression(source).certifiedJetAt(1)); checks++;
}
const tiny = parseMathExpression("1e-320").certifiedJetAt(0);
assert.ok(tiny.value > 0 && tiny.errorBounds.value < tiny.value);
const frozen = parseMathExpression("x^2").certifiedJetAt(2);
assert.equal(Reflect.set(frozen, "value", 99), false);
assert.equal(Reflect.set(frozen.errorBounds, "value", 99), false);
checks += 3;

console.log(`✓ certified math jet: ${checks} checks`);
