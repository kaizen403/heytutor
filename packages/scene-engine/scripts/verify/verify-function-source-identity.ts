import assert from "node:assert/strict";
import { cartesianLineCoefficients, isAffineMathExpression, mathExpressionsEquivalent, normalizeMathProductNotation } from "../../src/math/expression";
import { readCartesianEquationLabel } from "../../src/compile/qualitativeLabelTruth";

for (const [left, right] of [
  ["x*x", "x^2"], ["(x+1)*(x-1)", "x^2-1"], ["x/2", "0.5*x"],
  ["(x+y)^2", "x^2+2*x*y+y^2"], ["x-x", "0"], ["sin(x)", "sin(x)"],
]) assert(mathExpressionsEquivalent(left!, right!), `${left} = ${right}`);
for (const [left, right] of [
  ["x", "x^2"], ["0", "4"], ["2*x^2", "x^2"], ["x/x", "1"],
  ["sqrt(x)^2", "x"], ["x^2", "x^2+0.00000000000001"], ["sin(x)", "cos(x)"],
]) assert(!mathExpressionsEquivalent(left!, right!), `${left} must not gain ${right}'s authority`);
for (const body of ["sin(x)", "cos(x)+sin(x)", "1/(x^2+1)"]) {
  assert(mathExpressionsEquivalent(`(${body})-2*y`, `y-(${body})/2`, { allowNonzeroScale: true }), "constant rearrangement preserves complete opaque terms");
  assert(!mathExpressionsEquivalent(`(${body})-3*y`, `y-(${body})/2`, { allowNonzeroScale: true }));
}
assert(mathExpressionsEquivalent("2*y-2*x^2", "y-x*x", { allowNonzeroScale: true }));
assert(!mathExpressionsEquivalent("0", "y-x^2", { allowNonzeroScale: true }));
assert(!mathExpressionsEquivalent("y^2-x^4", "y-x^2", { allowNonzeroScale: true }));
assert(!mathExpressionsEquivalent("(x+y)^17", "x^17+y^17"));
assert(!mathExpressionsEquivalent("x+".repeat(300) + "1", "1"));
for (const expression of ["sin(x)", "1/(x^2+1)"]) {
  assert(mathExpressionsEquivalent(`(y-(${expression}))-0`, `y-(${expression})`, { allowNonzeroScale: true }));
  assert(mathExpressionsEquivalent(`(${expression})-y`, `y-(${expression})`, { allowNonzeroScale: true }));
  assert(mathExpressionsEquivalent(`3*(y-(${expression}))`, `y-(${expression})`, { allowNonzeroScale: true }));
  assert(!mathExpressionsEquivalent(`0*(y-(${expression}))`, `y-(${expression})`, { allowNonzeroScale: true }));
  assert(!mathExpressionsEquivalent(`${expression}/${expression}`, "1"), "domain-changing cancellation remains unsupported");
}
for (const expression of ["2*x+1", "x/3+1/6", "x^2-x*x+x", "4"]) assert(isAffineMathExpression(expression), expression);
for (const expression of ["x^2", "sin(x)", "1/x", "x/x", "x^3+1"]) assert(!isAffineMathExpression(expression), expression);
for (const [source, expected] of [["x+2 e + 1", "x+2*e+1"], ["x+2e+1", "x+2e+1"], ["2e +1", "2*e+1"], ["2e+ 1", "2*e+1"], ["2 x+3 (x-1)", "2*x+3*(x-1)"]]) assert.equal(normalizeMathProductNotation(source!), expected);
assert.throws(() => normalizeMathProductNotation("1 0"));
for (const source of ["pi x", "e x", "x x", "x 2", "e(x)"]) assert.throws(() => normalizeMathProductNotation(source));
assert.deepEqual(cartesianLineCoefficients("x", "0"), { x: 1, y: 0, constant: 0 });
assert(cartesianLineCoefficients("y", "-x/2+3/2"));
assert.equal(cartesianLineCoefficients("y", "x^2"), null);
assert.equal(cartesianLineCoefficients("x", "1e-400*y^2"), null, "nonzero underflow cannot erase nonlinear terms");
assert(!mathExpressionsEquivalent("1e-400*x", "0"));
assert.equal(cartesianLineCoefficients("x", "(1.0000000000000000001-1)*y^2"), null, "literal precision cannot erase nonlinear terms");
assert(!mathExpressionsEquivalent("1.0000000000000000001*x", "x"));
for (const coefficient of ["1.0000000000000000001^2-1", "sin(1.0000000000000000001)-sin(1)"]) assert.equal(cartesianLineCoefficients("x", `(${coefficient})*y^2`), null, "constant evaluation cannot erase nonlinear terms");
assert(mathExpressionsEquivalent("(1/3)^2", "1/9"));
assert(mathExpressionsEquivalent("2^-3", "1/8"));
assert(mathExpressionsEquivalent("sin(0)*x+cos(0)", "1"));
assert(!mathExpressionsEquivalent("log(-1)*0", "0"));
for (const [left, right] of [["log(x)-log(x)", "0"], ["1/x-1/x", "0"], ["sqrt(x)*sqrt(x)", "x"]]) assert(!mathExpressionsEquivalent(left!, right!), "opaque domain cannot disappear");
assert.equal(cartesianLineCoefficients("1/x", "y"), null);
assert.equal(cartesianLineCoefficients("y-y", "0"), null);
assert.deepEqual(cartesianLineCoefficients("5e-324*y", "0"), { x: 0, y: 1, constant: 0 });
assert.equal(cartesianLineCoefficients("1e-5*x+y", "1e12")?.x, 1e-5);
assert.equal(cartesianLineCoefficients("1e12*x+1e-5*x-1e12*x+y", "0")?.x, 1e-5);
for (const label of ["f(x)=x^2", "C: y=x^2", "y-x^2=0", "2*y=2*x*x"]) {
  const equation = readCartesianEquationLabel(label);
  assert(equation);
  assert(mathExpressionsEquivalent(`(${equation.lhs})-(${equation.rhs})`, "y-x^2", { allowNonzeroScale: true }), label);
}
console.log("function source identity: exact polynomial, equation-label, domain and bounded-work controls passed");
