import type { TurnPlanV3, VisualRequirement } from "@heytutor/scene-engine";

/** Opt-in: can start a previously skipped scene search or retain a pending peer. */
export function requiredFigurePolicyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REQUIRED_FIGURE_POLICY === "1";
}
export const REQUIRED_FIGURE_POLICY_VERSION = "source-visual-relations/v1";

export interface SourceVisualDemand {
  requirement: Exclude<VisualRequirement, "none">;
  reason: "explicit_visual" | "spatial_relation" | "explanatory_relation";
}

function explicitlyRequestsVisual(stem: string): boolean {
  return /(?:^|[.!?;,]|\b(?:and|then|next|afterwards|also)\b)\s*(?:(?:please|then|next|afterwards|also)\s+)*(?:draw|sketch|plot|illustrate)\b|\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:draw|sketch|plot|illustrate)\b|\b(?:with|using)\s+(?:(?:a|an|the)\s+)?(?:diagram|figure|graph|sketch)\b/i.test(stem);
}

export function isTextOnlyTeachingAsk(question: string): boolean {
  const stem = question.normalize("NFKC");
  if (/\b(?:do\s+not|don't)\s+(?:draw|sketch|plot|illustrate)\b|\b(?:without|no)\s+(?:(?:a|an|the)\s+)?(?:diagram|figure|graph|drawing|sketch|plot)\b/i.test(stem)) return true;
  if (explicitlyRequestsVisual(stem)) return false;
  return /^\s*(?:please\s+)?(?:define\b|who\s+(?:discovered|introduced|invented)\b)/i.test(stem) ||
    /^\s*(?:please\s+)?(?:state|give|explain|describe|what\s+(?:is|are))\b[^.!?;]{0,35}\b(?:definition|meaning|(?:SI\s+)?units?\s+of|etymology|history)\b/i.test(stem) ||
    /^\s*what\s+does\b[^.!?;]{0,55}\b(?:mean|stand\s+for)\b|\balgebraically\b/i.test(stem);
}

/**
 * Instructional need only, never a choice of family, operator or geometry.
 * A source relationship may warrant a picture without making it mandatory.
 * Definitions, factual recall and scalar/algebra-only work do not acquire a
 * figure just because their nouns also occur in visual lessons.
 */
export function sourceVisualDemand(question: string, plan: TurnPlanV3): SourceVisualDemand | null {
  const stem = question.normalize("NFKC");
  if (isTextOnlyTeachingAsk(stem)) return null;
  if (explicitlyRequestsVisual(stem)) {
    return { requirement: "required", reason: "explicit_visual" };
  }
  const spatialRelation = /\b(?:angle|distance|intersection|projection)\s+(?:between|of|onto)\b|\b(?:forces?\s+(?:acting|on)|rays?\s+(?:through|from)|(?:connected|arranged)\s+(?:in|across)|(?:two|three)\s+(?:planes|lines|circles))\b/i.test(stem);
  const locatedMotion = /\b(?:particle|body|block|ball|object)\b/i.test(stem) &&
    /\b(?:positions?\s+at|trajectory|path\s+(?:of|through)|located|relative\s+position)\b/i.test(stem);
  if (spatialRelation || locatedMotion) return { requirement: "required", reason: "spatial_relation" };
  if (!/^\s*(?:please\s+)?(?:explain|describe|compare|contrast|how\s+(?:does|do|is|are))\b/i.test(stem)) return null;
  const dimensionful = [...plan.givens, ...plan.derived, ...plan.unknowns]
    .some(q => q.unit && !/^(?:1|dimensionless|unitless)$/i.test(q.unit.trim()));
  const symbolicWork = /\b(?:expressions?|polynomials?|binomials?|coefficients?|exponents?|algebra|factor(?:ise|ize)?|simplify|expand)\b/i.test(stem) ||
    /(?:^|[\s([{])(?:[a-z](?:_\w+)?|\d+(?:\.\d+)?)\s*[+\-−*/^=]\s*(?:[a-z\d(])/i.test(stem);
  if (symbolicWork && !dimensionful) return null;
  // Use the accepted plan's source-facing relations, not an eval topic or ID.
  // No extra model call or invented measurements are introduced by this hint.
  const relation = [stem, ...plan.qualitativeClaims.flatMap(c => [c.claim, c.expected])].join(" ");
  if (/\b(?:depend(?:ence|s|ent)|var(?:y|ies|iation)|increas\w*|decreas\w*|growth|decay|changes?\s+(?:with|in|into)|interference|diffraction|path|flows?|direction|between\s+(?:two|the))\b/i.test(relation)) {
    return { requirement: "optional", reason: "explanatory_relation" };
  }
  return null;
}

export function applySourceVisualDemand(plan: TurnPlanV3, demand: SourceVisualDemand | null,
  enabled: boolean, advisory?: VisualRequirement | null): TurnPlanV3 {
  if (!enabled || !demand || plan.visualRequirement === "required") return plan;
  const requirement = demand.requirement === "required" ? "required"
    : plan.visualRequirement === "none" && advisory !== "none" ? "optional" : plan.visualRequirement;
  return requirement === plan.visualRequirement ? plan : { ...plan, visualRequirement: requirement };
}
