import { useCallback, useEffect } from "react";
import {
  IncrementalTagParser,
  lessonNarrationText,
  anchorToTextRect,
  prepareVerifiedLessonSegments,
  type TutorSegment,
} from "@heytutor/drawing";
import {
  streamLLMResponse,
  TUTOR_SYSTEM_PROMPT,
  TUTOR_CONTINUATION_PROMPT,
  CONCEPT_LESSON_RUNTIME_ADDON,
  isConceptLessonQuestion,
  buildGivenValueSegments,
  givenValuesPromptAddon,
  tutorDebug,
  resolveApiUrl,
  planSceneDocumentWithRepair,
  revalidateScenePlanWithRepairResult,
  planTurnV3,
  auditTurnPlanV3,
  planAndSolveProblemV1,
  createFallbackTurnPlanV3,
  inferSceneCapabilities,
  normalizeTutorQuestion,
  questionRequiresVisual,
  type ProblemAuthorityV1Response,
  type SceneCandidateValidation,
  type ScenePlanWithRepairResult,
} from "@heytutor/tutor-core";
import {
  SCENE_ENGINE_VERSION,
  compileSceneDocument,
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
  updateBoard,
  withBoardEpochSegment,
  type StoredTurn,
} from "@/lib/boards/boardsClient";
import { MAX_LLM_CONTINUATIONS, STREAM_SEGMENTS_LIVE } from "../../constants";
import { registerBoardAnchor } from "../../lib/boardLayout";
import { buildVerifiedDiagramPresentation } from "../../lib/verifiedScenePresentation";
import {
  selectVerifiedRepresentation,
  type RepresentationTier,
} from "../../lib/representationFallbackV4";
import {
  finalizeScenePlanAfterAuthority,
  SCENE_PLANNER_DEADLINE_MS,
  PROBLEM_AUTHORITY_DEADLINE_MS,
  TURN_PLAN_DEADLINE_MS,
  selectBestAvailableTurnPlan,
} from "../../lib/diagramGenerationV3";
import {
  findVerifiedSceneRecovery,
  forgetVerifiedScene,
  rememberVerifiedScene,
} from "../../lib/verifiedSceneRecovery";
import {
  createEmptySegmentPlanStats,
  isTeachingResponseIncomplete,
} from "../../lib/segmentPlanning";
import type { TutorPhase } from "../../types";
import type { TurnControlApi, UseTurnLifecycleParams } from "./types";

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
    boards,
    narrationText,
    boardLoaded,
    whiteboardRef,
    pendingQuestionRef,
    phaseRef,
    cancelRef,
    isPausedRef,
    conversationHistoryRef,
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
    boardLayoutRef,
    turnTelemetryRef,
    speedRef,
    fastModeRef,
    storedTurnsRef,
    pendingSegmentCountRef,
    setInputInteracted,
    setIsPaused,
    setIsReplaying,
    setTranscriptOpen,
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
  } = params;

  const { finishLectureUi, applyTurnPhase, enqueueSegment, enqueueVerifiedIntro, processResponseText } = turnControl;

  const handleQuestion = useCallback(
    async (rawQuestion: string) => {
      const question = normalizeTutorQuestion(rawQuestion);
      const wb = whiteboardRef.current;
      if (!boardLoaded || !wb) {
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
      setTranscriptOpen(false);
      setLastError(null);
      turnActiveRef.current = true;
      phaseRef.current = "thinking";
      const abortController = new AbortController();

      const boardIdForName = sessionId;
      if (boardIdForName) {
        const needsName = boards.find(
          (b) => b.id === boardIdForName,
        )?.title === "new board";
        if (needsName) {
          void fetch(resolveApiUrl("/api/board-name"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question }),
          })
            .then((r) => r.json())
            .then((data) => {
              const title: string | undefined = data?.title;
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
      await beginBoardEpoch();

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
      let exactDegradation: NonNullable<SceneArtifactsV3["degradation"]> | undefined;
      let turnPlan: TurnPlanV3 | null = null;
      let problemAuthority: ProblemAuthorityV1Response | null = null;
      let turnPlanMs = 0;

      const plannerUrl = resolveApiUrl("/api/chat");
        const recentConversation = conversationHistoryRef.current
          .slice(-3)
          .map((exchange) => `User: ${exchange.user}\nTutor: ${exchange.assistant}`)
          .join("\n\n");
        let recoveredScene = findVerifiedSceneRecovery(question, storedTurnsRef.current);
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
          const remainingAuditMs = Math.max(
            0,
            TURN_PLAN_DEADLINE_MS - (Date.now() - turnPlanStartedAt),
          );
          const auditedTurn = plannedTurn && remainingAuditMs > 0
            ? await awaitCurrentTurn(auditTurnPlanV3(question, plannedTurn.turnPlan, {
                proxyUrl: plannerUrl,
                sessionId: sessionId ?? undefined,
                signal: abortController.signal,
                timeoutMs: remainingAuditMs,
                fastMode: fastModeRef.current,
              }), isCurrentTurn)
            : null;
          turnPlanMs = Date.now() - turnPlanStartedAt;
          turnPlan = selectBestAvailableTurnPlan(
            auditedTurn?.turnPlan,
            plannedTurn?.turnPlan,
            createFallbackTurnPlanV3(question),
            plannedTurn?.peerTurnPlans,
          );
          if (plannedTurn && !auditedTurn) {
            tutorDebug("planner", "turn plan audit unavailable; using validated primary plan", {
              elapsed_ms: turnPlanMs,
            });
          }
        }

        const planningTurnPlan = turnPlan;
        const sceneCapabilities = inferSceneCapabilities(question, planningTurnPlan.lawIds);
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
            forgetVerifiedScene(question);
            recoveredScene = null;
          }
        }
        if (!result && shouldPlanExactScene && remainingPlannerMs > 0) {
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
                  planningGuidance: sceneCapabilities.planningGuidance,
                }
              : {}),
            },
          ).catch(() => null), isCurrentTurn);
        }

        if (problemAuthorityPromise) {
          problemAuthority = await awaitCurrentTurn(problemAuthorityPromise, isCurrentTurn);
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
        }

        result = await awaitCurrentTurn(finalizeScenePlanAfterAuthority(result, {
          problemAuthorityAvailable: problemAuthority !== null,
          planningTurnPlan,
          authoritativeTurnPlan: turnPlan,
          revalidate: (sceneResult) => revalidateScenePlanWithRepairResult(
            sceneResult,
            (candidate) => validateCandidateAgainstPlan(candidate, turnPlan),
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
        {
          try {
            const selected = selectVerifiedRepresentation({
              question,
              turnPlan,
              families: sceneCapabilities.families,
              exact: value && value.document.visualDecision.mode === "scene"
                ? {
                    sceneDocument: value.document,
                    renderScene: value.renderScene,
                    validationReport: value.report,
                  }
                : null,
            });
            sceneV2Document = selected.sceneDocument;
            sceneV2RenderScene = selected.renderScene;
            sceneV2Report = selected.validationReport;
            sceneVisualStatus = selected.sceneDocument.visualDecision.mode === "scene"
              ? "validated"
              : "text_only";
            representationTier = selected.tier;
            representationNonMetric = selected.nonMetric;
            representationReason = selected.reason;
            // #region agent log
            fetch('http://127.0.0.1:7280/ingest/352483c0-a316-40d0-8703-e595b34ba80f',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e9a5f5'},body:JSON.stringify({sessionId:'e9a5f5',runId:'pre-fix',hypothesisId:'H1',location:'useQuestionHandler.ts:selectVerifiedRepresentation',message:'scene selected',data:{tier:selected.tier,reason:selected.reason,families:sceneCapabilities.families,exactProvided:Boolean(value&&value.document.visualDecision.mode==='scene'),operators:selected.sceneDocument.constructions.map((c)=>c.operator),assertionSeverities:selected.sceneDocument.assertions.map((a)=>({id:a.id,predicate:a.predicate,severity:a.severity,entities:a.entities})),guessedPoints:selected.sceneDocument.constructions.filter((c)=>c.operator==='point').map((c)=>({id:c.id,outputs:c.outputs,x:c.inputs.x,y:c.inputs.y})),solidProjection:selected.sceneDocument.constructions.filter((c)=>c.operator==='solid_projection').map((c)=>({id:c.id,kind:c.inputs.kind,center:c.inputs.center,radius:c.inputs.radius,height:c.inputs.height,axis:c.inputs.axis})),issueSeverities:selected.validationReport.issues.map((i)=>({code:i.code,severity:i.severity})).slice(0,20)},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            if (selected.tier === "exact_verified" && turnPlan) {
              rememberVerifiedScene(question, selected.sceneDocument, turnPlan);
            }
          } catch (error) {
            // Invalid exact and fallback scenes are both kept off the canvas.
            sceneV2RenderScene = null;
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
      throwIfTurnCancelled();
      const plannerLatencyMs = Date.now() - plannerStartedAt;

      let activeDiagram: import("@heytutor/drawing").VerifiedDiagram | null;
      let diagramSource: "verified_scene" | "none";

      if (sceneV2RenderScene && sceneV2Document && "visualDecision" in sceneV2Document) {
        const presentation = buildVerifiedDiagramPresentation(
          sceneV2Document as SceneDocument,
          sceneV2RenderScene,
        );
        activeDiagram = presentation.diagram;
        sceneV2IntroSegments = presentation.introSegments;
        diagramSource = "verified_scene";
        activeVerifiedDiagramRef.current = activeDiagram;
      } else {
        // Failed or unnecessary diagrams never expose partial geometry.
        activeDiagram = null;
        diagramSource = "none";
        activeVerifiedDiagramRef.current = null;
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
        setLastError({
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

      const diagramPromptAddon = activeDiagram?.promptAddon ??
        `The semantic scene engine selected text-only mode because no fully validated diagram was available.
Do not emit any drawing, label, annotation, erase, highlight, or marker-movement tags.
Use WRITE only for equations and symbolic work in the left work area (x below 360).`;
      const turnPlanPromptAddon = turnPlan
        ? `AUTHORITATIVE TURN PLAN V3
Use these verified quantities and qualitative claims for the explanation. Do not replace them with independently guessed values or contradict them.
${JSON.stringify({
  givens: turnPlan.givens,
  unknowns: turnPlan.unknowns,
  derived: turnPlan.derived,
  qualitativeClaims: turnPlan.qualitativeClaims,
  lawIds: turnPlan.lawIds,
  assumptions: turnPlan.assumptions,
})}`
        : "";
      const solverPromptAddon = problemAuthority?.projection
        ? `INDEPENDENT SOLVER AUTHORITY V1
Use exactly these solver-verified values and formulation inputs. Do not independently replace or contradict them.
${JSON.stringify(problemAuthority.projection)}`
        : "";
      const givenSegments = buildGivenValueSegments(question, turnPlan);
      const runtimePromptAddon = [
        givenValuesPromptAddon(givenSegments.length > 0),
        diagramPromptAddon,
        turnPlanPromptAddon,
        solverPromptAddon,
        isConceptLessonQuestion(question) ? CONCEPT_LESSON_RUNTIME_ADDON : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const turnSystemPrompt = runtimePromptAddon
        ? `${TUTOR_SYSTEM_PROMPT}\n\n--- current lesson (runtime) ---\n${runtimePromptAddon}`
        : TUTOR_SYSTEM_PROMPT;
      const turnContinuationPrompt = runtimePromptAddon
        ? `${TUTOR_CONTINUATION_PROMPT}\n\n--- diagram reminder ---\n${runtimePromptAddon}`
        : TUTOR_CONTINUATION_PROMPT;

      // Transition from planning back to thinking before the LLM stream starts.
      throwIfTurnCancelled();
      setPhaseIfCurrent("thinking");

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

      if (STREAM_SEGMENTS_LIVE) {
        for (const segment of givenSegments) {
          enqueueSegment(segment, turnGeneration);
        }
        enqueueVerifiedIntro(introSegments, turnGeneration);
      }

      try {
        // Buffer one segment so unverified marker commands are removed before
        // they enter the speech and drawing queues.
        let bufferedSegment: TutorSegment | null = null;

        const flushBufferedSegment = () => {
          if (!bufferedSegment) return;
          const prepared = prepareVerifiedLessonSegments([bufferedSegment], activeDiagram);
          for (const seg of prepared.segments) {
            enqueueSegment(seg, turnGeneration);
          }
          if (prepared.blockedCommandCount > 0 || prepared.droppedSegmentCount > 0) {
            tutorDebug("draw", "live segment filtered by mini-buffer", {
              blocked_commands: prepared.blockedCommandCount,
              dropped_segments: prepared.droppedSegmentCount,
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

        while (continueCount <= MAX_LLM_CONTINUATIONS) {
          const isContinuation = continueCount > 0 && !reasoningOnlyRetry;
          const streamResult = await streamLLMResponse(
            {
              systemPrompt: isContinuation
                ? turnContinuationPrompt
                : turnSystemPrompt,
              userPrompt: isContinuation ? "continue" : question,
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
              hasAuthoritativePlan: Boolean(
                turnPlan &&
                (
                  turnPlan.givens.length > 0 ||
                  turnPlan.derived.length > 0 ||
                  turnPlan.qualitativeClaims.length > 0 ||
                  turnPlan.lawIds.length > 0
                )
              ),
              fastMode: fastModeRef.current,
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

          if (
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
          setLastError({ message, question });
          return;
        }

        tutorDebug("turn", "planning lesson from full response");
        throwIfTurnCancelled();
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
            const localTurn = persistTurnForReplay(
              question,
              responseForPersistence,
              recordedForPersistence,
            );
            storedTurnsRef.current = [...storedTurnsRef.current, localTurn];
            setStoredTurnsCount(storedTurnsRef.current.length);
            setBoards((prev) =>
              prev.map((b) =>
                b.id === currentId ? { ...b, preview: question.slice(0, 60) } : b,
              ),
            );

            void saveTurn(currentId, {
              question,
              rawResponse: responseForPersistence,
              speedMultiplier: speedRef.current,
              traceId: currentTraceIdRef.current,
              sceneDocument: sceneV2Document,
              sceneEngineVersion: SCENE_ENGINE_VERSION,
              validationReport: sceneV2Report,
              visualStatus: sceneVisualStatus,
              sceneArtifacts,
              segments: recordedForPersistence,
            }).then((savedTurn) => {
              if (!savedTurn) return;
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
            }).catch(() => undefined);
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
        setLastError({ message, question });
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

        finishLectureUi(turnGeneration);

        if (turnGeneration === turnGenerationRef.current) {
          turnTelemetryRef.current = null;
        }
        void tel.flush();
      }
    },
    [
      sessionId,
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
      setInputInteracted,
      cancelRef,
      isPausedRef,
      setIsPaused,
      setIsReplaying,
      setTranscriptOpen,
      setLastError,
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
      boardLayoutRef,
      turnTelemetryRef,
      conversationHistoryRef,
      speedRef,
      fastModeRef,
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
        hasWhiteboard: whiteboardRef.current !== null,
        phase: phaseRef.current,
        turnActive: turnActiveRef.current,
        pendingSegmentCount: pendingSegmentCountRef.current,
      })) {
        frameId = window.requestAnimationFrame(flushPendingQuestion);
        return;
      }

      pendingQuestionRef.current = null;
      void handleQuestion(pendingQuestion);
    };

    flushPendingQuestion();

    return () => {
      cancelled = true;
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
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
