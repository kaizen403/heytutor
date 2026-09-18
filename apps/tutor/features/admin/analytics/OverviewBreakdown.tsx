import type {
  BoundedAggregate,
  DegradationReasonCount,
  OutcomeCounts,
  OverviewPayload,
  TierCounts,
} from "@/lib/admin/types";
import type { DegradationReason } from "@/lib/admin/outcome";
import { BarList, type BarListEntry } from "../shared/components/BarList";
import { DailyChart } from "../shared/components/DailyChart";

function outcomeEntries(counts: OutcomeCounts): BarListEntry[] {
  return [
    { label: "Verified diagram", count: counts.validated, tone: "sky" },
    { label: "Text only", count: counts.textOnly, tone: "muted" },
    { label: "Retry required", count: counts.retryRequired, tone: "danger" },
    { label: "Unverified (legacy)", count: counts.unverified, tone: "muted" },
  ];
}

function tierEntries(tiers: TierCounts): BarListEntry[] {
  return [
    { label: "Exact verified", count: tiers.exactVerified },
    { label: "Qualitative verified", count: tiers.qualitativeVerified },
    { label: "Question representation", count: tiers.questionRepresentation },
  ];
}

function degradationLabel(reason: DegradationReason | "unrecorded"): string {
  if (reason === "unrecorded") return "Unrecorded";
  return reason.replaceAll("_", " ");
}

function degradationEntries(reasons: DegradationReasonCount[]): BarListEntry[] {
  return reasons.map((row) => ({
    label: degradationLabel(row.reason),
    count: row.count,
    tone: row.reason === "unrecorded" ? "muted" : "danger",
  }));
}

function boundedNote(aggregate: BoundedAggregate): string | undefined {
  return aggregate.truncated ? `newest ${aggregate.scanned} turns of more` : undefined;
}

export function OverviewBreakdown({ payload }: { payload: OverviewPayload }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <DailyChart title="Turns per day" points={payload.turnsPerDay} note="UTC" />
        <DailyChart
          title="New users per day"
          points={payload.newUsersPerDay}
          tone="frost"
          note="UTC"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <BarList title="Outcomes · all time" entries={outcomeEntries(payload.outcomesAllTime)} />
        <BarList title="Outcomes · 7 days" entries={outcomeEntries(payload.outcomes7d)} />
        <BarList
          title="Committed tiers · 7 days"
          entries={tierEntries(payload.tiers7d)}
          note={boundedNote(payload.tiers7d)}
        />
        <BarList
          title="Degradation reasons · 7 days"
          entries={degradationEntries(payload.degradation7d.reasons)}
          note={boundedNote(payload.degradation7d)}
        />
        <BarList
          title="Scene engine · 30 days"
          entries={payload.sceneEngineVersions30d.map((row) => ({
            label: row.version,
            count: row.count,
          }))}
        />
      </div>
    </div>
  );
}
