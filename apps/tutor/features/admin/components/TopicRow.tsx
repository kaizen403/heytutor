"use client";

import { ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SyllabusItem } from "../lib/parseSyllabus";
import { PROBE_DIFFICULTIES, type ProbeDifficulty, type ProbeQuestion } from "../lib/probes";
import type { ItemStatus } from "../lib/progressStorage";
import { Checkbox } from "./Checkbox";
import { DifficultyChips } from "./DifficultyChips";
import { StatusBadge } from "./StatusBadge";

interface TopicRowProps {
  item: SyllabusItem;
  probes: ProbeQuestion[];
  checked: boolean;
  status: ItemStatus;
  selecting: boolean;
  selectedIds: Set<string>;
  expanded: boolean;
  recorded: Partial<Record<ProbeDifficulty, string>>;
  recording?: Partial<Record<ProbeDifficulty, string>>;
  onToggleSelected: (ids: string[], selected: boolean) => void;
  onToggleExpanded: () => void;
  onOpenSheet: () => void;
  onWatch: (boardId: string, difficulty: ProbeDifficulty) => void;
  onWatchLive?: (boardId: string, difficulty: ProbeDifficulty) => void;
  onNotes: (boardId: string, difficulty: ProbeDifficulty) => void;
  onDelete: (boardId: string, difficulty: ProbeDifficulty) => void;
}

export function TopicRow({
  item,
  probes,
  checked,
  status,
  selecting,
  selectedIds,
  expanded,
  recorded,
  recording = {},
  onToggleSelected,
  onToggleExpanded,
  onOpenSheet,
  onWatch,
  onWatchLive,
  onNotes,
  onDelete,
}: TopicRowProps) {
  const probeIds = probes.map((probe) => probe.id);
  const selectedCount = probeIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = probeIds.length > 0 && selectedCount === probeIds.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const hasFixtures = probes.length > 0;

  return (
    <>
      <div
        className={cn(
          "group flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-[#1E1E21]",
          checked && "bg-[rgba(201,201,210,0.08)]",
        )}
      >
        {selecting ? (
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            disabled={!hasFixtures}
            onCheckedChange={(selected) => onToggleSelected(probeIds, selected)}
            aria-label={`Select ${item.text}`}
            title={hasFixtures ? "Select" : "No lecture fixtures for this topic yet"}
            className="mt-0.5"
          />
        ) : null}
        <button type="button" onClick={onOpenSheet} className="min-w-0 flex-1 text-left">
          <span className="text-sm leading-snug text-[#F2F2F4]">{item.text}</span>
        </button>
        <div className="pt-0.5">
          <DifficultyChips
            recorded={recorded}
            recording={recording}
            onWatch={onWatch}
            onWatchLive={onWatchLive}
            onDelete={onDelete}
          />
        </div>
        <StatusBadge status={status} />
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse difficulties" : "Expand difficulties"}
          className="shrink-0 rounded-md p-1 text-[#717177] transition-colors hover:bg-[#2E2E33] hover:text-[#C9C9D2]"
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
        </button>
      </div>

      {expanded ? (
        <ul className="mb-2 ml-8 flex flex-col gap-1 border-l border-[#2E2E33] pl-3">
          {PROBE_DIFFICULTIES.map((difficulty) => {
            const probe = probes.find((entry) => entry.difficulty === difficulty);
            const boardId = recorded[difficulty];
            const liveBoardId = recording[difficulty];
            const isRecording = Boolean(liveBoardId);
            const canWatchLive = Boolean(liveBoardId) && Boolean(onWatchLive);
            const canWatch = Boolean(boardId) && !isRecording;
            return (
              <li key={difficulty} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[#1E1E21]">
                {selecting ? (
                  <Checkbox
                    checked={probe ? selectedIds.has(probe.id) : false}
                    disabled={!probe}
                    onCheckedChange={(selected) => {
                      if (probe) {
                        onToggleSelected([probe.id], selected);
                      }
                    }}
                    aria-label={`Select ${difficulty} for ${item.text}`}
                    title="Select"
                    className="mt-0.5"
                  />
                ) : null}
                <span className="w-16 shrink-0 pt-0.5 text-xs capitalize text-[#A6A6AE]">{difficulty}</span>
                <button
                  type="button"
                  onClick={onOpenSheet}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    data-probe-question={probe ? probe.id : undefined}
                    className="block whitespace-pre-wrap break-words text-xs leading-relaxed text-[#C9C9D2]"
                  >
                    {probe ? probe.question : "No fixture yet"}
                  </span>
                </button>
                {canWatchLive && liveBoardId ? (
                  <div className="flex shrink-0 items-center gap-1 pt-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => onWatchLive?.(liveBoardId, difficulty)}
                    >
                      Watch Live
                    </Button>
                  </div>
                ) : boardId && canWatch ? (
                  <div className="flex shrink-0 items-center gap-1 pt-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => onWatch(boardId, difficulty)}
                    >
                      Watch
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => onNotes(boardId, difficulty)}
                    >
                      Notes
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-[#A6A6AE] hover:text-[#E06858]"
                      onClick={() => onDelete(boardId, difficulty)}
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
