import { isStoredCommandTrustedGeometry, type DrawCommand, type VerifiedDiagram } from "@heytutor/drawing";
import { createScheduledWriteClock, mathToSpeech } from "@heytutor/tutor-core";
import type { ExecuteCommandOptions } from "@/features/tutor-session/hooks/turn/types";
import { drawSegmentInk, planSegmentInk } from "@/features/tutor-session/lib/turn/segmentInk";
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
  getDiagram?: () => VerifiedDiagram | null;
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

    if (cue.commands.length > 0) {
      await drawExportCue({
        cue,
        executeCommand,
        getClockMs,
        getDiagram: options.getDiagram,
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
  getDiagram?: () => VerifiedDiagram | null;
  waitForAdvance: () => Promise<void>;
  shouldCancel: () => boolean;
}): Promise<void> {
  const { cue, executeCommand, getClockMs, waitForAdvance, shouldCancel } = options;
  const narration = cue.narration;
  const trustedDiagramGeometry =
    cue.trustedDiagramGeometry || isStoredCommandTrustedGeometry(cue.segment.command);
  const codeLesson = options.getDiagram?.()?.layout === "code_lesson";
  const plan = planSegmentInk({
    commands: cue.commands,
    verifiedDiagramIntro: trustedDiagramGeometry,
    hasNarration: narration.length > 0,
    sceneText: codeLesson,
  });
  const spokenLength = mathToSpeech(narration.trim()).length;
  const getDrawClockMs = createScheduledWriteClock({
    getRawPositionMs: () => Math.max(0, getClockMs() - cue.startMs),
    nowMs: getClockMs,
  });

  // Export and the finished player use the live lesson's cue words, spoken
  // order and FOCUS deadlines. A separate loop used to draw the whole figure
  // at the start, then hold the board while its voice continued.
  await drawSegmentInk({
    plan,
    verifiedDiagramIntro: trustedDiagramGeometry,
    clock: {
      narration,
      getTimings: () => cue.segment.timings,
      totalSpeechMs: cue.durationMs,
      estimatedSpeechMs: cue.durationMs,
      msPerChar: spokenLength > 0 ? cue.durationMs / spokenLength : undefined,
      getAudioPositionMs: getDrawClockMs,
      getPlaybackRate: () => 1,
      nowMs: getClockMs,
      waitForAdvance,
      ...(codeLesson ? { isSpeechComplete: () => getClockMs() >= cue.endMs } : {}),
    },
    getDiagram: options.getDiagram ?? (() => null),
    isCancelled: shouldCancel,
    waitWhilePaused: async () => !shouldCancel(),
    execute: executeCommand,
    commandOptions: () => ({ applyLayout: false, trustedDiagramGeometry, isCancelled: shouldCancel }),
  });
}
