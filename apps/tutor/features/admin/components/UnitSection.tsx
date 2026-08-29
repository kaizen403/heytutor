"use client";

import type { ReactNode } from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { PlainButton } from "@/components/ui/site-button";
import { cn } from "@/lib/utils";
import { Checkbox } from "./Checkbox";

export interface UnitSummary {
  /** Topics currently visible under the active filters. */
  shown: number;
  /** Topics in the unit before filtering. */
  total: number;
  recorded: number;
  running: number;
  accepted: number;
}

interface UnitSectionProps {
  number: number;
  title: string;
  tags: readonly string[];
  summary: UnitSummary;
  expanded: boolean;
  onToggleExpanded: () => void;
  selecting: boolean;
  allSelected: boolean;
  someSelected: boolean;
  selectableCount: number;
  onToggleSelected: (selected: boolean) => void;
  deletableCount: number;
  onDeleteLectures: () => void;
  children: ReactNode;
}

export function UnitSection({
  number,
  title,
  tags,
  summary,
  expanded,
  onToggleExpanded,
  selecting,
  allSelected,
  someSelected,
  selectableCount,
  onToggleSelected,
  deletableCount,
  onDeleteLectures,
  children,
}: UnitSectionProps) {
  const filtered = summary.shown !== summary.total;

  return (
    <section className="glass card-lift overflow-hidden rounded-xl">
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 transition-colors",
          expanded ? "border-b border-stroke bg-white/[0.04]" : "hover:bg-white/[0.03]",
        )}
      >
        {selecting ? (
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            disabled={selectableCount === 0}
            onCheckedChange={onToggleSelected}
            aria-label={`Select every question in Unit ${number}`}
            title={
              selectableCount === 0
                ? "No question fixtures in this unit yet"
                : `Select all ${selectableCount} questions in this unit`
            }
          />
        ) : null}

        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-faint transition-transform",
              expanded && "rotate-90",
            )}
            aria-hidden
          />
          <span className="type-accent-xs shrink-0 rounded-md border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-sky-300">
            {number}
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-frost">{title}</span>
          {tags.map((tag) => (
            <span
              key={tag}
              className="type-accent-xs hidden shrink-0 rounded-full border border-stroke px-2 py-1 text-faint sm:inline"
            >
              {tag}
            </span>
          ))}
        </button>

        <div className="type-accent-xs flex shrink-0 items-center gap-3 text-faint">
          <span title={filtered ? `${summary.shown} of ${summary.total} topics match the filters` : undefined}>
            {filtered ? `${summary.shown}/${summary.total}` : summary.total} topics
          </span>
          {summary.running > 0 ? (
            <span className="text-sky-300" title="Lectures recording right now">
              {summary.running} recording
            </span>
          ) : null}
          <span title={`${summary.recorded} of ${summary.total * 3} lectures recorded`}>
            {summary.recorded} rec
          </span>
          <span title={`${summary.accepted} of ${summary.total} topics accepted`}>
            {summary.accepted} ok
          </span>
          {deletableCount > 0 ? (
            <PlainButton
              variant="danger"
              className="h-6 px-1.5"
              onClick={onDeleteLectures}
              title={`Delete ${deletableCount} recording${deletableCount === 1 ? "" : "s"} in this unit`}
            >
              <Trash2 className="h-3 w-3" />
              {deletableCount}
            </PlainButton>
          ) : null}
        </div>
      </div>

      {expanded ? <ul className="flex flex-col">{children}</ul> : null}
    </section>
  );
}
