import type {
  DiagramGenerationStatus,
  SceneArtifactsV3,
} from "@heytutor/scene-engine";

/**
 * How a persisted turn ended up on the canvas, folded to what an admin needs
 * to see. `unverified` covers every row that predates the verified-scene
 * pipeline ("legacy") or never recorded a status — those were taught without
 * an outcome rather than confirmed failed, and must not be misread as fails.
 */
export type TurnOutcome = "validated" | "text_only" | "retry_required" | "unverified";

const OUTCOME_BY_VISUAL_STATUS: Record<string, TurnOutcome> = {
  validated: "validated",
  text_only: "text_only",
  retry_required: "retry_required",
};

export function classifyOutcome(visualStatus: string | null | undefined): TurnOutcome {
  if (visualStatus == null) return "unverified";
  return OUTCOME_BY_VISUAL_STATUS[visualStatus] ?? "unverified";
}

/** Visual statuses that mean the turn taught without a verified diagram. */
export const FAILED_VISUAL_STATUSES: readonly ["text_only", "retry_required", "legacy"] = [
  "text_only",
  "retry_required",
  "legacy",
];

export const REPRESENTATION_TIERS = [
  "exact_verified",
  "qualitative_verified",
  "question_representation",
] as const;

export type RepresentationTier = (typeof REPRESENTATION_TIERS)[number];

/** Why an exact scene was attempted but not committed (scene-engine contract). */
export const DEGRADATION_REASONS = [
  "planner_unavailable",
  "candidate_invalid",
  "missing_capability",
  "solver_contradiction",
  "required_visual_unavailable",
] as const;

export type DegradationReason = (typeof DEGRADATION_REASONS)[number];

export const DIAGRAM_RESULT_STATUSES = ["ready", "retry_required", "not_required", "text_only"] as const;

const MAX_ISSUE_CODES = 32;
const ISSUE_CODE_PATTERN = /^[a-z0-9_-]{1,64}$/i;

/**
 * The slice of `SceneArtifactsV3` an admin surface needs: which tier was
 * committed, and — when nothing was — why. Extracted server-side so the full
 * artifacts JSON (plans, candidates, documents) never reaches the client.
 */
export interface ArtifactSummary {
  representationTier: RepresentationTier | null;
  degradationReason: DegradationReason | null;
  issueCodes: string[];
  candidateCount: number | null;
  diagramResultStatus: DiagramGenerationStatus | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRepresentationTier(value: unknown): value is RepresentationTier {
  return (
    typeof value === "string" &&
    (REPRESENTATION_TIERS as readonly string[]).includes(value)
  );
}

function isDegradationReason(value: unknown): value is DegradationReason {
  return (
    typeof value === "string" &&
    (DEGRADATION_REASONS as readonly string[]).includes(value)
  );
}

function isDiagramResultStatus(value: unknown): value is DiagramGenerationStatus {
  return (
    typeof value === "string" &&
    (DIAGRAM_RESULT_STATUSES as readonly string[]).includes(value)
  );
}

function parseIssueCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  // Same shape rules as persistence: unique, code-like, capped.
  return Array.from(
    new Set(
      raw.filter(
        (code): code is string => typeof code === "string" && ISSUE_CODE_PATTERN.test(code),
      ),
    ),
  ).slice(0, MAX_ISSUE_CODES);
}

/**
 * Read a persisted `sceneArtifacts` JSON value (Prisma `Json?`) into the admin
 * summary. Any record yields a summary — unknown or malformed fields collapse
 * to null rather than failing the row — and anything that is not a record
 * (null included) yields null.
 */
export function extractArtifactSummary(raw: unknown): ArtifactSummary | null {
  if (!isRecord(raw)) return null;
  const summary: ArtifactSummary = {
    representationTier: isRepresentationTier(raw.representationTier)
      ? raw.representationTier
      : null,
    degradationReason: null,
    issueCodes: [],
    candidateCount: null,
    diagramResultStatus: isDiagramResultStatus(raw.diagramResultStatus)
      ? raw.diagramResultStatus
      : null,
  };
  if (isRecord(raw.degradation)) {
    const degradation = raw.degradation as {
      reason?: unknown;
      issueCodes?: unknown;
      candidateCount?: unknown;
    };
    if (isDegradationReason(degradation.reason)) {
      summary.degradationReason = degradation.reason;
    }
    summary.issueCodes = parseIssueCodes(degradation.issueCodes);
    if (
      typeof degradation.candidateCount === "number" &&
      Number.isInteger(degradation.candidateCount) &&
      degradation.candidateCount >= 0
    ) {
      summary.candidateCount = degradation.candidateCount;
    }
  }
  return summary;
}

/** Human label for a stored visual status, for admin tables. */
export function outcomeLabel(outcome: TurnOutcome): string {
  switch (outcome) {
    case "validated":
      return "Verified diagram";
    case "text_only":
      return "Text only";
    case "retry_required":
      return "Retry required";
    case "unverified":
      return "Unverified (legacy)";
  }
}

export interface OutcomeCounts {
  validated: number;
  textOnly: number;
  retryRequired: number;
  unverified: number;
}

export function foldOutcomeCounts(
  rows: ReadonlyArray<{ visualStatus: string | null; count: number }>,
): OutcomeCounts {
  const counts: OutcomeCounts = { validated: 0, textOnly: 0, retryRequired: 0, unverified: 0 };
  for (const row of rows) {
    const outcome = classifyOutcome(row.visualStatus);
    if (outcome === "validated") counts.validated += row.count;
    else if (outcome === "text_only") counts.textOnly += row.count;
    else if (outcome === "retry_required") counts.retryRequired += row.count;
    else counts.unverified += row.count;
  }
  return counts;
}

export type { SceneArtifactsV3 };
