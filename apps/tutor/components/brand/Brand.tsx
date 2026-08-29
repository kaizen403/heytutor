import { SITE_NAME } from "@/lib/site";

import { Logo } from "./Logo";

type Size = "sm" | "md" | "lg";

const SIZE_CLASS: Record<Size, string> = {
  sm: "brand--sm",
  md: "",
  lg: "brand--lg",
};

interface BrandProps {
  /** Renders an <a> when given, a plain <span> otherwise. */
  href?: string;
  size?: Size;
  className?: string;
}

/**
 * The Accelute lockup — the mark beside the wordmark, one ink, no container.
 *
 * This is the one wordmark treatment; the spec lives in `.brand` (globals.css)
 * and is mirrored in apps/landing so both apps render an identical brand.
 */
export function Brand({ href, size = "md", className }: BrandProps) {
  const classes = ["brand", SIZE_CLASS[size], className]
    .filter(Boolean)
    .join(" ");

  const lockup = (
    <>
      <Logo className="brand__mark" />
      <span className="brand__word">{SITE_NAME}</span>
    </>
  );

  if (href) {
    return (
      <a className={classes} href={href} aria-label={`${SITE_NAME} — home`}>
        {lockup}
      </a>
    );
  }

  return <span className={classes}>{lockup}</span>;
}
