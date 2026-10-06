import {
  SCENE_ARTIFACTS_V3_VERSION,
  admitFiniteBinomialProblem,
  evaluateMathExpression,
  expandFinitePolynomial,
  exactPolynomialText,
  finitePolynomialCoefficient,
  expressionToSafeSource,
  finiteBinomialPlanIssues,
  finiteProgressionSourceProgram,
  hasOnlyFiniteBinomialPlanFields,
  readFiniteBinomialProgram,
  readFiniteProgressionSource,
  readScrewGaugeQuestion,
  readUniformCircularRuntimeContract,
  snapshotMathSourceData,
  uniformCircularCallerIssues,
  validateProblemIR,
  validateSolverResult,
  validateTurnPlanV3,
  verifyMeasurementSourceAuthority,
  verifyTurnPlanAgainstSolver,
  type ProblemIR,
  type SolverAuthorityAudit,
  type SolverResult,
  type TurnPlanV3,
} from "@heytutor/scene-engine";

export interface NumericOnlyAuthority {
  problemIR: ProblemIR;
  turnPlan: TurnPlanV3;
  solverResult: SolverResult;
  solverAuthority: SolverAuthorityAudit;
}

/**
 * Numeric retention is opt-in to existing whole-source proofs, never to an
 * arbitrary solvable expression. Inspect the ORIGINAL plan before validators
 * can erase unknown fields. Refusal evidence is opaque and never an input.
 * No source correction, graph selection, claim pruning or IR synthesis here.
 */
export function numericOnlyAuthority(raw: unknown, question: string): NumericOnlyAuthority | null {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const artifacts = snapshotMathSourceData(raw) as Record<string, unknown>;
    if (artifacts.schemaVersion !== SCENE_ARTIFACTS_V3_VERSION || artifacts.problemIRRejection != null
      || !hasOnlyFiniteBinomialPlanFields(artifacts.turnPlan)) return null;
    const problem = validateProblemIR(artifacts.problemIR, question).problem;
    const plan = validateTurnPlanV3(artifacts.turnPlan, question).plan;
    if (!problem || !plan || problem.question !== question || plan.question !== question || !problem.solveRequests.length) return null;

    const measurement = readScrewGaugeQuestion(question);
    if (measurement.status !== "none") {
      const source = verifyMeasurementSourceAuthority(artifacts.problemIR, artifacts.turnPlan, question);
      if (source.status !== "verified" || source.issues.length) return null;
    } else if (readFiniteBinomialProgram(question).status === "ok") {
      if (admitFiniteBinomialProblem(question, artifacts.problemIR).status !== "ok"
        || finiteBinomialPlanIssues(question, artifacts.problemIR, artifacts.turnPlan).length) return null;
    } else if (readFiniteProgressionSource(question).status === "ok") {
      if (finiteProgressionSourceProgram(question, artifacts.problemIR, artifacts.turnPlan).status !== "ok") return null;
    } else if (readUniformCircularRuntimeContract(question)?.status === "bound") {
      if (uniformCircularCallerIssues(question, artifacts.problemIR, artifacts.turnPlan).length) return null;
    } else return null;

    const submitted = validateSolverResult(artifacts.solverResult, problem).result;
    if (!submitted || submitted.status !== "solved") return null;
    // The admitted profiles use bounded, variable-free evaluate requests.
    // Read normalization is synchronous: independently re-evaluate every AST,
    // replacing cached proofs/audits. Server saves additionally use the full
    // canonicalSolverArtifacts exact recomputation before persisting.
    const values: SolverResult["values"] = [];
    const proofs: SolverResult["proofs"] = [];
    for (const request of problem.solveRequests) {
      if (request.kind !== "evaluate") return null;
      const expression = problem.expressions.find(row => row.id === request.expressionId);
      const value = submitted.values.find(row => row.requestId === request.id);
      if (!expression || !value || value.valueType !== "scalar" || typeof value.approximate !== "number" || value.errorBound !== 0) return null;
      const approximate = evaluateMathExpression(expressionToSafeSource(expression.root), 0);
      if (!Number.isFinite(approximate) || !sameNumericValue(value.approximate, approximate)) return null;
      // Recompute rational exact strings through the existing bounded algebra
      // kernel too. Nonrational UCM expressions have no exact scalar string.
      let exact: {kind: "integer" | "rational"; value: string} | undefined;
      try {
        const polynomial = expandFinitePolynomial(expression.root);
        if (polynomial.degree !== 0) return null;
        const text = exactPolynomialText(finitePolynomialCoefficient(polynomial, 0));
        exact = {kind: text.includes("/") ? "rational" : "integer", value: text};
      } catch { /* Nonrational expressions retain independently evaluated scalars only. */ }
      if (exact ? !value.exact || Array.isArray(value.exact) || value.exact.kind !== exact.kind || value.exact.value !== exact.value
        : value.exact !== undefined) return null;
      values.push({id:`value_${request.id}`,requestId:request.id,valueType:"scalar",approximate,errorBound:0,...(exact ? {exact} : {})});
      proofs.push({id:`proof_${request.id}`,requestId:request.id,method:"exact_arithmetic",expressionIds:[expression.id],verified:true,residual:0,tolerance:0,detail:"Re-evaluated the complete source-admitted numeric expression at read admission."});
    }
    const solverResult: SolverResult = {schemaVersion:"solver-result/v1",problemId:problem.id,providerId:"local-deterministic/v1",status:"solved",values,proofs,issues:[]};
    const solverAuthority = verifyTurnPlanAgainstSolver(problem, solverResult, plan, question);
    if (solverAuthority.status !== "verified") return null;
    // Generic TurnPlan validation builds a projection. Authority above proves
    // the whole original; retain that original instead of its projection.
    return {problemIR:problem,turnPlan:artifacts.turnPlan as TurnPlanV3,solverResult,solverAuthority};
  } catch { return null; }
}

function sameNumericValue(actual: number, expected: number): boolean {
  return actual === expected || actual !== 0 && expected !== 0
    && Math.sign(actual) === Math.sign(expected)
    && Math.abs(actual - expected) <= 32 * Number.EPSILON * Math.abs(expected);
}

/** Presence of an authority-shaped payload requires admission even without IR. */
export function hasNumericOnlyPayload(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return ["problemIR", "solverResult", "solverAuthority", "turnPlan"].some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    return descriptor && (!("value" in descriptor) || descriptor.value != null);
  });
}

/** Remove visual claims and rebuild numeric claims for a scene-less saved turn. */
export function normalizedNumericOnlyArtifacts(raw: unknown, question: string, retryRequired: boolean): Record<string, unknown> {
  const numeric = numericOnlyAuthority(raw, question);
  const preserved: Record<string, unknown> = {};
  // Independently bounded diagnostics/page metadata survive even when the
  // numeric graph itself contains an invalid value, accessor or cycle.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of ["codeLesson", "boardContinuation", "problemIRRejection", "sourcePlanEvidence", "degradation"]) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (!descriptor || !("value" in descriptor)) continue;
      try { preserved[key] = snapshotMathSourceData(descriptor.value); } catch { /* Omit malformed metadata only. */ }
    }
  }
  const result = { ...preserved,
    schemaVersion: SCENE_ARTIFACTS_V3_VERSION,
    turnPlan: numeric?.turnPlan ?? null,
    problemIR: numeric?.problemIR ?? null,
    solverResult: numeric?.solverResult ?? null,
    solverAuthority: numeric?.solverAuthority ?? null,
    candidates: [], selectedCandidateId: null, proofObligations: [], visualReview: null,
    selectionReason: numeric ? "complete source-admitted numeric authority retained without a diagram"
      : "numeric-only authority declined during read admission",
    diagramResultStatus: retryRequired ? "retry_required" : "text_only",
  };
  for (const key of ["representationTier", "nonMetric"]) delete (result as Record<string, unknown>)[key];
  if (typeof preserved.sourcePlanEvidence !== "string" || preserved.sourcePlanEvidence.length > 200_000) {
    delete (result as Record<string, unknown>).sourcePlanEvidence;
  }
  return result;
}
