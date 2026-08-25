"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ScrollText, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TutorSessionShell, unlockTutorAudio } from "@/features/tutor-session";
import { ReplaySpeedSelect } from "@/features/tutor-session/components/ReplayControls";
import { DEFAULT_REPLAY_SPEED } from "@/lib/replay/replayAudio";
import { LectureNotesPanel } from "./LectureNotesPanel";

export type WatchIntent = "replay" | "notes";

const WATCH_OVERLAY_HISTORY_KEY = "htutorWatchOverlay";

interface WatchDrawerProps {
  boardId: string | null;
  intent: WatchIntent;
  title?: string;
  question?: string;
  onIntentChange: (intent: WatchIntent) => void;
  onClose: () => void;
  onDelete?: (boardId: string) => void;
}

export function WatchDrawer({
  boardId,
  intent,
  title,
  question,
  onIntentChange,
  onClose,
  onDelete,
}: WatchDrawerProps) {
  if (!boardId) {
    return null;
  }

  return (
    <WatchDrawerFrame
      key={boardId}
      boardId={boardId}
      intent={intent}
      title={title}
      question={question}
      onIntentChange={onIntentChange}
      onClose={onClose}
      onDelete={onDelete}
    />
  );
}

function WatchDrawerFrame({
  boardId,
  intent,
  title,
  question,
  onIntentChange,
  onClose,
  onDelete,
}: WatchDrawerProps & { boardId: string }) {
  const [speed, setSpeed] = useState(DEFAULT_REPLAY_SPEED);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const previousState =
      typeof window.history.state === "object" && window.history.state !== null
        ? window.history.state
        : {};
    window.history.pushState(
      { ...previousState, [WATCH_OVERLAY_HISTORY_KEY]: boardId },
      "",
      window.location.href,
    );
    const onPopState = () => {
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [boardId]);

  return (
    <div
      className="isolate fixed inset-0 z-[60] flex flex-col bg-[#0B0B0C]"
      data-watch-overlay=""
    >
      <div className="relative z-[70] flex shrink-0 flex-col gap-2 border-b border-[#2E2E33] bg-[#0B0B0C] px-3 py-2 pointer-events-auto sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onClose()}
            aria-label="Back to syllabus"
            data-watch-back=""
            className="h-10 shrink-0 gap-2 px-3 text-sm font-medium text-[#F2F2F4] hover:bg-[rgba(201,201,210,0.12)] hover:text-[#F2F2F4]"
          >
            <ArrowLeft className="h-5 w-5" />
            Back
          </Button>
          <p className="min-w-0 truncate text-sm font-medium text-[#F2F2F4]">
            {title ?? (intent === "notes" ? "Lecture notes" : "Lecture replay")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReplaySpeedSelect value={speed} onChange={setSpeed} />
          <div className="flex rounded-full border border-[#2E2E33] p-0.5">
            <button
              type="button"
              onClick={() => {
                unlockTutorAudio();
                onIntentChange("replay");
              }}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium",
                intent === "replay"
                  ? "bg-[rgba(201,201,210,0.12)] text-[#C9C9D2]"
                  : "text-[#A6A6AE] hover:text-[#F2F2F4]",
              )}
            >
              Watch
            </button>
            <button
              type="button"
              onClick={() => onIntentChange("notes")}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium",
                intent === "notes"
                  ? "bg-[rgba(201,201,210,0.12)] text-[#C9C9D2]"
                  : "text-[#A6A6AE] hover:text-[#F2F2F4]",
              )}
            >
              <ScrollText className="h-3 w-3" />
              Notes
            </button>
          </div>
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDelete(boardId)}
              className="gap-1.5 text-[#A6A6AE] hover:text-[#E06858]"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onClose()}
            aria-label="Close lecture"
            className="h-10 w-10 shrink-0 text-[#A6A6AE] hover:text-[#F2F2F4]"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
      {question?.trim() ? (
        <div className="relative z-[70] shrink-0 border-b border-[#2E2E33] bg-[#151517] px-4 py-3 pointer-events-auto">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#A6A6AE]">Question</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[#F2F2F4]">{question.trim()}</p>
        </div>
      ) : null}
      <div className="relative z-0 flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 min-w-0 flex-1">
          <TutorSessionShell
            key={boardId}
            sessionId={boardId}
            variant="embed"
            autoReplay={intent === "replay"}
            muteAudio={false}
            playbackRate={speed}
            onPlaybackRateChange={setSpeed}
          />
        </div>
        {intent === "notes" ? (
          <div className="h-[42%] shrink-0 border-t border-[#2E2E33] lg:h-auto lg:w-[380px] lg:border-l lg:border-t-0">
            <LectureNotesPanel key={boardId} boardId={boardId} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
