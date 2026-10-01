import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
export type SoundState = 'loading' | 'unavailable' | 'off' | 'on'

/** Native inline playback keeps the exported speech and ink on one media clock. */
export function useHeroVideo(rootRef: RefObject<HTMLElement | null>) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const visibleRef = useRef(false)
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const playbackEnabledRef = useRef(!reduced)
  const [sound, setSound] = useState<SoundState>('off')
  useEffect(() => {
    const video = videoRef.current
    const root = rootRef.current
    if (!video || !root) return
    const syncVisibility = () => {
      if (playbackEnabledRef.current && visibleRef.current && document.visibilityState !== 'hidden') {
        void video.play().catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          video.muted = true
          setSound('off')
        })
      } else video.pause()
    }
    const observer = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting
      syncVisibility()
    }, { rootMargin: '30% 0px', threshold: 0 })
    observer.observe(root)
    document.addEventListener('visibilitychange', syncVisibility)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', syncVisibility); video.pause() }
  }, [rootRef])
  const toggleSound = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    // A gesture can load a preload="none" video and opt into reduced-motion playback.
    playbackEnabledRef.current = true
    const turnOn = video.muted
    video.muted = !turnOn
    setSound(turnOn ? 'on' : 'off')
    void video.play().catch(() => { video.muted = true; setSound('off') })
  }, [])
  const onReady = useCallback(() => {
    if (playbackEnabledRef.current) {
      setSound((current) => current === 'on' ? 'on' : 'off')
      if (visibleRef.current && document.visibilityState !== 'hidden') {
        void videoRef.current?.play().catch(() => {
          if (videoRef.current) videoRef.current.muted = true
          setSound('off')
        })
      }
    }
  }, [])
  const onError = useCallback(() => setSound('unavailable'), [])
  return { videoRef, sound, toggleSound, reduced, onReady, onError }
}
