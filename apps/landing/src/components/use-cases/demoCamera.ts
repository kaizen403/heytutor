import type { BeatId } from './demoTimeline'

export const LAPTOP = { width: 1440, height: 900 }
interface Shot {
  at: number
  scale: number
  x: number
  y: number
}
const full = (at: number): Shot => ({ at, scale: 1, x: 720, y: 450 })
const composer = (at: number): Shot => ({ at, scale: 1.6, x: 915, y: 800 })
const markedStep = (at: number): Shot => ({ at, scale: 1.8, x: 490, y: 535 })
const answer = (at: number): Shot => ({ at, scale: 1.5, x: 660, y: 555 })
const toolbar = (at: number): Shot => ({ at, scale: 1.7, x: 1200, y: 120 })

const SHOTS: Record<BeatId, Shot[]> = {
  doubt: [
    full(0),
    full(0.8),
    composer(2.4),
    composer(6.3),
    markedStep(7.8),
    markedStep(10.2),
    composer(12.1),
    composer(13.2),
    answer(15.1),
    answer(18.5),
    full(20.7),
    full(24),
  ],
  ask: [full(0), composer(1), composer(3.4), full(4.8), full(11)],
  annotate: [
    full(0),
    { at: 2, scale: 1.35, x: 670, y: 350 },
    { at: 7.7, scale: 1.35, x: 670, y: 460 },
    full(9.5),
  ],
  replay: [
    full(0),
    toolbar(1.4),
    full(2.6),
    { at: 4, scale: 1.35, x: 850, y: 630 },
    full(9.4),
  ],
  notes: [full(0), toolbar(1.4), toolbar(6.8), full(8.5)],
}

function transform(shot: Shot) {
  // Keep every shot inside the same laptop screen, with no empty edges.
  return {
    scale: shot.scale,
    x: Math.max(
      LAPTOP.width * (1 - shot.scale),
      Math.min(0, LAPTOP.width / 2 - shot.x * shot.scale),
    ),
    y: Math.max(
      LAPTOP.height * (1 - shot.scale),
      Math.min(0, LAPTOP.height / 2 - shot.y * shot.scale),
    ),
  }
}

/** Zero velocity and acceleration at each end of a camera or cursor move. */
export function smoothGlide(t: number) {
  const p = Math.max(0, Math.min(1, t))
  return p * p * p * (p * (p * 6 - 15) + 10)
}

/** Camera movement changes framing; the production UI never reflows. */
export function demoCamera(beat: BeatId, seconds: number) {
  const shots = SHOTS[beat]
  const next = shots.findIndex((shot) => shot.at > seconds)
  if (next < 0) return transform(shots[shots.length - 1]!)
  if (next === 0) return transform(shots[0]!)
  const from = shots[next - 1]!
  const to = shots[next]!
  const fraction = (seconds - from.at) / (to.at - from.at)
  const ease = smoothGlide(fraction)
  const a = transform(from)
  const b = transform(to)
  return {
    scale: a.scale + (b.scale - a.scale) * ease,
    x: a.x + (b.x - a.x) * ease,
    y: a.y + (b.y - a.y) * ease,
  }
}
