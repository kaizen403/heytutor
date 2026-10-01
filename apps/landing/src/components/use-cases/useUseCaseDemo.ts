import { useEffect, useRef, useState } from 'react'
import { DEMO_DURATION, demoFrame, type BeatId } from './demoTimeline'

export function useUseCaseDemo(
  beat: BeatId,
  playing: boolean,
  visible: boolean,
  reduced: boolean,
  run: number,
  onCycle: () => void,
) {
  const clock = useRef({ beat, run, elapsed: 0 })
  const [sample, setSample] = useState({ beat, run, seconds: 0 })
  const cycle = useRef(onCycle)
  useEffect(() => {
    cycle.current = onCycle
  }, [onCycle])

  useEffect(() => {
    if (clock.current.beat !== beat || clock.current.run !== run)
      clock.current = { beat, run, elapsed: 0 }
    if (!playing || !visible || reduced) return
    let raf = 0
    let previous = performance.now()
    const tick = (now: number) => {
      // Accumulate only visible, playing time. Resume never restarts a doubt.
      clock.current.elapsed += (now - previous) / 1000
      previous = now
      setSample({ beat, run, seconds: clock.current.elapsed })
      if (clock.current.elapsed >= DEMO_DURATION[beat]) {
        clock.current.elapsed = 0
        cycle.current()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [beat, playing, visible, reduced, run])

  const seconds = reduced
    ? DEMO_DURATION[beat]
    : sample.beat === beat && sample.run === run
      ? sample.seconds
      : 0
  return demoFrame(beat, seconds)
}
