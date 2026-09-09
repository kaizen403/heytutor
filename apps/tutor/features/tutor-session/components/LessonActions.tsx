"use client";

import { useEffect, useRef, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { formatReplayTime } from "@/lib/replay/replayTimeline";
import type { LectureExportProgress } from "@/lib/lecture-export/exportLectureMp4";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

export interface LessonActionsProps {
  canReplay: boolean;
  canDownload?: boolean;
  canDownloadLecture?: boolean;
  isReplaying?: boolean;
  isDownloading?: boolean;
  isExportingLecture?: boolean;
  lectureExportProgress?: LectureExportProgress | null;
  lectureExportError?: string | null;
  onReplay: () => void;
  onDownload?: () => void;
  onDownloadLecture?: () => void;
  onCancelLectureExport?: () => void;
  compact?: boolean;
  /** Keep toolbar buttons visible (disabled when unavailable). */
  alwaysVisible?: boolean;
}

export function LessonActions({
  canReplay,
  canDownload = false,
  canDownloadLecture = false,
  isReplaying = false,
  isDownloading = false,
  isExportingLecture = false,
  lectureExportProgress = null,
  lectureExportError = null,
  onReplay,
  onDownload,
  onDownloadLecture,
  onCancelLectureExport,
  compact = false,
  alwaysVisible = false,
}: LessonActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const menuVisible = menuOpen && !isExportingLecture;

  if (!alwaysVisible && !canReplay && !canDownload && !canDownloadLecture) {
    return null;
  }

  const buttonClass = cn(
    "btn-plain btn-ghost shrink-0 rounded-full",
    compact
      ? "h-10 w-10 px-0 sm:h-8 sm:w-8"
      : "h-10 w-10 px-0 sm:h-8 sm:w-auto sm:gap-1.5 sm:px-3",
  );

  const showReplay = alwaysVisible || canReplay;
  const showDownload =
    alwaysVisible || canDownload || canDownloadLecture || isExportingLecture;
  const busy = isReplaying || isDownloading || isExportingLecture;
  const downloadDisabled = isExportingLecture
    ? false
    : busy || (!canDownload && !canDownloadLecture);
  const progressLabel = lectureExportProgress
    ? `${formatReplayTime(lectureExportProgress.currentMs)} / ${formatReplayTime(lectureExportProgress.totalMs)}`
    : "Generating…";

  if (!showReplay && !showDownload) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 sm:gap-1.5">
      {showReplay && (
        <button
          type="button"
          onClick={onReplay}
          disabled={!canReplay || isExportingLecture}
          aria-label="Replay lecture"
          className={cn(
            buttonClass,
            "text-[11px]",
          )}
        >
          <RotateCcw
            className={cn("h-3.5 w-3.5", isReplaying && "animate-spin")}
            aria-hidden
          />
          {!compact && (
            <span className="hidden sm:inline">
              {isReplaying ? "Replaying…" : "Replay"}
            </span>
          )}
        </button>
      )}
      {showDownload && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => {
              if (isExportingLecture) {
                onCancelLectureExport?.();
                return;
              }
              setMenuOpen((open) => !open);
            }}
            disabled={downloadDisabled}
            aria-label={
              isExportingLecture
                ? "Cancel lecture download"
                : "Download notes or lecture"
            }
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className={cn(
              buttonClass,
              "text-[11px]",
            )}
          >
            {isDownloading || isExportingLecture ? (
              <Spinner size={13} className="text-sky-500" />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
            {!compact && (
              <span className="hidden sm:inline">
                {isExportingLecture
                  ? progressLabel
                  : isDownloading
                    ? "Generating…"
                    : "Download"}
              </span>
            )}
          </button>
          {menuVisible ? (
            <div
              role="menu"
              className="glass-deep animate-fade-up absolute right-0 z-[80] mt-1 min-w-[11.5rem] rounded-xl p-1"
            >
              {onDownload ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canDownload || busy}
                  onClick={() => {
                    setMenuOpen(false);
                    onDownload();
                  }}
                  className="type-accent-xs flex w-full items-center rounded-lg px-2.5 py-2 text-left text-soft transition-colors hover:bg-white/5 hover:text-frost disabled:opacity-40"
                >
                  Notes (PDF)
                </button>
              ) : null}
              {onDownloadLecture ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canDownloadLecture || busy}
                  onClick={() => {
                    setMenuOpen(false);
                    onDownloadLecture();
                  }}
                  className="type-accent-xs flex w-full items-center rounded-lg px-2.5 py-2 text-left text-soft transition-colors hover:bg-white/5 hover:text-frost disabled:opacity-40"
                >
                  Lecture (MP4)
                </button>
              ) : null}
            </div>
          ) : null}
          {lectureExportError ? (
            <p
              className="glass-deep absolute right-0 top-full z-50 mt-1 max-w-[16rem] rounded-lg px-2 py-1 text-[11px] text-danger"
              role="status"
            >
              {lectureExportError}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
