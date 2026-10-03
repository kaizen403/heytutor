"use client";

import { PenSpinner } from "@heytutor/whiteboard/pen-spinner";
import { usePendingBeat } from "../hooks/usePendingBeat";
import { PENDING_BEAT_MS } from "../lib/board/pendingBeats";
import { PendingSketch } from "./PendingSketch";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../constants";

interface ThinkingOverlayProps {
  paused?: boolean;
  onResume?: () => void;
  onEnableAudio?: (() => void) | null;
  /** Marker colour the clicker writes in. */
  ink?: string;
  /**
   * A doubt is thought about over the page it was asked on, so the page stays
   * in view: no paper over it, only the progress hairline and a small clicker
   * at this point beside the part in question. Board units.
   */
  onBoardAt?: { x: number; y: number } | null;
  /**
   * CSS px per board unit. The board is drawn at this scale from the surface's
   * top left so a doubt clicker lands on the same point as the figure.
   */
  scale?: number;
}

/**
 * The pause before the tutor writes.
 *
 * Empty paper used to keep the Konva marker on it — contact shadow, barrel
 * drop-shadow, idle fidget, and a leftover "planning the diagram…" caption.
 * The board stays paper; the clicker is the wait. The short line under it
 * names that wait, so a long plan is not a dead board.
 */
export function ThinkingOverlay({ ink = "#1B2A4A", onBoardAt = null, scale, paused = false, onResume, onEnableAudio }: ThinkingOverlayProps) {
  if (paused || onEnableAudio) {
    return (
      <div
        className={`${onBoardAt ? "" : "wb-pending "}pointer-events-none absolute inset-0 z-20 flex items-center justify-center`}
      >
        <div className="pointer-events-auto rounded-2xl border border-current/10 bg-[var(--wb-paper)] px-6 py-5 text-center shadow-sm" style={{ color: ink }}>
          <p role="status" className="type-accent-s">
            {paused ? "Lecture paused" : "Audio needs your permission"}
          </p>
          <button
            type="button"
            className="mt-3 min-h-11 rounded-full border border-current/20 px-5 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
            onClick={paused ? onResume : onEnableAudio ?? undefined}
          >
            {paused ? "Resume" : "Tap to enable audio"}
          </button>
        </div>
      </div>
    );
  }
  if (onBoardAt) {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-20"
        role="status"
        aria-label="Thinking about your doubt"
      >
        <div className="absolute left-0 right-0 top-0 h-0.5 overflow-hidden">
          <div className="wb-progress-bar" />
        </div>
        <div
          className="absolute"
          style={{
            left: scale ? onBoardAt.x * scale : `${(onBoardAt.x / BOARD_WIDTH) * 100}%`,
            top: scale ? onBoardAt.y * scale : `${(onBoardAt.y / BOARD_HEIGHT) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <PenSpinner size={32} ink={ink} trail={false} smear={false} />
        </div>
      </div>
    );
  }
  return (
    <div
      className="wb-pending pointer-events-none absolute inset-0 z-20"
      role="status"
      aria-label="Preparing the lecture"
    >
      <div className="absolute left-0 right-0 top-0 h-0.5 overflow-hidden">
        <div className="wb-progress-bar" />
      </div>
      <div className="wb-pending__grid" aria-hidden />
      <LessonPending ink={ink} />
    </div>
  );
}

function LessonPending({ ink }: { ink: string }) {
  const { index, label } = usePendingBeat();

  return (
    <div className="wb-pending__pen relative flex h-full w-full flex-col items-center justify-center gap-2.5">
      <PenSpinner size={48} ink={ink} trail={false} smear={false} />
      <PendingSketch key={index} index={index} ink={ink} beatMs={PENDING_BEAT_MS} />
      <p key={label} className="wb-pending__label type-accent-s">
        {label}
        <span className="wb-pending__dots" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </p>
      <div className="wb-pending__rail" aria-hidden>
        <div className="wb-pending__rail-fill" />
      </div>
    </div>
  );
}
