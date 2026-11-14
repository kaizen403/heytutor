import { isStoredCommandTrustedGeometry, parseStoredSegmentCommands } from "@heytutor/drawing";

export type PlaygroundFigure = "with-figure" | "without-figure" | "reference-picture";
export type FigureReview = "drawn" | "not-drawn" | "incorrect" | "not-needed";
export const FIGURE_REVIEW_LABELS: Record<FigureReview, string> = {
  drawn: "Diagram drawn",
  "not-drawn": "Diagram not drawn",
  incorrect: "Diagram incorrect",
  "not-needed": "Diagram not needed",
};
export const REVIEW_TAGS = ["Clear explanation", "Incorrect answer", "Notes need work", "Audio issue"] as const;
export interface PlaygroundReview {
  stars: number | null;
  figure: FigureReview | null;
  tags: string[];
  feedback: string;
  skipped: boolean;
}
export interface PlaygroundLecture {
  topicId: string;
  difficulty: "easy" | "medium" | "hard";
  probeId?: string;
  state: "running" | "complete" | "discarded";
  /** Board revision inspected before exposing replay and notes. */
  checkedUpdatedAt?: number;
  figure?: PlaygroundFigure;
  review?: PlaygroundReview;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parsePlaygroundReview(value: unknown): PlaygroundReview | null {
  if (!record(value)) return null;
  const { stars, figure, tags, feedback, skipped } = value;
  if (stars !== null && !(typeof stars === "number" && Number.isInteger(stars) && stars >= 1 && stars <= 5)) return null;
  if (figure !== null && !(typeof figure === "string" && Object.hasOwn(FIGURE_REVIEW_LABELS, figure))) return null;
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string" || !(REVIEW_TAGS as readonly string[]).includes(tag))) return null;
  if (typeof feedback !== "string" || feedback.length > 1000 || typeof skipped !== "boolean") return null;
  return skipped ? { stars: null, figure: null, tags: [], feedback: "", skipped: true }
    : { stars, figure: figure as FigureReview | null, tags: [...new Set(tags)], feedback: feedback.trim(), skipped };
}

export function parsePlaygroundLecture(value: unknown): PlaygroundLecture | null {
  if (!record(value) || typeof value.topicId !== "string" || !value.topicId.trim() || value.topicId.length > 300) return null;
  if (value.difficulty !== "easy" && value.difficulty !== "medium" && value.difficulty !== "hard") return null;
  if (value.probeId !== undefined && (typeof value.probeId !== "string" || value.probeId.length > 300)) return null;
  if (value.state !== "running" && value.state !== "complete" && value.state !== "discarded") return null;
  return {
    topicId: value.topicId, difficulty: value.difficulty, state: value.state,
    ...(typeof value.checkedUpdatedAt === "number" && Number.isFinite(value.checkedUpdatedAt) ? { checkedUpdatedAt: value.checkedUpdatedAt } : {}),
    ...(typeof value.probeId === "string" ? { probeId: value.probeId } : {}),
    ...(value.figure === "with-figure" || value.figure === "without-figure" || value.figure === "reference-picture" ? { figure: value.figure } : {}),
    ...(parsePlaygroundReview(value.review) ? { review: parsePlaygroundReview(value.review)! } : {}),
  };
}

type InspectTurn = {
  status?: string;
  kind?: string;
  rawResponse: string;
  visualStatus: string | null;
  segments: readonly { narration: string; spokenText: string; audioUrl: string | null; durationMs: number | null; command: unknown }[];
};

/** A question preview or a single clip is never evidence of a finished recording. */
export function inspectPlaygroundLecture(turns: readonly InspectTurn[]):
  { complete: true; figure: PlaygroundFigure } | { complete: false; reason: string } {
  if (!turns.length || !turns.some(turn => !turn.kind || turn.kind === "lesson")) return { complete: false, reason: "No saved lesson" };
  if (turns.some(turn => turn.status !== "complete" || !turn.rawResponse.trim())) return { complete: false, reason: "Lesson did not finish" };
  let figure: PlaygroundFigure = "without-figure";
  let hasNotes = false;
  for (const turn of turns) {
    const speaking = turn.segments.filter(segment => segment.narration.trim() || segment.spokenText.trim());
    if (!speaking.length || speaking.some(segment => !segment.audioUrl?.trim() || !Number.isFinite(segment.durationMs) || (segment.durationMs ?? 0) <= 0)) {
      return { complete: false, reason: "Narration audio is incomplete" };
    }
    const commands = turn.segments.flatMap(segment => parseStoredSegmentCommands(segment.command));
    hasNotes ||= commands.some(command => (command.type === "WRITE" || command.type === "TYPE") && typeof command.text === "string" && Boolean(command.text.trim()));
    for (const segment of turn.segments) {
      if (!isStoredCommandTrustedGeometry(segment.command) || turn.visualStatus === "retry_required") continue;
      for (const command of parseStoredSegmentCommands(segment.command)) {
        if (command.type === "DRAW_PICTURE") {
          if (figure !== "with-figure") figure = "reference-picture";
        } else if (typeof command.type === "string" && command.type.startsWith("DRAW_")) figure = "with-figure";
      }
    }
  }
  return hasNotes ? { complete: true, figure } : { complete: false, reason: "Lesson notes are missing" };
}

export function figureCount(lectures: readonly (PlaygroundLecture | null | undefined)[]): number {
  return lectures.filter(lecture => lecture?.state === "complete" && lecture.figure === "with-figure").length;
}
