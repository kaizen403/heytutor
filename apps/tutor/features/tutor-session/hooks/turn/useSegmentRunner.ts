import { useCallback } from "react";
import {
  getSegmentCommands,
  prefetchStrokePaths,
  type DrawCommand,
  type TutorSegment,
  serializeSegmentCommands,
} from "@heytutor/drawing";
import {
  catchUpWriteScheduleOffsets,
  leadWriteScheduleToSpeech,
  getBestWriteCharScheduleMs,
  getCommandDrawDurationMs,
  getCommandSpeechWindow,
  resolveLiveAudioPositionMs,
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
  isPausedRef,
  turnActiveRef,
  turnGenerationRef,
  turnTelemetryRef,
  turnStatsRef,
  recordedSegmentsRef,
  narrationSinceEpochRef,
  currentTraceIdRef,
  setCurrentSegmentText,
  narrationDensityRef,
  drawChainRef,
  reserveTextCommandPlacement,
}: UseSegmentRunnerParams) {
  const waitWhilePaused = useCallback(async (): Promise<boolean> => {
    while (isPausedRef.current) {
      if (cancelRef.current) {
        return false;
      }
      await cancellableDelay(80);
    }
    return !cancelRef.current;
  }, [cancelRef, cancellableDelay, isPausedRef]);

  const runSegment = useCallback(
    async (
      segment: TutorSegment,
      index: number,
      allSegments: TutorSegment[],
      turnGeneration: number,
    ): Promise<void> => {
      const isStale = () => turnGeneration !== turnGenerationRef.current;
      const isCancelled = () => cancelRef.current || isStale();
      if (isCancelled()) return;
      if (!(await waitWhilePaused())) return;
      if (isStale()) return;

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
      if (isCancelled()) {
        segmentSpan?.end({ skipped: true, reason: "cancelled" });
        return;
      }

      setCurrentSegmentText(segment.narration);

      const previousText = allSegments[index - 1]?.narration;
      const nextText = allSegments[index + 1]?.narration;
      const narration = segment.narration.trim();
      if (nextText?.trim()) {
        tts.prefetchSegment?.(nextText, {
          previousText: narration,
          nextText: allSegments[index + 2]?.narration,
          traceId: currentTraceIdRef.current ?? undefined,
          sessionId: sessionId ?? undefined,
        });
      }

      if (!narration && !segment.command) {
        tutorDebug("segment", "skipped empty segment", { index });
        segmentSpan?.end({ skipped: true });
        return;
      }

      let segmentCommands = getSegmentCommands(segment);
      const reservedTextCommands = new Set<DrawCommand>();
      if (segment.verifiedDiagramIntro !== true) {
        const prepared: DrawCommand[] = [];
        for (const command of segmentCommands) {
          const resolved = await reserveTextCommandPlacement(command);
          prepared.push(resolved);
          if (resolved !== command) reservedTextCommands.add(resolved);
        }
        segmentCommands = prepared;
      }
      if (isCancelled()) return;
      applyTurnPhase("speaking");
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

        if (!audioStartedFlag && !isCancelled() && !speechComplete) {
          tutorDebug("tts", "audio start still pending", {
            index,
            waited_ms: timeoutMs,
          });
        }

        return audioStartedFlag;
      };

      let maxAudioPositionMs = Number.NEGATIVE_INFINITY;
      const liveAudioPositionMs = (): number => {
        const resolved = resolveLiveAudioPositionMs({
          speechComplete,
          capturedDurationMs:
            capturedDurationMs ??
            (capturedTimings?.totalDuration
              ? Math.round(capturedTimings.totalDuration * 1000)
              : null),
          estimateSpeechMs,
          playbackPositionMs: tts.getPlaybackPositionMs(),
          audioStartedAtMs,
          nowMs: performance.now(),
          maxAudioPositionMs,
        });
        maxAudioPositionMs = resolved.maxAudioPositionMs;
        return resolved.positionMs;
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
        const diagramDrawOptions = {
          trustedDiagramGeometry: segment.verifiedDiagramIntro === true,
          applyLayout: segment.verifiedDiagramIntro !== true,
          segmentIndex: index,
          isCancelled,
        };

        try {
          // Warm handwriting paths while TTS connects so the first glyph is ready
          // when its spoken cue arrives.
          for (const command of segmentCommands) {
            if (
              (command.type === "WRITE" || command.type === "LABEL") &&
              command.text &&
              Number.isFinite(command.params[0]) &&
              Number.isFinite(command.params[1])
            ) {
              prefetchStrokePaths(command.text, command.params[0]!, command.params[1]!, 32);
            }
          }

          // Wait once for audio — never per-command (that stacked 2.5s × N idle gaps).
          if (hasNarration) {
            await waitForAudioStart(700);
            if (isCancelled()) {
              return;
            }
            // HTTP/WS often start after this wait. A provisional clock lets
            // estimated writing begin instead of hanging at position -1 until
            // the sentence ends.
            if (audioStartedAtMs === null) {
              audioStartedAtMs = performance.now();
            }
            if (audioStartedFlag) {
              await waitForInitialTimings(40);
              if (isCancelled()) {
                return;
              }
            }
          }

          let textCommandIndex = 0;
          for (const command of segmentCommands) {
            if (isCancelled()) {
              return;
            }
            if (!(await waitWhilePaused())) {
              return;
            }

            const isTextCommand = command.type === "WRITE" || command.type === "LABEL";
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
            const writeSchedule =
              isTextCommand && hasNarration
                ? getBestWriteCharScheduleMs(
                    narration,
                    command,
                    capturedTimings,
                    segmentDurationMs,
                    textCommandIndex,
                  )
                : null;

            if (writeSchedule && writeSchedule.offsetsMs.length > 0) {
              const audioPosAtScheduleMs = Math.round(liveAudioPositionMs());
              const firstOffsetMs = writeSchedule.offsetsMs[0] ?? 0;
              // #region agent log
              if (textCommandIndex === 0) {
                fetch('http://127.0.0.1:7280/ingest/352483c0-a316-40d0-8703-e595b34ba80f',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e9a5f5'},body:JSON.stringify({sessionId:'e9a5f5',runId:'pre-fix',hypothesisId:'H5',location:'useSegmentRunner.ts:writeSchedule',message:'write clock at first text',data:{index,audioPosAtScheduleMs,firstOffsetMs,elapsedAtCommandStart:Math.round(elapsedAtCommandStart),audioStartedFlag,hasCapturedTimings:Boolean(capturedTimings),scheduleSource:writeSchedule.source??null,intro:segment.verifiedDiagramIntro===true,preview:narration.slice(0,50)},timestamp:Date.now()})}).catch(()=>{});
              }
              // #endregion
              const effectiveOffsets = catchUpWriteScheduleOffsets(
                leadWriteScheduleToSpeech(writeSchedule.offsetsMs, audioPosAtScheduleMs),
                audioPosAtScheduleMs,
              );

              const scheduleMetadata = {
                segment_index: index,
                text: command.text?.slice(0, 60),
                schedule_source: writeSchedule.source,
                timing_chars: capturedTimings?.charStartTimes.length ?? 0,
                first_offset_ms: firstOffsetMs,
                audio_pos_ms: audioPosAtScheduleMs,
                start_lag_ms: audioPosAtScheduleMs - firstOffsetMs,
                matched: writeSchedule.matched,
                syncable: writeSchedule.matched,
                valid_timing: writeSchedule.validTiming,
                reason:
                  writeSchedule.reason ??
                  timingValidation?.reason ??
                  null,
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
                ...diagramDrawOptions,
                textPlacementReserved: reservedTextCommands.has(command),
              });
              if (isTextCommand) {
                textCommandIndex++;
              }
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
            const startDelayMs = speechWindow && segment.verifiedDiagramIntro !== true
              ? Math.min(
                  Math.max(Math.round(speechWindow.startMs - elapsedAtCommandStart), 0),
                  // Allow waiting for the spoken cue; a 400ms cap made shapes appear
                  // long before the words they belong to.
                  6_000,
                )
              : 0;

            if (startDelayMs > 0) {
              await cancellableDelay(startDelayMs);
              if (isCancelled()) {
                return;
              }
            }

            const introMany = segment.verifiedDiagramIntro === true && segmentCommands.length > 8;
            const commandBudgetMs =
              segment.verifiedDiagramIntro === true
                ? hasNarration
                  ? // Fit the whole intro batch into the spoken window so leftover
                    // ink cannot hold the next sentence and break the voice.
                    Math.min(
                      Math.max(
                        commandSpeechMs,
                        command.type === "FOCUS" ? (introMany ? 160 : 360) : command.type === "DRAW_POINT" ? 80 : 100,
                      ),
                      command.type === "FOCUS" ? (introMany ? 280 : 1_200) : introMany ? 220 : 900,
                    )
                  : isTextCommand
                    ? 260
                    : 180
                : isTextCommand
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
              ...diagramDrawOptions,
              textPlacementReserved: reservedTextCommands.has(command),
            });
            if (isTextCommand) {
              textCommandIndex++;
            }
          }
        } finally {
          const drawMs = Math.round(performance.now() - drawStart);
          turnStatsRef.current.drawMs += drawMs;
          const audioElapsedMs =
            audioStartedAtMs === null ? null : Math.round(performance.now() - audioStartedAtMs);
          tel?.mark("draw-complete", {
            segment_index: index,
            command_count: segmentCommands.length,
            duration_ms: drawMs,
            audio_elapsed_ms: audioElapsedMs,
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
        // Fail fast vs the old 45s hangs, but leave room after WS watchdog (5s)
        // for HTTP / browser fallback to finish speaking.
        const timeoutMs = Math.min(Math.max(text.length * 140, 12_000), 18_000);
        let timedOut = false;
        let timeoutId: number | null = null;

        try {
          await raceWithCancel(
            Promise.race([
              tts.speakSegment(text, options),
              new Promise<never>((_, reject) => {
                timeoutId = window.setTimeout(() => {
                  timedOut = true;
                  reject(new Error(`tts segment timeout after ${timeoutMs}ms`));
                }, timeoutMs);
              }),
            ]),
          );
        } catch (error) {
          tutorDebug("tts", "segment speech failed", {
            index,
            error: error instanceof Error ? error.message : String(error),
            timed_out: timedOut,
          });
          tel?.mark("tts-segment-failed", {
            segment_index: index,
            error: error instanceof Error ? error.message : String(error),
            timed_out: timedOut,
          });
          // Kill zombie WS/HTTP work so the next paragraph is not blocked.
          tts.abandonSpeaking?.();
        } finally {
          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
          }
          markSpeechComplete();
        }
      };

      try {
        if (!(await waitWhilePaused())) return;

        if (hasNarration && !hasCommand) {
          tutorDebug("segment", "narration-only", { index });
          await speakSegmentWithTimeout(narration, speakOptions);
          if (isCancelled()) return;
          tutorDebug("segment", "narration-only complete", { index });
        } else if (!hasNarration && hasCommand) {
          tutorDebug("segment", "draw-only", { index });
          await runDraw(naturalDrawMs);
          if (isCancelled()) return;
          tutorDebug("segment", "draw-only complete", { index });
        } else if (hasNarration && hasCommand) {
          tutorDebug("segment", "paired narration+draw", { index });

          // Finish prior ink first, then speak + draw this segment together so the
          // marker stays with the words (do not let speech race ahead on drawChain).
          await drawChainRef.current.catch(() => undefined);
          if (isCancelled()) return;
          if (!(await waitWhilePaused())) return;

          const drawPromise = runDraw(estimateSpeechMs, null);
          drawChainRef.current = drawPromise.catch(() => undefined);

          await Promise.all([
            speakSegmentWithTimeout(narration, {
              ...speakOptions,
              onStart: () => {
                if (isCancelled() || !turnActiveRef.current) return;
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
            }),
            drawPromise,
          ]);

          if (isCancelled()) return;
          tutorDebug("segment", "paired narration+draw complete", { index });
        }
      } finally {
        if (!isCancelled()) {
          recordedSegmentsRef.current.push({
            orderIndex: index,
            narration: segment.narration,
            spokenText: mathToSpeech(narration),
            command: serializeSegmentCommands(segmentCommands, {
              trustedDiagramGeometry: segment.verifiedDiagramIntro === true,
            }),
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
      waitWhilePaused,
      turnActiveRef,
      turnGenerationRef,
      turnTelemetryRef,
      turnStatsRef,
      recordedSegmentsRef,
      narrationSinceEpochRef,
      currentTraceIdRef,
      setCurrentSegmentText,
      narrationDensityRef,
      drawChainRef,
      reserveTextCommandPlacement,
    ],
  );

  return { runSegment };
}
