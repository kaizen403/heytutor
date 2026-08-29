"use client";

import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  title?: string;
}

export function Checkbox({
  checked,
  indeterminate = false,
  onCheckedChange,
  id,
  className,
  disabled = false,
  "aria-label": ariaLabel,
  title,
}: CheckboxProps) {
  const filled = checked || indeterminate;
  return (
    <button
      type="button"
      id={id}
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={() => onCheckedChange(indeterminate ? true : !checked)}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          onCheckedChange(indeterminate ? true : !checked);
        }
      }}
      className={cn(
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:pointer-events-none disabled:opacity-50",
        filled
          ? "border-sky-400 bg-sky-500 text-ink-950 shadow-[0_0_10px_-2px_rgba(89,175,212,0.7)]"
          : "border-stroke-strong bg-ink-900 text-transparent hover:border-sky-400/60",
        className,
      )}
    >
      {indeterminate ? (
        <Minus className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      ) : (
        <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      )}
    </button>
  );
}
