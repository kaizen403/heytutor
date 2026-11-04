import type { AiCreditsSnapshot } from "@/lib/admin/aiCreditsCore";
import { cn } from "@/lib/utils";
import { KpiCard } from "../shared/components/KpiCard";
import { formatRelativeTime } from "../shared/lib/format";

function usd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/** Total AI credits against the monthly budget, read from the relay's own counter. */
export function OverviewAiCredits({ credits }: { credits: AiCreditsSnapshot }) {
  const barTone = credits.percent >= 95 ? "bg-danger" : credits.percent >= 80 ? "bg-amber-400/80" : "bg-sky-500/80";
  const serving = credits.servingProvider === "openai_compat"
    ? credits.model ?? "relay"
    : credits.servingProvider === "fireworks" ? "Fireworks" : credits.servingProvider;

  return (
    <section className="space-y-3" aria-label="AI credits">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-accent-xs text-faint">AI credits</h2>
        <p className="type-accent-xs text-faint">
          {credits.configured
            ? `Cycle from ${day(`${credits.cycleKey}T00:00:00+05:30`)} · resets ${day(credits.resetsAt)}`
            : "Relay not configured here"}
        </p>
      </div>

      {credits.exhausted ? (
        <p role="alert" className="glass rounded-xl px-3 py-2.5 type-accent-xs text-danger">
          The {usd(credits.budgetUsd)} is used up. New lessons run on Fireworks, billed to Fireworks, until {day(credits.resetsAt)}.
        </p>
      ) : null}

      <div className="glass rounded-xl px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px] font-medium tabular-nums tracking-[-0.02em] text-frost">
            {usd(credits.spentUsd)} <span className="text-faint">of {usd(credits.budgetUsd)}</span>
          </p>
          <p className="type-accent-xs tabular-nums text-soft">{credits.percent.toFixed(1)}%</p>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(credits.percent)}
        >
          <div className={cn("h-full rounded-full", barTone)} style={{ width: `${credits.percent}%` }} />
        </div>
        <p className={cn("type-accent-xs mt-1.5", credits.stale && credits.configured ? "text-danger" : "text-faint")}>
          {credits.lastPolledAt
            ? `${credits.stale ? "Stale: the relay's counter last answered" : "Relay counter read"} ${formatRelativeTime(credits.lastPolledAt)}`
            : "No reading yet"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard label="Remaining" value={usd(credits.remainingUsd)} tone={credits.exhausted ? "danger" : "sky"} hint={`of ${usd(credits.budgetUsd)} a month`} />
        <KpiCard label="Per day" value={usd(credits.dailyBurnUsd)} hint="average this cycle" />
        <KpiCard
          label="Runs out"
          value={credits.projectedRunOutAt ? day(credits.projectedRunOutAt) : "Not this cycle"}
          tone={credits.projectedRunOutAt ? "danger" : "default"}
          hint={credits.projectedRunOutAt ? "at this pace" : `resets ${day(credits.resetsAt)}`}
        />
        <KpiCard label="Lessons now use" value={serving} hint={credits.fallbackReason ?? "for every AI call"} />
      </div>

      {credits.history.length > 0 ? (
        <ul className="glass space-y-1.5 rounded-xl px-3 py-2.5">
          {credits.history.map((row) => (
            <li key={row.cycleKey} className="flex items-baseline justify-between gap-3">
              <p className="type-accent-xs text-soft">Cycle from {day(`${row.cycleKey}T00:00:00+05:30`)}</p>
              <p className="type-accent-xs tabular-nums text-frost">{usd(row.spentUsd)}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
