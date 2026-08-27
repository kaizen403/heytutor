import { LessonActions } from "@/features/tutor-session/components/LessonActions";
import type { StatusDisplay, TutorPhase } from "../types";

interface SessionHeaderProps {
  /** When true, always show the nav expand button (mobile drawer / collapsed sidebar). */
  showNavButton?: boolean;
  navButtonClassName?: string;
  sidebarCollapsed?: boolean;
  onExpandSidebar: () => void;
  boardTitle: string;
  canReplay: boolean;
  canDownload: boolean;
  isReplaying: boolean;
  isDownloading: boolean;
  phase: TutorPhase;
  activeStatus: StatusDisplay;
  compactActions?: boolean;
  notesOpen?: boolean;
  showNotesToggle?: boolean;
  onToggleNotes?: () => void;
  onReplay: () => void;
  onDownload: () => void;
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
  isReplaying,
  isDownloading,
  phase,
  activeStatus,
  compactActions = false,
  notesOpen = false,
  showNotesToggle = false,
  onToggleNotes,
  onReplay,
  onDownload,
  onStop,
}: SessionHeaderProps) {
  const isLive = phase !== "idle" || isReplaying;
  const title = displayBoardTitle(boardTitle);
  const isFreshBoard = !boardTitle.trim() || boardTitle.trim().toLowerCase() === "new board";
  const showNav = showNavButton || sidebarCollapsed;

  return (
    <header
      className="mb-3 shrink-0 rounded-2xl border border-[rgba(242,242,244,0.08)] bg-[#151517]/90 px-3 py-2.5 shadow-[0_8px_30px_-18px_rgba(0,0,0,0.55)] backdrop-blur-md sm:px-4"
      style={{ flexShrink: 0 }}
    >
      <div className="flex items-center gap-3">
        {/* Left: navigation + board identity */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {showNav && (
            <button
              type="button"
              onClick={onExpandSidebar}
              aria-label="Open navigation"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#2E2E33] bg-[#1E1E21] text-[#A6A6AE] transition-colors hover:border-[rgba(201,201,210,0.35)] hover:bg-[#2E2E33] hover:text-[#C9C9D2] ${navButtonClassName ?? ""}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="truncate text-[15px] font-semibold capitalize tracking-[-0.02em] text-[#F2F2F4] sm:text-base"
                title={title}
              >
                {title}
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(201,201,210,0.12)] px-2 py-0.5 text-[11px] font-medium text-[#C9C9D2]">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${activeStatus.dotClass}`}
                    style={{ backgroundColor: activeStatus.color }}
                  />
                  {activeStatus.label}
                </span>
              )}
            </div>
            {!compactActions && (
              <p className="mt-0.5 truncate text-[11px] text-[#A6A6AE] sm:text-xs">
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
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {showNotesToggle && onToggleNotes ? (
            <button
              type="button"
              onClick={onToggleNotes}
              aria-label={notesOpen ? "Hide notes" : "Show notes"}
              aria-pressed={notesOpen}
              className={`flex h-10 items-center justify-center rounded-full border shadow-sm sm:h-8 ${
                compactActions ? "w-10 px-0 sm:w-8" : "w-10 px-0 sm:w-auto sm:gap-1.5 sm:px-3"
              } ${
                notesOpen
                  ? "border-[rgba(201,201,210,0.45)] bg-[#2E2E33] text-[#F2F2F4]"
                  : "border-[#2E2E33] bg-[#1E1E21] text-[#C9C9D2] hover:border-[rgba(201,201,210,0.4)] hover:bg-[#2E2E33] hover:text-[#DEDEE4]"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
              </svg>
              {!compactActions ? <span className="hidden sm:inline text-xs font-medium">Notes</span> : null}
            </button>
          ) : null}
          <LessonActions
            canReplay={canReplay}
            canDownload={canDownload}
            isReplaying={isReplaying}
            isDownloading={isDownloading}
            onReplay={onReplay}
            onDownload={onDownload}
            compact={compactActions}
            alwaysVisible
          />

          {isLive && (
            <>
              <div className="hidden h-6 w-px bg-[#2E2E33] sm:block" aria-hidden />
              <button
                type="button"
                onClick={onStop}
                aria-label={isReplaying ? "Stop replay" : "Stop teaching"}
                className="rounded-full border border-[#2E2E33] bg-[#1E1E21] px-3 py-1.5 text-[11px] font-medium text-[#A6A6AE] shadow-sm transition-colors hover:border-[rgba(201,201,210,0.35)] hover:bg-[#2E2E33] hover:text-[#F2F2F4] sm:text-xs"
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
