import { useEffect, useRef, type CSSProperties } from 'react'

/* ═══════════════════════════════════════════════════════════════════════════
   PixelIllustration — real geometry, rasterised down to a pixel grid.

   Hand-placed sprites have to be authored cell by cell, so they stay coarse:
   at 16×16 a compass or a flask is a handful of blobs. Here the drawing is
   ordinary canvas vector work (arcs, polygons, lines) rendered into a small
   offscreen buffer, then quantised and blown back up with `image-rendering:
   pixelated`. The form comes from geometry, so it stays legible, while the
   cell count sets how fine the pixels are — the same trick the dither field
   uses, so both read as one pixel language.

   Quantising is what keeps it honest pixel art: canvas antialiases its edges,
   so every cell is forced to full ink, full accent, or nothing.
   ═══════════════════════════════════════════════════════════════════════════ */

export type PixelPaint = (ctx: CanvasRenderingContext2D, size: number) => void

const INK = [240, 245, 247] as const // frost
const ACCENT = [127, 196, 226] as const // sky-400

interface PixelIllustrationProps {
  paint: PixelPaint
  /** Grid resolution. Higher = finer pixels for the same rendered size. */
  cells?: number
  className?: string
  style?: CSSProperties
}

export default function PixelIllustration({
  paint,
  cells = 56,
  className = '',
  style,
}: PixelIllustrationProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    canvas.width = cells
    canvas.height = cells
    ctx.clearRect(0, 0, cells, cells)
    ctx.imageSmoothingEnabled = false
    paint(ctx, cells)

    // Quantise: canvas antialiases, pixel art does not. Every cell resolves to
    // ink, accent or empty — whichever the painted colour is nearer.
    const image = ctx.getImageData(0, 0, cells, cells)
    const data = image.data
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]!
      if (alpha < 115) {
        data[i + 3] = 0
        continue
      }
      const target = data[i]! + data[i + 1]! + data[i + 2]! > 600 ? INK : ACCENT
      data[i] = target[0]
      data[i + 1] = target[1]
      data[i + 2] = target[2]
      data[i + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
  }, [paint, cells])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={className}
      style={{ imageRendering: 'pixelated', ...style }}
    />
  )
}
