"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TranscriptDialog } from "@/features/tutor-session/components/TranscriptDialog";
import { BoardHistory } from "@/features/tutor-session/components/BoardHistory";
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
import { useIsCompactNav } from "@/lib/client/useMediaQuery";
import { ThinkingOverlay } from "./components/ThinkingOverlay";
import { BoardSettingsButton } from "./components/BoardSettingsButton";
import { SessionInputChrome } from "./components/SessionInputChrome";
import { SessionHeader } from "./components/SessionHeader";
import { SessionBoardCanvas } from "./components/SessionBoardCanvas";
import { Whiteboard } from "./components/WhiteboardLoader";
import { useReplay } from "./hooks/useReplay";
import { useCommandExecution } from "./hooks/useCommandExecution";
import { useCancelControl } from "./hooks/useCancelControl";
import { useTurnLifecycle } from "./hooks/useTurnLifecycle";
import { useBoardLayout } from "./hooks/useBoardLayout";
import { useBoardSession } from "./hooks/useBoardSession";
import { useAdaptiveDrawSpeed } from "./hooks/useAdaptiveDrawSpeed";
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
import {
  DEFAULT_REPLAY_SPEED,
  syncControlledPlaybackRate,
} from "@/lib/replay/replayAudio";
import {
  PAGE_GUTTER_X,
  PAGE_GUTTER_Y,
  LANDING_SUGGESTIONS,
  BOARD_WIDTH,
  BOARD_HEIGHT,
} from "./constants";
import type { TutorPhase, SegmentPlanStats } from "./types";
import { createEmptySegmentPlanStats } from "./lib/segmentPlanning";
import { lessonFollowUpMode } from "./lib/lessonFollowUp";
import { resolveActiveStatus } from "./lib/statusConfig";

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isCompactNav = useIsCompactNav();
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgressMs, setReplayProgressMs] = useState(0);
  const [replayTotalMs, setReplayTotalMs] = useState(0);
  const replayGenerationRef = useRef(0);
  const replayCueRef = useRef<ReplayCue | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

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

  const cursorState: CursorState =
    phase === "thinking"
      ? "thinking"
      : phase === "drawing" || phase === "speaking"
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
    setTranscriptOpen,
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
    phase,
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
    if (!autoReplay || isHeadless || !boardLoaded || storedTurnsCount === 0 || isReplaying) {
      return;
    }
    if (autoReplayStartedRef.current) {
      return;
    }
    if (storedTurnsRef.current.length === 0) {
      return;
    }
    autoReplayStartedRef.current = true;
    replayLecture();
  }, [autoReplay, isHeadless, boardLoaded, storedTurnsCount, isReplaying, replayLecture, storedTurnsRef]);

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
      </div>
    );
  }

  const activeStatus = resolveActiveStatus(phase, isReplaying, isPaused);

  const activeBoard = boards.find((b) => b.id === sessionId);
  const activeBoardTitle = activeBoard?.title ?? "";
  const canReplay = phase === "idle" && storedTurnsCount > 0 && !isReplaying;
  const canTranscript =
    narrationText.trim().length > 0 && (isEmbed || (phase === "idle" && !isReplaying));
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
    />
  );

  const showEmptyLanding = isInputOverlay && storedTurnsCount === 0;
  const fullBleedLanding = showEmptyLanding;
  const framePad = isCompactNav ? 20 : 32;

  return (
    <div
      className={
        isEmbed
          ? "relative flex h-full min-h-0 min-w-0 overflow-hidden"
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

      <div
        className={`relative z-10 flex min-h-0 min-w-0 flex-1 flex-col ${
          isEmbed || sidebarCollapsed ? "" : "lg:ml-[264px]"
        }`}
        style={{
          paddingLeft: `max(${PAGE_GUTTER_X}px, env(safe-area-inset-left))`,
          paddingRight: `max(${PAGE_GUTTER_X}px, env(safe-area-inset-right))`,
          paddingTop: `max(12px, env(safe-area-inset-top))`,
          paddingBottom: `max(12px, env(safe-area-inset-bottom))`,
          transition: "margin-left 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {!isEmbed ? (
          <SessionHeader
            showNavButton
            navButtonClassName={sidebarCollapsed ? undefined : "lg:hidden"}
            onExpandSidebar={() => {
              if (
                typeof window !== "undefined" &&
                window.matchMedia("(max-width: 1023px)").matches
              ) {
                setMobileNavOpen(true);
                return;
              }
              setSidebarCollapsed(false);
            }}
            boardTitle={activeBoardTitle}
            canReplay={canReplay}
            canTranscript={canTranscript}
            canDownload={canDownload}
            isReplaying={isReplaying}
            isDownloading={isDownloading}
            phase={phase}
            activeStatus={activeStatus}
            compactActions={isCompactNav}
            onReplay={replayLecture}
            onTranscript={() => setTranscriptOpen(true)}
            onDownload={downloadNotesPdf}
            onStop={stopTurn}
            onOpenSettings={() => setSettingsOpen(true)}
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
            {!showEmptyLanding && !isEmbed && (
              <BoardSettingsButton settings={settings} onOpen={() => setSettingsOpen(true)} />
            )}
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

            <TranscriptDialog
              text={narrationText}
              open={transcriptOpen}
              onClose={() => setTranscriptOpen(false)}
            />

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
