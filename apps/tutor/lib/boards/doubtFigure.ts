/**
 * A doubt that drew its own figure.
 *
 * Most doubts point at the figure the lesson drew (`doubtFigureRef.ts`). When
 * the doubt asks about something that figure does not show, and
 * DIAGRAM_DOUBT_FIGURES is on, the doubt plans and verifies a figure of its
 * own and it replaces the lesson's figure in the zone. The doubt is saved with
 * that scene and this marker; the lesson's figure comes back when the lesson
 * resumes.
 *
 * The scene's source question is the composed question below, never the
 * doubt's title, so the client plans on exactly the text the server checks.
 */

export const DOUBT_FIGURE_VERSION = "doubt-figure/v1" as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** sceneArtifacts.doubtFigure on a doubt that drew its own figure in the zone. */
export interface DoubtFigureMarker {
  schemaVersion: typeof DOUBT_FIGURE_VERSION;
  /** Turn.id of the figure it replaced in the zone; null when the zone was empty. */
  replacedTurnId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The marker, validated, or null. Tolerates any other artifacts beside it. */
export function doubtFigureOf(sceneArtifacts: unknown): DoubtFigureMarker | null {
  if (!isRecord(sceneArtifacts)) return null;
  const raw = sceneArtifacts.doubtFigure;
  if (!isRecord(raw) || raw.schemaVersion !== DOUBT_FIGURE_VERSION) return null;
  const replaced = raw.replacedTurnId;
  if (replaced !== null && (typeof replaced !== "string" || !UUID.test(replaced))) return null;
  return { schemaVersion: DOUBT_FIGURE_VERSION, replacedTurnId: replaced };
}

/** Scene artifacts marking a doubt that drew its own figure. */
export function doubtFigureArtifacts(replacedTurnId: string | null): { doubtFigure: DoubtFigureMarker } {
  return { doubtFigure: { schemaVersion: DOUBT_FIGURE_VERSION, replacedTurnId } };
}

/**
 * Deterministic; the client plans on it and the server recomputes it. Never
 * stored as Turn.question, which stays the doubt's title.
 */
export function composeDoubtFigureQuestion(lessonQuestion: string, doubtTitle: string): string {
  return `${lessonQuestion.trim()}\n\nStudent's doubt: ${doubtTitle.replace(/^Doubt:\s*/, "").trim()}`;
}

/** DIAGRAM_DOUBT_FIGURES, off unless exactly "on". Server side only. */
export function resolveDoubtFiguresEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DIAGRAM_DOUBT_FIGURES === "on";
}
