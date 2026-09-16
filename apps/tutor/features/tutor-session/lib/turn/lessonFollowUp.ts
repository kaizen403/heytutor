export type LessonFollowUpMode = "ask" | "follow-up";

export function lessonFollowUpMode(hasCompletedLesson: boolean): LessonFollowUpMode {
  return hasCompletedLesson ? "follow-up" : "ask";
}
