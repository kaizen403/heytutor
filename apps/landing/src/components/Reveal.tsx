import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'

/** How the element arrives. See `.reveal--*` in index.css. */
export type RevealVariant = 'up' | 'left' | 'right' | 'rise' | 'fade'

interface RevealProps {
  children: ReactNode
  /** Stagger in ms, applied as a transition-delay once the element enters view. */
  delay?: number
  variant?: RevealVariant
  /** Stagger direct children instead of the element itself. */
  group?: boolean
  className?: string
  as?: ElementType
}

/** Environments without IntersectionObserver (older browsers, SSR) render revealed. */
const canObserve = () => typeof IntersectionObserver !== 'undefined'

const VARIANT_CLASS: Record<RevealVariant, string> = {
  up: '',
  left: 'reveal--left',
  right: 'reveal--right',
  rise: 'reveal--rise',
  fade: 'reveal--fade',
}

/**
 * Scroll-triggered entrance. Adds `.is-visible` the first time the element
 * crosses into the viewport; the motion itself is CSS, so this stays off the
 * main thread and costs nothing in bundle size.
 *
 * With `group`, the element is the observer and its direct children animate in
 * sequence — one observer for a whole row of cards rather than one each.
 * Reduced motion is handled by the stylesheet, so there is no JS branch here.
 */
export default function Reveal({
  children,
  delay = 0,
  variant = 'up',
  group = false,
  className = '',
  as,
}: RevealProps) {
  const Tag = (as ?? 'div') as ElementType
  const ref = useRef<HTMLElement>(null)
  // Resolved at mount rather than in an effect, so the no-observer fallback
  // never triggers a cascading render.
  const [visible, setVisible] = useState(() => !canObserve())

  useEffect(() => {
    const node = ref.current
    if (!node || !canObserve()) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect()
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const base = group ? 'reveal-group' : `reveal ${VARIANT_CLASS[variant]}`

  return (
    <Tag
      ref={ref}
      className={`${base} ${visible ? 'is-visible' : ''} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}
