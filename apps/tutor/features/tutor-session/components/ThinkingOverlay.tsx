"use client";

import { PenSpinner } from "@heytutor/whiteboard/pen-spinner";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../constants";

interface ThinkingOverlayProps {
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
 * names that wait as preparing the lecture, so a long plan is not a dead board.
 */
export function ThinkingOverlay({ ink = "#1B2A4A", onBoardAt = null, scale }: ThinkingOverlayProps) {
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
      <div className="wb-pending__pen flex h-full w-full flex-col items-center justify-center gap-3">
        <PenSpinner size={48} ink={ink} trail={false} smear={false} />
        <p className="type-accent-xs wb-boot-label animate-wb-breathe">preparing the lecture</p>
      </div>
    </div>
  );
}
