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

/**
 * Which board is on screen.
 *
 * A lesson claims `/c/{id}` with `replaceState`, so Next often keeps reporting
 * that lecture after New board. The fresh draft stays up until the student
 * opens some other board, or until Next's route actually names the draft.
 */
export function resolveSessionBoard(input: {
  routeBoardId: string | null;
  draftBoardId: string;
  /** Lecture New board just left. The router may still be naming it. */
  abandonedRouteId: string | null;
  /** A board the student picked from the list, before the route catches up. */
  chosenBoardId: string | null;
}): { sessionId: string; isDraft: boolean } {
  if (input.chosenBoardId) {
    return {
      sessionId: input.chosenBoardId,
      isDraft: input.chosenBoardId === input.draftBoardId,
    };
  }
  if (input.routeBoardId === null) {
    return { sessionId: input.draftBoardId, isDraft: true };
  }
  if (input.routeBoardId === input.draftBoardId) {
    return { sessionId: input.draftBoardId, isDraft: false };
  }
  if (input.abandonedRouteId !== null && input.routeBoardId === input.abandonedRouteId) {
    return { sessionId: input.draftBoardId, isDraft: true };
  }
  return { sessionId: input.routeBoardId, isDraft: false };
}

/** A generated lesson title, as opposed to the placeholder on an empty board. */
export function boardTitleNamesLesson(title: string | null | undefined): boolean {
  const normalized = title?.trim().toLowerCase() ?? "";
  return normalized.length > 0 && normalized !== "new board";
}

/**
 * New board is a no-op only on a home board nobody has asked yet. A lesson
 * stopped before its turn was saved still has a title and still counts.
 */
export function isUntouchedHomeBoard(input: {
  isDraft: boolean;
  storedTurnsCount: number;
  inputInteracted: boolean;
  phaseIsIdle: boolean;
  question?: string;
  boardTitle?: string | null;
}): boolean {
  if (!input.isDraft) return false;
  if (input.storedTurnsCount > 0) return false;
  if (input.inputInteracted) return false;
  if (!input.phaseIsIdle) return false;
  if ((input.question ?? "").trim()) return false;
  if (boardTitleNamesLesson(input.boardTitle)) return false;
  return true;
}
