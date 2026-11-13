import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import { ExternalLink } from "lucide-react";
import type { PicturesReport } from "@/lib/admin/pictures";
import { EmptyState } from "../shared/components/EmptyState";
import { formatRelativeTime } from "../shared/lib/format";

const CELL = "px-3 py-2 align-top";
const HEAD = "px-4 text-left text-xs font-medium text-muted-foreground";

/** Stored, judged pictures and how many lessons in the period saved each one. */
export function PicturesLibrary({
  library,
}: {
  library: PicturesReport["library"];
}) {
  const summary = `${library.total.toLocaleString("en-US")} stored · ${library.wikimedia.toLocaleString("en-US")} Wikimedia · ${library.generated.toLocaleString("en-US")} generated${library.truncated ? ` · showing ${library.rows.length}` : ""}`;
  if (library.rows.length === 0) {
    return (
      <EmptyState
        title="No stored pictures"
        description="A picture is stored only after the judge accepts it."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table className="caption-top w-full min-w-[52rem] border-collapse">
        <TableCaption className="px-3 py-3 text-left">
          <span className="text-sm font-medium text-frost">
            Picture library
          </span>
          <span className="type-accent-xs ml-2 text-faint">{summary}</span>
        </TableCaption>
        <TableHeader>
          <TableRow className="border-b border-stroke">
            <TableHead className={HEAD}>Picture</TableHead>
            <TableHead className={HEAD}>Licence</TableHead>
            <TableHead className={HEAD}>Labels</TableHead>
            <TableHead className={HEAD}>Stored</TableHead>
            <TableHead className={`${HEAD} text-right`}>
              Lessons in period
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {library.rows.map((row) => (
            <TableRow
              key={row.id}
              className="border-b border-stroke/60 last:border-b-0"
            >
              <TableCell className={CELL}>
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- immutable same origin asset; next/image would proxy it for nothing */}
                  <img
                    src={row.thumbUrl}
                    alt={row.title}
                    loading="lazy"
                    width={96}
                    height={64}
                    className="h-16 w-24 shrink-0 rounded border border-stroke bg-white object-contain"
                  />
                  <div className="min-w-0">
                    {row.pageUrl ? (
                      <a
                        href={row.pageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-[20rem] items-center gap-1 truncate text-xs text-foreground hover:text-foreground"
                        title={row.title}
                      >
                        {row.title}
                        <ExternalLink
                          className="h-3 w-3 shrink-0"
                          aria-hidden
                        />
                      </a>
                    ) : (
                      <p
                        className="max-w-[20rem] truncate text-xs text-frost"
                        title={row.title}
                      >
                        {row.title}
                      </p>
                    )}
                    <p
                      className="type-accent-xs mt-0.5 max-w-[20rem] truncate text-soft"
                      title={row.shows}
                    >
                      {row.shows || "topic unrecorded"}
                    </p>
                    <p className="type-accent-xs mt-0.5 font-mono text-faint">
                      {row.id}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className={CELL}>
                <p className="type-accent-xs text-soft">{row.license}</p>
                <p
                  className="type-accent-xs mt-0.5 max-w-[12rem] truncate text-faint"
                  title={row.artist}
                >
                  {row.source}
                  {row.artist ? ` · ${row.artist}` : ""}
                </p>
              </TableCell>
              <TableCell className={CELL}>
                <p className="type-accent-xs tabular-nums text-soft">
                  {row.labelCount}
                </p>
                <p className="type-accent-xs mt-0.5 tabular-nums text-faint">
                  {row.width && row.height
                    ? `${row.width} × ${row.height}`
                    : "size unrecorded"}
                </p>
              </TableCell>
              <TableCell className={CELL}>
                <p
                  className="type-accent-xs whitespace-nowrap text-soft"
                  title={row.createdAt}
                >
                  {formatRelativeTime(row.createdAt)}
                </p>
              </TableCell>
              <TableCell className={`${CELL} text-right`}>
                <p className="text-xs tabular-nums text-frost">
                  {row.turns.toLocaleString("en-US")}
                </p>
                {row.lastUsedAt ? (
                  <p
                    className="type-accent-xs mt-0.5 text-faint"
                    title={row.lastUsedAt}
                  >
                    last {formatRelativeTime(row.lastUsedAt)}
                  </p>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
