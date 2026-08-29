"use client";

import { ChevronsDownUp, ChevronsUpDown, Download, FlaskConical, RotateCcw, Search, X } from "lucide-react";
import { SiteButton } from "@/components/ui/site-button";
import { cn } from "@/lib/utils";
import type { SyllabusSubject } from "../lib/parseSyllabus";
import {
  LECTURE_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  filtersAreActive,
  type LectureFilter,
  type StatusFilter,
  type TopicFilters,
} from "../lib/topicFilters";

const SUBJECT_LABEL: Record<SyllabusSubject, string> = {
  physics: "Physics",
  maths: "Mathematics",
};

const selectClass =
  "h-9 rounded-lg border border-stroke bg-ink-900 px-2.5 text-xs text-frost outline-none transition-colors hover:border-sky-500/50 focus-visible:ring-2 focus-visible:ring-sky-500";

interface AdminToolbarProps {
  subject: SyllabusSubject;
  onSubjectChange: (subject: SyllabusSubject) => void;
  unitCounts: Record<SyllabusSubject, number>;
  topicCounts: Record<SyllabusSubject, number>;
  stats: { total: number; checked: number; accepted: number; rejected: number; needsImprovement: number };
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
    <header className="glass rim-sky rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/12 text-sky-400">
            <FlaskConical className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </div>
          <div>
            <h1 className="text-[17px] font-medium tracking-[-0.015em] text-frost">
              Syllabus Playground
            </h1>
            <p className="type-accent-xs mt-1 text-faint">
              {stats.checked}/{stats.total} topics reviewed
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="type-accent-xs rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-sky-300">
            {stats.accepted} ok
          </span>
          <span className="type-accent-xs rounded-full border border-danger/30 bg-danger/15 px-2.5 py-1 text-danger">
            {stats.rejected} no
          </span>
          <span className="type-accent-xs rounded-full border border-stroke bg-ink-800 px-2.5 py-1 text-soft">
            {stats.needsImprovement} wip
          </span>
          <SiteButton variant="ghost" size="sm" onClick={onExport}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Export
          </SiteButton>
          <SiteButton variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </SiteButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-stroke px-4 py-3">
        <div className="flex rounded-lg border border-stroke bg-ink-900 p-0.5">
          {(["physics", "maths"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onSubjectChange(value)}
              aria-pressed={subject === value}
              className={cn(
                "type-accent-xs rounded-md px-3 py-1.5 transition-colors",
                subject === value
                  ? "bg-sky-500/20 text-sky-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  : "text-faint hover:text-frost",
              )}
            >
              {SUBJECT_LABEL[value]}
              <span className="ml-1.5 opacity-60">
                {unitCounts[value]}u·{topicCounts[value]}t
              </span>
            </button>
          ))}
        </div>

        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <input
            type="search"
            value={filters.query}
            onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
            placeholder="Search topics and questions…"
            aria-label="Search topics and questions"
            className="h-9 w-full rounded-lg border border-stroke bg-ink-900 pl-8 pr-8 text-xs text-frost outline-none transition-colors placeholder:text-faint hover:border-sky-500/50 focus-visible:ring-2 focus-visible:ring-sky-500"
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
            onFiltersChange({ ...filters, status: event.target.value as StatusFilter })
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
            onFiltersChange({ ...filters, lecture: event.target.value as LectureFilter })
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

        {active ? (
          <SiteButton
            variant="ghost"
            size="sm"
            onClick={() => onFiltersChange({ query: "", status: "all", lecture: "all" })}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </SiteButton>
        ) : null}

        {showExpandToggle ? (
        <SiteButton
          variant="ghost"
          size="sm"
          onClick={allExpanded ? onCollapseAll : onExpandAll}
          title={allExpanded ? "Collapse every unit" : "Expand every unit"}
        >
          {allExpanded ? (
            <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
          )}
          {allExpanded ? "Collapse all" : "Expand all"}
        </SiteButton>
        ) : null}

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
          {selecting ? "Done" : "Select"}
        </SiteButton>

        <span className="type-accent-xs text-faint">
          {active ? `${matchCount}/${subjectTopicCount}` : `${subjectTopicCount}`} topics
        </span>
      </div>
    </header>
  );
}
