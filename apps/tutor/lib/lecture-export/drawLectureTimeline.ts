import type { DrawCommand } from "@heytutor/drawing";
import {
  capSceneBatchDurations,
  isCuedSceneBatch,
  catchUpWriteScheduleOffsets,
  createScheduledWriteClock,
  getBestWriteCharScheduleMs,
  getCommandDrawDurationMs,
  getCommandSpeechWindow,
  inkPaceContextForSegment,
  leadWriteScheduleToSpeech,
  mathToSpeech,
  selectInkPace,
} from "@heytutor/tutor-core";
import { isStoredCommandTrustedGeometry } from "@heytutor/drawing";
import type { ReplayCue } from "@/lib/replay/replayTimeline";
import type { ExecuteCommandOptions } from "@/features/tutor-session/hooks/turn/types";
import type { SegmentInkClock } from "@/features/tutor-session/lib/turn/segmentInk";
import { pointThroughExplanation } from "@/features/tutor-session/lib/turn/explanationPointing";

export type ExportExecuteCommand = (
  command: DrawCommand,
  options?: ExecuteCommandOptions,
) => Promise<void>;

export async function waitUntilExportClock(
  getNowMs: () => number,
  targetMs: number,
  waitForAdvance: () => Promise<void>,
  shouldCancel: () => boolean,
): Promise<void> {
  while (!shouldCancel() && getNowMs() + 10 < targetMs) {
    await waitForAdvance();
  }
}

export async function drawLectureTimeline(options: {
  cues: ReplayCue[];
  executeCommand: ExportExecuteCommand;
  getClockMs: () => number;
  waitForAdvance: () => Promise<void>;
  shouldCancel: () => boolean;
  setAnimationSpeed?: (rate: number) => void;
  /** Cues before this one are already on the board. */
  startCueIndex?: number;
  /** Runs as each cue begins, before it draws. */
  onCueStart?: (cue: ReplayCue, index: number) => void;
}): Promise<void> {
  const { cues, executeCommand, getClockMs, waitForAdvance, shouldCancel } = options;

  for (let index = Math.max(0, options.startCueIndex ?? 0); index < cues.length; index++) {
    const cue = cues[index]!;
    if (shouldCancel()) {
      return;
    }

    await waitUntilExportClock(getClockMs, cue.startMs, waitForAdvance, shouldCancel);
    if (shouldCancel()) {
      return;
    }

    options.onCueStart?.(cue, index);
    options.setAnimationSpeed?.(1);

    await drawExportCue({ cue, executeCommand, getClockMs, waitForAdvance, shouldCancel });

    await waitUntilExportClock(getClockMs, cue.endMs, waitForAdvance, shouldCancel);
  }
}

async function drawExportCue(options: {
  cue: ReplayCue;
  executeCommand: ExportExecuteCommand;
  getClockMs: () => number;
  waitForAdvance: () => Promise<void>;
  shouldCancel: () => boolean;
}): Promise<void> {
  const { cue, executeCommand, getClockMs, waitForAdvance, shouldCancel } = options;
  const segmentCommands = cue.commands;
  // Keep the authored gesture's target for its whole spoken sentence.
  const canPointAtWork = !segmentCommands.some(command => command.type === "FOCUS" || command.type === "POINT");
  const narration = cue.narration;
  const paceContext = inkPaceContextForSegment({
    verifiedDiagramIntro: cue.trustedDiagramGeometry,
    commandCount: segmentCommands.length,
    hasNarration: narration.length > 0,
  });
  const commandPaces = segmentCommands.map((command) => selectInkPace(command, paceContext));
  const pacedDurations = segmentCommands.map((command, index) =>
    getCommandDrawDurationMs(command, commandPaces[index]),
  );
  const sceneBatch = commandPaces.filter((pace) => pace === "scene").length >= 4;
  const sceneDurations = sceneBatch
    ? capSceneBatchDurations(pacedDurations, undefined, { cued: isCuedSceneBatch(segmentCommands) })
    : null;
  const totalDrawWeight = pacedDurations.reduce((sum, ms) => sum + ms, 0);
  const durationMs = cue.durationMs;
  // The cue (recorded audio, or its replay estimate) owns speech time.
  // Notation expands when spoken; a fixed per-character rate can place
  // estimated WRITE targets after that cue and exhaust the bounded tail.
  const spokenLength = mathToSpeech(narration.trim()).length;
  const estimatedSpeechMsPerChar = spokenLength > 0 ? durationMs / spokenLength : undefined;
  const trustedDiagramGeometry =
    cue.trustedDiagramGeometry || isStoredCommandTrustedGeometry(cue.segment.command);

  const getDrawClockMs = createScheduledWriteClock({
    getRawPositionMs: () => Math.max(0, getClockMs() - cue.startMs),
    nowMs: getClockMs,
  });

  const speechClock: SegmentInkClock = {
    narration, getTimings: () => cue.segment.timings,
    totalSpeechMs: durationMs, estimatedSpeechMs: durationMs,
    msPerChar: estimatedSpeechMsPerChar,
    getAudioPositionMs: getDrawClockMs,
    // The virtual board already advances in media time, including pause/rate.
    getPlaybackRate: () => 1,
    nowMs: getClockMs,
    isSpeechComplete: () => getDrawClockMs() >= durationMs,
  };
  let textCommandIndex = 0;
  for (let commandIndex = 0; commandIndex < segmentCommands.length; commandIndex++) {
    if (shouldCancel()) {
      return;
    }
    const command = segmentCommands[commandIndex]!;
    const pace = commandPaces[commandIndex]!;
    const isTextCommand =
      command.type === "WRITE" || command.type === "LABEL" || command.type === "TYPE";
    const scheduleWorkWrite =
      isTextCommand &&
      command.type !== "TYPE" &&
      Boolean(narration) &&
      !(trustedDiagramGeometry && command.type === "LABEL");
    const writePlan = scheduleWorkWrite
      ? getBestWriteCharScheduleMs(
          narration,
          command,
          cue.segment.timings,
          durationMs,
          textCommandIndex,
          estimatedSpeechMsPerChar,
        )
      : null;

    if (writePlan && writePlan.offsetsMs.length > 0) {
      const audioPosAtScheduleMs = Math.round(getDrawClockMs());
      const effectiveOffsets = catchUpWriteScheduleOffsets(
        leadWriteScheduleToSpeech(writePlan.offsetsMs, audioPosAtScheduleMs, writePlan.maxInitialWaitMs),
        audioPosAtScheduleMs,
      );
      await executeCommand(command, {
        applyLayout: false,
        isCancelled: shouldCancel,
        trustedDiagramGeometry,
        inkPace: pace,
        ...(command.type === "WRITE" && !trustedDiagramGeometry && canPointAtWork ? { explanationClock: speechClock } : {}),
        writeSchedule: {
          charStartOffsetsMs: effectiveOffsets,
          charDurationsMs: writePlan.charDurationsMs,
          getAudioPositionMs: getDrawClockMs,
        },
      });
      if (isTextCommand) {
        textCommandIndex += 1;
      }
      continue;
    }

    const speechWindow =
      narration && cue.segment.timings
        ? getCommandSpeechWindow(narration, command, cue.segment.timings, textCommandIndex)
        : {
            startMs: 0,
            durationMs,
            matched: false,
          };

    if (speechWindow.startMs > 0) {
      if (!trustedDiagramGeometry && canPointAtWork) {
        await pointThroughExplanation({ clock: speechClock, execute: executeCommand, isCancelled: shouldCancel, beforeWriteMs: speechWindow.startMs });
        if (shouldCancel()) return;
      }
      await waitUntilExportClock(
        getDrawClockMs,
        speechWindow.startMs,
        waitForAdvance,
        shouldCancel,
      );
    }
    if (shouldCancel()) {
      return;
    }

    const commandWeight = pacedDurations[commandIndex] ?? getCommandDrawDurationMs(command, pace);
    const commandBudgetMs = sceneDurations
      ? sceneDurations[commandIndex] ?? commandWeight
      : totalDrawWeight > 0
        ? Math.max(Math.round(durationMs * (commandWeight / totalDrawWeight)), 50)
        : Math.max(Math.round(speechWindow.durationMs), 50);

    await executeCommand(command, {
      applyLayout: false,
      isCancelled: shouldCancel,
      speechDurationMs: commandBudgetMs,
      trustedDiagramGeometry,
      inkPace: pace,
      // A standalone authored POINT already identifies its verified target.
      // Keep it there through its recording instead of falling back to work.
      ...(command.type === "POINT" && commandIndex === segmentCommands.length - 1 ? {
        segmentNarration: narration,
        spokenClock: {
          narration, getTimings: speechClock.getTimings,
          estimatedTotalMs: durationMs, getAudioPositionMs: getDrawClockMs,
          getPlaybackRate: speechClock.getPlaybackRate,
          isSpeechComplete: speechClock.isSpeechComplete,
          msPerChar: estimatedSpeechMsPerChar,
        },
      } : {}),
    });
    if (isTextCommand) {
      textCommandIndex += 1;
    }
  }
  if (!trustedDiagramGeometry && canPointAtWork) {
    await pointThroughExplanation({ clock: speechClock, execute: executeCommand, isCancelled: shouldCancel });
  }
}
