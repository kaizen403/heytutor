/**
 * The validation errors a scene repair round sends the planner, as bounded
 * lines instead of a raw JSON dump. Every fatal error comes first and names
 * the element it is about (its id, resolved from the error path against the
 * candidate itself), the validator's finding, and what was found and expected
 * when the validator measured it. Errors that differ only in an index are
 * merged into one line; warnings are counted, not listed. Whole lines are
 * kept or dropped, never cut, and anything dropped is named by code. Nothing
 * here adds a value: every text comes from the validator or the candidate.
 */
import type { SceneDocumentCandidate, SceneRepairError } from "./scenePlannerV2";

const DEFAULT_MAX_CHARS = 4000;
const MAX_SUMMARY_CHARS = 240;

/** A one-line list of codes, each named once, cut at whole codes with a count of the rest. */
function summary(head: string, codes: readonly string[], tail = ""): string {
  const distinct = [...new Set(codes)];
  const shown: string[] = [];
  for (const code of distinct) {
    if (head.length + [...shown, code].join(", ").length + tail.length + 16 > MAX_SUMMARY_CHARS) break;
    shown.push(code);
  }
  const rest = distinct.length - shown.length;
  return `${head}${shown.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}${tail}`;
}
const MAX_VALUE_CHARS = 160;

type Record_ = Record<string, unknown>;
const isRecord = (value: unknown): value is Record_ => typeof value === "object" && value !== null && !Array.isArray(value);

const COLLECTION_NOUNS: Record<string, string> = {
  assertions: "assertion", constructions: "construction", entities: "entity", quantities: "quantity",
  annotations: "annotation", relations: "relation", revealGroups: "reveal group", teachingTimeline: "timeline step",
};

/**
 * The element an error is about, named by the candidate's own ids. The
 * validator indexes the document it read (after pruning), so an index in a
 * path may point at a different item of the candidate: an index is turned
 * into an id only when the validator stamped that id on the error, or the
 * error's own message names that item. Otherwise the raw path is shown.
 */
export function repairErrorElement(candidate: SceneDocumentCandidate, error: SceneRepairError): string {
  if (typeof error.assertionId === "string") return `assertion ${error.assertionId}`;
  if (typeof error.constructionId === "string") return `construction ${error.constructionId}`;
  const indexed = /^([A-Za-z]+)\[(\d+)\](.*)$/.exec(error.path ?? "");
  if (indexed) {
    const [, collection, position, rest] = indexed as unknown as [string, string, string, string];
    const items = (candidate as Record_)[collection];
    const noun = COLLECTION_NOUNS[collection] ?? collection;
    const field = rest ? ` field ${rest.replace(/^\./, "")}` : "";
    // Only an explicit "id:" prefix names the element. A later word such as
    // "segment" must not steal the finding from the construction the compiler named.
    const prefix = /^([A-Za-z_][\w-]*)\s*:/.exec(error.message.trim())?.[1];
    const named = prefix && Array.isArray(items) ? items.find((item): item is Record_ =>
      isRecord(item) && item.id === prefix) : undefined;
    if (named) {
      const operator = collection === "constructions" && typeof named.operator === "string" ? ` (${named.operator})` : "";
      return `${noun} ${String(named.id)}${operator}${field}`;
    }
    return `${collection}[${position}]${rest}`;
  }
  if (Array.isArray(error.entityIds) && error.entityIds.length > 0) return `entities ${error.entityIds.slice(0, 8).join(", ")}${error.entityIds.length > 8 ? ", …" : ""}`;
  return error.path ? error.path : "the document";
}

function compact(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length <= MAX_VALUE_CHARS ? text : `${text.slice(0, MAX_VALUE_CHARS - 1)}…`;
}

/** One line per finding: code, element, the validator's message, and measured/expected values it did not already write. */
function line(candidate: SceneDocumentCandidate, error: SceneRepairError, elements: string[]): string {
  const message = error.message.trim();
  const extras: string[] = [];
  // A construction finding shows the inputs the candidate itself wrote, so the repair edits those inputs.
  const construction = elements.length === 1 ? /^construction (\S+)/.exec(elements[0]!)?.[1] : undefined;
  const written = construction && Array.isArray(candidate.constructions)
    ? candidate.constructions.find((item) => isRecord(item) && item.id === construction) : undefined;
  if (isRecord(written) && isRecord(written.inputs)) extras.push(`Its inputs as written: ${compact(written.inputs)}.`);
  if (error.actual !== undefined && error.actual !== null && !message.includes("measured") && !message.includes(String(error.actual))) {
    extras.push(`Found ${compact(error.actual)}.`);
  }
  if (error.expected !== undefined && error.expected !== null && !message.includes("expected") && !message.includes("Valid when")) {
    extras.push(`Expected ${compact(error.expected)}.`);
  }
  const where = elements.length === 1 ? elements[0]! : `${elements.slice(0, 6).join("; ")}${elements.length > 6 ? `; and ${elements.length - 6} more` : ""}`;
  return `- ${error.code} at ${where}: ${message}${extras.length ? ` ${extras.join(" ")}` : ""}`;
}

export function renderRepairErrors(
  candidate: SceneDocumentCandidate,
  errors: readonly SceneRepairError[],
  options: { maxChars?: number } = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const fatal = errors.filter((error) => error.severity === "fatal");
  const warnings = errors.filter((error) => error.severity !== "fatal");
  // Errors that differ only in an index ("relations[0] needs …", "relations[1] needs …") are one finding.
  const groups = new Map<string, { error: SceneRepairError; elements: string[] }>();
  for (const error of fatal) {
    const key = `${error.code}|${error.message.replace(/\[\d+\]/g, "[]")}|${JSON.stringify(error.actual ?? null)}|${JSON.stringify(error.expected ?? null)}`;
    const element = repairErrorElement(candidate, error);
    const group = groups.get(key);
    if (group) { if (!group.elements.includes(element)) group.elements.push(element); }
    else groups.set(key, { error, elements: [element] });
  }
  const lines: string[] = [];
  let used = 0;
  const omitted: string[] = [];
  // Room is kept for the omitted-findings and warnings lines, so the whole section stays within maxChars.
  const budget = Math.max(0, maxChars - 2 * MAX_SUMMARY_CHARS);
  for (const { error, elements } of groups.values()) {
    const text = line(candidate, error, elements);
    if (used + text.length + 1 > budget) { omitted.push(error.code); continue; }
    lines.push(text);
    used += text.length + 1;
  }
  if (omitted.length > 0) lines.push(summary(`- ${omitted.length} more fatal finding${omitted.length === 1 ? "" : "s"} not listed: `, omitted));
  if (warnings.length > 0) {
    lines.push(summary(`(${warnings.length} warning${warnings.length === 1 ? "" : "s"}, not blocking: `, warnings.map((warning) => warning.code), ")"));
  }
  return lines.length > 0 ? lines.join("\n") : "- no fatal finding was reported";
}
