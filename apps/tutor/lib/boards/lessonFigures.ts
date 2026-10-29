/**
 * Later figures inside one lesson (DIAGRAM_LESSON_FIGURES, phase 3).
 *
 * The planner may name up to two later views of the same situation in words
 * (`plan.figures`, an unknown key validateTurnPlanV3 passes through). Each is
 * drawn only by the engine's own fast selector, on the lesson question
 * composed with the ask and on the lesson's own plan and authority; the
 * teaching moves to it with `[FOCUS:figure_2]`, forward only.
 *
 * An ask is words only. With no digit (and no number word) in it, no number
 * can reach a later figure except through the lesson's authority (rule 4).
 * A malformed list is dropped whole, never repaired, and never rejects the
 * plan, as exampleReactions is.
 */
import type { RepresentationTier } from "@/features/tutor-session/lib/scene/representationFallback";

export const LESSON_FIGURES_VERSION = "lesson-figures/v1" as const;
export const LESSON_FIGURE_IDS = ["figure_2", "figure_3"] as const;
export type LessonFigureId = (typeof LESSON_FIGURE_IDS)[number];

export interface LessonFigureAsk {
  id: LessonFigureId;
  ask: string;
}

export interface StoredLessonFigure extends LessonFigureAsk {
  sceneDocument: unknown;
  tier: RepresentationTier;
  family: string | null;
  figureSource: "fast_family";
}

/** sceneArtifacts.lessonFigures on the lesson turn (copied onto its resumes). */
export interface LessonFiguresArtifact {
  schemaVersion: typeof LESSON_FIGURES_VERSION;
  figures: StoredLessonFigure[];
}

const MAX_FIGURES = LESSON_FIGURE_IDS.length;
const ASK_MIN = 3;
const ASK_MAX = 80;
const NUMBER_WORD = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|half|quarter|double|twice|thrice|triple)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An advance id: exactly `figure_2` or `figure_3`. An id format, not a router. */
export function isLessonFigureAdvanceId(id: string): id is LessonFigureId {
  return id === "figure_2" || id === "figure_3";
}

/** A part named like an advance cue would make `[FOCUS:figure_2]` ambiguous. */
const ADVANCE_ID_SHAPE = /^figure_[1-3]$/;

/** A figure with a part named like an advance cue. The client plan and the server admission both refuse it (`id_collision`). */
export function figureCollidesWithAdvanceIds(diagram: { anchors: ReadonlyArray<{ id: string }> }): boolean {
  return diagram.anchors.some((anchor) => ADVANCE_ID_SHAPE.test(anchor.id.trim().toLowerCase()));
}

/** A later figure's ask: plain words naming the view, 3 to 80 characters, no number in any form. */
export function isLessonFigureAsk(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const ask = value.trim();
  return ask.length >= ASK_MIN && ask.length <= ASK_MAX &&
    !/\p{Nd}/u.test(ask) && !/[[\]:]/.test(ask) && !/[\p{Cc}\p{Cf}]/u.test(ask) && !NUMBER_WORD.test(ask);
}

/** At most two entries, ids unique and ascending (figure_2 before figure_3). */
function wellFormedIds(entries: readonly unknown[]): boolean {
  if (entries.length > MAX_FIGURES) return false;
  let last = -1;
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !isLessonFigureAdvanceId(entry.id)) return false;
    const index = LESSON_FIGURE_IDS.indexOf(entry.id);
    if (index <= last) return false;
    last = index;
  }
  return true;
}

/** The planner's `figures`, validated; a malformed list is dropped whole. */
export function lessonFigureAsksOf(plan: unknown): LessonFigureAsk[] {
  if (!isRecord(plan) || !Array.isArray(plan.figures)) return [];
  const entries = plan.figures as unknown[];
  if (!wellFormedIds(entries)) return [];
  if (!entries.every((entry) => isRecord(entry) && isLessonFigureAsk(entry.ask))) return [];
  return entries.map((entry) => {
    const record = entry as Record<string, unknown>;
    return { id: record.id as LessonFigureId, ask: (record.ask as string).trim() };
  });
}

function isTier(value: unknown): value is RepresentationTier {
  return value === "exact_verified" || value === "qualitative_verified" || value === "question_representation";
}

/** The stored artifact, validated whole, or null. Tolerates any other artifacts beside it. */
export function lessonFiguresOf(sceneArtifacts: unknown): LessonFiguresArtifact | null {
  if (!isRecord(sceneArtifacts)) return null;
  const raw = sceneArtifacts.lessonFigures;
  if (!isRecord(raw) || raw.schemaVersion !== LESSON_FIGURES_VERSION || !Array.isArray(raw.figures)) return null;
  const entries = raw.figures as unknown[];
  if (entries.length === 0 || !wellFormedIds(entries)) return null;
  const figures: StoredLessonFigure[] = [];
  for (const entry of entries) {
    const record = entry as Record<string, unknown>;
    if (!isLessonFigureAsk(record.ask) || !isRecord(record.sceneDocument) || !isTier(record.tier)) return null;
    if (record.family !== null && typeof record.family !== "string") return null;
    if (record.figureSource !== "fast_family") return null;
    figures.push({
      id: record.id as LessonFigureId,
      ask: record.ask.trim(),
      sceneDocument: record.sceneDocument,
      tier: record.tier,
      family: record.family as string | null,
      figureSource: "fast_family",
    });
  }
  return { schemaVersion: LESSON_FIGURES_VERSION, figures };
}

/**
 * The question figure k is planned and checked on. Deterministic: the client
 * plans on it and the server recomputes it. It contains the lesson question
 * whole, so every given the lesson states is still stated.
 */
export function composeLessonFigureQuestion(lessonQuestion: string, ask: string): string {
  return `${lessonQuestion.trim()}\n\nFigure: ${ask.trim()}`;
}

/** DIAGRAM_LESSON_FIGURES, off unless exactly "on". Server side only. */
export function resolveLessonFiguresEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DIAGRAM_LESSON_FIGURES === "on";
}
