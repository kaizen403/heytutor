import {
  useCallback,
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { stopReplayAudio } from "@/lib/replayAudio";
import type { ReplayCue } from "@/lib/replayTimeline";
import { enrichStoredSegmentsWithReplayAudio } from "@/lib/replayTurns";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import {
  parseDrawingCommands,
  getSegmentCommands,
  type DrawCommand,
  type TutorSegment,
  serializeSegmentCommands,
  IncrementalTagParser,
  buildLessonSegments,
  lessonNarrationText,
  matchDiagramTemplate,
  buildTemplateIntroSegments,
  prepareTemplateLessonSegments,
  anchorToTextRect,
  type DiagramTemplate,
} from "@heytutor/drawing";
import {
  streamLLMResponse,
  TUTOR_SYSTEM_PROMPT,
  TUTOR_CONTINUATION_PROMPT,
  getCommandDrawDurationMs,
  getCommandSpeechWindow,
  getEstimatedWriteCharScheduleMs,
  getWriteCharScheduleMs,
  isWriteScheduleUsable,
  validateAudioTimingsForNarration,
  tutorDebug,
  mathToSpeech,
  resolveApiUrl,
  type AudioTimings,
  type ConversationExchange,
  type TTSClient,
} from "@heytutor/tutor-core";
import { createTurnTelemetry, type TurnTelemetry } from "@/lib/turnTelemetry";
import {
  saveTurn,
  updateBoard,
  type RecordedSegmentPayload,
  type StoredTurn,
} from "@/lib/boardsClient";
import type { BoardEntry } from "@/components/BoardHistory";
import { MAX_LLM_CONTINUATIONS, STREAM_SEGMENTS_LIVE } from "../constants";
import type { TutorPhase, BoardLayoutState, SegmentPlanStats } from "../types";
import { FIXED_SHAPE_DRAW_MS } from "../types";
import { registerBoardAnchor } from "../lib/boardLayout";
import {
  createEmptySegmentPlanStats,
  summarizeSegmentsForTrace,
  isTeachingResponseIncomplete,
  normalizeSegmentForAlignment,
} from "../lib/segmentPlanning";

type ExecuteCommandOptions = {
  durationScale?: number;
  speechDurationMs?: number;
  writeSchedule?: {
    charStartOffsetsMs: number[];
    charDurationsMs: number[];
    getAudioPositionMs: () => number;
    onCharacterStart?: (info: {
      char: string;
      index: number;
      targetMs: number;
      audioPositionMs: number;
    }) => void;
  };
  applyLayout?: boolean;
  segmentNarration?: string;
  skipTemplateDuplicateCheck?: boolean;
  skipGeometrySnap?: boolean;
};

export type UseTurnLifecycleParams = {
  sessionId: string;
  searchParams: ReadonlyURLSearchParams;
  phase: TutorPhase;
  isReplaying: boolean;
  boardLoaded: boolean;
  narrationText: string;
  boards: BoardEntry[];
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  pendingQuestionRef: RefObject<string | null>;
  autoSubmitDoneRef: RefObject<boolean>;
  phaseRef: RefObject<TutorPhase>;
  isPausedRef: RefObject<boolean>;
  conversationHistoryRef: RefObject<ConversationExchange[]>;
  ttsClientRef: RefObject<TTSClient | null>;
  replayAudioRef: RefObject<HTMLAudioElement | null>;
  replayAudioPreloadRef: RefObject<Map<string, HTMLAudioElement>>;
  cancelRef: RefObject<boolean>;
  turnActiveRef: RefObject<boolean>;
  turnAbortRef: RefObject<AbortController | null>;
  segmentChainRef: RefObject<Promise<void>>;
  collectedSegmentsRef: RefObject<TutorSegment[]>;
  recordedSegmentsRef: RefObject<RecordedSegmentPayload[]>;
  storedTurnsRef: RefObject<StoredTurn[]>;
  rawResponseRef: RefObject<string>;
  currentTraceIdRef: RefObject<string | null>;
  turnTelemetryRef: RefObject<TurnTelemetry | null>;
  turnStatsRef: RefObject<{ drawMs: number; ttsChars: number }>;
  narrationSinceEpochRef: RefObject<string>;
  boardLayoutRef: RefObject<BoardLayoutState>;
  fbdPhaseMarkedRef: RefObject<boolean>;
  fbdPhaseStartedRef: RefObject<boolean>;
  activeDiagramTemplateRef: RefObject<DiagramTemplate | null>;
  segmentPlanStatsRef: RefObject<SegmentPlanStats>;
  stopTurnRef: RefObject<(() => void) | null>;
  speedRef: RefObject<number>;
  replayGenerationRef: RefObject<number>;
  replayCueRef: RefObject<ReplayCue | null>;
  setPhase: Dispatch<SetStateAction<TutorPhase>>;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
  setNarrationText: Dispatch<SetStateAction<string>>;
  setCurrentSegmentText: Dispatch<SetStateAction<string>>;
  setLastError: Dispatch<SetStateAction<{ message: string; question: string } | null>>;
  setInputInteracted: Dispatch<SetStateAction<boolean>>;
  setTranscriptOpen: Dispatch<SetStateAction<boolean>>;
  setIsReplaying: Dispatch<SetStateAction<boolean>>;
  setReplayProgressMs: Dispatch<SetStateAction<number>>;
  setReplayTotalMs: Dispatch<SetStateAction<number>>;
  setStoredTurnsCount: Dispatch<SetStateAction<number>>;
  setBoards: Dispatch<SetStateAction<BoardEntry[]>>;
  ensureTTSClient: () => TTSClient;
  executeCommandWithCancel: (
    command: DrawCommand,
    options?: ExecuteCommandOptions,
  ) => Promise<void>;
  cancellableDelay: (duration: number) => Promise<void>;
  raceWithCancel: <T>(promise: Promise<T>) => Promise<T | undefined>;
  clearCancelTimers: () => void;
  resetBoardLayout: (keepHeading?: boolean, forceSequentialWorkLayout?: boolean) => void;
  persistTurnForReplay: (
    question: string,
    rawResponse: string,
    recordedSegments: RecordedSegmentPayload[],
  ) => StoredTurn;
  registerReplayBlobUrl: (url: string) => void;
  revokeReplayBlobUrls: () => void;
};

export function useTurnLifecycle({
  sessionId,
  searchParams,
  phase,
  isReplaying,
  boardLoaded,
  narrationText,
  boards,
  whiteboardRef,
  pendingQuestionRef,
  autoSubmitDoneRef,
  phaseRef,
  isPausedRef,
  conversationHistoryRef,
  ttsClientRef,
  replayAudioRef,
  replayAudioPreloadRef,
  cancelRef,
  turnActiveRef,
  turnAbortRef,
  segmentChainRef,
  collectedSegmentsRef,
  recordedSegmentsRef,
  storedTurnsRef,
  rawResponseRef,
  currentTraceIdRef,
  turnTelemetryRef,
  turnStatsRef,
  narrationSinceEpochRef,
  boardLayoutRef,
  fbdPhaseMarkedRef,
  fbdPhaseStartedRef,
  activeDiagramTemplateRef,
  segmentPlanStatsRef,
  stopTurnRef,
  speedRef,
  replayGenerationRef,
  replayCueRef,
  setPhase,
  setIsPaused,
  setNarrationText,
  setCurrentSegmentText,
  setLastError,
  setInputInteracted,
  setTranscriptOpen,
  setIsReplaying,
  setReplayProgressMs,
  setReplayTotalMs,
  setStoredTurnsCount,
  setBoards,
  ensureTTSClient,
  executeCommandWithCancel,
  cancellableDelay,
  raceWithCancel,
  clearCancelTimers,
  resetBoardLayout,
  persistTurnForReplay,
  registerReplayBlobUrl,
  revokeReplayBlobUrls,
}: UseTurnLifecycleParams) {
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

  const runSegment = useCallback(
    async (
      segment: TutorSegment,
      index: number,
      allSegments: TutorSegment[],
    ): Promise<void> => {
      if (cancelRef.current) return;

      const tts = ensureTTSClient();

      tutorDebug("segment", "runSegment start", {
        index,
        narration_preview: segment.narration.slice(0, 80),
        narration_chars: segment.narration.length,
        command_type: segment.command?.type ?? null,
        command_text: segment.command?.text?.slice(0, 60),
      });

      const tel = turnTelemetryRef.current;
      const segmentName = `segment-${index}`;
      const segmentSpan = tel?.span(segmentName);

      if (cancelRef.current) {
        segmentSpan?.end({ skipped: true, reason: "cancelled" });
        return;
      }

      applyTurnPhase("speaking");
      setCurrentSegmentText(segment.narration);

      const previousText = allSegments[index - 1]?.narration;
      const nextText = allSegments[index + 1]?.narration;
      const narration = segment.narration.trim();

      if (!narration && !segment.command) {
        tutorDebug("segment", "skipped empty segment", { index });
        segmentSpan?.end({ skipped: true });
        return;
      }

      const segmentCommands = getSegmentCommands(segment);
      const totalDrawWeight = segmentCommands.reduce(
        (sum, cmd) => sum + getCommandDrawDurationMs(cmd),
        0,
      );
      const multiShapeSegment =
        segmentCommands.filter((cmd) =>
          ["DRAW_CIRCLE", "DRAW_LINE", "DRAW_RECT", "DRAW_CUBE", "DRAW_CUBOID"].includes(cmd.type),
        ).length > 1;

      const hasNarration = narration.length > 0;
      const hasCommand = segmentCommands.length > 0;

      if (hasNarration) {
        turnStatsRef.current.ttsChars += narration.length;
      }

      const segmentMetadata = {
        chars: narration.length,
        has_command: hasCommand,
        command_type: segmentCommands[0]?.type ?? null,
        command_count: segmentCommands.length,
      };

      let capturedAudio: Uint8Array | null = null;
      let capturedTimings: AudioTimings | null = null;
      let capturedDurationMs: number | null = null;
      const estimateSpeechMs = Math.max(narration.length * 85, 700);
      const naturalDrawMs = Math.max(
        segmentCommands.reduce((sum, cmd) => sum + getCommandDrawDurationMs(cmd), 0),
        200,
      );
      let audioStartedAtMs: number | null = null;
      let speechComplete = false;
      let timingTelemetryCount = 0;
      let lastTimingTelemetryChars = -1;
      const timingWaiters: Array<(timings: AudioTimings | null) => void> = [];

      let audioStartedFlag = false;
      let audioStartedResolver: (() => void) | null = null;
      const audioStartedPromise = new Promise<void>((resolve) => {
        audioStartedResolver = resolve;
      });

      const markSpeechComplete = () => {
        speechComplete = true;
        if (!audioStartedFlag) {
          audioStartedFlag = true;
          audioStartedResolver?.();
        }
      };

      const waitForAudioStart = async (): Promise<void> => {
        if (audioStartedFlag || !hasNarration) {
          return;
        }

        await Promise.race([
          raceWithCancel(audioStartedPromise),
          cancellableDelay(8_000),
        ]);

        if (!audioStartedFlag && !cancelRef.current) {
          tutorDebug("tts", "audio start timeout — proceeding with estimated write sync", {
            index,
          });
          markSpeechComplete();
          if (audioStartedAtMs === null) {
            audioStartedAtMs = performance.now();
          }
        }
      };

      let maxAudioPositionMs = -Infinity;
      const wallClockMs = (): number =>
        audioStartedAtMs === null ? 0 : performance.now() - audioStartedAtMs;
      const liveAudioPositionMs = (): number => {
        if (speechComplete) {
          const durationMs =
            capturedDurationMs ??
            (capturedTimings?.totalDuration
              ? Math.round(capturedTimings.totalDuration * 1000)
              : estimateSpeechMs);
          const endPosition = durationMs + 40;
          maxAudioPositionMs = Math.max(maxAudioPositionMs, endPosition);
          return endPosition;
        }

        const position = tts.getPlaybackPositionMs();
        if (position === null || position + 50 < maxAudioPositionMs) {
          return Math.max(maxAudioPositionMs, wallClockMs());
        }
        maxAudioPositionMs = Math.max(maxAudioPositionMs, position);
        return position;
      };

      const waitForInitialTimings = (timeoutMs = 40): Promise<AudioTimings | null> => {
        if (capturedTimings && capturedTimings.charStartTimes.length > 0) {
          return Promise.resolve(capturedTimings);
        }

        return new Promise((resolve) => {
          let settled = false;
          const waiter = (timings: AudioTimings | null) => {
            if (settled) {
              return;
            }
            settled = true;
            window.clearTimeout(timeoutId);
            resolve(timings);
          };
          const timeoutId = window.setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            const waiterIndex = timingWaiters.indexOf(waiter);
            if (waiterIndex >= 0) {
              timingWaiters.splice(waiterIndex, 1);
            }
            resolve(capturedTimings);
          }, timeoutMs);

          timingWaiters.push(waiter);
        });
      };

      const runDraw = async (
        totalSpeechMs: number,
        audioTimings?: AudioTimings | null,
      ): Promise<void> => {
        const drawName = `draw-${index}`;
        const drawSpan = tel?.span(drawName, segmentName);
        const drawStart = performance.now();
        const templateDrawOptions = {
          skipTemplateDuplicateCheck: segment.templateIntro === true,
          skipGeometrySnap: segment.templateIntro === true,
        };

        try {
          if (hasNarration && multiShapeSegment) {
            await waitForAudioStart();
            if (cancelRef.current) {
              return;
            }
          }

          let textCommandIndex = 0;
          for (const command of segmentCommands) {
            if (cancelRef.current) {
              return;
            }

            const isTextCommand = command.type === "WRITE" || command.type === "LABEL";

            if (isTextCommand && hasNarration && !audioStartedFlag) {
              const audioWaitStart = performance.now();
              await waitForAudioStart();
              if (cancelRef.current) return;
              await waitForInitialTimings(40);
              if (cancelRef.current) return;
              tutorDebug("draw", "text command waited for audio start", {
                index,
                waited_ms: Math.round(performance.now() - audioWaitStart),
              });
            }

            const elapsedAtCommandStart =
              audioStartedAtMs === null ? 0 : performance.now() - audioStartedAtMs;

            const timingValidation =
              isTextCommand && hasNarration && capturedTimings
                ? validateAudioTimingsForNarration(narration, capturedTimings)
                : null;
            const segmentDurationMs =
              timingValidation?.totalDurationMs ??
              (capturedTimings?.totalDuration
                ? Math.round(capturedTimings.totalDuration * 1000)
                : totalSpeechMs);
            const timedSchedule =
              isTextCommand && hasNarration && capturedTimings && timingValidation?.valid
                ? getWriteCharScheduleMs(narration, command, capturedTimings, textCommandIndex)
                : null;
            const estimatedSchedule =
              isTextCommand && hasNarration
                ? getEstimatedWriteCharScheduleMs(narration, command, textCommandIndex)
                : null;
            const usableTimedSchedule =
              timedSchedule && isWriteScheduleUsable(timedSchedule, narration, segmentDurationMs)
                ? timedSchedule
                : null;
            const writeSchedule = usableTimedSchedule ?? estimatedSchedule;

            if (writeSchedule && writeSchedule.offsetsMs.length > 0) {
              const audioPosAtScheduleMs = Math.round(liveAudioPositionMs());
              const firstOffsetMs = writeSchedule.offsetsMs[0] ?? 0;

              let effectiveOffsets = writeSchedule.offsetsMs;
              if (
                writeSchedule.source === "estimated" &&
                audioPosAtScheduleMs > firstOffsetMs + 200
              ) {
                const shift = audioPosAtScheduleMs - firstOffsetMs;
                effectiveOffsets = writeSchedule.offsetsMs.map(
                  (offset) => Math.max(offset + shift, 0),
                );
              }

              const scheduleMetadata = {
                segment_index: index,
                text: command.text?.slice(0, 60),
                schedule_source: writeSchedule.source,
                timing_chars: capturedTimings?.charStartTimes.length ?? 0,
                first_offset_ms: firstOffsetMs,
                audio_pos_ms: audioPosAtScheduleMs,
                start_lag_ms: audioPosAtScheduleMs - firstOffsetMs,
                matched: writeSchedule.matched,
                syncable: true,
                valid_timing: writeSchedule.validTiming,
                reason:
                  writeSchedule.reason ??
                  timingValidation?.reason ??
                  (timedSchedule && !usableTimedSchedule ? "schedule-offset-too-late" : null),
              };
              tutorDebug("draw", "write schedule ready", {
                index,
                ...scheduleMetadata,
              });
              tel?.mark("write-schedule-ready", scheduleMetadata);

              let loggedChars = 0;
              await executeCommandWithCancel(command, {
                segmentNarration: narration,
                writeSchedule: {
                  charStartOffsetsMs: effectiveOffsets,
                  charDurationsMs: writeSchedule.charDurationsMs,
                  getAudioPositionMs: liveAudioPositionMs,
                  onCharacterStart: ({ char, index: charIndex, targetMs, audioPositionMs }) => {
                    if (loggedChars >= 8) {
                      return;
                    }
                    loggedChars++;
                    const charMetadata = {
                      segment_index: index,
                      char,
                      char_index: charIndex,
                      target_ms: Math.round(targetMs),
                      audio_pos_ms: Math.round(audioPositionMs),
                      lag_ms: Math.round(audioPositionMs - targetMs),
                    };
                    tutorDebug("draw", "write char start", charMetadata);
                    tel?.mark("write-char-start", charMetadata);
                  },
                },
                ...templateDrawOptions,
              });
              continue;
            }

            if (isTextCommand && hasNarration) {
              const revealMs = Math.min(
                Math.max((command.text?.replace(/\s/g, "").length ?? 1) * 28, 320),
                950,
              );
              const scheduleMetadata = {
                segment_index: index,
                text: command.text?.slice(0, 60),
                schedule_source: "none",
                timing_chars: capturedTimings?.charStartTimes.length ?? 0,
                syncable: false,
                valid_timing: timingValidation?.valid ?? false,
                reason: timingValidation?.reason ?? "text-not-spoken",
              };
              tutorDebug("draw", "write unsyncable reveal", {
                index,
                ...scheduleMetadata,
              });
              tel?.mark("write-schedule-ready", scheduleMetadata);
              await executeCommandWithCancel(command, {
                segmentNarration: narration,
                speechDurationMs: revealMs,
                ...templateDrawOptions,
              });
              continue;
            }

            const commandWeight = getCommandDrawDurationMs(command);
            const naturalDrawMs = getCommandDrawDurationMs(command);
            const commandSpeechMs =
              totalDrawWeight > 0
                ? Math.max(Math.round(totalSpeechMs * (commandWeight / totalDrawWeight)), 50)
                : Math.max(Math.round(totalSpeechMs / segmentCommands.length), 50);
            const speechWindow =
              hasNarration && (capturedTimings ?? audioTimings)
                ? getCommandSpeechWindow(narration, command, capturedTimings ?? audioTimings, textCommandIndex)
                : null;
            const startDelayMs = speechWindow
              ? Math.max(Math.round(speechWindow.startMs - elapsedAtCommandStart), 0)
              : 0;

            if (startDelayMs > 0) {
              await cancellableDelay(startDelayMs);
              if (cancelRef.current) {
                return;
              }
            }

            const commandBudgetMs =
              isTextCommand
                ? (speechWindow?.durationMs ?? naturalDrawMs)
                : command.type === "PAUSE"
                  ? commandSpeechMs
                  : !multiShapeSegment && FIXED_SHAPE_DRAW_MS[command.type]
                    ? FIXED_SHAPE_DRAW_MS[command.type]
                    : Math.max(speechWindow?.durationMs ?? commandSpeechMs, 50);

            await executeCommandWithCancel(command, {
              segmentNarration: narration,
              speechDurationMs: commandBudgetMs,
              ...templateDrawOptions,
            });
            if (isTextCommand) {
              textCommandIndex++;
            }
          }
        } finally {
          const drawMs = Math.round(performance.now() - drawStart);
          turnStatsRef.current.drawMs += drawMs;
          tel?.mark("draw-complete", {
            segment_index: index,
            command_count: segmentCommands.length,
            duration_ms: drawMs,
          });
          drawSpan?.end({
            command_count: segmentCommands.length,
            duration_ms: drawMs,
          });
        }
      };

      const captureTimings = (timings: AudioTimings) => {
        capturedTimings = timings;
        const validation = validateAudioTimingsForNarration(narration, timings);
        if (timings.totalDuration > 0) {
          capturedDurationMs = Math.round(timings.totalDuration * 1000);
        }
        if (timingTelemetryCount < 3 && timings.charStartTimes.length !== lastTimingTelemetryChars) {
          timingTelemetryCount++;
          lastTimingTelemetryChars = timings.charStartTimes.length;
          tel?.mark("tts-timing-received", {
            segment_index: index,
            timing_chars: timings.charStartTimes.length,
            total_duration_ms: capturedDurationMs,
          });
          tel?.mark("tts-timing-validation", {
            segment_index: index,
            valid: validation.valid,
            reason: validation.reason ?? null,
            total_duration_ms: validation.totalDurationMs,
            expected_max_ms: validation.expectedMaxMs,
          });
        }
        if (timings.charStartTimes.length > 0 && timingWaiters.length > 0) {
          const waiters = timingWaiters.splice(0);
          for (const resolve of waiters) {
            resolve(timings);
          }
        }
      };

      const speakOptions = {
        previousText,
        nextText,
        traceId: currentTraceIdRef.current ?? undefined,
        sessionId: sessionId ?? undefined,
        onAudioCaptured: (audio: { bytes: Uint8Array }) => {
          capturedAudio = audio.bytes;
        },
        onTimings: captureTimings,
        onEnd: markSpeechComplete,
        onError: () => {
          markSpeechComplete();
        },
      };

      const speakSegmentWithTimeout = async (
        text: string,
        options: Parameters<TTSClient["speakSegment"]>[1] = {},
      ): Promise<void> => {
        const timeoutMs = Math.min(Math.max(text.length * 250, 45_000), 180_000);

        try {
          await raceWithCancel(
            Promise.race([
              tts.speakSegment(text, options),
              new Promise<never>((_, reject) => {
                window.setTimeout(
                  () => reject(new Error(`tts segment timeout after ${timeoutMs}ms`)),
                  timeoutMs,
                );
              }),
            ]),
          );
        } catch (error) {
          tutorDebug("tts", "segment speech failed", {
            index,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          markSpeechComplete();
        }
      };

      try {
        if (hasNarration && !hasCommand) {
          tutorDebug("segment", "narration-only", { index });
          await speakSegmentWithTimeout(narration, speakOptions);
          if (cancelRef.current) return;
          tutorDebug("segment", "narration-only complete", { index });
        } else if (!hasNarration && hasCommand) {
          tutorDebug("segment", "draw-only", { index });
          await runDraw(naturalDrawMs);
          if (cancelRef.current) return;
          tutorDebug("segment", "draw-only complete", { index });
        } else if (hasNarration && hasCommand) {
          tutorDebug("segment", "paired narration+draw", { index });

          const drawPromise = (async () => {
            await runDraw(estimateSpeechMs, null);
          })();

          const speechPromise = speakSegmentWithTimeout(
            narration,
            {
              ...speakOptions,
              onStart: () => {
                if (cancelRef.current || !turnActiveRef.current) return;
                audioStartedFlag = true;
                audioStartedResolver?.();
                tutorDebug("tts", "segment audio started", { index });
                tel?.mark("tts-start", {
                  segment_index: index,
                  chars: narration.length,
                  command_count: segmentCommands.length,
                });
                applyTurnPhase("drawing");
                audioStartedAtMs = performance.now();
              },
              onTimings: (timings) => {
                captureTimings(timings);
                if (timings.totalDuration > 0) {
                  tutorDebug("tts", "segment timings", {
                    index,
                    total_duration_ms: Math.round(timings.totalDuration * 1000),
                  });
                }
              },
            },
          );

          await Promise.all([
            speechPromise,
            drawPromise,
          ]);

          if (cancelRef.current) return;
          tutorDebug("segment", "paired narration+draw complete", { index });
        }
      } finally {
        if (!cancelRef.current) {
          const segmentCommands = getSegmentCommands(segment);
          recordedSegmentsRef.current.push({
            orderIndex: index,
            narration: segment.narration,
            spokenText: mathToSpeech(narration),
            command: serializeSegmentCommands(segmentCommands),
            audioBytes: capturedAudio,
            durationMs: capturedDurationMs,
            timings: capturedTimings,
          });
          if (segment.narration.trim()) {
            narrationSinceEpochRef.current +=
              (narrationSinceEpochRef.current ? " " : "") + segment.narration.trim();
          }
        }
        tutorDebug("segment", "runSegment end", { index, ...segmentMetadata });
        segmentSpan?.end(segmentMetadata);
      }
    },
    [
      sessionId,
      cancellableDelay,
      ensureTTSClient,
      executeCommandWithCancel,
      raceWithCancel,
      applyTurnPhase,
      cancelRef,
      turnActiveRef,
      turnTelemetryRef,
      turnStatsRef,
      recordedSegmentsRef,
      narrationSinceEpochRef,
      currentTraceIdRef,
      setCurrentSegmentText,
    ],
  );

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

  const handleQuestion = useCallback(
    async (question: string) => {
      const wb = whiteboardRef.current;
      if (!boardLoaded || !wb) {
        pendingQuestionRef.current = question;
        setInputInteracted(true);
        return;
      }
      if (phase !== "idle") {
        pendingQuestionRef.current = null;
        return;
      }

      pendingQuestionRef.current = null;

      tutorDebug("turn", "question submitted", {
        question_preview: question.slice(0, 120),
        board_id: sessionId,
      });

      cancelRef.current = false;
      isPausedRef.current = false;
      setIsPaused(false);
      setIsReplaying(false);
      setTranscriptOpen(false);
      setLastError(null);
      turnActiveRef.current = true;
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
      turnStatsRef.current = { drawMs: 0, ttsChars: 0 };
      segmentPlanStatsRef.current = createEmptySegmentPlanStats();
      revokeReplayBlobUrls();
      fbdPhaseMarkedRef.current = false;
      fbdPhaseStartedRef.current = false;
      activeDiagramTemplateRef.current = matchDiagramTemplate(question);
      resetBoardLayout(false, activeDiagramTemplateRef.current !== null);

      const runtimePromptAddon = activeDiagramTemplateRef.current?.promptAddon ?? "";
      const turnSystemPrompt = runtimePromptAddon
        ? `${TUTOR_SYSTEM_PROMPT}\n\n--- current lesson (runtime) ---\n${runtimePromptAddon}`
        : TUTOR_SYSTEM_PROMPT;
      const turnContinuationPrompt = runtimePromptAddon
        ? `${TUTOR_CONTINUATION_PROMPT}\n\n--- diagram reminder ---\n${runtimePromptAddon}`
        : TUTOR_CONTINUATION_PROMPT;

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

      void ensureTTSClient().prewarm({
        onConnect: ({ ms, ok }) => {
          endWsConnect({
            latency_ms: Math.round(ms),
            ok,
          });
        },
      });

      const activeTemplate = activeDiagramTemplateRef.current;
      const introSegments = activeTemplate ? buildTemplateIntroSegments(activeTemplate, question) : [];
      if (activeTemplate) {
        fbdPhaseStartedRef.current = true;
        for (const anchor of activeTemplate.anchors) {
          registerBoardAnchor(boardLayoutRef.current, anchorToTextRect(anchor));
        }
        turnTelemetryRef.current?.mark("template-intro-queued", {
          template_id: activeTemplate.id,
          template_name: activeTemplate.name,
          intro_segment_count: introSegments.length,
          command_count: activeTemplate.commands.length,
          commands: activeTemplate.commands.map((command) => ({
            type: command.type,
            params: command.params,
            ...(command.text ? { text: command.text } : {}),
          })),
        });
        tutorDebug("draw", "queued template intro segments", {
          template: activeTemplate.id,
          segment_count: introSegments.length,
        });
      }

      if (STREAM_SEGMENTS_LIVE) {
        for (const segment of introSegments) {
          enqueueSegment(segment);
        }
      }

      try {
        const parser = new IncrementalTagParser({
          onSegmentReady: (segment) => {
            if (STREAM_SEGMENTS_LIVE) {
              enqueueSegment(segment);
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

        while (continueCount <= MAX_LLM_CONTINUATIONS) {
          const isContinuation = continueCount > 0;
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
              signal: abortController.signal,
              onTraceId: (id) => {
                currentTraceIdRef.current = id;
                tel.setTrace(id, sessionId ?? undefined);
              },
            },
            (delta) => {
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

          fullResponse += streamResult.text;
          traceId = streamResult.traceId;
          lastStreamStats = streamResult.streamStats;

          if (cancelRef.current) {
            break;
          }

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

        const responseText = rawResponse.trim();
        rawResponseRef.current = responseText;

        if (responseText.length === 0) {
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
        applyTurnPhase("speaking");

        await processResponseText(responseText, introSegments, STREAM_SEGMENTS_LIVE);

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
            const savedTurn = await saveTurn(currentId, {
              question,
              rawResponse: rawResponseRef.current,
              speedMultiplier: speedRef.current,
              traceId: currentTraceIdRef.current,
              segments: recordedSegmentsRef.current,
            });

            let turnForReplay: StoredTurn | null = null;
            if (savedTurn) {
              turnForReplay = {
                ...savedTurn,
                segments: enrichStoredSegmentsWithReplayAudio(
                  savedTurn.segments,
                  recordedSegmentsRef.current,
                  registerReplayBlobUrl,
                ),
              };
            } else if (recordedSegmentsRef.current.length > 0) {
              turnForReplay = persistTurnForReplay(
                question,
                rawResponseRef.current,
                recordedSegmentsRef.current,
              );
            }

            if (turnForReplay) {
              storedTurnsRef.current = [...storedTurnsRef.current, turnForReplay];
              setStoredTurnsCount(storedTurnsRef.current.length);
            }

            setBoards((prev) =>
              prev.map((b) =>
                b.id === currentId ? { ...b, preview: question.slice(0, 60) } : b,
              ),
            );
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
        turnAbortRef.current = null;
        endWsConnect({ ok: false, reason: "turn_complete_without_connect_event" });
        if (!thinkingEnded) {
          endThinking({ phase: turnCancelled ? "cancelled" : "turn_complete" });
        }

        tel.meta({
          total_duration_ms: tel.durationMs(),
          segment_count: collectedSegmentsRef.current.length,
          total_draw_ms: turnStatsRef.current.drawMs,
          total_tts_chars: turnStatsRef.current.ttsChars,
          diagram_template_id: segmentPlanStatsRef.current.activeTemplateId,
          diagram_template_name: segmentPlanStatsRef.current.activeTemplateName,
          diagram_planned_segment_count: segmentPlanStatsRef.current.plannedSegmentCount,
          diagram_intro_segment_count: segmentPlanStatsRef.current.introSegmentCount,
          diagram_llm_segment_count: segmentPlanStatsRef.current.llmSegmentCount,
          diagram_blocked_template_draw_commands:
            segmentPlanStatsRef.current.blockedTemplateDrawCommands,
          diagram_dropped_template_redraw_segments:
            segmentPlanStatsRef.current.droppedTemplateRedrawSegments,
          question_preview: question.slice(0, 120),
          cancelled: turnCancelled,
        });

        tutorDebug("turn", "turn complete", {
          cancelled: turnCancelled,
          segment_count: collectedSegmentsRef.current.length,
          total_draw_ms: turnStatsRef.current.drawMs,
          total_tts_chars: turnStatsRef.current.ttsChars,
        });

        finishLectureUi();

        const telToFlush = turnTelemetryRef.current;
        turnTelemetryRef.current = null;
        void telToFlush?.flush();
      }
    },
    [
      sessionId,
      boards,
      narrationText,
      phase,
      processResponseText,
      enqueueSegment,
      resetBoardLayout,
      boardLoaded,
      persistTurnForReplay,
      registerReplayBlobUrl,
      revokeReplayBlobUrls,
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
      turnAbortRef,
      collectedSegmentsRef,
      recordedSegmentsRef,
      rawResponseRef,
      currentTraceIdRef,
      segmentChainRef,
      turnStatsRef,
      segmentPlanStatsRef,
      fbdPhaseMarkedRef,
      fbdPhaseStartedRef,
      activeDiagramTemplateRef,
      boardLayoutRef,
      turnTelemetryRef,
      conversationHistoryRef,
      speedRef,
      storedTurnsRef,
      setStoredTurnsCount,
      setBoards,
      setPhase,
      setNarrationText,
      setCurrentSegmentText,
    ],
  );

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
      void handleQuestion(question);
    };
    fire();
    return () => {
      cancelled = true;
    };
  }, [
    boardLoaded,
    searchParams,
    handleQuestion,
    autoSubmitDoneRef,
    pendingQuestionRef,
    cancelRef,
    phaseRef,
    whiteboardRef,
    setInputInteracted,
  ]);

  const handleAskDoubt = useCallback(
    (question: string) => {
      void handleQuestion(`I have a doubt about this: ${question}`);
    },
    [handleQuestion],
  );

  return {
    finishLectureUi,
    applyTurnPhase,
    stopTurn,
    pauseTurn,
    resumeTurn,
    handleQuestion,
    handleAskDoubt,
  };
}
