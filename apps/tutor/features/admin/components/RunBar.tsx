"use client";

import { useState } from "react";
import {
  ChevronDown,
  Eye,
  Radio,
  RotateCw,
  ScrollText,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { PlainButton, SiteButton } from "@/components/ui/site-button";
import { cn } from "@/lib/utils";
import type { BoardEntry } from "@/lib/boards/types";
import {
  CONCURRENCY_OPTIONS,
  countJobsByStatus,
  isLectureDeletable,
  isLectureLiveWatchable,
  isLectureWatchable,
  jobProgressPercent,
  lectureJobTitle,
  type LectureJob,
} from "../lib/lectureJobs";

interface RunBarProps {
  jobs: LectureJob[];
  now: number;
  busy: boolean;
  boards: BoardEntry[];
  recordingBoardIds: ReadonlySet<string>;
  concurrency: number;
  onConcurrencyChange: (count: number) => void;
  lastBatchCount: number;
  watchingBoardId: string | null;
  onStop: () => void;
  onStartAgain: () => void;
  onClear: () => void;
  onWatchLive: (boardId: string) => void;
  onWatch: (boardId: string) => void;
  onNotes: (boardId: string) => void;
  onDelete: (boardId: string) => void;
  onDeleteCompleted?: () => void;
  completedDeleteCount: number;
}

function statusLabel(job: LectureJob): string {
  if (job.status === "running") {
    if (job.phase === "drawing" || job.phase === "speaking") return "Teaching";
    if (job.phase === "planning" || job.phase === "thinking") return "Preparing";
    return "Starting";
  }
  if (job.status === "failed") return "Failed";
  if (job.status === "complete") return "Complete";
  return "Waiting";
}

export function RunBar({
  jobs,
  now,
  busy,
  boards,
  recordingBoardIds,
  concurrency,
  onConcurrencyChange,
  lastBatchCount,
  watchingBoardId,
  onStop,
  onStartAgain,
  onClear,
  onWatchLive,
  onWatch,
  onNotes,
  onDelete,
  onDeleteCompleted,
  completedDeleteCount,
}: RunBarProps) {
  const [open, setOpen] = useState(false);

  if (jobs.length === 0) {
    return null;
  }

  const counts = countJobsByStatus(jobs);
  const settled = counts.complete + counts.failed;
  const overall = Math.round((settled / jobs.length) * 100);
  const previewById = new Map(boards.map((board) => [board.id, board.preview]));

  return (
    <div className={cn("glass rounded-xl", busy && "glass-sky")}>
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-2 w-2 rounded-full",
                busy ? "animate-pulse bg-sky-400" : "bg-ink-500",
              )}
              aria-hidden
            />
            <p className="text-sm font-medium text-frost">
              {busy ? "Recording in progress" : "Last run"}
            </p>
          </div>
          <span className="text-xs tabular-nums text-soft">
            {settled}/{jobs.length}
          </span>
        </div>
        <p className="text-xs text-soft">
          {counts.running} recording · {counts.queued} waiting ·{" "}
          {counts.complete} complete
          {counts.failed > 0 ? (
            <span className="text-danger"> · {counts.failed} failed</span>
          ) : null}
        </p>
        <div
          className="h-1 overflow-hidden rounded-full bg-ink-700"
          role="progressbar"
          aria-label="Recording run progress"
          aria-valuemin={0}
          aria-valuemax={jobs.length}
          aria-valuenow={settled}
        >
          <div
            className="h-full rounded-full bg-sky-400 transition-[width] duration-500"
            style={{ width: `${overall}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-stroke px-4 py-3">
        <span className="text-xs text-soft" title="The rest wait in the queue">
          Record at a time
        </span>
        <div
          className="flex items-center gap-1"
          aria-label="Concurrent lectures"
        >
          {CONCURRENCY_OPTIONS.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => onConcurrencyChange(count)}
              aria-pressed={concurrency === count}
              aria-label={`${count} concurrent lectures`}
              className={cn(
                "h-7 w-7 rounded-md border text-xs font-medium transition-colors",
                concurrency === count
                  ? "border-sky-500/40 bg-sky-500/20 text-sky-200"
                  : "border-transparent text-faint hover:bg-ink-800 hover:text-frost",
              )}
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-stroke px-4 py-3">
        {busy ? (
          <SiteButton variant="ice" size="xs" onClick={onStop}>
            <Square className="h-3 w-3" aria-hidden />
            Stop run
          </SiteButton>
        ) : null}
        {!busy && lastBatchCount > 0 ? (
          <SiteButton variant="sky" size="xs" onClick={onStartAgain}>
            <RotateCw className="h-3 w-3" aria-hidden />
            Run again ({lastBatchCount})
          </SiteButton>
        ) : null}
        {completedDeleteCount > 0 && onDeleteCompleted ? (
          <PlainButton variant="danger" onClick={onDeleteCompleted}>
            <Trash2 className="h-3 w-3" aria-hidden />
            Delete {completedDeleteCount} recordings
          </PlainButton>
        ) : null}
        {!busy ? (
          <PlainButton
            onClick={onClear}
            title="Clear this run from the list. Recordings are kept."
          >
            <X className="h-3 w-3" aria-hidden />
            Clear run
          </PlainButton>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-t border-stroke px-4 py-2.5 text-left text-xs font-medium text-soft hover:text-frost"
      >
        {open ? "Hide" : "Show"} jobs ({jobs.length})
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto border-t border-stroke p-2">
          {jobs.map((job) => {
            const boardId = job.boardId;
            const isRecording = Boolean(
              boardId && recordingBoardIds.has(boardId),
            );
            const live = isLectureLiveWatchable(job, { isRecording });
            const watchable = isLectureWatchable(job, {
              isRecording,
              boardPreview: boardId ? previewById.get(boardId) : undefined,
            });
            const deletable = isLectureDeletable(job, { isRecording });
            const watching = Boolean(boardId && watchingBoardId === boardId);

            return (
              <li
                key={job.id}
                className={cn(
                  "rounded-lg border border-stroke bg-ink-900/60 px-3 py-2 transition-colors",
                  watching && "border-sky-500/60 bg-sky-500/10",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 break-words text-xs leading-snug text-frost">
                    {lectureJobTitle(job)}
                  </p>
                  <span
                    className={cn(
                      "type-accent-xs shrink-0 rounded-full border px-2 py-1",
                      job.status === "running" &&
                        "border-sky-500/40 bg-sky-500/15 text-sky-200",
                      job.status === "queued" &&
                        "border-stroke bg-ink-800 text-faint",
                      job.status === "complete" &&
                        "border-sky-500/25 bg-sky-500/10 text-sky-300",
                      job.status === "failed" &&
                        "border-danger/30 bg-danger/15 text-danger",
                    )}
                  >
                    {statusLabel(job)}
                  </span>
                </div>

                {job.status === "failed" && job.error ? (
                  <p className="mt-1 break-words text-xs text-danger">{job.error}</p>
                ) : null}

                {job.status === "running" || job.status === "complete" ? (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-700">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-600 to-sky-400 transition-[width] duration-500"
                      style={{ width: `${jobProgressPercent(job, now)}%` }}
                    />
                  </div>
                ) : null}

                {boardId && (live || watchable || deletable) ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {live ? (
                      <PlainButton
                        variant="sky"
                        onClick={() => onWatchLive(boardId)}
                      >
                        <Radio className="h-3 w-3" aria-hidden />
                        {watching ? "Watching" : "Watch live"}
                      </PlainButton>
                    ) : null}
                    {watchable ? (
                      <>
                        <PlainButton
                          variant="ice"
                          onClick={() => onWatch(boardId)}
                        >
                          <Eye className="h-3 w-3" aria-hidden />
                          Watch
                        </PlainButton>
                        <PlainButton onClick={() => onNotes(boardId)}>
                          <ScrollText className="h-3 w-3" aria-hidden />
                          Notes
                        </PlainButton>
                      </>
                    ) : null}
                    {deletable ? (
                      <PlainButton
                        variant="danger"
                        onClick={() => onDelete(boardId)}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                        {watchable ? "Delete" : "Leftover"}
                      </PlainButton>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
