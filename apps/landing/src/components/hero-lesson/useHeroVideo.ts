import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type SoundState = 'loading' | 'unavailable' | 'off' | 'on'

/**
 * True only while the lesson window still overlaps the viewport.
 * A positive rootMargin used to keep the recording "visible" after the box
 * had gone above the screen, so the next section played on with sound.
 * Bottom edge at or above the top of the viewport means it has left: pause.
 */
export function lessonWindowOnScreen(
  rect: { top: number; bottom: number; width: number; height: number },
  viewportHeight: number,
): boolean {
  if (rect.width <= 0 || rect.height <= 0 || viewportHeight <= 0) return false
  return rect.bottom > 0 && rect.top < viewportHeight
}

/** Native inline playback keeps the exported speech and ink on one media clock. */
export function useHeroVideo(rootRef: RefObject<HTMLElement | null>) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const visibleRef = useRef(false)
  const [onScreen, setOnScreen] = useState(false)
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const playbackEnabledRef = useRef(!reduced)
  const [sound, setSound] = useState<SoundState>('off')
  const soundRef = useRef<SoundState>('off')
  const commitSound = useCallback((next: SoundState) => {
    soundRef.current = next
    setSound(next)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    const root = rootRef.current
    if (!video || !root) return

    let frame = 0
    let startPending = false
    const halt = () => {
      // Mute first. Safari can keep a looping clip's audio graph hot after pause().
      video.muted = true
      video.pause()
    }
    const sync = () => {
      frame = 0
      const visible = lessonWindowOnScreen(root.getBoundingClientRect(), window.innerHeight || 1)
      visibleRef.current = visible
      setOnScreen((current) => (current === visible ? current : visible))
      const shouldPlay =
        playbackEnabledRef.current && visible && document.visibilityState !== 'hidden'
      if (!shouldPlay) {
        startPending = false
        if (!video.paused || !video.muted) halt()
        return
      }
      const wantMuted = soundRef.current !== 'on'
      if (video.muted !== wantMuted) video.muted = wantMuted
      if (!video.paused || startPending) return
      startPending = true
      void video.play().then(() => {
        startPending = false
        if (!visibleRef.current || document.visibilityState === 'hidden') halt()
      }).catch((error: unknown) => {
        startPending = false
        if (error instanceof DOMException && error.name === 'AbortError') return
        video.muted = true
        commitSound('off')
      })
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(sync)
    }
    const onPlay = () => {
      if (!visibleRef.current || document.visibilityState === 'hidden') halt()
    }

    sync()
    // Capture so a nested scroller still pauses the lesson the moment the box leaves.
    // The observer is only a wake-up: 3D tilt makes isIntersecting lie, and a
    // padded root used to keep the clip alive after the box had left.
    const observer = new IntersectionObserver(() => sync(), { rootMargin: '0px', threshold: 0 })
    observer.observe(root)
    document.addEventListener('scroll', onScroll, { passive: true, capture: true })
    window.addEventListener('resize', onScroll)
    document.addEventListener('visibilitychange', sync)
    video.addEventListener('play', onPlay)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('visibilitychange', sync)
      video.removeEventListener('play', onPlay)
      halt()
    }
  }, [commitSound, rootRef])

  const toggleSound = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    playbackEnabledRef.current = true
    const turnOn = soundRef.current !== 'on'
    video.muted = !turnOn
    commitSound(turnOn ? 'on' : 'off')
    if (!visibleRef.current || document.visibilityState === 'hidden') {
      video.pause()
      video.muted = true
      return
    }
    void video.play().catch(() => {
      video.muted = true
      commitSound('off')
    })
  }, [commitSound])

  const onReady = useCallback(() => {
    if (!playbackEnabledRef.current) return
    if (soundRef.current !== 'on') commitSound('off')
    if (!visibleRef.current || document.visibilityState === 'hidden') return
    const video = videoRef.current
    if (!video || !video.paused) return
    video.muted = soundRef.current !== 'on'
    void video.play().catch(() => {
      if (videoRef.current) videoRef.current.muted = true
      commitSound('off')
    })
  }, [commitSound])

  const onError = useCallback(() => commitSound('unavailable'), [commitSound])
  return { videoRef, sound, onScreen, toggleSound, reduced, onReady, onError }
}
