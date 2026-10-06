import { buildSolverAuthorityProjection, verifyTurnPlanAgainstSolver, type TurnPlanV3 } from "@heytutor/scene-engine";
import type { ProblemAuthorityV1Response } from "@heytutor/tutor-core";

/** Source corrections must invalidate a projection of the old planner formulation.
 * Audit the final plan; never reconcile the old solver value over source truth. */
export function refreshSolverAuthorityForPlan(
  authority: ProblemAuthorityV1Response,
  plan: TurnPlanV3,
  question: string,
): ProblemAuthorityV1Response {
  // A source withdrawal can remove planner unknowns. Still audit every retained
  // result-bound derived quantity, so removing an unknown cannot hide a conflict.
  const unknownIds = new Set(plan.unknowns.map((quantity) => quantity.id));
  const boundIds = new Set(authority.problemIR.solveRequests.map((request) => request.resultBinding?.turnPlanQuantityId));
  const auditPlan: TurnPlanV3 = { ...plan, unknowns: [
    ...plan.unknowns,
    ...plan.derived.filter((quantity) => boundIds.has(quantity.id) && !unknownIds.has(quantity.id))
      .map(({ id, symbol, unit }) => ({ id, symbol, ...(unit ? { unit } : {}) })),
  ] };
  let audit = verifyTurnPlanAgainstSolver(authority.problemIR, authority.solverResult, auditPlan, question);
  const withdrawn = audit.bindings.filter((binding) => !plan.derived.some((quantity) => quantity.id === binding.quantityId));
  if (audit.status === "verified" && withdrawn.length > 0) {
    audit = { ...audit, status: "incomplete", issues: [...audit.issues, ...withdrawn.map((binding) => ({
      code: "source_authority_binding_withdrawn", quantityId: binding.quantityId,
      message: "The final source-authoritative plan no longer carries this solver result",
    }))] };
  }
  return {
    ...authority,
    audit,
    projection: audit.status === "verified"
      ? buildSolverAuthorityProjection(authority.problemIR, authority.solverResult, audit)
      : null,
  };
}
