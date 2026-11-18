import { strict as assert } from "node:assert";
import { parseMathExpression } from "../../src/math/expression";

let checks = 0;
function exactBounds(source: string, low: number, high: number, expected: { low: number; high: number }): void {
  const actual = parseMathExpression(source).intervalBoundsOn(low, high);
  assert.deepEqual(actual, expected, `${source} on [${low},${high}]`);
  checks++;
}

// These source-rational cancellations fail with the legacy floating evaluator.
exactBounds("0.1+0.2-0.3-4e-17", 0.1, 0.1, { low: -4e-17, high: -3.9999999999999997e-17 });
exactBounds("0.1+0.2-0.3", -2, 3, { low: 0, high: 0 });
exactBounds("(1e10+x)-1e10", 0.1, 0.1, { low: 0.1, high: 0.1 });
exactBounds("(1e10+x)-1e10", -2, 3, { low: -2, high: 3 });
exactBounds("2-0.5*x", 0, 2, { low: 1, high: 2 });
exactBounds("x^2", -2, 3, { low: 0, high: 9 });
exactBounds("x^0", -2, 3, { low: 1, high: 1 });
exactBounds("x^3", -2, 3, { low: -8, high: 27 });
exactBounds("x^-1", 1, 2, { low: 0.5, high: 1 });
exactBounds("x^-2", -2, -1, { low: 0.25, high: 1 });
exactBounds("x^128", -1, 1, { low: 0, high: 1 });
exactBounds("x-x", -5, 5, { low: 0, high: 0 });
exactBounds("(1/3)*x*3-x", -5, 5, { low: 0, high: 0 });
exactBounds("0.1*x+0.2*x-0.3*x", -5, 5, { low: 0, high: 0 });
exactBounds("(x+1)^2-(x*x+2*x+1)", -4, 4, { low: 0, high: 0 });
exactBounds("pi*x-pi*x+e-e", -2, 2, { low: 0, high: 0 });
exactBounds("(x-1)/(x-1)", 2, 3, { low: 1, high: 1 });
exactBounds("sqrt(x)", 0, 4, { low: 0, high: 2 });
exactBounds("x^0.5", 0, 4, { low: 0, high: 2 });
exactBounds("abs(x)", -2, 3, { low: 0, high: 3 });
exactBounds("abs(x-x)", -2, 3, { low: 0, high: 0 });
exactBounds("ln(e)", -2, 3, { low: 1, high: 1 });
exactBounds("log(1)", -2, 3, { low: 0, high: 0 });
exactBounds("exp(0)", -2, 3, { low: 1, high: 1 });
exactBounds("cos(pi*x/2)", 1, 1, { low: 0, high: 0 });
exactBounds("sin(pi*x/2)", 1, 1, { low: 1, high: 1 });

// Keep the closed range of a square: expansion alone loses this useful proof.
const positiveInertia = parseMathExpression("(x-1)^2+1").intervalBoundsOn(0, 2);
assert.ok(positiveInertia.low > 0 && positiveInertia.low <= 1 && positiveInertia.high >= 2);
checks++;

const binaryDecimal = parseMathExpression("x-0.1").intervalBoundsOn(0.1, 0.1);
assert.ok(binaryDecimal.low > 0 && binaryDecimal.low < 6e-18 && binaryDecimal.high > 5e-18);
const nearPi = parseMathExpression("pi-3.141592653589793").intervalBoundsOn(-2, 3);
assert.ok(nearPi.low <= 0 && nearPi.high > 0, "an unresolved near-pi residual cannot prove zero or a sign");
const nearCos = parseMathExpression("cos(3.141592653589793*x/2)").intervalBoundsOn(1, 1);
assert.ok(nearCos.low < 0 && nearCos.high > 0, "a rounded pi cannot certify a cardinal trig zero");
checks += 3;

// Regression probes of closed-form functions; the whole-domain certificate
// comes from the interval algebra, not these samples. Oracle rounding has one
// ulp of allowance, also covering the rounded decimal exponent in the oracle.
for (const [source, low, high, oracle] of [
  ["x^2-4*x", 0, 4, (x: number) => x * x - 4 * x],
  ["1/(2-0.5*x)", 0, 2, (x: number) => 1 / (2 - 0.5 * x)],
  ["sin(x)", -3, 2, Math.sin], ["cos(x)", -4, 4, Math.cos],
  ["tan(x)", -0.2, 0.2, Math.tan], ["exp(x)", -1, 1, Math.exp],
  ["log(x)", 1, 4, Math.log], ["atan(x)", -2, 2, Math.atan],
  ["asin(x)", -1, 1, Math.asin], ["acos(x)", -1, 1, Math.acos],
  ["(1+x)^0.3", 0, 0.5, (x: number) => (1 + x) ** 0.3],
  ["x^x", 1, 2, (x: number) => x ** x],
] as const) {
  const bounds = parseMathExpression(source).intervalBoundsOn(low, high);
  assert.ok(Object.isFrozen(bounds) && Number.isFinite(bounds.low) && Number.isFinite(bounds.high));
  checks++;
  for (let index = 0; index <= 40; index++) {
    const x = low + (high - low) * index / 40;
    const value = oracle(x); const ulpAllowance = Number.EPSILON * Math.abs(value);
    assert.ok(value >= bounds.low - ulpAllowance && value <= bounds.high + ulpAllowance, `${source} at ${x}: ${value} outside [${bounds.low},${bounds.high}]`);
    checks++;
  }
}

for (const [source, low, high] of [
  ["1/(x-x)", -1, 1], ["(x-1)/(x-1)", 0, 2], ["1/(2-0.5*x)", 0, 5],
  ["1/x", -1, 1], ["x^-2", -1, 1], ["tan(x)", 1, 2],
  ["tan(pi*x/2)", 0, 2], ["tan(pi*x/2)", 1, 1],
  ["sqrt(x)", -1, 1], ["log(x)", 0, 1], ["asin(x)", -2, 0], ["acos(x)", 0, 2],
  ["x^x", -1, 1], ["x^0.3", -1, 1], ["1e-300*x", 0, 1e-300],
  ["1e-300*1e-300", 0, 1], ["exp(-1000)", 0, 1], ["exp(1000)", 0, 1],
  ["x^200", -1, 1], ["1e12*x", 1, 2],
] as const) {
  assert.throws(() => parseMathExpression(source).intervalBoundsOn(low, high), `${source} on [${low},${high}] must fail closed`);
  checks++;
}
for (const [low, high] of [[2, 1], [NaN, 1], [0, Infinity], [-Infinity, 0], [0, 1e13]]) {
  assert.throws(() => parseMathExpression("x").intervalBoundsOn(low!, high!)); checks++;
}
const frozen = parseMathExpression("x").intervalBoundsOn(0, 1);
assert.equal(Reflect.set(frozen, "low", 99), false);
assert.equal(frozen.low, 0);
checks += 2;

console.log(`✓ certified expression intervals: ${checks} checks`);
