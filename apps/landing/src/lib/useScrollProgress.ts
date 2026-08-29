import { useEffect, useRef, useState } from 'react'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * How far an element has travelled across the viewport, 0 → 1.
 *
 * 0 when its top edge is at the bottom of the viewport, 1 once its bottom edge
 * has passed the top. Unlike `Reveal`, which latches once on entry, this keeps
 * updating for the whole pass, so motion driven by it tracks the scroll rather
 * than firing and finishing.
 *
 * Reads are rAF-throttled and the listener is passive, so scrolling stays on
 * the compositor. Under `prefers-reduced-motion` it pins to the settled value
 * and never subscribes.
 */
export function useScrollProgress(ref: React.RefObject<HTMLElement | null>): number {
  const [progress, setProgress] = useState(() => (prefersReducedMotion() ? 1 : 0))
  const frame = useRef(0)

  useEffect(() => {
    const node = ref.current
    if (!node || prefersReducedMotion()) return

    const measure = () => {
      frame.current = 0
      const rect = node.getBoundingClientRect()
      const vh = window.innerHeight || 1
      // Span runs from "top edge entering at the fold" to "bottom edge leaving".
      const span = vh + rect.height
      const travelled = vh - rect.top
      const next = Math.min(1, Math.max(0, travelled / span))
      setProgress((current) => (Math.abs(current - next) > 0.002 ? next : current))
    }

    const onScroll = () => {
      if (frame.current) return
      frame.current = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [ref])

  return progress
}

/** Remap a slice of a 0–1 range back onto 0–1, clamped at both ends. */
export function slice(value: number, from: number, to: number): number {
  if (to <= from) return value >= to ? 1 : 0
  return Math.min(1, Math.max(0, (value - from) / (to - from)))
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
