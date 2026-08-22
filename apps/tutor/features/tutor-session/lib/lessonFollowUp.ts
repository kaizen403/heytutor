export type LessonFollowUpMode = "ask" | "follow-up";

export function lessonFollowUpMode(hasCompletedLesson: boolean): LessonFollowUpMode {
  return hasCompletedLesson ? "follow-up" : "ask";
}

export function nextQuestionBoardPath(boardId: string, question = ""): string {
  const trimmed = question.trim();
  if (!trimmed) return `/c/${boardId}`;
  return `/c/${boardId}?q=${encodeURIComponent(trimmed)}`;
}

export const LESSON_DONE_PROMPT =
  "This lesson is done. Ask a doubt here, or start the next question on a new board.";
