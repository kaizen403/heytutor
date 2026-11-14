/**
 * Why a planner request was cut off. `superseded`: a peer lane already won, or
 * the search was discarded. `deadline`: the request's or the search's own
 * budget ran out. `turn_cancelled`: the caller's signal, which in the live hook
 * is the turn (Stop, a newer question, or a failed turn).
 */
export type PlannerAbortReason = "superseded" | "deadline" | "turn_cancelled";

const PLANNER_ABORT_PREFIX = "planner-abort:";

/** An AbortError naming its cause. fetch rejects with it, so AbortError checks still hold. */
export function plannerAbort(reason: PlannerAbortReason): DOMException {
  return new DOMException(`${PLANNER_ABORT_PREFIX}${reason}`, "AbortError");
}

/** The named cause of an aborted signal; an unnamed abort came from the caller. */
export function plannerAbortReason(signal: AbortSignal | undefined): PlannerAbortReason | null {
  if (!signal?.aborted) return null;
  const reason: unknown = signal.reason;
  if (reason instanceof DOMException && reason.message.startsWith(PLANNER_ABORT_PREFIX)) {
    const named = reason.message.slice(PLANNER_ABORT_PREFIX.length);
    if (named === "superseded" || named === "deadline" || named === "turn_cancelled") return named;
  }
  return "turn_cancelled";
}
