export type LessonFollowUpMode = "ask" | "follow-up";

export function lessonFollowUpMode(hasCompletedLesson: boolean): LessonFollowUpMode {
  return hasCompletedLesson ? "follow-up" : "ask";
}

/**
 * A stopped lesson stays paused: after a mid-lecture doubt, after Stop, and
 * after a reload. The student chooses to pick it up or ask a doubt; the runtime
 * never continues on its own (that felt like the lecture had just stopped, or
 * talked over them).
 */
export const PAUSED_LECTURE_TITLE = "Lecture paused";
export const PAUSED_LECTURE_BODY =
  "Your doubt is answered. Continue the original lesson, or ask another doubt.";
/** One term for both offers. */
export const PAUSED_LECTURE_CONTINUE_LABEL = "Continue lesson";
export const PAUSED_LECTURE_ANOTHER_DOUBT_LABEL = "Ask another doubt";
export const PAUSED_LECTURE_PLACEHOLDER = "Ask another doubt about this lesson";

/** A plain Stop (or a reload after one): no doubt was asked. */
export const STOPPED_LESSON_TITLE = "Lesson stopped";
export const STOPPED_LESSON_BODY = "Pick up where you left off, or ask a doubt about it.";
export const STOPPED_LESSON_ASK_LABEL = "Ask a doubt";

export type PausedLessonCopyReason = "stop" | "doubt";

/** The bar's words for why the lesson is paused. */
export function pausedLessonCopy(reason: PausedLessonCopyReason): {
  title: string;
  body: string;
  continueLabel: string;
  askLabel: string;
} {
  return reason === "stop"
    ? {
        title: STOPPED_LESSON_TITLE,
        body: STOPPED_LESSON_BODY,
        continueLabel: PAUSED_LECTURE_CONTINUE_LABEL,
        askLabel: STOPPED_LESSON_ASK_LABEL,
      }
    : {
        title: PAUSED_LECTURE_TITLE,
        body: PAUSED_LECTURE_BODY,
        continueLabel: PAUSED_LECTURE_CONTINUE_LABEL,
        askLabel: PAUSED_LECTURE_ANOTHER_DOUBT_LABEL,
      };
}

export const QUESTION_FIELD_SELECTOR = "[data-question-field]";

/** Focus the composer so "Ask another doubt" lands in the same box. */
export function focusQuestionField(): boolean {
  if (typeof document === "undefined") return false;
  const field = document.querySelector<HTMLTextAreaElement>(QUESTION_FIELD_SELECTOR);
  if (!field || field.disabled) return false;
  field.focus();
  return true;
}
