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

/** A graduated semicircular protractor with a metal divider laid over it. */
export const paintGeometryTools: PixelPaint = (ctx, s) => {
  const u = s / 100
  ctx.save()
  inkStroke(ctx, 2.2 * u)

  // The protractor's flat edge and two concentric graduated arcs.
  ctx.beginPath()
  ctx.arc(34 * u, 77 * u, 29 * u, Math.PI, Math.PI * 2)
  ctx.lineTo(63 * u, 81 * u)
  ctx.lineTo(5 * u, 81 * u)
  ctx.closePath()
  ctx.stroke()
  accentStroke(ctx, 1.2 * u)
  ctx.beginPath()
  ctx.arc(34 * u, 77 * u, 21 * u, Math.PI, Math.PI * 2)
  ctx.stroke()
  for (let i = 0; i <= 18; i++) {
    const angle = Math.PI + i * Math.PI / 18
    const inner = i % 3 === 0 ? 23 : 26
    line(ctx, u,
      34 + Math.cos(angle) * inner, 77 + Math.sin(angle) * inner,
      34 + Math.cos(angle) * 29, 77 + Math.sin(angle) * 29,
    )
  }
  line(ctx, u, 34, 73, 34, 81)
  line(ctx, u, 31, 77, 37, 77)
  ctx.fillStyle = '#7FC4E2'
  ctx.font = `${5 * u}px monospace`
  ctx.textAlign = 'center'
  ctx.fillText('90', 34 * u, 63 * u)
  ctx.fillText('180', 14 * u, 76 * u)
  ctx.fillText('0', 55 * u, 76 * u)

  // Clear the protractor behind the divider so the two objects stay distinct.
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  inkStroke(ctx, 7 * u)
  line(ctx, u, 67, 24, 45, 88)
  line(ctx, u, 70, 24, 88, 85)
  ctx.restore()

  // Two tapered metal legs, both ending in a point rather than a pencil.
  inkStroke(ctx, 2 * u)
  ctx.beginPath()
  ctx.moveTo(64 * u, 25 * u)
  ctx.lineTo(43 * u, 85 * u)
  ctx.lineTo(43 * u, 94 * u)
  ctx.lineTo(48 * u, 86 * u)
  ctx.lineTo(69 * u, 27 * u)
  ctx.moveTo(68 * u, 27 * u)
  ctx.lineTo(85 * u, 84 * u)
  ctx.lineTo(91 * u, 91 * u)
  ctx.lineTo(90 * u, 82 * u)
  ctx.lineTo(73 * u, 25 * u)
  ctx.stroke()

  // The hinge, knurled handle and small adjustment screw.
  ctx.beginPath()
  ctx.arc(68.5 * u, 23 * u, 6 * u, 0, Math.PI * 2)
  ctx.stroke()
  line(ctx, u, 66, 16, 66, 8)
  line(ctx, u, 71, 16, 71, 8)
  line(ctx, u, 66, 8, 71, 8)
  accentStroke(ctx, 1.6 * u)
  ctx.beginPath()
  ctx.arc(68.5 * u, 23 * u, 2 * u, 0, Math.PI * 2)
  ctx.stroke()
  line(ctx, u, 58, 50, 78, 50)
  for (let x = 63; x <= 73; x += 2.5) line(ctx, u, x, 48, x, 52)
  line(ctx, u, 45, 86, 43, 94)
  line(ctx, u, 87, 83, 91, 91)

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
