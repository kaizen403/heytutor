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
assert.equal(failures.length, 0, `${failures.length}/${checks} failed: ${[...new Set(failures)].join("; ")}`);
console.log(`verify-turn-plan-measured-operands: ${checks} checks pass; five authored wordings, real arithmetic and claim contradictions retained`);
