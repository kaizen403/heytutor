import { useCallback, useRef } from "react";
import {
  getSegmentCommands,
  prefetchStrokePaths,
  resolveVerifiedDiagramFocusTargets,
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
  getFocusTargetSchedule,
  createSpeechRateState,
  observeSpeechRate,
  estimateSpeechDurationMs,
  resolveLiveAudioPositionMs,
  resolveInitialTimingWait,
  classifyTtsScheduleUse,
  validateAudioTimingsForNarration,
  tutorDebug,
  mathToSpeech,
  capSceneBatchDurations,
  cuedInkCapMs,
  cuedInkFloorMs,
  cueWindowRemainingMs,
  cueWindowReserveMs,
  cueWindowSharers,
  getCueSpeechWindow,
  isCuedSceneBatch,
  nextDistinctCueToken,
  inkPaceContextForSegment,
  selectInkPace,
  voiceSettingsForDelivery,
  shouldStartLiveDraw,
  type AudioTimings,
  type InitialTimingWaitRelease,
  type TTSClient,
} from "@heytutor/tutor-core";
import { waitUntilDrawClock } from "@/lib/replay/replayAudio";
import { orderCommandsBySpokenAnchor } from "../../lib/turn/segmentPlanning";
import { guardDrawWithSpeech } from "../../lib/turn/turnFailurePolicy";
import { speakSegmentTimeoutMs } from "../../lib/turn/ttsSegmentTimeout";
import { resolveCommandInkBudgetMs } from "../../types";
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
      const paceContext = inkPaceContextForSegment({
        verifiedDiagramIntro: segment.verifiedDiagramIntro === true,
        commandCount: segmentCommands.length,
        hasNarration,
        sceneText: segment.sceneText === true,
      });
      const commandPaces = segmentCommands.map((cmd) => selectInkPace(cmd, paceContext));
      const pacedDurations = segmentCommands.map((cmd, commandIndex) =>
        getCommandDrawDurationMs(cmd, commandPaces[commandIndex]),
      );
      // A cued intro (every command names the word it is drawn under) is
      // paced by the voice, one part per word. The batch cap is what
      // squeezed a 10 s mirror intro into 1.3 s of ink and a 3.3 s parked
      // pen; a DSA frame carries no cues and keeps it.
      const cuedIntro = segment.verifiedDiagramIntro === true && isCuedSceneBatch(segmentCommands);
      const sceneBatchDurations =
        segment.verifiedDiagramIntro === true && !cuedIntro
          ? capSceneBatchDurations(pacedDurations)
          : null;
      const cuedFloors = cuedIntro ? segmentCommands.map((cmd) => cuedInkFloorMs(cmd)) : null;
      const cuedCaps = cuedFloors
        ? segmentCommands.map((cmd, commandIndex) => cuedInkCapMs(cmd, cuedFloors[commandIndex]))
        : null;
      const totalDrawWeight = pacedDurations.reduce((sum, ms) => sum + ms, 0);
      const multiShapeSegment =
        segmentCommands.filter((cmd) =>
          ["DRAW_CIRCLE", "DRAW_LINE", "DRAW_RECT", "DRAW_CUBE", "DRAW_CUBOID"].includes(cmd.type),
        ).length > 1;

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
      const naturalDrawMs = Math.max(
        pacedDurations.reduce((sum, ms) => sum + ms, 0),
        200,
      );
      let audioStartedAtMs: number | null = null;
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
          playbackRate: tts.getPlaybackRate?.() ?? 1,
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
          const waitStartedAt = performance.now();
          let settled = false;
          let timerId: number | null = null;
          const evaluate = () => {
            if (settled) {
              return;
            }
            const decision = resolveInitialTimingWait({
              hasNarration,
              timingChars: capturedTimings?.charStartTimes.length ?? 0,
              audioStartedAtMs,
              nowMs: performance.now(),
              speechComplete,
              cancelled: isCancelled(),
              playbackPositionMs: tts.getPlaybackPositionMs(),
              waitedMs: performance.now() - waitStartedAt,
            });
            if (decision.release) {
              settled = true;
              if (timerId !== null) {
                window.clearTimeout(timerId);
              }
              const waiterIndex = timingWaiters.indexOf(evaluate);
              if (waiterIndex >= 0) {
                timingWaiters.splice(waiterIndex, 1);
              }
              initialTimingWait = {
                release: decision.source,
                waitedMs: Math.round(performance.now() - waitStartedAt),
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
                  ? Math.max(decision.releaseAtMs - performance.now(), 0) + 1
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

          let textCommandIndex = 0;
          // Where the last cue word was found: matching walks forward through
          // the sentence and a run of parts under one word shares it.
          let cueCursor = 0;
          // A sentence's commands run in the order their words are spoken. A
          // cued intro is already in spoken order; anything else with more
          // than one command (a row plus the pointing gestures inferred from
          // the names the sentence speaks) is sorted by its first word.
          const anchorDiagram = activeVerifiedDiagramRef.current;
          const spokenAnchorsMs: Array<number | null> =
            segment.verifiedDiagramIntro === true || segmentCommands.length < 2 || !hasNarration
              ? segmentCommands.map(() => null)
              : segmentCommands.map((command, commandIndex) => {
                  const pace = commandPaces[commandIndex]!;
                  const isText = command.type === "WRITE" || command.type === "LABEL";
                  if (isText && pace !== "scene") {
                    const textIndex = segmentCommands
                      .slice(0, commandIndex)
                      .filter((earlier) => earlier.type === "WRITE" || earlier.type === "LABEL" || earlier.type === "TYPE")
                      .length;
                    const schedule = getBestWriteCharScheduleMs(
                      narration,
                      command,
                      capturedTimings,
                      capturedTimings?.totalDuration ? Math.round(capturedTimings.totalDuration * 1000) : totalSpeechMs,
                      textIndex,
                      speechMsPerChar,
                    );
                    return schedule?.offsetsMs[0] ?? null;
                  }
                  if (
                    command.type === "FOCUS" &&
                    anchorDiagram &&
                    anchorDiagram.layout !== "code_lesson"
                  ) {
                    const targets = resolveVerifiedDiagramFocusTargets(command, anchorDiagram);
                    if (targets.length === 0) return null;
                    const schedule = getFocusTargetSchedule({
                      narration,
                      command,
                      targets,
                      timings: capturedTimings,
                      msPerChar: speechMsPerChar,
                    });
                    return schedule.targets[0]?.startMs ?? null;
                  }
                  return null;
                });
          const commandOrder = orderCommandsBySpokenAnchor(spokenAnchorsMs);
          if (commandOrder.some((commandIndex, position) => commandIndex !== position)) {
            tutorDebug("draw", "commands reordered by spoken word", {
              index,
              order: commandOrder.map((commandIndex) => `${segmentCommands[commandIndex]!.type}@${spokenAnchorsMs[commandIndex] ?? "-"}`).join(" "),
            });
          }
          for (const commandIndex of commandOrder) {
            const command = segmentCommands[commandIndex]!;
            const pace = commandPaces[commandIndex]!;
            if (isCancelled()) {
              return;
            }
            if (!(await waitWhilePaused())) {
              return;
            }

            const isTextCommand =
              command.type === "WRITE" ||
              command.type === "LABEL" ||
              // TYPE is text for pacing: it earns the same spoken window a
              // written line would.
              command.type === "TYPE";
            // Handwriting aligns each character to the word being spoken. Code
            // is not read aloud, so there is nothing to align to — a matched
            // schedule would stretch past the segment and strand the tail. The
            // code panel paces itself inside the window instead.
            //
            // Nor is figure text: a cell value or an index header is part of
            // the sketch, and it has no spoken token to track. Scheduling them
            // as handwriting cost half a second each, so a fourteen-label
            // figure took ten seconds to appear under a four second sentence.
            //
            // Nor a cued figure label: "P" is lettered as "pole" is said, in
            // the window of its cue word, and a one-letter text match against
            // the sentence would only send it to the wrong place.
            const spokenCue = cuedIntro ? command.spokenCue ?? null : null;
            const needsCharSchedule =
              isTextCommand && command.type !== "TYPE" && pace !== "scene" && !spokenCue;
            const elapsedAtCommandStart = liveAudioPositionMs();

            const timingValidation =
              needsCharSchedule && hasNarration && capturedTimings
                ? validateAudioTimingsForNarration(narration, capturedTimings)
                : null;
            const segmentDurationMs =
              timingValidation?.totalDurationMs ??
              (capturedTimings?.totalDuration
                ? Math.round(capturedTimings.totalDuration * 1000)
                : totalSpeechMs);
            const writeSchedule =
              needsCharSchedule && hasNarration
                ? getBestWriteCharScheduleMs(
                    narration,
                    command,
                    capturedTimings,
                    segmentDurationMs,
                    textCommandIndex,
                    speechMsPerChar,
                  )
                : null;

            if (writeSchedule && writeSchedule.offsetsMs.length > 0) {
              const audioPosAtScheduleMs = Math.round(liveAudioPositionMs());
              const firstOffsetMs = writeSchedule.offsetsMs[0] ?? 0;
              const effectiveOffsets = catchUpWriteScheduleOffsets(
                leadWriteScheduleToSpeech(
                  writeSchedule.offsetsMs,
                  audioPosAtScheduleMs,
                  writeSchedule.maxInitialWaitMs,
                ),
                audioPosAtScheduleMs,
              );

              // Agent B (timings live): why this row is, or is not, on the
              // exact clock. `schedule_source` alone hid the cause.
              const timingChars = capturedTimings?.charStartTimes.length ?? 0;
              const ttsScheduleUse = classifyTtsScheduleUse({
                scheduleSource: writeSchedule.source,
                scheduleReason: writeSchedule.reason ?? null,
                timingChars,
                timingValid: timingValidation?.valid ?? false,
              });
              const scheduleMetadata = {
                segment_index: index,
                text: command.text?.slice(0, 60),
                schedule_source: writeSchedule.source,
                tts_schedule: ttsScheduleUse,
                timing_chars: timingChars,
                spoken_chars: spokenChars,
                timing_total_ms: capturedTimings
                  ? Math.round(capturedTimings.totalDuration * 1000)
                  : 0,
                timing_valid: timingValidation?.valid ?? false,
                timing_reason: timingValidation?.reason ?? null,
                timing_origin: timingsOrigin,
                timing_wait_release: initialTimingWait?.release ?? null,
                timing_wait_ms: initialTimingWait?.waitedMs ?? null,
                first_offset_ms: firstOffsetMs,
                audio_pos_ms: audioPosAtScheduleMs,
                start_lag_ms: audioPosAtScheduleMs - firstOffsetMs,
                matched: writeSchedule.matched,
                matched_char_fraction: writeSchedule.matchedCharFraction,
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
                  // The slots are media ms; the glyph tween runs in wall time.
                  getPlaybackRate: () => tts.getPlaybackRate?.() ?? 1,
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
                inkPace: pace,
              });
              if (isTextCommand) {
                textCommandIndex++;
              }
              continue;
            }

            const commandWeight = pacedDurations[commandIndex] ?? getCommandDrawDurationMs(command, pace);
            const naturalDrawMs = commandWeight;
            const commandSpeechMs =
              totalDrawWeight > 0
                ? Math.max(Math.round(totalSpeechMs * (commandWeight / totalDrawWeight)), 50)
                : Math.max(Math.round(totalSpeechMs / segmentCommands.length), 50);
            // One trace per named part, each on its spoken word. The schedule
            // is built here because only the runner holds the sentence's
            // alignment; the FOCUS branch then waits per target itself. A
            // combined tag used to fire once at the top of the sentence for a
            // fixed 900 ms and the pen parked for the rest (136 s of it across
            // six measured lessons).
            const focusDiagram = activeVerifiedDiagramRef.current;
            const focusTargets =
              command.type === "FOCUS" &&
              hasNarration &&
              segment.verifiedDiagramIntro !== true &&
              focusDiagram &&
              focusDiagram.layout !== "code_lesson"
                ? resolveVerifiedDiagramFocusTargets(command, focusDiagram)
                : [];
            const focusSchedule =
              focusTargets.length > 0
                ? getFocusTargetSchedule({
                    narration,
                    command,
                    targets: focusTargets,
                    timings: capturedTimings,
                    msPerChar: speechMsPerChar,
                  })
                : null;
            if (focusSchedule) {
              const focusMetadata = {
                segment_index: index,
                spec: command.text?.slice(0, 60),
                source: focusSchedule.source,
                matched: focusSchedule.matchedCount,
                targets: focusSchedule.targets.map((target) => `${target.id}@${target.startMs}-${target.endMs}:${target.anchor}`).join(" "),
              };
              tutorDebug("draw", "focus schedule ready", focusMetadata);
              tel?.mark("focus-schedule-ready", focusMetadata);
            }
            // A written row's index picks the n-th spoken occurrence of its
            // text. A FOCUS after a row is not a second occurrence of anything,
            // and passing the row count here made it look for one, miss, and
            // fall to a window at the top of the sentence.
            // A cued figure part waits for its word. The window runs from the
            // word to the next part's word (or the end of the sentence), exact
            // when the alignment is in hand and estimated at the session's rate
            // otherwise. The beat's opening stroke starts with the sentence
            // even when its word comes later: "The real, inverted image" draws
            // the image from "The".
            const cueWindow =
              spokenCue && hasNarration
                ? getCueSpeechWindow(
                    narration,
                    spokenCue,
                    capturedTimings,
                    speechMsPerChar,
                    cueCursor,
                    nextDistinctCueToken(segmentCommands, commandIndex),
                  )
                : null;
            if (cueWindow) {
              cueCursor = cueWindow.cursor;
            }
            const cueStartMs = cueWindow ? (commandIndex === 0 ? 0 : cueWindow.startMs) : null;
            const speechWindow =
              !cueWindow && hasNarration && (capturedTimings ?? audioTimings)
                ? getCommandSpeechWindow(
                    narration,
                    command,
                    capturedTimings ?? audioTimings,
                    isTextCommand ? textCommandIndex : 0,
                    speechMsPerChar,
                  )
                : null;
            const startDelayMs = cueStartMs !== null
              ? Math.max(Math.round(cueStartMs - elapsedAtCommandStart), 0)
              : speechWindow && segment.verifiedDiagramIntro !== true && !focusSchedule
                ? Math.min(
                    Math.max(Math.round(speechWindow.startMs - elapsedAtCommandStart), 0),
                    // Allow waiting for the spoken cue; a 400ms cap made shapes appear
                    // long before the words they belong to.
                    6_000,
                  )
                : 0;

            if (startDelayMs > 0 && (cueStartMs !== null || speechWindow)) {
              await waitUntilDrawClock(liveAudioPositionMs, cueStartMs ?? speechWindow!.startMs, {
                shouldCancel: isCancelled,
                getPlaybackRate: () => tts.getPlaybackRate?.() ?? 1,
              });
              if (isCancelled()) {
                return;
              }
            }
            if (cueWindow) {
              const cueMetadata = {
                segment_index: index,
                command_type: command.type,
                text: command.text?.slice(0, 40),
                token: spokenCue?.token,
                entity_id: spokenCue?.entityId,
                matched: cueWindow.matched,
                source: capturedTimings ? "tts" : "estimated",
                word_start_ms: cueWindow.startMs,
                word_end_ms: cueWindow.endMs,
                audio_pos_ms: Math.round(liveAudioPositionMs()),
              };
              tutorDebug("draw", "cue window ready", cueMetadata);
              tel?.mark("cue-window-ready", cueMetadata);
            }

            // Ink budget. A cued part gets what is left of its word's window
            // after the wait, less the hand time the later words' parts still
            // need, shared with the parts under the same word; floored at
            // hand speed and capped at an unhurried pace, so the pen holds on
            // the finished part until the next word rather than crawling.
            const cueRemainingMs =
              cueWindow && cuedFloors
                ? cueWindowRemainingMs(
                    cueWindow,
                    Math.max(liveAudioPositionMs(), cueStartMs ?? 0),
                    cueWindowReserveMs(segmentCommands, commandIndex, cuedFloors),
                  )
                : null;
            const commandBudgetMs = resolveCommandInkBudgetMs({
              command,
              pace,
              verifiedDiagramIntro: segment.verifiedDiagramIntro === true,
              isTextCommand,
              speechWindowMs: speechWindow?.durationMs,
              commandSpeechMs,
              naturalDrawMs,
              multiShapeSegment,
              sceneBatchDurationMs: sceneBatchDurations?.[commandIndex],
              ...(cueRemainingMs !== null && cuedFloors && cuedCaps
                ? {
                    cueWindow: {
                      remainingMs: cueRemainingMs,
                      sharers: cueWindowSharers(segmentCommands, commandIndex, cuedFloors, cuedCaps),
                    },
                  }
                : {}),
            });

            await executeCommandWithCancel(command, {
              segmentNarration: narration,
              speechDurationMs: commandBudgetMs,
              // What this command may spend of the segment's spoken time.
              // Anything that fills time rather than drawing ink is capped by
              // it, so two commands in one beat cannot each take the whole
              // beat and leave the board running behind its own narration.
              speechShareMs: cueWindow
                ? Math.max(cueWindow.endMs - (cueStartMs ?? 0), commandBudgetMs)
                : command.type === "POINT"
                  // A pointing walk has no word of its own to be matched on,
                  // so the fallback window handed it 300 ms of a 20 s DSA
                  // sentence and the pen stood still for the rest. It walks
                  // for what is left of the sentence.
                  ? Math.max(
                      (capturedTimings?.totalDuration
                        ? Math.round(capturedTimings.totalDuration * 1000)
                        : totalSpeechMs) - Math.round(liveAudioPositionMs()),
                      commandSpeechMs,
                      speechWindow?.durationMs ?? 0,
                    )
                  : speechWindow?.durationMs || commandSpeechMs,
              ...diagramDrawOptions,
              textPlacementReserved: reservedTextCommands.has(command),
              inkPace: pace,
              // The voice is on this part: the whiteboard honours the requested
              // time instead of clipping it to the 320 ms scene ceiling.
              ...(cueWindow ? { cued: true } : {}),
              ...(focusSchedule ? { focusSchedule } : {}),
              getAudioPositionMs: liveAudioPositionMs,
              getPlaybackRate: () => tts.getPlaybackRate?.() ?? 1,
              // The sentence's own clock for the code lesson. TYPE, FRAME and
              // the code-lesson FOCUS follow its words with it (see
              // lib/code-lesson/codeSpokenSync.ts, SpokenSegmentClock). The
              // alignment is read through a getter: the first sentence's
              // arrives while it plays, and a typed block reads it after
              // typing, when it is there.
              spokenClock: {
                narration,
                getTimings: () => capturedTimings,
                estimatedTotalMs: estimateSpeechMs,
                getAudioPositionMs: liveAudioPositionMs,
                getPlaybackRate: () => tts.getPlaybackRate?.() ?? 1,
                msPerChar: speechMsPerChar,
              },
            });
            if (isTextCommand) {
              textCommandIndex++;
            }
          }
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
        onError: () => {
          markSpeechComplete();
        },
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

  return { runSegment };
}
