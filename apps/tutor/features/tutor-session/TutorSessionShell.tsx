"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BoardHistory, SIDEBAR_WIDTH } from "@/features/tutor-session/components/BoardHistory";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  SettingsDrawer,
  getMarkerColorHex,
  type SettingsState,
} from "@/features/tutor-session/components/SettingsDrawer";
import {
  CanvasLanding,
  CanvasLandingDoodles,
} from "@/features/tutor-session/components/CanvasLanding";
import { type ReplayCue } from "@/lib/replay/replayTimeline";
import type { WhiteboardHandle, CursorState } from "@heytutor/whiteboard";
import { useIsCompactNav, useIsMobile } from "@/lib/client/useMediaQuery";
import { ThinkingOverlay } from "./components/ThinkingOverlay";
import { SessionInputChrome } from "./components/SessionInputChrome";
import { SessionHeader } from "./components/SessionHeader";
import { NotesChatSidebar } from "./components/NotesChatSidebar";
import { SessionBoardCanvas } from "./components/SessionBoardCanvas";
import { Whiteboard } from "./components/WhiteboardLoader";
import { useReplay } from "./hooks/useReplay";
import { useCommandExecution } from "./hooks/useCommandExecution";
import { useCancelControl } from "./hooks/useCancelControl";
import { useTurnLifecycle } from "./hooks/useTurnLifecycle";
import { useBoardLayout } from "./hooks/useBoardLayout";
import { useBoardSession } from "./hooks/useBoardSession";
import { useAdaptiveDrawSpeed } from "./hooks/useAdaptiveDrawSpeed";
import { useNotesChat } from "./hooks/useNotesChat";
import {
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import {
  type InkPace,
  type TTSClient,
} from "@heytutor/tutor-core";
import { type TurnTelemetry } from "@/lib/obs/turnTelemetry";
import { type RecordedSegmentPayload } from "@/lib/boards/boardsClient";
import { liveNotesPayload } from "@/lib/boards/notesChatClient";
import {
  DEFAULT_REPLAY_SPEED,
  syncControlledPlaybackRate,
} from "@/lib/replay/replayAudio";
import {
  PAGE_GUTTER_X,
  PAGE_GUTTER_Y,
  NOTES_CHAT_RAIL_WIDTH,
  LANDING_SUGGESTIONS,
  BOARD_WIDTH,
  BOARD_HEIGHT,
} from "./constants";
import type { TutorPhase, SegmentPlanStats } from "./types";
import { createEmptySegmentPlanStats } from "./lib/segmentPlanning";
import { lessonFollowUpMode } from "./lib/lessonFollowUp";
import { buildLessonNotes } from "./lib/lessonNotes";
import { resolveActiveStatus } from "./lib/statusConfig";
import { canStartStoredLectureReplay } from "./lib/autoReplay";

export type TutorSessionVariant = "full" | "headless" | "embed";

export type TutorSessionError = {
  message: string;
  question: string;
};

export type TutorSessionShellProps = {
  sessionId: string;
  variant?: TutorSessionVariant;
  /** Submitted once the board and whiteboard are ready. */
  autoQuestion?: string;
  /** Start stored-turn replay once the board is restored. Used by `/c/{id}?replay=1`. */
  autoReplay?: boolean;
  /** Capture TTS bytes; do not play through speakers. Defaults on for `headless`. */
  muteAudio?: boolean;
  /** Controlled playback rate (admin Watch). Same model as student replay; default 1.5×. */
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  onPhase?: (phase: TutorPhase) => void;
  /** Fired after the turn is persisted (and saved when `onComplete` is set). */
  onComplete?: () => void;
  onError?: (error: TutorSessionError) => void;
};

export function TutorSessionShell({
  sessionId,
  variant = "full",
  autoQuestion,
  autoReplay = false,
  muteAudio,
  playbackRate,
  onPlaybackRateChange,
  onPhase,
  onComplete,
  onError,
}: TutorSessionShellProps) {
  const router = useRouter();
  const isHeadless = variant === "headless";
  const isEmbed = variant === "embed";
  const mutePlayback = isHeadless ? (muteAudio ?? true) : (muteAudio ?? false);

  const whiteboardRef = useRef<WhiteboardHandle>(null);
  const pendingQuestionRef = useRef<string | null>(null);
  const autoSubmitDoneRef = useRef(false);
  const [phase, setPhase] = useState<TutorPhase>("idle");
  const phaseRef = useRef<TutorPhase>("idle");
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [narrationText, setNarrationText] = useState("");
  const [currentSegmentText, setCurrentSegmentText] = useState("");
  const [lastError, setLastError] = useState<{ message: string; question: string } | null>(null);
  const ttsClientRef = useRef<TTSClient | null>(null);
  const replayAudioRef = useRef<HTMLAudioElement | null>(null);
  const replayAudioPreloadRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const cancelRef = useRef(false);
  const turnActiveRef = useRef(false);
  const turnGenerationRef = useRef(0);
  const turnAbortRef = useRef<AbortController | null>(null);
  const segmentChainRef = useRef(Promise.resolve());
  const drawChainRef = useRef(Promise.resolve());
  const collectedSegmentsRef = useRef<TutorSegment[]>([]);
  const recordedSegmentsRef = useRef<RecordedSegmentPayload[]>([]);
  const rawResponseRef = useRef("");
  const currentTraceIdRef = useRef<string | null>(null);
  const turnTelemetryRef = useRef<TurnTelemetry | null>(null);
  const turnStatsRef = useRef({ drawMs: 0, ttsChars: 0 });
  const [isDownloading, setIsDownloading] = useState(false);
  const fbdPhaseMarkedRef = useRef(false);
  const fbdPhaseStartedRef = useRef(false);
  const activeVerifiedDiagramRef = useRef<VerifiedDiagram | null>(null);
  const [activeVerifiedDiagram, setActiveVerifiedDiagram] = useState<VerifiedDiagram | null>(null);
  const segmentPlanStatsRef = useRef<SegmentPlanStats>(createEmptySegmentPlanStats());
  const stopTurnRef = useRef<(() => void) | null>(null);
  const pendingSegmentCountRef = useRef(0);
  const narrationDensityRef = useRef(0);
  const inkPaceRef = useRef<InkPace>("follow");
  const adaptiveFactorRef = useRef(1);
  const [settings, setSettings] = useState<SettingsState>({
    speedMultiplier: DEFAULT_REPLAY_SPEED,
    fastMode: true,
    audioLanguage: "english",
    accent: "india",
    subtitlesEnabled: true,
    subtitleLanguage: "english",
    markerColor: "navy",
  });
  const speedRef = useRef(DEFAULT_REPLAY_SPEED);
  const fastModeRef = useRef(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [liveQuestion, setLiveQuestion] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const notesUserToggledRef = useRef(false);
  const isCompactNav = useIsCompactNav();
  const isMobile = useIsMobile();
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgressMs, setReplayProgressMs] = useState(0);
  const [replayTotalMs, setReplayTotalMs] = useState(0);
  const replayGenerationRef = useRef(0);
  const replayCueRef = useRef<ReplayCue | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    onPhase?.(phase);
  }, [phase, onPhase]);

  useEffect(() => {
    if (isHeadless || typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem("htutor_fast_mode");
    if (stored === "0") {
      // Read after mount so SSR HTML stays the production default.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettings((current) => ({ ...current, fastMode: false }));
      fastModeRef.current = false;
    }
  }, [isHeadless]);

  useEffect(() => {
    fastModeRef.current = settings.fastMode;
    if (isHeadless || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("htutor_fast_mode", settings.fastMode ? "1" : "0");
  }, [settings.fastMode, isHeadless]);

  // Keep AudioContext eligible for audible playback after long planning awaits.
  useEffect(() => {
    const handler = () => {
      ttsClientRef.current?.unlockAudio?.();
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    for (const event of events) {
      window.addEventListener(event, handler, { passive: true });
    }
    return () => {
      for (const event of events) {
        window.removeEventListener(event, handler);
      }
    };
  }, []);

  const skipInkRestoreRef = useRef(autoReplay);
  skipInkRestoreRef.current = autoReplay;

  const cursorState: CursorState =
    phase === "thinking"
      ? "thinking"
      : isReplaying || phase === "drawing" || phase === "speaking"
        ? "drawing"
        : "idle";

  const { cancellableDelay, raceWithCancel, clearCancelTimers } = useCancelControl(cancelRef);

  const {
    boardContainerRef,
    boardViewport,
    boardLayoutRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    forceSequentialWorkLayoutRef,
    resetBoardLayout,
    beginBoardEpoch,
    forgetErasedTextRects,
    resolveTextPlacement,
    reserveTextCommandPlacement,
  } = useBoardLayout({
    whiteboardRef,
    cancelRef,
    fbdPhaseStartedRef,
    viewportMode: isHeadless ? "fixed" : "fit",
  });

  // Adaptive drawing speed: polls audio lag + queue depth + narration density
  // and pushes a dynamic animation-speed factor to the whiteboard. Pedagogical
  // pace (follow vs scene) caps catch-up so formulas stay readable.
  useAdaptiveDrawSpeed({
    whiteboardRef,
    ttsClientRef,
    turnActiveRef,
    speedRef,
    pendingSegmentCountRef,
    narrationDensityRef,
    inkPaceRef,
    adaptiveFactorRef,
  });

  const { executeCommand, executeCommandWithCancel } = useCommandExecution({
    whiteboardRef,
    cancelRef,
    speedRef,
    boardLayoutRef,
    forceSequentialWorkLayoutRef,
    fbdPhaseMarkedRef,
    fbdPhaseStartedRef,
    activeVerifiedDiagramRef,
    turnTelemetryRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    cancellableDelay,
    forgetErasedTextRects,
    resetBoardLayout,
    resolveTextPlacement,
    raceWithCancel,
    inkPaceRef,
    adaptiveFactorRef,
  });

  const handleRetraceEntity = useCallback((entityId: string) => {
    void executeCommand(
      {
        type: "FOCUS",
        params: [],
        text: entityId,
        charPosition: 0,
        narrationBefore: "",
      },
      { applyLayout: false, inkPace: "follow" },
    );
  }, [executeCommand]);

  const {
    boards,
    setBoards,
    boardLoaded,
    storedTurnsRef,
    storedTurnsCount,
    setStoredTurnsCount,
    conversationHistoryRef,
    inputInteracted,
    setInputInteracted,
    createNewBoard,
    startNextQuestion,
    switchBoard,
    deleteBoard,
    ensureTTSClient,
    registerReplayBlobUrl,
    revokeUnreferencedReplayBlobUrls,
    persistTurnForReplay,
  } = useBoardSession({
    sessionId,
    router,
    phase,
    speedMultiplier: settings.speedMultiplier,
    muted: mutePlayback,
    whiteboardRef,
    cancelRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    ttsClientRef,
    speedRef,
    stopTurnRef,
    replayAudioRef,
    replayAudioPreloadRef,
    setNarrationText,
    setCurrentSegmentText,
    resetBoardLayout,
    executeCommand,
    skipInkRestoreRef,
  });

  const {
    finishLectureUi,
    stopTurn,
    pauseTurn,
    resumeTurn,
    handleQuestion,
    handleAskDoubt,
  } = useTurnLifecycle({
    sessionId,
    autoQuestion,
    replaceAutoQuestionUrl: variant === "full",
    enableKeyboardControls: variant !== "headless",
    onComplete,
    onError,
    phase,
    isReplaying,
    boardLoaded,
    narrationText,
    boards,
    whiteboardRef,
    pendingQuestionRef,
    autoSubmitDoneRef,
    phaseRef,
    isPausedRef,
    conversationHistoryRef,
    ttsClientRef,
    replayAudioRef,
    replayAudioPreloadRef,
    cancelRef,
    turnActiveRef,
    turnGenerationRef,
    turnAbortRef,
    segmentChainRef,
    drawChainRef,
    collectedSegmentsRef,
    recordedSegmentsRef,
    storedTurnsRef,
    rawResponseRef,
    currentTraceIdRef,
    turnTelemetryRef,
    turnStatsRef,
    narrationSinceEpochRef,
    boardLayoutRef,
    fbdPhaseMarkedRef,
    fbdPhaseStartedRef,
    activeVerifiedDiagramRef,
    setActiveVerifiedDiagram,
    segmentPlanStatsRef,
    stopTurnRef,
    speedRef,
    fastModeRef,
    pendingSegmentCountRef,
    narrationDensityRef,
    replayGenerationRef,
    replayCueRef,
    setPhase,
    setIsPaused,
    setNarrationText,
    setCurrentSegmentText,
    setLastError,
    setInputInteracted,
    setLiveQuestion,
    setIsReplaying,
    setReplayProgressMs,
    setReplayTotalMs,
    setStoredTurnsCount,
    setBoards,
    ensureTTSClient,
    executeCommandWithCancel,
    cancellableDelay,
    raceWithCancel,
    clearCancelTimers,
    resetBoardLayout,
    beginBoardEpoch,
    reserveTextCommandPlacement,
    persistTurnForReplay,
    registerReplayBlobUrl,
    revokeUnreferencedReplayBlobUrls,
  });

  const notesEnabled = !isEmbed && !isHeadless;
  const lectureInProgress = phase !== "idle" && !isReplaying;
  const lessonNotes = useMemo(
    () =>
      buildLessonNotes({
        persistedTurns: storedTurnsRef.current,
        lectureInProgress,
        live: lectureInProgress
          ? {
              question:
                liveQuestion || storedTurnsRef.current.at(-1)?.question || "",
              collectedSegments: collectedSegmentsRef.current,
              recordedSegments: recordedSegmentsRef.current,
              currentSegmentText,
              rawResponse: rawResponseRef.current,
              sceneArtifacts:
                storedTurnsRef.current.at(-1)?.question === liveQuestion
                  ? storedTurnsRef.current.at(-1)?.sceneArtifacts
                  : undefined,
            }
          : null,
      }),
    [
      currentSegmentText,
      lectureInProgress,
      liveQuestion,
      narrationText,
      sessionId,
      storedTurnsCount,
    ],
  );
  const { messages: notesMessages, sending: notesSending, error: notesError, send: sendNotesChat } =
    useNotesChat(sessionId, notesEnabled);

  useEffect(() => {
    notesUserToggledRef.current = false;
    setLiveQuestion("");
  }, [sessionId]);

  useEffect(() => {
    if (!notesEnabled || isMobile) return;
    if (notesUserToggledRef.current) return;
    if (phase !== "idle" || storedTurnsCount > 0) {
      setNotesOpen(true);
    }
  }, [isMobile, notesEnabled, phase, storedTurnsCount]);

  const toggleNotes = useCallback(() => {
    notesUserToggledRef.current = true;
    setNotesOpen((open) => !open);
  }, []);

  const notesRailOpen = notesEnabled && notesOpen && !isMobile;

  const handleNotesChatSend = useCallback(
    (message: string) => {
      const liveTurn = lessonNotes.turns[lessonNotes.turns.length - 1] ?? null;
      void sendNotesChat(message, liveNotesPayload(liveTurn), lectureInProgress);
    },
    [lectureInProgress, lessonNotes, sendNotesChat],
  );

  const {
    replayLecture,
    downloadNotesPdf,
    seekReplay,
    toggleReplayPlayPause,
    handleReplaySpeedChange: applyReplaySpeed,
  } = useReplay({
    whiteboardRef,
    cancelRef,
    speedRef,
    isPausedRef,
    replayAudioRef,
    replayAudioPreloadRef,
    storedTurnsRef,
    replayGenerationRef,
    replayCueRef,
    ttsClientRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    phaseRef,
    isReplaying,
    isPaused,
    isDownloading,
    replayProgressMs,
    boards,
    sessionId,
    setPhase,
    setCurrentSegmentText,
    setNarrationText,
    setIsPaused,
    setIsReplaying,
    setReplayProgressMs,
    setReplayTotalMs,
    setSettings,
    setIsDownloading,
    cancellableDelay,
    raceWithCancel,
    executeCommandWithCancel,
    executeCommand,
    resetBoardLayout,
    finishLectureUi,
    pauseTurn,
    resumeTurn,
  });

  const handleReplaySpeedChange = (rate: number) => {
    applyReplaySpeed(rate);
    onPlaybackRateChange?.(rate);
  };

  useEffect(() => {
    syncControlledPlaybackRate(playbackRate, speedRef.current, applyReplaySpeed);
  }, [playbackRate, applyReplaySpeed]);

  const autoReplayStartedRef = useRef(false);
  useEffect(() => {
    autoReplayStartedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!autoReplay) {
      autoReplayStartedRef.current = false;
    }
  }, [autoReplay]);

  useEffect(() => {
    if (
      !canStartStoredLectureReplay({
        autoReplay,
        isHeadless,
        boardLoaded,
        storedTurnsCount,
        isReplaying,
        alreadyStarted: autoReplayStartedRef.current,
        viewportMeasured: boardViewport.measured,
      })
    ) {
      return;
    }
    if (!replayLecture()) {
      return;
    }
    autoReplayStartedRef.current = true;
  }, [
    autoReplay,
    isHeadless,
    boardLoaded,
    storedTurnsCount,
    isReplaying,
    replayLecture,
    storedTurnsRef,
    boardViewport.measured,
    boardViewport.scale,
  ]);

  const stopTurnOnUnmountRef = useRef(stopTurn);
  useEffect(() => {
    stopTurnOnUnmountRef.current = stopTurn;
  }, [stopTurn]);
  useEffect(() => {
    return () => {
      stopTurnOnUnmountRef.current();
    };
  }, []);

  if (isHeadless) {
    return (
      <div
        ref={boardContainerRef}
        data-tutor-session="headless"
        style={{
          position: "relative",
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
          flexShrink: 0,
        }}
      >
        <Whiteboard
          ref={whiteboardRef}
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
          cursorState={cursorState}
          inkColor={getMarkerColorHex(settings.markerColor)}
        />
        {phase === "planning" && (
          <ThinkingOverlay message="planning the diagram…" />
        )}
        {phase === "thinking" && <ThinkingOverlay />}
      </div>
    );
  }

  const activeStatus = resolveActiveStatus(phase, isReplaying, isPaused);

  const activeBoard = boards.find((b) => b.id === sessionId);
  const activeBoardTitle = activeBoard?.title ?? "";
  const canReplay = phase === "idle" && storedTurnsCount > 0 && !isReplaying;
  const canDownload = phase === "idle" && storedTurnsCount > 0 && !isReplaying;
  const isInputOverlay = !isEmbed && phase === "idle" && boardLoaded && !inputInteracted;
  const inputSubmitMode = lessonFollowUpMode(storedTurnsCount > 0);
  const showBoardLoading = !boardLoaded;

  const inputChrome = (
    <SessionInputChrome
      isInputOverlay={isInputOverlay}
      phase={phase}
      isPaused={isPaused}
      inputSubmitMode={inputSubmitMode}
      onSubmit={storedTurnsCount > 0 ? startNextQuestion : handleQuestion}
      onAskDoubt={handleAskDoubt}
      onPauseToggle={() => (isPaused ? resumeTurn() : pauseTurn())}
      onCancel={stopTurn}
      onUserInteractionChange={setInputInteracted}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );

  const showEmptyLanding = isInputOverlay && storedTurnsCount === 0;
  const fullBleedLanding = showEmptyLanding;
  const framePad = isCompactNav ? 20 : 32;

  return (
    <div
      className={
        isEmbed
          ? "relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          : "relative flex h-dvh max-h-dvh min-w-0 overflow-hidden"
      }
      data-tutor-session={isEmbed ? "embed" : "full"}
      style={{
        background: "var(--wb-bg)",
      }}
    >
      {!isEmbed ? (
        <>
          <BoardHistory
            boards={boards}
            activeBoardId={sessionId}
            onSelect={switchBoard}
            onNew={createNewBoard}
            onDelete={deleteBoard}
            disabled={phase !== "idle"}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            onWidthChange={setSidebarWidth}
            onResizingChange={setSidebarResizing}
            profileOpen={profileOpen}
            onProfileToggle={() => setProfileOpen(!profileOpen)}
          />

          <BoardHistory
            variant="drawer"
            open={mobileNavOpen}
            onOpenChange={setMobileNavOpen}
            boards={boards}
            activeBoardId={sessionId}
            onSelect={switchBoard}
            onNew={createNewBoard}
            onDelete={deleteBoard}
            disabled={phase !== "idle"}
            profileOpen={profileOpen}
            onProfileToggle={() => setProfileOpen(!profileOpen)}
          />
        </>
      ) : null}

      {notesRailOpen ? (
        <div
          className="flex"
          style={{
            position: "fixed",
            right: 0,
            top: 0,
            zIndex: 40,
            width: NOTES_CHAT_RAIL_WIDTH,
            height: "100dvh",
            borderLeft: "1px solid rgba(242, 242, 244, 0.08)",
          }}
        >
          <NotesChatSidebar
            notes={lessonNotes}
            messages={notesMessages}
            sending={notesSending}
            error={notesError}
            live={lectureInProgress}
            onClose={toggleNotes}
            onSend={handleNotesChatSend}
          />
        </div>
      ) : null}

      {notesEnabled ? (
        <Sheet open={isMobile && notesOpen} onOpenChange={(open) => {
          notesUserToggledRef.current = true;
          setNotesOpen(open);
        }}>
          <SheetContent
            side="right"
            className="w-[min(100%,380px)] border-l border-[rgba(242,242,244,0.08)] p-0 sm:max-w-[380px]"
          >
            <SheetTitle className="sr-only">Notes</SheetTitle>
            <NotesChatSidebar
              notes={lessonNotes}
              messages={notesMessages}
              sending={notesSending}
              error={notesError}
              live={lectureInProgress}
              onSend={handleNotesChatSend}
            />
          </SheetContent>
        </Sheet>
      ) : null}

      <div
        className={`relative z-10 flex min-h-0 min-w-0 flex-1 flex-col ${
          isEmbed ? "h-full" : ""
        } ${
          isEmbed ? "" : "md:mr-[var(--tutor-notes-width)] md:ml-[var(--tutor-sidebar-width)]"
        }`}
        style={{
          ["--tutor-sidebar-width" as string]:
            isEmbed || sidebarCollapsed ? "0px" : `${sidebarWidth}px`,
          ["--tutor-notes-width" as string]: notesRailOpen
            ? `${NOTES_CHAT_RAIL_WIDTH}px`
            : "0px",
          paddingLeft: `max(${PAGE_GUTTER_X}px, env(safe-area-inset-left))`,
          paddingRight: `max(${PAGE_GUTTER_X}px, env(safe-area-inset-right))`,
          paddingTop: `max(12px, env(safe-area-inset-top))`,
          paddingBottom: `max(12px, env(safe-area-inset-bottom))`,
          transition: sidebarResizing
            ? "none"
            : "margin-left 0.25s cubic-bezier(0.16, 1, 0.3, 1), margin-right 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {!isEmbed ? (
          <SessionHeader
            showNavButton
            navButtonClassName={sidebarCollapsed ? undefined : "md:hidden"}
            onExpandSidebar={() => {
              if (isMobile) {
                setMobileNavOpen(true);
                return;
              }
              setSidebarCollapsed(false);
            }}
            boardTitle={activeBoardTitle}
            canReplay={canReplay}
            canDownload={canDownload}
            isReplaying={isReplaying}
            isDownloading={isDownloading}
            phase={phase}
            activeStatus={activeStatus}
            compactActions={isCompactNav}
            notesOpen={notesOpen}
            showNotesToggle={notesEnabled}
            onToggleNotes={toggleNotes}
            onReplay={replayLecture}
            onDownload={downloadNotesPdf}
            onStop={stopTurn}
          />
        ) : null}

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={boardContainerRef}
            className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
            style={{
              marginTop: PAGE_GUTTER_Y,
            }}
          >
            {fullBleedLanding && (
              <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto overscroll-contain rounded-2xl border border-[rgba(242,242,244,0.08)] bg-[#0B0B0C]">
                <div className="flex min-h-full w-full flex-col [justify-content:safe_center] px-4 py-6 sm:px-8 sm:py-10">
                  <CanvasLanding
                    suggestions={LANDING_SUGGESTIONS}
                    onSubmit={(question) => void handleQuestion(question)}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                </div>
                <CanvasLandingDoodles />
              </div>
            )}

            <div
              className={`wb-frame relative max-w-full ${
                fullBleedLanding ? "pointer-events-none invisible absolute" : ""
              }`}
              style={{
                width: BOARD_WIDTH * boardViewport.scale + framePad,
                height: BOARD_HEIGHT * boardViewport.scale + framePad,
                maxWidth: "100%",
              }}
              aria-hidden={fullBleedLanding || undefined}
            >
            <div className="wb-surface absolute overflow-hidden">
            {isInputOverlay && !fullBleedLanding && (
              <div
                className="pointer-events-none absolute inset-0 z-10"
                style={{
                  backgroundColor: "rgba(13, 17, 23, 0.55)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              />
            )}

            {showBoardLoading && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center"
                style={{
                  backgroundColor: "rgba(13, 17, 23, 0.55)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              >
                <p className="text-sm text-[#A6A6AE]">Loading board…</p>
              </div>
            )}

            {isEmbed && boardLoaded && storedTurnsCount === 0 ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center">
                <p className="text-sm text-[#A6A6AE]">No saved lecture on this board.</p>
              </div>
            ) : null}

            {isInputOverlay && storedTurnsCount > 0 && (
              <div
                className="absolute inset-0 z-20 flex flex-col items-center justify-center px-3 sm:px-4"
                style={{ pointerEvents: "none" }}
              >
                <div className="w-full max-w-[720px]" style={{ pointerEvents: "auto" }}>
                  {inputChrome}
                </div>
              </div>
            )}

            {phase === "planning" && (
              <ThinkingOverlay message="planning the diagram…" />
            )}

            {phase === "thinking" && <ThinkingOverlay />}

            <SessionBoardCanvas
              boardViewport={boardViewport}
              whiteboardRef={whiteboardRef}
              cursorState={cursorState}
              settings={settings}
              phase={phase}
              currentSegmentText={currentSegmentText}
              lastError={lastError}
              isReplaying={isReplaying}
              isPaused={isPaused}
              replayProgressMs={replayProgressMs}
              replayTotalMs={replayTotalMs}
              verifiedDiagram={activeVerifiedDiagram}
              onRetraceEntity={handleRetraceEntity}
              onRetryError={(question) => {
                setLastError(null);
                void handleQuestion(question);
              }}
              onDismissError={() => setLastError(null)}
              onReplayPlayPause={toggleReplayPlayPause}
              onReplaySeek={seekReplay}
              onReplaySpeedChange={handleReplaySpeedChange}
              onStop={stopTurn}
            />
            </div>
            </div>
          </div>
        </main>

        {!isEmbed && !isInputOverlay && (
          <footer
            className="relative shrink-0"
            style={{ paddingTop: PAGE_GUTTER_Y }}
          >
            {inputChrome}
          </footer>
        )}

        {!isEmbed ? (
          <SettingsDrawer
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={settings}
            onSettingsChange={setSettings}
          />
        ) : null}
      </div>
    </div>
  );
}
