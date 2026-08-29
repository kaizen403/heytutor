import Logo from './Logo'

type Size = 'sm' | 'md' | 'lg'

/* Written out rather than interpolated so Tailwind's content scanner keeps
   these `@layer components` rules in the build. */
const SIZE_CLASS: Record<Size, string> = {
  sm: 'brand--sm',
  md: '',
  lg: 'brand--lg',
}

interface BrandProps {
  /** Renders an <a> when given, a plain <span> otherwise. */
  href?: string
  size?: Size
  className?: string
}

/**
 * The Accelute lockup — the mark beside the wordmark, one ink, no container.
 *
 * This is the one wordmark treatment; the spec lives in `.brand` (index.css)
 * and is mirrored in apps/tutor so both apps render an identical brand.
 */
export default function Brand({ href, size = 'md', className }: BrandProps) {
  const classes = ['brand', SIZE_CLASS[size], className].filter(Boolean).join(' ')

  const lockup = (
    <>
      <Logo className="brand__mark" />
      <span className="brand__word">Accelute</span>
    </>
  )

  if (href) {
    return (
      <a className={classes} href={href} aria-label="Accelute — home">
        {lockup}
      </a>
    )
  }

  return <span className={classes}>{lockup}</span>
}
