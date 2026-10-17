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
  IncrementalTagParser,
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
  completeScenePlanWithRepairResult,
  createFallbackTurnPlanV3,
  normalizeTutorQuestion,
  planAndSolveProblemV1,
  planSceneDocumentWithRepair,
  planTurnV3,
  subjectFromRejectedTurnPlanOutcomes,
  questionRequiresVisual,
  revalidateScenePlanWithRepairResult,
  streamLLMResponse,
  type ProblemAuthorityV1Response,
  type SceneCandidateValidation,
  type SceneCompletenessRoundRecord,
  type ScenePlannerRequestOutcome,
  type ScenePlannerRequestContext,
  type SceneRepairRequestEvidence,
  type ScenePlanWithRepairResult,
  type SubjectFamiliarity,
  type TurnPlanRequestOutcome,
  type TurnPlanVisualDecision,
} from "@heytutor/tutor-core";
import {
  FIGURE_SOURCES,
  buildSolverAuthorityProjection,
  reconcileTurnPlanWithSolver,
  verifyTurnPlanAgainstSolver,
  type FigureSource,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  deriveSceneGate as deriveProductionSceneGate, selectProductionScene, validateProductionSceneCandidate,
  settleSelectionDegradation, type DroppedSceneCandidate, type ProductionSceneGate, type ValidatedSceneCandidate,
  PRODUCTION_SCENE_SELECTION_VERSION,
} from "@/features/tutor-session/lib/scene/productionSceneSelection";
import { diagramStrategyAllowsFigureSource, type DiagramStrategyDecision } from "@/features/tutor-session/lib/scene/diagramStrategy";
import { applyVisualDecisionToPlan } from "@/features/tutor-session/lib/scene/visualRequirement";
import { buildVerifiedDiagramPresentation } from "@/features/tutor-session/lib/scene/verifiedScenePresentation";
import { isVisualPresentationRefusal } from "@/features/tutor-session/lib/scene/visualPresentationRefusal";
import {
  selectFastVerifiedRepresentation,
  type RepresentationTier,
} from "@/features/tutor-session/lib/scene/representationFallback";
import {
  PROBLEM_AUTHORITY_DEADLINE_MS,
  SCENE_PLANNER_DEADLINE_MS,
  REQUIRED_DIAGRAM_RETRY_ENABLED,
  TURN_PLAN_DEADLINE_MS,
  selectBestAvailableTurnPlan,
  turnPlanNeedsNumericAuthority,
} from "@/features/tutor-session/lib/scene/diagramGeneration";
import {
  runScenePlanningOverlap,
  type SpeculationAbortReason,
} from "@/features/tutor-session/lib/scene/planningOverlap";
import { buildTurnTeachingPrompt } from "@/features/tutor-session/lib/turn/turnTeachingPrompt";
import { isTeachingResponseIncomplete } from "@/features/tutor-session/lib/turn/segmentPlanning";
import { MAX_LLM_CONTINUATIONS } from "@/features/tutor-session/constants";
import { parseDiagramSubject, type DiagramSubject } from "@heytutor/tutor-core";
import { sceneDeclineExperimentGuidance, type SceneDeclinePolicy } from "./sceneDeclineExperiment";
import { createPlannerEvidence, recordPlannerResponse, recordRejectedOperatorCalls, type PlannerEvidence } from "./plannerEvidence";
import {
  classifyDiagramEmptyCause,
  evaluationDecision,
  supplementCandidateErrorCodes,
  type DiagramEmptyCause,
  type DiagramEvalArm,
  type PlannerUsageSummary,
} from "./diagramEval";
import {
  buildDiagramExampleCatalogue,
  type DiagramExampleCatalogue,
  type DiagramExemplar,
} from "./diagramExamples";
import {
  pickDiagramExamples,
  type DiagramExamplePickerRecord,
} from "./diagramExamplePicker";
import { fetchVisualNeedAssessment, type VisualNeedAssessment } from "@/features/tutor-session/lib/scene/visualNeedClient";
import { LAB_VISUAL_NEED_POLICY, visualNeedQuestionHash, type LabVisualNeedEvidence } from "./labVisualNeed";
import { hasProductionLabProfile, labStrategyDecision, pickProductionLabExamples } from "./productionLabProfile";
import type { LabSpendMode } from "./labSpend";
import { createParallelPrefixController } from "./parallelTeachingController";
import { parallelPrefixPrompt, parallelContinuationHistory, type AcceptedParallelPrefix } from "./parallelTeachingPrefix";
import { awaitUnstopped, pendingFigureIdentity, createPendingFigureCheckpoint, restorePendingFigureCheckpoint, type PendingFigureCheckpoint, type PendingFigureIdentity } from "./parallelPendingFigure";

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
  /** Remaining scene-planning deadline budget when the overlap run completed. */
  deadlineRemainingMs?: number;
  revalidateMs: number;
  /** The completeness round on the planner figure, reply validation included; 0 when it did not call. */
  completenessMs?: number;
  /** Scene planner requests launched by the shared overlap orchestrator. */
  plannerCalls?: number;
  /** The speculative run started during ProblemIR produced the scene. */
  speculative: boolean;
  /** Scene planning was started again on the final facts. */
  restarted: boolean;
  speculationAbort: SpeculationAbortReason | null;
}

export interface LectureExamplePickerRecord extends DiagramExamplePickerRecord {
  /** The ProblemIR request was in flight during at least part of the picker call. */
  overlappedProblemIr: boolean;
  /** Picker time beyond ProblemIR completion; zero means it added no planning wait. */
  criticalPathMs: number;
}

export interface LectureRun {
  probeId: string;
  topicId: string;
  unitId: string;
  difficulty: string;
  question: string;
  familiarity: SubjectFamiliarity;
  arm?: DiagramEvalArm;
  figureOnly?: boolean;
  /** Full accepted inputs for offline selection replay; absent on historical runs. */
  figureReplayInputs?: {
    schemaVersion: "lecture-figure-replay-inputs/v1";
    selection: Parameters<typeof selectProductionScene>[0];
    authority: Pick<ProblemAuthorityV1Response, "solverResult" | "audit" | "projection"> | null;
    authorityAttempted: boolean;
  } | null;
  startedAt: string;
  timings: {
    planMs: number;
    teachMs: number;
    totalMs: number;
    /** Time from turn start until a verified figure was ready to commit. */
    figureCommitMs?: number | null;
    /** Complete admitted host setup available to the lab; not acoustic playback. */
    firstSetupReadyMs?: number;
    /** First main teaching segment available to the parser; usefulness needs judging. */
    firstMainStepReadyMs?: number;
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
  planner?: PlannerUsageSummary;
  /** Observed TurnPlan completions only; absent on historical runs, bounded to three attempts. */
  turnPlanCallOutcomes?: TurnPlanRequestOutcome[];
  /** The actual admitted model result versus the existing handled fallback. */
  turnPlanStatus?: "planned" | "fallback";
  /** Declared/minimum/peer decision; enabled-only evidence, never added to plan authority. */
  turnPlanVisualDecision?: TurnPlanVisualDecision;
  examplePicker?: LectureExamplePickerRecord;
  /** Missing only on historical runs. Null votes mean unavailable evidence, never none. */
  visualNeed?: LabVisualNeedEvidence;
  productionStrategy?: LectureProductionStrategy;
  /** Lab-only experiment; no private prefix text in the public timing evidence. */
  parallelTeaching?: {
    enabled: boolean;
    started: boolean;
    accepted: boolean;
    frozen: boolean;
    reason: string | null;
    prefixRequestMs: number | null;
    prefixAcceptedMs: number | null;
    rawPrefixChars: number;
    /** Restored lab admission only; not a new callback or audio receipt. */
    restored?: boolean;
  };
  /** Private lab artifact, never live geometry or a planner decline. */
  stoppedWhileFigurePending?: true;
  pendingFigureCheckpoint?: PendingFigureCheckpoint;
  diagram: PlannerEvidence & {
    committed: boolean;
    /**
     * A representation was built and then refused for carrying no readable
     * label. That is the guard working, not the engine failing to produce one.
     */
    declinedUnreadable: boolean;
    /** Present on new run records; null only when a figure committed. */
    emptyCause?: DiagramEmptyCause | null;
    tier: RepresentationTier | null;
    nonMetric: boolean;
    figureSource?: FigureSource;
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
    candidateCount?: number;
    candidateTimings?: Array<{ phase: string; lane: string; pass: string; validationAndCompileMs: number | null; valid: boolean; errorCodes: string[] }>;
    /** Only true for the selected, validated text_only document, not an invalid refusal. */
    plannerDeclined?: boolean;
    /** HTTP/parse diagnostics for every scene-planner request in this turn. */
    plannerCallOutcomes?: ScenePlannerRequestOutcome[];
    /** Private lab evidence; raw model text, distinct from deterministic fallback reasons. */
    plannerResponses?: Array<{ phase: string; lane: string; selected: boolean; rawContent: string; requestContext?: ScenePlannerRequestContext; validation?: Pick<SceneCandidateValidation, "valid" | "errors"> }>;
    /**
     * The completeness round on the chosen planner figure (the live round):
     * attempted, accepted, outcome, items requested, items still missing and
     * the time it added. Null when no valid planner figure reached it.
     */
    completeness?: SceneCompletenessRoundRecord | null;
    plannerRepairRequests?: SceneRepairRequestEvidence[];
    examplesUsed?: Array<Pick<DiagramExemplar,
      "id" | "sourceKind" | "question" | "depicts" | "figureKind" | "family" | "archetype">>;
    validationIssues?: Array<{ code: string; severity: "fatal" | "warning"; message: string }>;
    degradationReason: string | null;
    /** Strict-arm fallback that compiled but was intentionally not rendered. */
    suppressedFallback?: { figureSource: FigureSource; family: string | null } | null;
    /** A candidate that passed validation as a scene but was not the figure drawn. */
    droppedCandidate?: DroppedSceneCandidate | null;
    /** The committed board figure as SVG, so a reviewer sees what the student saw. */
    svg: string | null;
    png?: string | null;
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
  arm?: DiagramEvalArm;
  figureOnly?: boolean;
  /** Evaluation-only override; live turns keep SCENE_PLANNER_DEADLINE_MS. */
  scenePlannerDeadlineMs?: number;
  /** Uses the same subject vocabulary as the live semantic planner. */
  subject?: DiagramSubject;
  productionStrictSubjects?: readonly DiagramSubject[] | null;
  productionPhysicsMode?: "hybrid" | null;
  sceneDeclinePolicy?: SceneDeclinePolicy;
  traceId?: string;
  /** Frozen, identity-checked Jev answer for a lab rerun; undefined calls the live service. */
  visualNeedReplay?: VisualNeedAssessment;
  /** Leak-filtered library for example evaluations and live subject profiles. */
  diagramExamples?: readonly DiagramExemplar[];
  /** Built once per round from diagramExamples. */
  diagramExampleCatalogue?: DiagramExampleCatalogue;
  /** Hard-cap accounting hook used by paid lecture-lab runs. */
  onModelCost?: (usd: number) => void;
  spendMode?: LabSpendMode;
  /** Lab-only prototype flag, default off. Never enables a live lesson switch. */
  parallelTeaching?: boolean;
  /** Called only after a complete narration-only prefix passes admission. */
  onParallelPrefix?: (prefix: AcceptedParallelPrefix) => void;
  /** Explicit lab Stop. Defaults absent; no live caller/control is added. */
  stopSignal?: AbortSignal;
  /** Unknown saved lab JSON, identity checked before any provider IO. */
  reopenPendingFigure?: unknown;
  /** Optional artifact capture; the live pipeline remains the authority. */
  onPresentation?: (presentation: {
    diagram: VerifiedDiagram | null;
    opening: TutorSegment | null;
    givens: TutorSegment[];
    intro: TutorSegment[];
  }) => void;
}

export interface LectureProductionStrategy {
  classifiedSubject: DiagramSubject;
  strategy: DiagramStrategyDecision["strategy"];
  physicsMode: "hybrid" | null;
  strategyReason: DiagramStrategyDecision["strategyReason"];
  hybridSignal: DiagramStrategyDecision["hybridSignal"];
  policyVersion: DiagramStrategyDecision["policyVersion"];
  /** Initial no-IR choice remains visible when authority changes the final gate. */
  pickerDecision?: Omit<LectureProductionStrategy, "pickerDecision">;
}

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
  const originalQuestion = rawQuestion;
  const question = normalizeTutorQuestion(rawQuestion);
  const familiarity = options.familiarity ?? "normal";
  const fastMode = options.fastMode ?? true;
  const plannerUrl = `${options.origin}/api/chat`;
  const traceId = options.traceId ?? crypto.randomUUID();
  const startedAt = Date.now();
  const scenePlannerDeadlineMs = options.scenePlannerDeadlineMs ?? SCENE_PLANNER_DEADLINE_MS;
  const dsaClassification = classifyDsaQuestion(question);
  const productionProfile = hasProductionLabProfile(options.productionStrictSubjects, options.productionPhysicsMode);

  const stages: LecturePlanningStages = {
    turnPlanMs: 0,
    problemIrMs: 0,
    deterministicFigureMs: 0,
    scenePlannerMs: 0,
    deadlineRemainingMs: scenePlannerDeadlineMs,
    revalidateMs: 0,
    completenessMs: 0,
    plannerCalls: 0,
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
    arm: options.arm ?? "current",
    figureOnly: options.figureOnly ?? false,
    figureReplayInputs: null,
    startedAt: new Date(startedAt).toISOString(),
    timings: {
      planMs: 0,
      teachMs: 0,
      totalMs: 0,
      figureCommitMs: null,
      stages,
    },
    error: null,
    isDsa: dsaClassification.isDsa,
    plan: null,
    solver: null,
    planner: {
      calls: 0,
      usageCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      estimatedCostUsd: 0,
      modelCalls: [],
    },
    turnPlanCallOutcomes: [],
    diagram: {
      ...createPlannerEvidence(),
      committed: false,
      declinedUnreadable: false,
      emptyCause: null,
      tier: null,
      nonMetric: false,
      figureSource: "text_only",
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
      candidateCount: 0,
      candidateTimings: [],
      plannerCallOutcomes: [],
      examplesUsed: [],
      validationIssues: [],
      degradationReason: null,
      suppressedFallback: null,
      droppedCandidate: null,
      svg: null,
      png: null,
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
  const parallelEnabled = options.parallelTeaching === true && !options.figureOnly && !dsaClassification.isDsa;
  let acceptedPrefix: AcceptedParallelPrefix | null = null;
  let checkpointIdentity: PendingFigureIdentity | null = null;
  let sceneDecisionFinished = false;
  const stopSignal = options.stopSignal;
  const assertUnstopped = (): void => {
    if (stopSignal?.aborted) throw new DOMException("Lab lecture stopped", "AbortError");
  };
  const guard = <T,>(operation: Promise<T>): Promise<T> => awaitUnstopped(operation, stopSignal);
  const prefixEvidence: NonNullable<LectureRun["parallelTeaching"]> | null = parallelEnabled ? {
    enabled: true, started: false, accepted: false, frozen: false, reason: null,
    prefixRequestMs: null, prefixAcceptedMs: null, rawPrefixChars: 0,
  } : null;
  if (prefixEvidence) run.parallelTeaching = prefixEvidence;
  const prefixController = parallelEnabled ? createParallelPrefixController({
    enabled: true,
    question,
    narrationLanguage: options.narrationLanguage,
    signal: stopSignal,
    request: async (signal) => {
      prefixEvidence!.prefixRequestMs = Date.now() - startedAt;
      // Same proxy, trace, admission and upstream cap as every normal teaching
      // call. No client hedge/retry/continuation; transport retries still count.
      const reply = await streamLLMResponse({
        systemPrompt: parallelPrefixPrompt(options.narrationLanguage), userPrompt: question,
        conversationHistory: [], proxyUrl: plannerUrl, hasAuthoritativePlan: true,
        fastMode, traceId, question, signal,
      });
      if (!stopSignal?.aborted) prefixEvidence!.rawPrefixChars = reply.text.length;
      return reply.text;
    },
    onAccepted: (prefix) => {
      if (stopSignal?.aborted) return;
      acceptedPrefix = { ...prefix, actions: [...prefix.actions] };
      prefixEvidence!.prefixAcceptedMs = Date.now() - startedAt;
      run.timings.firstSetupReadyMs = prefixEvidence!.prefixAcceptedMs;
      options.onParallelPrefix?.({ ...prefix, actions: [...prefix.actions] });
    },
  }) : null;

  try {
    if (parallelEnabled) {
      checkpointIdentity = pendingFigureIdentity({
        question: rawQuestion, language: options.narrationLanguage ?? "english",
        arm: options.arm ?? "current", familiarity, fastMode,
        productionStrictSubjects: options.productionStrictSubjects ?? null,
        scenePlannerDeadlineMs, sceneDeclinePolicy: options.sceneDeclinePolicy ?? "unchanged",
        selectionVersion: PRODUCTION_SCENE_SELECTION_VERSION,
      });
    }
    if (options.reopenPendingFigure !== undefined) {
      if (!checkpointIdentity) throw new Error("Pending-figure reopen requires lab parallel teaching");
      acceptedPrefix = restorePendingFigureCheckpoint(options.reopenPendingFigure, checkpointIdentity);
      if (prefixEvidence) prefixEvidence.restored = Boolean(acceptedPrefix);
    }
    assertUnstopped();
    const stoppableFetch: typeof fetch | undefined = stopSignal ? (input, init) => fetch(input, {
      ...init, signal: init?.signal ? AbortSignal.any([init.signal, stopSignal]) : stopSignal,
    }) : undefined;
    const plannerStartedAt = Date.now();
    let turnPlan: TurnPlanV3;
    let problemAuthority: ProblemAuthorityV1Response | null = null;
    let pickedExamples: DiagramExemplar[] = [];
    const visualNeedPromise = options.visualNeedReplay === undefined
      ? fetchVisualNeedAssessment({ url: `${options.origin}/api/visual-need`, question, traceId, signal: stopSignal })
      : Promise.resolve(options.visualNeedReplay);

    const turnPlanStartedAt = Date.now();
    const plannedTurn = await guard(planTurnV3(question, {
      proxyUrl: plannerUrl,
      timeoutMs: TURN_PLAN_DEADLINE_MS,
      fastMode,
      traceId,
      signal: stopSignal,
      classifySubject: productionProfile,
      onRequestOutcome: (outcome) => {
        // Late unused peers may report after selection; the saved JSON is a snapshot, not a drain.
        if (run.turnPlanCallOutcomes && run.turnPlanCallOutcomes.length < 3) run.turnPlanCallOutcomes.push(outcome);
      },
    }));
    stages.turnPlanMs = Date.now() - turnPlanStartedAt;
    run.turnPlanStatus = plannedTurn ? "planned" : "fallback";
    if (plannedTurn?.visualDecision) run.turnPlanVisualDecision = plannedTurn.visualDecision;
    turnPlan = selectBestAvailableTurnPlan(
      undefined,
      plannedTurn?.turnPlan,
      createFallbackTurnPlanV3(question),
      plannedTurn?.peerTurnPlans,
    );
    // As in live, numeric authority starts from the unmerged selected plan
    // while the visual-need request runs beside the turn planner.
    let problemAuthorityPromise: Promise<ProblemAuthorityV1Response | null> | null = null;
    let problemAuthorityFinishedAt: number | null = null;
    if (plannedTurn && turnPlanNeedsNumericAuthority(question, turnPlan)) {
      const remainingAuthorityMs = Math.max(
        1_000,
        scenePlannerDeadlineMs - (Date.now() - plannerStartedAt),
      );
      const problemIrStartedAt = Date.now();
      problemAuthorityPromise = planAndSolveProblemV1(question, turnPlan, {
        proxyUrl: plannerUrl,
        timeoutMs: Math.min(PROBLEM_AUTHORITY_DEADLINE_MS, remainingAuthorityMs),
        fastMode,
        traceId,
        signal: stopSignal,
      })
        .catch(() => null)
        .then((authority) => {
          if (!stopSignal?.aborted) {
            stages.problemIrMs = Date.now() - problemIrStartedAt;
            problemAuthorityFinishedAt = Date.now();
          }
          return authority;
        });
    }

    const assessment = await guard(visualNeedPromise);
    const plannerRequirement = turnPlan.visualRequirement;
    const pickerGate = deriveProductionSceneGate({ question, turnPlan, problemIR: null, visualNeedDecision: assessment.decision });
    turnPlan = pickerGate.turnPlan;
    run.visualNeed = { plannerRequirement, assessment, mergedRequirement: turnPlan.visualRequirement,
      origin: options.visualNeedReplay === undefined ? "live_service" : "frozen_replay",
      questionHash: visualNeedQuestionHash(question), policy: LAB_VISUAL_NEED_POLICY };
    const classifiedSubject = plannedTurn?.subject ?? subjectFromRejectedTurnPlanOutcomes(run.turnPlanCallOutcomes ?? []);
    // Match live: rejected-plan consensus is recorded, but cannot enable strict.
    const strategySubject = plannedTurn ? classifiedSubject : "other";
    const pickerDecision = labStrategyDecision(options.arm ?? "current", {
      subject: parseDiagramSubject(options.subject), chemistryLane: pickerGate.chemistryLane,
      codeLesson: false, dsa: dsaClassification.isDsa, doubt: false,
      physicsMode: options.productionPhysicsMode, sceneSignal: { families: pickerGate.families, archetypeId: pickerGate.archetypeId },
    }, options.productionStrictSubjects, strategySubject);
    const strategyRecord = (decision: DiagramStrategyDecision): Omit<LectureProductionStrategy, "pickerDecision"> => ({
      classifiedSubject, strategy: decision.strategy, physicsMode: options.productionPhysicsMode ?? null,
      strategyReason: decision.strategyReason, hybridSignal: decision.hybridSignal, policyVersion: decision.policyVersion,
    });
    if (productionProfile) run.productionStrategy = strategyRecord(pickerDecision);
    if (pickerGate.shouldPlanExactScene && pickerDecision.usePickedExamples) {
      const examples = options.diagramExamples ?? [];
      const pickerStartedAt = Date.now();
      const picked = await guard(productionProfile ? pickProductionLabExamples(examples, {
        origin: options.origin, question, plan: turnPlan, traceId, subject: classifiedSubject,
        fetchImpl: stoppableFetch,
      }) : pickDiagramExamples(
        examples,
        options.diagramExampleCatalogue ?? buildDiagramExampleCatalogue(examples),
        {
          question,
          plan: turnPlan,
          families: pickerGate.families,
          archetypeId: pickerGate.archetypeId,
          onModelCost: options.onModelCost,
          traceId: options.traceId,
          spendMode: options.spendMode,
          fetchImpl: stoppableFetch,
        },
      ));
      const pickerFinishedAt = Date.now();
      pickedExamples = picked.examples;
      run.examplePicker = {
        ...picked.record,
        overlappedProblemIr: problemAuthorityPromise !== null,
        criticalPathMs: problemAuthorityPromise === null
          ? pickerFinishedAt - pickerStartedAt
          : problemAuthorityFinishedAt === null
            ? 0
            : Math.max(0, pickerFinishedAt - problemAuthorityFinishedAt),
      };
    }

    const candidateClocks = new WeakMap<Record<string, unknown>, number>();
    const validateCandidateAgainstPlan = (
      candidate: Record<string, unknown>, authoritativePlan: TurnPlanV3,
    ): SceneCandidateValidation<ValidatedSceneCandidate> => {
      assertUnstopped();
      const startedAt = performance.now();
      const validation = validateProductionSceneCandidate({ candidate, question, turnPlan: authoritativePlan, experimentalCompleteness: process.env.NEXT_PUBLIC_EXPERIMENTAL_SCENE_COMPLETENESS === "1" });
      candidateClocks.set(candidate, performance.now() - startedAt);
      return validation;
    };
    const recordValidation = (response: Parameters<typeof recordRejectedOperatorCalls>[1], validation: SceneCandidateValidation, pass: "initial" | "authority_revalidation") => {
      run.diagram.candidateTimings?.push({ phase: response.phase, lane: response.lane, pass,
        validationAndCompileMs: candidateClocks.get(response.document) ?? null,
        valid: validation.valid, errorCodes: validation.errors.map((error) => error.code),
      });
      recordRejectedOperatorCalls(run.diagram, response, validation, pass);
    };

    type BenchSceneGate = ProductionSceneGate & {
      authorityBlocked: boolean;
      diagramStrategy: ReturnType<typeof evaluationDecision>;
      examplesUsed: DiagramExemplar[];
      request: ProductionSceneGate["request"] & { workedExamples?: DiagramExemplar[] };
    };
    const deriveSceneGate = (
      planningTurnPlan: TurnPlanV3, authority: ProblemAuthorityV1Response | null,
    ): BenchSceneGate => {
      const gate = deriveProductionSceneGate({
        question, turnPlan: planningTurnPlan, problemIR: authority?.problemIR ?? null,
      });
      const diagramStrategy = labStrategyDecision(options.arm ?? "current", {
        subject: parseDiagramSubject(options.subject), chemistryLane: gate.chemistryLane,
        codeLesson: false, dsa: dsaClassification.isDsa, doubt: false,
        physicsMode: options.productionPhysicsMode, sceneSignal: { families: gate.families, archetypeId: gate.archetypeId },
      }, options.productionStrictSubjects, strategySubject);
      const examplesUsed = diagramStrategy.usePickedExamples ? pickedExamples : [];
      return {
        ...gate, diagramStrategy, examplesUsed,
        authorityBlocked: authority?.audit.status === "contradiction",
        request: {
          ...gate.request, ...(examplesUsed.length > 0 ? { workedExamples: examplesUsed } : {}),
          ...(options.sceneDeclinePolicy && options.sceneDeclinePolicy !== "unchanged" ? {
            planningGuidance: [...(gate.request.planningGuidance ?? []), ...sceneDeclineExperimentGuidance(options.sceneDeclinePolicy)],
          } : {}),
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
      signal: stopSignal,
      guard,
      problemAuthority: problemAuthorityPromise,
      // Speculation follows NEXT_PUBLIC_SCENE_SPECULATION like the live hook
      // (SCENE_SPECULATION_ENABLED, default off).
      speculationAllowed: true,
      selectionOrder: (gate) => gate.diagramStrategy.selectionOrder,
      plannerStartedAt,
      deadlineMs: scenePlannerDeadlineMs,
      deriveGate: deriveSceneGate,
      applyAuthority: (planToReconcile, authority) => {
        const sourcePlan = reconcileTurnPlanWithSolver(
          planToReconcile,
          authority.problemIR,
          authority.solverResult,
        );
        const reconciledPlan = applyVisualDecisionToPlan({
          question, turnPlan: sourcePlan, evaluated: assessment.decision, problemIR: authority.problemIR,
        });
        const authorityAudit = verifyTurnPlanAgainstSolver(
          authority.problemIR,
          authority.solverResult,
          reconciledPlan,
          question,
        );
        return {
          turnPlan: reconciledPlan,
          authority: {
            ...authority,
            audit: authorityAudit,
            projection:
              authorityAudit.status === "verified"
                ? buildSolverAuthorityProjection(
                    authority.problemIR,
                    authority.solverResult,
                    authorityAudit,
                  )
                : null,
          },
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
      planScene: (gate, planningTurnPlan, sceneRun) => {
        // A held speculative run has no final authority. Do not add a prefix
        // on deterministic/no-planner paths, or on a numeric contradiction.
        assertUnstopped();
        prefixController?.start({ enabled: parallelEnabled && acceptedPrefix === null,
          speculative: Boolean(sceneRun.holdValidationUntil),
          blocked: gate.authorityBlocked || sceneRun.signal.aborted,
          // The overlap coordinator already admitted this exact callback,
          // including planner-first lanes without a known family/archetype.
          // Re-deriving admission here would drift from that authority.
          scenePlanned: true,
        });
        return planSceneDocumentWithRepair(
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
            onRequestOutcome: (outcome) => { if (!stopSignal?.aborted) run.diagram.plannerCallOutcomes?.push(outcome); },
            onResponse: (response) => { if (!stopSignal?.aborted) recordPlannerResponse(run.diagram, response); },
            onCandidateValidation: (response, validation) => { if (!stopSignal?.aborted) recordValidation(response, validation, "initial"); },
            onRepairRequest: (request) => { if (!stopSignal?.aborted) (run.diagram.plannerRepairRequests ??= []).push(request); },
            ...gate.request,
          },
        ).catch(() => null);
      },
      revalidate: (sceneResult, authoritativeTurnPlan) =>
        revalidateScenePlanWithRepairResult(sceneResult, (candidate) =>
          validateCandidateAgainstPlan(candidate, authoritativeTurnPlan),
          (response, validation) => recordValidation(response, validation, "authority_revalidation"),
        ),
      complete: process.env.NEXT_PUBLIC_EXPERIMENTAL_SCENE_COMPLETENESS === "1" ? (gate, sceneResult, authoritativeTurnPlan, round) =>
        completeScenePlanWithRepairResult(
          question,
          sceneResult,
          (candidate) => validateCandidateAgainstPlan(candidate, authoritativeTurnPlan),
          {
            proxyUrl: plannerUrl,
            signal: round.signal,
            remainingMs: round.remainingMs,
            requestBudget: round.requestBudget,
            fastMode,
            traceId,
            onRequestOutcome: (outcome) => run.diagram.plannerCallOutcomes?.push(outcome),
            onResponse: (response) => recordPlannerResponse(run.diagram, response),
            onCandidateValidation: (response, validation) => recordRejectedOperatorCalls(run.diagram, response, validation, "completeness"),
            ...gate.request,
          },
        ) : undefined,
    });
    assertUnstopped();
    run.diagram.completeness = planning.completeness;
    turnPlan = planning.turnPlan;
    if (run.visualNeed) run.visualNeed.finalRequirement = turnPlan.visualRequirement;
    problemAuthority = planning.authority;
    if (productionProfile) run.productionStrategy = {
      ...strategyRecord(planning.gate.diagramStrategy), pickerDecision: strategyRecord(pickerDecision),
    };
    const { sceneCapabilities, shouldPlanExactScene, shouldAttemptLlmScene } = planning.gate;
    const fastRepresentation = planning.fast;
    const result = planning.scene;
    // The singular field belongs to the selected candidate, never to a fallback diagnostic.
    const selectedEvidence = createPlannerEvidence();
    if (result) recordPlannerResponse(selectedEvidence, result.response);
    run.diagram.plannerDeclineReason = selectedEvidence.plannerDeclineReason;
    run.diagram.plannerResponses = result?.candidates.map((candidate) => ({
      phase: candidate.response.phase, lane: candidate.response.lane,
      selected: candidate.selected, rawContent: candidate.response.rawContent,
      requestContext: candidate.response.requestContext,
      validation: { valid: candidate.validation.valid, errors: candidate.validation.errors },
    })) ?? [];
    run.diagram.archetypeId = planning.gate.archetypeId;
    run.diagram.examplesUsed = planning.gate.examplesUsed.map(({
      id,
      sourceKind,
      question: exampleQuestion,
      depicts,
      figureKind,
      family,
      archetype,
    }) => ({
      id,
      sourceKind,
      question: exampleQuestion,
      depicts,
      figureKind,
      family,
      archetype,
    }));
    Object.assign(stages, {
      deterministicFigureMs: planning.timings.deterministicFigureMs,
      scenePlannerMs: planning.timings.scenePlannerMs,
      revalidateMs: planning.timings.revalidateMs,
      completenessMs: planning.timings.completenessMs,
      plannerCalls: planning.timings.plannerCalls,
      deadlineRemainingMs: planning.attempts.deadlineRemainingMs,
      speculative: planning.speculation.kept,
      restarted: planning.speculation.restarted,
      speculationAbort: planning.speculation.abortReason,
    });

    const solverAuthorityBlocked = problemAuthority?.audit.status === "contradiction";
    const value =
      !solverAuthorityBlocked && result?.validation.valid ? result.validation.value : undefined;
    run.diagram.plannerDeclined = value?.document.visualDecision.mode === "text_only";
    run.diagram.candidateErrorCodes = Array.from(
      new Set(
        result?.candidates.flatMap((candidate) =>
          candidate.validation.errors
            .filter((issue) => issue.severity === "fatal")
            .map((issue) => issue.code),
        ) ?? [],
      ),
    );
    run.diagram.candidateCount = result?.candidates.length ?? 0;
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

    assertUnstopped();
    const sceneSelectionInput: Parameters<typeof selectProductionScene>[0] = {
      question, turnPlan, problemIR: problemAuthority?.problemIR ?? null, sceneCapabilities,
      candidateValidation: result?.validation, fastRepresentation,
      exactFigureSource: planning.figureSource === "verified_recovery" ? "verified_recovery" : "planner",
      solverAuthorityBlocked, requiredRetryEnabled: REQUIRED_DIAGRAM_RETRY_ENABLED,
      policy: {
        preferPlanner: planning.gate.diagramStrategy.strategy === "strict",
        allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(planning.gate.diagramStrategy, source)),
      },
    };
    run.figureReplayInputs = structuredClone({
      schemaVersion: "lecture-figure-replay-inputs/v1",
      selection: sceneSelectionInput,
      authority: problemAuthority ? {
        solverResult: problemAuthority.solverResult,
        audit: problemAuthority.audit,
        projection: problemAuthority.projection,
      } : null,
      authorityAttempted: problemAuthorityPromise !== null,
    });
    const sceneSelection = selectProductionScene(sceneSelectionInput);
    sceneDecisionFinished = true;
    // Never hold the verified path for a slow prefix. Late output is aborted
    // and cannot enter history, useful-time measurements or the lesson.
    const finishedPrefix = prefixController?.finishScene() ?? null;
    acceptedPrefix = acceptedPrefix ?? finishedPrefix;
    if (prefixEvidence && prefixController) Object.assign(prefixEvidence, prefixController.snapshot());
    const selected = sceneSelection.representation;
    const attempted = sceneSelection.attemptedRepresentation;
    const sceneDocument = selected?.sceneDocument ?? null;
    const renderScene = selected?.renderScene ?? null;
    const figureFamily = selected?.family ?? null;
    run.diagram.primitiveCount = attempted?.renderScene.primitives.length ?? 0;
    run.diagram.declinedUnreadable = Boolean(attempted && !sceneSelection.hasReadableInk && run.diagram.primitiveCount > 0);
    run.diagram.tier = selected?.tier ?? null;
    run.diagram.nonMetric = selected?.nonMetric ?? false;
    run.diagram.figureSource = selected?.figureSource ?? "text_only";
    run.diagram.reason = sceneSelection.reason;
    run.diagram.family = figureFamily;
    run.diagram.validationIssues = attempted?.validationReport.issues.map((issue) => ({
      code: issue.code, severity: issue.severity, message: issue.message,
    })) ?? [];
    if (attempted && !sceneSelection.sourceAllowed && sceneSelection.hasReadableInk) {
      run.diagram.suppressedFallback = { figureSource: attempted.figureSource, family: attempted.family ?? null };
    }
    // The live hook runs the same step (settleSelectionDegradation), and
    // verify-valid-candidate-parity executes the lines between these markers.
    // settle-selection-degradation:begin
    run.diagram.droppedCandidate = sceneSelection.droppedCandidate;
    const settledDegradation = settleSelectionDegradation({
      earlier: run.diagram.degradationReason ? { reason: run.diagram.degradationReason } : null,
      selection: sceneSelection, candidateCount: result?.candidates.length ?? 0,
    });
    run.diagram.degradationReason = settledDegradation.degradation?.reason ?? null;
    // settle-selection-degradation:end

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
    let presentation: ReturnType<typeof buildVerifiedDiagramPresentation> | null = null;
    let presentationRefused = false;
    try {
      presentation = renderScene && sceneDocument && "visualDecision" in sceneDocument
        ? buildVerifiedDiagramPresentation(
          sceneDocument,
          renderScene,
          { narrationLanguage: options.narrationLanguage, originalQuestion, ...(figureFamily ? { figureFamily } : {}) },
        ) : null;
    } catch (error) {
      if (!isVisualPresentationRefusal(error)) throw error;
      presentationRefused = true;
      run.diagram.tier = null;
      run.diagram.nonMetric = false;
      run.diagram.family = null;
      run.diagram.reason = "source_scoped_presentation_refused";
    }
    if (presentation && renderScene && sceneDocument && verifiedDiagramHasDrawableInk(presentation.diagram)) {
      activeDiagram = presentation.diagram;
      diagramPromptAddon = presentation.diagram.promptAddon;
      run.diagram.committed = true;
      run.timings.figureCommitMs = Date.now() - startedAt;
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
    } else {
      run.diagram.figureSource = "text_only";
    }
    run.diagram.candidateErrorCodes = supplementCandidateErrorCodes({
      committed: run.diagram.committed,
      visualRequirement: turnPlan.visualRequirement,
      primitiveCount: run.diagram.primitiveCount,
      candidateCount: run.diagram.candidateCount ?? 0,
      candidateErrorCodes: run.diagram.candidateErrorCodes,
    });
    run.diagram.emptyCause = presentationRefused ? "presentation_refused" : classifyDiagramEmptyCause({
      committed: run.diagram.committed,
      visualRequirement: turnPlan.visualRequirement,
      declinedUnreadable: run.diagram.declinedUnreadable,
      primitiveCount: run.diagram.primitiveCount,
      plannerCalls: planning.timings.plannerCalls,
      deadlineRemainingMs: planning.attempts.deadlineRemainingMs,
      candidateCount: result?.candidates.length ?? 0,
      candidateErrorCodes: run.diagram.candidateErrorCodes,
      fallbackSuppressed: run.diagram.suppressedFallback !== null,
      plannerDeclined: run.diagram.plannerDeclined,
    });

    if (options.figureOnly) {
      assertUnstopped();
      options.onPresentation?.({
        diagram: activeDiagram,
        opening: null,
        givens: [],
        intro: presentation?.introSegments ?? [],
      });
      run.timings.totalMs = Date.now() - startedAt;
      return run;
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
    const alreadyTaughtAddon = acceptedPrefix ?
      "\n\nThe exact narration-only STEP in history has already been taught. Continue after it without repeating its explanation or starting the lesson again. Count it as the first step of this same lesson budget. Keep this full verified teaching prompt, its actual figure/focus contract, and the remaining lesson intact." : "";
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
    assertUnstopped();
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
    const readinessParser = new IncrementalTagParser({
      preserveStepSpeech: true,
      onSegmentReady: (segment) => {
        if (!stopSignal?.aborted && run.timings.firstMainStepReadyMs === undefined && /[\p{L}\p{N}]/u.test(segment.narration)) {
          run.timings.firstMainStepReadyMs = Date.now() - startedAt;
        }
      },
    });
    while (continueCount <= MAX_LLM_CONTINUATIONS) {
      assertUnstopped();
      const isContinuation = continueCount > 0 && !reasoningOnlyRetry;
      const streamResult = await guard(streamLLMResponse({
        systemPrompt: isContinuation
          ? teachingPrompt.continuationPrompt + alreadyTaughtAddon
          : teachingPrompt.systemPrompt + alreadyTaughtAddon,
        userPrompt: isContinuation ? "continue" : question,
        conversationHistory: isContinuation
          ? [{ user: question, assistant: (acceptedPrefix?.raw ?? "") + fullResponse }]
          : parallelContinuationHistory(question, acceptedPrefix),
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
        signal: stopSignal,
      }, (delta) => { if (!stopSignal?.aborted) readinessParser.push(delta); }));
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
    readinessParser.flush();
    run.teaching.incomplete = incomplete;
    // The live turn repairs this same text before the pen and the voice, so
    // the grade is the lesson a student would have heard.
    fullResponse = repairLectureMarkup(fullResponse);
    // Parse the main response independently: an accepted prefix's STEP marker
    // must not hide a valid unmarked main response from the graded lesson.
    const blocks = stepBlocks(fullResponse);
    const parsedMain = parseDrawingCommands(fullResponse);
    const mainSteps = blocks.length > 0
      ? blocks.map((block, index) => {
          const parsed = parseDrawingCommands(block);
          return { index: index + 1, speech: parsed.narration.trim(), tags: parsed.commands.map(commandTags) };
        })
      : stepsFromSegments(parsedMain);
    fullResponse = (acceptedPrefix?.raw ?? "") + fullResponse;
    run.teaching.rawText = fullResponse;
    run.timings.teachMs = Date.now() - teachStartedAt;

    const parsedAll = parseDrawingCommands(fullResponse);
    run.teaching.usedStepMarkers = Boolean(acceptedPrefix) || blocks.length > 0;
    run.teaching.steps = acceptedPrefix
      ? [{ index: 1, speech: acceptedPrefix.narration, tags: [] },
          ...mainSteps.map(step => ({ ...step, index: step.index + 1 }))]
      : mainSteps;
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
    if (stopSignal?.aborted && error instanceof DOMException && error.name === "AbortError" &&
        parallelEnabled && !sceneDecisionFinished && checkpointIdentity) {
      const stoppedPrefix = prefixController?.finishScene() ?? null;
      acceptedPrefix = acceptedPrefix ?? stoppedPrefix;
      if (prefixEvidence && prefixController) Object.assign(prefixEvidence, prefixController.snapshot());
      run.stoppedWhileFigurePending = true;
      run.pendingFigureCheckpoint = createPendingFigureCheckpoint(checkpointIdentity, acceptedPrefix);
      run.teaching.rawText = acceptedPrefix?.raw ?? "";
      run.teaching.steps = acceptedPrefix ? [{ index: 1, speech: acceptedPrefix.narration, tags: [] }] : [];
      run.teaching.usedStepMarkers = Boolean(acceptedPrefix);
      run.teaching.incomplete = true;
      run.timings.totalMs = Date.now() - startedAt;
      // Pending work is neither a planner decline nor a verified diagram.
      // Freeze the returned receipt even if an uncooperative port finishes late.
      return structuredClone(run);
    }
    run.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (!run.diagram.committed && run.diagram.emptyCause === null) {
      run.diagram.emptyCause = Date.now() - startedAt >= scenePlannerDeadlineMs
        ? "deadline"
        : run.plan?.visualRequirement === "none"
          ? "not_needed"
          : "not_attempted";
    }
  }

  prefixController?.finishScene();
  if (prefixEvidence && prefixController) Object.assign(prefixEvidence, prefixController.snapshot());

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
