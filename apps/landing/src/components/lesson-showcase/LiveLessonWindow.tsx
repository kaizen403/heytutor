import { useEffect, useRef, useState, type RefObject } from 'react'
import { Volume2 } from 'lucide-react'
import DashboardMockup from '../DashboardMockup'
import { QUESTION_TEXT } from '../hero-lesson/lessonScript'
import { heroLessonLocaleLabel } from '../hero-lesson/heroLessonLocale'
import { useHeroLessonLocale } from '../hero-lesson/useHeroLessonLocale'
import { useLessonSimulation } from '../hero-lesson/useLessonSimulation'
import SafariChrome from './SafariChrome'
import { COMPACT_DESIGN_W, DESIGN_H, DESIGN_W, MOBILE_MQ } from './windowSize'

/**
 * The shipping whiteboard renderer playing a verified lesson on its own clock.
 * Mobile removes the desktop sidebar before scaling, so no part of the board
 * is cropped or digitally zoomed.
 */
export default function LiveLessonWindow({
  visibilityRootRef,
}: {
  visibilityRootRef: RefObject<HTMLElement | null>
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const locale = useHeroLessonLocale()
  const drive = useLessonSimulation(visibilityRootRef, locale)
  const [view, setView] = useState({ fit: 0, compact: false })

  useEffect(() => {
    const node = bodyRef.current
    if (!node) return
    const mobile = window.matchMedia(MOBILE_MQ)
    const measure = () => {
      const compact = mobile.matches
      setView({ fit: node.clientWidth / (compact ? COMPACT_DESIGN_W : DESIGN_W), compact })
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

  const { fit, compact } = view
  const language = heroLessonLocaleLabel(locale)

  return (
    <>
      <SafariChrome sound={drive.sound} onToggle={drive.toggleSound} locale={locale} />
      <div ref={bodyRef} className="overflow-hidden" style={{ height: DESIGN_H * fit }}>
        <div
          className="origin-top-left"
          style={{
            width: compact ? COMPACT_DESIGN_W : DESIGN_W,
            height: DESIGN_H,
            transform: `scale(${fit})`,
          }}
        >
          <DashboardMockup
            compact={compact}
            locale={locale}
            drive={{ question: QUESTION_TEXT, ...drive }}
          />
        </div>
      </div>
      {drive.sound === 'off' && (
        <button
          type="button"
          data-sound-toggle
          onClick={drive.toggleSound}
          aria-label={`Play lesson voice in ${language}`}
          className="lsn-listen absolute bottom-2 left-1/2 z-20 flex min-h-9 -translate-x-1/2 cursor-pointer touch-manipulation items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-[11px] font-medium text-[#F2F2F4] sm:bottom-7 sm:min-h-0 sm:gap-2 sm:px-5 sm:py-2.5 sm:text-[14px]"
          style={{
            background: 'rgba(21, 21, 23, 0.94)',
            border: '1px solid rgba(242, 242, 244, 0.12)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <Volume2 size={14} aria-hidden />
          Hear this lesson · {language}
        </button>
      )}
    </>
  )
}
