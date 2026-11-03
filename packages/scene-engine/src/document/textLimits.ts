import type { SceneIssue } from "../types";

/**
 * Sizes for the text a scene document may hold. Every recorded document and all
 * generator output sit well inside them, so an ordinary figure never meets one. A
 * document outside them is refused before anything reads its text.
 */
export const SCENE_TEXT_LIMITS = Object.freeze({
  /** One label, axis title or node label, which layout measures many times. */
  labelChars: 160,
  /** All labels together. */
  labelTotalChars: 4_000,
  /** How many labels one document may hold. */
  labelCount: 256,
  /** One role, which is matched against the spoken words. */
  roleChars: 256,
  /** One id or object key. */
  nameChars: 128,
  /** One other text value: an annotation, a reason, a cue. */
  textChars: 2_000,
  /** All annotation text together. */
  annotationTotalChars: 8_000,
  /** The document's question and a generator's copy of it, the same size a saved turn may hold. */
  questionChars: 12_000,
  /** All text and keys together, apart from the question. */
  totalChars: 96_000,
  /** Entries in one list or object. */
  entries: 1_024,
  /** Values in the whole document, and how deep they nest. */
  nodes: 16_000,
  depth: 32,
  /** A run of whitespace in any value but the question. */
  whitespaceRun: 16,
  /** A run of digits in any value but the question. */
  digitRun: 400,
});

const OVER_LONG_WHITESPACE = new RegExp(String.raw`\s{${SCENE_TEXT_LIMITS.whitespaceRun + 1}}`);
const OVER_LONG_DIGITS = new RegExp(String.raw`\d{${SCENE_TEXT_LIMITS.digitRun + 1}}`);
const LABEL_FIELDS: ReadonlySet<string> = new Set(["label", "xLabel", "yLabel"]);
const NAME_FIELDS: ReadonlySet<string> = new Set(["id", "kind", "operator", "unit", "symbol"]);

/** The first size this document breaks, or null. Reads no meaning from the text. */
export function sceneTextOverLimit(raw: unknown): SceneIssue | null {
  const limits = SCENE_TEXT_LIMITS;
  const over = (limit: string): SceneIssue => ({
    code: "scene_text_over_limit",
    message: `scene text is over the ${limit} limit`,
    severity: "fatal",
    path: "$",
  });
  let total = 0;
  let labels = 0;
  let labelTotal = 0;
  let annotationTotal = 0;
  let nodes = 0;
  const pending: Array<{ value: unknown; key: string; depth: number; section: string }> = [{ value: raw, key: "", depth: 0, section: "" }];
  while (pending.length > 0) {
    const { value, key, depth, section } = pending.pop()!;
    if (++nodes > limits.nodes) return over("value count");
    if (depth > limits.depth) return over("nesting");
    if (typeof value === "string") {
      if (key === "question" && section === "source" && depth === 2) {
        // A real stem can hold wide gaps and long numbers, and neither costs anything here.
        if (value.length > limits.questionChars) return over("question length");
        continue;
      }
      const isLabel = LABEL_FIELDS.has(key) || (key === "text" && section === "constructions");
      // A generator may keep its own copy of the stem under source. It counts like other text.
      const isStemCopy = key === "question" && section === "source";
      const size = isLabel ? limits.labelChars : isStemCopy ? limits.questionChars : key === "role" ? limits.roleChars : NAME_FIELDS.has(key) ? limits.nameChars : limits.textChars;
      if (value.length > size) return over("field length");
      total += value.length;
      if (total > limits.totalChars) return over("total length");
      if (isLabel) {
        labelTotal += value.length;
        if (++labels > limits.labelCount) return over("label count");
        if (labelTotal > limits.labelTotalChars) return over("label total");
      }
      if (section === "annotations" && key === "text") {
        annotationTotal += value.length;
        if (annotationTotal > limits.annotationTotalChars) return over("annotation total");
      }
      if (OVER_LONG_WHITESPACE.test(value)) return over("whitespace run");
      if (OVER_LONG_DIGITS.test(value)) return over("digit run");
    } else if (Array.isArray(value)) {
      if (value.length > limits.entries) return over("entry count");
      for (const entry of value) pending.push({ value: entry, key, depth: depth + 1, section });
    } else if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value);
      if (entries.length > limits.entries) return over("entry count");
      for (const [entryKey, entry] of entries) {
        if (entryKey.length > limits.nameChars) return over("field length");
        total += entryKey.length;
        if (total > limits.totalChars) return over("total length");
        pending.push({ value: entry, key: entryKey, depth: depth + 1, section: depth === 0 ? entryKey : section });
      }
    }
  }
  return null;
}
