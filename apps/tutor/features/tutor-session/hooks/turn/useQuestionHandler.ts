import { useCallback, useEffect } from "react";
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
  tutorDebug,
  resolveApiUrl,
  planSceneDocumentWithRepair,
  revalidateScenePlanWithRepairResult,
  planTurnV3,
  planAndSolveProblemV1,
  createFallbackTurnPlanV3,
  inferSceneCapabilities,
  normalizeTutorQuestion,
  questionRequiresVisual,
  classifyDsaQuestion,
  planCodeLessonV1,
  type CodeLessonPlan,
  type ProblemAuthorityV1Response,
  type SceneCandidateValidation,
  type ScenePlanWithRepairResult,
} from "@heytutor/tutor-core";
import {
  ARCHETYPES,
  SCENE_ENGINE_VERSION,
  type SceneAssertion,
  compileSceneDocument,
  synthesizeDsaScene,
  detectArchetype,
  normalizeClaimedClosedRouteGeometry,
  normalizeClaimedParaxialReflectionGeometry,
  pruneDeadSceneEntities,
  pruneUnverifiedSceneAnnotations,
  validateSceneQuantityAgreement,
  validateSceneDocument,
  validateTurnPlanSceneProofs,
  buildSolverAuthorityProjection,
  reconcileTurnPlanWithSolver,
  verifyTurnPlanAgainstSolver,
  type RenderScene,
  type SceneArtifactsV3,
  type SceneDocument,
  type TurnPlanV3,
  type ValidationReport,
} from "@heytutor/scene-engine";
import { createTurnTelemetry } from "@/lib/obs/turnTelemetry";
import { enrichStoredSegmentsWithReplayAudio } from "@/lib/replay/replayTurns";
import {
  saveTurn,
  requestBoardTitle,
  updateBoard,
  withBoardEpochSegment,
  type StoredTurn,
} from "@/lib/boards/boardsClient";
import { DSA_DIAGRAM_ZONE, MAX_LLM_CONTINUATIONS, STREAM_SEGMENTS_LIVE } from "../../constants";
import { registerBoardAnchor } from "../../lib/board/boardLayout";
import {
  codeLessonResumeNote,
  createCodeLessonConductor,
} from "../../lib/code-lesson/codeLessonSegments";
import {
  resolveCodeLessonBoardContext,
  resolveDsaFrames,
  type CodeLessonBoardContext,
  type DsaFrameSet,
} from "../../lib/code-lesson/dsaFrames";
import { prettierSyntaxCheck } from "../../lib/code-lesson/prettierSyntaxCheck";
import { buildVerifiedDiagramPresentation } from "../../lib/scene/verifiedScenePresentation";
import { verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import { buildTurnTeachingPrompt } from "../../lib/turn/turnTeachingPrompt";
import {
  selectVerifiedRepresentation,
  type RepresentationTier,
} from "../../lib/scene/representationFallback";
import {
  finalizeScenePlanAfterAuthority,
  SCENE_PLANNER_DEADLINE_MS,
  PROBLEM_AUTHORITY_DEADLINE_MS,
  TURN_PLAN_DEADLINE_MS,
  selectBestAvailableTurnPlan,
} from "../../lib/scene/diagramGeneration";
import {
  findVerifiedSceneRecovery,
  forgetVerifiedScene,
  rememberVerifiedScene,
} from "../../lib/scene/verifiedSceneRecovery";
import {
  createEmptySegmentPlanStats,
  isTeachingResponseIncomplete,
} from "../../lib/turn/segmentPlanning";
import type { TutorPhase } from "../../types";
import { isWhiteboardReadyToDraw } from "../../lib/board/whiteboardReady";
import type { TurnControlApi, UseTurnLifecycleParams } from "./types";

/** The plan and the stem filter agree this question needs no picture. */
class NoFigureNeeded extends Error {
  constructor() {
    super("no figure needed");
    this.name = "NoFigureNeeded";
  }
}

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

export function useQuestionHandler(
  params: UseTurnLifecycleParams,
  turnControl: Pick<
    TurnControlApi,
    "finishLectureUi" | "applyTurnPhase" | "enqueueSegment" | "enqueueVerifiedIntro" | "processResponseText"
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
    storedTurnsRef,
    pendingSegmentCountRef,
    setInputInteracted,
    setLiveQuestion,
    setIsPaused,
    setIsReplaying,
    setLastError,
    setStoredTurnsCount,
    setBoards,
    setPhase,
    setNarrationText,
    setCurrentSegmentText,
    ensureTTSClient,
    beginBoardEpoch,
    persistTurnForReplay,
    registerReplayBlobUrl,
    revokeUnreferencedReplayBlobUrls,
    onComplete,
    onError,
  } = params;

  const emitError = useCallback((error: { message: string; question: string }) => {
    setLastError(error);
    onError?.(error);
  }, [setLastError, onError]);

  const { finishLectureUi, applyTurnPhase, enqueueSegment, enqueueVerifiedIntro, processResponseText } = turnControl;

  const handleQuestion = useCallback(
    async (rawQuestion: string) => {
      const question = normalizeTutorQuestion(rawQuestion);
      setLiveQuestion?.(question);
      if (!boardLoaded || !isWhiteboardReadyToDraw(whiteboardRef.current)) {
        pendingQuestionRef.current = question;
        setInputInteracted(true);
        return;
      }
      if (
        phaseRef.current !== "idle" ||
        turnActiveRef.current ||
        pendingSegmentCountRef.current > 0
      ) {
        pendingQuestionRef.current = null;
        return;
      }

      pendingQuestionRef.current = null;

      tutorDebug("turn", "question submitted", {
        question_preview: question.slice(0, 120),
        board_id: sessionId,
      });

      const turnGeneration = turnGenerationRef.current + 1;
      turnGenerationRef.current = turnGeneration;
      cancelRef.current = false;
      isPausedRef.current = false;
      setIsPaused(false);
      setIsReplaying(false);
      setLastError(null);
      turnActiveRef.current = true;
      phaseRef.current = "thinking";
      const abortController = new AbortController();

      // The home board becomes real here: this question writes its row and
      // takes over the URL. Kicked off now, awaited before the board epoch, so
      // the thinking overlay is not waiting on a round trip.
      const boardCommitted = commitDraftBoard
        ? commitDraftBoard()
        : Promise.resolve(false);

      const boardIdForName = sessionId;
      if (boardIdForName) {
        const needsName =
          isDraft ||
          boards.find((b) => b.id === boardIdForName)?.title === "new board";
        if (needsName) {
          // Naming waits on the commit: the row has to exist before it is named.
          void Promise.all([requestBoardTitle(question), boardCommitted])
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
      setPhase("thinking");
      setNarrationText("");
      setCurrentSegmentText("");
      collectedSegmentsRef.current = [];
      recordedSegmentsRef.current = [];
      rawResponseRef.current = "";
      currentTraceIdRef.current = null;
      segmentChainRef.current = Promise.resolve();
      drawChainRef.current = Promise.resolve();
      turnStatsRef.current = { drawMs: 0, ttsChars: 0 };
      segmentPlanStatsRef.current = createEmptySegmentPlanStats();
      revokeUnreferencedReplayBlobUrls();
      fbdPhaseMarkedRef.current = false;
      fbdPhaseStartedRef.current = false;
      activeVerifiedDiagramRef.current = null;
      setActiveVerifiedDiagram?.(null);
      codeLessonControllerRef?.current?.reset();
      // Every later save (turns, notes) addresses a board that now exists.
      await boardCommitted;
      await beginBoardEpoch();
      // Set after the epoch: the page it captured belongs to the previous
      // question, and a doubt raised meanwhile still names the lesson it stops.
      liveQuestionRef.current = question;

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

      const tel = createTurnTelemetry();
      turnTelemetryRef.current = tel;
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

      // Unlock WebAudio inside the submit gesture before any await — otherwise
      // planning (up to 8s) leaves AudioContext suspended and TTS is silent.
      const tts = ensureTTSClient();
      tts.unlockAudio?.();

      // The verified semantic scene engine is the only diagram generation path.
      setPhaseIfCurrent("planning");
      const plannerSpan = tel.span("planner");
      const plannerStartedAt = Date.now();

      void tts.prewarm({
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
      let sceneVisualStatus: "validated" | "text_only" | "retry_required" = "text_only";
      let sceneV2Repaired = false;
      let sceneArtifacts: SceneArtifactsV3 | null = null;
      let representationTier: RepresentationTier | null = null;
      let representationNonMetric = false;
      let representationReason: string | null = null;
      let representationFamily: string | null = null;
      let exactDegradation: NonNullable<SceneArtifactsV3["degradation"]> | undefined;
      let turnPlan: TurnPlanV3 | null = null;
      let problemAuthority: ProblemAuthorityV1Response | null = null;
      let turnPlanMs = 0;

      const plannerUrl = resolveApiUrl("/api/chat");

      // DSA questions take the code-lesson lane: a pre-validated CodeLessonPlan
      // plus a deterministic structure diagram replace the numeric TurnPlanV3 /
      // solver pipeline. If the code planner fails (including its one repair
      // attempt), the question falls through to the standard lesson unchanged.
      let codeLesson: CodeLessonPlan | null = null;
      let dsaFrameSet: DsaFrameSet | null = null;
      let dsaProofAssertions: SceneAssertion[] = [];
      const dsaClassification = classifyDsaQuestion(question);
      // Resolve the walk-through first, so the program can be planned against
      // the algorithm the board will actually draw.
      let boardContext: CodeLessonBoardContext | null = null;
      if (dsaClassification.isDsa) {
        boardContext = resolveCodeLessonBoardContext(question);
        const codeLessonResponse = await awaitCurrentTurn(
          planCodeLessonV1(question, {
            proxyUrl: plannerUrl,
            sessionId: sessionId ?? undefined,
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

      if (codeLesson) {
        turnPlan = createFallbackTurnPlanV3(question);
        // Prefer a real execution trace: when the algorithm catalog knows this
        // family we can run it on a concrete example and draw what it actually
        // did, frame by frame. Otherwise the planner's own hint steps are
        // compiled one figure per frame, which still keeps the board moving.
        // Only a hint that will not compile leaves a single static figure.
        dsaFrameSet = resolveDsaFrames(question, codeLesson.diagramHint, codeLesson);
        const firstTraceFrame = dsaFrameSet?.scenes.frames[0] ?? null;
        const dsaScene = firstTraceFrame
          ? null
          : synthesizeDsaScene(codeLesson.diagramHint, {
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
          dsaProofAssertions = dsaScene.document.assertions;
        } else {
          // An unsupported hint never blocks the lesson: the code panel and
          // narration still teach, the canvas just stays empty.
          sceneVisualStatus = "text_only";
          representationReason = "dsa_hint_unsupported";
        }
        sceneArtifacts = {
          schemaVersion: "scene-artifacts/v3",
          turnPlan,
          problemIR: null,
          solverResult: null,
          solverAuthority: null,
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
          structure: dsaScene?.structure ?? codeLesson.diagramHint.structure ?? null,
          compiled: dsaScene !== null,
          primitive_count: dsaScene?.renderScene.primitives.length ?? 0,
        });
      } else {
        const recentConversation = conversationHistoryRef.current
          .slice(-3)
          .map((exchange) => `User: ${exchange.user}\nTutor: ${exchange.assistant}`)
          .join("\n\n");
        let recoveredScene = findVerifiedSceneRecovery(question, storedTurnsRef.current, {
          boardId: sessionId,
        });
        let problemAuthorityPromise: Promise<ProblemAuthorityV1Response | null> | null = null;

        if (recoveredScene) {
          turnPlan = recoveredScene.turnPlan;
          problemAuthorityPromise = planAndSolveProblemV1(question, turnPlan, {
            proxyUrl: plannerUrl,
            sessionId: sessionId ?? undefined,
            signal: abortController.signal,
            timeoutMs: Math.min(PROBLEM_AUTHORITY_DEADLINE_MS, SCENE_PLANNER_DEADLINE_MS),
            fastMode: fastModeRef.current,
          });
          tutorDebug("planner", "found verified scene recovery candidate", {
            source: recoveredScene.source,
          });
        } else {
          const turnPlanStartedAt = Date.now();
          const plannedTurn = await awaitCurrentTurn(planTurnV3(question, {
            proxyUrl: plannerUrl,
            sessionId: sessionId ?? undefined,
            signal: abortController.signal,
            timeoutMs: TURN_PLAN_DEADLINE_MS,
            conversationContext: recentConversation,
            fastMode: fastModeRef.current,
          }), isCurrentTurn);
          if (plannedTurn) {
            const remainingAuthorityMs = Math.max(
              1_000,
              SCENE_PLANNER_DEADLINE_MS - (Date.now() - plannerStartedAt),
            );
            problemAuthorityPromise = planAndSolveProblemV1(question, plannedTurn.turnPlan, {
              proxyUrl: plannerUrl,
              sessionId: sessionId ?? undefined,
              signal: abortController.signal,
              timeoutMs: Math.min(PROBLEM_AUTHORITY_DEADLINE_MS, remainingAuthorityMs),
              fastMode: fastModeRef.current,
            });
          }
          // The turn-plan audit used to run here: a second LLM opinion on the
          // plan, awaited before the scene planner could start. Measured on
          // "Concave mirror, f = 15 cm, object at 20 cm" it cost 8.9s of a 37s
          // planning phase, on the critical path of every question, and
          // `selectBestAvailableTurnPlan` already fell back to the primary plan
          // whenever it timed out — so the lesson had to be correct without it
          // regardless. Taken off the live path on the owner's call (4 Sep
          // 2026) to cut time-to-first-word.
          //
          // This trades away one verification pass. What still guards the
          // numbers: `validateTurnPlanV3` (which catches a derived value
          // disagreeing with its own arithmetic), the independent
          // ProblemIR/solver authority below, and `verifyTurnPlanAgainstSolver`.
          // `auditTurnPlanV3` itself is untouched in tutor-core and keeps its
          // gate, so restoring it here is a one-line change.
          turnPlanMs = Date.now() - turnPlanStartedAt;
          turnPlan = selectBestAvailableTurnPlan(
            undefined,
            plannedTurn?.turnPlan,
            createFallbackTurnPlanV3(question),
            plannedTurn?.peerTurnPlans,
          );
        }

        // Await ProblemIR before family inference so the live exact path routes
        // circuit/river families from problem structure, not the English catalog.
        if (problemAuthorityPromise) {
          problemAuthority = await awaitCurrentTurn(problemAuthorityPromise, isCurrentTurn);
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
        const planContext = [
          recentConversation,
          `AUTHORITATIVE TURN PLAN V3\n${JSON.stringify(planningTurnPlan)}\nDo not contradict, replace, or independently recalculate these quantities and claims.`,
        ].filter(Boolean).join("\n\n");
        type ValidatedSceneCandidate = {
          document: SceneDocument;
          renderScene: RenderScene;
          report: ValidationReport;
        };
        const validateCandidateAgainstPlan = (
          candidate: Record<string, unknown>,
          authoritativePlan: TurnPlanV3,
        ): SceneCandidateValidation<ValidatedSceneCandidate> => {
          let validated = validateSceneDocument(pruneDeadSceneEntities(candidate));
          if (!validated.document) {
            return {
              valid: false,
              errors: validated.report.issues,
            };
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
            validated = validateSceneDocument(pruneDeadSceneEntities(
              constraintNormalized as unknown as Record<string, unknown>,
            ));
            if (!validated.document) {
              return {
                valid: false,
                errors: validated.report.issues,
              };
            }
          }
          const annotationPruned = pruneUnverifiedSceneAnnotations(validated.document, authoritativePlan);
          if (annotationPruned !== validated.document) {
            validated = validateSceneDocument(pruneDeadSceneEntities(
              annotationPruned as unknown as Record<string, unknown>,
            ));
            if (!validated.document) {
              return {
                valid: false,
                errors: validated.report.issues,
              };
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
                ? authoritativePlan.visualRequirement === "required" ? 100_000 : 10_000
                : 0) +
              compiledScene.report.issues.filter((issue) => issue.severity === "warning").length * 1_000 +
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
        const validateCandidate = (candidate: Record<string, unknown>) =>
          validateCandidateAgainstPlan(candidate, planningTurnPlan);
        let result: ScenePlanWithRepairResult<ValidatedSceneCandidate> | null = null;
        let usedVerifiedRecovery = false;
        if (shouldPlanExactScene && recoveredScene) {
          const validation = validateCandidate(
            recoveredScene.document as unknown as Record<string, unknown>,
          );
          if (validation.valid) {
            const response = {
              document: recoveredScene.document as unknown as Record<string, unknown>,
              rawContent: JSON.stringify(recoveredScene.document),
              phase: "plan" as const,
              lane: "primary" as const,
              elapsedMs: 0,
              strategy: `verified_scene_recovery:${recoveredScene.source}`,
            };
            result = {
              response,
              validation,
              repaired: false,
              candidates: [{
                candidateId: "verified-recovery-1",
                response,
                validation,
                score: validation.qualityScore ?? 0,
                selected: true,
              }],
            };
            usedVerifiedRecovery = true;
            tutorDebug("planner", "verified scene recovery accepted", {
              source: recoveredScene.source,
              primitive_count: validation.value?.report.stats.primitiveCount ?? 0,
            });
          } else {
            tutorDebug("planner", "verified scene recovery rejected by current engine", {
              source: recoveredScene.source,
              error_codes: validation.errors.map((error) => error.code),
            });
            forgetVerifiedScene(question, { boardId: sessionId });
            recoveredScene = null;
          }
        }
        if (!result && shouldPlanExactScene && remainingPlannerMs > 0) {
          // The archetype detector names the figure the question calls for
          // (its roles and required operators); the planner is told, so a
          // projectile is planned as a trajectory with components rather than
          // whatever the coarse family suggests.
          const archetype = detectArchetype(question, {
            turnPlan: planningTurnPlan,
            problemIR: problemAuthority?.problemIR ?? null,
          });
          const archetypeSpec = archetype ? ARCHETYPES[archetype.id] : null;
          const archetypeGuidance = archetypeSpec
            ? [
                `Figure: ${archetypeSpec.label}. It must contain entities with roles: ${archetypeSpec.contract.roles.join(", ")}` +
                  (archetypeSpec.contract.operators?.length ? `; use ${archetypeSpec.contract.operators.join(", ")}` : "") +
                  ".",
              ]
            : [];
          result = await awaitCurrentTurn(planSceneDocumentWithRepair(
            question,
            validateCandidate,
            {
            proxyUrl: plannerUrl,
            sessionId: sessionId ?? undefined,
            signal: abortController.signal,
            timeoutMs: remainingPlannerMs,
            conversationContext: planContext,
            fastMode: fastModeRef.current,
            // Any inferred family (FBD, circuit, conic, energy level, …) gets a
            // compact operator catalog; optics is no longer the only match.
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
          ).catch(() => null), isCurrentTurn);
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
            projection: authorityAudit.status === "verified"
              ? buildSolverAuthorityProjection(
                  problemAuthority.problemIR,
                  problemAuthority.solverResult,
                  authorityAudit,
                )
              : null,
          };
          tutorDebug("planner", "solver authority audit", {
            status: authorityAudit.status,
            issue_codes: authorityAudit.issues.map((issue) => issue.code),
            binding_count: authorityAudit.bindings.length,
            elapsed_ms: problemAuthority.elapsedMs,
          });
        }

        const authoritativeTurnPlan = turnPlan;
        result = await awaitCurrentTurn(finalizeScenePlanAfterAuthority(result, {
          problemAuthorityAvailable: problemAuthority !== null,
          planningTurnPlan,
          authoritativeTurnPlan,
          revalidate: (sceneResult) => revalidateScenePlanWithRepairResult(
            sceneResult,
            (candidate) => validateCandidateAgainstPlan(candidate, authoritativeTurnPlan),
          ),
        }), isCurrentTurn);
        const solverAuthorityBlocked = problemAuthority?.audit.status === "contradiction";

        sceneV2Document = result?.response.document ?? null;
        sceneV2Report = result?.validation.value?.report ?? (shouldPlanExactScene ? {
          engineVersion: SCENE_ENGINE_VERSION,
          valid: false,
          issues: result?.validation.errors ?? [{
            code: "planner_unavailable",
            message: "Semantic planner did not return a valid scene within the budget",
            severity: "fatal" as const,
          }],
          stats: { entityCount: 0, constructionCount: 0, primitiveCount: 0, assertionCount: 0 },
        } : {
          engineVersion: SCENE_ENGINE_VERSION,
          valid: true,
          issues: [],
          stats: { entityCount: 0, constructionCount: 0, primitiveCount: 0, assertionCount: 0 },
        });
        sceneV2Repaired = result?.repaired ?? false;

        const value = !solverAuthorityBlocked && result?.validation.valid
          ? result.validation.value
          : undefined;
        const exactIssueCodes = Array.from(new Set(
          result?.candidates.flatMap((candidate) =>
            candidate.validation.errors
              .filter((issue) => issue.severity === "fatal")
              .map((issue) => issue.code),
          ) ?? sceneV2Report.issues
            .filter((issue) => issue.severity === "fatal")
            .map((issue) => issue.code),
        ));
        if (solverAuthorityBlocked) {
          exactDegradation = {
            attemptedTier: "exact_verified",
            reason: "solver_contradiction",
            issueCodes: problemAuthority?.audit.issues.map((issue) => issue.code) ?? [],
            candidateCount: 0,
          };
        } else if (
          shouldPlanExactScene &&
          (!value || value.document.visualDecision.mode !== "scene")
        ) {
          const missingCapability = value?.document.visualDecision.mode === "text_only" ||
            exactIssueCodes.some((code) => /unsupported_operator|missing_capability/.test(code));
          exactDegradation = {
            attemptedTier: "exact_verified",
            reason: !result
              ? "planner_unavailable"
              : missingCapability ? "missing_capability" : "candidate_invalid",
            issueCodes: exactIssueCodes,
            candidateCount: result?.candidates.length ?? 0,
          };
        }
        selectRepresentation: {
          try {
            const fallbackCapabilities = inferSceneCapabilities(question, {
              lawIds: turnPlan?.lawIds ?? planningTurnPlan.lawIds,
              problemIR: problemAuthority?.problemIR ?? null,
              turnPlan,
            });
            // The plan already decided this question needs no picture. The
            // fallback used to run anyway, so a units-conversion question was
            // handed a P-V rectangle and an error-types question a Wheatstone
            // bridge. Only skip when the deterministic stem filter agrees, so a
            // planner that under-called the requirement is still covered.
            if (turnPlan.visualRequirement === "none" && !questionRequiresVisual(question)) {
              tutorDebug("planner", "no figure asked for, skipping the fallback", {
                law_ids: turnPlan.lawIds,
              });
              throw new NoFigureNeeded();
            }
            const selected = selectVerifiedRepresentation({
              question,
              turnPlan,
              problemIR: problemAuthority?.problemIR ?? null,
              families: fallbackCapabilities.families.length > 0
                ? fallbackCapabilities.families
                : sceneCapabilities.families,
              exact: value && value.document.visualDecision.mode === "scene"
                ? {
                    sceneDocument: value.document,
                    renderScene: value.renderScene,
                    validationReport: value.report,
                  }
                : null,
            });
            sceneV2Document = selected.sceneDocument;
            // A figure the student cannot read is not a figure.
            //
            // Two things were reaching the board and being narrated as though
            // they showed the question: a representation with no primitives at
            // all, and one whose only entity was a pair of axes. Nineteen
            // lectures in a 342-question sweep were handed that bare `axes`,
            // and every one of them described a picture that was not there
            // ("on the figure, the hot reservoir sits at the top").
            //
            // The test is drawn text, not primitive count, and the corpus makes
            // it safe: of 329 committed figures, every one with eight or more
            // primitives carried a label, and every unlabelled one had seven or
            // fewer. The contract already forbids naming a part that has no
            // label, so an unlabelled figure can only produce invention. Drop it
            // here, before the artifacts record is written, so the turn is
            // text-only everywhere and the lesson teaches in words instead.
            const selectedHasInk = selected.renderScene.primitives.some(
              (primitive) =>
                (primitive.kind === "label" || primitive.kind === "dimension") &&
                typeof primitive.text === "string" &&
                primitive.text.trim().length > 0,
            );
            if (!selectedHasInk) {
              tutorDebug("planner", "representation carries no readable label, teaching text only", {
                representation_tier: selected.tier,
                reason: selected.reason,
                primitive_count: selected.renderScene.primitives.length,
              });
            }
            sceneV2RenderScene = selectedHasInk ? selected.renderScene : null;
            sceneV2Report = selected.validationReport;
            sceneVisualStatus = selectedHasInk &&
              selected.sceneDocument.visualDecision.mode === "scene"
              ? "validated"
              : "text_only";
            representationTier = selected.tier;
            representationNonMetric = selected.nonMetric;
            representationReason = selected.reason;
            representationFamily = selected.family ?? null;
            // Never cache a scene that drew nothing: recovery would replay it
            // on a later turn only for the same guard to drop it again.
            if (selectedHasInk && selected.tier === "exact_verified" && turnPlan) {
              rememberVerifiedScene(question, selected.sceneDocument, turnPlan, {
                boardId: sessionId,
              });
            }
          } catch (error) {
            // Invalid exact and fallback scenes are both kept off the canvas.
            sceneV2RenderScene = null;
            if (error instanceof NoFigureNeeded) {
              sceneVisualStatus = "text_only";
              representationReason = "the question asks for no figure";
              break selectRepresentation;
            }
            // Escalate to retry_required when the deterministic pre-filter flags the
            // stem as diagram-worthy but the planner under-called visualRequirement.
            // This only changes the retry decision, never the geometry.
            sceneVisualStatus =
              turnPlan.visualRequirement === "required" || questionRequiresVisual(question)
                ? "retry_required"
                : "text_only";
            representationReason = error instanceof Error ? error.message : String(error);
          }
        }

        sceneArtifacts = {
          schemaVersion: "scene-artifacts/v3",
          turnPlan,
          problemIR: problemAuthority?.problemIR ?? null,
          solverResult: problemAuthority?.solverResult ?? null,
          solverAuthority: problemAuthority?.audit ?? null,
          representationTier: representationTier ?? undefined,
          nonMetric: representationTier ? representationNonMetric : undefined,
          candidates: result?.candidates.map((candidate) => {
            const report = candidate.validation.value?.report ?? {
              engineVersion: SCENE_ENGINE_VERSION,
              valid: false,
              issues: candidate.validation.errors,
              stats: {
                entityCount: Array.isArray(candidate.response.document.entities)
                  ? candidate.response.document.entities.length : 0,
                constructionCount: Array.isArray(candidate.response.document.constructions)
                  ? candidate.response.document.constructions.length : 0,
                primitiveCount: 0,
                assertionCount: Array.isArray(candidate.response.document.assertions)
                  ? candidate.response.document.assertions.length : 0,
              },
            } satisfies ValidationReport;
            return {
              candidateId: candidate.candidateId,
              strategy: candidate.response.strategy,
              phase: candidate.response.phase,
              accepted: candidate.selected && representationTier === "exact_verified",
              sceneDocument: candidate.response.document as unknown as SceneDocument,
              validationReport: report,
              score: candidate.score,
              rejectionCodes: report.issues
                .filter((issue) => issue.severity === "fatal")
                .map((issue) => issue.code),
            };
          }) ?? [],
          selectedCandidateId: representationTier === "exact_verified"
            ? result?.candidates.find((candidate) => candidate.selected)?.candidateId ?? null
            : null,
          selectionReason: representationReason ?? (sceneVisualStatus === "validated"
            ? usedVerifiedRecovery ? "verified_scene_recovery" : "validated_scene"
            : sceneVisualStatus === "retry_required"
              ? "required_diagram_failed"
              : "text_only_fallback"),
          degradation: exactDegradation,
          diagramResultStatus:
            sceneVisualStatus === "validated"
              ? "ready"
              : sceneVisualStatus === "retry_required"
                ? "retry_required"
                : turnPlan?.visualRequirement === "none" ? "not_required" : "text_only",
          proofObligations: sceneV2Document && "assertions" in sceneV2Document && Array.isArray(sceneV2Document.assertions)
            ? sceneV2Document.assertions.map((assertion, index) => {
                const value = assertion as Record<string, unknown>;
                return {
                  id: typeof value.id === "string" ? value.id : `assertion-${index + 1}`,
                  predicate: typeof value.predicate === "string" ? value.predicate : "unknown",
                  inputs: Array.isArray(value.entities)
                    ? value.entities.filter((id): id is string => typeof id === "string") : [],
                  expected: value.expected,
                  severity: value.severity === "warning" ? "warning" as const : "fatal" as const,
                };
              })
            : [],
          budgets: {
            deadlineMs: SCENE_PLANNER_DEADLINE_MS,
            planMs: turnPlanMs,
            candidatesMs: Math.max(0, Date.now() - plannerStartedAt - turnPlanMs),
          },
        };
      }
      throwIfTurnCancelled();
      const plannerLatencyMs = Date.now() - plannerStartedAt;

      let activeDiagram: import("@heytutor/drawing").VerifiedDiagram | null;
      let diagramSource: "verified_scene" | "none";

      const presentation = sceneV2RenderScene && sceneV2Document && "visualDecision" in sceneV2Document
        ? buildVerifiedDiagramPresentation(
            sceneV2Document as SceneDocument,
            sceneV2RenderScene,
            {
              ...(codeLesson ? { layout: "code_lesson" as const } : {}),
              ...(representationFamily ? { figureFamily: representationFamily } : {}),
            },
          )
        : null;
      // Second line of defence: primitives that compile to no command leave the
      // same empty board as no primitives at all.
      if (presentation && verifiedDiagramHasDrawableInk(presentation.diagram)) {
        activeDiagram = presentation.diagram;
        sceneV2IntroSegments = presentation.introSegments;
        diagramSource = "verified_scene";
        activeVerifiedDiagramRef.current = activeDiagram;
        setActiveVerifiedDiagram?.(activeDiagram);
      } else {
        // Failed or unnecessary diagrams never expose partial geometry.
        activeDiagram = null;
        diagramSource = "none";
        activeVerifiedDiagramRef.current = null;
        setActiveVerifiedDiagram?.(null);
      }

      plannerSpan.end({
        source: diagramSource,
        latency_ms: plannerLatencyMs,
        scene_engine_version: SCENE_ENGINE_VERSION,
        visual_status: sceneVisualStatus,
        representation_tier: representationTier,
        non_metric: representationNonMetric,
        repaired: sceneV2Repaired,
        validation_issue_count: sceneV2Report?.issues.length ?? null,
        validation_fatal_count:
          sceneV2Report?.issues.filter((issue) => issue.severity === "fatal").length ?? null,
        primitive_count: sceneV2RenderScene?.primitives.length ?? null,
        degrade_reason: sceneV2RenderScene ? null : "no_verified_scene",
      });
      tel.mark("verified-scene-decision", {
        source: diagramSource,
        visual_status: sceneVisualStatus,
        repaired: sceneV2Repaired,
        latency_ms: plannerLatencyMs,
        primitive_count: sceneV2RenderScene?.primitives.length ?? 0,
        issue_codes: sceneV2Report?.issues.map((issue) => issue.code) ?? [],
        representation_tier: representationTier,
        non_metric: representationNonMetric,
      });
      tel.meta({
        scene_engine_version: SCENE_ENGINE_VERSION,
        scene_visual_status: sceneVisualStatus,
        scene_validation_valid: sceneV2Report?.valid ?? null,
        scene_repaired: sceneV2Repaired,
        scene_representation_tier: representationTier,
        scene_non_metric: representationNonMetric,
        solver_authority_status: problemAuthority?.audit.status ?? "unavailable",
      });

      if (problemAuthority?.audit.status === "contradiction") {
        emitError({
          message: "The independent solution checks disagreed, so the tutor stopped before presenting an unverified answer. Retry the question.",
          question,
        });
        if (turnAbortRef.current === abortController) turnAbortRef.current = null;
        endThinking({ phase: "solver_authority_contradiction" });
        endWsConnect({ ok: false, reason: "solver_authority_contradiction" });
        tel.meta({
          total_duration_ms: tel.durationMs(),
          diagram_result_status: "retry_required",
          narration_started: false,
          solver_authority_issues: problemAuthority.audit.issues.map((issue) => issue.code),
        });
        if (turnTelemetryRef.current === tel) turnTelemetryRef.current = null;
        void tel.flush();
        finishLectureUi(turnGeneration);
        return;
      }

      if (sceneVisualStatus === "retry_required") {
        tel.mark("diagram-unverified-continue", {
          latency_ms: plannerLatencyMs,
          issue_codes: sceneV2Report?.issues.map((issue) => issue.code) ?? [],
        });
      }

      const teachingPrompt = buildTurnTeachingPrompt({
        question,
        diagramPromptAddon: activeDiagram?.promptAddon ?? null,
        turnPlan,
        solverProjection: problemAuthority?.projection ?? null,
        codeLesson,
        // The frames the board will actually show, so the narration is about
        // the figure in front of the student rather than the planner's hint.
        codeLessonFrames: dsaFrameSet?.frames.map((frame) => ({
          id: frame.id,
          caption: frame.caption,
          narrationIntent: frame.narrationIntent,
        })),
        ...(boardContext ? { codeLessonFacts: boardContext.facts } : {}),
        isDsa: dsaClassification.isDsa,
        familiarity: familiarityRef.current,
        fastMode: fastModeRef.current,
      });
      const { givenSegments, lessonBudget } = teachingPrompt;
      tutorDebug("turn", "lesson budget", {
        scope: lessonBudget.scope,
        min_steps: lessonBudget.minSteps,
        max_steps: lessonBudget.maxSteps,
        board_pages: lessonBudget.boardPages,
        level: familiarityRef.current,
      });
      const turnSystemPrompt = teachingPrompt.systemPrompt;
      const turnContinuationPrompt = teachingPrompt.continuationPrompt;

      // Transition from planning back to thinking before the LLM stream starts.
      throwIfTurnCancelled();
      setPhaseIfCurrent("thinking");

      // Commit the code lesson before any narration: the IDE panel mounts
      // empty and every later [TYPE] tag reveals only pre-validated blocks.
      if (codeLesson) {
        codeLessonControllerRef?.current?.commit(codeLesson);
        // Commit after the plan: reset() clears the frames with the lesson.
        codeLessonControllerRef?.current?.frames.commit(dsaFrameSet);
      }

      const introSegments = activeDiagram && sceneV2IntroSegments
        ? sceneV2IntroSegments
        : [];
      if (activeDiagram) {
        fbdPhaseStartedRef.current = true;
        for (const anchor of activeDiagram.anchors) {
          registerBoardAnchor(boardLayoutRef.current, anchorToTextRect(anchor));
        }

        turnTelemetryRef.current?.mark("verified-scene-intro-queued", {
          diagram_id: activeDiagram.id,
          diagram_name: activeDiagram.name,
          diagram_source: diagramSource,
          planner_latency_ms: plannerLatencyMs,
          intro_segment_count: introSegments.length,
          command_count: activeDiagram.commands.length,
          commands: activeDiagram.commands.map((command) => ({
            type: command.type,
            params: command.params,
            ...(command.text ? { text: command.text } : {}),
          })),
        });

        // Keep a compact trace of the committed scene for visual diagnostics.
        const introCommands = introSegments.flatMap((segment) => segment.commands ?? []);
        const diagramDrawCount = introCommands.filter((command) =>
          command.type.startsWith("DRAW_"),
        ).length;
        const diagramLabelCount = introCommands.filter(
          (command) => command.type === "LABEL",
        ).length;
        tutorDebug("draw", "queued diagram intro segments", {
          diagram: activeDiagram.id,
          source: diagramSource,
          segment_count: introSegments.length,
          diagram_draw_commands: diagramDrawCount,
          diagram_labels: diagramLabelCount,
          planner_latency_ms: plannerLatencyMs,
        });
      }

      try {
        // Inside the try: enqueueVerifiedIntro validates the intro commands and
        // throws synchronously on an unexpected one. Outside, that rejection was
        // unhandled, so finishLectureUi never ran and the turn stayed "thinking"
        // on an empty board with later questions dropped until Escape.
        // The opening — "Given: ..." then the figure reveal — is held until the
        // teaching model has actually produced its first step.
        //
        // It used to be enqueued here, the moment planning finished. On a
        // measured turn that meant the board spoke its four-second intro at
        // T+7s and then sat in silence until T+22s, because the teaching call
        // took 14.4s to return a first token. A finished-looking board with a
        // finished-looking timeline reads as "the lesson ended", and the
        // student stops watching. Waiting is fine before a lesson starts and
        // unacceptable once it has: the thinking overlay stays up for the whole
        // wait instead, and from the first spoken word the lesson runs straight
        // through.
        let introEnqueued = false;
        const enqueueLessonOpening = () => {
          if (introEnqueued || !STREAM_SEGMENTS_LIVE) return;
          introEnqueued = true;
          for (const segment of givenSegments) {
            enqueueSegment(segment, turnGeneration);
          }
          enqueueVerifiedIntro(introSegments, turnGeneration);
        };

        // Buffer one segment so unverified marker commands are removed before
        // they enter the speech and drawing queues.
        let bufferedSegment: TutorSegment | null = null;
        // One conductor for the whole turn: block order and the placement of
        // frame advances have to carry across streamed segments, so this
        // cannot be recreated per flush.
        // With no walk-through there are no frames to point at, and a spoken
        // step then had nothing for the board to do at all: on an uncovered
        // pattern that was half the lesson with the pen standing still. A
        // single static figure is still a figure, so its own anchors are the
        // fallback the marker walks.
        const staticPointIds = dsaFrameSet
          ? []
          : (activeDiagram?.anchors ?? []).slice(0, 6).map((anchor) => anchor.id);
        const conductor = codeLesson
          ? createCodeLessonConductor(codeLesson, {
              frameCount: dsaFrameSet?.frames.length ?? 0,
              frameIds: dsaFrameSet?.frames.map((frame) => frame.id) ?? [],
              frameFocusIds: dsaFrameSet?.frames.map((frame) => frame.focusEntityIds) ?? [],
              framePointIds: dsaFrameSet?.frames.map((frame) => frame.pointEntityIds) ?? [],
              ...(staticPointIds.length > 0 ? { fallbackPointIds: staticPointIds } : {}),
            })
          : null;

        const flushBufferedSegment = () => {
          if (!bufferedSegment) return;
          // First teaching segment in hand: open the lesson, then let it run.
          enqueueLessonOpening();
          const prepared = prepareVerifiedLessonSegments([bufferedSegment], activeDiagram);
          // DSA turns own no handwriting: [TYPE] resolves to its committed
          // block in plan order, frame advances are inserted between blocks,
          // and everything except FOCUS/PAUSE narration ink is dropped.
          const resolved = conductor ? conductor.resolve(prepared.segments) : null;
          for (const seg of resolved?.segments ?? prepared.segments) {
            enqueueSegment(seg, turnGeneration);
          }
          if (
            prepared.blockedCommandCount > 0 ||
            prepared.droppedSegmentCount > 0 ||
            (resolved && (resolved.blockedCommandCount > 0 || resolved.unknownBlockIds.length > 0))
          ) {
            tutorDebug("draw", "live segment filtered by mini-buffer", {
              blocked_commands: prepared.blockedCommandCount,
              dropped_segments: prepared.droppedSegmentCount,
              code_lesson_blocked: resolved?.blockedCommandCount ?? 0,
              unknown_block_ids: resolved?.unknownBlockIds ?? [],
            });
          }
          bufferedSegment = null;
        };

        const parser = new IncrementalTagParser({
          onSegmentReady: (segment) => {
            if (STREAM_SEGMENTS_LIVE) {
              // Flush the previously buffered segment, then buffer this one.
              flushBufferedSegment();
              bufferedSegment = segment;
            } else {
              tutorDebug("parser", "segment ready from stream", {
                narration_preview: segment.narration.slice(0, 80),
                command_type: segment.command?.type ?? null,
                deferred: true,
              });
            }
          },
        });

        tutorDebug("turn", "LLM stream starting");

        let fullResponse = "";
        let lastStreamStats: Awaited<ReturnType<typeof streamLLMResponse>>["streamStats"];
        let traceId: string | null = null;
        let continueCount = 0;
        let previousChunk = "";
        let reasoningOnlyRetry = false;
        // Beats the lesson still owed when the previous chunk ended.
        let beatsLeftBefore = Number.POSITIVE_INFINITY;

        while (continueCount <= MAX_LLM_CONTINUATIONS) {
          const isContinuation = continueCount > 0 && !reasoningOnlyRetry;
          const streamResult = await streamLLMResponse(
            {
              systemPrompt: isContinuation
                ? turnContinuationPrompt
                : turnSystemPrompt,
              userPrompt: isContinuation
                ? [
                    "continue",
                    // A code lesson that stopped early left the panel
                    // half-written and the walk-through mid-example. Name what
                    // is still owed so the continuation finishes the lesson
                    // instead of recapping it.
                    conductor && codeLesson
                      ? codeLessonResumeNote(conductor.status(), codeLesson)
                      : "",
                  ]
                    .filter(Boolean)
                    .join("\n\n")
                : question,
              conversationHistory: isContinuation
                ? [
                    ...conversationHistoryRef.current,
                    {
                      user: question,
                      assistant: lessonNarrationText(fullResponse),
                    },
                  ]
                : conversationHistoryRef.current,
              proxyUrl: resolveApiUrl("/api/chat"),
              sessionId: sessionId ?? undefined,
              hasAuthoritativePlan: Boolean(codeLesson) || Boolean(
                turnPlan &&
                (
                  turnPlan.givens.length > 0 ||
                  turnPlan.derived.length > 0 ||
                  turnPlan.qualitativeClaims.length > 0 ||
                  turnPlan.lawIds.length > 0
                )
              ),
              fastMode: fastModeRef.current,
              codeLesson: Boolean(codeLesson),
              signal: abortController.signal,
              onTraceId: (id) => {
                currentTraceIdRef.current = id;
                tel.setTrace(id, sessionId ?? undefined);
              },
            },
            (delta) => {
              if (!isCurrentTurn()) {
                return;
              }
              endThinking({ phase: "first_token", delta_chars: delta.length });
              if (delta.includes("[")) {
                tutorDebug("parser", "draw tag delta", {
                  delta_chars: delta.length,
                  preview: delta.slice(0, 80),
                });
              }
              parser.push(delta);
            },
          );

          throwIfTurnCancelled();
          fullResponse += streamResult.text;
          traceId = streamResult.traceId;
          lastStreamStats = streamResult.streamStats;

          if (cancelRef.current) {
            break;
          }

          // Reasoning-only starvation: the model spent its budget thinking and
          // emitted no spoken content. Retry the original question once instead
          // of failing the turn (upstream already raised the token ceiling).
          const reasoningOnlyChunk =
            streamResult.text.trim().length === 0 &&
            (streamResult.streamStats?.reasoningChars ?? 0) > 0;
          if (
            reasoningOnlyChunk &&
            !reasoningOnlyRetry &&
            continueCount < MAX_LLM_CONTINUATIONS
          ) {
            reasoningOnlyRetry = true;
            continueCount += 1;
            tutorDebug("turn", "reasoning-only response, retrying question", {
              reasoning_chars: streamResult.streamStats?.reasoningChars ?? 0,
            });
            continue;
          }
          reasoningOnlyRetry = false;

          // A code lesson is finished when its beats are, not when the text
          // happens to end on a full stop. The buffered segment has not been
          // conducted yet, so flush it before asking what is left.
          flushBufferedSegment();
          const codeLessonProgress = conductor?.status() ?? null;
          const beatsLeft = codeLessonProgress
            ? codeLessonProgress.missingBlockIds.length + codeLessonProgress.unshownFrameCount
            : 0;
          // Only continue while continuing is still achieving something. A
          // model that returns the same stuck chunk would otherwise burn every
          // continuation on it and delay the end of the turn.
          const codeLessonUnfinished = beatsLeft > 0 && beatsLeft < beatsLeftBefore;
          beatsLeftBefore = beatsLeft;
          if (codeLessonUnfinished) {
            tutorDebug("turn", "code lesson stopped early, continuing", {
              missing_blocks: codeLessonProgress?.missingBlockIds.length ?? 0,
              unshown_frames: codeLessonProgress?.unshownFrameCount ?? 0,
              continuation: continueCount + 1,
            });
          }

          if (
            !codeLessonUnfinished &&
            !isTeachingResponseIncomplete(
              streamResult.text,
              fullResponse,
              previousChunk,
            )
          ) {
            break;
          }

          previousChunk = streamResult.text;
          continueCount += 1;
          if (continueCount > MAX_LLM_CONTINUATIONS) {
            break;
          }

          tutorDebug("turn", "continuing truncated LLM response", {
            continuation: continueCount,
            response_chars: fullResponse.length,
          });
        }

        const rawResponse = fullResponse;
        const streamStats = lastStreamStats;

        tutorDebug("turn", "LLM stream finished", {
          response_chars: rawResponse.length,
          trace_id: traceId,
          stream_stats: streamStats,
          segments_so_far: collectedSegmentsRef.current.length,
          continuations: continueCount,
        });

        if (cancelRef.current) {
          turnCancelled = true;
          return;
        }

        if (traceId) {
          currentTraceIdRef.current = traceId;
          tel.setTrace(traceId, sessionId ?? undefined);
        }

        if (!thinkingEnded) {
          endThinking({ phase: "no_first_token" });
        }

        parser.flush();
        // Flush the final segment through verified-scene ownership filtering.
        flushBufferedSegment();
        // A tag the model wrote on its own line waits for the words it belongs
        // to; if the response ended on one, it still has to reach the board.
        if (conductor) {
          for (const seg of conductor.finish().segments) {
            enqueueSegment(seg, turnGeneration);
          }
        }
        throwIfTurnCancelled();

        const responseText = rawResponse.trim();
        rawResponseRef.current = responseText;

        if (responseText.length === 0) {
          if (!isCurrentTurn()) {
            return;
          }
          const reasoningOnly = (streamStats?.reasoningChars ?? 0) > 0;
          const message = reasoningOnly
            ? "the ai couldn't generate a response — try rephrasing"
            : "the ai returned an empty response. try asking again.";
          tutorDebug("turn", "empty response", {
            reasoning_chars: streamStats?.reasoningChars ?? 0,
            stream_stats: streamStats,
          });
          setNarrationText(message);
          setCurrentSegmentText(message);
          emitError({ message, question });
          return;
        }

        tutorDebug("turn", "planning lesson from full response");
        throwIfTurnCancelled();
        // A stream that produced no parseable step never reached
        // `flushBufferedSegment`, so the opening would otherwise be dropped
        // along with it. The givens and the verified figure are the runtime's
        // own and are owed to the student either way.
        enqueueLessonOpening();
        applyTurnPhase("speaking");

        await awaitCurrentTurn(processResponseText(
          responseText,
          introSegments,
          STREAM_SEGMENTS_LIVE,
          turnGeneration,
          givenSegments,
        ), isCurrentTurn);

        const finalNarration =
          responseText.length > 0 ? lessonNarrationText(responseText) : narrationText;

        if (finalNarration.trim() && !turnCancelled && !cancelRef.current) {
          conversationHistoryRef.current.push({
            user: question,
            assistant: finalNarration,
          });

          if (conversationHistoryRef.current.length > 10) {
            conversationHistoryRef.current.shift();
          }

          const currentId = sessionId;
          if (currentId && rawResponseRef.current) {
            const responseForPersistence = rawResponseRef.current;
            const recordedForPersistence = withBoardEpochSegment(recordedSegmentsRef.current);
            // The committed CodeLessonPlan rides the artifacts JSON so replay
            // and restored boards can rebuild the code panel and type-along.
            const artifactsForPersistence = codeLesson && sceneArtifacts
              ? { ...sceneArtifacts, codeLesson }
              : sceneArtifacts;
            const localTurn = persistTurnForReplay(
              question,
              responseForPersistence,
              recordedForPersistence,
              {
                sceneDocument: sceneV2Document,
                sceneEngineVersion: SCENE_ENGINE_VERSION,
                validationReport: sceneV2Report,
                visualStatus: sceneVisualStatus,
                sceneArtifacts: artifactsForPersistence,
              },
            );
            storedTurnsRef.current = [...storedTurnsRef.current, localTurn];
            setStoredTurnsCount(storedTurnsRef.current.length);
            setBoards((prev) =>
              prev.map((b) =>
                b.id === currentId ? { ...b, preview: question.slice(0, 60) } : b,
              ),
            );

            const savePromise = saveTurn(currentId, {
              question,
              rawResponse: responseForPersistence,
              speedMultiplier: speedRef.current,
              traceId: currentTraceIdRef.current,
              sceneDocument: sceneV2Document,
              sceneEngineVersion: SCENE_ENGINE_VERSION,
              validationReport: sceneV2Report,
              visualStatus: sceneVisualStatus,
              sceneArtifacts: artifactsForPersistence,
              segments: recordedForPersistence,
            }).then((savedTurn) => {
              if (!savedTurn) return false;
              const turnForReplay: StoredTurn = {
                ...savedTurn,
                segments: enrichStoredSegmentsWithReplayAudio(
                  savedTurn.segments,
                  recordedForPersistence,
                  registerReplayBlobUrl,
                ),
              };
              storedTurnsRef.current = storedTurnsRef.current.map((turn) =>
                turn.id === localTurn.id ? turnForReplay : turn,
              );
              setStoredTurnsCount(storedTurnsRef.current.length);
              return true;
            }).catch(() => false);

            if (onComplete) {
              const saved = await savePromise;
              if (!isCurrentTurn() || turnCancelled || cancelRef.current) {
                return;
              }
              if (saved) {
                onComplete();
              } else {
                emitError({
                  message: "could not save the lecture recording",
                  question,
                });
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          turnCancelled = true;
          endThinking({ phase: "cancelled" });
          return;
        }

        if (cancelRef.current) {
          turnCancelled = true;
          return;
        }

        if (!isCurrentTurn()) {
          turnCancelled = true;
          return;
        }

        console.error("Tutor error:", error);
        let message = "something went wrong. try asking again.";
        if (error instanceof TypeError && /fetch|network|failed to fetch/i.test(error.message)) {
          message = "network error — check your connection";
        } else if (error instanceof Error && /tts|audio|elevenlabs|speech/i.test(error.message)) {
          message = "audio generation failed — the lesson continues without voice";
        } else if (error instanceof Error && /timeout|aborted|abort/i.test(error.message)) {
          message = "the request took too long. try asking again.";
        }
        setNarrationText(message);
        setCurrentSegmentText(message);
        emitError({ message, question });
        endThinking({ phase: "error" });
      } finally {
        if (
          turnGeneration === turnGenerationRef.current &&
          !turnCancelled &&
          !cancelRef.current
        ) {
          // A stream failure can occur after the intro was enqueued. Do not expose
          // an idle UI until that exact turn's ink has settled; otherwise the next
          // question resets scene ownership underneath commands still in flight.
          const segmentQueue = segmentChainRef.current;
          await segmentQueue.catch(() => undefined);
          const drawQueue = drawChainRef.current;
          await drawQueue.catch(() => undefined);
        }

        if (turnAbortRef.current === abortController) {
          turnAbortRef.current = null;
        }
        endWsConnect({ ok: false, reason: "turn_complete_without_connect_event" });
        if (!thinkingEnded) {
          endThinking({ phase: turnCancelled ? "cancelled" : "turn_complete" });
        }

        tel.meta({
          total_duration_ms: tel.durationMs(),
          segment_count: collectedSegmentsRef.current.length,
          total_draw_ms: turnStatsRef.current.drawMs,
          total_tts_chars: turnStatsRef.current.ttsChars,
          verified_diagram_id: segmentPlanStatsRef.current.activeDiagramId,
          verified_diagram_name: segmentPlanStatsRef.current.activeDiagramName,
          diagram_planned_segment_count: segmentPlanStatsRef.current.plannedSegmentCount,
          diagram_intro_segment_count: segmentPlanStatsRef.current.introSegmentCount,
          diagram_llm_segment_count: segmentPlanStatsRef.current.llmSegmentCount,
          diagram_blocked_unverified_draw_commands:
            segmentPlanStatsRef.current.blockedUnverifiedDrawCommands,
          diagram_dropped_marker_only_segments:
            segmentPlanStatsRef.current.droppedMarkerOnlySegments,
          question_preview: question.slice(0, 120),
          cancelled: turnCancelled,
        });

        tutorDebug("turn", "turn complete", {
          cancelled: turnCancelled,
          segment_count: collectedSegmentsRef.current.length,
          total_draw_ms: turnStatsRef.current.drawMs,
          total_tts_chars: turnStatsRef.current.ttsChars,
        });

        // A finished DSA lesson keeps its panel up and unlocks type-along.
        if (!turnCancelled && !cancelRef.current) {
          codeLessonControllerRef?.current?.markLessonComplete();
        }

        finishLectureUi(turnGeneration);

        if (turnGeneration === turnGenerationRef.current) {
          turnTelemetryRef.current = null;
        }
        void tel.flush();
      }
    },
    [
      sessionId,
      isDraft,
      commitDraftBoard,
      boards,
      narrationText,
      phaseRef,
      processResponseText,
      enqueueSegment,
      enqueueVerifiedIntro,
      beginBoardEpoch,
      boardLoaded,
      persistTurnForReplay,
      registerReplayBlobUrl,
      revokeUnreferencedReplayBlobUrls,
      finishLectureUi,
      ensureTTSClient,
      applyTurnPhase,
      whiteboardRef,
      pendingQuestionRef,
      liveQuestionRef,
      setInputInteracted,
      setLiveQuestion,
      cancelRef,
      isPausedRef,
      setIsPaused,
      setIsReplaying,
      setLastError,
      emitError,
      onComplete,
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
      conversationHistoryRef,
      speedRef,
      fastModeRef,
      familiarityRef,
      storedTurnsRef,
      pendingSegmentCountRef,
      setStoredTurnsCount,
      setBoards,
      setPhase,
      setNarrationText,
      setCurrentSegmentText,
    ],
  );

  useEffect(() => {
    if (!boardLoaded || typeof window === "undefined") {
      return;
    }

    let frameId = 0;
    let cancelled = false;

    const flushPendingQuestion = () => {
      if (cancelled) {
        return;
      }

      const pendingQuestion = pendingQuestionRef.current;
      if (!pendingQuestion?.trim()) {
        return;
      }

      if (!shouldFlushPendingQuestion({
        pendingQuestion,
        boardLoaded,
        hasWhiteboard: isWhiteboardReadyToDraw(whiteboardRef.current),
        phase: phaseRef.current,
        turnActive: turnActiveRef.current,
        pendingSegmentCount: pendingSegmentCountRef.current,
      })) {
        frameId = scheduleFrame(flushPendingQuestion);
        return;
      }

      pendingQuestionRef.current = null;
      void handleQuestion(pendingQuestion);
    };

    flushPendingQuestion();

    return () => {
      cancelled = true;
      if (frameId !== 0) {
        cancelFrame(frameId);
      }
    };
  }, [
    boardLoaded,
    handleQuestion,
    pendingQuestionRef,
    pendingSegmentCountRef,
    phaseRef,
    turnActiveRef,
    whiteboardRef,
  ]);

  return { handleQuestion };
}
