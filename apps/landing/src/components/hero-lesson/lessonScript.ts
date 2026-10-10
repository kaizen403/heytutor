/** Captured square-pyramid lesson and its recorded media clock.
 * Geometry comes from the verified scene; speech uses the current tutor provider.
 * The offline recorder executes the current whiteboard and ink conductor.
 */
import asset from './lessonAsset.json' with { type: 'json' }
import narration from './lessonNarration.json' with { type: 'json' }
import type { TutorSegment, VerifiedDiagram } from '@heytutor/drawing'
import type { AudioTimings } from '@heytutor/tutor-core'
import type { HeroLessonLocale } from './heroLessonLocale'

export const QUESTION_TEXT = asset.question
export const LESSON_TITLE = asset.title
export const VERIFIED_DIAGRAM = asset.diagram as unknown as VerifiedDiagram
type HeroSegment = TutorSegment & {
  verifiedDiagramIntro: boolean
  timings?: AudioTimings
}
const BASE_SEGMENTS = asset.segments as unknown as HeroSegment[]

function localizeSegments(locale: HeroLessonLocale): HeroSegment[] {
  return BASE_SEGMENTS.map((segment, index) => ({
    ...segment,
    narration: narration[locale][index] ?? segment.narration,
    timings: undefined,
  }))
}

const HERO_SEGMENTS_BY_LOCALE: Record<HeroLessonLocale, HeroSegment[]> = {
  'en-GB': localizeSegments('en-GB'),
  'hi-IN': localizeSegments('hi-IN'),
}

export function heroSegments(locale: HeroLessonLocale): HeroSegment[] {
  return HERO_SEGMENTS_BY_LOCALE[locale]
}

export const HERO_SEGMENTS = heroSegments('en-GB')

function summarizeSegments(locale: HeroLessonLocale) {
  return heroSegments(locale).map((segment) => ({
    speech: segment.narration,
    bubble: '',
    fallbackDuration:
      segment.timings?.totalDuration ?? Math.max(2, segment.narration.length * 0.065),
  }))
}

const LESSON_SEGMENTS_BY_LOCALE = {
  'en-GB': summarizeSegments('en-GB'),
  'hi-IN': summarizeSegments('hi-IN'),
} satisfies Record<HeroLessonLocale, ReturnType<typeof summarizeSegments>>

export function lessonSegments(locale: HeroLessonLocale) {
  return LESSON_SEGMENTS_BY_LOCALE[locale]
}

export const SEGMENTS = lessonSegments('en-GB')

/* ── Timing model ─────────────────────────────────────────────────────────── */

export interface LessonTiming {
  /** Absolute start of each segment, seconds from lesson audio start. */
  starts: number[]
  /** Total spoken duration, seconds. */
  total: number
  /** Per-sentence provider alignment; Hinglish carries duration only. */
  segments?: AudioTimings[]
}

export function fallbackTiming(locale: HeroLessonLocale = 'en-GB'): LessonTiming {
  const starts: number[] = []
  let t = 0
  for (const seg of lessonSegments(locale)) {
    starts.push(t)
    t += seg.fallbackDuration
  }
  return { starts, total: t }
}

const TYPING_CHARS_PER_SECOND = 38
const TYPING_DURATION = QUESTION_TEXT.length / TYPING_CHARS_PER_SECOND
const SUBMIT_PAUSE = 5.6
export const HOLD_DURATION = 6.0
export const CLEAR_DURATION = 1.2

/**
 * The hero lesson plays at the tutor's natural pace. Keep this at 1 — HTML
 * `playbackRate` above 1 shifts pitch (chipmunk) even when the ink stays in
 * sync. Compress the loop by regenerating TTS at a higher `speed` dial, never
 * by stretching the MP3.
 */
export const PLAYBACK_SPEED = 1

/** Convert raw TTS seconds into wall-clock seconds at playback speed. */
export function toPlaybackTiming(raw: LessonTiming): LessonTiming {
  return {
    starts: raw.starts.map((s) => s / PLAYBACK_SPEED),
    total: raw.total / PLAYBACK_SPEED,
    segments: raw.segments,
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
  timeSeconds?: number
  phase: SimPhase
  /** Characters of the question currently visible in the input. */
  typedCount: number
  /** Narration bubble text ('' hides the bubble). */
  bubble: string
  chip: 'thinking' | 'teaching'
  /** Pause/cancel teaching controls visible in the input bar. */
  teaching: boolean
}

export function deriveSnapshot(
  timeSeconds: number,
  timing: LessonTiming,
  locale: HeroLessonLocale = 'en-GB',
): LessonSnapshot {
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
  const segments = lessonSegments(locale)

  if (lt < timing.total) {
    let seg = 0
    for (let i = 0; i < segments.length; i++) if (timing.starts[i] <= lt) seg = i
    return {
      phase: 'teaching',
      typedCount: 0,
      bubble: segments[seg].bubble,
      chip: 'teaching',
      teaching: true,
    }
  }

  if (lt < timing.total + HOLD_DURATION) {
    return {
      phase: 'hold',
      typedCount: 0,
      bubble: segments[segments.length - 1].bubble,
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
