import { memo, useLayoutEffect, useRef } from 'react'
import { PenSpinner } from '@heytutor/whiteboard/pen-spinner'
import asset from './lessonAsset.json'
import type { DemoFrame } from './demoTimeline'
import StudentMark from './StudentMark'
import DemoPen from './DemoPen'
import DemoPlayback from './DemoPlayback'

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const Ink = memo(function Ink({
  paths,
  progress,
  color = '#1B2A4A',
  width = 2.3,
  opacity = 1,
}: {
  paths: string[]
  progress: number
  color?: string
  width?: number
  opacity?: number
}) {
  return (
    <g
      fill="none"
      stroke={color}
      strokeWidth={width}
      opacity={opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((path, index) => {
        const drawn = clamp(progress * paths.length - index)
        return drawn > 0 ? (
          <path
            key={index}
            d={path}
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={1 - drawn}
            data-writing={drawn < 1 ? 'true' : undefined}
          />
        ) : null
      })}
    </g>
  )
})

export default function UseCaseBoard({ frame }: { frame: DemoFrame }) {
  const board = useRef<SVGSVGElement>(null)
  const pen = useRef<SVGGElement>(null)
  useLayoutEffect(() => {
    const path = board.current?.querySelector<SVGPathElement>(
      '[data-writing="true"]',
    )
    const cursor = pen.current
    if (!cursor) return
    if (!path) {
      cursor.setAttribute('opacity', '0')
      return
    }
    const progress = 1 - Number(path.getAttribute('stroke-dashoffset'))
    const point = path.getPointAtLength(path.getTotalLength() * progress)
    cursor.setAttribute(
      'transform',
      `translate(${point.x} ${point.y}) rotate(-33)`,
    )
    cursor.setAttribute('opacity', '1')
  }, [frame.work, frame.diagram, frame.answer])
  return (
    <div className="use-case-paper">
      <svg
        ref={board}
        viewBox="0 0 1200 700"
        className="demo-board-svg"
        aria-hidden="true"
      >
        {asset.diagram.map((primitive, index) => (
          <Ink
            key={primitive.id}
            paths={primitive.paths}
            progress={clamp(frame.diagram * asset.diagram.length - index)}
            color={asset.pencilInk.color}
            width={(primitive.label ? 2 : 2.7) * asset.pencilInk.widthScale}
            opacity={asset.pencilInk.opacity}
          />
        ))}
        {asset.work.map((row, index) => (
          <Ink
            key={row.text}
            paths={row.paths}
            progress={clamp(frame.work - index)}
          />
        ))}
        {asset.answer.map((row, index) => (
          <Ink
            key={row.text}
            paths={row.paths}
            progress={clamp(frame.answer - index)}
          />
        ))}
        <DemoPen
          ref={pen}
          instrument={frame.diagram > 0 && frame.diagram < 1 ? 'pencil' : 'pen'}
        />
      </svg>
      <StudentMark
        progress={frame.circle}
        time={frame.t}
        armed={frame.marking}
      />
      {frame.marking && <div className="demo-board-armed" />}
      {frame.beat === 'ask' && frame.step === 1 && (
        <div className="demo-preparing">
          <PenSpinner size={44} ink="#1B2A4A" trail={false} />
          <span>Preparing your lesson</span>
        </div>
      )}
      {frame.thinking && (
        <div className="demo-doubt-thinking">
          <PenSpinner size={32} ink="#1B2A4A" trail={false} />
        </div>
      )}
      {frame.beat === 'replay' && frame.t >= 1.6 && (
        <DemoPlayback frame={frame} />
      )}
    </div>
  )
}
