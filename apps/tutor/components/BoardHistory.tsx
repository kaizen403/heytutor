"use client";

import { useState, type CSSProperties } from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { SITE_NAME } from "@/lib/site";

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

const PANEL: CSSProperties = {
  background: "#EEF3FA",
  borderRight: "1px solid rgba(37, 99, 235, 0.1)",
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
    <div className="bh flex h-full flex-col overflow-hidden">
      <header className="bh__header">
        <span className="bh__brand">{SITE_NAME}</span>
        <div className="bh__header-actions">
          <button
            type="button"
            className="bh__icon-btn"
            onClick={() => setSearchOpen(!searchOpen)}
            aria-label="Search boards"
            aria-pressed={searchOpen}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>
          {showCollapseButton && onToggleCollapse && (
            <button
              type="button"
              className="bh__icon-btn"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {searchOpen && (
        <div className="bh__search">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search boards"
            autoFocus
            className="bh__search-input"
          />
        </div>
      )}

      <div className="bh__new-wrap">
        <button
          type="button"
          className="bh__new"
          onClick={onNew}
          disabled={disabled}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          New board
        </button>
      </div>

      <div className="bh__section-label">Recent boards</div>

      <div className="bh__list">
        {filtered.length === 0 && (
          <p className="bh__empty">
            {searchQuery
              ? "No boards match."
              : "No boards yet. Ask a question to start."}
          </p>
        )}

        {filtered.map((board) => {
          const isActive = board.id === activeBoardId;
          return (
            <div
              key={board.id}
              className={`bh__item${isActive ? " bh__item--active" : ""}`}
            >
              <button
                type="button"
                className="bh__item-btn"
                onClick={() => onSelect(board.id)}
                disabled={disabled}
              >
                <span className="bh__item-title">{board.title}</span>
                {!isActive && board.preview ? (
                  <span className="bh__item-preview">{board.preview}</span>
                ) : null}
              </button>
              {onDelete && (
                <button
                  type="button"
                  data-delete-btn
                  className="bh__delete"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(board.id);
                  }}
                  aria-label={`Delete ${board.title}`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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

      <footer className="bh__footer">
        <button
          type="button"
          className="bh__credits"
          onClick={onCreditsClick}
          disabled={!onCreditsClick}
        >
          Credits
        </button>

        <div className="bh__profile-wrap">
          {profileOpen && onProfileToggle && (
            <div className="bh__profile-menu">Profile</div>
          )}
          <button
            type="button"
            className={`bh__profile${profileOpen ? " bh__profile--open" : ""}`}
            aria-label="Profile"
            aria-expanded={profileOpen}
            onClick={onProfileToggle}
            disabled={!onProfileToggle}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
            </svg>
          </button>
        </div>
      </footer>

      <style>{STYLES}</style>
    </div>
  );
}

const STYLES = `
.bh {
  --ink: #152033;
  --ink-soft: #4A5A72;
  --ink-faint: #7B8BA3;
  --accent: #2563EB;
  --line: rgba(37, 99, 235, 0.12);
  --paper: rgba(255, 255, 255, 0.72);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}

.bh__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 1rem 1rem 0.75rem;
  flex-shrink: 0;
}

.bh__brand {
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: normal;
  color: var(--accent);
  user-select: none;
}

.bh__header-actions {
  display: flex;
  gap: 0.15rem;
}

.bh__icon-btn {
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: 0.55rem;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}

.bh__icon-btn:hover {
  background: rgba(255, 255, 255, 0.65);
  color: var(--ink);
}

.bh__icon-btn[aria-pressed="true"] {
  background: rgba(255, 255, 255, 0.85);
  color: var(--accent);
}

.bh__search {
  padding: 0 1rem 0.75rem;
  flex-shrink: 0;
}

.bh__search-input {
  width: 100%;
  padding: 0.55rem 0.75rem;
  border-radius: 0.65rem;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.8);
  color: var(--ink);
  font-size: 0.9rem;
  letter-spacing: normal;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.bh__search-input::placeholder {
  color: var(--ink-faint);
  font-style: normal;
}

.bh__search-input:focus {
  border-color: rgba(37, 99, 235, 0.35);
  background: #fff;
}

.bh__new-wrap {
  padding: 0 1rem 0.85rem;
  flex-shrink: 0;
}

.bh__new {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.65rem 0.85rem;
  border-radius: 0.7rem;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  font-size: 0.92rem;
  font-weight: 500;
  letter-spacing: normal;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.bh__new svg {
  color: var(--accent);
  flex-shrink: 0;
}

.bh__new:hover:not(:disabled) {
  background: #fff;
  border-color: rgba(37, 99, 235, 0.28);
}

.bh__new:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bh__section-label {
  padding: 0.15rem 1.05rem 0.45rem;
  font-size: 0.875rem;
  font-weight: 400;
  letter-spacing: normal;
  color: var(--ink-soft);
  flex-shrink: 0;
  user-select: none;
}

.bh__list {
  flex: 1;
  overflow-y: auto;
  padding: 0 0.65rem 0.75rem;
}

.bh__empty {
  margin: 0;
  padding: 0.55rem 0.55rem;
  font-size: 0.875rem;
  line-height: 1.45;
  letter-spacing: normal;
  color: var(--ink-faint);
}

.bh__item {
  position: relative;
  margin-bottom: 0.2rem;
  border-radius: 0.65rem;
  transition: background 0.15s ease;
}

.bh__item:hover {
  background: rgba(255, 255, 255, 0.55);
}

.bh__item--active {
  background: rgba(255, 255, 255, 0.92);
}

.bh__item--active:hover {
  background: rgba(255, 255, 255, 0.98);
}

.bh__item-btn {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  width: calc(100% - 2rem);
  padding: 0.65rem 0.7rem;
  border: 0;
  border-radius: 0.65rem;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.bh__item-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bh__item-title {
  font-size: 0.9rem;
  font-weight: 500;
  letter-spacing: normal;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bh__item--active .bh__item-title {
  color: var(--accent);
}

.bh__item-preview {
  font-size: 0.8rem;
  font-weight: 400;
  letter-spacing: normal;
  color: var(--ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bh__delete {
  position: absolute;
  right: 0.35rem;
  top: 50%;
  transform: translateY(-50%);
  width: 1.7rem;
  height: 1.7rem;
  border: 0;
  border-radius: 0.45rem;
  background: transparent;
  color: var(--ink-faint);
  cursor: pointer;
  opacity: 0;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.bh__item:hover .bh__delete,
.bh__item:focus-within .bh__delete {
  opacity: 1;
}

.bh__delete:hover {
  background: rgba(15, 23, 42, 0.06);
  color: var(--ink);
}

.bh__footer {
  flex-shrink: 0;
  border-top: 1px solid var(--line);
  padding: 0.75rem 1rem 0.9rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.bh__credits {
  border: 0;
  background: transparent;
  padding: 0.25rem 0;
  color: var(--ink-soft);
  font-size: 0.875rem;
  font-weight: 400;
  letter-spacing: normal;
  cursor: pointer;
  transition: color 0.15s ease;
}

.bh__credits:hover:not(:disabled) {
  color: var(--ink);
}

.bh__credits:disabled {
  cursor: default;
}

.bh__profile-wrap {
  position: relative;
}

.bh__profile-menu {
  position: absolute;
  bottom: calc(100% + 0.55rem);
  right: 0;
  padding: 0.65rem 0.9rem;
  border-radius: 0.65rem;
  background: #fff;
  border: 1px solid #E5E7EB;
  box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.18);
  min-width: 8rem;
  z-index: 20;
  font-size: 0.9rem;
  font-weight: 400;
  letter-spacing: normal;
  color: var(--ink);
}

.bh__profile {
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.7);
  color: var(--ink-soft);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.bh__profile:hover:not(:disabled),
.bh__profile--open {
  background: #fff;
  border-color: rgba(37, 99, 235, 0.28);
  color: var(--ink);
}

.bh__profile:disabled {
  cursor: default;
}

@media (hover: none) {
  .bh__delete {
    opacity: 0.55;
  }
}
`;

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
          className="board-sidebar w-[min(100%,280px)] border-r border-[rgba(37,99,235,0.1)] p-0 sm:max-w-[280px]"
          style={PANEL}
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
      className="board-sidebar hidden lg:flex"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        zIndex: 40,
        width,
        minWidth: width,
        height: "100dvh",
        ...PANEL,
        flexDirection: "column",
        overflow: "hidden",
        transition:
          "width 0.25s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        flexShrink: 0,
      }}
    >
      <BoardHistoryContent {...contentProps} />
    </div>
  );
}
