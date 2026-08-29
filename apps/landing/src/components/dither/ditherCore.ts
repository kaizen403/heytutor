import { useCallback, useEffect, useRef, type RefObject } from 'react'

/* ═══════════════════════════════════════════════════════════════════════════
   Ordered-dither canvas core.

   The trick: the canvas is one pixel per `cellPx` CSS pixels and is scaled up
   with `image-rendering: pixelated`, so a 1440×300 area is a 360×75 buffer.
   Every frame a density field is thresholded against a fixed 8×8 Bayer
   matrix. Nothing moves — as the field drifts, individual cells flip on and
   off, which reads as particles shimmering.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Classic 8×8 Bayer matrix, row-major. */
const BAYER_8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]

/** Threshold in (0,1) for cell (x, y). A cell is lit when density > threshold. */
export const bayerThreshold = (x: number, y: number): number =>
  (BAYER_8[((y & 7) << 3) | (x & 7)] + 0.5) / 64

/**
 * Pull `base` density up to 1 across the last `band` px before `edge`,
 * quadratically — so the field stays airy, then fuses solid quickly.
 */
export const fusedDensity = (base: number, y: number, edge: number, band: number): number => {
  const i = Math.min(1, Math.max(0, (y - (edge - band)) / band))
  return base + (1 - base) * i * i
}

/** '#rrggbb' → packed ABGR uint32, the byte order of an RGBA ImageData buffer. */
export const hexToAbgr = (hex: string): number => {
  const v = Number.parseInt(hex.slice(1), 16)
  return (0xff000000 | ((v & 255) << 16) | (((v >> 8) & 255) << 8) | ((v >> 16) & 255)) >>> 0
}

/** Channel-wise mix of two packed ABGR colours. `t` is clamped to 0–1. */
export const mixAbgr = (a: number, b: number, t: number): number => {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t
  const ir = a & 255
  const ig = (a >> 8) & 255
  const ib = (a >> 16) & 255
  const r = (ir + ((b & 255) - ir) * u + 0.5) | 0
  const g = (ig + (((b >> 8) & 255) - ig) * u + 0.5) | 0
  const bl = (ib + (((b >> 16) & 255) - ib) * u + 0.5) | 0
  return (0xff000000 | (bl << 16) | (g << 8) | r) >>> 0
}

export type DitherRender = (
  buf: Uint32Array,
  w: number,
  h: number,
  cell: number,
  timeSec: number,
  reduced: boolean,
) => void

const MAX_CELL = 16

/** Cell size in canvas px. Below 1 dppx the cells grow so the look survives zoom-out. */
const cellFor = (cellPx: number) =>
  Math.min(MAX_CELL, Math.round(cellPx / Math.min(1, window.devicePixelRatio || 1)))

/**
 * Drives a low-res dither canvas.
 *   fps      frame cap while animating (0 = never self-animate)
 *   animate  false → render only on resize or when the returned repaint() is called
 * Pauses off-screen, re-measures on resize and on devicePixelRatio change, and
 * honours prefers-reduced-motion by rendering a single static frame at t = 0.
 */
export function useDitherCanvas(
  ref: RefObject<HTMLCanvasElement | null>,
  cellPx: number,
  fps: number,
  render: DitherRender,
  animate = true,
  onResize?: (canvas: HTMLCanvasElement) => void,
): () => void {
  const renderRef = useRef(render)
  const resizeRef = useRef(onResize)
  const repaintRef = useRef<() => void>(() => {})
  const repaint = useCallback(() => repaintRef.current(), [])

  // Keep the latest closures without re-creating the canvas loop. Declared
  // before the main effect so they are current by the time it first paints.
  useEffect(() => {
    renderRef.current = render
    resizeRef.current = onResize
  })

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let cell = cellFor(cellPx)
    let image: ImageData | null = null
    let buf: Uint32Array | null = null
    let raf = 0
    let lastFrame = 0
    let visible = true
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const isStatic = !animate || reduced
    const t0 = performance.now()

    const paint = (now: number) => {
      if (!image || !buf) return
      renderRef.current(buf, w, h, cell, isStatic ? 0 : (now - t0) / 1000, reduced)
      ctx.putImageData(image, 0, 0)
    }
    repaintRef.current = () => paint(performance.now())

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - lastFrame < 1000 / fps) return
      lastFrame = now
      paint(now)
    }

    const measure = () => {
      const r = canvas.getBoundingClientRect()
      resizeRef.current?.(canvas)
      cell = cellFor(cellPx)
      w = Math.max(1, Math.ceil(r.width / cell))
      h = Math.max(1, Math.ceil(r.height / cell))
      canvas.width = w
      canvas.height = h
      image = ctx.createImageData(w, h)
      buf = new Uint32Array(image.data.buffer)
      paint(performance.now())
    }

    const ro = new ResizeObserver(measure)
    ro.observe(canvas)
    measure()

    // Re-measure when the window moves between displays of different density.
    let dprMq: MediaQueryList | null = null
    const onDpr = () => {
      watchDpr()
      measure()
    }
    const watchDpr = () => {
      dprMq?.removeEventListener('change', onDpr)
      dprMq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      dprMq.addEventListener('change', onDpr)
    }
    watchDpr()
    const unwatchDpr = () => dprMq?.removeEventListener('change', onDpr)

    if (isStatic) {
      return () => {
        unwatchDpr()
        ro.disconnect()
      }
    }

    const io = new IntersectionObserver(([entry]) => {
      const next = !!entry?.isIntersecting
      if (next && !visible) {
        lastFrame = 0
        raf = requestAnimationFrame(loop)
      } else if (!next && visible) {
        cancelAnimationFrame(raf)
      }
      visible = next
    })
    io.observe(canvas)
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      unwatchDpr()
      io.disconnect()
      ro.disconnect()
    }
  }, [ref, cellPx, fps, animate])

  return repaint
}
