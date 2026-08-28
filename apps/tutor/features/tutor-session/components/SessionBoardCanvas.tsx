"use client";

import { useCallback, useRef, useState, type PointerEvent, type RefObject } from "react";
import { ResponseBubble } from "@/features/tutor-session/components/ResponseBubble";
import { ReplayControls } from "@/features/tutor-session/components/ReplayControls";
import { getMarkerColorHex, type SettingsState } from "@/features/tutor-session/components/SettingsDrawer";
import type { WhiteboardHandle, CursorState } from "@heytutor/whiteboard";
import { hitTestVerifiedAnchor, type VerifiedDiagram } from "@heytutor/drawing";
import { BOARD_WIDTH, BOARD_HEIGHT, DIAGRAM_ZONE } from "../constants";
import type { BoardViewport, TutorPhase } from "../types";
import { Whiteboard } from "./WhiteboardLoader";
import { BoardErrorBanner } from "./BoardErrorBanner";

export interface SessionBoardCanvasProps {
  boardViewport: BoardViewport;
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cursorState: CursorState;
  settings: SettingsState;
  phase: TutorPhase;
  currentSegmentText: string;
  lastError: { message: string; question: string } | null;
  isReplaying: boolean;
  isPaused: boolean;
  replayProgressMs: number;
  replayTotalMs: number;
  verifiedDiagram?: VerifiedDiagram | null;
  onRetraceEntity?: (entityId: string) => void;
  onRetryError: (question: string) => void;
  onDismissError: () => void;
  onReplayPlayPause: () => void;
  onReplaySeek: (ms: number) => void;
  onReplaySpeedChange: (rate: number) => void;
  onStop: () => void;
}

function canvasPointFromPointer(
  event: PointerEvent<HTMLDivElement>,
): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  return {
    x: ((event.clientX - rect.left) / width) * BOARD_WIDTH,
    y: ((event.clientY - rect.top) / height) * BOARD_HEIGHT,
  };
}

export function SessionBoardCanvas({
  boardViewport,
  whiteboardRef,
  cursorState,
  settings,
  phase,
  currentSegmentText,
  lastError,
  isReplaying,
  isPaused,
  replayProgressMs,
  replayTotalMs,
  verifiedDiagram,
  onRetraceEntity,
  onRetryError,
  onDismissError,
  onReplayPlayPause,
  onReplaySeek,
  onReplaySpeedChange,
  onStop,
}: SessionBoardCanvasProps) {
  const retraceBusyRef = useRef(false);
  const [hoveringAnchor, setHoveringAnchor] = useState(false);
  const idle = phase === "idle" && !isReplaying;
  const canRetrace = idle && Boolean(verifiedDiagram && onRetraceEntity);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!canRetrace || !verifiedDiagram) {
      setHoveringAnchor(false);
      return;
    }
    const point = canvasPointFromPointer(event);
    setHoveringAnchor(hitTestVerifiedAnchor(point.x, point.y, verifiedDiagram) !== null);
  }, [canRetrace, verifiedDiagram]);

  const handlePointerLeave = useCallback(() => {
    setHoveringAnchor(false);
  }, []);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!canRetrace || !verifiedDiagram || !onRetraceEntity || retraceBusyRef.current) return;
    const point = canvasPointFromPointer(event);
    const hit = hitTestVerifiedAnchor(point.x, point.y, verifiedDiagram);
    if (!hit) return;
    event.preventDefault();
    retraceBusyRef.current = true;
    onRetraceEntity(hit.id);
    window.setTimeout(() => {
      retraceBusyRef.current = false;
    }, 900);
  }, [canRetrace, onRetraceEntity, verifiedDiagram]);

  const caption = verifiedDiagram?.caption?.trim();

  return (
    <div
      className="absolute inset-0 z-[1] overflow-hidden"
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
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
          {caption ? (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: DIAGRAM_ZONE.x + 12,
                top: 628,
                width: DIAGRAM_ZONE.width - 24,
                pointerEvents: "none",
                textAlign: "center",
                fontSize: 13,
                lineHeight: 1.35,
                color: "#5A5A62",
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
              }}
            >
              {caption}
            </div>
          ) : null}
          {canRetrace ? (
            <div
              aria-hidden="true"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 2,
                cursor: hoveringAnchor ? "pointer" : "default",
              }}
            />
          ) : null}
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
            onRetry={() => onRetryError(lastError.question)}
            onDismiss={onDismissError}
          />
        )}

        <ReplayControls
          visible={isReplaying}
          playing={isReplaying && !isPaused}
          progressMs={replayProgressMs}
          totalMs={replayTotalMs}
          playbackRate={settings.speedMultiplier}
          onPlayPause={onReplayPlayPause}
          onSeek={onReplaySeek}
          onPlaybackRateChange={onReplaySpeedChange}
          onStop={onStop}
        />
      </div>
    </div>
  );
}
