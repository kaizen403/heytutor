import { useEffect, useRef, useState, type CSSProperties } from 'react'
import UseCaseBoard from './UseCaseBoard'
import DemoComposer from './DemoComposer'
import DemoPointer from './DemoPointer'
import { DesktopHeader, DesktopSidebar } from './DesktopChrome'
import { DEMO_ANSWER, DEMO_STEPS } from './demoCopy'
import { demoCamera, LAPTOP } from './demoCamera'
import type { DemoFrame } from './demoTimeline'
import asset from './lessonAsset.json'
import './useCases.css'

/** A camera over one fixed desktop session; never a responsive mini-app. */
export default function DashboardStage({ frame }: { frame: DemoFrame }) {
  const viewport = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(1)
  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFit(entry.contentRect.width / LAPTOP.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const camera = demoCamera(frame.beat, frame.t)
  return (
    <div ref={viewport} className="use-case-viewport">
      <div
        className="use-case-laptop"
        role="img"
        aria-label="A walkthrough of the full desktop tutor app"
        style={{ ...asset.theme, transform: `scale(${fit})` } as CSSProperties}
      >
        <div
          className="use-case-camera"
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          }}
        >
          <DesktopSidebar />
          <div className="demo-session-main">
            <DesktopHeader frame={frame} />
            <div className="use-case-board-frame">
              <UseCaseBoard frame={frame} />
            </div>
            <DemoComposer frame={frame} />
          </div>
          <DemoPointer frame={frame} />
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {DEMO_STEPS[frame.beat][frame.step]}
      </span>
      {frame.answer > 0 && <p className="sr-only">{DEMO_ANSWER}</p>}
    </div>
  )
}
