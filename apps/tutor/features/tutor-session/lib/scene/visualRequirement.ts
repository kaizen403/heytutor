import type { ProblemIR, TurnPlanV3, VisualRequirement } from "@heytutor/scene-engine";
import { inferSceneCapabilities, isVisualDecisionEnabled, resolveVisualDecision } from "@heytutor/tutor-core";
import type { VisualNeedDecision } from "@/lib/llm/visualNeedPolicy";
import { diagramFailureVisualStatus } from "./diagramGeneration";

/** Jev resolves uncertain plans; explicit or structural requirements stay required. */
export function resolveVisualRequirement(
  planned: VisualRequirement,
  evaluated: VisualNeedDecision | null,
  deterministicRequired: boolean,
  sourceProgram = false,
  context?: {
    question: string;
    turnPlan: TurnPlanV3;
    problemIR?: ProblemIR | null;
    peerTurnPlans?: readonly TurnPlanV3[];
    visualDecisionEnabled?: boolean;
  },
): VisualRequirement {
  if (context && isVisualDecisionEnabled(context)) {
    return resolveVisualDecision({
      question: context.question, selectedPlan: context.turnPlan.visualRequirement === planned ? context.turnPlan
        : { ...context.turnPlan, visualRequirement: planned },
      visualNeedRequirement: evaluated, hasSourceProgram: sourceProgram,
      problemIR: context.problemIR, peerTurnPlans: context.peerTurnPlans,
      visualDecisionEnabled: context.visualDecisionEnabled,
    }).requirement;
  }
  if (planned === "required" || evaluated === "required" || deterministicRequired) return "required";
  // Jev unavailable (null: timeout, open circuit, no gateway key) is not a
  // "none" decision. A question the engine reads as a complete source program
  // (a matrix premise it binds) may still draw that program; every other
  // planner "none" stands, so no figure is invented without a bound source.
  if (evaluated === null && planned === "none" && sourceProgram) return "optional";
  return evaluated ?? planned;
}

export function resolveSelectedVisualStatus(
  requirement: VisualRequirement,
  hasReadableScene: boolean,
): "validated" | "retry_required" | "text_only" {
  if (hasReadableScene) return "validated";
  return diagramFailureVisualStatus(requirement);
}

/** Adopt the decision on the authoritative plan, not only on a derived scene gate. */
export function applyVisualDecisionToPlan(input: {
  question: string;
  turnPlan: TurnPlanV3;
  evaluated: VisualNeedDecision | null;
  problemIR: ProblemIR | null;
  visualDecisionEnabled?: boolean;
}): TurnPlanV3 {
  // Off must retain the exact old authority path, including object identity.
  if (!isVisualDecisionEnabled(input)) return input.turnPlan;
  const decision = resolveVisualDecision({
    question: input.question, selectedPlan: input.turnPlan,
    visualNeedRequirement: input.evaluated, problemIR: input.problemIR,
    hasSourceProgram: inferSceneCapabilities(input.question, {
      turnPlan: input.turnPlan, problemIR: input.problemIR,
    }).hasSourceProgram === true,
    visualDecisionEnabled: input.visualDecisionEnabled,
  });
  return decision.requirement === input.turnPlan.visualRequirement ? input.turnPlan : {
    ...input.turnPlan, visualRequirement: decision.requirement,
  };
}
