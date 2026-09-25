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
  /** Easy/medium/hard slots that actually have a probe fixture. */
  possible: number;
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

function completionWidth(part: number, total: number): string {
  if (total <= 0 || part <= 0) return "0%";
  return `${Math.min(100, (part / total) * 100)}%`;
}

function UnitCompletionBar({
  recorded,
  running,
  possible,
}: {
  recorded: number;
  running: number;
  possible: number;
}) {
  if (possible <= 0) return null;

  const recordedWidth = completionWidth(recorded, possible);
  const remaining = Math.max(0, possible - recorded);
  const runningWidth = completionWidth(Math.min(running, remaining), possible);
  const label = `${recorded} of ${possible} lectures recorded`;

  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      title={running > 0 ? `${label}, ${running} recording` : label}
      aria-label={label}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={possible}
      aria-valuenow={recorded}
    >
      <span
        className="flex h-1 w-16 overflow-hidden rounded-full bg-ink-700"
        aria-hidden
      >
        {recorded > 0 ? (
          <span
            className="h-full shrink-0 bg-sky-500/80"
            style={{ width: recordedWidth }}
          />
        ) : null}
        {running > 0 && runningWidth !== "0%" ? (
          <span
            className="h-full shrink-0 bg-sky-500/35"
            style={{ width: runningWidth }}
          />
        ) : null}
      </span>
      <span className="type-accent-xs tabular-nums text-faint">
        {recorded}/{possible}
      </span>
    </span>
  );
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
    <section
      className={cn(
        "glass card-lift rounded-xl",
        expanded ? "overflow-visible" : "overflow-hidden",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 transition-colors",
          expanded
            ? "border-b border-stroke bg-white/[0.04]"
            : "hover:bg-white/[0.03]",
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
          className="flex min-w-[min(100%,16rem)] flex-1 flex-wrap items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
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
          <span className="min-w-0 truncate text-sm font-medium text-frost">
            {title}
          </span>
          <UnitCompletionBar
            recorded={summary.recorded}
            running={summary.running}
            possible={summary.possible}
          />
          {tags.map((tag) => (
            <span
              key={tag}
              className="type-accent-xs hidden shrink-0 rounded-full border border-stroke px-2 py-1 text-faint sm:inline"
            >
              {tag}
            </span>
          ))}
        </button>

        <div className="type-accent-xs flex flex-wrap items-center gap-3 text-faint">
          <span
            title={
              filtered
                ? `${summary.shown} of ${summary.total} topics match the filters`
                : undefined
            }
          >
            {filtered ? `${summary.shown}/${summary.total}` : summary.total}{" "}
            topics
          </span>
          {summary.running > 0 ? (
            <span className="text-sky-300" title="Lectures recording right now">
              {summary.running} recording
            </span>
          ) : null}
          <span
            title={`${summary.accepted} of ${summary.total} topics accepted`}
          >
            {summary.accepted} accepted
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
