import { resolveApiUrl } from "@heytutor/tutor-core";
import type { LectureRatingMoment } from "@/lib/lecture-rating/ratingInput";

export interface LectureRatingSubmission {
  moment: LectureRatingMoment;
  stars: number;
  feedback?: string | null;
  stepsTaught: number;
}

/**
 * `retry` covers a network failure or a server error; `rejected` is a body or
 * turn the server will never accept, so sending it again is pointless.
 */
export type LectureRatingResult = { ok: true } | { ok: false; retry: boolean };

export async function submitLectureRating(
  boardId: string,
  turnId: string,
  submission: LectureRatingSubmission,
): Promise<LectureRatingResult> {
  try {
    const response = await fetch(
      resolveApiUrl(`/api/boards/${encodeURIComponent(boardId)}/turns/${encodeURIComponent(turnId)}/rating`),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission),
      },
    );
    if (response.ok) return { ok: true };
    return { ok: false, retry: response.status >= 500 || response.status === 429 };
  } catch {
    return { ok: false, retry: true };
  }
}
