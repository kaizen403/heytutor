import { BOARD_TYPE_SCALE } from "./boardTypography";

/** Shared whiteboard layout zones (1200×700 canvas). Runtime owns placement — not the LLM. */
export const BOARD_CANVAS = { width: 1200, height: 700 } as const;

export const WORK_ZONE = {
  x: 70,
  y: 126,
  width: 330,
  height: 520,
  marginX: 90,
  topY: 145,
  lineHeight: 66,
  /**
   * Work-row handwriting size. Runtime-owned, never the teaching model's, and
   * shared so anything composing a board line can measure against the size it
   * will actually be drawn at. `boardTypography` owns the number; this is the
   * name the layout code already knows it by.
   */
  fontSize: BOARD_TYPE_SCALE.work,
  /**
   * Work-row size while a figure holds the right of the board. The column is
   * only 282px there, which fits about fifteen characters at the full size — so
   * trimming per row would leave the column ragged. One smaller size for the
   * whole figure-bearing turn is steadier, and a row that still does not fit is
   * wrapped at this size rather than shrunk below it.
   */
  narrowFontSize: BOARD_TYPE_SCALE.workNarrow,
  /**
   * Widest a work row may be drawn when a figure holds the right of the board:
   * the diagram zone starts at x 400, less a 28px gutter, from marginX 90.
   * `writeText` draws whatever string it is handed at whatever size, so a row
   * has to arrive already fitted — the runtime wraps to this width rather than
   * letting a long line run through the figure.
   */
  maxTextWidth: 282,
  /** With no figure the column has the whole board, less both margins. */
  fullWidthTextWidth: 1020,
} as const;

export const SECOND_WORK_ZONE = {
  marginX: 500,
  topY: 145,
  maxWidth: 380,
  lineHeight: 72,
} as const;

export const DIAGRAM_ZONE = {
  x: 400,
  y: 140,
  // Extends to the right board edge so diagrams (and their right-hand labels)
  // can sit fully in the right half, leaving the left half for the solution.
  width: 760,
  height: 380,
  centerX: 780,
  centerY: 300,
} as const;

export function isInDiagramZone(x: number, y: number): boolean {
  return (
    x >= DIAGRAM_ZONE.x &&
    x <= DIAGRAM_ZONE.x + DIAGRAM_ZONE.width &&
    y >= DIAGRAM_ZONE.y &&
    y <= DIAGRAM_ZONE.y + DIAGRAM_ZONE.height
  );
}

export function clampToDiagramZone(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, DIAGRAM_ZONE.x + 8), DIAGRAM_ZONE.x + DIAGRAM_ZONE.width - 8),
    y: Math.min(Math.max(y, DIAGRAM_ZONE.y + 8), DIAGRAM_ZONE.y + DIAGRAM_ZONE.height - 8),
  };
}
