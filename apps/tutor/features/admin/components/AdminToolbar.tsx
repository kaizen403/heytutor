"use client";

import Link from "next/link";
import {
  ChevronLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { SiteButton } from "@/components/ui/site-button";
import { cn } from "@/lib/utils";
import {
  SYLLABUS_SUBJECTS,
  SYLLABUS_SUBJECT_LABEL,
  type SyllabusSubject,
} from "../lib/parseSyllabus";
import {
  LECTURE_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  filtersAreActive,
  type LectureFilter,
  type StatusFilter,
  type TopicFilters,
} from "../lib/topicFilters";

const selectClass =
  "h-9 w-full rounded-lg border border-stroke bg-ink-900 px-2.5 text-sm text-frost outline-none transition-colors hover:border-sky-500/50 focus-visible:ring-2 focus-visible:ring-sky-500";

interface AdminToolbarProps {
  subject: SyllabusSubject;
  onSubjectChange: (subject: SyllabusSubject) => void;
  unitCounts: Record<SyllabusSubject, number>;
  topicCounts: Record<SyllabusSubject, number>;
  stats: {
    total: number;
    checked: number;
    accepted: number;
    rejected: number;
    needsImprovement: number;
  };
  filters: TopicFilters;
  onFiltersChange: (filters: TopicFilters) => void;
  matchCount: number;
  subjectTopicCount: number;
  selecting: boolean;
  onToggleSelecting: () => void;
  canSelect: boolean;
  allExpanded: boolean;
  /** Hidden while filters are active, because matching units are force-expanded. */
  showExpandToggle: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onExport: () => void;
  onReset: () => void;
}

export function AdminToolbar({
  subject,
  onSubjectChange,
  unitCounts,
  topicCounts,
  stats,
  filters,
  onFiltersChange,
  matchCount,
  subjectTopicCount,
  selecting,
  onToggleSelecting,
  canSelect,
  allExpanded,
  showExpandToggle,
  onExpandAll,
  onCollapseAll,
  onExport,
  onReset,
}: AdminToolbarProps) {
  const active = filtersAreActive(filters);

  return (
    <header className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin"
            className="mb-3 inline-flex items-center gap-1 text-xs text-soft hover:text-frost"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            Admin panel
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-frost">
            Test playground
          </h1>
          <p className="mt-1 text-sm text-soft">
            Record syllabus questions, watch lectures, and review each topic.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SiteButton variant="ghost" size="sm" onClick={onExport}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Export progress
          </SiteButton>
          <SiteButton variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset progress
          </SiteButton>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-stroke py-3 text-xs text-soft"
        aria-label="Review progress"
      >
        <span>
          <strong className="mr-1 text-sm font-semibold tabular-nums text-frost">
            {stats.checked}/{stats.total}
          </strong>{" "}
          reviewed
        </span>
        <span>
          <strong className="mr-1 text-sm font-semibold tabular-nums text-sky-300">
            {stats.accepted}
          </strong>{" "}
          accepted
        </span>
        <span>
          <strong className="mr-1 text-sm font-semibold tabular-nums text-danger">
            {stats.rejected}
          </strong>{" "}
          rejected
        </span>
        <span>
          <strong className="mr-1 text-sm font-semibold tabular-nums text-frost">
            {stats.needsImprovement}
          </strong>{" "}
          need work
        </span>
      </div>

      <section aria-label="Browse syllabus">
        <h2 className="mb-1 text-base font-medium text-frost">
          Choose a subject
        </h2>
        <p className="mb-3 text-xs text-soft">
          Questions and recorded lectures are grouped by unit.
        </p>
        <div className="flex gap-1 overflow-x-auto border-b border-stroke">
          {SYLLABUS_SUBJECTS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onSubjectChange(value)}
              aria-pressed={subject === value}
              className={cn(
                "shrink-0 border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
                subject === value
                  ? "border-sky-400 font-medium text-frost"
                  : "border-transparent text-soft hover:text-frost",
              )}
            >
              {SYLLABUS_SUBJECT_LABEL[value]}
              <span className="ml-2 hidden text-xs text-faint sm:inline">
                {unitCounts[value]} units · {topicCounts[value]} topics
              </span>
            </button>
          ))}
        </div>
      </section>

      <section
        className="glass rounded-xl p-4"
        aria-label="Find and select questions"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-frost">Find questions</h2>
            <p className="mt-0.5 text-xs text-soft">
              Search, filter, then open a unit to review or record.
            </p>
          </div>
          <SiteButton
            variant={selecting ? "sky" : "ice"}
            size="sm"
            disabled={!canSelect}
            onClick={onToggleSelecting}
            title={
              canSelect
                ? "Pick questions to record lectures for"
                : "This subject has no question fixtures yet"
            }
          >
            {selecting ? "Exit selection" : "Select questions to record"}
          </SiteButton>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
          <div className="relative min-w-0">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <input
              type="search"
              value={filters.query}
              onChange={(event) =>
                onFiltersChange({ ...filters, query: event.target.value })
              }
              placeholder="Search topics and questions…"
              aria-label="Search topics and questions"
              className="h-9 w-full rounded-lg border border-stroke bg-ink-900 pl-8 pr-8 text-sm text-frost outline-none transition-colors placeholder:text-faint hover:border-sky-500/50 focus-visible:ring-2 focus-visible:ring-sky-500"
            />
            {filters.query ? (
              <button
                type="button"
                onClick={() => onFiltersChange({ ...filters, query: "" })}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-frost"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          <select
            value={filters.status}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                status: event.target.value as StatusFilter,
              })
            }
            aria-label="Filter by review status"
            className={selectClass}
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={filters.lecture}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                lecture: event.target.value as LectureFilter,
              })
            }
            aria-label="Filter by lecture state"
            className={selectClass}
          >
            {LECTURE_FILTER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-soft" role="status">
            {active
              ? `${matchCount} of ${subjectTopicCount} topics match`
              : `${subjectTopicCount} topics in this subject`}
          </span>
          <div className="flex items-center gap-1">
            {active ? (
              <SiteButton
                variant="ghost"
                size="sm"
                onClick={() =>
                  onFiltersChange({ query: "", status: "all", lecture: "all" })
                }
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Clear filters
              </SiteButton>
            ) : null}

            {showExpandToggle ? (
              <SiteButton
                variant="ghost"
                size="sm"
                onClick={allExpanded ? onCollapseAll : onExpandAll}
                title={
                  allExpanded ? "Collapse every unit" : "Expand every unit"
                }
              >
                {allExpanded ? (
                  <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
                )}
                {allExpanded ? "Collapse units" : "Expand units"}
              </SiteButton>
            ) : null}
          </div>
        </div>
      </section>
    </header>
  );
}
