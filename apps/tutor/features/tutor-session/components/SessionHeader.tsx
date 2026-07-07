import { LessonActions } from "@/components/LessonActions";
import type { StatusDisplay, TutorPhase } from "../types";

interface SessionHeaderProps {
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
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
}

export function SessionHeader({
  sidebarCollapsed,
  onExpandSidebar,
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
}: SessionHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "10px 16px 4px",
        flexShrink: 0,
      }}
    >
      {sidebarCollapsed && (
        <button
          onClick={onExpandSidebar}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginRight: "auto",
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </button>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <LessonActions
          canReplay={canReplay}
          canTranscript={canTranscript}
          canDownload={canDownload}
          isReplaying={isReplaying}
          isDownloading={isDownloading}
          onReplay={onReplay}
          onTranscript={onTranscript}
          onDownload={onDownload}
        />
        {(phase !== "idle" || isReplaying) && (
          <button
            type="button"
            onClick={onStop}
            aria-label={isReplaying ? "Stop replay" : "Stop teaching"}
            style={{
              fontSize: "0.7rem",
              color: "#9E4040",
              background: "rgba(217, 112, 112, 0.12)",
              border: "1px solid rgba(217, 112, 112, 0.35)",
              borderRadius: 9999,
              padding: "4px 10px",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(217, 112, 112, 0.22)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(217, 112, 112, 0.12)";
            }}
          >
            Stop
          </button>
        )}
        {(phase !== "idle" || isReplaying) && (
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${activeStatus.dotClass}`}
            style={{ backgroundColor: activeStatus.color }}
          />
        )}
        {(phase !== "idle" || isReplaying) && (
          <span
            style={{
              fontSize: "0.7rem",
              color: activeStatus.labelColor,
              transition: "color 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {activeStatus.label}
          </span>
        )}
      </div>
    </div>
  );
}
