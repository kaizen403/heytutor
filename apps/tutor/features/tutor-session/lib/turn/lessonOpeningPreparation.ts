import { WORK_ZONE, type TutorSegment } from "@heytutor/drawing";
import {
  buildGivenValueSegments, buildLessonOpeningSegment, isConceptLessonQuestion,
  type NarrationLanguage,
} from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

/** Preparation only: never enqueue speech, ink, or change a teaching prompt. */
const OPENING_PREFETCH_ENABLED = process.env.NEXT_PUBLIC_LESSON_OPENING_PREFETCH === "1";

export function shouldPrepareLessonOpening(input: {
  kind: "lesson" | "doubt" | "resume";
  isDsa: boolean;
  earlyAcknowledgement: boolean;
  current: boolean;
  paused: boolean;
}, enabled = OPENING_PREFETCH_ENABLED): boolean {
  return enabled && input.kind === "lesson" && !input.isDsa &&
    !input.earlyAcknowledgement && input.current && !input.paused;
}

/**
 * Return only an opening whose exact bytes cannot depend on the unfinished
 * figure. Before authority, both possible Given-row states must agree. After
 * authority, both board widths must agree. The final prompt still constructs
 * and releases its original opening at the original usable-teaching gate.
 */
export function prepareLessonOpening(input: {
  question: string;
  narrationLanguage?: NarrationLanguage;
  turnPlan?: TurnPlanV3 | null;
  authoritySettled?: boolean;
}): TutorSegment | null {
  const kind = isConceptLessonQuestion(input.question) ? "concept" : "problem";
  const openings = [WORK_ZONE.maxTextWidth, WORK_ZONE.fullWidthTextWidth].map((maxWidth, index) =>
    buildLessonOpeningSegment({
      question: input.question, kind, language: input.narrationLanguage,
      hasBoardOpening: input.authoritySettled
        ? buildGivenValueSegments(input.question, input.turnPlan ?? null, {
            maxWidth, language: input.narrationLanguage,
          }).length > 0
        : index === 0,
    }));
  return JSON.stringify(openings[0]) === JSON.stringify(openings[1]) ? openings[0] ?? null : null;
}
