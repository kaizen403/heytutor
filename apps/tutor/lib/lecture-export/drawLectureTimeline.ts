import type { DrawCommand } from "@heytutor/drawing";
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
  type InkPace,
} from "@heytutor/tutor-core";
import { isStoredCommandTrustedGeometry } from "@heytutor/drawing";
import type { WriteSchedule } from "@heytutor/whiteboard";
import type { ReplayCue } from "@/lib/replay/replayTimeline";

export type ExportExecuteCommand = (
  command: DrawCommand,
  options?: {
    durationScale?: number;
    speechDurationMs?: number;
    writeSchedule?: WriteSchedule;
    applyLayout?: boolean;
    trustedDiagramGeometry?: boolean;
    isCancelled?: () => boolean;
    inkPace?: InkPace;
  },
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
}): Promise<void> {
  const { cues, executeCommand, getClockMs, waitForAdvance, shouldCancel } = options;

  for (const cue of cues) {
    if (shouldCancel()) {
      return;
    }

    await waitUntilExportClock(getClockMs, cue.startMs, waitForAdvance, shouldCancel);
    if (shouldCancel()) {
      return;
    }

    options.setAnimationSpeed?.(1);

    if (cue.commands.length > 0) {
      await drawExportCue({
        cue,
        executeCommand,
        getClockMs,
        waitForAdvance,
        shouldCancel,
      });
    }

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
  const sceneDurations = sceneBatch ? capSceneBatchDurations(pacedDurations) : null;
  const totalDrawWeight = pacedDurations.reduce((sum, ms) => sum + ms, 0);
  const durationMs = cue.durationMs;
  const trustedDiagramGeometry =
    cue.trustedDiagramGeometry || isStoredCommandTrustedGeometry(cue.segment.command);

  const getDrawClockMs = createScheduledWriteClock({
    getRawPositionMs: () => Math.max(0, getClockMs() - cue.startMs),
    nowMs: getClockMs,
  });

  let textCommandIndex = 0;
  for (let commandIndex = 0; commandIndex < segmentCommands.length; commandIndex++) {
    if (shouldCancel()) {
      return;
    }
    const command = segmentCommands[commandIndex]!;
    const pace = commandPaces[commandIndex]!;
    const isTextCommand = command.type === "WRITE" || command.type === "LABEL";
    const scheduleWorkWrite =
      isTextCommand &&
      Boolean(narration) &&
      !(trustedDiagramGeometry && command.type === "LABEL");
    const writePlan = scheduleWorkWrite
      ? getBestWriteCharScheduleMs(
          narration,
          command,
          cue.segment.timings,
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
      await executeCommand(command, {
        applyLayout: false,
        isCancelled: shouldCancel,
        trustedDiagramGeometry,
        inkPace: pace,
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
    });
    if (isTextCommand) {
      textCommandIndex += 1;
    }
  }
}
