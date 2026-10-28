/**
 * Does this doubt need a figure the board does not show? (DIAGRAM_DOUBT_FIGURES)
 *
 * A small classifier on the lesson's own model, in fast mode, with a 3 s
 * deadline. It reads the lesson question, the doubt, and the parts of the
 * figure already in the zone, and answers "point" (teach on the figure that is
 * there) or "new_figure" (that figure cannot show what the doubt asks about).
 * It is a model judgment, never a keyword router. Every failure, timeout, bad
 * reply or missing key is "point": the doubt then teaches exactly as it does
 * with the flag off.
 */

/** The whole need check, client and server, ends by this many ms. */
export const DOUBT_FIGURE_NEED_DEADLINE_MS = 3_000;
export const DOUBT_FIGURE_NEED_MAX_TOKENS = 120;

export type DoubtFigureNeedDecision = "point" | "new_figure";

export interface DoubtFigureNeedResult {
  decision: DoubtFigureNeedDecision;
  reason: string;
}

export interface DoubtFigurePart {
  id: string;
  labels: string[];
}

export interface DoubtFigureNeedInput {
  lessonQuestion: string;
  doubt: string;
  /** The figure in the zone now; null family and no parts when the zone is empty. */
  figure: { family: string | null; parts: DoubtFigurePart[] };
}

const MAX_TEXT_CHARS = 4_000;
const MAX_PARTS = 80;
const MAX_LABELS = 6;
const MAX_LABEL_CHARS = 80;

/** The safe answer, with why it was taken. */
export function pointDecision(reason: string): DoubtFigureNeedResult {
  return { decision: "point", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The request body, bounded, or null when it is not one. */
export function parseDoubtFigureNeedInput(body: unknown): DoubtFigureNeedInput | null {
  if (!isRecord(body)) return null;
  const { lessonQuestion, doubt, figure } = body;
  if (typeof lessonQuestion !== "string" || typeof doubt !== "string") return null;
  if (!lessonQuestion.trim() || !doubt.trim()) return null;
  if (lessonQuestion.length > MAX_TEXT_CHARS || doubt.length > MAX_TEXT_CHARS) return null;
  if (!isRecord(figure)) return null;
  const family = figure.family === null || figure.family === undefined
    ? null
    : typeof figure.family === "string" && figure.family.length <= 120 ? figure.family : undefined;
  if (family === undefined || !Array.isArray(figure.parts) || figure.parts.length > MAX_PARTS) return null;
  const parts: DoubtFigurePart[] = [];
  for (const raw of figure.parts) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id.trim() || raw.id.length > MAX_LABEL_CHARS) return null;
    const labels = Array.isArray(raw.labels) ? raw.labels : [];
    if (labels.length > MAX_LABELS || labels.some((label) => typeof label !== "string" || label.length > MAX_LABEL_CHARS)) return null;
    parts.push({ id: raw.id, labels: labels as string[] });
  }
  return { lessonQuestion, doubt, figure: { family, parts } };
}

export const DOUBT_FIGURE_NEED_PROMPT = `You decide whether a student's doubt can be answered on the figure already drawn on a whiteboard, or needs a different figure.

You are given the lesson question, the student's doubt, and the parts of the figure on the board (ids and labels, and its family when known).

Answer "point" when the doubt is about something the figure already shows, or when no figure would help (a definition, a step of algebra, a unit, a "why" about reasoning). Pointing at the existing parts is enough.
Answer "new_figure" only when the doubt asks to see something the figure cannot show: a different situation, a different case, another arrangement, or a part the figure leaves out entirely.
When unsure, answer "point".

Reply with one JSON object and nothing else: {"decision":"point"|"new_figure","reason":"one short sentence"}`;

export function buildDoubtFigureNeedMessages(input: DoubtFigureNeedInput): Array<{ role: "system" | "user"; content: string }> {
  const parts = input.figure.parts.length > 0
    ? input.figure.parts.map((part) => `- ${part.id}${part.labels.length > 0 ? `: ${part.labels.join(", ")}` : ""}`).join("\n")
    : "(no figure on the board)";
  return [
    { role: "system", content: DOUBT_FIGURE_NEED_PROMPT },
    {
      role: "user",
      content: [
        `Lesson question:\n${input.lessonQuestion.trim()}`,
        `Student's doubt:\n${input.doubt.trim()}`,
        `Figure on the board${input.figure.family ? ` (family ${input.figure.family})` : ""}:\n${parts}`,
      ].join("\n\n"),
    },
  ];
}

/** The model's reply, or null when it is not exactly one of the two answers. */
export function parseDoubtFigureNeedReply(raw: string): DoubtFigureNeedResult | null {
  const text = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const decision = parsed.decision;
  if (decision !== "point" && decision !== "new_figure") return null;
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 240) : "";
  return { decision, reason };
}

/** The text of an OpenAI compatible completion, or "". */
export function completionText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return "";
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return "";
  const content = first.message.content;
  return typeof content === "string" ? content : "";
}
