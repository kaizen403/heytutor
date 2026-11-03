import type { PicturesReport } from "@/lib/admin/pictures";
import { BarList } from "../shared/components/BarList";
import { KpiCard } from "../shared/components/KpiCard";
import { formatRelativeTime } from "../shared/lib/format";
import { codeLabel } from "./pictureLabels";

/**
 * The topic cache (`reference_picture_queries`): a decline is remembered for a
 * day so a repeated topic skips the paid judge. All time, not the period: a
 * row's time is its last write.
 */
export function PicturesCache({ cache }: { cache: PicturesReport["cache"] }) {
  return (
    <section className="space-y-3" aria-label="Cached topic outcomes">
      <h2 className="type-accent-xs text-faint">Topic cache · all time</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Cached topics" value={cache.total.toLocaleString("en-US")} />
        <KpiCard label="Cached accepts" value={cache.accepted.toLocaleString("en-US")} tone="sky" />
        <KpiCard label="Cached declines" value={cache.declined.toLocaleString("en-US")} tone="danger" />
        <KpiCard label="Declines still held" value={cache.declinedActive.toLocaleString("en-US")} hint="younger than a day, the judge is skipped" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <BarList title="Cached declines · reason" emptyLabel="No cached declines"
          entries={cache.reasons.map((row) => ({ label: codeLabel(row.reason), count: row.count, tone: "danger" }))} />
        <div className="glass rounded-xl px-3 py-2.5">
          <p className="type-accent-xs text-faint">Recent cached declines</p>
          {cache.recent.length === 0 ? <p className="type-accent-xs mt-2 text-faint">No cached declines</p> : (
            <ul className="mt-2 divide-y divide-stroke">
              {cache.recent.map((row) => (
                <li key={`${row.keyPrefix}:${row.createdAt}`} className="flex items-baseline justify-between gap-3 py-1">
                  <span className="type-accent-xs min-w-0 truncate text-soft">{codeLabel(row.reason)}</span>
                  <span className="type-accent-xs shrink-0 text-faint">
                    <span className="font-mono">{row.keyPrefix}</span> · <span title={row.createdAt}>{formatRelativeTime(row.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
