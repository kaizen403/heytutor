import { DEMO_DOUBT, DEMO_QUESTION } from './demoCopy.ts'

export type BeatId = 'ask' | 'annotate' | 'doubt' | 'replay' | 'notes'
export const DEMO_DURATION: Record<BeatId, number> = {
  ask: 15,
  annotate: 10,
  doubt: 24,
  replay: 11,
  notes: 10,
}
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const between = (t: number, start: number, end: number) =>
  clamp((t - start) / (end - start))

/** A little breathing room between words, with steady variation between keys. */
function typedCharacters(text: string, progress: number): number {
  const weights = Array.from(text, (character, index) =>
    character === ' ' ? 2.2 : 1 + [0.1, 0.4, 0, 0.2, 0.3][index % 5]!,
  )
  const budget = weights.reduce((sum, weight) => sum + weight, 0) * progress
  let elapsed = 0
  let count = 0
  for (const weight of weights) {
    elapsed += weight
    if (elapsed > budget + 0.001) break
    count++
  }
  return count
}

/** One clock controls the rail, writing, pointer, and product chrome. */
export function demoFrame(beat: BeatId, seconds: number) {
  const t = Math.max(0, Math.min(seconds, DEMO_DURATION[beat]))
  let step = 0
  let input = ''
  let work = 7
  let diagram = 1
  let circle = 0
  let answer = 0
  let pressed = false

  switch (beat) {
    case 'ask':
      step = t < 2.4 ? 0 : t < 3.4 ? 1 : t < 13.4 ? 2 : 3
      input =
        t < 3.4
          ? DEMO_QUESTION.slice(
              0,
              typedCharacters(DEMO_QUESTION, between(t, 0.3, 2.3)),
            )
          : ''
      // One hand finishes the figure, then picks up the pen for the working.
      diagram = between(t, 3.4, 7.2)
      work = between(t, 7.6, 13.4) * 7
      pressed = t >= 2.4 && t < 2.9
      break
    case 'annotate':
      step = t < 1.4 ? 0 : t < 4 ? 1 : t < 7.7 ? 2 : 3
      work = 1 + between(t, 1.4, 8) * 6
      break
    case 'doubt':
      step = t < 3.2 ? 0 : t < 6.5 ? 1 : t < 12.5 ? 2 : 3
      input =
        t >= 3.2 && t < 13.2
          ? DEMO_DOUBT.slice(
              0,
              typedCharacters(DEMO_DOUBT, between(t, 3.2, 5.8)),
            )
          : ''
      circle = between(t, 7.8, 9.8)
      answer = between(t, 14.7, 17.5)
      pressed = (t >= 2.6 && t < 2.8) || (t >= 12.5 && t < 12.7)
      break
    case 'replay':
      step = t < 1.6 ? 0 : t < 3.5 ? 1 : t < 5 ? 2 : 3
      pressed = t >= 0.7 && t < 1.4
      work =
        t < 1.6
          ? 7
          : t < 5
            ? between(t, 3.6, 4.8) * 4
            : 4 + between(t, 5, 8.6) * 3
      diagram = t < 1.6 ? 1 : between(t, 1.6, 3.3)
      break
    case 'notes':
      step = t < 1.4 ? 0 : t < 3.8 ? 1 : t < 6.8 ? 2 : 3
      pressed = t >= 0.6 && t < 1.4
      break
  }
  return {
    beat,
    t,
    step,
    input,
    work,
    diagram,
    circle,
    answer,
    pressed,
    progress: clamp(t / DEMO_DURATION[beat]),
    marking: beat === 'doubt' && t >= 3.2 && t < 13.2,
    thinking: beat === 'doubt' && t >= 13.2 && t < 14.7,
    continued: beat === 'doubt' && t >= 18.5,
  }
}

export type DemoFrame = ReturnType<typeof demoFrame>
