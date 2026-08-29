import { useRef } from 'react'
import { hexToAbgr, useDitherCanvas } from './ditherCore'

/* ═══════════════════════════════════════════════════════════════════════════
   PixelSparkle — occasional lit cells, in the page's own pixel grid.

   A conventional sparkle layer is soft round glints, which would be the one
   thing here that is not pixel art. These are single cells of the same Bayer
   field that the hero sea and the section halos use, lit and faded on their own
   phase, so the "sparkle" reads as the blueprint catching light rather than as
   a particle effect borrowed from somewhere else.

   Positions come from a cheap hash of the cell index, so the pattern is stable
   between frames and needs no allocation or particle list.
   ═══════════════════════════════════════════════════════════════════════════ */

interface PixelSparkleProps {
  className?: string
  tint?: string
  /** Roughly how many cells in a thousand are candidates. */
  density?: number
  /** Seconds for one full twinkle cycle. */
  period?: number
}

/** Deterministic 0–1 from a pair of ints — same cell, same phase, every frame. */
const hash = (x: number, y: number): number => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

export default function PixelSparkle({
  className = '',
  tint = '#CCE6F1',
  density = 5,
  period = 4.5,
}: PixelSparkleProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const lit = hexToAbgr(tint)

  useDitherCanvas(ref, 3, 20, (buf, w, h, _cell, t, reduced) => {
    const threshold = density / 1000
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const seed = hash(col, row)
        if (seed > threshold) {
          buf[row * w + col] = 0
          continue
        }
        // Each candidate twinkles on its own offset; reduced motion holds them lit.
        const phase = reduced ? 0.5 : ((t / period + seed * 997) % 1)
        const brightness = Math.sin(phase * Math.PI)
        buf[row * w + col] = brightness > 0.55 ? lit : 0
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
