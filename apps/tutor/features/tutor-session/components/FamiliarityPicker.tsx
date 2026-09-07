"use client";

import { ChevronDown, Check, GraduationCap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SubjectFamiliarity } from "@heytutor/tutor-core";
import { cn } from "@/lib/utils";

/**
 * "Familiarity", picked per question in the chat bar.
 *
 * Written from the student's side: "New" means the subject is new to them, so
 * the lesson assumes the least and teaches the most. It never means a harder
 * problem. Hints carry that meaning because a bare label cannot.
 */
export const FAMILIARITY_OPTIONS: ReadonlyArray<{
  id: SubjectFamiliarity;
  label: string;
  hint: string;
}> = [
  { id: "new", label: "New", hint: "I have not learned this yet" },
  { id: "normal", label: "Normal", hint: "I have seen it, but I am rusty" },
  { id: "revision", label: "Revision", hint: "I know it and want a refresh" },
];

export function familiarityLabel(familiarity: SubjectFamiliarity): string {
  return FAMILIARITY_OPTIONS.find((entry) => entry.id === familiarity)?.label ?? "Normal";
}

interface FamiliarityPickerProps {
  value: SubjectFamiliarity;
  onChange: (familiarity: SubjectFamiliarity) => void;
  disabled?: boolean;
  prominent?: boolean;
  /** Icon-only trigger for the narrow in-session bar. */
  compact?: boolean;
}

export function FamiliarityPicker({
  value,
  onChange,
  disabled = false,
  prominent = false,
  compact = false,
}: FamiliarityPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. A popover inside a submit form must
  // never swallow the Enter key the student uses to ask the question.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const select = useCallback(
    (familiarity: SubjectFamiliarity) => {
      onChange(familiarity);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Select Familiarity: ${familiarityLabel(value)}`}
        title="Familiarity"
        className={cn(
          "flex items-center gap-1 rounded-full border border-stroke bg-ink-700 font-medium transition-colors",
          "hover:border-sky-500/35 hover:bg-ink-600 hover:text-sky-200 disabled:opacity-40",
          compact ? "h-9 px-2.5 text-xs" : prominent ? "h-10 px-3 text-[13px]" : "h-9 px-3 text-xs",
        )}
        style={{ color: "var(--text-soft)" }}
      >
        {/* Below sm the label collapses to the cap icon so the second row of
            the composer keeps room for the submit; the level still rides in
            the aria-label and title. */}
        <GraduationCap className="h-4 w-4 shrink-0 sm:hidden" strokeWidth={2} aria-hidden />
        <span className="hidden whitespace-nowrap sm:inline">{familiarityLabel(value)}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Select Familiarity"
          className="absolute bottom-full left-0 z-50 mb-2 w-[16.5rem] overflow-hidden rounded-2xl border border-stroke p-1 shadow-xl"
          style={{ backgroundColor: "var(--ink-850)" }}
        >
          <p
            className="px-3 pb-1.5 pt-2 text-[0.6875rem] font-medium"
            style={{ color: "var(--text-faint)" }}
          >
            Familiarity
          </p>
          {FAMILIARITY_OPTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={entry.id === value}
              onClick={() => select(entry.id)}
              className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-ink-700"
            >
              <Check
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                  entry.id === value ? "opacity-100" : "opacity-0",
                )}
                strokeWidth={2.5}
                style={{ color: "var(--sky-500)" }}
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium" style={{ color: "var(--frost)" }}>
                  {entry.label}
                </span>
                <span className="block text-[11.5px] leading-snug" style={{ color: "var(--text-soft)" }}>
                  {entry.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
