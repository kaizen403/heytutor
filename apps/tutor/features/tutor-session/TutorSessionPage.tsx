"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ResponseBubble } from "@/components/ResponseBubble";
import { TranscriptDialog } from "@/components/TranscriptDialog";
import { BoardHistory, SIDEBAR_WIDTH, type BoardEntry } from "@/components/BoardHistory";
import { ReplayControls } from "@/components/ReplayControls";
import { SettingsDrawer, type SettingsState, getMarkerColorHex } from "@/components/SettingsDrawer";
import { CanvasLanding } from "@/components/CanvasLanding";
import { type ReplayCue } from "@/lib/replayTimeline";
import { buildLocalStoredTurn } from "@/lib/replayTurns";
import type { WhiteboardHandle, CursorState } from "@heytutor/whiteboard";
import { Whiteboard } from "./components/WhiteboardLoader";
import { ThinkingOverlay } from "./components/ThinkingOverlay";
import { BoardSettingsButton } from "./components/BoardSettingsButton";
import { BoardErrorBanner } from "./components/BoardErrorBanner";
import { SessionInputChrome } from "./components/SessionInputChrome";
import { SessionHeader } from "./components/SessionHeader";
import { useBoardViewport } from "./hooks/useBoardViewport";
import { useReplay } from "./hooks/useReplay";
import { useCommandExecution } from "./hooks/useCommandExecution";
import { useCancelControl } from "./hooks/useCancelControl";
import { useTurnLifecycle } from "./hooks/useTurnLifecycle";
import {
  type DrawCommand,
  type TutorSegment,
  parseStoredSegmentCommands,
  lessonNarrationText,
  type DiagramTemplate,
} from "@heytutor/drawing";
import {
  createTTSClient,
  tutorDebug,
  type ConversationExchange,
  type TTSClient,
} from "@heytutor/tutor-core";
import { type TurnTelemetry } from "@/lib/turnTelemetry";
import { type NotesEpoch } from "@/lib/exportNotesPdf";
import {
  createBoard,
  deleteBoardApi,
  fetchBoardDetail,
  fetchBoards,
  type RecordedSegmentPayload,
  type StoredTurn,
} from "@/lib/boardsClient";
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  WHITEBOARD_COLOR,
  PAGE_GUTTER_X,
  PAGE_GUTTER_Y,
  LANDING_SUGGESTIONS,
  TEXT_LAYOUT,
  DIAGRAM_ZONE,
} from "./constants";
import type { TutorPhase, BoardTextRect, BoardLayoutState, SegmentPlanStats } from "./types";
import {
  isInDiagramZone,
  clampNumber,
  estimateBoardTextWidth,
  textRectsOverlap,
  registerBoardAnchor,
  getWorkAreaFlowStartY,
  overlapsWorkArea,
} from "./lib/boardLayout";
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
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const boardViewport = useBoardViewport(boardContainerRef);
  const [phase, setPhase] = useState<TutorPhase>("idle");
  const phaseRef = useRef<TutorPhase>("idle");
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [narrationText, setNarrationText] = useState("");
  const [currentSegmentText, setCurrentSegmentText] = useState("");
  const [lastError, setLastError] = useState<{ message: string; question: string } | null>(null);
  const conversationHistoryRef = useRef<ConversationExchange[]>([]);
  const ttsClientRef = useRef<TTSClient | null>(null);
  const replayAudioRef = useRef<HTMLAudioElement | null>(null);
  const replayAudioPreloadRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const cancelRef = useRef(false);
  const turnActiveRef = useRef(false);
  const turnAbortRef = useRef<AbortController | null>(null);
  const segmentChainRef = useRef(Promise.resolve());
  const collectedSegmentsRef = useRef<TutorSegment[]>([]);
  const recordedSegmentsRef = useRef<RecordedSegmentPayload[]>([]);
  const storedTurnsRef = useRef<StoredTurn[]>([]);
  const [storedTurnsCount, setStoredTurnsCount] = useState(0);
  const rawResponseRef = useRef("");
  const currentTraceIdRef = useRef<string | null>(null);
  const turnTelemetryRef = useRef<TurnTelemetry | null>(null);
  const turnStatsRef = useRef({ drawMs: 0, ttsChars: 0 });
  const notesEpochsRef = useRef<NotesEpoch[]>([]);
  const narrationSinceEpochRef = useRef("");
  const [isDownloading, setIsDownloading] = useState(false);
  const boardLayoutRef = useRef<BoardLayoutState>({
    rects: [],
    nextY: TEXT_LAYOUT.topY,
  });
  /** After a work-area erase, ignore LLM y coords and fill rows top-down. */
  const forceSequentialWorkLayoutRef = useRef(false);
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
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgressMs, setReplayProgressMs] = useState(0);
  const [replayTotalMs, setReplayTotalMs] = useState(0);
  const replayGenerationRef = useRef(0);
  const replayCueRef = useRef<ReplayCue | null>(null);
  const replayBlobUrlsRef = useRef<string[]>([]);
  const [inputInteracted, setInputInteracted] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const boardsFetchedRef = useRef(false);
  useEffect(() => {
    if (boardsFetchedRef.current) return;
    boardsFetchedRef.current = true;
    void fetchBoards().then((list) => {
      setBoards((prev) => {
        const existingIds = new Set(prev.map((b) => b.id));
        const newOnes = list.filter((b) => !existingIds.has(b.id));
        return [...prev, ...newOnes];
      });
    });
  }, []);

  useEffect(() => {
    speedRef.current = settings.speedMultiplier;
    ttsClientRef.current?.setPlaybackRate(settings.speedMultiplier);
  }, [settings.speedMultiplier]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const createNewBoard = useCallback(() => {
    void (async () => {
      const unused = boards.find(
        (b) => b.title === "new board" && !b.preview,
      );
      if (unused) {
        if (unused.id === sessionId) return;
        router.push(`/c/${unused.id}`);
        return;
      }
      const board = await createBoard();
      if (!board) return;
      setBoards((prev) => [board, ...prev.filter((b) => b.id !== board.id)]);
      router.push(`/c/${board.id}`);
    })();
  }, [boards, sessionId, router]);

  const switchBoard = useCallback(
    (id: string) => {
      if (id === sessionId) return;
      router.push(`/c/${id}`);
    },
    [sessionId, router],
  );

  const deleteBoard = useCallback(
    (id: string) => {
      void (async () => {
        if (id === sessionId && phase !== "idle") {
          stopTurnRef.current?.();
        }

        const ok = await deleteBoardApi(id);
        if (!ok) {
          return;
        }

        let remaining: BoardEntry[] = [];
        setBoards((prev) => {
          remaining = prev.filter((b) => b.id !== id);
          return remaining;
        });

        if (id === sessionId) {
          if (remaining.length > 0) {
            router.push(`/c/${remaining[0]!.id}`);
          } else {
            createNewBoard();
          }
        }
      })();
    },
    [sessionId, router, createNewBoard, phase],
  );

  const ensureTTSClient = useCallback((): TTSClient => {
    if (!ttsClientRef.current) {
      ttsClientRef.current = createTTSClient();
    }
    ttsClientRef.current.setPlaybackRate(speedRef.current);
    return ttsClientRef.current;
  }, []);

  useEffect(() => {
    ensureTTSClient();

    return () => {
      ttsClientRef.current?.stop();
    };
  }, [ensureTTSClient]);

  const cursorState: CursorState =
    phase === "thinking"
      ? "thinking"
      : phase === "drawing" || phase === "speaking"
        ? "drawing"
        : "idle";

  const { cancellableDelay, raceWithCancel, clearCancelTimers } = useCancelControl(cancelRef);

  const registerReplayBlobUrl = useCallback((url: string) => {
    replayBlobUrlsRef.current.push(url);
  }, []);

  const revokeReplayBlobUrls = useCallback(() => {
    for (const url of replayBlobUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    replayBlobUrlsRef.current = [];
  }, []);

  const persistTurnForReplay = useCallback(
    (
      question: string,
      rawResponse: string,
      recordedSegments: RecordedSegmentPayload[],
    ): StoredTurn => {
      const orderIndex = storedTurnsRef.current.length;
      return buildLocalStoredTurn(
        {
          question,
          rawResponse,
          speedMultiplier: speedRef.current,
          segments: recordedSegments,
        },
        orderIndex,
        registerReplayBlobUrl,
      );
    },
    [registerReplayBlobUrl],
  );

  const resetBoardLayout = useCallback((keepHeading = false, forceSequentialWorkLayout?: boolean): void => {
    const headingRects = keepHeading
      ? boardLayoutRef.current.rects.filter((rect) => rect.y < TEXT_LAYOUT.headingBottomY)
      : [];

    boardLayoutRef.current = {
      rects: headingRects,
      nextY: keepHeading && headingRects.length > 0 ? TEXT_LAYOUT.workTopY : TEXT_LAYOUT.topY,
    };

    if (forceSequentialWorkLayout !== undefined) {
      forceSequentialWorkLayoutRef.current = forceSequentialWorkLayout;
    }
  }, []);

  const forgetErasedTextRects = useCallback((eraseRect: BoardTextRect): void => {
    boardLayoutRef.current.rects = boardLayoutRef.current.rects.filter(
      (rect) => !textRectsOverlap(rect, eraseRect, 0),
    );
    const hasHeading = boardLayoutRef.current.rects.some(
      (rect) => rect.y < TEXT_LAYOUT.headingBottomY,
    );
    const remainingBottom = boardLayoutRef.current.rects.reduce(
      (bottom, rect) => Math.max(bottom, rect.y + TEXT_LAYOUT.lineHeight),
      TEXT_LAYOUT.topY,
    );
    let nextY = Math.max(remainingBottom, TEXT_LAYOUT.topY);
    if (hasHeading && nextY <= TEXT_LAYOUT.headingBottomY) {
      nextY = TEXT_LAYOUT.workTopY;
    }
    boardLayoutRef.current.nextY = nextY;
    if (overlapsWorkArea(eraseRect)) {
      forceSequentialWorkLayoutRef.current = true;
    }
  }, []);

  const resolveTextPlacement = useCallback(
    async (
      command: DrawCommand,
      x: number,
      y: number,
      applyLayout: boolean,
    ): Promise<{ x: number; y: number }> => {
      if (!applyLayout || !command.text) {
        if (command.text && Number.isFinite(x) && Number.isFinite(y)) {
          registerBoardAnchor(boardLayoutRef.current, {
            x,
            y,
            width: estimateBoardTextWidth(command.text),
            height: TEXT_LAYOUT.textHeight,
            text: command.text,
          });
        }
        return { x, y };
      }

      if (isInDiagramZone(x, y)) {
        const width = estimateBoardTextWidth(command.text);
        const height = TEXT_LAYOUT.textHeight;
        registerBoardAnchor(boardLayoutRef.current, { x, y, width, height, text: command.text });
        return { x, y };
      }

      const width = estimateBoardTextWidth(command.text);
      const height = TEXT_LAYOUT.textHeight;
      let layout = boardLayoutRef.current;

      // A diagram claims the right half of the board. Keep the solution in a clean
      // left column that stops short of the figure, so lines flow straight down
      // the left instead of hopping around the diagram (which used to leave big
      // vertical gaps). When there is no diagram, the solution uses the full width.
      const isDiagramRect = (rect: BoardTextRect) => rect.x >= DIAGRAM_ZONE.x;
      const diagramActive = fbdPhaseStartedRef.current;
      const diagramRects = diagramActive ? layout.rects.filter(isDiagramRect) : [];
      const diagramLeftEdge =
        diagramRects.length > 0
          ? Math.min(...diagramRects.map((rect) => rect.x))
          : DIAGRAM_ZONE.x;
      const columnRight = diagramActive
        ? Math.max(TEXT_LAYOUT.marginX + 160, diagramLeftEdge - 28)
        : BOARD_WIDTH - TEXT_LAYOUT.marginX;
      const maxX = Math.min(BOARD_WIDTH - TEXT_LAYOUT.marginX, columnRight) - width;
      const candidateX = clampNumber(x, TEXT_LAYOUT.marginX, Math.max(TEXT_LAYOUT.marginX, maxX));

      const findOpenY = (startY: number): number | null => {
        for (
          let tryY = clampNumber(startY, TEXT_LAYOUT.topY, TEXT_LAYOUT.bottomY - height);
          tryY <= TEXT_LAYOUT.bottomY - height;
          tryY += TEXT_LAYOUT.lineHeight
        ) {
          const rect = { x: candidateX, y: tryY, width, height };
          // Solution lines only stack around each other. The diagram lives in its
          // own right-hand column, so skip diagram rects when finding a free row —
          // otherwise a wide equation would jump below the whole figure.
          if (
            !layout.rects.some(
              (occupied) =>
                !(diagramActive && isDiagramRect(occupied)) &&
                textRectsOverlap(rect, occupied),
            )
          ) {
            return tryY;
          }
        }
        return null;
      };

      const placementStartY = (() => {
        if (forceSequentialWorkLayoutRef.current) {
          return getWorkAreaFlowStartY(layout);
        }
        let candidateY = clampNumber(y, TEXT_LAYOUT.topY, TEXT_LAYOUT.bottomY - height);
        if (layout.rects.length === 0 && candidateY > TEXT_LAYOUT.workTopY) {
          candidateY = TEXT_LAYOUT.topY;
        }
        return candidateY;
      })();

      let openY = findOpenY(placementStartY);

      if (openY === null) {
        const wb = whiteboardRef.current;
        if (wb && !cancelRef.current) {
          // Keep an in-progress diagram: when one exists, only clear the left
          // work column instead of the full board width.
          const eraseWidth = fbdPhaseStartedRef.current
            ? Math.max(DIAGRAM_ZONE.x - TEXT_LAYOUT.eraseX - 10, 40)
            : TEXT_LAYOUT.eraseWidth;
          tutorDebug("draw", "layout erasing work area", {
            text: command.text.slice(0, 60),
            rect_count: layout.rects.length,
            erase_width: eraseWidth,
          });
          const preEraseSnapshot = wb.captureSnapshot(2);
          if (preEraseSnapshot) {
            notesEpochsRef.current.push({
              index: notesEpochsRef.current.length,
              snapshotDataUrl: preEraseSnapshot,
              narrationText: narrationSinceEpochRef.current,
              timestampMs: Date.now(),
            });
            narrationSinceEpochRef.current = "";
          }
          await wb.eraseRegion(
            TEXT_LAYOUT.eraseX,
            TEXT_LAYOUT.eraseY,
            eraseWidth,
            TEXT_LAYOUT.eraseHeight,
            700,
          );
        }
        // Diagram-zone labels survive a work-column erase, so keep their
        // rects registered for later annotation snapping.
        const survivingDiagramRects = fbdPhaseStartedRef.current
          ? boardLayoutRef.current.rects.filter(
              (r) => r.x >= DIAGRAM_ZONE.x && r.y >= TEXT_LAYOUT.headingBottomY,
            )
          : [];
        resetBoardLayout(true, true);
        boardLayoutRef.current.rects.push(...survivingDiagramRects);
        layout = boardLayoutRef.current;
        openY = findOpenY(getWorkAreaFlowStartY(layout)) ?? TEXT_LAYOUT.workTopY;
      }

      const rect = { x: candidateX, y: openY, width, height, text: command.text };
      registerBoardAnchor(boardLayoutRef.current, rect);
      boardLayoutRef.current.nextY = Math.max(
        boardLayoutRef.current.nextY,
        openY + TEXT_LAYOUT.lineHeight,
      );

      return { x: rect.x, y: rect.y };
    },
    [resetBoardLayout],
  );

  const { executeCommand, executeCommandWithCancel, resolveAnnotationTarget } = useCommandExecution({
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

  const restoreBoardFromApi = useCallback(
    async (boardId: string) => {
      setBoardLoaded(false);

      let detail = await fetchBoardDetail(boardId);

      if (!detail) {
        await createBoard(boardId);
        detail = await fetchBoardDetail(boardId);
      }

      if (!detail) {
        setBoardLoaded(true);
        return;
      }

      storedTurnsRef.current = detail.turns;
      setStoredTurnsCount(detail.turns.length);
      // Reset the input overlay state for the restored board: a board with no
      // turns shows the Accelute landing (inputInteracted=false), while a board
      // with prior turns shows the doubt InputBar (inputInteracted=true).
      setInputInteracted(detail.turns.length > 0);
      conversationHistoryRef.current = detail.turns.map((turn) => ({
        user: turn.question,
        assistant: lessonNarrationText(turn.rawResponse),
      }));

      const lastTurn = detail.turns[detail.turns.length - 1];
      const lastNarration = lastTurn
        ? lessonNarrationText(lastTurn.rawResponse)
        : "";

      whiteboardRef.current?.clearBoard();
      resetBoardLayout(false, false);
      notesEpochsRef.current = [];
      narrationSinceEpochRef.current = "";
      setNarrationText(lastNarration);
      setCurrentSegmentText("");

      if (detail.turns.length === 0) {
        setBoardLoaded(true);
      }

      for (const turn of detail.turns) {
        for (const segment of turn.segments) {
          const commands = parseStoredSegmentCommands(segment.command);
          for (const command of commands) {
            if (!cancelRef.current) {
              await executeCommand(command, { durationScale: 0.05, applyLayout: false });
            }
          }
        }
      }

      setBoardLoaded(true);
    },
    [executeCommand, resetBoardLayout],
  );

  useEffect(() => {
    return () => {
      revokeReplayBlobUrls();
    };
  }, [revokeReplayBlobUrls]);

  useEffect(() => {
    if (!sessionId) return;

    cancelRef.current = false;
    queueMicrotask(() => {
      void restoreBoardFromApi(sessionId);
    });
  }, [sessionId, restoreBoardFromApi]);

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

            <div
              ref={boardContainerRef}
              className="absolute inset-0 z-[1] overflow-hidden"
            >
              <div
                style={{
                  position: "absolute",
                  top: boardViewport.offsetY,
                  left: boardViewport.offsetX,
                  width: BOARD_WIDTH * boardViewport.scale,
                  height: BOARD_HEIGHT * boardViewport.scale,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: BOARD_WIDTH,
                    height: BOARD_HEIGHT,
                    transform: `scale(${boardViewport.scale})`,
                    transformOrigin: "top left",
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

                <ResponseBubble
                  text={currentSegmentText}
                  visible={
                    settings.subtitlesEnabled &&
                    (phase === "speaking" || phase === "drawing")
                  }
                />

                {phase === "idle" && lastError && (
                  <BoardErrorBanner
                    message={lastError.message}
                    onRetry={() => {
                      const q = lastError.question;
                      setLastError(null);
                      void handleQuestion(q);
                    }}
                    onDismiss={() => setLastError(null)}
                  />
                )}

                <ReplayControls
                  visible={isReplaying}
                  playing={isReplaying && !isPaused}
                  progressMs={replayProgressMs}
                  totalMs={replayTotalMs}
                  playbackRate={settings.speedMultiplier}
                  onPlayPause={toggleReplayPlayPause}
                  onSeek={seekReplay}
                  onPlaybackRateChange={handleReplaySpeedChange}
                  onStop={stopTurn}
                />
              </div>
            </div>
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
