import { useEffect, useRef, useState, type RefObject } from 'react'
import { Volume2 } from 'lucide-react'
import metadata from '../hero-lesson/lessonMetadata.json'
import { useHeroVideo } from '../hero-lesson/useHeroVideo'
import SafariChrome from './SafariChrome'
import { DESIGN_H, DESIGN_W, MOBILE_MQ, SIDEBAR_W } from './windowSize'

/**
 * A recording of the current tutor renderer, with speech and ink muxed onto
 * one clock. Loaded on demand and paused offscreen; reduced-motion users see
 * the finished board until they choose to play the lesson.
 */
export default function LiveLessonWindow({
  visibilityRootRef,
}: {
  visibilityRootRef: RefObject<HTMLElement | null>
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const { videoRef, sound, onScreen, toggleSound, reduced, onReady, onError } = useHeroVideo(visibilityRootRef)
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
          style={{
            width: DESIGN_W * fit,
            height: DESIGN_H * fit,
            marginLeft: cropSidebar ? -SIDEBAR_W * fit : 0,
          }}
        >
          <video
            ref={videoRef}
            src={`/hero/lesson-loop.mp4?v=${metadata.version}`}
            poster={`/hero/lesson-poster.jpg?v=${metadata.version}`}
            width={DESIGN_W}
            height={DESIGN_H}
            muted={sound !== 'on' || !onScreen}
            loop
            playsInline
            preload={reduced ? 'none' : 'metadata'}
            onLoadedData={onReady}
            onError={onError}
            aria-label={`Tutor lesson: ${metadata.question}`}
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'fill' }}
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
