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
  const complete = prepareFallbackFunctionInventory(input.question, result);
  if (!complete) return null;
  return {
    tier: complete.tier,
    nonMetric: complete.nonMetric,
    sceneDocument: complete.document,
    renderScene: complete.renderScene,
    validationReport: complete.validationReport,
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
  const unprovenPlannerScene = input.exact && currentCompile?.renderScene &&
    tierForForeignDocument(input.exact.sceneDocument).tier !== "exact_verified";
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
  const sourceFigure = prepareFallbackFunctionInventory(input.question, circular?.status === "drawn" ? circular.scene
    : unprovenMensuration || unprovenPlannerScene || relativeMotion ? synthesize() : null);
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

  const synthesized = sourceFigure ?? prepareFallbackFunctionInventory(input.question, synthesize());
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
    const lastResort = prepareFallbackFunctionInventory(input.question, synthesizeLastResortScene({
      question: input.question,
      turnPlan: input.turnPlan,
      families,
      problemIR: input.problemIR ?? null,
    }), true);
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
  if (usesPlannerOpticsOnArchetypeStem(expectedQuestion, candidate.sceneDocument)) {
    return reject("planner_optics_on_archetype_stem", "planner optics was drawn for a stem the optics archetype owns");
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

function extractExplicitFunctionFacts(question: string, nativeInventory = false): SourceFunctionFact[] {
  const normalized = normalizeMathText(question);
  const unquotedPositions = unquotedFunctionSourcePositions(normalized);
  const facts: SourceFunctionFact[] = [];
  const ownedEqualities = new Set<number>();
  const ownedExpressionEnds = new Set<number>();
  const declaredNames = new Set<string>();
  let previousEquationEnd = -1;
  const equations = nativeInventory ? /(?<![\p{L}\p{N}_])(?:y|([\p{L}][\p{L}\p{N}_]*)\s*\(\s*x\s*\))\s*=\s*/giu : /\by\s*=\s*/gi;
  for (const match of normalized.matchAll(equations)) {
    const lhs = match.index!;
    if (!unquotedPositions[lhs]) continue;
    if (match[1] && FUNCTION_EXPRESSION_IDENTIFIERS.has(match[1].toLowerCase())) return [];
    const boundary = hasStandaloneFunctionLhs(normalized, lhs, previousEquationEnd);
    if (!boundary) return [];
    const start = lhs + match[0].length;
    const read = readCompleteSupportedExpression(normalized.slice(start), boundary, nativeInventory);
    if (!read) return [];
    const expression = nativeInventory ? normalizeNativeFunctionBody(read.expression) : normalizeExpression(read.expression);
    if (!expression) return [];
    ownedEqualities.add(lhs + match[0].indexOf("="));
    previousEquationEnd = start + read.end;
    ownedExpressionEnds.add(previousEquationEnd);
    if (match[1]) declaredNames.add(match[1]);
    if (!facts.some(fact => fact.expression === expression)) facts.push({ expression, sourceText: `y=${read.expression}` });
    if (facts.length > 4) return [];
  }
  // Every unquoted equality is accounted for. A rejected/later/implicit
  // Cartesian equation cannot leave the other curves as a partial figure.
  for (const match of normalized.matchAll(/=/g)) {
    const index = match.index!;
    if (!unquotedPositions[index] || ownedEqualities.has(index) || /[<>!]/.test(normalized[index - 1] ?? "")) continue;
    if (!isAuxiliaryFunctionEquation(normalized, index, facts, ownedExpressionEnds) &&
        !(nativeInventory && isNativeScalarFunctionEquation(normalized, index, declaredNames))) return [];
  }
  return facts;
}

/** Source-inventory admission for independently validated native syntheses.
 * The unchanged engine owns geometry, numeric proofs and tiers. This reader
 * neither decodes display coordinates nor grants derivative/answer authority:
 * it accepts only the whole program independently re-derived from the same
 * unquoted source, with no plan, IR or family hints, and returns it unchanged. */
export function prepareFallbackFunctionInventory<T extends { document: SceneDocument; renderScene: RenderScene; validationReport: ValidationReport; tier?: string; nonMetric?: boolean; family?: string }>(question: string, candidate: T | null, lastResort = false): T | null {
  if (!candidate) return null;
  const curves = candidate.document.constructions.filter(({ operator }) => operator === "function_curve" || operator === "implicit_curve");
  if (candidate.document.source.archetype === "function_graph" && curves.length === 0) return null;
  const bareAxes = curves.length === 0 && candidate.document.constructions.length > 0 && candidate.document.constructions.every(({ operator }) => operator === "axes");
  if (curves.length === 0 && !bareAxes) return candidate;
  const normalized = normalizeMathText(question);
  const unquoted = unquotedFunctionSourcePositions(normalized);
  const explicit = Array.from(normalized.matchAll(/\by\s*=/gi));
  const named = Array.from(normalized.matchAll(/(?<![\p{L}\p{N}_])[\p{L}][\p{L}\p{N}_]*\s*\(\s*x\s*\)\s*=/giu));
  const sourceProgram = [...explicit, ...named].some(match => unquoted[match.index!]);
  const quotedProgram = [...explicit, ...named].some(match => !unquoted[match.index!]);
  if (!sourceProgram && !quotedProgram) return candidate;
  if (bareAxes) return null;
  if (sourceProgram) {
    const facts = extractExplicitFunctionFacts(question, true);
    if (facts.length === 0 || curves.length !== facts.length) return null;
    const owners = new Set<number>(), outputIds = new Set<string>();
    for (const curve of curves) {
      if (curve.outputs.length !== 1 || outputIds.has(curve.outputs[0]!)) return null;
      const id = curve.outputs[0]!; outputIds.add(id);
      const entity = candidate.document.entities.find(entity => entity.id === id);
      const owner = facts.findIndex(fact => ownsCompleteFunctionLabel(entity?.label, stripCompleteExpressionGroups(fact.expression)));
      if (owner < 0 || owners.has(owner)) return null;
      owners.add(owner);
      const labels = candidate.renderScene.primitives.filter(primitive => primitive.entityId === id && primitive.kind === "label");
      if (labels.length !== 1 || !ownsCompleteFunctionLabel(labels[0]!.text, stripCompleteExpressionGroups(facts[owner]!.expression))) return null;
    }
  }
  // A same-engine whole-program identity is a provenance check, not a new
  // numeric proof. Never adopt masked-source ink or remove candidate marks.
  const stem = normalized.split("").map((character, index) => unquoted[index] ? character : " ").join("");
  const independent = (lastResort ? synthesizeLastResortScene : synthesizeFamilyScene)({ question: stem, turnPlan: null, problemIR: null });
  if (!independent?.validationReport.valid || nativeProgramFingerprint(candidate) !== nativeProgramFingerprint(independent) ||
      JSON.stringify(candidate.renderScene) !== JSON.stringify(independent.renderScene)) return null;
  if (candidate.family !== independent.family) {
    // A contextual family name also reaches narration. It needs its own
    // source-only corroboration, after the unhinted whole program is proved.
    // This sole tag may not introduce any mark or rescue a primary mismatch.
    if (typeof candidate.family !== "string" || !candidate.family.trim()) return null;
    const corroborated = (lastResort ? synthesizeLastResortScene : synthesizeFamilyScene)({
      question: stem, turnPlan: null, problemIR: null, families: [candidate.family],
    });
    if (!corroborated?.validationReport.valid || corroborated.family !== candidate.family ||
        nativeProgramFingerprint(corroborated) !== nativeProgramFingerprint(independent) ||
        JSON.stringify(corroborated.renderScene) !== JSON.stringify(independent.renderScene)) return null;
  }
  return candidate;
}

function normalizeNativeFunctionBody(expression: string): string {
  return normalizeExpression(normalizeMathText(expression).replace(/\|([^|]+)\|/g, (_match, inner: string) => `abs(${inner})`)).replace(/(\d)\.$/, "$1");
}

function nativeProgramFingerprint(candidate: { document: SceneDocument; tier?: string; nonMetric?: boolean; family?: string }): string {
  return JSON.stringify({ document: { ...candidate.document, source: { ...candidate.document.source, question: "" } }, tier: candidate.tier, nonMetric: candidate.nonMetric });
}

function ownsCompleteFunctionLabel(label: unknown, expression: string): boolean {
  if (typeof label !== "string") return false;
  const equation = /^\s*y\s*=\s*(.+?)\s*$/i.exec(normalizeMathText(label));
  return equation !== null && stripCompleteExpressionGroups(normalizeNativeFunctionBody(equation[1]!)) === expression;
}

function stripCompleteExpressionGroups(value: string): string {
  while (value.startsWith("(") && value.endsWith(")")) {
    let depth = 0, end = 0;
    for (; end < value.length; end++) {
      if (value[end] === "(") depth++;
      if (value[end] === ")" && --depth === 0) break;
    }
    if (end !== value.length - 1) break;
    value = value.slice(1, -1);
  }
  return value;
}

const FUNCTION_EXPRESSION_IDENTIFIERS = new Set([
  "x", "pi", "e", "sin", "cos", "tan", "asin", "acos", "atan",
  "sqrt", "abs", "exp", "log", "ln",
]);
const BARE_UNARY_FUNCTION = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${Array.from(FUNCTION_EXPRESSION_IDENTIFIERS).filter(name => !["x", "pi", "e"].includes(name)).join("|")})\\s+x(?=\\s*(?:$|[+\\-]))`, "gu",
);
const FUNCTION_PRIME_SYMBOL = /^(?:[A-Za-z\u0370-\u03ff](?:[0-9\u2080-\u2089]+|_[A-Za-z0-9\u0370-\u03ff]+)?|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)$/i;
const FUNCTION_PRIME_SCALAR = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const FUNCTION_QUOTED_SCALAR = /^\s*(?:[A-Za-z\u0370-\u03ff][A-Za-z0-9_\u0370-\u03ff\u2080-\u2089]*\s*=\s*)?[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i;

function unquotedFunctionSourcePositions(source: string): Uint8Array {
  // State bits: outside=1, single-quoted=2, double-quoted=4. Each row maps
  // those three input states to possible output states for the same token.
  const transitions = [
    [1, 2, 4], // ordinary text, contraction, or the start of a prime run
    [2, 1, 4], // nonattached single quotation boundary
    [4, 2, 1], // double quotation boundary
    [1, 3, 4], // attached run: all primes, or its last mark closes a quote
    [0, 3, 4], // ordinary closer: ambiguous inside, never a prime outside
  ] as const;
  const tokens = new Uint8Array(source.length);
  let rawSingleQuote = -1;
  let rawSingleQuoteCanOpen = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (/['’]/.test(character) && /[A-Za-z\u0370-\u03ff]/.test(source[index - 1] ?? "") &&
        /[A-Za-z\u0370-\u03ff]/.test(source[index + 1] ?? "")) continue;
    if (/['’]/.test(character) && /[A-Za-z0-9_\u0370-\u03ff\u2080-\u2089)]/.test(source[index - 1] ?? "")) {
      let start = index;
      while (start > 0 && /[A-Za-z0-9_\u0370-\u03ff\u2080-\u2089]/.test(source[start - 1]!)) start -= 1;
      const token = source.slice(start, index);
      const firstMark = index;
      let scalarStart = start;
      while (scalarStart > 0 && /[0-9.eE+\-]/.test(source[scalarStart - 1]!)) scalarStart -= 1;
      const numeric = FUNCTION_PRIME_SCALAR.test(source.slice(scalarStart, index)) &&
        !/[A-Za-z0-9_\u0370-\u03ff\u2080-\u2089]/.test(source[scalarStart - 1] ?? "");
      // Consecutive raw quote spans are disjoint. A quoted scalar/equality
      // can close a quote without making a bare measurement mark invalid.
      const literalScalar = numeric && rawSingleQuoteCanOpen &&
        FUNCTION_QUOTED_SCALAR.test(source.slice(rawSingleQuote + 1, firstMark));
      while (/['’]/.test(source[index + 1] ?? "")) index += 1;
      let following = index + 1;
      while (/\s/.test(source[following] ?? "") && following < source.length) following += 1;
      const literalWord = /^[A-Za-z]{2,}$/.test(token) && /['‘’]/.test(source[start - 1] ?? "");
      const symbol = FUNCTION_PRIME_SYMBOL.test(token) || FUNCTION_EXPRESSION_IDENTIFIERS.has(token.toLowerCase());
      const application = /^[A-Za-z_\u0370-\u03ff]/.test(token) && source[following] === "(" &&
        (following === index + 1 || !literalWord);
      // A possible plural possessive retains its open-quote path, even
      // before punctuation. A directly quoted ordinary word need not be a
      // valid outside possessive/prime to preserve that same inside path.
      const possessive = /s$/i.test(token) && !literalWord;
      tokens[index] = source[start - 1] === ")" || symbol || application || possessive || (numeric && !literalScalar) ? 3 : 4;
      rawSingleQuote = index;
      rawSingleQuoteCanOpen = false;
      continue;
    }
    if (/['‘’]/.test(character)) {
      tokens[index] = 1;
      rawSingleQuote = index;
      rawSingleQuoteCanOpen = true;
    }
    else if (/["“”]/.test(character)) tokens[index] = 2;
  }
  const forward = new Uint8Array(source.length + 1);
  const backward = new Uint8Array(source.length + 1);
  forward[0] = 1;
  backward[source.length] = 1;
  for (let index = 0; index < source.length; index += 1) {
    const transition = transitions[tokens[index]!]!;
    for (let state = 0; state < 3; state += 1) {
      if (forward[index]! & (1 << state)) forward[index + 1]! |= transition[state]!;
    }
  }
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const transition = transitions[tokens[index]!]!;
    for (let state = 0; state < 3; state += 1) {
      if (transition[state]! & backward[index + 1]!) backward[index]! |= 1 << state;
    }
  }
  const unquoted = new Uint8Array(source.length + 1);
  for (let index = 0; index <= source.length; index += 1) {
    // No balanced interpretation, or any viable quoted interpretation,
    // withholds source ownership at this position.
    unquoted[index] = (forward[index]! & backward[index]!) === 1 ? 1 : 0;
  }
  return unquoted;
}

function isSourceFunctionProseEndpoint(source: string, index: number): boolean {
  const identifier = /^[\p{L}\p{N}_]+/u.exec(source.slice(index))?.[0];
  const suffix = identifier === undefined ? "" : source.slice(index + identifier.length);
  let afterIdentifier = suffix.trimStart();
  const separatedWrapper = afterIdentifier.length < suffix.length;
  while (afterIdentifier.startsWith("(") || afterIdentifier.startsWith("\\(") || afterIdentifier.startsWith("$")) {
    afterIdentifier = afterIdentifier.slice(afterIdentifier.startsWith("\\(") ? 2 : 1).trimStart();
  }
  const nextEquationWrapper = separatedWrapper && /^y\s*=/i.test(afterIdentifier);
  return identifier !== undefined && index > 0 && /\s/.test(source[index - 1]!) && /^[\p{L}]{2,}$/u.test(identifier) &&
    !/\p{Script=Greek}/u.test(identifier) && !FUNCTION_PRIME_SYMBOL.test(identifier) &&
    !FUNCTION_EXPRESSION_IDENTIFIERS.has(identifier.toLowerCase()) && (!suffix.trimStart().startsWith("(") || nextEquationWrapper);
}

/** Prove only lexical separation from the complete mathematical LHS. */
function hasStandaloneFunctionLhs(source: string, index: number, previousEquationEnd: number): string[] | null {
  const rawPrefix = source.slice(0, index);
  if (previousEquationEnd >= 0 && /^\s*(?:,|and)?\s*$/i.test(rawPrefix.slice(previousEquationEnd))) return [];
  let prefix = rawPrefix.trimEnd();
  const closers: string[] = [];
  while (true) {
    if (prefix.endsWith("\\(") || prefix.endsWith("(")) {
      const latex = prefix.endsWith("\\("), before = prefix.slice(0, latex ? -2 : -1);
      if (/[\p{L}\p{N}_\])}]$/u.test(before)) return null;
      closers.push(latex ? "\\)" : ")"); prefix = before.trimEnd();
    }
    else if (prefix.endsWith("$")) { closers.push("$"); prefix = prefix.slice(0, -1).trimEnd(); }
    else break;
  }
  prefix = prefix.replace(/:$/, "").trimEnd();
  if (!prefix || /[.,;?]$/.test(prefix)) return closers;
  const token = /[\p{L}\p{N}_]+$/u.exec(prefix);
  if (!token || !/^[\p{L}]{2,}$/u.test(token[0]) || /\p{Script=Greek}/u.test(token[0]) ||
      FUNCTION_PRIME_SYMBOL.test(token[0]) || FUNCTION_EXPRESSION_IDENTIFIERS.has(token[0].toLowerCase())) return null;
  if (/[+\-*/^=([\\]$/.test(prefix.slice(0, token.index).trimEnd())) return null;
  return closers;
}

interface CompleteSourceExpression { expression: string; end: number }
function readCompleteSupportedExpression(source: string, closers: readonly string[] = [], nativeSyntax = false): CompleteSourceExpression | null {
  let index = 0, depth = 0, absoluteDepth: number | null = null;
  const complete = (end: number): CompleteSourceExpression | null => {
    const expression = source.slice(0, index).trim();
    if (!expression || depth !== 0) return null;
    try { parseMathExpression(nativeSyntax ? normalizeNativeFunctionBody(expression) : normalizeExpression(expression)); return { expression, end }; }
    catch { return null; }
  };
  while (index < source.length && index < 160) {
    const character = source[index]!;
    if (nativeSyntax && character === "|") {
      if (absoluteDepth === null) {
        if (index > 0 && !/[+\-*/^(]$/.test(source.slice(0, index).trimEnd())) return null;
        absoluteDepth = depth; depth++;
      } else {
        if (depth !== absoluteDepth + 1) return null;
        depth--; absoluteDepth = null;
      }
      index++; continue;
    }
    if (depth === 0 && (character === ")" || character === "$" || source.startsWith("\\)", index))) {
      if (!closers.length) return null;
      let end = index;
      for (const closer of closers) {
        while (/\s/.test(source[end] ?? "") && end < source.length) end++;
        if (!source.startsWith(closer, end)) return null;
        end += closer.length;
      }
      let next = end;
      while (/\s/.test(source[next] ?? "") && next < source.length) next++;
      const nextEquation = /[\r\n]/.test(source.slice(end, next)) && /^y\s*=/i.test(source.slice(next));
      const evaluation = next > end && readSourceAtEvaluation(source, next) !== null;
      if (next < source.length && !/[;,.?]/.test(source[next]!) && !nextEquation && !evaluation && !isSourceFunctionProseEndpoint(source, next)) return null;
      return complete(end);
    }
    if (/[;?]/.test(character)) return closers.length ? null : complete(index);
    if (character === ",") {
      if (/^\s*[+-]?(?:[0-9]|\.[0-9])/.test(source.slice(index + 1))) return null;
      return closers.length ? null : complete(index);
    }
    if (/[\r\n]/.test(character) && /^\s*y\s*=/i.test(source.slice(index + 1))) return closers.length ? null : complete(index);
    if (character === "." && !/[0-9]/.test(source[index + 1] ?? "")) {
      if (index === 0 || !/^(?:\s|$)/.test(source.slice(index + 1))) return null;
      return closers.length ? null : complete(index);
    }
    if (character === "(") {
      if (depth === 0 && !closers.length && index > 0 && /\s/.test(source[index - 1]!) && readSourceAtEvaluation(source, index)) return complete(index);
      depth++; index++; continue;
    }
    if (character === ")") { if (depth === 0) return null; depth--; index++; continue; }
    if (/\s/.test(character) || /[0-9.+\-*/^]/.test(character)) { index++; continue; }
    if (/[\p{L}_]/u.test(character)) {
      const identifier = /^[\p{L}\p{N}_]+/u.exec(source.slice(index))![0];
      if (!FUNCTION_EXPRESSION_IDENTIFIERS.has(identifier.toLowerCase())) {
        return isSourceFunctionProseEndpoint(source, index) && !closers.length ? complete(index) : null;
      }
      index += identifier.length;
      continue;
    }
    return null;
  }
  return index >= 160 && index < source.length || closers.length ? null : complete(index);
}

/** A function definition is owned only as an alias of a curve already drawn.
 * Complete parenthetical at-x scalars are separate evaluation slots. */
function isAuxiliaryFunctionEquation(source: string, equals: number, functions: readonly SourceFunctionFact[], ownedExpressionEnds: ReadonlySet<number>): boolean {
  const prefix = source.slice(0, equals);
  const definition = /([A-Za-z][A-Za-z0-9_]*)\s*\(\s*x\s*\)\s*$/i.exec(prefix);
  if (definition && !FUNCTION_EXPRESSION_IDENTIFIERS.has(definition[1]!.toLowerCase())) {
    const boundary = hasStandaloneFunctionLhs(source, definition.index, -1);
    if (boundary) {
      const read = readCompleteSupportedExpression(source.slice(equals + 1), boundary);
      return read !== null && functions.some(fact => fact.expression === normalizeExpression(read.expression));
    }
  }
  const evaluation = /\(\s*at\s+x\s*$/i.exec(prefix);
  if (!evaluation) return false;
  const attached = Array.from(ownedExpressionEnds).some(end => end <= evaluation.index && /^\s*$/.test(source.slice(end, evaluation.index)));
  if (!attached && !hasStandaloneFunctionLhs(source, evaluation.index, -1) && !/['"‘’“”]$/.test(source.slice(0, evaluation.index).trimEnd())) return false;
  return readSourceAtEvaluation(source, evaluation.index) !== null;
}

/** A complete scalar evaluation or declared prime-function scalar query is
 * not a Cartesian curve declaration. No derivative or answer is certified. */
function isNativeScalarFunctionEquation(source: string, equals: number, declaredNames: ReadonlySet<string>): boolean {
  const prefix = source.slice(0, equals);
  const scalar = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:\\s*\\/\\s*[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))?";
  const evaluation = new RegExp(`(?<![\\p{L}\\p{N}_])([\\p{L}][\\p{L}\\p{N}_]*)(?:(?:['’′]{1,2}|″)\\s*\\(\\s*(?:${scalar}|x)\\s*\\)|\\s*\\(\\s*${scalar}\\s*\\))\\s*$`, "u").exec(prefix);
  const at = /\bat\s+x\s*$/i.exec(prefix);
  if (evaluation ? !declaredNames.has(evaluation[1]!) || !hasStandaloneFunctionLhs(source, evaluation.index, -1) : !at) return false;
  const read = readCompleteSupportedExpression(source.slice(equals + 1));
  if (!read || /\bx\b/.test(read.expression)) return false;
  try { return Number.isFinite(parseMathExpression(normalizeExpression(read.expression)).evaluate(0)); }
  catch { return false; }
}

function readSourceAtEvaluation(source: string, index: number): number | null {
  const slot = /^\(\s*at\s+x\s*=\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+))?)\s*\)/i.exec(source.slice(index));
  if (!slot) return null;
  const end = index + slot[0].length;
  let next = end;
  while (next < source.length && /\s/.test(source[next]!)) next++;
  if (next < source.length && !/[;,.?]/.test(source[next]!) && !isSourceFunctionProseEndpoint(source, next)) return null;
  try { return Number.isFinite(parseMathExpression(normalizeExpression(slot[1]!)).evaluate(0)) ? end : null; }
  catch { return null; }
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
    // Bare unary notation owns only the literal x argument. Multiplicative,
    // power, call, identifier and digit continuations remain unsupported.
    .replace(BARE_UNARY_FUNCTION, "$1(x)")
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
