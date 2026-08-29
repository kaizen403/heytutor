import { useEffect, useMemo, useRef, useState } from 'react'
import type { CursorState, WhiteboardHandle } from '@heytutor/whiteboard'
import type { DashboardDrive } from '../DashboardMockup'
import type { LessonSnapshot } from '../hero-lesson/lessonScript'
import { drawResistorsLesson, RESISTORS_STAGES } from '../hero-lesson/resistorsProgram'

/* ═══════════════════════════════════════════════════════════════════════════
   useUseCaseDemo — poses the real dashboard through one scripted beat.

   The hero's simulation plays a whole lesson end to end on an audio clock.
   A use case needs something different: a short, looping fragment that shows
   one action — the question being typed, a doubt interrupting, replay being
   pressed. So this drives the same chrome from its own clock and its own
   timeline, and hands the result to <DashboardMockup drive={…}>.

   The clock restarts whenever the beat changes, so switching use cases always
   plays that action from its start rather than dropping you mid-way through it.
   ═══════════════════════════════════════════════════════════════════════════ */

export type BeatId = 'ask' | 'annotate' | 'doubt' | 'replay' | 'notes'

/** One beat runs this long before looping. Matches the rail's dwell. */
export const BEAT_SECONDS = 7

interface Frame {
  snapshot: LessonSnapshot
  /** Text in the input; the beat decides whether that is the question or a doubt. */
  text: string
  pressed?: 'replay' | 'download' | null
}

const CHARS_PER_SECOND = 34

const typing = (text: string, t: number, from: number): LessonSnapshot => ({
  phase: 'typing',
  typedCount: Math.min(text.length, Math.floor((t - from) * CHARS_PER_SECOND)),
  bubble: '',
  chip: 'thinking',
  teaching: false,
})

const teachingAt = (bubble: string): LessonSnapshot => ({
  phase: 'teaching',
  typedCount: 0,
  bubble,
  chip: 'teaching',
  teaching: true,
})

const idle: LessonSnapshot = {
  phase: 'hold',
  typedCount: 0,
  bubble: '',
  chip: 'teaching',
  teaching: false,
}

export interface DemoCopy {
  question: string
  doubt: string
  /** Narration captions, cycled while the board is being taught. */
  bubbles: string[]
}

/** The frame for a beat at time `t` seconds into it. Exported for the verify script. */
export function frameFor(beat: BeatId, t: number, copy: DemoCopy): Frame {
  const bubble = copy.bubbles[Math.min(copy.bubbles.length - 1, Math.floor(t / 1.6))] ?? ''

  switch (beat) {
    case 'ask': {
      // Straight off the home page: the question types itself, submits, teaches.
      const typeFor = copy.question.length / CHARS_PER_SECOND
      if (t < typeFor) return { snapshot: typing(copy.question, t, 0), text: copy.question }
      if (t < typeFor + 0.45)
        return {
          snapshot: { phase: 'submit', typedCount: copy.question.length, bubble: '', chip: 'thinking', teaching: false },
          text: copy.question,
        }
      return { snapshot: teachingAt(bubble), text: copy.question }
    }

    case 'annotate':
      // Mid-lesson: the diagram is up and the marks are going on.
      return { snapshot: teachingAt(bubble), text: copy.question }

    case 'doubt': {
      // Interrupt a running lesson, type the doubt, hand the board to it.
      if (t < 1.6) return { snapshot: teachingAt(copy.bubbles[0] ?? ''), text: copy.question }
      const typeFor = 1.6 + copy.doubt.length / CHARS_PER_SECOND
      if (t < typeFor) return { snapshot: typing(copy.doubt, t, 1.6), text: copy.doubt }
      if (t < typeFor + 0.45)
        return {
          snapshot: { phase: 'submit', typedCount: copy.doubt.length, bubble: '', chip: 'thinking', teaching: false },
          text: copy.doubt,
        }
      return { snapshot: teachingAt('answering the doubt on a clear board'), text: copy.doubt }
    }

    case 'replay': {
      if (t < 0.9) return { snapshot: idle, text: copy.question }
      if (t < 1.5) return { snapshot: idle, text: copy.question, pressed: 'replay' }
      return { snapshot: teachingAt(bubble), text: copy.question, pressed: null }
    }

    case 'notes': {
      if (t < 1.2) return { snapshot: idle, text: copy.question }
      if (t < 2.0) return { snapshot: idle, text: copy.question, pressed: 'download' }
      return { snapshot: idle, text: copy.question, pressed: 'download' }
    }
  }
}

export function useUseCaseDemo(
  beat: BeatId,
  copy: DemoCopy,
  paused: boolean,
  active: boolean,
): DashboardDrive {
  const [frame, setFrame] = useState<Frame>(() => frameFor(beat, 0, copy))
  const boardHandle = useRef<WhiteboardHandle | null>(null)
  const [boardReady, setBoardReady] = useState(false)

  useEffect(() => {
    if (paused) return
    const start = performance.now()
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      // Every tick re-renders the dashboard, and the dashboard contains a live
      // Konva board. At display rate the board never gets a frame to itself and
      // the lesson stalls with only the cursor animating. 24fps is plenty for a
      // typing caret and leaves the renderer alone.
      if (now - last < 1000 / 24) return
      last = now
      const t = ((now - start) / 1000) % BEAT_SECONDS
      setFrame(frameFor(beat, t, copy))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [beat, copy, paused])

  /* Each beat poses the board for its own moment, rather than every beat
     watching one long program from wherever it happens to be. Stages the beat
     is not about are rendered instantly; the one it *is* about is animated.
     That is what makes clicking a use case land on the thing it claims. */
  useEffect(() => {
    const board = boardHandle.current
    if (!board || !active) return

    let cancelled = false
    const timers: number[] = []
    const isCancelled = () => cancelled
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms))
      })

    void (async () => {
      await board.clearBoard(180)
      if (cancelled) return

      switch (beat) {
        case 'ask':
          // From an empty board, exactly as it looks when the question lands.
          await drawResistorsLesson(board, { isCancelled, animate: ['work', 'series'] })
          return

        case 'annotate':
          // Circuits already up; the marking is the subject.
          await drawResistorsLesson(board, {
            isCancelled,
            prefill: ['work', 'series', 'parallel'],
            animate: ['labels', 'marks'],
          })
          return

        case 'doubt': {
          // The lesson is on the board, then the doubt takes it over.
          await drawResistorsLesson(board, { isCancelled, prefill: RESISTORS_STAGES, animate: [] })
          if (cancelled) return
          await wait(3200)
          if (cancelled) return
          await board.clearBoard(420)
          if (cancelled) return
          await drawResistorsLesson(board, {
            isCancelled,
            animate: ['work', 'parallel'],
            speed: 1.8,
          })
          return
        }

        case 'replay':
          // The whole lesson again, at the speed the replay control implies.
          await wait(1400)
          if (cancelled) return
          await drawResistorsLesson(board, { isCancelled, speed: 2.4 })
          return

        case 'notes':
          // Finished board — this is what the PDF is taken from.
          await drawResistorsLesson(board, { isCancelled, prefill: RESISTORS_STAGES, animate: [] })
          return
      }
    })()

    return () => {
      cancelled = true
      for (const id of timers) window.clearTimeout(id)
      board.cancelAnimations()
    }
  }, [boardReady, beat, active])

  const boardRef = useMemo(
    () => (handle: WhiteboardHandle | null) => {
      boardHandle.current = handle
      setBoardReady(handle !== null)
    },
    [],
  )

  const cursorState: CursorState = frame.snapshot.teaching ? 'drawing' : 'thinking'

  return {
    question: frame.text,
    snapshot: frame.snapshot,
    sound: 'unavailable',
    toggleSound: () => {},
    boardRef,
    cursorState,
    pressed: frame.pressed ?? null,
  }
}
