import { outcomeLabel, type TurnOutcome } from "@/lib/admin/outcome";
import { cn } from "@/lib/utils";

const OUTCOME_STYLE: Record<TurnOutcome, { bg: string; text: string; border: string }> = {
  validated: {
    bg: "rgba(74, 158, 255, 0.14)",
    text: "#9CCBFF",
    border: "rgba(74, 158, 255, 0.32)",
  },
  text_only: {
    bg: "rgba(255, 255, 255, 0.06)",
    text: "rgba(237, 237, 235, 0.68)",
    border: "rgba(255, 255, 255, 0.20)",
  },
  retry_required: {
    bg: "rgba(224, 104, 88, 0.15)",
    text: "#E06858",
    border: "rgba(224, 104, 88, 0.32)",
  },
  unverified: {
    bg: "rgba(255, 255, 255, 0.04)",
    text: "rgba(237, 237, 235, 0.45)",
    border: "rgba(255, 255, 255, 0.12)",
  },
};

interface OutcomePillProps {
  outcome: TurnOutcome;
  className?: string;
}

export function OutcomePill({ outcome, className }: OutcomePillProps) {
  const config = OUTCOME_STYLE[outcome];
  return (
    <span
      className={cn(
        "type-accent-xs inline-flex shrink-0 items-center rounded-full border px-2 py-0.5",
        className,
      )}
      style={{ backgroundColor: config.bg, color: config.text, borderColor: config.border }}
    >
      {outcomeLabel(outcome)}
    </span>
  );
}
