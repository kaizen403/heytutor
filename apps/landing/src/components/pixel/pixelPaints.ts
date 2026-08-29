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

/** An open book, seen slightly from above: two leaves rising off a spine. */
export const paintBook: PixelPaint = (ctx, s) => {
  const u = s / 100
  ctx.save()

  // Left leaf
  ctx.beginPath()
  ctx.moveTo(50 * u, 30 * u)
  ctx.bezierCurveTo(38 * u, 22 * u, 24 * u, 20 * u, 8 * u, 24 * u)
  ctx.lineTo(8 * u, 74 * u)
  ctx.bezierCurveTo(24 * u, 70 * u, 38 * u, 72 * u, 50 * u, 80 * u)
  ctx.closePath()
  inkStroke(ctx, 2.6 * u)
  ctx.stroke()

  // Right leaf
  ctx.beginPath()
  ctx.moveTo(50 * u, 30 * u)
  ctx.bezierCurveTo(62 * u, 22 * u, 76 * u, 20 * u, 92 * u, 24 * u)
  ctx.lineTo(92 * u, 74 * u)
  ctx.bezierCurveTo(76 * u, 70 * u, 62 * u, 72 * u, 50 * u, 80 * u)
  ctx.closePath()
  ctx.stroke()

  // Spine
  ctx.beginPath()
  ctx.moveTo(50 * u, 30 * u)
  ctx.lineTo(50 * u, 80 * u)
  ctx.stroke()

  // Ruled lines, in accent so the page reads as written on
  accentStroke(ctx, 2 * u)
  for (let i = 0; i < 3; i++) {
    const y = (42 + i * 11) * u
    ctx.beginPath()
    ctx.moveTo(17 * u, y)
    ctx.lineTo(42 * u, y - 2 * u)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(58 * u, y - 2 * u)
    ctx.lineTo(83 * u, y)
    ctx.stroke()
  }
  ctx.restore()
}

/** A filament bulb at the moment it lands. */
export const paintBulb: PixelPaint = (ctx, s) => {
  const u = s / 100
  ctx.save()

  // Glass
  ctx.beginPath()
  ctx.arc(50 * u, 42 * u, 26 * u, Math.PI * 0.86, Math.PI * 0.14)
  ctx.lineTo(62 * u, 68 * u)
  ctx.lineTo(38 * u, 68 * u)
  ctx.closePath()
  inkStroke(ctx, 2.6 * u)
  ctx.stroke()

  // Screw base
  ctx.beginPath()
  ctx.moveTo(39 * u, 74 * u)
  ctx.lineTo(61 * u, 74 * u)
  ctx.moveTo(41 * u, 81 * u)
  ctx.lineTo(59 * u, 81 * u)
  ctx.moveTo(44 * u, 88 * u)
  ctx.lineTo(56 * u, 88 * u)
  ctx.stroke()

  // Filament, lit
  accentStroke(ctx, 2.4 * u)
  ctx.beginPath()
  ctx.moveTo(42 * u, 62 * u)
  ctx.lineTo(45 * u, 44 * u)
  ctx.lineTo(50 * u, 52 * u)
  ctx.lineTo(55 * u, 44 * u)
  ctx.lineTo(58 * u, 62 * u)
  ctx.stroke()

  // Rays
  ctx.lineWidth = 2.2 * u
  const rays: Array<[number, number, number, number]> = [
    [50, 6, 50, 13],
    [18, 16, 24, 22],
    [82, 16, 76, 22],
    [8, 44, 16, 44],
    [92, 44, 84, 44],
  ]
  for (const [x1, y1, x2, y2] of rays) {
    ctx.beginPath()
    ctx.moveTo(x1 * u, y1 * u)
    ctx.lineTo(x2 * u, y2 * u)
    ctx.stroke()
  }
  ctx.restore()
}
