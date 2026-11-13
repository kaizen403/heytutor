"use client";

import { cn } from "@/lib/utils";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

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

export function FilterSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: FilterSelectProps) {
  return (
    <NativeSelect
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className={cn("bg-background", className)}
    >
      {options.map((option) => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
