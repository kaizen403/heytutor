import {
  LocalDeterministicSolverProvider,
  FIGURE_SOURCES,
  SCENE_ARTIFACTS_V3_VERSION,
  SCENE_ENGINE_VERSION,
  validateProblemIR,
  validateSceneQuantityAgreement,
  validateSolverResult,
  validateTurnPlanV3,
  verifyTurnPlanAgainstSolver,
  type SceneArtifactsV3,
  type FigureSource,
  type SceneDocument,
  type TurnPlanV3,
  type ValidationReport,
} from "@heytutor/scene-engine";
import {
  getSegmentCommands,
  isBlockedVerifiedDiagramCommand,
  isStoredCommandTrustedGeometry,
  withoutFocusKeep,
  parseFocusSpec,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import { codeLessonBlockById, type CodeLessonPlan } from "@heytutor/tutor-core";
import { admitLessonFigures, admitStoredScene, isRepresentationTier, withoutLegacyTeachingNotes } from "@/lib/scene/sceneAdmission";
import {
  isLessonFigureAdvanceId,
  lessonFiguresOf,
  resolveLessonFiguresEnabled,
  LESSON_FIGURE_IDS,
  type LessonFigureId,
  type LessonFiguresArtifact,
} from "@/lib/boards/lessonFigures";
import { canonicalRecordedWorkWrite } from "@/features/tutor-session/lib/board/workTextPresentation";
import { parseStoredCodeLesson } from "@/lib/code-lesson/persistedCodeLesson";
import { boardContinuationOf, type BoardContinuation } from "@/lib/boards/boardContinuation";
import { doubtFigureRefArtifacts, doubtFigureRefOf, type DoubtFigureKind, type DoubtFigureRef } from "@/lib/boards/doubtFigureRef";
import {
  composeDoubtFigureQuestion,
  doubtFigureArtifacts,
  doubtFigureOf,
  resolveDoubtFiguresEnabled,
  type DoubtFigureMarker,
} from "@/lib/boards/doubtFigure";
import type { TurnKind } from "@/lib/boards/turnStatus";
import type { DoubtFigurePageCheck, LessonFigureStartLoader, PageFigureLoader } from "@/lib/scene/pageFigureLoader";
import { resolveDoubtPointingEnabled } from "@/lib/scene/doubtPointingFlag";
import type { DiagramStrategy } from "@/features/tutor-session/lib/scene/diagramStrategy";
import { recordedDiagramSubject } from "@/features/tutor-session/lib/scene/verifiedSceneRecovery";
import type { DiagramSubject } from "@heytutor/tutor-core";
import { readFailedTurnTelemetry, type FailedTurnTelemetry } from "@/lib/obs/failedTurnTelemetry";
import {
  isReferencePictureRow,
  pointsAtReferencePicture,
  referencePictureIdOf,
  type ReferencePictureOutcome,
  type StoredReferencePicture,
} from "@/features/tutor-session/lib/scene/referencePicturePresentation";
import {
  canonicalReferencePictureRows,
  canonicalizeReferencePictureTurn,
  type ReferencePictureLoader,
} from "@/lib/scene/referencePicturePersistence";

export interface SubmittedTurnSegment {
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: unknown;
  durationMs?: number;
  timings?: unknown;
  /**
   * Set by canonicalization only: the submitted `orderIndex` whose uploaded
   * audio part belongs to this row, or null when the row was built on the
   * server and has no recording. Rows can move, so the audio lookup must not
   * use the canonical `orderIndex`.
   */
  sourceOrderIndex?: number | null;
}

export interface SubmittedTurnSceneMetadata {
  question: string;
  sceneDocument?: unknown;
  sceneEngineVersion?: string | null;
  validationReport?: unknown;
  visualStatus?: "validated" | "text_only" | "legacy" | "retry_required" | null;
  sceneArtifacts?: unknown;
  segments: SubmittedTurnSegment[];
}

/**
 * Scene artifacts as persisted for a turn. DSA turns additionally carry the
 * validated CodeLessonPlan so restored boards can rebuild the code panel and
 * type-along practice; it rides the same JSON column as the scene artifacts.
 * A doubt answered on the lesson's page carries the board continuation marker
 * there too, so replay and restore keep that page through it.
 */
export type PersistedSceneArtifacts = SceneArtifactsV3 & {
  codeLesson?: CodeLessonPlan;
  boardContinuation?: BoardContinuation;
  diagramStrategy?: DiagramStrategy;
  /** The plan subject the scene was drawn under; scene recovery refuses chemistry and unrecorded subjects. */
  diagramSubject?: DiagramSubject;
  failureTelemetry?: FailedTurnTelemetry & { pointsAtFigureStatus?: "unresolved" };
  /** A doubt on that page: the earlier turn whose figure it pointed at. */
  pointsAtFigure?: DoubtFigureRef;
  /** A doubt that drew its own figure in the zone (DIAGRAM_DOUBT_FIGURES). */
  doubtFigure?: DoubtFigureMarker;
  /** A text only turn that drew a stored reference picture: the server's own summary. */
  referencePicture?: StoredReferencePicture;
  /** A lesson's later figures (DIAGRAM_LESSON_FIGURES), each admitted on its own composed question. */
  lessonFigures?: LessonFiguresArtifact & { droppedFigureIds?: LessonFigureId[] };
  /** How this turn's reference picture attempt ended (telemetry only). */
  referencePictureOutcome?: ReferencePictureOutcome;
};

export interface CanonicalTurnSceneMetadata {
  sceneDocument: SceneDocument | null;
  sceneEngineVersion: string | null;
  validationReport: ValidationReport | null;
  visualStatus: "validated" | "text_only" | "retry_required";
  sceneArtifacts: PersistedSceneArtifacts | null;
  segments: SubmittedTurnSegment[];
}

/** Stable validator leaves; never built from submitted text or error details. */
export type TurnSceneRejectionCode =
  | "scene_question_required" | "scene_segments_invalid" | "scene_segment_order_invalid"
  | "scene_code_lesson_invalid" | "scene_unvalidated_trusted_geometry"
  | "scene_artifacts_missing" | "scene_artifacts_schema_invalid" | "scene_result_not_ready"
  | "scene_representation_tier_invalid" | "scene_non_metric_mismatch"
  | "scene_document_invalid" | "scene_turn_plan_invalid" | "scene_representation_not_scene"
  | "scene_source_question_mismatch" | "scene_document_tier_mismatch" | "scene_metric_geometry_outside_exact"
  | "scene_compile_failed" | "scene_proof_failed" | "scene_admission_failed" | "scene_validation_report_invalid"
  | "scene_point_line_annotation_invalid" | "scene_point_line_quantity_invalid"
  | "scene_point_line_solver_binding_required" | "scene_point_line_solver_evidence_invalid"
  | "scene_point_line_solver_quantity_mismatch" | "scene_solver_artifacts_incomplete"
  | "scene_problem_ir_invalid" | "scene_solver_result_invalid" | "scene_solver_recomputation_failed"
  | "scene_solver_values_mismatch" | "scene_solver_plan_contradiction"
  | "scene_teaching_envelope_invalid" | "scene_teaching_type_plan_required" | "scene_teaching_command_not_allowed"
  | "scene_doubt_figure_invalid";

type TurnSceneFailure = { ok: false; error: string; code?: TurnSceneRejectionCode };

export type TurnScenePersistenceResult =
  | { ok: true; value: CanonicalTurnSceneMetadata }
  | TurnSceneFailure;

/**
 * Re-establish every diagram trust claim at the server boundary. A browser may
 * submit a scene for persistence, but it cannot decide that geometry is safe
 * to replay with the uncompiled-diagram guards disabled.
 */
export async function canonicalizeTurnSceneMetadata(
  submittedMetadata: SubmittedTurnSceneMetadata,
  options: {
    loadReferencePicture?: ReferencePictureLoader;
    /** Bound by the save route to this turn's board, owner and id. */
    loadPageFigure?: PageFigureLoader;
    /**
     * Bound by the save route like `loadPageFigure`: does a doubt figure
     * belong to its page's lesson. Absent, no doubt figure is admitted.
     */
    checkDoubtFigurePage?: DoubtFigurePageCheck;
    /** The saved turn's kind; a doubt figure is admitted on a doubt only. */
    kind?: TurnKind;
    /** DIAGRAM_DOUBT_FIGURES at save time; read from the environment when absent. */
    doubtFiguresEnabled?: boolean;
    /** DIAGRAM_DOUBT_POINTING at save time; read from the environment when absent. */
    doubtPointingEnabled?: boolean;
    /** DIAGRAM_LESSON_FIGURES at save time; read from the environment when absent. */
    lessonFiguresEnabled?: boolean;
    /**
     * Bound by the save route like `loadPageFigure`: the lesson figure the
     * stored page had reached, which a resume's teaching starts on. Absent, a
     * resume starts on figure 1.
     */
    lessonFigureStart?: LessonFigureStartLoader;
  } = {},
): Promise<TurnScenePersistenceResult> {
  const question = submittedMetadata.question?.trim();
  if (!question) return failure("scene_question_required", "question is required for scene validation");
  if (!Array.isArray(submittedMetadata.segments)) return failure("scene_segments_invalid", "segments must be an array");
  if (!validSegmentOrder(submittedMetadata.segments)) {
    return failure("scene_segment_order_invalid", "segment orderIndex values must be unique non-negative integers");
  }
  const metadata: SubmittedTurnSceneMetadata = {
    ...submittedMetadata,
    sceneArtifacts: freshPageOnDoubtOnly(submittedMetadata.sceneArtifacts, options.kind),
    sceneDocument: withoutLegacyTeachingNotes(submittedMetadata.sceneDocument),
    segments: submittedMetadata.segments.map((segment) => ({
      ...segment,
      sourceOrderIndex: segment.orderIndex,
    })),
  };

  // A submitted plan that fails validation is rejected outright rather than
  // silently dropped: its TYPE segments would otherwise fail with a confusing
  // "command not allowed" error, and invalid code must never be persisted.
  const codeLessonParse = parseStoredCodeLesson(metadata.sceneArtifacts, question);
  if (codeLessonParse.status === "invalid") {
    return failure("scene_code_lesson_invalid", `persisted code lesson plan is invalid: ${codeLessonParse.reason}`);
  }
  const codeLesson = codeLessonParse.status === "valid" ? codeLessonParse.plan : null;

  if (metadata.visualStatus !== "validated") {
    // A reference picture is the one trusted ink a text only turn may keep,
    // and only as rebuilt here from the server's record for its id.
    const picture = await canonicalizeReferencePictureTurn(
      metadata.segments, metadata.sceneArtifacts, options.loadReferencePicture,
    );
    if (picture.segments.some((segment) =>
      isStoredCommandTrustedGeometry(segment.command) && !(picture.stored && isReferencePictureRow(segment.command, picture.stored.id)))) {
      return failure("scene_unvalidated_trusted_geometry", "trusted diagram commands require a server-validated scene");
    }
    // A doubt on the lesson's page names the turn whose figure it pointed at.
    // Its pointing is checked against that figure, loaded here from the
    // referenced turn's own row; one the server cannot load loses its
    // pointing and keeps its words. The reference never fails a save.
    const pageContinuation = boardContinuationOf(metadata.sceneArtifacts);
    const submittedRef = pageContinuation && !referencePictureIdOf(metadata.sceneArtifacts)
      ? doubtFigureRefOf(metadata.sceneArtifacts)
      : null;
    // doubt-lesson-figure-ref:begin
    // A lesson's later figure is named only while DIAGRAM_LESSON_FIGURES is
    // on at save time; off, the id is stripped and the doubt is checked
    // against the turn's own figure, as before.
    const pointsAtFigure = submittedRef?.figureId !== undefined && !(options.lessonFiguresEnabled ?? resolveLessonFiguresEnabled())
      ? doubtFigureRefOf(doubtFigureRefArtifacts({ schemaVersion: submittedRef.schemaVersion, turnId: submittedRef.turnId, kind: submittedRef.kind }))
      : submittedRef;
    // doubt-lesson-figure-ref:end
    // With DIAGRAM_DOUBT_POINTING off the live doubt filter strips kept rings
    // and ANNOTATE, so only a modified client sends them: they are not saved.
    const doubtRows = (options.kind === "doubt" || (options.kind === undefined && pointsAtFigure !== null)) &&
      !(options.doubtPointingEnabled ?? resolveDoubtPointingEnabled())
      ? withoutFlaggedDoubtPointing(picture.segments)
      : picture.segments;
    let pageFigure: VerifiedDiagram | null = null;
    // The figure is rebuilt only for rows that point at it: most doubt
    // checkpoints carry words alone and need no compile.
    const pointing = doubtRows.some((segment) => segment.command != null && !isStoredCommandTrustedGeometry(segment.command) &&
      parseStoredSegmentCommands(segment.command).some((command) => SCENE_POINTING_COMMANDS.has(command.type)));
    if (pointsAtFigure && pageContinuation && options.loadPageFigure && pointing) {
      try {
        pageFigure = await options.loadPageFigure(pointsAtFigure, {
          lessonQuestion: pageContinuation.lessonQuestion,
          ...((options.lessonFiguresEnabled ?? resolveLessonFiguresEnabled()) ? { lessonFigures: true as const } : {}),
        });
      } catch {
        pageFigure = null;
      }
    }
    const teachingCommands = pointsAtFigure
      ? canonicalizeTeachingCommands(
          doubtRows,
          pageFigure ? doubtCheckDiagram(pageFigure, pointsAtFigure.kind) : null,
          codeLesson,
          { kind: pointsAtFigure.kind },
        )
      : canonicalizeTeachingCommands(doubtRows, picture.diagram, codeLesson);
    if (!teachingCommands.ok) return teachingCommands;
    const retryRequired = metadata.visualStatus === "retry_required";
    const plan = validatedOptionalTurnPlan(metadata.sceneArtifacts, question);
    const degradation = validatedDegradation(metadata.sceneArtifacts);
    const figureSource = validatedFigureSource(metadata.sceneArtifacts);
    const diagramStrategy = validatedDiagramStrategy(metadata.sceneArtifacts);
    const completion = validatedCompletion(metadata.sceneArtifacts);
    const readTelemetry = readFailedTurnTelemetry(isRecord(metadata.sceneArtifacts) ? metadata.sceneArtifacts.failureTelemetry : undefined);
    const failureTelemetry: PersistedSceneArtifacts["failureTelemetry"] = pointsAtFigure && pointing && !pageFigure
      ? { ...(readTelemetry ?? { subject: "unknown" }), pointsAtFigureStatus: "unresolved" }
      : readTelemetry;
    // A doubt is saved text-only, and without this its marker went with the
    // rest of the artifacts: replay and restore then treated it as a page of
    // its own and dropped the lesson's figure under it.
    const continuation = boardContinuationOf(metadata.sceneArtifacts);
    // A validated plan is kept on its own too: a text-only lesson stopped and
    // reopened needs it for Continue and for a doubt on that page.
    const baseArtifacts = retryRequired || degradation || figureSource || codeLesson || continuation || diagramStrategy || plan || completion || failureTelemetry || picture.stored || picture.outcome
      ? minimalFailureArtifacts(
          plan,
          retryRequired ? "retry_required" : "text_only",
          degradation,
          figureSource,
          diagramStrategy,
          completion,
        )
      : null;
    return {
      ok: true,
      value: {
        sceneDocument: null,
        sceneEngineVersion: null,
        validationReport: null,
        visualStatus: retryRequired ? "retry_required" : "text_only",
        sceneArtifacts: baseArtifacts
          ? {
              ...baseArtifacts,
              ...(codeLesson ? { codeLesson } : {}),
              ...(continuation ? { boardContinuation: continuation } : {}),
              ...(pointsAtFigure ? { pointsAtFigure } : {}),
              ...(failureTelemetry ? { failureTelemetry } : {}),
              ...(picture.stored ? { referencePicture: picture.stored } : {}),
              ...(picture.outcome ? { referencePictureOutcome: picture.outcome } : {}),
            }
          : null,
        segments: teachingCommands.segments,
      },
    };
  }

  if (!isRecord(metadata.sceneArtifacts)) {
    return failure("scene_artifacts_missing", "validated scenes require scene-artifacts/v3");
  }
  if (metadata.sceneArtifacts.schemaVersion !== SCENE_ARTIFACTS_V3_VERSION) {
    return failure("scene_artifacts_schema_invalid", `validated scenes require ${SCENE_ARTIFACTS_V3_VERSION}`);
  }
  if (metadata.sceneArtifacts.diagramResultStatus !== "ready") {
    return failure("scene_result_not_ready", "validated scenes require diagramResultStatus ready");
  }
  const tier = metadata.sceneArtifacts.representationTier;
  if (!isRepresentationTier(tier)) return failure("scene_representation_tier_invalid", "validated scene has an invalid representation tier");
  const nonMetric = tier !== "exact_verified";
  if (metadata.sceneArtifacts.nonMetric !== nonMetric) {
    return failure("scene_non_metric_mismatch", "representation tier and nonMetric flag disagree");
  }

  // A doubt that drew its own figure was planned and verified on the lesson
  // question composed with the doubt, never on its title. Every scene check
  // below reads that recomputed question; Turn.question stays the title.
  const submittedDoubtFigure = doubtFigureOf(metadata.sceneArtifacts);
  const doubtContinuation = boardContinuationOf(metadata.sceneArtifacts);
  if (isRecord(metadata.sceneArtifacts) && metadata.sceneArtifacts.doubtFigure !== undefined) {
    if (!submittedDoubtFigure || options.kind !== "doubt" || !doubtContinuation?.lessonQuestion) {
      return failure("scene_doubt_figure_invalid", "a doubt figure needs a doubt turn on its lesson's page");
    }
    // Off at save time: a doubt that drew its figure while the flag was on
    // keeps its words rather than losing every later checkpoint.
    if (!(options.doubtFiguresEnabled ?? resolveDoubtFiguresEnabled())) {
      return doubtFigureAsText(submittedMetadata, doubtContinuation, options);
    }
  }
  const doubtFigure = submittedDoubtFigure && doubtContinuation ? submittedDoubtFigure : null;
  // The composed question comes from the client's lesson question: it is
  // admitted only when the stored page really is that lesson's. A figure that
  // is not keeps the doubt's words, as text on the lesson's page.
  if (doubtFigure && doubtContinuation) {
    let onPage = false;
    try {
      onPage = options.checkDoubtFigurePage
        ? await options.checkDoubtFigurePage(doubtFigure, { lessonQuestion: doubtContinuation.lessonQuestion })
        : false;
    } catch {
      onPage = false;
    }
    if (!onPage) return doubtFigureAsText(submittedMetadata, doubtContinuation, options);
  }
  const sceneQuestion = doubtFigure && doubtContinuation
    ? composeDoubtFigureQuestion(doubtContinuation.lessonQuestion, question)
    : question;

  const planResult = validateTurnPlanV3(metadata.sceneArtifacts.turnPlan, sceneQuestion);
  const turnPlan = planResult.plan;
  // The intro's ink is rebuilt here, and each part carries the word it is
  // drawn under. Rebuilt in English under a Hinglish recording, those words
  // were not in the stored sentence, so replay and export found no cue and
  // drew every part at the top of it. The voice is read from the recording.
  const narrationLanguage = metadata.segments.some((segment) =>
    isStoredCommandTrustedGeometry(segment.command) && /\p{Script=Devanagari}/u.test(segment.narration),
  ) ? "hinglish" as const : undefined;
  const admitted = admitStoredScene({
    sceneDocument: metadata.sceneDocument,
    sceneQuestion,
    turnPlan,
    submittedTier: tier,
    narrationLanguage,
    planSubmitted: metadata.sceneArtifacts.turnPlan != null,
    planIssues: planResult.issues,
  });
  if (!admitted.ok) return failure(admitted.code, admitted.message);
  const { document, presentation: expectedPresentation } = admitted;
  const { report } = admitted.compiled;
  // A turn that continues a page (a resume after Stop, or a doubt) teaches
  // under a figure an earlier turn on the page already drew. It keeps its
  // marker so restore, replay and notes keep the page, and the figure intro is
  // never inserted again into it.
  const continuation = boardContinuationOf(metadata.sceneArtifacts);
  // Scene-engine owns diagram ink at persist time. Client intro may be missing
  // or diverge under concurrent lecture-lab compiles; replay uses the server
  // reconstruction, never the browser's trusted-geometry payload.
  // A picture never rides a validated scene: its passes would be paired with
  // the scene intro's rows. Words stay, picture ink goes.
  const persistSegments = mergeServerDiagramIntro(
    canonicalReferencePictureRows(metadata.segments, null, { pictureTurn: false }).segments,
    expectedPresentation.introSegments,
    // A doubt's own figure is new on the page: its intro is inserted when missing.
    { insertMissing: continuation === null || doubtFigure !== null },
  );
  // lesson-figures:begin
  // A lesson's later figures are admitted one by one on their own composed
  // questions; a figure that fails is dropped. Off at save time, or on a doubt
  // figure or a code lesson, the artifact is stripped and nothing else changes.
  const submittedLessonFigures = lessonFiguresOf(metadata.sceneArtifacts);
  const lessonFigures = submittedLessonFigures && !doubtFigure && !codeLesson &&
    (options.lessonFiguresEnabled ?? resolveLessonFiguresEnabled())
    ? admitLessonFigures(submittedLessonFigures, { lessonQuestion: sceneQuestion, lessonPlan: metadata.sceneArtifacts.turnPlan, narrationLanguage, first: expectedPresentation.diagram })
    : null;
  // lesson-figures:end
  // lesson-figure-resume-start:begin
  // A resume teaches on the figure the page had reached (live reads the zone),
  // so its cursor starts there, not on figure 1: its FOCUS on figure k's parts
  // are checked against figure k, as replay resolves them (`pageFigureAt`).
  let resumeStart: LessonFigureId | null = null;
  if (lessonFigures && continuation && options.kind === "resume" && options.lessonFigureStart) {
    let reached: string = "figure_1";
    try {
      reached = await options.lessonFigureStart();
    } catch {
      reached = "figure_1";
    }
    resumeStart = isLessonFigureAdvanceId(reached) && lessonFigures.diagrams.has(reached) ? reached : null;
  }
  // lesson-figure-resume-start:end
  const teachingCommands = canonicalizeTeachingCommands(
    doubtFigure && !(options.doubtPointingEnabled ?? resolveDoubtPointingEnabled())
      ? withoutFlaggedDoubtPointing(persistSegments)
      : persistSegments,
    expectedPresentation.diagram,
    codeLesson,
    null,
    lessonFigures?.diagrams ?? null,
    resumeStart,
  );
  if (!teachingCommands.ok) return teachingCommands;

  const solver = await canonicalSolverArtifacts(metadata.sceneArtifacts, turnPlan, sceneQuestion);
  if (!solver.ok) return solver;
  for (const construction of document.constructions) {
    if (construction.operator !== "point_line_distance") continue;
    for (const outputId of construction.outputs) {
      const links = document.annotations.filter((annotation) =>
        ["label", "callout", "badge"].includes(annotation.kind) &&
        annotation.targetIds.includes(outputId) && annotation.quantityId !== undefined);
      const link = links[0];
      if (links.length !== 1 || !link || link.targetIds.length !== 1) {
        return failure("scene_point_line_annotation_invalid", "point-line distance requires one unambiguous quantity-backed output annotation");
      }
      const quantities = document.quantities.filter((quantity) => quantity.id === link.quantityId);
      const planned = turnPlan && [...turnPlan.givens, ...turnPlan.derived]
        .filter((quantity) => quantity.id === link.quantityId);
      if (quantities.length !== 1 || !turnPlan || !planned || planned.length !== 1) {
        return failure("scene_point_line_quantity_invalid", "point-line distance annotation requires a validated plan quantity");
      }
      const claimedResult = turnPlan.derived.some((quantity) => quantity.id === link.quantityId) ||
        turnPlan.unknowns.some((quantity) => quantity.id === link.quantityId);
      if (!claimedResult) continue;
      const bindings = solver.solverAuthority?.bindings.filter((binding) =>
        binding.quantityId === link.quantityId) ?? [];
      const binding = bindings[0];
      if (bindings.length !== 1 || !binding || typeof binding.approximate !== "number") {
        return failure("scene_point_line_solver_binding_required", "claimed point-line distance requires one explicit scalar solver result binding");
      }
      const request = solver.problemIR?.solveRequests.find((candidate) => candidate.id === binding.requestId);
      if (!request?.resultBinding || !request.resultBinding.evidenceFactIds.every((factId) =>
        solver.problemIR?.facts.some((fact) => fact.id === factId && fact.kind === "requested"))) {
        return failure("scene_point_line_solver_evidence_invalid", "claimed point-line distance solver binding requires requested-fact evidence");
      }
      const resultIssues = validateSceneQuantityAgreement(
        [{ id: binding.quantityId, value: binding.approximate, unit: binding.unit }],
        turnPlan,
      );
      if (resultIssues.length > 0) {
        return failure("scene_point_line_solver_quantity_mismatch", `point-line distance solver binding disagrees with TurnPlanV3: ${formatIssues(resultIssues)}`);
      }
    }
  }
  const candidateId = "server-revalidated-scene";
  const canonicalArtifacts: PersistedSceneArtifacts = {
    schemaVersion: SCENE_ARTIFACTS_V3_VERSION,
    turnPlan: turnPlan ?? null,
    problemIR: solver.problemIR,
    solverResult: solver.solverResult,
    solverAuthority: solver.solverAuthority,
    representationTier: tier,
    nonMetric,
    figureSource: validatedFigureSource(metadata.sceneArtifacts),
    diagramStrategy: validatedDiagramStrategy(metadata.sceneArtifacts),
    ...(recordedDiagramSubject(metadata.sceneArtifacts.diagramSubject)
      ? { diagramSubject: recordedDiagramSubject(metadata.sceneArtifacts.diagramSubject)! }
      : {}),
    failureTelemetry: readFailedTurnTelemetry(metadata.sceneArtifacts.failureTelemetry),
    candidates: [{
      candidateId,
      strategy: "server_revalidation",
      phase: "plan",
      accepted: true,
      sceneDocument: document,
      validationReport: report,
      score: 0,
      rejectionCodes: [],
    }],
    selectedCandidateId: candidateId,
    selectionReason: "revalidated against the current server engine before persistence",
    degradation: validatedDegradation(metadata.sceneArtifacts),
    completion: validatedCompletion(metadata.sceneArtifacts),
    proofObligations: document.assertions.map((assertion) => ({
      id: assertion.id,
      predicate: assertion.predicate,
      inputs: assertion.entities,
      expected: assertion.expected,
      severity: assertion.severity,
      reason: assertion.reason,
    })),
    visualReview: null,
    diagramResultStatus: "ready",
  };

  return {
    ok: true,
    value: {
      sceneDocument: document,
      sceneEngineVersion: SCENE_ENGINE_VERSION,
      validationReport: report,
      visualStatus: "validated",
      sceneArtifacts: codeLesson || continuation || lessonFigures
        ? {
            ...canonicalArtifacts,
            ...(codeLesson ? { codeLesson } : {}),
            ...(continuation ? { boardContinuation: continuation } : {}),
            ...(doubtFigure ? doubtFigureArtifacts(doubtFigure.replacedTurnId) : {}),
            ...(lessonFigures ? { lessonFigures: lessonFigures.artifact } : {}),
          }
        : canonicalArtifacts,
      segments: teachingCommands.segments,
    },
  };
}

async function canonicalSolverArtifacts(
  artifacts: Record<string, unknown>,
  turnPlan: TurnPlanV3 | null,
  question: string,
): Promise<
  | { ok: true; problemIR: SceneArtifactsV3["problemIR"]; solverResult: SceneArtifactsV3["solverResult"]; solverAuthority: SceneArtifactsV3["solverAuthority"] }
  | TurnSceneFailure
> {
  const hasProblem = artifacts.problemIR != null;
  const hasResult = artifacts.solverResult != null;
  if (!hasProblem && !hasResult) {
    return { ok: true, problemIR: null, solverResult: null, solverAuthority: null };
  }
  if (!hasProblem || !hasResult || !turnPlan) {
    return failure("scene_solver_artifacts_incomplete", "solver authority requires ProblemIR, SolverResult, and a valid TurnPlanV3");
  }
  const problemValidation = validateProblemIR(artifacts.problemIR, question);
  if (!problemValidation.problem) {
    return failure("scene_problem_ir_invalid", `persisted ProblemIR is invalid: ${formatIssues(problemValidation.issues)}`);
  }
  const submittedResult = validateSolverResult(artifacts.solverResult, problemValidation.problem);
  if (!submittedResult.result || submittedResult.result.status !== "solved") {
    return failure("scene_solver_result_invalid", `persisted SolverResult is invalid: ${formatIssues(submittedResult.issues)}`);
  }
  const controller = new AbortController();
  const recomputed = await new LocalDeterministicSolverProvider().solve(problemValidation.problem, {
    signal: controller.signal,
    deadlineMs: Date.now() + 5_000,
  });
  const recomputedValidation = validateSolverResult(recomputed, problemValidation.problem);
  if (!recomputedValidation.result || recomputedValidation.result.status !== "solved") {
    return failure("scene_solver_recomputation_failed", "the current deterministic solver could not reproduce the submitted result");
  }
  if (!sameSolverValues(submittedResult.result.values, recomputedValidation.result.values)) {
    return failure("scene_solver_values_mismatch", "submitted solver values differ from server recomputation");
  }
  const audit = verifyTurnPlanAgainstSolver(
    problemValidation.problem,
    recomputedValidation.result,
    turnPlan,
    question,
  );
  if (audit.status === "contradiction") {
    return failure("scene_solver_plan_contradiction", `solver authority contradicts TurnPlanV3: ${formatIssues(audit.issues)}`);
  }
  return {
    ok: true,
    problemIR: problemValidation.problem,
    solverResult: recomputedValidation.result,
    solverAuthority: audit,
  };
}

function isEpochClearSegment(segment: SubmittedTurnSegment): boolean {
  const commands = parseStoredSegmentCommands(segment.command);
  return (
    commands.length === 1 &&
    commands[0]?.type === "CLEAR" &&
    segment.narration.trim() === "" &&
    segment.spokenText.trim() === ""
  );
}

/**
 * Keep teaching WRITE/FOCUS and the runtime CLEAR; replace client diagram ink.
 *
 * Only the ink is replaced. Each spoken intro sentence stays where it was
 * spoken, with the audio, alignment and duration recorded for it: the opening
 * and the given rows are spoken before the figure, and moving the figure ahead
 * of them paired every one of those rows with its neighbour's recording.
 * `sourceOrderIndex` names the submitted row whose audio part a row owns;
 * server-only intro rows own none.
 */
function mergeServerDiagramIntro(
  submitted: SubmittedTurnSegment[],
  introSegments: TutorSegment[],
  options: { insertMissing: boolean } = { insertMissing: true },
): SubmittedTurnSegment[] {
  const serverIntro: SubmittedTurnSegment[] = introSegments.map((segment) => ({
    orderIndex: 0,
    narration: segment.narration,
    spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment), {
      trustedDiagramGeometry: true,
    }),
    sourceOrderIndex: null,
  }));
  const merged: SubmittedTurnSegment[] = [];
  let nextIntro = 0;
  let lastIntroPosition = -1;
  let leadingClearCount = 0;
  let seenInk = false;
  for (const segment of submitted) {
    if (!isStoredCommandTrustedGeometry(segment.command)) {
      if (!seenInk && isEpochClearSegment(segment)) leadingClearCount += 1;
      else seenInk = true;
      merged.push(segment);
      continue;
    }
    seenInk = true;
    const server = serverIntro[nextIntro];
    nextIntro += 1;
    merged.push(server
      ? { ...segment, command: server.command }
      // More spoken intro sentences than the server compile draws: keep the
      // words and their recording, drop the ink nobody verified.
      : { ...segment, command: null });
    lastIntroPosition = merged.length - 1;
  }
  const missing = options.insertMissing ? serverIntro.slice(nextIntro) : [];
  if (missing.length > 0) {
    const insertAt = lastIntroPosition >= 0 ? lastIntroPosition + 1 : leadingClearCount;
    merged.splice(insertAt, 0, ...missing);
  }
  return merged.map((segment, orderIndex) => ({ ...segment, orderIndex }));
}

/**
 * A doubt's rows as the live filter leaves them with DIAGRAM_DOUBT_POINTING
 * off: plain FOCUS stays, a kept ring becomes a plain FOCUS, ANNOTATE goes.
 * Trusted figure rows are untouched.
 */
function withoutFlaggedDoubtPointing(segments: SubmittedTurnSegment[]): SubmittedTurnSegment[] {
  return segments.map((segment) => {
    if (segment.command == null || isStoredCommandTrustedGeometry(segment.command)) return segment;
    const commands = parseStoredSegmentCommands(segment.command);
    if (!commands.some((command) => command.type === "ANNOTATE" || command.type === "FOCUS")) return segment;
    const kept = commands
      .filter((command) => command.type !== "ANNOTATE")
      .map((command) => command.type === "FOCUS" ? withoutFocusKeep(command) : command);
    return { ...segment, command: kept.length > 0 ? serializeSegmentCommands(kept, { trustedDiagramGeometry: false }) : null };
  });
}

// doubt-fresh-page:begin
/**
 * Only a doubt turns a fresh page (DIAGRAM_DOUBT_FIGURES, lane 9): the marker
 * is dropped from any other turn. On a doubt it is kept whatever becomes of
 * the doubt's figure: the student saw the page turn, and the doubt's rows
 * were laid out on the blank page, never over the lesson's.
 */
function freshPageOnDoubtOnly(sceneArtifacts: unknown, kind: TurnKind | undefined): unknown {
  if (kind === "doubt" || !isRecord(sceneArtifacts) || !isRecord(sceneArtifacts.boardContinuation) ||
    !("freshPage" in sceneArtifacts.boardContinuation)) return sceneArtifacts;
  const continuation: Record<string, unknown> = { ...sceneArtifacts.boardContinuation };
  delete continuation.freshPage;
  return { ...sceneArtifacts, boardContinuation: continuation };
}
// doubt-fresh-page:end

/**
 * A doubt figure the server will not admit, saved as the text doubt it would
 * have been without a figure: the words stay on the lesson's page, the
 * figure's ink and its marker go, and with them any FOCUS or ANNOTATE on it.
 */
async function doubtFigureAsText(
  submitted: SubmittedTurnSceneMetadata,
  continuation: NonNullable<ReturnType<typeof boardContinuationOf>>,
  options: Parameters<typeof canonicalizeTurnSceneMetadata>[1],
): Promise<TurnScenePersistenceResult> {
  const segments = submitted.segments.map((segment) => {
    if (segment.command == null) return segment;
    if (isStoredCommandTrustedGeometry(segment.command)) return { ...segment, command: null };
    const kept = parseStoredSegmentCommands(segment.command).filter((command) => !SCENE_POINTING_COMMANDS.has(command.type));
    return { ...segment, command: kept.length > 0 ? serializeSegmentCommands(kept, { trustedDiagramGeometry: false }) : null };
  });
  return canonicalizeTurnSceneMetadata({
    ...submitted,
    visualStatus: "text_only",
    sceneDocument: null,
    sceneArtifacts: { boardContinuation: continuation },
    segments,
  }, { ...options, loadPageFigure: undefined });
}

function minimalFailureArtifacts(
  turnPlan: TurnPlanV3 | null,
  status: "retry_required" | "text_only",
  degradation?: SceneArtifactsV3["degradation"],
  figureSource?: FigureSource,
  diagramStrategy?: DiagramStrategy,
  completion?: SceneArtifactsV3["completion"],
): PersistedSceneArtifacts {
  return {
    schemaVersion: SCENE_ARTIFACTS_V3_VERSION,
    turnPlan,
    problemIR: null,
    solverResult: null,
    solverAuthority: null,
    figureSource,
    diagramStrategy,
    candidates: [],
    selectedCandidateId: null,
    selectionReason: "partial and unverified scene data was removed before persistence",
    degradation,
    completion,
    proofObligations: [],
    visualReview: null,
    diagramResultStatus: status,
  };
}

function validatedCompletion(artifacts: unknown): SceneArtifactsV3["completion"] | undefined {
  if (!isRecord(artifacts) || !isRecord(artifacts.completion)) return undefined;
  const value = artifacts.completion;
  if (typeof value.adopted !== "boolean" || !Array.isArray(value.additions) || value.additions.length > 32 ||
      !Array.isArray(value.skipped) || value.skipped.length > 256 ||
      (value.rejection !== undefined && typeof value.rejection !== "string")) return undefined;
  const strings = (candidate: unknown): candidate is string[] =>
    Array.isArray(candidate) && candidate.length <= 256 && candidate.every(item => typeof item === "string");
  const additions: NonNullable<SceneArtifactsV3["completion"]>["additions"] = [];
  for (const addition of value.additions) {
    if (!isRecord(addition) || typeof addition.id !== "string" ||
        (addition.kind !== "given_label" && addition.kind !== "given_angle" && addition.kind !== "unknown_label" && addition.kind !== "right_angle") ||
        !strings(addition.quantityIds) || !strings(addition.targetIds) ||
        (addition.text !== undefined && typeof addition.text !== "string")) return undefined;
    additions.push({ id: addition.id, kind: addition.kind, quantityIds: [...addition.quantityIds], targetIds: [...addition.targetIds],
      ...(addition.text !== undefined ? { text: addition.text } : {}) });
  }
  const skipped: NonNullable<SceneArtifactsV3["completion"]>["skipped"] = [];
  for (const skip of value.skipped) {
    if (!isRecord(skip) || typeof skip.code !== "string" ||
        (skip.quantityId !== undefined && typeof skip.quantityId !== "string") ||
        (skip.entityIds !== undefined && !strings(skip.entityIds))) return undefined;
    skipped.push({ code: skip.code, ...(skip.quantityId !== undefined ? { quantityId: skip.quantityId } : {}),
      ...(skip.entityIds !== undefined ? { entityIds: [...skip.entityIds] } : {}) });
  }
  // Retain the record, but never use its claimed adoption or proposed marks to
  // establish trust. Geometry trust is re-established separately by this boundary.
  return { adopted: value.adopted, additions, skipped, ...(value.rejection !== undefined ? { rejection: value.rejection } : {}) };
}

function validatedDiagramStrategy(artifacts: unknown): DiagramStrategy | undefined {
  if (!isRecord(artifacts)) return undefined;
  return artifacts.diagramStrategy === "current" || artifacts.diagramStrategy === "strict"
    ? artifacts.diagramStrategy
    : undefined;
}

function validatedFigureSource(artifacts: unknown): FigureSource | undefined {
  if (!isRecord(artifacts)) return undefined;
  const sources = new Set<FigureSource>(FIGURE_SOURCES);
  return typeof artifacts.figureSource === "string" && sources.has(artifacts.figureSource as FigureSource)
    ? artifacts.figureSource as FigureSource
    : undefined;
}

function validatedDegradation(artifacts: unknown): SceneArtifactsV3["degradation"] | undefined {
  if (!isRecord(artifacts) || !isRecord(artifacts.degradation)) return undefined;
  const value = artifacts.degradation;
  const reasons = new Set([
    "planner_unavailable",
    "candidate_invalid",
    "missing_capability",
    "solver_contradiction",
    "required_visual_unavailable",
    "valid_candidate_dropped",
  ]);
  if (
    value.attemptedTier !== "exact_verified" ||
    typeof value.reason !== "string" ||
    !reasons.has(value.reason) ||
    !Number.isInteger(value.candidateCount) ||
    (value.candidateCount as number) < 0 ||
    (value.candidateCount as number) > 16 ||
    !Array.isArray(value.issueCodes)
  ) return undefined;
  const issueCodes = Array.from(new Set(value.issueCodes.filter((code): code is string =>
    typeof code === "string" && /^[a-z0-9_-]{1,64}$/i.test(code),
  ))).slice(0, 32);
  return {
    attemptedTier: "exact_verified",
    reason: value.reason as NonNullable<SceneArtifactsV3["degradation"]>["reason"],
    issueCodes,
    candidateCount: value.candidateCount as number,
  };
}

function validatedOptionalTurnPlan(artifacts: unknown, question: string): TurnPlanV3 | null {
  if (!isRecord(artifacts)) return null;
  return validateTurnPlanV3(artifacts.turnPlan, question).plan;
}

/**
 * The page figure as a doubt's pointing is checked against it. A code lesson
 * frame is checked as a plain figure: on `code_lesson` a FOCUS names a frame
 * and passes unchecked, and a doubt never steps frames, so here it must name a
 * cell the frame drew.
 */
function doubtCheckDiagram(figure: VerifiedDiagram, kind: DoubtFigureKind): VerifiedDiagram {
  if (kind !== "dsa_frame") return figure;
  const plain = { ...figure };
  delete plain.layout;
  return plain;
}

/** A label the figure holds back until the lesson ends: no doubt letters it. */
function namesWithheldAnswer(command: DrawCommand, diagram: VerifiedDiagram): boolean {
  const requested = (command.text ?? command.semanticRef?.entityId ?? "").trim().toLowerCase();
  if (!requested) return false;
  return (diagram.deferredAnnotations ?? []).some((entry) =>
    (entry.revealAfter === "teaching_complete" || entry.revealAfterLesson === true) &&
    (entry.entityId.toLowerCase() === requested ||
      entry.entityId.split(",").some((id) => id.trim().toLowerCase() === requested)));
}

/**
 * Whether a doubt's pointing survives the save. Only FOCUS and ANNOTATE are
 * a doubt's to keep, and only when they resolve on the loaded page figure:
 * on a picture, the picture's own targets; ANNOTATE only on a verified scene,
 * never on an answer label. Everything else is filtered, never refused.
 */
function keepsDoubtPointing(command: DrawCommand, diagram: VerifiedDiagram | null, kind: DoubtFigureKind): boolean {
  if (!diagram) return false;
  if (command.type === "FOCUS") {
    if (isBlockedVerifiedDiagramCommand(command, diagram)) return false;
    return kind !== "reference_picture" || pointsAtReferencePicture(command, diagram);
  }
  if (command.type === "ANNOTATE") {
    return kind === "verified_scene" &&
      !isBlockedVerifiedDiagramCommand(command, diagram) &&
      !namesWithheldAnswer(command, diagram);
  }
  return false;
}

function canonicalizeTeachingCommands(
  segments: SubmittedTurnSegment[],
  diagram: Parameters<typeof isBlockedVerifiedDiagramCommand>[1],
  codeLesson: CodeLessonPlan | null = null,
  /** A doubt that names its page's figure: `diagram` is that figure, or null when it did not load. */
  doubt: { kind: DoubtFigureKind } | null = null,
  /**
   * A lesson's admitted later figures. A kept `[FOCUS:figure_k]` moves the
   * check diagram to figure k for every later command, forward only; an
   * advance to a figure not admitted is filtered like any stale FOCUS.
   */
  lessonFigures: ReadonlyMap<LessonFigureId, VerifiedDiagram> | null = null,
  /** A resume's starting figure: the one the page had reached (one of `lessonFigures`). */
  startFigure: LessonFigureId | null = null,
): { ok: true; segments: SubmittedTurnSegment[] } | TurnSceneFailure {
  const canonical: SubmittedTurnSegment[] = [];
  // lesson-figure-cursor:begin
  const start = startFigure && lessonFigures?.get(startFigure) ? startFigure : null;
  let checkDiagram = start ? lessonFigures!.get(start)! : diagram;
  let figureIndex = start ? LESSON_FIGURE_IDS.indexOf(start) : -1;
  const advanceOf = (candidate: DrawCommand): LessonFigureId | null => {
    if (!lessonFigures || candidate.type !== "FOCUS") return null;
    const spec = parseFocusSpec(candidate.semanticRef?.entityId ?? candidate.text);
    const target = spec.targetIds.length === 1 ? spec.targetIds[0]!.trim() : "";
    if (!isLessonFigureAdvanceId(target) || !lessonFigures.has(target)) return null;
    return LESSON_FIGURE_IDS.indexOf(target) > figureIndex ? target : null;
  };
  // lesson-figure-cursor:end

  for (const [segmentIndex, segment] of segments.entries()) {
    if (segment.command == null || isStoredCommandTrustedGeometry(segment.command)) {
      canonical.push({ ...segment });
      continue;
    }

    const commands = parseStoredSegmentCommands(segment.command);
    if (commands.length === 0 || commands.length > 16) {
      return failure("scene_teaching_envelope_invalid", `segment ${segment.orderIndex} has an invalid teaching command envelope`);
    }

    const normalized: DrawCommand[] = [];
    for (const command of commands) {
      // TYPE reveals pre-committed code, so it is only trustworthy alongside a
      // validated plan; its text is rebuilt from that plan, never taken from
      // the submission. A blockId the plan does not know is filtered like a
      // stale FOCUS target — the narration survives, nothing untrusted renders.
      if (isRecord(command) && command.type === "TYPE") {
        if (!codeLesson) {
          return failure("scene_teaching_type_plan_required", "TYPE commands require a persisted code lesson plan");
        }
        const rebuilt = canonicalTypeCommand(command, codeLesson);
        if (rebuilt) normalized.push(rebuilt);
        continue;
      }
      const runtimeClear =
        command?.type === "CLEAR" &&
        commands.length === 1 &&
        segmentIndex === 0 &&
        segment.orderIndex === 0 &&
        segment.narration.trim() === "" &&
        segment.spokenText.trim() === "" &&
        Array.isArray(command.params) &&
        command.params.length === 0;
      if (runtimeClear) {
        normalized.push({
          type: "CLEAR",
          params: [],
          charPosition: 0,
          narrationBefore: "",
        });
        continue;
      }

      const checked = canonicalTeachingCommand(command);
      const safeCommands = checked?.type === "WRITE" ? canonicalRecordedWorkWrite(checked) : checked ? [checked] : [];
      // A FOCUS that names an id absent from the committed diagram is a
      // teaching mismatch, not untrusted ink: filter the gesture and keep the
      // rest of the segment, mirroring the live prepareVerifiedLessonSegments
      // filter, so one stale id cannot drop the whole recording. Genuine
      // diagram ink (DRAW_*, LABEL, ERASE, …) and unknown ANNOTATE targets
      // still hard-fail below.
      // lesson-figure-advance:begin
      const advances = new Set<DrawCommand>();
      const allowed = safeCommands.filter((candidate) => {
        const advance = advanceOf(candidate);
        if (advance) {
          advances.add(candidate);
          figureIndex = LESSON_FIGURE_IDS.indexOf(advance);
          checkDiagram = lessonFigures!.get(advance)!;
          return true;
        }
        return doubt && SCENE_POINTING_COMMANDS.has(candidate.type)
          ? keepsDoubtPointing(candidate, checkDiagram, doubt.kind)
          : candidate.type !== "FOCUS" || !isBlockedVerifiedDiagramCommand(candidate, checkDiagram);
      });
      if (
        safeCommands.length === 0 ||
        normalized.length + allowed.length > 16 ||
        allowed.some((candidate) => !advances.has(candidate) && isBlockedVerifiedDiagramCommand(candidate, checkDiagram))
      ) {
      // lesson-figure-advance:end
        const type = isRecord(command) && typeof command.type === "string"
          ? command.type
          : "unknown";
        return failure(
          normalized.length + allowed.length > 16 ? "scene_teaching_envelope_invalid" : "scene_teaching_command_not_allowed",
          `teaching command ${type} is not allowed for persistence`,
        );
      }
      normalized.push(...allowed);
    }

    canonical.push({
      ...segment,
      command: serializeSegmentCommands(normalized),
    });
  }

  return { ok: true, segments: canonical };
}

/** A doubt's pointing at its page's figure: filtered on save, never a refusal. */
const SCENE_POINTING_COMMANDS = new Set<DrawCommand["type"]>(["POINT", "FOCUS", "FRAME", "ANNOTATE"]);

function canonicalTypeCommand(
  command: Record<string, unknown>,
  codeLesson: CodeLessonPlan,
): DrawCommand | null {
  if (!Array.isArray(command.params) || command.params.length !== 0) return null;
  const charPosition = command.charPosition;
  const narrationBefore = command.narrationBefore;
  if (
    !Number.isInteger(charPosition) ||
    (charPosition as number) < 0 ||
    (charPosition as number) > 10_000_000 ||
    typeof narrationBefore !== "string" ||
    narrationBefore.length > 8_000
  ) return null;

  // Resolved TYPE commands always carry the block id on semanticRef.entityId
  // (see resolveCodeLessonSegments); the text field holds code, never an id.
  const ref = isRecord(command.semanticRef) ? command.semanticRef : null;
  const blockId = typeof ref?.entityId === "string" ? ref.entityId.trim() : "";
  if (!blockId || blockId.length > 128) return null;

  const located = codeLessonBlockById(codeLesson, blockId);
  if (!located) return null;
  const shownChars = command.shownChars;
  if (shownChars !== undefined && (typeof shownChars !== "number" || !Number.isSafeInteger(shownChars))) return null;
  return {
    type: "TYPE",
    params: [],
    text: located.block.code,
    charPosition: charPosition as number,
    narrationBefore,
    semanticRef: { entityId: blockId },
    ...(shownChars === undefined ? {} : { shownChars: Math.max(0, Math.min(located.block.code.length, shownChars as number)) }),
  };
}

function canonicalTeachingCommand(command: unknown): DrawCommand | null {
  if (!isRecord(command) || !Array.isArray(command.params)) return null;
  if (!command.params.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return null;
  }
  const charPosition = command.charPosition;
  const narrationBefore = command.narrationBefore;
  if (
    !Number.isInteger(charPosition) ||
    (charPosition as number) < 0 ||
    (charPosition as number) > 10_000_000 ||
    typeof narrationBefore !== "string" ||
    narrationBefore.length > 8_000
  ) return null;

  if (
    command.type === "WRITE" &&
    command.params.length >= 2 &&
    command.params.length <= 3 &&
    typeof command.text === "string" &&
    command.text.length > 0 &&
    command.text.length <= 2_000
  ) {
    return {
      type: "WRITE",
      params: [...command.params] as number[],
      text: command.text,
      charPosition: charPosition as number,
      narrationBefore,
    };
  }

  if (
    command.type === "PAUSE" &&
    command.params.length === 1 &&
    command.params[0]! >= 0 &&
    command.params[0]! <= 60_000
  ) {
    return {
      type: "PAUSE",
      params: [...command.params] as number[],
      charPosition: charPosition as number,
      narrationBefore,
    };
  }

  // A frame advance is entirely runtime-owned: no coordinates, no text, no id.
  // It tells the replay to step the pre-compiled walk-through, which is only
  // ever rebuilt from the persisted scene, so there is nothing here that could
  // carry untrusted ink. Leaving it off this list rejected the whole turn with
  // "teaching command FRAME is not allowed for persistence", so every DSA
  // lesson that walked an example failed to save at all: no replay, no notes,
  // no board history, and no export.
  if (command.type === "FRAME" && command.params.length === 0) {
    return {
      type: "FRAME",
      params: [],
      charPosition: charPosition as number,
      narrationBefore,
    };
  }

  // A pointing move carries no coordinates and no ink: it names entities the
  // persisted scene already owns, and the replay resolves them the same way
  // the live board does. Leaving it off this list would reject the whole turn.
  if (
    command.type === "POINT" &&
    command.params.length === 0 &&
    typeof command.text === "string" &&
    command.text.trim().length > 0 &&
    command.text.length <= 160
  ) {
    return {
      type: "POINT",
      params: [],
      text: command.text.trim(),
      charPosition: charPosition as number,
      narrationBefore,
    };
  }

  if (command.type === "FOCUS" || command.type === "ANNOTATE") {
    // The live resolver gives an explicit semantic target precedence over
    // text, including its emphasis suffix. Persist that same target as text
    // so replay needs no client-owned reference or coordinate authority.
    const semanticTarget = isRecord(command.semanticRef) ? command.semanticRef.entityId : undefined;
    const target = semanticTarget ?? command.text;
    const limit = command.type === "FOCUS" ? 160 : 128;
    const providedTextValid = command.text === undefined || (
      typeof command.text === "string" && command.text.trim().length > 0 && command.text.length <= limit
    );
    if (
      command.params.length !== 0 ||
      typeof target !== "string" || target.trim().length === 0 || target.length > limit ||
      !providedTextValid
    ) return null;
    return {
      type: command.type,
      params: [],
      text: target.trim(),
      charPosition: charPosition as number,
      narrationBefore,
    };
  }

  if (
    command.type === "EMPHASIZE" &&
    command.params.length === 0 &&
    typeof command.text === "string" &&
    command.text.trim().length > 0 &&
    command.text.length <= 128
  ) {
    return {
      type: command.type,
      params: [],
      text: command.text.trim(),
      charPosition: charPosition as number,
      narrationBefore,
    };
  }

  return null;
}

function validSegmentOrder(segments: SubmittedTurnSegment[]): boolean {
  const seen = new Set<number>();
  return segments.every((segment) => {
    if (!Number.isInteger(segment.orderIndex) || segment.orderIndex < 0 || seen.has(segment.orderIndex)) {
      return false;
    }
    seen.add(segment.orderIndex);
    return true;
  });
}

function sameSolverValues(
  submitted: Array<{ requestId: string; exact?: unknown; approximate: number | number[]; errorBound: number }>,
  recomputed: Array<{ requestId: string; exact?: unknown; approximate: number | number[]; errorBound: number }>,
): boolean {
  const expected = new Map(recomputed.map((value) => [value.requestId, value]));
  return submitted.length === recomputed.length && submitted.every((value) => {
    const actual = expected.get(value.requestId);
    return Boolean(actual) && deepEqual(value.exact, actual!.exact) &&
      numericValueEqual(value.approximate, actual!.approximate, Math.max(value.errorBound, actual!.errorBound));
  });
}

function numericValueEqual(first: number | number[], second: number | number[], tolerance: number): boolean {
  if (typeof first === "number" && typeof second === "number") {
    return Math.abs(first - second) <= Math.max(1e-10, tolerance);
  }
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return false;
  return first.every((value, index) => Math.abs(value - second[index]!) <= Math.max(1e-10, tolerance));
}

function deepEqual(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first) && Array.isArray(second) && first.length === second.length &&
      first.every((value, index) => deepEqual(value, second[index]));
  }
  if (!isRecord(first) || !isRecord(second)) return false;
  const firstKeys = Object.keys(first).filter((key) => first[key] !== undefined).sort();
  const secondKeys = Object.keys(second).filter((key) => second[key] !== undefined).sort();
  return firstKeys.length === secondKeys.length && firstKeys.every((key, index) =>
    key === secondKeys[index] && deepEqual(first[key], second[key]),
  );
}

function formatIssues(issues: Array<{ code?: string; path?: string; message: string }>): string {
  return issues.slice(0, 4).map((issue) =>
    `${issue.code ?? issue.path ?? "invalid"}: ${issue.message}`,
  ).join("; ");
}

function failure(code: TurnSceneRejectionCode, error: string): { ok: false; error: string; code: TurnSceneRejectionCode } {
  return { ok: false, error, code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
