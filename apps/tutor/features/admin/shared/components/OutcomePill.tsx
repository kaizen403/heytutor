import {
  AlignLeft,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Image,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { outcomeLabel, type TurnOutcome } from "@/lib/admin/outcome";
import { cn } from "@/lib/utils";

const OUTCOME_ICON = {
  validated: CircleCheck,
  picture_shown: Image,
  text_only: AlignLeft,
  retry_required: RotateCcw,
  failed: CircleAlert,
  unverified: CircleDashed,
} satisfies Record<TurnOutcome, typeof CircleCheck>;

export function OutcomePill({
  outcome,
  className,
}: {
  outcome: TurnOutcome;
  className?: string;
}) {
  const Icon = OUTCOME_ICON[outcome];
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 rounded-md bg-muted/40 font-normal text-foreground",
        className,
      )}
    >
      <Icon strokeWidth={1.5} aria-hidden />
      {outcomeLabel(outcome)}
    </Badge>
  );
}
