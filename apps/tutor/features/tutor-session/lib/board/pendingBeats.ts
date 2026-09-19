/**
 * Quiet names for the wait, in the same lowercase the board already uses
 * ("loading the board", "preparing the lecture"). They cycle under the pen.
 */

export const LESSON_PENDING_BEATS = [
  "thinking",
  "planning the lecture",
  "planning the diagram",
  "planning the scene",
  "preparing the lecture",
] as const;

export const PENDING_BEAT_MS = 2800;
