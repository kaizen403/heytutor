import { FIGURE_REVIEW_LABELS, type PlaygroundLecture } from "@/lib/admin/playgroundLecture";
import { formatUsd, type RunCostSessionRow } from "@/lib/obs/runCost";

const tagClass = "inline-flex rounded-md border border-stroke px-2 py-1 text-xs text-soft";

export function FigureTag({ lecture }: { lecture?: PlaygroundLecture | null }) {
  const label = lecture?.state !== "complete" ? "Figure not checked"
    : lecture.figure === "with-figure" ? "With figure"
    : lecture.figure === "reference-picture" ? "Reference picture"
    : lecture.figure === "without-figure" ? "Without figure" : "Figure not checked";
  return <span className={tagClass} title="Detected from the saved recording; manual feedback is shown separately">{label}</span>;
}

export function QuestionTags({ lecture, cost, running }: {
  lecture?: PlaygroundLecture | null;
  cost?: Pick<RunCostSessionRow, "llmUsd" | "ttsUsd" | "totalUsd"> & Partial<Pick<RunCostSessionRow, "inputTokens" | "outputTokens" | "observations">>;
  running?: boolean;
}) {
  const review = lecture?.review;
  return <div className="flex flex-wrap items-center gap-1.5">
    <FigureTag lecture={lecture} />
    {lecture?.state === "complete" ? <span className={tagClass}>Video + notes ready</span> : null}
    <span className={tagClass} title="Measured model usage for this question, including planning and teaching">
      {cost && (cost.observations ?? cost.totalUsd) > 0
        ? `AI ${formatUsd(cost.llmUsd)}${cost.inputTokens !== undefined && cost.outputTokens !== undefined ? ` · ${(cost.inputTokens + cost.outputTokens).toLocaleString()} tokens` : ""}`
        : lecture?.state === "complete" || running ? "AI usage pending" : "Not run"}
    </span>
    {review ? <span className={tagClass}>{review.skipped ? "Review skipped" : "Reviewed"}{review.stars ? ` · ${review.stars}/5` : ""}</span> : lecture?.state === "complete" ? <span className={tagClass}>Awaiting review</span> : null}
    {review?.figure ? <span className={tagClass}>Manual: {FIGURE_REVIEW_LABELS[review.figure]}</span> : null}
    {review?.tags.map(tag => <span key={tag} className={tagClass}>{tag}</span>)}
  </div>;
}
