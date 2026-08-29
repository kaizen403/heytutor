/**
 * Second hero lesson: three 12 Ω resistors solved in series and in parallel.
 * The two networks are drawn one above the other on the right so the punchline —
 * 36 Ω against 4 Ω from the identical parts — is visible without scrolling the
 * board. Ink is rendered by the real @heytutor/whiteboard renderer through the
 * same flyCursorTo → writeText → drawShape → drawAnnotation idiom the live tutor
 * uses; canvas coordinates are the product's 1200×700 board space.
 *
 * No TTS track exists for this script yet, so the pen runs on fixed durations
 * instead of damping against an audio clock.
 */
import type { WhiteboardHandle } from '@heytutor/whiteboard'
import type { LessonSegment } from './lessonScript'

export const RESISTORS_QUESTION =
  'Three 12 ohm resistors in series and in parallel. Find both equivalent resistances and draw each circuit.'

export const RESISTORS_SEGMENTS: LessonSegment[] = [
  {
    speech: 'We have three twelve ohm resistors, and we want the equivalent resistance two ways: wired in series, then wired in parallel.',
    bubble: 'three 12 Ω resistors · series, then parallel',
    fallbackDuration: 7.4,
  },
  {
    speech: 'In series the current has only one path, so it passes through every resistor in turn and the resistances just add: R equals R one plus R two plus R three.',
    bubble: 'series: one path, so R = R₁ + R₂ + R₃',
    fallbackDuration: 8.6,
  },
  {
    speech: 'Twelve plus twelve plus twelve is thirty six ohms — larger than any single resistor on its own.',
    bubble: 'series total = 36 Ω',
    fallbackDuration: 6.2,
  },
  {
    speech: 'In parallel the current splits across three branches, so we add the reciprocals instead: one over R equals one over twelve, three times.',
    bubble: 'parallel: 1/R = 1/12 + 1/12 + 1/12',
    fallbackDuration: 8.2,
  },
  {
    speech: 'That is three twelfths, which is one quarter, so the equivalent resistance is four ohms.',
    bubble: 'parallel total = 4 Ω',
    fallbackDuration: 5.6,
  },
  {
    speech: 'Same three resistors, and the series value is nine times the parallel one. Giving the current more paths always lowers the resistance.',
    bubble: '36 Ω vs 4 Ω — more paths, less resistance',
    fallbackDuration: 7.6,
  },
]

/* ── Board geometry ───────────────────────────────────────────────────────── */

const WORK_X = 70
const FONT_SIZE = 32
const LABEL_SIZE = 22

const LINE_GIVEN = { text: 'Given: R₁ = R₂ = R₃ = 12 Ω', y: 130 }
const LINE_SERIES_RULE = { text: 'Series:  R = R₁+R₂+R₃', y: 202 }
const LINE_SERIES_ANSWER = { text: 'R = 36 Ω', y: 274 }
const LINE_PARALLEL_RULE = { text: 'Parallel: 1/R = 1/12 × 3', y: 346 }
const LINE_PARALLEL_ANSWER = { text: 'R = 4 Ω', y: 418 }

const UNDERLINE_SERIES = 'M 68 306 L 196 306'
const UNDERLINE_PARALLEL = 'M 68 450 L 180 450'

/**
 * Series loop: battery on the left rail (long plate = +), three resistors in a
 * row along the top wire, return path down the right and back along the bottom.
 * Every resistor spans 100 px with a ±12 px zig-zag, so the plain wire segments
 * start and end exactly on the resistor endpoints.
 */
const SERIES = {
  batteryPlus: 'M 556 210 L 604 210',
  batteryMinus: 'M 568 230 L 592 230',
  leadTop: 'M 580 210 L 580 150 L 620 150',
  r1: 'M 620 150 L 630 138 L 650 162 L 670 138 L 690 162 L 710 138 L 720 150',
  wire12: 'M 720 150 L 780 150',
  r2: 'M 780 150 L 790 138 L 810 162 L 830 138 L 850 162 L 870 138 L 880 150',
  wire23: 'M 880 150 L 940 150',
  r3: 'M 940 150 L 950 138 L 970 162 L 990 138 L 1010 162 L 1030 138 L 1040 150',
  returnRight: 'M 1040 150 L 1120 150 L 1120 290',
  returnBottom: 'M 1120 290 L 580 290 L 580 230',
}

/**
 * Parallel network: the same battery feeding two node rails at x = 700 and
 * x = 1000, with the three resistors bridging them at y = 408 / 472 / 536.
 * Each rail is one stroke from its battery plate so the terminals, the corner
 * runs and the rail itself cannot drift apart.
 */
const PARALLEL = {
  batteryPlus: 'M 596 489 L 644 489',
  batteryMinus: 'M 608 509 L 632 509',
  railA: 'M 620 489 L 620 408 L 700 408 L 700 536',
  railB: 'M 620 509 L 620 590 L 1000 590 L 1000 408',
  b1Left: 'M 700 408 L 800 408',
  b1: 'M 800 408 L 810 396 L 830 420 L 850 396 L 870 420 L 890 396 L 900 408',
  b1Right: 'M 900 408 L 1000 408',
  b2Left: 'M 700 472 L 800 472',
  b2: 'M 800 472 L 810 460 L 830 484 L 850 460 L 870 484 L 890 460 L 900 472',
  b2Right: 'M 900 472 L 1000 472',
  b3Left: 'M 700 536 L 800 536',
  b3: 'M 800 536 L 810 524 L 830 548 L 850 524 L 870 548 L 890 524 L 900 536',
  b3Right: 'M 900 536 L 1000 536',
}

const VALUE_LABELS = [
  { text: '12 Ω', x: 649, y: 176 },
  { text: '12 Ω', x: 809, y: 176 },
  { text: '12 Ω', x: 969, y: 176 },
  { text: '12 Ω', x: 829, y: 426 },
  { text: '12 Ω', x: 829, y: 490 },
  { text: '12 Ω', x: 829, y: 554 },
]

const SERIES_TOTAL = { text: 'R = 36 Ω', x: 810, y: 306 }
const PARALLEL_TOTAL = { text: 'R = 4 Ω', x: 776, y: 600 }

/** The lesson in the order it is taught. A use case can pose some of these
 *  instantly and animate only the part it is actually about. */
export type ResistorsStage = 'work' | 'series' | 'parallel' | 'labels' | 'marks'

export const RESISTORS_STAGES: ResistorsStage[] = ['work', 'series', 'parallel', 'labels', 'marks']

export interface DrawResistorsOptions {
  isCancelled: () => boolean
  /** Rendered with no animation first, so the board starts already showing them. */
  prefill?: ResistorsStage[]
  /** Animated, in order. Defaults to everything not prefilled. */
  animate?: ResistorsStage[]
  /** Multiplier on every duration; 2 draws twice as fast. */
  speed?: number
}

export async function drawResistorsLesson(
  board: WhiteboardHandle,
  opts: DrawResistorsOptions,
): Promise<void> {
  const cancel = opts.isCancelled
  const ok = () => !opts.isCancelled()
  const prefill = new Set(opts.prefill ?? [])
  const animate = opts.animate ?? RESISTORS_STAGES.filter((stage) => !prefill.has(stage))
  const speed = opts.speed ?? 1

  /* Posing and drawing are the same calls at different durations: a prefilled
     stage runs at zero so it is simply present, an animated one runs at its
     authored pace. That keeps one source of geometry for both. */
  let instant = false
  const ms = (base: number) => (instant ? 0 : Math.max(1, Math.round(base / speed)))
  const fly = async (x: number, y: number, base: number, lift?: number) => {
    if (instant) {
      board.setCursorPos(x, y)
      return
    }
    await board.flyCursorTo(x, y, base, lift)
  }

  const work = async () => {
    board.setCursorState(instant ? 'idle' : 'speaking')
    board.setCursorPos(WORK_X, LINE_GIVEN.y)
    for (const line of [
      LINE_GIVEN,
      LINE_SERIES_RULE,
      LINE_SERIES_ANSWER,
      LINE_PARALLEL_RULE,
      LINE_PARALLEL_ANSWER,
    ]) {
      await fly(WORK_X, line.y, 130, -35)
      if (!ok()) return
      await board.writeText(line.text, WORK_X, line.y, ms(900), undefined, FONT_SIZE, cancel)
      if (!ok()) return
    }
  }

  const series = async () => {
    board.setCursorState(instant ? 'idle' : 'drawing')
    await fly(580, 210, 220)
    for (const [shape, base] of [
      [SERIES.batteryPlus, 160],
      [SERIES.batteryMinus, 130],
      [SERIES.leadTop, 320],
      [SERIES.r1, 480],
      [SERIES.wire12, 240],
      [SERIES.r2, 480],
      [SERIES.wire23, 240],
      [SERIES.r3, 480],
      [SERIES.returnRight, 520],
      [SERIES.returnBottom, 900],
    ] as const) {
      await board.drawShape(shape, ms(base), { shouldCancel: cancel })
      if (!ok()) return
    }
  }

  const parallel = async () => {
    board.setCursorState(instant ? 'idle' : 'drawing')
    await fly(620, 489, 260)
    for (const [shape, base] of [
      [PARALLEL.batteryPlus, 160],
      [PARALLEL.batteryMinus, 130],
      [PARALLEL.railA, 640],
      [PARALLEL.railB, 1000],
      [PARALLEL.b1Left, 300],
      [PARALLEL.b1, 480],
      [PARALLEL.b1Right, 300],
      [PARALLEL.b2Left, 300],
      [PARALLEL.b2, 480],
      [PARALLEL.b2Right, 300],
      [PARALLEL.b3Left, 300],
      [PARALLEL.b3, 480],
      [PARALLEL.b3Right, 300],
    ] as const) {
      await board.drawShape(shape, ms(base), { shouldCancel: cancel })
      if (!ok()) return
    }
  }

  const labels = async () => {
    board.setCursorState(instant ? 'idle' : 'speaking')
    for (const label of VALUE_LABELS) {
      await fly(label.x, label.y, 90)
      if (!ok()) return
      await board.writeText(label.text, label.x, label.y, ms(240), undefined, LABEL_SIZE, cancel)
      if (!ok()) return
    }
    for (const total of [SERIES_TOTAL, PARALLEL_TOTAL]) {
      await fly(total.x, total.y, 110)
      if (!ok()) return
      await board.writeText(total.text, total.x, total.y, ms(320), undefined, LABEL_SIZE, cancel)
      if (!ok()) return
    }
  }

  const marks = async () => {
    await board.drawAnnotation('underline', UNDERLINE_SERIES, ms(380), { shouldCancel: cancel })
    if (!ok()) return
    await board.drawAnnotation('underline', UNDERLINE_PARALLEL, ms(360), { shouldCancel: cancel })
  }

  const RUN: Record<ResistorsStage, () => Promise<void>> = { work, series, parallel, labels, marks }

  instant = true
  for (const stage of RESISTORS_STAGES) {
    if (!prefill.has(stage)) continue
    await RUN[stage]()
    if (!ok()) return
  }

  instant = false
  for (const stage of animate) {
    await RUN[stage]()
    if (!ok()) return
  }

  board.setCursorState('idle')
}
