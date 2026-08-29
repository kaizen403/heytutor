import { useEffect, useRef } from 'react'
import { renderPenSprite, type PenSprite } from './penSprite'
import { buildScene, sampleAt, type Scene } from './scene'

/* ═══════════════════════════════════════════════════════════════════════════
   PenPlotter — a pen draws the axes, labels, v = u + at, and the acceleration
   curve, then leaves frame.

   Three things keep it smooth:
   · One continuous path with a smoothed velocity field (see scene.ts), so the
     pen never stops, jumps, or teleports between strokes.
   · Pen angle and lift are CRITICALLY DAMPED SPRINGS chasing a target rather
     than being set directly. A spring's output is continuous no matter what
     the target does, so a sudden rotation is impossible by construction.
   · Motion blur is real accumulation blur: the scene is re-sampled at several
     sub-frame times and the sprite is composited at each.
   ═══════════════════════════════════════════════════════════════════════════ */

const HOLD_S = 1.35
const FADE_S = 0.8
const BEAT_S = 0.5

const BASE_TILT = 31 // deg the pen leans while writing
const ANG_OMEGA = 15 // rad/s, angle spring
const LIFT_OMEGA = 13 // rad/s, pen-up spring
const MAX_BLUR_SAMPLES = 9
/* Only genuine flight tilts the pen. A short hop between glyph strokes can
   still touch ~600px/s, and letting that tip the barrel toward the hop's
   direction injected a sharp, short-lived rotation mid-word. */
const FLIGHT_MIN = 820
const FLIGHT_SPAN = 680
const FLIGHT_LERP = 6 // per second — smooths the blend itself, not just its result

// Ink, not chalk: a thin ice-blue line that sits IN the navy rather than
// glaring off it, with a faint sky bloom instead of a halo.
const INK_CORE = 'rgba(212,235,247,0.78)'
const INK_GLOW = 'rgba(89,175,212,0.09)'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const smoothstep = (t: number) => t * t * (3 - 2 * t)
/** Shortest signed distance between two angles, in degrees. */
const angDelta = (to: number, from: number) => ((((to - from) % 360) + 540) % 360) - 180

export default function PenPlotter({ className = '' }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLCanvasElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const boardCv = boardRef.current
    const fxCv = fxRef.current
    if (!root || !boardCv || !fxCv) return
    const hero = root.parentElement
    if (!hero) return
    const bctx = boardCv.getContext('2d')
    const fctx = fxCv.getContext('2d', { desynchronized: true })
    if (!bctx || !fctx) return

    let scene: Scene | null = null
    let sprite: PenSprite | null = null
    let dpr = 1
    let heroW = 0
    let heroH = 0
    let inkWidth = 2.5

    // playhead + spring state
    let elapsed = 0
    let last = 0
    let raf = 0
    let running = false
    let drawnTo = 0
    let hint = 1
    let angle = BASE_TILT
    let angVel = 0
    let lift = 1
    let liftVel = 0
    let flightBlend = 1
    let primed = false

    const dirty = { x0: 0, y0: 0, x1: 0, y1: 0, has: false }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const clearBoard = () => {
      bctx.setTransform(1, 0, 0, 1, 0, 0)
      bctx.clearRect(0, 0, boardCv.width, boardCv.height)
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawnTo = 0
    }

    /** Lay ink for every inked segment between `from` and `to`. */
    const inkTo = (to: number) => {
      const sc = scene
      if (!sc || to <= drawnTo) return
      bctx.lineCap = 'round'
      bctx.lineJoin = 'round'
      for (let i = drawnTo + 1; i <= to; i++) {
        if (!sc.ink[i]) continue
        const x0 = sc.x[i - 1]
        const y0 = sc.y[i - 1]
        const x1 = sc.x[i]
        const y1 = sc.y[i]
        // A real pen thins as it accelerates.
        // A real nib lays down less ink the faster it travels.
        const w = inkWidth * (1 - 0.4 * clamp(sc.speed[i] / 620, 0, 1))
        bctx.strokeStyle = INK_GLOW
        bctx.lineWidth = w * 2.8
        bctx.beginPath()
        bctx.moveTo(x0, y0)
        bctx.lineTo(x1, y1)
        bctx.stroke()
        bctx.strokeStyle = INK_CORE
        bctx.lineWidth = w
        bctx.beginPath()
        bctx.moveTo(x0, y0)
        bctx.lineTo(x1, y1)
        bctx.stroke()
      }
      drawnTo = to
    }

    const note = (bx0: number, by0: number, bx1: number, by1: number) => {
      if (!dirty.has) {
        dirty.x0 = bx0
        dirty.y0 = by0
        dirty.x1 = bx1
        dirty.y1 = by1
        dirty.has = true
        return
      }
      if (bx0 < dirty.x0) dirty.x0 = bx0
      if (by0 < dirty.y0) dirty.y0 = by0
      if (bx1 > dirty.x1) dirty.x1 = bx1
      if (by1 > dirty.y1) dirty.y1 = by1
    }

    /** Composite the pen, with accumulation motion blur when it is moving fast. */
    const drawPen = (t: number, speed: number, alphaScale: number) => {
      const sc = scene
      const sp = sprite
      if (!sc || !sp) return
      const blur = clamp((speed - 240) / 1500, 0, 1)
      const samples = blur > 0.02 ? 2 + Math.round(blur * (MAX_BLUR_SAMPLES - 2)) : 1
      const shutter = 0.017 * blur
      const reach = Math.hypot(sp.width, sp.height) + 6
      const rad = (angle * Math.PI) / 180
      const scale = 1 + 0.09 * lift

      for (let k = 0; k < samples; k++) {
        const back = samples === 1 ? 0 : (k / (samples - 1)) * shutter
        const s = sampleAt(sc, t - back, hint)
        // Older samples are fainter, which reads as a trail rather than a smear.
        const a = (alphaScale / samples) * (1 - 0.45 * (samples === 1 ? 0 : k / (samples - 1)))
        fctx.save()
        fctx.globalAlpha = a
        fctx.translate(s.x, s.y)
        fctx.rotate(rad)
        fctx.scale(scale, scale)
        fctx.drawImage(sp.canvas, -sp.tipX, -sp.tipY, sp.width, sp.height)
        fctx.restore()
        note(s.x - reach, s.y - reach, s.x + reach, s.y + reach)
      }

      // Contact shadow, only while the nib is near the surface.
      const contact = 1 - clamp(lift, 0, 1)
      if (contact > 0.02) {
        const s = sampleAt(sc, t, hint)
        const rx = inkWidth * 3.2
        fctx.save()
        fctx.globalAlpha = 0.3 * contact * alphaScale
        fctx.fillStyle = '#04101a'
        fctx.beginPath()
        fctx.ellipse(s.x + rx * 0.5, s.y + rx * 0.42, rx, rx * 0.5, 0, 0, Math.PI * 2)
        fctx.fill()
        fctx.restore()
        note(s.x - rx * 3, s.y - rx * 3, s.x + rx * 3, s.y + rx * 3)
      }
    }

    const measure = () => {
      const hr = hero.getBoundingClientRect()
      const stage = hero.querySelector('[data-pen-stage]')
      const sr = stage?.getBoundingClientRect()
      heroW = hr.width
      heroH = hr.height
      const next = sr
        ? buildScene({
            heroW,
            heroH,
            laneTop: sr.top - hr.top,
            laneBottom: sr.bottom - hr.top,
          })
        : null
      if (!next) {
        scene = null
        root.style.display = 'none'
        return
      }
      root.style.display = ''
      scene = next

      const raw = Math.min(2, window.devicePixelRatio || 1)
      dpr = heroW * heroH * raw * raw > 3_200_000 ? Math.min(raw, 1.5) : raw
      for (const cv of [boardCv, fxCv]) {
        cv.width = Math.round(heroW * dpr)
        cv.height = Math.round(heroH * dpr)
      }
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      inkWidth = clamp(heroW / 1440, 0.72, 1.15) * 1.62
      sprite = renderPenSprite(clamp(heroW * 0.055, 52, 92), dpr)
      dirty.has = false
      elapsed = 0
      hint = 1
      primed = false
      clearBoard()
      boardCv.style.opacity = '1'
    }

    /** prefers-reduced-motion: the finished drawing, no animation. */
    const renderStatic = () => {
      const sc = scene
      if (!sc) return
      clearBoard()
      inkTo(sc.n - 1)
      boardCv.style.opacity = '1'
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      fctx.clearRect(0, 0, heroW, heroH)
      dirty.has = false
    }

    const frame = (now: number) => {
      if (!running) return
      raf = requestAnimationFrame(frame)
      const sc = scene
      if (!sc) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      elapsed += dt

      const loop = sc.duration + HOLD_S + FADE_S + BEAT_S
      if (elapsed >= loop) {
        elapsed -= loop
        clearBoard()
        hint = 1
        primed = false
        boardCv.style.opacity = '1'
      }

      fctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (dirty.has) {
        fctx.clearRect(dirty.x0, dirty.y0, dirty.x1 - dirty.x0, dirty.y1 - dirty.y0)
        dirty.has = false
      }

      const performing = elapsed <= sc.duration
      const t = Math.min(elapsed, sc.duration)
      const s = sampleAt(sc, t, hint)
      hint = s.index

      // ── targets ──────────────────────────────────────────────────────────
      const inking = performing && sc.ink[s.index] === 1
      const flightTarget = smoothstep(clamp((s.speed - FLIGHT_MIN) / FLIGHT_SPAN, 0, 1))
      flightBlend += (flightTarget - flightBlend) * Math.min(1, dt * FLIGHT_LERP)
      const flight = flightBlend
      // Body trails the direction of travel; sprite points tip-down at angle 0.
      const flyAngle = (Math.atan2(s.dy, s.dx) * 180) / Math.PI + 270
      const sway = Math.sin(t * 1.9) * 2.4 + Math.sin(t * 0.7) * 1.6
      const writeAngle = BASE_TILT + sway
      const targetAngle = writeAngle + angDelta(flyAngle, writeAngle) * flight
      const targetLift = inking ? 0 : 1

      if (!primed) {
        // Start already settled so the first frame is not a spring snap.
        angle = targetAngle
        angVel = 0
        lift = targetLift
        liftVel = 0
        flightBlend = flightTarget
        primed = true
      }

      // Critically damped springs — position is C1 whatever the target does.
      const da = angDelta(targetAngle, angle)
      angVel += (ANG_OMEGA * ANG_OMEGA * da - 2 * ANG_OMEGA * angVel) * dt
      angle += angVel * dt
      const dl = targetLift - lift
      liftVel += (LIFT_OMEGA * LIFT_OMEGA * dl - 2 * LIFT_OMEGA * liftVel) * dt
      lift += liftVel * dt

      if (performing) inkTo(s.index)
      else inkTo(sc.n - 1)

      // Board dissolves on its own layer — a compositor property, no repaint.
      const afterEnd = elapsed - sc.duration
      boardCv.style.opacity =
        afterEnd <= HOLD_S
          ? '1'
          : afterEnd <= HOLD_S + FADE_S
            ? String(1 - (afterEnd - HOLD_S) / FADE_S)
            : '0'

      // No tail fade: the exit path carries the pen fully out of frame, so
      // fading it would read as dissolving in mid-air instead of leaving.
      if (performing) drawPen(t, s.speed, 1)
    }

    const setRunning = (run: boolean) => {
      running = run
      if (run) {
        last = performance.now()
        if (!raf) raf = requestAnimationFrame(frame)
      } else if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    let visible = true
    const sync = () =>
      setRunning(!reduced && visible && document.visibilityState === 'visible' && !!scene)

    const onVis = () => sync()
    document.addEventListener('visibilitychange', onVis)

    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting
      sync()
    })
    io.observe(root)

    let roRaf = 0
    const ro = new ResizeObserver(() => {
      if (roRaf) return
      roRaf = requestAnimationFrame(() => {
        roRaf = 0
        measure()
        if (reduced) renderStatic()
        sync()
      })
    })
    ro.observe(hero)

    measure()
    if (reduced) renderStatic()
    const settle = window.setTimeout(() => {
      measure()
      if (reduced) renderStatic()
      sync()
    }, 900)
    sync()

    return () => {
      window.clearTimeout(settle)
      if (roRaf) cancelAnimationFrame(roRaf)
      document.removeEventListener('visibilitychange', onVis)
      io.disconnect()
      ro.disconnect()
      setRunning(false)
    }
  }, [])

  return (
    <div ref={rootRef} className={className} aria-hidden="true">
      <canvas ref={boardRef} className="cm-canvas" />
      <canvas ref={fxRef} className="cm-canvas" />
    </div>
  )
}
