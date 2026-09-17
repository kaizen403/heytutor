import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { CursorState, WhiteboardHandle } from '@heytutor/whiteboard'
import {
  PLAYBACK_SPEED,
  SEGMENTS,
  completedSnapshot,
  deriveSnapshot,
  fallbackTiming,
  toPlaybackTiming,
  type LessonSnapshot,
  type LessonTiming,
} from './lessonScript'
import { drawStaticLesson, runHeroLessonLoop, type HeroPlayerControls } from './heroLessonPlayer'
import {
  heroSoundAfterAssetsLoad,
  initialHeroSectionVisible,
} from './heroVoicePolicy'
import {
  decideHeroAudioTick,
  lessonOffsetSec,
  shouldPauseHeroLesson,
  snapToNarrationIfDeadAir,
  startTimeMsToMatchAudio,
} from './heroAudioClock'
import { createHeroAudioEngine, type HeroAudioEngine } from './heroAudioEngine'

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
  hiddenSince: number | null
  soundOn: boolean
}

/**
 * Drives the hero's self-playing lesson: the surrounding chrome (typing, chip,
 * bubble) runs on one pause-aware wall clock, and the real whiteboard renderer
 * is driven by heroLessonPlayer against the same clock. While the voice is
 * speaking, that clock is slaved to the audio engine — the board never seeks
 * the voice onto a wall clock, which is what cut the sentence off on phones.
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
  const engineRef = useRef<HeroAudioEngine | null>(null)
  const stRef = useRef<SimInternals>({
    timing: toPlaybackTiming(fallbackTiming()),
    start: 0,
    pausedAccum: 0,
    pausedAt: null,
    ioVisible: initialHeroSectionVisible(),
    docVisible: true,
    hiddenSince: initialHeroSectionVisible() ? null : 0,
    soundOn: false,
  })

  const boardRef = useCallback((handle: WhiteboardHandle | null) => {
    boardHandleRef.current = handle
    setBoardReady(handle !== null)
  }, [])

  /* Sound on, joined wherever the loop currently is — and if the loop is in
     dead air (typing / hold / clear), the clock is pulled forward to the next
     narration start so the start() is issued inside this very gesture, in sync
     with the ink. iOS unlocks Web Audio only for a resume() called
     synchronously inside the gesture handler; a gesture that lands in dead air
     must not be spent waiting. The ink player is waiting on a segment boundary
     during dead air, so it fast-forwards the wait rather than skipping ink. */
  const startVoice = useCallback(() => {
    const st = stRef.current
    const engine = engineRef.current
    if (!engine?.isReady()) return
    engine.unlock()
    st.soundOn = true
    setSound('on')
    const nowMs = st.pausedAt ?? performance.now()
    const t = (nowMs - st.start - st.pausedAccum) / 1000
    const snapped = snapToNarrationIfDeadAir(t, st.timing)
    if (snapped.tSeconds !== t) {
      st.start -= (snapped.tSeconds - t) * 1000
    }
    engine.start(snapped.lessonOffsetSec * PLAYBACK_SPEED)
  }, [])

  useEffect(() => {
    if (reduced) return
    const st = stRef.current
    const engine = createHeroAudioEngine({
      onBlocked: () => {
        stRef.current.soundOn = false
        setSound('off')
      },
    })
    engineRef.current = engine
    let cancelled = false

    void (async () => {
      try {
        const [timingRes, audioRes] = await Promise.all([fetch(TIMINGS_SRC), fetch(AUDIO_SRC)])
        if (!timingRes.ok) throw new Error(`timings ${timingRes.status}`)
        if (!audioRes.ok) throw new Error(`audio ${audioRes.status}`)
        const data = (await timingRes.json()) as LessonTiming
        if (
          !Array.isArray(data?.starts) ||
          data.starts.length !== SEGMENTS.length ||
          typeof data.total !== 'number'
        ) {
          throw new Error('malformed timings')
        }
        const buf = await audioRes.arrayBuffer()
        if (cancelled) return
        st.timing = toPlaybackTiming(data)
        await engine.loadFromArrayBuffer(buf)
        if (cancelled) return
        if (!engine.isReady()) throw new Error('audio decode failed')
        setSound(heroSoundAfterAssetsLoad({ reducedMotion: false, timingsOk: true }))
      } catch {
        if (!cancelled) {
          setSound(heroSoundAfterAssetsLoad({ reducedMotion: false, timingsOk: false }))
        }
      } finally {
        if (!cancelled) setTimingReady(true)
      }
    })()

    return () => {
      cancelled = true
      engine.release()
      engineRef.current = null
      st.soundOn = false
    }
  }, [reduced])

  useEffect(() => {
    if (reduced) return
    const st = stRef.current
    st.start = performance.now()

    const io = new IntersectionObserver(
      ([entry]) => {
        st.ioVisible = entry.isIntersecting
      },
      { threshold: 0, rootMargin: '30% 0px 30% 0px' },
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
      if (visible) {
        st.hiddenSince = null
      } else if (st.hiddenSince === null) {
        st.hiddenSince = now
      }
      const hiddenForMs = st.hiddenSince === null ? 0 : now - st.hiddenSince
      const engine = engineRef.current

      if (shouldPauseHeroLesson({ ioVisible: st.ioVisible, docVisible: st.docVisible, hiddenForMs })) {
        if (st.pausedAt === null) {
          st.pausedAt = now
          engine?.stop()
          boardHandleRef.current?.setPaused(true)
        }
        return
      }
      if (st.pausedAt !== null) {
        st.pausedAccum += now - st.pausedAt
        st.pausedAt = null
        boardHandleRef.current?.setPaused(false)
      }

      let t = (now - st.start - st.pausedAccum) / 1000
      const decision = decideHeroAudioTick({
        soundOn: st.soundOn,
        lessonOffsetSec: lessonOffsetSec(t, st.timing),
        totalSec: st.timing.total,
        playing: engine?.isPlaying() ?? false,
        startInFlight: engine?.isStartInFlight() ?? false,
        unlocked: engine?.isUnlocked() ?? false,
        ready: engine?.isReady() ?? false,
        ioVisible: st.ioVisible,
        docVisible: st.docVisible,
        hiddenForMs,
      })
      if (decision.stop) engine?.stop()
      if (decision.startOffsetSec != null) {
        engine?.start(decision.startOffsetSec * PLAYBACK_SPEED)
      }
      if (decision.slaveClock) {
        const audioPos = engine?.getPositionSec()
        if (audioPos != null) {
          st.start = startTimeMsToMatchAudio({
            nowMs: now,
            pausedAccumMs: st.pausedAccum,
            audioPositionSec: audioPos / PLAYBACK_SPEED,
          })
          t = (now - st.start - st.pausedAccum) / 1000
        }
      }

      setSnapshot(deriveSnapshot(t, st.timing))
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      engineRef.current?.stop()
    }
  }, [rootRef, reduced])

  useEffect(() => {
    if (reduced || !boardReady || !timingReady) return
    const board = boardHandleRef.current
    if (!board) return

    const st = stRef.current
    st.start = performance.now()
    st.pausedAccum = 0

    let cancelled = false
    const controls: HeroPlayerControls = {
      getAudioPositionMs: () => {
        const engine = engineRef.current
        if (st.soundOn && engine) {
          const pos = engine.getPositionSec()
          if (pos != null) return (pos * 1000) / PLAYBACK_SPEED
        }
        const s = stRef.current
        const t = performance.now() - s.start - s.pausedAccum
        return lessonOffsetSec(t / 1000, s.timing) * 1000
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

  useEffect(() => {
    if (!reduced || !boardReady || !boardHandleRef.current) return
    void drawStaticLesson(boardHandleRef.current)
  }, [reduced, boardReady])

  const toggleSound = () => {
    const st = stRef.current
    const engine = engineRef.current
    if (!engine?.isReady()) return
    if (st.soundOn) {
      st.soundOn = false
      engine.stop()
      setSound('off')
      return
    }
    startVoice()
  }

  return { snapshot, sound, toggleSound, boardRef, cursorState }
}
