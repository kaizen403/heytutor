"use client";

import { Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LessonActionsProps {
  canReplay: boolean;
  canDownload?: boolean;
  isReplaying?: boolean;
  isDownloading?: boolean;
  onReplay: () => void;
  onDownload?: () => void;
  compact?: boolean;
  /** Keep toolbar buttons visible (disabled when unavailable). */
  alwaysVisible?: boolean;
}

export function LessonActions({
  canReplay,
  canDownload = false,
  isReplaying = false,
  isDownloading = false,
  onReplay,
  onDownload,
  compact = false,
  alwaysVisible = false,
}: LessonActionsProps) {
  if (!alwaysVisible && !canReplay && !canDownload) {
    return null;
  }

  const buttonClass = cn(
    "shrink-0 rounded-full border-[#2E2E33] bg-[#1E1E21] shadow-sm",
    "hover:border-[rgba(201,201,210,0.4)] hover:bg-[#2E2E33]",
    "disabled:pointer-events-none disabled:opacity-40",
    compact
      ? "h-10 w-10 px-0 sm:h-8 sm:w-8"
      : "h-10 w-10 px-0 sm:h-8 sm:w-auto sm:gap-1.5 sm:px-3",
  );

  const showReplay = alwaysVisible || canReplay;
  const showDownload = alwaysVisible || (canDownload && onDownload);

  if (!showReplay && !showDownload) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 sm:gap-1.5">
      {showReplay && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReplay}
          disabled={!canReplay}
          aria-label="Replay lecture"
          className={cn(
            buttonClass,
            "text-xs font-medium text-[#C9C9D2] hover:text-[#DEDEE4]",
          )}
        >
          <RotateCcw
            className={cn("h-3.5 w-3.5", isReplaying && "animate-spin")}
            aria-hidden
          />
          {!compact && (
            <span className="hidden sm:inline">
              {isReplaying ? "Replaying…" : "Replay"}
            </span>
          )}
        </Button>
      )}
      {showDownload && onDownload && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDownload}
          disabled={!canDownload || isReplaying || isDownloading}
          aria-label="Download notes as PDF"
          className={cn(
            buttonClass,
            "text-xs font-medium text-[#A6A6AE] hover:text-[#C9C9D2]",
          )}
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          {!compact && (
            <span className="hidden sm:inline">
              {isDownloading ? "Generating\u2026" : "Download notes"}
            </span>
          )}
        </Button>
      )}
    </div>
  );
}
