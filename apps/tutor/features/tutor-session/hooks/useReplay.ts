import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { playReplayAudio, stopReplayAudio } from "@/lib/replayAudio";
import {
  buildReplayTimeline,
  findCueAtTime,
  getPartialCommandCount,
  type ReplayCue,
} from "@/lib/replayTimeline";
import { exportNotesPdf, type NotesEpoch } from "@/lib/exportNotesPdf";
import type { BoardEntry } from "@/components/BoardHistory";
import type { SettingsState } from "@/components/SettingsDrawer";
import type { StoredSegment, StoredTurn } from "@/lib/boardsClient";
import type { DrawCommand } from "@heytutor/drawing";
import { lessonNarrationText } from "@heytutor/drawing";
import type { WriteSchedule, WhiteboardHandle } from "@heytutor/whiteboard";
import {
  getCommandDrawDurationMs,
  getCommandSpeechWindow,
  getWriteCharScheduleMs,
  tutorDebug,
  type TTSClient,
} from "@heytutor/tutor-core";
import type { TutorPhase } from "../types";

type ExecuteCommandOptions = {
  durationScale?: number;
  speechDurationMs?: number;
  writeSchedule?: WriteSchedule;
  applyLayout?: boolean;
  segmentNarration?: string;
  skipTemplateDuplicateCheck?: boolean;
  skipGeometrySnap?: boolean;
};

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
  cancellableDelay,
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
      audio?: HTMLAudioElement,
      fallbackDurationMs?: number,
    ): Promise<void> => {
      if (segmentCommands.length === 0 || cancelRef.current) {
        return;
      }

      setPhase("drawing");
      const playbackRate = Math.max(speedRef.current, 0.1);
      const totalDrawWeight = segmentCommands.reduce(
        (sum, cmd) => sum + getCommandDrawDurationMs(cmd),
        0,
      );
      const durationMs =
        fallbackDurationMs ??
        segment.durationMs ??
        Math.max(narration.length * 85, 700);

      let textCommandIndex = 0;
      for (const command of segmentCommands) {
        if (cancelRef.current) {
          return;
        }

        const isTextCommand = command.type === "WRITE" || command.type === "LABEL";
        const charSchedule =
          isTextCommand && narration && segment.timings
            ? getWriteCharScheduleMs(narration, command, segment.timings, textCommandIndex)
            : null;

        if (charSchedule && charSchedule.offsetsMs.length > 0 && audio) {
          await executeCommandWithCancel(command, {
            applyLayout: false,
            writeSchedule: {
              charStartOffsetsMs: charSchedule.offsetsMs,
              charDurationsMs: charSchedule.charDurationsMs,
              getAudioPositionMs: () => audio.currentTime * 1000,
            },
          });
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
        const startDelayMs = Math.max(
          Math.round(speechWindow.startMs / playbackRate),
          0,
        );

        if (startDelayMs > 0) {
          await cancellableDelay(startDelayMs);
        }
        if (cancelRef.current) {
          return;
        }

        const commandWeight = getCommandDrawDurationMs(command);
        const commandBudgetMs =
          totalDrawWeight > 0
            ? Math.max(Math.round((durationMs * (commandWeight / totalDrawWeight)) / playbackRate), 50)
            : Math.max(Math.round(speechWindow.durationMs / playbackRate), 50);

        await executeCommandWithCancel(command, {
          applyLayout: false,
          speechDurationMs: commandBudgetMs,
        });
        if (isTextCommand) {
          textCommandIndex++;
        }
      }
    },
    [cancelRef, speedRef, setPhase, cancellableDelay, executeCommandWithCancel],
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
    async (timeMs: number, cues: ReplayCue[]) => {
      const wb = whiteboardRef.current;
      if (!wb) {
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
          if (cancelRef.current) {
            return;
          }
          await executeCommand(cue.commands[i]!, {
            durationScale: 0,
            applyLayout: false,
          });
        }
      }
    },
    [whiteboardRef, cancelRef, executeCommand, resetBoardLayout],
  );

  const playReplayCue = useCallback(
    async (
      cue: ReplayCue,
      offsetMs: number,
      generation: number,
      skipDraw: boolean,
      nextCue?: ReplayCue,
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
          preloaded.playbackRate = speedRef.current;
          replayAudioPreloadRef.current.set(preloadKey, preloaded);
        }
      }

      const fallbackDurationMs =
        cue.durationMsStored ?? Math.max(cue.narration.length * 85, 700);
      const remainingMs = Math.max(cue.durationMs - offsetMs, 0);

      try {
        if (cue.audioUrl) {
          setPhase("speaking");
          // Reuse preloaded audio element if available — avoids re-fetching.
          const preloaded = replayAudioPreloadRef.current.get(cue.audioUrl);
          if (preloaded) {
            replayAudioPreloadRef.current.delete(cue.audioUrl);
          }

          const { audio, done } = playReplayAudio(cue.audioUrl, {
            playbackRate: speedRef.current,
            maxDurationMs: fallbackDurationMs,
            startAtMs: offsetMs,
            shouldCancel: () =>
              cancelRef.current || generation !== replayGenerationRef.current,
          });
          replayAudioRef.current = audio;

          if (!skipDraw) {
            setPhase("drawing");
            const drawPromise = runReplaySegmentDraw(
              cue.segment,
              cue.commands,
              cue.narration,
              audio,
              fallbackDurationMs,
            );
            await Promise.all([
              raceWithCancel(done),
              raceWithCancel(drawPromise),
            ]);
          } else {
            await raceWithCancel(done);
          }
          replayAudioRef.current = null;
        } else if (!skipDraw && cue.commands.length > 0) {
          await runReplaySegmentDraw(
            cue.segment,
            cue.commands,
            cue.narration,
            undefined,
            fallbackDurationMs,
          );
        } else if (remainingMs > 0) {
          setPhase("speaking");
          await cancellableDelay(remainingMs);
        }
      } catch (error) {
        tutorDebug("turn", "replay segment failed", {
          order_index: cue.segment.orderIndex,
          audio_url: cue.audioUrl,
          error: error instanceof Error ? error.message : String(error),
        });

        if (!skipDraw && cue.commands.length > 0) {
          await runReplaySegmentDraw(
            cue.segment,
            cue.commands,
            cue.narration,
            undefined,
            fallbackDurationMs,
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
      setCurrentSegmentText,
      setPhase,
      setReplayProgressMs,
      waitWhileReplayPaused,
      runReplaySegmentDraw,
      raceWithCancel,
      cancellableDelay,
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

      await renderBoardAtTime(startMs, timeline.cues);
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
          // drew the completed portion instantly. Continue drawing the
          // remaining commands in this cue alongside the audio.
          await playReplayCue(cue, offsetMs, generation, false, nextCue);
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
    void playReplayFrom(0);
  }, [storedTurnsRef, isReplaying, playReplayFrom]);

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
    speedRef.current = rate;
    setSettings((prev) => ({ ...prev, speedMultiplier: rate }));
    ttsClientRef.current?.setPlaybackRate(rate);
    if (replayAudioRef.current) {
      replayAudioRef.current.playbackRate = rate;
    }
  }, [speedRef, setSettings, ttsClientRef, replayAudioRef]);

  useEffect(() => {
    if (!isReplaying || isPaused) {
      return;
    }

    let frameId = 0;
    const replayStartWallMs = performance.now();
    const replayStartProgressMs = replayProgressMs;

    const tick = () => {
      const cue = replayCueRef.current;
      const audio = replayAudioRef.current;
      if (cue && audio && !audio.paused && Number.isFinite(audio.currentTime)) {
        setReplayProgressMs(
          Math.min(cue.startMs + audio.currentTime * 1000, cue.endMs),
        );
      } else if (cue) {
        // No audio or audio not playing — advance from wall clock so
        // draw-only and narration-only segments still move the progress bar.
        const elapsed = (performance.now() - replayStartWallMs) * speedRef.current;
        setReplayProgressMs(
          Math.min(replayStartProgressMs + elapsed, cue.endMs),
        );
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [
    isReplaying,
    isPaused,
    replayProgressMs,
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
