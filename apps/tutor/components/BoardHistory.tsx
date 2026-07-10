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

const SIDEBAR = {
  bg: "#E3ECF8",
  card: "rgba(255, 255, 255, 0.62)",
  cardBorder: "rgba(255, 255, 255, 0.88)",
  cardShadow: "0 1px 2px rgba(37, 99, 235, 0.05), 0 4px 14px -8px rgba(37, 99, 235, 0.12)",
  cardHover: "rgba(255, 255, 255, 0.92)",
  cardActive: "#FFFFFF",
  cardActiveBorder: "rgba(37, 99, 235, 0.28)",
  cardActiveShadow: "0 6px 20px -8px rgba(37, 99, 235, 0.28), inset 3px 0 0 #2563EB",
  divider: "rgba(37, 99, 235, 0.12)",
  text: "#1E293B",
  textMuted: "#64748B",
  textFaint: "#94A3B8",
  accent: "#2563EB",
} as const;

const sidebarFont: CSSProperties = {
  WebkitFontSmoothing: "antialiased",
};

const glassPanel: CSSProperties = {
  background: SIDEBAR.bg,
  borderRight: `1px solid ${SIDEBAR.divider}`,
  boxShadow: "4px 0 28px -14px rgba(37, 99, 235, 0.18)",
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
            color: SIDEBAR.text,
            letterSpacing: "-0.025em",
            userSelect: "none",
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
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.45)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.45)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              border: "1px solid rgba(255, 255, 255, 0.75)",
              background: "rgba(255, 255, 255, 0.55)",
              color: SIDEBAR.text,
              fontSize: "0.8125rem",
              outline: "none",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "rgba(37, 99, 235, 0.35)";
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.92)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.75)";
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.55)";
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
            border: "1px solid rgba(255, 255, 255, 0.82)",
            background: "rgba(255, 255, 255, 0.72)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease",
            color: SIDEBAR.text,
            fontSize: "0.875rem",
            fontWeight: 500,
            textAlign: "left",
            boxShadow: SIDEBAR.cardShadow,
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
              e.currentTarget.style.borderColor = "rgba(37, 99, 235, 0.22)";
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = SIDEBAR.cardActiveShadow;
            }
          }}
          onMouseLeave={(e) => {
            if (!disabled) {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.72)";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.82)";
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = SIDEBAR.cardShadow;
            }
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={SIDEBAR.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            color: SIDEBAR.textFaint,
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
              color: SIDEBAR.textFaint,
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
                marginBottom: 8,
                borderRadius: 12,
                background: isActive ? SIDEBAR.cardActive : SIDEBAR.card,
                border: isActive
                  ? `1px solid ${SIDEBAR.cardActiveBorder}`
                  : `1px solid ${SIDEBAR.cardBorder}`,
                boxShadow: isActive ? SIDEBAR.cardActiveShadow : SIDEBAR.cardShadow,
                transition: "background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease",
              }}
              onMouseEnter={(e) => {
                if (!disabled && !isActive) {
                  e.currentTarget.style.background = SIDEBAR.cardHover;
                  e.currentTarget.style.borderColor = "rgba(37, 99, 235, 0.16)";
                  e.currentTarget.style.boxShadow = "0 8px 22px -10px rgba(37, 99, 235, 0.2)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }
                const delBtn = e.currentTarget.querySelector('[data-delete-btn]') as HTMLElement | null;
                if (delBtn) delBtn.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                if (!disabled && !isActive) {
                  e.currentTarget.style.background = SIDEBAR.card;
                  e.currentTarget.style.borderColor = SIDEBAR.cardBorder;
                  e.currentTarget.style.boxShadow = SIDEBAR.cardShadow;
                  e.currentTarget.style.transform = "translateY(0)";
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
                  gap: "2px",
                  width: "calc(100% - 32px)",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "none",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  textAlign: "left",
                  background: "transparent",
                }}
              >
                <span
                  style={{
                    fontSize: "0.8125rem",
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? SIDEBAR.text : "#334155",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {board.title}
                </span>
                {!isActive && board.preview && (
                  <span
                    style={{
                      fontSize: "0.6875rem",
                      color: SIDEBAR.textFaint,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      opacity: 0.85,
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
                    color: isActive ? "rgba(107, 114, 128, 0.85)" : "rgba(107, 114, 128, 0.75)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(15, 23, 42, 0.06)";
                    e.currentTarget.style.color = "#334155";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = isActive ? "rgba(107, 114, 128, 0.85)" : "rgba(107, 114, 128, 0.75)";
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
          borderTop: `1px solid ${SIDEBAR.divider}`,
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
            color: SIDEBAR.textMuted,
            fontSize: "0.8125rem",
            fontWeight: 500,
            transition: "color 0.15s ease",
          }}
          onMouseEnter={(e) => {
            if (onCreditsClick) e.currentTarget.style.color = SIDEBAR.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = SIDEBAR.textMuted;
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              border: "1px solid rgba(255, 255, 255, 0.75)",
              background: "rgba(255, 255, 255, 0.45)",
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
                background: "#FFFFFF",
                border: "1px solid #E5E7EB",
                boxShadow: "0 16px 38px -10px rgba(0, 0, 0, 0.12)",
                backdropFilter: "blur(14px)",
                minWidth: 140,
                zIndex: 20,
                fontSize: "0.9rem",
                color: "#111827",
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
              border: "1px solid rgba(255, 255, 255, 0.75)",
              background: profileOpen
                ? "rgba(255, 255, 255, 0.95)"
                : "rgba(255, 255, 255, 0.55)",
              cursor: onProfileToggle ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: "all 0.15s ease",
              color: "#475569",
            }}
            onMouseEnter={(e) => {
              if (onProfileToggle) {
                e.currentTarget.style.borderColor = "rgba(37, 99, 235, 0.35)";
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.75)";
              e.currentTarget.style.background = profileOpen
                ? "rgba(255, 255, 255, 0.95)"
                : "rgba(255, 255, 255, 0.55)";
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
          className="board-sidebar w-[min(100%,280px)] border-r border-[rgba(37,99,235,0.12)] p-0 sm:max-w-[280px]"
          style={{
            ...glassPanel,
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
