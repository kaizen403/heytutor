import { normalizeTutorQuestion } from "@heytutor/tutor-core";

export const EXTRACT_QUESTION_PROMPT = `This is OCR only. Transcribe the exam or textbook question in this image, then stop.

Output only the question text. Do not solve, compute, hint, or teach. No preamble.

Write math so a tutor can parse it:
- square roots as \\sqrt{x} or sqrt(x)
- stacked fractions as \\frac{num}{den} or (num)/(den)
- powers as x^{2} or x^2
- keep every given value, unit, figure label, and what is asked
- keep part labels (a), (b), (c)

If the image includes a diagram, add one short sentence of the labeled facts needed to solve (lengths, angles, given marks). Do not invent values.

If there is no question, reply exactly: NO_QUESTION`;

const NO_QUESTION = /^NO_QUESTION\.?$/i;
const FENCE = /^```(?:latex|tex|markdown|text)?\s*([\s\S]*?)\s*```$/i;

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

export function parseExtractedQuestion(raw: string): string | null {
  let text = raw.trim();
  const fenced = text.match(FENCE);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }
  text = text.replace(/^question\s*:\s*/i, "").trim();
  if (!text || NO_QUESTION.test(text)) {
    return null;
  }
  if (/^(i('m| am) sorry|i cannot|i can't|unable to)/i.test(text)) {
    return null;
  }

  const question = normalizeTutorQuestion(text)
    .replace(/\^\{([^{}]+)\}/g, "^$1")
    .replace(/_\{([^{}]+)\}/g, "_$1");
  return question.length >= 3 ? question : null;
}
