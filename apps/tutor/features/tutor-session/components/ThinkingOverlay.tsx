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
   * top left; a percentage of the surface drifts wherever the frame padding
   * and the bezel disagree, which they do at compact widths.
   */
  scale?: number;
}

/**
 * The pause before the tutor writes.
 *
 * Empty paper used to keep the Konva marker on it — contact shadow, barrel
 * drop-shadow, idle fidget, and a "planning the diagram…" label. That read as
 * a leftover cursor, not a pending mark. The board stays paper; the clicker
 * itself is the wait, centred, with no copy and no second shadow.
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
      aria-label="Preparing the lesson"
    >
      <div className="absolute left-0 right-0 top-0 h-0.5 overflow-hidden">
        <div className="wb-progress-bar" />
      </div>
      <div className="wb-pending__pen flex h-full w-full items-center justify-center">
        <PenSpinner size={48} ink={ink} trail={false} smear={false} />
      </div>
    </div>
  );
}
