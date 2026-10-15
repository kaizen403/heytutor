import { hasMeaningfulTurnSegments } from "../boards/turnStatus";

/** Closed, positive failure evidence. Expected text-only outcomes are absent. */
export const CONFIRMED_TURN_FAILURE_CODES = [
  "planner_unavailable", "candidate_invalid", "missing_capability", "solver_contradiction",
  "required_visual_unavailable", "turn_plan_rejected", "problem_ir_invalid", "scene_planner_invalid",
  "planner_deadline", "planner_declined", "fallback_suppressed", "transport_error", "provider_error",
  "budget_limit", "rate_limit", "save_failure", "scene_relevance_rejected",
  "lesson_not_taught", "teaching_segment_failed", "dsa_hint_unsupported",
] as const;
export type ConfirmedTurnFailureCode = typeof CONFIRMED_TURN_FAILURE_CODES[number];
export const UNCOMMITTED_VISUAL_STATUSES = ["text_only", "retry_required", "legacy"] as const;

export interface TurnFailureInput {
  visualStatus?: string | null;
  status?: string;
  sceneArtifacts?: unknown;
  resumeState?: unknown;
  segments?: readonly { narration?: string; spokenText?: string; command?: unknown }[];
  /** Canonical persisted relation count, when the actual rows were not fetched. */
  segmentCount?: number;
}
export interface TurnFailureClassification {
  classification: "failed" | "healthy" | "unverified" | "pending";
  code: ConfirmedTurnFailureCode | "unknown" | null;
  taught: boolean | null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function confirmedCode(value: unknown): ConfirmedTurnFailureCode | null {
  return typeof value === "string" && (CONFIRMED_TURN_FAILURE_CODES as readonly string[]).includes(value)
    ? value as ConfirmedTurnFailureCode : null;
}

/**
 * The fails feed and Sentry share positive evidence, never the absence of a
 * diagram alone. A recovered verified figure clears diagram-attempt errors;
 * an explicit teaching failure still wins, including on continuation turns.
 */
export function classifyTurnFailure(input: TurnFailureInput): TurnFailureClassification {
  const artifacts = record(input.sceneArtifacts);
  const telemetry = record(artifacts.failureTelemetry);
  const plan = record(artifacts.turnPlan);
  const continuation = record(artifacts.boardContinuation).schemaVersion === "board-continuation/v1";
  const earlyOpeningOnly = record(input.resumeState).earlyOpeningOnly === true;
  const taught = input.segments === undefined ? null : !earlyOpeningOnly && hasMeaningfulTurnSegments(input.segments);
  const segmentCount = input.segments?.length ?? input.segmentCount;
  const verdict = (classification: TurnFailureClassification["classification"], code: TurnFailureClassification["code"] = null): TurnFailureClassification => ({ classification, code, taught });

  if (telemetry.failed === true) return verdict("failed", confirmedCode(telemetry.code) ?? "unknown");
  // Completed zero-row legacy saves are direct integrity evidence. A manual
  // Stop or a live checkpoint with no teaching is not the same statement.
  if (input.status === "complete" && segmentCount === 0) return verdict("failed", "lesson_not_taught");
  if (input.visualStatus === "validated") return verdict(input.status === "complete" && taught === false ? "unverified" : "healthy");

  const uncommitted = input.visualStatus == null || (UNCOMMITTED_VISUAL_STATUSES as readonly string[]).includes(input.visualStatus);
  if (uncommitted) {
    const code = confirmedCode(telemetry.code) ?? confirmedCode(record(artifacts.degradation).reason);
    if (code) return verdict("failed", code);
  }
  if (input.visualStatus === "retry_required") return verdict("failed", "required_visual_unavailable");
  if (input.status === "complete" && taught === false) return verdict("unverified");
  if (continuation || plan.visualRequirement === "none" || artifacts.diagramResultStatus === "not_required") return verdict("healthy");
  if (input.status === "live") return verdict("pending");
  return verdict("unverified");
}
