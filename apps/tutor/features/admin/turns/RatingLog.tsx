import type { AdminLectureRatingLog } from "@/lib/admin/types";
import { cn } from "@/lib/utils";
import { truncateText } from "../shared/lib/format";

const NOTE_CHARS = 90;

/** Stars and note a student left on this lecture, midway then at the end. */
export function RatingLog({ ratings }: { ratings: AdminLectureRatingLog[] }) {
  if (ratings.length === 0) return null;
  return (
    <ul className="mt-0.5 space-y-0.5">
      {ratings.map((rating) => (
        <li
          key={rating.moment}
          className={cn("type-accent-xs", rating.stars <= 2 ? "text-danger" : "text-soft")}
          title={rating.feedback ?? undefined}
        >
          {rating.moment === "during" ? "During" : "After"} {rating.stars}/5
          {rating.feedback ? <span className="text-faint"> · {truncateText(rating.feedback, NOTE_CHARS)}</span> : null}
        </li>
      ))}
    </ul>
  );
}
