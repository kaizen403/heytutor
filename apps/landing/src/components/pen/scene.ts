import { layoutText, smoothStroke, type Pt } from './strokeFont'

/* ═══════════════════════════════════════════════════════════════════════════
   Scene builder — the whole performance as ONE continuous path.

   The old version ran discrete phases, each with its own easing. Every phase
   boundary was therefore a velocity discontinuity (a phase starting at t=0 of
   an ease-in begins at zero speed — the visible "stop"), and the pen angle was
   computed by a different formula per phase, so it snapped at each seam.

   Here the entire performance is one polyline. Pen-up bridges between strokes
   leave along the previous tangent and arrive along the next one, so direction
   is continuous across every lift. Speed is a smoothed field over arc length,
   never zero and never stepped, so the pen is always moving. Time comes from
   integrating ds/v, which makes the whole thing frame-rate independent.
   ═══════════════════════════════════════════════════════════════════════════ */

const SPACING = 1.6 // px between polyline samples
const MIN_SPEED = 90 // px/s — the floor, so time never diverges
const CURV_CLAMP = 0.09 // 1/px
const CURV_K = 26 // px; speed halves where the radius of curvature is this
/* Hard ceiling on |dv/dt|. Blurring the speed field smooths it in ARC LENGTH,
   which is not the same as smoothing it in time: over a fast stretch, 300px of
   blur is only a tenth of a second, so the exit still snapped from writing
   speed to flight speed. Bounding acceleration directly is what actually makes
   the take-off and the landing feel eased. */
const A_MAX = 2050 // px/s^2

export interface StageGeom {
  heroW: number
  heroH: number
  laneTop: number
  laneBottom: number
}

export interface Scene {
  n: number
  x: Float32Array
  y: Float32Array
  /** 1 when the segment ending at i lays down ink. */
  ink: Uint8Array
  /** Cumulative time (s) at each sample. */
  time: Float32Array
  /** Speed (px/s) at each sample. */
  speed: Float32Array
  duration: number
  maxSpeed: number
  origin: Pt
}

type Move = { pts: Pt[]; ink: boolean; speed: number }

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const cubic = (p0: Pt, c1: Pt, c2: Pt, p1: Pt, n: number): Pt[] => {
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    })
  }
  return out
}

const quad = (p0: Pt, c: Pt, p2: Pt, n: number): Pt[] => {
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push({
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
    })
  }
  return out
}

const dirAt = (pts: Pt[], atStart: boolean): Pt => {
  const a = atStart ? pts[0] : pts[pts.length - 1]
  const b = atStart ? pts[Math.min(1, pts.length - 1)] : pts[Math.max(0, pts.length - 2)]
  const vx = atStart ? b.x - a.x : a.x - b.x
  const vy = atStart ? b.y - a.y : a.y - b.y
  const m = Math.hypot(vx, vy) || 1
  return { x: vx / m, y: vy / m }
}

/** Short tick across an axis. `vertical` = the tick stroke runs up/down. */
const tickMark = (at: Pt, vertical: boolean, back: number, fwd: number): Pt[] =>
  vertical
    ? [{ x: at.x, y: at.y - back }, { x: at.x, y: at.y + fwd }]
    : [{ x: at.x - back, y: at.y }, { x: at.x + fwd, y: at.y }]

/** A dashed run a→b, as one stroke per dash — the pen really does flick each one. */
const dashLine = (a: Pt, b: Pt, dash: number, gap: number): Pt[][] => {
  const total = dist(a, b)
  if (total < dash) return []
  const ux = (b.x - a.x) / total
  const uy = (b.y - a.y) / total
  const out: Pt[][] = []
  for (let d = 0; d + dash <= total; d += dash + gap) {
    out.push([
      { x: a.x + ux * d, y: a.y + uy * d },
      { x: a.x + ux * (d + dash), y: a.y + uy * (d + dash) },
    ])
  }
  return out
}

const circleAt = (c: Pt, r: number, startDeg: number): Pt[] => {
  const out: Pt[] = []
  const n = 28
  for (let i = 0; i <= n; i++) {
    const a = (startDeg * Math.PI) / 180 + (i / n) * Math.PI * 2
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r })
  }
  return out
}

/** Point at arc-length fraction `f` along a polyline. */
const alongPolyline = (pts: Pt[], f: number): Pt => {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i])
  const want = total * clamp(f, 0, 1)
  let run = 0
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i])
    if (run + d >= want) {
      const k = d > 0 ? (want - run) / d : 0
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k }
    }
    run += d
  }
  return pts[pts.length - 1]
}

/**
 * Smooth 1-D wobble from three summed sines (~62px, ~146px and ~370px
 * wavelengths). Ruler-straight axes are the giveaway that a machine drew this;
 * a sub-pixel drift perpendicular to the stroke is what makes ink look human.
 */
const tremorAt = (s: number, seed: number) =>
  Math.sin(s * 0.101 + seed * 4.1) * 0.28 +
  Math.sin(s * 0.043 + seed) * 0.62 +
  Math.sin(s * 0.017 + seed * 2.3) * 0.9

/** Collects moves, auto-bridging every gap so the path never teleports. */
class Builder {
  moves: Move[] = []
  private end: Pt | null = null
  private endDir: Pt | null = null

  /** Pen-down stroke. A bridge is inserted automatically if the pen is elsewhere. */
  stroke(pts: Pt[], speed: number, travelSpeed = 780) {
    if (pts.length < 2) return
    if (this.end && dist(this.end, pts[0]) > 0.5) this.bridge(pts, travelSpeed)
    this.moves.push({ pts, ink: true, speed })
    this.end = pts[pts.length - 1]
    this.endDir = dirAt(pts, false)
  }

  /** Explicit pen-up move (the fly-in / fly-out). */
  travel(pts: Pt[], speed: number) {
    if (pts.length < 2) return
    this.moves.push({ pts, ink: false, speed })
    this.end = pts[pts.length - 1]
    this.endDir = dirAt(pts, false)
  }

  /**
   * Pen-up hop onto the next stroke. Leaves along the previous tangent and
   * arrives along the next one — that G1 match at both ends is what stops the
   * direction (and therefore the pen) from flicking at a lift or a landing.
   */
  private bridge(next: Pt[], speed: number) {
    const p0 = this.end as Pt
    const p1 = next[0]
    const t0 = this.endDir ?? { x: 1, y: 0 }
    const t1 = dirAt(next, true)
    const gap = dist(p0, p1) || 1
    const ux = (p1.x - p0.x) / gap
    const uy = (p1.y - p0.y) / gap
    // How well each tangent points along the hop. Negative means the pen has to
    // double back — a retrace, as when crossing a 't'. Holding the handles at
    // full length there folds the cubic into a cusp, which reads as the pen
    // flicking 180 deg in one frame, so shorten them by how backward it is.
    const a0 = t0.x * ux + t0.y * uy
    const a1 = t1.x * ux + t1.y * uy
    const d = Math.max(14, gap * 0.38)
    const d0 = d * clamp(0.14 + 0.86 * a0, 0.08, 1)
    const d1 = d * clamp(0.14 + 0.86 * a1, 0.08, 1)
    // Bow the hop clear of the page; a backward hop bows more so it swings over
    // what was just written rather than scraping back across it.
    const back = clamp(0.5 - 0.5 * Math.min(a0, a1), 0, 1)
    const bow = Math.min(38, gap * 0.42) * (0.28 + 0.72 * back)
    const c1 = { x: p0.x + t0.x * d0, y: p0.y + t0.y * d0 - bow }
    const c2 = { x: p1.x - t1.x * d1, y: p1.y - t1.y * d1 - bow }
    this.moves.push({ pts: cubic(p0, c1, c2, p1, 30), ink: false, speed })
  }
}

const boxBlur = (src: Float32Array, radius: number, passes: number): Float32Array => {
  const n = src.length
  let a = Float32Array.from(src)
  let b = new Float32Array(n)
  for (let p = 0; p < passes; p++) {
    let sum = 0
    const w = radius * 2 + 1
    for (let i = -radius; i <= radius; i++) sum += a[clamp(i, 0, n - 1)]
    for (let i = 0; i < n; i++) {
      b[i] = sum / w
      sum -= a[clamp(i - radius, 0, n - 1)]
      sum += a[clamp(i + radius + 1, 0, n - 1)]
    }
    const t = a
    a = b
    b = t
  }
  return a
}

export function buildScene(g: StageGeom): Scene | null {
  const { heroW, laneTop, laneBottom } = g
  const laneH = laneBottom - laneTop
  if (heroW < 360 || laneH < 90) return null

  /* ── Layout ────────────────────────────────────────────────────────────── */
  const padTop = clamp(laneH * 0.05, 6, 24)
  const padBottom = clamp(laneH * 0.16, 22, 40) // clearance over the pixel sea
  const usableTop = laneTop + padTop
  const usableBottom = laneBottom - padBottom
  const graphH = Math.min(Math.max(90, usableBottom - usableTop), clamp(heroW * 0.185, 120, 250))
  // Width follows height: on a short viewport the stage is only ~190px tall, and
  // a full-width graph there reads as a squashed 3.4:1 letterbox rather than a
  // plotted axis pair. Capping the aspect keeps it looking deliberate.
  const graphW = Math.min(clamp(heroW * 0.4, 300, 560), graphH * 2.6)
  const cx = heroW / 2
  const ox = cx - graphW * 0.46
  const oy = usableBottom
  const yTop = oy - graphH
  const xRight = ox + graphW
  const origin = { x: ox, y: oy }

  const S = { draw: 410, write: 300, flick: 460, travel: 1000, hop: 900 }
  const em = clamp(Math.min(graphH * 0.19, graphW * 0.062), 16, 30)

  const b = new Builder()

  /* 1 ── in from off-screen left, ARRIVING STRAIGHT DOWN onto the s-axis.
         The last control point sits directly above the landing, so the entry
         tangent and the first stroke's tangent are identical — the pen flows
         into the downstroke with no turn and no pause at the hand-off. The
         approach is long and its peak speed modest, so the slow-down has room
         to happen instead of being crushed into the last few pixels. */
  b.travel(
    cubic(
      { x: -heroW * 0.2 - 150, y: yTop - graphH * 0.85 },
      { x: heroW * 0.14, y: yTop - graphH * 1.05 },
      { x: ox, y: yTop - graphH * 0.66 },
      { x: ox, y: yTop },
      72,
    ),
    1250,
  )

  /* 2 ── both axes as one L. The fillet keeps the corner's curvature finite so
         the speed dips through it rather than stopping dead. */
  const r = 9
  const axes: Pt[] = [
    { x: ox, y: yTop },
    { x: ox, y: oy - r },
    ...cubic({ x: ox, y: oy - r }, { x: ox, y: oy }, { x: ox, y: oy }, { x: ox + r, y: oy }, 10),
    { x: xRight, y: oy },
  ]
  b.stroke(axes, S.draw)

  /* 3 ── label the t-axis where the pen already is, then tick back along it */
  for (const st of layoutText('t', xRight - em * 0.62, oy - em * 0.38, em).strokes) b.stroke(st, S.write, S.hop)

  const tk = clamp(graphH * 0.032, 3.5, 6)
  for (const f of [0.66, 0.33]) {
    b.stroke(tickMark({ x: ox + graphW * f, y: oy }, true, tk, tk * 0.7), S.flick, S.hop)
  }
  for (const f of [0.36, 0.72]) {
    b.stroke(tickMark({ x: ox, y: oy - graphH * f }, false, tk, tk * 0.7), S.flick, S.hop)
  }

  /* 4 ── the s-axis label, then the equation and a quick underline */
  for (const st of layoutText('s', ox - em * 1.2, yTop + em * 1.1, em).strokes) b.stroke(st, S.write, S.hop)

  const eqX = ox + graphW * 0.17
  const eqY = yTop + graphH * 0.34
  const eq = layoutText('s = ½at^2', eqX, eqY, em)
  for (const st of eq.strokes) b.stroke(st, S.write, S.hop)
  b.stroke(
    [
      { x: eqX - em * 0.06, y: eqY + em * 0.26 },
      { x: eqX + eq.width * 0.5, y: eqY + em * 0.3 },
      { x: eqX + eq.width + em * 0.04, y: eqY + em * 0.24 },
    ],
    S.flick,
    S.hop,
  )

  /* 5 ── the curve itself: s = ½at², flat off the origin and steepening away.
         A quadratic whose control point is level with the origin is exactly
         that shape. */
  const curve = smoothStroke(
    quad(origin, { x: ox + graphW * 0.66, y: oy }, { x: ox + graphW * 0.93, y: yTop + graphH * 0.06 }, 48),
    1,
  )
  b.stroke(curve, S.draw, S.travel)

  /* 6 ── read a value off the curve: dashed projections up from t and across
         from s, meeting at a circled point */
  const mark = alongPolyline(curve, 0.72)
  const dot = clamp(em * 0.22, 3.5, 6)
  const dLen = clamp(graphH * 0.13, 13, 24)
  for (const d of dashLine({ x: mark.x, y: oy }, { x: mark.x, y: mark.y + dot + 2 }, dLen, dLen * 0.6)) {
    b.stroke(d, S.flick, S.hop)
  }
  for (const d of dashLine({ x: ox, y: mark.y }, { x: mark.x - dot - 2, y: mark.y }, dLen, dLen * 0.6)) {
    b.stroke(d, S.flick, S.hop)
  }
  b.stroke(circleAt(mark, dot, 150), S.write, S.hop)

  /* 7 ── away through the top-right, gathering speed off the mark */
  b.travel(
    cubic(
      mark,
      { x: mark.x + graphW * 0.22, y: mark.y - graphH * 0.3 },
      { x: heroW * 0.9, y: yTop - graphH * 0.55 },
      { x: heroW * 1.28 + 190, y: yTop - graphH * 1.3 },
      58,
    ),
    1550,
  )

  /* ── Flatten every move into one evenly-sampled polyline ───────────────── */
  const xs: number[] = []
  const ys: number[] = []
  const ink: number[] = []
  const base: number[] = []
  for (const mv of b.moves) {
    for (let i = 1; i < mv.pts.length; i++) {
      const a = mv.pts[i - 1]
      const c = mv.pts[i]
      const len = dist(a, c)
      if (len < 1e-6) continue
      const steps = Math.max(1, Math.ceil(len / SPACING))
      for (let k = 1; k <= steps; k++) {
        const t = k / steps
        if (xs.length === 0) {
          xs.push(a.x)
          ys.push(a.y)
          ink.push(0)
          base.push(mv.speed)
        }
        xs.push(a.x + (c.x - a.x) * t)
        ys.push(a.y + (c.y - a.y) * t)
        ink.push(mv.ink ? 1 : 0)
        base.push(mv.speed)
      }
    }
  }
  const n = xs.length
  if (n < 8) return null

  /* ── Speed field ───────────────────────────────────────────────────────── */
  // Macro profile: blur the per-move target speeds hard, so the fly-in eases
  // down into the first stroke over ~150px instead of stepping at the seam.
  const macro = boxBlur(Float32Array.from(base), 40, 3)

  // Curvature damping, blurred lightly so it still bites at corners. This is
  // what makes the hand slow into the arrowheads and the axis fillet.
  const curv = new Float32Array(n)
  for (let i = 1; i < n - 1; i++) {
    const ax = xs[i] - xs[i - 1]
    const ay = ys[i] - ys[i - 1]
    const bx = xs[i + 1] - xs[i]
    const by = ys[i + 1] - ys[i]
    const la = Math.hypot(ax, ay)
    const lb = Math.hypot(bx, by)
    if (la < 1e-6 || lb < 1e-6) continue
    const cosang = clamp((ax * bx + ay * by) / (la * lb), -1, 1)
    curv[i] = Math.min(CURV_CLAMP, Math.acos(cosang) / ((la + lb) * 0.5))
  }
  curv[0] = curv[1]
  curv[n - 1] = curv[n - 2]
  const curvS = boxBlur(curv, 7, 2)

  const speed = new Float32Array(n)
  for (let i = 0; i < n; i++) speed[i] = Math.max(MIN_SPEED, macro[i] / (1 + CURV_K * curvS[i]))

  /* Forward/backward velocity planner. The forward pass caps how fast the pen
     can already be going given where it came from; the backward pass caps it
     given where it must slow down to next. What survives both is the fastest
     profile reachable without ever exceeding A_MAX — the pen enters and leaves
     frame already moving, so neither end is pinned to zero. */
  for (let i = 1; i < n; i++) {
    const ds = Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
    const cap = Math.sqrt(speed[i - 1] * speed[i - 1] + 2 * A_MAX * ds)
    if (speed[i] > cap) speed[i] = cap
  }
  for (let i = n - 2; i >= 0; i--) {
    const ds = Math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i])
    const cap = Math.sqrt(speed[i + 1] * speed[i + 1] + 2 * A_MAX * ds)
    if (speed[i] > cap) speed[i] = cap
  }
  // The planner leaves corners where the two passes meet; a light blur rounds
  // those without meaningfully breaking the bound.
  const finalSpeed = boxBlur(speed, 8, 2)

  /* ── Integrate ds/v into a time axis ───────────────────────────────────── */
  const time = new Float32Array(n)
  let maxSpeed = 0
  for (let i = 1; i < n; i++) {
    const ds = Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
    const v = (finalSpeed[i] + finalSpeed[i - 1]) * 0.5
    time[i] = time[i - 1] + ds / v
    if (finalSpeed[i] > maxSpeed) maxSpeed = finalSpeed[i]
  }

  /* Hand tremor. Applied last, on top of the finished timing, so the wobble
     never feeds back into curvature or speed. The amplitude is faded by a
     blurred ink mask, so the pen drifts while drawing and flies clean. */
  const mask = boxBlur(Float32Array.from(ink, (v) => v), 12, 2)
  const amp = clamp(heroW / 1440, 0.7, 1.15) * 0.72
  const fx = Float32Array.from(xs)
  const fy = Float32Array.from(ys)
  let run = 0
  for (let i = 0; i < n; i++) {
    if (i > 0) run += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
    const j = Math.min(n - 1, i + 2)
    const k = Math.max(0, i - 2)
    const tx = xs[j] - xs[k]
    const ty = ys[j] - ys[k]
    const m = Math.hypot(tx, ty) || 1
    const off = amp * mask[i] * tremorAt(run, 1.7)
    fx[i] = xs[i] + (-ty / m) * off
    fy[i] = ys[i] + (tx / m) * off
  }

  return {
    n,
    x: fx,
    y: fy,
    ink: Uint8Array.from(ink),
    time,
    speed: finalSpeed,
    duration: time[n - 1],
    maxSpeed,
    origin,
  }
}

export interface Sample {
  x: number
  y: number
  dx: number
  dy: number
  speed: number
  index: number
}

/** Position/heading at time `t` (seconds), linearly interpolated between samples. */
export function sampleAt(sc: Scene, t: number, hint = 0): Sample {
  const tt = clamp(t, 0, sc.duration)
  let i = clamp(hint, 1, sc.n - 1)
  if (sc.time[i - 1] > tt) {
    let lo = 1
    let hi = i
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sc.time[mid] < tt) lo = mid + 1
      else hi = mid
    }
    i = lo
  } else {
    while (i < sc.n - 1 && sc.time[i] < tt) i++
  }
  const t0 = sc.time[i - 1]
  const t1 = sc.time[i]
  const f = t1 > t0 ? (tt - t0) / (t1 - t0) : 0
  const x = sc.x[i - 1] + (sc.x[i] - sc.x[i - 1]) * f
  const y = sc.y[i - 1] + (sc.y[i] - sc.y[i - 1]) * f
  // Heading from a short window, so it never jitters on a single short segment.
  const j = Math.min(sc.n - 1, i + 3)
  const k = Math.max(0, i - 4)
  let dx = sc.x[j] - sc.x[k]
  let dy = sc.y[j] - sc.y[k]
  const m = Math.hypot(dx, dy) || 1
  dx /= m
  dy /= m
  return { x, y, dx, dy, speed: sc.speed[i], index: i }
}
