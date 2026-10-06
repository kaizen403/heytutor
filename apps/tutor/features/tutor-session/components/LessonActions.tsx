"use client";

import { RotateCcw } from "lucide-react";
import {
  downloadIsBusy,
  type DownloadState,
} from "@/features/tutor-session/lib/download/downloadState";
import {
  DEFAULT_LECTURE_FILE_TYPE,
  type LectureFileType,
} from "@/lib/account/lessonSettings";
import { cn } from "@/lib/utils";
import { DownloadControl } from "./download/DownloadControl";
import {
  downloadStateFromLegacy,
  type LegacyExportProgress,
} from "./download/downloadView";

export interface LessonActionsProps {
  canReplay: boolean;
  isReplaying?: boolean;
  onReplay: () => void;
  lectureFileType?: LectureFileType;
  compact?: boolean;
  /** Keep toolbar buttons visible (disabled when unavailable). */
  alwaysVisible?: boolean;

  /** What the download is doing. When absent it is derived from the legacy props below. */
  downloadState?: DownloadState;
  /** Notes PDF can start now. Falls back to `canDownload`. */
  canDownloadPdf?: boolean;
  /** Video can start now. Falls back to `canDownloadLecture`. */
  canDownloadVideo?: boolean;
  /** The lesson is live or stopped, so a new file covers it up to now. */
  downloadPartial?: boolean;
  /** Why the files are unavailable, shown on the disabled control. */
  downloadUnavailableReason?: string;
  onDownloadPdf?: () => void;
  onDownloadVideo?: () => void;
  onCancelDownload?: () => void;
  onDismissDownload?: () => void;

  /** @deprecated Pass `canDownloadPdf`. */
  canDownload?: boolean;
  /** @deprecated Pass `canDownloadVideo`. */
  canDownloadLecture?: boolean;
  /** @deprecated Pass `downloadState`. */
  isDownloading?: boolean;
  /** @deprecated Pass `downloadState`. */
  isExportingLecture?: boolean;
  /** @deprecated Pass `downloadState`. */
  lectureExportProgress?: LegacyExportProgress | null;
  /** @deprecated Pass `downloadState`. */
  lectureExportError?: string | null;
  /** @deprecated Pass `onDownloadPdf`. */
  onDownload?: () => void;
  /** @deprecated Pass `onDownloadVideo`. */
  onDownloadLecture?: () => void;
  /** @deprecated Pass `onCancelDownload`. */
  onCancelLectureExport?: () => void;
}

export function LessonActions({
  canReplay,
  isReplaying = false,
  onReplay,
  lectureFileType = DEFAULT_LECTURE_FILE_TYPE,
  compact = false,
  alwaysVisible = false,
  downloadState,
  canDownloadPdf,
  canDownloadVideo,
  downloadPartial = false,
  downloadUnavailableReason,
  onDownloadPdf,
  onDownloadVideo,
  onCancelDownload,
  onDismissDownload,
  canDownload = false,
  canDownloadLecture = false,
  isDownloading = false,
  isExportingLecture = false,
  lectureExportProgress = null,
  lectureExportError = null,
  onDownload,
  onDownloadLecture,
  onCancelLectureExport,
}: LessonActionsProps) {
  const state =
    downloadState ??
    downloadStateFromLegacy({
      isDownloading,
      isExportingLecture,
      progress: lectureExportProgress,
      error: lectureExportError,
    });
  const pdfAllowed = canDownloadPdf ?? canDownload;
  const videoAllowed = canDownloadVideo ?? canDownloadLecture;
  const busy = downloadIsBusy(state);

  const showReplay = alwaysVisible || canReplay;
  const showDownload = alwaysVisible || pdfAllowed || videoAllowed || state.kind !== "idle";
  if (!showReplay && !showDownload) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {showReplay && (
        <button
          type="button"
          onClick={onReplay}
          disabled={!canReplay || busy}
          aria-label="Replay lecture"
          className={cn(
            "btn-plain btn-ghost type-accent-s shrink-0 rounded-full",
            compact
              ? "h-11 w-11 px-0"
              : "h-10 w-10 px-0 sm:h-8 sm:w-auto sm:gap-1.5 sm:px-3",
          )}
        >
          <RotateCcw
            className={cn("h-3.5 w-3.5", isReplaying && "motion-safe:animate-spin")}
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
        <DownloadControl
          state={state}
          canDownloadPdf={pdfAllowed}
          canDownloadVideo={videoAllowed}
          partial={downloadPartial}
          videoFileType={lectureFileType}
          unavailableReason={downloadUnavailableReason}
          blocked={isReplaying}
          compact={compact}
          onDownloadPdf={onDownloadPdf ?? onDownload}
          onDownloadVideo={onDownloadVideo ?? onDownloadLecture}
          onCancel={onCancelDownload ?? onCancelLectureExport}
          onDismiss={onDismissDownload}
        />
      )}
    </div>
  );
}
