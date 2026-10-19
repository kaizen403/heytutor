import { createHash } from "node:crypto";
import {
  parseScenePlannerResponseJson,
  type SceneCandidateValidation,
  type ScenePlannerResponse,
} from "@heytutor/tutor-core";

const EVIDENCE_LIMIT_BYTES = 2048;
const MAX_VALIDATION_RECORDS = 32;
const MAX_OPERATOR_RECORDS = 128;
const MAX_ISSUES_PER_VALIDATION = 64;
const MAX_ENTITY_IDS_PER_ISSUE = 16;
type EvidenceStage = "initial" | "authority_revalidation";
type ValidationIssue = SceneCandidateValidation["errors"][number];
export interface RetainedValidationIssue {
  code: string;
  message: string;
  severity: "fatal" | "warning";
  path?: string;
  entityIds?: string[];
  /** Original UTF-8 lengths/counts are present only when a field was shortened. */
  truncated?: {
    codeBytes?: number;
    messageBytes?: number;
    pathBytes?: number;
    omittedEntityIds?: number;
    shortenedEntityIds?: number;
  };
}
export interface PlannerEvidence {
  plannerDeclineReason: string | null;
  plannerDeclines: Array<{
    phase: string;
    lane: string;
    reason: string;
    reasonBytes: number;
    truncated: boolean;
  }>;
  /** Every rejected attempt, including discarded searches and authority revalidation. */
  candidateRejections: Array<{
    phase: string;
    lane: string;
    validationPass: EvidenceStage;
    /** Binds this attempted validation to its raw program without duplicating raw content. */
    rawContentSha256: string;
    errors: RetainedValidationIssue[];
    issueCount: number;
    omittedIssueCount: number;
  }>;
  /** Record caps never silently erase evidence. */
  rejectionEvidenceTruncation: {
    candidateRecords: number;
    candidateIssues: number;
    operatorRecords: number;
  };
  rejectedOperatorCalls: Array<{
    phase: string;
    lane: string;
    validationPass: EvidenceStage;
    constructionIndex: number;
    constructionId: string | null;
    operator: string | null;
    rawArguments: string;
    argumentsPresent: boolean;
    argumentBytes: number;
    truncated: boolean;
    attribution: "reported_path_or_entity" | "candidate_rejected";
    errorCodes: string[];
    errorPaths: string[];
    /** Details live once in candidateRejections; these indices preserve operator attribution. */
    validationRecordIndex: number;
    errorIndices: number[];
    omittedErrorCount: number;
  }>;
}

export function createPlannerEvidence(): PlannerEvidence {
  return {
    plannerDeclineReason: null,
    plannerDeclines: [],
    candidateRejections: [],
    rejectionEvidenceTruncation: {
      candidateRecords: 0,
      candidateIssues: 0,
      operatorRecords: 0,
    },
    rejectedOperatorCalls: [],
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rawDocument(
  response: Pick<ScenePlannerResponse, "rawContent">,
): Record<string, unknown> | null {
  return parseScenePlannerResponseJson(response.rawContent);
}

function truncateUtf8(text: string, limit = EVIDENCE_LIMIT_BYTES) {
  const bytes = Buffer.from(text, "utf8");
  let end = Math.min(bytes.length, limit);
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  return {
    text: bytes.subarray(0, end).toString("utf8"),
    bytes: bytes.length,
    truncated: bytes.length > end,
  };
}

/** Keep engine diagnostics only; arbitrary issue.details/actual/expected never enter the log. */
export function retainValidationIssue(
  issue: ValidationIssue,
): RetainedValidationIssue {
  const code = truncateUtf8(issue.code, 128);
  const message = truncateUtf8(issue.message);
  const path =
    issue.path === undefined ? undefined : truncateUtf8(issue.path, 512);
  const ids = issue.entityIds
    ?.slice(0, MAX_ENTITY_IDS_PER_ISSUE)
    .map((id) => truncateUtf8(id, 128));
  const shortenedEntityIds = ids?.filter((id) => id.truncated).length ?? 0;
  const omittedEntityIds = Math.max(
    0,
    (issue.entityIds?.length ?? 0) - MAX_ENTITY_IDS_PER_ISSUE,
  );
  const truncated = {
    ...(code.truncated ? { codeBytes: code.bytes } : {}),
    ...(message.truncated ? { messageBytes: message.bytes } : {}),
    ...(path?.truncated ? { pathBytes: path.bytes } : {}),
    ...(shortenedEntityIds ? { shortenedEntityIds } : {}),
    ...(omittedEntityIds ? { omittedEntityIds } : {}),
  };
  return {
    code: code.text,
    message: message.text,
    severity: issue.severity,
    ...(path ? { path: path.text } : {}),
    ...(ids ? { entityIds: ids.map((id) => id.text) } : {}),
    ...(Object.keys(truncated).length ? { truncated } : {}),
  };
}

export function recordPlannerResponse(
  evidence: PlannerEvidence,
  response: ScenePlannerResponse,
): void {
  const decision = record(rawDocument(response)?.visualDecision);
  if (decision?.mode !== "text_only" || typeof decision.reason !== "string")
    return;
  const reason = truncateUtf8(decision.reason);
  evidence.plannerDeclineReason = reason.text;
  evidence.plannerDeclines.push({
    phase: response.phase,
    lane: response.lane,
    reason: reason.text,
    reasonBytes: reason.bytes,
    truncated: reason.truncated,
  });
}

/** A failed document is atomic. Path/entity matches are diagnostic hints, not proof a suboperator failed. */
export function recordRejectedOperatorCalls(
  evidence: PlannerEvidence,
  response: ScenePlannerResponse,
  validation: SceneCandidateValidation,
  validationPass: EvidenceStage,
): void {
  if (validation.valid) return;
  const validationRecordIndex = evidence.candidateRejections.length;
  if (validationRecordIndex >= MAX_VALIDATION_RECORDS) {
    evidence.rejectionEvidenceTruncation.candidateRecords++;
    evidence.rejectionEvidenceTruncation.candidateIssues +=
      validation.errors.length;
    const calls = rawDocument(response)?.constructions;
    if (Array.isArray(calls))
      evidence.rejectionEvidenceTruncation.operatorRecords += calls.filter(
        (call) => record(call),
      ).length;
    return;
  }
  const retainedErrors = validation.errors
    .slice(0, MAX_ISSUES_PER_VALIDATION)
    .map(retainValidationIssue);
  evidence.candidateRejections.push({
    phase: response.phase,
    lane: response.lane,
    validationPass,
    rawContentSha256: createHash("sha256")
      .update(response.rawContent)
      .digest("hex"),
    errors: retainedErrors,
    issueCount: validation.errors.length,
    omittedIssueCount: validation.errors.length - retainedErrors.length,
  });
  const document = rawDocument(response);
  if (!Array.isArray(document?.constructions)) return;
  document.constructions.forEach((value, constructionIndex) => {
    const call = record(value);
    if (!call) return;
    if (evidence.rejectedOperatorCalls.length >= MAX_OPERATOR_RECORDS) {
      evidence.rejectionEvidenceTruncation.operatorRecords++;
      return;
    }
    const originalConstructionId = typeof call.id === "string" ? call.id : null;
    const constructionId =
      originalConstructionId === null
        ? null
        : truncateUtf8(originalConstructionId, 128).text;
    const outputs = Array.isArray(call.outputs) ? call.outputs : [];
    const directIndices = validation.errors.flatMap((error, index) =>
      error.path
        ?.match(
          /(?:constructions\[(\d+)\]|constructions\.(\d+)|\/constructions\/(\d+))(?:\D|$)/,
        )
        ?.slice(1)
        .includes(String(constructionIndex)) ||
      error.entityIds?.some(
        (id) => id === originalConstructionId || outputs.includes(id),
      )
        ? [index]
        : [],
    );
    const relevantIndices =
      directIndices.length > 0
        ? directIndices
        : validation.errors.map((_, index) => index);
    const errorIndices = relevantIndices.filter(
      (index) => index < retainedErrors.length,
    );
    const relevantErrors = errorIndices.map((index) => retainedErrors[index]!);
    const argumentsPresent = Object.hasOwn(call, "inputs");
    const args = truncateUtf8(JSON.stringify(call.inputs ?? null));
    evidence.rejectedOperatorCalls.push({
      phase: response.phase,
      lane: response.lane,
      validationPass,
      constructionIndex,
      constructionId,
      operator:
        typeof call.operator === "string"
          ? truncateUtf8(call.operator, 128).text
          : null,
      rawArguments: args.text,
      argumentsPresent,
      argumentBytes: args.bytes,
      truncated: args.truncated,
      attribution:
        directIndices.length > 0
          ? "reported_path_or_entity"
          : "candidate_rejected",
      errorCodes: [...new Set(relevantErrors.map((error) => error.code))],
      errorPaths: [
        ...new Set(
          relevantErrors.flatMap((error) => (error.path ? [error.path] : [])),
        ),
      ],
      validationRecordIndex,
      errorIndices,
      omittedErrorCount: relevantIndices.length - errorIndices.length,
    });
  });
}
