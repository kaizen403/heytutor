import type { DrawCommand } from "@heytutor/drawing";
import type { CodeLessonPlan } from "@heytutor/tutor-core";

/**
 * What a turn does when its visuals stop working.
 *
 * A segment speaks and draws at the same time, and the two are separate
 * promises. If the draw side throws, `Promise.all` rejects — but the speech
 * promise is already in flight and keeps playing, and the per-segment catch in
 * the queue logs the failure and moves to the next segment. The result is a
 * tutor narrating a whole lesson at a board that stopped moving, which is what
 * the owner saw: audio continuing, timeline frozen at 0:19, one figure drawn
 * and an empty code panel.
 *
 * The cause that time was external — a concurrently-edited module failed to
 * compile and took the session's React tree down mid-lesson — but the
 * behaviour is wrong whatever the cause. Silence is honest; talking over a
 * dead board is not.
 */

/**
 * Consecutive segment failures tolerated before the turn gives up.
 *
 * One is worth riding out: a single command can throw for a transient reason
 * and the next segment recovers. Two in a row means the drawing pipeline
 * itself is gone, and every further segment would speak into nothing.
 */
export const MAX_CONSECUTIVE_SEGMENT_FAILURES = 2;

export function shouldAbandonTurn(consecutiveFailures: number): boolean {
  return consecutiveFailures >= MAX_CONSECUTIVE_SEGMENT_FAILURES;
}

export const INCOMPLETE_CODE_BEAT_MESSAGE = "This code block did not finish. Continue the lesson to finish it.";

/** The current admitted TYPE lost required characters, so later blocks cannot follow it. */
export class IncompleteCodeBeatError extends Error {
  constructor(readonly blockId: string, readonly intendedChars: number, readonly shownChars: number, cause: unknown) {
    super(INCOMPLETE_CODE_BEAT_MESSAGE, { cause });
    this.name = "IncompleteCodeBeatError";
  }
}

export interface CodeBeatTarget { blockId: string; intendedChars: number }

/** Capture this segment's validated targets before asynchronous speech or drawing starts. */
export function requiredCodeBeatTargets(
  commands: readonly DrawCommand[],
  plan: CodeLessonPlan | null | undefined,
): CodeBeatTarget[] {
  if (!plan) return [];
  const targets: CodeBeatTarget[] = [];
  const blocks = plan.sections.flatMap((section) => section.blocks);
  for (const command of commands) {
    if (command.type !== "TYPE") continue;
    const block = blocks.find((candidate) => candidate.id === command.semanticRef?.entityId);
    if (!block || command.text !== block.code) continue;
    const intended = command.shownChars === undefined ? block.code.length
      : Number.isSafeInteger(command.shownChars) ? Math.max(0, Math.min(block.code.length, command.shownChars)) : 0;
    if (intended > 0) targets.push({ blockId: block.id, intendedChars: intended });
  }
  return targets;
}

/** A failed beat may stop the lesson only for one of its own still-owed targets. */
export function incompleteCodeBeatFailure(
  targets: readonly CodeBeatTarget[],
  revealedChars: Readonly<Record<string, number>>,
  cause: unknown,
): IncompleteCodeBeatError | null {
  for (const target of targets) {
    const shown = revealedChars[target.blockId] ?? 0;
    if (shown < target.intendedChars) return new IncompleteCodeBeatError(target.blockId, target.intendedChars, shown, cause);
  }
  return null;
}

/**
 * The browser cancelled the fetch. That is the student leaving, or this turn
 * aborting a request, not a deadline. A message that also says the attempt
 * timed out is a deadline and still fails the turn.
 */
export function isBenignTurnAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError") return false;
  if (/timed out|timeout|deadline/i.test(error.message)) return false;
  return error.name === "AbortError" || /\babort(?:ed|ing)?\b/i.test(error.message);
}

/**
 * The voice never became audible. Distinct from a draw failure: the figure
 * already inked inside the intro transaction is still good, and cancelling
 * the turn here erases it and skips every later sentence.
 */
export function isVoiceStartupFailure(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  return (
    error.message.startsWith("The voice could not start") ||
    error.message.startsWith("tts segment timeout")
  );
}

/**
 * What a sentence does once its voice has failed for good (the provider gave
 * no audio and browser speech failed too).
 *
 * A voice is not the board. Production lessons on 20 to 23 Oct 2026 ended with
 * "The lesson could not continue playing" because two silent sentences in a
 * row counted as two failed segments, while every draw was healthy. So the
 * sentence is taught silently: its ink plays on the estimated schedule and the
 * lesson moves on, and the next sentence asks the voice again.
 *
 * - `quiet`: the turn was stopped or replaced; nothing is reported.
 * - `fail`: the draw itself failed, or the one bounded provider retry after a
 *   browser restart failed. The beat fails and still counts toward
 *   `shouldAbandonTurn`. A code beat that still owes TYPE characters also
 *   fails, as before: its own recovery stops on the exact typed prefix and
 *   offers Continue (`incompleteCodeBeatFailure`), not the dead end message.
 * - `teach_silently`: every other voice failure.
 */
export type VoiceFailureDisposition = "quiet" | "fail" | "teach_silently";

/** What a completed beat tells the queue. Absent for an ordinary spoken beat. */
export interface SegmentRunOutcome {
  /** Taught with its ink and no voice. Never counts toward `shouldAbandonTurn`. */
  voiceDegraded: true;
}

export function voiceFailureDisposition(input: {
  cancelled: boolean;
  drawFailed: boolean;
  providerRecoveryAttempted: boolean;
  /** This beat types code the lesson plan requires. */
  codeBeatOwed?: boolean;
}): VoiceFailureDisposition {
  if (input.cancelled) return "quiet";
  if (input.drawFailed || input.providerRecoveryAttempted || input.codeBeatOwed) return "fail";
  return "teach_silently";
}

/**
 * How much longer a silently taught sentence holds the board: the estimated
 * spoken length at the live rate, less the time already spent on it since its
 * silent clock started. Never negative.
 */
export function silentSentenceRemainingMs(input: {
  estimateSpeechMs: number;
  playbackRate: number;
  elapsedMs: number;
}): number {
  const rate = Number.isFinite(input.playbackRate) && input.playbackRate > 0 ? input.playbackRate : 1;
  const total = Number.isFinite(input.estimateSpeechMs) ? Math.max(input.estimateSpeechMs, 0) / rate : 0;
  const elapsed = Number.isFinite(input.elapsedMs) ? Math.max(input.elapsedMs, 0) : 0;
  return Math.max(total - elapsed, 0);
}

/**
 * Pair a draw promise with the voice narrating it: if the draw fails, silence
 * the speech before propagating. The rejection still reaches the caller, so
 * the queue can count it toward `shouldAbandonTurn`.
 *
 * `onDrawFailed` must be safe to call more than once and must not throw — a
 * failure inside the failure handler would mask the original error.
 */
export function guardDrawWithSpeech<T>(
  draw: Promise<T>,
  onDrawFailed: (error: unknown) => void,
): Promise<T> {
  return draw.catch((error: unknown) => {
    try {
      onDrawFailed(error);
    } catch {
      // Swallowed on purpose: the draw error below is the one worth reporting.
    }
    throw error;
  });
}
