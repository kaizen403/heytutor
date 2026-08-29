import { useEffect, useRef } from 'react'
import { bayerThreshold, hexToAbgr, mixAbgr, useDitherCanvas } from './ditherCore'

/* ═══════════════════════════════════════════════════════════════════════════
   DitherBand — a section seam that melts one colour into the next.

   The colour itself travels: each cell is a mix of `from` → `via` → `to`
   across the height, with a Bayer grain so the field stays in the same pixel
   family as the hero sea. There is no threshold line and no fuse-to-solid
   ruler — those are what read as a hard cut between two slabs.
   The wobble phase is driven by how far the band has scrolled through the
   viewport, so the grain shifts under you as you scroll rather than on a clock.
   ═══════════════════════════════════════════════════════════════════════════ */

interface DitherBandProps {
  from: string
  to: string
  /** Mid-blend colour, so the mix travels through teal instead of grey. */
  via?: string
  heightClass?: string
  className?: string
}

type Rect = { docTop: number; height: number }

/** 0 when the band is just below the fold, 1 once it has scrolled off the top. */
const scrollProgress = ({ docTop, height }: Rect) => {
  const vh = window.innerHeight || 1
  return Math.min(1, Math.max(0, (vh - (docTop - window.scrollY)) / (vh + height)))
}

const mixRamp = (from: number, via: number | null, to: number, t: number): number => {
  if (!via) return mixAbgr(from, to, t)
  return t < 0.5 ? mixAbgr(from, via, t * 2) : mixAbgr(via, to, (t - 0.5) * 2)
}

export default function DitherBand({
  from,
  to,
  via,
  heightClass = 'h-[clamp(5rem,8vh,8rem)]',
  className = '',
}: DitherBandProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const rect = useRef<Rect>({ docTop: 0, height: 1 })
  const progress = useRef(0.5)
  const fromAbgr = hexToAbgr(from)
  const toAbgr = hexToAbgr(to)
  const viaAbgr = via ? hexToAbgr(via) : null
  const cssGradient = via
    ? `linear-gradient(180deg, ${from} 0%, ${via} 50%, ${to} 100%)`
    : `linear-gradient(180deg, ${from} 0%, ${to} 100%)`

  const repaint = useDitherCanvas(
    ref,
    4,
    0,
    (buf, w, h, cell, _t, reduced) => {
      const p = reduced ? 0.5 : progress.current
      const rows = Math.max(1, h)

      for (let col = 0; col < w; col++) {
        const x = col * cell
        const wave =
          0.016 * Math.sin(x / 210 + 5.2 * p + 1.4) +
          0.009 * Math.sin(x / 86 - 7.6 * p + 1.7) +
          0.004 * Math.sin(x / 37 + 11.4 * p + 4.2)

        for (let row = 0; row < h; row++) {
          const idx = row * w + col
          const u = (row + 0.5) / rows + wave
          const grain = (bayerThreshold(col, row) - 0.5) * 0.07
          buf[idx] = mixRamp(fromAbgr, viaAbgr, toAbgr, u + grain)
        }
      }
    },
    false,
    (canvas) => {
      const r = canvas.getBoundingClientRect()
      rect.current = { docTop: r.top + window.scrollY, height: r.height }
      progress.current = scrollProgress(rect.current)
    },
  )

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const next = scrollProgress(rect.current)
        if (Math.abs(next - progress.current) > 0.001) {
          progress.current = next
          repaint()
        }
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
    }
  }, [repaint])

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none relative w-full ${heightClass} ${className}`}
      /* If the canvas misses a frame, the same colour ramp still shows — never
         a hairline between two flat fills. */
      style={{ background: cssGradient }}
    >
      <canvas
        ref={ref}
        className="absolute inset-x-0 -top-px -bottom-px block w-full"
        style={{ imageRendering: 'pixelated', height: 'calc(100% + 2px)' }}
      />
    </div>
  )
}
