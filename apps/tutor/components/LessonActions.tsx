"use client";

import { RotateCcw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LessonActionsProps {
  canReplay: boolean;
  canTranscript: boolean;
  isReplaying?: boolean;
  onReplay: () => void;
  onTranscript: () => void;
  compact?: boolean;
}

export function LessonActions({
  canReplay,
  canTranscript,
  isReplaying = false,
  onReplay,
  onTranscript,
  compact = false,
}: LessonActionsProps) {
  if (!canReplay && !canTranscript) {
    return null;
  }

  const buttonClass = cn(
    "h-8 shrink-0 rounded-full border-[rgba(0,119,204,0.28)] bg-[rgba(255,255,255,0.72)] shadow-sm backdrop-blur-sm",
    "hover:border-[rgba(0,119,204,0.42)] hover:bg-[rgba(0,119,204,0.08)]",
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
            "text-xs font-medium text-[#0077CC] hover:text-[#0066B3]",
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
            "text-xs font-medium text-[#333333] hover:text-[#0077CC]",
          )}
        >
          <ScrollText className="h-3.5 w-3.5" aria-hidden />
          {!compact && "Transcript"}
        </Button>
      )}
    </div>
  );
}
