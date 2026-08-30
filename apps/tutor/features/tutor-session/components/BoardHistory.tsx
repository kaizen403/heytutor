"use client";

import { PenSpinner } from "@heytutor/whiteboard/pen-spinner";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Brand } from "@/components/brand/Brand";
import type { BoardEntry } from "@/lib/boards/types";

export type { BoardEntry };

interface BoardHistoryProps {
  boards: BoardEntry[];
  activeBoardId: string | null;
  /** Board currently teaching or replaying; it spins a pen in the list. */
  busyBoardId?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  disabled?: boolean;
  variant?: "sidebar" | "drawer";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenSettings?: () => void;
  onCreditsClick?: () => void;
  onWidthChange?: (width: number) => void;
  onResizingChange?: (resizing: boolean) => void;
}

const SIDEBAR_WIDTH = 264;
const SIDEBAR_MIN_WIDTH = 216;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_WIDTH_KEY = "htutor_sidebar_width";

const PANEL: CSSProperties = {
  background: "#0B0B0C",
  borderRight: "1px solid rgba(242, 242, 244, 0.08)",
};

export { SIDEBAR_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH };

function clampSidebarWidth(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

function readStoredSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return SIDEBAR_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return SIDEBAR_WIDTH;
    return clampSidebarWidth(parsed);
  } catch {
    return SIDEBAR_WIDTH;
  }
}

function writeStoredSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    /* ignore quota / private mode */
  }
}

interface BoardHistoryContentProps {
  boards: BoardEntry[];
  activeBoardId: string | null;
  busyBoardId?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  disabled?: boolean;
  onToggleCollapse?: () => void;
  showCollapseButton?: boolean;
  onOpenSettings?: () => void;
  onCreditsClick?: () => void;
}

const DELETE_CONFIRM_TIMEOUT_MS = 6000;

function BoardHistoryContent({
  boards,
  activeBoardId,
  busyBoardId = null,
  onSelect,
  onNew,
  onDelete,
  disabled = false,
  onToggleCollapse,
  showCollapseButton = true,
  onOpenSettings,
  onCreditsClick,
}: BoardHistoryContentProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const profileWrapRef = useRef<HTMLDivElement>(null);
  // Deleting drops every turn on the board, so the trash icon only arms a
  // confirm row; it disarms on its own if the student walks away.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const timeoutId = window.setTimeout(
      () => setConfirmDeleteId(null),
      DELETE_CONFIRM_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [confirmDeleteId]);

  // A running lesson locks the list. Drop an armed confirm in the same
  // render as that lock, so the student cannot confirm mid-lecture.
  if (disabled && confirmDeleteId) {
    setConfirmDeleteId(null);
  }

  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!profileWrapRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [profileOpen]);

  const filtered = searchQuery.trim()
    ? boards.filter((b) =>
        b.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : boards;

  return (
    <div className="bh flex h-full flex-col overflow-hidden">
      <header className="bh__header">
        <Brand size="sm" />
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
          <span className="bh__new-icon" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
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
          const isBusy = board.id === busyBoardId;
          if (confirmDeleteId === board.id) {
            return (
              <div
                key={board.id}
                className={`bh__item bh__item--confirm${isActive ? " bh__item--active" : ""}`}
                role="group"
                aria-label={`Delete ${board.title}?`}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setConfirmDeleteId(null);
                }}
              >
                <span className="bh__confirm-text">Delete this board?</span>
                <button
                  type="button"
                  className="bh__confirm-btn bh__confirm-btn--danger"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    setConfirmDeleteId(null);
                    onDelete?.(board.id);
                  }}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="bh__confirm-btn"
                  onClick={() => setConfirmDeleteId(null)}
                  autoFocus
                >
                  Cancel
                </button>
              </div>
            );
          }
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
                <span className="bh__item-title-row">
                  <span className="bh__item-title">{board.title}</span>
                  {isBusy ? (
                    <span className="bh__item-spinner" aria-hidden>
                      <PenSpinner size={15} ink="#C9C9D2" trail={false} />
                    </span>
                  ) : null}
                </span>
                {!isActive && board.preview ? (
                  <span className="bh__item-preview">{board.preview}</span>
                ) : null}
              </button>
              {onDelete && (
                <button
                  type="button"
                  data-delete-btn
                  className="bh__delete"
                  disabled={disabled}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (disabled) return;
                    setConfirmDeleteId(board.id);
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
        {onCreditsClick ? (
          <button type="button" className="bh__credits" onClick={onCreditsClick}>
            Credits
          </button>
        ) : null}

        <div className="bh__profile-wrap" ref={profileWrapRef}>
          {profileOpen && (
            <div className="bh__profile-menu" role="menu">
              <p className="bh__profile-note">Anonymous session on this device</p>
              {onOpenSettings ? (
                <button
                  type="button"
                  role="menuitem"
                  className="bh__profile-item"
                  onClick={() => {
                    setProfileOpen(false);
                    onOpenSettings();
                  }}
                >
                  Settings
                </button>
              ) : null}
            </div>
          )}
          <button
            type="button"
            className={`bh__profile${profileOpen ? " bh__profile--open" : ""}`}
            aria-label="Profile"
            aria-haspopup="menu"
            aria-expanded={profileOpen}
            onClick={() => setProfileOpen((open) => !open)}
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
  --ink: #F2F2F4;
  --ink-soft: #A6A6AE;
  --ink-faint: #7A7A82;
  --accent: #C9C9D2;
  --line: rgba(242, 242, 244, 0.08);
  --paper: #151517;
  --hover: #1E1E21;
  color: var(--ink);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.bh__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 1.125rem 1rem 0.875rem;
  flex-shrink: 0;
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
  background: var(--hover);
  color: var(--ink);
}

.bh__icon-btn[aria-pressed="true"] {
  background: var(--hover);
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
  background: var(--paper);
  color: var(--ink);
  font-size: 0.875rem;
  line-height: 1.4;
  letter-spacing: -0.005em;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.bh__search-input::placeholder {
  color: var(--ink-faint);
  font-style: normal;
}

.bh__search-input:focus {
  border-color: rgba(201, 201, 210, 0.4);
  background: var(--hover);
}

.bh__new-wrap {
  padding: 0 1rem 0.85rem;
  flex-shrink: 0;
}

.bh__new {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.55rem;
  border-radius: 0.85rem;
  border: 1px solid rgba(201, 201, 210, 0.22);
  background: linear-gradient(180deg, #262629 0%, #1A1A1D 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 1px 2px rgba(0, 0, 0, 0.28);
  color: var(--ink);
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.4;
  letter-spacing: 0;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.bh__new-icon {
  width: 1.55rem;
  height: 1.55rem;
  border-radius: 0.45rem;
  background: #F2F2F4;
  color: #0B0B0C;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bh__new:hover:not(:disabled) {
  border-color: rgba(201, 201, 210, 0.42);
  background: linear-gradient(180deg, #2E2E32 0%, #202024 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.28);
}

.bh__new:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bh__section-label {
  padding: 0.15rem 1.05rem 0.55rem;
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1.3;
  color: var(--ink-soft);
  flex-shrink: 0;
  user-select: none;
}

.bh__list {
  flex: 1;
  overflow-y: auto;
  padding: 0 0.5rem 0.875rem;
  /* Docked sidebar: no permanent gutter. The thumb fades in on hover and is
     tinted to the shell, so the list never shows a stray light scrollbar. */
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  transition: scrollbar-color 0.25s ease;
}

.bh__list:hover {
  scrollbar-color: var(--line) transparent;
}

.bh__list::-webkit-scrollbar {
  width: 6px;
}

.bh__list::-webkit-scrollbar-track {
  background: transparent;
}

.bh__list::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 999px;
  border: 0;
  transition: background 0.25s ease;
}

.bh__list:hover::-webkit-scrollbar-thumb {
  background: rgba(242, 242, 244, 0.16);
}

.bh__list::-webkit-scrollbar-thumb:hover {
  background: rgba(242, 242, 244, 0.3);
}

.bh__empty {
  margin: 0;
  padding: 0.55rem 0.55rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  letter-spacing: -0.005em;
  color: var(--ink-faint);
}

.bh__item {
  position: relative;
  margin-bottom: 0.125rem;
  border: 1px solid transparent;
  border-radius: 0.8rem;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.bh__item:hover {
  background: var(--hover);
}

.bh__item--active {
  background: rgba(201, 201, 210, 0.07);
  border-color: var(--line);
}

.bh__item--active:hover {
  background: rgba(201, 201, 210, 0.1);
}

.bh__item-btn {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  width: calc(100% - 2rem);
  padding: 0.8rem 0.55rem;
  border: 0;
  border-radius: 0.8rem;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.bh__item-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bh__item-title {
  font-size: 0.875rem;
  font-weight: 400;
  letter-spacing: 0;
  line-height: 1.35;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bh__item-title-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.bh__item-spinner {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  color: #C9C9D2;
}

.bh__item-preview {
  font-size: 0.8125rem;
  font-weight: 400;
  letter-spacing: -0.005em;
  line-height: 1.4;
  color: var(--ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bh__delete {
  position: absolute;
  right: 0.5rem;
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

.bh__delete:hover:not(:disabled) {
  background: rgba(248, 81, 73, 0.15);
  color: #E06858;
}

.bh__delete:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.bh__item--confirm {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 0.55rem;
  background: var(--hover);
}

.bh__confirm-text {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bh__confirm-btn {
  flex-shrink: 0;
  border: 1px solid rgba(242, 242, 244, 0.14);
  border-radius: 0.5rem;
  background: transparent;
  padding: 0.25rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ink);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.bh__confirm-btn:hover {
  background: rgba(242, 242, 244, 0.06);
}

.bh__confirm-btn--danger {
  border-color: rgba(248, 81, 73, 0.4);
  color: #E06858;
}

.bh__confirm-btn--danger:hover {
  background: rgba(248, 81, 73, 0.15);
}

.bh__footer {
  flex-shrink: 0;
  border-top: 1px solid var(--line);
  padding: 0.875rem 1rem 1rem;
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
  font-size: 0.8125rem;
  font-weight: 400;
  letter-spacing: -0.005em;
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
  margin-left: auto;
}

.bh__profile-note {
  margin: 0 0 0.45rem;
  font-size: 0.75rem;
  color: var(--ink-faint);
  white-space: nowrap;
}

.bh__profile-item {
  display: block;
  width: calc(100% + 1rem);
  margin: 0 -0.5rem;
  border: 0;
  border-radius: 0.45rem;
  padding: 0.35rem 0.5rem;
  background: transparent;
  text-align: left;
  font-size: 0.875rem;
  color: var(--ink);
  cursor: pointer;
}

.bh__profile-item:hover {
  background: var(--hover);
}

.bh__profile-menu {
  position: absolute;
  bottom: calc(100% + 0.55rem);
  right: 0;
  padding: 0.65rem 0.9rem;
  border-radius: 0.65rem;
  background: #151517;
  border: 1px solid rgba(240, 246, 252, 0.1);
  box-shadow: 0 12px 28px -12px rgba(0, 0, 0, 0.55);
  min-width: 8rem;
  z-index: 20;
  font-size: 0.875rem;
  font-weight: 400;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.bh__profile {
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  border: 1px solid var(--line);
  background: var(--paper);
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
  background: var(--hover);
  border-color: rgba(201, 201, 210, 0.35);
  color: var(--ink);
}

.bh__profile:disabled {
  cursor: default;
}

.bh__resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 100%;
  z-index: 6;
  cursor: col-resize;
  touch-action: none;
  background: transparent;
  border: 0;
  padding: 0;
}

.bh__resize::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 1px;
  background: transparent;
  transition: background 0.15s ease, width 0.15s ease, box-shadow 0.15s ease;
}

.bh__resize:hover::after,
.bh__resize:focus-visible::after,
.board-sidebar--resizing .bh__resize::after {
  width: 2px;
  background: rgba(201, 201, 210, 0.55);
  box-shadow: 0 0 0 1px rgba(201, 201, 210, 0.12);
}

.board-sidebar--docked {
  display: none;
}

@media (min-width: 768px) {
  .board-sidebar--docked {
    display: flex;
  }
}

.bh__resize:focus-visible {
  outline: none;
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
  busyBoardId = null,
  onSelect,
  onNew,
  onDelete,
  disabled = false,
  variant = "sidebar",
  open = false,
  onOpenChange,
  collapsed = false,
  onToggleCollapse,
  onOpenSettings,
  onCreditsClick,
  onWidthChange,
  onResizingChange,
}: BoardHistoryProps) {
  // Read the stored width up front rather than setting it from an effect:
  // a mount-time correction is initial state, not a state change.
  const [width, setWidth] = useState(() =>
    variant === "sidebar" ? readStoredSidebarWidth() : SIDEBAR_WIDTH,
  );
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  // Mirrored for the pointer handlers, which read it long after render.
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const applyWidth = useCallback(
    (next: number, persist: boolean) => {
      const clamped = clampSidebarWidth(next);
      setWidth(clamped);
      onWidthChange?.(clamped);
      if (persist) writeStoredSidebarWidth(clamped);
    },
    [onWidthChange],
  );

  // The width itself is already initialised from storage above; this only
  // tells the parent what it turned out to be.
  useLayoutEffect(() => {
    if (variant !== "sidebar") return;
    onWidthChange?.(width);
    // Only on mount and when the parent's callback identity changes — width
    // changes are reported by applyWidth as they happen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, onWidthChange]);

  useEffect(() => {
    onResizingChange?.(resizing);
  }, [resizing, onResizingChange]);

  useEffect(() => {
    if (!resizing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizing]);

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

  const handleOpenSettings = onOpenSettings
    ? () => {
        onOpenSettings();
        if (variant === "drawer") {
          onOpenChange?.(false);
        }
      }
    : undefined;

  const stopDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setResizing(false);
    writeStoredSidebarWidth(widthRef.current);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragRef.current = { startX: event.clientX, startWidth: widthRef.current };
      setResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      applyWidth(
        dragRef.current.startWidth + (event.clientX - dragRef.current.startX),
        false,
      );
    },
    [applyWidth],
  );

  const handleDoubleClick = useCallback(() => {
    applyWidth(SIDEBAR_WIDTH, true);
  }, [applyWidth]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        applyWidth(widthRef.current - 16, true);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        applyWidth(widthRef.current + 16, true);
      } else if (event.key === "Home") {
        event.preventDefault();
        applyWidth(SIDEBAR_MIN_WIDTH, true);
      } else if (event.key === "End") {
        event.preventDefault();
        applyWidth(SIDEBAR_MAX_WIDTH, true);
      }
    },
    [applyWidth],
  );

  const contentProps: BoardHistoryContentProps = {
    boards,
    activeBoardId,
    busyBoardId,
    onSelect: handleSelect,
    onNew: handleNew,
    onDelete,
    disabled,
    onToggleCollapse,
    showCollapseButton: variant === "sidebar",
    onOpenSettings: handleOpenSettings,
    onCreditsClick,
  };

  if (variant === "drawer") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          className="board-sidebar w-[min(100%,280px)] border-r border-[rgba(242,242,244,0.08)] p-0 sm:max-w-[280px]"
          style={PANEL}
        >
          <SheetTitle className="sr-only">Board history</SheetTitle>
          <BoardHistoryContent {...contentProps} />
        </SheetContent>
      </Sheet>
    );
  }

  const frameWidth = collapsed ? 0 : width;

  return (
    <div
      className={`board-sidebar board-sidebar--docked${resizing ? " board-sidebar--resizing" : ""}`}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        zIndex: 40,
        width: frameWidth,
        minWidth: frameWidth,
        height: "100dvh",
        ...PANEL,
        flexDirection: "column",
        overflow: "hidden",
        transition: resizing
          ? "none"
          : "width 0.25s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        flexShrink: 0,
      }}
    >
      <BoardHistoryContent {...contentProps} />
      {!collapsed ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={width}
          title="Drag to resize"
          tabIndex={0}
          className="bh__resize"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onLostPointerCapture={stopDrag}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
        />
      ) : null}
    </div>
  );
}
