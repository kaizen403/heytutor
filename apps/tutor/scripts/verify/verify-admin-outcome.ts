/**
 * Admin outcome helpers: turn statuses folded to admin outcomes, and the
 * scene-artifacts JSON read into a slim summary (tier + degradation only).
 * Pure functions — the API routes and the verify scripts share them.
 */
import {
  classifyOutcome,
  extractArtifactSummary,
  outcomeLabel,
  FAILED_VISUAL_STATUSES,
} from "../../lib/admin/outcome";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- classifyOutcome ----------------------------------------------------------
{
  assert(classifyOutcome("validated") === "validated", "validated stays validated");
  assert(classifyOutcome("text_only") === "text_only", "text_only stays text_only");
  assert(
    classifyOutcome("retry_required") === "retry_required",
    "retry_required stays retry_required",
  );
  assert(classifyOutcome(null) === "unverified", "a null status is unverified, not failed");
  assert(classifyOutcome(undefined) === "unverified", "a missing status is unverified");
  assert(classifyOutcome("legacy") === "unverified", "legacy rows predate outcomes, not fails");
  assert(
    classifyOutcome("something-new") === "unverified",
    "an unknown status collapses to unverified rather than throwing",
  );
  assert(
    FAILED_VISUAL_STATUSES.includes("text_only") &&
      FAILED_VISUAL_STATUSES.includes("retry_required") &&
      FAILED_VISUAL_STATUSES.includes("legacy"),
    "the failed statuses are exactly text_only, retry_required, and legacy",
  );
}

// --- outcomeLabel -------------------------------------------------------------
{
  assert(outcomeLabel("validated") === "Verified diagram", "validated has a table label");
  assert(
    outcomeLabel("unverified") === "Unverified (legacy)",
    "unverified is labeled so legacy rows are not misread as confirmed fails",
  );
}

// --- extractArtifactSummary ---------------------------------------------------
{
  assert(extractArtifactSummary(null) === null, "null artifacts yield no summary");
  assert(extractArtifactSummary(undefined) === null, "undefined artifacts yield no summary");
  assert(extractArtifactSummary("nope") === null, "a non-record yields no summary");
  assert(extractArtifactSummary([1, 2]) === null, "an array is not a record — null");

  const empty = extractArtifactSummary({});
  assert(empty !== null, "any record yields a summary");
  assert(
    empty !== null &&
      empty.representationTier === null &&
      empty.degradationReason === null &&
      empty.issueCodes.length === 0 &&
      empty.candidateCount === null &&
      empty.diagramResultStatus === null,
    "an artifact-less record collapses every field to null",
  );

  const healthy = extractArtifactSummary({
    schemaVersion: "scene-artifacts/v3",
    representationTier: "exact_verified",
    diagramResultStatus: "ready",
    degradation: {
      attemptedTier: "exact_verified",
      reason: "missing_capability",
      issueCodes: ["no_operator", "no_operator", "bad code!", 7, ""],
      candidateCount: 3,
    },
  });
  assert(
    healthy !== null &&
      healthy.representationTier === "exact_verified" &&
      healthy.diagramResultStatus === "ready" &&
      healthy.degradationReason === "missing_capability" &&
      healthy.candidateCount === 3,
    "a well-formed artifact reads through",
  );
  assert(
    healthy !== null &&
      healthy.issueCodes.length === 1 &&
      healthy.issueCodes[0] === "no_operator",
    "issue codes dedupe and drop anything that is not a code-like string",
  );

  const capped = extractArtifactSummary({
    degradation: {
      reason: "not_a_real_reason",
      issueCodes: Array.from({ length: 80 }, (_, i) => `code_${i}`),
      candidateCount: -2,
    },
  });
  assert(
    capped !== null &&
      capped.degradationReason === null &&
      capped.candidateCount === null,
    "an unknown reason and a negative candidate count collapse to null",
  );
  assert(
    capped !== null && capped.issueCodes.length === 32,
    "issue codes are capped at 32 even when the array is longer",
  );

  const tiers = extractArtifactSummary({
    representationTier: "question_representation",
    diagramResultStatus: "text_only",
  });
  assert(
    tiers !== null &&
      tiers.representationTier === "question_representation" &&
      tiers.diagramResultStatus === "text_only",
    "fallback tiers survive with their own diagram status",
  );
}

console.log("✓ admin outcome classification and artifact summaries");
