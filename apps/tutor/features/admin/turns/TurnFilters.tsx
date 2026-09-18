"use client";

import { X } from "lucide-react";
import type { TurnsOutcomeFilter } from "@/lib/admin/types";
import { SiteButton } from "@/components/ui/site-button";
import { FilterSelect } from "../shared/components/FilterSelect";

const OUTCOME_OPTIONS: Array<{ value: TurnsOutcomeFilter; label: string }> = [
  { value: "all", label: "All outcomes" },
  { value: "validated", label: "Verified diagram" },
  { value: "failed", label: "Without verified diagram" },
];

const DAYS_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
  { value: "all", label: "All time" },
];

interface TurnFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  outcome: TurnsOutcomeFilter;
  onOutcomeChange: (value: TurnsOutcomeFilter) => void;
  days: string;
  onDaysChange: (value: string) => void;
  /** The fails page is always filtered to failed turns, so it hides the outcome select. */
  lockOutcome?: boolean;
  onClear?: () => void;
  active: boolean;
}

export function TurnFilters({
  searchInput,
  onSearchInputChange,
  outcome,
  onOutcomeChange,
  days,
  onDaysChange,
  lockOutcome = false,
  onClear,
  active,
}: TurnFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[16rem] flex-1">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
          placeholder="Search questions…"
          aria-label="Search questions"
          className="h-9 w-full rounded-lg border border-stroke bg-ink-900 px-3 text-xs text-frost outline-none transition-colors placeholder:text-faint hover:border-sky-500/50 focus-visible:ring-2 focus-visible:ring-sky-500"
        />
        {searchInput ? (
          <button
            type="button"
            onClick={() => onSearchInputChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-frost"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {lockOutcome ? null : (
        <FilterSelect
          value={outcome}
          options={OUTCOME_OPTIONS}
          onChange={(value) => onOutcomeChange(value as TurnsOutcomeFilter)}
          ariaLabel="Filter by outcome"
        />
      )}
      <FilterSelect
        value={days}
        options={DAYS_OPTIONS}
        onChange={onDaysChange}
        ariaLabel="Filter by time range"
      />
      {active && onClear ? (
        <SiteButton variant="ghost" size="sm" onClick={onClear}>
          <X className="h-3.5 w-3.5" aria-hidden />
          Clear
        </SiteButton>
      ) : null}
    </div>
  );
}
