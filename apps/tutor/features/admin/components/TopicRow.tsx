"use client";

import { ChevronRight, ScrollText, Trash2 } from "lucide-react";
import { PlainButton } from "@/components/ui/site-button";
import { cn } from "@/lib/utils";
import type { DifficultyState } from "../lib/lectureState";
import type { SyllabusItem } from "../lib/parseSyllabus";
import { PROBE_DIFFICULTIES, type ProbeDifficulty, type ProbeQuestion } from "../lib/probes";
import type { ItemStatus } from "../lib/progressStorage";
import { Checkbox } from "./Checkbox";
import { DifficultyCell } from "./DifficultyCell";
import { StatusBadge } from "./StatusBadge";

export interface TopicRowProps {
  item: SyllabusItem;
  probes: readonly ProbeQuestion[];
  states: Record<ProbeDifficulty, DifficultyState>;
  /** Board to act on per difficulty - the live board while running, else the recording. */
  boardIds: Partial<Record<ProbeDifficulty, string>>;
  checked: boolean;
  status: ItemStatus;
  selecting: boolean;
  selectedIds: ReadonlySet<string>;
  expanded: boolean;
  onToggleSelected: (ids: string[], selected: boolean) => void;
  onToggleExpanded: () => void;
  onOpenSheet: () => void;
  onActivate: (difficulty: ProbeDifficulty) => void;
  onNotes: (difficulty: ProbeDifficulty) => void;
  onDelete: (difficulty: ProbeDifficulty) => void;
}

export function TopicRow({
  item,
  probes,
  states,
  boardIds,
  checked,
  status,
  selecting,
  selectedIds,
  expanded,
  onToggleSelected,
  onToggleExpanded,
  onOpenSheet,
  onActivate,
  onNotes,
  onDelete,
}: TopicRowProps) {
  const probeIds = probes.map((probe) => probe.id);
  const selectedCount = probeIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = probeIds.length > 0 && selectedCount === probeIds.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const hasFixtures = probes.length > 0;

  return (
    <li className="border-b border-stroke/60 last:border-b-0">
      <div
        className={cn(
          "group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-white/[0.035]",
          checked && "bg-sky-500/[0.06]",
          selecting && selectedCount > 0 && "bg-sky-500/[0.10]",
        )}
      >
        {selecting ? (
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            disabled={!hasFixtures}
            onCheckedChange={(selected) => onToggleSelected(probeIds, selected)}
            aria-label={`Select ${item.text}`}
            title={hasFixtures ? "Select all three difficulties" : "No question fixtures for this topic yet"}
          />
        ) : null}

        <button
          type="button"
          onClick={onOpenSheet}
          className="min-w-0 flex-1 text-left"
          title="Open review panel"
        >
          <span className="text-sm leading-snug text-frost/90 transition-colors group-hover:text-frost">
            {item.text}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {PROBE_DIFFICULTIES.map((difficulty) => (
            <DifficultyCell
              key={difficulty}
              difficulty={difficulty}
              state={states[difficulty]}
              onActivate={() => onActivate(difficulty)}
            />
          ))}
        </div>

        <div className="flex w-[7.5rem] shrink-0 justify-end">
          <StatusBadge status={status} />
        </div>

        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? `Hide questions for ${item.text}` : `Show questions for ${item.text}`}
          title={expanded ? "Hide questions" : "Show questions"}
          className="shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-ink-700 hover:text-sky-300"
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
        </button>
      </div>

      {expanded ? (
        <ul className="flex flex-col gap-1 border-t border-stroke bg-ink-950/50 px-3 py-2">
          {PROBE_DIFFICULTIES.map((difficulty) => {
            const probe = probes.find((entry) => entry.difficulty === difficulty);
            const state = states[difficulty];
            const boardId = boardIds[difficulty];
            const isRecorded = state === "recorded";
            const isRunning = state === "running";

            return (
              <li key={difficulty} className="flex items-start gap-3 rounded-md px-1 py-1.5">
                {selecting ? (
                  <Checkbox
                    checked={probe ? selectedIds.has(probe.id) : false}
                    disabled={!probe}
                    onCheckedChange={(selected) => {
                      if (probe) {
                        onToggleSelected([probe.id], selected);
                      }
                    }}
                    aria-label={`Select ${difficulty} question for ${item.text}`}
                    title={probe ? "Select this question" : "No fixture yet"}
                    className="mt-0.5"
                  />
                ) : null}

                <span className="type-accent-xs w-14 shrink-0 pt-1 text-faint">
                  {difficulty}
                </span>

                <p
                  data-probe-question={probe ? probe.id : undefined}
                  className={cn(
                    "min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed",
                    probe ? "text-sky-300" : "italic text-frost/25",
                  )}
                >
                  {probe ? probe.question : "No question fixture yet"}
                </p>

                <div className="flex shrink-0 items-center gap-1">
                  {isRunning && boardId ? (
                    <PlainButton variant="sky" onClick={() => onActivate(difficulty)}>
                      Watch live
                    </PlainButton>
                  ) : null}
                  {isRecorded && boardId ? (
                    <>
                      <PlainButton variant="ice" onClick={() => onActivate(difficulty)}>
                        Watch
                      </PlainButton>
                      <PlainButton onClick={() => onNotes(difficulty)}>
                        <ScrollText className="h-3 w-3" />
                        Notes
                      </PlainButton>
                      <PlainButton
                        variant="danger"
                        className="w-7 px-0"
                        onClick={() => onDelete(difficulty)}
                        aria-label={`Delete ${difficulty} lecture for ${item.text}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </PlainButton>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
