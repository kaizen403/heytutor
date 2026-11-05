/**
 * A figure saved with its plan is checked against the whole question, so a
 * new question gets a figure only up to this size, counted with runs of
 * whitespace as one space. Past it the lesson still teaches, as text. A
 * question already saved on its turn keeps its figure when the turn saves
 * again, so a board saved before this size existed still resumes.
 */
export const FIGURE_QUESTION_CHARS = 4_000;

/** Characters a question counts toward the figure size. */
export function figureQuestionChars(question: string): number {
  return question.replace(/\s+/g, " ").trim().length;
}

/** True when a new question is too long to draw a figure for. */
export function figureQuestionTooLong(question: string, storedQuestion?: string | null): boolean {
  if (figureQuestionChars(question) <= FIGURE_QUESTION_CHARS) return false;
  if (typeof storedQuestion !== "string") return true;
  return storedQuestion.replace(/\s+/g, " ").trim() !== question.replace(/\s+/g, " ").trim();
}

/** What the student reads when the question is past the size. */
export const FIGURE_QUESTION_NOTE = "This question is too long to draw a figure for. The lesson will still teach it.";
