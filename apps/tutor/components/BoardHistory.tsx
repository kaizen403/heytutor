"use client";

import { useState, type CSSProperties } from "react";

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
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  profileOpen?: boolean;
  onProfileToggle?: () => void;
  onCreditsClick?: () => void;
}

const SIDEBAR_WIDTH = 260;

const sidebarFont: CSSProperties = {
  fontFamily: '"Anthropic Sans", var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  fontFeatureSettings: '"cv01", "cv02", "cv03", "cv04"',
  WebkitFontSmoothing: "antialiased",
};

const glassPanel: CSSProperties = {
  background: "rgba(255, 255, 255, 0.42)",
  backdropFilter: "blur(20px) saturate(1.4)",
  WebkitBackdropFilter: "blur(20px) saturate(1.4)",
  borderRight: "1px solid rgba(255, 255, 255, 0.55)",
  boxShadow: "inset -1px 0 0 rgba(0, 119, 204, 0.06), 4px 0 24px -8px rgba(0, 0, 0, 0.06)",
};

export { SIDEBAR_WIDTH };

export function BoardHistory({
  boards,
  activeBoardId,
  onSelect,
  onNew,
  onDelete,
  disabled = false,
  collapsed = false,
  onToggleCollapse,
  profileOpen = false,
  onProfileToggle,
  onCreditsClick,
}: BoardHistoryProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery.trim()
    ? boards.filter((b) =>
        b.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : boards;

  const width = collapsed ? 0 : SIDEBAR_WIDTH;

  return (
    <div
      className="board-sidebar"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        zIndex: 40,
        width,
        minWidth: width,
        height: "100vh",
        ...glassPanel,
        ...sidebarFont,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width 0.25s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px 10px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "1.0625rem",
            fontWeight: 600,
            color: "#333333",
            letterSpacing: "-0.025em",
            userSelect: "none",
          }}
        >
          Accelute
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0,119,204,0.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"             stroke="#0099E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,119,204,0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"             stroke="#0099E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {searchOpen && (
        <div style={{ padding: "0 16px 10px", flexShrink: 0 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="search boards..."
            autoFocus
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid rgba(255, 255, 255, 0.5)",
              background: "rgba(255, 255, 255, 0.35)",
              color: "#0077CC",
              fontSize: "0.8125rem",
              outline: "none",
              backdropFilter: "blur(8px)",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "#0077CC";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "rgba(0,119,204,0.2)";
            }}
          />
        </div>
      )}

      <div style={{ padding: "0 12px 12px", flexShrink: 0 }}>
        <button
          onClick={onNew}
          disabled={disabled}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            width: "100%",
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255, 255, 255, 0.45)",
            background: "rgba(255, 255, 255, 0.28)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            transition: "background 0.15s ease, border-color 0.15s ease",
            color: "#333333",
            fontSize: "0.875rem",
            fontWeight: 500,
            textAlign: "left",
            backdropFilter: "blur(8px)",
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.45)";
              e.currentTarget.style.borderColor = "rgba(0, 119, 204, 0.25)";
            }
          }}
          onMouseLeave={(e) => {
            if (!disabled) {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.28)";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.45)";
            }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0077CC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M12 7v6M9 10h6" />
          </svg>
          new board
        </button>
      </div>

      <div
        style={{
          padding: "0 16px 6px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: "rgba(51, 51, 51, 0.45)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
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
          padding: "0 8px 12px",
        }}
      >
        {filtered.length === 0 && (
          <p
            style={{
              fontSize: "0.8125rem",
              color: "rgba(51,51,51,0.5)",
              padding: "8px 12px",
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
                marginBottom: 2,
                borderRadius: 8,
                background: isActive
                  ? "rgba(255, 255, 255, 0.55)"
                  : "transparent",
                border: isActive ? "1px solid rgba(255, 255, 255, 0.5)" : "1px solid transparent",
                backdropFilter: isActive ? "blur(8px)" : undefined,
                transition: "background 0.12s ease",
              }}
              onMouseEnter={(e) => {
                if (!disabled && !isActive) {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.25)";
                }
                const delBtn = e.currentTarget.querySelector('[data-delete-btn]') as HTMLElement | null;
                if (delBtn) delBtn.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                if (!disabled && !isActive) {
                  e.currentTarget.style.background = "transparent";
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
                  width: "calc(100% - 36px)",
                  padding: "10px 12px",
                  borderRadius: 8,
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
                     fontWeight: isActive ? 500 : 400,
                      color: isActive ? "#333333" : "#0077CC",
                     overflow: "hidden",
                     textOverflow: "ellipsis",
                     whiteSpace: "nowrap",
                   }}
                 >
                   {board.title}
                 </span>
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
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    opacity: 0,
                    zIndex: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "opacity 0.15s ease, background 0.15s ease",
                    color: "rgba(51,51,51,0.5)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(217,112,112,0.15)";
                    e.currentTarget.style.color = "#9E4040";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "rgba(51,51,51,0.5)";
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          borderTop: "1px solid rgba(255, 255, 255, 0.45)",
          padding: "10px 16px 12px",
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
            gap: 10,
            border: "none",
            background: "transparent",
            cursor: onCreditsClick ? "pointer" : "default",
            padding: 0,
            color: "rgba(51, 51, 51, 0.55)",
            fontSize: "0.8125rem",
            fontWeight: 500,
            transition: "color 0.15s ease",
          }}
          onMouseEnter={(e) => {
            if (onCreditsClick) e.currentTarget.style.color = "rgba(51, 51, 51, 0.85)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "rgba(51, 51, 51, 0.55)";
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              border: "1px solid rgba(51, 51, 51, 0.18)",
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
                borderRadius: 10,
                background: "rgba(255,255,255,0.97)",
                border: "1px solid rgba(0,119,204,0.2)",
                boxShadow: "0 12px 32px -8px rgba(0,0,0,0.15)",
                backdropFilter: "blur(12px)",
                minWidth: 140,
                zIndex: 20,
                fontSize: "0.9rem",
                color: "#0099E5",
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
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "1px solid rgba(51, 51, 51, 0.14)",
              background: profileOpen
                ? "rgba(0,119,204,0.18)"
                : "rgba(51, 51, 51, 0.06)",
              cursor: onProfileToggle ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: "all 0.15s ease",
              color: "rgba(51, 51, 51, 0.7)",
            }}
            onMouseEnter={(e) => {
              if (onProfileToggle) {
                e.currentTarget.style.borderColor = "rgba(0,119,204,0.35)";
                e.currentTarget.style.color = "#0099E5";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(51, 51, 51, 0.14)";
              e.currentTarget.style.color = "rgba(51, 51, 51, 0.7)";
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
