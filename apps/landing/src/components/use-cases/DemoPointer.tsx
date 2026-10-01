import { MousePointer2 } from 'lucide-react'
import { smoothGlide } from './demoCamera'
import type { DemoFrame } from './demoTimeline'

/** The pointer travels into each control before clicking, then leaves the ink alone. */
export default function DemoPointer({ frame }: { frame: DemoFrame }) {
  if (frame.beat !== 'doubt') return null
  const t = frame.t
  const first = t >= 0.8 && t < 3.9
  const submit = t >= 11.2 && t < 13.2
  if (!first && !submit) return null
  const glide = first
    ? smoothGlide((t - 0.8) / 1.5)
    : smoothGlide((t - 11.2) / 1.1)
  const leave = first ? smoothGlide((t - 3.2) / 0.5) : 0
  const x = first
    ? 1280 + (1190 - 1280) * glide - 470 * leave
    : 970 + 220 * glide
  const y = first ? 780 + 82 * glide : 740 + 122 * glide
  const fade = Math.min(
    1,
    (t - (first ? 0.8 : 11.2)) / 0.2,
    first ? (3.9 - t) / 0.2 : (13.2 - t) / 0.2,
  )
  const click =
    t >= 2.6 && t < 2.8
      ? (t - 2.6) / 0.2
      : t >= 12.5 && t < 12.7
        ? (t - 12.5) / 0.2
        : 0
  const press = Math.sin(click * Math.PI) * 2
  return (
    <MousePointer2
      className="demo-mouse-pointer"
      strokeWidth={1.4}
      style={{
        opacity: fade,
        transform: `translate(${x + press}px, ${y + press}px)`,
      }}
      aria-hidden="true"
    />
  )
}
