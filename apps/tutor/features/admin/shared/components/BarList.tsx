import { cn } from "@/lib/utils";
import { formatCount } from "../lib/format";

type BarTone = "sky" | "danger" | "muted";

export interface BarListEntry {
  label: string;
  count: number;
  tone?: BarTone;
}

interface BarListProps {
  title: string;
  entries: BarListEntry[];
  emptyLabel?: string;
  note?: string;
}

const BAR_CLASS: Record<BarTone, string> = {
  sky: "bg-sky-500/70",
  danger: "bg-danger/70",
  muted: "bg-frost/40",
};

/** Labeled distribution rows with proportional bars, in the RunCostBox style. */
export function BarList({ title, entries, emptyLabel = "Nothing yet", note }: BarListProps) {
  const max = Math.max(...entries.map((entry) => entry.count), 1);
  return (
    <div className="glass rounded-xl px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-accent-xs text-faint">{title}</p>
        {note ? <p className="type-accent-xs text-faint">{note}</p> : null}
      </div>
      {entries.length === 0 ? (
        <p className="type-accent-xs mt-2 text-faint">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {entries.map((entry) => (
            <li key={entry.label} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="type-accent-xs min-w-0 truncate text-soft">{entry.label}</p>
                <p className="type-accent-xs shrink-0 tabular-nums text-frost">
                  {formatCount(entry.count)}
                </p>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-ink-700">
                <div
                  className={cn("h-full rounded-full", BAR_CLASS[entry.tone ?? "sky"])}
                  style={{
                    width: entry.count <= 0 ? "0%" : `${Math.max(6, Math.round((entry.count / max) * 100))}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
