/**
 * Hero lesson audio clock — when the voice may start, stop, or drive the
 * board, and never when it may be seeked.
 *
 * The landing mockup used to treat a wall-clock rAF loop as master and nudge
 * an HTMLAudioElement onto it (currentTime = …, play() every frame while
 * paused). On phones that aborts the in-flight play() and cuts the sentence
 * in half; Konva jank then looks like more drift and seeks again. Audio is
 * the master clock. The lesson and the pen follow it.
 */
import { loopDuration, teachStart, type LessonTiming } from './lessonScript.ts'
import { shouldAttemptHeroPlayback } from './heroVoicePolicy.ts'

/** Off-screen / tab-hidden must hold this long before we pause. 3D
 *  transforms and the iOS URL bar otherwise flicker IntersectionObserver
 *  and cut the voice mid-word. */
export const HERO_VISIBILITY_PAUSE_MS = 1000

export function lessonOffsetSec(tSeconds: number, timing: LessonTiming): number {
  const loopSec = loopDuration(timing)
  const t = ((tSeconds % loopSec) + loopSec) % loopSec
  return t - teachStart()
}

export function isHeroNarrationWindow(offsetSec: number, totalSec: number): boolean {
  return offsetSec >= 0 && offsetSec < totalSec
}

/**
 * A tap that lands in typing / hold / clear would otherwise be spent on a
 * pause(), and iOS would block every later start(). Jump to the next
 * narration start so the gesture's start() is the one that speaks.
 */
export function snapToNarrationIfDeadAir(
  tSeconds: number,
  timing: LessonTiming,
): { tSeconds: number; lessonOffsetSec: number } {
  const offset = lessonOffsetSec(tSeconds, timing)
  if (isHeroNarrationWindow(offset, timing.total)) {
    return { tSeconds, lessonOffsetSec: offset }
  }
  const loopSec = loopDuration(timing)
  const pos = ((tSeconds % loopSec) + loopSec) % loopSec
  const teach = teachStart()
  const wait = pos < teach ? teach - pos : loopSec - pos + teach
  const next = tSeconds + wait
  return { tSeconds: next, lessonOffsetSec: 0 }
}

export function shouldPauseHeroLesson(input: {
  ioVisible: boolean
  docVisible: boolean
  hiddenForMs: number
}): boolean {
  if (input.ioVisible && input.docVisible) return false
  return input.hiddenForMs >= HERO_VISIBILITY_PAUSE_MS
}

export function isUnlockBlockingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return (error as { name?: string }).name === 'NotAllowedError'
}

/**
 * WebKit reports `interrupted` when the phone's audio session is taken
 * away (silent switch, background, Control Center). resume() must run for
 * that state too — gating only on `suspended` leaves iOS silent after the
 * Hear-this-lesson tap.
 */
export function audioContextNeedsResume(state: string): boolean {
  return state === 'suspended' || state === 'interrupted'
}

/** 1-sample WAV. Played inside the tap so iOS routes later Web Audio through media playback. */
export const HERO_SILENT_UNLOCK_SRC =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

/** Re-anchor the wall clock so lessonOffsetSec(t) == audioPositionSec. */
export function startTimeMsToMatchAudio(input: {
  nowMs: number
  pausedAccumMs: number
  audioPositionSec: number
}): number {
  return input.nowMs - input.pausedAccumMs - (input.audioPositionSec + teachStart()) * 1000
}

export interface HeroAudioTickInput {
  soundOn: boolean
  lessonOffsetSec: number
  totalSec: number
  playing: boolean
  startInFlight: boolean
  unlocked: boolean
  ready: boolean
  ioVisible: boolean
  docVisible: boolean
  hiddenForMs: number
}

export interface HeroAudioTickDecision {
  /** Start (or restart) the voice at this media offset. Null = do not start. */
  startOffsetSec: number | null
  stop: boolean
  slaveClock: boolean
}

/**
 * One rAF of audio policy. The only legal start is "not already starting
 * or playing". Seeking is not a decision this function can return.
 */
export function decideHeroAudioTick(input: HeroAudioTickInput): HeroAudioTickDecision {
  const idle: HeroAudioTickDecision = { startOffsetSec: null, stop: false, slaveClock: false }
  const flicker =
    (!input.ioVisible || !input.docVisible) && input.hiddenForMs < HERO_VISIBILITY_PAUSE_MS
  const mayPlay = shouldAttemptHeroPlayback({
    soundOn: input.soundOn,
    sectionVisible: input.ioVisible || flicker,
    documentVisible: input.docVisible || flicker,
  })

  if (!mayPlay) {
    return { startOffsetSec: null, stop: input.playing, slaveClock: false }
  }

  const inNarration = isHeroNarrationWindow(input.lessonOffsetSec, input.totalSec)
  if (!inNarration) {
    return { startOffsetSec: null, stop: input.playing, slaveClock: false }
  }

  if (input.playing) {
    return { startOffsetSec: null, stop: false, slaveClock: true }
  }

  if (input.startInFlight || !input.unlocked || !input.ready) {
    return idle
  }

  return {
    startOffsetSec: Math.max(0, input.lessonOffsetSec),
    stop: false,
    slaveClock: false,
  }
}
