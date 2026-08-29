"use client";

import { Clock, Eye, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DifficultyState } from "../lib/lectureState";
import type { ProbeDifficulty } from "../lib/probes";

const SHORT_LABEL: Record<ProbeDifficulty, string> = {
  easy: "Easy",
  medium: "Med",
  hard: "Hard",
};

const FULL_LABEL: Record<ProbeDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

function describe(difficulty: ProbeDifficulty, state: DifficultyState): string {
  const name = FULL_LABEL[difficulty];
  switch (state) {
    case "missing":
      return `${name}: no question fixture yet`;
    case "idle":
      return `${name}: no lecture recorded yet`;
    case "queued":
      return `${name}: queued to record`;
    case "running":
      return `${name}: recording now - watch live`;
    case "recorded":
      return `${name}: watch the recorded lecture`;
  }
}

interface DifficultyCellProps {
  difficulty: ProbeDifficulty;
  state: DifficultyState;
  onActivate?: () => void;
}

export function DifficultyCell({ difficulty, state, onActivate }: DifficultyCellProps) {
  const interactive = state === "recorded" || state === "running";
  const label = describe(difficulty, state);

  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={interactive ? onActivate : undefined}
      aria-label={label}
      title={label}
      data-difficulty={difficulty}
      data-state={state}
      className={cn(
        "type-accent-xs inline-flex h-6 w-[4.25rem] items-center justify-center gap-1 rounded-md border transition-colors",
        state === "missing" && "border-dashed border-stroke bg-transparent text-frost/20",
        state === "idle" && "border-stroke bg-ink-900/70 text-faint",
        state === "queued" && "border-stroke bg-ink-800 text-soft",
        state === "running" &&
          "border-sky-400/70 bg-sky-500/25 text-sky-100 shadow-[0_0_12px_-2px_rgba(89,175,212,0.6)] hover:bg-sky-500/35",
        state === "recorded" &&
          "border-sky-500/40 bg-sky-500/10 text-sky-300 hover:border-sky-400 hover:bg-sky-500/20",
        !interactive && "cursor-default",
      )}
    >
      {state === "running" ? <Radio className="h-2.5 w-2.5 shrink-0" aria-hidden /> : null}
      {state === "queued" ? <Clock className="h-2.5 w-2.5 shrink-0" aria-hidden /> : null}
      {state === "recorded" ? <Eye className="h-2.5 w-2.5 shrink-0" aria-hidden /> : null}
      <span>{SHORT_LABEL[difficulty]}</span>
    </button>
  );
}
