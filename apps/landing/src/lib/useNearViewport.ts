import { useEffect, useState, type RefObject } from 'react'

/** Flips to true, once, when `ref` comes within `rootMargin` of the viewport.
    Used to hold back heavy chunks until a section is actually within reach. */
export function useNearViewport(ref: RefObject<Element | null>, rootMargin = '150% 0px') {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const node = ref.current
    if (near || !node) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true)
      },
      { rootMargin },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [near, ref, rootMargin])

  return near
}
