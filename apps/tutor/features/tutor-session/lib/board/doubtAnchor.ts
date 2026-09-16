/**
 * Where the tutor is seen thinking about a doubt.
 *
 * The page stays up while a doubt is thought about, so the wait is shown on
 * it: a small clicker beside the first thing the student marked, or at the row
 * the answer will start on when they only typed.
 */
import { BOARD_HEIGHT, BOARD_WIDTH, TEXT_LAYOUT } from "../../constants";
import type { BoardLayoutState } from "../../types";
import { workColumnRoom } from "./boardLayout";
import type { BoardMark, MarkPoint } from "./boardMarking";

/** Clear of the mark's own highlighter band. */
const BESIDE_MARK_PX = 34;
/** Clear of the board's edge, so the clicker is never clipped. */
const EDGE_PX = 28;
/** Under the last row of a full page, above the board's lower edge. */
const BELOW_FULL_COLUMN_PX = 16;

/** Under the work column: for a doubt that arrived without a place to think. */
export const DOUBT_THINKING_FALLBACK: MarkPoint = {
  x: TEXT_LAYOUT.marginX + BESIDE_MARK_PX,
  y: TEXT_LAYOUT.bottomY + BELOW_FULL_COLUMN_PX,
};

function clampToBoard(point: MarkPoint): MarkPoint {
  return {
    x: Math.min(Math.max(point.x, EDGE_PX), BOARD_WIDTH - EDGE_PX),
    y: Math.min(Math.max(point.y, EDGE_PX), BOARD_HEIGHT - EDGE_PX),
  };
}

export function doubtThinkingAnchor(
  marks: readonly BoardMark[],
  layout: BoardLayoutState,
  diagramActive: boolean,
): MarkPoint {
  const first = marks[0];
  if (first) {
    return clampToBoard({
      x: first.bounds.x + first.bounds.width + BESIDE_MARK_PX,
      y: first.bounds.y + first.bounds.height / 2,
    });
  }
  const { nextRowY } = workColumnRoom(layout, diagramActive);
  const y =
    nextRowY === null
      ? TEXT_LAYOUT.bottomY + BELOW_FULL_COLUMN_PX
      : nextRowY + TEXT_LAYOUT.textHeight / 2;
  return clampToBoard({ x: TEXT_LAYOUT.marginX + BESIDE_MARK_PX, y });
}
