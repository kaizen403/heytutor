import { normalizeTutorQuestion } from "@heytutor/tutor-core";

/** Upper bound on a question photo as a base64 data URL; the client shrinks to fit. */
export const MAX_QUESTION_IMAGE_DATA_URL_CHARS = 1_800_000;

/** Longest transcription the tutor accepts from one photo. */
export const MAX_EXTRACTED_QUESTION_CHARS = 12_000;

export const EXTRACT_QUESTION_PROMPT = `This is OCR only. Transcribe the question, problem, or exercise in this image, then stop.

Output only the question text. Do not solve, compute, hint, or teach. No preamble.

Any of these counts as a question:
- printed, handwritten, on a screen, or in a screenshot, at any angle
- a task without a question mark ("Find x", "Prove that", "Calculate", "Sketch", "Show that")
- a diagram, graph, circuit, table, or figure with a marked unknown or a task, even with little text
- a question that is cut off or partly unreadable: transcribe what you can read and write [unclear] for gaps
- several questions: transcribe each one in order, keeping its number

Write math so a tutor can parse it:
- square roots as \\sqrt{x} or sqrt(x)
- stacked fractions as \\frac{num}{den} or (num)/(den)
- powers as x^{2} or x^2
- keep every given value, unit, figure label, and what is asked
- keep part labels (a), (b), (c)

If the image includes a diagram, add one short sentence of the labeled facts needed to solve (lengths, angles, given marks). If the diagram is the whole question, state its labeled facts and the task it marks, such as "Find the angle marked x". Do not invent values.

Reply exactly NO_QUESTION only when there is nothing to work on at all: for example a selfie, a room, a blank page, or a picture with no problem, exercise, or task in it.`;

/**
 * The second look, sent only when the first reading found nothing. A model at
 * low effort answers the same photo the same way every time, so a retake of
 * the same page would fail again.
 */
export const EXTRACT_QUESTION_SECOND_LOOK_PROMPT = `${EXTRACT_QUESTION_PROMPT}

A first reading of this image found no question. Look again carefully, including small, faint, rotated, handwritten, or partly cropped text, and any diagram with a marked unknown. Students send this photo because it holds something to work on. Reply NO_QUESTION only if the image truly contains no problem, exercise, or task.`;

/** Why a reply did not become a question. */
export type ExtractionDecline =
  | "empty"
  | "no_question"
  | "refusal"
  | "too_short"
  | "too_long";

export type Extraction =
  | { question: string; reason: null }
  | { question: null; reason: ExtractionDecline };

export type ExtractionReply = Extraction & {
  /** The visible reply or refusal text, for the trace only. */
  reply: string;
  finishReason: string | null;
};

const NO_QUESTION_LINE = /^[\s*_`"'.:-]*NO[_ ]QUESTION[\s*_`"'.!:-]*$/i;
const FENCE = /^```[\w-]*[ \t]*\n?([\s\S]*?)\n?\s*```$/;
const THINKING = /<think>[\s\S]*?<\/think>/gi;
const LEADING_LABEL =
  /^(?:#{1,6}\s*)?(?:\*\*|__)?(?:question|transcription|transcribed question|problem)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*/i;
const PREAMBLE =
  /^(?:sure[,.!]?\s*)?here(?:'s| is) (?:the |a )?(?:transcri\w+|question|problem|text)[^\n:]{0,60}:\s*/i;
const REFUSAL =
  /^(?:i(?:'m| am) (?:sorry|unable|not able)|sorry\b|i (?:cannot|can't|can not|could not|couldn't|am unable)|unable to|(?:the|this) image (?:does not|doesn't) (?:contain|show|include) (?:a |any )?(?:question|problem|exercise|task|readable)|there (?:is|are) no (?:question|problem|exercise|task|readable)s?\b)/i;

export function readExtractedContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .join("");
}

function cleanReply(raw: string): string {
  let text = raw.replace(THINKING, "").trim();
  const fenced = text.match(FENCE);
  if (fenced?.[1] !== undefined) {
    text = fenced[1].trim();
  }
  return text.replace(PREAMBLE, "").replace(LEADING_LABEL, "").trim();
}

export function readExtraction(raw: string): Extraction {
  const text = cleanReply(raw);
  if (!text) return { question: null, reason: "empty" };
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (
    NO_QUESTION_LINE.test(lines[0] ?? "") ||
    NO_QUESTION_LINE.test(lines[lines.length - 1] ?? "")
  ) {
    return { question: null, reason: "no_question" };
  }
  if (REFUSAL.test(text)) return { question: null, reason: "refusal" };

  const question = normalizeTutorQuestion(text)
    .replace(/\^\{([^{}]+)\}/g, "^$1")
    .replace(/_\{([^{}]+)\}/g, "_$1");
  if (question.length < 3) return { question: null, reason: "too_short" };
  if (question.length > MAX_EXTRACTED_QUESTION_CHARS) {
    return { question: null, reason: "too_long" };
  }
  return { question, reason: null };
}

export function parseExtractedQuestion(raw: string): string | null {
  return readExtraction(raw).question;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one chat-completions choice. OpenAI-style models put a safety refusal
 * in `message.refusal` with null content; that is a refusal, not an empty page.
 */
export function readExtractionChoice(choice: unknown): ExtractionReply {
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : {};
  const finishReason =
    isRecord(choice) && typeof choice.finish_reason === "string"
      ? choice.finish_reason
      : null;
  const reply = readExtractedContent(message.content);
  const refusal = typeof message.refusal === "string" ? message.refusal.trim() : "";
  if (!reply.trim() && refusal) {
    return { question: null, reason: "refusal", reply: refusal, finishReason };
  }
  return { ...readExtraction(reply), reply, finishReason };
}

/** Declines worth a second look. A too-long transcription is not one. */
export function shouldTakeSecondLook(extraction: Extraction): boolean {
  return extraction.question === null && extraction.reason !== "too_long";
}
