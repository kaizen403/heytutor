import type { PixelPaint } from './PixelIllustration'

/* ── The illustrations ──────────────────────────────────────────────────
   Drawn in a 0–1 space and scaled to the grid, so the cell count can change
   without redrawing anything. Ink is near-white, accent is sky; the quantiser
   snaps everything to one or the other. */

const inkStroke = (ctx: CanvasRenderingContext2D, w: number) => {
  ctx.strokeStyle = '#F0F5F7'
  ctx.lineWidth = w
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
}
const accentStroke = (ctx: CanvasRenderingContext2D, w: number) => {
  ctx.strokeStyle = '#7FC4E2'
  ctx.lineWidth = w
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
}

const line = (ctx: CanvasRenderingContext2D, u: number, x1: number, y1: number, x2: number, y2: number) => {
  ctx.beginPath()
  ctx.moveTo(x1 * u, y1 * u)
  ctx.lineTo(x2 * u, y2 * u)
  ctx.stroke()
}

/** An open book, seen slightly from above: two leaves rising off a spine,
    the page block showing under each, a written page, and a ribbon. */
export const paintBook: PixelPaint = (ctx, s) => {
  const u = s / 100
  ctx.save()
  inkStroke(ctx, 2.2 * u)

  // Leaves, mirrored about the spine
  for (const dir of [-1, 1]) {
    const x = (v: number) => (50 + dir * v) * u
    ctx.beginPath()
    ctx.moveTo(x(0), 28 * u)
    ctx.bezierCurveTo(x(12), 20 * u, x(26), 18 * u, x(42), 22 * u)
    ctx.lineTo(x(42), 72 * u)
    ctx.bezierCurveTo(x(26), 68 * u, x(12), 70 * u, x(0), 78 * u)
    ctx.closePath()
    ctx.stroke()

    // The page block: two more edges stepping out under the leaf
    ctx.lineWidth = 1.5 * u
    for (let k = 1; k <= 2; k++) {
      const d = k * 3.2
      ctx.beginPath()
      ctx.moveTo(x(42 + d * 0.6), (24 + d) * u)
      ctx.lineTo(x(42 + d * 0.6), (72 + d) * u)
      ctx.bezierCurveTo(x(26), (68 + d) * u, x(12), (70 + d) * u, x(0), (78 + d) * u)
      ctx.stroke()
    }
    ctx.lineWidth = 2.2 * u
  }

  // Spine
  line(ctx, u, 50, 28, 50, 84)

  // Written lines, in accent, ragged like real text
  accentStroke(ctx, 1.6 * u)
  const left = [24, 22, 25, 14, 23]
  const right = [23, 25, 18, 24, 12]
  for (let i = 0; i < 5; i++) {
    const y = 34 + i * 8
    line(ctx, u, 14, y + 1.2, 14 + left[i]!, y - 1.2)
    line(ctx, u, 86 - right[i]!, y - 1.2, 86, y + 1.2)
  }

  // Ribbon marker hanging off the spine
  accentStroke(ctx, 2 * u)
  ctx.beginPath()
  ctx.moveTo(53 * u, 78 * u)
  ctx.lineTo(55 * u, 94 * u)
  ctx.lineTo(57.5 * u, 90 * u)
  ctx.lineTo(60 * u, 94 * u)
  ctx.lineTo(58 * u, 77 * u)
  ctx.stroke()

  ctx.restore()
}

/** A filament bulb at the moment it lands: glass with a highlight, a lit
    filament on its supports, a threaded base, and rays. */
export const paintBulb: PixelPaint = (ctx, s) => {
  const u = s / 100
  ctx.save()

  // Glass: the dome runs clockwise from lower-left (28.1, 52) over the
  // top to lower-right (71.9, 52), then both sides pinch into the neck.
  ctx.beginPath()
  ctx.arc(50 * u, 40 * u, 25 * u, Math.PI * 0.84, Math.PI * 0.16)
  ctx.bezierCurveTo(68 * u, 58 * u, 62 * u, 62 * u, 62 * u, 67 * u)
  ctx.lineTo(38 * u, 67 * u)
  ctx.bezierCurveTo(38 * u, 62 * u, 32 * u, 58 * u, 28.1 * u, 52 * u)
  inkStroke(ctx, 2.2 * u)
  ctx.stroke()

  // Highlight on the glass
  ctx.lineWidth = 1.6 * u
  ctx.beginPath()
  ctx.arc(50 * u, 40 * u, 18 * u, Math.PI * 1.08, Math.PI * 1.42)
  ctx.stroke()

  // Threaded base and the contact tip
  ctx.lineWidth = 2.2 * u
  line(ctx, u, 38, 67, 62, 67)
  line(ctx, u, 39, 73, 61, 73)
  line(ctx, u, 40, 79, 60, 79)
  line(ctx, u, 38, 67, 40, 83)
  line(ctx, u, 62, 67, 60, 83)
  line(ctx, u, 40, 83, 60, 83)
  ctx.beginPath()
  ctx.moveTo(44 * u, 83 * u)
  ctx.quadraticCurveTo(50 * u, 92 * u, 56 * u, 83 * u)
  ctx.stroke()

  // Filament supports and the lit filament
  accentStroke(ctx, 1.6 * u)
  line(ctx, u, 44, 66, 43, 50)
  line(ctx, u, 56, 66, 57, 50)
  accentStroke(ctx, 2 * u)
  ctx.beginPath()
  ctx.moveTo(43 * u, 50 * u)
  for (let i = 1; i <= 6; i++) {
    ctx.lineTo((43 + i * (14 / 6)) * u, (i % 2 ? 42 : 50) * u)
  }
  ctx.stroke()

  // Rays, long and short alternating
  ctx.lineWidth = 2 * u
  const rays: Array<[number, number, number, number]> = [
    [50, 3, 50, 10],
    [30, 7, 33, 12],
    [70, 7, 67, 12],
    [15, 18, 21, 23],
    [85, 18, 79, 23],
    [6, 38, 13, 38],
    [94, 38, 87, 38],
    [11, 58, 17, 55],
    [89, 58, 83, 55],
  ]
  for (const [x1, y1, x2, y2] of rays) line(ctx, u, x1, y1, x2, y2)

  ctx.restore()
}
