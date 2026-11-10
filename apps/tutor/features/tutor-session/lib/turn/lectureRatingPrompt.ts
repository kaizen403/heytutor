/**
 * When the board asks the student to rate the lecture. Pure: the hook feeds it
 * the tab's newest turn and what was already asked, and renders what it says.
 *
 * Twice at most per turn. `during` is a lesson's own turn while it plays, once
 * it has taught for a while; a Continue is not asked midway, it was already
 * asked as the lesson it continues. `after` is any lesson or Continue turn that
 * has ended (finished, or stopped by the student) and taught at least a step.
 * Doubt answers are never rated.
 */
import type { LectureRatingMoment } from "@/lib/lecture-rating/ratingInput";
import type { TurnKind, TurnStatus } from "@/lib/boards/turnStatus";

/** Teaching time, from the first finished step, before the midway question. */
export const DURING_PROMPT_AFTER_MS = 60_000;
/** An untouched midway question leaves after this. */
export const DURING_PROMPT_VISIBLE_MS = 25_000;
/** The thank-you line stays this long before the card closes. */
export const RATING_THANKS_MS = 1_800;
/** Waits before resending a rating the server could not take for now. */
export const RATING_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000];

export interface RatingPromptTurn {
  turnId: string;
  kind: TurnKind;
  status: TurnStatus;
  /** At least one finished step. */
  taught: boolean;
}

export interface LectureRatingPromptInput {
  turn: RatingPromptTurn | null;
  /** A lesson is playing in this tab (not a replay). */
  lecturing: boolean;
  /** The turn has taught for `DURING_PROMPT_AFTER_MS`. */
  duringDue: boolean;
  /** `ratingPromptKey`s already answered, dismissed or timed out. */
  asked: ReadonlySet<string>;
}

export function ratingPromptKey(turnId: string, moment: LectureRatingMoment): string {
  return `${turnId}:${moment}`;
}

/** The turn's midway clock should run: a lesson that is playing and has taught a step. */
export function duringClockRuns(turn: RatingPromptTurn | null, lecturing: boolean): boolean {
  return Boolean(turn && lecturing && turn.kind === "lesson" && turn.status === "live" && turn.taught);
}

export function lectureRatingPrompt(input: LectureRatingPromptInput): LectureRatingMoment | null {
  const { turn, lecturing, duringDue, asked } = input;
  if (!turn || turn.kind === "doubt" || !turn.taught) return null;
  if (lecturing) {
    if (!duringDue || !duringClockRuns(turn, lecturing)) return null;
    return asked.has(ratingPromptKey(turn.turnId, "during")) ? null : "during";
  }
  if (turn.status === "live") return null;
  return asked.has(ratingPromptKey(turn.turnId, "after")) ? null : "after";
}

/** A low-churn snapshot of the registry's turn, so a new step never re-renders the shell. */
export function ratingTurnSnapshot(turn: (Omit<RatingPromptTurn, "taught"> & { saved: boolean; steps: number }) | null): string {
  if (!turn) return "";
  return [turn.turnId, turn.kind, turn.status, turn.saved ? "1" : "0", turn.steps > 0 ? "1" : "0"].join("|");
}

export function parseRatingTurnSnapshot(snapshot: string): (RatingPromptTurn & { saved: boolean }) | null {
  if (!snapshot) return null;
  const [turnId, kind, status, saved, taught] = snapshot.split("|");
  if (!turnId || !kind || !status) return null;
  return {
    turnId,
    kind: kind as TurnKind,
    status: status as TurnStatus,
    saved: saved === "1",
    taught: taught === "1",
  };
}
