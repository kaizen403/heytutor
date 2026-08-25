import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { CursorState, WhiteboardHandle } from '@heytutor/whiteboard'
import {
  PLAYBACK_SPEED,
  SEGMENTS,
  SUBMIT_PAUSE,
  TYPING_DURATION,
  completedSnapshot,
  deriveSnapshot,
  fallbackTiming,
  loopDuration,
  toPlaybackTiming,
  type LessonSnapshot,
  type LessonTiming,
} from './lessonScript'
import { drawStaticLesson, runHeroLessonLoop, type HeroPlayerControls } from './heroLessonPlayer'

const AUDIO_SRC = '/hero/lesson.mp3'
const TIMINGS_SRC = '/hero/lesson-timings.json'

export type SoundState = 'loading' | 'unavailable' | 'off' | 'on'

interface SimInternals {
  timing: LessonTiming
  start: number
  pausedAccum: number
  pausedAt: number | null
  ioVisible: boolean
  docVisible: boolean
  soundOn: boolean
  audio: HTMLAudioElement | null
}

function teachStartMs(): number {
  return (TYPING_DURATION + SUBMIT_PAUSE) * 1000
}

function lessonOffsetMs(tSeconds: number, timing: LessonTiming): number {
  const loopMs = loopDuration(timing) * 1000
  const t = tSeconds * 1000
  return (((t % loopMs) + loopMs) % loopMs) - teachStartMs()
}

/**
 * Drives the hero's self-playing lesson: the surrounding chrome (typing, chip,
 * bubble) runs on one pause-aware wall clock, and the real whiteboard renderer
 * is driven by heroLessonPlayer against the same clock. When TTS timings +
 * audio exist, the audio is nudged onto the clock and the pen tracks the audio
 * position — the board never blocks on TTS.
 */
export function useLessonSimulation(rootRef: RefObject<HTMLElement | null>): {
  snapshot: LessonSnapshot
  sound: SoundState
  toggleSound: () => void
  boardRef: (handle: WhiteboardHandle | null) => void
  cursorState: CursorState
} {
  const [reduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [snapshot, setSnapshot] = useState<LessonSnapshot>(() =>
    reduced ? completedSnapshot() : deriveSnapshot(0, toPlaybackTiming(fallbackTiming())),
  )
  const [sound, setSound] = useState<SoundState>(reduced ? 'unavailable' : 'loading')
  const [cursorState, setCursorState] = useState<CursorState>('thinking')
  const [boardReady, setBoardReady] = useState(false)
  const [timingReady, setTimingReady] = useState(false)
  const boardHandleRef = useRef<WhiteboardHandle | null>(null)
  const stRef = useRef<SimInternals>({
    timing: toPlaybackTiming(fallbackTiming()),
    start: 0,
    pausedAccum: 0,
    pausedAt: null,
    ioVisible: true,
    docVisible: true,
    soundOn: false,
    audio: null,
  })

  const boardRef = useCallback((handle: WhiteboardHandle | null) => {
    boardHandleRef.current = handle
    setBoardReady(handle !== null)
  }, [])

  // Optional TTS assets. Absent or malformed → silent estimated schedule.
  useEffect(() => {
    if (reduced) return
    const st = stRef.current
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(TIMINGS_SRC)
        if (!res.ok) throw new Error(`timings ${res.status}`)
        const data = (await res.json()) as LessonTiming
        if (
          !Array.isArray(data?.starts) ||
          data.starts.length !== SEGMENTS.length ||
          typeof data.total !== 'number'
        ) {
          throw new Error('malformed timings')
        }
        if (cancelled) return
        st.timing = toPlaybackTiming(data)
        const audio = new Audio(AUDIO_SRC)
        audio.preload = 'auto'
        audio.playbackRate = PLAYBACK_SPEED
        st.audio = audio
        // Muted-first: voice only plays after the visitor clicks the sound
        // toggle. The animation runs on the estimated schedule regardless.
        st.soundOn = false
        setSound('off')
      } catch {
        if (!cancelled) setSound('unavailable')
      } finally {
        if (!cancelled) setTimingReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reduced])

  // Master clock: chrome snapshot + audio nudged onto it.
  useEffect(() => {
    if (reduced) return
    const st = stRef.current
    st.start = performance.now()

    const io = new IntersectionObserver(
      ([entry]) => {
        st.ioVisible = entry.isIntersecting
      },
      { threshold: 0.1 },
    )
    if (rootRef.current) io.observe(rootRef.current)
    const onVis = () => {
      st.docVisible = document.visibilityState === 'visible'
    }
    document.addEventListener('visibilitychange', onVis)

    let raf = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const visible = st.ioVisible && st.docVisible

      if (!visible) {
        if (st.pausedAt === null) {
          st.pausedAt = now
          st.audio?.pause()
          boardHandleRef.current?.setPaused(true)
        }
        return
      }
      if (st.pausedAt !== null) {
        st.pausedAccum += now - st.pausedAt
        st.pausedAt = null
        boardHandleRef.current?.setPaused(false)
      }

      const t = (now - st.start - st.pausedAccum) / 1000
      setSnapshot(deriveSnapshot(t, st.timing))

      const audio = st.audio
      if (audio && st.soundOn) {
        const lt = lessonOffsetMs(t, st.timing) / 1000
        if (lt >= 0 && lt < st.timing.total) {
          const mediaTarget = lt * PLAYBACK_SPEED
          if (audio.paused) {
            audio.currentTime = mediaTarget
            audio.play().catch(() => {
              st.soundOn = false
              setSound('off')
            })
          } else if (Math.abs(audio.currentTime - mediaTarget) > 0.3) {
            audio.currentTime = mediaTarget
          }
        } else if (!audio.paused) {
          audio.pause()
        }
      }
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      st.audio?.pause()
    }
  }, [rootRef, reduced])

  // The whiteboard player: real renderer, real call sequence, looped.
  useEffect(() => {
    if (reduced || !boardReady || !timingReady) return
    const board = boardHandleRef.current
    if (!board) return

    // Re-anchor the wall clock so chrome and ink share the same t=0.
    const st = stRef.current
    st.start = performance.now()
    st.pausedAccum = 0

    let cancelled = false
    const controls: HeroPlayerControls = {
      getAudioPositionMs: () => {
        const { audio, soundOn } = st
        if (audio && soundOn && !audio.paused) return (audio.currentTime * 1000) / PLAYBACK_SPEED
        const s = stRef.current
        const t = performance.now() - s.start - s.pausedAccum
        return lessonOffsetMs(t / 1000, s.timing)
      },
      getMonotonicMs: () => {
        const s = stRef.current
        return performance.now() - s.start - s.pausedAccum
      },
      isPaused: () => stRef.current.pausedAt !== null,
      isCancelled: () => cancelled,
      setCursorState,
    }
    void runHeroLessonLoop(board, st.timing, controls)

    return () => {
      cancelled = true
      board.cancelAnimations()
    }
  }, [reduced, boardReady, timingReady])

  // Reduced motion: draw the finished board once, no animation, no audio.
  useEffect(() => {
    if (!reduced || !boardReady || !boardHandleRef.current) return
    void drawStaticLesson(boardHandleRef.current)
  }, [reduced, boardReady])

  const toggleSound = () => {
    const st = stRef.current
    if (!st.audio) return
    if (st.soundOn) {
      st.soundOn = false
      st.audio.pause()
      setSound('off')
      return
    }
    st.soundOn = true
    setSound('on')
    const t = (performance.now() - st.start - st.pausedAccum) / 1000
    const lt = lessonOffsetMs(t, st.timing) / 1000
    if (lt >= 0 && lt < st.timing.total) {
      st.audio.currentTime = lt * PLAYBACK_SPEED
      st.audio.play().catch(() => {
        st.soundOn = false
        setSound('off')
      })
    }
  }

  return { snapshot, sound, toggleSound, boardRef, cursorState }
}
