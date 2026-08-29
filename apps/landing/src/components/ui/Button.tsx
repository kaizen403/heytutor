import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react'

type Variant = 'ice' | 'sky' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

/* Written out rather than interpolated so Tailwind's content scanner keeps
   these `@layer components` rules in the build. */
const VARIANT_CLASS: Record<Variant, string> = {
  ice: 'btn-ice',
  sky: 'btn-sky',
  ghost: 'btn-ghost',
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'btn-sm',
  md: 'btn-md',
  lg: 'btn-lg',
}

interface Shared {
  /** ice = frost keycap (primary), sky = accent, ghost = raised navy slab. */
  variant?: Variant
  size?: Size
  /** Stretch to the parent's width. */
  block?: boolean
  className?: string
  children: ReactNode
}

type AsAnchor = Shared & { href: string } & Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    keyof Shared | 'href'
  >

type AsButton = Shared & { href?: never } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    keyof Shared
  >

export type ButtonProps = AsAnchor | AsButton

/**
 * Pedestal button — a cap resting on a taller base (see `.btn` in index.css).
 * Clicking drops the cap onto the base without moving the outer box.
 *
 * Renders an <a> when `href` is passed, a <button> otherwise. Children sit
 * directly in the flex row, so an icon beside the label just works.
 */
export default function Button({
  variant = 'ice',
  size = 'md',
  block = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    block ? 'btn-block' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (typeof rest.href === 'string') {
    const anchorProps = rest as AnchorHTMLAttributes<HTMLAnchorElement>
    return (
      <a className={classes} {...anchorProps}>
        {children}
      </a>
    )
  }

  const { href: _href, ...buttonProps } = rest as ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: never
  }
  return (
    <button type="button" className={classes} {...buttonProps}>
      {children}
    </button>
  )
}
