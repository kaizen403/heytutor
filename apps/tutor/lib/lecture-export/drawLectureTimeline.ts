import type { DrawCommand, VerifiedDiagram } from "@heytutor/drawing";
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
import type { ExecuteCommandOptions } from "@/features/tutor-session/hooks/turn/types";
import { drawSegmentInk, planSegmentInk, type SegmentInkClock } from "@/features/tutor-session/lib/turn/segmentInk";
import { advanceExplanationTarget, pointThroughExplanation, type CompletedExplanationTarget } from "@/features/tutor-session/lib/turn/explanationPointing";
import type { ReplayCue } from "@/lib/replay/replayTimeline";

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
  /** The committed figure FOCUS traces resolve against, read per command. */
  getDiagram?: () => VerifiedDiagram | null;
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

    const getDiagram = options.getDiagram ?? (() => null);
    // A physics explanation can use a code-lesson layout and still has to point.
    // The opening figure of a real code walk is trusted geometry on that layout;
    // replay draws one cue at a time, so the TYPE/FRAME beats are not in this list.
    const cueTypesCode = cue.commands.some((command) => command.type === "TYPE" || command.type === "FRAME");
    const hasFocus = cue.commands.some((command) => command.type === "FOCUS");
    const trustedFigure = cue.commands.length > 0 &&
      (cue.trustedDiagramGeometry || isStoredCommandTrustedGeometry(cue.segment.command));
    const codeWalkFigure = getDiagram()?.layout === "code_lesson" && trustedFigure;
    // Untimed export cues, trusted figures and any cue with a FOCUS share the
    // live ink clock, so a focus waits for its word (as on main). A timed work
    // or narration cue without FOCUS keeps its pointing tour.
    const spokenFigure = cue.commands.length > 0 &&
      (!cue.segment.timings || trustedFigure || hasFocus);
    if ((cueTypesCode || codeWalkFigure) && cue.commands.length > 0) {
      await drawCodeLessonExportCue({
        cue, executeCommand, getClockMs, waitForAdvance, shouldCancel, getDiagram,
      });
    } else if (spokenFigure) {
      await drawExportCue({
        cue, executeCommand, getClockMs, waitForAdvance, shouldCancel, getDiagram,
      });
    } else if (!cueTypesCode) {
      // Work rows and narration-only explanations keep the pen moving.
      // A trusted figure uses the shared ink clock above instead.
      await drawWorkExportCue({
        cue, executeCommand, getClockMs, waitForAdvance, shouldCancel, getDiagram: options.getDiagram,
      });
    }

    await waitUntilExportClock(getClockMs, cue.endMs, waitForAdvance, shouldCancel);
  }
}

/**
 * One recorded sentence, drawn by the same engine as the live lesson and the
 * replay (`drawSegmentInk`), on the recording's clock.
 *
 * This used to be its own scheduler. Without a word alignment (always the case
 * for the Sarvam voice) every shape started at 0 ms, so a figure intro's parts
 * were all drawn in the first seconds of the sentence and the board then stood
 * still under the rest of it (17 s to 39 s of a 203 s lesson, 19 Oct 2026).
 * FOCUS also had no schedule and traced at the top of its sentence. Now every
 * cued part waits for its word, estimated across the clip's real length when
 * there is no alignment, and FOCUS traces each part as it is named.
 */
async function drawExportCue(options: {
  cue: ReplayCue;
  executeCommand: ExportExecuteCommand;
  getClockMs: () => number;
  waitForAdvance: () => Promise<void>;
  shouldCancel: () => boolean;
  getDiagram: () => VerifiedDiagram | null;
}): Promise<void> {
  const { cue, executeCommand, getClockMs, waitForAdvance, shouldCancel } = options;
  const narration = cue.narration;
  const durationMs = cue.durationMs;
  const trustedDiagramGeometry =
    cue.trustedDiagramGeometry || isStoredCommandTrustedGeometry(cue.segment.command);
  const plan = planSegmentInk({
    commands: cue.commands,
    verifiedDiagramIntro: trustedDiagramGeometry,
    hasNarration: narration.length > 0,
  });
  // The cue (recorded audio, or its replay estimate) owns speech time.
  // Notation expands when spoken; a fixed per-character rate can place
  // estimated targets after that cue and exhaust the bounded tail.
  const spokenChars = mathToSpeech(narration.trim()).length;
  const getDrawClockMs = createScheduledWriteClock({
    getRawPositionMs: () => Math.max(0, getClockMs() - cue.startMs),
    nowMs: getClockMs,
  });
  // The export clock only moves when the encoder pumps it, so a wait is a
  // wait for the next pump, never wall-time polling.
  const waitUntilMs = async (targetMs: number, getTargetMs?: () => number): Promise<void> => {
    while (!shouldCancel() && getDrawClockMs() + 10 < (getTargetMs?.() ?? targetMs)) {
      await waitForAdvance();
    }
  };

  await drawSegmentInk({
    plan,
    verifiedDiagramIntro: trustedDiagramGeometry,
    clock: {
      narration,
      getTimings: () => cue.segment.timings,
      totalSpeechMs: narration ? durationMs : Math.max(plan.totalDrawWeight, 200),
      estimatedSpeechMs: durationMs,
      // Without an alignment, cue words are estimated across the clip's
      // real length rather than the default speaking rate.
      msPerChar: !cue.segment.timings && spokenChars > 0 ? durationMs / spokenChars : undefined,
      getAudioPositionMs: getDrawClockMs,
      // The board's time source is this media clock.
      getPlaybackRate: () => 1,
      nowMs: getClockMs,
      // No isSpeechComplete: a figure part still drawing when its sentence
      // ends keeps its pace in the file (the next cue waits for it) instead
      // of landing instantly.
      canAdvanceAfterSpeech: () => true,
      waitUntilMs,
    },
    getDiagram: options.getDiagram,
    isCancelled: shouldCancel,
    waitWhilePaused: async () => !shouldCancel(),
    execute: executeCommand,
    commandOptions: () => ({
      applyLayout: false,
      isCancelled: shouldCancel,
      trustedDiagramGeometry,
    }),
  });
}

/**
 * A code lesson keeps the export scheduler its walk-through was tuned on: the
 * code panel is drawn from lecture time and its FRAME and TYPE beats settle
 * on this clock. The live runner's spoken walks would run them past the
 * bounded export tail.
 */
async function drawCodeLessonExportCue(options: {
  cue: ReplayCue;
  executeCommand: ExportExecuteCommand;
  getClockMs: () => number;
  waitForAdvance: () => Promise<void>;
  shouldCancel: () => boolean;
  getDiagram?: () => VerifiedDiagram | null;
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

/** Work and narration-only cues: point through the explanation on the export clock. */
async function drawWorkExportCue(options: {
  cue: ReplayCue;
  executeCommand: ExportExecuteCommand;
  getClockMs: () => number;
  waitForAdvance: () => Promise<void>;
  shouldCancel: () => boolean;
  getDiagram?: () => VerifiedDiagram | null;
}): Promise<void> {
  const { cue, executeCommand, getClockMs, waitForAdvance, shouldCancel } = options;
  const segmentCommands = cue.commands;
  // Keep the authored gesture's target for its whole spoken sentence.
  const canPointAtWork = !segmentCommands.some(command => command.type === "FOCUS" || command.type === "POINT");
  let completedTarget: CompletedExplanationTarget | null = null;
  const executeAuthored: ExportExecuteCommand = async (command, commandOptions) => {
    const diagram = options.getDiagram?.() ?? null;
    await executeCommand(command, commandOptions);
    completedTarget = advanceExplanationTarget(completedTarget, command, diagram === options.getDiagram?.() ? diagram : null);
  };
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
      await executeAuthored(command, {
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

    await executeAuthored(command, {
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
  if (!trustedDiagramGeometry && (canPointAtWork || completedTarget)) {
    await pointThroughExplanation({ clock: speechClock, execute: executeCommand, isCancelled: shouldCancel,
      ...(completedTarget ? { completedTarget, getDiagram: options.getDiagram } : {}) });
  }
}
