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
import { markTargets, type BoardMark, type MarkPoint, type MarkRect } from "../lib/board/boardMarking";

export interface BoardMarkingLayerProps {
  armed: boolean;
  marks: BoardMark[];
  draftPoints: MarkPoint[];
  atMarkLimit: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
}

/** Nib width in board px — a shade under one work-row's cap height. */
const NIB_WIDTH = 21;
/** Nib angle. The same tilt the tutor's own pen rests at. */
const NIB_ANGLE_RAD = (-35 * Math.PI) / 180;
const NIB_EDGE = {
  x: Math.cos(NIB_ANGLE_RAD),
  y: Math.sin(NIB_ANGLE_RAD),
};

const HIGHLIGHT_FILL = "rgba(89, 175, 212, 0.42)";
const HIGHLIGHT_DRAFT_FILL = "rgba(89, 175, 212, 0.32)";
/** The darker rim a wet highlighter leaves at the edge of a pass. */
const HIGHLIGHT_EDGE = "rgba(46, 124, 163, 0.30)";
const HALO_FILL = "rgba(89, 175, 212, 0.10)";
const HALO_EDGE = "rgba(62, 143, 180, 0.55)";
const HALO_PAD = 7;

/**
 * The marker the pointer becomes. Drawn as a real OS cursor so it tracks with
 * zero latency — an element chasing pointermove always trails the hand.
 */
const MARKER_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g transform="rotate(32 16 16)">
    <rect x="10.5" y="3" width="11" height="19" rx="2.6" fill="#59AFD4" stroke="#06121C" stroke-width="1.4"/>
    <rect x="10.5" y="8" width="11" height="2.4" fill="#2E7CA3" opacity="0.85"/>
    <path d="M10.5 22h11l-2 5.4h-7z" fill="#E4F2F9" stroke="#06121C" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M12.6 27.4h6.8" stroke="#2E7CA3" stroke-width="1.6" stroke-linecap="round"/>
  </g>
</svg>`;

const MARKER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  MARKER_CURSOR_SVG.replace(/\s+/g, " "),
)}") 9 28, crosshair`;

/** Sweep the nib along the path, as one fillable region. */
function buildChiselPath(points: MarkPoint[]): Path2D | null {
  if (points.length === 0) {
    return null;
  }
  const half = NIB_WIDTH / 2;
  const ex = NIB_EDGE.x * half;
  const ey = NIB_EDGE.y * half;
  const path = new Path2D();

  if (points.length === 1) {
    // A tap still leaves the nib's own footprint.
    const [only] = points;
    path.moveTo(only.x - ex, only.y - ey);
    path.lineTo(only.x + ex, only.y + ey);
    path.lineTo(only.x + ex + 1.5, only.y + ey + 1.5);
    path.lineTo(only.x - ex + 1.5, only.y - ey + 1.5);
    path.closePath();
    return path;
  }

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    path.moveTo(a.x - ex, a.y - ey);
    path.lineTo(a.x + ex, a.y + ey);
    path.lineTo(b.x + ex, b.y + ey);
    path.lineTo(b.x - ex, b.y - ey);
    path.closePath();
  }
  return path;
}

function traceRoundedRect(
  context: CanvasRenderingContext2D,
  rect: MarkRect,
  radius: number,
): void {
  const { x, y, width, height } = rect;
  if (typeof context.roundRect === "function") {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
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

    // What the mark resolved to, drawn behind the ink: the board answering
    // "yes, this line" while the student is still holding the marker.
    context.save();
    for (const mark of marks) {
      const targets = markTargets(mark);
      for (const target of targets) {
        if (target.kind === "region") continue;
        const halo: MarkRect = {
          x: target.rect.x - HALO_PAD,
          y: target.rect.y - HALO_PAD,
          width: target.rect.width + HALO_PAD * 2,
          height: target.rect.height + HALO_PAD * 2,
        };
        traceRoundedRect(context, halo, 8);
        context.fillStyle = HALO_FILL;
        context.fill();
        context.strokeStyle = HALO_EDGE;
        context.lineWidth = 1.25;
        context.setLineDash([5, 4]);
        context.stroke();
        context.setLineDash([]);
      }
    }
    context.restore();

    context.save();
    context.globalCompositeOperation = "multiply";
    context.lineJoin = "round";

    const paint = (points: MarkPoint[], fill: string) => {
      const path = buildChiselPath(points);
      if (!path) return;
      context.fillStyle = fill;
      context.fill(path, "nonzero");
      context.strokeStyle = HIGHLIGHT_EDGE;
      context.lineWidth = 1;
      context.stroke(path);
    };

    for (const mark of marks) {
      paint(mark.points, HIGHLIGHT_FILL);
    }
    if (draftPoints.length > 0) {
      paint(draftPoints, HIGHLIGHT_DRAFT_FILL);
    }
    context.restore();
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
          aria-label="Marking layer — circle or underline anything you did not follow"
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
              "radial-gradient(120% 90% at 50% 40%, rgba(89,175,212,0) 55%, rgba(89,175,212,0.09) 100%)",
            boxShadow: "inset 0 0 0 2px rgba(89,175,212,0.42)",
          }}
        />
      ) : null}
    </div>
  );
}
