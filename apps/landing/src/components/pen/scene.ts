import { layoutText, type Pt } from './strokeFont'

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

/* ── Where the figure may go ──────────────────────────────────────────────
   The lane spans the hero, but the rows it covers are shared with the pixel
   book and bulb (HeroPixelDecor, lg and up) and with the wallpaper doodles that
   flank it (SketchWallpaper's hero scatter). These limits mirror those
   percentages, measured off the rendered page at 1024 to 1920 wide. If either
   layout moves, move these with it. */

interface Band {
  left: number
  right: number
}

/** lg and up: between the pixel props and the flanking doodle columns. */
const wideBand = (w: number): Band => ({
  // the book's right edge; the Newton and circle doodles 18 to 19.5% in
  left: Math.max(w * 0.06 + 240, w * 0.195 + 62),
  // the bulb's left edge; the pH scale 20% in; the 22.5% column (xl only)
  right: Math.min(w * 0.94 - 205, w * 0.8 - 80, w >= 1250 ? w * 0.775 - 50 : Infinity),
})

/** md: no pixel props. Below the upper doodles only the edge columns remain. */
const tabletBand = (w: number, belowUpperDoodles: boolean): Band =>
  belowUpperDoodles
    ? { left: w * 0.003 + 72, right: w * 0.997 - 72 }
    : {
        left: Math.max(w * 0.195 + 62, w * 0.18 + 86),
        right: Math.min(w * 0.8 - 80, w * 0.86 - 45, w * 0.97 - 113),
      }

/** Lowest ink of md's upper doodles (the Pythagoras triangle, pH scale, circle). */
const upperDoodlesBottom = (h: number) => Math.max(h * 0.38 + 60, h * 0.31 + 95, h * 0.35 + 55)

/** Lowest ink of the mobile doodles parked between the buttons and the lane. */
const mobileDoodlesBottom = (h: number) => h * 0.49 + 60

/** Largest amplitude, and the one the figure was sized around. */
const R_MAX = 125
/** Wave period as a multiple of R when width is what binds. */
const PERIOD_R = 3.8
/** The curves stop 3/8 of a period past a whole turn (θ = 3π/4), where
    sin θ is up at +0.71 and cos θ down at -0.71: each ends clear of the other
    and of the axis, with room to be named beside its own end. */
const END_TURN = 0.375
const SIN_LABEL = 'sin θ'
const COS_LABEL = 'cos θ'

/** Everything in the figure scales off the amplitude. */
const proportions = (R: number) => {
  const em = clamp(R * 0.31, 15, 30)
  // How far each axis runs past the curves. Never less than the y label needs
  // to clear the top of the cosine's first crest with its tail.
  const ov = Math.max(R * 0.2, em * 0.78)
  // Past the end of the waves: a gap, the curve labels, then the axis carries
  // on under θ.
  const labelW = Math.max(layoutText(SIN_LABEL, 0, 0, em).width, layoutText(COS_LABEL, 0, 0, em).width)
  const tail = em * 0.4 + labelW + em * 1.15
  return {
    em,
    ov,
    tail,
    height: 2 * R + 2 * ov + em * 0.28,
    width: ov + (1 + END_TURN) * PERIOD_R * R + tail,
  }
}

/** Largest radius whose figure fits `maxW` by `maxH`. */
const fitRadius = (maxW: number, maxH: number) => {
  let lo = 0
  let hi = R_MAX
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2
    const f = proportions(mid)
    if (f.width <= maxW && f.height <= maxH) lo = mid
    else hi = mid
  }
  return lo
}

/** Centre and usable width of a band, holding the figure near the hero's centre line. */
const across = (band: Band, w: number) => {
  const mid = clamp((band.left + band.right) / 2, w * 0.475, w * 0.525)
  return { mid, width: 2 * (Math.min(mid - band.left, band.right - mid) - 14) }
}

export function buildScene(g: StageGeom): Scene | null {
  const { heroW, heroH, laneTop, laneBottom } = g
  const laneH = laneBottom - laneTop
  if (heroW < 360 || laneH < 90) return null

  /* ── Layout ────────────────────────────────────────────────────────────── */
  const padTop = clamp(laneH * 0.05, 6, 24)
  const padBottom = clamp(laneH * 0.16, 22, 40) // clearance over the pixel sea
  const usableTop = laneTop + padTop
  const usableBottom = laneBottom - padBottom
  const usableH = usableBottom - usableTop

  // A circle unrolling into a wave wants to travel, so the figure takes the
  // whole clear middle of the hero. On a short lane the radius shrinks; the
  // figure never grows past the lane.
  let maxH = usableH
  let band: Band
  if (heroW >= 1000) {
    band = wideBand(heroW)
  } else if (heroW >= 768) {
    const open = tabletBand(heroW, true)
    const R = fitRadius(across(open, heroW).width, maxH)
    band = usableBottom - proportions(R).height >= upperDoodlesBottom(heroH) ? open : tabletBand(heroW, false)
  } else {
    // Just under md a desktop scrollbar can leave the md doodles showing, so
    // keep clear of their edge columns too.
    band = heroW >= 740 ? tabletBand(heroW, true) : { left: 6, right: heroW - 6 }
    // Stay under the doodles parked above the lane. On a short phone they sit
    // inside it, and a figure squeezed below them is too small to read, so it
    // takes the whole lane instead.
    const clear = usableBottom - Math.max(usableTop, mobileDoodlesBottom(heroH))
    if (clear >= 96) maxH = clear
  }
  const { mid, width: maxW } = across(band, heroW)
  const R = fitRadius(maxW, maxH)
  const { em, ov, tail } = proportions(R)

  // Whatever width the axes and labels leave goes to the waves: two turns and
  // the end if the periods stay readable, otherwise one.
  const waveRoom = maxW - ov - tail
  const periods = (waveRoom / (2 + END_TURN) >= R * 3.4 ? 2 : 1) + END_TURN
  const P = Math.min(waveRoom / periods, R * 4.4)

  const figW = ov + periods * P + tail
  const cx = mid - figW / 2 + ov // the y axis, where θ = 0
  const cy = usableBottom - R - ov
  const origin = { x: cx, y: cy }
  const waveEnd = cx + periods * P
  const tip = cy - R - ov // top of the vertical axis

  // A bigger figure is drawn by a quicker hand, so a wide screen does not
  // stretch the loop into a lecture. Straight construction lines (`rule`) go
  // down faster than the curves.
  const pace = clamp(Math.pow(R / 70, 0.6), 1, 1.45)
  const S = {
    draw: 410 * pace,
    rule: 540 * pace,
    write: 300 * pace,
    flick: 460 * pace,
    travel: 1000 * pace,
    hop: 900 * pace,
  }
  const b = new Builder()

  /* 1 ── in from off-screen left, ARRIVING LEVEL onto the left end of the θ
         axis. The last control point sits on the axis behind the landing, so
         the entry tangent and the axis's own are the same and the pen flows
         into the stroke with no turn. */
  const land = { x: cx - ov, y: cy }
  b.travel(
    cubic(
      { x: -heroW * 0.2 - 150, y: tip - R * 1.3 },
      { x: Math.min(heroW * 0.14, land.x - R), y: tip - R * 1.5 },
      { x: land.x - R * 0.9, y: cy },
      land,
      72,
    ),
    1250 * pace,
  )

  /* 2 ── the θ axis, θ written over its end, a tick at every π on the way
         back, then the vertical axis drawn upward so y is written where the
         pen stops, right beside where cos θ starts. */
  const axisEnd = waveEnd + tail
  b.stroke([land, { x: axisEnd, y: cy }], S.rule, S.hop)
  for (const st of layoutText('θ', axisEnd - em * 0.85, cy - em * 0.28, em).strokes) b.stroke(st, S.write, S.hop)

  const tk = clamp(R * 0.075, 3.5, 6)
  for (let f = Math.floor(periods * 2) / 2; f > 0; f -= 0.5) {
    b.stroke(tickMark({ x: cx + P * f, y: cy }, true, tk, tk), S.flick, S.hop)
  }

  b.stroke([{ x: cx, y: cy + R + ov }, { x: cx, y: tip }], S.rule, S.hop)
  for (const st of layoutText('y', cx - em * 0.84, tip + em * 0.42, em).strokes) b.stroke(st, S.write, S.hop)

  /* 3 ── cos θ from its crest on the y axis, in one stroke at drawing pace,
         then named beside its end, below the axis. y = cy - R f(θ) because
         the canvas is y-down. */
  const curve = (f: (th: number) => number): Pt[] => {
    const steps = Math.ceil((periods * P) / 2)
    const out: Pt[] = []
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * periods * Math.PI * 2
      out.push({ x: cx + (th / (Math.PI * 2)) * P, y: cy - R * f(th) })
    }
    return out
  }
  // Labels sit on their curve's end: the x-height is centred on it.
  const labelAt = (text: string, end: Pt) => layoutText(text, waveEnd + em * 0.4, end.y + em * 0.35, em).strokes

  const cos = curve(Math.cos)
  b.stroke(cos, S.draw, S.hop)
  for (const st of labelAt(COS_LABEL, cos[cos.length - 1])) b.stroke(st, S.write, S.hop)

  /* 4 ── back across to the origin for sin θ, named above the axis where it
         ends. */
  const sin = curve(Math.sin)
  b.stroke(sin, S.draw, S.travel)
  const sinLabel = labelAt(SIN_LABEL, sin[sin.length - 1])
  for (const st of sinLabel) b.stroke(st, S.write, S.hop)

  /* 5 ── away through the top-right, leaving the last stroke along its own
         tangent and gathering speed */
  const lastStroke = sinLabel[sinLabel.length - 1]
  const last = lastStroke[lastStroke.length - 1]
  b.travel(
    cubic(
      last,
      { x: last.x + P * 0.45, y: last.y },
      { x: heroW * 0.9, y: tip - R * 1.1 },
      { x: heroW * 1.28 + 190, y: tip - R * 2.6 },
      58,
    ),
    1550 * pace,
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
