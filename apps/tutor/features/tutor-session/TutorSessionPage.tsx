"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { TranscriptDialog } from "@/components/TranscriptDialog";
import { BoardHistory, SIDEBAR_WIDTH } from "@/components/BoardHistory";
import { SettingsDrawer, type SettingsState } from "@/components/SettingsDrawer";
import { CanvasLanding } from "@/components/CanvasLanding";
import { type ReplayCue } from "@/lib/replayTimeline";
import type { WhiteboardHandle, CursorState } from "@heytutor/whiteboard";
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
  WHITEBOARD_COLOR,
  PAGE_GUTTER_X,
  PAGE_GUTTER_Y,
  LANDING_SUGGESTIONS,
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
  const isInputOverlay = phase === "idle" && !inputInteracted;
  const inputSubmitMode = storedTurnsCount > 0 ? "doubt" : "ask";

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

  return (
    <div
      className="relative flex h-screen overflow-hidden"
      style={{
        background: "#659287",
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

      <div
        className="relative z-10 flex flex-1 flex-col min-h-0"
        style={{
          marginLeft: sidebarCollapsed ? 0 : SIDEBAR_WIDTH,
          paddingLeft: PAGE_GUTTER_X,
          paddingRight: PAGE_GUTTER_X,
          transition: "margin-left 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <SessionHeader
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={() => setSidebarCollapsed(false)}
          canReplay={canReplay}
          canTranscript={canTranscript}
          canDownload={canDownload}
          isReplaying={isReplaying}
          isDownloading={isDownloading}
          phase={phase}
          activeStatus={activeStatus}
          onReplay={replayLecture}
          onTranscript={() => setTranscriptOpen(true)}
          onDownload={downloadNotesPdf}
          onStop={stopTurn}
        />

        <main className="relative flex flex-1 flex-col min-h-0">
          {activeBoardTitle && activeBoardTitle !== "new board" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px 12px",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: "1.05rem",
                  fontWeight: 600,
                  color: "#659287",
                  textTransform: "capitalize",
                  letterSpacing: "0.01em",
                  userSelect: "none",
                }}
              >
                {activeBoardTitle}
              </span>
            </div>
          )}

          <div
            className="relative min-h-0 flex-1 overflow-hidden rounded-2xl"
            style={{
              background: WHITEBOARD_COLOR,
              marginTop: PAGE_GUTTER_Y,
              boxShadow: "0 1px 4px rgba(0, 0, 0, 0.05), inset 0 0 0 1px rgba(101, 146, 135, 0.08)",
            }}
          >
            <BoardSettingsButton settings={settings} onOpen={() => setSettingsOpen(true)} />
            {isInputOverlay && (
              <div
                className="pointer-events-none absolute inset-0 z-10"
                style={{
                  backgroundColor: "rgba(230, 242, 221, 0.6)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              />
            )}

            {isInputOverlay && storedTurnsCount === 0 && (
              <div
                className="absolute inset-0 z-20 flex flex-col items-center justify-center px-4 overflow-y-auto"
                style={{ pointerEvents: "none" }}
              >
                <div style={{ width: "100%", maxWidth: "720px", pointerEvents: "auto" }}>
                  <CanvasLanding
                    suggestions={LANDING_SUGGESTIONS}
                    onSubmit={(question) => void handleQuestion(question)}
                  />
                </div>
              </div>
            )}

            {isInputOverlay && storedTurnsCount > 0 && (
              <div
                className="absolute inset-0 z-20 flex flex-col items-center justify-center px-4"
                style={{ pointerEvents: "none" }}
              >
                <div style={{ width: "100%", maxWidth: "720px", pointerEvents: "auto" }}>
                  {inputChrome}
                </div>
              </div>
            )}

            {phase === "thinking" && <ThinkingOverlay />}

            <TranscriptDialog
              text={narrationText}
              open={transcriptOpen}
              onClose={() => setTranscriptOpen(false)}
            />

            <SessionBoardCanvas
              boardContainerRef={boardContainerRef}
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
        </main>

        {!isInputOverlay && (
          <footer
            className="relative shrink-0 pt-2 pb-3"
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
