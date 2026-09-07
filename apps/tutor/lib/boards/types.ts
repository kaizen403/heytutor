export interface BoardEntry {
  id: string;
  title: string;
  createdAt: number;
  preview: string;
  /**
   * When the student pinned it; pinned boards sort above the rest. Optional so
   * an existing fixture or an older cached row is still a valid BoardEntry:
   * absent and null both mean "not pinned".
   */
  pinnedAt?: number | null;
  /** When the student archived it. Archived boards leave the default list. */
  archivedAt?: number | null;
}

export function isPinned(board: BoardEntry): boolean {
  return board.pinnedAt != null;
}

export function isArchived(board: BoardEntry): boolean {
  return board.archivedAt != null;
}

/** Pin state for an optimistic update, without waiting for a refetch. */
export function withPinned(board: BoardEntry, pinned: boolean): BoardEntry {
  return { ...board, pinnedAt: pinned ? (board.pinnedAt ?? Date.now()) : null };
}

/** Archive state for an optimistic update. */
export function withArchived(board: BoardEntry, archived: boolean): BoardEntry {
  return { ...board, archivedAt: archived ? (board.archivedAt ?? Date.now()) : null };
}

/**
 * Pinned first, newest pin on top, then everything else newest first. The
 * server sorts too; this keeps an optimistic local update in the right place
 * without waiting for a refetch.
 */
export function sortBoards(boards: BoardEntry[]): BoardEntry[] {
  return [...boards].sort((a, b) => {
    if ((a.pinnedAt == null) !== (b.pinnedAt == null)) return a.pinnedAt == null ? 1 : -1;
    if (a.pinnedAt != null && b.pinnedAt != null && a.pinnedAt !== b.pinnedAt) {
      return b.pinnedAt - a.pinnedAt;
    }
    return b.createdAt - a.createdAt;
  });
}
