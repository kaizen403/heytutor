import { isLectureStars } from "@/lib/lecture-rating/ratingInput";
import type { AdminLectureRatingLog } from "./types";

const MOMENT_ORDER = ["during", "after"] as const;

/**
 * The ratings stored for one lecture, midway first. A row that is not a
 * 1–5 star `during` or `after` rating is dropped rather than shown.
 */
export function lectureRatingLogs(
  rows: ReadonlyArray<{ moment: string; stars: number; feedback: string | null }>,
): AdminLectureRatingLog[] {
  const logs: AdminLectureRatingLog[] = [];
  for (const moment of MOMENT_ORDER) {
    const row = rows.find((item) => item.moment === moment);
    if (!row || !isLectureStars(row.stars)) continue;
    const feedback = row.feedback?.trim() ? row.feedback.trim() : null;
    logs.push({ moment, stars: row.stars, feedback });
  }
  return logs;
}
