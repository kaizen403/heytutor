/**
 * A turn that continues the page the previous turn left.
 *
 * A question takes a fresh page: the runtime draws a CLEAR first
 * (`beginBoardEpoch`), and `withBoardEpochSegment` persists that CLEAR as the
 * turn's first segment, so replay, restore, rewind, notes and export all treat
 * each turn as its own page.
 *
 * A doubt does not. The student circled a line and asked about it, so the answer
 * is written under that line, on the same page, beside the same figure. Such a
 * turn is persisted without the CLEAR and carries this marker in its scene
 * artifacts. Every surface that rebuilds the board reads the marker and keeps
 * the page, its figure and its code panel across that turn instead of starting
 * over. The marker alone is not enough: a turn that still opens on a CLEAR
 * starts a page whatever its artifacts say.
 */
import { parseStoredSegmentCommands } from "@heytutor/drawing";
import type { StoredTurn } from "./boardsClient";

export const BOARD_CONTINUATION_VERSION = "board-continuation/v1";

export interface BoardContinuation {
  schemaVersion: typeof BOARD_CONTINUATION_VERSION;
  /** The question whose page this turn continues. */
  lessonQuestion: string;
}

/** Long enough for any stem a student pastes; the column is not a dump. */
const MAX_LESSON_QUESTION_CHARS = 4_000;

type ContinuationTurn = Pick<StoredTurn, "sceneArtifacts" | "segments">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Scene artifacts for a turn saved onto the page `lessonQuestion` opened. */
export function boardContinuationArtifacts(
  lessonQuestion: string,
): { boardContinuation: BoardContinuation } {
  return {
    boardContinuation: {
      schemaVersion: BOARD_CONTINUATION_VERSION,
      lessonQuestion: lessonQuestion.trim().slice(0, MAX_LESSON_QUESTION_CHARS),
    },
  };
}

/** The marker, validated, or null. Tolerates any other artifacts beside it. */
export function boardContinuationOf(sceneArtifacts: unknown): BoardContinuation | null {
  if (!isRecord(sceneArtifacts)) return null;
  const raw = sceneArtifacts.boardContinuation;
  if (!isRecord(raw) || raw.schemaVersion !== BOARD_CONTINUATION_VERSION) return null;
  if (typeof raw.lessonQuestion !== "string") return null;
  return {
    schemaVersion: BOARD_CONTINUATION_VERSION,
    lessonQuestion: raw.lessonQuestion.trim().slice(0, MAX_LESSON_QUESTION_CHARS),
  };
}

function opensOnBoardClear(segments: ContinuationTurn["segments"]): boolean {
  let first: ContinuationTurn["segments"][number] | null = null;
  for (const segment of segments) {
    if (!first || segment.orderIndex < first.orderIndex) first = segment;
  }
  if (!first) return false;
  const commands = parseStoredSegmentCommands(first.command);
  return commands.length === 1 && commands[0]?.type === "CLEAR";
}

/** True when this stored turn was drawn on the page the turn before it left. */
export function storedTurnContinuesBoard(turn: ContinuationTurn): boolean {
  return boardContinuationOf(turn.sceneArtifacts) !== null && !opensOnBoardClear(turn.segments);
}

/**
 * The question the page this turn was drawn on belongs to. A doubt is saved
 * under its own title, but its page, its notes and any later doubt on it belong
 * to the lesson it was asked about.
 */
export function storedTurnPageQuestion(
  turn: Pick<StoredTurn, "question" | "sceneArtifacts" | "segments">,
): string {
  if (!storedTurnContinuesBoard(turn)) return turn.question;
  return boardContinuationOf(turn.sceneArtifacts)?.lessonQuestion || turn.question;
}

/**
 * Every turn that drew the page `turns[index]` ends on, oldest first: the turn
 * that opened the page and each doubt that continued it. `turns` must be in
 * board order.
 */
export function pageTurnsEndingAt<T extends ContinuationTurn>(
  turns: readonly T[],
  index: number = turns.length - 1,
): T[] {
  if (index < 0 || index >= turns.length) return [];
  let start = index;
  while (start > 0 && storedTurnContinuesBoard(turns[start]!)) {
    start -= 1;
  }
  return turns.slice(start, index + 1);
}
