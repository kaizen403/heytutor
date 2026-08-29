import { useCallback, useEffect, useRef, type RefObject } from "react";
import { stopReplayAudio } from "@/lib/replay/replayAudio";
import {
  cancelFrame,
  parseDrawingCommands,
  scheduleFrame,
  type TutorSegment,
  buildLessonSegments,
  lessonNarrationText,
  prepareVerifiedLessonSegments,
  remainingDeferredAnnotations,
} from "@heytutor/drawing";
import { tutorDebug } from "@heytutor/tutor-core";
import {
  summarizeSegmentsForTrace,
  normalizeSegmentForAlignment,
} from "../../lib/segmentPlanning";
import {
  autoQuestionSubmissionKey,
  buildDoubtPrompt,
  buildInterruptedLessonExchange,
  doubtInterruptsLesson,
  isRuntimeReadyForDoubt,
  DOUBT_INTERRUPT_TIMEOUT_MESSAGE,
  DOUBT_INTERRUPT_TIMEOUT_MS,
} from "../../lib/askDoubt";
import { useSegmentRunner } from "./useSegmentRunner";
import type { TutorPhase } from "../../types";
import type { TurnControlApi, UseTurnLifecycleParams } from "./types";

export function useTurnControl(
  params: UseTurnLifecycleParams,
  handleQuestionRef: RefObject<(question: string) => Promise<void>>,
): TurnControlApi {
  const {
    sessionId,
    autoQuestion,
    replaceAutoQuestionUrl = false,
    enableKeyboardControls = true,
    onError,
    phase,
    isReplaying,
    boardLoaded,
    whiteboardRef,
    pendingQuestionRef,
    autoSubmitDoneRef,
    phaseRef,
    isPausedRef,
    rewoundRef,
    conversationHistoryRef,
    liveQuestionRef,
    narrationSinceEpochRef,
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
    setActiveVerifiedDiagram,
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
    setLastError,
    setIsReplaying,
    setReplayProgressMs,
    setReplayTotalMs,
    clearCancelTimers,
    pendingSegmentCountRef,
    resetBoardLayout,
    executeCommandWithCancel,
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
          // CIRCLE_AROUND and HIGHLIGHT are trace marks over geometry the scene
          // has already verified, and they execute through the very same
          // handler as ARROW, which is permitted here. Rejecting them threw out
          // of the intro and left the turn stuck in "thinking" on a blank board
          // for every scene with a focus-on-point or an enclose annotation.
          ["ARROW", "CIRCLE_AROUND", "HIGHLIGHT", "LABEL", "DIMENSION", "FOCUS"].includes(command.type)
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
          setActiveVerifiedDiagram?.(null);
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
      setActiveVerifiedDiagram,
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
        const message = "the tutor did not answer. try asking again.";
        const question = liveQuestionRef.current;
        setNarrationText(message);
        setCurrentSegmentText(message);
        // Subtitles are off by default, so the narration line alone is invisible.
        setLastError({ message, question });
        onError?.({ message, question });
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
        const leftover = activeDiagram ? remainingDeferredAnnotations(activeDiagram) : [];
        for (const command of leftover) {
          await executeCommandWithCancel({
            type: command.type,
            params: [...command.params],
            text: command.text,
            charPosition: 0,
            narrationBefore: "",
            visualStyle: command.visualStyle,
            semanticRef: command.semanticRef,
          }, { trustedDiagramGeometry: true, applyLayout: false, inkPace: "scene" });
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
      const leftover = activeDiagram ? remainingDeferredAnnotations(activeDiagram) : [];
      for (const command of leftover) {
        await executeCommandWithCancel({
          type: command.type,
          params: [...command.params],
          text: command.text,
          charPosition: 0,
          narrationBefore: "",
          visualStyle: command.visualStyle,
          semanticRef: command.semanticRef,
        }, { trustedDiagramGeometry: true, applyLayout: false, inkPace: "scene" });
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
      liveQuestionRef,
      onError,
      setLastError,
      setNarrationText,
      setCurrentSegmentText,
      executeCommandWithCancel,
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
    // A rewind owns this pause. The lecture may only restart by going live —
    // otherwise it would teach on a board the student is not looking at.
    if (rewoundRef?.current) {
      return;
    }

    isPausedRef.current = false;
    setIsPaused(false);
    ttsClientRef.current?.resume();
    void replayAudioRef.current?.play().catch(() => undefined);
    whiteboardRef.current?.setPaused(false);
    tutorDebug("turn", "resumed");
  }, [isPausedRef, rewoundRef, setIsPaused, ttsClientRef, replayAudioRef, whiteboardRef]);

  useEffect(() => {
    if (!enableKeyboardControls) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // Typing a doubt or a notes-chat message must never stop the lesson.
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      // While the student is in the past, the rewind overlay owns these keys.
      if (rewoundRef?.current) {
        return;
      }

      if (event.key === "Escape") {
        stopTurn();
        return;
      }

      if (event.key !== " " || phase === "idle") {
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
  }, [enableKeyboardControls, pauseTurn, phase, resumeTurn, stopTurn, isPausedRef, rewoundRef]);

  useEffect(() => {
    if (!boardLoaded) return;
    const q = autoQuestion?.trim();
    if (!q) return;
    // Keyed per board and question: the URL is consumed once, but a later board
    // (or a new question on this one) is a different submission, not a repeat.
    const submissionKey = autoQuestionSubmissionKey(sessionId, q);
    if (autoSubmitDoneRef.current === submissionKey) return;
    autoSubmitDoneRef.current = submissionKey;
    if (replaceAutoQuestionUrl && typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
    const question = q;
    pendingQuestionRef.current = question;
    queueMicrotask(() => setInputInteracted(true));

    let cancelled = false;
    const fire = () => {
      if (cancelled || cancelRef.current) return;
      if (phaseRef.current !== "idle") return;
      if (!whiteboardRef.current) {
        window.setTimeout(fire, 16);
        return;
      }
      void handleQuestionRef.current(question);
    };
    fire();
    return () => {
      cancelled = true;
    };
  }, [
    sessionId,
    boardLoaded,
    autoQuestion,
    replaceAutoQuestionUrl,
    handleQuestionRef,
    autoSubmitDoneRef,
    pendingQuestionRef,
    cancelRef,
    phaseRef,
    whiteboardRef,
    setInputInteracted,
  ]);

  // A doubt raised mid-lesson has to stop that lesson, wait for it to unwind,
  // and only then start its own turn. `handleQuestion` silently drops anything
  // that arrives while the previous turn is still tearing down.
  const isReplayingRef = useRef(isReplaying);
  useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying]);

  const pendingDoubtRef = useRef<string | null>(null);
  const doubtFrameRef = useRef(0);
  const doubtDeadlineRef = useRef(0);

  const cancelDoubtFlush = useCallback(() => {
    if (doubtFrameRef.current !== 0) {
      cancelFrame(doubtFrameRef.current);
      doubtFrameRef.current = 0;
    }
  }, []);

  useEffect(() => cancelDoubtFlush, [cancelDoubtFlush]);

  const handleAskDoubt = useCallback(
    (rawDoubt: string) => {
      const doubt = rawDoubt.trim();
      if (!doubt) {
        return;
      }

      cancelDoubtFlush();
      const interrupting = doubtInterruptsLesson({
        phase: phaseRef.current,
        turnActive: turnActiveRef.current,
        isReplaying: isReplayingRef.current,
        pendingSegmentCount: pendingSegmentCountRef.current,
      });
      const prompt = buildDoubtPrompt(
        doubt,
        interrupting ? liveQuestionRef.current : null,
      );

      if (!interrupting) {
        pendingDoubtRef.current = null;
        void handleQuestionRef.current(prompt);
        return;
      }

      const interruptedLesson = buildInterruptedLessonExchange(
        liveQuestionRef.current,
        narrationSinceEpochRef.current,
      );
      if (interruptedLesson) {
        conversationHistoryRef.current.push(interruptedLesson);
        if (conversationHistoryRef.current.length > 10) {
          conversationHistoryRef.current.shift();
        }
      }

      tutorDebug("turn", "doubt interrupts lesson", {
        lesson_question_preview: (liveQuestionRef.current ?? "").slice(0, 80),
        doubt_preview: doubt.slice(0, 80),
        narration_chars: narrationSinceEpochRef.current.length,
      });

      pendingDoubtRef.current = prompt;
      doubtDeadlineRef.current = Date.now() + DOUBT_INTERRUPT_TIMEOUT_MS;
      // Snapshots the board into notes and clears it on the way into the doubt
      // turn (`beginBoardEpoch` inside handleQuestion).
      stopTurn();

      const flushDoubt = () => {
        doubtFrameRef.current = 0;
        const pending = pendingDoubtRef.current;
        if (!pending) {
          return;
        }
        if (
          isRuntimeReadyForDoubt({
            phase: phaseRef.current,
            turnActive: turnActiveRef.current,
            isReplaying: isReplayingRef.current,
            pendingSegmentCount: pendingSegmentCountRef.current,
          })
        ) {
          pendingDoubtRef.current = null;
          void handleQuestionRef.current(pending);
          return;
        }
        if (Date.now() >= doubtDeadlineRef.current) {
          pendingDoubtRef.current = null;
          setLastError({
            message: DOUBT_INTERRUPT_TIMEOUT_MESSAGE,
            question: pending,
          });
          return;
        }
        doubtFrameRef.current = scheduleFrame(flushDoubt);
      };

      flushDoubt();
    },
    [
      cancelDoubtFlush,
      conversationHistoryRef,
      handleQuestionRef,
      liveQuestionRef,
      narrationSinceEpochRef,
      pendingSegmentCountRef,
      phaseRef,
      setLastError,
      stopTurn,
      turnActiveRef,
    ],
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
