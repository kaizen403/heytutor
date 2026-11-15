import { formatUsd, type LectureUsageCost, type RunCostLoadState } from "@/lib/obs/runCost";

/** Missing streams stay unknown, and a subtotal states how many lectures it covers. */
export function LectureUsage({ costs, states = [], details = false }: {
  costs: readonly (LectureUsageCost | undefined)[];
  states?: readonly (RunCostLoadState | undefined)[];
  details?: boolean;
}) {
  if (!costs.length) return null;

  const missing = states.length > 0 && states.every(state => state === "unconfigured")
    ? "not configured"
    : states.some(state => state === "unavailable") ? "unavailable" : "pending";

  return <span className="inline-flex flex-wrap items-center gap-1.5">
    {(["AI", "Voice"] as const).map(stream => {
      const measured = costs.filter((cost): cost is LectureUsageCost => cost !== undefined && (stream === "AI"
        ? cost.llmUsd > 0 || (cost.inputTokens ?? 0) + (cost.outputTokens ?? 0) > 0
        : cost.ttsUsd > 0 || (cost.characters ?? 0) > 0));
      const total = measured.reduce((sum, cost) => sum + (stream === "AI" ? cost.llmUsd : cost.ttsUsd), 0);
      const quantity = measured.reduce((sum, cost) => sum + (stream === "AI"
        ? (cost.inputTokens ?? 0) + (cost.outputTokens ?? 0) : cost.characters ?? 0), 0);
      let label = `${stream} usage ${missing}`;
      if (measured.length) {
        label = `${stream} ${formatUsd(total)}`;
        if (measured.length < costs.length) label += ` (${measured.length}/${costs.length})`;
        if (details && quantity > 0) label += ` · ${quantity.toLocaleString("en-US")} ${stream === "AI" ? "tokens" : "characters"}`;
      }
      return <span key={stream} className="inline-flex rounded-md border border-stroke px-2 py-1 text-xs tabular-nums text-soft"
        title={measured.length ? `${stream} measured for ${measured.length} of ${costs.length} lectures${measured.length < costs.length ? "; remaining usage is not included" : ""}` : `${stream} usage ${missing}`}>
        {label}
      </span>;
    })}
  </span>;
}
