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
 * Select the highest-confidence representation without changing the exact
 * scene's proof contract. An exact candidate wins only when the caller's final
 * report is valid and the current engine supplies the selected render/report.
 */
export function selectVerifiedRepresentation(
  input: RepresentationSelectionInput,
): SelectedRepresentation {
  // The question fixes these motion numbers. A plan that would narrate a
  // different value gets no figure at all, so a stale number is never spoken
  // over a correct (or a planner-drawn) picture.
  const motionConflict = motionPlanConflict(input.question, input.turnPlan);
  if (motionConflict) {
    const textOnly = buildTextOnlySelected(input.question);
    return { ...textOnly, reason: motionConflict };
  }
  const currentCompile = input.exact
    ? compileUsableExactRepresentation(input.exact, input.question, input.problemIR)
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
  if (circular?.status === "declined" && !circular.legacyOnly) return buildTextOnlySelected(input.question);
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
      return {
        tier: decision.tier,
        nonMetric: decision.nonMetric,
        sceneDocument: document,
        renderScene: compiled.renderScene,
        validationReport: compiled.report,
        figureSource: input.exactFigureSource ?? "planner",
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
    const compiled = compileSceneDocument(matrixDocument);
    if (compiled.ok && compiled.renderScene) {
      return {
        tier: decision.tier,
        nonMetric: decision.nonMetric,
        sceneDocument: matrixDocument,
        renderScene: compiled.renderScene,
        validationReport: compiled.report,
        figureSource: "matrix_source",
        reason: `engine drew the question's matrix source program; ${decision.reason}`,
      };
    }
  }

  const synthesized = sourceFigure ?? synthesize();
  if (synthesized) {
    return {
      tier: synthesized.tier,
      nonMetric: synthesized.nonMetric,
      sceneDocument: synthesized.document,
      renderScene: synthesized.renderScene,
      validationReport: synthesized.validationReport,
      figureSource: synthesizedFigureSource(synthesized.document, synthesized.family),
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
        figureSource: "last_resort",
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

function compileUsableExactRepresentation(
  candidate: ExactVerifiedRepresentation,
  expectedQuestion: string,
  problemIR?: ProblemStructureView | null,
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
    plannerOpticsProof(expectedQuestion, candidate.sceneDocument) === "unproven"
  ) {
    return null;
  }
  const normalized = validateSceneDocument(candidate.sceneDocument);
  // The compiler validates a normalized copy, but compiles the supplied document.
  // Do not accept a raw document whose actions, proofs or operands were changed
  // (or dropped) by that normalization while returning the raw document to the tutor.
  if (!normalized.document || !sameJsonStructure(normalized.document, candidate.sceneDocument, true)) {
    return null;
  }
  const currentCompile = compileSceneDocument(candidate.sceneDocument);
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
 * the stem, the element is drawn on that centre and axis with the stem's sense,
 * every ray ends on an engine-derived point, and every line converging on the
 * image tip leaves the element after a drawn incident ray from the object tip
 * (or is a lens chief ray through the optical centre). Free-point figures, whose
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
  const failure = opticsProofFailure(match, document);
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
/** lens_section and spherical_surface draw a flat element beyond this radius. */
const OPTICS_PLANO_RATIO = 40;

function opticsProofFailure(match: OpticsStemMatch, document: SceneDocument): string | null {
  const element = match.id === "thin_lens" ? "lens" : "mirror";
  const stemKind = match.slots.kind === "convex" ? "convex" : "concave";
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
  // P8: a fatal convergence at the engine image tip.
  const convergence = document.assertions.filter((assertion) =>
    assertion.predicate === "converges" && assertion.severity === "fatal" &&
    assertion.entities.length >= 3 && assertion.entities.at(-1) === imageTip);
  if (convergence.length === 0) return "no fatal converges assertion ending on the gaussian image tip";
  // P7: every ray, extension and converging line ends on an engine-derived point.
  const producer = new Map<string, OpticsConstruction>();
  for (const construction of document.constructions) {
    for (const output of construction.outputs) producer.set(output, construction);
  }
  const entityText = new Map(document.entities.map((entity) =>
    [entity.id, `${entity.id} ${entity.role ?? ""} ${entity.label ?? ""}`]));
  const rays = new Set<OpticsConstruction>();
  for (const construction of document.constructions) {
    if (arrows.includes(construction)) continue;
    if (construction.operator === "segment" || construction.operator === "ray" || construction.operator === "vector") {
      rays.add(construction);
    } else if (construction.operator === "line" &&
      construction.outputs.some((output) => /ray|extension/i.test(entityText.get(output) ?? ""))) {
      rays.add(construction);
    }
  }
  for (const assertion of convergence) {
    for (const id of assertion.entities.slice(0, -1)) {
      const path = producer.get(id);
      if (!path || !OPTICS_PATH_OPERATORS.has(path.operator)) return `converging line ${id} is not a drawn ray`;
      rays.add(path);
    }
  }
  if (rays.size < 2) return "fewer than two ray or extension paths";
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
    const references = opticsDerivedReferences(ray, document);
    if (!references || !references.every((reference) => derived(reference, 0))) {
      return `ray ${ray.outputs[0] ?? ray.id} has an endpoint the engine did not derive`;
    }
  }
  // P9: each converging line is a real ray path through the element.
  const lensImage = element === "lens" ? { u, v: f * u / (u + f) } : null;
  for (const assertion of convergence) {
    for (const id of assertion.entities.slice(0, -1)) {
      const failure = opticsConvergingPathFailure(id, producer.get(id)!, image, lensImage, document, producer);
      if (failure) return failure;
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
 * the axis, all nonzero. The on-element points are the centre (pole or optical
 * centre) and points the document derives on the element plane, the
 * perpendicular to the axis through the centre: `project` onto that plane, or an
 * `intersection` with it.
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
  producer: ReadonlyMap<string, OpticsConstruction>,
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
  const planes = new Set(document.constructions.filter((construction) =>
    construction.operator === "perpendicular_through" &&
    sameOpticsInput(opticsFirst(construction.inputs, ["through", "point"]), center) &&
    sameOpticsInput(opticsFirst(construction.inputs, ["line", "reference"]), image.inputs.axis))
    .flatMap((construction) => construction.outputs));
  const onElement = (point: unknown): boolean => {
    if (typeof point !== "string") return false;
    if (sameOpticsInput(point, center)) return true;
    const construction = producer.get(point);
    if (construction?.operator === "project") return planes.has(opticsFirst(construction.inputs, ["line", "onto"]) as string);
    if (construction?.operator === "intersection") {
      return [["first", "a", "line1"], ["second", "b", "line2"]].some((keys) => planes.has(opticsFirst(construction.inputs, keys) as string));
    }
    return false;
  };
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
  let dx: number;
  if (typeof axis === "string") {
    const line = document.constructions.find((construction) => construction.outputs.includes(axis));
    if (!line || line.operator !== "line") return null;
    dx = opticsPathDx(line, document, 0);
  } else {
    dx = opticsDirectionDx(axis, document, 0);
  }
  if (!Number.isFinite(dx)) return null;
  return dx < 0 ? -1 : 1;
}

/** dx of a path the way the engine reads it: end minus start, else its `direction` or `vector`. */
function opticsPathDx(path: OpticsConstruction, document: SceneDocument, depth: number): number {
  if (opticsFirst(path.inputs, OPTICS_END_KEYS) !== undefined) {
    const start = opticsLiteralPoint(opticsFirst(path.inputs, OPTICS_LINE_START_KEYS), document);
    const end = opticsLiteralPoint(opticsFirst(path.inputs, OPTICS_END_KEYS), document);
    return start && end ? end.x - start.x : Number.NaN;
  }
  return opticsDirectionDx(opticsFirst(path.inputs, ["direction", "vector"]), document, depth + 1);
}

/** dx of a direction input: [dx, dy], {x, y}, or the id of a drawn path. */
function opticsDirectionDx(value: unknown, document: SceneDocument, depth: number): number {
  if (depth > 8) return Number.NaN;
  if (Array.isArray(value) && value.length === 2) return opticsNumber(value[0], document);
  if (isRecord(value) && "x" in value) return opticsNumber(value.x, document);
  if (typeof value !== "string") return Number.NaN;
  const path = document.constructions.find((construction) => construction.outputs.includes(value));
  return path && OPTICS_PATH_OPERATORS.has(path.operator) ? opticsPathDx(path, document, depth) : Number.NaN;
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
