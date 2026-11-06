import { composeDoubtFigureQuestion } from "@/lib/boards/doubtFigure";

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
/** The same, for a doubt, whose figure counts the lesson question with it. */
export const FIGURE_DOUBT_NOTE = "This doubt and its lesson are too long to draw a figure for. The answer will still teach it.";

/**
 * The note under the input box, or null. A doubt is counted as the browser
 * plans its figure: its title with the page's whole lesson question.
 */
export function figureQuestionNote(question: string, doubtPageQuestion?: string): string | null {
  const page = doubtPageQuestion?.trim() ?? "";
  const asked = question.trim();
  if (page && asked) return figureQuestionChars(composeDoubtFigureQuestion(page, asked)) > FIGURE_QUESTION_CHARS ? FIGURE_DOUBT_NOTE : null;
  return figureQuestionChars(question) > FIGURE_QUESTION_CHARS ? FIGURE_QUESTION_NOTE : null;
}
