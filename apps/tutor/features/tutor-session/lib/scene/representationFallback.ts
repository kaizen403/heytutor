import {
  SCENE_ENGINE_VERSION,
  readScrewGaugeQuestion,
  pointLineCallerIssues,
  buildMatrixSourceDocument,
  compileSceneDocument,
  detectArchetype,
  isRiverBoatStem,
  parseMathExpression,
  synthesizeFamilyScene,
  synthesizeLastResortScene,
  synthesizeUniformCircularScene,
  demandRejection,
  sceneDemand,
  sourceMensurationStructure,
  tierForForeignDocument,
  validateSceneDocument,
  validateSceneQuantityAgreement,
  validateTurnPlanSceneProofs,
  validateTurnPlanV3,
  validateProblemIR,
  type ProblemStructureView,
  type RenderScene,
  type SceneDocument,
  type SceneIssue,
  type TurnPlanV3,
  type ValidationReport,
  type ValidationResult,
  relativeMotionSource,
  relativeMotionCallerIssues,
  relativeMotionPlanConflicts,
  riverCrossingPlanConflicts,
  riverCrossingSpeeds,
  RELATIVE_MOTION_SOURCE_MODEL,
  deriveVisualObligations,
  isFullProblemIRStructure,
  readSectionFormulaSource,
  sectionFormulaPlanIssues,
  validateSectionFormulaProblemSource,
  validateSectionPointSourceInputs,
  visualObligationRejection,
  suvatGivenIsSourceOwned,
  suvatCallerIssues,
  suvatPlanForSIComparison,
} from "@heytutor/scene-engine";
import { isQuotedPhysicalConstant, questionStatesValue } from "@heytutor/tutor-core";

export type RepresentationTier =
  | "exact_verified"
  | "qualitative_verified"
  | "question_representation";

export interface ExactVerifiedRepresentation {
  sceneDocument: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
}

export interface SelectedRepresentation {
  tier: RepresentationTier;
  /** Exact scenes are metric. Both fallback tiers are explicitly nonmetric. */
  nonMetric: boolean;
  sceneDocument: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
  reason: string;
  /**
   * What kind of picture this is, when a family or archetype built it.
   *
   * The tutor is handed a list of entity ids and labels and nothing else, so
   * when the family layer picked the wrong construction the lesson simply
   * renamed the parts: a `double_slit` figure was taught as a capillary tube
   * ("S is the capillary tube"), and two point charges as Earth's magnetic
   * field. The model cannot refuse a figure it has not been told the name of.
   */
  family?: string;
}

export interface RepresentationSelectionInput {
  question: string;
  turnPlan?: TurnPlanV3 | unknown | null;
  exact?: ExactVerifiedRepresentation | null;
  families?: readonly string[];
  /**
   * Solved structure. The synthesizer orders families and sharpens its picture
   * demand from this, so the fallback figure follows the solve rather than a
   * second English reading of the stem.
   */
  problemIR?: ProblemStructureView | null;
}

interface SourceFunctionFact {
  expression: string;
  sourceText: string;
}

interface SourceFact {
  id: string;
  label: string;
  kind: "given" | "relationship" | "entity";
  sourceText: string;
  provenance: "question" | "turn_plan_given" | "turn_plan_grounded_claim";
}

const DISPLAY_DOMAINS: ReadonlyArray<readonly [number, number]> = [
  [-4, 4],
  [0, 4],
  [-4, 0],
  [-1, 1],
  [0.25, 4],
  [-4, -0.25],
];

const RELATION_PREDICATES = [
  "parallel",
  "series",
  "perpendicular",
  "tangent",
  "connected",
  "intersects",
  "encloses",
  "inside",
  "outside",
  "above",
  "below",
  "equal",
  "similar",
  "congruent",
  "incident",
] as const;

/**
 * A standard constant (g, c, h, ...) the planner supplied for a question that
 * never stated it. It is not a measurement the student gave, so it does not
 * make a symbolic question numeric. A constant the question does state stays
 * a given: "take g = 10" is part of the problem, and an overloaded letter such
 * as a stated R = 8.31 ohm is a resistance, not the gas constant.
 */
export function isPlannerQuotedConstant(
  question: string,
  given: Pick<TurnPlanV3["givens"][number], "symbol" | "value">,
): boolean {
  return isQuotedPhysicalConstant(given.symbol, given.value) &&
    !questionStatesValue(question, given.value);
}

export function selectFastVerifiedRepresentation(
  input: RepresentationSelectionInput,
): SelectedRepresentation | null {
  if (readScrewGaugeQuestion(input.question).status !== "none") return null;
  const sourceRelative = relativeMotionSource(input.question)?.status === "admitted";
  if (relativeMotionCallerIssues(input.question, input.problemIR, input.turnPlan).length) return null;
  if (sourceRelative && motionPlanConflict(input.question, input.turnPlan)) return null;
  if (pointLineCallerIssues(input.question, input.problemIR, input.turnPlan).length) return null;
  if (suvatCallerIssues(input.question, input.problemIR, input.turnPlan).length) return null;
  const plan = validateTurnPlanV3(input.turnPlan, input.question).plan;
  if (!plan || plan.visualRequirement === "none") return null;
  if (!sourceRelative && plan.givens.some((given) => !questionStatesValue(input.question, given.value) &&
      !suvatGivenIsSourceOwned(input.question, given) &&
      !isQuotedPhysicalConstant(given.symbol, given.value))) return null;
  const synthesized = synthesizeFamilyScene({
    question: input.question,
    turnPlan: plan,
    families: input.families,
    problemIR: input.problemIR ?? null,
  });
  const result = sourceRelative && synthesized ? compileSourceFigureForCaller(synthesized, input) : synthesized;
  if (!result?.validationReport.valid || result.tier === "question_representation" ||
      !result.renderScene.primitives.some((primitive) =>
        (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text?.trim())) return null;
  if (result.tier !== "exact_verified" && (plan.givens.some((given) => !isPlannerQuotedConstant(input.question, given)) ||
      plan.derived.some((quantity) => !questionStatesValue(input.question, quantity.value)))) return null;
  const comparisonPlan = suvatPlanForSIComparison(input.question, input.problemIR, input.turnPlan) ?? plan;
  const agreement = validateSceneQuantityAgreement(result.document.quantities, comparisonPlan,
    result.renderScene.primitives.flatMap((primitive) =>
      (primitive.kind === "label" || primitive.kind === "dimension") && typeof primitive.text === "string"
        ? [primitive.text] : []),
    sourceRelative ? {
      question: input.question, problemIR: input.problemIR, document: result.document,
    } : undefined);
  if (agreement.length > 0 || (result.tier === "exact_verified" &&
      validateTurnPlanSceneProofs(result.document, plan).some((issue) => issue.severity === "fatal"))) return null;
  return {
    tier: result.tier,
    nonMetric: result.nonMetric,
    sceneDocument: result.document,
    renderScene: result.renderScene,
    validationReport: result.validationReport,
    reason: result.reason,
    family: result.family,
  };
}

/**
 * Select the highest-confidence representation without changing the exact
 * scene's proof contract. An exact candidate wins only when the caller's final
 * report is valid and the current engine supplies the selected render/report.
 */
export function selectVerifiedRepresentation(
  input: RepresentationSelectionInput,
): SelectedRepresentation {
  // Whole source/caller refusal is terminal for this operator. None of the
  // exact, family, source-sketch or last-resort paths may omit an obligation
  // and recover a partial graph from an equation inside the refused question.
  const pointLineConflict = pointLineCallerIssues(input.question, input.problemIR, input.turnPlan)
    .find((issue) => issue.severity === "fatal");
  if (pointLineConflict) {
    return { ...buildTextOnlySelected(input.question), reason: pointLineConflict.message };
  }
  // The measurement arithmetic profile has no source-proved apparatus scene.
  // Refusal, including a terminal empty caller, cannot regain figure authority.
  if (readScrewGaugeQuestion(input.question).status !== "none") {
    return { ...buildTextOnlySelected(input.question), reason: "measurement apparatus scene profile unsupported" };
  }
  const suvatIssues = suvatCallerIssues(input.question, input.problemIR, input.turnPlan);
  if (suvatIssues.length) return {...buildTextOnlySelected(input.question), reason: suvatIssues[0]!.message};
  // The question fixes these motion numbers. A plan that would narrate a
  // different value gets no figure at all, so a stale number is never spoken
  // over a correct (or a planner-drawn) picture.
  const relativeCallerIssue = relativeMotionCallerIssues(input.question, input.problemIR, input.turnPlan)[0];
  if (relativeCallerIssue) return { ...buildTextOnlySelected(input.question), reason: relativeCallerIssue.message };
  const motionConflict = motionPlanConflict(input.question, input.turnPlan);
  if (motionConflict) {
    const textOnly = buildTextOnlySelected(input.question);
    return { ...textOnly, reason: motionConflict };
  }
  if (input.turnPlan != null) {
    const sectionPlanConflict = sectionFormulaPlanIssues(input.question, input.turnPlan, input.problemIR)
      .find((issue) => issue.severity === "fatal");
    if (sectionPlanConflict) {
      const textOnly = buildTextOnlySelected(input.question);
      return { ...textOnly, reason: sectionPlanConflict.message };
    }
  }
  const currentCompile = input.exact
    ? compileUsableExactRepresentation(input.exact, input.question, input.problemIR, input.turnPlan)
    : null;
  const families = input.families?.length ? input.families : undefined;
  const synthesize = () => synthesizeFamilyScene({
    question: input.question,
    turnPlan: input.turnPlan,
    families,
    problemIR: input.problemIR ?? null,
  });
  // Complete source-bound mensuration operators preserve each part and its
  // dimensions. Prefer them to a sketch proved only to exist; metric-proved
  // scenes retain their priority. Other families keep their existing policy.
  const unprovenMensuration = input.exact && currentCompile?.renderScene &&
    tierForForeignDocument(input.exact.sceneDocument).tier !== "exact_verified" &&
    sourceMensurationStructure(input.question);
  // A parameterized archetype computed from source-bound slots and proved by
  // a metric assertion outranks a planner scene that only earned the
  // qualitative tier: the student sees the figure whose numbers were checked.
  const unprovenPlannerScene = input.exact && currentCompile?.renderScene &&
    tierForForeignDocument(input.exact.sceneDocument).tier !== "exact_verified";
  const sectionSource = readSectionFormulaSource(input.question);
  // When the plan names circular motion, the source owns the figure: the
  // engine recomputes the state from the stated radius and rate, so a planner
  // scene cannot imply a direction or value the source did not give. A source
  // the engine declines (zero radius, contradictory rates, changing speed, a
  // plan value that disagrees with the recomputed state) teaches without a
  // figure rather than through any other picture.
  const circular = synthesizeUniformCircularScene(input.question, { turnPlan: input.turnPlan, problemIR: input.problemIR });
  if (circular?.status === "declined" && !circular.legacyOnly) return buildTextOnlySelected(input.question);
  // An admitted constant-velocity relative-motion source owns its whole
  // figure (bodies, frame, signed velocities, encounter); a planner scene
  // cannot replace it with differently signed or stale motion.
  const relativeMotion = input.exact && relativeMotionSource(input.question)?.status === "admitted";
  const requiredVisual = validateTurnPlanV3(input.turnPlan, input.question).plan?.visualRequirement === "required";
  const sourceCandidate = circular?.status === "drawn" ? circular.scene
    : unprovenMensuration || unprovenPlannerScene || relativeMotion || (sectionSource.status === "ok" && !input.exact)
      ? synthesize() : null;
  if (sectionSource.status === "ok" && requiredVisual &&
      isFullProblemIRStructure(input.problemIR) && (unprovenPlannerScene || !input.exact) && !sourceCandidate) {
    const textOnly = buildTextOnlySelected(input.question);
    return { ...textOnly, reason: "the complete section source could not satisfy every ProblemIR visual obligation" };
  }
  const sourceFigure = sourceCandidate ? compileSourceFigureForCaller(sourceCandidate, input) : null;
  const preferSourceFigure = circular?.status === "drawn"
    || sourceFigure?.family === "solid_figure" || sourceFigure?.family === "bounded_region"
    || sourceFigure?.document.source.sourceModel === RELATIVE_MOTION_SOURCE_MODEL
    || (unprovenPlannerScene && sourceFigure?.tier === "exact_verified");
  if (input.exact && currentCompile?.renderScene && !preferSourceFigure) {
    // A validated planner scene wins over every fallback, but its tier is
    // earned, not assumed: exact needs a fatal metric proof (an angle, a ratio,
    // a function value, Snell's law). Existence and topology alone are
    // qualitative — the same rule the synthesized archetypes live under.
    const decision = currentCompile.report.issues.some((issue) => issue.code === "matrix_source_component_only")
      ? { tier: "question_representation" as const, nonMetric: true, reason: "source matrix component verified; original outside-component claims remain unverified" }
      : tierForForeignDocument(input.exact.sceneDocument);
    const source = input.exact.sceneDocument.source;
    const declaredTierMismatch = source.representationTier !== undefined && source.representationTier !== decision.tier;
    const declaredMetricMismatch = source.nonMetric !== undefined && source.nonMetric !== decision.nonMetric;
    const document = declaredTierMismatch || declaredMetricMismatch
      ? structuredClone(input.exact.sceneDocument)
      : input.exact.sceneDocument;
    if (document !== input.exact.sceneDocument) {
      document.source = { ...document.source, representationTier: decision.tier, nonMetric: decision.nonMetric };
    }
    const compiled = document === input.exact.sceneDocument ? currentCompile
      : compileWithCallerContext(document, input.question, input.problemIR, input.turnPlan);
    if (compiled.ok && compiled.renderScene) {
      return {
        tier: decision.tier,
        nonMetric: decision.nonMetric,
        sceneDocument: document,
        renderScene: compiled.renderScene,
        validationReport: compiled.report,
        reason: decision.tier === "exact_verified"
          ? `caller supplied a verified scene with ${decision.reason}`
          : `caller supplied a verified scene; ${decision.reason}`,
      };
    }
  }

  // A complete matrix source program is drawn by the engine from the question
  // when no planner candidate survived. The builder applies the same source
  // and plan binding as the live path and returns null rather than a partial table.
  const matrixDocument = sourceFigure ? null : buildMatrixSourceDocument(input.question, input.turnPlan);
  if (matrixDocument) {
    // A component-only indexed premise stays a question representation; the
    // builder already declared it and the binding refuses any stronger tier.
    const decision = matrixDocument.source.representationTier === "question_representation"
      ? { tier: "question_representation" as const, nonMetric: true, reason: "source matrix component verified; original outside-component claims remain unverified" }
      : tierForForeignDocument(matrixDocument);
    matrixDocument.source = { ...matrixDocument.source, representationTier: decision.tier, nonMetric: decision.nonMetric };
    const compiled = compileWithCallerContext(matrixDocument, input.question, input.problemIR, input.turnPlan);
    if (compiled.ok && compiled.renderScene) {
      return {
        tier: decision.tier,
        nonMetric: decision.nonMetric,
        sceneDocument: matrixDocument,
        renderScene: compiled.renderScene,
        validationReport: compiled.report,
        reason: `engine drew the question's matrix source program; ${decision.reason}`,
      };
    }
  }

  const synthesizedCandidate = sourceFigure ?? synthesize();
  const synthesized = synthesizedCandidate ? compileSourceFigureForCaller(synthesizedCandidate, input) : null;
  if (synthesized) {
    return {
      tier: synthesized.tier,
      nonMetric: synthesized.nonMetric,
      sceneDocument: synthesized.document,
      renderScene: synthesized.renderScene,
      validationReport: synthesized.validationReport,
      reason: synthesized.reason,
      family: synthesized.family,
    };
  }

  try {
    return buildSourceGroundedRepresentation(input.question, input.turnPlan);
  } catch {
    const lastResort = synthesizeLastResortScene({
      question: input.question,
      turnPlan: input.turnPlan,
      families,
      problemIR: input.problemIR ?? null,
    });
    if (lastResort) {
      return {
        tier: lastResort.tier,
        nonMetric: lastResort.nonMetric,
        sceneDocument: lastResort.document,
        renderScene: lastResort.renderScene,
        validationReport: lastResort.validationReport,
        reason: lastResort.reason,
      };
    }
    return buildTextOnlySelected(input.question);
  }
}

function motionPlanConflict(question: string, turnPlan: unknown): string | null {
  const relative = relativeMotionSource(question);
  if (relative?.status === "admitted") {
    const conflicts = relativeMotionPlanConflicts(relative.source, turnPlan, question);
    if (conflicts.length > 0) return `plan quantities disagree with the stated relative motion: ${conflicts.map((conflict) => `${conflict.symbol}=${conflict.value} ${conflict.unit}`).join(", ")}`;
  }
  if (isRiverBoatStem(question)) {
    const speeds = riverCrossingSpeeds(question);
    const conflicts = speeds.status === "bound" ? riverCrossingPlanConflicts(speeds, turnPlan, question) : [];
    if (conflicts.length > 0) return `plan quantities disagree with the stated river crossing: ${conflicts.map((conflict) => `${conflict.symbol}=${conflict.value} ${conflict.unit}`).join(", ")}`;
  }
  return null;
}

function buildTextOnlySelected(question: string): SelectedRepresentation {
  const document = buildTextOnlyRepresentation(question, [], "question_representation");
  const compiled = compileSceneDocument(document);
  return {
    tier: "question_representation",
    nonMetric: true,
    sceneDocument: document,
    renderScene: compiled.renderScene ?? {
      engineVersion: compiled.report.engineVersion,
      primitives: [],
      revealGroups: [],
      timeline: [],
      entityBounds: {},
    },
    validationReport: compiled.report,
    reason: "no family operator program was available",
  };
}

/**
 * Produce a conservative scene from source facts only. This function never
 * consumes TurnPlan.derived, never computes requested answers, and never
 * infers topology or bounded regions.
 */
export function buildSourceGroundedRepresentation(
  question: string,
  turnPlan?: TurnPlanV3 | unknown | null,
): SelectedRepresentation {
  const sourceConflict = pointLineCallerIssues(question, null, turnPlan)
    .find((issue) => issue.severity === "fatal");
  if (sourceConflict) throw new Error(sourceConflict.message);
  const normalizedQuestion = question.trim();
  const functionFacts = extractExplicitFunctionFacts(normalizedQuestion);
  const groundedClaims = extractGroundedRelationshipFacts(normalizedQuestion);
  const givenFacts = extractGivenFacts(normalizedQuestion, turnPlan);
  const tier: Exclude<RepresentationTier, "exact_verified"> = groundedClaims.length > 0
    ? "qualitative_verified"
    : "question_representation";

  if (
    functionFacts.length === 0 &&
    isRecord(turnPlan) &&
    turnPlan.visualRequirement === "required"
  ) {
    throw new Error(
      "required visual representation unavailable: no meaningful source-grounded operator program",
    );
  }

  const document = functionFacts.length > 0
    ? buildFunctionRepresentation(normalizedQuestion, functionFacts, tier, givenFacts, groundedClaims)
    : buildTextOnlyRepresentation(
        normalizedQuestion,
        [...givenFacts, ...groundedClaims],
        tier,
      );
  const compiled = compileSceneDocument(document);
  if (!compiled.ok || !compiled.renderScene) {
    throw new Error(`source-grounded representation failed: ${compiled.report.issues
      .map((issue) => issue.code)
      .join(", ")}`);
  }

  return {
    tier,
    nonMetric: true,
    sceneDocument: document,
    renderScene: compiled.renderScene,
    validationReport: compiled.report,
    reason: document.visualDecision.mode === "text_only"
      ? "no meaningful source-grounded visual structure was available"
      : tier === "qualitative_verified"
        ? "rendered source-grounded qualitative relationships without metric claims"
        : "rendered only entities and equations explicitly present in the question",
  };
}

function compileUsableExactRepresentation(
  candidate: ExactVerifiedRepresentation,
  expectedQuestion: string,
  problemIR?: ProblemStructureView | null,
  turnPlan?: TurnPlanV3 | unknown | null,
): ReturnType<typeof compileSceneDocument> | null {
  // TypeScript's interface is not a runtime proof: the caller may supply an
  // incomplete, forged or stale report despite the ExactVerifiedRepresentation type.
  if (!isCurrentEngineReport(candidate.validationReport)) return null;
  // A planner scene is validated and compiled, which proves the geometry is
  // sound — never that it is this question's geometry. It faces the same
  // picture demand the synthesized families face, so a validated-but-wrong
  // figure falls through to the fallback instead of being taught.
  if (demandRejection(candidate.sceneDocument, sceneDemand(expectedQuestion, problemIR))) {
    return null;
  }
  if (turnPlan != null && sectionFormulaPlanIssues(expectedQuestion, turnPlan, problemIR)
    .some((issue) => issue.severity === "fatal")) return null;
  const sourceQuestion = candidate.sceneDocument.source.question;
  if (
    typeof sourceQuestion !== "string" ||
    normalizeQuestion(sourceQuestion) !== normalizeQuestion(expectedQuestion) ||
    candidate.validationReport.issues.some((issue) =>
      issue.severity === "fatal" || issue.code === "assertion_failed") ||
    candidate.sceneDocument.visualDecision.mode !== "scene" ||
    usesMensurationSolidOnContactProblem(expectedQuestion, candidate.sceneDocument) ||
    usesCollidingCircuitViews(expectedQuestion, candidate.sceneDocument) ||
    usesGenericVectorDiagramOnRiverBoat(expectedQuestion, candidate.sceneDocument) ||
    usesPlannerOpticsOnArchetypeStem(expectedQuestion, candidate.sceneDocument)
  ) {
    return null;
  }
  const normalized = validateSceneDocumentForCaller(candidate.sceneDocument, expectedQuestion, problemIR, turnPlan);
  // The compiler validates a normalized copy, but compiles the supplied document.
  // Do not accept a raw document whose actions, proofs or operands were changed
  // (or dropped) by that normalization while returning the raw document to the tutor.
  if (!normalized.document || !sameJsonStructure(normalized.document, candidate.sceneDocument, true)) {
    return null;
  }
  const currentCompile = compileWithCallerContext(candidate.sceneDocument, expectedQuestion, problemIR, turnPlan);
  const hasReadableInk = currentCompile.renderScene?.primitives.some((primitive) =>
    (primitive.kind === "label" || primitive.kind === "dimension") &&
    typeof primitive.text === "string" && primitive.text.trim().length > 0);
  return currentCompile.ok && currentCompile.report.valid &&
    !currentCompile.report.issues.some((issue) =>
      issue.severity === "fatal" || issue.code === "assertion_failed") &&
    reportsAgree(candidate.validationReport, currentCompile.report) &&
    currentCompile.renderScene?.primitives.length && hasReadableInk
    ? currentCompile
    : null;
}

function compileSourceFigureForCaller(
  candidate: NonNullable<ReturnType<typeof synthesizeFamilyScene>>,
  input: RepresentationSelectionInput,
): NonNullable<ReturnType<typeof synthesizeFamilyScene>> | null {

  if (input.turnPlan != null && sectionFormulaPlanIssues(input.question, input.turnPlan, input.problemIR)
    .some((issue) => issue.severity === "fatal")) return null;
  const compiled = compileWithCallerContext(candidate.document, input.question, input.problemIR, input.turnPlan);
  if (!compiled.ok || !compiled.renderScene || !compiled.report.valid || compiled.report.issues.some((issue) =>
    issue.severity === "fatal" || issue.code === "assertion_failed")) return null;
  return { ...candidate, renderScene: compiled.renderScene, validationReport: compiled.report };
}

function compileWithCallerContext(
  document: SceneDocument,
  question: string,
  problemIR?: ProblemStructureView | null,
  turnPlan?: TurnPlanV3 | unknown | null,
): ReturnType<typeof compileSceneDocument> {
  const structural = validateSceneDocumentForCaller(document, question, problemIR, turnPlan);
  if (!structural.document) return { ok: false, renderScene: null, report: structural.report };
  return compileSceneDocument(document,{sourceAuthority:{question,problemIR,turnPlan}});
}

function validateSceneDocumentForCaller(
  document: SceneDocument,
  question: string,
  problemIR?: ProblemStructureView | null,
  turnPlan?: TurnPlanV3 | unknown | null,
): ValidationResult {
  const structural = validateSceneDocument(document,{sourceAuthority:{question,problemIR,turnPlan}});
  if (!structural.document) return structural;
  const issues: SceneIssue[] = [];
  if (turnPlan != null) {
    const checkedPlan = validateTurnPlanV3(turnPlan, question);
    if (!checkedPlan.valid || !checkedPlan.plan) {
      issues.push({ code: "caller_turn_plan", severity: "fatal" as const,
        message: "Caller TurnPlan must validate against the actual question", path: "sourceAuthority.turnPlan" });
    } else {
      issues.push(...validateTurnPlanSceneProofs(document, checkedPlan.plan));
    }
  }
  if (isFullProblemIRStructure(problemIR)) {
    const checkedProblem = validateProblemIR(problemIR, question);
    if (!checkedProblem.valid || !checkedProblem.problem) {
      issues.push({ code: "caller_problem_ir", severity: "fatal",
        message: "Caller ProblemIR must validate against the actual question", path: "sourceAuthority.problemIR" });
    } else {
      const missing = visualObligationRejection(deriveVisualObligations(checkedProblem.problem), document, checkedProblem.problem, turnPlan);
      if (missing) issues.push({
        code: "source_visual_obligation",
        severity: "fatal",
        message: missing,
        path: "sourceAuthority.problemIR",
      });
    }
  }
  if (readSectionFormulaSource(question).status === "ok") {
    issues.push(
      ...validateSectionPointSourceInputs(document, question),
      ...validateSectionFormulaProblemSource(document, question, isFullProblemIRStructure(problemIR) ? problemIR : null),
      ...(turnPlan == null ? [] : sectionFormulaPlanIssues(question, turnPlan, problemIR)),
    );
  }
  if (!issues.some((issue) => issue.severity === "fatal")) return structural;
  return {
    document: null,
    report: { ...structural.report, valid: false, issues: [...structural.report.issues, ...issues] },
  };
}

function isCurrentEngineReport(value: unknown): value is ValidationReport {
  if (!isRecord(value) || value.engineVersion !== SCENE_ENGINE_VERSION ||
      value.valid !== true || !Array.isArray(value.issues) || !isRecord(value.stats)) return false;
  if (Object.keys(value).length !== 4 ||
      !Object.keys(value).every((key) => ["engineVersion", "valid", "issues", "stats"].includes(key))) return false;
  const stats = value.stats;
  if (Object.keys(stats).length !== 4 ||
      !Object.keys(stats).every((key) =>
        ["entityCount", "constructionCount", "primitiveCount", "assertionCount"].includes(key))) return false;
  if (![stats.entityCount, stats.constructionCount, stats.primitiveCount, stats.assertionCount]
    .every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) return false;
  return value.issues.every((issue) => isRecord(issue) &&
    Object.keys(issue).every((key) =>
      ["code", "message", "severity", "path", "entityIds", "expected", "actual", "residual"].includes(key)) &&
    typeof issue.code === "string" && issue.code.length > 0 &&
    typeof issue.message === "string" &&
    (issue.severity === "fatal" || issue.severity === "warning") &&
    (issue.path === undefined || typeof issue.path === "string") &&
    (issue.entityIds === undefined || (Array.isArray(issue.entityIds) &&
      issue.entityIds.every((id) => typeof id === "string"))) &&
    (issue.residual === undefined || (typeof issue.residual === "number" && Number.isFinite(issue.residual))));
}

function reportsAgree(caller: ValidationReport, current: ValidationReport): boolean {
  return sameJsonStructure(caller, current);
}

const NORMALIZED_ANNOTATION_STYLE_FIELDS = new Set(["count", "pointStyle", "transient"]);

function isAnnotationRecordPath(path: readonly string[]): boolean {
  return path.length === 2 && path[0] === "annotations" && /^\d+$/.test(path[1]!);
}

function isAnnotationStylePath(path: readonly string[]): boolean {
  return path.length === 3 && isAnnotationRecordPath(path.slice(0, 2)) && path[2] === "style";
}

/** normalizeAnnotationStyle always writes count, pointStyle, and transient, using
 * undefined for each omitted field. An omitted style is written as an own
 * style: undefined. Those paths are schema shape, not dropped data.
 */
function isNormalizedAnnotationStyleField(path: readonly string[]): boolean {
  return path.length === 4 && isAnnotationStylePath(path.slice(0, 3)) &&
    NORMALIZED_ANNOTATION_STYLE_FIELDS.has(path[3]!);
}

function isSchemaNormalizedUndefinedStyle(path: readonly string[], record: object, key: string): boolean {
  return explicitUndefined(record, key) && (
    (key === "style" && isAnnotationRecordPath(path)) ||
    (isAnnotationStylePath(path) && NORMALIZED_ANNOTATION_STYLE_FIELDS.has(key))
  );
}

function explicitUndefined(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return Boolean(descriptor && Object.hasOwn(descriptor, "value") && descriptor.value === undefined);
}

/** Compare report/document structure without JSON.stringify's key-order sensitivity
 * or lossy handling of unknown values. An omitted annotation style is equivalent
 * only to normalization's own style: undefined. Inside that style object,
 * normalization may add undefined count, pointStyle, or transient children.
 * Object keys are unordered; array elements are not.
 */
function sameJsonStructure(
  left: unknown,
  right: unknown,
  allowUndefinedAnnotationStyle = false,
  path: readonly string[] = [],
  seenLeft = new WeakSet<object>(),
  seenRight = new WeakSet<object>(),
): boolean {
  if (left === undefined || right === undefined) {
    return left === undefined && right === undefined && allowUndefinedAnnotationStyle &&
      (isAnnotationStylePath(path) || isNormalizedAnnotationStyleField(path));
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    if (typeof left !== typeof right || left === null || right === null) {
      return left === null && right === null;
    }
    return (typeof left === "string" || typeof left === "boolean" ||
      (typeof left === "number" && Number.isFinite(left))) && Object.is(left, right);
  }
  if (seenLeft.has(left) || seenRight.has(right)) return false;
  seenLeft.add(left);
  seenRight.add(right);
  try {
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) ||
          Object.getPrototypeOf(left) !== Array.prototype ||
          Object.getPrototypeOf(right) !== Array.prototype ||
          left.length !== right.length ||
          Reflect.ownKeys(left).length !== left.length + 1 ||
          Reflect.ownKeys(right).length !== right.length + 1) return false;
      for (let index = 0; index < left.length; index += 1) {
        const l = Object.getOwnPropertyDescriptor(left, index);
        const r = Object.getOwnPropertyDescriptor(right, index);
        if (!l || !r || !Object.hasOwn(l, "value") || !Object.hasOwn(r, "value") ||
            !sameJsonStructure(l.value, r.value, allowUndefinedAnnotationStyle,
              [...path, String(index)], seenLeft, seenRight)) return false;
      }
      return true;
    }
    if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
    const leftKeys = Reflect.ownKeys(left);
    const rightKeys = Reflect.ownKeys(right);
    if (leftKeys.some((key) => typeof key !== "string") ||
        rightKeys.some((key) => typeof key !== "string")) return false;
    const comparable = (record: object, keys: readonly (string | symbol)[]): string[] =>
      (keys as string[]).filter((key) =>
        !(allowUndefinedAnnotationStyle && isSchemaNormalizedUndefinedStyle(path, record, key)));
    const leftComparable = comparable(left, leftKeys);
    const rightComparable = comparable(right, rightKeys);
    if (leftComparable.length !== rightComparable.length ||
        rightComparable.some((key) => !leftComparable.includes(key))) return false;
    return leftComparable.every((key) => {
      const l = Object.getOwnPropertyDescriptor(left, key);
      const r = Object.getOwnPropertyDescriptor(right, key);
      return l && r && Object.hasOwn(l, "value") && Object.hasOwn(r, "value") &&
        sameJsonStructure(l.value, r.value, allowUndefinedAnnotationStyle,
          [...path, key], seenLeft, seenRight);
    });
  } finally {
    seenLeft.delete(left);
    seenRight.delete(right);
  }
}

function isPlainRecord(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeQuestion(value: string): string {
  return normalizeMathText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function usesMensurationSolidOnContactProblem(
  question: string,
  document: SceneDocument,
): boolean {
  if (!/(?:incline|inclined plane|slope|rolling without slipping|rolls without slipping)/i.test(question)) {
    return false;
  }
  return document.constructions.some((construction) => construction.operator === "solid_projection");
}

function usesCollidingCircuitViews(
  question: string,
  document: SceneDocument,
): boolean {
  if (!/\bseries\b/i.test(question) || !/\bparallel\b/i.test(question)) return false;
  const seen = new Map<string, string>();
  for (const construction of document.constructions) {
    if (construction.operator !== "point") continue;
    const id = construction.outputs[0];
    const x = construction.inputs.x;
    const y = construction.inputs.y;
    if (typeof id !== "string" || typeof x !== "number" || typeof y !== "number") continue;
    const space = construction.inputs.coordinateSpace === "layout" ? "layout" : "world";
    const key = `${space}:${x}:${y}`;
    const prior = seen.get(key);
    if (prior && prior !== id) return true;
    if (!prior) seen.set(key, id);
  }
  return false;
}

function usesPlannerOpticsOnArchetypeStem(
  question: string,
  document: SceneDocument,
): boolean {
  const match = detectArchetype(question);
  if (match?.id !== "spherical_mirror" && match?.id !== "thin_lens") return false;
  const source = document.source as { archetype?: unknown } | undefined;
  return source?.archetype !== match.id;
}

function usesGenericVectorDiagramOnRiverBoat(
  question: string,
  document: SceneDocument,
): boolean {
  if (!isRiverBoatStem(question)) return false;
  const ids = new Set(document.entities.map((entity) => entity.id));
  const recycledAB = ids.has("origin") && ids.has("a") && ids.has("b")
    && ids.has("a_end") && ids.has("b_end");
  const hasBanks = document.entities.some((entity) =>
    /bank|shore/i.test(`${entity.id} ${entity.role} ${entity.label ?? ""}`));
  return recycledAB || !hasBanks;
}

function buildFunctionRepresentation(
  question: string,
  functions: SourceFunctionFact[],
  tier: Exclude<RepresentationTier, "exact_verified">,
  givens: SourceFact[],
  claims: SourceFact[],
): SceneDocument {
  const domain = sharedDisplayDomain(functions) ?? [-1, 1] as const;
  const yRange = displayYRange(functions, domain);
  const entities: SceneDocument["entities"] = [{
    id: "source_axes",
    kind: "axes",
    role: "nonmetric display axes",
    provenance: sourceProvenance("question", tier, question),
  }];
  const constructions: SceneDocument["constructions"] = [{
    id: "construct_source_axes",
    operator: "axes",
    inputs: {
      xMin: domain[0],
      xMax: domain[1],
      yMin: yRange[0],
      yMax: yRange[1],
    },
    outputs: ["source_axes"],
    reason: "deterministic display window for explicit source equations",
  }];

  functions.forEach((fact, index) => {
    const entityId = `source_function_${index + 1}`;
    const fullLabel = `y=${fact.expression}`;
    entities.push({
      id: entityId,
      kind: "polyline",
      role: "explicit function graph",
      label: compactLabel(fullLabel, `f${index + 1}`),
      semantic: { expression: fact.expression, sourceText: fact.sourceText },
      provenance: sourceProvenance("question", tier, fact.sourceText),
    });
    constructions.push({
      id: `construct_${entityId}`,
      operator: "function_curve",
      inputs: {
        expression: fact.expression,
        variable: "x",
        xMin: domain[0],
        xMax: domain[1],
        samples: 65,
      },
      outputs: [entityId],
      reason: "plot an equation copied directly from the submitted question",
    });
  });

  const requiredEntityIds = entities.map((entity) => entity.id);
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: {
      mode: "scene",
      reason: "source-grounded nonmetric fallback; derived regions and intersections are intentionally omitted",
    },
    source: {
      question,
      representationTier: tier,
      nonMetric: true,
      displayDomain: { xMin: domain[0], xMax: domain[1] },
      sourceFacts: [
        ...functions.map((fact) => ({ kind: "equation", ...fact })),
        ...givens,
        ...claims,
      ],
      omittedClaims: ["derived values", "intersections", "bounded regions", "metric scale"],
    },
    quantities: givens.map(sourceQuantity),
    entities,
    constructions,
    relations: [],
    assertions: requiredEntityIds.map((entityId, index) => ({
      id: `assert_source_entity_${index + 1}`,
      predicate: "exists",
      entities: [entityId],
      expected: true,
      severity: "fatal",
      reason: "every explicit source equation must be visible",
    })),
    annotations: [],
    requiredEntityIds,
    revealGroups: [{
      id: "source_setup",
      entityIds: requiredEntityIds,
      dependsOn: [],
      narrationCue: "Sketch the equations stated in the question on a common conceptual display window.",
    }],
    teachingTimeline: [{
      id: "reveal_source_setup",
      action: "reveal",
      targetId: "source_setup",
      dependsOn: [],
      narrationIntent: "Introduce only the curves explicitly stated in the question; do not imply a solved region.",
    }],
  };
}

function buildTextOnlyRepresentation(
  question: string,
  facts: SourceFact[],
  tier: Exclude<RepresentationTier, "exact_verified">,
): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: {
      mode: "text_only",
      reason: "no meaningful source-grounded visual structure is available",
    },
    source: {
      question,
      representationTier: tier,
      nonMetric: true,
      sourceFacts: facts,
      omittedClaims: ["derived values", "metric distances", "unstated topology", "unstated directions"],
    },
    quantities: facts.filter((fact) => fact.kind === "given").map(sourceQuantity),
    entities: [],
    constructions: [],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: [],
    revealGroups: [],
    teachingTimeline: [],
  };
}

function extractExplicitFunctionFacts(question: string): SourceFunctionFact[] {
  const normalized = normalizeMathText(question);
  const facts: SourceFunctionFact[] = [];
  const matches = normalized.matchAll(/\by\s*=\s*/gi);
  for (const match of matches) {
    const start = (match.index ?? 0) + match[0].length;
    const rawExpression = readSupportedExpressionPrefix(normalized.slice(start, start + 160));
    const expression = normalizeExpression(rawExpression);
    if (!expression || facts.some((fact) => fact.expression === expression)) continue;
    try {
      parseMathExpression(expression);
      facts.push({ expression, sourceText: `y=${rawExpression.trim()}` });
    } catch {
      // Unsupported expressions stay available as literal source facts instead
      // of being approximated or repaired into a different equation.
    }
  }
  return facts.slice(0, 4);
}

function readSupportedExpressionPrefix(source: string): string {
  const allowedIdentifiers = new Set([
    "x", "pi", "e", "sin", "cos", "tan", "asin", "acos", "atan",
    "sqrt", "abs", "exp", "log", "ln",
  ]);
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (/\s/.test(character) || /[0-9.+\-*/^()]/.test(character)) {
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? "";
      if (!allowedIdentifiers.has(identifier.toLowerCase())) break;
      index += identifier.length;
      continue;
    }
    break;
  }
  return source.slice(0, index).trim();
}

function normalizeMathText(value: string): string {
  return value
    .replace(/[−–—]/g, "-")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3");
}

function normalizeExpression(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/(\d)(?=(?:x|pi|e|sin|cos|tan|asin|acos|atan|sqrt|abs|exp|log|ln|\())/g, "$1*")
    .replace(/x(?=\()/g, "x*")
    .replace(/\)(?=(?:\d|x|pi|e|\())/g, ")*");
}

function sharedDisplayDomain(
  functions: SourceFunctionFact[],
): readonly [number, number] | null {
  for (const domain of DISPLAY_DOMAINS) {
    try {
      functions.forEach((fact) => parseMathExpression(fact.expression)
        .assertContinuousOn(domain[0], domain[1]));
      return domain;
    } catch {
      // Try the next deterministic window; never bridge a discontinuity.
    }
  }
  return null;
}

function displayYRange(
  functions: SourceFunctionFact[],
  domain: readonly [number, number],
): readonly [number, number] {
  const values = [0];
  for (const fact of functions) {
    const parsed = parseMathExpression(fact.expression);
    for (let index = 0; index <= 32; index += 1) {
      const x = domain[0] + (domain[1] - domain[0]) * index / 32;
      values.push(parsed.evaluate(x));
    }
  }
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (maximum - minimum < 2) {
    minimum -= 1;
    maximum += 1;
  } else {
    const padding = (maximum - minimum) * 0.08;
    minimum -= padding;
    maximum += padding;
  }
  return [roundDisplayBound(minimum, "floor"), roundDisplayBound(maximum, "ceil")];
}

function roundDisplayBound(value: number, direction: "floor" | "ceil"): number {
  const rounded = direction === "floor" ? Math.floor(value) : Math.ceil(value);
  return Math.max(-1e6, Math.min(1e6, rounded));
}

function extractGivenFacts(question: string, turnPlan: unknown): SourceFact[] {
  if (!isRecord(turnPlan) || !Array.isArray(turnPlan.givens)) return [];
  return turnPlan.givens.flatMap((value, index) => {
    if (
      !isRecord(value) ||
      value.provenance !== "given" ||
      typeof value.value !== "number" ||
      !Number.isFinite(value.value)
    ) {
      return [];
    }
    const sourceText = typeof value.sourceText === "string" ? value.sourceText.trim() : "";
    if (
      !sourceText ||
      !containsSourceEvidence(question, sourceText) ||
      !sourceEvidenceMatchesQuantity(sourceText, value.value, typeof value.unit === "string" ? value.unit : undefined)
    ) return [];
    const symbol = compactIdentifier(value.symbol) ?? compactIdentifier(value.id) ?? `q${index + 1}`;
    const unit = typeof value.unit === "string" && value.unit !== "1"
      ? value.unit.trim().replace(/\s+/g, " ")
      : "";
    const fullLabel = `${symbol}=${formatNumber(value.value)}${unit ? ` ${unit}` : ""}`;
    return [{
      id: `given_${index + 1}`,
      label: compactLabel(fullLabel, symbol),
      kind: "given" as const,
      sourceText,
      provenance: "turn_plan_given" as const,
    }];
  }).slice(0, 8);
}

function extractGroundedRelationshipFacts(question: string): SourceFact[] {
  const normalized = normalizeWords(question);
  return RELATION_PREDICATES.flatMap((predicate, index) => {
    if (!wordPresent(normalized, predicate)) return [];
    const affirmative = relationStatementPattern(predicate).exec(normalized);
    if (!affirmative || /\b(?:not|never|whether|if)\b/.test(affirmative[0])) return [];
    return [{
      id: `relationship_${index + 1}`,
      label: predicate,
      kind: "relationship" as const,
      sourceText: predicate,
      provenance: "question" as const,
    }];
  }).slice(0, 4);
}

function relationStatementPattern(predicate: (typeof RELATION_PREDICATES)[number]): RegExp {
  if (predicate === "series" || predicate === "parallel") {
    return new RegExp(`\\b(?:is|are|remain|remains|connected)\\s+(?:directly\\s+|in\\s+)?${predicate}\\b`);
  }
  if (predicate === "intersects" || predicate === "encloses") {
    return new RegExp(`\\b[a-z0-9]+\\s+${predicate}\\b`);
  }
  return new RegExp(`\\b(?:is|are|lies|lie|remains|remain)\\s+${predicate}\\b`);
}

function sourceQuantity(fact: SourceFact, index: number): Record<string, unknown> & { id: string } {
  return {
    id: `source_quantity_${index + 1}`,
    label: fact.label,
    sourceText: fact.sourceText,
    provenance: "given",
    representationOnly: true,
  };
}

function sourceProvenance(
  source: string,
  tier: Exclude<RepresentationTier, "exact_verified">,
  sourceText: string,
): Record<string, unknown> {
  return {
    source,
    sourceText,
    representationTier: tier,
    nonMetric: true,
  };
}

function compactIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/\s+/g, "");
  return compact && compact.length <= 16 ? compact : null;
}

function compactLabel(value: string, fallback: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (compact.length > 0 && compact.length <= 16) return compact;
  const safeFallback = fallback.trim().replace(/\s+/g, " ");
  return safeFallback.slice(0, 16) || "Fact";
}

function formatNumber(value: number): string {
  return Number(value.toPrecision(8)).toString();
}

function normalizeWords(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function containsSourceEvidence(question: string, sourceText: string): boolean {
  const compact = (value: string) => normalizeMathText(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[,:;.!?]+$/g, "");
  const evidence = compact(sourceText);
  return evidence.length > 0 && compact(question).includes(evidence);
}

function sourceEvidenceMatchesQuantity(sourceText: string, value: number, unit: string | undefined): boolean {
  const numbers = normalizeMathText(sourceText).match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
  const hasValue = numbers.some((source) => {
    const parsed = Number(source);
    return Number.isFinite(parsed) && Math.abs(parsed - value) <= 1e-9 * Math.max(1, Math.abs(value));
  });
  if (!hasValue) return false;
  const normalizedUnit = String(unit ?? "1").trim().toLowerCase().replace(/\s+/g, "");
  if (!normalizedUnit || normalizedUnit === "1" || normalizedUnit === "dimensionless") return true;
  return normalizeMathText(sourceText).toLowerCase().replace(/\s+/g, "").includes(normalizedUnit);
}

function wordPresent(value: string, word: string): boolean {
  return new RegExp(`(?:^| )${word}(?: |$)`).test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
