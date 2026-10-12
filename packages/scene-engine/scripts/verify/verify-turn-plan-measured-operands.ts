/** This session owns unit/symbol collision regressions; all questions are authored here. */
import assert from "node:assert/strict";
import { reconcileTurnPlanV3ExplicitArithmetic, validateTurnPlanV3, type TurnPlanV3 } from "../../src/index";

const wordings = [
  "A conductor has cross-sectional area A = 0.8 mm² and resistance R = 12 ohm. Plot V against current I up to 3 A.",
  "Sketch potential difference versus current for a 12-ohm wire with area A = 0.8 mm², from zero to 3 amperes.",
  "Show the V-I characteristic of a conductor: R = 12 Ω, A = 0.8 mm², and the largest current is 3 A.",
  "For a wire of area A = 0.8 square millimetres and resistance 12 ohms, find the voltage at 3 A and draw its graph.",
  "Draw a voltage-current line for a resistor with R = 12 Ω and area A = 0.8 mm². Use I = 3 A for the endpoint.",
];

function plan(question: string, sourceText: string, value = 36): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
    givens: [
      { id: "area", symbol: "A", value: 0.8, unit: "mm²", provenance: "given" },
      { id: "resistance", symbol: "R", value: 12, unit: "Ω", provenance: "given" },
      { id: "maximum_current", symbol: "I_max", value: 3, unit: "A", provenance: "given" },
    ],
    unknowns: [{ id: "maximum_voltage", symbol: "V_max", unit: "V" }],
    derived: [{ id: "maximum_voltage", symbol: "V_max", value, unit: "V", provenance: "derived",
      dependsOn: ["resistance", "maximum_current"], sourceText }],
    qualitativeClaims: [], lawIds: ["ohms_law"], assumptions: [],
  };
}

let checks = 0;
const failures: string[] = [];
function check(name: string, condition: boolean) {
  checks++;
  if (!condition) failures.push(name);
}
for (const question of wordings) {
  for (const source of [
    "V_max = I_max R = (3.0 A)(12 Ω) = 36 V",
    "V_max = (3.0 A)(12 Ω) = 36 V",
    "V_max = I_max*R = 3.0*12 = 36 V",
  ]) {
    const input = plan(question, source);
    const raw = validateTurnPlanV3(input, question);
    const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
    check("correct arithmetic does not multiply the ampere label by area", raw.valid);
    check("correct value is never rewritten through an area/ampere collision", reconciled.reconciliations.length === 0);
    check("correct arithmetic survives live reconciliation order", validateTurnPlanV3(reconciled.plan, question).valid);
  }
  const wrong = plan(question, "V_max = I_max R = (3.0 A)(12 Ω) = 37 V", 37);
  check("a wrong written voltage remains rejected", !validateTurnPlanV3(wrong, question).valid);
  const wrongClaim = plan(question, "V_max = I_max*R = 3*12 = 36 V");
  wrongClaim.qualitativeClaims = [{ id: "voltage", claim: "V_max = 37 V", expected: true,
    relatedQuantityIds: ["maximum_voltage"] }];
  check("wrong attributed claim remains rejected", validateTurnPlanV3(wrongClaim, question).issues.some(x => x.code === "claim_quantity_mismatch"));
  const unexplained = plan(question, "V_max = I_max*R = 3*12 = 36 V");
  unexplained.qualitativeClaims = [{ id: "plot", claim: "The line goes through (0 A, 0 V) and (3 A, 36 V).",
    expected: true, relatedQuantityIds: ["maximum_current", "maximum_voltage"] }];
  check("an unrepresented coordinate is not excused as the endpoint", validateTurnPlanV3(unexplained, question).issues.some(x => x.code === "claim_quantity_mismatch"));
}

// Explicit products retain their variable meaning even if the symbol is a unit.
for (const [symbol, unit, source] of [
  ["A", "mm²", "D = 2*A = 1.6 mm²"],
  ["N", "N", "D = 2*N = 1.6 N"],
] as const) {
  const input = plan("Find twice the supplied quantity.", source, 1.6);
  input.givens = [{ id: "input", symbol, value: 0.8, unit, provenance: "given" }];
  input.unknowns = [{ id: "double_quantity", symbol: "D", unit }];
  input.derived = [{ id: "double_quantity", symbol: "D", value: 1.6, unit, provenance: "derived", sourceText: source, dependsOn: ["input"] }];
  check("explicit coefficient multiplication retains the bound variable", validateTurnPlanV3(input).valid);
}
// A digit at the end of a symbol must not turn its following variable into a unit.
for (const [value, source, expected] of [
  [10, "F = mu1 N = 10 N", true],
  [0.25, "F = mu1 N = 0.25 N", false],
] as const) {
  const input = plan("Find the friction force for N = 40 N and coefficient mu1 = 0.25.", source, value);
  input.givens = [
    { id: "coefficient", symbol: "mu1", value: 0.25, provenance: "given" },
    { id: "normal_force", symbol: "N", value: 40, unit: "N", provenance: "given" },
  ];
  input.unknowns = [{ id: "friction", symbol: "F", unit: "N" }];
  input.derived = [{ id: "friction", symbol: "F", value, unit: "N", sourceText: source,
    provenance: "derived", dependsOn: ["coefficient", "normal_force"] }];
  check("a symbol's trailing digit never becomes a measured literal", validateTurnPlanV3(input).valid === expected);
}
// Glued coefficients of an existing symbol remain products, not unit labels.
// The original measured operand '(3.0 A)' is explicitly space-delimited.
for (const [symbol, unit] of [["N", "N"], ["A", "mm²"]] as const) {
  for (const expression of [`2${symbol}+${symbol}`, `2.0${symbol}+${symbol}`, `2e0${symbol}+${symbol}`, `2(${symbol})+${symbol}`, `2*${symbol}+${symbol}`]) {
    const input = plan("Find three times an authored input quantity of 40.", `D = ${expression} = 120 ${unit}`, 120);
    input.givens = [{ id: "coefficient_input", symbol, value: 40, unit, provenance: "given" }];
    // A is also a known measured unit even when the supplied A names area.
    if (symbol === "A") input.givens.push({ id: "separate_current", symbol: "I", value: 1, unit: "A", provenance: "given" });
    input.unknowns = [{ id: "coefficient_result", symbol: "D", unit }];
    input.derived = [{ id: "coefficient_result", symbol: "D", value: 120, unit, provenance: "derived",
      dependsOn: ["coefficient_input"], sourceText: `D = ${expression} = 120 ${unit}` }];
    check("a glued coefficient keeps the bound symbol", validateTurnPlanV3(input).valid);
    check("a correct symbolic product is never rewritten as a unit-only scalar", reconcileTurnPlanV3ExplicitArithmetic(input).reconciliations.length === 0);
    const wrong = structuredClone(input);
    wrong.derived[0]!.value = 42; wrong.derived[0]!.sourceText = `D = ${expression} = 42 ${unit}`;
    check("a wrong unit-only scalar stays rejected for a bound-symbol product", !validateTurnPlanV3(wrong).valid);
  }
}
for (const value of [87, 42]) {
  const input = plan("Find twice the explicitly named e0N = 40 N quantity plus a separate N = 7 N.", `D = 2e0N + N = ${value} N`, value);
  input.givens = [{ id: "long_name", symbol: "e0N", value: 40, unit: "N", provenance: "given" },
    { id: "other_force", symbol: "N", value: 7, unit: "N", provenance: "given" }];
  input.unknowns = [{ id: "double_long_name", symbol: "D", unit: "N" }];
  input.derived = [{ id: "double_long_name", symbol: "D", value, unit: "N", provenance: "derived",
    dependsOn: ["long_name", "other_force"], sourceText: `D = 2e0N + N = ${value} N` }];
  check("an explicitly bound longer scientific-looking name stays authoritative", validateTurnPlanV3(input).valid === (value === 87));
}
for (const value of [21, 9]) {
  const input = plan("Find three times e0N = 7 N, with no separate N variable.", `D = 2e0N + e0N = ${value} N`, value);
  input.givens = [{ id: "only_long_name", symbol: "e0N", value: 7, unit: "N", provenance: "given" }];
  input.unknowns = [{ id: "triple_long_name", symbol: "D", unit: "N" }];
  input.derived = [{ id: "triple_long_name", symbol: "D", value, unit: "N", provenance: "derived",
    dependsOn: ["only_long_name"], sourceText: `D = 2e0N + e0N = ${value} N` }];
  check("longer bindings protect their unit-looking suffix without a second suffix variable", validateTurnPlanV3(input).valid === (value === 21));
  if (value === 21) check("the longer-name product is never rewritten by measured-label stripping", reconcileTurnPlanV3ExplicitArithmetic(input).reconciliations.length === 0);
}
for (const expression of ["(3*4) V", "(3*4)V", "(3*(2+2)) V"]) {
  for (const value of [12, 99]) {
    const input = plan("Evaluate the explicitly authored voltage arithmetic.", `D = ${expression} = ${value} V`, value);
    input.givens = []; input.unknowns = [{ id: "group_result", symbol: "D", unit: "V" }];
    input.derived = [{ id: "group_result", symbol: "D", value, unit: "V", provenance: "derived", sourceText: `D = ${expression} = ${value} V` }];
    check("an original parenthesized result unit cannot hide wrong arithmetic", validateTurnPlanV3(input).valid === (value === 12));
    if (value === 12) check("a correct grouped result stays unchanged", reconcileTurnPlanV3ExplicitArithmetic(input).reconciliations.length === 0);
  }
}
for (const value of [160, 43]) {
  const input = plan("Evaluate an authored grouped coefficient of a normal force N = 40 N.", `D = (2+1)N + N = ${value} N`, value);
  input.givens = [{ id: "group_force", symbol: "N", value: 40, unit: "N", provenance: "given" }];
  input.unknowns = [{ id: "group_product", symbol: "D", unit: "N" }];
  input.derived = [{ id: "group_product", symbol: "D", value, unit: "N", provenance: "derived", sourceText: `D = (2+1)N + N = ${value} N`, dependsOn: ["group_force"] }];
  check("an original grouped bound-variable product is not a result unit", validateTurnPlanV3(input).valid === (value === 160));
}
// Compound unit spellings may themselves be products of bound variables.
// Do not erase N*m as a label when its N and m actually supply arithmetic.
for (const [unit, product, expected] of [
  ["N*m", "N*m", 240], ["N/m", "N/m", 60],
  ["N*m^2", "N*m^2", 480], ["N/m^2", "N/m^2", 30],
  ["Nm", "Nm", 240],
] as const) {
  for (const coefficient of ["(2+1)", "(2+1) ", "3", "3e0"]) {
    for (const value of [expected, 3]) {
      // A lone "3 N*m" is a measured scalar, not an unambiguous product.
      // Numeric coefficients include an explicit operation to test arithmetic.
      const expression = `${coefficient}${product}${coefficient.startsWith("(") ? "" : " + 0"}`;
      const input = plan("Evaluate a product of authored N = 40 N and m = 2 m quantities.", `D = ${expression} = ${value} ${unit}`, value);
      input.givens = [
        { id: "compound_force", symbol: "N", value: 40, unit: "N", provenance: "given" },
        { id: "compound_length", symbol: "m", value: 2, unit: "m", provenance: "given" },
      ];
      input.unknowns = [{ id: "compound_result", symbol: "D", unit }];
      input.derived = [{ id: "compound_result", symbol: "D", value, unit, provenance: "derived",
        sourceText: `D = ${expression} = ${value} ${unit}`, dependsOn: ["compound_force", "compound_length"] }];
      check(`compound ${expression} at ${value} retains every factor`, validateTurnPlanV3(input).valid === (value === expected));
      check(`compound ${expression} at ${value} reconciles to ${expected}, not a stripped coefficient`, reconcileTurnPlanV3ExplicitArithmetic(input).plan.derived[0]?.value === expected);
    }
  }
}
for (const unit of ["N*m", "N/m", "N*m^2", "N/m^2"]) {
  for (const value of [12, 99]) {
    const source = `D = (3*4) ${unit} = ${value} ${unit}`;
    const input = plan("Evaluate authored numeric arithmetic followed by an unbound compound unit label.", source, value);
    input.givens = []; input.unknowns = [{ id: "unbound_compound_result", symbol: "D", unit }];
    input.derived = [{ id: "unbound_compound_result", symbol: "D", value, unit, provenance: "derived", sourceText: source }];
    check(`unbound ${unit} result labels cannot hide wrong arithmetic`, validateTurnPlanV3(input).valid === (value === 12));
    check(`unbound ${unit} result labels reconcile to numeric12`, reconcileTurnPlanV3ExplicitArithmetic(input).plan.derived[0]?.value === 12);
  }
}
// An incompletely bound compound still has its existing unit-label meaning.
// Protecting only one factor must not make numeric grouped arithmetic unreadable.
for (const unit of ["N*m", "N/m", "N*m^2", "N/m^2", "Nm", "N*e", "N*E", "N/e", "N/E", "N*e3", "N/e3"]) {
  for (const symbol of ["N", "m"]) {
    for (const value of [12, 99]) {
      const source = `D = (3*4) ${unit} = ${value} ${unit}`;
      const input = plan("Evaluate authored grouped arithmetic with a compound result unit and one separately bound symbol.", source, value);
      input.givens = [{ id: "partial_binding", symbol, value: symbol === "N" ? 40 : 2, unit: symbol, provenance: "given" }];
      input.unknowns = [{ id: "partial_compound_result", symbol: "D", unit }];
      input.derived = [{ id: "partial_compound_result", symbol: "D", value, unit, provenance: "derived", sourceText: source }];
      check(`partially bound ${unit}/${symbol} labels keep wrong arithmetic checked`, validateTurnPlanV3(input).valid === (value === 12));
      check(`partially bound ${unit}/${symbol} labels reconcile to numeric12`, reconcileTurnPlanV3ExplicitArithmetic(input).plan.derived[0]?.value === 12);
    }
  }
}
// Undefined/overflowing products retain the parent unit-label numeric check.
// This does not claim general zero-division validation: numeric12 is the label
// interpretation, but an arbitrary wrong99 must not become newly unreadable.
for (const [unit, length, force] of [["N/m", 0, 40], ["N/m^2", 0, 40], ["N*m", 1e308, 1e308]] as const) {
  for (const value of [12, 99]) {
    const source = `D = (3*4) ${unit} = ${value} ${unit}`;
    const input = plan("Evaluate authored grouped arithmetic followed by a compound result unit.", source, value);
    input.givens = [
      { id: "nonfinite_force", symbol: "N", value: force, unit: "N", provenance: "given" },
      { id: "nonfinite_length", symbol: "m", value: length, unit: "m", provenance: "given" },
    ];
    input.unknowns = [{ id: "nonfinite_label_result", symbol: "D", unit }];
    input.derived = [{ id: "nonfinite_label_result", symbol: "D", value, unit, provenance: "derived", sourceText: source }];
    check(`undefined ${unit} products retain the parent wrong-result check`, validateTurnPlanV3(input).valid === (value === 12));
    check(`undefined ${unit} products retain the numeric-label reconciliation`, reconcileTurnPlanV3ExplicitArithmetic(input).plan.derived[0]?.value === 12);
  }
}
for (const expression of ["(3*4)N*m", "12*N*m"]) {
  const expected = 9.6e-17;
  for (const [value, written, valid] of [[expected, expected, true], [1.92e-16, 1.92e-16, false], [1.92e-16, expected, false], [-expected, -expected, false]] as const) {
    const source = `D = ${expression} = ${written} N*m`;
    const input = plan("Evaluate an authored product with N = 4e-9 N and m = 2e-9 m.", source, value);
    input.givens = [
      { id: "tiny_force", symbol: "N", value: 4e-9, unit: "N", provenance: "given" },
      { id: "tiny_length", symbol: "m", value: 2e-9, unit: "m", provenance: "given" },
    ];
    input.unknowns = [{ id: "tiny_result", symbol: "D", unit: "N*m" }];
    input.derived = [{ id: "tiny_result", symbol: "D", value, unit: "N*m", provenance: "derived", sourceText: source,
      dependsOn: ["tiny_force", "tiny_length"] }];
    check(`tiny ${expression} metadata${value}/written${written} retains numeric authority`, validateTurnPlanV3(input).valid === valid);
    const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
    check(`tiny ${expression} never retains a two-times or wrong-sign result`, Math.abs((reconciled.plan.derived[0]?.value ?? NaN) - expected) <= expected * 1e-12);
    if (valid) check(`correct tiny ${expression} is never rewritten`, reconciled.reconciliations.length === 0);
  }
  for (const value of [0, 1e-16]) {
    const source = `D = ${expression} = ${value} N*m`;
    const input = plan("Evaluate an authored zero force times a length of 2 m.", source, value);
    input.givens = [{ id: "zero_force", symbol: "N", value: 0, unit: "N", provenance: "given" },
      { id: "zero_length", symbol: "m", value: 2, unit: "m", provenance: "given" }];
    input.unknowns = [{ id: "zero_result", symbol: "D", unit: "N*m" }];
    input.derived = [{ id: "zero_result", symbol: "D", value, unit: "N*m", provenance: "derived", sourceText: source }];
    check(`zero ${expression} cannot authorize a tiny nonzero answer`, validateTurnPlanV3(input).valid === (value === 0));
    check(`zero ${expression} reconciles exactly to zero`, reconcileTurnPlanV3ExplicitArithmetic(input).plan.derived[0]?.value === 0);
  }
}
for (const expression of ["0.3-0.2-0.1", "0.3-(0.2+0.1)", "3e-17-2e-17-1e-17", "cos(90°)", "sin(pi)", "sqrt(2)*sqrt(2)-2"]) {
  for (const literal of ["0", "0.0000000000000000000000000000000000000000"]) {
    const source = `D = ${expression} = ${literal} V`;
    const input = plan("Evaluate an authored cancellation that gives zero.", source, 0);
    input.givens = []; input.unknowns = [{ id: "cancellation_result", symbol: "D", unit: "V" }];
    input.derived = [{ id: "cancellation_result", symbol: "D", value: 0, sign: "zero", unit: "V", provenance: "derived", sourceText: source }];
    check(`zero ${expression}/${literal} does not falsely decline`, validateTurnPlanV3(input).valid);
    const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
    check(`zero ${expression} stays exactly zero`, reconciled.plan.derived[0]?.value === 0);
    check(`zero ${expression} never gains a floating-residue sign`, reconciled.plan.derived[0]?.sign === "zero");
    check(`zero ${expression} is not rewritten`, reconciled.reconciliations.length === 0);
  }
  const source = `D = ${expression} = 1e-16 V`;
  const wrong = plan("Evaluate an authored cancellation that gives zero, not a tiny nonzero value.", source, 1e-16);
  wrong.givens = []; wrong.unknowns = [{ id: "cancellation_result", symbol: "D", unit: "V" }];
  wrong.derived = [{ id: "cancellation_result", symbol: "D", value: 1e-16, unit: "V", provenance: "derived", sourceText: source }];
  check(`zero ${expression} cannot support a tiny nonzero claim`, !validateTurnPlanV3(wrong).valid);
  check(`wrong ${expression} reconciles exactly to zero`, reconcileTurnPlanV3ExplicitArithmetic(wrong).plan.derived[0]?.value === 0);
}
for (const [expression, expected] of [["sin(1e-9)", 1e-9], ["sqrt(1e-18)", 1e-9], ["1-1+1e-17", 1e-17],
  ["1.0000000000000002-1", 2e-16], ["1-(1-1e-16)", 1e-16], ["1.0000000000000001-1", 1e-16],
  ["0.5-0.5+1e-17", 1e-17], ["0.3-0.3+1e-17", 1e-17]] as const) {
  for (const value of [expected, expected * 2]) {
    const source = `D = ${expression} = ${value} V`;
    const input = plan("Evaluate an authored genuinely nonzero small expression.", source, value);
    input.givens = []; input.unknowns = [{ id: "nonzero_small_result", symbol: "D", unit: "V" }];
    input.derived = [{ id: "nonzero_small_result", symbol: "D", value, unit: "V", provenance: "derived", sourceText: source }];
    check(`real small ${expression} has no absolute slack`, validateTurnPlanV3(input).valid === (value === expected));
    const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
    check(`real small ${expression} is never erased or doubled`, Math.abs((reconciled.plan.derived[0]?.value ?? NaN) - expected) <= expected * 1e-12);
    if (value === expected) check(`real small ${expression} stays unchanged`, reconciled.reconciliations.length === 0);
  }
  const source = `D = ${expression} = 0.0000000000000000000000000000000000000000 V`;
  const wrongZero = plan("Evaluate an authored nonzero difference, not an exact zero.", source, 0);
  wrongZero.givens = []; wrongZero.unknowns = [{ id: "nonzero_small_result", symbol: "D", unit: "V" }];
  wrongZero.derived = [{ id: "nonzero_small_result", symbol: "D", value: 0, unit: "V", provenance: "derived", sourceText: source }];
  check(`nonzero ${expression} is not fabricated into a precise zero`, !validateTurnPlanV3(wrongZero).valid);
}
for (const expression of ["sqrt(100000000000-100000000000.000001)^2", "sqrt(100000000000-100000000000.000001)*sqrt(100000000000-100000000000.000001)"]) {
  const source = `D = ${expression} = -1e-6 V`;
  const input = plan("Do not turn an exactly negative radicand into a real negative square.", source, -1e-6);
  input.givens = []; input.unknowns = [{ id: "invalid_square_result", symbol: "D", unit: "V" }];
  input.derived = [{ id: "invalid_square_result", symbol: "D", value: -1e-6, unit: "V", provenance: "derived", sourceText: source }];
  check("a real square identity needs an exactly nonnegative radicand", !validateTurnPlanV3(input).valid);
  check("an invalid square identity never authorizes the negative radicand as its result", reconcileTurnPlanV3ExplicitArithmetic(input).plan.derived[0]?.value !== -1e-6);
}
assert.equal(failures.length, 0, `${failures.length}/${checks} failed: ${[...new Set(failures)].join("; ")}`);
console.log(`verify-turn-plan-measured-operands: ${checks} checks pass; five authored wordings, real arithmetic and claim contradictions retained`);
