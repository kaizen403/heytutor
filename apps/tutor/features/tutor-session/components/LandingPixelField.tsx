"use client";

import DitherHalo from "@/components/dither/DitherHalo";
import PixelSparkle from "@/components/dither/PixelSparkle";

/**
 * The landing's pixel field, behind the empty board's first screen.
 *
 * Two blooms of the same 8x8 Bayer grid, one at each end, plus single cells
 * catching light across the panel. Top and bottom get the identical treatment
 * so the field reads as one texture the content floats on, with no horizon and
 * nothing that could be mistaken for a second surface.
 *
 * Kept fine and faint on purpose. This is a ground for a page of text, not the
 * marketing hero, so the grid is 2 CSS px per cell — small enough to read as
 * grain rather than as squares — and the whole field sits under 0.1 opacity.
 *
 * Two numbers do different jobs and it is easy to reach for the wrong one:
 * `cell` sets how big each pixel is, `strength` sets what fraction of them
 * light up. Making cells bigger thins the field but coarsens it, which is the
 * opposite of what a background wants.
 *
 * There is deliberately no `DitherWave` here. The marketing hero's rising sea
 * works because nothing sits on top of it and it seams into the next section;
 * inside this panel it put a bright waterline straight across the middle and
 * lit the whole lower half, which fought the suggestion cards.
 *
 * Both layers pause off-screen, re-measure on resize, and render one static
 * frame under `prefers-reduced-motion`.
 */
export function LandingPixelField() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-2xl" aria-hidden>
      {/* Behind the wordmark and the prompt. */}
      <DitherHalo
        className="absolute inset-x-0 top-0 h-[55%] opacity-[0.09]"
        tint="#59AFD4"
        strength={0.24}
        center={[0.5, 0.34]}
        radius={[0.52, 0.66]}
        cell={2}
      />

      {/* The same bloom, mirrored, so the foot of the panel matches its head. */}
      <DitherHalo
        className="absolute inset-x-0 bottom-0 h-[55%] opacity-[0.09]"
        tint="#59AFD4"
        strength={0.24}
        center={[0.5, 0.66]}
        radius={[0.52, 0.66]}
        cell={2}
      />

      <PixelSparkle
        className="absolute inset-0 opacity-[0.2]"
        tint="#CCE6F1"
        density={1.1}
        period={6.5}
        cell={2}
      />
    </div>
  );
}
