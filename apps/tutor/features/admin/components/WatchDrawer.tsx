"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Radio, ScrollText, Trash2, X } from "lucide-react";
import { PlainButton, SiteButton } from "@/components/ui/site-button";
import { cn } from "@/lib/utils";
import { TutorSessionShell, unlockTutorAudio } from "@/features/tutor-session";
import type { TutorPhase } from "@/features/tutor-session/types";
import { ReplaySpeedSelect } from "@/features/tutor-session/components/ReplayControls";
import { DEFAULT_REPLAY_SPEED } from "@/lib/replay/replayAudio";
import { LectureNotesPanel } from "./LectureNotesPanel";

export type WatchIntent = "replay" | "notes" | "live";

const WATCH_OVERLAY_HISTORY_KEY = "htutorWatchOverlay";

interface WatchDrawerProps {
  boardId: string | null;
  intent: WatchIntent;
  title?: string;
  question?: string;
  livePhase?: TutorPhase;
  liveStatus?: "running" | "complete" | "failed";
  onIntentChange: (intent: WatchIntent) => void;
  onClose: () => void;
  onDelete?: (boardId: string) => void;
}

export function WatchDrawer({
  boardId,
  intent,
  title,
  question,
  livePhase,
  liveStatus,
  onIntentChange,
  onClose,
  onDelete,
}: WatchDrawerProps) {
  if (!boardId) {
    return null;
  }

  return (
    <WatchDrawerFrame
      key={`${intent}:${boardId}`}
      boardId={boardId}
      intent={intent}
      title={title}
      question={question}
      livePhase={livePhase}
      liveStatus={liveStatus}
      onIntentChange={onIntentChange}
      onClose={onClose}
      onDelete={onDelete}
    />
  );
}

function liveBadgeLabel(status?: "running" | "complete" | "failed", phase?: TutorPhase): string {
  if (status === "complete") {
    return "Finished";
  }
  if (status === "failed") {
    return "Stopped";
  }
  if (phase === "planning") {
    return "Planning";
  }
  if (phase === "thinking") {
    return "Thinking";
  }
  if (phase === "drawing" || phase === "speaking") {
    return "Teaching";
  }
  return "Live";
}

function WatchDrawerFrame({
  boardId,
  intent,
  title,
  question,
  livePhase,
  liveStatus,
  onIntentChange,
  onClose,
  onDelete,
}: WatchDrawerProps & { boardId: string }) {
  const isLive = intent === "live";
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

  const heading =
    title ?? (isLive ? "Live lecture" : intent === "notes" ? "Lecture notes" : "Lecture replay");

  return (
    <div
      className="site-theme isolate fixed inset-0 z-[60] flex flex-col bg-ink-950"
      data-watch-overlay=""
      data-watch-intent={intent}
    >
      <div className="relative z-[70] flex shrink-0 flex-col gap-2 border-b border-stroke bg-ink-950 px-3 py-2 pointer-events-auto sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-2">
          <SiteButton
            variant="ghost"
            size="sm"
            onClick={() => onClose()}
            aria-label="Back to syllabus"
            data-watch-back=""
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </SiteButton>
          <p className="min-w-0 truncate text-sm font-medium text-frost">{heading}</p>
          {isLive ? (
            <span className="type-accent-xs inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-sky-200">
              <Radio className="h-3 w-3" />
              {liveBadgeLabel(liveStatus, livePhase)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isLive ? null : (
            <>
              <ReplaySpeedSelect value={speed} onChange={setSpeed} />
              <div className="flex rounded-full border border-stroke p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    unlockTutorAudio();
                    onIntentChange("replay");
                  }}
                  className={cn(
                    "type-accent-xs rounded-full px-3 py-1.5",
                    intent === "replay"
                      ? "bg-sky-500/12 text-sky-300"
                      : "text-soft hover:text-frost",
                  )}
                >
                  Watch
                </button>
                <button
                  type="button"
                  onClick={() => onIntentChange("notes")}
                  className={cn(
                    "type-accent-xs inline-flex items-center gap-1 rounded-full px-3 py-1.5",
                    intent === "notes"
                      ? "bg-sky-500/12 text-sky-300"
                      : "text-soft hover:text-frost",
                  )}
                >
                  <ScrollText className="h-3 w-3" />
                  Notes
                </button>
              </div>
              {onDelete ? (
                <PlainButton variant="danger" className="h-8 px-2.5" onClick={() => onDelete(boardId)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </PlainButton>
              ) : null}
            </>
          )}
          <PlainButton
            onClick={() => onClose()}
            aria-label="Close lecture"
            className="h-9 w-9 shrink-0 rounded-lg px-0"
          >
            <X className="h-4 w-4" />
          </PlainButton>
        </div>
      </div>
      {question?.trim() ? (
        <div className="relative z-[70] max-h-28 shrink-0 overflow-y-auto border-b border-stroke bg-ink-850 px-4 py-2 pointer-events-auto">
          <p className="type-accent-xs text-faint">Question</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-frost">{question.trim()}</p>
        </div>
      ) : null}
      <div className="relative z-0 flex min-h-0 flex-1 flex-col lg:flex-row">
        {isLive ? (
          <div
            data-live-watch-slot=""
            className="relative z-0 min-h-0 min-w-0 flex-1 bg-ink-950"
          />
        ) : (
          <>
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
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
              <div className="h-[42%] shrink-0 border-t border-stroke lg:h-auto lg:w-[380px] lg:border-l lg:border-t-0">
                <LectureNotesPanel key={boardId} boardId={boardId} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
