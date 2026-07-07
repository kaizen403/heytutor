"use client";

import { useState, type CSSProperties } from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

export interface BoardEntry {
  id: string;
  title: string;
  createdAt: number;
  preview: string;
}

interface BoardHistoryProps {
  boards: BoardEntry[];
  activeBoardId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  disabled?: boolean;
  variant?: "sidebar" | "drawer";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  profileOpen?: boolean;
  onProfileToggle?: () => void;
  onCreditsClick?: () => void;
}

const SIDEBAR_WIDTH = 264;

const sidebarFont: CSSProperties = {
  WebkitFontSmoothing: "antialiased",
};

// Solid dark green sidebar — slightly deeper than the #659287 page so the
// boundary reads clearly. Text on top is near-white.
const glassPanel: CSSProperties = {
  background: "#4F7468",
  borderRight: "1px solid rgba(0, 0, 0, 0.18)",
  boxShadow: "4px 0 28px -10px rgba(0, 0, 0, 0.35)",
};

export { SIDEBAR_WIDTH };

interface BoardHistoryContentProps {
  boards: BoardEntry[];
  activeBoardId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  disabled?: boolean;
  onToggleCollapse?: () => void;
  showCollapseButton?: boolean;
  profileOpen?: boolean;
  onProfileToggle?: () => void;
  onCreditsClick?: () => void;
}

function BoardHistoryContent({
  boards,
  activeBoardId,
  onSelect,
  onNew,
  onDelete,
  disabled = false,
  onToggleCollapse,
  showCollapseButton = true,
  profileOpen = false,
  onProfileToggle,
  onCreditsClick,
}: BoardHistoryContentProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery.trim()
    ? boards.filter((b) =>
        b.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : boards;

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={sidebarFont}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px 12px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "1.0625rem",
            fontWeight: 600,
            color: "#FFFFFF",
            letterSpacing: "-0.025em",
            userSelect: "none",
            textShadow: "0 1px 2px rgba(0, 0, 0, 0.18)",
          }}
        >
          Accelute
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            aria-label="Search boards"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>
          {showCollapseButton && onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {searchOpen && (
        <div style={{ padding: "0 14px 12px", flexShrink: 0 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="search boards…"
            autoFocus
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 9,
              border: "1px solid rgba(255, 255, 255, 0.14)",
              background: "rgba(255, 255, 255, 0.08)",
              color: "#FFFFFF",
              fontSize: "0.8125rem",
              outline: "none",
              backdropFilter: "blur(8px)",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.32)";
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.14)";
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
            }}
          />
        </div>
      )}

      <div style={{ padding: "0 14px 12px", flexShrink: 0 }}>
        <button
          onClick={onNew}
          disabled={disabled}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "9px",
            width: "100%",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid rgba(255, 255, 255, 0.16)",
            background: "rgba(255, 255, 255, 0.10)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease",
            color: "#FFFFFF",
            fontSize: "0.875rem",
            fontWeight: 500,
            textAlign: "left",
            backdropFilter: "blur(8px)",
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.18)";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.30)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }
          }}
          onMouseLeave={(e) => {
            if (!disabled) {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.16)";
              e.currentTarget.style.transform = "translateY(0)";
            }
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          new board
        </button>
      </div>

      <div
        style={{
          padding: "6px 16px 8px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: "rgba(255, 255, 255, 0.50)",
            textTransform: "uppercase",
            letterSpacing: "0.10em",
            userSelect: "none",
          }}
        >
          Recents
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 10px 12px",
        }}
      >
        {filtered.length === 0 && (
          <p
            style={{
              fontSize: "0.8125rem",
              color: "rgba(255, 255, 255, 0.45)",
              padding: "10px 12px",
              lineHeight: 1.5,
            }}
          >
            {searchQuery ? "no boards match." : "no boards yet. ask a question to start."}
          </p>
        )}

        {filtered.map((board) => {
          const isActive = board.id === activeBoardId;
          return (
            <div
              key={board.id}
              style={{
                position: "relative",
                marginBottom: 3,
                borderRadius: 10,
                background: isActive
                  ? "rgba(255, 255, 255, 0.92)"
                  : "transparent",
                border: isActive
                  ? "1px solid rgba(255, 255, 255, 0.85)"
                  : "1px solid transparent",
                boxShadow: isActive
                  ? "0 6px 20px -8px rgba(0, 0, 0, 0.35)"
                  : "none",
                transition: "background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!disabled && !isActive) {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.12)";
                }
                const delBtn = e.currentTarget.querySelector('[data-delete-btn]') as HTMLElement | null;
                if (delBtn) delBtn.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                if (!disabled && !isActive) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "transparent";
                }
                const delBtn = e.currentTarget.querySelector('[data-delete-btn]') as HTMLElement | null;
                if (delBtn) delBtn.style.opacity = "0";
              }}
            >
              <button
                type="button"
                onClick={() => onSelect(board.id)}
                disabled={disabled}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "3px",
                  width: "calc(100% - 32px)",
                  padding: "11px 13px",
                  borderRadius: 10,
                  border: "none",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  textAlign: "left",
                  background: "transparent",
                }}
              >
                <span
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 600 : 450,
                    color: isActive ? "#2f4a42" : "rgba(255, 255, 255, 0.88)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    letterSpacing: "-0.005em",
                  }}
                >
                  {board.title}
                </span>
                {!isActive && board.preview && (
                  <span
                    style={{
                      fontSize: "0.72rem",
                      color: "rgba(255, 255, 255, 0.50)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {board.preview}
                  </span>
                )}
              </button>
              {onDelete && (
                <button
                  type="button"
                  data-delete-btn
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(board.id);
                  }}
                  aria-label={`Delete ${board.title}`}
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    opacity: 0,
                    zIndex: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "opacity 0.15s ease, background 0.15s ease",
                    color: isActive ? "rgba(47, 74, 66, 0.55)" : "rgba(255, 255, 255, 0.6)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = isActive
                      ? "rgba(158, 64, 64, 0.14)"
                      : "rgba(217, 112, 112, 0.28)";
                    e.currentTarget.style.color = "#9E4040";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = isActive ? "rgba(47, 74, 66, 0.55)" : "rgba(255, 255, 255, 0.6)";
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid rgba(255, 255, 255, 0.10)",
          padding: "11px 16px 13px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <button
          type="button"
          onClick={onCreditsClick}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            border: "none",
            background: "transparent",
            cursor: onCreditsClick ? "pointer" : "default",
            padding: 0,
            color: "rgba(255, 255, 255, 0.65)",
            fontSize: "0.8125rem",
            fontWeight: 500,
            transition: "color 0.15s ease",
          }}
          onMouseEnter={(e) => {
            if (onCreditsClick) e.currentTarget.style.color = "rgba(255, 255, 255, 0.92)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "rgba(255, 255, 255, 0.65)";
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              border: "1px solid rgba(255, 255, 255, 0.22)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.6875rem",
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            $
          </span>
          Credits
        </button>

        <div style={{ position: "relative" }}>
          {profileOpen && onProfileToggle && (
            <div
              style={{
                position: "absolute",
                bottom: "calc(100% + 10px)",
                right: 0,
                padding: "0.75rem 1rem",
                borderRadius: 11,
                background: "rgba(255, 255, 255, 0.95)",
                border: "1px solid rgba(255, 255, 255, 0.6)",
                boxShadow: "0 16px 38px -10px rgba(0, 0, 0, 0.4)",
                backdropFilter: "blur(14px)",
                minWidth: 140,
                zIndex: 20,
                fontSize: "0.9rem",
                color: "#2f4a42",
                fontWeight: 500,
              }}
            >
              Profile
            </div>
          )}

          <button
            type="button"
            aria-label="Profile"
            aria-expanded={profileOpen}
            onClick={onProfileToggle}
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              border: "1px solid rgba(255, 255, 255, 0.20)",
              background: profileOpen
                ? "rgba(255, 255, 255, 0.20)"
                : "rgba(255, 255, 255, 0.08)",
              cursor: onProfileToggle ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: "all 0.15s ease",
              color: "rgba(255, 255, 255, 0.85)",
            }}
            onMouseEnter={(e) => {
              if (onProfileToggle) {
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.42)";
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.16)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.20)";
              e.currentTarget.style.background = profileOpen
                ? "rgba(255, 255, 255, 0.20)"
                : "rgba(255, 255, 255, 0.08)";
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function BoardHistory({
  boards,
  activeBoardId,
  onSelect,
  onNew,
  onDelete,
  disabled = false,
  variant = "sidebar",
  open = false,
  onOpenChange,
  collapsed = false,
  onToggleCollapse,
  profileOpen = false,
  onProfileToggle,
  onCreditsClick,
}: BoardHistoryProps) {
  const handleSelect = (id: string) => {
    onSelect(id);
    if (variant === "drawer") {
      onOpenChange?.(false);
    }
  };

  const handleNew = () => {
    onNew();
    if (variant === "drawer") {
      onOpenChange?.(false);
    }
  };

  const contentProps: BoardHistoryContentProps = {
    boards,
    activeBoardId,
    onSelect: handleSelect,
    onNew: handleNew,
    onDelete,
    disabled,
    onToggleCollapse,
    showCollapseButton: variant === "sidebar",
    profileOpen,
    onProfileToggle,
    onCreditsClick,
  };

  if (variant === "drawer") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          className="board-sidebar w-[min(100%,280px)] border-r border-[rgba(0,0,0,0.18)] p-0 sm:max-w-[280px]"
          style={{
            ...glassPanel,
            boxShadow: "4px 0 28px -10px rgba(0, 0, 0, 0.35)",
          }}
        >
          <SheetTitle className="sr-only">Board history</SheetTitle>
          <BoardHistoryContent {...contentProps} />
        </SheetContent>
      </Sheet>
    );
  }

  const width = collapsed ? 0 : SIDEBAR_WIDTH;

  return (
    <div
      className="board-sidebar hidden md:flex"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        zIndex: 40,
        width,
        minWidth: width,
        height: "100dvh",
        ...glassPanel,
        ...sidebarFont,
        flexDirection: "column",
        overflow: "hidden",
        transition: "width 0.25s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        flexShrink: 0,
      }}
    >
      <BoardHistoryContent {...contentProps} />
    </div>
  );
}
