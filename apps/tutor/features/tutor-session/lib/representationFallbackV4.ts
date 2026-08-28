import {
  compileSceneDocument,
  isRiverBoatStem,
  parseMathExpression,
  synthesizeFamilyScene,
  synthesizeLastResortScene,
  type RenderScene,
  type SceneDocument,
  type TurnPlanV3,
  type ValidationReport,
} from "@heytutor/scene-engine";

export const REPRESENTATION_TIERS = [
  "exact_verified",
  "qualitative_verified",
  "question_representation",
] as const;

export type RepresentationTier = (typeof REPRESENTATION_TIERS)[number];

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
}

export interface RepresentationSelectionInput {
  question: string;
  turnPlan?: TurnPlanV3 | unknown | null;
  exact?: ExactVerifiedRepresentation | null;
  families?: readonly string[];
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
 * Select the highest-confidence representation without changing the exact
 * scene's proof contract. An exact candidate wins only when the caller's final
 * report is valid and the scene still compiles under the current engine.
 */
export function selectVerifiedRepresentation(
  input: RepresentationSelectionInput,
): SelectedRepresentation {
  if (input.exact && isUsableExactRepresentation(input.exact, input.question)) {
    return {
      tier: "exact_verified",
      nonMetric: false,
      sceneDocument: input.exact.sceneDocument,
      renderScene: input.exact.renderScene,
      validationReport: input.exact.validationReport,
      reason: "caller supplied a fully verified exact scene",
    };
  }

  const families = input.families?.length ? input.families : undefined;
  const synthesized = synthesizeFamilyScene({
    question: input.question,
    turnPlan: input.turnPlan,
    families,
  });
  if (synthesized) {
    return {
      tier: synthesized.tier,
      nonMetric: synthesized.nonMetric,
      sceneDocument: synthesized.document,
      renderScene: synthesized.renderScene,
      validationReport: synthesized.validationReport,
      reason: synthesized.reason,
    };
  }

  try {
    return buildSourceGroundedRepresentation(input.question, input.turnPlan);
  } catch {
    const lastResort = synthesizeLastResortScene({
      question: input.question,
      turnPlan: input.turnPlan,
      families,
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

function isUsableExactRepresentation(
  candidate: ExactVerifiedRepresentation,
  expectedQuestion: string,
): boolean {
  const sourceQuestion = candidate.sceneDocument.source.question;
  if (
    typeof sourceQuestion !== "string" ||
    normalizeQuestion(sourceQuestion) !== normalizeQuestion(expectedQuestion) ||
    !candidate.validationReport.valid ||
    candidate.validationReport.issues.some((issue) =>
      issue.severity === "fatal" || issue.code === "assertion_failed") ||
    candidate.sceneDocument.visualDecision.mode !== "scene" ||
    candidate.renderScene.primitives.length === 0 ||
    usesMensurationSolidOnContactProblem(expectedQuestion, candidate.sceneDocument) ||
    usesCollidingCircuitViews(expectedQuestion, candidate.sceneDocument) ||
    usesGenericVectorDiagramOnRiverBoat(expectedQuestion, candidate.sceneDocument)
  ) {
    return false;
  }
  const currentCompile = compileSceneDocument(candidate.sceneDocument);
  return currentCompile.ok && Boolean(currentCompile.renderScene?.primitives.length);
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
