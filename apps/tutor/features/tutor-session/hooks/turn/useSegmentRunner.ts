import { useCallback, useRef } from "react";
import {
  getSegmentCommands,
  prefetchStrokePaths,
  type DrawCommand,
  type TutorSegment,
  serializeSegmentCommands,
} from "@heytutor/drawing";
import {
  createSpeechRateState,
  observeSpeechRate,
  estimateSpeechDurationMs,
  resolveLiveAudioPositionMs,
  resolveInitialTimingWait,
  validateAudioTimingsForNarration,
  tutorDebug,
  mathToSpeech,
  voiceSettingsForDelivery,
  shouldStartLiveDraw,
  type AudioTimings,
  type InitialTimingWaitRelease,
  type TTSClient,
  SpeechSynthesisTTSClient,
} from "@heytutor/tutor-core";
import { drawSegmentInk, planSegmentInk } from "../../lib/turn/segmentInk";
import { guardDrawWithSpeech } from "../../lib/turn/turnFailurePolicy";
import { speakSegmentTimeoutMs } from "../../lib/turn/ttsSegmentTimeout";
import { browserRecoveryPlaybackRate, createPauseAwareSpeechClock, requireSpeechStart, speakWithPauseOwnedFallback, speakWithStartupRecovery, speechPlaybackOverdue, type PauseAwareSpeechClock } from "../../lib/turn/speechStartup";
import type { UseSegmentRunnerParams } from "./types";

/**
 * Sentences asked for ahead of the one being spoken. The TTS client caps how
 * many it will actually hold open; this is the order they are asked for in.
 */
const TTS_LOOKAHEAD_SEGMENTS = 2;

export function useSegmentRunner({
  sessionId,
  activeVerifiedDiagramRef,
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
  reserveTextCommandPlacements,
}: UseSegmentRunnerParams) {
  // The voice's measured pace, learned from every aligned sentence of the
  // session and used wherever a sentence has no alignment yet. The estimate
  // used to assume 15 spoken chars a second; the voice runs 11 to 13.5, so
  // every guessed row finished a median 1.4 s before its words.
  const speechRateRef = useRef(createSpeechRateState());
  const browserSpeechRef = useRef<SpeechSynthesisTTSClient | null>(null);
  const browserFallbackOwnerRef = useRef<symbol | null>(null);
  const fallbackPauseGenerationRef = useRef(0);
  const speechClockRef = useRef<PauseAwareSpeechClock | null>(null);
  const timingWaitClockRef = useRef<PauseAwareSpeechClock | null>(null);

  // Turn controls own both transports. Browser pause() cancels its current
  // utterance; the fallback loop retries that sentence after resume.
  const pauseFallbackSpeech = () => {
    speechClockRef.current?.pause();
    timingWaitClockRef.current?.pause();
    fallbackPauseGenerationRef.current++;
    if (browserFallbackOwnerRef.current) browserSpeechRef.current?.pause();
  };
  const resumeFallbackSpeech = () => {
    speechClockRef.current?.resume();
    timingWaitClockRef.current?.resume();
    if (browserFallbackOwnerRef.current) browserSpeechRef.current?.resume();
  };
  const stopFallbackSpeech = () => {
    // A cancelled turn must not leave its startup poll suspended forever.
    speechClockRef.current?.resume();
    timingWaitClockRef.current?.resume();
    fallbackPauseGenerationRef.current++;
    if (browserFallbackOwnerRef.current) browserSpeechRef.current?.stop();
  };

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
      let browserRecoveryRate: number | null = null;
      const segmentPlaybackRate = () => browserRecoveryRate ?? tts.getPlaybackRate?.() ?? 1;

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
      // Two sentences ahead, in speaking order. One is enough while a beat
      // runs for seconds, but a short beat — a one-line emphasis, a five-word
      // aside — does not cover a sentence's generation on its own, and that
      // was the last place the lecture could still be heard to stop.
      for (let ahead = 1; ahead <= TTS_LOOKAHEAD_SEGMENTS; ahead++) {
        const upcoming = allSegments[index + ahead]?.narration;
        if (!upcoming?.trim()) continue;
        tts.prefetchSegment?.(upcoming, {
          previousText: allSegments[index + ahead - 1]?.narration ?? narration,
          nextText: allSegments[index + ahead + 1]?.narration,
          traceId: currentTraceIdRef.current ?? undefined,
          sessionId: sessionId ?? undefined,
          // Generated ahead with the dials it will be spoken with, so the
          // lookahead cannot hand an opening line the teaching voice.
          voiceSettings: voiceSettingsForDelivery(allSegments[index + ahead]?.delivery),
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
          // One work row can come back as several: a line too long for the
          // column is wrapped there rather than shrunk to fit.
          const resolved = await reserveTextCommandPlacements(command);
          for (const row of resolved) {
            prepared.push(row);
            if (row !== command) reservedTextCommands.add(row);
          }
        }
        segmentCommands = prepared;
      }
      if (isCancelled()) return;
      // Stay in thinking until the voice is audible. Applying "speaking" here
      // dropped the preparing overlay the moment a segment was queued, so the
      // student watched a silent 1.5–2× dump while TTS was still connecting.
      const hasNarration = narration.length > 0;
      const hasCommand = segmentCommands.length > 0;
      const inkPlan = planSegmentInk({
        commands: segmentCommands,
        verifiedDiagramIntro: segment.verifiedDiagramIntro === true,
        hasNarration,
        sceneText: segment.sceneText === true,
      });

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
      const spokenChars = mathToSpeech(narration).length;
      // The dials this sentence is spoken with. The lookahead generated it
      // with the same ones, and the cache is keyed on them, so the peek
      // below must ask with exactly what `speakSegment` will ask with.
      const voiceSettings = voiceSettingsForDelivery(segment.delivery);
      const speechMsPerChar = speechRateRef.current.msPerChar;
      const estimateSpeechMs = estimateSpeechDurationMs(spokenChars, speechMsPerChar);
      // Feed the adaptive-speed hook with the narration density of this segment.
      narrationDensityRef.current =
        estimateSpeechMs > 0 ? narration.length / estimateSpeechMs : 0;
      const naturalDrawMs = Math.max(inkPlan.totalDrawWeight, 200);
      let audioStartedAtMs: number | null = null;
      let audioStartedAtActiveMs: number | null = null;
      let usingBrowserFallback = false;
      let speechAborted = false;
      const segmentFallbackOwner = Symbol("browser fallback");
      let speechComplete = false;
      let actualDrawMs = 0;
      let timingTelemetryCount = 0;
      let lastTimingTelemetryChars = -1;
      // Agent B (timings live): the initial-timing wait. Each waiter re-reads
      // the segment state through `resolveInitialTimingWait`; the three
      // events that can move that decision (first alignment, audio start,
      // speech end) each call `notifyTimingWaiters`.
      const timingWaiters: Array<() => void> = [];
      const notifyTimingWaiters = () => {
        for (const notify of timingWaiters.slice()) {
          notify();
        }
      };
      /** Where the first alignment came from, for the schedule log. */
      let timingsOrigin: "peek" | "callback" | null = null;
      let initialTimingWait: { release: InitialTimingWaitRelease; waitedMs: number } | null = null;

      const markSpeechComplete = () => {
        speechComplete = true;
        notifyTimingWaiters();
      };

      let maxAudioPositionMs = Number.NEGATIVE_INFINITY;
      const liveAudioPositionMs = (): number => {
        const clock = speechClockRef.current;
        const resolved = resolveLiveAudioPositionMs({
          speechComplete,
          capturedDurationMs:
            capturedDurationMs ??
            (capturedTimings?.totalDuration
              ? Math.round(capturedTimings.totalDuration * 1000)
              : null),
          estimateSpeechMs,
          playbackPositionMs: usingBrowserFallback ? null : tts.getPlaybackPositionMs(),
          audioStartedAtMs: clock && audioStartedAtActiveMs !== null ? audioStartedAtActiveMs : audioStartedAtMs,
          nowMs: clock ? clock.elapsedMs() : performance.now(),
          maxAudioPositionMs,
          playbackRate: segmentPlaybackRate(),
        });
        maxAudioPositionMs = resolved.maxAudioPositionMs;
        return resolved.positionMs;
      };

      /**
       * Hold the first schedule until the voice is actually audible
       * (playback > 0, not merely `onStart`) and either the exact alignment
       * is in hand, 120 ms have passed since `onStart`, speech has ended, or
       * the turn is cancelled. Peeked timings and onStart used to release the
       * pen onto a silent 1.5× wall clock.
       */
      const waitForInitialTimings = (): Promise<void> =>
        new Promise((resolve) => {
          const waitClock = createPauseAwareSpeechClock();
          if (isPausedRef.current) waitClock.pause();
          timingWaitClockRef.current = waitClock;
          let settled = false;
          let timerId: number | null = null;
          const evaluate = () => {
            if (settled) {
              return;
            }
            const speechClock = speechClockRef.current;
            const nowMs = speechClock?.elapsedMs() ?? performance.now();
            const decision = resolveInitialTimingWait({
              hasNarration,
              timingChars: capturedTimings?.charStartTimes.length ?? 0,
              audioStartedAtMs: speechClock && audioStartedAtActiveMs !== null ? audioStartedAtActiveMs : audioStartedAtMs,
              nowMs,
              speechComplete,
              cancelled: isCancelled(),
              playbackPositionMs: usingBrowserFallback ? null : tts.getPlaybackPositionMs(),
              waitedMs: waitClock.elapsedMs(),
            });
            if (decision.release) {
              settled = true;
              if (timingWaitClockRef.current === waitClock) timingWaitClockRef.current = null;
              if (timerId !== null) {
                window.clearTimeout(timerId);
              }
              const waiterIndex = timingWaiters.indexOf(evaluate);
              if (waiterIndex >= 0) {
                timingWaiters.splice(waiterIndex, 1);
              }
              initialTimingWait = {
                release: decision.source,
                waitedMs: Math.round(waitClock.elapsedMs()),
              };
              resolve();
              return;
            }
            if (!timingWaiters.includes(evaluate)) {
              timingWaiters.push(evaluate);
            }
            if (timerId === null) {
              // Playback becoming audible is not an event — poll. Cap the
              // deadline timer at one frame so we notice the first sample.
              const delay =
                decision.releaseAtMs !== null
                  ? Math.max(decision.releaseAtMs - nowMs, 0) + 1
                  : 16;
              timerId = window.setTimeout(() => {
                timerId = null;
                evaluate();
              }, Math.min(delay, 16));
            }
          };
          evaluate();
        });

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

          // Agent B (timings live), start. The lookahead generated this
          // sentence one or two beats ago, so its alignment is already in the
          // client; asked for here, before any schedule is built, it is what
          // makes `schedule_source: tts` the normal case. The claim replays
          // the same timings 1 to 3 ms after the old code had already built
          // the estimated schedule (15 of 15 WRITE rows, 10 Sep 2026).
          if (hasNarration && !capturedTimings) {
            const peeked = tts.peekSegmentTimings?.(narration, { voiceSettings });
            if (peeked && peeked.charStartTimes.length > 0) {
              timingsOrigin = "peek";
              captureTimings(peeked);
              tutorDebug("tts", "segment timings peeked", {
                index,
                timing_chars: peeked.charStartTimes.length,
                spoken_chars: spokenChars,
                total_duration_ms: Math.round(peeked.totalDuration * 1000),
              });
            }
          }
          // Spoken ink waits until the voice is audible. Peeked alignment is
          // used once `onStart` has fired — not before, or the pen dumps the
          // figure on the wall clock while TTS is still connecting.
          if (hasNarration) {
            await raceWithCancel(waitForInitialTimings());
            if (isCancelled()) {
              return;
            }
            if (
              !shouldStartLiveDraw({
                hasNarration: true,
                audioStarted: audioStartedAtMs !== null,
              })
            ) {
              tutorDebug("draw", "skipped silent dump; voice never started", { index });
              // Voice never came: uncover the board so the lecture is not stuck
              // behind "preparing" for the rest of the turn.
              applyTurnPhase("speaking");
              return;
            }
            applyTurnPhase("drawing");
            tutorDebug("draw", "initial timing wait", {
              index,
              release: initialTimingWait?.release ?? null,
              waited_ms: initialTimingWait?.waitedMs ?? null,
              timing_chars: capturedTimings?.charStartTimes.length ?? 0,
              timing_origin: timingsOrigin,
            });
          }
          // Agent B (timings live), end.

          await drawSegmentInk({
            plan: inkPlan,
            verifiedDiagramIntro: segment.verifiedDiagramIntro === true,
            clock: {
              narration,
              getTimings: () => capturedTimings,
              fallbackTimings: audioTimings,
              totalSpeechMs,
              estimatedSpeechMs: estimateSpeechMs,
              msPerChar: speechMsPerChar,
              getAudioPositionMs: liveAudioPositionMs,
              getPlaybackRate: segmentPlaybackRate,
              isSpeechComplete: () => speechComplete,
              canAdvanceAfterSpeech: () => !isPausedRef.current,
            },
            getDiagram: () => activeVerifiedDiagramRef.current,
            isCancelled,
            waitWhilePaused,
            execute: executeCommandWithCancel,
            commandOptions: (command) => ({
              ...diagramDrawOptions,
              textPlacementReserved: reservedTextCommands.has(command),
            }),
            segmentIndex: index,
            spokenChars,
            describeTiming: () => ({
              timing_origin: timingsOrigin,
              timing_wait_release: initialTimingWait?.release ?? null,
              timing_wait_ms: initialTimingWait?.waitedMs ?? null,
            }),
            trace: {
              reordered: (order) => {
                tutorDebug("draw", "commands reordered by spoken word", { index, order });
              },
              writeScheduleReady: (metadata) => {
                tutorDebug("draw", "write schedule ready", { index, ...metadata });
                tel?.mark("write-schedule-ready", metadata);
              },
              writeCharStart: (metadata) => {
                tutorDebug("draw", "write char start", metadata);
                tel?.mark("write-char-start", metadata);
              },
              focusScheduleReady: (metadata) => {
                tutorDebug("draw", "focus schedule ready", metadata);
                tel?.mark("focus-schedule-ready", metadata);
              },
              cueWindowReady: (metadata) => {
                tutorDebug("draw", "cue window ready", metadata);
                tel?.mark("cue-window-ready", metadata);
              },
            },
          });
        } finally {
          actualDrawMs = Math.round(performance.now() - drawStart);
          turnStatsRef.current.drawMs += actualDrawMs;
          const audioElapsedMs =
            audioStartedAtMs === null ? null : Math.round(performance.now() - audioStartedAtMs);
          tel?.mark("draw-complete", {
            segment_index: index,
            command_count: segmentCommands.length,
            duration_ms: actualDrawMs,
            audio_elapsed_ms: audioElapsedMs,
          });
          drawSpan?.end({
            command_count: segmentCommands.length,
            duration_ms: actualDrawMs,
          });
        }
      };

      const captureTimings = (timings: AudioTimings) => {
        if (timingsOrigin === null && timings.charStartTimes.length > 0) {
          timingsOrigin = "callback";
        }
        capturedTimings = timings;
        const validation = validateAudioTimingsForNarration(narration, timings);
        if (timings.totalDuration > 0) {
          speechRateRef.current = observeSpeechRate(
            speechRateRef.current,
            spokenChars,
            Math.round(timings.totalDuration * 1000),
          );
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
        if (timings.charStartTimes.length > 0) {
          notifyTimingWaiters();
        }
      };

      const markVoiceStarted = () => {
        if (isCancelled() || !turnActiveRef.current) return;
        if (audioStartedAtMs === null) {
          audioStartedAtMs = performance.now();
          audioStartedAtActiveMs = speechClockRef.current?.elapsedMs() ?? null;
        }
        // Narration-only: drop the overlay as soon as onStart fires.
        // Paired speech+ink waits until playback is audible so a long
        // decode cannot uncover a silent 1.5× dump.
        if (!hasCommand) {
          applyTurnPhase("speaking");
        }
        notifyTimingWaiters();
      };

      const speakOptions = {
        previousText,
        nextText,
        traceId: currentTraceIdRef.current ?? undefined,
        sessionId: sessionId ?? undefined,
        voiceSettings,
        onStart: markVoiceStarted,
        onAudioCaptured: (audio: { bytes: Uint8Array }) => {
          capturedAudio = audio.bytes;
        },
        onTimings: captureTimings,
        onEnd: markSpeechComplete,
        // The provider can report an error before this runner starts browser
        // recovery. Only the final outcome releases the drawing wait.
        onError: () => {},
      };

      const speakSegmentWithTimeout = async (
        text: string,
        options: Parameters<TTSClient["speakSegment"]>[1] = {},
      ): Promise<void> => {
        // First-chunk latency plus the whole playback. An 18s hard cap was
        // shorter than a normal DSA paragraph on HTTP TTS and killed the pen.
        const timeoutMs = speakSegmentTimeoutMs(text);
        let timedOut = false;
        let timeoutId: number | null = null;
        let playbackWatchId: number | null = null;
        const clock = createPauseAwareSpeechClock();
        if (isPausedRef.current) clock.pause();
        speechClockRef.current = clock;

        try {
          const spoken = requireSpeechStart(speakWithStartupRecovery({
            primary: (onStart) => tts.speakSegment(text, {
              ...options,
              onStart: () => {
                if (usingBrowserFallback || isCancelled()) return;
                options.onStart?.();
                onStart();
              },
              onEnd: () => {
                if (!usingBrowserFallback && audioStartedAtMs !== null) options.onEnd?.();
              },
              onTimings: (timings) => {
                if (!usingBrowserFallback) options.onTimings?.(timings);
              },
              onAudioCaptured: (audio) => {
                if (!usingBrowserFallback) options.onAudioCaptured?.(audio);
              },
            }),
            fallback: async () => {
              browserSpeechRef.current ??= new SpeechSynthesisTTSClient();
              browserSpeechRef.current.setPlaybackRate(segmentPlaybackRate());
              browserFallbackOwnerRef.current = segmentFallbackOwner;
              try {
                await speakWithPauseOwnedFallback({
                  speak: ({ onStart, onEnd, onError }) => browserSpeechRef.current!.speakSegment(text, {
                    ...options,
                    onStart: () => {
                      if (isCancelled()) return;
                      // pause() cancels browser speech; the next utterance starts
                      // this sentence over. Reset both its origin and the wall
                      // fallback's high-water mark so ink waits for the voice.
                      if (audioStartedAtMs !== null) {
                        audioStartedAtMs = performance.now();
                        audioStartedAtActiveMs = clock.elapsedMs();
                        maxAudioPositionMs = Number.NEGATIVE_INFINITY;
                      }
                      onStart();
                      options.onStart?.();
                    },
                    onEnd: () => { if (!isCancelled()) { onEnd(); options.onEnd?.(); } },
                    onError,
                  }),
                  waitWhilePaused,
                  isCancelled: () => isCancelled() || speechAborted,
                  pauseGeneration: () => fallbackPauseGenerationRef.current,
                });
              } finally {
                if (browserFallbackOwnerRef.current === segmentFallbackOwner) {
                  browserFallbackOwnerRef.current = null;
                }
              }
            },
            abandonPrimary: () => {
              if (tts.abandonSpeaking) tts.abandonSpeaking();
              else tts.stop();
            },
            hasStarted: () => audioStartedAtMs !== null,
            canFallback: () => !isCancelled() && !speechAborted && !isPausedRef.current,
            onFallback: (reason) => {
              usingBrowserFallback = true;
              browserRecoveryRate = browserRecoveryPlaybackRate(tts.getPlaybackRate?.() ?? 1);
              capturedAudio = null;
              capturedTimings = null;
              capturedDurationMs = null;
              tel?.mark("tts-browser-recovery", { segment_index: index, reason });
            },
            clock,
          }), () => audioStartedAtMs !== null || isCancelled() || isPausedRef.current);
          const playbackWatch = new Promise<never>((_, reject) => {
            const check = () => {
              const timings = capturedTimings;
              if (
                !usingBrowserFallback && audioStartedAtMs !== null && timings &&
                validateAudioTimingsForNarration(narration, timings).valid &&
                speechPlaybackOverdue({
                  elapsedMs: clock.elapsedMs() - (audioStartedAtActiveMs ?? 0),
                  audioDurationMs: timings.totalDuration * 1000,
                  playbackRate: segmentPlaybackRate(),
                  paused: isPausedRef.current,
                })
              ) {
                timedOut = true;
                reject(new Error("tts segment playback stalled after audio started"));
                return;
              }
              playbackWatchId = window.setTimeout(check, 250);
            };
            playbackWatchId = window.setTimeout(check, 250);
          });
          await raceWithCancel(Promise.race([
            spoken,
            playbackWatch,
            new Promise<never>((_, reject) => {
              const check = () => {
                if (clock.elapsedMs() >= timeoutMs) {
                  timedOut = true;
                  reject(new Error(`tts segment timeout after ${timeoutMs}ms`));
                  return;
                }
                timeoutId = window.setTimeout(check, 250);
              };
              timeoutId = window.setTimeout(check, 250);
            }),
          ]));
        } catch (error) {
          speechAborted = true;
          if (browserFallbackOwnerRef.current === segmentFallbackOwner) stopFallbackSpeech();
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
          // Do not count a silent fallback as a successful lecture beat. Let
          // the queue stop after repeated failures and show its retry message.
          // Browser recovery only succeeds after its utterance actually ends.
          // A partial onStart before a synthesis error is still a failed beat.
          if ((audioStartedAtMs === null || usingBrowserFallback) && !isCancelled()) throw error;
        } finally {
          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
          }
          if (playbackWatchId !== null) {
            window.clearTimeout(playbackWatchId);
          }
          if (speechClockRef.current === clock) speechClockRef.current = null;
          markSpeechComplete();
        }
      };

      let segmentCompleted = false;
      try {
        if (!(await waitWhilePaused())) return;

        if (hasNarration && !hasCommand) {
          tutorDebug("segment", "narration-only", { index });
          await speakSegmentWithTimeout(narration, speakOptions);
          if (isCancelled()) return;
          tutorDebug("segment", "narration-only complete", { index });
        } else if (!hasNarration && hasCommand) {
          tutorDebug("segment", "draw-only", { index });
          applyTurnPhase("drawing");
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
          // If the ink stops, the voice stops with it. Without this the two
          // promises are independent: Promise.all rejects on the draw side
          // while the speech carries on narrating a board that has frozen.
          const guardedDraw = guardDrawWithSpeech(drawPromise, (error) => {
            speechAborted = true;
            if (browserFallbackOwnerRef.current === segmentFallbackOwner) stopFallbackSpeech();
            tutorDebug("segment", "draw failed; silencing narration", {
              index,
              error: error instanceof Error ? error.message : String(error),
            });
            tel?.mark("segment-draw-failed", {
              segment_index: index,
              error: error instanceof Error ? error.message : String(error),
            });
            tts.abandonSpeaking?.();
          });

          await Promise.all([
            speakSegmentWithTimeout(narration, {
              ...speakOptions,
              onStart: () => {
                markVoiceStarted();
                tutorDebug("tts", "segment audio started", { index });
                tel?.mark("tts-start", {
                  segment_index: index,
                  chars: narration.length,
                  command_count: segmentCommands.length,
                });
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
            guardedDraw,
          ]);

          if (isCancelled()) return;
          tutorDebug("segment", "paired narration+draw complete", { index });
        }
        segmentCompleted = true;
      } finally {
        if (segmentCompleted && !isCancelled()) {
          recordedSegmentsRef.current.push({
            orderIndex: index,
            narration: segment.narration,
            spokenText: mathToSpeech(narration),
            command: serializeSegmentCommands(segmentCommands, {
              trustedDiagramGeometry: segment.verifiedDiagramIntro === true,
            }),
            audioBytes: capturedAudio,
            durationMs: (() => {
              const spoken = capturedDurationMs;
              const typed = segmentCommands.some((command) => command.type === "TYPE");
              if (!typed) return spoken;
              const elapsed = audioStartedAtMs != null
                ? Math.round(performance.now() - audioStartedAtMs)
                : actualDrawMs > 0 ? actualDrawMs : null;
              if (spoken == null) return elapsed;
              if (elapsed == null) return spoken;
              return Math.max(spoken, elapsed);
            })(),
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
      activeVerifiedDiagramRef,
      cancellableDelay,
      ensureTTSClient,
      executeCommandWithCancel,
      raceWithCancel,
      applyTurnPhase,
      cancelRef,
      isPausedRef,
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
      reserveTextCommandPlacements,
    ],
  );

  return { runSegment, pauseFallbackSpeech, resumeFallbackSpeech, stopFallbackSpeech };
}
