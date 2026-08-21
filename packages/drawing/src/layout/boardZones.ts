/** Shared whiteboard layout zones (1200×700 canvas). Runtime owns placement — not the LLM. */
export const BOARD_CANVAS = { width: 1200, height: 700 } as const;

export const WORK_ZONE = {
  x: 70,
  y: 126,
  width: 330,
  height: 520,
  marginX: 90,
  topY: 145,
  lineHeight: 54,
} as const;

export const SECOND_WORK_ZONE = {
  marginX: 500,
  topY: 145,
  maxWidth: 380,
  lineHeight: 54,
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
