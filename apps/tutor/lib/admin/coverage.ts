import taxonomy from "../../../../data/question-bank/syllabus-taxonomy.json";
import { FAILED_TURN_CODES, FAILED_TURN_ISSUE_CODES } from "../obs/failedTurnTelemetry";

export interface CoverageWindow { from: string; to: string }
export interface CoverageFact {
  subject: unknown; chapterId: unknown; requirement: unknown; visualStatus: unknown; status: unknown;
  hasTrustedInk: boolean; degradationReason: unknown; issueCodes: unknown;
  failureCode: unknown; failureIssueCodes: unknown; recordedUnknownIssueCount?: unknown; strategy: unknown; count: bigint | number;
}
export interface CoverageCounts {
  savedLessons: number; needed: number; drawn: number; neededDrawn: number; neededEmpty: number;
  neededUnknown: number; empty: number; unrecordedNeed: number; unrecordedOutcome: number;
}
export interface CoverageGroup extends CoverageCounts { subject: string; chapterId: string | null; chapter: string }
export interface CoverageEmptyReason {
  subject: string; chapterId: string | null; chapter: string; requirement: string; status: string;
  degradationReason: string; failureCode: string; issueCodes: string[]; unknownIssueCount: number;
  strategy: string; fallbackSuppressed: "yes" | "unrecorded";
  evidence: "text_only" | "retry_required" | "validated_without_saved_ink"; lessons: number;
}
export interface CoverageReport {
  window: CoverageWindow; totals: CoverageCounts; subjects: CoverageGroup[]; chapters: CoverageGroup[];
  emptyReasons: CoverageEmptyReason[];
}
const DAY = 86_400_000;
const SUBJECTS = ["maths", "physics", "chemistry", "other", "unknown"];
const ISSUES = new Set<string>(FAILED_TURN_ISSUE_CODES);
const REASONS = new Set<string>(FAILED_TURN_CODES);
const member = (value: unknown, choices: readonly string[], fallback = "unrecorded") =>
  typeof value === "string" && choices.includes(value) ? value : fallback;
const known = (value: unknown) => typeof value === "string" && REASONS.has(value) ? value : "unrecorded";

/** Date-only UTC bounds; start inclusive, end exclusive. No partial/bad dates. */
export function parseCoverageWindow(params: URLSearchParams, now = new Date()): CoverageWindow {
  if (params.getAll("from").length > 1 || params.getAll("to").length > 1) throw new Error("invalid_coverage_window");
  const from = params.get("from");
  const to = params.get("to");
  if ((from === null) !== (to === null)) throw new Error("invalid_coverage_window");
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = from ?? new Date(today - 6 * DAY).toISOString().slice(0, 10);
  const end = to ?? new Date(today + DAY).toISOString().slice(0, 10);
  for (const value of [start, end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value) throw new Error("invalid_coverage_window");
  }
  const span = Date.parse(end) - Date.parse(start);
  if (span <= 0 || span > 366 * DAY) throw new Error("invalid_coverage_window");
  return { from: start, to: end };
}

function emptyCounts(): CoverageCounts {
  return { savedLessons: 0, needed: 0, drawn: 0, neededDrawn: 0, neededEmpty: 0,
    neededUnknown: 0, empty: 0, unrecordedNeed: 0, unrecordedOutcome: 0 };
}
/** Chapter names only come from the checked-in taxonomy, never arbitrary strings. */
function chapterFor(subject: string, id: unknown) {
  const unit = taxonomy.subjects.find(row => row.subject_id === subject)?.units.find(row => row.unit_id === id);
  return { chapterId: unit?.unit_id ?? null, chapter: unit?.name ?? "Unrecorded" };
}
function add(target: CoverageCounts, row: CoverageCounts) {
  for (const key of Object.keys(target) as Array<keyof CoverageCounts>) {
    // Groups carry dimensions as well, so only known numeric counters are added.
    if (typeof row[key] === "number") {
      target[key] += row[key];
      if (!Number.isSafeInteger(target[key])) throw new Error("coverage_count_overflow");
    }
  }
}

/** Fold only content-free SQL projections; missing evidence stays explicit. */
export function aggregateCoverage(facts: readonly CoverageFact[], window: CoverageWindow): CoverageReport {
  const totals = emptyCounts();
  const subjects = new Map<string, CoverageGroup>();
  const chapters = new Map<string, CoverageGroup>();
  const emptyReasons = new Map<string, CoverageEmptyReason>();
  for (const fact of facts) {
    const count = Number(fact.count);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("invalid_coverage_count");
    const subject = member(fact.subject, SUBJECTS, "unknown");
    const chapter = chapterFor(subject, fact.chapterId);
    const requirement = member(fact.requirement, ["required", "optional", "none"]);
    const visual = member(fact.visualStatus, ["validated", "text_only", "retry_required"]);
    const drawn = visual === "validated" && fact.hasTrustedInk === true;
    const empty = !drawn && visual !== "unrecorded";
    const needed = requirement === "required";
    const counts: CoverageCounts = { savedLessons: count, needed: needed ? count : 0, drawn: drawn ? count : 0,
      neededDrawn: needed && drawn ? count : 0, neededEmpty: needed && empty ? count : 0,
      neededUnknown: needed && !drawn && !empty ? count : 0, empty: empty ? count : 0,
      unrecordedNeed: requirement === "unrecorded" ? count : 0,
      unrecordedOutcome: !drawn && !empty ? count : 0 };
    add(totals, counts);
    for (const [map, key, dimension] of [[subjects, subject, { chapterId: null, chapter: "All chapters" }],
      [chapters, JSON.stringify([subject, chapter.chapterId]), chapter]] as const) {
      const group = map.get(key) ?? { ...emptyCounts(), subject, ...dimension };
      add(group, counts);
      map.set(key, group);
    }
    if (!empty) continue;
    const rawCodes = [...(Array.isArray(fact.issueCodes) ? fact.issueCodes : []),
      ...(Array.isArray(fact.failureIssueCodes) ? fact.failureIssueCodes : [])];
    const issueCodes = [...new Set(rawCodes.filter((value): value is string => typeof value === "string" && ISSUES.has(value)))].sort();
    const row: CoverageEmptyReason = { subject, ...chapter, requirement,
      status: member(fact.status, ["complete", "stopped"]), degradationReason: known(fact.degradationReason),
      failureCode: known(fact.failureCode), issueCodes,
      unknownIssueCount: rawCodes.filter(value => typeof value !== "string" || !ISSUES.has(value)).length +
        (typeof fact.recordedUnknownIssueCount === "number" && Number.isSafeInteger(fact.recordedUnknownIssueCount)
          && fact.recordedUnknownIssueCount > 0 ? Math.min(10_000, fact.recordedUnknownIssueCount) : 0),
      strategy: member(fact.strategy, ["current", "strict"]),
      fallbackSuppressed: fact.failureCode === "fallback_suppressed" || fact.degradationReason === "fallback_suppressed" ||
        issueCodes.includes("fallback_suppressed") || issueCodes.includes("source_policy_suppressed") ? "yes" : "unrecorded",
      evidence: visual === "validated" ? "validated_without_saved_ink" : visual === "retry_required" ? "retry_required" : "text_only",
      lessons: 0 };
    const key = JSON.stringify(row);
    const current = emptyReasons.get(key) ?? row;
    current.lessons += count;
    emptyReasons.set(key, current);
  }
  const order = (a: CoverageGroup, b: CoverageGroup) => a.subject.localeCompare(b.subject) || a.chapter.localeCompare(b.chapter);
  return { window, totals, subjects: [...subjects.values()].sort(order), chapters: [...chapters.values()].sort(order),
    emptyReasons: [...emptyReasons.values()].sort((a, b) => b.lessons - a.lessons || JSON.stringify(a).localeCompare(JSON.stringify(b))) };
}
