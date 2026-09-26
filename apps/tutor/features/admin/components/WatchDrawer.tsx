"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Maximize, Minimize, Radio, ScrollText, Trash2, X } from "lucide-react";
import { PlainButton, SiteButton } from "@/components/ui/site-button";
import { cn } from "@/lib/utils";
import { TutorSessionShell, unlockTutorAudio, type TutorSessionExportApi } from "@/features/tutor-session";
import type { TutorPhase } from "@/features/tutor-session/types";
import { LessonActions } from "@/features/tutor-session/components/LessonActions";
import { ReplaySpeedSelect } from "@/features/tutor-session/components/ReplaySpeedSelect";
import {
  useBoardFullscreen,
  useSessionChromeHidden,
} from "@/features/tutor-session/hooks/useBoardFullscreen";
import { fullscreenKeyAction, isTypingElement } from "@/features/tutor-session/lib/board/boardFullscreen";

export type WatchIntent = "replay" | "notes" | "live";

const WATCH_OVERLAY_HISTORY_KEY = "htutorWatchOverlay";
/** Above the promoted headless board (z-61) once the chrome leaves the overlay flow. */
const WATCH_FULLSCREEN_CHROME_Z = 70;

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
      // Keyed on the board alone. It used to carry the intent as well, so
      // switching to Notes tore the lesson down and built it again; the Ask
      // panel is now part of the same session rather than a separate surface.
      key={boardId}
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

function WatchChromePortal({
  overlay,
  children,
}: {
  overlay: boolean;
  children: ReactNode;
}) {
  if (!overlay || typeof document === "undefined") {
    return children;
  }
  return createPortal(children, document.body);
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
  const [speed, setSpeed] = useState(1);
  const [exportApi, setExportApi] = useState<TutorSessionExportApi | null>(null);
  const fullscreen = useBoardFullscreen();
  const closeAndExit = useCallback(() => {
    fullscreen.exit();
    onClose();
  }, [fullscreen, onClose]);
  const onCloseRef = useRef(closeAndExit);
  useEffect(() => {
    onCloseRef.current = closeAndExit;
  }, [closeAndExit]);

  const chromeHidden = useSessionChromeHidden({
    fullscreen: fullscreen.active,
    live: isLive
      ? liveStatus !== "complete" && liveStatus !== "failed"
      : Boolean(exportApi?.isReplaying),
    pinned: intent === "notes",
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialogOpen = Boolean(document.querySelector('[role="dialog"][data-state="open"]'));
      const action = fullscreenKeyAction({
        key: event.key,
        withModifier: event.ctrlKey || event.metaKey || event.altKey,
        typing: isTypingElement(document.activeElement),
        fullscreen: fullscreen.active,
        mode: fullscreen.mode,
        dialogOpen,
        // Watch's own Escape closes the overlay. Native full screen is the
        // browser's Escape; fallback leaves with the overlay on unmount.
        lessonOwnsEscape: true,
      });
      if (action === "toggle") {
        event.preventDefault();
        fullscreen.toggle();
        return;
      }
      if (event.key === "Escape" && !dialogOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [fullscreen]);

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
  const boardFullscreen = fullscreen.active;

  const headerBar = (
    <div
      className={
        boardFullscreen
          ? "site-theme glass wb-session-chrome wb-session-chrome--top pointer-events-auto flex flex-col gap-2 rounded-2xl px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-2.5"
          : "relative z-[80] flex shrink-0 flex-col gap-2 border-b border-stroke bg-ink-950 px-3 py-2 pointer-events-auto sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3"
      }
      data-hidden={boardFullscreen && chromeHidden ? "true" : undefined}
      style={
        boardFullscreen
          ? {
              position: "fixed",
              top: "max(6px, env(safe-area-inset-top))",
              left: "max(6px, env(safe-area-inset-left))",
              right: "max(6px, env(safe-area-inset-right))",
              zIndex: WATCH_FULLSCREEN_CHROME_Z,
            }
          : undefined
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <SiteButton
          variant="ghost"
          size="sm"
          onClick={closeAndExit}
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
        {isLive && liveStatus === "complete" ? (
          <SiteButton
            variant="ice"
            size="sm"
            onClick={() => {
              unlockTutorAudio();
              onIntentChange("replay");
            }}
          >
            Watch replay
          </SiteButton>
        ) : null}
        {isLive ? null : (
          <>
            <ReplaySpeedSelect value={speed} onChange={setSpeed} />
            <LessonActions
              canReplay={exportApi?.canReplay ?? false}
              canDownload={exportApi?.canDownload ?? false}
              canDownloadLecture={exportApi?.canDownloadLecture ?? false}
              lectureFileType={exportApi?.lectureFileType}
              isReplaying={exportApi?.isReplaying ?? false}
              isDownloading={exportApi?.isDownloading ?? false}
              isExportingLecture={exportApi?.isExportingLecture ?? false}
              lectureExportProgress={exportApi?.lectureExportProgress ?? null}
              lectureExportError={exportApi?.lectureExportError ?? null}
              onReplay={() => {
                unlockTutorAudio();
                exportApi?.replayLecture();
              }}
              onDownload={() => exportApi?.downloadNotesPdf()}
              onDownloadLecture={() => exportApi?.downloadLectureMp4()}
              onCancelLectureExport={() => exportApi?.cancelLectureExport()}
              compact
              alwaysVisible
            />
            <div className="flex rounded-full border border-stroke p-0.5">
              <button
                type="button"
                onClick={() => {
                  unlockTutorAudio();
                  onIntentChange("replay");
                  // Switching back from Notes no longer remounts the shell,
                  // so the replay has to be asked for rather than falling
                  // out of `autoReplay` on a fresh mount.
                  if (!exportApi?.isReplaying) {
                    exportApi?.replayLecture();
                  }
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
        <button
          type="button"
          onClick={fullscreen.toggle}
          aria-label={boardFullscreen ? "Leave full screen" : "Full screen board"}
          aria-pressed={boardFullscreen}
          title={boardFullscreen ? "Leave full screen (f)" : "Full screen board (f)"}
          className="btn-plain btn-ghost h-9 w-9 shrink-0 rounded-full px-0 sm:h-8 sm:w-8"
        >
          {boardFullscreen ? (
            <Minimize size={15} strokeWidth={2} aria-hidden />
          ) : (
            <Maximize size={15} strokeWidth={2} aria-hidden />
          )}
        </button>
        <PlainButton
          onClick={closeAndExit}
          aria-label="Close lecture"
          className="h-9 w-9 shrink-0 rounded-lg px-0"
        >
          <X className="h-4 w-4" />
        </PlainButton>
      </div>
    </div>
  );

  return (
    <div
      className={`site-theme isolate fixed inset-0 z-[60] flex flex-col bg-ink-950${
        boardFullscreen ? " wb-board-immersive" : ""
      }`}
      data-watch-overlay=""
      data-watch-intent={intent}
      data-watch-fullscreen={boardFullscreen ? (fullscreen.mode ?? "fallback") : undefined}
      data-chrome-hidden={boardFullscreen && chromeHidden ? "true" : undefined}
    >
      <WatchChromePortal overlay={boardFullscreen}>{headerBar}</WatchChromePortal>
      {!boardFullscreen && question?.trim() ? (
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
              {/*
                `panel`: the whole lesson with the app frame taken off, because
                this drawer brings its own. Watching a lecture here can do
                everything the main page can — ask a follow-up, open the Ask
                panel, mark the board, change the lesson settings — rather than
                being a viewer with a separate, poorer notes list beside it.
              */}
              <TutorSessionShell
                key={boardId}
                sessionId={boardId}
                variant="panel"
                autoReplay={intent === "replay"}
                muteAudio={false}
                playbackRate={speed}
                onExportApi={setExportApi}
                notesOpen={intent === "notes"}
                onNotesOpenChange={(open) => onIntentChange(open ? "notes" : "replay")}
                boardFullscreenApi={fullscreen}
              />
            </div>
          </>
        )}
      </div>
      {isLive && boardFullscreen && fullscreen.rotateHint
        ? createPortal(
            <div className="site-theme wb-rotate-hint glass text-frost" role="status" style={{ zIndex: WATCH_FULLSCREEN_CHROME_Z }}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <rect x="7" y="2" width="10" height="20" rx="2.5" />
                <path d="M11 18.6h2" />
              </svg>
              <span>Turn your phone for a bigger board</span>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
