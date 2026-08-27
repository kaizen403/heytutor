"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LectureJob } from "../lib/lectureJobs";
import {
  isLectureLiveWatchable,
  jobProgressPercent,
  lectureJobTitle,
  ongoingLectureJobs,
} from "../lib/lectureJobs";
import { liveRecordingsDockStyle } from "../lib/headlessRuntime";

interface LiveRecordingsDockProps {
  jobs: LectureJob[];
  now: number;
  recordingBoardIds: ReadonlySet<string>;
  watchingBoardId?: string | null;
  onWatchLive: (boardId: string) => void;
}

function phaseLabel(job: LectureJob): string {
  return job.phase ?? "running";
}

export function LiveRecordingsDock({
  jobs,
  now,
  recordingBoardIds,
  watchingBoardId,
  onWatchLive,
}: LiveRecordingsDockProps) {
  const ongoing = ongoingLectureJobs(jobs);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (ongoing.length === 0) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col items-end gap-2"
      style={liveRecordingsDockStyle()}
      data-live-recordings-dock=""
    >
      {open ? (
        <div
          className="w-full overflow-hidden rounded-xl border border-[#2E2E33] bg-[#151517] shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
          data-live-recordings-tab=""
        >
          <div className="border-b border-[#2E2E33] px-3 py-2">
            <p className="text-sm font-semibold text-[#F2F2F4]">Live recordings</p>
            <p className="mt-0.5 text-[11px] text-[#A6A6AE]">
              Select a question to watch it live
            </p>
          </div>
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto p-2">
            {ongoing.map((job) => {
              const boardId = job.boardId;
              const live = isLectureLiveWatchable(job, {
                isRecording: Boolean(boardId && recordingBoardIds.has(boardId)),
              });
              const percent = jobProgressPercent(job, now);
              const watching = Boolean(boardId && watchingBoardId === boardId);
              return (
                <li key={job.id}>
                  <button
                    type="button"
                    disabled={!live || !boardId}
                    onClick={() => {
                      if (!boardId || !live) {
                        return;
                      }
                      setOpen(false);
                      onWatchLive(boardId);
                    }}
                    className={cn(
                      "flex w-full flex-col rounded-lg border px-3 py-2 text-left",
                      live
                        ? "border-[#2E2E33] bg-[#0B0B0C] hover:border-[#C9C9D2]"
                        : "cursor-not-allowed border-[#2E2E33] bg-[#0B0B0C] opacity-60",
                      watching && "border-[#C9C9D2] bg-[rgba(201,201,210,0.08)]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-xs text-[#F2F2F4]">{lectureJobTitle(job)}</p>
                      <span className="shrink-0 rounded-full bg-[rgba(201,201,210,0.12)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#C9C9D2]">
                        {phaseLabel(job)}
                      </span>
                    </div>
                    {job.question.trim() ? (
                      <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-[#A6A6AE]">
                        {job.question.trim()}
                      </p>
                    ) : null}
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#2E2E33]">
                      <div
                        className="h-full rounded-full bg-[#C9C9D2] transition-[width] duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] font-medium text-[#C9C9D2]">
                      {live ? (watching ? "Watching live" : "Watch this lecture") : "Starting board…"}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-label={
          open
            ? "Hide live recordings"
            : `Show ${ongoing.length} live recording${ongoing.length === 1 ? "" : "s"}`
        }
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-2 rounded-full border border-[#C9C9D2] bg-[#151517] px-3 py-2 text-xs font-medium text-[#C9C9D2] shadow-[0_8px_24px_rgba(0,0,0,0.4)] hover:bg-[rgba(201,201,210,0.12)]"
      >
        <Radio className="h-3.5 w-3.5" />
        Live recordings ({ongoing.length})
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
    </div>
  );
}
