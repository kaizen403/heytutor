import { Settings } from "lucide-react";
import { LessonActions } from "@/components/LessonActions";
import type { StatusDisplay, TutorPhase } from "../types";

interface SessionHeaderProps {
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  boardTitle: string;
  canReplay: boolean;
  canTranscript: boolean;
  canDownload: boolean;
  isReplaying: boolean;
  isDownloading: boolean;
  phase: TutorPhase;
  activeStatus: StatusDisplay;
  onReplay: () => void;
  onTranscript: () => void;
  onDownload: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
}

function displayBoardTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed || trimmed.toLowerCase() === "new board") {
    return "New board";
  }
  return trimmed;
}

export function SessionHeader({
  sidebarCollapsed,
  onExpandSidebar,
  boardTitle,
  canReplay,
  canTranscript,
  canDownload,
  isReplaying,
  isDownloading,
  phase,
  activeStatus,
  onReplay,
  onTranscript,
  onDownload,
  onStop,
  onOpenSettings,
}: SessionHeaderProps) {
  const isLive = phase !== "idle" || isReplaying;
  const title = displayBoardTitle(boardTitle);
  const isFreshBoard = !boardTitle.trim() || boardTitle.trim().toLowerCase() === "new board";

  return (
    <header
      className="mb-3 shrink-0 rounded-2xl border border-white/70 bg-white/90 px-3 py-2.5 shadow-[0_8px_30px_-18px_rgba(37,99,235,0.35)] backdrop-blur-md sm:px-4"
      style={{ flexShrink: 0 }}
    >
      <div className="flex items-center gap-3">
        {/* Left: navigation + board identity */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={onExpandSidebar}
              aria-label="Expand sidebar"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] text-[#475569] transition-colors hover:border-[rgba(37,99,235,0.28)] hover:bg-[#EDF3FD] hover:text-[#2563EB]"
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
                className="truncate text-[15px] font-semibold capitalize tracking-[-0.02em] text-[#0F172A] sm:text-base"
                title={title}
              >
                {title}
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EDF3FD] px-2 py-0.5 text-[11px] font-medium text-[#2563EB]">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${activeStatus.dotClass}`}
                    style={{ backgroundColor: activeStatus.color }}
                  />
                  {activeStatus.label}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-[#64748B] sm:text-xs">
              {isFreshBoard
                ? "Ask a question below to start this board"
                : isLive
                  ? "Lesson in progress on the whiteboard"
                  : "Whiteboard session"}
            </p>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <LessonActions
            canReplay={canReplay}
            canTranscript={canTranscript}
            canDownload={canDownload}
            isReplaying={isReplaying}
            isDownloading={isDownloading}
            onReplay={onReplay}
            onTranscript={onTranscript}
            onDownload={onDownload}
            alwaysVisible
          />

          <div className="hidden h-6 w-px bg-[#E2E8F0] sm:block" aria-hidden />

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Board settings"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-[#475569] shadow-sm transition-colors hover:border-[rgba(37,99,235,0.3)] hover:bg-[#EDF3FD] hover:text-[#2563EB] sm:h-9 sm:w-9"
          >
            <Settings className="h-4 w-4" strokeWidth={1.75} />
          </button>

          {isLive && (
            <button
              type="button"
              onClick={onStop}
              aria-label={isReplaying ? "Stop replay" : "Stop teaching"}
              className="rounded-full border border-[#E5E7EB] bg-white px-3 py-1.5 text-[11px] font-medium text-[#475569] shadow-sm transition-colors hover:border-[rgba(37,99,235,0.3)] hover:bg-[#EDF3FD] hover:text-[#2563EB] sm:text-xs"
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
