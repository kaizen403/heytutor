/**
 * Hero lesson script — a self-playing kinematics mini-lesson for the landing hero.
 *
 * The `speech` strings are the EXACT text sent to ElevenLabs by
 * apps/landing/scripts/generate-hero-voice.mjs. If you change them, re-run that
 * script to regenerate public/hero/lesson.mp3 + lesson-timings.json. When the
 * timings file is absent the simulation runs on the estimated durations below —
 * same rule as the live tutor: estimated schedules first, never block on TTS.
 *
 * Board ink is rendered by the real @heytutor/whiteboard renderer, driven by
 * heroLessonPlayer.ts; this file only owns the spoken script, the timing model,
 * and the surrounding chrome state (input typing, header chip, bubble).
 */

export const QUESTION_TEXT =
  'A car starts from rest and accelerates at 2 m/s² for 5 s. Find the final velocity.'

export const LESSON_TITLE = 'Final velocity of a car'

export interface LessonSegment {
  /** Exact spoken sentence (drives TTS + timing offsets). Keep in sync with the generator script. */
  speech: string
  /** Caption shown in the narration bubble while this segment plays. */
  bubble: string
  /** Estimated duration (seconds) used when no TTS timings are available. */
  fallbackDuration: number
}

export const SEGMENTS: LessonSegment[] = [
  {
    speech: "Let's find the final velocity of this car.",
    bubble: "let's find the final velocity of this car",
    fallbackDuration: 3.2,
  },
  {
    speech: 'It starts from rest, accelerates at two metres per second squared, for five seconds.',
    bubble: 'starts from rest · a = 2 m/s² · t = 5 s',
    fallbackDuration: 6.0,
  },
  {
    speech: 'We use the first equation of motion: v equals u plus a t.',
    bubble: 'first equation of motion: v = u + at',
    fallbackDuration: 5.2,
  },
  {
    speech: "On a velocity time graph, that's a straight line rising from the origin.",
    bubble: 'on a v–t graph, velocity rises in a straight line',
    fallbackDuration: 5.8,
  },
  {
    speech: 'Substituting the values: v equals zero, plus two times five.',
    bubble: 'substitute: v = 0 + 2 × 5',
    fallbackDuration: 4.8,
  },
  {
    speech: 'So the final velocity is ten metres per second.',
    bubble: 'final velocity = 10 m/s',
    fallbackDuration: 4.0,
  },
]

/* ── Timing model ─────────────────────────────────────────────────────────── */

export interface LessonTiming {
  /** Absolute start of each segment, seconds from lesson audio start. */
  starts: number[]
  /** Total spoken duration, seconds. */
  total: number
}

export function fallbackTiming(): LessonTiming {
  const starts: number[] = []
  let t = 0
  for (const seg of SEGMENTS) {
    starts.push(t)
    t += seg.fallbackDuration
  }
  return { starts, total: t }
}

export const TYPING_CHARS_PER_SECOND = 38
export const TYPING_DURATION = QUESTION_TEXT.length / TYPING_CHARS_PER_SECOND
export const SUBMIT_PAUSE = 0.55
export const HOLD_DURATION = 3.0
export const CLEAR_DURATION = 1.2

/** The whole lesson (voice included) plays at this multiple of real time. */
export const PLAYBACK_SPEED = 1.25

/** Convert raw TTS seconds into wall-clock seconds at playback speed. */
export function toPlaybackTiming(raw: LessonTiming): LessonTiming {
  return {
    starts: raw.starts.map((s) => s / PLAYBACK_SPEED),
    total: raw.total / PLAYBACK_SPEED,
  }
}

export function teachStart(): number {
  return TYPING_DURATION + SUBMIT_PAUSE
}

export function loopDuration(timing: LessonTiming): number {
  return teachStart() + timing.total + HOLD_DURATION + CLEAR_DURATION
}

/* ── Pure state derivation: chrome state is a function of time ───────────── */

export type SimPhase = 'typing' | 'submit' | 'teaching' | 'hold' | 'clearing'

export interface LessonSnapshot {
  phase: SimPhase
  /** Characters of the question currently visible in the input. */
  typedCount: number
  /** Narration bubble text ('' hides the bubble). */
  bubble: string
  chip: 'thinking' | 'teaching'
  /** Pause/cancel teaching controls visible in the input bar. */
  teaching: boolean
}

export function deriveSnapshot(timeSeconds: number, timing: LessonTiming): LessonSnapshot {
  const loop = loopDuration(timing)
  const t = ((timeSeconds % loop) + loop) % loop
  const teach = teachStart()

  if (t < TYPING_DURATION) {
    return {
      phase: 'typing',
      typedCount: Math.min(QUESTION_TEXT.length, Math.floor(t * TYPING_CHARS_PER_SECOND)),
      bubble: '',
      chip: 'thinking',
      teaching: false,
    }
  }

  if (t < teach) {
    const st = t - TYPING_DURATION
    return {
      phase: 'submit',
      typedCount: st < 0.35 ? QUESTION_TEXT.length : 0,
      bubble: '',
      chip: 'thinking',
      teaching: false,
    }
  }

  const lt = t - teach

  if (lt < timing.total) {
    let seg = 0
    for (let i = 0; i < SEGMENTS.length; i++) if (timing.starts[i] <= lt) seg = i
    return {
      phase: 'teaching',
      typedCount: 0,
      bubble: SEGMENTS[seg].bubble,
      chip: 'teaching',
      teaching: true,
    }
  }

  if (lt < timing.total + HOLD_DURATION) {
    return {
      phase: 'hold',
      typedCount: 0,
      bubble: SEGMENTS[SEGMENTS.length - 1].bubble,
      chip: 'teaching',
      teaching: true,
    }
  }

  return { phase: 'clearing', typedCount: 0, bubble: '', chip: 'thinking', teaching: false }
}

/** Static snapshot for prefers-reduced-motion: the finished lesson. */
export function completedSnapshot(): LessonSnapshot {
  const timing = toPlaybackTiming(fallbackTiming())
  return deriveSnapshot(teachStart() + timing.total + 0.5, timing)
}
