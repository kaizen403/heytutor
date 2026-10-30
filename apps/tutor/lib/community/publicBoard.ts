/**
 * What Community shows of a board, and to whom. Pure: no database, so the
 * privacy gate can check every rule here without a server.
 *
 * Community is public by default. That makes the reader the place where a
 * mistake leaks: a field added to the owner's board GET must not reach a
 * stranger by accident. So the public turn is built from a whitelist, never by
 * deleting fields from the owner's shape.
 */
import type { SubjectId } from "@/lib/account/types";
import { isTurnKind } from "@/lib/boards/turnStatus";

export type CommunityVisibility = "public" | "private";

export function isCommunityVisibility(value: unknown): value is CommunityVisibility {
  return value === "public" || value === "private";
}

export type CommunitySort = "featured" | "trending" | "new";

export function parseCommunitySort(value: unknown): CommunitySort {
  return value === "featured" || value === "new" ? value : "trending";
}

/** Community lists a lesson only after it has spoken for at least this long. */
export const COMMUNITY_MIN_LESSON_MS = 60_000;

export const COMMUNITY_HANDLE = /^[a-z0-9](?:[a-z0-9_]{1,22})[a-z0-9]$/;

/** Names that would read as the product or its staff on a public card. */
const RESERVED_HANDLES = new Set([
  "accelute", "admin", "administrator", "community", "help", "mod", "moderator",
  "official", "staff", "support", "team", "tutor", "heytutor", "system",
]);

export function normalizeCommunityHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  if (!COMMUNITY_HANDLE.test(handle) || RESERVED_HANDLES.has(handle)) return null;
  return handle;
}

/**
 * The name under a Community card. A chosen handle wins. Without one, adults
 * show their first name; a minor shows a neutral label, never their account
 * name, and no one's email or avatar is ever sent.
 */
export function communityAuthorName(user: { handle: string | null; name: string | null; ageBand: string | null }): string {
  if (user.handle) return `@${user.handle}`;
  if (user.ageBand === "18_plus") {
    const first = user.name?.trim().split(/\s+/)[0];
    if (first) return first.slice(0, 40);
  }
  return "Accelute student";
}

export interface CommunityAuthor {
  name: string;
  /** One letter for the avatar circle. */
  initial: string;
}

export function communityAuthor(user: { handle: string | null; name: string | null; ageBand: string | null }): CommunityAuthor {
  const name = communityAuthorName(user);
  const initial = name.replace(/^@/, "").charAt(0).toUpperCase() || "A";
  return { name, initial };
}

const SUBJECT_PREFIX: Array<{ subject: SubjectId; pattern: RegExp }> = [
  { subject: "physics", pattern: /^\s*physics\b/i },
  { subject: "maths", pattern: /^\s*(?:maths?|mathematics)\b/i },
  { subject: "chemistry", pattern: /^\s*chemistry\b/i },
  { subject: "dsa", pattern: /^\s*(?:dsa|leetcode)\b/i },
];

/** Words the general subject guess misses on Community titles. */
const SUBJECT_EXTRA: Array<{ subject: SubjectId; pattern: RegExp }> = [
  { subject: "chemistry", pattern: /\b(lewis|covalent|ionic|bond(?:ing)?|electron(?:s)?|vsepr|oxidation|redox|organic|polymer|periodic|atom(?:ic)?|ion(?:s)?|chemical)\b/i },
  { subject: "maths", pattern: /\b(mathematics|pyramid|polynomial|quadratic|matrix|vector(?:s)?|derivative|sketch y|y\s*=|logarithm|trigonometr\w*|circle|parabola)\b/i },
];

/**
 * The subject chip on a card. An explicit "Physics:" style prefix wins, then
 * the title, then the question: a few specific words first, then the same
 * guess the Library uses (`infer`).
 */
export function communitySubject(
  title: string,
  question: string,
  infer: (text: string) => SubjectId | "other",
): SubjectId | "other" {
  for (const text of [title, question]) {
    const prefixed = SUBJECT_PREFIX.find((hint) => hint.pattern.test(text));
    if (prefixed) return prefixed.subject;
  }
  for (const text of [title, question]) {
    // The specific words first: the general guess reads "base" as chemistry.
    const extra = SUBJECT_EXTRA.find((hint) => hint.pattern.test(text));
    if (extra) return extra.subject;
    const guessed = infer(text);
    if (guessed !== "other") return guessed;
  }
  return "other";
}

export interface CommunityCard {
  id: string;
  title: string;
  /** The first question asked on the board. */
  question: string;
  subject: SubjectId | "other";
  author: CommunityAuthor;
  createdAt: number;
  viewCount: number;
  remixCount: number;
  featured: boolean;
  /** Null until the owner's tab uploads the card picture. */
  thumbnailUrl: string | null;
}

export function communityThumbnailUrl(boardId: string, thumbnailAt: Date | null): string | null {
  if (!thumbnailAt) return null;
  return `/api/community/${encodeURIComponent(boardId)}/thumbnail?v=${thumbnailAt.getTime()}`;
}

/**
 * A turn a stranger may watch: finished or stopped, and with something on
 * the board. A turn still marked live is never shown, even one its tab left
 * idle: the student may still resume it, and it would replay as finished.
 * A failed lesson with no steps adds nothing to the replay.
 */
export function isCommunityTurnShown(turn: { status: string; segmentCount: number }): boolean {
  if (turn.segmentCount < 1) return false;
  return turn.status === "complete" || turn.status === "stopped";
}

/**
 * Scene artifacts minus the turn's failure telemetry, which carries account
 * state (a billing code) rather than anything the board draws.
 */
export function communitySceneArtifacts(artifacts: unknown): unknown {
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) return artifacts;
  if (!Object.prototype.hasOwnProperty.call(artifacts, "failureTelemetry")) return artifacts;
  const rest: Record<string, unknown> = { ...(artifacts as Record<string, unknown>) };
  delete rest.failureTelemetry;
  return rest;
}

interface PrivateTurnRow {
  id: string;
  orderIndex: number;
  question: string;
  rawResponse: string;
  speedMultiplier: number;
  sceneDocument: unknown;
  sceneEngineVersion: string | null;
  validationReport: unknown;
  visualStatus: string | null;
  sceneArtifacts: unknown;
  status: string;
  kind: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PrivateSegmentRow {
  id: string;
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: unknown;
  audioUrl: string | null;
  audioFormat: string | null;
  audioRef: number | null;
  durationMs: number | null;
  timings: unknown;
}

/** Fields a public turn carries. A verify gate fails if this list grows unreviewed. */
export const COMMUNITY_TURN_FIELDS = [
  "id", "orderIndex", "question", "rawResponse", "speedMultiplier", "traceId",
  "sceneDocument", "sceneEngineVersion", "validationReport", "visualStatus",
  "sceneArtifacts", "status", "persistedStatus", "kind", "resumeState",
  "createdAt", "updatedAt", "segments",
] as const;

export const COMMUNITY_SEGMENT_FIELDS = [
  "id", "orderIndex", "narration", "spokenText", "command", "audioUrl",
  "audioFormat", "audioRef", "durationMs", "timings",
] as const;

/**
 * The owner's turn, as a stranger sees it. The trace id, Continue state, and
 * every Sentry and save bookkeeping column stay behind; `traceId` and
 * `resumeState` are present as null so the player reads the same shape.
 */
export function toCommunityTurn(turn: PrivateTurnRow, segments: readonly PrivateSegmentRow[]) {
  return {
    id: turn.id,
    orderIndex: turn.orderIndex,
    question: turn.question,
    rawResponse: turn.rawResponse,
    speedMultiplier: turn.speedMultiplier,
    traceId: null,
    sceneDocument: turn.sceneDocument,
    sceneEngineVersion: turn.sceneEngineVersion,
    validationReport: turn.validationReport,
    visualStatus: turn.visualStatus,
    sceneArtifacts: communitySceneArtifacts(turn.sceneArtifacts),
    // A stopped lesson replays as what it is; the reader never sees a live one.
    status: turn.status === "stopped" ? "stopped" as const : "complete" as const,
    persistedStatus: turn.status === "stopped" ? "stopped" as const : "complete" as const,
    kind: isTurnKind(turn.kind) ? turn.kind : "lesson" as const,
    resumeState: null,
    createdAt: turn.createdAt.getTime(),
    updatedAt: turn.updatedAt.getTime(),
    segments: segments.map((segment) => ({
      id: segment.id,
      orderIndex: segment.orderIndex,
      narration: segment.narration,
      spokenText: segment.spokenText,
      command: segment.command,
      audioUrl: segment.audioUrl,
      audioFormat: segment.audioFormat,
      audioRef: segment.audioRef,
      durationMs: segment.durationMs,
      timings: segment.timings,
    })),
  };
}

export type CommunityTurn = ReturnType<typeof toCommunityTurn>;
