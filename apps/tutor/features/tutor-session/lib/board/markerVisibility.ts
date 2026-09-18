/**
 * How visible the marker is, decided in one place.
 *
 * The board's `cursorState` is a small enum with a big consequence: `idle` is
 * opacity 0, so anything that maps a live teaching phase onto it takes the
 * marker off the board while the tutor is still talking. That mapping used to
 * be an inline ternary in `TutorSessionShell`, which is exactly the kind of
 * thing that gets one more branch added to it and quietly starts hiding the
 * pen mid-lesson.
 *
 * So it lives here, as a pure function, with a gate on it
 * (`verify-marker-visibility.ts`). The rule the gate holds is the one the
 * student actually cares about: **while the tutor is speaking or drawing, the
 * marker is on the board.** Not faint, not mid-fade, not briefly missing
 * between two commands. On the board.
 *
 * `idle` is reserved for the two moments when there is deliberately nothing to
 * watch: before the first teaching token of a turn, where a full-board overlay
 * covers the paper, and after a turn has finished. Even then the board fades
 * rather than switches, so the marker is set down rather than deleted.
 */

import type { CursorState } from "@heytutor/whiteboard";
import type { TutorPhase } from "../../types";

/** The phases in which the student is watching a lesson happen. */
export const TEACHING_PHASES: readonly TutorPhase[] = ["speaking", "drawing"];

export function isTeachingPhase(phase: TutorPhase): boolean {
  return TEACHING_PHASES.includes(phase);
}

/**
 * Whether the pending clicker is over the paper. Planning and the wait for the
 * first teaching token both put it there, and the marker stays down underneath
 * so its contact shadow and its fidget are not playing on covered paper.
 */
export function isWaitingToTeach(phase: TutorPhase): boolean {
  return phase === "planning" || phase === "thinking";
}

export interface MarkerVisibilityInput {
  phase: TutorPhase;
  /** A saved lecture being played back rather than taught live. */
  isReplaying: boolean;
}

/**
 * The board's cursor state for a phase.
 *
 * While teaching the answer is `thinking`, which is a live marker the board is
 * free to move imperatively. It is deliberately not `drawing`: `drawing` is a
 * React prop the board re-reads, and mapping a live turn onto it froze the pen
 * the moment TTS started.
 */
export function markerCursorState({ phase, isReplaying }: MarkerVisibilityInput): CursorState {
  if (isReplaying) return "drawing";
  if (phase === "idle") return "idle";
  if (isWaitingToTeach(phase)) return "idle";
  return "thinking";
}

/**
 * Is the marker on the board for this phase?
 *
 * The single assertion the gate is built around, stated once so the shell, the
 * gate and anyone reading either can only be looking at the same rule.
 */
export function markerIsOnBoard(input: MarkerVisibilityInput): boolean {
  return markerCursorState(input) !== "idle";
}

export interface RewindMarkerInput {
  /** The rewind overlay is up at all. */
  active: boolean;
  /** Playback is held, so nothing is moving and nothing is being said. */
  paused: boolean;
}

/**
 * The same rule for the rewind overlay, which is a second board the student
 * watches a recorded lecture on.
 *
 * It used to derive its state from the *recorded* phase, so any beat of the
 * played-back lecture that was not speaking or drawing took the marker off
 * that board too. Playback is playback: while it runs the marker is on the
 * board, and it is only down when the overlay is closed or held.
 */
export function rewindMarkerCursorState({ active, paused }: RewindMarkerInput): CursorState {
  if (!active || paused) return "idle";
  return "drawing";
}
