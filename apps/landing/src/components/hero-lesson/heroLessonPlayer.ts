/**
 * Drives the REAL whiteboard renderer through the same call sequence the live
 * tutor uses: flyCursorTo → writeText (per-character WriteSchedule held against
 * the audio clock) → drawShape with audio-damped targets → drawAnnotation →
 * clearBoard. Canvas coordinates are the product's 1200×700 board space.
 */
import { measureTextWidth, prefetchStrokePaths } from '@heytutor/drawing'
import type { CursorState, WhiteboardHandle, WriteSchedule } from '@heytutor/whiteboard'
import {
  CLEAR_DURATION,
  HOLD_DURATION,
  teachStart,
  type LessonTiming,
} from './lessonScript'

export interface HeroPlayerControls {
  /** ms of lesson audio elapsed — the audio clock while playing, the estimated clock otherwise. */
  getAudioPositionMs: () => number
  /** Pause-aware monotonic wall clock (ms), never wraps — paces the loop itself. */
  getMonotonicMs: () => number
  isPaused: () => boolean
  isCancelled: () => boolean
  setCursorState: (state: CursorState) => void
}

const WORK_X = 70
const FONT_SIZE = 32
const LABEL_SIZE = 22

const LINE_A = { text: 'Given: u = 0 m/s, a = 2 m/s², t = 5 s', y: 130 }
const LINE_B = { text: 'v = u + at', y: 210 }
const LINE_C = { text: 'v = 0 + 2 × 5', y: 290 }
const LINE_D = { text: 'v = 10 m/s', y: 370 }
/* Measured off the answer's real ink width, never hardcoded. */
const UNDERLINE = `M ${WORK_X - 2} ${LINE_D.y + FONT_SIZE} L ${Math.round(
  WORK_X + measureTextWidth(LINE_D.text, FONT_SIZE) + 4,
)} ${LINE_D.y + FONT_SIZE}`

const GRAPH = {
  axisX: 'M 560 470 L 934 470',
  arrowX: 'M 926 462 L 940 470 L 926 478',
  axisY: 'M 560 470 L 560 176',
  arrowY: 'M 552 184 L 560 170 L 568 184',
  rise: 'M 560 470 L 880 230',
  dashDown: 'M 880 230 L 880 470',
  dashLeft: 'M 880 230 L 560 230',
  dot: 'M 876 230 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0',
}

const LABEL_V = { text: 'v (m/s)', x: 576, y: 150 }
const LABEL_T = { text: 't (s)', x: 950, y: 508 }
const LABEL_10 = { text: '10', x: 514, y: 240 }
const LABEL_5 = { text: '5', x: 862, y: 508 }

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function makeSchedule(
  text: string,
  segStartMs: number,
  segDurMs: number,
  c: HeroPlayerControls,
): WriteSchedule {
  const lead = Math.min(500, segDurMs * 0.12)
  const write = segDurMs * 0.68
  const chars = [...text].filter((ch) => ch !== ' ')
  const per = write / Math.max(chars.length, 1)
  return {
    charStartOffsetsMs: chars.map((_, i) => segStartMs + lead + i * per),
    charDurationsMs: chars.map(() => per),
    getAudioPositionMs: c.getAudioPositionMs,
  }
}

export async function runHeroLessonLoop(
  board: WhiteboardHandle,
  timing: LessonTiming,
  c: HeroPlayerControls,
): Promise<void> {
  const S = timing.starts.map((s) => s * 1000)
  const totalMs = timing.total * 1000
  const teachMs = teachStart() * 1000
  const holdMs = HOLD_DURATION * 1000
  const clearMs = CLEAR_DURATION * 1000
  const loopMs = teachMs + totalMs + holdMs + clearMs
  const segDur = (i: number) => (i + 1 < S.length ? S[i + 1] : totalMs) - S[i]

  const ok = () => !c.isCancelled()
  const waitFor = async (ms: number): Promise<boolean> => {
    if (ms <= 0) return ok()
    const from = c.getMonotonicMs()
    while (ok()) {
      if (c.getMonotonicMs() - from >= ms) return true
      await delay(40)
    }
    return false
  }

  while (ok()) {
    const loopStart = c.getMonotonicMs()
    const at = (ms: number) => waitFor(loopStart + ms - c.getMonotonicMs())

    // Typing + submit: blank board; park the pen (hidden) where writing begins.
    c.setCursorState('thinking')
    board.setCursorPos(WORK_X, LINE_A.y)
    if (!(await at(teachMs))) return

    // Segment 0 (narration only): the pen fades in at the work area.
    c.setCursorState('speaking')
    if (!(await at(teachMs + S[1]))) return

    // Segment 1: the givens.
    prefetchStrokePaths(LINE_A.text, WORK_X, LINE_A.y, FONT_SIZE)
    await board.writeText(LINE_A.text, WORK_X, LINE_A.y, 0, makeSchedule(LINE_A.text, S[1], segDur(1), c), FONT_SIZE, c.isCancelled)
    if (!ok()) return

    // Segment 2: the first equation of motion.
    if (!(await at(teachMs + S[2]))) return
    prefetchStrokePaths(LINE_B.text, WORK_X, LINE_B.y, FONT_SIZE)
    await board.flyCursorTo(WORK_X, LINE_B.y, 130, -35)
    await board.writeText(LINE_B.text, WORK_X, LINE_B.y, 0, makeSchedule(LINE_B.text, S[2], segDur(2), c), FONT_SIZE, c.isCancelled)
    if (!ok()) return

    // Segment 3: the velocity–time graph (short flights between strokes).
    if (!(await at(teachMs + S[3]))) return
    c.setCursorState('drawing')
    const g = S[3]
    const damp = (targetMs: number) => ({
      getAudioPositionMs: c.getAudioPositionMs,
      targetMs,
      shouldCancel: c.isCancelled,
    })
    await board.flyCursorTo(560, 470, 140)
    await board.drawShape(GRAPH.axisX, 540, damp(g + 680))
    if (!ok()) return
    await board.drawShape(GRAPH.arrowX, 90, damp(g + 770))
    if (!ok()) return
    await board.drawShape(GRAPH.axisY, 540, damp(g + 1310))
    if (!ok()) return
    await board.drawShape(GRAPH.arrowY, 90, damp(g + 1400))
    if (!ok()) return
    await board.flyCursorTo(LABEL_V.x, LABEL_V.y, 100)
    await board.writeText(LABEL_V.text, LABEL_V.x, LABEL_V.y, 240, undefined, LABEL_SIZE, c.isCancelled)
    if (!ok()) return
    await board.flyCursorTo(LABEL_T.x, LABEL_T.y, 100)
    await board.writeText(LABEL_T.text, LABEL_T.x, LABEL_T.y, 240, undefined, LABEL_SIZE, c.isCancelled)
    if (!ok()) return
    await board.flyCursorTo(560, 470, 110)
    await board.drawShape(GRAPH.rise, 900, damp(g + 3090))
    if (!ok()) return
    await board.drawShape(GRAPH.dot, 130, damp(g + 3220))
    if (!ok()) return
    await board.drawShape(GRAPH.dashDown, 320, { ...damp(g + 3540), dashed: true, strokeWidth: 1.6 })
    if (!ok()) return
    await board.drawShape(GRAPH.dashLeft, 320, { ...damp(g + 3860), dashed: true, strokeWidth: 1.6 })
    if (!ok()) return
    await board.flyCursorTo(LABEL_10.x, LABEL_10.y, 90)
    await board.writeText(LABEL_10.text, LABEL_10.x, LABEL_10.y, 240, undefined, LABEL_SIZE, c.isCancelled)
    if (!ok()) return
    await board.flyCursorTo(LABEL_5.x, LABEL_5.y, 90)
    await board.writeText(LABEL_5.text, LABEL_5.x, LABEL_5.y, 240, undefined, LABEL_SIZE, c.isCancelled)
    if (!ok()) return

    // Segment 4: substitution.
    c.setCursorState('speaking')
    if (!(await at(teachMs + S[4]))) return
    prefetchStrokePaths(LINE_C.text, WORK_X, LINE_C.y, FONT_SIZE)
    await board.flyCursorTo(WORK_X, LINE_C.y, 150, -35)
    await board.writeText(LINE_C.text, WORK_X, LINE_C.y, 0, makeSchedule(LINE_C.text, S[4], segDur(4), c), FONT_SIZE, c.isCancelled)
    if (!ok()) return

    // Segment 5: the answer, underlined.
    if (!(await at(teachMs + S[5]))) return
    prefetchStrokePaths(LINE_D.text, WORK_X, LINE_D.y, FONT_SIZE)
    await board.flyCursorTo(WORK_X, LINE_D.y, 130, -35)
    await board.writeText(LINE_D.text, WORK_X, LINE_D.y, 0, makeSchedule(LINE_D.text, S[5], segDur(5), c), FONT_SIZE, c.isCancelled)
    if (!ok()) return
    await board.drawAnnotation('underline', UNDERLINE, 420, { shouldCancel: c.isCancelled })
    if (!ok()) return

    // Hold the finished board, then erase and loop.
    c.setCursorState('idle')
    if (!(await at(teachMs + totalMs + holdMs))) return
    c.setCursorState('erasing')
    await board.clearBoard(900)
    if (!(await at(loopMs - 120))) return
  }
}

/** One-shot static render of the finished board (prefers-reduced-motion). */
export async function drawStaticLesson(board: WhiteboardHandle): Promise<void> {
  board.setCursorState('idle')
  for (const line of [LINE_A, LINE_B, LINE_C, LINE_D]) {
    await board.writeText(line.text, WORK_X, line.y, 0, undefined, FONT_SIZE)
  }
  await board.drawShape(GRAPH.axisX, 0)
  await board.drawShape(GRAPH.arrowX, 0)
  await board.drawShape(GRAPH.axisY, 0)
  await board.drawShape(GRAPH.arrowY, 0)
  await board.writeText(LABEL_V.text, LABEL_V.x, LABEL_V.y, 0, undefined, LABEL_SIZE)
  await board.writeText(LABEL_T.text, LABEL_T.x, LABEL_T.y, 0, undefined, LABEL_SIZE)
  await board.drawShape(GRAPH.rise, 0)
  await board.drawShape(GRAPH.dot, 0)
  await board.drawShape(GRAPH.dashDown, 0, { dashed: true, strokeWidth: 1.6 })
  await board.drawShape(GRAPH.dashLeft, 0, { dashed: true, strokeWidth: 1.6 })
  await board.writeText(LABEL_10.text, LABEL_10.x, LABEL_10.y, 0, undefined, LABEL_SIZE)
  await board.writeText(LABEL_5.text, LABEL_5.x, LABEL_5.y, 0, undefined, LABEL_SIZE)
  await board.drawAnnotation('underline', UNDERLINE, 0)
}
