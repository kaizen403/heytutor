import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import type { PictureStatusCounts, PicturesReport } from "@/lib/admin/pictures";
import { BarList, type BarListEntry } from "../shared/components/BarList";
import { DailyChart } from "../shared/components/DailyChart";
import { codeLabel, rateLabel, subjectLabel } from "./pictureLabels";

const HEAD = "type-accent-xs whitespace-nowrap px-3 py-2 text-left text-faint";
const CELL = "px-3 py-2 align-top text-xs text-soft";
const COLUMNS: ReadonlyArray<readonly [keyof PictureStatusCounts, string]> = [
  ["needed", "Needed"],
  ["attempted", "Attempted"],
  ["shown", "Shown"],
  ["declined", "Declined"],
  ["unavailable", "Unavailable"],
  ["skipped", "Skipped"],
  ["notAttempted", "Not attempted"],
];

function reasonEntries(report: PicturesReport): BarListEntry[] {
  return report.reasons.map((row) => ({
    label: `${row.status} · ${codeLabel(row.reason)}`,
    count: row.count,
    tone:
      row.status === "skipped" || row.reason === "unrecorded"
        ? "muted"
        : "danger",
  }));
}

export function PicturesBreakdown({ report }: { report: PicturesReport }) {
  const truncated = report.scan.truncated
    ? `newest ${report.scan.scanned.toLocaleString("en-US")} lessons of more`
    : undefined;
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table
          className="caption-top w-full min-w-max border-collapse"
          containerProps={{
            role: "region",
            "aria-label": "Picture outcomes by subject",
            tabIndex: 0,
            className:
              "focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring",
          }}
        >
          <TableCaption className="px-3 py-3 text-left text-sm font-medium text-frost">
            By subject
          </TableCaption>
          <TableHeader>
            <TableRow className="border-b border-stroke">
              <TableHead scope="col" className={HEAD}>
                Subject
              </TableHead>
              {COLUMNS.map(([key, label]) => (
                <TableHead
                  key={key}
                  scope="col"
                  className={`${HEAD} text-right`}
                >
                  {label}
                </TableHead>
              ))}
              <TableHead scope="col" className={`${HEAD} text-right`}>
                Shown rate
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.subjects.map((row) => (
              <TableRow
                key={row.subject}
                className="border-b border-stroke/60 last:border-b-0"
              >
                <TableHead
                  scope="row"
                  className={`${CELL} text-left font-medium text-frost`}
                >
                  {subjectLabel(row.subject)}
                </TableHead>
                {COLUMNS.map(([key]) => (
                  <TableCell
                    key={key}
                    className={`${CELL} text-right tabular-nums`}
                  >
                    {row[key].toLocaleString("en-US")}
                  </TableCell>
                ))}
                <TableCell
                  className={`${CELL} text-right tabular-nums text-frost`}
                >
                  {rateLabel(row.shownRate)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <DailyChart
          title="Needed, engine did not draw · per day"
          points={report.daily.needed}
          tone="frost"
          note="UTC"
        />
        <DailyChart
          title="Picture shown · per day"
          points={report.daily.shown}
          note="UTC"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <BarList
          title="Declined, unavailable and skipped · reason"
          entries={reasonEntries(report)}
          emptyLabel="No declines in this period"
          note={truncated}
        />
        <BarList
          title="Shown · source"
          emptyLabel="Nothing shown in this period"
          note={truncated}
          entries={report.sources.map((row) => ({
            label:
              row.source === "wikimedia" ? "Wikimedia Commons" : "Generated",
            count: row.count,
          }))}
        />
      </div>
    </div>
  );
}
