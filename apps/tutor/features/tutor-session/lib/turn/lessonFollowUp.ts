export type LessonFollowUpMode = "ask" | "follow-up";

export function lessonFollowUpMode(hasCompletedLesson: boolean): LessonFollowUpMode {
  return hasCompletedLesson ? "follow-up" : "ask";
}

/**
 * After a mid-lecture doubt the original lesson is still paused. The student
 * chooses to pick it up or ask another doubt; the runtime never continues on
 * its own (that felt like the lecture had just stopped, or talked over them).
 */
export const PAUSED_LECTURE_TITLE = "Lecture paused";
export const PAUSED_LECTURE_BODY =
  "Your doubt is answered. Continue the original lesson, or ask another doubt.";
export const PAUSED_LECTURE_CONTINUE_LABEL = "Continue lecture";
export const PAUSED_LECTURE_ANOTHER_DOUBT_LABEL = "Ask another doubt";
export const PAUSED_LECTURE_PLACEHOLDER = "Ask another doubt about this lesson";

export const QUESTION_FIELD_SELECTOR = "[data-question-field]";

/** Focus the composer so "Ask another doubt" lands in the same box. */
export function focusQuestionField(): boolean {
  if (typeof document === "undefined") return false;
  const field = document.querySelector<HTMLTextAreaElement>(QUESTION_FIELD_SELECTOR);
  if (!field || field.disabled) return false;
  field.focus();
  return true;
}
