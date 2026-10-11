/**
 * Synthetic held-out scalar-authority regression, not the original P10 replay.
 * Its planner/IR payload was not retained. This gate makes no claim that the
 * historical refusal was false or repaired, or that a diagram/lesson is correct.
 *
 * Independent worked-example oracle: +2/-2 microcoulombs, 0.30 m, k=9e9
 * gives force magnitude 0.4 N; opposite signs mean attraction. The scalar solver
 * verifies the magnitude, not the qualitative attraction claim.
 */
import assert from "node:assert/strict";
import { validateTurnPlanV3, type TurnPlanV3 } from "../../src/contracts/contractsV3";
import { validateProblemIR, type ExpressionNodeIR, type ProblemIR } from "../../src/ir/problemIR";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import { verifyTurnPlanAgainstSolver } from "../../src/ir/solverAuthority";

const question = "Two point charges q1 = +2 μC and q2 = -2 μC are separated by r = 0.30 m. Use k = 9 × 10^9 N m^2/C^2. Find the force magnitude and whether it is attractive or repulsive.";
const requested = "Find the force magnitude and whether it is attractive or repulsive.";
const number = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const binary = (operator: "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
const signedProduct = binary("*", number(2e-6), number(-2e-6));
const denominator = binary("^", number(0.30), number(2));
const forceMagnitude = binary("/", binary("*", number(9e9), { kind: "call", function: "abs", argument: signedProduct }), denominator);

function problemFor(root: ExpressionNodeIR): ProblemIR {
  return {
    schemaVersion: "problem-ir/v1", id: "syntheticCoulombMagnitude", question,
    facts: [
      { id: "given", kind: "given", statement: "Signed charges, distance and Coulomb constant", evidence: { source: "question", start: 0, end: question.indexOf(requested), quote: question.slice(0, question.indexOf(requested)).trim() } },
      { id: "requested", kind: "requested", statement: "Force magnitude and attraction or repulsion", evidence: { source: "question", start: question.indexOf(requested), end: question.length, quote: requested } },
    ],
    entities: [], expressions: [{ id: "force", valueType: "scalar", root, evidenceFactIds: ["given"] }],
    constraints: [], representationIntents: [],
    solveRequests: [{ id: "forceMagnitude", kind: "evaluate", expressionId: "force", resultBinding: { turnPlanQuantityId: "F", symbol: "F", unit: "N", evidenceFactIds: ["requested"] } }],
  };
}

function planFor(siGivens = false): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, visualRequirement: "optional",
    givens: [
      { id: "q1", symbol: "q1", value: siGivens ? 2e-6 : 2, unit: siGivens ? "C" : "μC", sign: "positive", provenance: "given", sourceText: siGivens ? "q1 = +2e-6 C" : "q1 = +2 μC" },
      { id: "q2", symbol: "q2", value: siGivens ? -2e-6 : -2, unit: siGivens ? "C" : "μC", sign: "negative", provenance: "given", sourceText: siGivens ? "q2 = -2e-6 C" : "q2 = -2 μC" },
      { id: "r", symbol: "r", value: 0.30, unit: "m", sign: "positive", provenance: "given", sourceText: "r = 0.30 m" },
      { id: "k", symbol: "k", value: 9e9, unit: "N m^2/C^2", sign: "positive", provenance: "given", sourceText: "k = 9 × 10^9 N m^2/C^2" },
    ],
    unknowns: [{ id: "F", symbol: "F", unit: "N" }],
    derived: [{ id: "F", symbol: "F", value: 0.4, unit: "N", sign: "positive", provenance: "derived", sourceText: "F = 0.4 N", dependsOn: ["q1", "q2", "r", "k"] }],
    qualitativeClaims: [{ id: "attraction", claim: "force_character", expected: "attractive", relatedQuantityIds: ["q1", "q2"] }],
    lawIds: ["Coulomb law"], assumptions: [],
  };
}

const correctSourceForms = [
  ["literal_si_abs_function", "F = 9e9 * abs(2e-6 * (-2e-6)) / 0.30^2"],
  ["literal_si_absolute_bars", "F = 9e9 * |2e-6 * (-2e-6)| / 0.30^2"],
  ["literal_si_unicode", "F = (9 × 10^9) × |(+2 × 10^-6) × (−2 × 10^-6)| / (0.30)^2"],
  ["symbolic_abs_function", "F = k * abs(q1*q2) / r^2"],
  ["symbolic_absolute_bars", "F = k * |q1*q2| / r^2"],
  ["symbolic_compact_unicode", "F = k|q₁q₂|/r² = 0.4 N"],
  ["literal_si_superscripts", "F = (9 × 10⁹) × |(+2 × 10⁻⁶)(−2 × 10⁻⁶)| / (0.30)² = 0.4 N"],
  ["symbolic_prose_magnitude", "Coulomb force magnitude k |q1 q2| / r² is 0.4 N; opposite signs make it attractive."],
  ["signed_intermediate_then_magnitude", "k*q1*q2/r^2 = -0.4 N; abs(k*q1*q2/r^2) = 0.4 N. The force magnitude is 0.4 N, attractive."],
  ["literal_prose_signed_intermediate", "The signed SI product is -4e-12 C^2; its magnitude is 4e-12 C^2. F = 9e9*4e-12/(0.30^2) = 0.4 N."],
  ["inline_micro_units", "F = (9e9 N*m^2/C^2) * |(+2 μC)*(-2 μC)| / (0.30 m)^2 = 0.4 N"],
  ["inline_si_units", "F = (9e9 N*m^2/C^2) * |(+2e-6 C)*(-2e-6 C)| / (0.30 m)^2 = 0.4 N"],
  ["literal_abs_whole_expression", "F = |9e9*(2e-6)*(-2e-6)/(0.30^2)|"],
  ["opposite_signed_product_negated", "F = -9e9*(2e-6)*(-2e-6)/(0.30^2)"],
] as const;

async function main(): Promise<void> {
  const problem = problemFor(forceMagnitude);
  const problemValidation = validateProblemIR(problem, question);
  assert(problemValidation.problem, JSON.stringify(problemValidation.issues));
  const result = await new LocalDeterministicSolverProvider().solve(problemValidation.problem);
  assert.equal(result.status, "solved");
  const value = result.values.find(candidate => candidate.requestId === "forceMagnitude");
  assert(value && typeof value.approximate === "number");
  assert(Math.abs(value.approximate - 0.4) < 1e-12, "independent literal oracle is 0.4 N");

  const baseline = planFor();
  assert(validateTurnPlanV3(baseline, question).valid);
  const baselineAudit = verifyTurnPlanAgainstSolver(problem, result, baseline, question);
  assert.equal(baselineAudit.status, "verified", JSON.stringify(baselineAudit.issues));
  assert.equal(baselineAudit.bindings.length, 1);
  assert.equal(baselineAudit.bindings[0]!.quantityId, "F");

  let verifiedVariants = 0;
  for (const [name, sourceText] of correctSourceForms) {
    for (const siGivens of [false, true]) {
      const candidate = planFor(siGivens);
      candidate.derived[0]!.sourceText = sourceText;
      const validation = validateTurnPlanV3(candidate, question);
      assert(validation.valid, `${name}/${siGivens ? "SI" : "micro"}: ${JSON.stringify(validation.issues)}`);
      const audit = verifyTurnPlanAgainstSolver(problem, result, candidate, question);
      assert.equal(audit.status, "verified", `${name}/${siGivens ? "SI" : "micro"}: ${JSON.stringify(audit.issues)}`);
      assert.equal(audit.bindings.length, 1);
      verifiedVariants++;
    }
  }

  const wrongScalar = planFor();
  wrongScalar.derived[0]!.value = 0.5;
  wrongScalar.derived[0]!.sourceText = "F = 0.5 N";
  assert(validateTurnPlanV3(wrongScalar, question).valid, "wrong scalar reaches the independent result comparison");
  const wrongScalarAudit = verifyTurnPlanAgainstSolver(problem, result, wrongScalar, question);
  assert.equal(wrongScalarAudit.status, "contradiction", "a wrong scalar must never be accepted");
  assert(wrongScalarAudit.issues.some(issue => issue.code === "solver_turnplan_contradiction"));

  const wrongSourceArithmetic = planFor();
  wrongSourceArithmetic.derived[0]!.sourceText = "F = 0.4 + 0.1";
  const arithmeticValidation = validateTurnPlanV3(wrongSourceArithmetic, question);
  assert(!arithmeticValidation.valid, "correct declared answer cannot override inconsistent source arithmetic");
  assert(arithmeticValidation.issues.some(issue => issue.code === "source_text_value_mismatch"));
  const arithmeticAudit = verifyTurnPlanAgainstSolver(problem, result, wrongSourceArithmetic, question);
  assert.equal(arithmeticAudit.status, "contradiction");
  assert(arithmeticAudit.issues.some(issue => issue.code === "authority_input_contradiction"));

  for (const [name, value, sign] of [
    ["negative_charge_positive_tag", -2, "positive"],
    ["positive_magnitude_negative_tag", 2, "negative"],
  ] as const) {
    const wrongSign = planFor();
    wrongSign.givens[1]!.value = value;
    wrongSign.givens[1]!.sign = sign;
    const validation = validateTurnPlanV3(wrongSign, question);
    assert(!validation.valid, name);
    assert(validation.issues.some(issue => issue.code === "sign_mismatch"), name);
    const audit = verifyTurnPlanAgainstSolver(problem, result, wrongSign, question);
    assert.equal(audit.status, "contradiction", name);
    assert(audit.issues.some(issue => issue.code === "authority_input_contradiction"), name);
  }

  const negativeProductProblem = problemFor(binary("/", binary("*", number(9e9), signedProduct), denominator));
  assert(validateProblemIR(negativeProductProblem, question).valid);
  const negativeProductResult = await new LocalDeterministicSolverProvider().solve(negativeProductProblem);
  assert.equal(negativeProductResult.status, "solved");
  const negativeValue = negativeProductResult.values[0]?.approximate;
  assert(typeof negativeValue === "number" && Math.abs(negativeValue - (-0.4)) < 1e-12);
  const negativeProductAudit = verifyTurnPlanAgainstSolver(negativeProductProblem, negativeProductResult, baseline, question);
  assert.equal(negativeProductAudit.status, "contradiction", "signed product cannot be silently accepted as force magnitude");
  assert(negativeProductAudit.issues.some(issue => issue.code === "solver_turnplan_contradiction"));

  console.log(`Coulomb magnitude authority: baseline + ${verifiedVariants} notation/unit variants verified; 5 genuine contradiction controls rejected. Synthetic regression only; historical P10 payload unavailable.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
