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
  /** ice = white key (primary), sky = accent, ghost = a step of the ground, danger = destructive. */
  variant?: SiteButtonVariant;
  size?: SiteButtonSize;
  block?: boolean;
}

/**
 * The app's button (`.btn` in globals.css): a flat filled rectangle that
 * answers by changing its fill. It used to be a pedestal shared with the
 * landing site; the tutor's own theme has no light to model, so the cap and
 * its base are gone. The landing still has them.
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
 * The same face, for dense inline and icon-only actions. Same palette and
 * type; size it with utility classes.
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
