import {
  remainingDeferredAnnotations,
  verifiedDiagramCommandToDrawCommand,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { storedTurnContinuesBoard } from "@/lib/boards/boardContinuation";
import {
  drawLectureTimeline,
  type ExportExecuteCommand,
} from "@/lib/lecture-export/drawLectureTimeline";
import type { ReplayCue } from "@/lib/replay/replayTimeline";

/** Match the live after-turn flush, after both the last cue's ink and speech. */
export async function completeReplayDiagramTurn(options: {
  cue: ReplayCue;
  nextCue?: ReplayCue;
  turn: StoredTurn | undefined;
  diagram: VerifiedDiagram | null;
  executeCommand: ExportExecuteCommand;
  shouldCancel: () => boolean;
  durationScale?: number;
}): Promise<void> {
  const { cue, nextCue, turn, diagram, executeCommand, shouldCancel } = options;
  if (
    shouldCancel() ||
    nextCue?.turnIndex === cue.turnIndex ||
    !turn ||
    storedTurnContinuesBoard(turn) ||
    !diagram ||
    diagram.layout === "code_lesson"
  )
    return;

  // FOCUS has already consumed the parts named during teaching. Only the
  // remaining engine-owned marks are released, in the same order as live.
  for (const command of remainingDeferredAnnotations(diagram)) {
    if (shouldCancel()) return;
    await executeCommand(verifiedDiagramCommandToDrawCommand(command), {
      trustedDiagramGeometry: true,
      applyLayout: false,
      inkPace: "scene",
      isCancelled: shouldCancel,
      durationScale: options.durationScale,
    });
  }
}

/** Replay retains the export clock and cue ordering, adding live completion. */
export async function drawReplayDiagramTimeline(
  options: Parameters<typeof drawLectureTimeline>[0] & {
    getTurn: (turnIndex: number) => StoredTurn | undefined;
    getDiagram: () => VerifiedDiagram | null;
  },
): Promise<void> {
  const { cues } = options;
  for (
    let index = Math.max(0, options.startCueIndex ?? 0);
    index < cues.length;
    index++
  ) {
    if (options.shouldCancel()) return;
    const cue = cues[index]!;
    await drawLectureTimeline({
      ...options,
      cues: [cue],
      startCueIndex: 0,
      onCueStart: () => options.onCueStart?.(cue, index),
    });
    await completeReplayDiagramTurn({
      cue,
      nextCue: cues[index + 1],
      turn: options.getTurn(cue.turnIndex),
      diagram: options.getDiagram(),
      executeCommand: options.executeCommand,
      shouldCancel: options.shouldCancel,
    });
  }
}
