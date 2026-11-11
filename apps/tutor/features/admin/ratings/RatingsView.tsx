"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { SiteButton } from "@/components/ui/site-button";
import type { AdminRatingsPage } from "@/lib/admin/ratingsQueries";
import { cn } from "@/lib/utils";
import { AdminPageHeader } from "../shared/components/AdminPageHeader";
import { BarList } from "../shared/components/BarList";
import { EmptyState } from "../shared/components/EmptyState";
import { FilterSelect } from "../shared/components/FilterSelect";
import { KpiCard } from "../shared/components/KpiCard";
import { Pagination } from "../shared/components/Pagination";
import { useAdminQuery } from "../shared/hooks/useAdminQuery";
import { formatCount, formatPercent, formatRelativeTime } from "../shared/lib/format";

const PAGE_SIZE = 25;
const CELL = "px-3 py-2 align-top";
const HEAD = "type-accent-xs px-3 py-2 text-left text-faint";

const WINDOWS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];
const STARS = [
  { value: "", label: "Any stars" },
  ...[5, 4, 3, 2, 1].map((stars) => ({ value: String(stars), label: `${stars} ${stars === 1 ? "star" : "stars"}` })),
];
const MOMENTS = [
  { value: "", label: "During and after" },
  { value: "during", label: "During the lecture" },
  { value: "after", label: "After the lecture" },
];
const FEEDBACK = [
  { value: "", label: "With or without a note" },
  { value: "with", label: "With a note" },
];

function formatAverage(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function StarRow({ stars }: { stars: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${stars} of 5 stars`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className="h-3.5 w-3.5"
          strokeWidth={1.6}
          style={{ color: index < stars ? "var(--sky-300)" : "var(--text-faint)" }}
          fill={index < stars ? "currentColor" : "none"}
          aria-hidden
        />
      ))}
    </span>
  );
}

/** How students rate their lectures: the averages, the spread, and every note. */
export function RatingsView() {
  const [range, setRange] = useState("30d");
  const [stars, setStars] = useState("");
  const [moment, setMoment] = useState("");
  const [feedback, setFeedback] = useState("");
  const [page, setPage] = useState(1);

  const url = useMemo(() => {
    const params = new URLSearchParams({ window: range, page: String(page), pageSize: String(PAGE_SIZE) });
    if (stars) params.set("stars", stars);
    if (moment) params.set("moment", moment);
    if (feedback) params.set("feedback", feedback);
    return `/api/admin/ratings?${params}`;
  }, [range, stars, moment, feedback, page]);
  const { data, loading, error, refresh } = useAdminQuery<AdminRatingsPage>(url);
  const summary = data?.summary;

  const onFilter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Ratings"
        icon={<Star className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        description="Stars and notes students leave during and after each lecture"
        actions={
          <>
            <FilterSelect value={range} options={WINDOWS} onChange={onFilter(setRange)} ariaLabel="Time window" />
            <FilterSelect value={stars} options={STARS} onChange={onFilter(setStars)} ariaLabel="Stars" />
            <FilterSelect value={moment} options={MOMENTS} onChange={onFilter(setMoment)} ariaLabel="When it was asked" />
            <FilterSelect value={feedback} options={FEEDBACK} onChange={onFilter(setFeedback)} ariaLabel="Notes" />
          </>
        }
      />

      {summary ? (
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiCard label="Average" value={formatAverage(summary.average)} hint={`${formatCount(summary.count)} ratings`} tone="sky" />
            <KpiCard label="During" value={formatAverage(summary.duringAverage)} hint="asked midway" />
            <KpiCard label="After" value={formatAverage(summary.afterAverage)} hint="asked at the end" />
            <KpiCard
              label="Response rate"
              value={summary.lecturesTaught > 0 ? formatPercent(summary.ratedLectures / summary.lecturesTaught) : "—"}
              hint={`${formatCount(summary.ratedLectures)} of ${formatCount(summary.lecturesTaught)} lectures`}
            />
            <KpiCard label="With a note" value={formatCount(summary.withFeedback)} />
            <KpiCard
              label="Low (1–2 stars)"
              value={formatCount((summary.distribution[0] ?? 0) + (summary.distribution[1] ?? 0))}
              tone={(summary.distribution[0] ?? 0) + (summary.distribution[1] ?? 0) > 0 ? "danger" : "default"}
            />
          </div>
          <BarList
            title="Stars"
            emptyLabel="No ratings yet"
            entries={summary.count === 0 ? [] : [5, 4, 3, 2, 1].map((value) => ({
              label: `${value} ${value === 1 ? "star" : "stars"}`,
              count: summary.distribution[value - 1] ?? 0,
              tone: value <= 2 ? "danger" : value === 3 ? "muted" : "sky",
            }))}
          />
        </div>
      ) : null}

      {error ? (
        <EmptyState title="Ratings did not load" description={error} action={<SiteButton size="sm" onClick={refresh}>Try again</SiteButton>} />
      ) : !loading && data && data.rows.length === 0 ? (
        <EmptyState title="No ratings here" description="Students are asked at the end of every lecture, and midway through longer ones." />
      ) : (
        <div className="glass overflow-x-auto rounded-xl">
          <table className="w-full min-w-[60rem] border-collapse">
            <thead>
              <tr className="border-b border-stroke">
                <th className={HEAD}>Stars</th>
                <th className={HEAD}>Note</th>
                <th className={HEAD}>Lecture</th>
                <th className={HEAD}>Student</th>
                <th className={cn(HEAD, "text-right")}>When</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row) => (
                <tr key={row.id} className="border-b border-stroke/60 last:border-b-0 hover:bg-white/[0.03]">
                  <td className={cn(CELL, "whitespace-nowrap")}>
                    <StarRow stars={row.stars} />
                    <p className="mt-0.5 text-xs text-faint">
                      {row.moment === "during" ? "During" : "After"} · step {row.stepsTaught}
                    </p>
                  </td>
                  <td className={cn(CELL, "max-w-[24rem]")}>
                    {row.feedback ? (
                      <p className="whitespace-pre-wrap break-words text-sm text-frost">{row.feedback}</p>
                    ) : (
                      <span className="text-xs text-faint">No note</span>
                    )}
                  </td>
                  <td className={cn(CELL, "max-w-[20rem]")}>
                    <p className="line-clamp-2 text-sm text-frost" title={row.question}>{row.question}</p>
                    <p className="truncate text-xs text-faint">
                      {row.boardTitle}
                      {row.turnKind === "resume" ? " · continued" : ""}
                    </p>
                  </td>
                  <td className={CELL}>
                    <Link href={`/admin/users/${encodeURIComponent(row.userId)}`} className="text-sm text-frost hover:text-sky-300">
                      {row.userName ?? row.userEmail ?? "No name"}
                    </Link>
                    {row.userName && row.userEmail ? <p className="text-xs text-faint">{row.userEmail}</p> : null}
                  </td>
                  <td className={cn(CELL, "whitespace-nowrap text-right text-xs text-faint")}>
                    {formatRelativeTime(row.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} /> : null}
    </div>
  );
}
