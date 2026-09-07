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
