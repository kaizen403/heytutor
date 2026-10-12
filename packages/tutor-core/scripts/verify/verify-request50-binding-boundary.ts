import assert from "node:assert/strict";
import { basename } from "node:path";
import {
  LocalDeterministicSolverProvider,
  validateProblemIR,
  validateSolverResult,
  verifyTurnPlanAgainstSolver,
  type ProblemIR,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { normalizeProblemIRModelOutput } from "../../src/planners/problemPlannerV1";

/** Synthetic source only: no captured student question or model reply. */
export function bindingFixture(
  unknownSymbol = "x",
  derivedSymbol = unknownSymbol,
  bindingSymbol = unknownSymbol,
): { problem: ProblemIR; plan: TurnPlanV3 } {
  const question = `Given 2 m, determine ${unknownSymbol}; draw a labelled segment AB.`;
  const evidence = (quote: string) => ({
    source: "question" as const,
    start: question.indexOf(quote),
    end: question.indexOf(quote) + quote.length,
    quote,
  });
  return {
    problem: {
      schemaVersion: "problem-ir/v1", id: "syntheticBindingBoundary", question,
      facts: [
        { id: "given", kind: "given", statement: "The supplied scalar.", evidence: evidence("2 m") },
        { id: "requested", kind: "requested", statement: "Find the requested scalar.", evidence: evidence(`determine ${unknownSymbol}`) },
      ],
      entities: [],
      expressions: [{ id: "scalar", valueType: "scalar", root: { kind: "number", value: 2 }, evidenceFactIds: ["given"] }],
      constraints: [], representationIntents: [],
      solveRequests: [{ id: "solve", kind: "evaluate", expressionId: "scalar", resultBinding: {
        turnPlanQuantityId: "target", symbol: bindingSymbol, unit: "m", evidenceFactIds: ["requested"],
      } }],
    },
    plan: {
      schemaVersion: "turn-plan/v3", question,
      givens: [], unknowns: [{ id: "target", symbol: unknownSymbol, unit: "m" }],
      derived: [{ id: "target", symbol: derivedSymbol, value: 2, unit: "m", provenance: "derived" }],
      qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
    },
  };
}

export async function normalizeAndAudit(fixture: ReturnType<typeof bindingFixture>) {
  const normalized = normalizeProblemIRModelOutput(fixture.problem, fixture.plan.question, fixture.plan);
  const problemValidation = validateProblemIR(normalized, fixture.plan.question);
  assert(problemValidation.problem, `synthetic IR rejected: ${problemValidation.issues.map((issue) => issue.code).join(",")}`);
  const problem = problemValidation.problem;
  const solved = await new LocalDeterministicSolverProvider().solve(problem);
  const resultValidation = validateSolverResult(solved, problem);
  assert(resultValidation.result && resultValidation.result.status === "solved", "the real local solver must solve the retained request");
  const result = resultValidation.result;
  const audit = verifyTurnPlanAgainstSolver(problem, result, fixture.plan, fixture.plan.question);
  return { problem, result, audit, plan: fixture.plan };
}

async function main(): Promise<void> {
  const fixture = bindingFixture("x", "xₘₐₓ");
  const original = JSON.stringify(fixture);
  const observed = await normalizeAndAudit(fixture);
  assert.equal(observed.problem.solveRequests.length, 1, "an unsupported binding must not delete the actual solve request");
  assert.equal(observed.problem.solveRequests[0]!.resultBinding, undefined,
    "Unicode xₘₐₓ must not alias the different requested symbol x");
  assert.equal(observed.audit.status, "incomplete", "a missing identity join is an absent second opinion, not numeric disagreement");
  assert.deepEqual(observed.audit.bindings, [], "an unsupported alias cannot become a verified value");
  assert.equal(JSON.stringify(fixture), original, "transport normalization must not rewrite the authoritative plan or raw input");
  const identities = [
    ["exact", "x", "x", "x", true],
    ["Unicode request subscript formatting", "x_max", "x_max", "xₘₐₓ", true],
    ["ASCII request subscript formatting", "xₘₐₓ", "xₘₐₓ", "x_max", true],
    ["known request math markup", "x_max", "x_max", String.raw`\mathrm{x}_{max}`, true],
    ["exact Greek", "θ", "θ", "θ", true],
    ["unsupported mixed Delta plan notation", "Δv", String.raw`\Delta v`, "Δv", false],
    ["unsupported reverse mixed Delta plan notation", String.raw`\Delta v`, "Δv", String.raw`\Delta v`, false],
    ["exact Unicode Delta", "Δv", "Δv", "Δv", true],
    ["canonicalize raw Delta markup", "Δv", "Δv", String.raw`\Delta v`, true],
    ["exact Delta markup", String.raw`\Delta v`, String.raw`\Delta v`, String.raw`\Delta v`, true],
    ["ASCII semantic suffix", "x", "x_max", "x", false],
    ["different Greek derived identity", "θ", "φ", "θ", false],
    ["different Greek request identity", "θ", "θ", "φ", false],
    ["delta is semantic", "Δv", "v", "Δv", false],
    ["derived case is semantic", "r", "R", "r", false],
    ["request case is semantic", "r", "r", "R", false],
    ["unrelated symbol", "x", "y", "x", false],
  ] as const;
  for (const [name, unknown, derived, binding, retained] of identities) {
    const input = bindingFixture(unknown, derived, binding);
    const before = JSON.stringify(input);
    const result = await normalizeAndAudit(input);
    assert.equal(result.problem.solveRequests.length, 1, `${name}: the solve request survives`);
    assert.equal(Boolean(result.problem.solveRequests[0]!.resultBinding), retained, `${name}: only an exact identity join survives`);
    assert.equal(result.audit.status, retained ? "verified" : "incomplete", name);
    assert.equal(result.audit.bindings.length, retained ? 1 : 0, `${name}: no unsupported numeric alias`);
    assert.equal(result.result.values[0]!.approximate, 2, `${name}: the real local solution is unchanged`);
    assert.equal(JSON.stringify(input), before, `${name}: no authoritative input mutation`);
    if (!retained) assert.deepEqual(result.audit.issues.map((issue) => issue.code), ["unbound_unknown"], name);
  }

  const numeric = bindingFixture();
  numeric.plan.derived[0]!.value = 3;
  const numericAudit = await normalizeAndAudit(numeric);
  assert.equal(numericAudit.audit.status, "contradiction", "a genuine scalar disagreement still stops");
  assert(numericAudit.audit.issues.some((issue) => issue.code === "solver_turnplan_contradiction"));

  const sign = bindingFixture();
  sign.plan.derived[0]!.sign = "negative";
  const signAudit = await normalizeAndAudit(sign);
  assert.equal(signAudit.audit.status, "contradiction", "a positive scalar cannot carry a negative declared sign");
  assert(signAudit.audit.issues.some((issue) => issue.code === "authority_input_contradiction"));

  const duplicate = bindingFixture();
  duplicate.problem.solveRequests.push({ ...duplicate.problem.solveRequests[0]!, id: "secondSolve" });
  const duplicateAudit = await normalizeAndAudit(duplicate);
  assert.equal(duplicateAudit.audit.status, "contradiction", "two scalar requests cannot claim the same quantity");
  assert(duplicateAudit.audit.issues.some((issue) => issue.code === "duplicate_result_binding"));

  const verified = await normalizeAndAudit(bindingFixture());
  const incompatibleUnit = structuredClone(verified.plan);
  incompatibleUnit.derived[0]!.unit = "cm";
  const unitAudit = verifyTurnPlanAgainstSolver(verified.problem, verified.result, incompatibleUnit, verified.plan.question);
  assert.equal(unitAudit.status, "contradiction", "the unchanged deterministic auditor rejects a retained incompatible-unit join");
  assert(unitAudit.issues.some((issue) => issue.code === "unit_mismatch"));
  const unitBoundary = await normalizeAndAudit({ problem: verified.problem, plan: incompatibleUnit });
  assert.equal(unitBoundary.audit.status, "incomplete", "a model-boundary unit mismatch loses its unsupported binding rather than gaining authority");
  assert.equal(unitBoundary.problem.solveRequests[0]!.resultBinding, undefined);
  assert.deepEqual(unitBoundary.audit.bindings, []);

  const mixedSource = bindingFixture();
  mixedSource.problem.question = "Different synthetic source.";
  const sourceValidation = validateProblemIR(
    normalizeProblemIRModelOutput(mixedSource.problem, mixedSource.plan.question, mixedSource.plan), mixedSource.plan.question,
  );
  assert.equal(sourceValidation.problem, null, "the model boundary never joins a different trusted question");
  assert(sourceValidation.issues.some((issue) => issue.code === "question_mismatch"));

  const zeroRequests = bindingFixture();
  zeroRequests.problem.solveRequests = [];
  const zero = await normalizeAndAudit(zeroRequests);
  assert.equal(zero.audit.status, "not_applicable", "zero numeric requests preserve the existing no-second-opinion status");
  assert.deepEqual(zero.audit.bindings, []);
  assert.deepEqual(zero.result.values, [], "zero requests cannot manufacture a solved scalar");
  const mixedPlanFormatting = await normalizeAndAudit(bindingFixture("x_max", "xₘₐₓ", "x_max"));
  assert(mixedPlanFormatting.problem.solveRequests[0]!.resultBinding,
    "transport recognizes formatting equivalence independently of plan validation");
  assert.equal(mixedPlanFormatting.audit.status, "verified",
    "equivalent formatting survives the full boundary for a source-valid, explicitly identified plan quantity");
  console.log(`verified Request 50 binding boundary: ${1 + identities.length + 8} synthetic scenarios; Unicode/case/Greek identity, unchanged real solver safeguards, retained requests, no aliases and no input mutation`);
}

if (basename(process.argv[1] ?? "") === "verify-request50-binding-boundary.ts") {
  void main().catch((error) => { console.error(error); process.exitCode = 1; });
}
