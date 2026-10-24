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

/**
 * The local playback of a generated clip stopped: its clock froze, it ran
 * past every deadline, or the media element failed. Not a provider refusal
 * or a broken stream (a budget skip, a socket error), which keep their
 * existing stop paths, including the code lesson's Continue offer.
 */
export function isLocalPlaybackFailure(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  return (
    error.message.startsWith("tts segment playback stalled") ||
    error.message.startsWith("tts segment timeout") ||
    error.message.startsWith("Native audio playback clock did not advance") ||
    error.message.startsWith("HTML audio playback failed")
  );
}

/**
 * Local playback failed after the student already heard part of the sentence.
 *
 * A frozen clip (v3 p4e1-t2: a fully local Sarvam WAV stopped at 1.63 s of
 * 8.7 s, then the next at 5.9 s of 9.9 s) used to fail its segment, and two
 * in a row cancelled the whole lesson at 142 s. The sentence was generated
 * and partly heard; its board work is still right. The segment finishes its
 * ink and text, and the failure never counts toward `shouldAbandonTurn`.
 *
 * Not for a voice nobody heard (zero clock), a browser recovery voice, a
 * failed provider retry, a draw failure that silenced the voice, a provider
 * failure, or a cancelled turn: those keep their existing failure paths.
 */
export function shouldFinishSegmentAfterHeardSpeechFailure(input: {
  error: unknown;
  heardPositionMs: number;
  browserFallback: boolean;
  providerRecoveryAttempted: boolean;
  speechAborted: boolean;
  cancelled: boolean;
}): boolean {
  return isLocalPlaybackFailure(input.error) &&
    Number.isFinite(input.heardPositionMs) && input.heardPositionMs > 0 &&
    !input.browserFallback && !input.providerRecoveryAttempted && !input.speechAborted && !input.cancelled;
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
