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
  type ScenePlannerRequestOutcome,
  type ScenePlanWithRepairResult,
  type SubjectFamiliarity,
  type TurnPlanRequestOutcome,
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
} from "@/features/tutor-session/lib/scene/productionSceneSelection";
import { diagramStrategyAllowsFigureSource, type DiagramStrategyDecision } from "@/features/tutor-session/lib/scene/diagramStrategy";
import { buildVerifiedDiagramPresentation } from "@/features/tutor-session/lib/scene/verifiedScenePresentation";
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
  examplePicker?: LectureExamplePickerRecord;
  /** Missing only on historical runs. Null votes mean unavailable evidence, never none. */
  visualNeed?: LabVisualNeedEvidence;
  productionStrategy?: LectureProductionStrategy;
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
    plannerResponses?: Array<{ phase: string; lane: string; selected: boolean; rawContent: string }>;
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

  try {
    const plannerStartedAt = Date.now();
    let turnPlan: TurnPlanV3;
    let problemAuthority: ProblemAuthorityV1Response | null = null;
    let pickedExamples: DiagramExemplar[] = [];
    const visualNeedPromise = options.visualNeedReplay === undefined
      ? fetchVisualNeedAssessment({ url: `${options.origin}/api/visual-need`, question, traceId })
      : Promise.resolve(options.visualNeedReplay);

    const turnPlanStartedAt = Date.now();
    const plannedTurn = await planTurnV3(question, {
      proxyUrl: plannerUrl,
      timeoutMs: TURN_PLAN_DEADLINE_MS,
      fastMode,
      traceId,
