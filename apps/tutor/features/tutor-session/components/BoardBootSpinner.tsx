"use client";

import { cn } from "@/lib/utils";

interface BoardBootSpinnerProps {
  /** Outer diameter in px. The stroke scales with it (2.5px at 30px). */
  size?: number;
  /** Accessible name for the pending state. */
  label?: string;
  className?: string;
}

/**
 * The board's boot arc — the pending mark shown while the Konva chunk loads.
 *
 * It is the same 252° sky sweep the on-canvas `ThinkingSpinner` draws
 * (sky-500, round caps, soft glow), rendered in SVG so it can spin before
 * Konva exists. Boot → thinking is one continuous visual family: the arc that
 * waits for the board is the arc that waits for the diagram.
 *
 * The rotation is a CSS transform on its own compositor layer; the glow is a
 * static drop-shadow on the wrapper, so the spin never repaints. Under
 * `prefers-reduced-motion` the arc stops and breathes instead, the same
 * degrade the pen spinner uses.
 */
export function BoardBootSpinner({ size = 30, label, className }: BoardBootSpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("wb-boot-arc", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 30 30" focusable="false" aria-hidden="true">
        {/* 252° of 360° = 70 of pathLength 100. The 54° pre-rotation parks the
            gap where ThinkingSpinner parks it (3 o'clock at rest). */}
        <g transform="rotate(54 15 15)">
          <circle
            cx="15"
            cy="15"
            r="13.75"
            pathLength={100}
            strokeDasharray="70 30"
            fill="none"
            stroke="var(--sky-500)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </g>
      </svg>
    </span>
  );
}
