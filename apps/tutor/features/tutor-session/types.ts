import type { DrawCommand } from "@heytutor/drawing";

export type TutorPhase = "idle" | "thinking" | "drawing" | "speaking";

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

/** Fixed draw budget for geometric commands — independent of TTS length. */
export const FIXED_SHAPE_DRAW_MS: Partial<Record<DrawCommand["type"], number>> = {
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
