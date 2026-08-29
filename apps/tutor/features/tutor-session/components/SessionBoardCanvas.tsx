"use client";

import { useCallback, useRef, useState, type PointerEvent, type RefObject } from "react";
import { ResponseBubble } from "@/features/tutor-session/components/ResponseBubble";
import { ReplayControls } from "@/features/tutor-session/components/ReplayControls";
import { getMarkerColorHex, type SettingsState } from "@/features/tutor-session/components/SettingsDrawer";
import type { LecturePlaybackMode } from "@/lib/replay/liveTimeline";
import type { WhiteboardHandle, CursorState } from "@heytutor/whiteboard";
import { hitTestVerifiedAnchor, type VerifiedDiagram } from "@heytutor/drawing";
import { BOARD_WIDTH, BOARD_HEIGHT, DIAGRAM_ZONE } from "../constants";
import type { BoardViewport, TutorPhase } from "../types";
import { DiagramLabelInspector } from "./DiagramLabelInspector";
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
  replayProgressMs: number;
  replayTotalMs: number;
  /** Which timeline the scrub bar is showing: a finished lecture or a live one. */
  playbackMode: LecturePlaybackMode;
  /** Transport state of whichever playback owns the board right now. */
  playbackPlaying: boolean;
  /** Scrub bar is offered whenever there is a past worth revisiting. */
  showPlaybackControls: boolean;
  /** End of what has been taught — the live track's max. */
  liveEdgeMs: number;
  /** Overlay board the past is drawn on while the live lecture stays frozen. */
  rewindBoardRef: RefObject<WhiteboardHandle | null>;
  rewindActive: boolean;
  rewindCursorState: CursorState;
  rewindSegmentText: string;
  verifiedDiagram?: VerifiedDiagram | null;
  onRetraceEntity?: (entityId: string) => void;
  onRetryError: (question: string) => void;
  onDismissError: () => void;
  onReplayPlayPause: () => void;
  onReplaySeek: (ms: number) => void;
  onReplaySpeedChange: (rate: number) => void;
  onGoLive: () => void;
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
  replayProgressMs,
  replayTotalMs,
  playbackMode,
  playbackPlaying,
  showPlaybackControls,
  liveEdgeMs,
  rewindBoardRef,
  rewindActive,
  rewindCursorState,
  rewindSegmentText,
  verifiedDiagram,
  onRetraceEntity,
  onRetryError,
  onDismissError,
  onReplayPlayPause,
  onReplaySeek,
  onReplaySpeedChange,
  onGoLive,
  onStop,
}: SessionBoardCanvasProps) {
  const retraceBusyRef = useRef(false);
  const [hoveringAnchor, setHoveringAnchor] = useState(false);
  const idle = phase === "idle" && !isReplaying && !rewindActive;
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

  const triggerRetrace = useCallback((entityId: string) => {
    if (!onRetraceEntity || retraceBusyRef.current) return;
    retraceBusyRef.current = true;
    onRetraceEntity(entityId);
    window.setTimeout(() => {
      retraceBusyRef.current = false;
    }, 900);
  }, [onRetraceEntity]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!canRetrace || !verifiedDiagram) return;
    const point = canvasPointFromPointer(event);
    const hit = hitTestVerifiedAnchor(point.x, point.y, verifiedDiagram);
    if (!hit) return;
    event.preventDefault();
    triggerRetrace(hit.id);
  }, [canRetrace, triggerRetrace, verifiedDiagram]);

  const caption = verifiedDiagram?.caption?.trim();

  // Symbols become answerable once the figure has settled.
  const labelsSettled = phase === "idle" || phase === "speaking";

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
          {verifiedDiagram?.labelGlossary ? (
            <DiagramLabelInspector
              diagram={verifiedDiagram}
              glossary={verifiedDiagram.labelGlossary}
              scale={1}
              enabled={labelsSettled}
            />
          ) : null}
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
          {canRetrace && verifiedDiagram
            ? verifiedDiagram.anchors.map((anchor) => (
                // Keyboard path for the pointer hit layer above: Tab lands on
                // each diagram part and Enter traces it.
                <button
                  key={anchor.id}
                  type="button"
                  onClick={() => triggerRetrace(anchor.id)}
                  aria-label={`Trace ${
                    anchor.labels.length > 0 ? anchor.labels.join(", ") : anchor.id
                  } on the diagram`}
                  className="absolute rounded-md border-0 bg-transparent p-0 opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#5FA4F9]"
                  style={{
                    left: anchor.x - 4,
                    top: anchor.y - 4,
                    width: anchor.width + 8,
                    height: anchor.height + 8,
                    zIndex: 3,
                    pointerEvents: "none",
                  }}
                />
              ))
            : null}

          {rewindActive ? (
            // A second board, opaque and on top. The live board keeps every
            // stroke it had — including the half-drawn one the pause froze —
            // so going live is just dropping this layer.
            <div
              className="absolute inset-0"
              style={{ zIndex: 5 }}
              aria-label="Earlier in this lecture"
            >
              <Whiteboard
                ref={rewindBoardRef}
                width={BOARD_WIDTH}
                height={BOARD_HEIGHT}
                cursorState={rewindCursorState}
                inkColor={getMarkerColorHex(settings.markerColor)}
              />
            </div>
          ) : null}
        </div>

        <ResponseBubble
          text={rewindActive ? rewindSegmentText : currentSegmentText}
          visible={
            settings.subtitlesEnabled &&
            (rewindActive
              ? rewindSegmentText.length > 0
              : phase === "speaking" || phase === "drawing")
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
          visible={showPlaybackControls}
          mode={playbackMode}
          playing={playbackPlaying}
          progressMs={replayProgressMs}
          totalMs={replayTotalMs}
          liveEdgeMs={liveEdgeMs}
          playbackRate={settings.speedMultiplier}
          onPlayPause={onReplayPlayPause}
          onSeek={onReplaySeek}
          onPlaybackRateChange={onReplaySpeedChange}
          onGoLive={onGoLive}
          onStop={onStop}
        />
      </div>
    </div>
  );
}
