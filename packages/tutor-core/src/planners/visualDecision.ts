import { validateProblemIR, validateTurnPlanV3, type ProblemIR, type TurnPlanV3, type VisualRequirement } from "@heytutor/scene-engine";
import {
  inferSceneCapabilities, isQualitativeConceptQuestion, qualitativeQuestionAllowsScene,
  sceneFamiliesForceVisualRequirement,
} from "./sceneCapabilities";

export const SCENE_VISUAL_DECISION_ENABLED = process.env.NEXT_PUBLIC_SCENE_VISUAL_DECISION === "1";
export const SCENE_VISUAL_DECISION_POLICY = "scene-visual-decision/v1";

export interface VisualDecisionOptions {
  visualDecisionEnabled?: boolean;
}

export type VisualDecisionReason =
  | "required" | "evaluated" | "source_program" | "compatible_peer" | "source_structure" | "planned";

export interface VisualDecisionResult {
  requirement: VisualRequirement;
  reason: VisualDecisionReason;
}

export interface VisualDecisionInput extends VisualDecisionOptions {
  question: string;
  selectedPlan: TurnPlanV3;
  visualNeedRequirement: VisualRequirement | null;
  /** Only the full source-validated IR, never a loose capability view. */
  problemIR?: ProblemIR | null;
  /** Accepted, completed lanes only; this resolver never waits for peers. */
  peerTurnPlans?: readonly TurnPlanV3[];
  hasSourceProgram?: boolean;
}

export function isVisualDecisionEnabled(options: VisualDecisionOptions = {}): boolean {
  return options.visualDecisionEnabled ?? SCENE_VISUAL_DECISION_ENABLED;
}

export function explicitDiagramRequest(question: string): boolean {
  return /\b(?:draw|diagram|illustrat(?:e|ion)|sketch|construct|plot|graph|locate|mark|show\s+(?:the\s+)?(?:ray|circuit|figure|geometry|position|image))\b/i.test(question);
}

/** References an accompanying figure without an explicit draw verb ("as shown in the figure", "the figure shows"). */
export function referencesFigure(question: string): boolean {
  return /\b(?:as\s+shown\s+in\s+(?:the\s+)?(?:figure|diagram)|in\s+the\s+(?:figure|diagram)|the\s+(?:figure|diagram)\s+shows|shown\s+in\s+the\s+(?:figure|diagram)|figure\s+below|diagram\s+below|see\s+(?:the\s+)?figure)\b/i.test(question);
}

export function questionRequiresVisual(question: string, options: VisualDecisionOptions = {}): boolean {
  // A qualitative assertion/reason or multiple-choice concept check teaches
  // text-only unless the stem still names a spatial apparatus to set up.
  if (isQualitativeConceptQuestion(question) && !qualitativeQuestionAllowsScene(question)) {
    return explicitDiagramRequest(question);
  }
  return explicitDiagramRequest(question) ||
    referencesFigure(question) ||
    (!isVisualDecisionEnabled(options) && sceneFamiliesForceVisualRequirement(inferSceneCapabilities(question).families)) ||
    /\b(?:mirror|lens|prism|ray\s+optics|circuit|free[- ]body|force\s+diagram|field\s+line|vector\s+diagram|geometry\s+construction|apparatus|ray\s+diagram|parabola|ellipse|hyperbola|directrix|eccentricity|foci|latus\s+rectum|tangent\s+to\s+the\s+(?:curve|circle|parabola|ellipse|hyperbola)|normal\s+to\s+the\s+(?:curve|circle))\b/i.test(question);
}

/** Visual policy changes no quantities, claims, timing, or drawing authority. */
export function resolveVisualDecision(input: VisualDecisionInput): VisualDecisionResult {
  const { selectedPlan, visualNeedRequirement } = input;
  if (selectedPlan.visualRequirement === "required" || questionRequiresVisual(input.question, input)) {
    return { requirement: "required", reason: "required" };
  }
  if (visualNeedRequirement !== null) {
    return { requirement: visualNeedRequirement, reason: "evaluated" };
  }
  if (selectedPlan.visualRequirement === "none" && input.hasSourceProgram) {
    return { requirement: "optional", reason: "source_program" };
  }
  if (isVisualDecisionEnabled(input) && selectedPlan.visualRequirement === "none" &&
      validateTurnPlanV3(selectedPlan, input.question).valid) {
    const authority = planAuthority(selectedPlan);
    const compatible = input.peerTurnPlans?.some((peer) => peer.visualRequirement !== "none" &&
      validateTurnPlanV3(peer, input.question).valid && planAuthority(peer) === authority);
    if (compatible) return { requirement: "optional", reason: "compatible_peer" };
    if (hasSourceVisualStructure(input.problemIR, input.question)) {
      return { requirement: "optional", reason: "source_structure" };
    }
  }
  return { requirement: selectedPlan.visualRequirement, reason: "planned" };
}

function hasSourceVisualStructure(input: ProblemIR | null | undefined, question: string): boolean {
  if (!input) return false;
  const problem = validateProblemIR(input, question).problem;
  if (!problem) return false;
  const sourceFacts = new Set(problem.facts.filter((fact) => fact.kind !== "assumption").map((fact) => fact.id));
  const entities = new Map(problem.entities.map((entity) => [entity.id, entity]));
  return problem.representationIntents.some((intent) => {
    if (intent.kind === "conceptual") return false;
    const intentFacts = new Set(intent.evidenceFactIds.filter((id) => sourceFacts.has(id)));
    const grounded = (ids: readonly string[]) => ids.some((id) => intentFacts.has(id));
    const referenced = intent.entityIds.map((id) => entities.get(id)!);
    // Complete intent entities need their own source evidence. A grounded
    // curve cannot lend authority to an assumed point or a free-form label.
    if (intentFacts.size === 0 || referenced.some((entity) =>
      entity.kind === "other" || entity.kind === "state" || !grounded(entity.evidenceFactIds))) return false;
    const intentEntities = new Set(intent.entityIds);
    const relation = problem.constraints.some((constraint) =>
      constraint.kind !== "equation" && constraint.kind !== "inequality" &&
      new Set(constraint.entityIds).size >= 2 && constraint.entityIds.every((id) => intentEntities.has(id)) &&
      grounded(constraint.evidenceFactIds));
    const graphFunction = intent.kind === "graph" && problem.expressions.some((expression) =>
      expression.valueType === "function" && grounded(expression.evidenceFactIds) &&
      referenced.some((entity) => entity.kind === "curve" &&
        entity.evidenceFactIds.some((id) => intentFacts.has(id) && expression.evidenceFactIds.includes(id))));
    return relation || graphFunction;
  });
}

function planAuthority(plan: TurnPlanV3): string {
  // Provenance is response metadata. Persisted assumptions and all claimed
  // content stay authority; old assumption strings are never interpreted.
  const authority = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "visualRequirement"));
  return JSON.stringify(canonicalValue(authority));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([first], [second]) => first.localeCompare(second))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}
