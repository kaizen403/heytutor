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
}: LessonActionsProps) {
  if (!canReplay && !canTranscript && !canDownload) {
    return null;
  }

  const buttonClass = cn(
    "h-8 shrink-0 rounded-full border-[rgba(101,146,135,0.28)] bg-[rgba(255,255,255,0.72)] shadow-sm backdrop-blur-sm",
    "hover:border-[rgba(101,146,135,0.42)] hover:bg-[rgba(101,146,135,0.08)]",
    "disabled:opacity-60",
    compact ? "w-8 px-0" : "gap-1.5 px-3",
  );

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {canReplay && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReplay}
          disabled={isReplaying}
          aria-label="Replay lecture"
          className={cn(
            buttonClass,
            "text-xs font-medium text-[#659287] hover:text-[#4F7468]",
          )}
        >
          <RotateCcw
            className={cn("h-3.5 w-3.5", isReplaying && "animate-spin")}
            aria-hidden
          />
          {!compact && (isReplaying ? "Replaying…" : "Replay")}
        </Button>
      )}
      {canTranscript && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onTranscript}
          disabled={isReplaying}
          aria-label="View lesson transcript"
          className={cn(
            buttonClass,
            "text-xs font-medium text-[#333333] hover:text-[#659287]",
          )}
        >
          <ScrollText className="h-3.5 w-3.5" aria-hidden />
          {!compact && "Transcript"}
        </Button>
      )}
      {canDownload && onDownload && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDownload}
          disabled={isReplaying || isDownloading}
          aria-label="Download notes as PDF"
          className={cn(
            buttonClass,
            "text-xs font-medium text-[#333333] hover:text-[#659287]",
          )}
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          {!compact && (isDownloading ? "Generating\u2026" : "Download notes")}
        </Button>
      )}
    </div>
  );
}
