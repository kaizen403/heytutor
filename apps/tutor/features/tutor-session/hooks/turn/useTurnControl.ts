import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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
import { compactConversationHistory, tutorDebug, voiceSettingsForDelivery } from "@heytutor/tutor-core";
import {
  summarizeSegmentsForTrace,
  normalizeSegmentForAlignment,
} from "../../lib/turn/segmentPlanning";
import { placeDsaFigureIntro, resolveCodeLessonSegments } from "../../lib/code-lesson/codeLessonSegments";
import { shouldAbandonTurn } from "../../lib/turn/turnFailurePolicy";
import { clearSpotlight } from "../../lib/board/spotlight";
import { workColumnRows } from "../../lib/board/boardLayout";
import { createIntroLayoutCheckpoint } from "../../lib/board/introLayoutCheckpoint";
import {
  autoQuestionSubmissionKey,
  buildDoubtPrompt,
  buildInterruptedLessonExchange,
  interruptedLessonStem,
  interruptedTurnNarration,
  doubtInterruptsLesson,
  doubtTurnTitle,
  isRuntimeReadyForDoubt,
  DOUBT_INTERRUPT_TIMEOUT_MESSAGE,
  DOUBT_INTERRUPT_TIMEOUT_MS,
  type DoubtTurnRequest,
} from "../../lib/input/askDoubt";
import {
  pausedLessonFromLive,
  pausedLessonOnStop,
  type ActiveResume,
  type PausedLessonReason,
  type PausedLessonRequest,
} from "../../lib/turn/doubtTurn";
import { pausedLessonFromStoredTurns } from "../../lib/turn/pausedLessonRestore";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { liveTurnSave } from "../../lib/turn/liveTurnSave";
import { useSegmentRunner } from "./useSegmentRunner";
import type { TutorPhase } from "../../types";
import type { HandleQuestionOptions, TurnControlApi, TurnPauseSource, UseTurnLifecycleParams } from "./types";

export const EMPTY_AI_RESPONSE_MESSAGE = "the tutor did not answer. try asking again.";

/**
 * How far down the segment queue a sentence may still be sent for early
 * generation. The opening pair covers the wait before the first word; every
 * sentence after that is asked for in speaking order as the lecture runs.
 */
const TTS_LOOKAHEAD_QUEUE_DEPTH = 2;

export function isEmptyTutorResponse(
  responseText: string,
  parsed: { commands: readonly unknown[]; narration: string },
): boolean {
  return parsed.commands.length === 0 && !parsed.narration.trim() && !/\[STEP\]/i.test(responseText);
}

export function emptyAiResponseError(question: string): { message: string; question: string } {
  return { message: EMPTY_AI_RESPONSE_MESSAGE, question };
}

interface IntroProgress {
  generation: number;
  segments: TutorSegment[];
  /** Beats fully drawn and spoken. */
  completed: number;
  /** A beat is drawing now, from `savepointId`. */
  inBeat: boolean;
  transactionId: string | null;
  savepointId: string | null;
  beatLayout: { rollback: () => void } | null;
  /** The missing beats of a figure an earlier Stop cut off: drawn, never saved. */
  remainder: boolean;
}

export function useTurnControl(
  params: UseTurnLifecycleParams,
  handleQuestionRef: RefObject<(question: string, options?: HandleQuestionOptions) => Promise<void>>,
): TurnControlApi {
  const {
    sessionId,
    boardLayoutRef,
    boardPageRef,
    boardShowsStoppedReplayRef,
    autoQuestion,
    replaceAutoQuestionUrl = false,
    enableKeyboardControls = true,
    onError,
    onSpeechStartupStatus,
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
    ttsClientRef,
    ensureTTSClient,
    currentTraceIdRef,
    replayAudioRef,
    replayDrawClockRef,
    replayAudioPreloadRef,
    cancelRef,
    turnActiveRef,
    turnGenerationRef,
    turnAbortRef,
    segmentChainRef,
    drawChainRef,
    collectedSegmentsRef,
    recordedSegmentsRef,
    narrationSinceEpochRef,
    activeVerifiedDiagramRef,
    codeLessonControllerRef,
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
    executeCommandWithCancel,
  } = params;
  const activeIntroTransactionRef = useRef<string | null>(null);
  const introNarrationCleanupRef = useRef<{ transactionId: string; rollback: () => void } | null>(null);
  /** Set when a doubt interrupt commits an in-flight intro so its catch does not roll the ink back. */
  const introKeptByStopRef = useRef<string | null>(null);
  /**
   * The figure intro queued or drawing now: which beats finished, and the
   * savepoint of the one in progress. Stop keeps the finished beats and hands
   * the rest to Continue (decision 4).
   */
  const introProgressRef = useRef<IntroProgress | null>(null);
  /** Figure beats the last Stop left undrawn, for the doubt snapshot taken right after it. */
  const stopRemainderRef = useRef<TutorSegment[] | undefined>(undefined);
  /** The resume this tab is teaching now, so a Stop of it is offered again. */
  const activeResumeRef = useRef<ActiveResume | null>(null);
  /** Resets on any segment that completes; see turnFailurePolicy. */
  const consecutiveSegmentFailuresRef = useRef(0);

  const finishLectureUi = useCallback((turnGeneration?: number) => {
    if (
      turnGeneration !== undefined &&
      turnGeneration !== turnGenerationRef.current
    ) {
      return;
    }
    turnActiveRef.current = false;
    if (typeof onSpeechStartupStatus === "function") onSpeechStartupStatus(null);
    isPausedRef.current = false;
    setIsPaused(false);
    whiteboardRef.current?.setPaused(false);
    // Whatever happened during the turn, the board must not be left dimmed.
    clearSpotlight(whiteboardRef.current);
    try {
      ttsClientRef.current?.stop();
    } catch {
      // Transport cleanup cannot keep a cancelled lecture active in the UI.
    }
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
    onSpeechStartupStatus,
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

  const { runSegment, pauseFallbackSpeech, resumeFallbackSpeech, stopFallbackSpeech, speakingNarrationRef } = useSegmentRunner({ ...params, applyTurnPhase });

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

      // Only the front of the queue may generate ahead. The whole lesson is
      // usually enqueued while the first sentence is still being spoken, so
      // asking for all of it here handed the one lookahead slot to whichever
      // segment happened to arrive — the tenth, say — and the sentence
      // actually coming next then had to be generated from scratch. Past the
      // opening, `useSegmentRunner` asks for the next one in speaking order.
      const queuePosition = pendingSegmentCountRef.current - 1;
      if (segmentToRun.narration.trim() && queuePosition < TTS_LOOKAHEAD_QUEUE_DEPTH) {
        ensureTTSClient().prefetchSegment?.(segmentToRun.narration, {
          previousText: collectedSegmentsRef.current[index - 1]?.narration,
          nextText: undefined,
          traceId: currentTraceIdRef.current ?? undefined,
          sessionId: sessionId ?? undefined,
          voiceSettings: voiceSettingsForDelivery(segmentToRun.delivery),
        });
      }

      // Only the live turn's segments are counted: `stopTurn` zeroes the count,
      // and a stopped turn's stragglers must not take from the next turn's.
      const counted = () => turnGeneration === turnGenerationRef.current;
      segmentChainRef.current = segmentChainRef.current.then(async () => {
        if (cancelRef.current || turnGeneration !== turnGenerationRef.current) {
          if (counted()) {
            pendingSegmentCountRef.current = Math.max(pendingSegmentCountRef.current - 1, 0);
          }
          return;
        }

        try {
          await runSegment(
            segmentToRun,
            index,
            collectedSegmentsRef.current,
            turnGeneration,
          );
          consecutiveSegmentFailuresRef.current = 0;
        } catch (error) {
          consecutiveSegmentFailuresRef.current += 1;
          console.error(`Segment ${index} failed:`, error);
          tutorDebug("segment", "segment failed", {
            index,
            error: error instanceof Error ? error.message : String(error),
            consecutive_failures: consecutiveSegmentFailuresRef.current,
          });
          // console.error only reaches the browser. A segment dying is the
          // failure that looks like the board froze, so send it where it can
          // actually be read back after the fact.
          turnTelemetryRef.current?.mark("segment-failed", {
            segment_index: index,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? (error.stack ?? "").slice(0, 600) : "",
            consecutive_failures: consecutiveSegmentFailuresRef.current,
          });
          // Two in a row means the drawing pipeline is gone, not that one
          // command was unlucky. Stop the turn rather than narrate the rest of
          // the lesson to a board that has stopped moving.
          // A stopped turn's straggler failing must not cancel the turn that
          // replaced it.
          if (counted() && shouldAbandonTurn(consecutiveSegmentFailuresRef.current)) {
            tutorDebug("segment", "abandoning turn after repeated draw failures", {
              index,
              consecutive_failures: consecutiveSegmentFailuresRef.current,
            });
            cancelRef.current = true;
            const failure = {
              message: "The lesson could not continue playing. Please try again.",
              question: liveQuestionRef.current,
            };
            setLastError(failure);
            onError?.(failure);
          }
        } finally {
          if (counted()) {
            pendingSegmentCountRef.current = Math.max(pendingSegmentCountRef.current - 1, 0);
          }
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
      turnTelemetryRef,
      liveQuestionRef,
      setLastError,
      onError,
    ],
  );

  const enqueueVerifiedIntro = useCallback(
    (segments: TutorSegment[], turnGeneration = turnGenerationRef.current, options?: { remainder?: boolean }) => {
      if (segments.length === 0 || turnGeneration !== turnGenerationRef.current) return;
      const normalized = segments.map(normalizeSegmentForAlignment);
      const remainder = options?.remainder === true;
      const unsafeCommand = normalized.flatMap((segment) => segment.commands ?? []).find((command) =>
        !(
          command.type.startsWith("DRAW_") ||
          // CIRCLE_AROUND and HIGHLIGHT are trace marks over geometry the scene
          // has already verified, and they execute through the very same
          // handler as ARROW, which is permitted here. Rejecting them threw out
          // of the intro and left the turn stuck in "thinking" on a blank board
          // for every scene with a focus-on-point or an enclose annotation.
          // FOCUS may consume deferred annotations and control spotlight state.
          // The canonical presentation compiler keeps it outside intro reveals.
          ["ARROW", "CIRCLE_AROUND", "HIGHLIGHT", "LABEL", "DIMENSION"].includes(command.type)
        )
      );
      if (unsafeCommand) {
        throw new Error(`verified intro contains non-transactional command ${unsafeCommand.type}`);
      }
      const startIndex = collectedSegmentsRef.current.length;
      collectedSegmentsRef.current.push(...normalized);
      pendingSegmentCountRef.current += normalized.length;
      const tts = ensureTTSClient();
      const pendingBeforeIntro = pendingSegmentCountRef.current - normalized.length;
      normalized.forEach((segment, offset) => {
        if (!segment.narration.trim()) return;
        // Same rule as enqueueSegment: only the opening generates ahead here.
        if (pendingBeforeIntro + offset >= TTS_LOOKAHEAD_QUEUE_DEPTH) return;
        tts.prefetchSegment?.(segment.narration, {
          previousText: normalized[offset - 1]?.narration ?? collectedSegmentsRef.current[startIndex - 1]?.narration,
          nextText: normalized[offset + 1]?.narration,
          traceId: currentTraceIdRef.current ?? undefined,
          sessionId: sessionId ?? undefined,
          voiceSettings: voiceSettingsForDelivery(segment.delivery),
        });
      });

      // Counted for the live turn only, as in `enqueueSegment`.
      const counted = () => turnGeneration === turnGenerationRef.current;
      const progress: IntroProgress = {
        generation: turnGeneration,
        segments: normalized,
        completed: 0,
        inBeat: false,
        transactionId: null,
        savepointId: null,
        beatLayout: null,
        remainder,
      };
      introProgressRef.current = progress;
      const releaseProgress = () => {
        if (introProgressRef.current === progress) introProgressRef.current = null;
      };
      segmentChainRef.current = segmentChainRef.current.then(async () => {
        const wb = whiteboardRef.current;
        if (!wb || cancelRef.current || turnGeneration !== turnGenerationRef.current) {
          releaseProgress();
          if (counted()) {
            pendingSegmentCountRef.current = Math.max(
              pendingSegmentCountRef.current - normalized.length,
              0,
            );
          }
          return;
        }
        const transactionId = wb.beginDrawTransaction();
        const introLayout = createIntroLayoutCheckpoint(boardLayoutRef.current);
        activeIntroTransactionRef.current = transactionId;
        progress.transactionId = transactionId;
        const introPage = boardPageRef.current?.boardId === sessionId ? boardPageRef.current : null;
        // The rest of a figure Stop cut off: its rows are held like a fresh
        // intro's, then dropped instead of sent. The stopped turn's save already
        // holds the whole figure (the server completes its intro).
        if (remainder && introPage) introPage.figureDrawn = false;
        const introRecordedRows = new Set<(typeof recordedSegmentsRef.current)[number]>();
        const narrationBeforeIntro = narrationSinceEpochRef.current;
        let narrationAfterIntro = narrationBeforeIntro;
        let narrationCleanupDone = false;
        const rollbackIntroNarration = () => {
          if (narrationCleanupDone) return;
          narrationCleanupDone = true;
          // Compare against the last value this intro actually published. A
          // replacement turn/notes epoch owns any different value by now.
          if (narrationSinceEpochRef.current === narrationAfterIntro) {
            narrationSinceEpochRef.current = narrationBeforeIntro;
          }
        };
        introNarrationCleanupRef.current = { transactionId, rollback: rollbackIntroNarration };
        let committed = false;
        try {
          // Every compiled reveal beat must finish both speech and actual ink.
          // A startup miss cannot count as an empty successful reveal.
          for (const [offset, segment] of normalized.entries()) {
            if (cancelRef.current || turnGeneration !== turnGenerationRef.current) {
              throw new DOMException("verified intro cancelled", "AbortError");
            }
            const savepointId = wb.createDrawSavepoint(transactionId);
            const beatLayout = createIntroLayoutCheckpoint(introLayout.layout, introLayout);
            progress.savepointId = savepointId;
            progress.beatLayout = beatLayout;
            progress.inBeat = true;
            await runSegment(
              segment,
              startIndex + offset,
              collectedSegmentsRef.current,
              turnGeneration,
              () => {
                if (cancelRef.current || !counted() || activeIntroTransactionRef.current !== transactionId) {
                  throw new DOMException("verified intro restart cancelled", "AbortError");
                }
                beatLayout.rollback();
                wb.rollbackDrawSavepoint(transactionId, savepointId);
              },
              beatLayout,
              (row) => {
                introRecordedRows.add(row);
                narrationAfterIntro = narrationSinceEpochRef.current;
              },
            );
            progress.inBeat = false;
            progress.completed = offset + 1;
          }
          if (cancelRef.current || turnGeneration !== turnGenerationRef.current) {
            throw new DOMException("verified intro cancelled", "AbortError");
          }
          wb.commitDrawTransaction(transactionId);
          committed = true;
          if (remainder) {
            recordedSegmentsRef.current = recordedSegmentsRef.current.filter((row) => !introRecordedRows.has(row));
            liveTurnSave().dropIntroRows(cancelRef, turnGeneration);
            // Drawn: a later Stop of this resume owes no figure beats.
            const active = activeResumeRef.current;
            if (active?.request.remainingIntro) {
              activeResumeRef.current = { ...active, request: { ...active.request, remainingIntro: undefined } };
            }
          }
          // The figure is ink now, not a plan: a doubt asked from here may point at it.
          const page = boardPageRef.current;
          if (page && page.boardId === sessionId) {
            page.figureDrawn = true;
          }
          // Its held rows are ink now: save them with the figure at once.
          liveTurnSave().figureCommitted(cancelRef, turnGeneration);
        } catch (error) {
          // A doubt interrupt may already have committed this intro so the
          // figure the student circled stays on the board. Aborting here
          // rolled that ink back and the doubt answered on blank paper.
          if (introKeptByStopRef.current === transactionId) {
            throw error;
          }
          wb.abortDrawTransaction(transactionId);
          introLayout.rollback();
          // Remove exact rows owned by this intro even after Stop increments the
          // turn generation. Never splice a replacement turn's new recordings.
          recordedSegmentsRef.current = recordedSegmentsRef.current.filter((row) => !introRecordedRows.has(row));
          // Never saved either: a figure that did not commit leaves no rows.
          liveTurnSave().dropIntroRows(cancelRef, turnGeneration);
          rollbackIntroNarration();
          // A remainder's figure keeps the beats an earlier Stop committed.
          if (remainder && introPage) introPage.figureDrawn = true;
          // Only the intro's own turn is torn down with it. A stopped turn's
          // intro unwinding late must not cancel, abort, or strip the figure
          // from the turn that has already replaced it.
          if (counted()) {
            // Intro rows become successful together with the whole figure.
            if (!remainder) {
              activeVerifiedDiagramRef.current = null;
              setActiveVerifiedDiagram?.(null);
              fbdPhaseMarkedRef.current = false;
              fbdPhaseStartedRef.current = false;
            }

            cancelRef.current = true;
            pendingSegmentCountRef.current = 0;
            turnAbortRef.current?.abort(error);
          }
          throw error;
        } finally {
          releaseProgress();
          const kept = introKeptByStopRef.current === transactionId;
          if (kept) introKeptByStopRef.current = null;
          if (!committed && !kept) wb.finishAbortedDrawTransaction(transactionId);
          if (activeIntroTransactionRef.current === transactionId) {
            activeIntroTransactionRef.current = null;
          }
          if (introNarrationCleanupRef.current?.transactionId === transactionId) {
            introNarrationCleanupRef.current = null;
          }
          if (counted()) {
            pendingSegmentCountRef.current = Math.max(
              pendingSegmentCountRef.current - normalized.length,
              0,
            );
          }
        }
      });
    },
    [
      activeVerifiedDiagramRef,
      setActiveVerifiedDiagram,
      boardLayoutRef,
      boardPageRef,
      cancelRef,
      collectedSegmentsRef,
      recordedSegmentsRef,
      narrationSinceEpochRef,
      fbdPhaseMarkedRef,
      fbdPhaseStartedRef,
      pendingSegmentCountRef,
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
      options?: { revealDeferredAnnotations?: boolean; errorQuestion?: string },
    ) => {
      if (turnGeneration !== turnGenerationRef.current) {
        return;
      }
      const revealDeferredAnnotations = options?.revealDeferredAnnotations ?? true;
      const parsed = parseDrawingCommands(responseText);

      if (isEmptyTutorResponse(responseText, parsed)) {
        // Subtitles are off by default — never put this in narrationText.
        // A doubt names its own prompt here: the live question is the lesson's,
        // and retrying that would re-teach the lesson instead of the doubt.
        const error = emptyAiResponseError(options?.errorQuestion ?? liveQuestionRef.current);
        setLastError(error);
        onError?.(error);
        return;
      }

      const activeDiagram = activeVerifiedDiagramRef.current;
      const rawLlmSegments = buildLessonSegments(responseText);
      const preparedLlmSegments = prepareVerifiedLessonSegments(rawLlmSegments, activeDiagram);
      // During a code lesson the teaching stream may only narrate, gesture,
      // and reveal committed blocks; [TYPE] tags resolve to their exact code.
      const codeLessonState = codeLessonControllerRef?.current?.getState();
      const activeCodeLesson = codeLessonState?.plan ?? null;
      const frameSet = codeLessonControllerRef?.current?.frames.getSet();
      const llmSegments = activeCodeLesson
        ? resolveCodeLessonSegments(preparedLlmSegments.segments, activeCodeLesson, {
            // The batch path sees the whole response at once, so one conductor
            // call covers the turn and frame advances land between blocks.
            frameCount: codeLessonControllerRef?.current?.frames.total() ?? 0,
            frameIds: frameSet?.frames.map((frame) => frame.id) ?? [],
            frameFocusIds: frameSet?.frames.map((frame) => frame.focusEntityIds) ?? [],
            framePointIds: frameSet?.frames.map((frame) => frame.pointEntityIds) ?? [],
          }).segments
        : preparedLlmSegments.segments;
      const segments = activeCodeLesson
        ? placeDsaFigureIntro(givenSegments, introSegments, llmSegments)
        : [...givenSegments, ...introSegments, ...llmSegments];

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
        const leftover = activeDiagram && revealDeferredAnnotations
        ? remainingDeferredAnnotations(activeDiagram)
        : [];
        for (const command of leftover) {
          // A doubt can own the board by now: one starts the moment this turn
          // is stopped, and these labels must not draw onto its page.
          if (turnGeneration !== turnGenerationRef.current) {
            return;
          }
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

      if (activeCodeLesson) {
        let index = 0;
        while (
          index < segments.length &&
          segments[index] !== introSegments[0] &&
          segments[index]?.verifiedDiagramIntro !== true
        ) {
          enqueueSegment(segments[index]!, turnGeneration);
          index += 1;
        }
        enqueueVerifiedIntro(introSegments, turnGeneration);
        while (
          index < segments.length &&
          (introSegments.includes(segments[index]!) ||
            segments[index]?.verifiedDiagramIntro === true)
        ) {
          index += 1;
        }
        while (index < segments.length) {
          enqueueSegment(segments[index]!, turnGeneration);
          index += 1;
        }
      } else {
        for (const segment of givenSegments) {
          enqueueSegment(segment, turnGeneration);
        }
        enqueueVerifiedIntro(introSegments, turnGeneration);
        for (const segment of llmSegments) {
          enqueueSegment(segment, turnGeneration);
        }
      }

      const segmentQueue = segmentChainRef.current;
      await segmentQueue;
      const drawQueue = drawChainRef.current;
      await drawQueue;
      if (turnGeneration !== turnGenerationRef.current) {
        return;
      }
      const leftover = activeDiagram && revealDeferredAnnotations
        ? remainingDeferredAnnotations(activeDiagram)
        : [];
      for (const command of leftover) {
        if (turnGeneration !== turnGenerationRef.current) {
          return;
        }
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
      codeLessonControllerRef,
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
      executeCommandWithCancel,
    ],
  );

  const pausedLessonRef = useRef<PausedLessonRequest | null>(null);
  /** Board the offer belongs to, and why it stopped. Another board must not resume it. */
  const [pausedLessonOfferState, setPausedLessonOfferState] = useState<
    { boardId: string; reason: PausedLessonReason } | null
  >(null);
  const showPausedLessonOffer = useCallback((pending: PausedLessonRequest | null) => {
    setPausedLessonOfferState(pending ? { boardId: pending.boardId, reason: pending.reason } : null);
  }, []);

  const stopTurn = useCallback((options?: { keepVisibleBoard?: boolean; supersede?: boolean }) => {
    if (typeof onSpeechStartupStatus === "function") onSpeechStartupStatus(null);
    // A plain Stop of a lesson or a resume (not a doubt's interrupt, not a new
    // board, not a replay) leaves it to continue: it keeps its figure and words
    // like a doubt does, and is offered again below (decisions 3 and 4).
    const stopPage = boardPageRef.current?.boardId === sessionId ? boardPageRef.current : null;
    const lessonStop =
      !options?.keepVisibleBoard &&
      !options?.supersede &&
      phase !== "idle" &&
      !isReplaying &&
      (activeResumeRef.current !== null || stopPage?.turn?.kind === "lesson");
    const keepIntro = options?.keepVisibleBoard === true || lessonStop;
    const stoppedGeneration = turnGenerationRef.current;
    const stoppedTraceId = currentTraceIdRef?.current ?? null;
    const stoppedProgress = introProgressRef.current?.generation === stoppedGeneration
      ? introProgressRef.current
      : null;
    // Read before anything below unwinds the turn: the step Stop cut off, and
    // whether this turn put anything on the board at all.
    const stoppedStep = lessonStop
      ? (speakingNarrationRef.current || recordedSegmentsRef.current.at(-1)?.narration || "").trim()
      : "";
    const taught = lessonStop && (
      recordedSegmentsRef.current.length > 0 ||
      speakingNarrationRef.current.trim().length > 0 ||
      Boolean(stoppedProgress && (stoppedProgress.completed > 0 || stoppedProgress.inBeat)));
    stopRemainderRef.current = undefined;
    // Stop invalidates generation and releases the queue immediately. Remove
    // this intro's completed epoch contribution before a successor can append;
    // a doubt or a resumable Stop retains the visible intro and its narration.
    if (!keepIntro) introNarrationCleanupRef.current?.rollback();
    // Stop only this shell's primary and runner-owned fallback. Browser
    // speechSynthesis.cancel() is page-global and could silence a sibling.
    try {
      ttsClientRef.current?.stop();
    } catch (error) {
      turnTelemetryRef.current?.mark("tts-stop-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      stopFallbackSpeech();
    }

    if (phase === "idle" && !isReplaying) {
      // New board. The UI is already idle, but a parked segment only checks
      // the generation it captured. Bump it so that segment cannot draw after
      // the next board clears the cancel flag. Do not touch input state: this
      // board is about to be replaced, and marking it interacted would skip
      // the landing on the fresh one.
      if (options?.supersede) {
        cancelRef.current = true;
        turnActiveRef.current = false;
        turnGenerationRef.current += 1;
        pendingSegmentCountRef.current = 0;
        turnAbortRef.current?.abort();
        whiteboardRef.current?.cancelAnimations();
        segmentChainRef.current = Promise.resolve();
        drawChainRef.current = Promise.resolve();
      }
      return;
    }

    if (isReplaying) {
      // The board is left on whatever page the replay had reached.
      boardShowsStoppedReplayRef.current = true;
    }
    cancelRef.current = true;
    turnActiveRef.current = false;
    turnGenerationRef.current += 1;
    // The count is of the live turn's unfinished segments. The stopped turn's
    // stragglers are generation-guarded and never draw again, so whatever
    // starts next need not wait for them: a segment parked on a paused voice
    // used to hold a doubt past its deadline, and the doubt was lost.
    pendingSegmentCountRef.current = 0;

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
    whiteboardRef.current?.cancelAnimations();
    const activeIntroTransaction = activeIntroTransactionRef.current;
    const progress = stoppedProgress?.transactionId === activeIntroTransaction ? stoppedProgress : null;
    if (activeIntroTransaction) {
      if (keepIntro) {
        // A doubt is asked over the figure the student can already see. Aborting
        // the intro rolled that ink back and the doubt answered on blank paper.
        // A plain Stop keeps the beats that finished and takes back the one it
        // cut off: Continue draws it whole, with the rest of the figure.
        if (lessonStop && progress?.inBeat && progress.savepointId) {
          whiteboardRef.current?.rollbackDrawSavepoint(activeIntroTransaction, progress.savepointId);
          progress.beatLayout?.rollback();
        }
        // The rest of a figure an earlier Stop cut off is never saved: the
        // stopped turn's save already holds the whole figure.
        if (progress?.remainder) liveTurnSave().dropIntroRows(cancelRef, stoppedGeneration);
        whiteboardRef.current?.commitDrawTransaction(activeIntroTransaction);
        introKeptByStopRef.current = activeIntroTransaction;
        // Before the save closes below, so the held intro rows go with the figure.
        const page = boardPageRef.current;
        if (page && page.boardId === sessionId) {
          page.figureDrawn = true;
        }
        if (progress) stopRemainderRef.current = progress.segments.slice(progress.completed);
      } else {
        whiteboardRef.current?.abortDrawTransaction(activeIntroTransaction);
      }
      activeIntroTransactionRef.current = null;
    } else if (stoppedProgress && stoppedProgress.transactionId === null && boardPageRef.current?.figureDrawn) {
      // Queued behind other segments and never started: every beat still owed.
      stopRemainderRef.current = [...stoppedProgress.segments];
    }
    if (lessonStop) {
      const snapshot = pausedLessonOnStop({
        record: stopPage,
        boardId: sessionId,
        activeResume: activeResumeRef.current,
        taught,
        liveQuestion: liveQuestionRef.current ?? "",
        codeLesson: Boolean(codeLessonControllerRef?.current?.getActivePlan()),
        lessonBoardRows: workColumnRows(boardLayoutRef.current).map((row) =>
          row.workId ? { workId: row.workId, text: row.text } : { text: row.text },
        ),
        interruptedStep: stoppedStep,
        parentTraceId: stoppedTraceId,
        remainingIntro: stopRemainderRef.current,
      });
      activeResumeRef.current = null;
      if (snapshot) {
        pausedLessonRef.current = snapshot;
        showPausedLessonOffer(snapshot);
      }
    }
    // Save what the stopped lesson taught now, not when its aborted chain
    // unwinds (that may never happen on a stall). After the intro above, so a
    // figure kept for a doubt goes with it. The turn's own `finally` is then a
    // no-op.
    liveTurnSave().closeOwner(cancelRef);
    whiteboardRef.current?.setPaused(false);

    segmentChainRef.current = Promise.resolve();
    drawChainRef.current = Promise.resolve();
    collectedSegmentsRef.current = [];

    setIsReplaying(false);
    setReplayProgressMs(0);
    setReplayTotalMs(0);
    finishLectureUi();
  }, [
    boardShowsStoppedReplayRef,
    boardPageRef,
    boardLayoutRef,
    codeLessonControllerRef,
    currentTraceIdRef,
    liveQuestionRef,
    recordedSegmentsRef,
    speakingNarrationRef,
    showPausedLessonOffer,
    finishLectureUi,
    isReplaying,
    phase,
    sessionId,
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
    stopFallbackSpeech,
    whiteboardRef,
    segmentChainRef,
    drawChainRef,
    collectedSegmentsRef,
    turnTelemetryRef,
    pendingSegmentCountRef,
    setIsReplaying,
    setReplayProgressMs,
    setReplayTotalMs,
    onSpeechStartupStatus,
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

  const pauseTurn = useCallback((source: TurnPauseSource = "control") => {
    if (phaseRef.current === "idle" || isPausedRef.current) {
      return;
    }

    pauseFallbackSpeech();
    isPausedRef.current = true;
    replayDrawClockRef.current?.setPaused(true);
    setIsPaused(true);
    ttsClientRef.current?.pause();
    replayAudioRef.current?.pause();
    whiteboardRef.current?.setPaused(true);
    tutorDebug("turn", "paused");
    turnTelemetryRef.current?.mark("turn-paused", {
      source: source === "keyboard" || source === "doubt-composer" || source === "marking" || source === "rewind"
        ? source : "control",
      phase: phaseRef.current,
      turn_generation: turnGenerationRef.current,
      pending_segment_count: pendingSegmentCountRef.current,
      audio_context_state: ttsClientRef.current?.getAudioContextState?.() ?? null,
    });
  }, [phaseRef, isPausedRef, replayDrawClockRef, setIsPaused, ttsClientRef, replayAudioRef, whiteboardRef, pauseFallbackSpeech, turnTelemetryRef, turnGenerationRef, pendingSegmentCountRef]);

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
    replayDrawClockRef.current?.setPaused(false);
    resumeFallbackSpeech();
    setIsPaused(false);
    ttsClientRef.current?.resume();
    void replayAudioRef.current?.play().catch(() => undefined);
    whiteboardRef.current?.setPaused(false);
    tutorDebug("turn", "resumed");
    turnTelemetryRef.current?.mark("turn-resumed", {
      phase: phaseRef.current,
      turn_generation: turnGenerationRef.current,
      pending_segment_count: pendingSegmentCountRef.current,
      audio_context_state: ttsClientRef.current?.getAudioContextState?.() ?? null,
    });
  }, [phaseRef, isPausedRef, rewoundRef, replayDrawClockRef, setIsPaused, ttsClientRef, replayAudioRef, whiteboardRef, resumeFallbackSpeech, turnTelemetryRef, turnGenerationRef, pendingSegmentCountRef]);

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
      if (event.key === " " && target instanceof HTMLElement && target.closest("button, [role='button']")) return;

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
        pauseTurn("keyboard");
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
      window.history.replaceState(window.history.state ?? {}, "", window.location.pathname);
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

  const pendingDoubtRef = useRef<DoubtTurnRequest | null>(null);
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
    /**
     * `options.prompt` lets a caller that has already composed a grounded
     * question — a marked doubt naming the exact board lines it is about —
     * hand it over whole, instead of having it wrapped a second time.
     * `options.title` is what the doubt is saved and listed under.
     */
    (rawDoubt: string, options?: { prompt?: string; title?: string }) => {
      const doubt = rawDoubt.trim();
      const composed = options?.prompt?.trim() ?? "";
      if (!doubt && !composed) {
        return;
      }

      cancelDoubtFlush();
      const runtime = {
        phase: phaseRef.current,
        turnActive: turnActiveRef.current,
        isReplaying: isReplayingRef.current,
        pendingSegmentCount: pendingSegmentCountRef.current,
      };
      // A lesson to stop, or a runtime that would not take a question yet:
      // either way the doubt waits for it. Sent straight to `handleQuestion`
      // while segments were still counted, it used to be dropped without a word.
      const interrupting = doubtInterruptsLesson(runtime) || !isRuntimeReadyForDoubt(runtime);
      // Mid-lesson or after it, a doubt is about the lesson on this board and
      // is answered on its page, so it always carries that lesson's question.
      const lessonQuestion = (liveQuestionRef.current ?? "").trim();
      const request: DoubtTurnRequest = {
        prompt: composed || buildDoubtPrompt(doubt, lessonQuestion || null),
        title: options?.title?.trim() || doubtTurnTitle(doubt),
        lessonQuestion,
        // Over a replay, or over the page a stopped replay left behind, the
        // board is not the last saved page, so the doubt cannot continue it.
        afterReplay: isReplayingRef.current || boardShowsStoppedReplayRef.current,
      };
      // From here the page is the doubt's own record.
      boardShowsStoppedReplayRef.current = false;
      // The lesson stopped earlier is now continued after a doubt: its resume
      // may say so. A resume this doubt interrupts is snapshotted below.
      const activeResume = activeResumeRef.current?.request.boardId === sessionId
        ? activeResumeRef.current
        : null;
      activeResumeRef.current = null;
      const paused = pausedLessonRef.current;
      if (paused && paused.boardId === sessionId && paused.reason !== "doubt") {
        pausedLessonRef.current = { ...paused, reason: "doubt" };
      }

      if (!interrupting) {
        pendingDoubtRef.current = null;
        void handleQuestionRef.current(request.prompt, { doubt: request });
        return;
      }

      // The page transcript includes every earlier doubt. Handing it back on
      // each interruption duplicates old explanations until they crowd out the
      // student's current question. Only the interrupted turn belongs here.
      const interruptedNarration = runtime.turnActive
        ? interruptedTurnNarration(
            recordedSegmentsRef.current.map((segment) => segment.narration),
            speakingNarrationRef.current,
          )
        : "";
      const interruptedLesson = buildInterruptedLessonExchange(
        interruptedLessonStem(boardPageRef.current, liveQuestionRef.current),
        interruptedNarration,
      );
      if (interruptedLesson) {
        conversationHistoryRef.current = compactConversationHistory([
          ...conversationHistoryRef.current,
          interruptedLesson,
        ]);
      }

      tutorDebug("turn", "doubt interrupts lesson", {
        lesson_question_preview: (liveQuestionRef.current ?? "").slice(0, 80),
        doubt_preview: (doubt || composed).slice(0, 80),
        narration_chars: interruptedNarration.length,
      });

      const lessonBoardRows = workColumnRows(boardLayoutRef.current).map((row) => ({ ...row }));
      const interruptedStep = (speakingNarrationRef.current ||
        recordedSegmentsRef.current.at(-1)?.narration || "").trim();
      const interruptedTraceId = currentTraceIdRef.current;
      const resumePageBefore = activeResume?.pageBefore ?? null;
      pendingDoubtRef.current = request;
      doubtDeadlineRef.current = Date.now() + DOUBT_INTERRUPT_TIMEOUT_MS;
      // Stops the voice and the pen and leaves the page exactly as it is: the
      // doubt turn skips `beginBoardEpoch` and writes under what the lesson wrote.
      // Keep the visible figure — aborting an in-flight intro used to wipe it.
      stopTurn({ keepVisibleBoard: true });
      // stop() closes the lecture AudioContext. Re-arm it in this click so the
      // doubt's first sentence is not silent after the interrupt unwind.
      ttsClientRef.current?.unlockAudio?.();
      // A resume interrupted before its own page record exists hands back the
      // request it started from; otherwise the page it is teaching on.
      const resumeNotStarted = activeResume !== null &&
        (boardPageRef.current === resumePageBefore || boardPageRef.current?.turn.kind === "doubt");
      const snapshot = resumeNotStarted
        ? { ...activeResume.request, reason: "doubt" as const }
        : pausedLessonFromLive({
            record: boardPageRef.current,
            boardId: sessionId,
            lessonQuestion: liveQuestionRef.current,
            codeLesson: Boolean(codeLessonControllerRef?.current?.getActivePlan()),
            figureDrawn: Boolean(activeVerifiedDiagramRef.current),
            lessonBoardRows,
            interruptedStep,
            reason: "doubt",
            parentTraceId: interruptedTraceId,
            remainingIntro: stopRemainderRef.current,
          });
      if (snapshot) {
        const existing = pausedLessonRef.current;
        // A nested doubt must not replace the original lesson snapshot with the
        // doubt's text-only page record, or the lecture resumes without its figure.
        if (!existing || boardPageRef.current?.turn.kind === "lesson") {
          pausedLessonRef.current = snapshot;
        }
      }

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
          void handleQuestionRef.current(pending.prompt, { doubt: pending });
          return;
        }
        if (Date.now() >= doubtDeadlineRef.current) {
          pendingDoubtRef.current = null;
          setLastError({
            message: DOUBT_INTERRUPT_TIMEOUT_MESSAGE,
            question: pending.prompt,
          });
          return;
        }
        doubtFrameRef.current = scheduleFrame(flushDoubt);
      };

      flushDoubt();
    },
    [
      boardShowsStoppedReplayRef,
      boardLayoutRef,
      boardPageRef,
      cancelDoubtFlush,
      codeLessonControllerRef,
      conversationHistoryRef,
      currentTraceIdRef,
      activeVerifiedDiagramRef,
      handleQuestionRef,
      liveQuestionRef,
      recordedSegmentsRef,
      speakingNarrationRef,
      pendingSegmentCountRef,
      phaseRef,
      sessionId,
      setLastError,
      stopTurn,
      ttsClientRef,
      turnActiveRef,
    ],
  );

  const clearPausedLesson = useCallback(() => {
    pausedLessonRef.current = null;
    activeResumeRef.current = null;
    setPausedLessonOfferState(null);
  }, []);

  const offerPausedLessonResume = useCallback((resume?: PausedLessonRequest) => {
    if (resume) pausedLessonRef.current = resume;
    const pending = pausedLessonRef.current;
    if (!pending || pending.boardId !== sessionId) {
      return;
    }
    showPausedLessonOffer(pending);
  }, [sessionId, showPausedLessonOffer]);

  /** The board `restorePausedLesson` already derived an offer for. */
  const restoredOfferBoardRef = useRef<string | null>(null);
  // Another board's snapshot is never offered here; drop it, and derive this
  // board's offer from its saved turns once it is restored.
  useEffect(() => {
    restoredOfferBoardRef.current = null;
    if (pausedLessonRef.current && pausedLessonRef.current.boardId !== sessionId) {
      pausedLessonRef.current = null;
    }
  }, [sessionId]);

  const restorePausedLesson = useCallback((turns: readonly StoredTurn[]): PausedLessonRequest | null => {
    if (!sessionId) return null;
    const held = pausedLessonRef.current?.boardId === sessionId ? pausedLessonRef.current : null;
    if (restoredOfferBoardRef.current === sessionId) return held;
    // A turn or a replay owns the board: ask again when it ends.
    if (
      phaseRef.current !== "idle" ||
      turnActiveRef.current ||
      isReplayingRef.current ||
      pendingSegmentCountRef.current > 0
    ) {
      return null;
    }
    // A saved turn that reads live is stopped unless this tab is still
    // teaching it (a crashed tab or a lost keepalive close leaves it live for
    // two minutes). One this tab teaches ends later: derive then, not now, so
    // a passing null is never kept as the board's answer.
    const save = liveTurnSave();
    const isLiveHere = (turnId: string) => save.isLiveHere(turnId);
    if (turns.some((turn) => isLiveHere(turn.id))) return null;
    restoredOfferBoardRef.current = sessionId;
    // The saved turns win over a snapshot this tab took before the board was
    // redrawn from them (a board switch stops the lesson on the way out): the
    // restored figure is whole, and the server may know of a later turn.
    const restored = pausedLessonFromStoredTurns(turns, { boardId: sessionId, isLiveHere });
    if (!restored) {
      if (held) clearPausedLesson();
      return null;
    }
    pausedLessonRef.current = restored;
    showPausedLessonOffer(restored);
    return restored;
  }, [sessionId, phaseRef, turnActiveRef, pendingSegmentCountRef, showPausedLessonOffer, clearPausedLesson]);

  const flushPausedLesson = useCallback(() => {
    const pending = pausedLessonRef.current;
    if (!pending || pending.boardId !== sessionId) {
      pausedLessonRef.current = null;
      setPausedLessonOfferState(null);
      return;
    }
    setPausedLessonOfferState(null);
    const deadline = Date.now() + DOUBT_INTERRUPT_TIMEOUT_MS;
    const tick = () => {
      const resume = pausedLessonRef.current;
      if (!resume || resume.boardId !== sessionId) {
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
        tutorDebug("turn", "resuming paused lesson", {
          lesson_question_preview: resume.lessonQuestion.slice(0, 80),
          reason: resume.reason,
          figure_drawn: resume.figureDrawn,
          code_lesson: resume.codeLesson,
        });
        // Before the call: a Stop during its first synchronous steps must find it.
        activeResumeRef.current = { request: resume, pageBefore: boardPageRef.current };
        void handleQuestionRef.current(resume.lessonQuestion, { resume });
        // The idle check and turnActive latch are synchronous. Only drop the
        // snapshot once this resume owns the board; a silent drop used to
        // lose the lecture.
        if (turnActiveRef.current) {
          pausedLessonRef.current = null;
          return;
        }
        activeResumeRef.current = null;
      }
      if (Date.now() >= deadline) {
        tutorDebug("turn", "paused lesson did not resume in time", {
          lesson_question_preview: resume.lessonQuestion.slice(0, 80),
        });
        showPausedLessonOffer(resume);
        return;
      }
      scheduleFrame(tick);
    };
    tick();
  }, [boardPageRef, handleQuestionRef, pendingSegmentCountRef, phaseRef, sessionId, showPausedLessonOffer, turnActiveRef]);

  return {
    finishLectureUi,
    applyTurnPhase,
    enqueueSegment,
    enqueueVerifiedIntro,
    processResponseText,
    stopTurn,
    pauseTurn,
    resumeTurn,
    flushPausedLesson,
    offerPausedLessonResume,
    clearPausedLesson,
    restorePausedLesson,
    pausedLessonOffer: pausedLessonOfferState?.boardId === sessionId,
    pausedLessonReason: pausedLessonOfferState?.boardId === sessionId ? pausedLessonOfferState.reason : null,
    handleAskDoubt,
  };
}
