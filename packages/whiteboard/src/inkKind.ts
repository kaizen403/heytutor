import { DIAGRAM_ZONE } from "@heytutor/drawing";

/** Konva attr that marks whether a node is work-column ink or figure ink. */
export const BOARD_INK_ATTR = "htInk";

/**
 * `"pin"` is a kept FOCUS ring: it is drawn round a figure part but belongs
 * to the page, so a work column page turn takes it away with the work while
 * the figure itself stays.
 */
export type BoardInkKind = "work" | "scene" | "pin";

/**
 * Work rows start in the left column. Figure labels and geometry start at or
 * past the diagram zone. Overflowing work glyphs keep the kind of the row they
 * belong to, not the x they spilled into — otherwise a page-turn erase that
 * stops at the column edge leaves the spilled tails on the board.
 */
export function boardInkKindAt(x: number): BoardInkKind {
  return x < DIAGRAM_ZONE.x ? "work" : "scene";
}
