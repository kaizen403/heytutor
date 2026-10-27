import { ExternalLink } from "lucide-react";
import type { PicturesReport } from "@/lib/admin/pictures";
import { EmptyState } from "../shared/components/EmptyState";
import { formatRelativeTime } from "../shared/lib/format";

const CELL = "px-3 py-2 align-top";
const HEAD = "type-accent-xs px-3 py-2 text-left text-faint";

/** Stored, judged pictures and how many lessons in the period saved each one. */
export function PicturesLibrary({ library }: { library: PicturesReport["library"] }) {
  const summary = `${library.total.toLocaleString("en-US")} stored · ${library.wikimedia.toLocaleString("en-US")} Wikimedia · ${library.generated.toLocaleString("en-US")} generated${library.truncated ? ` · showing ${library.rows.length}` : ""}`;
  if (library.rows.length === 0) {
    return <EmptyState title="No stored pictures" description="A picture is stored only after the judge accepts it." />;
  }
  return (
    <div className="glass overflow-x-auto rounded-xl">
      <table className="w-full min-w-[52rem] border-collapse">
        <caption className="px-3 py-3 text-left">
          <span className="text-sm font-medium text-frost">Picture library</span>
          <span className="type-accent-xs ml-2 text-faint">{summary}</span>
        </caption>
        <thead>
          <tr className="border-b border-stroke">
            <th className={HEAD}>Picture</th>
            <th className={HEAD}>Licence</th>
            <th className={HEAD}>Labels</th>
            <th className={HEAD}>Stored</th>
            <th className={`${HEAD} text-right`}>Lessons in period</th>
          </tr>
        </thead>
        <tbody>
          {library.rows.map((row) => (
            <tr key={row.id} className="border-b border-stroke/60 last:border-b-0">
              <td className={CELL}>
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- immutable same origin asset; next/image would proxy it for nothing */}
                  <img src={row.thumbUrl} alt={row.title} loading="lazy" width={96} height={64}
                    className="h-16 w-24 shrink-0 rounded border border-stroke bg-white object-contain" />
                  <div className="min-w-0">
                    {row.pageUrl ? (
                      <a href={row.pageUrl} target="_blank" rel="noreferrer"
                        className="inline-flex max-w-[20rem] items-center gap-1 truncate text-xs text-sky-300 hover:text-sky-200" title={row.title}>
                        {row.title}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                      </a>
                    ) : <p className="max-w-[20rem] truncate text-xs text-frost" title={row.title}>{row.title}</p>}
                    <p className="type-accent-xs mt-0.5 max-w-[20rem] truncate text-soft" title={row.shows}>{row.shows || "topic unrecorded"}</p>
                    <p className="type-accent-xs mt-0.5 font-mono text-faint">{row.id}</p>
                  </div>
                </div>
              </td>
              <td className={CELL}>
                <p className="type-accent-xs text-soft">{row.license}</p>
                <p className="type-accent-xs mt-0.5 max-w-[12rem] truncate text-faint" title={row.artist}>{row.source}{row.artist ? ` · ${row.artist}` : ""}</p>
              </td>
              <td className={CELL}>
                <p className="type-accent-xs tabular-nums text-soft">{row.labelCount}</p>
                <p className="type-accent-xs mt-0.5 tabular-nums text-faint">{row.width && row.height ? `${row.width} × ${row.height}` : "size unrecorded"}</p>
              </td>
              <td className={CELL}><p className="type-accent-xs whitespace-nowrap text-soft" title={row.createdAt}>{formatRelativeTime(row.createdAt)}</p></td>
              <td className={`${CELL} text-right`}>
                <p className="text-xs tabular-nums text-frost">{row.turns.toLocaleString("en-US")}</p>
                {row.lastUsedAt ? <p className="type-accent-xs mt-0.5 text-faint" title={row.lastUsedAt}>last {formatRelativeTime(row.lastUsedAt)}</p> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
