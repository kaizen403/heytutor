"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { TranscriptDialog } from "@/components/TranscriptDialog";
import { BoardHistory } from "@/components/BoardHistory";
import { SettingsDrawer, type SettingsState } from "@/components/SettingsDrawer";
import { CanvasLanding } from "@/components/CanvasLanding";
import { type ReplayCue } from "@/lib/replayTimeline";
import type { WhiteboardHandle, CursorState } from "@heytutor/whiteboard";
import { useIsCompactNav } from "@/lib/useMediaQuery";
import { ThinkingOverlay } from "./components/ThinkingOverlay";
import { BoardSettingsButton } from "./components/BoardSettingsButton";
import { SessionInputChrome } from "./components/SessionInputChrome";
import { SessionHeader } from "./components/SessionHeader";
import { SessionBoardCanvas } from "./components/SessionBoardCanvas";
import { useReplay } from "./hooks/useReplay";
import { useCommandExecution } from "./hooks/useCommandExecution";
import { useCancelControl } from "./hooks/useCancelControl";
import { useTurnLifecycle } from "./hooks/useTurnLifecycle";
import { useBoardLayout } from "./hooks/useBoardLayout";
import { useBoardSession } from "./hooks/useBoardSession";
import { useAdaptiveDrawSpeed } from "./hooks/useAdaptiveDrawSpeed";
import {
  type TutorSegment,
  type DiagramTemplate,
} from "@heytutor/drawing";
import {
  type TTSClient,
} from "@heytutor/tutor-core";
import { type TurnTelemetry } from "@/lib/turnTelemetry";
import { type RecordedSegmentPayload } from "@/lib/boardsClient";
import {
  PAGE_GUTTER_X,
  PAGE_GUTTER_Y,
  LANDING_SUGGESTIONS,
  BOARD_WIDTH,
  BOARD_HEIGHT,
} from "./constants";
import type { TutorPhase, SegmentPlanStats } from "./types";
import { createEmptySegmentPlanStats } from "./lib/segmentPlanning";
import { resolveActiveStatus } from "./lib/statusConfig";

export function TutorSessionPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = params.sessionId as string;

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
  const activeDiagramTemplateRef = useRef<DiagramTemplate | null>(null);
  const segmentPlanStatsRef = useRef<SegmentPlanStats>(createEmptySegmentPlanStats());
  const stopTurnRef = useRef<(() => void) | null>(null);
  const pendingSegmentCountRef = useRef(0);
  const narrationDensityRef = useRef(0);
  const [settings, setSettings] = useState<SettingsState>({
    speedMultiplier: 1.5,
    audioLanguage: "english",
    accent: "us",
    subtitlesEnabled: true,
    subtitleLanguage: "english",
    markerColor: "navy",
  });
  const speedRef = useRef(1.5);
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
    forgetErasedTextRects,
    resolveTextPlacement,
  } = useBoardLayout({
    whiteboardRef,
    cancelRef,
    fbdPhaseStartedRef,
  });

  const { executeCommand, executeCommandWithCancel } = useCommandExecution({
    whiteboardRef,
    cancelRef,
    speedRef,
    boardLayoutRef,
    forceSequentialWorkLayoutRef,
    fbdPhaseMarkedRef,
    fbdPhaseStartedRef,
    activeDiagramTemplateRef,
    turnTelemetryRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    cancellableDelay,
    forgetErasedTextRects,
    resetBoardLayout,
    resolveTextPlacement,
    raceWithCancel,
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
    switchBoard,
    deleteBoard,
    ensureTTSClient,
    registerReplayBlobUrl,
    revokeReplayBlobUrls,
    persistTurnForReplay,
  } = useBoardSession({
    sessionId,
    router,
    phase,
    speedMultiplier: settings.speedMultiplier,
    whiteboardRef,
    cancelRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    ttsClientRef,
    speedRef,
    stopTurnRef,
    setNarrationText,
    setCurrentSegmentText,
    resetBoardLayout,
    executeCommand,
  });

  // Adaptive drawing speed: polls audio lag + queue depth + narration density
  // and pushes a dynamic animation-speed factor to the whiteboard.
  useAdaptiveDrawSpeed({
    whiteboardRef,
    ttsClientRef,
    turnActiveRef,
    speedRef,
    pendingSegmentCountRef,
    narrationDensityRef,
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
    searchParams,
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
    activeDiagramTemplateRef,
    segmentPlanStatsRef,
    stopTurnRef,
    speedRef,
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
    persistTurnForReplay,
    registerReplayBlobUrl,
    revokeReplayBlobUrls,
  });

  const {
    replayLecture,
    downloadNotesPdf,
    seekReplay,
    toggleReplayPlayPause,
    handleReplaySpeedChange,
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

  const activeStatus = resolveActiveStatus(phase, isReplaying, isPaused);

  const activeBoard = boards.find((b) => b.id === sessionId);
  const activeBoardTitle = activeBoard?.title ?? "";
  const canReplay = phase === "idle" && storedTurnsCount > 0 && !isReplaying;
  const canTranscript = phase === "idle" && narrationText.trim().length > 0 && !isReplaying;
  const canDownload = phase === "idle" && storedTurnsCount > 0 && !isReplaying;
  const isInputOverlay = phase === "idle" && boardLoaded && !inputInteracted;
  const inputSubmitMode = storedTurnsCount > 0 ? "doubt" : "ask";
  const showBoardLoading = !boardLoaded;

  const inputChrome = (
    <SessionInputChrome
      isInputOverlay={isInputOverlay}
      phase={phase}
      isPaused={isPaused}
      inputSubmitMode={inputSubmitMode}
      onSubmit={handleQuestion}
      onAskDoubt={handleAskDoubt}
      onPauseToggle={() => (isPaused ? resumeTurn() : pauseTurn())}
      onCancel={stopTurn}
      onUserInteractionChange={setInputInteracted}
    />
  );

  const showEmptyLanding = isInputOverlay && storedTurnsCount === 0;
  const fullBleedLanding = showEmptyLanding && isCompactNav;
  const framePad = isCompactNav ? 20 : 32;

  return (
    <div
      className="relative flex h-dvh max-h-dvh min-w-0 overflow-hidden"
      style={{
        background: "var(--wb-bg)",
      }}
    >
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

      <div
        className={`relative z-10 flex min-h-0 min-w-0 flex-1 flex-col ${
          sidebarCollapsed ? "" : "lg:ml-[264px]"
        }`}
        style={{
          paddingLeft: `max(${PAGE_GUTTER_X}px, env(safe-area-inset-left))`,
          paddingRight: `max(${PAGE_GUTTER_X}px, env(safe-area-inset-right))`,
          paddingTop: `max(12px, env(safe-area-inset-top))`,
          paddingBottom: `max(12px, env(safe-area-inset-bottom))`,
          transition: "margin-left 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
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

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={boardContainerRef}
            className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
            style={{
              marginTop: PAGE_GUTTER_Y,
            }}
          >
            {fullBleedLanding && (
              <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto overscroll-contain rounded-2xl border border-white/70 bg-white/95 shadow-[0_8px_30px_-18px_rgba(37,99,235,0.28)] backdrop-blur-md">
                <div className="my-auto w-full px-3 py-5 sm:px-6 sm:py-8">
                  <CanvasLanding
                    suggestions={LANDING_SUGGESTIONS}
                    onSubmit={(question) => void handleQuestion(question)}
                  />
                </div>
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
            <BoardSettingsButton settings={settings} onOpen={() => setSettingsOpen(true)} />
            {isInputOverlay && !fullBleedLanding && (
              <div
                className="pointer-events-none absolute inset-0 z-10"
                style={{
                  backgroundColor: "rgba(242, 247, 252, 0.72)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              />
            )}

            {showBoardLoading && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center"
                style={{
                  backgroundColor: "rgba(242, 247, 252, 0.72)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              >
                <p className="text-sm text-slate-500">Loading board…</p>
              </div>
            )}

            {showEmptyLanding && !fullBleedLanding && (
              <div
                className="absolute inset-0 z-20 flex flex-col items-center justify-start overflow-y-auto overscroll-contain px-3 py-4 sm:justify-center sm:px-4 sm:py-6"
                style={{ pointerEvents: "none" }}
              >
                <div className="my-auto w-full max-w-[720px]" style={{ pointerEvents: "auto" }}>
                  <CanvasLanding
                    suggestions={LANDING_SUGGESTIONS}
                    onSubmit={(question) => void handleQuestion(question)}
                  />
                </div>
              </div>
            )}

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

        {!isInputOverlay && (
          <footer
            className="relative shrink-0"
            style={{ paddingTop: PAGE_GUTTER_Y }}
          >
            {inputChrome}
          </footer>
        )}

        <SettingsDrawer
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onSettingsChange={setSettings}
        />
      </div>
    </div>
  );
}
