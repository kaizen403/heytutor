import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  applyReplayPlaybackRate,
  applyReplaySpeed,
  playReplayAudio,
  speedAwareDelay,
  stopReplayAudio,
  waitUntilDrawClock,
} from "@/lib/replay/replayAudio";
import {
  buildReplayTimeline,
  findCueAtTime,
  getPartialCommandCount,
  type ReplayCue,
} from "@/lib/replay/replayTimeline";
import { exportNotesPdf, type NotesEpoch } from "@/lib/client/exportNotesPdf";
import type { BoardEntry } from "@/lib/boards/types";
import type { SettingsState } from "@/features/tutor-session/components/SettingsDrawer";
import type { StoredSegment, StoredTurn } from "@/lib/boards/boardsClient";
import type { DrawCommand } from "@heytutor/drawing";
import {
  isStoredCommandTrustedGeometry,
  lessonNarrationText,
} from "@heytutor/drawing";
import type { WriteSchedule, WhiteboardHandle } from "@heytutor/whiteboard";
import {
  capSceneBatchDurations,
  catchUpWriteScheduleOffsets,
  createScheduledWriteClock,
  getBestWriteCharScheduleMs,
  getCommandDrawDurationMs,
  getCommandSpeechWindow,
  inkPaceContextForSegment,
  leadWriteScheduleToSpeech,
  selectInkPace,
  tutorDebug,
  unlockTutorAudio,
  type InkPace,
  type TTSClient,
} from "@heytutor/tutor-core";
import type { TutorPhase } from "../types";

type ExecuteCommandOptions = {
  durationScale?: number;
  speechDurationMs?: number;
  writeSchedule?: WriteSchedule;
  applyLayout?: boolean;
  segmentNarration?: string;
  trustedDiagramGeometry?: boolean;
  isCancelled?: () => boolean;
  inkPace?: InkPace;
};

type ReplayGenerationState = {
  generation: number;
  activeGeneration: number;
  cancelled: boolean;
};

export function isReplayGenerationCurrent(state: ReplayGenerationState): boolean {
  return state.generation === state.activeGeneration && !state.cancelled;
}

export type UseReplayParams = {
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cancelRef: RefObject<boolean>;
  speedRef: RefObject<number>;
  isPausedRef: RefObject<boolean>;
  replayAudioRef: RefObject<HTMLAudioElement | null>;
  replayAudioPreloadRef: RefObject<Map<string, HTMLAudioElement>>;
  storedTurnsRef: RefObject<StoredTurn[]>;
  replayGenerationRef: RefObject<number>;
  replayCueRef: RefObject<ReplayCue | null>;
  ttsClientRef: RefObject<TTSClient | null>;
  notesEpochsRef: RefObject<NotesEpoch[]>;
  narrationSinceEpochRef: RefObject<string>;
  phase: TutorPhase;
  isReplaying: boolean;
  isPaused: boolean;
  isDownloading: boolean;
  replayProgressMs: number;
  boards: BoardEntry[];
  sessionId: string;
  setPhase: Dispatch<SetStateAction<TutorPhase>>;
  setCurrentSegmentText: Dispatch<SetStateAction<string>>;
  setNarrationText: Dispatch<SetStateAction<string>>;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
  setIsReplaying: Dispatch<SetStateAction<boolean>>;
  setReplayProgressMs: Dispatch<SetStateAction<number>>;
  setReplayTotalMs: Dispatch<SetStateAction<number>>;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  setIsDownloading: Dispatch<SetStateAction<boolean>>;
  cancellableDelay: (duration: number) => Promise<void>;
  raceWithCancel: <T>(promise: Promise<T>) => Promise<T | undefined>;
  executeCommandWithCancel: (
    command: DrawCommand,
    options?: ExecuteCommandOptions,
  ) => Promise<void>;
  executeCommand: (command: DrawCommand, options?: ExecuteCommandOptions) => Promise<void>;
  resetBoardLayout: (keepHeading?: boolean, forceSequentialWorkLayout?: boolean) => void;
  finishLectureUi: () => void;
  pauseTurn: () => void;
  resumeTurn: () => void;
};

export function useReplay({
  whiteboardRef,
  cancelRef,
  speedRef,
  isPausedRef,
  replayAudioRef,
  replayAudioPreloadRef,
  storedTurnsRef,
  replayGenerationRef,
  replayCueRef,
  ttsClientRef,
  notesEpochsRef,
  narrationSinceEpochRef,
  phase,
  isReplaying,
  isPaused,
  isDownloading,
  replayProgressMs,
  boards,
  sessionId,
  setPhase,
  setCurrentSegmentText,
  setNarrationText,
  setIsPaused,
  setIsReplaying,
  setReplayProgressMs,
  setReplayTotalMs,
  setSettings,
  setIsDownloading,
  raceWithCancel,
  executeCommandWithCancel,
  executeCommand,
  resetBoardLayout,
  finishLectureUi,
  pauseTurn,
  resumeTurn,
}: UseReplayParams) {
  const runReplaySegmentDraw = useCallback(
    async (
      segment: StoredSegment,
      segmentCommands: DrawCommand[],
      narration: string,
      generation: number,
      audio?: HTMLAudioElement,
      fallbackDurationMs?: number,
      initialTextCommandIndex = 0,
    ): Promise<void> => {
      const isCurrentReplay = () =>
        isReplayGenerationCurrent({
          generation,
          activeGeneration: replayGenerationRef.current,
          cancelled: cancelRef.current,
        });

      if (segmentCommands.length === 0 || !isCurrentReplay()) {
        return;
      }

      setPhase("drawing");
      // Ink RAF speed tracks the live rate so mid-cue changes stay aligned.
      whiteboardRef.current?.setAnimationSpeed(Math.max(speedRef.current, 0.1));
      const paceContext = inkPaceContextForSegment({
        verifiedDiagramIntro: isStoredCommandTrustedGeometry(segment.command),
        commandCount: segmentCommands.length,
        hasNarration: narration.length > 0,
      });
      const commandPaces = segmentCommands.map((cmd) => selectInkPace(cmd, paceContext));
      const pacedDurations = segmentCommands.map((cmd, commandIndex) =>
        getCommandDrawDurationMs(cmd, commandPaces[commandIndex]),
      );
      const sceneBatch = commandPaces.filter((pace) => pace === "scene").length >= 4;
      const sceneDurations = sceneBatch ? capSceneBatchDurations(pacedDurations) : null;
      const totalDrawWeight = pacedDurations.reduce((sum, ms) => sum + ms, 0);
      const durationMs =
        fallbackDurationMs ??
        segment.durationMs ??
        Math.max(narration.length * 85, 700);
      const trustedDiagramGeometry = isStoredCommandTrustedGeometry(segment.command);
      const getRate = () => Math.max(speedRef.current, 0.1);
      const shouldCancel = () => !isCurrentReplay();
      const wallOriginMs = performance.now();
      const getDrawClockMs = createScheduledWriteClock({
        getRawPositionMs: () =>
          audio && Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0,
        nowMs: () => wallOriginMs + (performance.now() - wallOriginMs) * getRate(),
      });

      let textCommandIndex = initialTextCommandIndex;
      for (let commandIndex = 0; commandIndex < segmentCommands.length; commandIndex++) {
        const command = segmentCommands[commandIndex]!;
        const pace = commandPaces[commandIndex]!;
        if (!isCurrentReplay()) {
          return;
        }

        whiteboardRef.current?.setAnimationSpeed(getRate());

        const isTextCommand = command.type === "WRITE" || command.type === "LABEL";
        const scheduleWorkWrite =
          isTextCommand &&
          Boolean(narration) &&
          !(trustedDiagramGeometry && command.type === "LABEL");
        const writePlan = scheduleWorkWrite
          ? getBestWriteCharScheduleMs(
              narration,
              command,
              segment.timings,
              durationMs,
              textCommandIndex,
            )
          : null;

        if (writePlan && writePlan.offsetsMs.length > 0) {
          const audioPosAtScheduleMs = Math.round(getDrawClockMs());
          const effectiveOffsets = catchUpWriteScheduleOffsets(
            leadWriteScheduleToSpeech(writePlan.offsetsMs, audioPosAtScheduleMs),
            audioPosAtScheduleMs,
          );
          await executeCommandWithCancel(command, {
            applyLayout: false,
            isCancelled: () => !isCurrentReplay(),
            trustedDiagramGeometry,
            inkPace: pace,
            writeSchedule: {
              charStartOffsetsMs: effectiveOffsets,
              charDurationsMs: writePlan.charDurationsMs,
              getAudioPositionMs: getDrawClockMs,
            },
          });
          if (isTextCommand) {
            textCommandIndex++;
          }
          continue;
        }

        const speechWindow =
          narration && segment.timings
            ? getCommandSpeechWindow(narration, command, segment.timings, textCommandIndex)
            : {
                startMs: 0,
                durationMs,
                matched: false,
              };

        if (speechWindow.startMs > 0) {
          await waitUntilDrawClock(getDrawClockMs, speechWindow.startMs, {
            shouldCancel,
            getPlaybackRate: getRate,
          });
        }
        if (!isCurrentReplay()) {
          return;
        }

        const commandWeight = pacedDurations[commandIndex] ?? getCommandDrawDurationMs(command, pace);
        // Scene batches keep their capped reveal time instead of stretching a
        // train across the recorded sentence. Follow ink still fills the cue.
        const commandBudgetMs = sceneDurations
          ? sceneDurations[commandIndex] ?? commandWeight
          : totalDrawWeight > 0
            ? Math.max(Math.round(durationMs * (commandWeight / totalDrawWeight)), 50)
            : Math.max(Math.round(speechWindow.durationMs), 50);

        await executeCommandWithCancel(command, {
          applyLayout: false,
          isCancelled: () => !isCurrentReplay(),
          speechDurationMs: commandBudgetMs,
          trustedDiagramGeometry,
          inkPace: pace,
        });
        if (isTextCommand) {
          textCommandIndex++;
        }
      }
    },
    [cancelRef, replayGenerationRef, speedRef, setPhase, whiteboardRef, executeCommandWithCancel],
  );

  const waitWhileReplayPaused = useCallback(async (generation: number) => {
    while (isPausedRef.current) {
      if (cancelRef.current || generation !== replayGenerationRef.current) {
        return false;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    return !cancelRef.current && generation === replayGenerationRef.current;
  }, [cancelRef, isPausedRef, replayGenerationRef]);

  const renderBoardAtTime = useCallback(
    async (timeMs: number, cues: ReplayCue[], generation: number) => {
      const wb = whiteboardRef.current;
      const isCurrentReplay = () =>
        isReplayGenerationCurrent({
          generation,
          activeGeneration: replayGenerationRef.current,
          cancelled: cancelRef.current,
        });
      if (!wb) {
        return;
      }

      if (!isCurrentReplay()) {
        return;
      }

      wb.clearBoard();
      resetBoardLayout(false, false);

      // Render all completed commands instantly — no animation during seek.
      // durationScale 0 makes the whiteboard jump to the final state.
      for (const cue of cues) {
        if (cue.startMs >= timeMs) {
          break;
        }

        const partialCount =
          cue.endMs <= timeMs
            ? cue.commands.length
            : getPartialCommandCount(cue, timeMs - cue.startMs);

        for (let i = 0; i < partialCount; i++) {
          if (!isCurrentReplay()) {
            return;
          }
          await executeCommand(cue.commands[i]!, {
            durationScale: 0,
            applyLayout: false,
            isCancelled: () => !isCurrentReplay(),
            trustedDiagramGeometry: cue.trustedDiagramGeometry,
          });
        }
      }
    },
    [whiteboardRef, replayGenerationRef, cancelRef, executeCommand, resetBoardLayout],
  );

  const playReplayCue = useCallback(
    async (
      cue: ReplayCue,
      offsetMs: number,
      generation: number,
      skipDraw: boolean,
      nextCue?: ReplayCue,
      startCommandIndex = 0,
    ) => {
      if (cancelRef.current || generation !== replayGenerationRef.current) {
        return;
      }

      const ready = await waitWhileReplayPaused(generation);
      if (!ready) {
        return;
      }

      replayCueRef.current = cue;
      if (cue.narration) {
        setCurrentSegmentText(cue.narration);
      }

      // Preload the next segment's audio so there's no gap between cues.
      if (nextCue?.audioUrl) {
        const preloadKey = nextCue.audioUrl;
        if (!replayAudioPreloadRef.current.has(preloadKey)) {
          const preloaded = new Audio(nextCue.audioUrl);
          preloaded.preload = "auto";
          applyReplayPlaybackRate(preloaded, speedRef.current);
          replayAudioPreloadRef.current.set(preloadKey, preloaded);
        } else {
          const existing = replayAudioPreloadRef.current.get(preloadKey);
          if (existing) {
            applyReplayPlaybackRate(existing, speedRef.current);
          }
        }
      } else if (nextCue) {
        const nextSpoken = (nextCue.segment.spokenText || nextCue.narration).trim();
        if (nextSpoken) {
          ttsClientRef.current?.prefetchSegment?.(nextSpoken);
        }
      }

      const fallbackDurationMs =
        cue.durationMsStored ?? Math.max(cue.narration.length * 85, 700);
      const remainingMs = Math.max(cue.durationMs - offsetMs, 0);
      const getRate = () => Math.max(speedRef.current, 0.1);
      const shouldCancel = () =>
        cancelRef.current || generation !== replayGenerationRef.current;
      const startIdx = Math.max(0, startCommandIndex);
      const remainingCommands = cue.commands.slice(startIdx);
      const initialTextCommandIndex = cue.commands
        .slice(0, startIdx)
        .filter((command) => command.type === "WRITE" || command.type === "LABEL")
        .length;

      const spokenText = (cue.segment.spokenText || cue.narration).trim();
      const speakLiveTts = async (): Promise<void> => {
        const tts = ttsClientRef.current;
        if (!spokenText || !tts || shouldCancel()) {
          if (remainingMs > 0) {
            await speedAwareDelay(remainingMs, {
              shouldCancel,
              getPlaybackRate: getRate,
            });
          }
          return;
        }
        unlockTutorAudio();
        tts.unlockAudio?.();
        tts.setMuted?.(false);
        tts.setPlaybackRate(getRate());
        await tts.speakSegment(spokenText);
      };

      const drawRemaining = (audio?: HTMLAudioElement) =>
        runReplaySegmentDraw(
          cue.segment,
          remainingCommands,
          cue.narration,
          generation,
          audio,
          fallbackDurationMs,
          initialTextCommandIndex,
        );

      try {
        if (cue.audioUrl) {
          setPhase("speaking");
          // Drop preloaded element after applying rate — playReplayAudio owns playback.
          const preloaded = replayAudioPreloadRef.current.get(cue.audioUrl);
          if (preloaded) {
            replayAudioPreloadRef.current.delete(cue.audioUrl);
          }

          const { audio, done } = playReplayAudio(cue.audioUrl, {
            playbackRate: getRate(),
            getPlaybackRate: getRate,
            maxDurationMs: fallbackDurationMs,
            startAtMs: offsetMs,
            shouldCancel,
          });
          replayAudioRef.current = audio;
          whiteboardRef.current?.setAnimationSpeed(getRate());

          const voiceDone = done.catch(async (error: unknown) => {
            tutorDebug("turn", "replay audio missing or blocked; using live TTS", {
              order_index: cue.segment.orderIndex,
              audio_url: cue.audioUrl,
              error: error instanceof Error ? error.message : String(error),
            });
            replayAudioRef.current = null;
            if (shouldCancel()) {
              return;
            }
            await speakLiveTts();
          });

          if (!skipDraw) {
            setPhase("drawing");
            await Promise.all([
              raceWithCancel(voiceDone),
              raceWithCancel(drawRemaining(audio)),
            ]);
          } else {
            await raceWithCancel(voiceDone);
          }
          replayAudioRef.current = null;
        } else {
          setPhase("speaking");
          whiteboardRef.current?.setAnimationSpeed(getRate());
          const voiceDone = speakLiveTts();
          if (!skipDraw && remainingCommands.length > 0) {
            setPhase("drawing");
            await Promise.all([
              raceWithCancel(voiceDone),
              raceWithCancel(drawRemaining()),
            ]);
          } else {
            await raceWithCancel(voiceDone);
          }
        }
      } catch (error) {
        tutorDebug("turn", "replay segment failed", {
          order_index: cue.segment.orderIndex,
          audio_url: cue.audioUrl,
          error: error instanceof Error ? error.message : String(error),
        });

        if (isReplayGenerationCurrent({
          generation,
          activeGeneration: replayGenerationRef.current,
          cancelled: cancelRef.current,
        }) && !skipDraw && remainingCommands.length > 0) {
          await runReplaySegmentDraw(
            cue.segment,
            remainingCommands,
            cue.narration,
            generation,
            undefined,
            fallbackDurationMs,
            initialTextCommandIndex,
          );
        }
      }

      if (generation === replayGenerationRef.current) {
        setReplayProgressMs(cue.endMs);
      }
    },
    [
      cancelRef,
      replayGenerationRef,
      replayCueRef,
      replayAudioPreloadRef,
      speedRef,
      replayAudioRef,
      ttsClientRef,
      setCurrentSegmentText,
      setPhase,
      setReplayProgressMs,
      waitWhileReplayPaused,
      runReplaySegmentDraw,
      raceWithCancel,
      whiteboardRef,
    ],
  );

  const playReplayFrom = useCallback(
    async (startMs: number) => {
      const wb = whiteboardRef.current;
      const timeline = buildReplayTimeline(storedTurnsRef.current);
      if (!wb || timeline.cues.length === 0) {
        return;
      }

      if (phase !== "idle" && !isReplaying) {
        return;
      }

      const generation = ++replayGenerationRef.current;
      cancelRef.current = false;
      isPausedRef.current = false;
      setIsPaused(false);
      setIsReplaying(true);
      setReplayTotalMs(timeline.totalMs);
      setReplayProgressMs(startMs);
      setPhase("speaking");

      stopReplayAudio(replayAudioRef.current);
      replayAudioRef.current = null;

      await renderBoardAtTime(startMs, timeline.cues, generation);
      if (cancelRef.current || generation !== replayGenerationRef.current) {
        return;
      }

      const found = findCueAtTime(timeline.cues, startMs);
      if (!found) {
        stopReplayAudio(replayAudioRef.current);
        replayAudioRef.current = null;
        setIsReplaying(false);
        finishLectureUi();
        return;
      }

      try {
        for (let i = found.index; i < timeline.cues.length; i++) {
          if (cancelRef.current || generation !== replayGenerationRef.current) {
            break;
          }

          const cue = timeline.cues[i]!;
          const nextCue = timeline.cues[i + 1];
          const offsetMs = i === found.index ? found.offsetMs : 0;
          // Don't skip draw on mid-segment seek — renderBoardAtTime already
          // drew the completed portion instantly. Continue drawing only the
          // remaining commands in this cue alongside the audio.
          const startCommandIndex =
            i === found.index && offsetMs > 0
              ? getPartialCommandCount(cue, offsetMs)
              : 0;
          await playReplayCue(
            cue,
            offsetMs,
            generation,
            false,
            nextCue,
            startCommandIndex,
          );
        }

        const lastTurn =
          storedTurnsRef.current[storedTurnsRef.current.length - 1];
        if (lastTurn && generation === replayGenerationRef.current) {
          setNarrationText(lessonNarrationText(lastTurn.rawResponse));
        }
      } finally {
        if (generation !== replayGenerationRef.current) {
          return;
        }
        stopReplayAudio(replayAudioRef.current);
        replayAudioRef.current = null;
        replayCueRef.current = null;
        // Clean up any preloaded audio elements.
        for (const preloaded of replayAudioPreloadRef.current.values()) {
          stopReplayAudio(preloaded);
        }
        replayAudioPreloadRef.current.clear();
        setIsReplaying(false);
        setReplayProgressMs(timeline.totalMs);
        finishLectureUi();
      }
    },
    [
      whiteboardRef,
      storedTurnsRef,
      phase,
      isReplaying,
      replayGenerationRef,
      cancelRef,
      isPausedRef,
      replayAudioRef,
      replayAudioPreloadRef,
      replayCueRef,
      setIsPaused,
      setIsReplaying,
      setReplayTotalMs,
      setReplayProgressMs,
      setPhase,
      setNarrationText,
      renderBoardAtTime,
      playReplayCue,
      finishLectureUi,
    ],
  );

  const replayLecture = useCallback(() => {
    if (storedTurnsRef.current.length === 0 || isReplaying) {
      return;
    }
    unlockTutorAudio();
    ttsClientRef.current?.unlockAudio?.();
    ttsClientRef.current?.setMuted?.(false);
    void playReplayFrom(0);
  }, [storedTurnsRef, isReplaying, playReplayFrom, ttsClientRef]);

  const downloadNotesPdf = useCallback(() => {
    if (isDownloading || isReplaying) {
      return;
    }
    const wb = whiteboardRef.current;
    if (!wb) {
      return;
    }
    setIsDownloading(true);
    try {
      const finalSnapshot = wb.captureSnapshot(2);
      const epochs: NotesEpoch[] = [...notesEpochsRef.current];
      if (finalSnapshot) {
        epochs.push({
          index: epochs.length,
          snapshotDataUrl: finalSnapshot,
          narrationText: narrationSinceEpochRef.current,
          timestampMs: Date.now(),
        });
      }
      if (epochs.length === 0) {
        return;
      }
      const boardTitle = boards.find((b) => b.id === sessionId)?.title ?? "Lecture Notes";
      exportNotesPdf({
        title: boardTitle,
        epochs,
      });
    } finally {
      setIsDownloading(false);
    }
  }, [
    whiteboardRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    boards,
    sessionId,
    isDownloading,
    isReplaying,
    setIsDownloading,
  ]);

  const seekReplay = useCallback(
    (timeMs: number) => {
      if (!isReplaying) {
        return;
      }
      void playReplayFrom(timeMs);
    },
    [isReplaying, playReplayFrom],
  );

  const toggleReplayPlayPause = useCallback(() => {
    if (!isReplaying) {
      return;
    }
    if (isPausedRef.current) {
      resumeTurn();
    } else {
      pauseTurn();
    }
  }, [isReplaying, isPausedRef, pauseTurn, resumeTurn]);

  const handleReplaySpeedChange = useCallback((rate: number) => {
    const safeRate = applyReplaySpeed({
      rate,
      audio: replayAudioRef.current,
      preloaded: replayAudioPreloadRef.current.values(),
      setTtsPlaybackRate: (next) => ttsClientRef.current?.setPlaybackRate(next),
      setAnimationSpeed: (next) => whiteboardRef.current?.setAnimationSpeed(next),
    });
    speedRef.current = safeRate;
    setSettings((prev) => ({ ...prev, speedMultiplier: safeRate }));
  }, [speedRef, setSettings, ttsClientRef, replayAudioRef, replayAudioPreloadRef, whiteboardRef]);

  useEffect(() => {
    if (!isReplaying || isPaused) {
      return;
    }

    let frameId = 0;
    let lastWallMs = performance.now();
    let mediaProgressMs = replayProgressMs;
    let lastCueStartMs = replayCueRef.current?.startMs ?? -1;

    const tick = () => {
      const cue = replayCueRef.current;
      const audio = replayAudioRef.current;
      const now = performance.now();
      if (cue && cue.startMs !== lastCueStartMs) {
        // New cue or seek landed in another cue — resync media baseline.
        lastCueStartMs = cue.startMs;
        mediaProgressMs =
          audio && Number.isFinite(audio.currentTime)
            ? cue.startMs + audio.currentTime * 1000
            : cue.startMs;
        lastWallMs = now;
      }
      if (cue && audio && !audio.paused && Number.isFinite(audio.currentTime)) {
        mediaProgressMs = Math.min(cue.startMs + audio.currentTime * 1000, cue.endMs);
        setReplayProgressMs(mediaProgressMs);
        lastWallMs = now;
      } else if (cue) {
        // No audio — advance in media-time using the live speed so mid-cue
        // rate changes keep the scrubber honest without resetting the baseline.
        const rate = Math.max(speedRef.current, 0.1);
        mediaProgressMs = Math.min(
          mediaProgressMs + (now - lastWallMs) * rate,
          cue.endMs,
        );
        lastWallMs = now;
        setReplayProgressMs(mediaProgressMs);
      } else {
        lastWallMs = now;
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
    // replayProgressMs is intentionally read only at effect start / cue change;
    // including it every tick would reset the media baseline on each frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReplaying,
    isPaused,
    replayCueRef,
    replayAudioRef,
    speedRef,
    setReplayProgressMs,
  ]);

  return {
    runReplaySegmentDraw,
    waitWhileReplayPaused,
    renderBoardAtTime,
    playReplayCue,
    playReplayFrom,
    replayLecture,
    downloadNotesPdf,
    seekReplay,
    toggleReplayPlayPause,
    handleReplaySpeedChange,
  };
}
