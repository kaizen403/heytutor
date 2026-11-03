/**
 * Reference picture analytics: what happened on saved lessons whose verified
 * figure was not drawn. Pure folds over content-free SQL projections, shared
 * by the admin API, the verify script and the local sample script.
 *
 * The picture tier never touches `figureSource`, `diagramResultStatus` or
 * `visual_status`, so the engine's outcome is read from those exactly as the
 * other admin pages read it, and the picture's own outcome only from
 * `sceneArtifacts.referencePictureOutcome` (the browser's account) and
 * `sceneArtifacts.referencePicture` (written by the server from its record).
 * Only lesson turns count: a resume copies its lesson's outcome.
 */
import { isReferencePictureId, referencePictureAssetUrls } from "@heytutor/drawing";
import type { FigureSource } from "@heytutor/scene-engine";
import {
  readReferencePictureOutcome,
  type ReferencePictureOutcome,
} from "@/features/tutor-session/lib/scene/referencePicturePresentation";
import { classifyOutcome, extractArtifactSummary, type DegradationReason, type TurnOutcome } from "./outcome";
import { recentDayRange, utcDayKey, type DayCount } from "./timeBuckets";

const DAY_MS = 86_400_000;
/** Whole UTC days, so the tiles and the daily series cover the same rows. */
export const PICTURE_PERIOD_DAYS = [1, 7, 30, 90] as const;
export type PicturePeriodDays = (typeof PICTURE_PERIOD_DAYS)[number];
/** Newest saved lessons read for one report. One extra row is the truncation witness. */
export const PICTURE_SCAN_BUDGET = 5_000;
export const PICTURE_RECENT_LIMIT = 50;
export const PICTURE_LIBRARY_LIMIT = 100;
export const PICTURE_CACHE_LIMIT = 20;
/** A cached decline is retried after a day (`lib/reference-picture/cachePolicy.ts`). */
export { DECLINE_TTL_MS as CACHED_DECLINE_TTL_MS } from "@/lib/reference-picture/cachePolicy";

const SUBJECTS = ["maths", "physics", "chemistry", "other", "unknown"] as const;
export type PictureSubject = (typeof SUBJECTS)[number];
const NEEDS = new Set(["required", "optional"]);
export type PictureRequirement = "required" | "optional" | "none" | "unrecorded";
/** Same shape rule as the outcome reader; anything else is never echoed back. */
const CODE = /^[a-z0-9_:-]{1,64}$/i;

export interface PicturesWindow {
  days: PicturePeriodDays;
  /** UTC day, inclusive. */
  from: string;
  /** UTC day, exclusive (tomorrow). */
  to: string;
}

/** `?days=` from the fixed list, default 7. Repeated or unknown values are rejected, not guessed. */
export function parsePicturesPeriod(params: URLSearchParams, nowMs: number = Date.now()): PicturesWindow {
  const values = params.getAll("days");
  if (values.length > 1) throw new Error("invalid_pictures_period");
  const raw = values[0];
  const days = raw === undefined ? 7 : Number(raw);
  if (raw !== undefined && !/^\d{1,3}$/.test(raw)) throw new Error("invalid_pictures_period");
  if (!(PICTURE_PERIOD_DAYS as readonly number[]).includes(days)) throw new Error("invalid_pictures_period");
  return picturesWindow(days as PicturePeriodDays, nowMs);
}

export function picturesWindow(days: PicturePeriodDays, nowMs: number = Date.now()): PicturesWindow {
  const range = recentDayRange(days, nowMs);
  return { days, from: range[0]!, to: utcDayKey(Date.parse(`${range[range.length - 1]}T00:00:00.000Z`) + DAY_MS) };
}

/** The window's day keys, oldest first; the series is zero filled over exactly these. */
export function windowDays(window: PicturesWindow): string[] {
  const days: string[] = [];
  for (let at = Date.parse(`${window.from}T00:00:00.000Z`); at < Date.parse(`${window.to}T00:00:00.000Z`); at += DAY_MS) {
    days.push(utcDayKey(at));
  }
  return days;
}

// --- facts ---------------------------------------------------------------------

/** One saved lesson, projected to the fields this page reads. No identities or text. */
export interface PictureFact {
  day: unknown;
  subject: unknown;
  requirement: unknown;
  visualStatus: unknown;
  /** `sceneArtifacts.referencePictureOutcome`, validated here by the turn's own reader. */
  outcome: unknown;
  /** `sceneArtifacts.referencePicture.id` and `.source`: present only when the server saved the picture. */
  pictureId: unknown;
  pictureSource: unknown;
  windowMatches?: unknown;
}

export interface PictureStatusCounts {
  /** Lessons that needed a figure the engine did not draw. */
  needed: number;
  attempted: number;
  notAttempted: number;
  shown: number;
  declined: number;
  unavailable: number;
  skipped: number;
}

export interface PicturesTotals extends PictureStatusCounts {
  lessons: number;
  engineDrew: number;
  /** Needed rows whose plan recorded no requirement, counted only on picture evidence. */
  unrecordedNeed: number;
  /** Attempted rows started while the scene still planned (subjects with no engine). */
  speculative: number;
  /** The browser said shown, but the server saved no picture (record missing, or ink stripped). */
  shownUnsaved: number;
  /** A speculative request dropped because the engine drew after all: paid, not shown. */
  abandonedAfterDraw: number;
  /** An outcome on a lesson whose plan said no figure (a request the turn did not wait for). */
  outsideNeed: number;
  /** shown / needed, null when nothing was needed. */
  shownRate: number | null;
  /** shown / attempted, null when nothing was attempted. */
  shownOfAttempted: number | null;
}

export interface PictureSubjectRow extends PictureStatusCounts {
  subject: PictureSubject;
  shownRate: number | null;
}

export interface PictureReasonRow {
  status: "declined" | "unavailable" | "skipped";
  reason: string;
  count: number;
}

export interface PictureMsStats {
  count: number;
  medianMs: number | null;
  p90Ms: number | null;
}

export interface PictureScan {
  budget: number;
  scanned: number;
  truncated: boolean;
}

export interface PictureOutcomeSummary {
  totals: PicturesTotals;
  subjects: PictureSubjectRow[];
  reasons: PictureReasonRow[];
  sources: Array<{ source: "wikimedia" | "generated"; count: number }>;
  ms: { attempted: PictureMsStats; shown: PictureMsStats };
  daily: { needed: DayCount[]; shown: DayCount[] };
  scan: PictureScan;
}

const member = <T extends string>(value: unknown, choices: readonly T[], fallback: T): T =>
  typeof value === "string" && (choices as readonly string[]).includes(value) ? (value as T) : fallback;

const requirementOf = (value: unknown): PictureRequirement =>
  value === "required" || value === "optional" || value === "none" ? value : "unrecorded";

export const pictureRate = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

function emptyStatus(): PictureStatusCounts {
  return { needed: 0, attempted: 0, notAttempted: 0, shown: 0, declined: 0, unavailable: 0, skipped: 0 };
}

/** Linear interpolation between ranks (Postgres `percentile_cont`), rounded to whole ms. */
export function percentileMs(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return Math.round(sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low));
}

export function msStats(values: readonly number[]): PictureMsStats {
  return { count: values.length, medianMs: percentileMs(values, 0.5), p90Ms: percentileMs(values, 0.9) };
}

/** The outcome as the turn's own reader accepts it; malformed telemetry reads as no attempt. */
export function readPictureOutcome(raw: unknown): ReferencePictureOutcome | null {
  return readReferencePictureOutcome({ referencePictureOutcome: raw });
}

/**
 * The SQL reads at most one witness past the budget. Counts describe exactly
 * the scanned set; a partial report never claims to be the whole period.
 */
export function pictureScan(facts: readonly PictureFact[]): PictureScan {
  if (facts.length === 0 || facts.every((fact) => fact.windowMatches == null)) {
    return { budget: PICTURE_SCAN_BUDGET, scanned: facts.length, truncated: false };
  }
  const matches = Number(facts[0]?.windowMatches);
  if (!Number.isSafeInteger(matches) || matches < facts.length || facts.some((fact) => Number(fact.windowMatches) !== matches)) {
    throw new Error("pictures_scan_mismatch");
  }
  const truncated = matches > PICTURE_SCAN_BUDGET;
  const scanned = truncated ? PICTURE_SCAN_BUDGET : matches;
  if (facts.length !== scanned) throw new Error("pictures_scan_mismatch");
  return { budget: PICTURE_SCAN_BUDGET, scanned, truncated };
}

/**
 * Engine drew = `visual_status` validated. Needed = the engine did not draw
 * and the saved plan asked for a figure (required or optional), or the plan
 * is unrecorded but a picture attempt is evidence the turn asked (the tier
 * runs only when the requirement is not none). A plan of none with an
 * outcome is a request the turn did not wait for, counted on its own.
 */
export function aggregatePictureOutcomes(facts: readonly PictureFact[], window: PicturesWindow): PictureOutcomeSummary {
  const totals = { ...emptyStatus(), lessons: 0, engineDrew: 0, unrecordedNeed: 0, speculative: 0,
    shownUnsaved: 0, abandonedAfterDraw: 0, outsideNeed: 0 };
  const subjects = new Map<PictureSubject, PictureStatusCounts>(SUBJECTS.map((subject) => [subject, emptyStatus()]));
  const reasons = new Map<string, PictureReasonRow>();
  const sources = new Map<"wikimedia" | "generated", number>();
  const attemptedMs: number[] = [];
  const shownMs: number[] = [];
  const days = windowDays(window);
  const neededByDay = new Map(days.map((day) => [day, 0]));
  const shownByDay = new Map(days.map((day) => [day, 0]));
  for (const fact of facts) {
    totals.lessons += 1;
    const outcome = readPictureOutcome(fact.outcome);
    const requirement = requirementOf(fact.requirement);
    const drew = fact.visualStatus === "validated";
    if (drew) totals.engineDrew += 1;
    const needed = !drew && (NEEDS.has(requirement) || (requirement === "unrecorded" && outcome !== null));
    if (!needed) {
      if (outcome && drew) totals.abandonedAfterDraw += 1;
      else if (outcome) totals.outsideNeed += 1;
      continue;
    }
    const subject = member(fact.subject, SUBJECTS, "unknown");
    const group = subjects.get(subject)!;
    const counts: PictureStatusCounts[] = [totals, group];
    const bump = (key: keyof PictureStatusCounts) => { for (const target of counts) target[key] += 1; };
    bump("needed");
    if (requirement === "unrecorded") totals.unrecordedNeed += 1;
    const day = typeof fact.day === "string" ? fact.day : null;
    if (day && neededByDay.has(day)) neededByDay.set(day, neededByDay.get(day)! + 1);
    if (!outcome || !outcome.attempted) {
      bump("notAttempted");
      continue;
    }
    bump("attempted");
    bump(outcome.status);
    attemptedMs.push(outcome.ms);
    if (outcome.speculative) totals.speculative += 1;
    if (outcome.status === "shown") {
      shownMs.push(outcome.ms);
      if (day && shownByDay.has(day)) shownByDay.set(day, shownByDay.get(day)! + 1);
      const saved = isReferencePictureId(fact.pictureId);
      if (!saved) totals.shownUnsaved += 1;
      const source = fact.pictureSource === "wikimedia" || fact.pictureSource === "generated" ? fact.pictureSource : null;
      if (saved && source) sources.set(source, (sources.get(source) ?? 0) + 1);
      continue;
    }
    const reason = outcome.reason && CODE.test(outcome.reason) ? outcome.reason : "unrecorded";
    const key = `${outcome.status}:${reason}`;
    const row = reasons.get(key) ?? { status: outcome.status, reason, count: 0 };
    row.count += 1;
    reasons.set(key, row);
  }
  return {
    totals: { ...totals, shownRate: pictureRate(totals.shown, totals.needed), shownOfAttempted: pictureRate(totals.shown, totals.attempted) },
    // Every subject is listed, zero rows included, so a missing subject reads as none, not as unknown.
    subjects: SUBJECTS.map((subject) => {
      const row = subjects.get(subject)!;
      return { subject, ...row, shownRate: pictureRate(row.shown, row.needed) };
    }).filter((row) => row.subject !== "unknown" || row.needed > 0),
    reasons: [...reasons.values()].sort((a, b) => b.count - a.count || a.status.localeCompare(b.status) || a.reason.localeCompare(b.reason)),
    sources: [...sources.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
    ms: { attempted: msStats(attemptedMs), shown: msStats(shownMs) },
    daily: {
      needed: days.map((day) => ({ day, count: neededByDay.get(day) ?? 0 })),
      shown: days.map((day) => ({ day, count: shownByDay.get(day) ?? 0 })),
    },
    scan: pictureScan(facts),
  };
}

// --- recent turns ----------------------------------------------------------------

export interface PictureTurnSource {
  id: unknown;
  createdAt: unknown;
  question: unknown;
  userId: unknown;
  userName: unknown;
  userEmail: unknown;
  subject: unknown;
  requirement: unknown;
  visualStatus: unknown;
  figureSource: unknown;
  diagramResultStatus: unknown;
  degradation: unknown;
  outcome: unknown;
  pictureId: unknown;
  pictureSource: unknown;
  pictureTitle: unknown;
  pictureLicense: unknown;
}

export interface PictureShown {
  id: string;
  source: "wikimedia" | "generated";
  title: string;
  license: string;
  thumbUrl: string;
}

export interface PictureTurnRow {
  turnId: string;
  createdAt: string;
  subject: PictureSubject;
  question: string;
  userId: string;
  userLabel: string;
  engine: {
    outcome: TurnOutcome;
    requirement: PictureRequirement;
    figureSource: FigureSource | null;
    degradationReason: DegradationReason | null;
  };
  picture: ReferencePictureOutcome | null;
  shown: PictureShown | null;
}

/** Long enough for the table's tooltip; the cell truncates further, as the other tables do. */
export const PICTURE_QUESTION_MAX = 240;

const text = (value: unknown, max: number): string | null => (typeof value === "string" ? value.slice(0, max) : null);

function pictureUserLabel(userId: string, name: unknown, email: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed) return trimmed.slice(0, 120);
  if (typeof email === "string" && email) return email.slice(0, 200);
  return userId.slice(0, 8);
}

export function shapePictureTurn(row: PictureTurnSource): PictureTurnRow | null {
  if (typeof row.id !== "string" || typeof row.userId !== "string") return null;
  const created = row.createdAt instanceof Date ? row.createdAt : typeof row.createdAt === "string" ? new Date(row.createdAt) : null;
  if (!created || !Number.isFinite(created.getTime())) return null;
  const summary = extractArtifactSummary({ figureSource: row.figureSource, diagramResultStatus: row.diagramResultStatus, degradation: row.degradation });
  const source: PictureShown["source"] | null = row.pictureSource === "wikimedia" || row.pictureSource === "generated" ? row.pictureSource : null;
  const shown: PictureShown | null = isReferencePictureId(row.pictureId) && source
    ? { id: row.pictureId, source, title: text(row.pictureTitle, 400) ?? "Untitled", license: text(row.pictureLicense, 200) ?? "unrecorded",
        thumbUrl: referencePictureAssetUrls(row.pictureId).imageUrl }
    : null;
  return {
    turnId: row.id,
    createdAt: created.toISOString(),
    subject: member(row.subject, SUBJECTS, "unknown"),
    question: text(row.question, PICTURE_QUESTION_MAX) ?? "",
    userId: row.userId,
    userLabel: pictureUserLabel(row.userId, row.userName, row.userEmail),
    engine: {
      outcome: classifyOutcome(typeof row.visualStatus === "string" ? row.visualStatus : null),
      requirement: requirementOf(row.requirement),
      figureSource: summary?.figureSource ?? null,
      degradationReason: summary?.degradationReason ?? null,
    },
    picture: readPictureOutcome(row.outcome),
    shown,
  };
}

// --- library -----------------------------------------------------------------------

export interface PictureLibrarySource {
  id: unknown;
  source: unknown;
  title: unknown;
  shows: unknown;
  license: unknown;
  artist: unknown;
  pageUrl: unknown;
  labelCount: unknown;
  width: unknown;
  height: unknown;
  createdAt: unknown;
  turns: unknown;
  lastUsedAt: unknown;
}

export interface PictureLibraryRow {
  id: string;
  source: "wikimedia" | "generated" | "unrecorded";
  title: string;
  /** The judge's "must show" topic for this picture. */
  shows: string;
  license: string;
  artist: string;
  /** Only an https link is kept, so a stored record can never become a script URL. */
  pageUrl: string | null;
  labelCount: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  /** Lesson turns in the period that saved this picture. */
  turns: number;
  lastUsedAt: string | null;
  thumbUrl: string;
}

const iso = (value: unknown): string | null => {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const whole = (value: unknown): number | null => {
  const n = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

export function shapeLibraryRow(row: PictureLibrarySource): PictureLibraryRow | null {
  if (!isReferencePictureId(row.id)) return null;
  const createdAt = iso(row.createdAt);
  if (!createdAt) return null;
  const pageUrl = typeof row.pageUrl === "string" && row.pageUrl.length <= 1000 && /^https:\/\//.test(row.pageUrl) ? row.pageUrl : null;
  return {
    id: row.id,
    source: row.source === "wikimedia" || row.source === "generated" ? row.source : "unrecorded",
    title: text(row.title, 400) ?? "Untitled",
    shows: text(row.shows, 240) ?? "",
    license: text(row.license, 200) ?? "unrecorded",
    artist: text(row.artist, 400) ?? "",
    pageUrl,
    labelCount: whole(row.labelCount) ?? 0,
    width: whole(row.width),
    height: whole(row.height),
    createdAt,
    turns: whole(row.turns) ?? 0,
    lastUsedAt: iso(row.lastUsedAt),
    thumbUrl: referencePictureAssetUrls(row.id).imageUrl,
  };
}

// --- query cache -------------------------------------------------------------------

export interface PictureCacheSource {
  totals: { total: unknown; accepted: unknown; declined: unknown; declinedActive: unknown } | undefined;
  reasons: ReadonlyArray<{ reason: unknown; count: unknown; latestAt: unknown }>;
  recent: ReadonlyArray<{ keyPrefix: unknown; reason: unknown; createdAt: unknown }>;
}

export interface PictureCacheSummary {
  total: number;
  accepted: number;
  declined: number;
  /** Declines younger than the decline TTL: a repeat of the topic skips the judge. */
  declinedActive: number;
  reasons: Array<{ reason: string; count: number; latestAt: string | null }>;
  recent: Array<{ keyPrefix: string; reason: string; createdAt: string }>;
}

/** Stored reasons are pipeline codes; anything else reads as unrecognised, never as free text. */
const cacheReason = (value: unknown) => (value == null ? "no_picture" : typeof value === "string" && CODE.test(value) ? value : "unrecognised");

export function shapePictureCache(source: PictureCacheSource): PictureCacheSummary {
  const reasons = new Map<string, { reason: string; count: number; latestAt: string | null }>();
  for (const row of source.reasons) {
    const reason = cacheReason(row.reason);
    const current = reasons.get(reason) ?? { reason, count: 0, latestAt: null };
    current.count += whole(row.count) ?? 0;
    const latest = iso(row.latestAt);
    if (latest && (!current.latestAt || latest > current.latestAt)) current.latestAt = latest;
    reasons.set(reason, current);
  }
  return {
    total: whole(source.totals?.total) ?? 0,
    accepted: whole(source.totals?.accepted) ?? 0,
    declined: whole(source.totals?.declined) ?? 0,
    declinedActive: whole(source.totals?.declinedActive) ?? 0,
    reasons: [...reasons.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    recent: source.recent.flatMap((row) => {
      const createdAt = iso(row.createdAt);
      const keyPrefix = typeof row.keyPrefix === "string" ? row.keyPrefix.replace(/[^a-z0-9_:-]/gi, "").slice(0, 12) : "";
      return createdAt ? [{ keyPrefix, reason: cacheReason(row.reason), createdAt }] : [];
    }),
  };
}

// --- payload -----------------------------------------------------------------------

export interface PicturesReport extends PictureOutcomeSummary {
  generatedAt: string;
  window: PicturesWindow;
  recent: PictureTurnRow[];
  library: { total: number; wikimedia: number; generated: number; truncated: boolean; rows: PictureLibraryRow[] };
  cache: PictureCacheSummary;
}
