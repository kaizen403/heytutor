import Link from "next/link";
import { formatUsd } from "@/lib/obs/runCost";
import type { OverviewCost as OverviewCostPayload, OverviewInference } from "@/lib/admin/types";
import { KpiCard } from "../shared/components/KpiCard";
import { formatMillicentsUsd } from "../shared/lib/format";

function shareWidth(part: number, total: number): string {
  if (total <= 0 || part <= 0) return "0%";
  return `${Math.max(6, Math.round((part / total) * 100))}%`;
}

function inferenceStatus(inference: OverviewInference): string {
  if (!inference.configured) return "Langfuse is not configured";
  if (inference.error === "langfuse_unavailable") return "Langfuse unreachable";
  if (inference.observations === 0) return "No traces in the last 7 days";
  return inference.truncated
    ? `Newest ${inference.observations} generations · 7 days`
    : `From Langfuse · 7 days`;
}

export function OverviewCost({ cost }: { cost: OverviewCostPayload }) {
  const { inference7d: inference } = cost;
  const avgPerTurn =
    cost.turnsThisPeriod > 0 && cost.spentMillicents > 0
      ? formatMillicentsUsd(Math.round(cost.spentMillicents / cost.turnsThisPeriod))
      : "—";
  const maxMonth = Math.max(...cost.series.map((row) => row.spentMillicents), 1);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-accent-xs text-faint">Cost</h2>
        <p className="type-accent-xs text-faint">
          Fireworks + ElevenLabs estimate · period {cost.period}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard
          label="Spend this month"
          value={formatMillicentsUsd(cost.spentMillicents)}
          hint={`${cost.spendUsers} user${cost.spendUsers === 1 ? "" : "s"} with usage`}
          tone="sky"
        />
        <KpiCard
          label="Last month"
          value={formatMillicentsUsd(cost.previousSpentMillicents)}
          hint={cost.previousPeriod}
        />
        <KpiCard
          label="Avg / turn"
          value={avgPerTurn}
          hint={`${cost.turnsThisPeriod} turn${cost.turnsThisPeriod === 1 ? "" : "s"} this month`}
        />
        <KpiCard
          label="Top-up bonus"
          value={formatMillicentsUsd(cost.bonusMillicents)}
          hint="unused extra allowance this period"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="glass rounded-xl px-3 py-2.5">
          <p className="type-accent-xs text-faint">AI vs voice · 7 days</p>
          <p className="mt-1 text-[15px] font-medium tracking-[-0.02em] text-frost">
            {formatUsd(inference.totalUsd)}
          </p>
          <p className="type-accent-xs mt-0.5 text-faint">{inferenceStatus(inference)}</p>
          <div className="mt-2 space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="type-accent-xs text-soft">AI</p>
              <p className="type-accent-xs tabular-nums text-frost">{formatUsd(inference.llmUsd)}</p>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="type-accent-xs text-soft">Voice</p>
              <p className="type-accent-xs tabular-nums text-frost">{formatUsd(inference.ttsUsd)}</p>
            </div>
            {inference.totalUsd > 0 ? (
              <div className="flex h-1 overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full bg-sky-500/80"
                  style={{ width: shareWidth(inference.llmUsd, inference.totalUsd) }}
                />
                <div
                  className="h-full bg-frost/35"
                  style={{ width: shareWidth(inference.ttsUsd, inference.totalUsd) }}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="glass rounded-xl px-3 py-2.5">
          <p className="type-accent-xs text-faint">Spend by month</p>
          <ul className="mt-2 space-y-1.5">
            {cost.series.map((row) => (
              <li key={row.period} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="type-accent-xs text-soft">{row.period}</p>
                  <p className="type-accent-xs shrink-0 tabular-nums text-frost">
                    {formatMillicentsUsd(row.spentMillicents)}
                  </p>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full rounded-full bg-sky-500/70"
                    style={{
                      width:
                        row.spentMillicents <= 0
                          ? "0%"
                          : `${Math.max(6, Math.round((row.spentMillicents / maxMonth) * 100))}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="glass rounded-xl px-3 py-2.5">
          <p className="type-accent-xs text-faint">Highest spend · {cost.period}</p>
          <ul className="mt-2 divide-y divide-stroke">
            {cost.topSpenders.map((user) => (
              <li key={user.userId} className="flex items-baseline justify-between gap-3 py-1.5">
                <Link
                  href={`/admin/users/${user.userId}`}
                  className="type-accent-xs min-w-0 truncate text-soft transition-colors hover:text-frost"
                >
                  {user.label}
                </Link>
                <p className="type-accent-xs shrink-0 tabular-nums text-frost">
                  {formatMillicentsUsd(user.spentMillicents)}
                </p>
              </li>
            ))}
            {cost.topSpenders.length === 0 ? (
              <li className="type-accent-xs py-2 text-faint">No billed usage this month</li>
            ) : null}
          </ul>
        </div>
      </div>
    </section>
  );
}
