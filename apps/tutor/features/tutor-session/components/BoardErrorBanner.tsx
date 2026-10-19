import { CloudOff, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BoardErrorBannerProps {
  message: string;
  /** Runs the action. For a lesson error it re-asks; for a save it only resends. */
  onRetry: () => void;
  onDismiss: () => void;
  /** Defaults to "Retry". */
  actionLabel?: string;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Sits above another banner in the same slot. */
  className?: string;
}

export function BoardErrorBanner({
  message,
  onRetry,
  onDismiss,
  actionLabel = "Retry",
  icon,
  className,
}: BoardErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        "glass-deep animate-fade-up pointer-events-auto absolute bottom-20 left-1/2 z-30 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2.5",
        className,
      )}
    >
      {icon}
      <span className="min-w-0 text-sm text-frost">{message}</span>
      <button type="button" onClick={onRetry} className="btn-plain btn-sky h-7 shrink-0 rounded-md px-2.5 text-[11px] [@media(pointer:coarse)]:min-h-11">
        {actionLabel}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="inline-flex items-center justify-center text-soft transition-colors hover:text-frost [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export const SAVE_FAILURE_MESSAGE = "This lesson did not save.";
export const SAVE_FAILURE_ACTION = "Try again";

export interface SaveFailureBannerProps {
  /** The save's cause and recovery guidance, independent of teaching errors. */
  message?: string;
  /** Resend the unsaved part of the lesson. Never re-asks the question. */
  onRetrySave: () => void;
  /** Hides the banner; the header chip keeps saying "Not saved". */
  onDismiss: () => void;
  className?: string;
}

/**
 * The loud, once signal for a failed save. It is not the lesson error
 * channel: its action resends the save and never teaches or bills again.
 */
export function SaveFailureBanner({ message = SAVE_FAILURE_MESSAGE, onRetrySave, onDismiss, className }: SaveFailureBannerProps) {
  return (
    <BoardErrorBanner
      message={message}
      actionLabel={SAVE_FAILURE_ACTION}
      icon={<CloudOff className="h-4 w-4 shrink-0 text-warning" aria-hidden />}
      onRetry={onRetrySave}
      onDismiss={onDismiss}
      className={className}
    />
  );
}
