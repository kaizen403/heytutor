import { useRef } from 'react'
import { bayerThreshold, fusedDensity, hexToAbgr, mixAbgr, useDitherCanvas } from './ditherCore'

/* ═══════════════════════════════════════════════════════════════════════════
   DitherWave — the hero's rising sea of pixels.

   A water-line (three drifting sines, lifted at the screen edges) marks the
   top of the field. Below it, dot density ramps 16% → 84%, then fuses to a
   solid band across the last stretch. Dots near the surface are the dim
   colour, deeper ones the bright colour, dithered between the two.
   Through the foot the solid band grades bright → mid. When `melt` is set,
   that foot instead colour-lerps through to `sink` for a section seam.
   Above the water-line the canvas is transparent, so the hero shows through.
   ═══════════════════════════════════════════════════════════════════════════ */

interface DitherWaveProps {
  className?: string
  /** CSS px from the canvas top down to the centre water-line. */
  surface?: number
  /** Solid px at the very bottom, below the fuse edge. Ignored when `melt` is set. */
  foot?: number
  /** Bottom fraction of the canvas that colour-lerps mid → sink. */
  melt?: number
  /** How far the water-line rises at the left/right screen edges, in px. */
  edgeLift?: number
  /** Distance over which that edge lift decays toward the centre, in px. */
  edgeFalloff?: number
  /** Dot colour near the surface. */
  dim?: string
  /** Dot colour at depth, and the top of the fused band. */
  bright?: string
  /** What the fused band has darkened to by the start of the melt. */
  mid?: string
  /** Colour the foot arrives at — the next section's ground. */
  sink?: string
}

export default function DitherWave({
  className = '',
  surface = 250,
  foot = 44,
  melt,
  edgeLift = 26,
  edgeFalloff = 260,
  dim = '#3E8FB4',
  bright = '#7FC4E2',
  mid = '#59AFD4',
  sink = '#06121C',
}: DitherWaveProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dimAbgr = hexToAbgr(dim)
  const brightAbgr = hexToAbgr(bright)
  const midAbgr = hexToAbgr(mid)
  const sinkAbgr = hexToAbgr(sink)

  const viaAbgr = hexToAbgr('#1E4D66')

  useDitherCanvas(ref, 4, 30, (buf, w, h, cell, t) => {
    const W = w * cell
    const H = h * cell
    const footPx = melt != null ? Math.max(64, melt * H) : foot
    const edge = H - footPx // fuse edge: everything below melts toward sink
    const span = Math.max(cell, edge - surface) // usable depth under the water-line
    const tint = Math.min(span, Math.max(80, 0.22 * span)) // dim → bright over this depth
    const ramp = Math.min(span, Math.max(150, 0.62 * span)) // 16% → 84% over this depth
    const fuse = Math.min(span, Math.max(120, 0.36 * span)) // fuse-to-solid band height
    const wobbleAmp = 0.21 * fuse
    const breathe = 1 + 0.06 * Math.sin(0.55 * t)

    for (let col = 0; col < w; col++) {
      const x = col * cell
      // the water-line: three octaves drifting at different speeds
      const swell =
        22 * Math.sin(x / 118 + 0.7 * t) +
        12 * Math.sin(x / 61 - 1.1 * t + 1.7) +
        6 * Math.sin(x / 29 + 1.9 * t + 4.2)
      // the fuse edge wobbles independently
      const wobble =
        wobbleAmp *
        (0.6 * Math.sin(x / 82 + 1.4 + 0.55 * t) +
          0.28 * Math.sin(x / 44 + 1.7 - 0.36 * t) +
          0.12 * Math.sin(x / 24 + 4.2 + 0.8 * t))
      const lift = edgeLift * Math.exp(-Math.min(x, W - cell - x) / edgeFalloff) * breathe
      const waterline = surface - lift + swell

      for (let row = 0; row < h; row++) {
        const idx = row * w + col
        const depth = row * cell - waterline
        if (depth < 0) {
          buf[idx] = 0
          continue
        }
        const bottom = row * cell + cell
        if (bottom >= edge) {
          const fall = Math.min(1, Math.max(0, (bottom + wobble * 0.5 - edge) / footPx))
          if (melt == null) {
            // Compact sea: grade bright → mid so the foot matches the next
            // seam's `from`, without swallowing the graph lane above.
            buf[idx] = fall * fall < bayerThreshold(col + 5, row + 2) ? brightAbgr : midAbgr
            continue
          }
          const ice = mixAbgr(brightAbgr, midAbgr, Math.min(1, fall * 0.45))
          const grain = (bayerThreshold(col + 5, row + 2) - 0.5) * 0.06
          const tMix = Math.min(1, Math.max(0, fall * 1.5 + grain))
          buf[idx] =
            tMix < 0.5
              ? mixAbgr(ice, viaAbgr, tMix * 2)
              : mixAbgr(viaAbgr, sinkAbgr, (tMix - 0.5) * 2)
          continue
        }
        const base = Math.min(0.16 + (depth / ramp) * 0.68, 0.84)
        const density = fusedDensity(base, bottom + wobble, edge, fuse)
        if (density <= bayerThreshold(col, row)) {
          buf[idx] = 0
          continue
        }
        // offset the second Bayer lookup so the tint dither doesn't align with the density dither
        buf[idx] = depth / tint < bayerThreshold(col + 3, row + 5) ? dimAbgr : brightAbgr
      }
    }
  })

  return (
    <div aria-hidden="true" className={className}>
      <canvas ref={ref} className="block h-full w-full" style={{ imageRendering: 'pixelated' }} />
    </div>
  )
}
