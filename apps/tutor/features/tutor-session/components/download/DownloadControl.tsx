"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, CircleAlert, Download, Info, X } from "lucide-react";
import {
  downloadIsBusy,
  IDLE_DOWNLOAD,
  type DownloadState,
} from "@/features/tutor-session/lib/download/downloadState";
import {
  DEFAULT_LECTURE_FILE_TYPE,
  LECTURE_FILE_TYPE_LABELS,
  type LectureFileType,
} from "@/lib/account/lessonSettings";
import { cn } from "@/lib/utils";
import { DownloadMenu } from "./DownloadMenu";
import { ExportProgressRing } from "./ExportProgressRing";
import {
  DOWNLOAD_REPLAY_REASON,
  DOWNLOAD_UNAVAILABLE_REASON,
  downloadErrorHeadline,
  downloadNoteCopy,
  downloadPillView,
  downloadPopoverKey,
  type DownloadPillView,
} from "./downloadView";

/** Fixed pill widths: the control never pushes its neighbours. */
export const DOWNLOAD_PILL_WIDE = "sm:w-[8.5rem]";
export const DOWNLOAD_PILL_NARROW = "w-[4.75rem]";

export interface DownloadControlProps {
  /** What the export is doing. `useLectureExport` produces it. */
  state: DownloadState;
  canDownloadPdf: boolean;
  canDownloadVideo: boolean;
  /** The lesson is live or stopped, so a new file ends at the current point. */
  partial?: boolean;
  videoFileType?: LectureFileType;
  /** Why a file is unavailable, shown as the trigger title and in the menu. */
  unavailableReason?: string;
  /** A replay owns the board, so nothing new can start. */
  blocked?: boolean;
  /** Admin drawer and phones: 44 px tall, number only, cancel lives in the menu. */
  compact?: boolean;
  onDownloadPdf?: () => void;
  onDownloadVideo?: () => void;
  onCancel?: () => void;
  /** Clear a finished or failed state back to idle. */
  onDismiss?: () => void;
}

function toneClass(tone: DownloadPillView["tone"]): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "soft":
      return "text-faint";
    default:
      return "text-frost";
  }
}

function PillGlyph({ view, size }: { view: DownloadPillView; size: number }) {
  if (view.ring !== "none") {
    return <ExportProgressRing percent={view.ring === "determinate" ? view.percent : null} size={size} />;
  }
  const className = cn("h-3.5 w-3.5 shrink-0", toneClass(view.tone));
  if (view.icon === "check") return <Check className={className} aria-hidden />;
  if (view.icon === "alert") return <CircleAlert className={className} aria-hidden />;
  return <Download className={className} aria-hidden />;
}

function WideLabel({ view }: { view: DownloadPillView }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <span
        className={cn(
          "truncate transition-opacity duration-150 motion-reduce:transition-none",
          view.tone === "soft" || view.figure ? "text-soft" : "text-frost",
        )}
      >
        {view.label}
      </span>
      {view.figure ? (
        <span className="ml-auto min-w-[4ch] text-right text-frost tabular-nums">{view.figure}</span>
      ) : null}
      {view.icon === "download" && view.tone === "frost" ? (
        <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-faint" aria-hidden />
      ) : null}
    </span>
  );
}

/**
 * The Download control: one fixed width pill with a determinate ring, an
 * always visible cancel while a video is being made, and calm finished,
 * cancelled and failed states. Nothing in it is red: cancelling a download
 * is reversible, so it does not get the danger face.
 */
export function DownloadControl({
  state: reported,
  canDownloadPdf,
  canDownloadVideo,
  partial = false,
  videoFileType = DEFAULT_LECTURE_FILE_TYPE,
  unavailableReason,
  blocked = false,
  compact = false,
  onDownloadPdf,
  onDownloadVideo,
  onCancel,
  onDismiss,
}: DownloadControlProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hiddenPopover, setHiddenPopover] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const popoverId = useId();

  // With no dismiss callback (the legacy bridge holds an error until the next
  // export) a dismissed error reads as idle, so the menu is reachable again.
  const state =
    !onDismiss && reported.kind === "error" && hiddenPopover === downloadPopoverKey(reported)
      ? IDLE_DOWNLOAD
      : reported;
  const view = downloadPillView(state);
  const busy = downloadIsBusy(state);
  const popoverKey = downloadPopoverKey(state);

  // A new run forgets what the student dismissed last time.
  if (busy && hiddenPopover !== null) {
    setHiddenPopover(null);
  }

  const popoverOpen = popoverKey !== null && hiddenPopover !== popoverKey && !menuOpen;
  const reason = blocked ? DOWNLOAD_REPLAY_REASON : (unavailableReason ?? DOWNLOAD_UNAVAILABLE_REASON);
  const pdfAvailable = canDownloadPdf && !blocked && Boolean(onDownloadPdf);
  const videoAvailable = canDownloadVideo && !blocked && Boolean(onDownloadVideo);
  const disabled = !busy && state.kind !== "error" && !pdfAvailable && !videoAvailable;

  useEffect(() => {
    if (!menuOpen && !popoverOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
      if (popoverKey) setHiddenPopover(popoverKey);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      if (popoverKey) setHiddenPopover(popoverKey);
      triggerRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, popoverOpen, popoverKey]);

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const onTriggerClick = () => {
    if (state.kind === "error" && popoverKey) {
      setMenuOpen(false);
      setHiddenPopover(popoverOpen ? popoverKey : null);
      return;
    }
    setMenuOpen((open) => !open);
  };

  const dismiss = () => {
    if (popoverKey) setHiddenPopover(popoverKey);
    onDismiss?.();
  };

  const retry = () => {
    if (state.kind !== "error") return;
    if (popoverKey) setHiddenPopover(popoverKey);
    if (state.file === "pdf") onDownloadPdf?.();
    else onDownloadVideo?.();
  };

  const wide = !compact;
  const showInlineCancel = view.canCancel && wide && Boolean(onCancel);
  const noteCopy = state.kind === "done" ? downloadNoteCopy(state.note) : null;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Lesson download"
      title={disabled ? reason : undefined}
      data-download-state={state.kind}
      className={cn(
        "download-pill relative shrink-0",
        compact ? `h-11 ${DOWNLOAD_PILL_NARROW}` : `h-10 ${DOWNLOAD_PILL_NARROW} sm:h-8 ${DOWNLOAD_PILL_WIDE}`,
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={onTriggerClick}
        disabled={disabled}
        aria-label={view.ariaLabel}
        aria-haspopup={state.kind === "error" ? "dialog" : "menu"}
        aria-expanded={state.kind === "error" ? popoverOpen : menuOpen}
        aria-controls={menuOpen ? menuId : popoverOpen ? popoverId : undefined}
        className={cn(
          "btn-plain btn-ghost type-accent-xs h-full w-full rounded-full tabular-nums",
          compact
            ? "justify-center gap-1.5 px-2"
            : "justify-center gap-1.5 px-2 sm:justify-start sm:gap-2 sm:pl-2.5 sm:pr-2",
          showInlineCancel && "sm:pr-8",
          (menuOpen || popoverOpen) && "bg-white/5",
        )}
      >
        <PillGlyph view={view} size={compact ? 18 : 16} />
        {wide ? (
          <span className="hidden min-w-0 flex-1 sm:flex">
            <WideLabel view={view} />
          </span>
        ) : null}
        {view.shortLabel ? (
          <span className={cn("text-frost tabular-nums", wide && "sm:hidden")}>{view.shortLabel}</span>
        ) : null}
        {view.icon === "download" && view.tone === "frost" ? (
          <ChevronDown className={cn("h-3 w-3 shrink-0 text-faint", wide && "sm:hidden")} aria-hidden />
        ) : null}
      </button>

      {showInlineCancel ? (
        <button
          type="button"
          onClick={() => onCancel?.()}
          aria-label="Cancel video download"
          title="Cancel download"
          className="absolute right-1 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-faint transition-colors hover:bg-white/5 hover:text-frost focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(255,255,255,0.3)] sm:inline-flex"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      ) : null}

      <span className="sr-only" role="status" aria-live="polite">
        {view.live}
      </span>

      {menuOpen ? (
        <DownloadMenu
          id={menuId}
          state={state}
          partial={state.kind === "video" ? state.partial : partial}
          videoTypeLabel={LECTURE_FILE_TYPE_LABELS[videoFileType]}
          canDownloadPdf={pdfAvailable}
          canDownloadVideo={videoAvailable}
          unavailableReason={reason}
          touch={compact}
          onDownloadPdf={onDownloadPdf}
          onDownloadVideo={onDownloadVideo}
          onCancel={onCancel}
          onClose={closeMenu}
        />
      ) : null}

      {popoverOpen && state.kind === "error" ? (
        <div
          id={popoverId}
          role="alert"
          className="surface-float animate-fade-up absolute right-0 top-full z-[80] mt-1.5 w-[17rem] rounded-xl px-3 py-2.5"
        >
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="type-accent-s text-frost">{downloadErrorHeadline(state.file)}</p>
              {state.message ? (
                <p className="type-accent-xs mt-1 text-soft">{state.message}</p>
              ) : null}
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={retry}
                  className={cn("btn btn-xs btn-ghost", compact && "min-h-11")}
                >
                  Try again
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-white/5 hover:text-frost",
                compact ? "h-11 w-11 -mr-2 -mt-2" : "h-6 w-6",
              )}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {popoverOpen && noteCopy ? (
        <div
          id={popoverId}
          role="status"
          className="surface-float animate-fade-up absolute right-0 top-full z-[80] mt-1.5 flex w-[17rem] items-start gap-2 rounded-xl px-3 py-2.5"
        >
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
          <p className="type-accent-s min-w-0 flex-1 text-soft">{noteCopy}</p>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-white/5 hover:text-frost",
              compact ? "h-11 w-11 -mr-2 -mt-2" : "h-6 w-6",
            )}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
