"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  BoardHistory,
  SIDEBAR_WIDTH,
} from "@/features/tutor-session/components/BoardHistory";
import type { AppShellBoardHandlers, AppShellProfile, AppShellVariant } from "./types";


type AppShellProps = AppShellBoardHandlers & {
  profile: AppShellProfile;
  children: ReactNode;
  variant?: AppShellVariant;
  onOpenLessonSettings?: () => void;
  className?: string;
  style?: CSSProperties;
  contentStyle?: CSSProperties;
  sidebarCollapsed?: boolean;
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  mobileNavOpen?: boolean;
  onMobileNavOpenChange?: (open: boolean) => void;
  onSidebarWidthChange?: (width: number) => void;
  onSidebarResizingChange?: (resizing: boolean) => void;
};

export function AppShell({
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
  profile,
  children,
  variant = "account",
  onOpenLessonSettings,
  className,
  style,
  contentStyle,
  sidebarCollapsed: sidebarCollapsedProp,
  onSidebarCollapsedChange,
  mobileNavOpen: mobileNavOpenProp,
  onMobileNavOpenChange,
  onSidebarWidthChange,
  onSidebarResizingChange,
}: AppShellProps) {
  const router = useRouter();
  const [sidebarCollapsedState, setSidebarCollapsedState] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [mobileNavOpenState, setMobileNavOpenState] = useState(false);
  const sidebarCollapsed = sidebarCollapsedProp ?? sidebarCollapsedState;
  const mobileNavOpen = mobileNavOpenProp ?? mobileNavOpenState;

  const setSidebarCollapsed = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const value = typeof next === "function" ? next(sidebarCollapsed) : next;
      setSidebarCollapsedState(value);
      onSidebarCollapsedChange?.(value);
    },
    [onSidebarCollapsedChange, sidebarCollapsed],
  );

  const setMobileNavOpen = useCallback(
    (next: boolean) => {
      setMobileNavOpenState(next);
      onMobileNavOpenChange?.(next);
    },
    [onMobileNavOpenChange],
  );

  const handleWidthChange = useCallback(
    (width: number) => {
      setSidebarWidth(width);
      onSidebarWidthChange?.(width);
    },
    [onSidebarWidthChange],
  );

  const handleResizingChange = useCallback(
    (resizing: boolean) => {
      setSidebarResizing(resizing);
      onSidebarResizingChange?.(resizing);
    },
    [onSidebarResizingChange],
  );

  const goUsage = useCallback(() => {
    router.push("/usage");
  }, [router]);

  const sidebarProps = {
    boards,
    activeBoardId,
    busyBoardId,
    onSelect,
    onNew,
    onDelete,
    onTogglePin,
    onToggleArchive,
    onRename,
    disabled,
    profile,
    onCreditsClick: goUsage,
    onOpenSettings: onOpenLessonSettings,
  };

  return (
    <div
      className={className ?? "fx-aurora-soft relative flex h-dvh max-h-dvh min-w-0 overflow-hidden"}
      data-app-shell={variant}
      style={style}
    >
      <BoardHistory
        {...sidebarProps}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
        onWidthChange={handleWidthChange}
        onResizingChange={handleResizingChange}
      />
      <BoardHistory
        {...sidebarProps}
        variant="drawer"
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
      />
      <div
        className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col md:ml-[var(--tutor-sidebar-width)]"
        style={{
          ["--tutor-sidebar-width" as string]: sidebarCollapsed ? "0px" : `${sidebarWidth}px`,
          transition: sidebarResizing
            ? "none"
            : "margin-left 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          ...contentStyle,
        }}
      >
        {variant === "account" ? (
          <div className="glass relative z-40 mx-3 mb-0 mt-[max(0.75rem,env(safe-area-inset-top))] flex shrink-0 items-center rounded-2xl px-2 py-1.5 md:hidden">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="btn-plain btn-ghost h-10 w-10 shrink-0 rounded-[9px]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
