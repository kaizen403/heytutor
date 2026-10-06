import {
  buildSolverAuthorityProjection,
  buildUniformCircularSourceFallback,
  LocalDeterministicSolverProvider,
  prepareMatrixLiteralSourceAuthority,
  validateSolverResult,
  verifyTurnPlanAgainstSolver,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import type { ProblemAuthorityV1Response } from "@heytutor/tutor-core";

/** A closed source formulation carries its complete IR and freshly solved results. */
export async function prepareSourceProblemAuthority(
  question: string,
  plan: TurnPlanV3,
  existing: ProblemAuthorityV1Response | null = null,
): Promise<{ plan: TurnPlanV3; authority: ProblemAuthorityV1Response } | null> {
  const prepared = prepareMatrixLiteralSourceAuthority(question, plan, existing?.problemIR);
  if (!prepared) return null;
  const solverResult = await new LocalDeterministicSolverProvider().solve(prepared.problemIR);
  if (!validateSolverResult(solverResult, prepared.problemIR).valid || solverResult.status !== "solved") return null;
  const audit = verifyTurnPlanAgainstSolver(prepared.problemIR, solverResult, prepared.plan, question);
  if (audit.status !== "verified") return null;
  return { plan: prepared.plan, authority: {
    problemIR: prepared.problemIR, solverResult, audit,
    projection: buildSolverAuthorityProjection(prepared.problemIR, solverResult, audit),
    rawContent: existing?.rawContent ?? "source-formulation/literal-matrix",
    elapsedMs: existing?.elapsedMs ?? 0, ...(existing?.traceId ? { traceId: existing.traceId } : {}),
  } };
}

/** Use only when the model supplied no usable turn formulation, never over an existing IR. */
export async function unavailableSourceProblemAuthority(question: string): Promise<{ plan: TurnPlanV3; authority: ProblemAuthorityV1Response } | null> {
  const source = await buildUniformCircularSourceFallback(question);
  if (!source) return null;
  const audit = verifyTurnPlanAgainstSolver(source.problemIR, source.solverResult, source.turnPlan, question);
  if (audit.status !== "verified") return null;
  return { plan: source.turnPlan, authority: {
    problemIR: source.problemIR, solverResult: source.solverResult, audit,
    projection: buildSolverAuthorityProjection(source.problemIR, source.solverResult, audit),
    rawContent: "source-formulation/uniform-circular-state", elapsedMs: 0,
  } };
}
