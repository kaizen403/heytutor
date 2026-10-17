import {
  SCENE_ENGINE_VERSION,
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
  isChemistrySceneFamily,
  tierForForeignDocument,
  validateSceneDocument,
  validateSceneQuantityAgreement,
  validateTurnPlanSceneProofs,
  validateTurnPlanV3,
  type ProblemStructureView,
  type RenderScene,
  type SceneDocument,
  type TurnPlanV3,
  type ValidationReport,
  type FigureSource,
  relativeMotionSource,
  relativeMotionPlanConflicts,
  resolveCartesianOpticsInputs,
  riverCrossingPlanConflicts,
  riverCrossingSpeeds,
  RELATIVE_MOTION_SOURCE_MODEL,
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
  figureSource: FigureSource;
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
  /** Provenance for an accepted `exact` candidate; planner is the live default. */
  exactFigureSource?: Extract<FigureSource, "planner" | "verified_recovery">;
  /** An explicit strict policy may retain admissible planner ink before source fallbacks. Default is unchanged. */
  preferPlanner?: boolean;
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
  const plan = validateTurnPlanV3(input.turnPlan, input.question).plan;
  if (!plan || plan.visualRequirement === "none") return null;
  if (plan.givens.some((given) => !questionStatesValue(input.question, given.value) &&
      !isQuotedPhysicalConstant(given.symbol, given.value))) return null;
  const result = synthesizeFamilyScene({
    question: input.question,
    turnPlan: plan,
    families: input.families,
    problemIR: input.problemIR ?? null,
  });
  if (!result?.validationReport.valid || result.tier === "question_representation" ||
      !result.renderScene.primitives.some((primitive) =>
        (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text?.trim())) return null;
  if (result.tier !== "exact_verified" && (plan.givens.some((given) => !isPlannerQuotedConstant(input.question, given)) ||
      plan.derived.some((quantity) => !questionStatesValue(input.question, quantity.value)))) return null;
  const agreement = validateSceneQuantityAgreement(result.document.quantities, plan,
    result.renderScene.primitives.flatMap((primitive) =>
      (primitive.kind === "label" || primitive.kind === "dimension") && typeof primitive.text === "string"
        ? [primitive.text] : []));
  if (agreement.length > 0 || (result.tier === "exact_verified" &&
      validateTurnPlanSceneProofs(result.document, plan).some((issue) => issue.severity === "fatal"))) return null;
  return {
    tier: result.tier,
    nonMetric: result.nonMetric,
    sceneDocument: result.document,
    renderScene: result.renderScene,
    validationReport: result.validationReport,
    figureSource: "fast_family",
    reason: result.reason,
    family: result.family,
  };
}

/**
 * Why a supplied exact candidate was not the representation returned. A code
 * is a stable issue code; `preferred` marks a policy that draws another
 * verified figure instead, every other code is a check the per-candidate
 * validator does not apply.
 */
export interface ExactCandidateDecline {
  code: string;
  reason: string;
  preferred: boolean;
}

/**
 * Select the highest-confidence representation without changing the exact
 * scene's proof contract. An exact candidate wins only when the caller's final
 * report is valid and the current engine supplies the selected render/report.
 */
export function selectVerifiedRepresentation(
  input: RepresentationSelectionInput,
): SelectedRepresentation {
  return selectVerifiedRepresentationExplained(input).selected;
}

/**
 * The same selection, plus the reason a supplied exact candidate was not
 * returned. `exactDecline` is null when there was no exact candidate or it was
 * the representation selected.
 */
export function selectVerifiedRepresentationExplained(
  input: RepresentationSelectionInput,
): { selected: SelectedRepresentation; exactDecline: ExactCandidateDecline | null } {
  // The question fixes these motion numbers. A plan that would narrate a
  // different value gets no figure at all, so a stale number is never spoken
  // over a correct (or a planner-drawn) picture.
  const motionConflict = motionPlanConflict(input.question, input.turnPlan);
  if (motionConflict) {
    const textOnly = buildTextOnlySelected(input.question);
    return {
      selected: { ...textOnly, reason: motionConflict },
      exactDecline: input.exact ? { code: "motion_plan_conflict", reason: motionConflict, preferred: false } : null,
    };
  }
  const exactCheck = input.exact
    ? checkUsableExactRepresentation(input.exact, input.question, input.problemIR)
    : null;
  const currentCompile = exactCheck?.compiled ?? null;
  let exactDecline: ExactCandidateDecline | null = exactCheck?.rejection
    ? { ...exactCheck.rejection, preferred: false }
    : null;
  const explained = (selected: SelectedRepresentation) => ({ selected, exactDecline });
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
  // A lens or mirror scene the optics proof accepts is engine-derived from the
  // stem's u and f; it earns only the qualitative tier (no metric predicate
  // covers gaussian_image) yet must not lose to the archetype.
  const unprovenPlannerScene = input.exact && currentCompile?.renderScene &&
    tierForForeignDocument(input.exact.sceneDocument).tier !== "exact_verified" &&
    plannerOpticsProof(input.question, input.exact.sceneDocument) !== "proven";
  // When the plan names circular motion, the source owns the figure: the
  // engine recomputes the state from the stated radius and rate, so a planner
  // scene cannot imply a direction or value the source did not give. A source
  // the engine declines (zero radius, contradictory rates, changing speed, a
  // plan value that disagrees with the recomputed state) teaches without a
  // figure rather than through any other picture.
  const circular = synthesizeUniformCircularScene(input.question, { turnPlan: input.turnPlan, problemIR: input.problemIR });
  if (circular?.status === "declined" && !circular.legacyOnly) {
    if (currentCompile) {
      exactDecline = { code: "circular_source_declined", reason: "the stated circular motion was declined, so no figure is drawn", preferred: false };
    }
    return explained(buildTextOnlySelected(input.question));
  }
  // An admitted constant-velocity relative-motion source owns its whole
  // figure (bodies, frame, signed velocities, encounter); a planner scene
  // cannot replace it with differently signed or stale motion.
  const relativeMotion = input.exact && relativeMotionSource(input.question)?.status === "admitted";
  const sourceFigure = circular?.status === "drawn" ? circular.scene
    : unprovenMensuration || unprovenPlannerScene || relativeMotion ? synthesize() : null;
  const preferSourceFigure = circular?.status === "drawn"
    || sourceFigure?.family === "solid_figure" || sourceFigure?.family === "bounded_region"
    || sourceFigure?.document.source.sourceModel === RELATIVE_MOTION_SOURCE_MODEL
    || (unprovenPlannerScene && sourceFigure?.tier === "exact_verified" && typeof sourceFigure.document.source.archetype === "string");
  if (input.exact && currentCompile?.renderScene && preferSourceFigure && !input.preferPlanner) {
    exactDecline = { code: "source_figure_preferred", reason: "a source-computed figure outranks the planner scene", preferred: true };
  }
  if (input.exact && currentCompile?.renderScene && (!preferSourceFigure || input.preferPlanner)) {
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
    const compiled = document === input.exact.sceneDocument ? currentCompile : compileSceneDocument(document);
    if (compiled.ok && compiled.renderScene) {
      return explained({
        tier: decision.tier,
        nonMetric: decision.nonMetric,
        sceneDocument: document,
        renderScene: compiled.renderScene,
        validationReport: compiled.report,
        figureSource: input.exactFigureSource ?? "planner",
        reason: decision.tier === "exact_verified"
          ? `caller supplied a verified scene with ${decision.reason}`
          : `caller supplied a verified scene; ${decision.reason}`,
      });
    }
    exactDecline = { code: "exact_tier_recompile_failed", reason: "the scene did not compile after its earned tier was written in", preferred: false };
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
    const compiled = compileSceneDocument(matrixDocument);
    if (compiled.ok && compiled.renderScene) {
      return explained({
        tier: decision.tier,
        nonMetric: decision.nonMetric,
        sceneDocument: matrixDocument,
        renderScene: compiled.renderScene,
        validationReport: compiled.report,
        figureSource: "matrix_source",
        reason: `engine drew the question's matrix source program; ${decision.reason}`,
      });
    }
  }

  const synthesized = sourceFigure ?? synthesize();
  if (synthesized) {
    return explained({
      tier: synthesized.tier,
      nonMetric: synthesized.nonMetric,
      sceneDocument: synthesized.document,
      renderScene: synthesized.renderScene,
      validationReport: synthesized.validationReport,
      figureSource: synthesizedFigureSource(synthesized.document, synthesized.family),
      reason: synthesized.reason,
      family: synthesized.family,
    });
  }

  try {
    return explained(buildSourceGroundedRepresentation(input.question, input.turnPlan));
  } catch {
    const lastResort = synthesizeLastResortScene({
      question: input.question,
      turnPlan: input.turnPlan,
      families,
      problemIR: input.problemIR ?? null,
    });
    if (lastResort) {
      return explained({
        tier: lastResort.tier,
        nonMetric: lastResort.nonMetric,
        sceneDocument: lastResort.document,
        renderScene: lastResort.renderScene,
        validationReport: lastResort.validationReport,
        figureSource: "last_resort",
        reason: lastResort.reason,
      });
    }
    return explained(buildTextOnlySelected(input.question));
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
    figureSource: "text_only",
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
    figureSource: document.visualDecision.mode === "text_only" ? "text_only" : "source_grounded",
    reason: document.visualDecision.mode === "text_only"
      ? "no meaningful source-grounded visual structure was available"
      : tier === "qualitative_verified"
        ? "rendered source-grounded qualitative relationships without metric claims"
        : "rendered only entities and equations explicitly present in the question",
  };
}

function synthesizedFigureSource(document: SceneDocument, family: string | undefined): FigureSource {
  if (family && isChemistrySceneFamily(family)) return "chemistry_family";
  return typeof document.source.archetype === "string" ? "archetype" : "family";
}

type ExactCandidateRejection = Omit<ExactCandidateDecline, "preferred">;

function checkUsableExactRepresentation(
  candidate: ExactVerifiedRepresentation,
  expectedQuestion: string,
  problemIR?: ProblemStructureView | null,
): { compiled: ReturnType<typeof compileSceneDocument> | null; rejection: ExactCandidateRejection | null } {
  const reject = (code: string, reason: string) => ({ compiled: null, rejection: { code, reason } });
  // TypeScript's interface is not a runtime proof: the caller may supply an
  // incomplete, forged or stale report despite the ExactVerifiedRepresentation type.
  if (!isCurrentEngineReport(candidate.validationReport)) {
    return reject("exact_report_not_current", "the scene report is not a valid report from the current engine");
  }
  // A planner scene is validated and compiled, which proves the geometry is
  // sound — never that it is this question's geometry. It faces the same
  // picture demand the synthesized families face, so a validated-but-wrong
  // figure falls through to the fallback instead of being taught.
  const demand = demandRejection(candidate.sceneDocument, sceneDemand(expectedQuestion, problemIR));
  if (demand) return reject("picture_demand_unmet", `the scene does not show what the question asks for: ${demand}`);
  // The scene must be for the asked question. The planner parse step keeps
  // an explicit model source.question, and a recovered or persisted scene
  // keeps its own, so this exact match refuses a scene planned for another
  // question, or for a restatement of this one (15 Oct 2026: writing the
  // asked question over restatements drew 9 wrong strict figures in a replay
  // of 74 restated runs, so the match stays exact).
  const sourceQuestion = candidate.sceneDocument.source.question;
  if (typeof sourceQuestion !== "string" ||
      normalizeQuestion(sourceQuestion) !== normalizeQuestion(expectedQuestion)) {
    return reject("source_question_mismatch", "the scene was drawn for a different question");
  }
  if (candidate.validationReport.issues.some((issue) =>
    issue.severity === "fatal" || issue.code === "assertion_failed")) {
    return reject("exact_assertion_unproven", "the scene report carries a fatal issue or a failed assertion");
  }
  if (candidate.sceneDocument.visualDecision.mode !== "scene") {
    return reject("exact_not_scene", "the candidate declined to draw a scene");
  }
  if (usesMensurationSolidOnContactProblem(expectedQuestion, candidate.sceneDocument)) {
    return reject("mensuration_solid_on_contact_problem", "a mensuration solid was drawn for a contact problem");
  }
  if (usesCollidingCircuitViews(expectedQuestion, candidate.sceneDocument)) {
    return reject("colliding_circuit_views", "two circuit views collide on the board");
  }
  if (usesGenericVectorDiagramOnRiverBoat(expectedQuestion, candidate.sceneDocument)) {
    return reject("generic_vectors_on_river_boat", "a generic vector diagram was drawn for a river crossing");
  }
  if (plannerOpticsProof(expectedQuestion, candidate.sceneDocument) === "unproven") {
    return reject("planner_optics_unproven", "the optics proof does not accept this lens or mirror scene");
  }
  const normalized = validateSceneDocument(candidate.sceneDocument);
  // The compiler validates a normalized copy, but compiles the supplied document.
  // Do not accept a raw document whose actions, proofs or operands were changed
  // (or dropped) by that normalization while returning the raw document to the tutor.
  if (!normalized.document || !sameJsonStructure(normalized.document, candidate.sceneDocument, true)) {
    return reject("exact_not_normalized", "normalization changed the scene document");
  }
  const currentCompile = compileSceneDocument(candidate.sceneDocument);
  const hasReadableInk = currentCompile.renderScene?.primitives.some((primitive) =>
    (primitive.kind === "label" || primitive.kind === "dimension") &&
    typeof primitive.text === "string" && primitive.text.trim().length > 0);
  if (!currentCompile.ok || !currentCompile.report.valid ||
      currentCompile.report.issues.some((issue) =>
        issue.severity === "fatal" || issue.code === "assertion_failed")) {
    return reject("exact_recompile_invalid", "the current engine does not compile the scene cleanly");
  }
  if (!reportsAgree(candidate.validationReport, currentCompile.report)) {
    return reject("exact_report_disagrees", "the supplied report disagrees with the current compile");
  }
  if (!currentCompile.renderScene?.primitives.length || !hasReadableInk) {
    return reject("exact_without_readable_ink", "the compiled scene has no readable label");
  }
  return { compiled: currentCompile, rejection: null };
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

export type PlannerOpticsProof = "not_optics" | "proven" | "unproven";

/**
 * On a lens or mirror stem a planner figure is admitted only when the engine,
 * not the model, placed what the student reads: the object, image and foci are
 * `gaussian_image` / `optical_focus` outputs whose u, f and element kind match
 * the stem (a stated lens power fixes |f| = 1/|P|; a kind the stem neither names
 * nor implies by a power, focal sign or the image it states declines), the engine image has the
 * distance, side and nature (real or virtual, enlarged or diminished) the stem states, the element is drawn on that
 * centre and axis with the stem's sense, every ray ends on an engine-derived
 * point, and every line affirmatively converging on the image tip leaves the
 * element (a point on its plane within the element as drawn) after a drawn
 * incident ray from the object tip, or is a lens chief ray through the optical
 * centre. Rays the engine traced with `principal_rays` from the image tip need
 * no hand `converges`; two of them prove the rays, and each must meet the
 * element within its drawn half height (P10). Every other drawn light path, a
 * third hand ray or a polyline included, must be a ray the element forms (P11). Free-point figures, whose
 * ratio assertions are self-declared, fail. A model-writable
 * `source.archetype` label is never read.
 *
 * The stem is matched unhinted (no plan), as before; a misspelled stem the
 * detector misses stays "not_optics".
 */
export function plannerOpticsProof(question: string, document: SceneDocument): PlannerOpticsProof {
  return explainPlannerOpticsProof(question, document).proof;
}

export function explainPlannerOpticsProof(
  question: string,
  document: SceneDocument,
): { proof: PlannerOpticsProof; reason: string } {
  const match = detectArchetype(question);
  if (match?.id !== "spherical_mirror" && match?.id !== "thin_lens") {
    return { proof: "not_optics", reason: "not a lens or mirror stem" };
  }
  const failure = opticsProofFailure(question, match, document);
  return failure === null
    ? { proof: "proven", reason: "object, image, foci and rays are engine-derived from the stem's u and f" }
    : { proof: "unproven", reason: failure };
}

type OpticsStemMatch = NonNullable<ReturnType<typeof detectArchetype>>;
type OpticsConstruction = SceneDocument["constructions"][number];

const OPTICS_CM_PER_UNIT: Readonly<Record<string, number>> = {
  cm: 1, centimeter: 1, centimeters: 1, centimetre: 1, centimetres: 1,
  m: 100, meter: 100, meters: 100, metre: 100, metres: 100,
  mm: 0.1, millimeter: 0.1, millimeters: 0.1, millimetre: 0.1, millimetres: 0.1,
};
const OPTICS_START_KEYS = ["start", "from", "a"] as const;
const OPTICS_LINE_START_KEYS = ["start", "from", "a", "origin"] as const;
const OPTICS_END_KEYS = ["end", "to", "b"] as const;
/** Parameter-free derivations: each output is fixed by its geometric inputs. */
const OPTICS_DERIVED_INPUTS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  project: [["point", "source"], ["line", "onto"]],
  intersection: [["first", "a", "line1"], ["second", "b", "line2"]],
  perpendicular_through: [["through", "point"], ["line", "reference"]],
  parallel_through: [["through", "point"], ["line", "reference"]],
  reflect_point: [["point", "source"], ["line", "axis"]],
  midpoint: [["a", "start"], ["b", "end"]],
  rotate: [["point", "source"], ["center"]],
  line: [OPTICS_LINE_START_KEYS, OPTICS_END_KEYS],
  ray: [OPTICS_LINE_START_KEYS, OPTICS_END_KEYS],
  segment: [OPTICS_START_KEYS, OPTICS_END_KEYS],
  vector: [OPTICS_LINE_START_KEYS, OPTICS_END_KEYS],
};
const OPTICS_PATH_OPERATORS = new Set(["segment", "ray", "vector", "line"]);
/** Open paths the compiler draws between given points: always read as light paths (P7, P11). */
const OPTICS_OPEN_PATH_OPERATORS = new Set(["segment", "ray", "vector", "polyline"]);
/** lens_section and spherical_surface draw a flat element beyond this radius. */
const OPTICS_PLANO_RATIO = 40;

function opticsProofFailure(question: string, match: OpticsStemMatch, document: SceneDocument): string | null {
  const element = match.id === "thin_lens" ? "lens" : "mirror";
  // P1: one engine image, of the stem's element.
  const images = document.constructions.filter((construction) => construction.operator === "gaussian_image");
  if (images.length !== 1) return `gaussian_image count ${images.length}`;
  const image = images[0]!;
  const inputs = image.inputs;
  if (inputs.kind !== element) return `gaussian_image kind ${String(inputs.kind)} on a ${match.id} stem`;
  if (image.outputs.length !== 4) return "gaussian_image must output object base, object tip, image base and image tip";
  // P2: u and f read through the engine's own Cartesian resolver (signed inputs, or
  // unsigned magnitudes with form), so the proof and the engine cannot disagree.
  // A real object with light along +axis, the stem's focal sign, and the stem's form.
  const resolved = opticsResolved(inputs, document, "gaussian_image");
  if (typeof resolved === "string") return `gaussian_image ${resolved}`;
  // The kind is the stem's: named, implied by a lens power or focal sign, or by the image the stem
  // describes. detectArchetype defaults an unnamed kind to convex, and the figure's own form or sign
  // would only compare the figure with itself, so a stem that implies no kind declines.
  const stemKind = opticsStatedKind(question, element, match) ?? opticsImpliedKind(question, element, match);
  if (stemKind === null) {
    return `the stem names no ${element} kind, and no power, focal sign, image nature or image side implies one`;
  }
  const converges = element === "lens" ? stemKind === "convex" : stemKind === "concave";
  if (resolved.form !== undefined && (resolved.form === "converging") !== converges) {
    return `gaussian_image form ${resolved.form} contradicts a ${stemKind} ${element}`;
  }
  const u = resolved.objectDistance ?? Number.NaN;
  const f = resolved.focalLength;
  if (!Number.isFinite(u) || !(u < 0)) return "objectDistance must be negative: a real object with light along +axis";
  const focalSign = element === "lens" ? (stemKind === "convex" ? 1 : -1) : (stemKind === "concave" ? -1 : 1);
  if (!Number.isFinite(f) || Math.sign(f) !== focalSign) return `focalLength sign contradicts a ${stemKind} ${element}`;
  // P3: |u| and |f| are the stem's (f = R/2 when only R is stated). A metric unit is
  // required only when a stated slot is compared; a stem with no numbers draws
  // representative unitless values.
  const statedSlots = (["u", "f"] as const).filter((slot) =>
    (match.sources[slot] === "stem" || match.sources[slot] === "plan") && typeof match.slots[slot] === "number");
  const scale = opticsCmPerUnit(inputs.lengthUnit);
  if (statedSlots.length > 0 && scale === null) return "gaussian_image lengthUnit must be cm, m or mm";
  for (const slot of statedSlots) {
    // A stem may write the sign ("focal length of -0.25 m"); only the magnitude is the stem's claim.
    const stated = Math.abs(match.slots[slot] as number);
    const value = (slot === "u" ? -u : Math.abs(f)) * scale!;
    if (!opticsClose(value, stated)) return `${slot} = ${value} cm contradicts the stem's ${stated} cm`;
  }
  // A lens power in dioptres states |f| = 1/|P| metres, so -6.25 D is 16 cm whatever else the stem gives.
  // detectArchetype reads no focal length from a power; 1/P rounded to three figures still agrees.
  const power = element === "lens" ? opticsStatedPowerFocal(question) : null;
  if (power) {
    if (scale === null) return "gaussian_image lengthUnit must be cm, m or mm";
    const value = Math.abs(f) * scale;
    if (!(Math.abs(value - power.cm) <= OPTICS_POWER_TOLERANCE * power.cm)) {
      return `f = ${opticsCompact(value)} cm contradicts the stem's power ${power.text} D (|f| = ${opticsCompact(power.cm)} cm)`;
    }
  }
  // An image distance the stem states is the engine's, within 1 percent, on the side it states
  // (behind a mirror, or on the object's side of a lens, is virtual).
  const v = element === "lens" ? f * u / (u + f) : f * u / (u - f);
  const virtualImage = element === "lens" ? v < 0 : v > 0;
  const stemImage = opticsStemImage(question, element);
  for (const side of stemImage.sides) {
    if (side.cm === null) continue;
    if (scale === null) return "gaussian_image lengthUnit must be cm, m or mm";
    const value = Math.abs(v) * scale;
    if (!(Math.abs(value - side.cm) <= OPTICS_IMAGE_DISTANCE_TOLERANCE * side.cm) || (side.virtual !== null && side.virtual !== virtualImage)) {
      const where = element === "mirror" ? (virtualImage ? "behind the mirror" : "in front of the mirror")
        : virtualImage ? "on the object's side of the lens" : "on the far side of the lens";
      return `the image at ${opticsCompact(value)} cm ${where} contradicts the stem's ${side.text}`;
    }
  }
  // The image nature the stem states is the engine image's, not only the kind it implies (a convex
  // lens forms a real image only beyond f): real or virtual, and enlarged (|m| > 1) or diminished
  // (|m| < 1), with |m| = |v/u| for both elements.
  const nature = opticsStemNature(question, element, match);
  const magnification = Math.abs(v / u);
  const engineImage = `the engine image (${virtualImage ? "virtual" : "real"}, |m| = ${opticsCompact(magnification)})`;
  const contradicted = nature.real && virtualImage ? "real" : nature.virtual && !virtualImage ? "virtual"
    : nature.larger && !(magnification > 1) ? "enlarged" : nature.smaller && !(magnification < 1) ? "diminished" : null;
  if (contradicted) return `${engineImage} contradicts the stem's ${contradicted} image`;
  // A nature the stem denies ("does not form a real image", "no real, magnified image") is not the
  // engine image's in full. A denial implies no kind (`opticsStemImage`), so it only refuses.
  const holds = (word: string) => /real|inverted/.test(word) ? !virtualImage : /virtual|erect|upright/.test(word) ? virtualImage
    : /enlarged|magnified/.test(word) ? magnification > 1 : magnification < 1;
  const ruledOut = stemImage.denied.find((words) => words.length > 0 && words.every(holds));
  if (ruledOut) return `${engineImage} is the ${ruledOut.join(", ")} image the stem denies`;
  // P4: every focus is the engine focus of this element, in the image's unit.
  const foci = document.constructions.filter((construction) => construction.operator === "optical_focus");
  if (foci.length === 0) return "no optical_focus";
  const displayScale = opticsNumber(inputs.displayScale, document);
  for (const focus of foci) {
    const focusResolved = opticsResolved(focus.inputs, document, "optical_focus");
    if (
      typeof focusResolved === "string" ||
      focus.inputs.kind !== element || opticsUnitKey(focus.inputs.lengthUnit) !== opticsUnitKey(inputs.lengthUnit) ||
      !sameOpticsInput(focus.inputs.center, inputs.center) || !sameOpticsInput(focus.inputs.axis, inputs.axis) ||
      !opticsClose(focusResolved.focalLength, f) ||
      !opticsClose(opticsNumber(focus.inputs.displayScale, document), displayScale)
    ) return `optical_focus ${focus.id} disagrees with the gaussian_image element`;
  }
  // P5: the element itself, on the same centre and axis, with the stem's sense.
  const elementFailure = opticsElementFailure(element, stemKind, image, document);
  if (elementFailure) return elementFailure;
  // P6: the object and image arrows join the engine anchors.
  const [objectBase, objectTip, imageBase, imageTip] = image.outputs;
  const arrows = [[objectBase, objectTip], [imageBase, imageTip]].map(([from, to]) =>
    document.constructions.find((construction) =>
      (construction.operator === "vector" || construction.operator === "segment") &&
      opticsFirst(construction.inputs, construction.operator === "vector" ? OPTICS_LINE_START_KEYS : OPTICS_START_KEYS) === from &&
      opticsFirst(construction.inputs, OPTICS_END_KEYS) === to));
  if (arrows.some((arrow) => !arrow)) return "object or image arrow is not drawn on the gaussian_image anchors";
  // The compiler draws a vector's direction in place of its end, so such an arrow is not on the tip it names.
  const redirected = arrows.find((arrow) => opticsRedirected(arrow!));
  if (redirected) {
    return `object or image arrow ${redirected.outputs[0] ?? redirected.id} carries a direction, which the compiler draws in place of its end`;
  }
  // P8: two or more rays the engine traced from this image tip (principal_rays), or a
  // fatal convergence of hand-drawn rays at the engine image tip. The compiler passes a
  // converges with expected false when the rays miss, so only an affirmative one proves.
  const traced = document.constructions.filter((construction) => construction.operator === "principal_rays");
  const untraced = traced.find((construction) => construction.inputs.image !== imageTip);
  if (untraced) return `principal_rays ${untraced.id} does not trace the gaussian image tip`;
  const tracedOutputs = new Set(traced.flatMap((construction) => construction.outputs));
  const convergence = document.assertions.filter((assertion) =>
    assertion.predicate === "converges" && assertion.severity === "fatal" && assertion.expected !== false &&
    assertion.entities.length >= 3 && assertion.entities.at(-1) === imageTip);
  if (convergence.length === 0 && tracedOutputs.size < 2) {
    return "no fatal converges assertion ending on the gaussian image tip, and fewer than two principal_rays traced from it";
  }
  // P7: every ray, extension and converging line ends on an engine-derived point. Each open path
  // other than the two arrows counts, whatever its role: a polyline draws ink as a segment does. So
  // does every line that can show light (`opticsLineShowsLight`).
  const producer = new Map<string, OpticsConstruction>();
  for (const construction of document.constructions) {
    for (const output of construction.outputs) producer.set(output, construction);
  }
  const frame = opticsFrame(image, foci, element, resolved, displayScale, document, producer);
  const entities = new Map(document.entities.map((entity) => [entity.id, entity]));
  const rays = new Set<OpticsConstruction>();
  for (const construction of document.constructions) {
    if (arrows.includes(construction)) continue;
    if (OPTICS_OPEN_PATH_OPERATORS.has(construction.operator) ||
      (construction.operator === "line" && opticsLineShowsLight(construction, inputs.axis, entities, frame, document))) {
      rays.add(construction);
    }
  }
  for (const assertion of convergence) {
    for (const id of assertion.entities.slice(0, -1)) {
      if (tracedOutputs.has(id)) continue;
      const path = producer.get(id);
      if (!path || !OPTICS_PATH_OPERATORS.has(path.operator)) return `converging line ${id} is not a drawn ray`;
      rays.add(path);
    }
  }
  if (rays.size + tracedOutputs.size < 2) return "fewer than two ray or extension paths";
  const anchors = new Set<string>([...image.outputs, ...foci.flatMap((focus) => focus.outputs)]);
  if (typeof inputs.center === "string") anchors.add(inputs.center);
  if (typeof inputs.axis === "string") anchors.add(inputs.axis);
  const verdicts = new Map<string, boolean>();
  const derived = (id: unknown, depth: number): boolean => {
    if (typeof id !== "string") return false;
    if (anchors.has(id)) return true;
    const known = verdicts.get(id);
    if (known !== undefined) return known;
    if (depth > 32) return false;
    verdicts.set(id, false);
    const construction = producer.get(id);
    const references = construction ? opticsDerivedReferences(construction, document) : null;
    const verdict = references !== null && references.every((reference) => derived(reference, depth + 1));
    verdicts.set(id, verdict);
    return verdict;
  };
  for (const ray of rays) {
    const references = opticsPathVertices(ray, document);
    if (!references || !references.every((reference) => derived(reference, 0))) {
      return `ray ${ray.outputs[0] ?? ray.id} has an endpoint the engine did not derive`;
    }
  }
  // P9: each converging line is a real ray path through the element. A hit is on the
  // element when it lies on the element plane within the element as drawn, whatever
  // parameter-free construction placed it.
  const lensImage = element === "lens" ? { u, v: f * u / (u + f) } : null;
  const surfaces = document.constructions.filter((construction) =>
    construction.operator === "lens_section" || construction.operator === "spherical_surface");
  const reach = Math.min(...surfaces.map((surface) => opticsDrawnHalfHeight(surface, document)));
  const onElement = (point: unknown): boolean => {
    const at = frame.point(point);
    return at !== null && Math.abs(at.a) <= frame.tolerance && Math.abs(at.y) <= reach * (1 + 1e-9) + frame.tolerance;
  };
  for (const assertion of convergence) {
    for (const id of assertion.entities.slice(0, -1)) {
      // The engine certified its traced rays; P9 holds the hand-drawn ones.
      if (tracedOutputs.has(id)) continue;
      const failure = opticsConvergingPathFailure(id, producer.get(id)!, image, lensImage, document, onElement);
      if (failure) return failure;
    }
  }
  // P10: every traced ray meets the element within its drawn half height.
  const tracedFailure = opticsTracedHitFailure(traced, element, resolved, displayScale, surfaces, document);
  if (tracedFailure) return tracedFailure;
  // P11: every other drawn light path, converging or not, is a ray the element forms.
  const converging = new Set(convergence.flatMap((assertion) => assertion.entities.slice(0, -1)));
  return opticsLightPathFailure(rays, converging, element, image, document, frame, onElement);
}

/**
 * P11. Two traced or converging rays prove the image; every other path P7 classes as light (each
 * segment, ray, vector and polyline other than the two arrows, a line that can show light, a
 * converging line) must be one too, or the figure draws a ray no element forms. A polyline is
 * read as the segments between its points, each held to these rules, and a vector carrying a
 * `direction` is refused, since the compiler draws that instead of its end. A path is light when it is
 * - on the principal axis (the axial ray; also the axis and distances drawn along it);
 * - on a lens, on the chief line from the object tip through the optical centre, from the object
 *   tip onward (back to a virtual image when there is one, dashed and arrowless behind the object
 *   tip), with any arrow pointing on through the centre;
 * - an incident ray: a segment or vector from the object tip to a point S on the element as drawn;
 * - an emergent ray: it leaves such an S, reached by a drawn incident ray from the object tip, on
 *   the line from S through the image tip (by the imaging property every ray from the object tip
 *   does: a parallel ray leaves through or as if from the focus, a focal ray leaves parallel), on
 *   the side the light leaves toward (beyond a lens, back in front of a mirror), or, for a virtual
 *   image, back from S as the extension that meets it (drawn to the image or on to the focus),
 *   dashed and with no arrowhead (`OpticsPathInk`), since no light runs there.
 * Everything is evaluated in the element frame (`opticsFrame`); a line is unbounded both ways, so
 * one is light only along the axis. Element outlines, and unmarked lines along or across the axis
 * (`opticsLineShowsLight`), are not paths and are not read.
 */
function opticsLightPathFailure(
  paths: ReadonlySet<OpticsConstruction>,
  converging: ReadonlySet<string>,
  element: "lens" | "mirror",
  image: OpticsConstruction,
  document: SceneDocument,
  frame: { point(id: unknown): OpticsFramePoint | null; tolerance: number },
  onElement: (point: unknown) => boolean,
): string | null {
  const [objectBase, objectTip, , imageTip] = image.outputs;
  const tip = frame.point(objectTip);
  const target = frame.point(imageTip);
  if (!tip || !target) return "the object or image tip cannot be placed on the element";
  const centre: OpticsFramePoint = { a: 0, y: 0 };
  const tolerance = frame.tolerance;
  // Light leaves a lens toward +a and a mirror back toward -a; a virtual image lies on the other side.
  const side = element === "lens" ? 1 : -1;
  const onLine = (point: OpticsFramePoint, from: OpticsFramePoint, to: OpticsFramePoint) =>
    Math.abs((to.a - from.a) * (point.y - from.y) - (to.y - from.y) * (point.a - from.a)) <=
      tolerance * Math.max(1, Math.hypot(to.a - from.a, to.y - from.y));
  const startOf = (construction: OpticsConstruction) => opticsFirst(construction.inputs,
    construction.operator === "segment" ? OPTICS_START_KEYS : OPTICS_LINE_START_KEYS);
  const endOf = (construction: OpticsConstruction) => opticsFirst(construction.inputs, OPTICS_END_KEYS);
  // The straight pieces a path draws: a polyline's segments between its points, else the path itself.
  const pieces = new Map<OpticsConstruction, OpticsPathPiece[]>();
  const piecesOf = (construction: OpticsConstruction): OpticsPathPiece[] => {
    let known = pieces.get(construction);
    if (!known) {
      const points = construction.operator === "polyline" ? opticsPathVertices(construction, document) ?? [] : [];
      known = construction.operator === "polyline"
        ? points.slice(1).map((end, index) => ({ operator: "segment", start: points[index], end }))
        : [{ operator: construction.operator, start: startOf(construction), end: endOf(construction) }];
      pieces.set(construction, known);
    }
    return known;
  };
  // Incident rays: a segment, vector or polyline piece from the object tip to the hit.
  const drawn = document.constructions.flatMap((construction) =>
    construction.operator === "segment" || construction.operator === "vector" || construction.operator === "polyline" ? piecesOf(construction) : []);
  const incident = (piece: OpticsPathPiece, hit: unknown) => drawn.some((other) => other !== piece &&
    ((other.start === objectTip && other.end === hit) || (other.operator === "segment" && other.start === hit && other.end === objectTip)));
  const pieceFailure = (piece: OpticsPathPiece, name: string, id: string, ink: OpticsPathInk): string | null => {
    const { operator, start: startId, end: endId } = piece;
    const start = frame.point(startId);
    const end = frame.point(endId);
    if (!start || !end) return `${name} has an endpoint the proof cannot place on the element`;
    // The axial extent the drawn path covers: a segment or vector between its ends, a ray from its
    // start through its end and on, a line both ways.
    const run = end.a - start.a;
    const low = operator === "line" || (operator === "ray" && run < 0) ? Number.NEGATIVE_INFINITY : Math.min(start.a, end.a);
    const high = operator === "line" || (operator === "ray" && run > 0) ? Number.POSITIVE_INFINITY : Math.max(start.a, end.a);
    if (Math.abs(start.y) <= tolerance && Math.abs(end.y) <= tolerance) return null;
    if (element === "lens" && onLine(start, centre, tip) && onLine(end, centre, tip)) {
      if (!(low >= Math.min(tip.a, target.a) - tolerance)) {
        return `chief ray ${id} runs back past the object tip, where no light on the line through the optical centre goes`;
      }
      // Its light runs from the object tip on through the centre, so an arrow points that way. Back
      // past the object tip (to a virtual image farther out) it is only the extension: dashed, no arrow.
      if (ink.arrow && run < -tolerance) return `chief ray ${id} points back toward the object, against its light`;
      if (low < tip.a - tolerance && (ink.arrow || !ink.dashed)) {
        return `chief ray ${id} runs back past the object tip to the virtual image as ${ink.arrow ? "an arrow" : "solid ink"}; that extension is drawn dashed with no arrow`;
      }
      return null;
    }
    const undirected = !ink.arrow && (operator === "segment" || operator === "line");
    if ((operator === "segment" && startId === objectTip && onElement(endId)) || (undirected && endId === objectTip && onElement(startId)) ||
      (operator === "vector" && startId === objectTip && onElement(endId))) return null;
    const hit = onElement(startId) ? startId : undirected && onElement(endId) ? endId : undefined;
    if (hit === undefined) {
      return `${name} neither runs from the object tip to the ${element} nor leaves it${startId === objectBase || endId === objectBase ? " (it touches the object base)" : ""}`;
    }
    if (!incident(piece, hit)) return `${name} has no drawn incident ray from the object tip to ${String(hit)}`;
    const leave = frame.point(hit)!;
    if (!onLine(start, leave, target) || !onLine(end, leave, target)) {
      return `${name} leaves the ${element} at ${String(hit)} off the line to the image tip (a parallel ray leaves through or as if from the focus, a focal ray leaves parallel)`;
    }
    // Along this line the light runs from S to the leaving side. Back from S it is only the
    // extension of a virtual image's ray, drawn to the image or on to the focus: dashed, and with no
    // arrow, which would point back against the light. A line through S is held to this for its back part.
    const nearest = side > 0 ? low : -high;
    if (!(nearest >= -tolerance)) {
      const back = element === "lens" ? "back across the lens toward the object" : "behind the mirror";
      if (side * target.a > 0) return `${name} runs ${back} where its light does not go`;
      if (ink.arrow || !ink.dashed) {
        return `${name} runs ${back} as ${ink.arrow ? "an arrow" : "solid ink"}, where only the virtual image's extension goes, dashed with no arrow`;
      }
    }
    return null;
  };
  const entities = new Map(document.entities.map((entity) => [entity.id, entity]));
  for (const path of paths) {
    const id = path.outputs[0] ?? path.id;
    const name = converging.has(id) ? `converging line ${id}` : `ray ${id}`;
    // A vector with a direction is drawn along it, not to the end the rules below read.
    if (opticsRedirected(path)) return `${name} carries a direction, which the compiler draws in place of its end`;
    const entity = entities.get(id);
    const ink: OpticsPathInk = {
      arrow: path.operator === "vector" || path.operator === "ray" || entity?.kind === "vector" || entity?.kind === "ray",
      dashed: entity?.provenance?.dashed === true,
    };
    for (const piece of piecesOf(path)) {
      const failure = pieceFailure(piece, name, id, ink);
      if (failure) return failure;
    }
  }
  return null;
}

/**
 * Whether P7 and P11 read a `line` as light. Unbounded, a line drawn anywhere but along or across the
 * principal axis crosses the figure where only light is drawn, so it is light. A line along the axis
 * (the axis itself, an optical bench) or square to it (the element plane, a screen, a focal plane),
 * where no ray from the object tip runs, is not, unless it is marked as light: an arrowhead (an
 * entity of kind vector or ray, which `toPrimitives` draws as an arrow) or an id, role or label
 * naming a ray, an extension, light, a path or a beam. The element's own axis is never read (P11
 * passes the axis). The frame places a line by its two ends; a line it cannot place (a literal end
 * or a `direction`) is across the axis only when its world direction is square to the axis's.
 */
function opticsLineShowsLight(
  line: OpticsConstruction,
  axis: unknown,
  entities: ReadonlyMap<string, SceneDocument["entities"][number]>,
  frame: { point(id: unknown): OpticsFramePoint | null; tolerance: number },
  document: SceneDocument,
): boolean {
  if (typeof axis === "string" && line.outputs.includes(axis)) return false;
  const marked = line.outputs.some((output) => {
    const entity = entities.get(output);
    return entity?.kind === "vector" || entity?.kind === "ray" ||
      /ray|extension|light|path|beam/i.test(`${output} ${entity?.role ?? ""} ${entity?.label ?? ""}`);
  });
  if (marked) return true;
  const start = frame.point(opticsFirst(line.inputs, OPTICS_LINE_START_KEYS));
  const end = frame.point(opticsFirst(line.inputs, OPTICS_END_KEYS));
  if (start && end) {
    const along = Math.abs(start.y) <= frame.tolerance && Math.abs(end.y) <= frame.tolerance;
    return !along && !(Math.abs(start.a - end.a) <= frame.tolerance);
  }
  const direction = opticsPathDirection(line, document, 0);
  const axisDirection = opticsAxisDirection(axis, document);
  return !(Math.abs(direction.x * axisDirection.x + direction.y * axisDirection.y) <=
    1e-9 * Math.hypot(direction.x, direction.y) * Math.hypot(axisDirection.x, axisDirection.y));
}

/**
 * A vector whose `direction` input the compiler draws instead of its end (start plus the unit
 * direction times the start to end span, or times `length`). A ray or line with an end ignores a
 * direction, and a segment has none.
 */
function opticsRedirected(path: OpticsConstruction): boolean {
  return path.operator === "vector" && path.inputs.direction !== undefined;
}

/** One straight piece of a drawn path, with the operator whose extent and direction it has. */
interface OpticsPathPiece { operator: string; start: unknown; end: unknown }

/**
 * How the compiler inks a path: with an arrowhead for a vector or ray operator, or any path whose
 * entity kind is vector or ray (toPrimitives draws those as arrows), and dashed when the entity's
 * provenance says `dashed`, as the presentation reads it.
 */
interface OpticsPathInk { arrow: boolean; dashed: boolean }

/** The points a drawn path runs through, as the compiler reads them: a polyline's points, else its two ends. */
function opticsPathVertices(path: OpticsConstruction, document: SceneDocument): unknown[] | null {
  if (path.operator !== "polyline") return opticsDerivedReferences(path, document);
  const points = opticsFirst(path.inputs, ["points", "vertices"]);
  return Array.isArray(points) && points.length >= 2 ? points : null;
}

interface OpticsFramePoint { a: number; y: number }
interface OpticsFrameLine { at: OpticsFramePoint; along: OpticsFramePoint }

/**
 * Points in the element's own frame, in world units: `a` along the gaussian_image axis from its
 * centre, `y` along the engine's normal. The anchors sit where the engine places them (object base
 * and tip at u and (u, h), image at v and (v, m h), a mirror focus at f, lens foci at -f and f, all
 * times displayScale; the axis is y = 0). Every other point is evaluated through the parameter-free
 * operators P7 admits; each is equivariant under the frame's isometry, so a point is on the element
 * plane in the frame exactly when it is in the world. A literal or unreadable point is null.
 */
function opticsFrame(
  image: OpticsConstruction,
  foci: readonly OpticsConstruction[],
  element: "lens" | "mirror",
  resolved: { focalLength: number; objectDistance?: number; objectHeight?: number },
  displayScale: number,
  document: SceneDocument,
  producer: ReadonlyMap<string, OpticsConstruction>,
): { point(id: unknown): OpticsFramePoint | null; tolerance: number } {
  const s = displayScale;
  const u = resolved.objectDistance ?? Number.NaN;
  const f = resolved.focalLength;
  const h = resolved.objectHeight ?? Number.NaN;
  const v = element === "lens" ? f * u / (u + f) : f * u / (u - f);
  const m = element === "lens" ? v / u : -v / u;
  const points = new Map<string, OpticsFramePoint | null>();
  const lines = new Map<string, OpticsFrameLine | null>();
  const [objectBase, objectTip, imageBase, imageTip] = image.outputs;
  for (const [id, a, y] of [[objectBase, u, 0], [objectTip, u, h], [imageBase, v, 0], [imageTip, v, m * h]] as const) {
    if (id) points.set(id, Number.isFinite(a * s) && Number.isFinite(y * s) ? { a: a * s, y: y * s } : null);
  }
  for (const focus of foci) {
    const distances = element === "lens" ? [-f, f] : [f];
    focus.outputs.forEach((id, index) => {
      const distance = distances[index];
      if (distance !== undefined && !points.has(id)) points.set(id, { a: distance * s, y: 0 });
    });
  }
  if (typeof image.inputs.center === "string") points.set(image.inputs.center, { a: 0, y: 0 });
  if (typeof image.inputs.axis === "string") lines.set(image.inputs.axis, { at: { a: 0, y: 0 }, along: { a: 1, y: 0 } });
  const scale = Math.max(1, ...[u, v, f, h, m * h].map((value) => Math.abs(value * s)).filter(Number.isFinite));
  const tolerance = 1e-6 * scale;
  const cross = (p: OpticsFramePoint, q: OpticsFramePoint) => p.a * q.y - p.y * q.a;
  const foot = (p: OpticsFramePoint, line: OpticsFrameLine): OpticsFramePoint => {
    const t = ((p.a - line.at.a) * line.along.a + (p.y - line.at.y) * line.along.y) /
      (line.along.a ** 2 + line.along.y ** 2);
    return { a: line.at.a + t * line.along.a, y: line.at.y + t * line.along.y };
  };
  const point = (id: unknown, depth = 0): OpticsFramePoint | null => {
    if (typeof id !== "string" || depth > 32) return null;
    if (points.has(id)) return points.get(id)!;
    points.set(id, null);
    const construction = producer.get(id);
    const references = construction && construction.outputs.length === 1 ? opticsDerivedReferences(construction, document) : null;
    let result: OpticsFramePoint | null = null;
    if (construction && references) {
      const at = (index: number) => point(references[index], depth + 1);
      const along = (index: number) => line(references[index], depth + 1);
      if (construction.operator === "project") {
        const p = at(0); const target = along(1);
        result = p && target ? foot(p, target) : null;
      } else if (construction.operator === "intersection") {
        const first = along(0); const second = along(1);
        const denominator = first && second ? cross(first.along, second.along) : 0;
        if (first && second && Math.abs(denominator) > 1e-12 * Math.hypot(first.along.a, first.along.y) * Math.hypot(second.along.a, second.along.y)) {
          const t = cross({ a: second.at.a - first.at.a, y: second.at.y - first.at.y }, second.along) / denominator;
          result = { a: first.at.a + t * first.along.a, y: first.at.y + t * first.along.y };
        }
      } else if (construction.operator === "midpoint") {
        const p = at(0); const q = at(1);
        result = p && q ? { a: (p.a + q.a) / 2, y: (p.y + q.y) / 2 } : null;
      } else if (construction.operator === "reflect_point") {
        const p = at(0); const mirrorLine = along(1);
        const base = p && mirrorLine ? foot(p, mirrorLine) : null;
        result = p && base ? { a: 2 * base.a - p.a, y: 2 * base.y - p.y } : null;
      } else if (construction.operator === "rotate") {
        // opticsDerivedReferences admits only a half-turn.
        const p = at(0); const c = at(1);
        result = p && c ? { a: 2 * c.a - p.a, y: 2 * c.y - p.y } : null;
      }
    }
    points.set(id, result);
    return result;
  };
  const line = (id: unknown, depth = 0): OpticsFrameLine | null => {
    if (typeof id !== "string" || depth > 32) return null;
    if (lines.has(id)) return lines.get(id)!;
    lines.set(id, null);
    const construction = producer.get(id);
    const references = construction && construction.outputs.length === 1 ? opticsDerivedReferences(construction, document) : null;
    let result: OpticsFrameLine | null = null;
    if (construction && references) {
      const through = point(references[0], depth + 1);
      if (construction.operator === "perpendicular_through" || construction.operator === "parallel_through") {
        const reference = line(references[1], depth + 1);
        result = through && reference ? {
          at: through,
          along: construction.operator === "parallel_through" ? reference.along : { a: -reference.along.y, y: reference.along.a },
        } : null;
      } else if (OPTICS_PATH_OPERATORS.has(construction.operator)) {
        const end = point(references[1], depth + 1);
        result = through && end && Math.hypot(end.a - through.a, end.y - through.y) > tolerance
          ? { at: through, along: { a: end.a - through.a, y: end.y - through.y } } : null;
      }
    }
    lines.set(id, result);
    return result;
  };
  return { point: (id) => point(id), tolerance };
}

/**
 * How far from the axis a lens_section or spherical_surface is drawn, in world units. The engine's
 * surfaces stop a curved face at 0.95 |R| even when halfHeight asks for more (opticsSurfaces); a face
 * flatter than OPTICS_PLANO_RATIO half heights is drawn flat to halfHeight. A mirror with no radius is
 * drawn at |R| = 2.8 halfHeight, which never clips.
 */
function opticsDrawnHalfHeight(surface: OpticsConstruction, document: SceneDocument): number {
  const halfHeight = opticsNumber(opticsFirst(surface.inputs, ["halfHeight", "aperture"]), document);
  if (!(halfHeight > 0)) return Number.NaN;
  const face = (radius: number) => !Number.isFinite(radius) || Math.abs(radius) > OPTICS_PLANO_RATIO * halfHeight
    ? halfHeight : Math.min(halfHeight, 0.95 * Math.abs(radius));
  if (surface.operator === "lens_section") {
    return Math.min(
      face(opticsNumber(opticsFirst(surface.inputs, ["radius1", "R1", "signedRadius1"]), document)),
      face(opticsNumber(opticsFirst(surface.inputs, ["radius2", "R2", "signedRadius2"]), document)),
    );
  }
  const radius = opticsFirst(surface.inputs, ["signedRadius", "radius"]);
  return radius === undefined ? halfHeight : face(opticsNumber(radius, document));
}

const OPTICS_DEFAULT_TRACED_RAYS = ["parallel", "central"] as const;

/**
 * P10. A `principal_rays` ray meets the element plane at height h (parallel), h' = m h (focal) or 0
 * (central), in physical units times the display scale. Each drawn lens_section or
 * spherical_surface must reach that height as drawn (`opticsDrawnHalfHeight`: a
 * curved face stops at 0.95 |R|), or the ray would bend in mid air.
 */
function opticsTracedHitFailure(
  traced: readonly OpticsConstruction[],
  element: "lens" | "mirror",
  resolved: { focalLength: number; objectDistance?: number; objectHeight?: number },
  displayScale: number,
  surfaces: readonly OpticsConstruction[],
  document: SceneDocument,
): string | null {
  if (traced.length === 0) return null;
  const u = resolved.objectDistance ?? Number.NaN;
  const f = resolved.focalLength;
  const h = resolved.objectHeight ?? Number.NaN;
  const v = element === "lens" ? f * u / (u + f) : f * u / (u - f);
  const imageHeight = (element === "lens" ? v / u : -v / u) * h;
  if (![u, f, h, v, imageHeight, displayScale].every(Number.isFinite)) return "principal_rays hit heights are not computable";
  for (const construction of traced) {
    const rays = Array.isArray(construction.inputs.rays) ? construction.inputs.rays : OPTICS_DEFAULT_TRACED_RAYS;
    for (const ray of rays) {
      const height = ray === "parallel" ? Math.abs(h) : ray === "focal" ? Math.abs(imageHeight) : ray === "central" ? 0 : Number.NaN;
      if (!Number.isFinite(height)) return `principal_rays ${construction.id} names an unknown ray ${String(ray)}`;
      for (const surface of surfaces) {
        const reach = opticsDrawnHalfHeight(surface, document);
        const needed = height * Math.abs(displayScale);
        if (!(needed <= reach * (1 + 1e-9))) {
          return `principal_rays ${construction.id} ${String(ray)} ray hits at ${opticsCompact(needed)} beyond the ${surface.operator} ${surface.id} drawn half height ${opticsCompact(reach)}`;
        }
      }
    }
  }
  return null;
}

/**
 * P9. By the thin-element imaging property every ray from the object tip that
 * meets the element at a point S leaves S on a line through the image tip. So a
 * line converging on the image tip is a real ray (or the back-extension of one)
 * when it starts at an on-element point S and a drawn incident ray runs from the
 * object tip to S. None of the engine's own landmarks lie on the element: the
 * gaussian_image anchors sit at u and v and the optical_focus points at f along
 * the axis, all nonzero. The on-element points are those the document derives,
 * by any parameter-free operator, on the element plane (the perpendicular to the
 * axis through the centre) within the element as drawn: `onElement`, evaluated
 * in the element frame (`opticsFrame`, `opticsDrawnHalfHeight`).
 *
 * The one exception is the lens chief ray: a straight path from the object tip
 * through the optical centre. On a lens the engine's object tip, centre and image
 * tip are collinear (m = v/u), so a path from the object tip to the image tip or
 * to the centre lies on that ray; it is accepted when its drawn extent contains
 * both the centre and the image tip.
 */
function opticsConvergingPathFailure(
  id: string,
  path: OpticsConstruction,
  image: OpticsConstruction,
  lensImage: { u: number; v: number } | null,
  document: SceneDocument,
  onElement: (point: unknown) => boolean,
): string | null {
  const [objectBase, objectTip] = image.outputs;
  const center = image.inputs.center;
  const undirected = path.operator === "segment" || path.operator === "line";
  const startOf = (construction: OpticsConstruction) => opticsFirst(construction.inputs,
    construction.operator === "segment" ? OPTICS_START_KEYS : OPTICS_LINE_START_KEYS);
  const start = startOf(path);
  const end = opticsFirst(path.inputs, OPTICS_END_KEYS);
  if (lensImage && (start === objectTip || (undirected && end === objectTip))) {
    const through = start === objectTip ? end : start;
    const { u, v } = lensImage;
    // Axial coordinates: the object at u < 0, the centre at 0, the image at v.
    const to = through === image.outputs[3] ? v : sameOpticsInput(through, center) ? 0 : Number.NaN;
    if (Number.isFinite(to)) {
      const covers = (x: number) => path.operator === "line" ? true
        : path.operator === "ray" ? (to - u) * (x - u) >= 0
          : (x - u) * (x - to) <= 1e-9 * Math.max(1, Math.abs(u), Math.abs(to));
      if (covers(0) && covers(v)) return null;
      return `chief ray ${id} does not run from the object tip through the optical centre to the image tip`;
    }
  }
  const hit = onElement(start) ? start : undirected && onElement(end) ? end : undefined;
  if (hit === undefined) {
    const from = start === objectBase ? " (it starts at the object base)" : "";
    return `converging line ${id} does not leave the ${image.inputs.kind === "lens" ? "lens" : "mirror"}${from}`;
  }
  const incident = document.constructions.some((construction) => {
    if (construction === path || !OPTICS_PATH_OPERATORS.has(construction.operator)) return false;
    const from = startOf(construction);
    const to = opticsFirst(construction.inputs, OPTICS_END_KEYS);
    return (from === objectTip && to === hit) ||
      ((construction.operator === "segment" || construction.operator === "line") && from === hit && to === objectTip);
  });
  return incident ? null : `converging line ${id} has no drawn incident ray from the object tip to ${String(hit)}`;
}

/**
 * The element kind the stem states, or null when it states none. A named kind decides (convex,
 * concave, converging, diverging; a stem naming both keeps the detector's reading). For a lens, a
 * stated power or focal length decides by its sign: negative is diverging in every convention. A
 * mirror's sign depends on the convention, so a number never names a mirror's kind.
 */
function opticsStatedKind(question: string, element: "lens" | "mirror", match: OpticsStemMatch): "convex" | "concave" | null {
  const converging = element === "lens" ? /\b(?:bi)?convex\b|\bconverging\b/i : /\bconcave\b|\bconverging\b/i;
  const diverging = element === "lens" ? /\b(?:bi)?concave\b|\bdiverging\b/i : /\bconvex\b|\bdiverging\b/i;
  const namesConverging = converging.test(question);
  const namesDiverging = diverging.test(question);
  if (namesConverging && namesDiverging) return match.slots.kind === "convex" ? "convex" : "concave";
  if (namesConverging || namesDiverging) return (element === "lens") === namesConverging ? "convex" : "concave";
  if (element === "mirror") return null;
  const power = opticsStatedPowers(question)[0];
  if (power !== undefined && power !== 0) return power > 0 ? "convex" : "concave";
  const focal = match.slots.f;
  if (match.sources.f === "stem" && typeof focal === "number" && focal !== 0) return focal > 0 ? "convex" : "concave";
  return null;
}

const OPTICS_NATURE = "real|virtual|inverted|erect|upright|enlarged|magnified|diminished";
const OPTICS_NATURE_WORD = new RegExp(`\\b(?:${OPTICS_NATURE})\\b`, "gi");
/** Nature words in front of "image": "a real, magnified image", "an erect and diminished image". */
const OPTICS_NATURE_BEFORE = new RegExp(`\\b((?:(?:${OPTICS_NATURE})(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s+))+)images?\\b`, "gi");
/** Nature words after it: "the image is virtual, erect and diminished", "an image which is real", "the image isn't real". */
const OPTICS_NATURE_AFTER = new RegExp(`\\bimages?\\b(?:\\s+(?:so\\s+)?(?:formed|produced|obtained|seen|which|that))?\\s+(?:is|was|will be|appears(?: to be)?)` +
  `(?:n['’]t|\\s+(?:not|never|neither))?\\s+((?:${OPTICS_NATURE})(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)(?:${OPTICS_NATURE}))*)\\b`, "gi");
/**
 * A negation that governs what follows it: "does not form a", "cannot produce an", "no", "isn't",
 * "neither a real nor an", "no image forms". Only verbs that make an image, articles and a distance
 * may stand between, so "no parallax with the" or "not convex forms a" governs nothing.
 */
const OPTICS_NEGATED = /(?:\b(?:not|never|no|cannot|neither|nor)\b|n['’]t\b)(?:\s+(?:be|been|able|to|ever|an?|any|the|images?|\d+(?:\.\d+)?|mm|cm|m|(?:form|produce|give|cast|make|create|obtain|get|see|lie|appear)\w*))*\s+$/i;
/** A negation inside a nature match: "the image is not real", "isn't inverted". */
const OPTICS_NEGATION_WORD = /n['’]t\b|\b(?:not|never|neither)\b/i;
/** "real or virtual", "upright or inverted": the stem asks about the nature, it does not state it. */
const OPTICS_NATURE_CHOICE = new RegExp(`\\b(?:${OPTICS_NATURE})\\s+or\\s+(?:an?\\s+)?(?:${OPTICS_NATURE})\\b`, "i");
/** Where the image forms: "an image 30 cm behind the mirror", "the image forms on the other side of the lens". */
const OPTICS_IMAGE_SIDE = /\bimages?\b((?:(?!\bobjects?\b)(?:[^.;]|\.(?=\d)))*?)\b(behind|in front of|on the (?:other|opposite|far|same) side(?:\s+(?:of|as))?)\s+(it|the (?:mirror|lens|object))\b/gi;
/** A stated image distance rounded to three figures (33.3 cm for 33.33 cm) still agrees. */
const OPTICS_IMAGE_DISTANCE_TOLERANCE = 0.01;

/**
 * What the stem states about the image: nature words next to "image", and where it forms, each with
 * its distance when one is written just before the side ("an image 30 cm behind it"). Only the stem
 * is read, and only its statements (`opticsStatement`): what a question asks, or a clause after
 * "whether" or "if", is not read, and "real or virtual" names no nature in its sentence, though
 * that sentence's image distance and side are still read. A side is virtual behind a mirror (or on
 * its other side) and real in front of it (or on the object's side); across a lens it is real and on
 * the object's side virtual. "Behind" or "in front of" a lens names no side for certain (null), though a
 * distance there is still the image's. "Behind the object" is not read at all. A negated phrase or
 * side ("does not form a real image", "the image is not formed behind the mirror") states nothing:
 * it is kept apart as a nature the image must not have in full (`denied`), and a negated side with a
 * distance ("not 30 cm behind it") denies nothing.
 */
function opticsStemImage(question: string, element: "lens" | "mirror"): {
  words: Set<string>;
  sides: Array<{ virtual: boolean | null; cm: number | null; text: string }>;
  denied: string[][];
} {
  const words = new Set<string>();
  const sides: Array<{ virtual: boolean | null; cm: number | null; text: string }> = [];
  const denied: string[][] = [];
  for (const sentence of question.split(/(?<=[.!?])\s+/)) {
    const statement = opticsStatement(sentence);
    // A choice of nature states none in its sentence, but the image distance and side it states still hold.
    const natures = OPTICS_NATURE_CHOICE.test(statement) ? []
      : [...statement.matchAll(OPTICS_NATURE_BEFORE), ...statement.matchAll(OPTICS_NATURE_AFTER)];
    for (const found of natures) {
      const named = (found[1]!.match(OPTICS_NATURE_WORD) ?? []).map((word) => word.toLowerCase());
      if (OPTICS_NEGATED.test(statement.slice(0, found.index)) || OPTICS_NEGATION_WORD.test(found[0])) denied.push(named);
      else for (const word of named) words.add(word);
    }
    for (const found of statement.matchAll(OPTICS_IMAGE_SIDE)) {
      const where = found[2]!.toLowerCase();
      // "Behind the object" or "in front of" it is a place against the object, not a side of the
      // element, and its distance is not the image distance; only "the same side as the object" is.
      if (/object/i.test(found[3]!) && !/same/.test(where)) continue;
      const virtual = element === "mirror" ? /behind|other|opposite|far/.test(where) : /same/.test(where);
      const real = element === "mirror" ? /in front|same/.test(where) : /other|opposite|far/.test(where);
      const distance = /(\d+(?:\.\d+)?)\s*(mm|cm|m)\s*$/i.exec(found[1]!);
      // The stem's words up to the side: "image does not form ", "image 30 cm ".
      const lead = found[0].slice(0, /^images?/i.exec(found[0])![0].length + found[1]!.length);
      if (OPTICS_NEGATED.test(statement.slice(0, found.index) + lead)) {
        if (virtual !== real && !distance) denied.push([virtual ? "virtual" : "real"]);
        continue;
      }
      if (virtual === real && !distance) continue;
      // The stem's own words from the side on: "behind it", "on the other side of the lens".
      const place = found[0].slice(lead.length);
      sides.push({
        virtual: virtual === real ? null : virtual,
        cm: distance ? Number(distance[1]) * OPTICS_CM_PER_UNIT[distance[2]!.toLowerCase()]! : null,
        text: distance ? `image ${distance[1]} ${distance[2]} ${place}` : `image ${place}`,
      });
    }
  }
  return { words, sides, denied };
}

/** Question words that ask wherever they stand: "...; where does the image form?", "find how far". */
const OPTICS_QUESTION_WORD = /\b(?:where|what|how|why)\b/i;
/** A clause that opens with an auxiliary or a question word asks: "; is the image real?", ", and which is it?". */
const OPTICS_QUESTION_CLAUSE = /(?:^|[;,]|\band\b)\s*(?:and\s+)?(?:which|who|whose|whom|when|does|do|did|is|are|was|were|will|would|can|could|should|shall|has|have|had|may|might|must)\b/i;
/** Where one clause ends and the next begins. */
const OPTICS_CLAUSE_BREAK = /[;,]|\band\b/gi;

/**
 * The part of a sentence that states facts. A question still states the clauses before the part
 * that asks ("forms a real image of an object placed at 15 cm; where does the image form?"): it asks
 * from its first question word or from a clause an auxiliary opens, else from its last clause, so a
 * question of one clause states nothing. A clause after "whether" or "if" asks about the image too.
 */
function opticsStatement(sentence: string): string {
  let statement = sentence;
  if (sentence.trim().endsWith("?")) {
    const asks = [OPTICS_QUESTION_WORD.exec(sentence)?.index, OPTICS_QUESTION_CLAUSE.exec(sentence)?.index]
      .filter((index): index is number => index !== undefined);
    const breaks = [...sentence.matchAll(OPTICS_CLAUSE_BREAK)].map((found) => found.index);
    statement = sentence.slice(0, asks.length > 0 ? Math.min(...asks) : breaks.at(-1) ?? 0);
  }
  return statement.split(/\b(?:whether|if)\b/i)[0]!;
}

/**
 * The nature of the image the stem states, for a real object (`opticsStemImage`): real when it says
 * real or inverted, virtual when it says virtual, erect or upright, and the side the stem puts the
 * image on is its nature too. It is larger when enlarged or magnified and smaller when diminished,
 * and a virtual image distance against the stem's object distance gives its size. Real with virtual,
 * or enlarged with diminished, states neither.
 */
function opticsStemNature(question: string, element: "lens" | "mirror", match: OpticsStemMatch): {
  real: boolean; virtual: boolean; larger: boolean; smaller: boolean;
} {
  const { words, sides } = opticsStemImage(question, element);
  const real = words.has("real") || words.has("inverted") || sides.some((side) => side.virtual === false);
  const virtual = words.has("virtual") || words.has("erect") || words.has("upright") || sides.some((side) => side.virtual === true);
  const u = match.sources.u === "stem" && typeof match.slots.u === "number" ? Math.abs(match.slots.u) : null;
  const sized = sides.filter((side) => side.virtual === true && side.cm !== null && u !== null);
  const larger = words.has("enlarged") || words.has("magnified") || sized.some((side) => side.cm! > u!);
  const smaller = words.has("diminished") || sized.some((side) => side.cm! < u!);
  return { real: real && !virtual, virtual: virtual && !real, larger: larger && !smaller, smaller: smaller && !larger };
}

/**
 * The element kind the image the stem describes implies, or null (`opticsStemNature`). A real image
 * needs a converging element. A virtual image is enlarged only by a converging element and
 * diminished only by a diverging one.
 */
function opticsImpliedKind(question: string, element: "lens" | "mirror", match: OpticsStemMatch): "convex" | "concave" | null {
  const nature = opticsStemNature(question, element, match);
  if (!nature.real && !nature.virtual) return null;
  const converging = element === "lens" ? "convex" : "concave";
  if (nature.real) return converging;
  if (!nature.larger && !nature.smaller) return null;
  return nature.larger ? converging : element === "lens" ? "concave" : "convex";
}

const OPTICS_POWER = /(^|[^\w.])([+\-−–]?)\s*(\d+(?:\.\d+)?)\s*(?:D|[Dd]ioptres?|[Dd]iopters?)\b/g;
/** 1/P rounded to three figures (|f| = 33.3 cm for 3 D) still agrees; 1 percent, like the engine's own focal agreement. */
const OPTICS_POWER_TOLERANCE = 0.01;

/**
 * Every lens power the stem states in dioptres, signed, in order. An unsigned power is positive.
 * A bare "2D" or "3D" names a dimension, not a power.
 */
function opticsStatedPowers(question: string): number[] {
  return [...question.matchAll(OPTICS_POWER)]
    .filter((match) => !/^[23]D$/.test(match[0].slice(match[1]!.length)))
    .map((match) => (match[2] === "" || match[2] === "+" ? 1 : -1) * Number(match[3]));
}

/**
 * |f| in cm from the stem's lens power (|f| = 1/|P| m), or null when the stem states no power, a zero
 * power, or two different powers (lenses in combination, whose element f the stem does not fix).
 */
function opticsStatedPowerFocal(question: string): { cm: number; text: string } | null {
  const powers = opticsStatedPowers(question);
  const power = powers[0];
  if (power === undefined || power === 0 || powers.some((other) => other !== power)) return null;
  return { cm: 100 / Math.abs(power), text: `${power > 0 ? "+" : ""}${opticsCompact(power)}` };
}

function opticsCompact(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(6))) : String(value);
}

/** P5: lens_section for a lens, spherical_surface for a mirror, never the other, never flat. */
function opticsElementFailure(
  element: "lens" | "mirror",
  stemKind: "convex" | "concave",
  image: OpticsConstruction,
  document: SceneDocument,
): string | null {
  const own = element === "lens" ? "lens_section" : "spherical_surface";
  const surfaces = document.constructions.filter((construction) =>
    construction.operator === "lens_section" || construction.operator === "spherical_surface");
  if (surfaces.length === 0) return `the ${element} is not drawn by ${own}`;
  const axisSign = element === "mirror" ? opticsAxisSign(image.inputs.axis, document) : 1;
  for (const surface of surfaces) {
    if (surface.operator !== own) return `${surface.operator} drawn on a ${element} stem`;
    const at = opticsFirst(surface.inputs, element === "lens" ? ["center", "opticalCentre", "optical_center"] : ["vertex", "pole"]);
    if (!sameOpticsInput(at, image.inputs.center) || !sameOpticsInput(surface.inputs.axis, image.inputs.axis)) {
      return `${own} ${surface.id} is not on the gaussian_image centre and axis`;
    }
    const halfHeight = opticsNumber(opticsFirst(surface.inputs, ["halfHeight", "aperture"]), document);
    if (!(halfHeight > 0)) return `${own} ${surface.id} has no positive halfHeight`;
    const curvature = (radius: number) => Math.abs(radius) > OPTICS_PLANO_RATIO * halfHeight ? 0 : 1 / radius;
    if (element === "lens") {
      // The engine draws in a +x frame: radius1 > 0 and radius2 < 0 bulge outward.
      const power = curvature(opticsNumber(opticsFirst(surface.inputs, ["radius1", "R1", "signedRadius1"]), document)) -
        curvature(opticsNumber(opticsFirst(surface.inputs, ["radius2", "R2", "signedRadius2"]), document));
      if (!Number.isFinite(power) || Math.sign(power) !== (stemKind === "convex" ? 1 : -1)) {
        return `lens_section ${surface.id} is not drawn ${stemKind}`;
      }
      continue;
    }
    // A centre-of-curvature point overrides the radius; its sense is not provable here.
    if (surface.inputs.center !== undefined) return `spherical_surface ${surface.id} must give signedRadius, not a centre point`;
    if (axisSign === null) return "the principal axis direction is not readable from the document";
    const radiusInput = opticsFirst(surface.inputs, ["signedRadius", "radius"]);
    const kind = typeof surface.inputs.kind === "string" ? surface.inputs.kind.toLowerCase() : undefined;
    const radius = radiusInput === undefined
      ? (kind === "plano" ? Number.POSITIVE_INFINITY : kind === "concave" ? -1 : 1)
      : opticsNumber(radiusInput, document);
    if (!Number.isFinite(radius) || curvature(radius) === 0) return `spherical_surface ${surface.id} is drawn flat`;
    // The surface frame always points along +x; the object sits on the -axis side.
    // Concave: the centre of curvature is on the object side.
    const objectSide = -axisSign;
    if ((Math.sign(radius) === objectSide) !== (stemKind === "concave")) {
      return `spherical_surface ${surface.id} is not drawn ${stemKind}`;
    }
  }
  return null;
}

/** +1 when the principal axis runs toward +x in the engine's surface frame, -1 when it runs toward -x. */
function opticsAxisSign(axis: unknown, document: SceneDocument): 1 | -1 | null {
  const dx = opticsAxisDirection(axis, document).x;
  if (!Number.isFinite(dx)) return null;
  return dx < 0 ? -1 : 1;
}

/** World direction (NaN when unread) of a principal axis: its line's, or one written inline. */
function opticsAxisDirection(axis: unknown, document: SceneDocument): { x: number; y: number } {
  if (typeof axis !== "string") return opticsDirection(axis, document, 0);
  const line = document.constructions.find((construction) => construction.outputs.includes(axis));
  return line && line.operator === "line" ? opticsPathDirection(line, document, 0) : { x: Number.NaN, y: Number.NaN };
}

/** World direction of a path the way the engine reads it: end minus start, else its `direction` or `vector`. */
function opticsPathDirection(path: OpticsConstruction, document: SceneDocument, depth: number): { x: number; y: number } {
  if (opticsFirst(path.inputs, OPTICS_END_KEYS) !== undefined) {
    const start = opticsLiteralPoint(opticsFirst(path.inputs, OPTICS_LINE_START_KEYS), document);
    const end = opticsLiteralPoint(opticsFirst(path.inputs, OPTICS_END_KEYS), document);
    return start && end ? { x: end.x - start.x, y: end.y - start.y } : { x: Number.NaN, y: Number.NaN };
  }
  return opticsDirection(opticsFirst(path.inputs, ["direction", "vector"]), document, depth + 1);
}

/** A direction input: [dx, dy], {x, y}, or the id of a drawn path. */
function opticsDirection(value: unknown, document: SceneDocument, depth: number): { x: number; y: number } {
  const unread = { x: Number.NaN, y: Number.NaN };
  if (depth > 8) return unread;
  if (Array.isArray(value) && value.length === 2) return { x: opticsNumber(value[0], document), y: opticsNumber(value[1], document) };
  if (isRecord(value) && "x" in value) return { x: opticsNumber(value.x, document), y: opticsNumber(value.y, document) };
  if (typeof value !== "string") return unread;
  const path = document.constructions.find((construction) => construction.outputs.includes(value));
  return path && OPTICS_PATH_OPERATORS.has(path.operator) ? opticsPathDirection(path, document, depth) : unread;
}

function opticsLiteralPoint(id: unknown, document: SceneDocument): { x: number; y: number } | null {
  if (typeof id !== "string") return null;
  const construction = document.constructions.find((candidate) => candidate.outputs.includes(id));
  if (!construction || construction.operator !== "point") return null;
  const x = opticsNumber(construction.inputs.x, document);
  const y = opticsNumber(construction.inputs.y, document);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** The geometric references a derived construction reads, or null when it is not parameter-free. */
function opticsDerivedReferences(construction: OpticsConstruction, document: SceneDocument): unknown[] | null {
  const groups = OPTICS_DERIVED_INPUTS[construction.operator];
  if (!groups) return null;
  if (construction.operator === "rotate") {
    // Only a half-turn (C from P through F, 2F from O through F) is free of an authored angle.
    const value = opticsNumber(construction.inputs.angle, document);
    const radians = construction.inputs.angleUnit === "degrees" || Math.abs(value) > 2 * Math.PI ? value * Math.PI / 180 : value;
    if (!(Math.abs(Math.cos(radians) + 1) < 1e-9)) return null;
  }
  return groups.map((keys) => opticsFirst(construction.inputs, keys));
}

function opticsFirst(inputs: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) if (inputs[key] !== undefined) return inputs[key];
  return undefined;
}

function opticsNumber(value: unknown, document: SceneDocument, depth = 0): number {
  if (depth > 32) return Number.NaN;
  if (typeof value === "number") return value;
  if (isRecord(value) && "value" in value) return opticsNumber(value.value, document, depth + 1);
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  const quantity = document.quantities.find((item) => item.id === value);
  return quantity ? opticsNumber(quantity.value, document, depth + 1) : Number(value);
}

/** The engine's Cartesian reading of optics inputs, or the reason it refuses them. */
function opticsResolved(
  inputs: Record<string, unknown>,
  document: SceneDocument,
  operator: "gaussian_image" | "optical_focus",
): ReturnType<typeof resolveCartesianOpticsInputs> | string {
  try {
    return resolveCartesianOpticsInputs(inputs, (value) => opticsNumber(value, document), operator);
  } catch (error) {
    return error instanceof Error ? error.message : "inputs are not readable";
  }
}

/** One key per length scale: metric units by their cm factor, unitless spellings as "unit". */
function opticsUnitKey(value: unknown): string | null {
  if (value === undefined) return "unit";
  if (typeof value !== "string") return null;
  const scale = opticsCmPerUnit(value);
  if (scale !== null) return `cm*${scale}`;
  const unit = value.trim().toLowerCase();
  return ["unit", "units", "1", "dimensionless"].includes(unit) ? "unit" : unit;
}

function opticsCmPerUnit(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const unit = value.trim().replace(/[A-Za-z]{4,}/g, (word) => word.toLowerCase());
  return OPTICS_CM_PER_UNIT[unit] ?? null;
}

function opticsClose(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Number.isFinite(expected) &&
    Math.abs(actual - expected) <= 1e-6 * Math.max(Math.abs(actual), Math.abs(expected));
}

function sameOpticsInput(a: unknown, b: unknown): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
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
