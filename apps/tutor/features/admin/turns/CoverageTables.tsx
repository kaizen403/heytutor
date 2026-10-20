import type { CoverageCounts, CoverageGroup, CoverageReport } from "@/lib/admin/coverage";
import { EmptyState } from "../shared/components/EmptyState";

const HEAD = "type-accent-xs whitespace-nowrap px-3 py-2 text-left text-faint";
const CELL = "px-3 py-2 align-top text-xs text-soft";
const COLUMNS: ReadonlyArray<readonly [keyof CoverageCounts, string]> = [
  ["savedLessons", "Saved lessons"], ["needed", "Needed figures"], ["drawn", "All drawn"],
  ["neededDrawn", "Required drawn"], ["neededEmpty", "Required empty"],
  ["neededUnknown", "Required unknown"], ["empty", "All confirmed empty"],
  ["unrecordedNeed", "Unrecorded need"], ["unrecordedOutcome", "Unknown outcome"],
];

function GroupTable({ title, rows, chapter = false }: { title: string; rows: CoverageGroup[]; chapter?: boolean }) {
  return (
    <div className="glass overflow-x-auto rounded-xl focus-visible:outline focus-visible:outline-sky-400" role="region" aria-label={`${title} coverage`} tabIndex={0}>
      <table className="w-full min-w-max border-collapse">
        <caption className="px-3 py-3 text-left text-sm font-medium text-frost">{title}</caption>
        <thead><tr className="border-b border-stroke">
          <th scope="col" className={HEAD}>Subject</th>
          {chapter ? <th scope="col" className={HEAD}>Chapter</th> : null}
          {COLUMNS.map(([key, label]) => <th key={key} scope="col" className={`${HEAD} text-right`}>{label}</th>)}
        </tr></thead>
        <tbody>{rows.map(row => (
          <tr key={`${row.subject}:${row.chapterId ?? "unrecorded"}`} className="border-b border-stroke/60 last:border-b-0">
            <th scope="row" className={`${CELL} text-left font-medium text-frost`}>{row.subject}</th>
            {chapter ? <td className={CELL}>{row.chapter}</td> : null}
            {COLUMNS.map(([key]) => <td key={key} className={`${CELL} text-right tabular-nums`}>{row[key].toLocaleString("en-US")}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function CoverageTables({ report }: { report: CoverageReport }) {
  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-soft">
        Needed means the saved plan recorded a required figure; this is not an independent accuracy or need judgement.
        All drawn includes optional figures; Required drawn counts only recorded required lessons.
        Unknown outcomes are separate from confirmed empty figures. Chapter: Unrecorded — current saved
        lessons do not record a chapter; it is not inferred from lesson text.
      </p>
      <p className="text-xs leading-relaxed text-soft">
        Drawn means validated status plus saved trusted, non-trace diagram ink, not proof every mark was watched.
        Fallback suppressed: yes is positive stored evidence; unrecorded does not mean no.
        Issue codes outside the privacy-safe catalogue are counted as unknown, never displayed as free text.
      </p>
      <GroupTable title="By subject" rows={report.subjects} />
      <GroupTable title="By chapter" rows={report.chapters} chapter />
      {report.emptyReasons.length === 0 ? <EmptyState title="No confirmed empty figures" description="Unknown outcomes remain in their own counts above." /> : (
        <div className="glass overflow-x-auto rounded-xl focus-visible:outline focus-visible:outline-sky-400" role="region" aria-label="Confirmed empty diagnostics" tabIndex={0}>
          <table className="w-full min-w-max border-collapse">
            <caption className="px-3 py-3 text-left text-sm font-medium text-frost">Confirmed empty diagnostics</caption>
            <thead><tr className="border-b border-stroke">
              {["Count", "Subject", "Chapter", "Requirement", "Status", "Evidence", "Degradation reason", "Failure code", "Issue codes", "Unknown issue count", "Strategy", "Fallback suppressed"].map(label => (
                <th key={label} scope="col" className={HEAD}>{label}</th>
              ))}
            </tr></thead>
            <tbody>{report.emptyReasons.map(row => (
              <tr key={JSON.stringify(row)} className="border-b border-stroke/60 last:border-b-0">
                <th scope="row" className={`${CELL} text-left font-medium tabular-nums`}>{row.lessons.toLocaleString("en-US")}</th>
                <td className={CELL}>{row.subject}</td><td className={CELL}>{row.chapter}</td>
                <td className={CELL}>{row.requirement}</td><td className={CELL}>{row.status}</td>
                <td className={CELL}>{row.evidence}</td><td className={CELL}>{row.degradationReason}</td>
                <td className={CELL}>{row.failureCode}</td>
                <td className={`${CELL} max-w-xs whitespace-normal break-words`}>{row.issueCodes.join(", ") || "unrecorded"}</td>
                <td className={`${CELL} tabular-nums`}>{row.unknownIssueCount.toLocaleString("en-US")}</td>
                <td className={CELL}>{row.strategy}</td><td className={CELL}>{row.fallbackSuppressed}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
