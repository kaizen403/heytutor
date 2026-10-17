import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  lessonNarrationText,
  IncrementalTagParser,
  anchorToTextRect,
  prepareVerifiedLessonSegments,
  type TutorSegment,
  cancelFrame,
  scheduleFrame,
} from "@heytutor/drawing";
import {
  streamLLMResponse,
  TEACHING_HEDGE_AFTER_MS,
  type TeachingAttemptKind,
  type TeachingStartupRetryReason,
  compactConversationHistory,
  tutorDebug,
  resolveApiUrl,
  planSceneDocumentWithRepair,
  revalidateScenePlanWithRepairResult,
  planTurnV3,
  subjectFromRejectedTurnPlanOutcomes,
  planAndSolveProblemV1,
  createFallbackTurnPlanV3,
  inferSceneCapabilities,
  normalizeTutorQuestion,
  questionRequiresVisual,
  classifyDsaQuestion,
  isExplanationOnlyDsaQuestion,
  dsaLessonIncludesCode,
  dsaOpeningPointIds,
  voiceSettingsForDelivery,
  planCodeLessonV1,
  type CodeLessonPlan,
  type DsaTeachingPolicy,
  type ProblemAuthorityV1Response,
  type SceneCandidateValidation,
  type ScenePlanWithRepairResult,
  type TurnPlanRequestOutcome,
  narrationLanguageForVoice,
} from "@heytutor/tutor-core";
import {
  SCENE_ENGINE_VERSION,
  FIGURE_SOURCES,
  type SceneAssertion,
  synthesizeDsaScene,
  applySectionFormulaAuthority,
  applySourceQuantityAuthority,
  reconcileTurnPlanWithSolver,
  type RenderScene,
  type SceneArtifactsV3,
  type FigureSource,
  type SceneDocument,
  type TurnPlanV3,
  type ValidationReport,
} from "@heytutor/scene-engine";
import { createTurnTelemetry, measureSceneCandidateValidation, measureSceneSelection } from "@/lib/obs/turnTelemetry";
import { pageLoadTiming } from "@/lib/obs/pageLoadTiming";
import { readFailedTurnTelemetry, sceneRequestFailureTelemetry, turnPlanFailureTelemetry, type FailedTurnTelemetry } from "@/lib/obs/failedTurnTelemetry";
import { boardNeedsGeneratedTitle } from "@/lib/boards/boardTitle";
import {
  fetchBoardDetail,
  requestBoardTitle,
  updateBoard,
} from "@/lib/boards/boardsClient";
import { DSA_DIAGRAM_ZONE, MAX_LLM_CONTINUATIONS, STREAM_SEGMENTS_LIVE } from "../../constants";
import {
  dropDiagramRects,
  registerBoardAnchor,
  workColumnRoom,
  workColumnRows,
} from "../../lib/board/boardLayout";
import {
  doubtPageRecord,
  doubtSegment,
  inheritedTeachingContext,
  lessonPageRecord,
  planDoubtPage,
  resumePageRecord,
  revealedCodeText,
} from "../../lib/turn/doubtTurn";
import {
  codeLessonResumeNote,
  createCodeLessonConductor,
  dsaSegmentNeedsFigure,
  fullyRevealedBlockIds,
} from "../../lib/code-lesson/codeLessonSegments";
import {
  resolveCodeLessonBoardContext,
  resolveDsaFrames,
  type CodeLessonBoardContext,
  type DsaFrameSet,
} from "../../lib/code-lesson/dsaFrames";
import { prettierSyntaxCheck } from "../../lib/code-lesson/prettierSyntaxCheck";
import { recordingAudioCaptureComplete, recordingAudioPersistenceComplete } from "../../lib/turn/recordingAudioCapture";
import { liveTurnSave, type LiveTurnHandle } from "../../lib/turn/liveTurnSave";
import { lessonResumeState } from "../../lib/turn/pausedLessonRestore";
import { buildEarlyLessonOpeningSegment, shouldStartEarlyLessonOpening } from "../../lib/turn/earlyLessonOpening";
import { isBenignTurnAbort } from "../../lib/turn/turnFailurePolicy";
import {
  FALLBACK_DSA_TEACHING_POLICY,
  fetchDsaTeachingPolicy,
} from "../../lib/code-lesson/dsaTeachingPolicyClient";
import { beginTurn, parseBillingFailureFromUnknown, rememberBillingFailure, type BillingFailure } from "@/lib/billing/billingClient";
import { studentBillingMessage } from "@/lib/billing/studentCopy";
import { buildVerifiedDiagramPresentation } from "../../lib/scene/verifiedScenePresentation";
import { fetchVisualNeed } from "../../lib/scene/visualNeedClient";
import { resolveSelectedVisualStatus, resolveVisualRequirement } from "../../lib/scene/visualRequirement";
import { verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import {
  buildDoubtTeachingPrompt,
  buildResumeTeachingPrompt,
  buildTurnTeachingPrompt,
  resumeLessonUserPrompt,
  resumeInkRetryUserPrompt,
} from "../../lib/turn/turnTeachingPrompt";
import { LectureMarkupBuffer } from "../../lib/turn/lectureCueRepair";
import { restoreVerifiedPresentationFromTurn } from "../../lib/scene/restoreVerifiedDiagram";
import {
  selectFastVerifiedRepresentation,
  type RepresentationTier,
} from "../../lib/scene/representationFallback";
import {
  deriveSceneGate as deriveProductionSceneGate, selectProductionScene, validateProductionSceneCandidate,
  settleSelectionDegradation,
  type ProductionSceneGate, type ValidatedSceneCandidate,
} from "../../lib/scene/productionSceneSelection";
import { refreshSolverAuthorityForPlan } from "../../lib/turn/refreshSolverAuthority";
import { runScenePlanningOverlap } from "../../lib/scene/planningOverlap";
import {
  diagramStrategyAllowsFigureSource,
  liveDiagramStrategyDecision,
  type DiagramStrategy,
} from "../../lib/scene/diagramStrategy";
import {
  pickLiveDiagramExampleIds,
  awaitLiveDiagramExamplePicker,
  scenePlannerUrlWithExampleIds,
} from "../../lib/scene/diagramExamplePickerClient";
import {
  SCENE_PLANNER_DEADLINE_MS,
  REQUIRED_DIAGRAM_RETRY_ENABLED,
  PROBLEM_AUTHORITY_DEADLINE_MS,
  TURN_PLAN_DEADLINE_MS,
  selectBestAvailableTurnPlan,
  turnPlanNeedsNumericAuthority,
} from "../../lib/scene/diagramGeneration";
import {
  findVerifiedSceneRecovery,
  forgetVerifiedScene,
  rememberVerifiedScene,
} from "../../lib/scene/verifiedSceneRecovery";
import {
  canStreamResumeRepair,
  createEmptySegmentPlanStats,
  createResumeInkGate,
  foldGluedSegment,
  isTeachingResponseIncomplete,
  normalizeSegmentForAlignment,
  shouldRepairResumeWithoutInk,
  shouldRestoreResumeOffer,
} from "../../lib/turn/segmentPlanning";
import type { TutorPhase } from "../../types";
import { isWhiteboardReadyToDraw } from "../../lib/board/whiteboardReady";
import { lessonAdmission } from "../../lib/turn/lessonOwnership";
import { currentPausedLesson } from "../../lib/turn/pausedLessonRestore";
import type { HandleQuestionOptions, TurnControlApi, UseTurnLifecycleParams } from "./types";

type PendingQuestionFlushState = {
  pendingQuestion: string | null;
  boardLoaded: boolean;
  hasWhiteboard: boolean;
  phase: TutorPhase;
  turnActive: boolean;
  pendingSegmentCount: number;
};

type TurnContinuationState = {
  turnGeneration: number;
  activeTurnGeneration: number;
  cancelled: boolean;
  aborted: boolean;
};

export function shouldFlushPendingQuestion(state: PendingQuestionFlushState): boolean {
  return Boolean(
    state.pendingQuestion?.trim() &&
      state.boardLoaded &&
      state.hasWhiteboard &&
      state.phase === "idle" &&
      !state.turnActive &&
      state.pendingSegmentCount === 0,
  );
}

export function canContinueTurnAfterAsync(state: TurnContinuationState): boolean {
  return (
    state.turnGeneration === state.activeTurnGeneration &&
    !state.cancelled &&
    !state.aborted
  );
}

export async function awaitCurrentTurn<T>(
  operation: Promise<T>,
  isCurrent: () => boolean,
): Promise<T> {
  const result = await operation;
  if (!isCurrent()) {
    throw new DOMException("turn cancelled", "AbortError");
  }
  return result;
}

/** A queued Ask older than this is not the click that started the turn. */
const QUEUED_ASK_TTL_MS = 60_000;

/**
 * Race a silent first teaching request with a reasoning-off copy. Off unless
 * NEXT_PUBLIC_TEACHING_HEDGE=1: a hedge spends a second paid teaching call,
 * and the per-turn call cap and billing for the losing request are owner
 * decisions.
 */
export const TEACHING_HEDGE_ENABLED = process.env.NEXT_PUBLIC_TEACHING_HEDGE === "1";

/** Where a turn leaves its save handle once billed, for `handleQuestion`'s finally. */
type LiveTurnSaveExit = { handle: LiveTurnHandle | null };

export function useQuestionHandler(
  params: UseTurnLifecycleParams,
  turnControl: Pick<
    TurnControlApi,
    | "finishLectureUi"
    | "enqueueSegment"
    | "enqueueVerifiedIntro"
    | "processResponseText"
    | "offerPausedLessonResume"
    | "clearPausedLesson"
  >,
) {
  const {
    sessionId,
    isDraft = false,
    commitDraftBoard,
    boards,
    narrationText,
    boardLoaded,
    whiteboardRef,
    pendingQuestionRef,
    phaseRef,
    cancelRef,
    isPausedRef,
    conversationHistoryRef,
    liveQuestionRef,
    boardPageRef,
    boardShowsStoppedReplayRef,
    setLiveTurnKind,
    turnActiveRef,
    turnGenerationRef,
    turnAbortRef,
    collectedSegmentsRef,
    recordedSegmentsRef,
    rawResponseRef,
    currentTraceIdRef,
    segmentChainRef,
    drawChainRef,
    turnStatsRef,
    segmentPlanStatsRef,
    fbdPhaseMarkedRef,
    fbdPhaseStartedRef,
    activeVerifiedDiagramRef,
    setActiveVerifiedDiagram,
    codeLessonControllerRef,
    boardLayoutRef,
    turnTelemetryRef,
    speedRef,
    fastModeRef,
    familiarityRef,
    voicePreferencesRef,
    pendingVoicePreferencesRef,
    ttsClientRef,
    teachingPrefsRef,
    storedTurnsRef,
    pendingSegmentCountRef,
    setInputInteracted,
    setLiveQuestion,
    setIsPaused,
    setIsReplaying,
    setLastError,
    setBoards,
    setPhase,
    setNarrationText,
    setCurrentSegmentText,
    ensureTTSClient,
    beginBoardEpoch,
    revokeUnreferencedReplayBlobUrls,
    onComplete,
    onError,
    onSpeechStartupStatus,
  } = params;

  const emitError = useCallback((error: { message: string; question: string; billing?: BillingFailure }) => {
    if (error.billing) rememberBillingFailure(error.billing);
    setLastError(error);
    onError?.(error);
  }, [setLastError, onError]);

  const {
    finishLectureUi,
    enqueueSegment,
    enqueueVerifiedIntro,
    processResponseText,
    offerPausedLessonResume,
    clearPausedLesson,
  } = turnControl;

  /**
   * The options a question was queued with while the board loaded, keyed to
   * that question: a doubt queued there must still run as a doubt, and a
   * question queued later (an auto-submit) must not inherit them.
   */
  const pendingQuestionOptionsRef = useRef<{
    question: string;
    options: HandleQuestionOptions;
  } | null>(null);
  /**
   * When a question queued behind the board load was asked; telemetry counts
   * from it. Only for the same board, and only for a minute: an older click
   * is a different visit.
   */
  const queuedAskRef = useRef<{ question: string; startedAt: number; boardId: string | null } | null>(null);

  /**
   * One question, from the Ask click to the end of the turn. `handleQuestion`
   * wraps it so every exit of a billed turn saves (see there).
   */
  const teachQuestion = useCallback(
    async (rawQuestion: string, options: HandleQuestionOptions | undefined, saveExit: LiveTurnSaveExit) => {
      // The turn's telemetry clock starts here, at the Ask click, not after
      // the commit, billing and epoch awaits below.
      const askStartedAt = performance.now();
      const question = normalizeTutorQuestion(rawQuestion);
      // Join the Ask click before any await. Committing the home board and
      // begin-turn used to run first (~1s); Chrome dropped the gesture,
      // AudioContext stayed suspended through planning, and the first spoken
      // beat fell through to silent speechSynthesis.
      ensureTTSClient().unlockAudio?.();
      // A doubt answers on the page it was asked about; see `lib/turn/doubtTurn`.
      const doubt = options?.doubt ?? null;
      // The rest of a lesson a mid-lesson doubt just paused. Mutually exclusive
      // with a doubt: the doubt answers first, then this turn continues.
      const resume = doubt ? null : (options?.resume ?? null);
      // The notes list a doubt under its own title. Under the lesson's question
      // it would stand in for the lesson's notes while it is being taught.
      setLiveQuestion?.(doubt ? doubt.title : question);
      if (!boardLoaded || !isWhiteboardReadyToDraw(whiteboardRef.current)) {
        pendingQuestionRef.current = question;
        pendingQuestionOptionsRef.current = options ? { question, options } : null;
        if (queuedAskRef.current?.question !== question || queuedAskRef.current.boardId !== (sessionId ?? null)) {
          queuedAskRef.current = { question, startedAt: askStartedAt, boardId: sessionId ?? null };
        }
        setInputInteracted(true);
        return;
      }
      const queuedAsk = queuedAskRef.current?.question === question &&
        queuedAskRef.current.boardId === (sessionId ?? null) &&
        askStartedAt - queuedAskRef.current.startedAt <= QUEUED_ASK_TTL_MS
        ? queuedAskRef.current
        : null;
      queuedAskRef.current = null;
      const askOrigin = queuedAsk?.startedAt ?? askStartedAt;
      if (
        phaseRef.current !== "idle" ||
        turnActiveRef.current ||
        pendingSegmentCountRef.current > 0
      ) {
        pendingQuestionRef.current = null;
        return;
      }

      pendingQuestionRef.current = null;
      // Suggestion clicks never go through the input bar, so a lesson started
      // from a card looked untouched until the turn finished saving.
      setInputInteracted(true);
      if (!doubt && !resume) {
        clearPausedLesson();
      }

      tutorDebug("turn", "question submitted", {
        question_preview: question.slice(0, 120),
        board_id: sessionId,
        turn_kind: doubt ? "doubt" : resume ? "resume" : "lesson",
      });

      // Read before anything below resets the turn buffers: which page the
      // doubt answers on. The turn it stopped was saved by its Stop (see
      // `liveTurnSave`), not here, so a doubt refused by billing loses nothing.
      const pageRecord = boardPageRef.current;
      const doubtPage = doubt
        ? planDoubtPage({
            record: pageRecord,
            boardId: sessionId,
            recordedSegmentCount: recordedSegmentsRef.current.length,
            storedTurnCount: storedTurnsRef.current.length,
            afterReplay: doubt.afterReplay,
            hasActiveFigure: Boolean(activeVerifiedDiagramRef.current),
          })
        : null;
      const inherited = doubt
        ? inheritedTeachingContext({
            record: pageRecord,
            boardId: sessionId,
            lessonQuestion: doubt.lessonQuestion,
            storedTurns: storedTurnsRef.current,
          })
        : null;
      const turnGeneration = turnGenerationRef.current + 1;
      turnGenerationRef.current = turnGeneration;
      onSpeechStartupStatus?.(null);
      cancelRef.current = false;
      isPausedRef.current = false;
      setIsPaused(false);
      setIsReplaying(false);
      setLastError(null);
      // A language switch made during the last question takes effect here,
      // before this one begins; from now until the turn ends a switch waits.
      const pendingVoice = pendingVoicePreferencesRef?.current;
      if (pendingVoice && voicePreferencesRef && pendingVoicePreferencesRef) {
        pendingVoicePreferencesRef.current = null;
        voicePreferencesRef.current = pendingVoice;
        ttsClientRef.current?.setVoicePreferences?.(pendingVoice);
      }
      // The voice speaking this turn decides the narration language, so the
      // words and the voice can never disagree.
      const turnNarrationLanguage = narrationLanguageForVoice(voicePreferencesRef?.current?.voiceKey);
      turnActiveRef.current = true;
      phaseRef.current = "thinking";
      const abortController = new AbortController();

      // The home board becomes real here: this question writes its row and
      // takes over the URL. Kicked off now, awaited before the board epoch, so
      // the thinking overlay is not waiting on a round trip.
      // A network failure here must not escape as an unhandled rejection: the
      // billing call just below fails on the same network and tells the student.
      const boardCommitStartedAt = performance.now();
      let boardCommitTotalMs: number | null = null;
      let boardCommitResult: "created" | "not_created" | "failed" | "not_called" = "not_called";
      const boardCommitted = (commitDraftBoard
        ? commitDraftBoard()
        : Promise.resolve(false)
      ).then((created) => {
        if (commitDraftBoard) {
          boardCommitTotalMs = Math.round(performance.now() - boardCommitStartedAt);
          boardCommitResult = created ? "created" : "not_created";
        }
        return created;
      }).catch(() => {
        boardCommitTotalMs = Math.round(performance.now() - boardCommitStartedAt);
        boardCommitResult = "failed";
        return false;
      });

      const boardIdForName = sessionId;
      if (boardIdForName) {
        const needsName = boardNeedsGeneratedTitle({
          isDraft,
          title: boards.find((b) => b.id === boardIdForName)?.title,
          persistedTurnCount: storedTurnsRef.current.length,
        });
        if (needsName) {
          // Naming waits on the commit: the row has to exist before it is named.
          void Promise.all([
            requestBoardTitle(doubt ? doubt.lessonQuestion : question),
            boardCommitted,
          ])
            .then(([title]) => {
              if (!title) return;
              void updateBoard(boardIdForName, { title }).then((board) => {
                if (!board) return;
                setBoards((prev) =>
                  prev.map((b) => (b.id === boardIdForName ? { ...b, title: board.title } : b)),
                );
              });
            })
            .catch(() => {
              // ignore — keep "new board" as fallback
            });
        }
      }
      turnAbortRef.current = abortController;
      let turnCancelled = false;
      // Same tick as the phase, so a doubt never shows a frame of blank paper.
      setLiveTurnKind?.(doubt ? "doubt" : resume ? "resume" : "lesson");
      setPhase("thinking");
      setNarrationText("");
      setCurrentSegmentText("");
      collectedSegmentsRef.current = [];
      recordedSegmentsRef.current = [];
      rawResponseRef.current = "";
      // Billing lineage only. After a reload nothing is in memory, so a resume
      // names the trace of the turn that stopped; it saves under its own.
      const previousTraceId = resume
        ? resume.parentTraceId ?? currentTraceIdRef.current ?? undefined
        : doubt ? currentTraceIdRef.current ?? undefined : undefined;
      currentTraceIdRef.current = crypto.randomUUID();
      segmentChainRef.current = Promise.resolve();
      drawChainRef.current = Promise.resolve();
      turnStatsRef.current = { drawMs: 0, ttsChars: 0 };
      segmentPlanStatsRef.current = createEmptySegmentPlanStats();
      revokeUnreferencedReplayBlobUrls();
      if (!doubt && !resume) {
        fbdPhaseMarkedRef.current = false;
        fbdPhaseStartedRef.current = false;
        activeVerifiedDiagramRef.current = null;
        setActiveVerifiedDiagram?.(null);
        codeLessonControllerRef?.current?.reset();
      } else if (doubt && !doubtPage?.figureOnPage && activeVerifiedDiagramRef.current) {
        // Planned but never drawn: the stopped lesson's figure intro had not
        // committed. A doubt pointing at it would trace parts the board lacks.
        activeVerifiedDiagramRef.current = null;
        setActiveVerifiedDiagram?.(null);
        dropDiagramRects(boardLayoutRef.current);
        fbdPhaseMarkedRef.current = false;
        fbdPhaseStartedRef.current = false;
      }
      // Every later save (turns, notes) addresses a board that now exists.
      const boardCommitWaitStartedAt = performance.now();
      await boardCommitted;
      // Replaced while the row was being written: the turn that superseded this
      // one owns the board, the page record and the live question now.
      if (turnGeneration !== turnGenerationRef.current) {
        return;
      }
      // Also where the commit wait ends: the generation check above is
      // synchronous, and gates keep it right after the await.
      const beginTurnStartedAt = performance.now();
      let billed: Awaited<ReturnType<typeof beginTurn>>;
      try {
        billed = await beginTurn({
          traceId: currentTraceIdRef.current!,
          kind: doubt ? "doubt" : resume ? "resume" : "lesson",
          parentTraceId: previousTraceId,
          signal: abortController.signal,
          ownsTurn: () =>
            turnGeneration === turnGenerationRef.current && !abortController.signal.aborted,
        });
      } catch {
        // Transport failures reject. Billing refusals and the 15s timeout return.
        // A stop aborts this signal and moves the generation before we resume.
        // The rejection text can include a URL, so it is not read or logged.
        if (turnGeneration === turnGenerationRef.current && !abortController.signal.aborted) {
          emitError({ message: "network error. check your connection", question });
          if (resume) offerPausedLessonResume(resume);
          finishLectureUi(turnGeneration);
        }
        return;
      }
      // Returned after stop or a newer turn: leave that lesson's error, latch, and page alone.
      if (turnGeneration !== turnGenerationRef.current || abortController.signal.aborted) {
        return;
      }
      if (!billed.ok) {
        const billing = {
          status: billed.status,
          code: billed.code,
          remaining: billed.remaining,
        };
        emitError({ message: studentBillingMessage(billed.code), question, billing });
        // Release this attempt. A newer generation is left running.
        if (resume) offerPausedLessonResume(resume);
        finishLectureUi(turnGeneration);
        return;
      }
      // Billed: from here every exit saves this turn (`handleQuestion`'s
      // finally, or Stop). The id is minted now; rows go out as they are taught.
      const liveSave = sessionId
        ? liveTurnSave().begin({
            owner: cancelRef,
            generation: turnGeneration,
            boardId: sessionId,
            traceId: currentTraceIdRef.current,
            kind: doubt ? "doubt" : resume ? "resume" : "lesson",
            question: doubt ? doubt.title : question,
            preview: doubt ? doubt.lessonQuestion : resume ? resume.lessonQuestion : question,
            speedMultiplier: speedRef.current,
            continuesBoard: doubt ? (doubtPage?.continuesBoard ?? false) : Boolean(resume),
          })
        : null;
      saveExit.handle = liveSave;
      // Read after the billing checks, which are synchronous: the gates keep
      // nothing between the begin-turn await and its refusal branch.
      const beginTurnMs = performance.now() - beginTurnStartedAt;
      // A doubt and a resume keep the page. Only a fresh lesson snapshots it
      // into the notes and clears it.
      let boardEpochMs: number | null = null;
      const boardEpochStartedAt = performance.now();
      if (!doubt && !resume) {
        await beginBoardEpoch();
        boardEpochMs = performance.now() - boardEpochStartedAt;
        if (turnGeneration !== turnGenerationRef.current) {
          return;
        }
        // A fresh page: nothing a stopped replay left is on the board now.
        boardShowsStoppedReplayRef.current = false;
      }
      // Set after the epoch: the page it captured belongs to the previous
      // question, and a doubt raised meanwhile still names the lesson it stops.
      liveQuestionRef.current = doubt
        ? doubt.lessonQuestion
        : resume
          ? resume.lessonQuestion
          : question;
      const page = doubt
        ? doubtPageRecord({
            boardId: sessionId,
            lessonQuestion: doubt.lessonQuestion,
            title: doubt.title,
            continuesBoard: doubtPage?.continuesBoard ?? false,
            figureDrawn: doubtPage?.figureOnPage ?? false,
            turnPlan: inherited?.turnPlan ?? null,
            solverProjection: inherited?.solverProjection ?? null,
          })
        : resume
          ? resumePageRecord({
              boardId: sessionId,
              lessonQuestion: resume.lessonQuestion,
              // Ink, not a plan: a figure Stop caught before its first beat is
              // drawn by this turn and marks the page when it commits.
              figureDrawn: resume.figureDrawn,
              turnPlan: resume.turnPlan,
              solverProjection: resume.solverProjection,
              scene: resume.scene,
            })
        : lessonPageRecord(sessionId, question);
      boardPageRef.current = page;
      const inheritedFailureTelemetry = readFailedTurnTelemetry(
        resume?.scene?.sceneArtifacts && typeof resume.scene.sceneArtifacts === "object"
          ? (resume.scene.sceneArtifacts as Record<string, unknown>).failureTelemetry : undefined,
      );
      page.failureTelemetry = { subject: inheritedFailureTelemetry?.subject ?? "other" };
      liveSave?.setPage(page);
      // What a Continue after a reload cannot rebuild from the saved turns.
      if (resume) liveTurnSave().setResumeState(cancelRef, turnGeneration, lessonResumeState(resume.solverProjection));

      const isCurrentTurn = () =>
        canContinueTurnAfterAsync({
          turnGeneration,
          activeTurnGeneration: turnGenerationRef.current,
          cancelled: cancelRef.current,
          aborted: abortController.signal.aborted,
        });
      const throwIfTurnCancelled = () => {
        if (!isCurrentTurn()) {
          throw new DOMException("turn cancelled", "AbortError");
        }
      };
      const setPhaseIfCurrent = (next: TutorPhase) => {
        if (!isCurrentTurn()) {
          return;
        }
        phaseRef.current = next;
        setPhase(next);
      };

      throwIfTurnCancelled();

      const tel = createTurnTelemetry({ originPerf: askOrigin });
      turnTelemetryRef.current = tel;
      const turnTraceId = currentTraceIdRef.current;
      if (turnTraceId) {
        tel.setTrace(turnTraceId, sessionId ?? undefined);
      }
      // A tab closed mid planning still sends what was measured so far. A turn
      // replaced or thrown before its flush lets go at the next page event.
      tel.watchPageLifecycle(
        () => turnTelemetryRef.current === tel && turnGeneration === turnGenerationRef.current,
      );
      // Durations only: no question text rides on startup telemetry.
      tel.mark("startup-ask", {
        pre_telemetry_ms: tel.durationMs(),
        queued_for_board_ms: queuedAsk ? Math.round(askStartedAt - queuedAsk.startedAt) : 0,
        board_commit_ms: Math.round(beginTurnStartedAt - boardCommitWaitStartedAt),
        // Full callback and remaining await overlap; never add these durations.
        // This is not a server-only POST/create duration. False may mean no draft.
        board_commit_total_ms: boardCommitTotalMs,
        board_commit_called: Boolean(commitDraftBoard),
        board_commit_result: boardCommitResult,
        begin_turn_ms: Math.round(beginTurnMs),
        board_epoch_ms: boardEpochMs === null ? null : Math.round(boardEpochMs),
        turn_kind: doubt ? "doubt" : resume ? "resume" : "lesson",
      });
      // `total_duration_ms` and every mark count from the Ask click now.
      tel.meta({
        telemetry_origin: "ask",
        diagram_strategy_assigned: billed.diagramStrategy,
        diagram_physics_mode: billed.diagramPhysicsMode ?? null,
        ...pageLoadTiming.claimFirstTurnMeta(askOrigin),
      });
      const thinkingSpan = tel.span("thinking");
      let thinkingEnded = false;

      const endThinking = (metadata?: Record<string, unknown>) => {
        if (thinkingEnded) {
          return;
        }

        thinkingEnded = true;
        thinkingSpan.end(metadata);
      };

      const wsSpan = tel.span("websocket-connect");
      let wsEnded = false;

      const endWsConnect = (metadata: Record<string, unknown>) => {
        if (wsEnded) {
          return;
        }

        wsEnded = true;
        wsSpan.end(metadata);
      };

      // Re-arm the graph the Ask click already held. Planning can last a
      // minute; this does not replace unlocking inside the gesture.
      const tts = ensureTTSClient();
      if (!isPausedRef.current) tts.unlockAudio?.();

      // The verified semantic scene engine is the only diagram generation path.
      setPhaseIfCurrent("planning");
      const plannerSpan = tel.span("planner");
      const plannerStartedAt = Date.now();

      void tts.prewarm({
        traceId: turnTraceId ?? undefined,
        sessionId: sessionId ?? undefined,
        onConnect: ({ ms, ok }) => {
          endWsConnect({
            latency_ms: Math.round(ms),
            ok,
          });
        },
      });

      let sceneV2Document: SceneDocument | Record<string, unknown> | null = null;
      let sceneV2Report: ValidationReport | null = null;
      let sceneV2RenderScene: RenderScene | null = null;
      let sceneV2IntroSegments: TutorSegment[] | null = null;
      /** The intro is the rest of a figure a Stop cut off: drawn, never saved. */
      let resumeIntroRemainder = false;
      let sceneVisualStatus: "validated" | "text_only" | "retry_required" = "text_only";
      let sceneV2Repaired = false;
      let sceneArtifacts: (SceneArtifactsV3 & { diagramStrategy?: DiagramStrategy }) | null = null;
      let representationTier: RepresentationTier | null = null;
      let representationNonMetric = false;
      let representationReason: string | null = null;
      let representationFamily: string | null = null;
      let figureSource: FigureSource = "text_only";
      let exactDegradation: NonNullable<SceneArtifactsV3["degradation"]> | undefined;
      let turnPlan: TurnPlanV3 | null = null;
      let problemAuthority: ProblemAuthorityV1Response | null = null;
      let turnPlanMs = 0;
      let sceneRequestFailure: Pick<FailedTurnTelemetry, "stage" | "code"> | undefined;

      const plannerUrl = resolveApiUrl("/api/chat");

      // DSA questions take the code-lesson lane: a pre-validated CodeLessonPlan
      // plus a deterministic structure diagram replace the numeric TurnPlanV3 /
      // solver pipeline. If the code planner fails (including its one repair
      // attempt), the question falls through to the standard lesson unchanged.
      let codeLesson: CodeLessonPlan | null = null;
      // Jev's choice counts only if it arrived before the teaching prompt is
      // built. The default policy is always a complete lesson.
      const dsaTeachingPolicy: { current: DsaTeachingPolicy | null } = { current: null };
      let dsaFrameSet: DsaFrameSet | null = null;
      let dsaProofAssertions: SceneAssertion[] = [];
      const dsaClassification = classifyDsaQuestion(resume?.lessonQuestion ?? question);
      const earlyOpeningStarted = STREAM_SEGMENTS_LIVE && shouldStartEarlyLessonOpening({
        kind: doubt ? "doubt" : resume ? "resume" : "lesson",
        isDsa: dsaClassification.isDsa,
        admitted: true,
        current: isCurrentTurn(),
        paused: isPausedRef.current,
      });
      let earlyOpeningWaitPhase: "planning" | "thinking" | null = earlyOpeningStarted ? "planning" : null;
      if (earlyOpeningStarted) {
        // Fixed acknowledgement only: figure selection and useful teaching
        // below still receive the same original inputs and authority gates.
        page.earlyOpeningStarted = true;
        liveTurnSave().setResumeState(cancelRef, turnGeneration, { v: 1, earlyOpeningOnly: true });
        tel.mark("early-lesson-opening-queued", { early_opening: true });
        tel.meta({ early_lesson_opening: true });
        enqueueSegment(buildEarlyLessonOpeningSegment(turnNarrationLanguage), turnGeneration);
        // The acknowledgement owns only its spoken beat, not the wait for
        // planning/teaching. A replaced turn must never reset its successor.
        void segmentChainRef.current.then(() => {
          if (earlyOpeningWaitPhase && phaseRef.current === "speaking") setPhaseIfCurrent(earlyOpeningWaitPhase);
        }, () => {});
      }
      let diagramSubject: import("@heytutor/tutor-core").DiagramSubject = "other";
      let diagramStrategySubject: import("@heytutor/tutor-core").DiagramSubject = "other";
      let diagramStrategyDecision = liveDiagramStrategyDecision({
        assignedStrategy: billed.diagramStrategy,
        subject: diagramStrategySubject,
        strictSubjects: billed.diagramStrictSubjects,
        physicsMode: billed.diagramPhysicsMode,
        chemistryLane: false,
        codeLesson: dsaClassification.isDsa,
        dsa: dsaClassification.isDsa,
        doubt: Boolean(doubt || resume),
      });
      tel.meta({ diagram_strategy: diagramStrategyDecision.strategy });
      if (resume && page.turn.scene) {
        const prior = page.turn.scene.sceneArtifacts;
        page.turn.scene = {
          ...page.turn.scene,
          sceneArtifacts: {
            ...(typeof prior === "object" && prior !== null && !Array.isArray(prior) ? prior : {}),
            diagramStrategy: diagramStrategyDecision.strategy,
          },
        };
      }
      const explanationOnlyDsa = dsaClassification.isDsa &&
        isExplanationOnlyDsaQuestion(resume?.lessonQuestion ?? question);
      // Resolve the walk-through first, so the program can be planned against
      // the algorithm the board will actually draw.
      let boardContext: CodeLessonBoardContext | null = null;
      // Fresh lessons and an undrawn code Continue use the same captured
      // plan and compiler authority. The page still withholds this planned
      // scene until the queued verified intro actually commits.
      let rebuildingCodeIntro = false;
      const rebuildCodeScene = () => {
        const capturedPlan = codeLesson;
        if (!capturedPlan) return false;
        const firstTraceFrame = dsaFrameSet?.scenes.frames[0] ?? null;
        const dsaScene = firstTraceFrame
          ? null
          : synthesizeDsaScene(capturedPlan.diagramHint, {
              question,
              compile: { viewport: DSA_DIAGRAM_ZONE },
            });

        if (dsaFrameSet && firstTraceFrame) {
          sceneV2Document = {
            ...firstTraceFrame.document,
            source: {
              ...firstTraceFrame.document.source,
              nonMetric: dsaFrameSet.nonMetric,
              representationTier: dsaFrameSet.tier,
            },
          };
          sceneV2RenderScene = firstTraceFrame.renderScene;
          sceneV2Report = firstTraceFrame.validationReport;
          sceneVisualStatus = "validated";
          representationTier = dsaFrameSet.tier;
          representationNonMetric = dsaFrameSet.nonMetric;
          representationReason = dsaFrameSet.reason;
          figureSource = "dsa_trace";
          dsaProofAssertions = firstTraceFrame.document.assertions;
          tutorDebug("planner", "dsa walk-through frames", {
            algorithm_id: dsaFrameSet.algorithmId,
            frame_source: dsaFrameSet.frameSource,
            frame_count: dsaFrameSet.frames.length,
            example_source: dsaFrameSet.exampleSource,
            structure: dsaFrameSet.structure,
          });
        } else if (dsaScene) {
          // Stamp the tier onto the source so the shared presentation names
          // and captions the figure like other qualitative representations.
          sceneV2Document = {
            ...dsaScene.document,
            source: {
              ...dsaScene.document.source,
              nonMetric: true,
              representationTier: dsaScene.tier,
            },
          };
          sceneV2RenderScene = dsaScene.renderScene;
          sceneV2Report = dsaScene.validationReport;
          sceneVisualStatus = "validated";
          representationTier = dsaScene.tier;
          representationNonMetric = true;
          representationReason = dsaScene.reason;
          figureSource = "dsa_trace";
          dsaProofAssertions = dsaScene.document.assertions;
        } else {
          // An unsupported hint never blocks the lesson: the code panel and
          // narration still teach, the canvas just stays empty.
          sceneVisualStatus = "text_only";
          sceneV2Document = null;
          sceneV2RenderScene = null;
          sceneV2Report = null;
          figureSource = "text_only";
          representationTier = null;
          representationNonMetric = false;
          dsaProofAssertions = [];
          representationReason = "dsa_hint_unsupported";
        }
        sceneArtifacts = {
          schemaVersion: "scene-artifacts/v3",
          turnPlan,
          problemIR: null,
          solverResult: null,
          solverAuthority: null,
          figureSource,
          diagramStrategy: diagramStrategyDecision.strategy,
          representationTier: representationTier ?? undefined,
          nonMetric: representationTier ? representationNonMetric : undefined,
          candidates: [],
          selectedCandidateId: null,
          selectionReason: representationReason ?? "code_lesson",
          diagramResultStatus: sceneVisualStatus === "validated" ? "ready" : "text_only",
          proofObligations: dsaProofAssertions.map((assertion) => ({
            id: assertion.id,
            predicate: assertion.predicate,
            inputs: [...assertion.entities],
            expected: assertion.expected,
            severity: assertion.severity === "warning" ? "warning" as const : "fatal" as const,
          })),
          budgets: {
            deadlineMs: SCENE_PLANNER_DEADLINE_MS,
            planMs: Date.now() - plannerStartedAt,
            candidatesMs: 0,
          },
        };
        tutorDebug("planner", "dsa scene synthesis", {
          structure: dsaScene?.structure ?? capturedPlan.diagramHint.structure ?? null,
          compiled: dsaScene !== null,
          primitive_count: dsaScene?.renderScene.primitives.length ?? 0,
        });
        return sceneVisualStatus === "validated";
      };

      if (resume) {
        turnPlan = resume.turnPlan;
        if (resume.codeLesson) {
          codeLesson = codeLessonControllerRef?.current?.getActivePlan() ?? null;
          dsaFrameSet = codeLessonControllerRef?.current?.frames.getSet() ?? null;
        }
        if (resume.scene) {
          sceneV2Document = (resume.scene.sceneDocument as SceneDocument | Record<string, unknown> | null) ?? null;
          sceneVisualStatus =
            resume.scene.visualStatus === "validated" || resume.scene.visualStatus === "retry_required"
              ? resume.scene.visualStatus
              : "text_only";
          sceneArtifacts = (resume.scene.sceneArtifacts as SceneArtifactsV3 | null) ?? null;
          figureSource = sceneArtifacts?.figureSource ?? "text_only";
        }
        if (codeLesson && !resume.figureDrawn) {
          rebuildingCodeIntro = true;
          rebuildCodeScene();
        }
      } else if (!doubt && dsaClassification.isDsa) {
        boardContext = resolveCodeLessonBoardContext(question);
        // New and Revision already have fixed motivation rules. Only Normal
        // needs a semantic choice, and it runs beside the code planner.
        if (familiarityRef.current === "normal") {
          void fetchDsaTeachingPolicy({
            url: resolveApiUrl("/api/dsa-teaching-policy"),
            question,
            familiarity: familiarityRef.current,
            technique: boardContext?.context.familyId ?? null,
            traceId: turnTraceId,
            signal: abortController.signal,
          }).then((policy) => {
            dsaTeachingPolicy.current = policy;
          });
        }
        const codeLessonResponse = await awaitCurrentTurn(
          planCodeLessonV1(question, {
            proxyUrl: plannerUrl,
            sessionId: sessionId ?? undefined,
            traceId: turnTraceId ?? undefined,
            signal: abortController.signal,
            timeoutMs: SCENE_PLANNER_DEADLINE_MS,
            fastMode: fastModeRef.current,
            syntaxCheck: prettierSyntaxCheck,
            ...(boardContext ? { context: boardContext.context } : {}),
          }).catch(() => null),
          isCurrentTurn,
        );
        codeLesson = codeLessonResponse?.plan ?? null;
        tutorDebug("planner", "code lesson lane", {
          classified: dsaClassification.confidence,
          language: dsaClassification.language,
          board_family: boardContext?.context.familyId ?? null,
          plan_accepted: codeLesson !== null,
          section_count: codeLesson?.sections.length ?? 0,
          elapsed_ms: codeLessonResponse?.elapsedMs ?? null,
        });
      }

      if (codeLesson && !resume) {
        turnPlan = createFallbackTurnPlanV3(question);
        dsaFrameSet = resolveDsaFrames(question, codeLesson.diagramHint, codeLesson);
        rebuildCodeScene();
      } else if (!doubt && !resume) {
        // A doubt or a resume plans nothing: the page already carries the
        // lesson's figure and rows, and the plan its numbers came from is
        // inherited below.
        const recentConversation = compactConversationHistory(
          conversationHistoryRef.current,
          { maxTurns: 3, lastAssistantChars: 400, olderAssistantChars: 180 },
        )
          .map((exchange) => `User: ${exchange.user}\nTutor: ${exchange.assistant}`)
          .join("\n\n");
        // A repeated phrase can refer to a different figure after prior turns.
        // Reuse of a context-free scene would skip both the contextual turn
        // planner and Jev's visual assessment for this follow-up.
        let recoveredScene = recentConversation
          ? null
          : findVerifiedSceneRecovery(question, storedTurnsRef.current, {
              boardId: sessionId,
            });
        let problemAuthorityPromise: Promise<ProblemAuthorityV1Response | null> | null = null;
        let visualNeedPromise: ReturnType<typeof fetchVisualNeed> | null = null;
        let diagramExampleIds: string[] = [];
        let diagramExamplePickerSettled = false;
        let diagramExamplePickerPromise: Promise<void> | null = null;
        let diagramExamplePickerWaitStartedAt: number | null = null;
        const startDiagramExamplePicker = (plan: TurnPlanV3) => {
          const gate = deriveProductionSceneGate({ question, turnPlan: plan, problemIR: null });
          const decision = liveDiagramStrategyDecision({
            assignedStrategy: billed.diagramStrategy,
            subject: diagramStrategySubject,
            strictSubjects: billed.diagramStrictSubjects,
            physicsMode: billed.diagramPhysicsMode,
            sceneSignal: { families: gate.families, archetypeId: gate.archetypeId },
            chemistryLane: gate.chemistryLane,
            codeLesson: false,
            dsa: dsaClassification.isDsa,
            doubt: false,
          });
          diagramStrategyDecision = decision;
          tel.meta({ diagram_strategy: decision.strategy });
          if (!decision.usePickedExamples || recoveredScene || plan.visualRequirement === "none") {
            diagramExamplePickerSettled = true;
            return;
          }
          const pickerSpan = tel.span("diagram-example-picker", "planner");
          diagramExamplePickerPromise = pickLiveDiagramExampleIds({
            question,
            plan,
            subject: diagramSubject,
            traceId: turnTraceId ?? undefined,
            sessionId: sessionId ?? undefined,
            signal: abortController.signal,
            fastMode: fastModeRef.current,
          }).then((picked) => {
            diagramExamplePickerSettled = true;
            diagramExampleIds = picked.ids;
            pickerSpan.end({
              status: picked.status,
              elapsed_ms: picked.elapsedMs,
              picked_count: picked.ids.length,
              critical_path_wait_ms: diagramExamplePickerWaitStartedAt === null ? 0 : Date.now() - diagramExamplePickerWaitStartedAt,
            });
          });
        };
        // ProblemIR runs alongside the visual decision and, when it is slow,
        // alongside speculative scene candidates; its span records its own cost.
        const traceProblemAuthority = (
          operation: Promise<ProblemAuthorityV1Response | null>,
        ): Promise<ProblemAuthorityV1Response | null> => {
          const problemIrSpan = tel.span("problem-ir", "planner");
          return operation.then(
            (authority) => {
              problemIrSpan.end({ ok: authority !== null });
              return authority;
            },
            (error: unknown) => {
              problemIrSpan.end({ ok: false });
              throw error;
            },
          );
        };

        if (recoveredScene) {
          turnPlan = recoveredScene.turnPlan;
          problemAuthorityPromise = traceProblemAuthority(planAndSolveProblemV1(question, turnPlan, {
            proxyUrl: plannerUrl,
            sessionId: sessionId ?? undefined,
            traceId: turnTraceId ?? undefined,
            signal: abortController.signal,
            timeoutMs: Math.min(PROBLEM_AUTHORITY_DEADLINE_MS, SCENE_PLANNER_DEADLINE_MS),
            fastMode: fastModeRef.current,
          }));
          tutorDebug("planner", "found verified scene recovery candidate", {
            source: recoveredScene.source,
          });
        } else {
          // Resolve visual need alongside the turn planner. Jev supplies no geometry.
          visualNeedPromise = fetchVisualNeed({
            url: resolveApiUrl("/api/visual-need"),
            question,
            conversationContext: recentConversation,
            traceId: turnTraceId,
            signal: abortController.signal,
          });
          const turnPlanStartedAt = Date.now();
          const turnPlanSpan = tel.span("turn-plan", "planner");
          const turnPlanOutcomes: TurnPlanRequestOutcome[] = [];
          // A cancelled or failed turn plan still closes its span.
          const closeTurnPlanSpanOnFailure = (error: unknown): never => {
            turnPlanSpan.end({ aborted: true });
            throw error;
          };
          const plannedTurn = await awaitCurrentTurn(planTurnV3(question, {
            proxyUrl: plannerUrl,
            sessionId: sessionId ?? undefined,
            traceId: turnTraceId ?? undefined,
            signal: abortController.signal,
            timeoutMs: TURN_PLAN_DEADLINE_MS,
            conversationContext: recentConversation,
            fastMode: fastModeRef.current,
