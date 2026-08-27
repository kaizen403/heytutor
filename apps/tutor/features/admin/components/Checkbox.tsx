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
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9C9D2] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0B0C] disabled:pointer-events-none disabled:opacity-50",
        filled
          ? "border-[#C9C9D2] bg-[#C9C9D2] text-[#0B0B0C]"
          : "border-[#2E2E33] bg-[#151517] text-transparent hover:border-[rgba(201,201,210,0.45)]",
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
