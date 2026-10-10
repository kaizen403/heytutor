/**
 * Whether the lesson on screen is safely stored. The progressive save
 * produces it; the header chip and the error banner only render it.
 */
export type SaveStatus =
  /** Nothing to save yet, or nothing has changed. */
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  /** The browser is offline; the save retries when it reconnects. */
  | { kind: "offline" }
  /** Retries stopped. `retry` sends the unsaved part again without teaching again. */
  | { kind: "failed"; message: string };

export const IDLE_SAVE: SaveStatus = { kind: "idle" };
