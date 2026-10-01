import { forwardRef } from 'react'
import type {
  InstrumentShape,
  InstrumentPalette,
} from '../../../../../packages/whiteboard/src/instruments'
import asset from './lessonAsset.json'

/** The same shape table rendered by the tutor's VirtualCursor. */
export default forwardRef<
  SVGGElement,
  {
    instrument?: 'pen' | 'pencil' | 'highlighter'
    transform?: string
    opacity?: number
  }
>(function DemoPen({ instrument = 'pen', transform, opacity = 0 }, ref) {
  const palette: InstrumentPalette = asset[instrument].palette
  const shapes = asset[instrument].shapes as InstrumentShape[]
  return (
    <g ref={ref} opacity={opacity} transform={transform}>
      {shapes.map((shape, index) => {
        const style = {
          fill: shape.fill ? palette[shape.fill] : 'none',
          stroke: shape.stroke ? palette[shape.stroke] : undefined,
          strokeWidth: shape.strokeWidth,
          opacity: shape.opacity,
        }
        if (shape.kind === 'rect')
          return (
            <rect
              key={index}
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              rx={shape.radius}
              {...style}
            />
          )
        if (shape.kind === 'circle')
          return (
            <circle
              key={index}
              cx={shape.x}
              cy={shape.y}
              r={shape.radius}
              {...style}
            />
          )
        const points = shape.points
          .reduce((path, value, i) => `${path}${i % 2 ? ',' : ' '}${value}`, '')
          .trim()
        return shape.kind === 'stroke' ? (
          <polyline key={index} points={points} {...style} />
        ) : (
          <polygon key={index} points={points} {...style} />
        )
      })}
    </g>
  )
})
