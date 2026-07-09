import type { DrawCommand } from "@heytutor/drawing";

export type TutorPhase = "idle" | "planning" | "thinking" | "drawing" | "speaking";

export interface SegmentPlanStats {
  activeTemplateId: string | null;
  activeTemplateName: string | null;
  plannedSegmentCount: number;
  introSegmentCount: number;
  llmSegmentCount: number;
  blockedTemplateDrawCommands: number;
  droppedTemplateRedrawSegments: number;
}

export interface BoardTextRect {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  commandIndex?: number;
}

export interface BoardLayoutState {
  rects: BoardTextRect[];
  nextY: number;
}

export interface BoardViewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface StatusDisplay {
  color: string;
  label: string;
  dotClass: string;
  labelColor: string;
}

/** Base draw budget for geometric commands — the adaptive function scales these. */
export const BASE_SHAPE_DRAW_MS: Partial<Record<DrawCommand["type"], number>> = {
  DRAW_CIRCLE: 1050,
  DRAW_LINE: 420,
  DRAW_RECT: 850,
  DRAW_CUBE: 1100,
  DRAW_CUBOID: 1200,
  UNDERLINE: 350,
  CIRCLE_AROUND: 700,
  ARROW: 500,
  HIGHLIGHT: 250,
  SCRIBBLE: 400,
};

function clampBudget(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Adaptive shape draw budget. When a speech window is available, the shape is
 * paced to fill the narration window (scaled by the speed factor) instead of
 * using a fixed duration. Falls back to the base table otherwise.
 *
 * A lone DRAW_CIRCLE in a segment with 3s of narration now takes ~3s (scaled)
 * instead of the fixed 1050ms — keeping ink and voice in sync.
 */
export function adaptiveShapeBudget(
  commandType: DrawCommand["type"],
  speechWindowMs?: number,
  speedFactor: number = 1,
): number {
  const baseMs = BASE_SHAPE_DRAW_MS[commandType] ?? 800;
  const effectiveSpeed = Math.max(speedFactor, 0.4);
  if (speechWindowMs && speechWindowMs > 100) {
    // Fit to the speech window, scaled by speed — but never shorter than 200ms
    // or longer than 2x the base, so a single shape doesn't drag or sprint.
    return clampBudget(speechWindowMs / effectiveSpeed, 200, baseMs * 2);
  }
  return Math.max(Math.round(baseMs / effectiveSpeed), 150);
}
