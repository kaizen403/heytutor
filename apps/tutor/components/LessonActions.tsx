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
}

export function LessonActions({
  canReplay,
  canTranscript,
  isReplaying = false,
  onReplay,
  onTranscript,
}: LessonActionsProps) {
  if (!canReplay && !canTranscript) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {canReplay && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReplay}
          disabled={isReplaying}
          aria-label="Replay lecture"
          className={cn(
            "h-8 gap-1.5 rounded-full border-[rgba(0,119,204,0.28)] bg-[rgba(255,255,255,0.72)] px-3",
            "text-xs font-medium text-[#0077CC] shadow-sm backdrop-blur-sm",
            "hover:border-[rgba(0,119,204,0.42)] hover:bg-[rgba(0,119,204,0.08)] hover:text-[#0066B3]",
            "disabled:opacity-60",
          )}
        >
          <RotateCcw
            className={cn("h-3.5 w-3.5", isReplaying && "animate-spin")}
            aria-hidden
          />
          {isReplaying ? "Replaying…" : "Replay"}
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
            "h-8 gap-1.5 rounded-full border-[rgba(0,119,204,0.28)] bg-[rgba(255,255,255,0.72)] px-3",
            "text-xs font-medium text-[#333333] shadow-sm backdrop-blur-sm",
            "hover:border-[rgba(0,119,204,0.42)] hover:bg-[rgba(0,119,204,0.08)] hover:text-[#0077CC]",
            "disabled:opacity-60",
          )}
        >
          <ScrollText className="h-3.5 w-3.5" aria-hidden />
          Transcript
        </Button>
      )}
    </div>
  );
}
