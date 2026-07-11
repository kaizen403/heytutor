"use client";

import { Download, RotateCcw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LessonActionsProps {
  canReplay: boolean;
  canTranscript: boolean;
  canDownload?: boolean;
  isReplaying?: boolean;
  isDownloading?: boolean;
  onReplay: () => void;
  onTranscript: () => void;
  onDownload?: () => void;
  compact?: boolean;
  /** Keep toolbar buttons visible (disabled when unavailable). */
  alwaysVisible?: boolean;
}

export function LessonActions({
  canReplay,
  canTranscript,
  canDownload = false,
  isReplaying = false,
  isDownloading = false,
  onReplay,
  onTranscript,
  onDownload,
  compact = false,
  alwaysVisible = false,
}: LessonActionsProps) {
  if (!alwaysVisible && !canReplay && !canTranscript && !canDownload) {
    return null;
  }

  const buttonClass = cn(
    "shrink-0 rounded-full border-[#E5E7EB] bg-white shadow-sm",
    "hover:border-[rgba(37,99,235,0.35)] hover:bg-[#EDF3FD]",
    "disabled:pointer-events-none disabled:opacity-40",
    compact
      ? "h-10 w-10 px-0 sm:h-8 sm:w-8"
      : "h-10 w-10 px-0 sm:h-8 sm:w-auto sm:gap-1.5 sm:px-3",
  );

  const showReplay = alwaysVisible || canReplay;
  const showTranscript = alwaysVisible || canTranscript;
  const showDownload = alwaysVisible || (canDownload && onDownload);

  if (!showReplay && !showTranscript && !showDownload) {
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
          disabled={!canReplay || isReplaying}
          aria-label="Replay lecture"
          className={cn(
            buttonClass,
            "text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]",
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
      {showTranscript && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onTranscript}
          disabled={!canTranscript || isReplaying}
          aria-label="View lesson transcript"
          className={cn(
            buttonClass,
            "text-xs font-medium text-[#374151] hover:text-[#2563EB]",
          )}
        >
          <ScrollText className="h-3.5 w-3.5" aria-hidden />
          {!compact && <span className="hidden sm:inline">Transcript</span>}
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
            "text-xs font-medium text-[#374151] hover:text-[#2563EB]",
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
