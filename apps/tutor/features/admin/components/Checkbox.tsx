"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
}

export function Checkbox({
  checked,
  onCheckedChange,
  id,
  className,
  disabled = false,
}: CheckboxProps) {
  return (
    <button
      type="button"
      id={id}
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          onCheckedChange(!checked);
        }
      }}
      className={cn(
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        checked
          ? "border-[#2563EB] bg-[#2563EB] text-white"
          : "border-[#E5E7EB] bg-white text-transparent hover:border-[rgba(37,99,235,0.4)]",
        className,
      )}
    >
      <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
    </button>
  );
}
