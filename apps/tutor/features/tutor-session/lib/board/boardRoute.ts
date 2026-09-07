/**
 * Board URLs. A lesson only claims `/c/{id}` once it exists; the home board at
 * `/` is a real, usable board that has simply not been written down yet.
 */

const BOARD_PREFIX = "/c/";

export function boardPath(boardId: string): string {
  return `${BOARD_PREFIX}${encodeURIComponent(boardId)}`;
}

/** `null` for `/` (and anything else): no saved board is being addressed. */
export function boardIdFromPathname(pathname: string | null | undefined): string | null {
  if (!pathname?.startsWith(BOARD_PREFIX)) return null;
  const [segment = ""] = pathname.slice(BOARD_PREFIX.length).split("/");
  if (!segment) return null;
  try {
    return decodeURIComponent(segment) || null;
  } catch {
    return segment;
  }
}

/**
 * Route to a fresh home board. A question rides along in `?q=` so the board it
 * lands on submits it the moment the whiteboard is ready.
 */
export function draftBoardPath(question = ""): string {
  const trimmed = question.trim();
  return trimmed ? `/?q=${encodeURIComponent(trimmed)}` : "/";
}

/** Ids are minted client-side so the home board can teach before it is saved. */
export function createDraftBoardId(): string {
  return crypto.randomUUID();
}
