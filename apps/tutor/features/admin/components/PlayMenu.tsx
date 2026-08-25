"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProbeDifficulty } from "../lib/probes";

type PlayChoice = ProbeDifficulty | "all";

interface PlayMenuProps {
  disabled?: boolean;
  label?: string;
  available: Partial<Record<ProbeDifficulty, number>>;
  emptyTitle?: string;
  onPick: (choice: PlayChoice) => void;
}

const CHOICES: Array<{ id: PlayChoice; label: string }> = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
  { id: "all", label: "All" },
];

export function PlayMenu({
  disabled = false,
  label = "Select",
  available,
  emptyTitle = "No lecture fixtures yet",
  onPick,
}: PlayMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const total = (available.easy ?? 0) + (available.medium ?? 0) + (available.hard ?? 0);
  const isDisabled = disabled || total === 0;

  return (
    <div ref={rootRef} className="relative" title={isDisabled ? emptyTitle : undefined}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isDisabled}
        onClick={() => setOpen((current) => !current)}
        className="gap-1"
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-[#2E2E33] bg-[#151517] py-1 shadow-[0_8px_30px_-18px_rgba(0,0,0,0.55)]">
          {CHOICES.map((choice) => {
            const count = choice.id === "all" ? total : (available[choice.id] ?? 0);
            return (
              <button
                key={choice.id}
                type="button"
                disabled={count === 0}
                onClick={() => {
                  setOpen(false);
                  onPick(choice.id);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-[#F2F2F4] hover:bg-[#1E1E21] disabled:cursor-not-allowed disabled:opacity-40",
                )}
              >
                <span>{choice.label}</span>
                <span className="text-[11px] text-[#A6A6AE]">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
