import type { TurnPlanV3 } from "@heytutor/scene-engine";
import type { ProblemAuthorityV1Decline } from "@heytutor/tutor-core";

/** Explicit refusal is distinct from not having attempted a formulation. */
export function withdrawDeclinedProblemAuthority(
  plan: TurnPlanV3,
  refusal: ProblemAuthorityV1Decline,
): TurnPlanV3 {
  // Null/unparseable raw content is still a known refused attempt. Preserve it
  // and the original caller Plan in refusal evidence. The teaching envelope
  // grants no numeric/law/claim authority and carries no hidden obligations.
  // This is a terminal refusal, never a smaller IR used to regain permission.
  return {
    schemaVersion: "turn-plan/v3", question: refusal.question,
    givens: [], derived: [], unknowns: [], qualitativeClaims: [], lawIds: [],
    assumptions: [], visualRequirement: plan.visualRequirement,
  };
}
