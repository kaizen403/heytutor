/**
 * One terminal event for every started turn.
 *
 * Lab drivers and analytics wait for `[tutor:turn] turn complete` or
 * `[tutor:turn] turn failed`. A turn that left early (a solver contradiction,
 * a billing refusal, a newer turn, an exception thrown while planning) used to
 * log neither, so a driver waited 25 minutes on a turn that had already ended
 * (v3 p2c-t2). The live handler runs its body inside one wrapper whose
 * `finally` settles this record, so no exit can skip it.
 */
export interface TurnTerminalRecord {
  /** Set once the turn is submitted; queued or refused asks are not turns. */
  started: boolean;
  /** A terminal line has been written for this turn. */
  ended: boolean;
  /** Why the turn stopped early, set at the exit that knows. */
  reason: string | null;
  generation: number | null;
}

export type TurnTerminalLog = (event: "turn failed", details: Record<string, unknown>) => void;

export function createTurnTerminalRecord(): TurnTerminalRecord {
  return { started: false, ended: false, reason: null, generation: null };
}

const records = new WeakMap<object, TurnTerminalRecord>();

/**
 * The record of the turn run with this owner (the live handler's save exit
 * object, one per Ask). The body and the wrapper that settles it share it
 * without another parameter.
 */
export function turnTerminalRecordFor(owner: object): TurnTerminalRecord {
  let record = records.get(owner);
  if (!record) {
    record = createTurnTerminalRecord();
    records.set(owner, record);
  }
  return record;
}

export function markTurnStarted(record: TurnTerminalRecord, generation: number): void {
  record.started = true;
  record.generation = generation;
}

/** The first reason recorded wins: it names the exit that ended the turn. */
export function markTurnExitReason(record: TurnTerminalRecord, reason: string): void {
  record.reason ??= reason;
}

/** The normal `turn complete` line was written. */
export function markTurnCompleted(record: TurnTerminalRecord): void {
  record.ended = true;
}

/**
 * Called from the wrapper's `finally`. Writes `turn failed {reason}` exactly
 * once for a started turn that has no terminal line yet, and reports whether
 * it did.
 */
export function settleTurnTerminalRecord(
  record: TurnTerminalRecord,
  outcome: { threw: boolean; cancelled?: boolean; inferredReason?: string | null },
  log: TurnTerminalLog,
): boolean {
  if (!record.started || record.ended) return false;
  record.ended = true;
  const reason = record.reason ??
    (outcome.threw ? (outcome.cancelled ? "cancelled" : "uncaught_error") : null) ??
    outcome.inferredReason ?? "returned_without_terminal_event";
  log("turn failed", { reason, generation: record.generation });
  return true;
}
