"use client";

import { cn } from "@/lib/utils";
import { formatUsd, type RunCostSessionRow } from "@/lib/obs/runCost";

export type CostChipValue = Pick<RunCostSessionRow, "llmUsd" | "ttsUsd" | "totalUsd">;

export function CostChip({
  cost,
  className,
}: {
  cost: CostChipValue | undefined;
  className?: string;
}) {
  if (!cost || cost.totalUsd <= 0) return null;

  return (
    <span className={cn("group/cost relative z-20 inline-flex shrink-0", className)}>
      <button
        type="button"
        className="type-accent-xs rounded-md border border-sky-500/25 bg-sky-500/10 px-2 py-1 tabular-nums text-sky-300 outline-none transition-colors hover:border-sky-400/50 hover:bg-sky-500/15 focus-visible:ring-2 focus-visible:ring-sky-500/60"
        aria-label={`Cost ${formatUsd(cost.totalUsd)}. AI ${formatUsd(cost.llmUsd)}. Voice ${formatUsd(cost.ttsUsd)}.`}
      >
        {formatUsd(cost.totalUsd)}
      </button>
      <span
        role="tooltip"
        className="glass pointer-events-none invisible absolute bottom-full right-0 z-30 mb-1 flex min-w-[8.5rem] flex-col gap-0.5 rounded-md px-2.5 py-1.5 group-hover/cost:visible group-focus-within/cost:visible"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="type-accent-xs text-soft">AI</span>
          <span className="type-accent-xs tabular-nums text-frost">{formatUsd(cost.llmUsd)}</span>
        </span>
        <span className="flex items-baseline justify-between gap-3">
          <span className="type-accent-xs text-soft">Voice</span>
          <span className="type-accent-xs tabular-nums text-frost">{formatUsd(cost.ttsUsd)}</span>
        </span>
      </span>
    </span>
  );
}
