"use client";

/**
 * The marker layer.
 *
 * A plain 2D canvas laid over the Konva stage. The student's ink is drawn here
 * and nowhere else, which is what keeps it out of snapshots, notes, exports and
 * persisted turns — those all read Konva layers.
 *
 * The stroke is rendered as a chisel-tip highlighter: a nib of fixed width held
 * at a fixed angle, swept along the path. Motion across the nib lays down a
 * broad band, motion along it lays down a thin one, which is why a real
 * highlighter thins on the diagonal. The whole path is filled in one pass so
 * overlapping passes do not stack into a dark blot, and it multiplies into the
 * board so the tutor's ink stays crisp underneath.
 */
import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../constants";
import {
  MARKER_CURSOR,
  paintBoardMarks,
} from "@heytutor/whiteboard/marker-ink";
import {
  markTargets,
  type BoardMark,
  type MarkPoint,
} from "../lib/board/boardMarking";

export interface BoardMarkingLayerProps {
  armed: boolean;
  marks: BoardMark[];
  draftPoints: MarkPoint[];
  atMarkLimit: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function BoardMarkingLayer({
  armed,
  marks,
  draftPoints,
  atMarkLimit,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: BoardMarkingLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(BOARD_WIDTH * ratio);
    const pixelHeight = Math.round(BOARD_HEIGHT * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

    paintBoardMarks(
      context,
      marks.map((mark) => ({
        points: mark.points,
        targets: markTargets(mark),
      })),
      draftPoints,
    );
  }, [draftPoints, marks]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const onResize = () => render();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [render]);

  return (
    <div
      className="absolute inset-0"
      style={{ zIndex: 4, pointerEvents: armed ? "auto" : "none" }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
          pointerEvents: "none",
        }}
      />
      {armed ? (
        <div
          role="application"
          aria-label="Marking layer. Circle or underline anything you did not follow"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            position: "absolute",
            inset: 0,
            touchAction: "none",
            cursor: atMarkLimit ? "not-allowed" : MARKER_CURSOR,
            // A whisper of the accent, so it is unmistakable that the board is
            // listening — without dimming the work the student is reading.
            background:
              "radial-gradient(120% 90% at 50% 40%, rgba(74, 158, 255, 0) 55%, rgba(74, 158, 255, 0.09) 100%)",
            boxShadow: "inset 0 0 0 2px rgba(74, 158, 255, 0.42)",
          }}
        />
      ) : null}
    </div>
  );
}
