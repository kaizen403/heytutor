/**
 * Pure production figure decision. Network planning, cache writes, telemetry
 * and presentation stay in the callers; admission and its order live here.
 */
import {
  ARCHETYPES, compileSceneDocument, detectArchetype, isChemistryQuestion, isChemistrySceneFamily,
  normalizeClaimedClosedRouteGeometry, normalizeClaimedParaxialReflectionGeometry,
  pruneDeadSceneEntities, pruneUnverifiedSceneAnnotations, displayedSceneQuantityTexts,
  validateMatrixSourceBinding, validateSceneQuantityAgreement, validateSceneDocument,
  validateSphericalRefractionImagePlacements, validateTurnPlanSceneProofs, resolveDiagramFailureStatus,
  type FigureSource, type ProblemStructureView, type RenderScene, type SceneDocument,
  type TurnPlanV3, type ValidationReport,
} from "@heytutor/scene-engine";
import { inferSceneCapabilities, questionRequiresVisual, type SceneCandidateValidation } from "@heytutor/tutor-core";
import type { VisualNeedDecision } from "@/lib/llm/visualNeedPolicy";
import { liveSceneSaveFailure } from "@/lib/scene/sceneSaveAdmission";
import { shouldAttemptExactScene } from "./diagramGeneration";
import { resolveVisualRequirement } from "./visualRequirement";
import {
  selectVerifiedRepresentationExplained, type ExactCandidateDecline, type SelectedRepresentation,
} from "./representationFallback";

/** Lab execution identity: old rounds did not use all production admission guards. */
export const PRODUCTION_SCENE_SELECTION_VERSION = "production-scene-selection/v2";

export interface ProductionSceneInput {
  question: string;
  turnPlan: TurnPlanV3;
  problemIR: ProblemStructureView | null;
  sceneCapabilities?: ReturnType<typeof inferSceneCapabilities>;
  /** Omit only when the plan already contains the merged live decision. Null is unavailable, not none. */
  visualNeedDecision?: VisualNeedDecision | null;
  conversationContext?: string;
}

export interface ValidatedSceneCandidate {
  document: SceneDocument;
  renderScene: RenderScene;
  report: ValidationReport;
}

export interface ProductionSceneGate {
  turnPlan: TurnPlanV3;
  sceneCapabilities: ReturnType<typeof inferSceneCapabilities>;
  chemistryLane: boolean;
  shouldPlanExactScene: boolean;
  shouldAttemptLlmScene: boolean;
  families: readonly string[];
  archetypeId: string | null;
  request: {
    conversationContext: string;
    constructionOperators?: string[];
    proofPredicates?: string[];
    planningGuidance?: string[];
  };
}

/** The live gate, including chemistry exemption and family/archetype/source-program admission. */
export function deriveSceneGate(input: ProductionSceneInput): ProductionSceneGate {
  const { question, problemIR } = input;
  const sceneCapabilities = input.sceneCapabilities ?? inferSceneCapabilities(question, {
    lawIds: input.turnPlan.lawIds, problemIR, turnPlan: input.turnPlan,
  });
  const planningTurnPlan = input.visualNeedDecision === undefined ? input.turnPlan : {
    ...input.turnPlan,
    visualRequirement: resolveVisualRequirement(input.turnPlan.visualRequirement, input.visualNeedDecision,
      questionRequiresVisual(question), sceneCapabilities.hasSourceProgram === true),
  };
  const chemistryLane = sceneCapabilities.families.some(isChemistrySceneFamily) || isChemistryQuestion(question);
  const shouldPlanExactScene = planningTurnPlan.visualRequirement !== "none" && !chemistryLane;
  const earlyArchetype = detectArchetype(question, { turnPlan: planningTurnPlan, problemIR });
  const shouldAttemptLlmScene = shouldAttemptExactScene({
    visualRequirement: planningTurnPlan.visualRequirement,
    chemistryLane, familyCount: sceneCapabilities.families.length,
    hasArchetype: earlyArchetype !== null, hasSourceProgram: sceneCapabilities.hasSourceProgram,
  });
  const planContext = [
    input.conversationContext,
    `AUTHORITATIVE TURN PLAN V3\n${JSON.stringify(planningTurnPlan)}\nDo not contradict, replace, or independently recalculate these quantities and claims.`,
  ].filter(Boolean).join("\n\n");
  // A score-2 relation cue (for example, "angle between") can admit a planner
  // attempt, but cannot prescribe the catalogue's specific figure roles. Keep
  // numeric-free apparatus hints; slot availability is not role confidence.
  const archetypeSpec = earlyArchetype && earlyArchetype.score >= 3 ? ARCHETYPES[earlyArchetype.id] : null;
  const archetypeGuidance = archetypeSpec ? [
    `Figure: ${archetypeSpec.label}. It must contain entities with roles: ${archetypeSpec.contract.roles.join(", ")}` +
      (archetypeSpec.contract.operators?.length ? `; use ${archetypeSpec.contract.operators.join(", ")}` : "") + ".",
  ] : [];
  return {
    turnPlan: planningTurnPlan, sceneCapabilities, chemistryLane, shouldPlanExactScene,
    shouldAttemptLlmScene, families: sceneCapabilities.families, archetypeId: earlyArchetype?.id ?? null,
    request: {
      conversationContext: planContext,
      ...(sceneCapabilities.families.length > 0 || sceneCapabilities.hasSourceProgram ? {
        constructionOperators: sceneCapabilities.constructionOperators,
        proofPredicates: sceneCapabilities.proofPredicates,
        planningGuidance: [...sceneCapabilities.planningGuidance, ...archetypeGuidance],
      } : archetypeGuidance.length > 0 ? { planningGuidance: archetypeGuidance } : {}),
    },
  };
}

/** Candidate validation order is unchanged: normalize/prune, quantities, source, obligations, compile. */
export function validateProductionSceneCandidate(input: {
  candidate: Record<string, unknown>; question: string; turnPlan: TurnPlanV3;
}): SceneCandidateValidation<ValidatedSceneCandidate> {
  const { candidate, question, turnPlan: authoritativePlan } = input;
  let validated = validateSceneDocument(pruneDeadSceneEntities(candidate));
  if (!validated.document) {
    return {
      valid: false,
      errors: validated.report.issues,
    };
  }
  const routeNormalized = normalizeClaimedClosedRouteGeometry(
    validated.document,
    authoritativePlan,
  );
  const constraintNormalized = normalizeClaimedParaxialReflectionGeometry(
    routeNormalized,
    authoritativePlan,
  );
  if (constraintNormalized !== validated.document) {
    validated = validateSceneDocument(pruneDeadSceneEntities(
      constraintNormalized as unknown as Record<string, unknown>,
    ));
    if (!validated.document) {
      return {
        valid: false,
        errors: validated.report.issues,
      };
    }
  }
  const annotationPruned = pruneUnverifiedSceneAnnotations(validated.document, authoritativePlan);
  if (annotationPruned !== validated.document) {
    validated = validateSceneDocument(pruneDeadSceneEntities(
      annotationPruned as unknown as Record<string, unknown>,
    ));
    if (!validated.document) {
      return {
        valid: false,
        errors: validated.report.issues,
      };
    }
  }
  const agreementIssues = validateSceneQuantityAgreement(
    validated.document.quantities,
    authoritativePlan,
    displayedSceneQuantityTexts(validated.document),
  );
  const authorityIssues = agreementIssues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path,
    severity: "fatal" as const,
  }));
  const sourceIssues = validateMatrixSourceBinding(validated.document, question, authoritativePlan);
  const proofIssues = validateTurnPlanSceneProofs(validated.document, authoritativePlan);
  // A literal image point at a plan-derived distance from a refracting
  // surface's vertex must be where the spherical refraction law puts it.
  const refractionImageIssues = validateSphericalRefractionImagePlacements(validated.document, authoritativePlan);
  const compiledScene = compileSceneDocument(validated.document);
  // Final admission already requires readable ink. Reject the same candidates
  // here so a cheaper unlabelled scene cannot displace a drawable sibling.
  const missingReadableLabel = compiledScene.ok && compiledScene.renderScene &&
    validated.document.visualDecision.mode === "scene" && authoritativePlan.visualRequirement !== "none" &&
    !compiledScene.renderScene.primitives.some((primitive) =>
      (primitive.kind === "label" || primitive.kind === "dimension") &&
      typeof primitive.text === "string" && primitive.text.trim().length > 0);
  const fatalIssues = [
    ...sourceIssues,
    ...authorityIssues,
    ...proofIssues,
    ...refractionImageIssues,
    ...compiledScene.report.issues,
    ...(missingReadableLabel ? [{
      code: "scene_without_readable_label",
      message: "A requested scene must contain readable label or dimension text attached to its geometry.",
      path: "entities",
      severity: "fatal" as const,
    }] : []),
  ].filter((issue) => issue.severity === "fatal");
  if (fatalIssues.length > 0 || !compiledScene.ok || !compiledScene.renderScene) {
    return {
      valid: false,
      errors: fatalIssues.length > 0 ? fatalIssues : compiledScene.report.issues,
    };
  }
  return {
    valid: true,
    errors: [...proofIssues, ...compiledScene.report.issues],
    qualityScore:
      (validated.document.visualDecision.mode === "text_only" &&
      authoritativePlan.visualRequirement !== "none"
        ? authoritativePlan.visualRequirement === "required" ? 100_000 : 10_000
        : 0) +
      compiledScene.report.issues.filter((issue) => issue.severity === "warning").length * 1_000 +
      compiledScene.report.stats.primitiveCount * 2 +
      compiledScene.report.stats.entityCount +
      compiledScene.report.stats.constructionCount,
    value: {
      document: validated.document,
      renderScene: compiledScene.renderScene,
      report: compiledScene.report,
    },
  };

}

export interface ProductionSceneSelectionInput extends ProductionSceneInput {
  /** Raw planner response, or the validation produced by the shared asynchronous planning callback. */
  candidate?: Record<string, unknown> | null;
  candidateValidation?: SceneCandidateValidation<ValidatedSceneCandidate> | null;
  fastRepresentation?: SelectedRepresentation | null;
  exactFigureSource?: "planner" | "verified_recovery";
  solverAuthorityBlocked?: boolean;
  /** Explicit policy inputs: this pure module never reads rollout/retry settings. */
  requiredRetryEnabled?: boolean;
  policy?: { preferPlanner?: boolean; allowedFigureSources?: readonly FigureSource[] };
}

export interface ProductionSceneSelection {
  gate: ProductionSceneGate;
  representation: SelectedRepresentation | null;
  /** Diagnostics only: a rejected attempt must never be presented or saved. */
  attemptedRepresentation: SelectedRepresentation | null;
  candidateValidation: SceneCandidateValidation<ValidatedSceneCandidate> | null;
  visualStatus: "validated" | "retry_required" | "text_only";
  reason: string;
  /** Retains the production artifact reason even when a later admission guard declines it. */
  selectionReason: string;
  hasReadableInk: boolean;
  sourceAllowed: boolean;
  saveFailure: string | null;
  /**
   * Set whenever a candidate that passed validation as a scene is not the
   * figure drawn. Null when there was no such candidate or it was drawn.
   */
  droppedCandidate: DroppedSceneCandidate | null;
}

export interface DroppedSceneCandidate extends ExactCandidateDecline {
  /** The figure drawn instead, or null when the turn draws none. */
  replacedBy: FigureSource | null;
}

/** Issue code saved with every valid candidate that selection did not draw. */
export const VALID_CANDIDATE_DROPPED = "valid_candidate_dropped";

/**
 * The degradation a dropped valid candidate leaves on the turn. A policy that
 * draws another verified figure instead (a fast or source-computed figure)
 * records nothing; every other drop is a check the per-candidate validator
 * does not apply, so it is saved, shown on the admin fails page and reported.
 */
export function validCandidateDropDegradation(
  selection: Pick<ProductionSceneSelection, "droppedCandidate">,
  candidateCount: number,
): { attemptedTier: "exact_verified"; reason: "valid_candidate_dropped"; issueCodes: string[]; candidateCount: number } | null {
  const dropped = selection.droppedCandidate;
  if (!dropped || (dropped.preferred && dropped.replacedBy !== null)) return null;
  return {
    attemptedTier: "exact_verified",
    reason: VALID_CANDIDATE_DROPPED,
    issueCodes: [VALID_CANDIDATE_DROPPED, dropped.code],
    candidateCount,
  };
}

/**
 * One live/lab final decision: effective visual need → validated exact/fallback
 * selection → readable ink → source policy → exact obligations/save admission
 * → solver-blocked commit. Invalid or rejected candidates never become output geometry.
 */
export function selectProductionScene(input: ProductionSceneSelectionInput): ProductionSceneSelection {
  const gate = deriveSceneGate(input);
  const { question } = input;
  const turnPlan = gate.turnPlan;
  // A drop is only meaningful for a candidate that validated as a scene. A
  // solver contradiction already records its own degradation.
  const validScene = (validation: SceneCandidateValidation<ValidatedSceneCandidate> | null | undefined) =>
    !input.solverAuthorityBlocked && validation?.valid === true && validation.value?.document.visualDecision.mode === "scene";
  const empty = (
    reason: string,
    visualStatus: ProductionSceneSelection["visualStatus"],
    droppedCandidate: DroppedSceneCandidate | null = null,
  ): ProductionSceneSelection => ({
    gate, representation: null, attemptedRepresentation: null, candidateValidation: null,
    visualStatus, reason, selectionReason: reason, hasReadableInk: false, sourceAllowed: true, saveFailure: null,
    droppedCandidate,
  });
  let candidateValidation: SceneCandidateValidation<ValidatedSceneCandidate> | null = input.candidateValidation ?? null;
  try {
    // Preserve the live no-figure guard, not just the planner's vote.
    if (turnPlan.visualRequirement === "none" && !questionRequiresVisual(question)) {
      return empty("the question asks for no figure", "text_only", validScene(candidateValidation)
        ? { code: "no_figure_asked", reason: "the question asks for no figure", preferred: true, replacedBy: null }
        : null);
    }
    candidateValidation = input.candidate
      ? validateProductionSceneCandidate({ candidate: input.candidate, question, turnPlan })
      : input.candidateValidation ?? null;
    const value = validScene(candidateValidation) && gate.shouldPlanExactScene ? candidateValidation?.value : undefined;
    const fallbackCapabilities = inferSceneCapabilities(question, {
      lawIds: turnPlan.lawIds, problemIR: input.problemIR, turnPlan,
    });
    const explained = input.fastRepresentation ? null : selectVerifiedRepresentationExplained({
      question, turnPlan, problemIR: input.problemIR,
      families: fallbackCapabilities.families.length > 0 ? fallbackCapabilities.families : gate.families,
      preferPlanner: input.policy?.preferPlanner,
      exact: value && value.document.visualDecision.mode === "scene" ? {
        sceneDocument: value.document, renderScene: value.renderScene, validationReport: value.report,
      } : null,
      exactFigureSource: input.exactFigureSource ?? "planner",
    });
    const selected = input.fastRepresentation ?? explained!.selected;
    const selectedHasInk = selected.renderScene.primitives.some((primitive) =>
      (primitive.kind === "label" || primitive.kind === "dimension") &&
      typeof primitive.text === "string" && primitive.text.trim().length > 0);
    const selectedSourceAllowed = input.policy?.allowedFigureSources === undefined ||
      input.policy.allowedFigureSources.includes(selected.figureSource);
    const saveFailure = selectedHasInk && selectedSourceAllowed && selected.sceneDocument.visualDecision.mode === "scene"
      ? liveSceneSaveFailure({ document: selected.sceneDocument, question, turnPlan, tier: selected.tier }) : null;
    const selectedIsDrawable = !input.solverAuthorityBlocked && selectedHasInk && selectedSourceAllowed && !saveFailure &&
      selected.sceneDocument.visualDecision.mode === "scene";
    const failureStatus = resolveDiagramFailureStatus({
      visualRequirement: turnPlan.visualRequirement, requiredRetryEnabled: input.requiredRetryEnabled ?? true,
    });
    const selectionReason = selectedSourceAllowed ? selected.reason : `strict strategy suppressed ${selected.figureSource}`;
    const reason = selectedIsDrawable ? selectionReason : input.solverAuthorityBlocked ? "solver_contradiction"
      : !selectedSourceAllowed ? selectionReason : saveFailure ?? (!selectedHasInk ? "representation carries no readable label" : selected.reason);
    const replacedBy = selectedIsDrawable ? selected.figureSource : null;
    // The exact branch may redeclare the earned tier on a copy, so the drawn
    // candidate is recognised by its provenance, not by object identity.
    const candidateDrawn = selectedIsDrawable && value !== undefined && !input.fastRepresentation &&
      !explained?.exactDecline && selected.figureSource === (input.exactFigureSource ?? "planner");
    // Every way a valid scene candidate can leave the board names itself.
    const decline: ExactCandidateDecline | null = !validScene(candidateValidation) || candidateDrawn ? null
      : !gate.shouldPlanExactScene ? { code: "exact_scene_not_admitted", reason: "the gate does not admit an exact scene for this question", preferred: false }
        : input.fastRepresentation ? { code: "fast_figure_preferred", reason: "a fast verified figure was selected first", preferred: true }
          : explained?.exactDecline ?? (saveFailure ? { code: "save_admission_refused", reason: saveFailure, preferred: false }
            : !selectedSourceAllowed ? { code: "source_policy_suppressed", reason: selectionReason, preferred: false }
              : { code: "exact_not_drawable", reason, preferred: false });
    return {
      gate, representation: selectedIsDrawable ? selected : null, attemptedRepresentation: selected,
      candidateValidation, visualStatus: selectedIsDrawable ? "validated" : failureStatus === "retry_required" ? "retry_required" : "text_only",
      reason, selectionReason, hasReadableInk: selectedHasInk, sourceAllowed: selectedSourceAllowed, saveFailure,
      droppedCandidate: decline ? { ...decline, replacedBy } : null,
    };
  } catch (error) {
    // The pre-existing exception path records required failures regardless of retry opt-out.
    const message = error instanceof Error ? error.message : String(error);
    return empty(message,
      turnPlan.visualRequirement === "required" || questionRequiresVisual(question) ? "retry_required" : "text_only",
      validScene(candidateValidation) ? { code: "selection_error", reason: message, preferred: false, replacedBy: null } : null);
  }
}
