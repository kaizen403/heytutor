import { applySourceQuantityAuthority, type TurnPlanV3 } from "@heytutor/scene-engine";
import type { ProblemAuthorityV1Decline } from "@heytutor/tutor-core";

/** Explicit refusal is distinct from not having attempted a formulation. */
export function withdrawDeclinedProblemAuthority(
  plan: TurnPlanV3,
  refusal: ProblemAuthorityV1Decline,
): TurnPlanV3 {
  const sourcePlan = applySourceQuantityAuthority(plan, refusal.rawProblemIR, refusal.question).plan;
  // Null/unparseable raw content is still a known refused attempt. Preserve it
  // in refusal evidence; never manufacture an IR to trigger withdrawal.
  return { ...sourcePlan, derived: [], unknowns: [], qualitativeClaims: [], assumptions: [] };
}
