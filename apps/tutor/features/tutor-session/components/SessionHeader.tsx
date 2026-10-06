
import { Maximize, Minimize } from "lucide-react";
import { LessonActions } from "@/features/tutor-session/components/LessonActions";
import { SaveStatusChip } from "@/features/tutor-session/components/SaveStatusChip";
import type { LegacyExportProgress } from "@/features/tutor-session/components/download/downloadView";
import type { DownloadState } from "@/features/tutor-session/lib/download/downloadState";
import type { SaveStatus } from "@/features/tutor-session/lib/turn/saveStatus";
import type { LectureFileType } from "@/lib/account/lessonSettings";
import type { TutorPhase } from "../types";

/**
 * One face for every control on the right: 32 px tall on a wide header,
 * 44 px compact, fully rounded, 12 px labels and 14 px icons.
 */
const HEADER_CONTROL = "btn-plain shrink-0 rounded-full type-accent-s";
const HEADER_CONTROL_SIZE_COMPACT = "h-11 w-11 px-0";
const HEADER_CONTROL_SIZE_ICON = "h-10 w-10 px-0 sm:h-8 sm:w-8";
const HEADER_CONTROL_SIZE_LABEL = "h-10 w-10 px-0 sm:h-8 sm:w-auto sm:gap-1.5 sm:px-3";

interface SessionHeaderProps {
  /** When true, always show the nav expand button (mobile drawer / collapsed sidebar). */
  showNavButton?: boolean;
  navButtonClassName?: string;
  sidebarCollapsed?: boolean;
  onExpandSidebar: () => void;
  boardTitle: string;
  /** The board was asked a lesson that never saved. The subtitle says so. */
  boardStatus?: "unsaved";
  /** Whether the lesson on screen is stored. Renders a quiet chip after the title. */
  saveStatus?: SaveStatus;
  /** Resend the unsaved part of the lesson. Never teaches again. */
  onRetrySave?: () => void;
  canReplay: boolean;
  lectureFileType?: LectureFileType;
  isReplaying: boolean;
  phase: TutorPhase;
  compactActions?: boolean;
  notesOpen?: boolean;
  showNotesToggle?: boolean;
  onToggleNotes?: () => void;
  /**
   * The board owns the screen, so this bar floats over the paper's top margin
   * instead of taking layout from it. Nothing about the board resizes when it
   * comes and goes.
   */
  overlay?: boolean;
  /** The student has been still through a running lesson: withdraw. */
  chromeHidden?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onReplay: () => void;
  onStop: () => void;

  /** What the download is doing. When absent it is derived from the legacy props. */
  downloadState?: DownloadState;
  canDownloadPdf?: boolean;
  canDownloadVideo?: boolean;
  /** The lesson is live or stopped, so a new file covers it up to now. */
  downloadPartial?: boolean;
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

function displayBoardTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed || trimmed.toLowerCase() === "new board") {
    return "New board";
  }
  return trimmed;
}

export function SessionHeader({
  showNavButton = false,
  navButtonClassName,
  sidebarCollapsed = false,
  onExpandSidebar,
  boardTitle,
  boardStatus,
  saveStatus,
  onRetrySave,
  canReplay,
  lectureFileType,
  isReplaying,
  phase,
  compactActions = false,
  notesOpen = false,
  showNotesToggle = false,
  onToggleNotes,
  overlay = false,
  chromeHidden = false,
  isFullscreen = false,
  onToggleFullscreen,
  onReplay,
  onStop,
  downloadState,
  canDownloadPdf,
  canDownloadVideo,
  downloadPartial,
  downloadUnavailableReason,
  onDownloadPdf,
  onDownloadVideo,
  onCancelDownload,
  onDismissDownload,
  canDownload,
  canDownloadLecture,
  isDownloading,
  isExportingLecture,
  lectureExportProgress,
  lectureExportError,
  onDownload,
  onDownloadLecture,
  onCancelLectureExport,
}: SessionHeaderProps) {
  const isLive = phase !== "idle" || isReplaying;
  const title = displayBoardTitle(boardTitle);
  const isFreshBoard = !boardTitle.trim() || boardTitle.trim().toLowerCase() === "new board";
  const showNav = showNavButton || sidebarCollapsed;
  // Over the paper the bar is a control strip, not a page header: the standing
  // line about what the board is doing belongs to the windowed layout.
  const showSubtitle = !compactActions && !overlay;

  return (
    <header
      className={
        overlay
          ? "glass wb-session-chrome wb-session-chrome--top absolute rounded-2xl px-3 py-2 sm:px-4 sm:py-2.5"
          : "glass relative z-40 mb-1.5 shrink-0 rounded-2xl px-3 py-2 sm:mb-3 sm:px-4 sm:py-2.5"
      }
      data-hidden={overlay && chromeHidden ? "true" : undefined}
      style={
        overlay
          ? {
              top: "max(6px, env(safe-area-inset-top))",
              left: "max(6px, env(safe-area-inset-left))",
              right: "max(6px, env(safe-area-inset-right))",
              zIndex: 45,
            }
          : { flexShrink: 0 }
      }
    >
      <div className={`wb-session-header-layout ${compactActions ? "flex flex-col items-stretch gap-2" : "flex flex-nowrap items-center gap-2 sm:gap-3"}`}>
        {/* Left: navigation + board identity */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {showNav && (
            <button
              type="button"
              onClick={onExpandSidebar}
              aria-label="Open navigation"
              className={`btn-plain btn-ghost shrink-0 rounded-[9px] ${compactActions ? "h-11 w-11" : "h-10 w-10 sm:h-8 sm:w-8"} ${navButtonClassName ?? ""}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`wb-session-header-title min-w-0 text-[15px] font-semibold tracking-[-0.015em] text-frost sm:text-base ${compactActions ? "line-clamp-2 break-words" : "block truncate"}`}
                title={title}
              >
                {title}
              </span>
              {saveStatus ? (
                <SaveStatusChip
                  status={saveStatus}
                  onRetrySave={onRetrySave}
                  compact={compactActions}
                />
              ) : null}
            </div>
            {showSubtitle && (
              <p className="mt-0.5 truncate text-[11px] text-soft sm:text-xs">
                {boardStatus === "unsaved"
                  ? "Not saved"
                  : isFreshBoard
                    ? "Ask a question below to start this board"
                    : isLive
                      ? "Lesson in progress on the whiteboard"
                      : "Whiteboard session"}
              </p>
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className={`flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2 ${compactActions ? "flex-wrap justify-between" : "flex-nowrap"}`}>
          {showNotesToggle && onToggleNotes ? (
            <button
              type="button"
              onClick={onToggleNotes}
              aria-label={notesOpen ? "Hide chat" : "Ask me anything"}
              aria-pressed={notesOpen}
              className={`${HEADER_CONTROL} ${notesOpen ? "btn-sky" : "btn-ghost"} ${
                compactActions ? HEADER_CONTROL_SIZE_COMPACT : HEADER_CONTROL_SIZE_LABEL
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
                <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
              </svg>
              {!compactActions ? <span className="hidden sm:inline">Ask</span> : null}
            </button>
          ) : null}
          <LessonActions
            canReplay={canReplay}
            lectureFileType={lectureFileType}
            isReplaying={isReplaying}
            onReplay={onReplay}
            compact={compactActions}
            alwaysVisible
            downloadState={downloadState}
            canDownloadPdf={canDownloadPdf}
            canDownloadVideo={canDownloadVideo}
            downloadPartial={downloadPartial}
            downloadUnavailableReason={downloadUnavailableReason}
            onDownloadPdf={onDownloadPdf}
            onDownloadVideo={onDownloadVideo}
            onCancelDownload={onCancelDownload}
            onDismissDownload={onDismissDownload}
            canDownload={canDownload}
            canDownloadLecture={canDownloadLecture}
            isDownloading={isDownloading}
            isExportingLecture={isExportingLecture}
            lectureExportProgress={lectureExportProgress}
            lectureExportError={lectureExportError}
            onDownload={onDownload}
            onDownloadLecture={onDownloadLecture}
            onCancelLectureExport={onCancelLectureExport}
          />

          {onToggleFullscreen ? (
            <button
              type="button"
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? "Leave full screen" : "Full screen board"}
              aria-pressed={isFullscreen}
              title={isFullscreen ? "Leave full screen (f)" : "Full screen board (f)"}
              className={`${HEADER_CONTROL} btn-ghost ${compactActions ? HEADER_CONTROL_SIZE_COMPACT : HEADER_CONTROL_SIZE_ICON}`}
            >
              {isFullscreen ? (
                <Minimize size={14} strokeWidth={2} aria-hidden />
              ) : (
                <Maximize size={14} strokeWidth={2} aria-hidden />
              )}
            </button>
          ) : null}

          {isLive && (
            <>
              <div className="hidden h-6 w-px bg-stroke sm:block" aria-hidden />
              <button
                type="button"
                onClick={onStop}
                aria-label={isReplaying ? "Stop replay" : "Stop teaching"}
                // Not the danger face. Stopping a lesson is reversible: the
                // board keeps everything written so far and the lecture can be
                // replayed, so it does not warrant the one red in the UI.
                className={`${HEADER_CONTROL} btn-ghost ${compactActions ? "h-11 min-h-11 px-4" : "h-10 px-3 sm:h-8"}`}
              >
                Stop
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
