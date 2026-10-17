import {
  applySourceQuantityAuthority,
  type TurnPlanV3,
} from "@heytutor/scene-engine";

/**
 * Recompute the source model independently of any planner prose. A missing
 * ProblemIR does not make deterministic circuit/optics/mechanics facts into
 * unchecked model guesses; conversely, a corrected number must not certify
 * all the unrelated claims in a model's plan.
 */
export function sourceTeachingFacts(question: string): string {
  const emptyPlan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3",
    question,
    visualRequirement: "required",
    givens: [],
    derived: [],
    unknowns: [],
    qualitativeClaims: [],
    lawIds: [],
    assumptions: [],
  };
  const result = applySourceQuantityAuthority(emptyPlan, null, question);
  if (
    result.outcomes.length === 0 ||
    result.outcomes.some((outcome) => outcome.declineFigure)
  )
    return "";
  const { givens, derived, qualitativeClaims } = result.plan;
  if (givens.length + derived.length + qualitativeClaims.length === 0)
    return "";
  return `SOURCE-COMPUTED FACTS
The scene engine recomputed only the facts below from the question's stated inputs and physical roles, without using the planner's answers. These facts take precedence over conflicting model working or qualitative claims above. Explain the governing equations consistently with them. Keep object and image positions distinct, and distinguish the direction of velocity from acceleration when explaining friction.
${JSON.stringify({ givens, derived, qualitativeClaims })}`;
}
