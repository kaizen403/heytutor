import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import type {
  CoverageCounts,
  CoverageGroup,
  CoverageReport,
} from "@/lib/admin/coverage";
import { EmptyState } from "../shared/components/EmptyState";

const HEAD = "type-accent-xs whitespace-nowrap px-3 py-2 text-left text-faint";
const CELL = "px-3 py-2 align-top text-xs text-soft";
const COLUMNS: ReadonlyArray<readonly [keyof CoverageCounts, string]> = [
  ["savedLessons", "Saved lessons"],
  ["needed", "Needed figures"],
  ["drawn", "All drawn"],
  ["neededDrawn", "Required drawn"],
  ["neededEmpty", "Required empty"],
  ["neededUnknown", "Required unknown"],
  ["empty", "All confirmed empty"],
  ["unrecordedNeed", "Unrecorded need"],
  ["unrecordedOutcome", "Unknown outcome"],
];

function GroupTable({
  title,
  rows,
  chapter = false,
}: {
  title: string;
  rows: CoverageGroup[];
  chapter?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table
        className="caption-top w-full min-w-max border-collapse"
        containerProps={{
          role: "region",
          "aria-label": `${title} coverage`,
          tabIndex: 0,
          className:
            "focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring",
        }}
      >
        <TableCaption className="px-3 py-3 text-left text-sm font-medium text-frost">
          {title}
        </TableCaption>
        <TableHeader>
          <TableRow className="border-b border-stroke">
            <TableHead scope="col" className={HEAD}>
              Subject
            </TableHead>
            {chapter ? (
              <TableHead scope="col" className={HEAD}>
                Chapter
              </TableHead>
            ) : null}
            {COLUMNS.map(([key, label]) => (
              <TableHead key={key} scope="col" className={`${HEAD} text-right`}>
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={`${row.subject}:${row.chapterId ?? "unrecorded"}`}
              className="border-b border-stroke/60 last:border-b-0"
            >
              <TableHead
                scope="row"
                className={`${CELL} text-left font-medium text-frost`}
              >
                {row.subject}
              </TableHead>
              {chapter ? (
                <TableCell className={CELL}>{row.chapter}</TableCell>
              ) : null}
              {COLUMNS.map(([key]) => (
                <TableCell
                  key={key}
                  className={`${CELL} text-right tabular-nums`}
                >
                  {row[key].toLocaleString("en-US")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function CoverageTables({ report }: { report: CoverageReport }) {
  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-soft">
        Needed means the saved plan recorded a required figure; this is not an
        independent accuracy or need judgement. All drawn includes optional
        figures; Required drawn counts only recorded required lessons. Unknown
        outcomes are separate from confirmed empty figures. Chapter: Unrecorded
        — current saved lessons do not record a chapter; it is not inferred from
        lesson text.
      </p>
      <p className="text-xs leading-relaxed text-soft">
        Drawn means validated status plus saved trusted, non-trace diagram ink,
        not proof every mark was watched. Fallback suppressed: yes is positive
        stored evidence; unrecorded does not mean no. Issue codes outside the
        privacy-safe catalogue are counted as unknown, never displayed as free
        text.
      </p>
      <GroupTable title="By subject" rows={report.subjects} />
      <GroupTable title="By chapter" rows={report.chapters} chapter />
      {report.emptyReasons.length === 0 ? (
        <EmptyState
          title="No confirmed empty figures"
          description="Unknown outcomes remain in their own counts above."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table
            className="caption-top w-full min-w-max border-collapse"
            containerProps={{
              role: "region",
              "aria-label": "Confirmed empty diagnostics",
              tabIndex: 0,
              className:
                "focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring",
            }}
          >
            <TableCaption className="px-3 py-3 text-left text-sm font-medium text-frost">
              Confirmed empty diagnostics
            </TableCaption>
            <TableHeader>
              <TableRow className="border-b border-stroke">
                {[
                  "Count",
                  "Subject",
                  "Chapter",
                  "Requirement",
                  "Status",
                  "Evidence",
                  "Degradation reason",
                  "Failure code",
                  "Issue codes",
                  "Unknown issue count",
                  "Strategy",
                  "Fallback suppressed",
                ].map((label) => (
                  <TableHead key={label} scope="col" className={HEAD}>
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.emptyReasons.map((row) => (
                <TableRow
                  key={JSON.stringify(row)}
                  className="border-b border-stroke/60 last:border-b-0"
                >
                  <TableHead
                    scope="row"
                    className={`${CELL} text-left font-medium tabular-nums`}
                  >
                    {row.lessons.toLocaleString("en-US")}
                  </TableHead>
                  <TableCell className={CELL}>{row.subject}</TableCell>
                  <TableCell className={CELL}>{row.chapter}</TableCell>
                  <TableCell className={CELL}>{row.requirement}</TableCell>
                  <TableCell className={CELL}>{row.status}</TableCell>
                  <TableCell className={CELL}>{row.evidence}</TableCell>
                  <TableCell className={CELL}>
                    {row.degradationReason}
                  </TableCell>
                  <TableCell className={CELL}>{row.failureCode}</TableCell>
                  <TableCell
                    className={`${CELL} max-w-xs whitespace-normal break-words`}
                  >
                    {row.issueCodes.join(", ") || "unrecorded"}
                  </TableCell>
                  <TableCell className={`${CELL} tabular-nums`}>
                    {row.unknownIssueCount.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className={CELL}>{row.strategy}</TableCell>
                  <TableCell className={CELL}>
                    {row.fallbackSuppressed}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
