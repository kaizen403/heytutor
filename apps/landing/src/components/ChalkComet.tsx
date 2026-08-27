import { useEffect, useRef } from 'react'

const LOOP_MS = 8600
const ENTRY_END = 1200
const YAXIS_END = 2200
const HOP1_END = 2310
const XAXIS_END = 3300
const HOP2_END = 3410
const PARA_END = 5300
const EXIT_END = 6500
const HOLD_END = 7500
const FADE_END = 8150

const TIP_X = 0.105
const TIP_Y = 0.725
const TIP_DIR_DEG = 133.2
const DRAW_ROT = -68.2
const WOBBLE_AMP = 1.5
const PARA_EASE = 2.0
const EXIT_EASE = 2.6
const STREAK_MS = 90
const GRAVITY = 320
const SPRITE_ASPECT = 498 / 480
const STAMP_STEP = 2.2

type Pt = { x: number; y: number }
type Bezier = [Pt, Pt, Pt, Pt]
type PhaseName = 'entry' | 'yaxis' | 'hop1' | 'xaxis' | 'hop2' | 'para' | 'exit' | 'hold' | 'fade' | 'beat'
type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; r: number }
type StreakPt = { x: number; y: number; t: number }
type LineSeg = { kind: 'line'; a: Pt; b: Pt; len: number }
type QuadSeg = { kind: 'quad'; p0: Pt; c: Pt; p2: Pt; len: number; lut: { t: number; s: number }[] }
type Seg = LineSeg | QuadSeg
type Geom = {
  heroW: number
  heroH: number
  entry: Bezier
  exit: Bezier
  segs: Seg[]
  arrowTips: { at: Pt; dir: number }[]
  spriteW: number
  spriteH: number
  stampScale: number
  hidden: boolean
}
type Clock = { elapsed: number; last: number; raf: number | null; running: boolean; prev: PhaseName }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const easeIn = (t: number, k: number) => Math.pow(t, k)

const bez = (b: Bezier, t: number): Pt => {
  const u = 1 - t
  const a = u * u * u
  const c = 3 * u * u * t
  const d = 3 * u * t * t
  const e = t * t * t
  return {
    x: a * b[0].x + c * b[1].x + d * b[2].x + e * b[3].x,
    y: a * b[0].y + c * b[1].y + d * b[2].y + e * b[3].y,
  }
}

const bezTan = (b: Bezier, t: number): Pt => {
  const u = 1 - t
  return {
    x: 3 * u * u * (b[1].x - b[0].x) + 6 * u * t * (b[2].x - b[1].x) + 3 * t * t * (b[3].x - b[2].x),
    y: 3 * u * u * (b[1].y - b[0].y) + 6 * u * t * (b[2].y - b[1].y) + 3 * t * t * (b[3].y - b[2].y),
  }
}

const quad = (p0: Pt, c: Pt, p2: Pt, t: number): Pt => {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
  }
}

const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const phase = (el: number): { name: PhaseName; t: number } => {
  if (el < ENTRY_END) return { name: 'entry', t: el / ENTRY_END }
  if (el < YAXIS_END) return { name: 'yaxis', t: (el - ENTRY_END) / (YAXIS_END - ENTRY_END) }
  if (el < HOP1_END) return { name: 'hop1', t: (el - YAXIS_END) / (HOP1_END - YAXIS_END) }
  if (el < XAXIS_END) return { name: 'xaxis', t: (el - HOP1_END) / (XAXIS_END - HOP1_END) }
  if (el < HOP2_END) return { name: 'hop2', t: (el - XAXIS_END) / (HOP2_END - XAXIS_END) }
  if (el < PARA_END) return { name: 'para', t: (el - HOP2_END) / (PARA_END - HOP2_END) }
  if (el < EXIT_END) return { name: 'exit', t: (el - PARA_END) / (EXIT_END - PARA_END) }
  if (el < HOLD_END) return { name: 'hold', t: (el - EXIT_END) / (HOLD_END - EXIT_END) }
  if (el < FADE_END) return { name: 'fade', t: (el - HOLD_END) / (FADE_END - HOLD_END) }
  return { name: 'beat', t: (el - FADE_END) / (LOOP_MS - FADE_END) }
}

const makeLine = (a: Pt, b: Pt): LineSeg => ({ kind: 'line', a, b, len: Math.hypot(b.x - a.x, b.y - a.y) })

const makeQuad = (p0: Pt, c: Pt, p2: Pt): QuadSeg => {
  const lut: { t: number; s: number }[] = [{ t: 0, s: 0 }]
  let prev = p0
  let s = 0
  const N = 96
  for (let i = 1; i <= N; i++) {
    const t = i / N
    const p = quad(p0, c, p2, t)
    s += Math.hypot(p.x - prev.x, p.y - prev.y)
    lut.push({ t, s })
    prev = p
  }
  return { kind: 'quad', p0, c, p2, len: s, lut }
}

const segPoint = (seg: Seg, s: number): { pos: Pt; dir: number } => {
  if (seg.kind === 'line') {
    const t = clamp(s / seg.len, 0, 1)
    return {
      pos: { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t },
      dir: Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x),
    }
  }
  const lut = seg.lut
  let i = 1
  while (i < lut.length && lut[i].s < s) i++
  const hi = lut[Math.min(i, lut.length - 1)]
  const lo = lut[Math.max(0, i - 1)]
  const f = hi.s > lo.s ? clamp((s - lo.s) / (hi.s - lo.s), 0, 1) : 0
  const t = lo.t + (hi.t - lo.t) * f
  const pos = quad(seg.p0, seg.c, seg.p2, t)
  const tan = {
    x: 2 * (1 - t) * (seg.c.x - seg.p0.x) + 2 * t * (seg.p2.x - seg.c.x),
    y: 2 * (1 - t) * (seg.c.y - seg.p0.y) + 2 * t * (seg.p2.y - seg.c.y),
  }
  return { pos, dir: Math.atan2(tan.y, tan.x) }
}

const makeBrush = (seed: number, size: number): HTMLCanvasElement => {
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const ctx = cv.getContext('2d')
  if (!ctx) return cv
  const rand = mulberry32(seed)
  const grid: number[] = []
  for (let i = 0; i < 81; i++) grid.push(rand())
  const noise = (x: number, y: number) => {
    const gx = (x / size) * 8
    const gy = (y / size) * 8
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const fx = gx - x0
    const fy = gy - y0
    const at = (xx: number, yy: number) => grid[(yy % 9) * 9 + (xx % 9)]
    const a = at(x0, y0)
    const b = at(x0 + 1, y0)
    const c = at(x0, y0 + 1)
    const d = at(x0 + 1, y0 + 1)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
  }
  const img = ctx.createImageData(size, size)
  const half = size / 2
  const R = size * 0.4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - half
      const dy = y - half
      const d = Math.hypot(dx, dy) / R
      const o = (y * size + x) * 4
      if (d > 1.15) {
        img.data[o + 3] = 0
        continue
      }
      const e = noise(x, y)
      let a = 0
      if (d < 0.7 + 0.3 * e) {
        const core = Math.max(0, 1 - d)
        const grain = 0.5 * noise(x * 2.7 + 13, y * 2.7 + 7) + 0.5 * e
        a = clamp(core * (0.42 + 0.58 * grain) * 1.15, 0, 0.92)
        if (rand() < 0.05) a *= 0.3
      }
      img.data[o] = 252
      img.data[o + 1] = 251
      img.data[o + 2] = 247
      img.data[o + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

export default function ChalkComet({ className = '' }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!root || !canvas || !img) return
    const hero = root.parentElement
    if (!hero) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const geom: { current: Geom | null } = { current: null }
    const particles: Particle[] = []
    const streak: StreakPt[] = []
    const clock: Clock = { elapsed: 0, last: 0, raf: null, running: false, prev: 'beat' }
    const state = { started: false, visible: true, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches }
    const board = document.createElement('canvas')
    const bctx = board.getContext('2d')
    if (!bctx) return
    const brushes = [makeBrush(7, 64), makeBrush(23, 64), makeBrush(51, 64)]
    let brushIdx = 0
    let dpr = 1
    const drawn = { seg: -1, s: 0 }

    const stamp = (x: number, y: number, scale: number, alpha: number, rot: number) => {
      const g = geom.current
      if (!g) return
      const brush = brushes[brushIdx]
      brushIdx = (brushIdx + 1) % brushes.length
      const w = 64 * scale
      bctx.save()
      bctx.translate(x * dpr, y * dpr)
      bctx.rotate(rot)
      bctx.globalAlpha = alpha
      bctx.drawImage(brush, -w / 2, -w / 2, w, w)
      bctx.restore()
    }

    const stampRange = (seg: Seg, sFrom: number, sTo: number) => {
      const g = geom.current
      if (!g || sTo <= sFrom) return
      for (let s = sFrom; s < sTo; s += STAMP_STEP) {
        const { pos } = segPoint(seg, s)
        const jx = (Math.random() - 0.5) * 1.6
        const jy = (Math.random() - 0.5) * 1.6
        const sc = g.stampScale * (0.88 + Math.random() * 0.28)
        stamp(pos.x + jx + 0.7, pos.y + jy + 1.1, sc * 1.18, 0.1, Math.random() * Math.PI)
        stamp(pos.x + jx, pos.y + jy, sc, 0.62 + Math.random() * 0.28, Math.random() * Math.PI)
        if (Math.random() < 0.06) {
          stamp(pos.x + (Math.random() - 0.5) * 14, pos.y + (Math.random() - 0.5) * 14, sc * 0.4, 0.14, 0)
        }
      }
    }

    const stampArrow = (at: Pt, dir: number) => {
      const g = geom.current
      if (!g) return
      for (const sgn of [1, -1]) {
        const ang = dir + Math.PI + sgn * 0.42
        for (let d = 2; d < 15; d += STAMP_STEP) {
          stamp(at.x + Math.cos(ang) * d, at.y + Math.sin(ang) * d, g.stampScale * 0.92, 0.7, 0)
        }
      }
    }

    const clearBoard = () => {
      bctx.setTransform(1, 0, 0, 1, 0, 0)
      bctx.clearRect(0, 0, board.width, board.height)
      drawn.seg = -1
      drawn.s = 0
    }

    const measure = () => {
      const hr = hero.getBoundingClientRect()
      const heroW = hr.width
      const heroH = hr.height
      const lane = hero.querySelector('[data-comet-lane]')
      const lr = lane?.getBoundingClientRect()
      const laneTop = lr ? lr.top - hr.top : NaN
      const laneBottom = lr ? lr.bottom - hr.top : NaN
      const laneH = laneBottom - laneTop
      if (!lr || !(laneH >= 80) || heroW < 360) {
        geom.current = null
        root.style.display = 'none'
        return
      }
      root.style.display = ''
      const cx0 = heroW / 2
      const graphW = clamp(heroW * 0.52, 260, 720)
      const axisY = laneTop + laneH * 0.58
      const yTop = laneTop + laneH * 0.05
      const yBot = laneBottom - 2
      const xLeft = cx0 - graphW / 2
      const xRight = cx0 + graphW / 2
      const armW = graphW * 0.34
      const vertexY = laneBottom - laneH * 0.08
      const armTopY = laneTop + laneH * 0.03
      const paraP0 = { x: cx0 - armW, y: armTopY }
      const paraC = { x: cx0, y: 2 * vertexY - armTopY }
      const paraP2 = { x: cx0 + armW, y: armTopY }
      const segs: Seg[] = [
        makeLine({ x: cx0, y: yTop }, { x: cx0, y: yBot }),
        makeLine({ x: xLeft, y: axisY }, { x: xRight, y: axisY }),
        makeQuad(paraP0, paraC, paraP2),
      ]
      const arrowTips = [
        { at: { x: cx0, y: yTop }, dir: -Math.PI / 2 },
        { at: { x: xRight, y: axisY }, dir: 0 },
      ]
      const entry: Bezier = [
        { x: heroW + 160, y: -140 },
        { x: heroW * 0.78, y: 30 },
        { x: heroW * 0.24, y: 240 },
        { x: cx0, y: yTop },
      ]
      const exit: Bezier = [
        { x: cx0 + armW, y: armTopY },
        { x: cx0 + armW + 110, y: armTopY - 70 },
        { x: heroW * 0.88, y: 10 },
        { x: heroW + 240, y: -220 },
      ]
      const spriteW = clamp(heroW * 0.075, 56, 130)
      const spriteH = spriteW * SPRITE_ASPECT
      img.style.width = `${spriteW}px`
      img.style.height = `${spriteH}px`
      dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(heroW * dpr)
      canvas.height = Math.round(heroH * dpr)
      board.width = canvas.width
      board.height = canvas.height
      geom.current = {
        heroW,
        heroH,
        entry,
        exit,
        segs,
        arrowTips,
        spriteW,
        spriteH: spriteW * SPRITE_ASPECT,
        stampScale: clamp(heroW / 1440, 0.62, 1.05) * 0.21,
        hidden: false,
      }
      clearBoard()
    }

    const poseTip = (p: Pt, rot: number, squash: number) => {
      const g = geom.current
      if (!g) return
      img.style.transformOrigin = `${TIP_X * 100}% ${TIP_Y * 100}%`
      img.style.left = `${p.x - TIP_X * g.spriteW}px`
      img.style.top = `${p.y - TIP_Y * g.spriteH}px`
      img.style.transform = `rotate(${rot}deg) scale(${2 - squash}, ${squash})`
      img.style.opacity = '1'
      root.dataset.cmTip = `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    }

    const spawnBurst = (p: Pt, n: number, spread: number) => {
      for (let i = 0; i < n; i++) {
        const ang = Math.PI * (0.12 + 0.76 * Math.random())
        const spd = spread * (0.4 + Math.random())
        particles.push({
          x: p.x,
          y: p.y,
          vx: Math.cos(ang) * spd,
          vy: -Math.abs(Math.sin(ang)) * spd,
          life: 0,
          maxLife: 320 + 260 * Math.random(),
          r: 1.1 + 1.6 * Math.random(),
        })
      }
    }

    const spawnSprinkle = (p: Pt) => {
      particles.push({
        x: p.x,
        y: p.y,
        vx: (Math.random() - 0.5) * 70,
        vy: -(8 + Math.random() * 55),
        life: 0,
        maxLife: 250 + 200 * Math.random(),
        r: 0.8 + 1.0 * Math.random(),
      })
    }

    const drawFx = (dt: number) => {
      const g = geom.current
      if (!g) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, g.heroW, g.heroH)
      const ph = phase(clock.elapsed)
      const boardAlpha = ph.name === 'fade' ? 1 - easeIn(ph.t, 1.5) : ph.name === 'beat' || ph.name === 'entry' ? 0 : 1
      if (boardAlpha > 0) {
        ctx.globalAlpha = boardAlpha
        ctx.drawImage(board, 0, 0, g.heroW, g.heroH)
        ctx.globalAlpha = 1
      }
      if (streak.length > 1) {
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        for (let i = 1; i < streak.length; i++) {
          const pr = i / (streak.length - 1)
          ctx.strokeStyle = `rgba(255,255,255,${(0.38 * Math.pow(pr, 1.2)).toFixed(3)})`
          ctx.lineWidth = 15 * Math.pow(pr, 1.4)
          ctx.beginPath()
          ctx.moveTo(streak[i - 1].x, streak[i - 1].y)
          ctx.lineTo(streak[i].x, streak[i].y)
          ctx.stroke()
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life += dt
        if (p.life >= p.maxLife) {
          particles.splice(i, 1)
          continue
        }
        p.vy += (GRAVITY * dt) / 1000
        p.vx *= Math.exp((-2.5 * dt) / 1000)
        p.x += (p.vx * dt) / 1000
        p.y += (p.vy * dt) / 1000
        const a = 1 - p.life / p.maxLife
        ctx.fillStyle = `rgba(255,255,255,${(0.85 * a).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * (0.6 + 0.4 * a), 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const drawTo = (segIdx: number, s: number) => {
      const g = geom.current
      if (!g) return
      if (drawn.seg > segIdx) return
      if (drawn.seg < segIdx) {
        for (let i = drawn.seg + 1; i < segIdx; i++) {
          stampRange(g.segs[i], 0, g.segs[i].len)
          if (g.arrowTips[i]) stampArrow(g.arrowTips[i].at, g.arrowTips[i].dir)
        }
        drawn.seg = segIdx
        drawn.s = 0
      }
      stampRange(g.segs[segIdx], drawn.s, s)
      drawn.s = s
    }

    const frame = (now: number) => {
      if (!clock.running) return
      const dt = Math.min(50, now - clock.last)
      clock.last = now
      clock.elapsed += dt
      if (clock.elapsed >= LOOP_MS) {
        clock.elapsed -= LOOP_MS
        clearBoard()
      }
      const g = geom.current
      if (!g) {
        clock.raf = null
        return
      }
      const ph = phase(clock.elapsed)
      let tip: Pt | null = null
      let rot = 0
      let squash = 1
      let streakOn = false
      if (ph.name === 'entry') {
        const p = easeIn(ph.t, 2.3)
        const pos = bez(g.entry, p)
        const tan = bezTan(g.entry, p)
        const phi = (Math.atan2(tan.y, tan.x) * 180) / Math.PI
        tip = pos
        rot = phi - TIP_DIR_DEG + 45 * Math.sin(p * Math.PI)
        streakOn = true
      } else if (ph.name === 'yaxis' || ph.name === 'xaxis' || ph.name === 'para') {
        const idx = ph.name === 'yaxis' ? 0 : ph.name === 'xaxis' ? 1 : 2
        const seg = g.segs[idx]
        const eased = ph.name === 'para' ? easeIn(ph.t, PARA_EASE) : ph.t
        const s = seg.len * eased
        const { pos } = segPoint(seg, s)
        tip = pos
        rot = DRAW_ROT + Math.sin(clock.elapsed / 110) * WOBBLE_AMP
        squash = 0.985
        drawTo(idx, s)
        if (Math.random() < dt / 80) spawnSprinkle(pos)
      } else if (ph.name === 'hop1' || ph.name === 'hop2') {
        const fromIdx = ph.name === 'hop1' ? 0 : 1
        const toIdx = fromIdx + 1
        const a = segPoint(g.segs[fromIdx], g.segs[fromIdx].len).pos
        const b = segPoint(g.segs[toIdx], 0).pos
        const up = Math.sin(ph.t * Math.PI) * 26
        tip = { x: a.x + (b.x - a.x) * ph.t, y: a.y + (b.y - a.y) * ph.t - up }
        rot = DRAW_ROT + Math.sin(clock.elapsed / 110) * WOBBLE_AMP
        if (drawn.seg < fromIdx) drawTo(fromIdx, g.segs[fromIdx].len)
      } else if (ph.name === 'exit') {
        const p = easeIn(ph.t, EXIT_EASE)
        const pos = bez(g.exit, p)
        const tan = bezTan(g.exit, p)
        const phi = (Math.atan2(tan.y, tan.x) * 180) / Math.PI
        tip = pos
        rot = phi - TIP_DIR_DEG + 540 * p
        streakOn = true
      }
      if (tip) {
        poseTip(tip, rot, squash)
        if (streakOn) {
          streak.push({ x: tip.x, y: tip.y, t: clock.elapsed })
          while (streak.length > 1 && clock.elapsed - streak[0].t > STREAK_MS) streak.shift()
        } else {
          streak.length = 0
        }
      } else {
        img.style.opacity = '0'
        streak.length = 0
        delete root.dataset.cmTip
      }
      if (ph.name === 'yaxis' && clock.prev === 'entry') {
        const start = segPoint(g.segs[0], 0).pos
        spawnBurst(start, 14, 130)
      }
      if (ph.name === 'exit' && clock.prev !== 'exit') {
        spawnBurst(bez(g.exit, 0), 8, 80)
      }
      if (ph.name === 'hold' && clock.prev !== 'hold') {
        drawTo(2, g.segs[2].len)
      }
      clock.prev = ph.name
      drawFx(dt)
      clock.raf = null
      if (clock.running) clock.raf = requestAnimationFrame(frame)
    }

    const renderStatic = () => {
      measure()
      const g = geom.current
      if (!g) return
      clearBoard()
      for (let i = 0; i < g.segs.length; i++) stampRange(g.segs[i], 0, g.segs[i].len)
      for (const at of g.arrowTips) stampArrow(at.at, at.dir)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, g.heroW, g.heroH)
      ctx.drawImage(board, 0, 0, g.heroW, g.heroH)
      const end = segPoint(g.segs[2], g.segs[2].len).pos
      poseTip(end, DRAW_ROT, 1)
    }

    const setRunning = (run: boolean) => {
      clock.running = run
      if (run) {
        clock.last = performance.now()
        if (!clock.raf) clock.raf = requestAnimationFrame(frame)
      } else if (clock.raf) {
        cancelAnimationFrame(clock.raf)
        clock.raf = null
      }
    }

    const sync = () =>
      setRunning(!state.reduced && state.started && state.visible && document.visibilityState === 'visible' && !!geom.current)

    const onVis = () => sync()
    document.addEventListener('visibilitychange', onVis)

    const io = new IntersectionObserver((entries) => {
      state.visible = entries[0]?.isIntersecting ?? false
      sync()
    })
    io.observe(root)

    const ro = new ResizeObserver(() => {
      measure()
      if (state.reduced) renderStatic()
    })
    ro.observe(hero)

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMq = (e: MediaQueryListEvent) => {
      state.reduced = e.matches
      if (e.matches) {
        setRunning(false)
        renderStatic()
      } else {
        state.started = true
        measure()
        sync()
      }
    }
    mq.addEventListener('change', onMq)

    measure()
    const fontsReady = document.fonts?.ready
    if (fontsReady) {
      fontsReady.then(() => {
        measure()
        if (state.reduced) renderStatic()
      })
    }
    const startTimer = window.setTimeout(() => {
      state.started = true
      measure()
      if (state.reduced) renderStatic()
      sync()
    }, 1500)
    const settleTimer = window.setTimeout(() => {
      measure()
      if (state.reduced) renderStatic()
      sync()
    }, 2600)

    return () => {
      window.clearTimeout(startTimer)
      window.clearTimeout(settleTimer)
      document.removeEventListener('visibilitychange', onVis)
      io.disconnect()
      ro.disconnect()
      mq.removeEventListener('change', onMq)
      setRunning(false)
    }
  }, [])

  return (
    <div ref={rootRef} className={className} aria-hidden="true">
      <canvas ref={canvasRef} className="cm-canvas" />
      <img ref={imgRef} className="cm-sprite" src="/chalk/chalk.png" alt="" draggable={false} style={{ opacity: 0 }} />
    </div>
  )
}
