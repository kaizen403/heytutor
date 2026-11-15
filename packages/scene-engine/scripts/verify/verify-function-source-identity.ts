import assert from "node:assert/strict";
import { isAffineMathExpression, mathExpressionsEquivalent } from "../../src/math/expression";
import { readCartesianEquationLabel } from "../../src/compile/qualitativeLabelTruth";

for (const [left, right] of [
  ["x*x", "x^2"], ["(x+1)*(x-1)", "x^2-1"], ["x/2", "0.5*x"],
  ["(x+y)^2", "x^2+2*x*y+y^2"], ["x-x", "0"], ["sin(x)", "sin(x)"],
]) assert(mathExpressionsEquivalent(left!, right!), `${left} = ${right}`);
for (const [left, right] of [
  ["x", "x^2"], ["0", "4"], ["2*x^2", "x^2"], ["x/x", "1"],
  ["sqrt(x)^2", "x"], ["x^2", "x^2+0.00000000000001"], ["sin(x)", "cos(x)"],
]) assert(!mathExpressionsEquivalent(left!, right!), `${left} must not gain ${right}'s authority`);
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
for (const label of ["f(x)=x^2", "C: y=x^2", "y-x^2=0", "2*y=2*x*x"]) {
  const equation = readCartesianEquationLabel(label);
  assert(equation);
  assert(mathExpressionsEquivalent(`(${equation.lhs})-(${equation.rhs})`, "y-x^2", { allowNonzeroScale: true }), label);
}
console.log("function source identity: exact polynomial, equation-label, domain and bounded-work controls passed");
