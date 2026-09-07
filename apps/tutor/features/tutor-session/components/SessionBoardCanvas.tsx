"use client";

import { useCallback, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { ResponseBubble } from "@/features/tutor-session/components/ResponseBubble";
import { getMarkerColorHex, type SettingsState } from "@/features/tutor-session/components/SettingsDrawer";
import type { WhiteboardHandle, CursorState } from "@heytutor/whiteboard";
import { hitTestVerifiedAnchor, type VerifiedDiagram } from "@heytutor/drawing";
import { BOARD_WIDTH, BOARD_HEIGHT, DIAGRAM_ZONE } from "../constants";
import type { BoardViewport, TutorPhase } from "../types";
import { DiagramLabelInspector } from "./DiagramLabelInspector";
import { BoardMarkingLayer } from "./BoardMarkingLayer";
import { Whiteboard } from "./WhiteboardLoader";
import { BoardErrorBanner } from "./BoardErrorBanner";
import type { BoardMarkingApi } from "../hooks/useBoardMarking";

export interface SessionBoardCanvasProps {
  boardViewport: BoardViewport;
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cursorState: CursorState;
  settings: SettingsState;
  phase: TutorPhase;
  currentSegmentText: string;
  lastError: { message: string; question: string } | null;
  isReplaying: boolean;
  /** Overlay board the past is drawn on while the live lecture stays frozen. */
  rewindBoardRef: RefObject<WhiteboardHandle | null>;
  /** Off-screen board used to re-render a finished question for MP4 export. */
  exportBoardRef: RefObject<WhiteboardHandle | null>;
  exportBoardMounted: boolean;
  rewindActive: boolean;
  rewindCursorState: CursorState;
  rewindSegmentText: string;
  verifiedDiagram?: VerifiedDiagram | null;
  /** DSA code-lesson overlay, rendered inside the scaled board box. */
  codeLessonPanel?: ReactNode;
  /** The student's marker. While armed it owns the board's pointer. */
  marking?: BoardMarkingApi | null;
  onRetraceEntity?: (entityId: string) => void;
  onRetryError: (question: string) => void;
  onDismissError: () => void;
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
  rewindBoardRef,
  exportBoardRef,
  exportBoardMounted,
  rewindActive,
  rewindCursorState,
  rewindSegmentText,
  verifiedDiagram,
  codeLessonPanel,
  marking,
  onRetraceEntity,
  onRetryError,
  onDismissError,
}: SessionBoardCanvasProps) {
  const retraceBusyRef = useRef(false);
  const [hoveringAnchor, setHoveringAnchor] = useState(false);
  const idle = phase === "idle" && !isReplaying && !rewindActive;
  const markingArmed = Boolean(marking?.armed);
  // The marker owns every pointer while it is out: a stroke must never also
  // fire a retrace or open a label popover.
  const canRetrace = idle && !markingArmed && Boolean(verifiedDiagram && onRetraceEntity);

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
  const labelsSettled = (phase === "idle" || phase === "speaking") && !markingArmed;

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
          {codeLessonPanel}
          {marking ? (
            <BoardMarkingLayer
              armed={marking.armed}
              marks={marking.marks}
              draftPoints={marking.draftPoints}
              atMarkLimit={marking.atMarkLimit}
              onPointerDown={marking.onPointerDown}
              onPointerMove={marking.onPointerMove}
              onPointerUp={marking.onPointerUp}
            />
          ) : null}
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
                color: "var(--ink-500)",
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
                  className="absolute rounded-md border-0 bg-transparent p-0 opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sky-500"
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

      </div>
      {exportBoardMounted ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: -10000,
            top: 0,
            width: BOARD_WIDTH,
            height: BOARD_HEIGHT,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <Whiteboard
            ref={exportBoardRef}
            width={BOARD_WIDTH}
            height={BOARD_HEIGHT}
            cursorState="drawing"
            inkColor={getMarkerColorHex(settings.markerColor)}
            thinkingMotion="none"
          />
        </div>
      ) : null}
    </div>
  );
}
