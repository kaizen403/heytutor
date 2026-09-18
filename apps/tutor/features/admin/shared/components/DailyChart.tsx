import { cn } from "@/lib/utils";
import { formatCount, formatUtcDate } from "../lib/format";

interface DailyChartProps {
  title: string;
  points: ReadonlyArray<{ day: string; count: number }>;
  tone?: "sky" | "frost";
  note?: string;
}

/** A 14-day UTC bar series. Pure divs — no chart library in the app. */
export function DailyChart({ title, points, tone = "sky", note }: DailyChartProps) {
  const max = Math.max(...points.map((point) => point.count), 1);
  const first = points[0];
  const last = points[points.length - 1];
  const label =
    first && last
      ? `Daily counts from ${formatUtcDate(first.day)} to ${formatUtcDate(last.day)}, peaking at ${max}`
      : title;

  return (
    <div className="glass rounded-xl px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-accent-xs text-faint">{title}</p>
        {note ? <p className="type-accent-xs text-faint">{note}</p> : null}
      </div>
      <div className="mt-3 flex h-20 items-end gap-[3px]" role="img" aria-label={label}>
        {points.map((point) => (
          <div
            key={point.day}
            className="min-w-0 flex-1"
            title={`${formatUtcDate(point.day)}: ${point.count}`}
          >
            <div
              className={cn("w-full rounded-sm", tone === "sky" ? "bg-sky-500/70" : "bg-frost/50")}
              style={{
                height: point.count <= 0 ? "2px" : `${Math.max(4, Math.round((point.count / max) * 76))}px`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="type-accent-xs mt-1.5 flex justify-between text-faint">
        <span>{first ? formatUtcDate(first.day) : ""}</span>
        <span>peak {formatCount(max)}</span>
        <span>{last ? formatUtcDate(last.day) : ""}</span>
      </div>
    </div>
  );
}
