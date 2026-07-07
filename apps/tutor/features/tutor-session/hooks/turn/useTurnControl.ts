import { useCallback, useEffect, type RefObject } from "react";
import { stopReplayAudio } from "@/lib/replayAudio";
import {
  parseDrawingCommands,
  type TutorSegment,
  buildLessonSegments,
  lessonNarrationText,
  prepareTemplateLessonSegments,
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
    replayAudioRef,
    replayAudioPreloadRef,
    cancelRef,
    turnActiveRef,
    turnAbortRef,
    segmentChainRef,
    collectedSegmentsRef,
    recordedSegmentsRef,
    activeDiagramTemplateRef,
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
  } = params;

  const finishLectureUi = useCallback(() => {
    turnActiveRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    whiteboardRef.current?.setPaused(false);
    ttsClientRef.current?.stop();
    setPhase("idle");
    setCurrentSegmentText("");
    setInputInteracted(true);
  }, [
    turnActiveRef,
    isPausedRef,
    whiteboardRef,
    ttsClientRef,
    setIsPaused,
    setPhase,
    setCurrentSegmentText,
    setInputInteracted,
  ]);

  const applyTurnPhase = useCallback(
    (next: TutorPhase) => {
      if (turnActiveRef.current && !cancelRef.current) {
        setPhase(next);
      }
    },
    [turnActiveRef, cancelRef, setPhase],
  );

  const { runSegment } = useSegmentRunner({ ...params, applyTurnPhase });

  const enqueueSegment = useCallback(
    (segment: TutorSegment) => {
      const segmentToRun = normalizeSegmentForAlignment(segment);
      collectedSegmentsRef.current.push(segmentToRun);
      const index = collectedSegmentsRef.current.length - 1;

      tutorDebug("parser", "segment enqueued", {
        index,
        narration_preview: segmentToRun.narration.slice(0, 80),
        command_type: segmentToRun.command?.type ?? null,
      });

      segmentChainRef.current = segmentChainRef.current.then(async () => {
        if (cancelRef.current) {
          return;
        }

        try {
          await runSegment(segmentToRun, index, collectedSegmentsRef.current);
        } catch (error) {
          console.error(`Segment ${index} failed:`, error);
          tutorDebug("segment", "segment failed", {
            index,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
    [runSegment, collectedSegmentsRef, segmentChainRef, cancelRef],
  );

  const processResponseText = useCallback(
    async (responseText: string, introSegments: TutorSegment[] = [], liveEnqueued = false) => {
      const parsed = parseDrawingCommands(responseText);

      if (parsed.commands.length === 0 && !parsed.narration.trim() && !/\[STEP\]/i.test(responseText)) {
        const message = "no response from ai";
        setNarrationText(message);
        setCurrentSegmentText(message);
        return;
      }

      const activeTemplate = activeDiagramTemplateRef.current;
      const rawLlmSegments = buildLessonSegments(responseText);
      const preparedLlmSegments = prepareTemplateLessonSegments(rawLlmSegments, activeTemplate);
      const llmSegments = preparedLlmSegments.segments;
      const segments = [...introSegments, ...llmSegments];

      segmentPlanStatsRef.current = {
        activeTemplateId: activeTemplate?.id ?? null,
        activeTemplateName: activeTemplate?.name ?? null,
        plannedSegmentCount: segments.length,
        introSegmentCount: introSegments.length,
        llmSegmentCount: llmSegments.length,
        blockedTemplateDrawCommands: preparedLlmSegments.blockedCommandCount,
        droppedTemplateRedrawSegments: preparedLlmSegments.droppedSegmentCount,
      };

      turnTelemetryRef.current?.mark("diagram-plan", {
        active_template_id: activeTemplate?.id ?? null,
        active_template_name: activeTemplate?.name ?? null,
        planned_segment_count: segments.length,
        intro_segment_count: introSegments.length,
        raw_llm_segment_count: rawLlmSegments.length,
        llm_segment_count: llmSegments.length,
        blocked_template_draw_commands: preparedLlmSegments.blockedCommandCount,
        dropped_template_redraw_segments: preparedLlmSegments.droppedSegmentCount,
        segments: summarizeSegmentsForTrace(segments),
      });

      tutorDebug("turn", "lesson segments built", {
        segment_count: segments.length,
        intro_segment_count: introSegments.length,
        raw_llm_segment_count: rawLlmSegments.length,
        blocked_template_draw_commands: preparedLlmSegments.blockedCommandCount,
        dropped_template_redraw_segments: preparedLlmSegments.droppedSegmentCount,
        structured: /\[STEP\]/i.test(responseText),
        live_enqueued: liveEnqueued,
      });

      if (liveEnqueued) {
        await segmentChainRef.current;
        setNarrationText(
          [
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

      for (const segment of segments) {
        enqueueSegment(segment);
      }

      await segmentChainRef.current;
      setNarrationText(
        [
          ...introSegments.map((segment) => segment.narration).filter(Boolean),
          lessonNarrationText(responseText),
        ].join(" "),
      );
    },
    [
      enqueueSegment,
      activeDiagramTemplateRef,
      segmentPlanStatsRef,
      turnTelemetryRef,
      segmentChainRef,
      collectedSegmentsRef,
      recordedSegmentsRef,
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
    whiteboardRef.current?.setPaused(false);

    segmentChainRef.current = Promise.resolve();
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
    collectedSegmentsRef,
    setIsReplaying,
    setReplayProgressMs,
    setReplayTotalMs,
    setTranscriptOpen,
  ]);

  useEffect(() => {
    stopTurnRef.current = stopTurn;
  }, [stopTurn, stopTurnRef]);

  const pauseTurn = useCallback(() => {
    if (phase === "idle" || isPausedRef.current) {
      return;
    }

    isPausedRef.current = true;
    setIsPaused(true);
    ttsClientRef.current?.pause();
    replayAudioRef.current?.pause();
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
    processResponseText,
    stopTurn,
    pauseTurn,
    resumeTurn,
    handleAskDoubt,
  };
}
