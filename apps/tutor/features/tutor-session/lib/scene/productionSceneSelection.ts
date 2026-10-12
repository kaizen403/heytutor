/**
 * Pure production figure decision. Network planning, cache writes, telemetry
 * and presentation stay in the callers; admission and its order live here.
 */
import {
  ARCHETYPES, compileSceneDocument, detectArchetype, isChemistryQuestion, isChemistrySceneFamily,
  normalizeClaimedClosedRouteGeometry, normalizeClaimedParaxialReflectionGeometry,
  pruneDeadSceneEntities, pruneUnverifiedSceneAnnotations, displayedSceneQuantityTexts,
  validateMatrixSourceBinding, validateSceneQuantityAgreement, validateSceneDocument,
  validateTurnPlanSceneProofs, resolveDiagramFailureStatus,
  type FigureSource, type ProblemStructureView, type RenderScene, type SceneDocument,
  type TurnPlanV3, type ValidationReport,
} from "@heytutor/scene-engine";
import { inferSceneCapabilities, questionRequiresVisual, type SceneCandidateValidation } from "@heytutor/tutor-core";
import type { VisualNeedDecision } from "@/lib/llm/visualNeedPolicy";
import { liveSceneSaveFailure } from "@/lib/scene/sceneSaveAdmission";
import { shouldAttemptExactScene } from "./diagramGeneration";
import { resolveVisualRequirement } from "./visualRequirement";
import { selectVerifiedRepresentation, type SelectedRepresentation } from "./representationFallback";

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

type AgreementIssue = { code: string; message: string; path: string; severity: "fatal" };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PLAN_LENGTH_UNIT = /^(?:m|cm|mm|km|um|µm|μm|nm|in|ft|inch(?:es)?|foot|feet|(?:centi|milli|kilo|micro|nano)?met(?:er|re)s?)$/i;
const OPTICS_MAGNITUDE_INPUTS: Readonly<Record<string, readonly string[]>> = {
  gaussian_image: ["objectDistance", "focalLength"],
  optical_focus: ["focalLength"],
};
/** A plan's object height: h, h_o, h₀, ho, h0, hobj (subscripts folded, case and underscores ignored). */
const PLAN_OBJECT_HEIGHT = /^h(?:o|0|obj(?:ect)?)?$/;
/**
 * The plan quantity each optics input states, by id or symbol: an object distance u, u₁, u_M, d_o,
 * s_o, s or "object distance"; a focal length f, f₁, f_L, f_o, |f| or "focal length". A literal
 * that equals some other plan length (the object distance, R) is not that quantity.
 */
const PLAN_OPTICS_ROLE: Readonly<Record<string, RegExp>> = {
  objectDistance: /^(?:u[0-9a-z]?|do|dobj(?:ect)?|so?|objectdistance)$/,
  focalLength: /^(?:f[0-9a-z]?|focallength)$/,
  objectHeight: PLAN_OBJECT_HEIGHT,
};

function planSymbolKey(text: unknown): string {
  return typeof text === "string" ? text.normalize("NFKC").replace(/[\s_{}|]/g, "").toLowerCase() : "";
}

/** The plan with every value as a magnitude, so a signed plan and an unsigned literal compare equal. */
function magnitudePlan(plan: TurnPlanV3, givens = plan.givens, derived = plan.derived): TurnPlanV3 {
  const magnitude = <T extends { value: number }>(quantity: T): T => ({ ...quantity, value: Math.abs(quantity.value) });
  return { ...plan, givens: givens.map(magnitude), derived: derived.map(magnitude) };
}

/**
 * Inline optics literals checked like scene quantities, by magnitude on both
 * sides (the Cartesian sign lives in `form` or in the literal, never in the
 * plan's reading of the stem), each against its own plan quantity only.
 *
 * - objectDistance and focalLength, in magnitude mode (`form` present):
 *   - written as a plan quantity id (declared in the document), the input is
 *     that quantity whatever its name, so u called p binds to p. Two
 *     exceptions keep the binding honest: a quantity named as another input
 *     (focalLength "do"), or one the plan does not name as this input while
 *     it names another quantity so (focalLength "p" beside a plan f), is held
 *     to the plan's own object distance or focal length, as a literal is.
 *   - a literal, or a document quantity the plan does not declare, must equal
 *     the plan's object distance or focal length (PLAN_OPTICS_ROLE), not any
 *     plan length, so |f| = 112 cm fails where the plan's 112 cm is the object
 *     distance. When the plan names no such quantity, it must equal some plan
 *     length.
 * - objectHeight, in signed and magnitude mode, only when the plan gives an
 *   object height: it must equal that height. A stem with no stated height
 *   still draws a representative one.
 *
 * Stems whose plan gives no length draw representative values and are skipped.
 */
function opticsMagnitudeLiteralIssues(
  document: { quantities?: unknown; constructions?: unknown },
  plan: TurnPlanV3,
): AgreementIssue[] {
  type PlanQuantity = TurnPlanV3["givens"][number];
  const isLength = (quantity: { unit?: string }) => typeof quantity.unit === "string" && PLAN_LENGTH_UNIT.test(quantity.unit.trim());
  if (!plan.givens.some(isLength)) return [];
  const documentQuantities = new Map((Array.isArray(document.quantities) ? document.quantities : [])
    .filter(isPlainRecord).filter((quantity) => typeof quantity.id === "string").map((quantity) => [quantity.id as string, quantity]));
  const planQuantities = new Map([...plan.givens, ...plan.derived].map((quantity) => [quantity.id, quantity]));
  const namedAs = (quantity: PlanQuantity, key: string) => isLength(quantity) &&
    (PLAN_OPTICS_ROLE[key]!.test(planSymbolKey(quantity.symbol)) || PLAN_OPTICS_ROLE[key]!.test(planSymbolKey(quantity.id)));
  // Qualitative claims never support a literal.
  const subPlan = (keep: (quantity: PlanQuantity) => boolean): TurnPlanV3 =>
    ({ ...magnitudePlan(plan, plan.givens.filter(keep), plan.derived.filter(keep)), qualitativeClaims: [] });
  const rolePlan = (key: string): TurnPlanV3 => subPlan((quantity) => namedAs(quantity, key));
  const roleName = (key: string) => key === "focalLength" ? "focal length" : key === "objectDistance" ? "object distance" : "object height";
  /** What one input is held to: its referenced plan quantity, the plan's quantities of its role, or any plan length. */
  const binding = (key: string, written: unknown): { against: TurnPlanV3; scope: string } => {
    const role = rolePlan(key);
    const roleNamed = role.givens.length + role.derived.length > 0;
    const referenced = typeof written === "string" ? planQuantities.get(written) : undefined;
    if (referenced && isLength(referenced) && (namedAs(referenced, key) ||
      (!roleNamed && !Object.keys(PLAN_OPTICS_ROLE).some((other) => other !== key && namedAs(referenced, other))))) {
      return { against: subPlan((quantity) => quantity === referenced), scope: `the plan's quantity ${referenced.id} only` };
    }
    if (referenced || roleNamed) return { against: role, scope: `the plan's ${roleName(key)} only` };
    return { against: subPlan(isLength), scope: `any plan length, as the plan names no ${roleName(key)}` };
  };
  const heightPlan = plan.givens.some((given) => isLength(given) &&
    (PLAN_OBJECT_HEIGHT.test(planSymbolKey(given.symbol)) || PLAN_OBJECT_HEIGHT.test(planSymbolKey(given.id))))
    ? { ...rolePlan("objectHeight"), derived: [] } : null;
  const issues: AgreementIssue[] = [];
  (Array.isArray(document.constructions) ? document.constructions : []).forEach((construction, index) => {
    if (!isPlainRecord(construction) || typeof construction.operator !== "string" || !isPlainRecord(construction.inputs)) return;
    const inputs = construction.inputs;
    const keys: string[] = inputs.form !== undefined ? [...OPTICS_MAGNITUDE_INPUTS[construction.operator] ?? []] : [];
    if (construction.operator === "gaussian_image" && heightPlan) keys.push("objectHeight");
    for (const key of keys) {
      const wrapper = isPlainRecord(inputs[key]) ? inputs[key] as Record<string, unknown> : undefined;
      const written = wrapper ? wrapper.value : inputs[key];
      const quantity = typeof written === "string" ? documentQuantities.get(written) : undefined;
      // The height check keeps its old scope: a height by quantity id is held by plan agreement.
      if (quantity && key === "objectHeight") continue;
      const raw = quantity ? quantity.value : written;
      const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : Number.NaN;
      if (!Number.isFinite(value)) continue;
      const unit = quantity ? (typeof quantity.unit === "string" ? quantity.unit : inputs.lengthUnit)
        : typeof wrapper?.unit === "string" ? wrapper.unit : inputs.lengthUnit;
      const id = `${String(construction.id ?? construction.operator)}.${key}`;
      const source = quantity ? `quantity ${String(written)}` : "magnitude literal";
      const { against, scope } = key === "objectHeight" ? { against: heightPlan!, scope: "the plan's object height only" } : binding(key, written);
      for (const issue of validateSceneQuantityAgreement([{ id, value: Math.abs(value), ...(unit === undefined ? {} : { unit }) }], against)) {
        issues.push({ code: issue.code, message: `${issue.message} (a ${construction.operator} ${key} ${source}, held to ${scope})`, path: `constructions[${index}].inputs.${key}`, severity: "fatal" });
      }
    }
  });
  return issues;
}

/**
 * Plan agreement on the candidate as written, reported alongside a structural
 * failure so one repair round sees both kinds of error. Only finite numeric
 * quantities are read: normalization never had a chance to run.
 */
function rawQuantityAgreementIssues(candidate: Record<string, unknown>, plan: TurnPlanV3): AgreementIssue[] {
  const quantities = (Array.isArray(candidate.quantities) ? candidate.quantities : [])
    .filter((quantity): quantity is Record<string, unknown> & { id: string } =>
      isPlainRecord(quantity) && typeof quantity.id === "string" &&
      typeof quantity.value === "number" && Number.isFinite(quantity.value));
  return [
    ...validateSceneQuantityAgreement(quantities, plan).map((issue) => ({
      code: issue.code, message: issue.message, path: issue.path, severity: "fatal" as const,
    })),
    ...opticsMagnitudeLiteralIssues(candidate, plan),
  ];
}

/** Candidate validation order is unchanged: normalize/prune, quantities, source, obligations, compile. */
export function validateProductionSceneCandidate(input: {
  candidate: Record<string, unknown>; question: string; turnPlan: TurnPlanV3;
}): SceneCandidateValidation<ValidatedSceneCandidate> {
  const { candidate, question, turnPlan: authoritativePlan } = input;
  const structuralFailure = (issues: ValidationReport["issues"]): SceneCandidateValidation<ValidatedSceneCandidate> => ({
    valid: false,
    errors: [...issues, ...rawQuantityAgreementIssues(candidate, authoritativePlan)],
  });
  let validated = validateSceneDocument(pruneDeadSceneEntities(candidate));
  if (!validated.document) return structuralFailure(validated.report.issues);
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
    if (!validated.document) return structuralFailure(validated.report.issues);
  }
  const annotationPruned = pruneUnverifiedSceneAnnotations(validated.document, authoritativePlan);
  if (annotationPruned !== validated.document) {
    validated = validateSceneDocument(pruneDeadSceneEntities(
      annotationPruned as unknown as Record<string, unknown>,
    ));
    if (!validated.document) return structuralFailure(validated.report.issues);
  }
  const agreementIssues = validateSceneQuantityAgreement(
    validated.document.quantities,
    authoritativePlan,
    displayedSceneQuantityTexts(validated.document),
  );
  const authorityIssues = [
    ...agreementIssues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path,
      severity: "fatal" as const,
    })),
    ...opticsMagnitudeLiteralIssues(validated.document, authoritativePlan),
  ];
  const sourceIssues = validateMatrixSourceBinding(validated.document, question, authoritativePlan);
  const proofIssues = validateTurnPlanSceneProofs(validated.document, authoritativePlan);
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
  const empty = (reason: string, visualStatus: ProductionSceneSelection["visualStatus"]): ProductionSceneSelection => ({
    gate, representation: null, attemptedRepresentation: null, candidateValidation: null,
    visualStatus, reason, selectionReason: reason, hasReadableInk: false, sourceAllowed: true, saveFailure: null,
  });
  try {
    // Preserve the live no-figure guard, not just the planner's vote.
    if (turnPlan.visualRequirement === "none" && !questionRequiresVisual(question)) {
      return empty("the question asks for no figure", "text_only");
    }
    const candidateValidation = input.candidate
      ? validateProductionSceneCandidate({ candidate: input.candidate, question, turnPlan })
      : input.candidateValidation ?? null;
    const value = !input.solverAuthorityBlocked && gate.shouldPlanExactScene && candidateValidation?.valid
      ? candidateValidation.value : undefined;
    const fallbackCapabilities = inferSceneCapabilities(question, {
      lawIds: turnPlan.lawIds, problemIR: input.problemIR, turnPlan,
    });
    const selected = input.fastRepresentation ?? selectVerifiedRepresentation({
      question, turnPlan, problemIR: input.problemIR,
      families: fallbackCapabilities.families.length > 0 ? fallbackCapabilities.families : gate.families,
      preferPlanner: input.policy?.preferPlanner,
      exact: value && value.document.visualDecision.mode === "scene" ? {
        sceneDocument: value.document, renderScene: value.renderScene, validationReport: value.report,
      } : null,
      exactFigureSource: input.exactFigureSource ?? "planner",
    });
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
    return {
      gate, representation: selectedIsDrawable ? selected : null, attemptedRepresentation: selected,
      candidateValidation, visualStatus: selectedIsDrawable ? "validated" : failureStatus === "retry_required" ? "retry_required" : "text_only",
      reason: selectedIsDrawable ? selectionReason : input.solverAuthorityBlocked ? "solver_contradiction"
        : !selectedSourceAllowed ? selectionReason : saveFailure ?? (!selectedHasInk ? "representation carries no readable label" : selected.reason),
      selectionReason, hasReadableInk: selectedHasInk, sourceAllowed: selectedSourceAllowed, saveFailure,
    };
  } catch (error) {
    // The pre-existing exception path records required failures regardless of retry opt-out.
    return empty(error instanceof Error ? error.message : String(error),
      turnPlan.visualRequirement === "required" || questionRequiresVisual(question) ? "retry_required" : "text_only");
  }
}
