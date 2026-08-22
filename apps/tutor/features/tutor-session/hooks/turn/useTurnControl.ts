import { useCallback, useEffect, useRef, type RefObject } from "react";
import { stopReplayAudio } from "@/lib/replay/replayAudio";
import {
  parseDrawingCommands,
  type TutorSegment,
  buildLessonSegments,
  lessonNarrationText,
  prepareVerifiedLessonSegments,
} from "@heytutor/drawing";
import { tutorDebug } from "@heytutor/tutor-core";
import {
  summarizeSegmentsForTrace,
  normalizeSegmentForAlignment,
} from "../../lib/segmentPlanning";
import { useSegmentRunner } from "./useSegmentRunner";
import type { TutorPhase } from "../../types";
import type { TurnControlApi, UseTurnLifecycleParams } from "./types";

export function useTurnControl(
  params: UseTurnLifecycleParams,
  handleQuestionRef: RefObject<(question: string) => Promise<void>>,
): TurnControlApi {
  const {
    sessionId,
    searchParams,
    phase,
    isReplaying,
    boardLoaded,
    whiteboardRef,
    pendingQuestionRef,
    autoSubmitDoneRef,
    phaseRef,
    isPausedRef,
    ttsClientRef,
    ensureTTSClient,
    currentTraceIdRef,
    replayAudioRef,
    replayAudioPreloadRef,
    cancelRef,
    turnActiveRef,
    turnGenerationRef,
    turnAbortRef,
    segmentChainRef,
    drawChainRef,
    collectedSegmentsRef,
    recordedSegmentsRef,
    activeVerifiedDiagramRef,
    fbdPhaseMarkedRef,
    fbdPhaseStartedRef,
    segmentPlanStatsRef,
    stopTurnRef,
    replayGenerationRef,
    replayCueRef,
    turnTelemetryRef,
    setPhase,
    setIsPaused,
    setNarrationText,
    setCurrentSegmentText,
    setInputInteracted,
    setTranscriptOpen,
    setIsReplaying,
    setReplayProgressMs,
    setReplayTotalMs,
    clearCancelTimers,
    pendingSegmentCountRef,
    resetBoardLayout,
  } = params;
  const activeIntroTransactionRef = useRef<string | null>(null);

  const finishLectureUi = useCallback((turnGeneration?: number) => {
    if (
      turnGeneration !== undefined &&
      turnGeneration !== turnGenerationRef.current
    ) {
      return;
    }
    turnActiveRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    whiteboardRef.current?.setPaused(false);
    ttsClientRef.current?.stop();
    phaseRef.current = "idle";
    setPhase("idle");
    setCurrentSegmentText("");
    setInputInteracted(true);
  }, [
    turnActiveRef,
    turnGenerationRef,
    isPausedRef,
    whiteboardRef,
    ttsClientRef,
    setIsPaused,
    setPhase,
    setCurrentSegmentText,
    setInputInteracted,
    phaseRef,
  ]);

  const applyTurnPhase = useCallback(
    (next: TutorPhase) => {
      if (turnActiveRef.current && !cancelRef.current) {
        phaseRef.current = next;
        setPhase(next);
      }
    },
    [turnActiveRef, cancelRef, phaseRef, setPhase],
  );

  const { runSegment } = useSegmentRunner({ ...params, applyTurnPhase });

  const enqueueSegment = useCallback(
    (segment: TutorSegment, turnGeneration = turnGenerationRef.current) => {
      if (turnGeneration !== turnGenerationRef.current) {
        return;
      }
      const segmentToRun = normalizeSegmentForAlignment(segment);
      collectedSegmentsRef.current.push(segmentToRun);
      const index = collectedSegmentsRef.current.length - 1;
      pendingSegmentCountRef.current += 1;

      tutorDebug("parser", "segment enqueued", {
        index,
        narration_preview: segmentToRun.narration.slice(0, 80),
        command_type: segmentToRun.command?.type ?? null,
      });

      if (segmentToRun.narration.trim()) {
        ensureTTSClient().prefetchSegment?.(segmentToRun.narration, {
          previousText: collectedSegmentsRef.current[index - 1]?.narration,
          nextText: undefined,
          traceId: currentTraceIdRef.current ?? undefined,
          sessionId: sessionId ?? undefined,
        });
      }

      segmentChainRef.current = segmentChainRef.current.then(async () => {
        if (cancelRef.current || turnGeneration !== turnGenerationRef.current) {
          pendingSegmentCountRef.current = Math.max(pendingSegmentCountRef.current - 1, 0);
          return;
        }

        try {
          await runSegment(
            segmentToRun,
            index,
            collectedSegmentsRef.current,
            turnGeneration,
          );
        } catch (error) {
          console.error(`Segment ${index} failed:`, error);
          tutorDebug("segment", "segment failed", {
            index,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          pendingSegmentCountRef.current = Math.max(pendingSegmentCountRef.current - 1, 0);
        }
      });
    },
    [
      runSegment,
      collectedSegmentsRef,
      segmentChainRef,
      cancelRef,
      turnGenerationRef,
      pendingSegmentCountRef,
      ensureTTSClient,
      currentTraceIdRef,
      sessionId,
    ],
  );

  const enqueueVerifiedIntro = useCallback(
    (segments: TutorSegment[], turnGeneration = turnGenerationRef.current) => {
      if (segments.length === 0 || turnGeneration !== turnGenerationRef.current) return;
      const normalized = segments.map(normalizeSegmentForAlignment);
      const unsafeCommand = normalized.flatMap((segment) => segment.commands ?? []).find((command) =>
        !(
          command.type.startsWith("DRAW_") ||
          ["ARROW", "LABEL", "DIMENSION", "FOCUS"].includes(command.type)
        )
      );
      if (unsafeCommand) {
        throw new Error(`verified intro contains non-transactional command ${unsafeCommand.type}`);
      }
      const startIndex = collectedSegmentsRef.current.length;
      collectedSegmentsRef.current.push(...normalized);
      pendingSegmentCountRef.current += normalized.length;
      const tts = ensureTTSClient();
      normalized.forEach((segment, offset) => {
        if (!segment.narration.trim()) return;
        tts.prefetchSegment?.(segment.narration, {
          previousText: normalized[offset - 1]?.narration ?? collectedSegmentsRef.current[startIndex - 1]?.narration,
          nextText: normalized[offset + 1]?.narration,
          traceId: currentTraceIdRef.current ?? undefined,
          sessionId: sessionId ?? undefined,
        });
      });

      segmentChainRef.current = segmentChainRef.current.then(async () => {
        const wb = whiteboardRef.current;
        if (!wb || cancelRef.current || turnGeneration !== turnGenerationRef.current) {
          pendingSegmentCountRef.current = Math.max(
            pendingSegmentCountRef.current - normalized.length,
            0,
          );
          return;
        }
        const transactionId = wb.beginDrawTransaction();
        activeIntroTransactionRef.current = transactionId;
        let committed = false;
        try {
          for (const [offset, segment] of normalized.entries()) {
            if (cancelRef.current || turnGeneration !== turnGenerationRef.current) {
              throw new DOMException("verified intro cancelled", "AbortError");
            }
            await runSegment(
              segment,
              startIndex + offset,
              collectedSegmentsRef.current,
              turnGeneration,
            );
          }
          if (cancelRef.current || turnGeneration !== turnGenerationRef.current) {
            throw new DOMException("verified intro cancelled", "AbortError");
          }
          wb.commitDrawTransaction(transactionId);
          committed = true;
        } catch (error) {
          wb.abortDrawTransaction(transactionId);
          activeVerifiedDiagramRef.current = null;
          fbdPhaseMarkedRef.current = false;
          fbdPhaseStartedRef.current = false;
          resetBoardLayout(false, true);
          cancelRef.current = true;
          pendingSegmentCountRef.current = 0;
          turnAbortRef.current?.abort(error);
          throw error;
        } finally {
          if (!committed) wb.finishAbortedDrawTransaction(transactionId);
          if (activeIntroTransactionRef.current === transactionId) {
            activeIntroTransactionRef.current = null;
          }
          pendingSegmentCountRef.current = Math.max(
            pendingSegmentCountRef.current - normalized.length,
            0,
          );
        }
      });
    },
    [
      activeVerifiedDiagramRef,
      cancelRef,
      collectedSegmentsRef,
      fbdPhaseMarkedRef,
      fbdPhaseStartedRef,
      pendingSegmentCountRef,
      resetBoardLayout,
      runSegment,
      segmentChainRef,
      turnAbortRef,
      turnGenerationRef,
      whiteboardRef,
      ensureTTSClient,
      currentTraceIdRef,
      sessionId,
    ],
  );

  const processResponseText = useCallback(
    async (
      responseText: string,
      introSegments: TutorSegment[] = [],
      liveEnqueued = false,
      turnGeneration = turnGenerationRef.current,
      givenSegments: TutorSegment[] = [],
    ) => {
      if (turnGeneration !== turnGenerationRef.current) {
        return;
      }
      const parsed = parseDrawingCommands(responseText);

      if (parsed.commands.length === 0 && !parsed.narration.trim() && !/\[STEP\]/i.test(responseText)) {
        const message = "no response from ai";
        setNarrationText(message);
        setCurrentSegmentText(message);
        return;
      }

      const activeDiagram = activeVerifiedDiagramRef.current;
      const rawLlmSegments = buildLessonSegments(responseText);
      const preparedLlmSegments = prepareVerifiedLessonSegments(rawLlmSegments, activeDiagram);
      const llmSegments = preparedLlmSegments.segments;
      const segments = [...givenSegments, ...introSegments, ...llmSegments];

      segmentPlanStatsRef.current = {
        activeDiagramId: activeDiagram?.id ?? null,
        activeDiagramName: activeDiagram?.name ?? null,
        plannedSegmentCount: segments.length,
        introSegmentCount: introSegments.length,
        llmSegmentCount: llmSegments.length,
        blockedUnverifiedDrawCommands: preparedLlmSegments.blockedCommandCount,
        droppedMarkerOnlySegments: preparedLlmSegments.droppedSegmentCount,
      };

      turnTelemetryRef.current?.mark("diagram-plan", {
        active_diagram_id: activeDiagram?.id ?? null,
        active_diagram_name: activeDiagram?.name ?? null,
        planned_segment_count: segments.length,
        given_segment_count: givenSegments.length,
        intro_segment_count: introSegments.length,
        raw_llm_segment_count: rawLlmSegments.length,
        llm_segment_count: llmSegments.length,
        blocked_unverified_draw_commands: preparedLlmSegments.blockedCommandCount,
        dropped_marker_only_segments: preparedLlmSegments.droppedSegmentCount,
        segments: summarizeSegmentsForTrace(segments),
      });

      tutorDebug("turn", "lesson segments built", {
        segment_count: segments.length,
        intro_segment_count: introSegments.length,
        raw_llm_segment_count: rawLlmSegments.length,
        blocked_unverified_draw_commands: preparedLlmSegments.blockedCommandCount,
        dropped_marker_only_segments: preparedLlmSegments.droppedSegmentCount,
        structured: /\[STEP\]/i.test(responseText),
        live_enqueued: liveEnqueued,
      });

      if (liveEnqueued) {
        const segmentQueue = segmentChainRef.current;
        await segmentQueue;
        const drawQueue = drawChainRef.current;
        await drawQueue;
        if (turnGeneration !== turnGenerationRef.current) {
          return;
        }
        setNarrationText(
          [
            ...givenSegments.map((segment) => segment.narration).filter(Boolean),
            ...introSegments.map((segment) => segment.narration).filter(Boolean),
            lessonNarrationText(responseText),
          ].join(" "),
        );
        return;
      }

      if (segments.length === 0) {
        return;
      }

      collectedSegmentsRef.current = [];
      recordedSegmentsRef.current = [];
      segmentChainRef.current = Promise.resolve();
      drawChainRef.current = Promise.resolve();

      for (const segment of givenSegments) {
        enqueueSegment(segment, turnGeneration);
      }
      enqueueVerifiedIntro(introSegments, turnGeneration);
      for (const segment of llmSegments) {
        enqueueSegment(segment, turnGeneration);
      }

      const segmentQueue = segmentChainRef.current;
      await segmentQueue;
      const drawQueue = drawChainRef.current;
      await drawQueue;
      if (turnGeneration !== turnGenerationRef.current) {
        return;
      }
      setNarrationText(
        [
          ...givenSegments.map((segment) => segment.narration).filter(Boolean),
          ...introSegments.map((segment) => segment.narration).filter(Boolean),
          lessonNarrationText(responseText),
        ].join(" "),
      );
    },
    [
      enqueueSegment,
      enqueueVerifiedIntro,
      activeVerifiedDiagramRef,
      segmentPlanStatsRef,
      turnTelemetryRef,
      segmentChainRef,
      drawChainRef,
      collectedSegmentsRef,
      recordedSegmentsRef,
      turnGenerationRef,
      setNarrationText,
      setCurrentSegmentText,
    ],
  );

  const stopTurn = useCallback(() => {
    if (phase === "idle" && !isReplaying) {
      return;
    }

    cancelRef.current = true;
    turnActiveRef.current = false;
    turnGenerationRef.current += 1;

    const telemetry = turnTelemetryRef.current;
    telemetry?.mark("turn-cancelled", {
      phase,
      pending_segment_count: pendingSegmentCountRef.current,
    });
    telemetry?.meta({
      cancelled: true,
      cancel_phase: phase,
      pending_segment_count: pendingSegmentCountRef.current,
      total_duration_ms: telemetry.durationMs(),
    });
    void telemetry?.flush();

    clearCancelTimers();

    isPausedRef.current = false;
    setIsPaused(false);
    turnAbortRef.current?.abort();
    stopReplayAudio(replayAudioRef.current);
    replayAudioRef.current = null;
    replayCueRef.current = null;
    for (const preloaded of replayAudioPreloadRef.current.values()) {
      stopReplayAudio(preloaded);
    }
    replayAudioPreloadRef.current.clear();
    replayGenerationRef.current += 1;
    ttsClientRef.current?.stop();
    whiteboardRef.current?.cancelAnimations();
    const activeIntroTransaction = activeIntroTransactionRef.current;
    if (activeIntroTransaction) {
      whiteboardRef.current?.abortDrawTransaction(activeIntroTransaction);
    }
    whiteboardRef.current?.setPaused(false);

    segmentChainRef.current = Promise.resolve();
    drawChainRef.current = Promise.resolve();
    collectedSegmentsRef.current = [];

    setIsReplaying(false);
    setReplayProgressMs(0);
    setReplayTotalMs(0);
    finishLectureUi();
    setTranscriptOpen(false);
  }, [
    finishLectureUi,
    isReplaying,
    phase,
    cancelRef,
    turnActiveRef,
    turnGenerationRef,
    clearCancelTimers,
    isPausedRef,
    setIsPaused,
    turnAbortRef,
    replayAudioRef,
    replayCueRef,
    replayAudioPreloadRef,
    replayGenerationRef,
    ttsClientRef,
    whiteboardRef,
    segmentChainRef,
    drawChainRef,
    collectedSegmentsRef,
    turnTelemetryRef,
    pendingSegmentCountRef,
    setIsReplaying,
    setReplayProgressMs,
    setReplayTotalMs,
    setTranscriptOpen,
  ]);

  useEffect(() => {
    stopTurnRef.current = stopTurn;
  }, [stopTurn, stopTurnRef]);

  // On unmount, run stopTurn to abort any in-flight LLM stream, stop TTS,
  // cancel whiteboard animations, and clear pending delay timers. React 18+
  // silently ignores state updates after unmount, so the setters inside
  // stopTurn are harmless no-ops.
  useEffect(() => {
    return () => {
      stopTurnRef.current?.();
    };
  }, [stopTurnRef]);

  const pauseTurn = useCallback(() => {
    if (phase === "idle" || isPausedRef.current) {
      return;
    }

    isPausedRef.current = true;
    setIsPaused(true);
    ttsClientRef.current?.pause();
    replayAudioRef.current?.pause();
    // Belt-and-suspenders: Chromium speechSynthesis often ignores pause().
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    whiteboardRef.current?.setPaused(true);
    tutorDebug("turn", "paused");
  }, [phase, isPausedRef, setIsPaused, ttsClientRef, replayAudioRef, whiteboardRef]);

  const resumeTurn = useCallback(() => {
    if (!isPausedRef.current) {
      return;
    }

    isPausedRef.current = false;
    setIsPaused(false);
    ttsClientRef.current?.resume();
    void replayAudioRef.current?.play().catch(() => undefined);
    whiteboardRef.current?.setPaused(false);
    tutorDebug("turn", "resumed");
  }, [isPausedRef, setIsPaused, ttsClientRef, replayAudioRef, whiteboardRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stopTurn();
        return;
      }

      if (event.key !== " " || phase === "idle") {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      if (isPausedRef.current) {
        resumeTurn();
      } else {
        pauseTurn();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pauseTurn, phase, resumeTurn, stopTurn, isPausedRef]);

  useEffect(() => {
    if (!boardLoaded || autoSubmitDoneRef.current) return;
    const q = searchParams.get("q");
    if (!q || q.trim().length === 0) return;
    autoSubmitDoneRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    const question = q.trim();
    pendingQuestionRef.current = question;
    queueMicrotask(() => setInputInteracted(true));

    let cancelled = false;
    const fire = () => {
      if (cancelled || cancelRef.current) return;
      if (phaseRef.current !== "idle") return;
      if (!whiteboardRef.current) {
        window.requestAnimationFrame(fire);
        return;
      }
      void handleQuestionRef.current(question);
    };
    fire();
    return () => {
      cancelled = true;
    };
  }, [
    boardLoaded,
    searchParams,
    handleQuestionRef,
    autoSubmitDoneRef,
    pendingQuestionRef,
    cancelRef,
    phaseRef,
    whiteboardRef,
    setInputInteracted,
  ]);

  const handleAskDoubt = useCallback(
    (question: string) => {
      void handleQuestionRef.current(`I have a doubt about this: ${question}`);
    },
    [handleQuestionRef],
  );

  return {
    finishLectureUi,
    applyTurnPhase,
    enqueueSegment,
    enqueueVerifiedIntro,
    processResponseText,
    stopTurn,
    pauseTurn,
    resumeTurn,
    handleAskDoubt,
  };
}
