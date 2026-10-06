import {liveSceneSaveFailure} from "@/lib/scene/sceneSaveAdmission";
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
import { renderSceneSvg } from "../../../../packages/scene-engine/scripts/lib/renderSceneSvg";
import {
  parseDrawingCommands,
  resolveVerifiedDiagramFocusTargets,
  verifiedDiagramHasDrawableInk,
  type DrawCommand,
  type VerifiedDiagram,
  type TutorSegment,
} from "@heytutor/drawing";
import { repairLectureMarkup } from "../../features/tutor-session/lib/turn/lectureCueRepair";
import {
  classifyDsaQuestion,
  createFallbackTurnPlanV3,
  inferSceneCapabilities,
  normalizeTutorQuestion,
  planProblemAuthorityV1,
  refuseProblemAuthorityForPlan,
  refuseSourcePlan,
  planSceneDocumentWithRepair,
  planTurnV3,
  questionRequiresVisual,
  revalidateScenePlanWithRepairResult,
  streamLLMResponse,
  type ProblemAuthorityV1Response,
  type ProblemAuthorityV1Decline,
  type SceneCandidateValidation,
  type ScenePlanWithRepairResult,
  type SubjectFamiliarity,
} from "@heytutor/tutor-core";
import {
  ARCHETYPES,
  applySourceQuantityAuthority,
  compileSceneDocument,
  detectArchetype,
  isChemistryQuestion,
  isChemistrySceneFamily,
  normalizeClaimedClosedRouteGeometry,
  normalizeClaimedParaxialReflectionGeometry,
  pruneDeadSceneEntities,
  pruneUnverifiedSceneAnnotations,
  reconcileTurnPlanWithSolver,
  validateSceneDocument,
  validateSceneQuantityAgreement,
  validateTurnPlanSceneProofs,
  type RenderScene,
  type SceneDocument,
  type TurnPlanV3,
  type ValidationReport,
} from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "@/features/tutor-session/lib/scene/verifiedScenePresentation";
import {
  selectFastVerifiedRepresentation,
  selectVerifiedRepresentation,
  type RepresentationTier,
} from "@/features/tutor-session/lib/scene/representationFallback";
import {
  PROBLEM_AUTHORITY_DEADLINE_MS,
  SCENE_PLANNER_DEADLINE_MS,
  TURN_PLAN_DEADLINE_MS,
  selectBestAvailableTurnPlan,
  shouldAttemptExactScene,
  turnPlanNeedsNumericAuthority,
} from "@/features/tutor-session/lib/scene/diagramGeneration";
import {
  runScenePlanningOverlap,
  type SpeculationAbortReason,
} from "@/features/tutor-session/lib/scene/planningOverlap";
import { buildTurnTeachingPrompt } from "@/features/tutor-session/lib/turn/turnTeachingPrompt";
import { refreshSolverAuthorityForPlan } from "@/features/tutor-session/lib/turn/refreshSolverAuthority";
import { withdrawDeclinedProblemAuthority } from "@/features/tutor-session/lib/turn/declinedProblemAuthority";
import { isTeachingResponseIncomplete } from "@/features/tutor-session/lib/turn/segmentPlanning";
import { MAX_LLM_CONTINUATIONS } from "@/features/tutor-session/constants";

export interface LectureStep {
  index: number;
  /** Spoken text of the step with every tag removed. */
  speech: string;
  tags: { type: string; params: number[]; text?: string }[];
}

export interface LecturePlanningStages {
  turnPlanMs: number;
  /** ProblemIR plus solver, from request to answer; 0 when not needed. */
  problemIrMs: number;
  deterministicFigureMs: number;
  /** Start to result of the scene planner run that was used. */
  scenePlannerMs: number;
  revalidateMs: number;
  /** The speculative run started during ProblemIR produced the scene. */
  speculative: boolean;
  /** Scene planning was started again on the final facts. */
  restarted: boolean;
  speculationAbort: SpeculationAbortReason | null;
}

export interface LectureRun {
  probeId: string;
  topicId: string;
  unitId: string;
  difficulty: string;
  question: string;
  familiarity: SubjectFamiliarity;
  startedAt: string;
  timings: {
    planMs: number;
    teachMs: number;
    totalMs: number;
    /** The live planner stages, measured on the same orchestration. */
    stages?: LecturePlanningStages;
  };
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
    /** The committed board figure as SVG, so a reviewer sees what the student saw. */
    svg: string | null;
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
  /** "hinglish" replays a lesson for the Sarvam voice. */
  narrationLanguage?: "english" | "hinglish";
  probeId?: string;
  topicId?: string;
  unitId?: string;
  difficulty?: string;
  /** Optional artifact capture; the live pipeline remains the authority. */
  onPresentation?: (presentation: {
    diagram: VerifiedDiagram | null;
    opening: TutorSegment | null;
    givens: TutorSegment[];
    intro: TutorSegment[];
  }) => void;
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
  const traceId = crypto.randomUUID();
  const startedAt = Date.now();
  const dsaClassification = classifyDsaQuestion(question);

  const stages: LecturePlanningStages = {
    turnPlanMs: 0,
    problemIrMs: 0,
    deterministicFigureMs: 0,
    scenePlannerMs: 0,
    revalidateMs: 0,
    speculative: false,
    restarted: false,
    speculationAbort: null,
  };
  const run: LectureRun = {
    probeId: options.probeId ?? "",
    topicId: options.topicId ?? "",
    unitId: options.unitId ?? "",
    difficulty: options.difficulty ?? "",
    question,
    familiarity,
    startedAt: new Date(startedAt).toISOString(),
    timings: {
      planMs: 0,
      teachMs: 0,
      totalMs: 0,
      stages,
    },
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
      svg: null,
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
    let turnPlan: TurnPlanV3;
    let problemAuthority: ProblemAuthorityV1Response | null = null;

    const turnPlanStartedAt = Date.now();
    const plannedTurn = await planTurnV3(question, {
      proxyUrl: plannerUrl,
      timeoutMs: TURN_PLAN_DEADLINE_MS,
      fastMode,
      traceId,
    });
    stages.turnPlanMs = Date.now() - turnPlanStartedAt;
    turnPlan = selectBestAvailableTurnPlan(
      undefined,
      plannedTurn?.turnPlan,
      createFallbackTurnPlanV3(question),
      plannedTurn?.peerTurnPlans,
    );
    // Mirrors the live hook: ProblemIR only when the plan needs numeric
    // authority, started from the selected plan. The bench has no visual-need
    // service, so the planner's own visual requirement stands.
    let problemAuthorityPromise: Promise<ProblemAuthorityV1Response | null> | null = null;
        let sourceDecline:ProblemAuthorityV1Decline|null=null;
        const retainAuthorityOutcome=(outcome:Awaited<ReturnType<typeof planProblemAuthorityV1>>):ProblemAuthorityV1Response|null=>{
          if(outcome && "status" in outcome){sourceDecline=outcome;return null;}return outcome;
        };
    const originalPlanRefusal=refuseSourcePlan(question,turnPlan);
    if(originalPlanRefusal){sourceDecline=originalPlanRefusal;turnPlan=withdrawDeclinedProblemAuthority(turnPlan,originalPlanRefusal);}
    if (plannedTurn && !sourceDecline && turnPlanNeedsNumericAuthority(question, turnPlan)) {
      const remainingAuthorityMs = Math.max(
        1_000,
        SCENE_PLANNER_DEADLINE_MS - (Date.now() - plannerStartedAt),
      );
      const problemIrStartedAt = Date.now();
      problemAuthorityPromise = planProblemAuthorityV1(question, turnPlan, {
        proxyUrl: plannerUrl,
        timeoutMs: Math.min(PROBLEM_AUTHORITY_DEADLINE_MS, remainingAuthorityMs),
        fastMode,
        traceId,
      }).then(retainAuthorityOutcome)
        .catch(() => null)
        .then((authority) => {
          stages.problemIrMs = Date.now() - problemIrStartedAt;
          return authority;
        });
    }

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

    type BenchSceneGate = {
      sceneCapabilities: ReturnType<typeof inferSceneCapabilities>;
      shouldPlanExactScene: boolean;
      shouldAttemptLlmScene: boolean;
      families: readonly string[];
      archetypeId: string | null;
      request: {
        conversationContext: string;
        constructionOperators?: ReturnType<typeof inferSceneCapabilities>["constructionOperators"];
        proofPredicates?: ReturnType<typeof inferSceneCapabilities>["proofPredicates"];
        planningGuidance?: string[];
      };
    };
    // Mirrors deriveSceneGate in the live hook: chemistry lane, exact gate,
    // archetype guidance and the planner request built from the same plan.
    const deriveSceneGate = (
      planningTurnPlan: TurnPlanV3,
      authority: ProblemAuthorityV1Response | null,
    ): BenchSceneGate => {
      const sceneCapabilities = inferSceneCapabilities(question, {
        lawIds: planningTurnPlan.lawIds,
        problemIR: authority?.problemIR ?? null,
        turnPlan: planningTurnPlan,
      });
      const chemistryLane = sceneCapabilities.families.some(isChemistrySceneFamily)
        || isChemistryQuestion(question);
      const shouldPlanExactScene = planningTurnPlan.visualRequirement !== "none" && !chemistryLane;
      const archetype = detectArchetype(question, {
        turnPlan: planningTurnPlan,
        problemIR: authority?.problemIR ?? null,
      });
      const shouldAttemptLlmScene = shouldAttemptExactScene({
        visualRequirement: planningTurnPlan.visualRequirement,
        chemistryLane,
        familyCount: sceneCapabilities.families.length,
        hasArchetype: archetype !== null,
      });
      const planContext =
        `AUTHORITATIVE TURN PLAN V3\n${JSON.stringify(planningTurnPlan)}\n` +
        "Do not contradict, replace, or independently recalculate these quantities and claims.";
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
      return {
        sceneCapabilities,
        shouldPlanExactScene,
        shouldAttemptLlmScene,
        families: sceneCapabilities.families,
        archetypeId: archetype?.id ?? null,
        request: {
          conversationContext: planContext,
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
      };
    };

    const planning = await runScenePlanningOverlap<
      ProblemAuthorityV1Response,
      BenchSceneGate,
      NonNullable<ReturnType<typeof selectFastVerifiedRepresentation>>,
      ScenePlanWithRepairResult<ValidatedSceneCandidate>
    >({
      turnPlan,
      problemAuthority: problemAuthorityPromise,
      // Speculation follows NEXT_PUBLIC_SCENE_SPECULATION like the live hook
      // (SCENE_SPECULATION_ENABLED, default off).
      speculationAllowed: true,
      plannerStartedAt,
      deadlineMs: SCENE_PLANNER_DEADLINE_MS,
      deriveGate: deriveSceneGate,
      applyUnavailableAuthority: plan => sourceDecline
        ? withdrawDeclinedProblemAuthority(plan, sourceDecline) : plan,
      applyAuthority: (planToReconcile, authority) => {
        const refusal=refuseProblemAuthorityForPlan(question,planToReconcile,authority);
        if(refusal){sourceDecline=refusal;return {turnPlan:withdrawDeclinedProblemAuthority(planToReconcile,refusal),authority:null};}
        const reconciledPlan = applySourceQuantityAuthority(reconcileTurnPlanWithSolver(
          planToReconcile,
          authority.problemIR,
          authority.solverResult,
        ), authority.problemIR, question).plan;
        return {
          turnPlan: reconciledPlan,
          authority: refreshSolverAuthorityForPlan(authority, reconciledPlan, question),
        };
      },
      fastFigureBlocked: (authority) => authority?.audit.status === "contradiction",
      selectFast: (planningTurnPlan, authority, gate) =>
        selectFastVerifiedRepresentation({
          question,
          turnPlan: planningTurnPlan,
          problemIR: authority?.problemIR ?? null,
          families: gate.sceneCapabilities.families,
        }),
      planScene: (gate, planningTurnPlan, sceneRun) =>
        planSceneDocumentWithRepair(
          question,
          (candidate) => validateCandidateAgainstPlan(candidate, planningTurnPlan),
          {
            proxyUrl: plannerUrl,
            signal: sceneRun.signal,
            timeoutMs: sceneRun.timeoutMs,
            holdValidationUntil: sceneRun.holdValidationUntil,
            maxConcurrentRequests: sceneRun.maxConcurrentRequests,
            requestBudget: sceneRun.requestBudget,
            fastMode,
            traceId,
            ...gate.request,
          },
        ).catch(() => null),
      revalidate: (sceneResult, authoritativeTurnPlan) =>
        revalidateScenePlanWithRepairResult(sceneResult, (candidate) =>
          validateCandidateAgainstPlan(candidate, authoritativeTurnPlan),
        ),
    });
    turnPlan = planning.turnPlan;
    problemAuthority = planning.authority;
    const { sceneCapabilities, shouldPlanExactScene, shouldAttemptLlmScene } = planning.gate;
    const fastRepresentation = planning.fast;
    const result = planning.scene;
    run.diagram.archetypeId = planning.gate.archetypeId;
    Object.assign(stages, {
      deterministicFigureMs: planning.timings.deterministicFigureMs,
      scenePlannerMs: planning.timings.scenePlannerMs,
      revalidateMs: planning.timings.revalidateMs,
      speculative: planning.speculation.kept,
      restarted: planning.speculation.restarted,
      speculationAbort: planning.speculation.abortReason,
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
    } else if (
      shouldPlanExactScene &&
      !fastRepresentation &&
      (!value || value.document.visualDecision.mode !== "scene")
    ) {
      const skippedExactForMissingCapability = !shouldAttemptLlmScene;
      run.diagram.degradationReason = !result
        ? skippedExactForMissingCapability ? "missing_capability" : "planner_unavailable"
        : value?.document.visualDecision.mode === "text_only" ||
            run.diagram.candidateErrorCodes.some((code) => /unsupported_operator|missing_capability/.test(code))
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
      const selected = fastRepresentation ?? selectVerifiedRepresentation({
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
      const admissionFailure=liveSceneSaveFailure({document:selected.sceneDocument,question,problemIR:problemAuthority?.problemIR ?? null,turnPlan,tier:selected.tier});
      if(admissionFailure)throw new Error(admissionFailure);
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
      run.diagram.svg = renderSceneSvg(renderScene, {
        title: question.slice(0, 110),
        subtitle: `family=${run.diagram.family ?? "?"} tier=${run.diagram.tier ?? "?"} labels=${run.diagram.renderedLabels.join(" | ")}`,
      });
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
      narrationLanguage: options.narrationLanguage,
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
    options.onPresentation?.({
      diagram: activeDiagram,
      opening: teachingPrompt.openingSegment,
      givens: teachingPrompt.givenSegments,
      intro: presentation?.introSegments ?? [],
    });

    const teachStartedAt = Date.now();
    let fullResponse = "";
    let continueCount = 0;
    let previousChunk = "";
    let reasoningOnlyRetry = false;
    // Mirrors the live hook: only the retry of the turn's first request is a startup retry.
    let startupRetry: "first_content_timeout" | "reasoning_only" | undefined;
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
        noReasoning: reasoningOnlyRetry,
        startupRetry: reasoningOnlyRetry ? startupRetry : undefined,
        traceId,
        question,
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
        startupRetry = continueCount === 0
          ? streamResult.streamStats?.firstContentTimedOut ? "first_content_timeout" : "reasoning_only"
          : undefined;
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
    // The live turn repairs this same text before the pen and the voice, so
    // the grade is the lesson a student would have heard.
    fullResponse = repairLectureMarkup(fullResponse);
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
