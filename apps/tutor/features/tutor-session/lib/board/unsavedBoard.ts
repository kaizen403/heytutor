/**
 * An honest board: a real board with nothing on it to show was asked a
 * lesson that never saved. It must not look like the home page, which says
 * "ask me anything" over a title that says otherwise.
 *
 * A board row exists only after a question commits it, so a real title with
 * nothing to replay means a lesson was asked and lost. The one exception is
 * the restore fallback for an unknown id, which keeps the title "New board".
 */

export const NEW_BOARD_TITLE = "New board";

/** A stored turn as far as this predicate cares. */
export type UnsavedBoardTurn = {
  question: string;
  /** Segments with ink on the board. Zero for a lesson that died before its first step. */
  segmentCount: number;
};

export type UnsavedBoardInput = {
  isDraft: boolean;
  boardLoaded: boolean;
  title: string;
  /** The board preview: the lesson question, cut to 60 characters by the server. */
  preview: string;
  /** Stored turns on the open page. A turn with segments means there is a board to show. */
  turns: readonly UnsavedBoardTurn[];
  /** A question the client still remembers from this tab, if any. */
  pendingQuestion?: string | null;
};

export type UnsavedBoard = {
  /** The student's exact question, when it was kept. Teach it again sends it. */
  question: string | null;
  /**
   * With a question: the board title, or "" when it adds nothing.
   * Without one: the best topic left (the cut preview, else the title).
   * Teach it again then prefills the composer with it instead of sending.
   */
  title: string;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function isPlaceholderTitle(title: string): boolean {
  const t = clean(title);
  return t === "" || t.toLowerCase() === NEW_BOARD_TITLE.toLowerCase();
}

/** The notice to show instead of the home landing, or null for a normal board. */
export function unsavedLessonBoard(input: UnsavedBoardInput): UnsavedBoard | null {
  if (input.isDraft || !input.boardLoaded) return null;
  if (input.turns.some((turn) => turn.segmentCount > 0)) return null;

  const title = isPlaceholderTitle(input.title) ? null : clean(input.title);
  // The newest kept question wins: a stopped turn with no ink still has its question.
  const keptTurn = [...input.turns].reverse().find((turn) => clean(turn.question) !== "");
  // Trim only: the question is sent again as typed, line breaks and all.
  const exactQuestion = (keptTurn?.question ?? "").trim() || (input.pendingQuestion ?? "").trim();

  if (exactQuestion) {
    const extra = title && title.toLowerCase() !== clean(exactQuestion).toLowerCase() ? title : "";
    return { question: exactQuestion, title: extra };
  }

  // The preview is the question cut short, so it can only prefill, never send.
  const topic = clean(input.preview) || title;
  return topic ? { question: null, title: topic } : null;
}

/**
 * What Teach it again does: send the exact question, or, when only a topic
 * survived, hand the topic to the composer to edit before sending.
 */
export function unsavedNoticeAction(board: UnsavedBoard): { text: string; exact: boolean } {
  const question = (board.question ?? "").trim();
  return question ? { text: board.question as string, exact: true } : { text: board.title, exact: false };
}
