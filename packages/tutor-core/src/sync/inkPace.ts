import type { DrawCommand } from "@heytutor/drawing";

/**
 * Engine-owned ink pace. The teaching LLM never chooses this — it is derived
 * from command type and whether the marks are verified scene setup vs work-area
 * teaching. Independent of Watch overlay playback rate (1.5× etc.).
 *
 * - `follow`: student must track the pen (formulas, substitutions, FOCUS traces,
 *   and every diagram label — a name the student has to read is not scenery).
 * - `scene`: student should see a figure, not a stroke-by-stroke performance
 *   (verified diagram bodies, compound setup, decorative geometry).
 *
 * Structure and naming are paced apart on purpose: the body of a figure can
 * appear quickly because it is one thing seen at once, while each label is read
 * word by word alongside the explanation of what it marks.
 */
export type InkPace = "follow" | "scene";

export interface InkPaceContext {
  /** Scene-engine verified diagram intro / geometry reveal, not work-area WRITE. */
  verifiedDiagramIntro?: boolean;
  /**
   * This mark is the construction being explained in the current speech window
   * (a small reveal, not a compound figure dump). Fit to speech via the usual
   * budget, at followable pace.
   */
  explainedInSpeechWindow?: boolean;
  /** Commands in this reveal batch. Large batches are compound figures. */
  batchCommandCount?: number;
}

const TEXT_TYPES = new Set<DrawCommand["type"]>(["WRITE", "LABEL", "DIMENSION"]);
const COMPOUND_SCENE_BATCH = 4;

/** Scene geometry is a visible reveal, not handwriting. */
export const SCENE_DURATION_SCALE = 0.22;
export const SCENE_MIN_MS = 70;
export const SCENE_MAX_MS = 320;
export const SCENE_FLIGHT_MIN_MS = 30;
export const SCENE_FLIGHT_MAX_MS = 90;
export const SCENE_WRITE_MS_PER_CHAR = 12;
export const SCENE_WRITE_MIN_MS = 70;
export const SCENE_WRITE_MAX_MS = 280;
/** FOCUS traces stay followable but slightly quicker than a full formula WRITE. */
export const FOLLOW_FOCUS_SCALE = 0.78;
/** Cap total setup ink so a train / busy body cannot stall the lecture. */
export const MAX_SCENE_BATCH_MS = 1300;

export const FOLLOW_ADAPTIVE_MIN = 0.85;
export const FOLLOW_ADAPTIVE_MAX = 1.2;
export const SCENE_ADAPTIVE_MIN = 0.5;
export const SCENE_ADAPTIVE_MAX = 2.0;
export const FOLLOW_LIVE_INK_SPEED_CAP = 1.2;
export const SCENE_LIVE_INK_SPEED_CAP = 2.4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Choose pedagogical pace. Runtime-owned: no speed field on DrawCommand, and
 * teaching-stream DRAW_* is not a speed signal.
 */
export function selectInkPace(
  command: DrawCommand,
  context: InkPaceContext = {},
): InkPace {
  if (
    command.type === "PAUSE" ||
    command.type === "CLEAR" ||
    command.type === "ERASE"
  ) {
    return "follow";
  }

  const batch = context.batchCommandCount ?? 1;
  const compoundIntro =
    context.verifiedDiagramIntro === true && batch >= COMPOUND_SCENE_BATCH;

  // Teaching FOCUS: follow the existing geometry. Setup traces inside a busy
  // intro batch are part of the figure, not a lesson follow-along.
  if (
    command.type === "FOCUS" ||
    command.type === "EMPHASIZE" ||
    command.type === "SUPERSEDE" ||
    command.type === "ANNOTATE"
  ) {
    return compoundIntro ? "scene" : "follow";
  }

  if (context.verifiedDiagramIntro === true) {
    // A label or dimension is read, not watched. Even inside a compound intro
    // it keeps handwriting pace so the naming lands with the words explaining
    // it, while the geometry around it still reveals quickly.
    if (TEXT_TYPES.has(command.type)) {
      return "follow";
    }
    if (context.explainedInSpeechWindow === true && !compoundIntro) {
      return "follow";
    }
    return "scene";
  }

  if (TEXT_TYPES.has(command.type)) {
    return "follow";
  }

  return "follow";
}

export function inkPaceContextForSegment(options: {
  verifiedDiagramIntro: boolean;
  commandCount: number;
  hasNarration: boolean;
}): InkPaceContext {
  return {
    verifiedDiagramIntro: options.verifiedDiagramIntro,
    batchCommandCount: options.commandCount,
    explainedInSpeechWindow:
      options.verifiedDiagramIntro &&
      options.commandCount <= 2 &&
      options.hasNarration,
  };
}

export function applySceneDuration(baseMs: number): number {
  return clamp(Math.round(baseMs * SCENE_DURATION_SCALE), SCENE_MIN_MS, SCENE_MAX_MS);
}

export function applySceneFlight(baseMs: number): number {
  return clamp(Math.round(baseMs * SCENE_DURATION_SCALE), SCENE_FLIGHT_MIN_MS, SCENE_FLIGHT_MAX_MS);
}

export function capSceneBatchDurations(
  durationsMs: number[],
  maxMs: number = MAX_SCENE_BATCH_MS,
): number[] {
  const total = durationsMs.reduce((sum, value) => sum + value, 0);
  if (total <= maxMs) {
    return durationsMs;
  }
  const scale = maxMs / total;
  const scaled = durationsMs.map((value) => Math.max(Math.round(value * scale), 50));
  const scaledTotal = scaled.reduce((sum, value) => sum + value, 0);
  if (scaledTotal <= maxMs || scaled.length === 0) {
    return scaled;
  }
  const overflow = scaledTotal - maxMs;
  const last = scaled.length - 1;
  scaled[last] = Math.max((scaled[last] ?? 50) - overflow, 50);
  return scaled;
}

/** Catch-up still applies, but follow pace cannot sprint formula ink. */
export function clampAdaptiveInkFactor(factor: number, pace: InkPace): number {
  if (pace === "scene") {
    return clamp(factor, SCENE_ADAPTIVE_MIN, SCENE_ADAPTIVE_MAX);
  }
  return clamp(factor, FOLLOW_ADAPTIVE_MIN, FOLLOW_ADAPTIVE_MAX);
}

export function liveInkSpeedCap(pace: InkPace): number {
  return pace === "scene" ? SCENE_LIVE_INK_SPEED_CAP : FOLLOW_LIVE_INK_SPEED_CAP;
}

export function effectiveWhiteboardInkSpeed(
  userSpeed: number,
  adaptiveFactor: number,
  pace: InkPace,
): number {
  const factor = clampAdaptiveInkFactor(adaptiveFactor, pace);
  const cap = liveInkSpeedCap(pace);
  return clamp(userSpeed * factor, 0.4, cap);
}
