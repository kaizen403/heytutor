import type { DrawCommand } from "@heytutor/drawing";
import { SCENE_DURATION_SCALE, type InkPace } from "@heytutor/tutor-core";

export type TutorPhase = "idle" | "planning" | "thinking" | "drawing" | "speaking";

export interface SegmentPlanStats {
  activeDiagramId: string | null;
  activeDiagramName: string | null;
  plannedSegmentCount: number;
  introSegmentCount: number;
  llmSegmentCount: number;
  blockedUnverifiedDrawCommands: number;
  droppedMarkerOnlySegments: number;
}

export interface BoardTextRect {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  commandIndex?: number;
  workIndex?: number;
  workId?: string;
}

export interface BoardLayoutState {
  rects: BoardTextRect[];
  nextY: number;
}

export interface BoardViewport {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** False until the board container has a real size (fit mode). */
  measured: boolean;
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
  FOCUS: 900,
  EMPHASIZE: 420,
  SUPERSEDE: 400,
  ANNOTATE: 700,
  SCRIBBLE: 400,
};

function clampBudget(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Adaptive shape draw budget. Follow pace fills the narration window when one
 * exists (a lone DRAW_CIRCLE in a 3s cue takes ~3s). Scene pace stays a fast
 * reveal and does not stretch a train / body across the whole sentence.
 */
export function adaptiveShapeBudget(
  commandType: DrawCommand["type"],
  speechWindowMs?: number,
  speedFactor: number = 1,
  pace: InkPace = "follow",
): number {
  const baseMs = BASE_SHAPE_DRAW_MS[commandType] ?? 800;
  const pacedBase =
    pace === "scene" ? Math.max(Math.round(baseMs * SCENE_DURATION_SCALE), 70) : baseMs;
  const effectiveSpeed = Math.max(speedFactor, 0.4);
  if (speechWindowMs && speechWindowMs > 100) {
    if (pace === "scene") {
      return clampBudget(speechWindowMs / effectiveSpeed, 70, pacedBase);
    }
    // Fit to the speech window, scaled by speed — but never shorter than 200ms
    // or longer than 2x the base, so a single shape doesn't drag or sprint.
    return clampBudget(speechWindowMs / effectiveSpeed, 200, pacedBase * 2);
  }
  return Math.max(Math.round(pacedBase / effectiveSpeed), pace === "scene" ? 70 : 150);
}

/** Live ink budget for one command. Scene batches stay capped; follow fits speech. */
export function resolveCommandInkBudgetMs(input: {
  command: DrawCommand;
  pace: InkPace;
  verifiedDiagramIntro: boolean;
  isTextCommand: boolean;
  speechWindowMs?: number;
  commandSpeechMs: number;
  naturalDrawMs: number;
  multiShapeSegment: boolean;
  sceneBatchDurationMs?: number;
}): number {
  if (input.verifiedDiagramIntro && input.pace === "scene") {
    return input.sceneBatchDurationMs ?? input.naturalDrawMs;
  }
  if (input.verifiedDiagramIntro && input.pace === "follow") {
    return adaptiveShapeBudget(input.command.type, input.speechWindowMs, 1, input.pace);
  }
  if (input.isTextCommand) {
    return input.speechWindowMs ?? input.naturalDrawMs;
  }
  if (input.command.type === "PAUSE") {
    return input.commandSpeechMs;
  }
  if (input.speechWindowMs) {
    return adaptiveShapeBudget(input.command.type, input.speechWindowMs, 1, input.pace);
  }
  if (input.multiShapeSegment) {
    return Math.max(input.commandSpeechMs, 50);
  }
  return adaptiveShapeBudget(input.command.type, undefined, 1, input.pace);
}
