/**
 * Later figures inside one lesson (DIAGRAM_LESSON_FIGURES, phase 3).
 *
 * The planner may pick up to two later views of the same situation
 * (`plan.figures`, an unknown key validateTurnPlanV3 passes through). A view
 * is one figure kind id from a closed list the engine reads from the question
 * (`turnPlanV3LessonFiguresAddon`), never words of the model's own: the
 * figure's source question is the lesson question plus the engine's own name
 * for that kind (`composeLessonFigureQuestion`), so no planner word ("smooth",
 * "upward", a species) can become source truth (rules 4 and 5). Each figure
 * is drawn only by the engine's own fast selector, on that composed question
 * and on the lesson's own plan; the teaching moves to it with
 * `[FOCUS:figure_2]`, forward only.
 *
 * A malformed list is dropped whole, never repaired, and never rejects the
 * plan, as exampleReactions is. Any other key in an entry is never read.
 */
import {
  describeSceneFamily,
  isSceneVisualFamily,
  type SceneVisualFamily,
} from "@heytutor/scene-engine";
import type { RepresentationTier } from "@/features/tutor-session/lib/scene/representationFallback";

export const LESSON_FIGURES_VERSION = "lesson-figures/v2" as const;
export const LESSON_FIGURE_IDS = ["figure_2", "figure_3"] as const;
export type LessonFigureId = (typeof LESSON_FIGURE_IDS)[number];

export interface LessonFigureAsk {
  id: LessonFigureId;
  /** A figure kind id from the engine's closed list; never free text. */
  view: SceneVisualFamily;
}

export interface StoredLessonFigure extends LessonFigureAsk {
  sceneDocument: unknown;
  tier: RepresentationTier;
  /** The family the selector drew: always the picked view. */
  family: SceneVisualFamily;
  figureSource: "fast_family";
}

/** sceneArtifacts.lessonFigures on the lesson turn (copied onto its resumes). */
export interface LessonFiguresArtifact {
  schemaVersion: typeof LESSON_FIGURES_VERSION;
  figures: StoredLessonFigure[];
}

const MAX_FIGURES = LESSON_FIGURE_IDS.length;

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

/** A later figure's view: one figure kind id from the engine's closed list, nothing else. */
export function isLessonFigureView(value: unknown): value is SceneVisualFamily {
  return typeof value === "string" && isSceneVisualFamily(value);
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
  if (!entries.every((entry) => isRecord(entry) && isLessonFigureView(entry.view))) return [];
  // Only the id and the view are read: any words beside them are dropped here.
  return entries.map((entry) => {
    const record = entry as Record<string, unknown>;
    return { id: record.id as LessonFigureId, view: record.view as SceneVisualFamily };
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
    if (!isLessonFigureView(record.view) || !isRecord(record.sceneDocument) || !isTier(record.tier)) return null;
    if (record.family !== record.view) return null;
    if (record.figureSource !== "fast_family") return null;
    figures.push({
      id: record.id as LessonFigureId,
      view: record.view,
      sceneDocument: record.sceneDocument,
      tier: record.tier,
      family: record.view,
      figureSource: "fast_family",
    });
  }
  return { schemaVersion: LESSON_FIGURES_VERSION, figures };
}

/**
 * The question figure k is planned and checked on: the lesson question whole,
 * then the engine's own name for the picked view. Deterministic: the client
 * plans on it and the server and every restore recompute it from the stored
 * view id. No planner word is ever part of it.
 */
export function composeLessonFigureQuestion(lessonQuestion: string, view: SceneVisualFamily): string {
  return `${lessonQuestion.trim()}\n\nFigure: ${describeSceneFamily(view)}`;
}

/** DIAGRAM_LESSON_FIGURES, off unless exactly "on". Server side only. */
export function resolveLessonFiguresEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DIAGRAM_LESSON_FIGURES === "on";
}
