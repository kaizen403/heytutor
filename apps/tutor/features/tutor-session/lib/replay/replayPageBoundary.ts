import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { storedTurnContinuesBoard } from "@/lib/boards/boardContinuation";

/** Runtime page ownership, separate from narrated or stored CLEAR commands. */
export async function resetReplayPageAtTurn(options: {
  turn: StoredTurn | undefined;
  previousTurnIndex: number;
  turnIndex: number;
  whiteboard: WhiteboardHandle | null;
  resetBoardLayout: (keepHeading?: boolean, forceSequentialWorkLayout?: boolean) => void;
  shouldCancel: () => boolean;
  capturePreviousPage?: () => unknown;
}): Promise<boolean> {
  if (options.shouldCancel()) return false;
  if (options.previousTurnIndex < 0 || options.previousTurnIndex === options.turnIndex ||
    !options.turn || storedTurnContinuesBoard(options.turn)) return true;
  options.capturePreviousPage?.();
  if (options.shouldCancel()) return false;
  await options.whiteboard?.clearBoard();
  if (options.shouldCancel()) return false;
  options.resetBoardLayout(false, false);
  return true;
}
