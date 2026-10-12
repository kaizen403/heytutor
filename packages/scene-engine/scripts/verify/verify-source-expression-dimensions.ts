/** Owned public-seam checks for source expression SI dimensions. */
import assert from "node:assert/strict";
import { evaluateMathExpression, inferSourceExpressionDimensions } from "../../src/math/expression";

// kg, m, s, A, K, mol, cd. Worked literal vectors, not an implementation oracle.
const bindings = new Map<string, readonly number[]>([
  ["m", [1, 0, 0, 0, 0, 0, 0]],
  ["v", [0, 1, -1, 0, 0, 0, 0]],
]);
assert.deepEqual(inferSourceExpressionDimensions("0.5 m * v^2", bindings), [1, 2, -2, 0, 0, 0, 0],
  "a mass multiplicand contributes kg even when an equal-valued metre exists elsewhere");
assert.deepEqual(inferSourceExpressionDimensions("m^-2", bindings), [-2, 0, 0, 0, 0, 0, 0],
  "negative powers preserve canonical zero axes");
let checks = 2;
function check(source: string, input: ReadonlyMap<string, readonly number[]>, expected: readonly number[] | null, message = source): void {
  checks++;
  assert.deepEqual(inferSourceExpressionDimensions(source, input), expected, message);
}
const none = new Map<string, readonly number[]>();
const zero = [0, 0, 0, 0, 0, 0, 0];
const mechanical = new Map<string, readonly number[]>([
  ["m", [1, 0, 0, 0, 0, 0, 0]], ["v", [0, 1, -1, 0, 0, 0, 0]],
  ["g", [0, 1, -2, 0, 0, 0, 0]], ["h", [0, 1, 0, 0, 0, 0, 0]],
  ["N", [1, 1, -2, 0, 0, 0, 0]], ["x", [0, 1, 0, 0, 0, 0, 0]],
  ["t", [0, 0, 1, 0, 0, 0, 0]], ["n", zero],
]);
const electrical = new Map<string, readonly number[]>([
  ["A", [0, 0, 0, 1, 0, 0, 0]], ["R", [1, 2, -3, -2, 0, 0, 0]],
  ["V", [1, 2, -3, -1, 0, 0, 0]], ["C", [-1, -2, 4, 2, 0, 0, 0]],
  ["I_max", [0, 0, 0, 1, 0, 0, 0]],
]);
check("3 A * R", electrical, [1, 2, -3, -1, 0, 0, 0], "ampere times ohm is volt");
check("3 A * R", new Map([...electrical, ["A", [0, 2, 0, 0, 0, 0, 0]]]), [1, 4, -3, -2, 0, 0, 0],
  "area times ohm is not volt despite any equal-valued current");
check("0.5 m * v^2", new Map([...bindings, ["m", [0, 1, 0, 0, 0, 0, 0]]]), [0, 3, -2, 0, 0, 0, 0],
  "metre times speed squared is not energy");
check("sqrt(2 g h)", mechanical, [0, 1, -1, 0, 0, 0, 0]);
check("0.25 C (V^2)", electrical, [1, 2, -2, 0, 0, 0, 0]);
check("2 C V", electrical, [0, 0, 1, 1, 0, 0, 0]);
check("0.4 N x", mechanical, [1, 2, -2, 0, 0, 0, 0]);
check("I_maxR", electrical, [1, 2, -3, -1, 0, 0, 0], "underscore bindings segment completely");
check("I_max R", electrical, [1, 2, -3, -1, 0, 0, 0]);
check("mvv", mechanical, [1, 2, -2, 0, 0, 0, 0]);
check("mv_unknown", mechanical, null, "partial known prefixes never erase unknown suffixes");
check("abc", new Map([["a", [1, 0, 0, 0, 0, 0, 0]], ["ab", [0, 1, 0, 0, 0, 0, 0]],
  ["bc", [0, 0, 1, 0, 0, 0, 0]], ["c", [0, 0, 0, 1, 0, 0, 0]]]), null, "multiple complete segmentations decline");
check("mvv", new Map([...mechanical, ["mvv", [0, 0, 0, 0, 1, 0, 0]]]), [0, 0, 0, 0, 1, 0, 0],
  "an exact multi-letter binding outranks products");
for (const source of ["1e-5 v", "2e0v", "2E+0*v", "1e-5*v+2e-5*v"]) {
  check(source, mechanical, [0, 1, -1, 0, 0, 0, 0], "scientific exponents remain numeric tokens: " + source);
}
check("2e0N", mechanical, [1, 1, -2, 0, 0, 0, 0]);
check("m² v²", mechanical, [2, 2, -2, 0, 0, 0, 0], "existing superscript normalization precedes dimension tagging");
check("(m)(v^2)", mechanical, [1, 2, -2, 0, 0, 0, 0]);
check("2(m)*sqrt(v^2)", mechanical, [1, 1, -1, 0, 0, 0, 0]);
check("v/t", mechanical, [0, 1, -2, 0, 0, 0, 0]);
check("v+g*t", mechanical, [0, 1, -1, 0, 0, 0, 0]);
check("v-g*t", mechanical, [0, 1, -1, 0, 0, 0, 0]);
check("v+g", mechanical, null, "incompatible addition declines");
check("m+0", mechanical, null, "literal zero does not erase an incompatible dimension");
check("0*m", mechanical, [1, 0, 0, 0, 0, 0, 0], "zero coefficient retains the physical dimension");
check("1*m", mechanical, [1, 0, 0, 0, 0, 0, 0], "ordinary numeric one is not a dimension marker");
check("m^1", mechanical, [1, 0, 0, 0, 0, 0, 0]);
check("m+1", mechanical, null);
check("1+1", mechanical, zero);
check("m^0", mechanical, zero);
check("m/m", mechanical, zero);
check("m^0.5", mechanical, [0.5, 0, 0, 0, 0, 0, 0]);
check("m^(-0.25)", mechanical, [-0.25, 0, 0, 0, 0, 0, 0]);
check("m^2e0", mechanical, [2, 0, 0, 0, 0, 0, 0]);
for (const source of ["m^n", "m^v", "m^(1+1)", "m^33", "m^0.1", "m^2.0000000000000001"]) {
  check(source, mechanical, null, "unsupported power is not approximate dimension proof: " + source);
}
check("abs(-m)", mechanical, [1, 0, 0, 0, 0, 0, 0]);
check("sqrt(m)", mechanical, [0.5, 0, 0, 0, 0, 0, 0]);
for (const name of ["sin", "cos", "tan", "asin", "acos", "atan", "exp", "log", "ln"]) {
  check(name + "(n)", mechanical, zero);
  check(name + "(m)", mechanical, null, "dimensionful function argument declines: " + name);
}
check("pi*m+e*m", new Map([...mechanical, ["pi", [0, 0, 1, 0, 0, 0, 0]], ["e", [0, 0, 1, 0, 0, 0, 0]]]), [1, 0, 0, 0, 0, 0, 0],
  "reserved constants cannot acquire binding dimensions");
check("sin(1)", new Map([["sin", [1, 0, 0, 0, 0, 0, 0]]]), zero, "reserved functions cannot be rebound");
for (const source of ["unknown", "unknown(m)", "gamma(1)", "", "m+", "sqrt m", "1e13", "m="]) check(source, mechanical, null);
check("m".repeat(257), mechanical, null, "source length budget");
check("1+".repeat(64) + "1", none, null, "actual tokenizer budget");
check("(".repeat(50) + "m" + ")".repeat(50), mechanical, null, "actual parser nesting budget");
check("m".repeat(86), mechanical, null, "replacement expansion remains bounded");
for (const invalid of [[], [1, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0, 0], [NaN, 0, 0, 0, 0, 0, 0],
  [Infinity, 0, 0, 0, 0, 0, 0], [33, 0, 0, 0, 0, 0, 0]]) check("m", new Map([["m", invalid]]), null);
check("m", new Map([["invalid key", zero]]), null);
let hugeDimension = "m";
for (let index = 0; index < 11; index++) hugeDimension = `(${hugeDimension}^32)`;
check(`(m*${hugeDimension})/${hugeDimension}`, mechanical, null,
  "intermediate dimension overflow cannot absorb a mass axis and certify false zero");
check(`0*${hugeDimension}`, mechanical, null, "a zero coefficient cannot hide an unsupported dimensional child");
check("m^0.0009765625", mechanical, [0.0009765625, 0, 0, 0, 0, 0, 0]);
check("sqrt(m^0.0009765625)", mechanical, null, "axes finer than the exact supported grid decline before cancellation");
check("m", new Map([["m", [1e-300, 0, 0, 0, 0, 0, 0]]]), null, "tiny input axes cannot underflow into dimensionless proof");
check("m", new Map([["m", new Array<number>(7)]]), null, "sparse dimension vectors are malformed");
checks++;
const snapshot = JSON.stringify([...mechanical]);
inferSourceExpressionDimensions("m*v^2", mechanical);
assert.equal(JSON.stringify([...mechanical]), snapshot, "caller bindings and vectors are never mutated");

// Dimension inference is not a numeric/domain validator. Existing public
// evaluation still owns those checks, and the new callback cannot weaken it.
checks++;
assert.equal(evaluateMathExpression("0.5*2*3^2", 0), 9);
checks++;
assert.throws(() => evaluateMathExpression("sqrt(-1)", 0));
checks++;
assert.throws(() => evaluateMathExpression("1/0", 0));
console.log(`verify-source-expression-dimensions: ${checks} public dimension/numeric-control checks passed`);
