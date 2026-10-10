import {
  remainingDeferredAnnotations,
  verifiedDiagramCommandToDrawCommand,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import { storedTurnStatus, type StoredTurn } from "@/lib/boards/boardsClient";
import { boardContinuationOf, storedTurnContinuesBoard } from "@/lib/boards/boardContinuation";
import { deepEqual } from "../scene/diagramGeneration";
import { restoreVerifiedDiagramFromTurn } from "../scene/restoreVerifiedDiagram";
import {
  drawLectureTimeline,
  type ExportExecuteCommand,
} from "@/lib/lecture-export/drawLectureTimeline";
import type { ReplayCue } from "@/lib/replay/replayTimeline";

// Completion writes only engine-owned diagram marks, never narrated WRITE
// schedules. Both live and export executors accept this narrower option set.
type CompleteDiagramExecuteCommand = (
  command: Parameters<ExportExecuteCommand>[0],
  options?: Pick<NonNullable<Parameters<ExportExecuteCommand>[1]>, "durationScale" | "trustedDiagramGeometry" | "applyLayout" | "inkPace" | "isCancelled">,
) => Promise<void>;

/** A resume may finish only the source-checked figure its own page opened. */
function compatibleCompletedResume(turn: StoredTurn, pageTurns: readonly StoredTurn[] | undefined): boolean {
  if (turn.kind !== "resume" || !pageTurns || pageTurns.length < 2) return false;
  const opening = pageTurns[0]!;
  if (pageTurns.at(-1)?.id !== turn.id || storedTurnContinuesBoard(opening) ||
    opening.visualStatus !== "validated" || !opening.sceneDocument || !restoreVerifiedDiagramFromTurn(opening)) return false;
  const question = opening.question.trim();
  return pageTurns.slice(1).every((entry) =>
    storedTurnContinuesBoard(entry) && boardContinuationOf(entry.sceneArtifacts)?.lessonQuestion === question &&
    (entry.kind !== "resume" || entry.question.trim() === question) &&
    entry.visualStatus !== "retry_required" &&
    (!entry.sceneDocument || (entry.visualStatus === "validated" && deepEqual(entry.sceneDocument, opening.sceneDocument) &&
      restoreVerifiedDiagramFromTurn(entry) !== null)),
  );
}

/** Restore the live final figure only for a turn that actually completed. */
export async function completeStoredTurnDiagram(options: {
  turn: StoredTurn | undefined;
  diagram: VerifiedDiagram | null;
  /** Opening turn through this turn; required for a completed resume. */
  pageTurns?: readonly StoredTurn[];
  executeCommand: CompleteDiagramExecuteCommand;
  shouldCancel: () => boolean;
  durationScale?: number;
}): Promise<void> {
  const { turn, diagram, executeCommand, shouldCancel } = options;
  if (
    shouldCancel() ||
    !turn ||
    storedTurnStatus(turn) !== "complete" ||
    !diagram ||
    diagram.layout === "code_lesson" ||
    (storedTurnContinuesBoard(turn) && !compatibleCompletedResume(turn, options.pageTurns))
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

/** Match the live after-turn flush, after both the last cue's ink and speech. */
export async function completeReplayDiagramTurn(options: Parameters<typeof completeStoredTurnDiagram>[0] & {
  cue: ReplayCue;
  nextCue?: ReplayCue;
}): Promise<void> {
  if (options.nextCue?.turnIndex === options.cue.turnIndex) return;
  await completeStoredTurnDiagram(options);
}

/** Replay retains the export clock and cue ordering, adding live completion. */
export async function drawReplayDiagramTimeline(
  options: Parameters<typeof drawLectureTimeline>[0] & {
    getTurn: (turnIndex: number) => StoredTurn | undefined;
    getDiagram: () => VerifiedDiagram | null;
    getPageTurns?: (turnIndex: number) => readonly StoredTurn[];
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
    // The finished lecture's voice is one stitched track with no gap between
    // turns, so the marks land instantly: animating them would push the next
    // turn's ink behind its own voice.
    await completeReplayDiagramTurn({
      cue,
      nextCue: cues[index + 1],
      turn: options.getTurn(cue.turnIndex),
      diagram: options.getDiagram(),
      pageTurns: options.getPageTurns?.(cue.turnIndex),
      executeCommand: options.executeCommand,
      shouldCancel: options.shouldCancel,
      durationScale: 0,
    });
  }
}
