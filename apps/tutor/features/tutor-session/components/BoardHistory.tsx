"use client";

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
import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Brand } from "@/components/brand/Brand";
import type { BoardEntry } from "@/lib/boards/types";
import { Spinner } from "@/components/ui/spinner";
import {
  firstName,
  profileSubtitle,
  type AccountProfile,
} from "@/lib/account/types";
import { getLegalHref } from "@/lib/site";
import { useEntitlement } from "@/lib/billing/useEntitlement";
import { remainingPctBarWidth, remainingPctLabel } from "@/lib/billing/studentCopy";

interface BoardHistoryProps {
  boards: BoardEntry[];
  activeBoardId: string | null;
  /** Board currently teaching or replaying; it spins a pen in the list. */
  busyBoardId?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  disabled?: boolean;
  variant?: "sidebar" | "drawer";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenSettings?: () => void;
  onCreditsClick?: () => void;
  onSignOut?: () => void;
  profile?: Pick<AccountProfile, "name" | "image" | "email" | "examGoal" | "classYear"> | null;
  onWidthChange?: (width: number) => void;
  onResizingChange?: (resizing: boolean) => void;
}

const SIDEBAR_WIDTH = 264;
const SIDEBAR_MIN_WIDTH = 216;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_WIDTH_KEY = "htutor_sidebar_width";

const PANEL: CSSProperties = {
  background: "var(--ink-850)",
  borderRight: "1px solid var(--stroke)",
};

export { SIDEBAR_WIDTH };

function PinIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.2 3.6l6.2 6.2-2.1 2.1-1.4-.4-3.6 3.6.5 3.4-1.6 1.6-8.3-8.3 1.6-1.6 3.4.5 3.6-3.6-.4-1.4z" />
      <path d="M6.5 17.5L3 21" fill="none" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1.2" />
      <path d="M5.5 8.5v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9" />
      <path d="M10 12.5h4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 7h15" />
      <path d="M10 4.25h4" />
      <path d="M6.9 7l.68 11.8a1.75 1.75 0 0 0 1.75 1.65h5.34a1.75 1.75 0 0 0 1.75-1.65L17.1 7" />
    </svg>
  );
}

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
  onTogglePin?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  disabled?: boolean;
  onToggleCollapse?: () => void;
  showCollapseButton?: boolean;
  onOpenSettings?: () => void;
  onCreditsClick?: () => void;
  onSignOut?: () => void;
  profile?: Pick<AccountProfile, "name" | "image" | "email" | "examGoal" | "classYear"> | null;
  onDismiss?: () => void;
  isDrawer?: boolean;
}

const DELETE_CONFIRM_TIMEOUT_MS = 6000;

function CreditsFooterButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  const { entitlement } = useEntitlement();
  const remainingPct = entitlement?.remainingPct ?? null;
  const tooltip = entitlement
    ? remainingPctLabel(remainingPct, { staff: entitlement.staff })
    : "Usage";
  const width = remainingPctBarWidth(remainingPct, { staff: entitlement?.staff });
  const pctText =
    entitlement && !entitlement.staff && remainingPct != null ? `${width}%` : null;

  return (
    <button
      type="button"
      className="bh__credits"
      title={tooltip}
      aria-label={tooltip}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="bh__credits-row">
        <span className="bh__credits-label">Usage</span>
        {pctText ? <span className="bh__credits-pct">{pctText}</span> : null}
      </span>
      <span className="bh__credits-track" aria-hidden>
        <span className="bh__credits-fill" style={{ width: `${width}%` }} />
      </span>
    </button>
  );
}

function ProfileAvatar({ src }: { src?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className="bh__avatar"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </svg>
  );
}

function AccountNavLink({
  href,
  label,
  onNavigate,
}: {
  href: string;
  label: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`bh__nav-link${active ? " bh__nav-link--active" : ""}`}
      onClick={onNavigate}
    >
      {label}
    </Link>
  );
}

function BoardHistoryContent({
  boards,
  activeBoardId,
  busyBoardId = null,
  onSelect,
  onNew,
  onDelete,
  onTogglePin,
  onToggleArchive,
  onRename,
  disabled = false,
  onToggleCollapse,
  showCollapseButton = true,
  onOpenSettings,
  onCreditsClick,
  onSignOut,
  profile,
  onDismiss,
  isDrawer = false,
}: BoardHistoryContentProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const profileWrapRef = useRef<HTMLDivElement>(null);
  // Deleting drops every turn on the board, so the trash icon only arms a
  // confirm row; it disarms on its own if the student walks away.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [menuBoardId, setMenuBoardId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu is a hover-revealed popover, so it has to close on an outside
  // click and on Escape or it strands itself open once the pointer leaves.
  useEffect(() => {
    if (!menuBoardId) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuBoardId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuBoardId(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuBoardId]);

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
  if (disabled && menuBoardId) {
    setMenuBoardId(null);
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

  // Archived boards leave the list but stay findable: a search still reaches
  // them, so archiving is a tidy-up rather than a place things disappear to.
  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? boards.filter((b) => b.title.toLowerCase().includes(query))
    : boards.filter((b) => b.archivedAt == null || b.id === activeBoardId);

  return (
    <div className={`bh flex h-full min-h-0 flex-col overflow-visible${isDrawer ? " bh--drawer" : ""}`}>
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

      <nav className="bh__account-nav" aria-label="Account">
        <AccountNavLink href="/library" label="Library" onNavigate={onDismiss} />
        <AccountNavLink href="/progress" label="Progress" onNavigate={onDismiss} />
      </nav>

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
          if (renamingId === board.id) {
            return (
              <form
                key={board.id}
                className={`bh__item bh__item--rename${isActive ? " bh__item--active" : ""}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = renameDraft.trim();
                  setRenamingId(null);
                  if (next && next !== board.title) onRename?.(board.id, next);
                }}
              >
                <input
                  className="bh__rename-input"
                  value={renameDraft}
                  autoFocus
                  maxLength={200}
                  aria-label={`Rename ${board.title}`}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => setRenamingId(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setRenamingId(null);
                  }}
                />
              </form>
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
                      <Spinner size={12} />
                    </span>
                  ) : null}
                </span>
                {!isActive && board.preview ? (
                  <span className="bh__item-preview">{board.preview}</span>
                ) : null}
              </button>
              <div className="bh__row-actions" data-row-actions>
                <button
                  type="button"
                  className="bh__row-btn"
                  disabled={disabled}
                  aria-haspopup="menu"
                  aria-expanded={menuBoardId === board.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (disabled) return;
                    setMenuBoardId((current) => (current === board.id ? null : board.id));
                  }}
                  aria-label={`More options for ${board.title}`}
                  title="More"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <circle cx="6" cy="12" r="1.7" />
                    <circle cx="12" cy="12" r="1.7" />
                    <circle cx="18" cy="12" r="1.7" />
                  </svg>
                </button>
                {menuBoardId === board.id ? (
                  <div className="bh__menu" role="menu" ref={menuRef}>
                    <button
                      type="button"
                      role="menuitem"
                      className="bh__menu-item"
                      onClick={() => {
                        setMenuBoardId(null);
                        setRenamingId(board.id);
                        setRenameDraft(board.title);
                      }}
                    >
                      <RenameIcon />
                      Rename
                    </button>
                    <div className="bh__menu-sep" role="none" />
                    <button
                      type="button"
                      role="menuitem"
                      className="bh__menu-item"
                      onClick={() => {
                        setMenuBoardId(null);
                        onTogglePin?.(board.id);
                      }}
                    >
                      <PinIcon filled={board.pinnedAt != null} />
                      {board.pinnedAt != null ? "Unpin board" : "Pin board"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="bh__menu-item"
                      onClick={() => {
                        setMenuBoardId(null);
                        onToggleArchive?.(board.id);
                      }}
                    >
                      <ArchiveIcon />
                      {board.archivedAt != null ? "Unarchive" : "Archive"}
                    </button>
                    {onDelete ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="bh__menu-item"
                        onClick={() => {
                          setMenuBoardId(null);
                          setConfirmDeleteId(board.id);
                        }}
                      >
                        <TrashIcon />
                        Delete
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="bh__footer">
        <CreditsFooterButton
          onClick={() => {
            onDismiss?.();
            onCreditsClick?.();
          }}
          disabled={!onCreditsClick}
        />

        <div className="bh__profile-wrap" ref={profileWrapRef}>
          {profileOpen && (
            <div className="bh__profile-menu" role="menu">
              <div className="bh__profile-head">
                <p className="bh__profile-name">{firstName(profile?.name, profile?.email)}</p>
                <p className="bh__profile-note">
                  {profileSubtitle(profile ?? {}) ?? "Student on Accelute"}
                </p>
              </div>
              <Link href="/profile" role="menuitem" className="bh__profile-item" onClick={() => { setProfileOpen(false); onDismiss?.(); }}>
                Profile
              </Link>
              <Link href="/settings" role="menuitem" className="bh__profile-item" onClick={() => { setProfileOpen(false); onDismiss?.(); }}>
                Settings
              </Link>
              <Link href="/usage" role="menuitem" className="bh__profile-item" onClick={() => { setProfileOpen(false); onDismiss?.(); }}>
                Upgrade plan
              </Link>
              <Link href="/settings/help" role="menuitem" className="bh__profile-item" onClick={() => { setProfileOpen(false); onDismiss?.(); }}>
                Help / What’s new
              </Link>
              <button
                type="button"
                role="menuitem"
                className="bh__profile-item"
                onClick={() => {
                  setProfileOpen(false);
                  onDismiss?.();
                  if (onSignOut) {
                    onSignOut();
                    return;
                  }
                  void signOut({ callbackUrl: "/login" });
                }}
              >
                Log out
              </button>
              <div className="bh__profile-legal">
                <a href={getLegalHref("/terms")} target="_blank" rel="noreferrer">Terms</a>
                <span aria-hidden>·</span>
                <a href={getLegalHref("/privacy")} target="_blank" rel="noreferrer">Privacy</a>
              </div>
              {onOpenSettings ? (
                <button
                  type="button"
                  role="menuitem"
                  className="bh__profile-item"
                  onClick={() => {
                    setProfileOpen(false);
                    onDismiss?.();
                    onOpenSettings();
                  }}
                >
                  Lesson settings
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
            <ProfileAvatar src={profile?.image} />
          </button>
        </div>
      </footer>

      <style>{STYLES}</style>
    </div>
  );
}

const STYLES = `
.bh {
  /* Graphite, by way of the global tokens in app/globals.css. The rail is
     --ink-850, so its own surfaces step up from there rather than down. */
  --ink: var(--frost);
  --ink-soft: var(--text-soft);
  --ink-faint: var(--text-faint);
  --accent: var(--sky-500);
  --line: var(--stroke);
  --paper: var(--ink-800);
  --hover: var(--ink-600);
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
  width: 2.5rem;
  height: 2.5rem;
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
  border-color: var(--stroke-strong);
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
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.4;
  letter-spacing: 0;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.bh__new-icon {
  width: 1.55rem;
  height: 1.55rem;
  border-radius: 0.45rem;
  background: #EDEDEB;
  color: #131312;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bh__new:hover:not(:disabled) {
  border-color: var(--stroke-strong);
  background: var(--hover);
}

.bh__new:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bh__account-nav {
  padding: 0 0.5rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  flex-shrink: 0;
}

.bh__nav-link {
  display: block;
  padding: 0.45rem 0.55rem;
  border-radius: 0.65rem;
  color: var(--ink-soft);
  font-size: 0.875rem;
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}

.bh__nav-link:hover {
  background: var(--hover);
  color: var(--ink);
}

.bh__nav-link--active {
  background: rgba(74, 158, 255, 0.07);
  color: var(--ink);
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
  min-height: 0;
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
  background: rgba(255, 255, 255, 0.16);
}

.bh__list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
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
  background: rgba(74, 158, 255, 0.07);
  border-color: var(--line);
}

.bh__item--active:hover {
  background: rgba(74, 158, 255, 0.1);
}

.bh__item-btn {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  /* Room for the one hover action, always reserved. The title must never run
     underneath it, and reflowing the text on hover would make it jump. */
  width: calc(100% - 2.6rem);
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
  color: #4A9EFF;
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

/*
  Arming a confirm is not destructive, so the trash does not dress as danger.
  It is the same quiet square as the header icon buttons; the red is spent once,
  on the Delete in the confirm row, where it actually means something.
*/
/* The row's hover cluster: pin, then the overflow menu. Both carry the old
   trash button's styling, deliberately. No red lives here — arming a confirm
   is not itself destructive, so red is spent once, on the confirm button. */
.bh__row-actions {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  z-index: 2;
}

.bh__row-btn {
  width: 1.65rem;
  height: 1.65rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--ink-faint);
  cursor: pointer;
  opacity: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    opacity 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.bh__item:hover .bh__row-btn,
.bh__item:focus-within .bh__row-btn {
  opacity: 1;
}



.bh__row-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.07);
  border-color: var(--line);
  color: var(--ink);
}

.bh__row-btn:active:not(:disabled) {
  background: rgba(255, 255, 255, 0.11);
}

/* Load-bearing: without it a keyboard user tabs to an invisible control. */
.bh__row-btn:focus-visible {
  opacity: 1;
  outline: 2px solid rgba(74, 158, 255, 0.5);
  outline-offset: 1px;
}

.bh__row-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.bh__menu {
  position: absolute;
  top: calc(100% + 0.3rem);
  right: 0;
  min-width: 10.5rem;
  padding: 0.25rem;
  border: 1px solid var(--line);
  border-radius: 0.75rem;
  background: var(--ink-850, #151514);
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  z-index: 30;
}

.bh__menu-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--ink-soft);
  font-size: 0.8125rem;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.bh__menu-item:hover {
  background: var(--hover);
  color: var(--ink);
}

.bh__menu-item:focus-visible {
  outline: 2px solid rgba(74, 158, 255, 0.5);
  outline-offset: -2px;
}

.bh__menu-sep {
  height: 1px;
  margin: 0.25rem 0.35rem;
  background: var(--line);
}

.bh__item--rename {
  padding: 0.3rem 0.4rem;
}

.bh__rename-input {
  width: 100%;
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--line);
  border-radius: 0.45rem;
  background: rgba(255, 255, 255, 0.05);
  color: var(--ink);
  font-size: 0.8125rem;
}

.bh__rename-input:focus {
  outline: 2px solid rgba(74, 158, 255, 0.5);
  outline-offset: 1px;
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
  border: 1px solid rgba(255, 255, 255, 0.14);
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
  background: rgba(255, 255, 255, 0.06);
}

/* The one red in the sidebar, spent on the step that actually destroys. */
.bh__confirm-btn--danger {
  border-color: rgba(224, 104, 88, 0.4);
  color: var(--danger);
}

.bh__confirm-btn--danger:hover {
  background: rgba(224, 104, 88, 0.14);
}

.bh__footer {
  flex-shrink: 0;
  overflow: visible;
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
  padding: 0.15rem 0;
  color: var(--ink-soft);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.4rem;
  width: 8.75rem;
  min-width: 8.75rem;
  text-align: left;
}

.bh__credits-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.65rem;
  width: 100%;
}

.bh__credits-label {
  font-size: 0.8125rem;
  font-weight: 400;
  letter-spacing: -0.005em;
  line-height: 1;
}

.bh__credits-pct {
  font-size: 0.75rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--ink);
}

.bh__credits-track {
  display: block;
  width: 100%;
  height: 3px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.bh__credits-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--sky-500);
  transition: width 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.bh__credits:hover:not(:disabled) {
  color: var(--ink);
}

.bh__credits:disabled {
  cursor: default;
}

.bh__profile-wrap {
  position: relative;
  overflow: visible;
  margin-left: auto;
}

.bh__profile-head {
  margin: 0 0 0.45rem;
}

.bh__profile-name {
  margin: 0;
  font-size: 0.875rem;
  color: var(--ink);
}

.bh__profile-note {
  margin: 0.15rem 0 0;
  font-size: 0.75rem;
  color: var(--ink-faint);
  white-space: nowrap;
}

.bh__profile-legal {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem 0.15rem;
  font-size: 0.75rem;
  color: var(--ink-faint);
}

.bh__profile-legal a {
  color: inherit;
  text-decoration: none;
}

.bh__profile-legal a:hover {
  color: var(--ink);
}

.bh__avatar {
  width: 100%;
  height: 100%;
  border-radius: 9999px;
  object-fit: cover;
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
  text-decoration: none;
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
  background: #171716;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 28px -12px rgba(0, 0, 0, 0.55);
  min-width: 12.5rem;
  z-index: 20;
  font-size: 0.875rem;
  font-weight: 400;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.bh__profile {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 9999px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink-soft);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  overflow: hidden;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.bh__profile:hover:not(:disabled),
.bh__profile--open {
  background: var(--hover);
  border-color: rgba(74, 158, 255, 0.35);
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
  background: rgba(74, 158, 255, 0.55);
  box-shadow: 0 0 0 1px rgba(74, 158, 255, 0.12);
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

/* Touch has no hover, so a hover-only cluster would be unreachable. Reveal it
   for the open board only: nothing shows by default, which is the rule, and
   the actions are still one tap away once a board is selected. */
@media (hover: none) {
  .bh__item--active .bh__row-btn {
    opacity: 1;
  }

  .bh__item {
    min-height: 2.75rem;
  }

  .bh__row-btn {
    width: 2.5rem;
    height: 2.5rem;
  }

  .bh__item-btn {
    width: calc(100% - 3.2rem);
  }

  .bh__nav-link {
    min-height: 2.75rem;
    display: flex;
    align-items: center;
  }

  .bh__new {
    min-height: 2.75rem;
  }

  .bh__confirm-btn {
    min-height: 2.5rem;
    padding: 0.4rem 0.7rem;
  }

  .bh__credits {
    min-height: 2.5rem;
    padding: 0.4rem 0.25rem;
    justify-content: center;
  }

  .bh__profile-item {
    min-height: 2.5rem;
    display: flex;
    align-items: center;
  }
}

@media (pointer: coarse) {
  .bh__item--active .bh__row-btn {
    opacity: 1;
  }
}

.bh--drawer .bh__header {
  padding-top: 2.75rem;
  padding-right: 3rem;
}

.bh--drawer .bh__footer {
  overflow: visible;
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
`;

export function BoardHistory({
  boards,
  activeBoardId,
  busyBoardId = null,
  onSelect,
  onNew,
  onDelete,
  onTogglePin,
  onToggleArchive,
  onRename,
  disabled = false,
  variant = "sidebar",
  open = false,
  onOpenChange,
  collapsed = false,
  onToggleCollapse,
  onOpenSettings,
  onCreditsClick,
  onSignOut,
  profile,
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
    onTogglePin,
    onToggleArchive,
    onRename,
    disabled,
    onToggleCollapse,
    showCollapseButton: variant === "sidebar",
    onOpenSettings: handleOpenSettings,
    onCreditsClick,
    onSignOut,
    profile,
    onDismiss: variant === "drawer" ? () => onOpenChange?.(false) : undefined,
    isDrawer: variant === "drawer",
  };

  if (variant === "drawer") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          className="board-sidebar w-[min(100%,min(20rem,100vw-2.5rem))] overflow-visible border-r border-stroke p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-[20rem] [&>button]:right-3 [&>button]:top-[max(0.75rem,env(safe-area-inset-top))]"
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
