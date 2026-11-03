import { hasMeaningfulTurnSegments } from "../boards/turnStatus";

/** Closed, positive failure evidence. Expected text-only outcomes are absent. */
export const CONFIRMED_TURN_FAILURE_CODES = [
  "planner_unavailable", "candidate_invalid", "missing_capability", "solver_contradiction",
  "required_visual_unavailable", "turn_plan_rejected", "problem_ir_invalid", "scene_planner_invalid",
  "planner_deadline", "planner_declined", "fallback_suppressed", "transport_error", "provider_error",
  "budget_limit", "rate_limit", "save_failure", "scene_relevance_rejected",
  "lesson_not_taught", "teaching_segment_failed", "dsa_hint_unsupported", "valid_candidate_dropped",
] as const;
export type ConfirmedTurnFailureCode = typeof CONFIRMED_TURN_FAILURE_CODES[number];
export const UNCOMMITTED_VISUAL_STATUSES = ["text_only", "retry_required", "legacy"] as const;
/**
 * The confirmed codes that only say the engine drew no figure. A reference
 * picture on the board answers these. Every other confirmed code (the lesson,
 * the voice, billing, the save, a numeric contradiction) still fails the turn.
 */
export const PICTURE_ANSWERED_FAILURE_CODES = [
  "planner_unavailable", "candidate_invalid", "missing_capability", "required_visual_unavailable",
  "turn_plan_rejected", "problem_ir_invalid", "scene_planner_invalid", "planner_deadline", "planner_declined",
  "fallback_suppressed", "scene_relevance_rejected", "valid_candidate_dropped",
] as const satisfies readonly ConfirmedTurnFailureCode[];

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
  /** `picture_shown`: no verified figure, but the server stored a reference picture on the board. Neither failed nor verified. */
  classification: "failed" | "healthy" | "unverified" | "pending" | "picture_shown";
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
    // Only the server writes `referencePicture`, and only after rebuilding the
    // picture's ink from its record. The browser's own outcome is not evidence.
    if (typeof record(artifacts.referencePicture).id === "string" &&
      [confirmedCode(telemetry.code), confirmedCode(record(artifacts.degradation).reason)]
        .every((value) => value === null || (PICTURE_ANSWERED_FAILURE_CODES as readonly string[]).includes(value))) {
      return verdict("picture_shown", code);
    }
    // The planner may skip a figure the plan did not require, or the engine
    // may have no figure tools for the subject. That taught lesson is the
    // text outcome, not a failed turn. A required figure stays a failure even
    // when narration was saved.
    if ((code === "planner_declined" || code === "missing_capability") && taught === true &&
      (plan.visualRequirement === "optional" || plan.visualRequirement === "none")) {
      return verdict("healthy");
    }
    // A student who stops before any teaching cuts off the requests in
    // flight, and the page teardown reports them as transport errors. Only
    // that transport error is dropped: a confirmed degradation reason, or a
    // retry_required figure below, still reports, and a turn that kept going
    // still reports the transport error itself.
    const degradationCode = confirmedCode(record(artifacts.degradation).reason);
    const stoppedBeforeTeaching = code === "transport_error" && telemetry.failed !== true &&
      input.status === "stopped" && taught === false;
    const effective = stoppedBeforeTeaching
      ? (degradationCode !== "transport_error" ? degradationCode : null)
      : code;
    if (effective) return verdict("failed", effective);
  }
  if (input.visualStatus === "retry_required") return verdict("failed", "required_visual_unavailable");
  if (input.status === "complete" && taught === false) return verdict("unverified");
  if (continuation || plan.visualRequirement === "none" || artifacts.diagramResultStatus === "not_required") return verdict("healthy");
  if (input.status === "live") return verdict("pending");
  return verdict("unverified");
}
