/**
 * What a lecture rating is on the wire. Pure, so the route and the browser
 * read the same limits.
 */

export type LectureRatingMoment = "during" | "after";

export const LECTURE_RATING_MOMENTS: readonly LectureRatingMoment[] = ["during", "after"];
export const MIN_LECTURE_STARS = 1;
export const MAX_LECTURE_STARS = 5;
export const MAX_LECTURE_FEEDBACK_CHARS = 1000;
const MAX_STEPS_TAUGHT = 10_000;

export interface LectureRatingInput {
  moment: LectureRatingMoment;
  stars: number;
  /** Trimmed; null when the student wrote nothing. */
  feedback: string | null;
  stepsTaught: number;
}

export type LectureRatingParse =
  | { ok: true; input: LectureRatingInput }
  | { ok: false; error: string };

export function isLectureRatingMoment(value: unknown): value is LectureRatingMoment {
  return typeof value === "string" && (LECTURE_RATING_MOMENTS as readonly string[]).includes(value);
}

export function isLectureStars(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_LECTURE_STARS && value <= MAX_LECTURE_STARS;
}

export function parseLectureRatingInput(body: unknown): LectureRatingParse {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid body" };
  const record = body as Record<string, unknown>;
  if (!isLectureRatingMoment(record.moment)) return { ok: false, error: "invalid moment" };
  if (!isLectureStars(record.stars)) return { ok: false, error: "stars must be 1 to 5" };
  let feedback: string | null = null;
  if (record.feedback !== undefined && record.feedback !== null) {
    if (typeof record.feedback !== "string") return { ok: false, error: "invalid feedback" };
    const trimmed = record.feedback.trim();
    if (trimmed.length > MAX_LECTURE_FEEDBACK_CHARS) return { ok: false, error: "feedback too long" };
    feedback = trimmed || null;
  }
  const steps = record.stepsTaught;
  const stepsTaught = typeof steps === "number" && Number.isFinite(steps)
    ? Math.min(Math.max(Math.trunc(steps), 0), MAX_STEPS_TAUGHT)
    : 0;
  return { ok: true, input: { moment: record.moment, stars: record.stars, feedback, stepsTaught } };
}
