import { useRef } from 'react'
import { bayerThreshold, hexToAbgr, useDitherCanvas } from './ditherCore'

/* ═══════════════════════════════════════════════════════════════════════════
   DitherHalo — the halftone bloom that sits behind the section heading.

   A soft radial field of density, run through the same Bayer threshold as the
   hero's pixel sea, so the texture reads as one family across the page. Cells
   below the threshold are written transparent rather than skipped: the canvas
   buffer is reused between paints, so every cell has to be assigned.

   Density breathes slowly and drifts sideways, which keeps the field alive
   without pulling attention off the headline in front of it.
   ═══════════════════════════════════════════════════════════════════════════ */

interface DitherHaloProps {
  className?: string
  /** Lit-cell colour. */
  tint?: string
  /** Peak density at the centre of the bloom (0–1). */
  strength?: number
  /** Bloom centre as a fraction of the canvas, [x, y]. */
  center?: [number, number]
  /** Bloom radii as a fraction of the canvas, [x, y]. */
  radius?: [number, number]
  /** Cell size in CSS px. Larger reads coarser and grainier. */
  cell?: number
}

export default function DitherHalo({
  className = '',
  tint = '#59AFD4',
  strength = 0.62,
  center = [0.5, 0.42],
  radius = [0.46, 0.62],
  cell = 3,
}: DitherHaloProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const lit = hexToAbgr(tint)

  useDitherCanvas(ref, cell, 12, (buf, w, h, _cell, t, reduced) => {
    const cx = w * center[0]
    const cy = h * center[1]
    const rx = w * radius[0]
    const ry = h * radius[1]
    const breathe = reduced ? 1 : 1 + 0.07 * Math.sin(t * 0.5)
    const drift = reduced ? 0 : 0.045 * w * Math.sin(t * 0.24)

    for (let row = 0; row < h; row++) {
      const dy = (row - cy) / ry
      for (let col = 0; col < w; col++) {
        const dx = (col - cx - drift) / rx
        // Smooth radial falloff, squared so the edge dissolves rather than stops.
        const r = Math.sqrt(dx * dx + dy * dy)
        const fall = Math.max(0, 1 - r)
        const density = strength * breathe * fall * fall
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
