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

/**
 * How many of each thing one document may hold. Every recorded document and all
 * generator output sit well inside them.
 */
export const SCENE_COUNT_LIMITS = Object.freeze({
  entities: 768,
  constructions: 768,
  annotations: 64,
  revealGroups: 32,
  assertions: 256,
  quantities: 128,
  relations: 32,
  teachingTimeline: 128,
  /** One kind of entity or construction, unless named below. */
  perKind: 32,
  kinds: Object.freeze({
    point: 768,
    segment: 256,
    rectangle: 256,
    vector: 128,
    label: 128,
    circle: 96,
    connect: 96,
    connector: 96,
    tick_mark: 64,
    space_point: 64,
    space_segment: 64,
    component: 48,
    curve_anchor: 48,
    polyline: 48,
    symbol: 48,
    dimension: 16,
    field_lines: 4,
    implicit_curve: 8,
    constraint_region: 4,
    centre_of_mass: 4,
    simple_body_inertia: 4,
    linear_feasible_region: 3,
    harmonic_wave: 8,
    wave_superposition: 4,
    function_region: 8,
  }),
});

/** Sizes of one construction's inputs, where they multiply. */
export const SCENE_INPUT_LIMITS = Object.freeze({
  /** Starts times steps in one set of field lines. */
  fieldLineSteps: 1_600,
  /** Harmonics times samples in one wave. */
  waveHarmonicSamples: 16_384,
});

const COUNTED_LISTS = ["entities", "constructions", "annotations", "revealGroups", "assertions", "quantities", "relations", "teachingTimeline"] as const;

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

/** The first count this document breaks, or null. */
export function sceneCountOverLimit(raw: unknown): SceneIssue | null {
  if (typeof raw !== "object" || raw === null) return null;
  const limits = SCENE_COUNT_LIMITS;
  const fields = raw as Record<string, unknown>;
  const over = (limit: string): SceneIssue => ({
    code: "scene_count_over_limit",
    message: `scene document is over the ${limit} count limit`,
    severity: "fatal",
    path: "$",
  });
  for (const field of COUNTED_LISTS) {
    const list = fields[field];
    if (Array.isArray(list) && list.length > limits[field]) return over(field);
  }
  for (const [list, key] of [[fields.constructions, "operator"], [fields.entities, "kind"]] as const) {
    if (!Array.isArray(list)) continue;
    const counts = new Map<string, number>();
    for (const entry of list) {
      const kind = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>)[key] : undefined;
      if (typeof kind !== "string") continue;
      const count = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, count);
      const limit = Object.hasOwn(limits.kinds, kind) ? limits.kinds[kind as keyof typeof limits.kinds] : limits.perKind;
      if (count > limit) return over("kind");
    }
  }
  return null;
}
