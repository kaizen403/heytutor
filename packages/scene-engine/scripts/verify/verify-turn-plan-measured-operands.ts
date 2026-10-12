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
// #160 FIX FIRST: a space-delimited mass is still a multiplicand before v.
// Use a non-routed law ID so only source arithmetic supplies this authority.
const reviewedKineticQuestion = "A body has mass m = 2 kg, speed v = 3 m/s and height h = 5 m. Find its kinetic energy.";
const reviewedWrongKinetic: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question: reviewedKineticQuestion, visualRequirement: "required",
  givens: [
    { id: "mass", symbol: "m", value: 2, unit: "kg", provenance: "given" },
    { id: "speed", symbol: "v", value: 3, unit: "m/s", provenance: "given" },
    { id: "height", symbol: "h", value: 5, unit: "m", provenance: "given" },
  ],
  unknowns: [{ id: "result", symbol: "X", unit: "J" }],
  derived: [{ id: "result", symbol: "X", value: 4.5, unit: "J", provenance: "derived",
    dependsOn: ["mass", "speed"], sourceText: "KE = 0.5 m v^2 = 0.5 * 9 = 4.5 J" }],
  qualitativeClaims: [], lawIds: ["x"], assumptions: [],
};
type PhysicalArithmeticCase = { name: string; input: TurnPlanV3; valid: boolean; truth: number };
function physicalPlan(question: string, givens: TurnPlanV3["givens"], sourceText: string, value: number, unit: string): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: structuredClone(givens),
    unknowns: [{ id: "result", symbol: "X", unit }],
    derived: [{ id: "result", symbol: "X", value, unit, provenance: "derived", sourceText, dependsOn: givens.map(given => given.id) }],
    qualitativeClaims: [], lawIds: ["x"], assumptions: [] };
}
function checkPhysicalArithmetic({ name, input, valid, truth }: PhysicalArithmeticCase) {
  const original = JSON.stringify(input);
  const raw = validateTurnPlanV3(input, input.question);
  check(`${name}: actual validator ${valid ? "accepts the correct" : "rejects the wrong"} value`, raw.valid === valid);
  if (!valid) check(`${name}: arithmetic, not a separate law router, rejects the value`, raw.issues.some(issue => issue.code === "source_text_arithmetic_invalid"));
  const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
  const value = reconciled.plan.derived[0]?.value;
  const exactTruth = typeof value === "number" && Math.abs(value - truth) <= Math.abs(truth) * 1e-12;
  if (valid) {
    // Written rounding can canonicalize to the full correct result, never to
    // a coefficient left after deleting a physical operand.
    check(`${name}: reconciliation keeps the correct value or its precise truth`, value === input.derived[0]?.value || exactTruth);
    if (input.derived[0]?.value === truth) check(`${name}: exact correct arithmetic is not rewritten`, reconciled.reconciliations.length === 0);
    check(`${name}: the correctly reconciled plan remains valid`, validateTurnPlanV3(reconciled.plan, input.question).valid);
  } else {
    check(`${name}: reconciliation never invents a third, stripped-operand value`, value === input.derived[0]?.value || exactTruth);
    check(`${name}: reconciliation cannot authorize the known wrong result`, !validateTurnPlanV3(reconciled.plan, input.question).valid || exactTruth);
  }
  check(`${name}: reconciliation does not mutate the source plan`, JSON.stringify(input) === original);
}
const fallQuestion = "A body has mass m = 200 g. With g = 9.8 m/s^2 it falls from rest through h = 5 m. Find its speed.";
const fallGivens: TurnPlanV3["givens"] = [
  { id: "mass", symbol: "m", value: 200, unit: "g", provenance: "given" },
  { id: "gravity", symbol: "g", value: 9.8, unit: "m/s^2", provenance: "given" },
  { id: "height", symbol: "h", value: 5, unit: "m", provenance: "given" },
];
const capacitorQuestion = "A capacitor has capacitance C = 1e-5 F, voltage V = 12 V and charge Q = 1.2e-4 C. Find its stored energy.";
const capacitorGivens: TurnPlanV3["givens"] = [
  { id: "capacitance", symbol: "C", value: 1e-5, unit: "F", provenance: "given" },
  { id: "voltage", symbol: "V", value: 12, unit: "V", provenance: "given" },
  { id: "charge", symbol: "Q", value: 1.2e-4, unit: "C", provenance: "given" },
];
const reviewUnitProducts: PhysicalArithmeticCase[] = [
  { name: "review wrong decimal KE", input: reviewedWrongKinetic, valid: false, truth: 9 },
  { name: "review wrong fractional KE", input: physicalPlan(reviewedKineticQuestion, reviewedWrongKinetic.givens, "KE = 1/2 m v^2 = 4.5 J", 4.5, "J"), valid: false, truth: 9 },
  { name: "review wrong falling speed", input: physicalPlan(fallQuestion, fallGivens, "v = sqrt(2 g h) = 3.16227766 m/s", 3.162, "m/s"), valid: false, truth: 9.899494936611665 },
  { name: "review wrong capacitor energy", input: physicalPlan(capacitorQuestion, capacitorGivens, "U = 1/2 C V^2 = 72 J", 72, "J"), valid: false, truth: 0.00072 },
  { name: "review correct decimal KE", input: physicalPlan(reviewedKineticQuestion, reviewedWrongKinetic.givens, "KE = 0.5 m v^2 = 0.5 * 2 * 9 = 9 J", 9, "J"), valid: true, truth: 9 },
  { name: "review correct fractional KE", input: physicalPlan(reviewedKineticQuestion, reviewedWrongKinetic.givens, "KE = 1/2 m v^2 = 0.5 × 2 × 3^2 = 9 J", 9, "J"), valid: true, truth: 9 },
  { name: "review correct scaled force", input: physicalPlan("A body has m = 3 kg, acceleration a = 2 m/s^2 and height h = 5 m. Find three times its accelerating force.", [
    { id: "mass", symbol: "m", value: 3, unit: "kg", provenance: "given" },
    { id: "acceleration", symbol: "a", value: 2, unit: "m/s^2", provenance: "given" },
    { id: "height", symbol: "h", value: 5, unit: "m", provenance: "given" },
  ], "F = 3 m a = 3 × 3 × 2 = 18 N", 18, "N"), valid: true, truth: 18 },
  { name: "review correct falling speed", input: physicalPlan(fallQuestion, fallGivens, "v = sqrt(2 g h) = sqrt(98) = 9.899 m/s", 9.899, "m/s"), valid: true, truth: 9.899494936611665 },
  { name: "review correct capacitor energy", input: physicalPlan(capacitorQuestion, capacitorGivens, "U = 1/2 C V^2 = 0.5*1e-5*144 = 7.2e-4 J", 0.00072, "J"), valid: true, truth: 0.00072 },
];
for (const input of reviewUnitProducts) checkPhysicalArithmetic(input);
// Ten separately authored physical/expression cases. Each has a literal
// worked truth and a self-consistent arithmetic slip that drops a binding.
const given = (id: string, symbol: string, value: number, unit: string): TurnPlanV3["givens"][number] => ({ id, symbol, value, unit, provenance: "given" });
// #160 re-review: textbook measured substitutions must remain readable when
// their labels collide with symbols or use a different scale from the givens.
// These questions and circuit fixtures are independently authored here.
const conversionRegressions: Array<{ name: string; question: string; givens: TurnPlanV3["givens"]; unit: string; truth: number; expression: string; rightResult: string; wrongValue: number; wrongResult: string }> = [
  { name: "textbook measured Ohm current", question: "An ohmic component has V = 12 V across R = 6 Ω. Calculate the current in amperes.",
    givens: [given("voltage", "V", 12, "V"), given("resistance", "R", 6, "Ω")], unit: "A", truth: 2,
    expression: "12 V / 6 Ω", rightResult: "2 A", wrongValue: 24, wrongResult: "24 A" },
  { name: "gram given with kilogram working", question: "Raise a 500 g parcel through h = 3 m in gravity g = 9.8 m/s^2. Find the gravitational energy gained in joules.",
    givens: [given("mass", "m", 500, "g"), given("gravity", "g", 9.8, "m/s^2"), given("height", "h", 3, "m")], unit: "J", truth: 14.7,
    expression: "0.5 kg * 9.8 m/s^2 * 3 m", rightResult: "14.7 J", wrongValue: 14700, wrongResult: "14700 J" },
  { name: "microfarad given with farad charge working", question: "A capacitor C = 4 μF is held at V = 6 V. Calculate its charge in microcoulombs.",
    givens: [given("capacitance", "C", 4, "μF"), given("voltage", "V", 6, "V")], unit: "μC", truth: 24,
    expression: "4e-6 F * 6 V", rightResult: "2.4e-5 C = 24 μC", wrongValue: 2.4, wrongResult: "2.4e-6 C = 2.4 μC" },
  { name: "microfarad given with farad energy working", question: "A capacitor C = 2 μF has potential difference V = 100 V. Find its stored energy in joules.",
    givens: [given("capacitance", "C", 2, "μF"), given("voltage", "V", 100, "V")], unit: "J", truth: 0.01,
    expression: "0.5 * 2e-6 F * (100 V)^2", rightResult: "0.01 J", wrongValue: 10000, wrongResult: "10000 J" },
  { name: "projectile gravity symbol with gram mass supplied", question: "A 50 g object starts at u = 20 m/s at angle θ = 30 degrees. With g = 10 m/s^2, find its maximum height above the launch point.",
    givens: [given("mass", "m", 50, "g"), given("speed", "u", 20, "m/s"), given("angle", "θ", 30, "deg"), given("gravity", "g", 10, "m/s^2")], unit: "m", truth: 5,
    expression: "u^2 sin^2(θ)/(2 g)", rightResult: "5 m", wrongValue: 50, wrongResult: "50 m" },
];
for (const entry of conversionRegressions) {
  for (const [value, valid, result] of [[entry.truth, true, entry.rightResult], [entry.wrongValue, false, entry.wrongResult]] as const) {
    checkPhysicalArithmetic({ name: `re-review ${entry.name}/${valid ? "right" : "wrong"}`, valid, truth: entry.truth,
      input: physicalPlan(entry.question, entry.givens, `X = ${entry.expression} = ${result}`, value, entry.unit) });
  }
}
// Coherent-unit givens and an unused-mass-free projectile are paired controls:
// the same literal working must not acquire or lose authority from metadata.
const coherentConversionControls = conversionRegressions.map(entry => ({ ...entry, givens: structuredClone(entry.givens), name: `coherent control ${entry.name}` }));
coherentConversionControls[0]!.givens[0]!.symbol = "U";
coherentConversionControls[0]!.question = "An ohmic component has U = 12 V across R = 6 Ω. Calculate the current in amperes.";
coherentConversionControls[1]!.givens[0] = given("mass", "m", 0.5, "kg");
coherentConversionControls[1]!.question = "Raise a 0.5 kg parcel through h = 3 m in gravity g = 9.8 m/s^2. Find the gravitational energy gained in joules.";
coherentConversionControls[2]!.givens[0] = given("capacitance", "C", 4e-6, "F");
coherentConversionControls[2]!.question = "A capacitor C = 4e-6 F is held at V = 6 V. Calculate its charge in microcoulombs.";
coherentConversionControls[3]!.givens[0] = given("capacitance", "C", 2e-6, "F");
coherentConversionControls[3]!.question = "A capacitor C = 2e-6 F has potential difference V = 100 V. Find its stored energy in joules.";
coherentConversionControls[4]!.givens = coherentConversionControls[4]!.givens.filter(quantity => quantity.id !== "mass");
coherentConversionControls[4]!.question = "An object starts at u = 20 m/s at angle θ = 30 degrees. With g = 10 m/s^2, find its maximum height above the launch point.";
coherentConversionControls[4]!.expression = "u^2 (sin(θ))^2/(2 g)";
for (const entry of coherentConversionControls) {
  for (const [value, valid, result] of [[entry.truth, true, entry.rightResult], [entry.wrongValue, false, entry.wrongResult]] as const) {
    checkPhysicalArithmetic({ name: `re-review ${entry.name}/${valid ? "right" : "wrong"}`, valid, truth: entry.truth,
      input: physicalPlan(entry.question, entry.givens, `X = ${entry.expression} = ${result}`, value, entry.unit) });
  }
}
for (const entry of [
  { name: "explicit voltage symbol product", base: conversionRegressions[0]!, expression: "2 * V / R", truth: 4, wrong: 2 },
  { name: "explicit capacitance symbol product", base: conversionRegressions[2]!, expression: "2 * C * V", truth: 48, wrong: 12 },
  { name: "explicit gravity symbol denominator", base: conversionRegressions[4]!, expression: "u^2 (sin(θ))^2/(2 * g)", truth: 5, wrong: 50 },
]) {
  for (const [value, valid] of [[entry.truth, true], [entry.wrong, false]] as const) {
    checkPhysicalArithmetic({ name: `re-review ${entry.name}/${valid ? "right" : "wrong"}`, valid, truth: entry.truth,
      input: physicalPlan(entry.base.question, entry.base.givens, `X = ${entry.expression} = ${value} ${entry.base.unit}`, value, entry.base.unit) });
  }
}
// Three complete public series plans exercise the recorded regression shapes:
// explanatory arithmetic with two prose prefixes and a voltage-drop equality.
for (const style of ["calculation", "explanatory", "voltage-sum"] as const) {
  for (const [current, valid] of [[2, true], [24, false]] as const) {
    const question = "A 12 V source drives two series resistors R_a = 2 Ω and R_b = 4 Ω. Find the current and both voltage drops, and show their sum.";
    const source = (symbol: string, expression: string, result: string) => style === "calculation"
      ? `Evaluate ${symbol}: ${expression} = ${result}.` : `Calculate ${symbol}: ${expression} = ${result}.`;
    const input: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
      givens: [given("supply", "V", 12, "V"), given("first", "R_a", 2, "Ω"), given("second", "R_b", 4, "Ω")],
      unknowns: [{ id: "current", symbol: "I", unit: "A" }, { id: "first_drop", symbol: "V_a", unit: "V" }, { id: "second_drop", symbol: "V_b", unit: "V" }],
      derived: [
        { id: "total", symbol: "R_total", value: 6, unit: "Ω", provenance: "derived", dependsOn: ["first", "second"], sourceText: source("R_total", "2 Ω + 4 Ω", "6 Ω") },
        { id: "current", symbol: "I", value: current, unit: "A", provenance: "derived", dependsOn: ["supply", "total"], sourceText: source("I", "12 V / 6 Ω", `${current} A`) },
        { id: "first_drop", symbol: "V_a", value: 4, unit: "V", provenance: "derived", dependsOn: ["current", "first"], sourceText: source("V_a", "2 A * 2 Ω", "4 V") },
        { id: "second_drop", symbol: "V_b", value: 8, unit: "V", provenance: "derived", dependsOn: ["current", "second"], sourceText: source("V_b", "2 A * 4 Ω", "8 V") + (style === "voltage-sum" ? " The source check is 4 V + 8 V = 12 V." : "") },
      ], qualitativeClaims: [], lawIds: ["x"], assumptions: [] };
    const original = JSON.stringify(input);
    const raw = validateTurnPlanV3(input, question);
    check(`re-review complete series/${style}/${current}: raw ${valid ? "accepts" : "rejects"}`, raw.valid === valid);
    const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
    const actualCurrent = reconciled.plan.derived.find(quantity => quantity.id === "current")?.value;
    check(`re-review complete series/${style}/${current}: current is never replaced by a third value`, actualCurrent === current || actualCurrent === 2);
    if (valid) {
      check(`re-review complete series/${style}: correct quantities are not rewritten`, reconciled.reconciliations.length === 0);
      check(`re-review complete series/${style}: correct plan survives reconciliation`, validateTurnPlanV3(reconciled.plan, question).valid);
    } else {
      check(`re-review complete series/${style}: wrong current never gains authority`, !validateTurnPlanV3(reconciled.plan, question).valid || actualCurrent === 2);
    }
    check(`re-review complete series/${style}/${current}: input is not mutated`, JSON.stringify(input) === original);
  }
}
// Independent post-fix probes cover the reusable alias/trig paths and the
// sentence-attribution boundary exercised by the voltage-sum circuit fixture.
for (const entry of [
  { name: "milliampere given with ampere power working", question: "An element carries I = 5 mA at V = 12 V. Compute its power in watts.",
    givens: [given("current", "I", 5, "mA"), given("voltage", "V", 12, "V")], expression: "0.005 A * 12 V", truth: 0.06, wrong: 0.6, unit: "W" },
  { name: "milligram given with kilogram energy working", question: "Lift a mass m = 500000 mg through h = 3 m with g = 10 m/s^2. Find the energy gained in joules.",
    givens: [given("mass", "m", 500000, "mg"), given("gravity", "g", 10, "m/s^2"), given("height", "h", 3, "m")], expression: "0.5 kg * 10 m/s^2 * 3 m", truth: 15, wrong: 150, unit: "J" },
  { name: "nanofarad given with farad charge working", question: "A capacitor C = 4000 nF is held at V = 6 V. Find its charge in coulombs.",
    givens: [given("capacitance", "C", 4000, "nF"), given("voltage", "V", 6, "V")], expression: "4e-6 F * 6 V", truth: 2.4e-5, wrong: 2.4e-4, unit: "C" },
]) {
  for (const [value, valid] of [[entry.truth, true], [entry.wrong, false]] as const) {
    checkPhysicalArithmetic({ name: `post-fix ${entry.name}/${valid ? "right" : "wrong"}`, truth: entry.truth, valid,
      input: physicalPlan(entry.question, entry.givens, `X = ${entry.expression} = ${value} ${entry.unit}`, value, entry.unit) });
  }
}
for (const [expression, truth, wrong] of [["cos^2(60°)", 0.25, 2.5], ["sin^3(30°)", 0.125, 1.25]] as const) {
  for (const [value, valid] of [[truth, true], [wrong, false]] as const) {
    const input = physicalPlan("Evaluate the supplied trigonometric expression.", [], `X = ${expression} = ${value}`, value, "1");
    const original = JSON.stringify(input);
    const raw = validateTurnPlanV3(input, input.question);
    check(`post-fix textbook ${expression}/${value}: function power has the expected authority`, raw.valid === valid);
    if (!valid) check(`post-fix textbook ${expression}: computed arithmetic rejects the wrong scalar`, raw.issues.some(issue => issue.code === "source_text_value_mismatch"));
    const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
    check(`post-fix textbook ${expression}/${value}: reconciliation computes the function power`, reconciled.plan.derived[0]?.value === truth);
    check(`post-fix textbook ${expression}/${value}: the reconciled arithmetic is valid`, validateTurnPlanV3(reconciled.plan, input.question).valid);
    if (valid) check(`post-fix textbook ${expression}: the exact correct power is not rewritten`, reconciled.reconciliations.length === 0);
    check(`post-fix textbook ${expression}/${value}: the original plan is unchanged`, JSON.stringify(input) === original);
  }
}
const sentenceGivens = [given("mass", "m", 2, "kg"), given("speed", "v", 3, "m/s"), given("height", "h", 0.5, "m"), given("force", "N", 40, "N"), given("other", "F", 3, "N")];
for (const [name, sourceText, value, valid] of [
  ["unrelated unsupported sentence", "X = 2*3 = 6 J. Check another quantity: 3 N*v = 9 W.", 6, true],
  ["named ambiguous sentence", "X = 2*3 = 6 J. X = 3 N*v = 9 W.", 6, false],
  ["anchored ambiguous sentence", "X = 2*3 = 6 J. Check this quantity: 2 N * 3 m * 1 = 6 J.", 6, false],
  ["wrong earlier named arithmetic", "X = 2*3 = 7 J. Check another quantity: 3 N*v = 9 W.", 7, false],
] as const) {
  const input = physicalPlan("Use the supplied physical quantities to evaluate the written source arithmetic.", sentenceGivens, sourceText, value, "J");
  const original = JSON.stringify(input);
  check(`post-fix ${name}: raw attribution has the expected authority`, validateTurnPlanV3(input, input.question).valid === valid);
  const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
  const actual = reconciled.plan.derived[0]?.value;
  if (valid) {
    check(`post-fix ${name}: the verified value is not rewritten`, reconciled.reconciliations.length === 0 && actual === 6);
    check(`post-fix ${name}: unrelated arithmetic cannot poison valid authority`, validateTurnPlanV3(reconciled.plan, input.question).valid);
  } else if (value === 6) {
    check(`post-fix ${name}: attributed ambiguity remains rejected after reconciliation`, !validateTurnPlanV3(reconciled.plan, input.question).valid);
  } else {
    check(`post-fix ${name}: an unrelated sentence cannot authorize a wrong value`, !validateTurnPlanV3(reconciled.plan, input.question).valid || actual === 6);
  }
  check(`post-fix ${name}: the original plan is unchanged`, JSON.stringify(input) === original);
}
const additionalUnitProducts: Array<{ name: string; question: string; givens: TurnPlanV3["givens"]; unit: string; truth: number; right: string; wrongValue: number; wrong: string }> = [
  { name: "two-body momentum", question: "Two identical bodies each have m = 4 kg and v = 5 m/s. Their separation is d = 6 m. Find their total momentum.",
    givens: [given("mass", "m", 4, "kg"), given("speed", "v", 5, "m/s"), given("distance", "d", 6, "m")], unit: "kg*m/s", truth: 40,
    right: "p = 2 m v = 2*4*5 = 40 kg*m/s", wrongValue: 10, wrong: "p = 2 m v = 2*5 = 10 kg*m/s" },
  { name: "friction work", question: "A block has normal force N = 25 N and friction coefficient mu = 0.4. Find the work magnitude over x = 4 m.",
    givens: [given("normal", "N", 25, "N"), given("coefficient", "mu", 0.4, "1"), given("distance", "x", 4, "m")], unit: "J", truth: 40,
    right: "W = 0.4 N x = 0.4*25*4 = 40 J", wrongValue: 1.6, wrong: "W = 0.4 N x = 0.4*4 = 1.6 J" },
  { name: "two-force torque", question: "Two forces each have magnitude N = 15 N and perpendicular lever arm r = 0.3 m. Find their combined same-sense torque.",
    givens: [given("force", "N", 15, "N"), given("radius", "r", 0.3, "m")], unit: "N*m", truth: 9,
    right: "tau = 2 N r = 2*15*0.3 = 9 N*m", wrongValue: 0.6, wrong: "tau = 2 N r = 2*0.3 = 0.6 N*m" },
  { name: "specific gravitational energy", question: "A body has mass M = 400 g. Gravity is g = 10 m/s^2 and h = 3 m. Find the gravitational energy per unit mass gained on falling through three times h.",
    givens: [given("mass", "M", 400, "g"), given("gravity", "g", 10, "m/s^2"), given("height", "h", 3, "m")], unit: "m^2/s^2", truth: 90,
    right: "E = 3 g h = 3*10*3 = 90 m^2/s^2", wrongValue: 9, wrong: "E = 3 g h = 3*3 = 9 m^2/s^2" },
  { name: "two-load electric power", question: "Two identical loads each operate at V = 6 V and I = 0.5 A. Find their total electric power.",
    givens: [given("voltage", "V", 6, "V"), given("current", "I", 0.5, "A")], unit: "W", truth: 6,
    right: "P = 2 V I = 2*6*0.5 = 6 W", wrongValue: 1, wrong: "P = 2 V I = 2*0.5 = 1 W" },
  { name: "voltage-square Joule heat", question: "A resistor R = 4 ohm is held at V = 8 V for t = 3 s. Find half the Joule heat generated.",
    givens: [given("resistance", "R", 4, "Ω"), given("voltage", "V", 8, "V"), given("time", "t", 3, "s")], unit: "J", truth: 24,
    right: "H = 0.5 V^2 t/R = 0.5*8^2*3/4 = 24 J", wrongValue: 0.1875, wrong: "H = 0.5 V^2 t/R = 0.5^2*3/4 = 0.1875 J" },
  { name: "current-field magnetic force", question: "A straight wire is L = 2 m long and carries current represented by A = 0.25 A, perpendicular to B = 0.4 T. Find its magnetic force.",
    givens: [given("length", "L", 2, "m"), given("current", "A", 0.25, "A"), given("field", "B", 0.4, "T")], unit: "N", truth: 0.2,
    right: "F = 2 A B = 2*0.25*0.4 = 0.2 N", wrongValue: 0.8, wrong: "F = 2 A B = 2*0.4 = 0.8 N" },
  { name: "half capacitor energy with grouped voltage", question: "A capacitor has C = 8e-6 F, V = 10 V and Q = 8e-5 C. Find half its stored energy.",
    givens: [given("capacitance", "C", 8e-6, "F"), given("voltage", "V", 10, "V"), given("charge", "Q", 8e-5, "C")], unit: "J", truth: 0.0002,
    right: "U = 0.25 C (V^2) = 0.25*8e-6*100 = 2e-4 J", wrongValue: 25, wrong: "U = 0.25 C (V^2) = 0.25*100 = 25 J" },
  { name: "parallel capacitor charge", question: "Two identical capacitors each have C = 3e-6 F at V = 5 V, each with charge Q = 1.5e-5 C. Find their total charge in parallel.",
    givens: [given("capacitance", "C", 3e-6, "F"), given("voltage", "V", 5, "V"), given("charge", "Q", 1.5e-5, "C")], unit: "C", truth: 0.00003,
    right: "Q_total = 2 C V = 2*3e-6*5 = 3e-5 C", wrongValue: 10, wrong: "Q_total = 2 C V = 2*5 = 10 C" },
  { name: "parallel-plate capacitor force", question: "A parallel-plate capacitor has C = 2e-6 F, V = 10 V, plate gap d = 0.01 m and charge Q = 2e-5 C. Find the attractive plate force at fixed voltage.",
    givens: [given("capacitance", "C", 2e-6, "F"), given("voltage", "V", 10, "V"), given("gap", "d", 0.01, "m"), given("charge", "Q", 2e-5, "C")], unit: "N", truth: 0.01,
    right: "F = 0.5 C V^2/d = 0.5*2e-6*100/0.01 = 0.01 N", wrongValue: 5000, wrong: "F = 0.5 C V^2/d = 0.5*100/0.01 = 5000 N" },
];
for (const row of additionalUnitProducts) {
  checkPhysicalArithmetic({ name: `additional correct ${row.name}`, input: physicalPlan(row.question, row.givens, row.right, row.truth, row.unit), valid: true, truth: row.truth });
  checkPhysicalArithmetic({ name: `additional wrong ${row.name}`, input: physicalPlan(row.question, row.givens, row.wrong, row.wrongValue, row.unit), valid: false, truth: row.truth });
}
// Retain the independent review's operator/casing/scientific-number witnesses
// at the actual public seam, including an otherwise agreeing wrong claim.
const independentOperatorProducts = [
  ["review coefficient", "0.5 m v^2", 9, 4.5, "J"],
  ["fraction coefficient", "1/2 m v^2", 9, 4.5, "J"],
  ["bound exponent", "0.5 m^2 v^2", 18, 4.5, "kg^2*m^2/s^2"],
  ["bound superscript", "0.5 m² v²", 18, 4.5, "kg^2*m^2/s^2"],
  ["following group", "0.5 m (v^2)", 9, 4.5, "J"],
  ["following number", "0.5 m 9", 9, 4.5, "kg"],
  ["following scientific", "0.5 m 9e0", 9, 4.5, "kg"],
  ["scientific coefficient", "5e-1 m v^2", 9, 4.5, "J"],
  ["leading dot", ".5 m v^2", 9, 4.5, "J"],
  ["negative coefficient", "-0.5 m v^2", -9, -4.5, "J"],
  ["grouped coefficient", "(1/2) m v^2", 9, 4.5, "J"],
  ["explicit following multiplication", "0.5 m * v^2", 9, 4.5, "J"],
  ["unicode following multiplication", "0.5 m × v²", 9, 4.5, "J"],
  ["explicit following division", "18 m / v^2", 4, 2, "kg*s^2/m^2"],
  ["all explicit product", "0.5 * m * v^2", 9, 4.5, "J"],
  ["following plus", "0.5 m + n", 10, 9.5, "kg"],
  ["following minus", "0.5 m - n", -8, -8.5, "kg"],
  ["unbound compound measurement label", "0.5 m/s * 18", 9, 99, "m/s"],
] as const;
const operatorQuestion = "A body has mass m = 2 kg, speed v = 3 m/s and height h = 5 m. Evaluate the explicitly authored energy arithmetic.";
for (const [name, expression, truth, wrong, unit] of independentOperatorProducts) {
  const givens = structuredClone(reviewedWrongKinetic.givens);
  let details = "";
  if (name === "following plus" || name === "following minus") {
    givens.push(given("other_mass", "n", 9, "kg")); details = " Another mass n = 9 kg is supplied.";
  }
  if (name === "unbound compound measurement label") {
    givens.push(given("other_speed", "u", 0.5, "m/s")); details = " Another measured speed u = 0.5 m/s is supplied.";
  }
  const question = `A body has mass m = 2 kg, speed v = 3 m/s and height h = 5 m.${details} Evaluate X = ${expression} and report it in ${unit}.`;
  for (const extraChain of [false, true]) {
    for (const [value, valid] of [[truth, true], [wrong, false]] as const) {
      checkPhysicalArithmetic({ name: `operator ${name}/${extraChain ? "restated" : "direct"}/${valid ? "right" : "wrong"}`, truth, valid,
        input: physicalPlan(question, givens, `X = ${expression}${extraChain ? ` = ${value}` : ""} = ${value} ${unit}`, value, unit) });
    }
  }
}
for (const expression of ["0.5 m v^2", "0.5 m * v^2"]) {
  const input = physicalPlan(operatorQuestion, reviewedWrongKinetic.givens, `X = ${expression} = 4.5 = 4.5 J`, 4.5, "J");
  input.qualitativeClaims = [{ id: "claimed", claim: "X = 4.5 J", expected: true, relatedQuantityIds: ["result"] }];
  checkPhysicalArithmetic({ name: `wrong operator ${expression} reinforced by attributed claim`, input, truth: 9, valid: false });
}
for (const unit of ["m^2", "m²"]) {
  for (const expression of ["0.5 m^2 v^2", "0.5 m² v²", "0.5 m^2 * v^2"]) {
    for (const [value, valid] of [[18, true], [4.5, false]] as const) {
      const question = `A body has mass m = 2 kg, speed v = 3 m/s and height h = 5 m. An unrelated area S = 5 m² is supplied. Evaluate X = ${expression}, half the squared momentum, in kg^2*m^2/s^2.`;
      const input = physicalPlan(question, [...reviewedWrongKinetic.givens, given("unrelated_area", "S", 5, unit)], `X = ${expression} = ${value} kg^2*m^2/s^2`, value, "kg^2*m^2/s^2");
      checkPhysicalArithmetic({ name: `complete exponent unit ${unit}/${expression}/${value}`, input, truth: 18, valid });
    }
  }
}
const ampereQuestion = "A conductor has area A = 0.8 mm², current I = 3 A and resistance R = 12 Ω. Find its voltage.";
for (const expression of ["3 A * R", "3 A * 12", "(3 A) * R"]) {
  for (const [value, valid] of [[36, true], [28.8, false]] as const) {
    const input = physicalPlan(ampereQuestion, [given("area", "A", 0.8, "mm²"), given("current", "I", 3, "A"), given("resistance", "R", 12, "Ω")], `X = ${expression} = ${value} V`, value, "V");
    checkPhysicalArithmetic({ name: `trusted measured ampere ${expression}/${value}`, input, truth: 36, valid });
  }
}
// An uncomputed derived assertion is not an independently supplied
// measurement and cannot turn the mass coefficient into a length label.
for (const [value, valid] of [[9, true], [4.5, false]] as const) {
  const input = physicalPlan(reviewedKineticQuestion, reviewedWrongKinetic.givens, `X = 0.5 m * v^2 = ${value} J`, value, "J");
  input.derived.unshift({ id: "decoy", symbol: "L", value: 0.5, unit: "m", provenance: "derived", dependsOn: [], sourceText: "L = 0.5 m" });
  input.derived[1]!.dependsOn!.push("decoy");
  check(`uncomputed length assertion/${value}: raw kinetic authority is ${valid ? "accepted" : "rejected"}`, validateTurnPlanV3(input, input.question).valid === valid);
  const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
  const actual = reconciled.plan.derived.find(quantity => quantity.id === "result")?.value;
  check(`uncomputed length assertion/${value}: reconciliation retains the true mass product`, actual === 9);
  check(`uncomputed length assertion/${value}: only the true reconciled answer is admitted`, !validateTurnPlanV3(reconciled.plan, input.question).valid || actual === 9);
  if (valid) check("uncomputed length assertion: correct kinetic value is never rewritten", !reconciled.reconciliations.some(change => change.quantityId === "result"));
}
// Even a genuinely supplied matching length is not the mass in kinetic
// energy. Operand dimensions, not coincidental numeric equality, distinguish
// the readings. The nearby length also catches any approximate-value guess.
for (const height of [0.5, 0.5000000001]) {
  for (const operator of ["*", "×"]) {
    for (const [value, valid] of [[9, true], [4.5, false]] as const) {
      const question = `A body has mass m = 2 kg, speed v = 3 m/s and height h = ${height} m. Find its kinetic energy.`;
      const givens = [given("mass", "m", 2, "kg"), given("speed", "v", 3, "m/s"), given("height", "h", height, "m")];
      checkPhysicalArithmetic({ name: `real matching length ${height}/${operator}/${value}`, truth: 9, valid,
        input: physicalPlan(question, givens, `X = 0.5 m ${operator} v^2 = ${value} J`, value, "J") });
    }
  }
}
// Final six independently reported safety witnesses: dimensional admission
// must decline rather than later accept whichever arithmetic chain matches.
let hugeMassPower = "m";
for (let index = 0; index < 11; index++) hugeMassPower = `(${hugeMassPower}^32)`;
const incompatibleDimensionCases: Array<{ name: string; input: TurnPlanV3 }> = [
  { name: "large dimensional intermediate cannot round away the mass axis", input: physicalPlan(
    "A body has mass m = 1 kg, speed v = 3 m/s and height h = 0.5 m. Evaluate the written expression without inventing dimensionless mass.",
    [given("mass", "m", 1, "kg"), given("speed", "v", 3, "m/s"), given("height", "h", 0.5, "m")],
    `X = 0.5 m * ${hugeMassPower} / ${hugeMassPower} = 0.5 dimensionless`, 0.5, "dimensionless") },
  ...[false, true].map(restated => ({ name: `both force readings fit power dimensions/${restated ? "restated" : "direct"}`, input: physicalPlan(
    "A body has force N = 40 N, speed v = 3 m/s and another force F = 3 N. Evaluate the ambiguous written expression in watts.",
    [given("force", "N", 40, "N"), given("speed", "v", 3, "m/s"), given("other_force", "F", 3, "N")],
    `X = 3 N * v${restated ? " = 9" : ""} = 9 W`, 9, "W") })),
  { name: "neither mass-plus-speed-squared reading has energy dimensions", input: physicalPlan(
    "A body has mass m = 2 kg, speed v = 3 m/s and height h = 5 m. Do not treat mass plus squared speed as energy.",
    reviewedWrongKinetic.givens, "X = 0.5 m + v^2 = 10 = 10 J", 10, "J") },
  { name: "multiple unit collisions cannot choose a convenient later scalar", input: physicalPlan(
    "Use mass m = 2 kg, speed v = 3 m/s, height h = 3 m and forces N = 40 N, F = 2 N. Evaluate the ambiguous written expression in joules.",
    [given("mass", "m", 2, "kg"), given("speed", "v", 3, "m/s"), given("height", "h", 3, "m"), given("force", "N", 40, "N"), given("other_force", "F", 2, "N")],
    "X = 2 N * 3 m * 1 = 6 = 6 J", 6, "J") },
  { name: "unknown target units cannot prove the collision interpretation", input: physicalPlan(
    "A body has mass m = 2 kg, speed v = 3 m/s and height h = 0.5 m. The requested target unit arb has no supplied physical definition.",
    [given("mass", "m", 2, "kg"), given("speed", "v", 3, "m/s"), given("height", "h", 0.5, "m")],
    "X = 0.5 m * v^2 = 4.5 = 4.5 arb", 4.5, "arb") },
];
for (const { name, input } of incompatibleDimensionCases) {
  const original = JSON.stringify(input);
  check(`dimensional safety ${name}: raw validation declines`, !validateTurnPlanV3(input, input.question).valid);
  const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
  check(`dimensional safety ${name}: no unproved arithmetic rewrite`, reconciled.reconciliations.length === 0);
  check(`dimensional safety ${name}: reconciliation cannot gain valid authority`, !validateTurnPlanV3(reconciled.plan, input.question).valid);
  check(`dimensional safety ${name}: original source is unchanged`, JSON.stringify(input) === original);
}
for (const [value, valid] of [[4.175, true], [41.75, false]] as const) {
  const question = "A particle with mass m = 1.67e-27 kg has a verified magnetic-orbit radius r = 0.04175 m. Convert that radius to centimetres using 100 cm per metre.";
  const input = physicalPlan(question, [given("mass", "m", 1.67e-27, "kg"), given("radius", "r", 0.04175, "m")],
    `X = 0.04175 m * 100 cm/m = ${value} cm`, value, "cm");
  checkPhysicalArithmetic({ name: `magnetic-radius centimetre conversion/${value}`, input, valid, truth: 4.175 });
}
for (const unused of [given("density", "ρ", 8900, "kg/m³"), given("unrelated-mass", "q", 1, "kg")]) {
  const detail = unused.id === "density" ? "An unrelated density ρ = 8900 kg/m³ is supplied." : "An unrelated mass q = 1 kg is supplied.";
  const input = physicalPlan(`${ampereQuestion} ${detail}`, [given("area", "A", 0.8, "mm²"), given("current", "I", 3, "A"), given("resistance", "R", 12, "Ω"), unused],
    "X = 3 A * R = 36 V", 36, "V");
  input.derived[0]!.dependsOn = ["current", "resistance"];
  checkPhysicalArithmetic({ name: `unused ${unused.id}/${unused.symbol} cannot poison proven ampere voltage`, input, valid: true, truth: 36 });
}
// Closing a parenthesis does not turn an embedded bound capacitance or mass
// into a coulomb or metre label. The whole expression fixes its dimensions.
for (const [value, valid] of [[1e-4, true], [2e-10, false]] as const) {
  const question = "A capacitor has C = 2e-6 F, voltage V = 10 V and charge Q = 2e-5 C. Find its stored energy from Q squared divided by twice its capacitance.";
  const input = physicalPlan(question, [given("capacitance", "C", 2e-6, "F"), given("voltage", "V", 10, "V"), given("charge", "Q", 2e-5, "C")],
    `X = Q²/(2 C) = ${value} J`, value, "J");
  checkPhysicalArithmetic({ name: `parenthesized capacitance energy/${value}`, input, valid, truth: 1e-4 });
}
for (const [value, valid] of [[9, true], [4.5, false]] as const) {
  const input = physicalPlan(reviewedKineticQuestion, reviewedWrongKinetic.givens,
    `X = (0.5 m)*v² = ${value} J`, value, "J");
  checkPhysicalArithmetic({ name: `parenthesized mass kinetic energy/${value}`, input, valid, truth: 9 });
}
// A one-figure V=6 must not attach a nearby anonymous 63/11 calculation
// before the named nodal computation. The written 0.3333 is intentionally
// retained: reconcile its explicit arithmetic, not an unwritten exact 1/3.
{
  const question = "Two batteries have E1 = 9 V, r1 = 1 ohm and E2 = 3 V, r2 = 2 ohm. Their positive terminals are joined and their negative terminals are joined across load R = 3 ohm. Find the load current.";
  const input: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
    givens: [given("E1", "E1", 9, "V"), given("r1", "r1", 1, "ohm"), given("E2", "E2", 3, "V"), given("r2", "r2", 2, "ohm"), given("R", "R", 3, "ohm")],
    unknowns: [{ id: "IL", symbol: "I_L", unit: "A" }],
    derived: [
      { id: "V", symbol: "V", value: 6, unit: "V", provenance: "derived", dependsOn: ["E1", "r1", "E2", "r2", "R"],
        sourceText: "(E1/r1+E2/r2)/(1/r1+1/r2+1/R)=(9/1+3/2)/(1+0.5+1/3)=10.5/(11/6)=63/11? recompute: 10.5*6/11=63/11≈5.727; use nodal: V=(9+1.5)/(1+0.5+0.3333)=10.5/1.8333=5.727" },
      { id: "IL", symbol: "I_L", value: 1.909, unit: "A", provenance: "derived", dependsOn: ["V", "R"], sourceText: "I_L=V/R=5.727/3=1.909 A" },
    ], qualitativeClaims: [], lawIds: ["x"], assumptions: [] };
  const original = JSON.stringify(input);
  check("single-figure nodal anchor: raw stale voltage is invalid", !validateTurnPlanV3(input, question).valid);
  const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
  const voltage = reconciled.plan.derived.find(quantity => quantity.id === "V")?.value;
  const current = reconciled.plan.derived.find(quantity => quantity.id === "IL")?.value;
  const writtenVoltage = 10.5 / 1.8333;
  check("single-figure nodal anchor: named explicit denominator supplies voltage", typeof voltage === "number" && Math.abs(voltage - writtenVoltage) <= writtenVoltage * 1e-12);
  check("single-figure nodal anchor: downstream current uses reconciled voltage", typeof current === "number" && Math.abs(current - writtenVoltage / 3) <= writtenVoltage / 3 * 1e-12);
  check("single-figure nodal anchor: stale 6 V never survives reconciliation", voltage !== 6);
  check("single-figure nodal anchor: corrected dependent plan validates", validateTurnPlanV3(reconciled.plan, question).valid);
  check("single-figure nodal anchor: original source is unchanged", JSON.stringify(input) === original);
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
for (const expression of ["0.3-0.2-0.1", "0.3-(0.2+0.1)", "3e-17-2e-17-1e-17", "cos(90°)", "sin(pi)", "sqrt(2)*sqrt(2)-2",
  "2*sin(30°)-1", "2*cos(60°)-1", "2*sin(150°)-1", "2*cos(120°)+1", "tan(45°)-1", "tan(135°)+1",
  "2*sin(45°)^2-1", "2*cos(45°)*cos(45°)-1", "4*cos(30°)^2-3", "3*tan(30°)^2-1",
  "sin(60°)-cos(30°)", "sqrt(3)*sin(30°)-sin(60°)", "sin(45°)+cos(45°)-sqrt(2)",
  "cos(30°)^2-sin(60°)^2", "sin(60°)^2+cos(60°)^2-1", "tan(30°)^2-1/3",
  "2*sin(-30°)+1", "2*sin(390°)-1", "2*cos(-60°)-1", "sqrt(0.5)-cos(45°)",
  "sin(10°)^2+cos(10°)^2-1", "sin(pi/5)^2+cos(pi/5)^2-1",
  "cos(37°)*cos(37°)+sin(37°)*sin(37°)-1", "sin(1)^2+cos(1)^2-1",
  "sqrt(18)-3*sqrt(2)", "sqrt(50)-5*sqrt(2)", "sqrt(2)/3-sqrt(18)/9", "sqrt(72)-2*sqrt(18)",
  "sqrt(18)/sqrt(2)-3", "sqrt(2)^(-2)-1/2", "(sqrt(2)/sqrt(3))^2-2/3",
  "1/(sqrt(2)^(-2))-2", "sin(pi/4)^(-2)-2", "sqrt(18)/(-sqrt(2))+3"]) {
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
  ["0.5-0.5+1e-17", 1e-17], ["0.3-0.3+1e-17", 1e-17],
  ["2*sin(pi/6+1e-9)-1", 2 * Math.sin(Math.PI / 6 + 1e-9) - 1],
  ["2*cos(pi/3+1e-9)-1", 2 * Math.cos(Math.PI / 3 + 1e-9) - 1],
  ["sin(10°)^2+cos(10°)^2-1+1e-17", 1e-17], ["sqrt(18)-3*sqrt(2)+1e-17", 1e-17]] as const) {
  for (const value of [expected, expected * 2]) {
    const source = `D = ${expression} = ${value} V`;
    const input = plan("Evaluate an authored genuinely nonzero small expression.", source, value);
    input.givens = []; input.unknowns = [{ id: "nonzero_small_result", symbol: "D", unit: "V" }];
    input.derived = [{ id: "nonzero_small_result", symbol: "D", value, unit: "V", provenance: "derived", sourceText: source }];
    check(`real small ${expression} has no absolute slack`, validateTurnPlanV3(input).valid === (value === expected));
    const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input);
    check(`real small ${expression} is never erased or doubled`, Math.abs((reconciled.plan.derived[0]?.value ?? NaN) - expected) <= Math.abs(expected) * 1e-12);
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
for (const argument of ["sqrt(100000000000-100000000000.000001)", "acos(1.0000000000000001)"]) {
  const source = `D = sin(${argument})^2+cos(${argument})^2-(1-1e-17) = 1e-17 V`;
  const input = plan("An identity must not grant authority outside its exact real domain.", source, 1e-17);
  input.givens = []; input.unknowns = [{ id: "invalid_identity", symbol: "D", unit: "V" }];
  input.derived = [{ id: "invalid_identity", symbol: "D", value: 1e-17, unit: "V", provenance: "derived", sourceText: source }];
  check("a Pythagorean identity requires a supported exact real argument", !validateTurnPlanV3(input).valid);
  check("undefined real identities do not retain a newly proved nonzero result", reconcileTurnPlanV3ExplicitArithmetic(input).plan.derived[0]?.value !== 1e-17);
}
const hiddenInvalidRoot = "sqrt(100000000000-100000000000.000001)";
for (const [expression, value] of [
  [`2*sin(pi/6+(${hiddenInvalidRoot}-${hiddenInvalidRoot})*pi)-1+1e-17`, 1e-17],
  [`sqrt(18+(${hiddenInvalidRoot}-${hiddenInvalidRoot}))-3*sqrt(2)+1e-17`, 1e-17],
  ["sqrt(acos(1.0000000000000001)-acos(1.0000000000000001)+18)-3*sqrt(2)", 0],
  [`sqrt(${hiddenInvalidRoot}-${hiddenInvalidRoot}+18)-3*sqrt(2)`, 0],
] as const) {
  const source = `D = ${expression} = ${value === 0 ? "0.0000000000000000000000000000000000000000" : value} V`;
  const input = plan("Hidden invalid domains cannot be canceled into new exact authority.", source, value);
  input.givens = []; input.unknowns = [{ id: "invalid_cancellation", symbol: "D", unit: "V" }];
  input.derived = [{ id: "invalid_cancellation", symbol: "D", value, unit: "V", provenance: "derived", sourceText: source }];
  check("every new exact proof requires recursively valid real domains", !validateTurnPlanV3(input).valid);
  check("invalid-domain cancellation never gains the newly exact declared result", reconcileTurnPlanV3ExplicitArithmetic(input).plan.derived[0]?.value !== value);
}
assert.equal(failures.length, 0, `${failures.length}/${checks} failed: ${[...new Set(failures)].join("; ")}`);
console.log(`verify-turn-plan-measured-operands: ${checks} checks pass; 9 FIX FIRST review plans (4 wrong/5 correct), 32 re-review conversion/symbol/complete-series plans, 14 post-fix alias/trig/sentence plans, 10 additional physical cases (10 right/10 wrong), 92 independent operator/claim/exponent/ampere plans, 2 uncomputed-derived measurement trust plans, 8 matching/nearby real-length operator plans, 6 dimensional fail-closed plans, 2 magnetic-radius conversion plans, 2 unused-metadata ampere plans, 4 parenthesized mass/capacitance plans, 1 single-figure nodal-anchor plan, all original 1541 checks retained`);
