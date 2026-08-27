"use client";

import { Eye, Loader2, Radio, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROBE_DIFFICULTIES, type ProbeDifficulty } from "../lib/probes";

const LABELS: Record<ProbeDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

interface DifficultyChipsProps {
  recorded: Partial<Record<ProbeDifficulty, string>>;
  recording?: Partial<Record<ProbeDifficulty, string>>;
  onWatch: (boardId: string, difficulty: ProbeDifficulty) => void;
  onWatchLive?: (boardId: string, difficulty: ProbeDifficulty) => void;
  onDelete?: (boardId: string, difficulty: ProbeDifficulty) => void;
}

export function DifficultyChips({
  recorded,
  recording = {},
  onWatch,
  onWatchLive,
  onDelete,
}: DifficultyChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PROBE_DIFFICULTIES.map((difficulty) => {
        const liveBoardId = recording[difficulty];
        const boardId = recorded[difficulty];
        const isRecording = Boolean(liveBoardId);
        const canWatchLive = Boolean(liveBoardId) && Boolean(onWatchLive);
        const canWatch = Boolean(boardId) && !isRecording;
        return (
          <span key={difficulty} className="inline-flex items-center gap-0.5">
            <button
              type="button"
              disabled={!canWatchLive && !canWatch}
              onClick={() => {
                if (liveBoardId && onWatchLive) {
                  onWatchLive(liveBoardId, difficulty);
                  return;
                }
                if (boardId && canWatch) {
                  onWatch(boardId, difficulty);
                }
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                canWatchLive || canWatch
                  ? "border border-[#C9C9D2] bg-[rgba(201,201,210,0.12)] text-[#C9C9D2] hover:bg-[rgba(201,201,210,0.2)]"
                  : "border border-[#2E2E33] bg-[#1E1E21] text-[#717177]",
                isRecording && !canWatchLive && "border-[rgba(201,201,210,0.45)] text-[#A6A6AE]",
              )}
              aria-label={
                canWatchLive
                  ? `Watch ${LABELS[difficulty]} lecture live`
                  : canWatch
                    ? `Watch ${LABELS[difficulty]} lecture`
                    : isRecording
                      ? `Recording ${LABELS[difficulty]} lecture`
                      : `${LABELS[difficulty]} lecture not recorded`
              }
            >
              {canWatchLive ? <Radio className="h-2.5 w-2.5" /> : null}
              {isRecording && !canWatchLive ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
              {canWatch ? <Eye className="h-2.5 w-2.5" /> : null}
              {canWatchLive
                ? `Live ${LABELS[difficulty]}`
                : canWatch
                  ? `Watch ${LABELS[difficulty]}`
                  : LABELS[difficulty]}
            </button>
            {canWatch && boardId && onDelete ? (
              <button
                type="button"
                aria-label={`Delete ${LABELS[difficulty]} lecture`}
                onClick={() => onDelete(boardId, difficulty)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#717177] hover:bg-[#2E2E33] hover:text-[#E06858]"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
