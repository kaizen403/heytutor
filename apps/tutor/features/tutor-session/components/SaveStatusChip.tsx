"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, CloudOff, X } from "lucide-react";
import type { SaveStatus } from "@/features/tutor-session/lib/turn/saveStatus";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** A save that finishes inside this window never shows "Saving", so fast saves do not flicker. */
export const SAVE_PENDING_SHOW_MS = 600;
/** "Saved" keeps its word this long, then shrinks to the tick alone. */
export const SAVED_WORD_MS = 3000;

export const SAVE_COPY = {
  saving: "Saving",
  saved: "Saved",
  savedLabel: "Lesson saved",
  offline: "Offline",
  offlineTitle: "You are offline. This lesson saves when you reconnect.",
  failed: "Not saved",
  failedHeadline: "This lesson did not save.",
  failedDetail: "It stays on this device until you close the tab.",
  retry: "Try again",
} as const;

export interface SaveStatusChipProps {
  status: SaveStatus;
  /** Send the unsaved part again. Never teaches the lesson again. */
  onRetrySave?: () => void;
  /** Icon only, keeping the accessible name. */
  compact?: boolean;
}

/**
 * The quiet save indicator after the board title. It says nothing while
 * nothing is at stake, and only "Not saved" asks for attention.
 */
export function SaveStatusChip({ status, onRetrySave, compact = false }: SaveStatusChipProps) {
  const [pendingShown, setPendingShown] = useState(false);
  const [savedWordShown, setSavedWordShown] = useState(true);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const [popoverPosition, setPopoverPosition] = useState({ left: 16, top: 64 });
  const popoverId = useId();

  const savingNow = status.kind === "saving";
  const savedAt = status.kind === "saved" ? status.at : null;

  // A new save, or a new saved moment, starts its own clock.
  const [prevSaving, setPrevSaving] = useState(savingNow);
  if (prevSaving !== savingNow) {
    setPrevSaving(savingNow);
    setPendingShown(false);
  }
  const [prevSavedAt, setPrevSavedAt] = useState(savedAt);
  if (prevSavedAt !== savedAt) {
    setPrevSavedAt(savedAt);
    setSavedWordShown(true);
  }

  useEffect(() => {
    if (!savingNow) return undefined;
    const timer = window.setTimeout(() => setPendingShown(true), SAVE_PENDING_SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [savingNow]);

  useEffect(() => {
    if (savedAt === null) return undefined;
    const left = Math.max(0, SAVED_WORD_MS - (Date.now() - savedAt));
    const timer = window.setTimeout(() => setSavedWordShown(false), left);
    return () => window.clearTimeout(timer);
  }, [savedAt]);

  useLayoutEffect(() => {
    if (!popoverOpen) return undefined;
    const position = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(272, window.innerWidth - 32);
      setPopoverPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), top: rect.bottom + 6 });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [popoverOpen]);

  useEffect(() => {
    if (!popoverOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPopoverOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopoverOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [popoverOpen]);

  const word = (text: string) =>
    compact ? null : <span className="type-accent-xs">{text}</span>;

  switch (status.kind) {
    case "idle":
      return null;
    case "saving":
      if (!pendingShown) return null;
      return (
        <span
          role="status"
          aria-label="Saving the lesson"
          data-save-status="saving"
          className="inline-flex h-6 shrink-0 items-center gap-1 text-faint"
        >
          <Spinner size={10} />
          {word(SAVE_COPY.saving)}
        </span>
      );
    case "saved":
      return (
        <span
          role="status"
          aria-label={SAVE_COPY.savedLabel}
          title={SAVE_COPY.saved}
          data-save-status="saved"
          className="inline-flex h-6 shrink-0 items-center gap-1 text-faint"
        >
          <Check className="h-3 w-3" aria-hidden />
          {savedWordShown ? word(SAVE_COPY.saved) : null}
        </span>
      );
    case "offline":
      return (
        <span
          role="status"
          aria-label={SAVE_COPY.offlineTitle}
          title={SAVE_COPY.offlineTitle}
          data-save-status="offline"
          className="inline-flex h-6 shrink-0 items-center gap-1 text-faint"
        >
          <CloudOff className="h-3 w-3" aria-hidden />
          {word(SAVE_COPY.offline)}
        </span>
      );
    case "failed":
      return (
        <span ref={rootRef} className="relative inline-flex shrink-0" data-save-status="failed">
          <button
            type="button"
            onClick={() => setPopoverOpen((open) => !open)}
            aria-label="Lesson not saved. Show details"
            title={status.message}
            aria-haspopup="dialog"
            aria-expanded={popoverOpen}
            aria-controls={popoverOpen ? popoverId : undefined}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-full text-warning transition-colors hover:bg-white/5",
              compact ? "h-11 w-11" : "h-6 px-2",
            )}
          >
            <CloudOff className="h-3 w-3" aria-hidden />
            {word(SAVE_COPY.failed)}
          </button>
          {popoverOpen ? (
            <span
              id={popoverId}
              role="alert"
              className="surface-float animate-fade-up fixed z-[80] flex w-[17rem] max-w-[calc(100vw-2rem)] items-start gap-2 rounded-xl px-3 py-2.5 text-left"
              style={popoverPosition}
            >
              <span className="min-w-0 flex-1">
                <span className="type-accent-s block text-frost">{status.message}</span>
                <span className="type-accent-xs mt-1 block text-soft">{SAVE_COPY.failedDetail}</span>
                {onRetrySave ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPopoverOpen(false);
                      onRetrySave();
                    }}
                    className={cn("btn btn-xs btn-ghost mt-2.5", compact && "min-h-11")}
                  >
                    {SAVE_COPY.retry}
                  </button>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => setPopoverOpen(false)}
                aria-label="Dismiss"
                className={cn(
                  "inline-flex shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-white/5 hover:text-frost",
                  compact ? "h-11 w-11 -mr-2 -mt-2" : "h-6 w-6",
                )}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ) : null}
        </span>
      );
  }
}
