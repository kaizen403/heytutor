import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { storedTurnContinuesBoard } from "@/lib/boards/boardContinuation";
import { closeDoubtPageForNotes, type DoubtPageNotes } from "../board/doubtPage";

/** Runtime page ownership, separate from narrated or stored CLEAR commands. */
export async function resetReplayPageAtTurn(options: {
  turn: StoredTurn | undefined;
  previousTurnIndex: number;
  turnIndex: number;
  whiteboard: WhiteboardHandle | null;
  resetBoardLayout: (keepHeading?: boolean, forceSequentialWorkLayout?: boolean) => void;
  shouldCancel: () => boolean;
  capturePreviousPage?: () => unknown;
  /**
   * The surface's notes epoch (restore). A doubt page left up with the
   * lesson's page held is captured, then the lesson's page, before the clear
   * drops it (review round 3 M2), as `beginBoardEpoch` does live.
   */
  notes?: DoubtPageNotes | null;
}): Promise<boolean> {
  if (options.shouldCancel()) return false;
  if (options.previousTurnIndex < 0 || options.previousTurnIndex === options.turnIndex ||
    !options.turn || storedTurnContinuesBoard(options.turn)) return true;
  // doubt-page-restore-notes:begin
  if (!(options.notes && closeDoubtPageForNotes(options.whiteboard, options.notes))) options.capturePreviousPage?.();
  // doubt-page-restore-notes:end
  if (options.shouldCancel()) return false;
  await options.whiteboard?.clearBoard();
  if (options.shouldCancel()) return false;
  options.resetBoardLayout(false, false);
  return true;
}
