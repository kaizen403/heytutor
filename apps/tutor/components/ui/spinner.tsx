import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

interface SpinnerProps {
  /** Outer diameter in px. */
  size?: number;
  /** Ring thickness. Defaults to a tenth of the diameter, floored at 1.5px. */
  thickness?: number;
  /** Accessible name. Omit where adjacent text already says what is pending. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * The plain loading ring, drawn in `currentColor`.
 *
 * The twirling clicker pen (`PenSpinner`) is the board's own pending mark,
 * kept in `@heytutor/whiteboard` for the landing's board mockups; the tutor
 * board's boot and thinking states draw the sky arc instead. Everywhere else
 * — the top bar, the sidebar, menus, side panels — waiting is just waiting,
 * and gets this.
 */
export function Spinner({ size = 16, thickness, label, className, style }: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block shrink-0 animate-spin rounded-full align-middle", className)}
      style={{
        width: size,
        height: size,
        borderWidth: thickness ?? Math.max(1.5, size / 10),
        borderStyle: "solid",
        borderColor: "currentColor",
        // The gap in the ring is what makes the rotation readable.
        borderTopColor: "transparent",
        ...style,
      }}
    />
  );
}
