"use client";

import { cn } from "@/lib/utils";

interface FilterSelectOption {
  value: string;
  label: string;
}

interface FilterSelectProps {
  value: string;
  options: ReadonlyArray<FilterSelectOption>;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

const selectClass =
  "h-9 rounded-lg border border-stroke bg-ink-900 px-2.5 text-xs text-frost outline-none transition-colors hover:border-sky-500/50 focus-visible:ring-2 focus-visible:ring-sky-500";

export function FilterSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: FilterSelectProps) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className={cn(selectClass, className)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
