import { effectiveTurnStatus, hasMeaningfulTurnSegments } from "../boards/turnStatus";
import { classifyTurnFailure } from "./turnFailureClassification";
import { failedTurnRuntimeEnvironment } from "./failedTurnRuntime";

/** Content-free vocabulary shared by the outbox and Sentry's final privacy boundary. */
export const FAILED_TURN_STAGES = [
  "turn_plan", "problem_ir", "solver", "scene_planner", "validation", "deadline", "teaching", "save", "unknown",
] as const;
export const FAILED_TURN_CODES = [
  "planner_unavailable", "candidate_invalid", "missing_capability", "solver_contradiction",
  "required_visual_unavailable", "unrecorded", "turn_plan_rejected", "problem_ir_invalid",
  "scene_planner_invalid", "planner_deadline", "planner_declined", "fallback_suppressed",
  "transport_error", "provider_error", "budget_limit", "rate_limit", "save_failure",
  "not_needed", "continuation", "scene_relevance_rejected", "lesson_not_taught", "teaching_segment_failed", "dsa_hint_unsupported", "unknown",
] as const;
export const FAILED_TURN_ISSUE_CODES = [
  ...FAILED_TURN_CODES,
  "claim_quantity_mismatch", "cyclic_dependency", "duplicate_claim_id", "duplicate_quantity_id",
  "duplicate_unknown_id", "given_trig_stipulation_conflict", "invalid_assumption", "invalid_claim",
  "invalid_claim_entity_hints", "invalid_claim_expected", "invalid_claim_quantity_ids", "invalid_dependencies",
  "invalid_law_id", "invalid_plan", "invalid_provenance", "invalid_quantity", "invalid_quantity_id",
  "invalid_quantity_value", "invalid_question", "invalid_sign", "invalid_symbol", "invalid_unit",
  "invalid_unknown", "invalid_visual_requirement", "missing_array", "question_mismatch", "schema_version",
  "sign_mismatch", "source_text_arithmetic_conflict", "source_text_arithmetic_invalid", "source_text_value_mismatch",
  "unknown_claim_quantity", "unknown_dependency", "unresolved_numeric_unknown", "optics_law_mismatch",
  "scene_without_readable_label", "planner_declined_required_scene", "unsupported_operator",
  "scene_source_question_mismatch", "scene_solver_plan_contradiction", "solver_value_mismatch",
  "numeric_authority_contradiction", "unknown_issue",
] as const;
export const FAILED_TURN_DEPLOYMENTS = ["gpt-6-sol", "gpt-6-1-sol", "gpt-6.1-sol", "gpt-5-4-mini", "fireworks", "mock", "unknown"] as const;

export const FAILED_TURN_REPORTING_ORIGINS = ["live", "backfill", "unknown"] as const;

type FailureCode = typeof FAILED_TURN_CODES[number];
type FailureStage = typeof FAILED_TURN_STAGES[number];

export interface FailedTurnTelemetry {
  subject: "maths" | "physics" | "chemistry" | "other" | "unknown";
  stage?: FailureStage;
  code?: FailureCode;
  failed?: boolean;
  requestCount?: number;
  issueCodes?: string[];
  unknownIssueCount?: number;
}

export function turnPlanFailureTelemetry(outcome: { code: string; httpStatus: number | null }): Pick<FailedTurnTelemetry, "stage" | "code"> | undefined {
  if (outcome.code === "accepted" || outcome.code === "cancelled") return undefined;
  const code = outcome.httpStatus === 429 ? "rate_limit" : outcome.httpStatus === 402 ? "budget_limit"
    : outcome.code === "timeout" ? "planner_deadline" : outcome.code === "transport_failed" ? "transport_error"
      : outcome.code === "http_error" ? "provider_error" : "turn_plan_rejected";
  return { stage: "turn_plan", code };
}

/** Only booleans/status/elapsed data enter here; the planner's error and refusal text stays private. */
export function sceneRequestFailureTelemetry(outcome: {
  httpStatus: number | null; bodyParsed: boolean; errorPresent: boolean; declined: boolean; timedOut: boolean;
}): Pick<FailedTurnTelemetry, "stage" | "code"> | undefined {
  const code = outcome.httpStatus === 429 ? "rate_limit" : outcome.httpStatus === 402 ? "budget_limit"
    : outcome.httpStatus !== null && outcome.httpStatus >= 400 ? "provider_error"
      : outcome.declined ? "planner_declined" : outcome.timedOut ? "planner_deadline"
        : !outcome.bodyParsed && outcome.httpStatus === null && outcome.errorPresent ? "transport_error"
          : !outcome.bodyParsed ? "scene_planner_invalid" : undefined;
  return code ? { stage: "scene_planner", code } : undefined;
}

/** Client diagnostics cross the persistence boundary through enums/counts only. */
export function readFailedTurnTelemetry(raw: unknown): FailedTurnTelemetry | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = record(raw);
  const codes = new Set<string>(FAILED_TURN_ISSUE_CODES);
  return {
    subject: member(value.subject, ["maths", "physics", "chemistry", "other", "unknown"] as const, "unknown"),
    ...(typeof value.stage === "string" && FAILED_TURN_STAGES.includes(value.stage as FailureStage) ? { stage: value.stage as FailureStage } : {}),
    ...(typeof value.code === "string" && FAILED_TURN_CODES.includes(value.code as FailureCode) ? { code: value.code as FailureCode } : {}),
    ...(value.failed === true ? { failed: true } : {}),
    requestCount: count(value.requestCount, 16),
    issueCodes: Array.isArray(value.issueCodes) ? [...new Set(value.issueCodes.filter((code): code is string => typeof code === "string" && codes.has(code)))].slice(0, 32) : [],
    unknownIssueCount: count(value.unknownIssueCount),
  };
}

export interface FailedTurnInput {
  visualStatus: string | null;
  status: string;
  kind?: string;
  rawResponse?: string;
  sceneArtifacts: unknown;
  resumeState?: unknown;
  updatedAt?: Date;
  segments: ReadonlyArray<{ narration?: string; spokenText?: string; command?: unknown }>;
}

export interface FailedTurnSentryEvent {
  timestamp: number;
  message: "Tutor turn failed";
  level: "warning" | "error";
  fingerprint: string[];
  tags: Record<string, string>;
  extra: { candidate_count: number; validation_issue_count: number; unknown_issue_count: number; request_count: number; issue_codes: string[]; segment_count: number };
  release: string;
  environment: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function member<const T extends readonly string[]>(value: unknown, choices: T, fallback: T[number]): T[number] {
  return typeof value === "string" && choices.includes(value) ? value : fallback;
}

function count(value: unknown, cap = 10_000): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? Math.min(cap, value) : 0;
}

function stageFor(code: FailureCode): FailureStage {
  if (code === "turn_plan_rejected") return "turn_plan";
  if (code === "problem_ir_invalid") return "problem_ir";
  if (code === "solver_contradiction") return "solver";
  if (code === "candidate_invalid") return "validation";
  if (code === "planner_deadline") return "deadline";
  if (code === "lesson_not_taught" || code === "teaching_segment_failed") return "teaching";
  if (code === "save_failure") return "save";
  return code === "unrecorded" || code === "unknown" ? "unknown" : "scene_planner";
}

/** Never infer a subject from student words. Missing historical metadata stays honest. */
export function buildFailedTurnSentryEvent(
  turn: FailedTurnInput,
  env: Record<string, string | undefined> = process.env,
  options: { historical?: boolean; staleLive?: boolean; now?: Date } = {},
): FailedTurnSentryEvent | null {
  // Initial live checkpoints are placeholders while the planner is still working.
  const staleLive = turn.status === "live" && options.staleLive === true && turn.updatedAt !== undefined &&
    effectiveTurnStatus(turn.status, turn.updatedAt, options.now?.getTime() ?? Date.now()) === "stopped";
  if (turn.status === "live" && !staleLive) return null;
  const failure = classifyTurnFailure(turn);
  if (failure.classification !== "failed") return null;
  const artifacts = record(turn.sceneArtifacts);
  const telemetry = readFailedTurnTelemetry(artifacts.failureTelemetry) ?? { subject: "unknown" };
  const plan = record(artifacts.turnPlan);
  const degradation = record(artifacts.degradation);
  const taught = record(turn.resumeState).earlyOpeningOnly !== true &&
    hasMeaningfulTurnSegments(turn.segments);
  const figureNeed = member(plan.visualRequirement, ["required", "optional", "none", "unknown"] as const, "unknown");
  const subject = member(telemetry.subject, ["maths", "physics", "chemistry", "other", "unknown"] as const, "unknown");
  const code = member(failure.code, FAILED_TURN_CODES, "unknown");
  const stage = member(telemetry.stage, FAILED_TURN_STAGES, stageFor(code));
  const rawCodes = [...(Array.isArray(degradation.issueCodes) ? degradation.issueCodes : []), ...(telemetry.issueCodes ?? [])];
  const known = new Set<string>(FAILED_TURN_ISSUE_CODES);
  const issueCodes = [...new Set(rawCodes.map(value => typeof value === "string" && known.has(value) ? value : "unknown_issue"))].slice(0, 32);
  const strictSubjects = (env.DIAGRAM_STRICT_SUBJECTS ?? "").split(/[\s,]+/)
    .filter(value => ["maths", "physics", "chemistry"].includes(value));
  const azure = env.LLM_PROVIDER === "azure" && Boolean(env.AZURE_OPENAI_ENDPOINT?.trim() && env.AZURE_OPENAI_API_KEY?.trim() && env.AZURE_OPENAI_DEPLOYMENT?.trim());
  const provider = options.historical ? "unknown" : azure ? "azure" : env.FIREWORKS_API_KEY?.trim() ? "fireworks" : "mock";
  const deployment = options.historical ? "unknown" : member(azure ? env.AZURE_OPENAI_DEPLOYMENT : provider === "mock" ? "mock" : "fireworks", FAILED_TURN_DEPLOYMENTS, "unknown");
  const releaseValue = env.SENTRY_RELEASE ?? env.GITHUB_SHA ?? "";
  const release = !options.historical && /^[a-f0-9]{40}$/i.test(releaseValue) ? releaseValue.toLowerCase() : "unknown";
  const environment = failedTurnRuntimeEnvironment(env);
  return {
    timestamp: (options.now?.getTime() ?? Date.now()) / 1_000,
    message: "Tutor turn failed",
    level: taught && telemetry.failed !== true ? "warning" : "error",
    fingerprint: ["turn-failure", stage, code, subject],
    tags: {
      area: "turn-failure", subject, stage, code, figure_need: figureNeed,
      reporting_origin: options.historical ? "backfill" : "live",
      strict_subjects: options.historical ? "unknown" : [...new Set(strictSubjects)].sort().join(",") || "none",
      provider, deployment, release, environment,
    },
    extra: {
      candidate_count: count(degradation.candidateCount, 16),
      validation_issue_count: Math.min(10_000, rawCodes.length),
      unknown_issue_count: Math.min(10_000, rawCodes.filter(value => typeof value !== "string" || !known.has(value)).length + count(telemetry.unknownIssueCount)),
      request_count: count(telemetry.requestCount, 16),
      issue_codes: issueCodes, segment_count: Math.min(10_000, turn.segments.length),
    },
    release, environment,
  };
}
