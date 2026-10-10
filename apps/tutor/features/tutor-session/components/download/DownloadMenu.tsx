"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { FileText, Film, X } from "lucide-react";
import type { DownloadState } from "@/features/tutor-session/lib/download/downloadState";
import { cn } from "@/lib/utils";
import {
  DOWNLOAD_CANCEL_LABEL,
  downloadMenuCopy,
  downloadStatusCopy,
  nextMenuIndex,
} from "./downloadView";

export interface DownloadMenuProps {
  id: string;
  state: DownloadState;
  /** The lesson is live or stopped, so a file ends at the current point. */
  partial: boolean;
  /** "MP4" or "WebM". */
  videoTypeLabel: string;
  canDownloadPdf: boolean;
  canDownloadVideo: boolean;
  /** Shown in place of an item's detail line when that item is unavailable. */
  unavailableReason: string;
  /** 44 px rows everywhere, not only under a coarse pointer. */
  touch: boolean;
  onDownloadPdf?: () => void;
  onDownloadVideo?: () => void;
  onCancel?: () => void;
  /** Close and, when `restoreFocus`, return focus to the trigger. */
  onClose: (restoreFocus: boolean) => void;
}

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

function MenuItem({
  icon,
  title,
  detail,
  disabled,
  touch,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  disabled?: boolean;
  touch: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors",
        "hover:bg-white/5 focus-visible:bg-white/5 disabled:pointer-events-none disabled:opacity-45",
        touch ? "min-h-11 py-3" : "py-2 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:py-3",
      )}
    >
      <span className="mt-px shrink-0 text-soft" aria-hidden>
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="type-accent-s text-frost">{title}</span>
        {detail ? <span className="type-accent-xs text-faint">{detail}</span> : null}
      </span>
    </button>
  );
}

/**
 * The download menu. Its surface and keys copy the playback speed menu:
 * first enabled item focused on open, arrows, Home and End rove, Escape
 * returns focus to the trigger.
 */
export function DownloadMenu({
  id,
  state,
  partial,
  videoTypeLabel,
  canDownloadPdf,
  canDownloadVideo,
  unavailableReason,
  touch,
  onDownloadPdf,
  onDownloadVideo,
  onCancel,
  onClose,
}: DownloadMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const status = downloadStatusCopy(state);
  const copy = downloadMenuCopy({ partial, videoTypeLabel });

  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR);
    first?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = nextMenuIndex(event.key, index, items.length);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
  };

  const pick = (action: (() => void) | undefined) => {
    onClose(true);
    action?.();
  };

  return (
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={copy.heading}
      onKeyDown={onKeyDown}
      className="glass-deep animate-fade-up absolute right-0 top-full z-[80] mt-1.5 w-[15.5rem] rounded-xl p-1 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.7)]"
    >
      {status ? (
        <>
          <div role="presentation" className="px-2.5 pb-2 pt-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="type-accent-s text-frost">{status.title}</span>
              {status.figure ? (
                <span className="type-accent-s min-w-[4ch] text-right text-frost tabular-nums">
                  {status.figure}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-[var(--stroke-strong)]" aria-hidden>
              <div
                className={cn(
                  "h-full rounded-full bg-sky-500",
                  status.percent === null
                    ? "w-1/3 motion-safe:animate-pulse"
                    : "motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-linear",
                )}
                style={status.percent === null ? undefined : { width: `${status.percent}%` }}
              />
            </div>
            <p className="type-accent-xs mt-1.5 text-faint">{status.detail}</p>
          </div>
          {state.kind === "video" ? (
            <MenuItem
              icon={<X className="h-3.5 w-3.5" />}
              title={DOWNLOAD_CANCEL_LABEL}
              touch={touch}
              onSelect={() => pick(onCancel)}
            />
          ) : null}
        </>
      ) : (
        <>
          <p aria-hidden className="type-accent-xs px-2.5 pb-1.5 pt-1 text-faint">
            {copy.heading}
          </p>
          {onDownloadPdf ? (
            <MenuItem
              icon={<FileText className="h-3.5 w-3.5" />}
              title={copy.pdf.title}
              detail={canDownloadPdf ? copy.pdf.detail : unavailableReason}
              disabled={!canDownloadPdf}
              touch={touch}
              onSelect={() => pick(onDownloadPdf)}
            />
          ) : null}
          {onDownloadVideo ? (
            <MenuItem
              icon={<Film className="h-3.5 w-3.5" />}
              title={copy.video.title}
              detail={canDownloadVideo ? copy.video.detail : unavailableReason}
              disabled={!canDownloadVideo}
              touch={touch}
              onSelect={() => pick(onDownloadVideo)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
