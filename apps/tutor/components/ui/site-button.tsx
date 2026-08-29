"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type SiteButtonVariant = "ice" | "sky" | "ghost" | "danger";
type SiteButtonSize = "xs" | "sm" | "md";

/* Written out rather than interpolated so the class scanner keeps them. */
const VARIANT_CLASS: Record<SiteButtonVariant, string> = {
  ice: "btn-ice",
  sky: "btn-sky",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

const SIZE_CLASS: Record<SiteButtonSize, string> = {
  xs: "btn-xs",
  sm: "btn-sm",
  md: "btn-md",
};

export interface SiteButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** ice = frost keycap (primary), sky = accent, ghost = raised navy, danger = destructive. */
  variant?: SiteButtonVariant;
  size?: SiteButtonSize;
  block?: boolean;
}

/**
 * Pedestal button, shared with the landing site (`.btn` in globals.css).
 * The cap drops onto its base when pressed without moving the outer box.
 */
export const SiteButton = React.forwardRef<HTMLButtonElement, SiteButtonProps>(
  ({ variant = "ghost", size = "sm", block = false, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn("btn", VARIANT_CLASS[variant], SIZE_CLASS[size], block && "btn-block", className)}
      {...props}
    />
  ),
);
SiteButton.displayName = "SiteButton";

export interface PlainButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: SiteButtonVariant;
}

/**
 * Flat sibling of the pedestal, for dense inline actions where a raised cap
 * would be too heavy. Same palette and type; size it with utility classes.
 */
export const PlainButton = React.forwardRef<HTMLButtonElement, PlainButtonProps>(
  ({ variant = "ghost", className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "btn-plain h-7 rounded-md px-2 text-[10px]",
        VARIANT_CLASS[variant],
        className,
      )}
      {...props}
    />
  ),
);
PlainButton.displayName = "PlainButton";
