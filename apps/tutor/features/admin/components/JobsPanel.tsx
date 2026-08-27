"use client";

import { Eye, Radio, ScrollText, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BoardEntry } from "@/lib/boards/types";
import type { LectureJob } from "../lib/lectureJobs";
import {
  CONCURRENCY_OPTIONS,
  countJobsByStatus,
  isLectureDeletable,
  isLectureLiveWatchable,
  isLectureWatchable,
  jobProgressPercent,
  lectureJobTitle,
} from "../lib/lectureJobs";

interface JobsPanelProps {
  jobs: LectureJob[];
  now: number;
  onStop: () => void;
  busy: boolean;
  concurrency: number;
  onConcurrencyChange: (count: number) => void;
  lastBatchCount: number;
  onStartAgain: () => void;
  onClear: () => void;
  boards: BoardEntry[];
  recordingBoardIds: ReadonlySet<string>;
  onWatch: (boardId: string) => void;
  onWatchLive?: (boardId: string) => void;
  onNotes: (boardId: string) => void;
  onDelete: (boardId: string) => void;
  onDeleteCompleted?: () => void;
  completedDeleteCount?: number;
}

function statusLabel(job: LectureJob): string {
  if (job.status === "running") {
    return job.phase ?? "running";
  }
  if (job.status === "failed") {
    return job.error ?? "failed";
  }
  return job.status;
}

export function JobsPanel({
  jobs,
  now,
  onStop,
  busy,
  concurrency,
  onConcurrencyChange,
  lastBatchCount,
  onStartAgain,
  onClear,
  boards,
  recordingBoardIds,
  onWatch,
  onWatchLive,
  onNotes,
  onDelete,
  onDeleteCompleted,
  completedDeleteCount = 0,
}: JobsPanelProps) {
  const counts = countJobsByStatus(jobs);
  const previewById = new Map(boards.map((board) => [board.id, board.preview]));

  return (
    <section className="rounded-xl border border-[#2E2E33] bg-[#151517] px-4 py-3.5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[#F2F2F4]">Jobs</h2>
          <p className="mt-0.5 text-[11px] text-[#A6A6AE]">
            {jobs.length === 0
              ? "Select questions, then Start testing"
              : `${counts.queued} queued · ${counts.running} running · ${counts.complete} done · ${counts.failed} failed`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1"
            title="How many lectures run together. The rest wait in the queue."
          >
            <span className="text-[11px] text-[#A6A6AE]">At a time</span>
            {CONCURRENCY_OPTIONS.map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => onConcurrencyChange(count)}
                className={cn(
                  "h-7 w-7 rounded-md text-xs font-medium",
                  concurrency === count
                    ? "bg-[rgba(201,201,210,0.12)] text-[#C9C9D2]"
                    : "text-[#A6A6AE] hover:bg-[#1E1E21]",
                )}
              >
                {count}
              </button>
            ))}
          </div>
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded-full border border-[#2E2E33] px-3 py-1 text-[11px] font-medium text-[#F2F2F4] hover:bg-[#1E1E21]"
            >
              Stop testing
            </button>
          ) : null}
          {lastBatchCount > 0 ? (
            <button
              type="button"
              onClick={onStartAgain}
              className="rounded-full border border-[#C9C9D2] bg-[rgba(201,201,210,0.12)] px-3 py-1 text-[11px] font-medium text-[#C9C9D2] hover:bg-[rgba(201,201,210,0.2)]"
            >
              Start again ({lastBatchCount})
            </button>
          ) : null}
          {completedDeleteCount > 0 && onDeleteCompleted ? (
            <button
              type="button"
              onClick={onDeleteCompleted}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#2E2E33] px-3 py-1 text-[11px] font-medium text-[#A6A6AE] hover:border-[#E06858] hover:text-[#E06858]"
            >
              <Trash2 className="h-3 w-3" />
              Delete recordings ({completedDeleteCount})
            </button>
          ) : null}
          {!busy && jobs.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-full border border-[#2E2E33] px-3 py-1 text-[11px] font-medium text-[#A6A6AE] hover:bg-[#1E1E21]"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {jobs.length === 0 ? null : (
        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {jobs.map((job) => {
            const percent = jobProgressPercent(job, now);
            const boardId = job.boardId;
            const watchable = isLectureWatchable(job, {
              isRecording: Boolean(boardId && recordingBoardIds.has(boardId)),
              boardPreview: boardId ? previewById.get(boardId) : undefined,
            });
            const live = isLectureLiveWatchable(job, {
              isRecording: Boolean(boardId && recordingBoardIds.has(boardId)),
            });
            const deletable = isLectureDeletable(job, {
              isRecording: Boolean(boardId && recordingBoardIds.has(boardId)),
            });
            return (
              <li key={job.id} className="rounded-lg border border-[#2E2E33] bg-[#0B0B0C] px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-xs text-[#F2F2F4]">
                    {lectureJobTitle(job)}
                  </p>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                      job.status === "running" && "bg-[rgba(201,201,210,0.12)] text-[#C9C9D2]",
                      job.status === "queued" && "bg-[#1E1E21] text-[#A6A6AE]",
                      job.status === "complete" && "bg-[rgba(201,201,210,0.12)] text-[#C9C9D2]",
                      job.status === "failed" && "bg-[rgba(224,104,88,0.15)] text-[#E06858]",
                    )}
                  >
                    {statusLabel(job)}
                  </span>
                </div>
                {job.status === "running" || job.status === "complete" ? (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#2E2E33]">
                    <div
                      className="h-full rounded-full bg-[#C9C9D2] transition-[width] duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                ) : null}
                {live && boardId && onWatchLive ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onWatchLive(boardId)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#C9C9D2] bg-[rgba(201,201,210,0.12)] px-3 py-1 text-[11px] font-medium text-[#C9C9D2] hover:bg-[rgba(201,201,210,0.2)]"
                    >
                      <Radio className="h-3 w-3" />
                      Watch Live
                    </button>
                  </div>
                ) : watchable && boardId ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onWatch(boardId)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#C9C9D2] bg-[rgba(201,201,210,0.12)] px-3 py-1 text-[11px] font-medium text-[#C9C9D2] hover:bg-[rgba(201,201,210,0.2)]"
                    >
                      <Eye className="h-3 w-3" />
                      Watch lecture
                    </button>
                    <button
                      type="button"
                      onClick={() => onNotes(boardId)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#2E2E33] px-3 py-1 text-[11px] font-medium text-[#F2F2F4] hover:bg-[#1E1E21]"
                    >
                      <ScrollText className="h-3 w-3" />
                      View notes
                    </button>
                    {deletable ? (
                      <button
                        type="button"
                        onClick={() => onDelete(boardId)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#2E2E33] px-3 py-1 text-[11px] font-medium text-[#A6A6AE] hover:border-[#E06858] hover:text-[#E06858]"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    ) : null}
                  </div>
                ) : deletable && boardId ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onDelete(boardId)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#2E2E33] px-3 py-1 text-[11px] font-medium text-[#A6A6AE] hover:border-[#E06858] hover:text-[#E06858]"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete leftover
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
