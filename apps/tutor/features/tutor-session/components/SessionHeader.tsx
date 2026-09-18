
import { Maximize, Minimize } from "lucide-react";
import { LessonActions } from "@/features/tutor-session/components/LessonActions";
import type { LectureExportProgress } from "@/lib/lecture-export/exportLectureMp4";
import type { LectureFileType } from "@/lib/account/lessonSettings";
import type { TutorPhase } from "../types";

interface SessionHeaderProps {
  /** When true, always show the nav expand button (mobile drawer / collapsed sidebar). */
  showNavButton?: boolean;
  navButtonClassName?: string;
  sidebarCollapsed?: boolean;
  onExpandSidebar: () => void;
  boardTitle: string;
  canReplay: boolean;
  canDownload: boolean;
  canDownloadLecture: boolean;
  lectureFileType?: LectureFileType;
  isReplaying: boolean;
  isDownloading: boolean;
  isExportingLecture: boolean;
  lectureExportProgress: LectureExportProgress | null;
  lectureExportError: string | null;
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
  onDownload: () => void;
  onDownloadLecture: () => void;
  onCancelLectureExport: () => void;
  onStop: () => void;
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
  canReplay,
  canDownload,
  canDownloadLecture,
  lectureFileType,
  isReplaying,
  isDownloading,
  isExportingLecture,
  lectureExportProgress,
  lectureExportError,
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
  onDownload,
  onDownloadLecture,
  onCancelLectureExport,
  onStop,
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
      <div className="flex flex-nowrap items-center gap-2 sm:gap-3">
        {/* Left: navigation + board identity */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {showNav && (
            <button
              type="button"
              onClick={onExpandSidebar}
              aria-label="Open navigation"
              className={`btn-plain btn-ghost h-10 w-10 shrink-0 rounded-[9px] sm:h-[34px] sm:w-[34px] ${navButtonClassName ?? ""}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}

          <div className="min-w-0 flex-1">
            <span
              className="block min-w-0 truncate text-[15px] font-semibold tracking-[-0.015em] text-frost sm:text-base"
              title={title}
            >
              {title}
            </span>
            {showSubtitle && (
              <p className="mt-0.5 truncate text-[11px] text-soft sm:text-xs">
                {isFreshBoard
                  ? "Ask a question below to start this board"
                  : isLive
                    ? "Lesson in progress on the whiteboard"
                    : "Whiteboard session"}
              </p>
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 flex-nowrap items-center gap-1.5 sm:gap-2">
          {showNotesToggle && onToggleNotes ? (
            <button
              type="button"
              onClick={onToggleNotes}
              aria-label={notesOpen ? "Hide chat" : "Ask me anything"}
              aria-pressed={notesOpen}
              className={`btn btn-sm ${notesOpen ? "btn-sky" : "btn-ghost"} ${
                compactActions ? "h-10 w-10 px-0" : "h-10 w-10 px-0 sm:h-[34px] sm:w-auto sm:px-[15px]"
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
            canDownload={canDownload}
            canDownloadLecture={canDownloadLecture}
            lectureFileType={lectureFileType}
            isReplaying={isReplaying}
            isDownloading={isDownloading}
            isExportingLecture={isExportingLecture}
            lectureExportProgress={lectureExportProgress}
            lectureExportError={lectureExportError}
            onReplay={onReplay}
            onDownload={onDownload}
            onDownloadLecture={onDownloadLecture}
            onCancelLectureExport={onCancelLectureExport}
            compact={compactActions}
            alwaysVisible
          />

          {onToggleFullscreen ? (
            <button
              type="button"
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? "Leave full screen" : "Full screen board"}
              aria-pressed={isFullscreen}
              title={isFullscreen ? "Leave full screen (f)" : "Full screen board (f)"}
              className="btn-plain btn-ghost h-10 w-10 shrink-0 rounded-full px-0 sm:h-8 sm:w-8"
            >
              {isFullscreen ? (
                <Minimize size={15} strokeWidth={2} aria-hidden />
              ) : (
                <Maximize size={15} strokeWidth={2} aria-hidden />
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
                // Not the danger face. Stopping a lesson is reversible — the
                // board keeps everything written so far and the lecture can be
                // replayed — so it does not warrant the one red in the UI.
                className="btn btn-ghost btn-sm shrink-0"
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
