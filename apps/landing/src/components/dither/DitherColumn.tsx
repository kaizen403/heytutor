import { useRef } from 'react'
import { bayerThreshold, hexToAbgr, useDitherCanvas } from './ditherCore'

/* ═══════════════════════════════════════════════════════════════════════════
   DitherColumn — a slow vertical drift of pixels for the margins.

   The lesson window is capped at 62rem inside a 72rem column, so on wide
   screens there is bare navy either side of it. This fills that with the same
   Bayer field the hero's sea and the section halos use, drifting upward on a
   long period: enough motion to feel alive beside a playing video, far too
   slow to pull the eye off it.

   Density is a soft vertical band modulated by two slow sines, so the field
   thickens and thins as it climbs rather than scrolling as a rigid texture.
   ═══════════════════════════════════════════════════════════════════════════ */

interface DitherColumnProps {
  className?: string
  tint?: string
  /** Peak density (0–1). */
  strength?: number
  /** Cells per second of upward drift. */
  speed?: number
  /** Mirror the horizontal falloff, so a pair leans toward the centre. */
  side?: 'left' | 'right'
}

export default function DitherColumn({
  className = '',
  tint = '#59AFD4',
  strength = 0.5,
  speed = 2.2,
  side = 'left',
}: DitherColumnProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const lit = hexToAbgr(tint)

  useDitherCanvas(ref, 3, 14, (buf, w, h, _cell, t, reduced) => {
    const drift = reduced ? 0 : t * speed
    for (let row = 0; row < h; row++) {
      const y = row + drift
      // Two slow waves climbing at different rates keeps the band breathing.
      const band = 0.5 + 0.5 * Math.sin(y / 26) * Math.sin(y / 61 + 1.3)
      for (let col = 0; col < w; col++) {
        // Densest at the outer edge, thinning toward the content.
        const across = side === 'left' ? 1 - col / w : col / w
        const density = strength * band * across * across
        buf[row * w + col] = density > bayerThreshold(col, row) ? lit : 0
      }
    }
  })

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none block h-full w-full ${className}`}
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
