import { useCallback } from "react";
import {
  getSegmentCommands,
  type TutorSegment,
  serializeSegmentCommands,
} from "@heytutor/drawing";
import {
  getCommandDrawDurationMs,
  getCommandSpeechWindow,
  getEstimatedWriteCharScheduleMs,
  getWriteCharScheduleMs,
  isWriteScheduleUsable,
  validateAudioTimingsForNarration,
  tutorDebug,
  mathToSpeech,
  type AudioTimings,
  type TTSClient,
} from "@heytutor/tutor-core";
import { adaptiveShapeBudget } from "../../types";
import type { UseSegmentRunnerParams } from "./types";

export function useSegmentRunner({
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
  narrationDensityRef,
}: UseSegmentRunnerParams) {
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
      // Feed the adaptive-speed hook with the narration density of this segment.
      narrationDensityRef.current =
        estimateSpeechMs > 0 ? narration.length / estimateSpeechMs : 0;
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
      };

      const waitForAudioStart = async (timeoutMs = 1_200): Promise<boolean> => {
        if (audioStartedFlag || !hasNarration) {
          return true;
        }

        await Promise.race([
          raceWithCancel(audioStartedPromise),
          cancellableDelay(timeoutMs),
        ]);

        if (!audioStartedFlag && !cancelRef.current && !speechComplete) {
          tutorDebug("tts", "audio start still pending", {
            index,
            waited_ms: timeoutMs,
          });
        }

        return audioStartedFlag;
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
          return audioStartedAtMs === null ? 0 : Math.max(maxAudioPositionMs, wallClockMs());
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
            await waitForAudioStart(1_200);
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
              await waitForAudioStart(2_500);
              if (cancelRef.current) return;
              await waitForInitialTimings(40);
              if (cancelRef.current) return;
              tutorDebug("draw", "text command waited for audio start", {
                index,
                waited_ms: Math.round(performance.now() - audioWaitStart),
              });
            }

            if (!isTextCommand && hasNarration && command.type !== "PAUSE" && !audioStartedFlag) {
              const audioWaitStart = performance.now();
              await waitForAudioStart(2_500);
              if (cancelRef.current) return;
              tutorDebug("draw", "shape command waited for audio start", {
                index,
                command_type: command.type,
                waited_ms: Math.round(performance.now() - audioWaitStart),
                audio_started: audioStartedFlag,
              });
            }

            const textCanFollowAudio = !isTextCommand || !hasNarration || audioStartedFlag;
            const elapsedAtCommandStart =
              audioStartedAtMs === null ? 0 : performance.now() - audioStartedAtMs;

            const timingValidation =
              isTextCommand && hasNarration && textCanFollowAudio && capturedTimings
                ? validateAudioTimingsForNarration(narration, capturedTimings)
                : null;
            const segmentDurationMs =
              timingValidation?.totalDurationMs ??
              (capturedTimings?.totalDuration
                ? Math.round(capturedTimings.totalDuration * 1000)
                : totalSpeechMs);
            const timedSchedule =
              isTextCommand && hasNarration && textCanFollowAudio && capturedTimings && timingValidation?.valid
                ? getWriteCharScheduleMs(narration, command, capturedTimings, textCommandIndex)
                : null;
            const estimatedSchedule =
              isTextCommand && hasNarration && textCanFollowAudio
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
                  : speechWindow?.durationMs
                    ? adaptiveShapeBudget(command.type, speechWindow.durationMs, 1)
                    : multiShapeSegment
                      ? Math.max(commandSpeechMs, 50)
                      : adaptiveShapeBudget(command.type, undefined, 1);

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
                if (!audioStartedFlag) {
                  audioStartedFlag = true;
                  audioStartedResolver?.();
                }
                tutorDebug("tts", "segment audio started", { index });
                tel?.mark("tts-start", {
                  segment_index: index,
                  chars: narration.length,
                  command_count: segmentCommands.length,
                });
                applyTurnPhase("drawing");
                if (audioStartedAtMs === null) {
                  audioStartedAtMs = performance.now();
                }
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
      narrationDensityRef,
    ],
  );

  return { runSegment };
}
