import type { FigureSource } from "@heytutor/scene-engine";
import type { DiagramSubject } from "@heytutor/tutor-core";

export type DiagramStrategy = "current" | "strict";

export interface DiagramStrategyContext {
  chemistryLane: boolean;
  codeLesson: boolean;
  dsa: boolean;
  doubt: boolean;
  subject?: DiagramSubject;
  strictSubjects?: readonly DiagramSubject[];
}

export interface DiagramStrategyDecision extends DiagramStrategyContext {
  assignedStrategy: DiagramStrategy;
  /** The strategy actually used after subject/turn exemptions. */
  strategy: DiagramStrategy;
  selectionOrder: "current" | "planner_first";
  usePickedExamples: boolean;
}

/**
 * The single live/lab policy boundary for the strict diagram experiment.
 * Cohort assignment is deliberately separate: this function applies the
 * subject and turn exemptions and describes every downstream choice.
 */
export function decideDiagramStrategy(
  input: DiagramStrategyContext & { assignedStrategy: DiagramStrategy },
): DiagramStrategyDecision {
  const eligible =
    (input.assignedStrategy === "strict" ||
      (input.subject !== undefined && input.subject !== "other" && input.strictSubjects?.includes(input.subject))) &&
    !input.chemistryLane &&
    !input.codeLesson &&
    !input.dsa &&
    !input.doubt;
  const strategy: DiagramStrategy = eligible ? "strict" : "current";
  return {
    ...input,
    strategy,
    selectionOrder: strategy === "strict" ? "planner_first" : "current",
    usePickedExamples: strategy === "strict",
  };
}

export function liveDiagramStrategyDecision(
  input: DiagramStrategyContext & { assignedStrategy: DiagramStrategy },
): DiagramStrategyDecision {
  return decideDiagramStrategy(input);
}

export function evaluationDiagramStrategyDecision(
  arm: "current" | "planner_first" | "planner_examples" | "planner_examples_strict",
  context: DiagramStrategyContext,
): DiagramStrategyDecision {
  if (arm === "planner_examples_strict") {
    return decideDiagramStrategy({ assignedStrategy: "strict", ...context });
  }
  const current = decideDiagramStrategy({ assignedStrategy: "current", ...context });
  return {
    ...current,
    selectionOrder: arm === "current" ? "current" : "planner_first",
    usePickedExamples: arm === "planner_examples",
  };
}

/** Recovery is already server-verified and remains available in strict. */
export function diagramStrategyAllowsFigureSource(
  decision: DiagramStrategyDecision,
  source: FigureSource,
): boolean {
  return decision.strategy === "current" ||
    source === "planner" ||
    source === "verified_recovery" ||
    source === "text_only";
}
