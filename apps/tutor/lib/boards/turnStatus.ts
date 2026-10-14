/**
 * Where a saved turn stands. Pure, so the server routes and the browser read
 * the same rules.
 *
 * A lesson is saved while it is taught. `live` means a tab is still sending it,
 * `stopped` means it ended early (Stop, an error, out of credits, a closed tab)
 * and `complete` means it played to its end. Turns saved before progressive
 * saving existed are all `complete`.
 */

export type TurnStatus = "live" | "stopped" | "complete";
export type TurnKind = "lesson" | "doubt" | "resume";

export const TURN_STATUSES: readonly TurnStatus[] = ["live", "stopped", "complete"];
export const TURN_KINDS: readonly TurnKind[] = ["lesson", "doubt", "resume"];

/**
 * A live turn whose tab has not checkpointed for this long is reported as
 * stopped: the tab closed or crashed without its close reaching the server.
 */
export const LIVE_TURN_IDLE_MS = 120_000;

const STATUS_RANK: Record<TurnStatus, number> = { live: 0, stopped: 1, complete: 2 };

export function isTurnStatus(value: unknown): value is TurnStatus {
  return typeof value === "string" && (TURN_STATUSES as readonly string[]).includes(value);
}

export function isTurnKind(value: unknown): value is TurnKind {
  return typeof value === "string" && (TURN_KINDS as readonly string[]).includes(value);
}

/**
 * Completion needs recorded teaching, not only generated text or a page reset.
 * Audio is optional: a muted lesson may retain narration or written work.
 * This is an integrity check on already-canonical rows, not command validation.
 */
export function hasMeaningfulTurnSegments(rows: readonly {
  narration?: string; spokenText?: string; command?: unknown;
}[]): boolean {
  return rows.some(row => {
    if (row.narration?.trim() || row.spokenText?.trim()) return true;
    const stored = row.command;
    if (!stored || typeof stored !== "object") return false;
    const commands = "commands" in stored && Array.isArray(stored.commands) ? stored.commands : [stored];
    return commands.some((command: unknown) => command !== null && typeof command === "object" &&
      "type" in command && (command.type === "WRITE" || command.type === "TYPE") &&
      "text" in command && typeof command.text === "string" && Boolean(command.text.trim()));
  });
}

/**
 * Status only moves forward: live, then stopped, then complete. A late live
 * checkpoint after a close still saves its rows but cannot reopen the turn, and
 * a complete turn is final.
 */
export function nextTurnStatus(current: TurnStatus, requested: TurnStatus): TurnStatus {
  return STATUS_RANK[requested] > STATUS_RANK[current] ? requested : current;
}

/** The status a reader should act on: a live turn left idle reads as stopped. */
export function effectiveTurnStatus(
  status: unknown,
  updatedAt: Date | number | null | undefined,
  now: number = Date.now(),
): TurnStatus {
  const stored = isTurnStatus(status) ? status : "complete";
  if (stored !== "live") return stored;
  const updated = updatedAt instanceof Date ? updatedAt.getTime() : updatedAt;
  if (typeof updated !== "number" || !Number.isFinite(updated)) return "stopped";
  return now - updated > LIVE_TURN_IDLE_MS ? "stopped" : "live";
}
