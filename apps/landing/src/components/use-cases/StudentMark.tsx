import { useEffect, useRef } from 'react'
import { paintBoardMarks } from '@heytutor/whiteboard/marker-ink'
import asset from './lessonAsset.json'
import { smoothGlide } from './demoCamera'
import DemoPen from './DemoPen'

const selected = asset.work[6]!
const target = {
  x: selected.x,
  y: selected.y,
  width: selected.width,
  height: selected.size,
}
const cx = target.x + target.width / 2
const cy = target.y + target.height / 2
const points = Array.from({ length: 181 }, (_, index) => {
  const angle = (index / 180) * Math.PI * 2
  const wobble = Math.sin(angle * 3) * 1.8
  return {
    x: cx + (target.width / 2 + 27 + wobble) * Math.cos(angle),
    y: cy + (target.height / 2 + 18 + wobble) * Math.sin(angle),
  }
})
/** The live chisel ink, with the tutor's full highlighter held by its felt tip. */
export default function StudentMark({
  progress,
  time,
  armed,
}: {
  progress: number
  time: number
  armed: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const count = Math.floor(progress * (points.length - 1)) + 1
  const current = points[Math.min(count - 1, points.length - 1)]!
  const approach = 1 - smoothGlide((time - 6.5) / 1.3)
  const tip = { x: current.x + 30 * approach, y: current.y + 35 * approach }
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    context.setTransform(2, 0, 0, 2, 0, 0)
    context.clearRect(0, 0, 1200, 700)
    if (progress <= 0) return
    const stroke = points.slice(0, count)
    paintBoardMarks(
      context,
      progress === 1
        ? [{ points: stroke, targets: [{ kind: 'work', rect: target }] }]
        : [],
      progress < 1 ? stroke : [],
    )
  }, [progress, count])
  return (
    <>
      <canvas
        ref={canvas}
        className="demo-student-mark"
        width={2400}
        height={1400}
        aria-hidden="true"
      />
      {armed && time >= 6.5 && progress < 1 && (
        <svg
          className="demo-marker-cursor"
          viewBox="0 0 1200 700"
          aria-hidden="true"
        >
          <DemoPen
            instrument="highlighter"
            opacity={Math.min(1, (time - 6.5) / 0.2)}
            transform={`translate(${tip.x} ${tip.y}) rotate(-33)`}
          />
        </svg>
      )}
    </>
  )
}
