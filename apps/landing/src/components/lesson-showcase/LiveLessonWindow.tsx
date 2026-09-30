import { useEffect, useRef, useState, type RefObject } from 'react'
import { Volume2 } from 'lucide-react'
import DashboardMockup from '../DashboardMockup'
import { QUESTION_TEXT } from '../hero-lesson/lessonScript'
import { useLessonSimulation } from '../hero-lesson/useLessonSimulation'
import SafariChrome from './SafariChrome'
import { DESIGN_H, DESIGN_W, MOBILE_MQ, SIDEBAR_W } from './windowSize'

/**
 * The live, self-driving mockup inside the Safari window — the same
 * DashboardMockup /record.html renders, running its own lesson on its own
 * clock. The simulation observes the window body, so the lesson pauses itself
 * when the window scrolls offscreen (and reduced-motion users get the
 * completed board with sound 'unavailable' — no poster branch needed).
 *
 * Loaded on demand: this module pulls in the whiteboard renderer and the
 * lesson voice, which the first screen never needs.
 */
export default function LiveLessonWindow({
  visibilityRootRef,
}: {
  visibilityRootRef: RefObject<HTMLElement | null>
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const { snapshot, sound, toggleSound, boardRef, cursorState } = useLessonSimulation(visibilityRootRef)
  const [view, setView] = useState({ fit: 0, cropSidebar: false })

  useEffect(() => {
    const node = bodyRef.current
    if (!node) return
    const mobile = window.matchMedia(MOBILE_MQ)
    const measure = () => {
      const crop = mobile.matches
      setView({ fit: node.clientWidth / (crop ? DESIGN_W - SIDEBAR_W : DESIGN_W), cropSidebar: crop })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    mobile.addEventListener('change', measure)
    return () => {
      observer.disconnect()
      mobile.removeEventListener('change', measure)
    }
  }, [])

  const { fit, cropSidebar } = view

  return (
    <>
      <SafariChrome sound={sound} onToggle={toggleSound} />
      <div ref={bodyRef} className="overflow-hidden" style={{ height: DESIGN_H * fit }}>
        <div
          className="origin-top-left"
          style={{
            width: DESIGN_W,
            height: DESIGN_H,
            transform: `translateX(${cropSidebar ? -SIDEBAR_W * fit : 0}px) scale(${fit})`,
          }}
        >
          <DashboardMockup
            drive={{ question: QUESTION_TEXT, snapshot, sound, toggleSound, boardRef, cursorState }}
          />
        </div>
      </div>
      {sound === 'off' && (
        <button
          type="button"
          data-sound-toggle
          onClick={toggleSound}
          aria-label="Play lesson voice"
          className="lsn-listen absolute bottom-5 left-1/2 z-20 flex min-h-11 -translate-x-1/2 cursor-pointer touch-manipulation items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-medium text-[#F2F2F4] sm:bottom-7 sm:min-h-0 sm:px-5 sm:text-[14px]"
          style={{
            background: 'rgba(21, 21, 23, 0.94)',
            border: '1px solid rgba(242, 242, 244, 0.12)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <Volume2 size={16} aria-hidden />
          Hear this lesson
        </button>
      )}
    </>
  )
}
