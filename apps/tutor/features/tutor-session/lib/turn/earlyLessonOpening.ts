import type { TutorSegment } from "@heytutor/drawing";
import type { NarrationLanguage } from "@heytutor/tutor-core";

/** Opt-in only: ordinary lesson ordering is unchanged without the exact flag. */
export const EARLY_LESSON_OPENING_ENABLED = process.env.NEXT_PUBLIC_EARLY_LESSON_OPENING === "1";

export interface EarlyLessonOpeningAdmission {
  enabled?: boolean;
  kind: "lesson" | "doubt" | "resume";
  isDsa: boolean;
  admitted: boolean;
  current: boolean;
  paused: boolean;
}

/** The caller supplies turn ownership and billing admission, never question text. */
export function shouldStartEarlyLessonOpening(input: EarlyLessonOpeningAdmission): boolean {
  return (input.enabled ?? EARLY_LESSON_OPENING_ENABLED) &&
    input.kind === "lesson" && !input.isDsa && input.admitted && input.current && !input.paused;
}

const OPENING_NARRATION = {
  english: "Okay, let's take this question one step at a time.",
  hinglish: "ठीक है, इस सवाल को आराम से समझते हैं.",
} as const;

/** No question or planner input can become pre-authority speech or ink. */
export function buildEarlyLessonOpeningSegment(language: NarrationLanguage = "english"): TutorSegment {
  return { narration: OPENING_NARRATION[language], command: null, delivery: "opening" };
}

export interface EarlyLessonSpokenSegment {
  narration: string;
  /** Live DrawCommand or recorded command envelope; any non-null ink is substantive. */
  command?: unknown;
  commands?: readonly unknown[];
}

export interface EarlyLessonProgressInput {
  /** Set by the owner of this turn, not inferred from arbitrary narration. */
  earlyOpeningStarted: boolean;
  /** Only spoken/recorded rows, never queued-but-unheard segments. */
  spokenSegments: readonly EarlyLessonSpokenSegment[];
  /** The current segment already speaking when Stop interrupts it. */
  activeNarration?: string | null;
  /** Actual visible figure ink, not a ready or queued presentation. */
  figureDrawn: boolean;
}

export type EarlyLessonProgress = "none" | "opening_only" | "substantive";

/** An opening-only Stop cannot resume past unfinished numeric/scene authority. */
export function classifyEarlyLessonProgress(input: EarlyLessonProgressInput): EarlyLessonProgress {
  if (input.figureDrawn) return "substantive";
  let openingHeard = false;
  const classifyNarration = (narration: string): EarlyLessonProgress => {
    const text = narration.trim();
    if (!text) return "none";
    return input.earlyOpeningStarted &&
      (text === OPENING_NARRATION.english || text === OPENING_NARRATION.hinglish)
      ? "opening_only" : "substantive";
  };
  for (const segment of input.spokenSegments) {
    if (segment.command != null || (segment.commands?.length ?? 0) > 0) return "substantive";
    const progress = classifyNarration(segment.narration);
    if (progress === "substantive") return progress;
    openingHeard ||= progress === "opening_only";
  }
  const activeProgress = classifyNarration(input.activeNarration ?? "");
  if (activeProgress === "substantive") return activeProgress;
  return openingHeard || activeProgress === "opening_only" ? "opening_only" : "none";
}
