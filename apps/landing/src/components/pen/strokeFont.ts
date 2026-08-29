/* ═══════════════════════════════════════════════════════════════════════════
   A minimal handwriting stroke font.

   Each glyph is a list of PEN STROKES, and each stroke is a list of control
   points that get smoothed into a curve. Letters are written the way a hand
   writes them — one stroke per pen-down — so the animation can lift between
   them instead of retracing, which would force a 180° turn and a hard stop.

   Coordinate space per glyph: x right, y down, ascender y=0, x-height top
   y=0.30, baseline y=1.0. `adv` is the advance width in the same units.
   ═══════════════════════════════════════════════════════════════════════════ */

export type Pt = { x: number; y: number }

export interface Glyph {
  adv: number
  strokes: Pt[][]
}

const p = (x: number, y: number): Pt => ({ x, y })

export const GLYPHS: Record<string, Glyph> = {
  v: {
    adv: 0.6,
    strokes: [[p(0.06, 0.3), p(0.18, 0.6), p(0.3, 0.92), p(0.42, 0.6), p(0.54, 0.3)]],
  },
  u: {
    adv: 0.64,
    strokes: [
      [p(0.08, 0.3), p(0.08, 0.7), p(0.16, 0.92), p(0.34, 0.99), p(0.49, 0.89), p(0.55, 0.7)],
      [p(0.55, 0.3), p(0.55, 0.86), p(0.6, 0.99)],
    ],
  },
  a: {
    adv: 0.66,
    strokes: [
      [
        p(0.5, 0.42), p(0.36, 0.28), p(0.17, 0.33), p(0.08, 0.55),
        p(0.1, 0.8), p(0.24, 0.96), p(0.42, 0.92), p(0.52, 0.74),
      ],
      [p(0.52, 0.3), p(0.52, 0.86), p(0.6, 0.99)],
    ],
  },
  t: {
    adv: 0.58,
    strokes: [
      [p(0.26, 0.08), p(0.26, 0.8), p(0.33, 0.96), p(0.47, 0.98), p(0.56, 0.88)],
      [p(0.07, 0.36), p(0.47, 0.34)],
    ],
  },
  '=': {
    adv: 0.72,
    strokes: [
      [p(0.09, 0.52), p(0.63, 0.5)],
      [p(0.09, 0.76), p(0.63, 0.74)],
    ],
  },
  '+': {
    adv: 0.74,
    strokes: [
      [p(0.1, 0.64), p(0.64, 0.63)],
      [p(0.37, 0.37), p(0.37, 0.91)],
    ],
  },
  s: {
    adv: 0.56,
    strokes: [
      [
        p(0.47, 0.4), p(0.38, 0.3), p(0.21, 0.29), p(0.11, 0.41), p(0.17, 0.55),
        p(0.34, 0.62), p(0.46, 0.73), p(0.42, 0.9), p(0.24, 0.98), p(0.1, 0.9),
      ],
    ],
  },
  '2': {
    adv: 0.58,
    strokes: [
      [
        p(0.1, 0.42), p(0.16, 0.31), p(0.33, 0.26), p(0.47, 0.34),
        p(0.47, 0.5), p(0.3, 0.7), p(0.09, 0.96), p(0.52, 0.95),
      ],
    ],
  },
  // ½ drawn the way it is written: numerator, solidus, denominator.
  '½': {
    adv: 0.82,
    strokes: [
      [p(0.05, 0.36), p(0.13, 0.29), p(0.13, 0.62)],
      [p(0.05, 0.99), p(0.44, 0.24)],
      [
        p(0.36, 0.74), p(0.41, 0.67), p(0.52, 0.66), p(0.59, 0.73),
        p(0.56, 0.83), p(0.44, 0.93), p(0.35, 1.0), p(0.63, 0.99),
      ],
    ],
  },
  ' ': { adv: 0.3, strokes: [] },
}

/** A '^' in the layout string raises and shrinks the character after it. */
const SUP_SCALE = 0.6
const SUP_RISE = 0.42

/**
 * Catmull-Rom through `pts`, sampled into a polyline. Endpoints are duplicated
 * so the curve actually starts and ends on the first/last control point.
 */
export function smoothStroke(pts: Pt[], samplesPerSpan = 12): Pt[] {
  if (pts.length < 2) return pts.slice()
  if (pts.length === 2) {
    const out: Pt[] = []
    for (let i = 0; i <= samplesPerSpan; i++) {
      const t = i / samplesPerSpan
      out.push({ x: pts[0].x + (pts[1].x - pts[0].x) * t, y: pts[0].y + (pts[1].y - pts[0].y) * t })
    }
    return out
  }
  const ext = [pts[0], ...pts, pts[pts.length - 1]]
  const out: Pt[] = []
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1]
    const p1 = ext[i]
    const p2 = ext[i + 1]
    const p3 = ext[i + 2]
    for (let j = 0; j < samplesPerSpan; j++) {
      const t = j / samplesPerSpan
      const t2 = t * t
      const t3 = t2 * t
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      })
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * Lay out `text` at `em` size with its baseline-left at (x, y).
 * Returns absolute, already-smoothed strokes plus the total advance.
 */
export function layoutText(
  text: string,
  x: number,
  y: number,
  em: number,
): { strokes: Pt[][]; width: number } {
  const strokes: Pt[][] = []
  let cursor = 0
  let sup = false
  for (const ch of text) {
    if (ch === '^') {
      sup = true
      continue
    }
    const glyph = GLYPHS[ch]
    if (!glyph) continue
    const k = sup ? SUP_SCALE : 1
    const rise = sup ? SUP_RISE * em : 0
    for (const raw of glyph.strokes) {
      const abs = raw.map((q) => ({
        x: x + cursor * em + q.x * em * k,
        y: y + (q.y - 1) * em * k - rise,
      }))
      strokes.push(smoothStroke(abs))
    }
    cursor += glyph.adv * k
    sup = false
  }
  return { strokes, width: cursor * em }
}
