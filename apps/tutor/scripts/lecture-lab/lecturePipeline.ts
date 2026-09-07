/**
 * Runs one whole lecture turn without a browser.
 *
 * The admin playground answers "did the lecture finish"; it cannot answer "was
 * the lecture any good", because everything worth grading (which figure was
 * committed, what the tutor actually said, which rows it wrote) only exists
 * inside a React turn. This module replays that turn's non-DSA path against the
 * running dev server: same planners, same scene validation, same representation
 * fallback, and the teaching prompt comes from `buildTurnTeachingPrompt`, the
 * module the live hook uses. What it drops is presentation only: Konva, TTS,
 * persistence, and cancellation.
 */
import {
  parseDrawingCommands,
  resolveVerifiedDiagramFocusTargets,
  verifiedDiagramHasDrawableInk,
  type DrawCommand,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import {
  classifyDsaQuestion,
  createFallbackTurnPlanV3,
  inferSceneCapabilities,
  normalizeTutorQuestion,
  planAndSolveProblemV1,
  planSceneDocumentWithRepair,
  planTurnV3,
  questionRequiresVisual,
  revalidateScenePlanWithRepairResult,
  streamLLMResponse,
  type ProblemAuthorityV1Response,
  type SceneCandidateValidation,
  type ScenePlanWithRepairResult,
  type SubjectFamiliarity,
} from "@heytutor/tutor-core";
import {
  ARCHETYPES,
  buildSolverAuthorityProjection,
  compileSceneDocument,
  detectArchetype,
  normalizeClaimedClosedRouteGeometry,
  normalizeClaimedParaxialReflectionGeometry,
  pruneDeadSceneEntities,
  pruneUnverifiedSceneAnnotations,
  reconcileTurnPlanWithSolver,
  validateSceneDocument,
  validateSceneQuantityAgreement,
  validateTurnPlanSceneProofs,
  verifyTurnPlanAgainstSolver,
  type RenderScene,
  type SceneDocument,
  type TurnPlanV3,
  type ValidationReport,
} from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "@/features/tutor-session/lib/scene/verifiedScenePresentation";
import {
  selectVerifiedRepresentation,
  type RepresentationTier,
} from "@/features/tutor-session/lib/scene/representationFallback";
import {
  PROBLEM_AUTHORITY_DEADLINE_MS,
  SCENE_PLANNER_DEADLINE_MS,
  TURN_PLAN_DEADLINE_MS,
  finalizeScenePlanAfterAuthority,
  selectBestAvailableTurnPlan,
} from "@/features/tutor-session/lib/scene/diagramGeneration";
import { buildTurnTeachingPrompt } from "@/features/tutor-session/lib/turn/turnTeachingPrompt";
import { isTeachingResponseIncomplete } from "@/features/tutor-session/lib/turn/segmentPlanning";
import { MAX_LLM_CONTINUATIONS } from "@/features/tutor-session/constants";

export interface LectureStep {
  index: number;
  /** Spoken text of the step with every tag removed. */
  speech: string;
  tags: { type: string; params: number[]; text?: string }[];
}

export interface LectureRun {
  probeId: string;
  topicId: string;
  unitId: string;
  difficulty: string;
  question: string;
  familiarity: SubjectFamiliarity;
  startedAt: string;
  timings: { planMs: number; teachMs: number; totalMs: number };
  error: string | null;
  isDsa: boolean;
  plan: {
    visualRequirement: string;
    requiresVisualByStem: boolean;
    givens: unknown[];
    unknowns: unknown[];
    derived: { id: string; symbol?: string; value: unknown; unit?: string }[];
    qualitativeClaims: { id: string; expected: unknown }[];
    lawIds: string[];
    assumptions: unknown[];
  } | null;
  solver: {
    status: string;
    issueCodes: string[];
    hasProjection: boolean;
    projection: unknown;
  } | null;
  diagram: {
    committed: boolean;
    /**
     * A representation was built and then refused for carrying no readable
     * label. That is the guard working, not the engine failing to produce one.
     */
    declinedUnreadable: boolean;
    tier: RepresentationTier | null;
    nonMetric: boolean;
    reason: string | null;
    archetypeId: string | null;
    /** The family or archetype construction the figure came from. */
    family: string | null;
    entityIds: string[];
    /** Ids the prompt advertised as FOCUS targets. */
    focusableIds: string[];
    labels: string[];
    annotations: string[];
    /** Text the compiler actually put on the board (label + dimension ink). */
    renderedLabels: string[];
    /** Entity id to the text drawn for it, which is what the tutor may say. */
    labelByEntity: Record<string, string>;
    primitiveCount: number;
    assertionCount: number;
    candidateErrorCodes: string[];
    degradationReason: string | null;
  };
  lessonBudget: { scope: string; minSteps: number; maxSteps: number; boardPages: number };
  givenRows: string[];
  teaching: {
    rawText: string;
    /** The response wrapped its steps in [STEP] tags. The board does not need them. */
    usedStepMarkers: boolean;
    /** FOCUS/ANNOTATE ids the runtime resolver could not match to the figure. */
    unresolvedFocusIds: string[];
    steps: LectureStep[];
    writes: { text: string; x: number | null; y: number | null }[];
    focusIds: string[];
    emphasizeTargets: string[];
    annotateTargets: string[];
    forbiddenTags: string[];
    continuations: number;
    incomplete: boolean;
    contentChars: number;
    reasoningChars: number;
    ttftMs: number | null;
  };
  promptChars: number;
}

export interface RunLectureOptions {
  origin: string;
  cookie: string;
  familiarity?: SubjectFamiliarity;
  fastMode?: boolean;
  probeId?: string;
  topicId?: string;
  unitId?: string;
  difficulty?: string;
}

/** The plan and the stem filter agree this question needs no picture. */
class NoFigureNeeded extends Error {}

type ValidatedSceneCandidate = {
  document: SceneDocument;
  renderScene: RenderScene;
  report: ValidationReport;
};

/** Structural ink the teaching stream is never allowed to emit. */
const TEACHING_OWNED_TAGS = new Set([
  "WRITE",
  "FOCUS",
  "PAUSE",
  "EMPHASIZE",
  "ANNOTATE",
  "TYPE",
  "FRAME",
]);

function stepBlocks(raw: string): string[] {
  const blocks: string[] = [];
  const pattern = /\[STEP\]([\s\S]*?)(?:\[\/STEP\]|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function commandTags(command: DrawCommand): { type: string; params: number[]; text?: string } {
  return command.text === undefined
    ? { type: command.type, params: command.params }
    : { type: command.type, params: command.params, text: command.text };
}

/** `[FOCUS:a,b|spotlight]` names entities; the parser stores them as text. */
function focusIdsFromText(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split("|")[0]
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function runLecture(
  rawQuestion: string,
  options: RunLectureOptions,
): Promise<LectureRun> {
  const question = normalizeTutorQuestion(rawQuestion);
  const familiarity = options.familiarity ?? "normal";
  const fastMode = options.fastMode ?? true;
  const plannerUrl = `${options.origin}/api/chat`;
  const startedAt = Date.now();
  const dsaClassification = classifyDsaQuestion(question);

  const run: LectureRun = {
    probeId: options.probeId ?? "",
    topicId: options.topicId ?? "",
    unitId: options.unitId ?? "",
    difficulty: options.difficulty ?? "",
    question,
    familiarity,
    startedAt: new Date(startedAt).toISOString(),
    timings: { planMs: 0, teachMs: 0, totalMs: 0 },
    error: null,
    isDsa: dsaClassification.isDsa,
    plan: null,
    solver: null,
    diagram: {
      committed: false,
      declinedUnreadable: false,
      tier: null,
      nonMetric: false,
      reason: null,
      archetypeId: null,
      family: null,
      entityIds: [],
      focusableIds: [],
      labels: [],
      annotations: [],
      renderedLabels: [],
      labelByEntity: {},
      primitiveCount: 0,
      assertionCount: 0,
      candidateErrorCodes: [],
      degradationReason: null,
    },
    lessonBudget: { scope: "", minSteps: 0, maxSteps: 0, boardPages: 0 },
    givenRows: [],
    teaching: {
      rawText: "",
      usedStepMarkers: false,
      unresolvedFocusIds: [],
      steps: [],
      writes: [],
      focusIds: [],
      emphasizeTargets: [],
      annotateTargets: [],
      forbiddenTags: [],
      continuations: 0,
      incomplete: false,
      contentChars: 0,
      reasoningChars: 0,
      ttftMs: null,
    },
    promptChars: 0,
  };

  try {
    const plannerStartedAt = Date.now();
    let turnPlan: TurnPlanV3 | null = null;
    let problemAuthority: ProblemAuthorityV1Response | null = null;

    const plannedTurn = await planTurnV3(question, {
      proxyUrl: plannerUrl,
      timeoutMs: TURN_PLAN_DEADLINE_MS,
      fastMode,
    });
    let problemAuthorityPromise: Promise<ProblemAuthorityV1Response | null> | null = null;
    if (plannedTurn) {
      const remainingAuthorityMs = Math.max(
        1_000,
        SCENE_PLANNER_DEADLINE_MS - (Date.now() - plannerStartedAt),
      );
      problemAuthorityPromise = planAndSolveProblemV1(question, plannedTurn.turnPlan, {
        proxyUrl: plannerUrl,
        timeoutMs: Math.min(PROBLEM_AUTHORITY_DEADLINE_MS, remainingAuthorityMs),
        fastMode,
      });
    }
    turnPlan = selectBestAvailableTurnPlan(
      undefined,
      plannedTurn?.turnPlan,
      createFallbackTurnPlanV3(question),
      plannedTurn?.peerTurnPlans,
    );

    if (problemAuthorityPromise) {
      problemAuthority = await problemAuthorityPromise.catch(() => null);
    }

    const planningTurnPlan = turnPlan;
    const sceneCapabilities = inferSceneCapabilities(question, {
      lawIds: planningTurnPlan.lawIds,
      problemIR: problemAuthority?.problemIR ?? null,
      turnPlan: planningTurnPlan,
    });
    const remainingPlannerMs = Math.max(
      0,
      SCENE_PLANNER_DEADLINE_MS - (Date.now() - plannerStartedAt),
    );
    const shouldPlanExactScene = planningTurnPlan.visualRequirement !== "none";
    const planContext =
      `AUTHORITATIVE TURN PLAN V3\n${JSON.stringify(planningTurnPlan)}\n` +
      "Do not contradict, replace, or independently recalculate these quantities and claims.";

    const validateCandidateAgainstPlan = (
      candidate: Record<string, unknown>,
      authoritativePlan: TurnPlanV3,
    ): SceneCandidateValidation<ValidatedSceneCandidate> => {
      let validated = validateSceneDocument(pruneDeadSceneEntities(candidate));
      if (!validated.document) {
        return { valid: false, errors: validated.report.issues };
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
        validated = validateSceneDocument(
          pruneDeadSceneEntities(constraintNormalized as unknown as Record<string, unknown>),
        );
        if (!validated.document) {
          return { valid: false, errors: validated.report.issues };
        }
      }
      const annotationPruned = pruneUnverifiedSceneAnnotations(
        validated.document,
        authoritativePlan,
      );
      if (annotationPruned !== validated.document) {
        validated = validateSceneDocument(
          pruneDeadSceneEntities(annotationPruned as unknown as Record<string, unknown>),
        );
        if (!validated.document) {
          return { valid: false, errors: validated.report.issues };
        }
      }
      const agreementIssues = validateSceneQuantityAgreement(
        validated.document.quantities,
        authoritativePlan,
        [
          ...validated.document.entities
            .map((entity) => entity.label)
            .filter((label): label is string => typeof label === "string"),
          ...validated.document.annotations
            .map((annotation) => annotation.text)
            .filter((text): text is string => typeof text === "string"),
        ],
      );
      const authorityIssues = agreementIssues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path,
        severity: "fatal" as const,
      }));
      const proofIssues = validateTurnPlanSceneProofs(validated.document, authoritativePlan);
      const compiledScene = compileSceneDocument(validated.document);
      const fatalIssues = [
        ...authorityIssues,
        ...proofIssues,
        ...compiledScene.report.issues,
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
            ? authoritativePlan.visualRequirement === "required"
              ? 100_000
              : 10_000
            : 0) +
          compiledScene.report.issues.filter((issue) => issue.severity === "warning").length *
            1_000 +
          compiledScene.report.stats.primitiveCount * 2 +
          compiledScene.report.stats.entityCount +
          compiledScene.report.stats.constructionCount,
        value: {
          document: validated.document,
          renderScene: compiledScene.renderScene,
          report: compiledScene.report,
        },
      };
    };

    const archetype = detectArchetype(question, {
      turnPlan: planningTurnPlan,
      problemIR: problemAuthority?.problemIR ?? null,
    });
    run.diagram.archetypeId = archetype?.id ?? null;

    let result: ScenePlanWithRepairResult<ValidatedSceneCandidate> | null = null;
    if (shouldPlanExactScene && remainingPlannerMs > 0) {
      const archetypeSpec = archetype ? ARCHETYPES[archetype.id] : null;
      const archetypeGuidance = archetypeSpec
        ? [
            `Figure: ${archetypeSpec.label}. It must contain entities with roles: ${archetypeSpec.contract.roles.join(", ")}` +
              (archetypeSpec.contract.operators?.length
                ? `; use ${archetypeSpec.contract.operators.join(", ")}`
                : "") +
              ".",
          ]
        : [];
      result = await planSceneDocumentWithRepair(
        question,
        (candidate) => validateCandidateAgainstPlan(candidate, planningTurnPlan),
        {
          proxyUrl: plannerUrl,
          timeoutMs: remainingPlannerMs,
          conversationContext: planContext,
          fastMode,
          ...(sceneCapabilities.families.length > 0
            ? {
                constructionOperators: sceneCapabilities.constructionOperators,
                proofPredicates: sceneCapabilities.proofPredicates,
                planningGuidance: [...sceneCapabilities.planningGuidance, ...archetypeGuidance],
              }
            : archetypeGuidance.length > 0
              ? { planningGuidance: archetypeGuidance }
              : {}),
        },
      ).catch(() => null);
    }

    if (problemAuthority) {
      turnPlan = reconcileTurnPlanWithSolver(
        turnPlan,
        problemAuthority.problemIR,
        problemAuthority.solverResult,
      );
      const authorityAudit = verifyTurnPlanAgainstSolver(
        problemAuthority.problemIR,
        problemAuthority.solverResult,
        turnPlan,
        question,
      );
      problemAuthority = {
        ...problemAuthority,
        audit: authorityAudit,
        projection:
          authorityAudit.status === "verified"
            ? buildSolverAuthorityProjection(
                problemAuthority.problemIR,
                problemAuthority.solverResult,
                authorityAudit,
              )
            : null,
      };
    }

    const authoritativeTurnPlan = turnPlan;
    result = await finalizeScenePlanAfterAuthority(result, {
      problemAuthorityAvailable: problemAuthority !== null,
      planningTurnPlan,
      authoritativeTurnPlan,
      revalidate: (sceneResult) =>
        revalidateScenePlanWithRepairResult(sceneResult, (candidate) =>
          validateCandidateAgainstPlan(candidate, authoritativeTurnPlan),
        ),
    });

    const solverAuthorityBlocked = problemAuthority?.audit.status === "contradiction";
    const value =
      !solverAuthorityBlocked && result?.validation.valid ? result.validation.value : undefined;
    run.diagram.candidateErrorCodes = Array.from(
      new Set(
        result?.candidates.flatMap((candidate) =>
          candidate.validation.errors
            .filter((issue) => issue.severity === "fatal")
            .map((issue) => issue.code),
        ) ?? [],
      ),
    );
    if (solverAuthorityBlocked) {
      run.diagram.degradationReason = "solver_contradiction";
    } else if (shouldPlanExactScene && (!value || value.document.visualDecision.mode !== "scene")) {
      run.diagram.degradationReason = !result
        ? "planner_unavailable"
        : value?.document.visualDecision.mode === "text_only"
          ? "missing_capability"
          : "candidate_invalid";
    }

    let sceneDocument: SceneDocument | null = null;
    let renderScene: RenderScene | null = null;
    let figureFamily: string | null = null;
    try {
      // Mirrors the live guard: a question whose plan and stem filter agree it
      // needs no picture does not get a fallback one.
      if (turnPlan.visualRequirement === "none" && !questionRequiresVisual(question)) {
        run.diagram.reason = "the question asks for no figure";
        throw new NoFigureNeeded();
      }
      const fallbackCapabilities = inferSceneCapabilities(question, {
        lawIds: turnPlan.lawIds,
        problemIR: problemAuthority?.problemIR ?? null,
        turnPlan,
      });
      const selected = selectVerifiedRepresentation({
        question,
        turnPlan,
        problemIR: problemAuthority?.problemIR ?? null,
        families:
          fallbackCapabilities.families.length > 0
            ? fallbackCapabilities.families
            : sceneCapabilities.families,
        exact:
          value && value.document.visualDecision.mode === "scene"
            ? {
                sceneDocument: value.document,
                renderScene: value.renderScene,
                validationReport: value.report,
              }
            : null,
      });
      sceneDocument = selected.sceneDocument;
      // Mirrors the live guard: a figure the student cannot read is not a
      // figure, so the turn teaches as text only.
      const selectedHasInk = selected.renderScene.primitives.some(
        (primitive) =>
          (primitive.kind === "label" || primitive.kind === "dimension") &&
          typeof primitive.text === "string" &&
          primitive.text.trim().length > 0,
      );
      renderScene = selectedHasInk ? selected.renderScene : null;
      run.diagram.declinedUnreadable = !selectedHasInk;
      run.diagram.tier = selected.tier;
      run.diagram.nonMetric = selected.nonMetric;
      run.diagram.reason = selected.reason;
      figureFamily = selected.family ?? null;
      run.diagram.family = figureFamily;
    } catch (error) {
      if (!(error instanceof NoFigureNeeded)) {
        run.diagram.reason = error instanceof Error ? error.message : String(error);
      }
    }

    run.timings.planMs = Date.now() - plannerStartedAt;
    run.plan = {
      visualRequirement: turnPlan.visualRequirement,
      requiresVisualByStem: questionRequiresVisual(question),
      givens: turnPlan.givens,
      unknowns: turnPlan.unknowns,
      derived: turnPlan.derived.map(({ id, symbol, value: quantityValue, unit }) => ({
        id,
        symbol,
        value: quantityValue,
        unit,
      })),
      qualitativeClaims: turnPlan.qualitativeClaims.map(({ id, expected }) => ({ id, expected })),
      lawIds: turnPlan.lawIds,
      assumptions: turnPlan.assumptions,
    };
    run.solver = problemAuthority
      ? {
          status: problemAuthority.audit.status,
          issueCodes: problemAuthority.audit.issues.map((issue) => issue.code),
          hasProjection: Boolean(problemAuthority.projection),
          projection: problemAuthority.projection ?? null,
        }
      : null;

    let diagramPromptAddon: string | null = null;
    let activeDiagram: VerifiedDiagram | null = null;
    const presentation = renderScene && sceneDocument && "visualDecision" in sceneDocument
      ? buildVerifiedDiagramPresentation(
          sceneDocument,
          renderScene,
          figureFamily ? { figureFamily } : {},
        )
      : null;
    if (presentation && renderScene && sceneDocument && verifiedDiagramHasDrawableInk(presentation.diagram)) {
      activeDiagram = presentation.diagram;
      diagramPromptAddon = presentation.diagram.promptAddon;
      run.diagram.committed = true;
      run.diagram.entityIds = sceneDocument.entities.map((entity) => entity.id);
      run.diagram.focusableIds = [
        ...presentation.diagram.anchors.map((anchor) => anchor.id),
        ...(presentation.diagram.groups ?? []).map((group) => group.id),
      ];
      run.diagram.labels = sceneDocument.entities
        .map((entity) => entity.label)
        .filter((label): label is string => typeof label === "string");
      run.diagram.annotations = sceneDocument.annotations
        .map((annotation) => annotation.text)
        .filter((text): text is string => typeof text === "string");
      for (const primitive of renderScene.primitives) {
        if (primitive.kind !== "label" && primitive.kind !== "dimension") continue;
        const text = primitive.text?.trim();
        if (!text) continue;
        run.diagram.renderedLabels.push(text);
        if (!run.diagram.labelByEntity[primitive.entityId]) {
          run.diagram.labelByEntity[primitive.entityId] = text;
        }
      }
      run.diagram.primitiveCount = renderScene.primitives.length;
      run.diagram.assertionCount = sceneDocument.assertions.length;
    }

    const teachingPrompt = buildTurnTeachingPrompt({
      question,
      diagramPromptAddon,
      turnPlan,
      solverProjection: problemAuthority?.projection ?? null,
      codeLesson: null,
      isDsa: dsaClassification.isDsa,
      familiarity,
      fastMode,
    });
    run.promptChars = teachingPrompt.systemPrompt.length;
    run.lessonBudget = {
      scope: teachingPrompt.lessonBudget.scope,
      minSteps: teachingPrompt.lessonBudget.minSteps,
      maxSteps: teachingPrompt.lessonBudget.maxSteps,
      boardPages: teachingPrompt.lessonBudget.boardPages,
    };
    run.givenRows = teachingPrompt.givenSegments.flatMap((segment) =>
      (segment.commands ?? (segment.command ? [segment.command] : []))
        .map((command) => command.text)
        .filter((text): text is string => typeof text === "string"),
    );

    const teachStartedAt = Date.now();
    let fullResponse = "";
    let continueCount = 0;
    let previousChunk = "";
    let reasoningOnlyRetry = false;
    let incomplete = false;
    while (continueCount <= MAX_LLM_CONTINUATIONS) {
      const isContinuation = continueCount > 0 && !reasoningOnlyRetry;
      const streamResult = await streamLLMResponse({
        systemPrompt: isContinuation
          ? teachingPrompt.continuationPrompt
          : teachingPrompt.systemPrompt,
        userPrompt: isContinuation ? "continue" : question,
        conversationHistory: isContinuation
          ? [{ user: question, assistant: fullResponse }]
          : [],
        proxyUrl: plannerUrl,
        hasAuthoritativePlan: Boolean(
          turnPlan.givens.length > 0 ||
            turnPlan.derived.length > 0 ||
            turnPlan.qualitativeClaims.length > 0 ||
            turnPlan.lawIds.length > 0,
        ),
        fastMode,
      });
      fullResponse += streamResult.text;
      run.teaching.contentChars += streamResult.streamStats?.contentChars ?? 0;
      run.teaching.reasoningChars += streamResult.streamStats?.reasoningChars ?? 0;
      if (run.teaching.ttftMs === null) {
        run.teaching.ttftMs = streamResult.streamStats?.ttftContentMs ?? null;
      }

      const reasoningOnlyChunk =
        streamResult.text.trim().length === 0 &&
        (streamResult.streamStats?.reasoningChars ?? 0) > 0;
      if (reasoningOnlyChunk && !reasoningOnlyRetry && continueCount < MAX_LLM_CONTINUATIONS) {
        reasoningOnlyRetry = true;
        continueCount += 1;
        continue;
      }
      reasoningOnlyRetry = false;

      if (!isTeachingResponseIncomplete(streamResult.text, fullResponse, previousChunk)) {
        break;
      }
      previousChunk = streamResult.text;
      continueCount += 1;
      incomplete = continueCount > MAX_LLM_CONTINUATIONS;
    }
    run.teaching.continuations = continueCount;
    run.teaching.incomplete = incomplete;
    run.teaching.rawText = fullResponse;
    run.timings.teachMs = Date.now() - teachStartedAt;

    const blocks = stepBlocks(fullResponse);
    const parsedAll = parseDrawingCommands(fullResponse);
    run.teaching.usedStepMarkers = blocks.length > 0;
    run.teaching.steps = blocks.length > 0
      ? blocks.map((block, index) => {
          const parsed = parseDrawingCommands(block);
          return {
            index: index + 1,
            speech: parsed.narration.trim(),
            tags: parsed.commands.map(commandTags),
          };
        })
      // A response can teach perfectly and simply not wrap its steps in [STEP].
      // The live parser emits a segment per tag either way, so the lesson runs;
      // grading it as "no lesson" measured the markup, not the teaching.
      : stepsFromSegments(parsedAll);
    for (const command of parsedAll.commands) {
      if (command.type === "WRITE") {
        run.teaching.writes.push({
          text: command.text ?? "",
          x: command.params[0] ?? null,
          y: command.params[1] ?? null,
        });
      } else if (command.type === "FOCUS") {
        run.teaching.focusIds.push(...focusIdsFromText(command.text));
        // Resolve exactly as the board does, so an "unknown entity" finding
        // means the marker really would have stayed parked.
        if (resolveVerifiedDiagramFocusTargets(command, activeDiagram).length === 0) {
          run.teaching.unresolvedFocusIds.push(...focusIdsFromText(command.text));
        }
      } else if (command.type === "EMPHASIZE") {
        run.teaching.emphasizeTargets.push(command.text ?? "");
      } else if (command.type === "ANNOTATE") {
        run.teaching.annotateTargets.push(command.text ?? "");
        if (resolveVerifiedDiagramFocusTargets(command, activeDiagram).length === 0) {
          run.teaching.unresolvedFocusIds.push(...focusIdsFromText(command.text));
        }
      } else if (!TEACHING_OWNED_TAGS.has(command.type)) {
        run.teaching.forbiddenTags.push(command.type);
      }
    }
  } catch (error) {
    run.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  run.timings.totalMs = Date.now() - startedAt;
  return run;
}

/**
 * Rebuild steps from the tag stream for a response with no [STEP] markers.
 *
 * A step is one spoken beat and every tag that follows it, which is exactly
 * how `IncrementalTagParser` hands segments to the board.
 */
function stepsFromSegments(parsed: ReturnType<typeof parseDrawingCommands>): LectureStep[] {
  const steps: LectureStep[] = [];
  for (const segment of parsed.segments) {
    const command = parsed.commands[segment.commandIndex];
    const speech = segment.text.trim();
    if (speech || steps.length === 0) {
      steps.push({ index: steps.length + 1, speech, tags: [] });
    }
    if (command) {
      steps[steps.length - 1].tags.push(commandTags(command));
    }
  }
  return steps.filter((step) => step.speech.length > 0 || step.tags.length > 0);
}
