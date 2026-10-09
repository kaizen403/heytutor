import type {
  SceneCandidateValidation,
  ScenePlannerResponse,
} from "@heytutor/tutor-core";

const EVIDENCE_LIMIT_BYTES = 2048;
type EvidenceStage = "initial" | "authority_revalidation";
export interface PlannerEvidence {
  plannerDeclineReason: string | null;
  plannerDeclines: Array<{
    phase: string;
    lane: string;
    reason: string;
    reasonBytes: number;
    truncated: boolean;
  }>;
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
  }>;
}

export function createPlannerEvidence(): PlannerEvidence {
  return {
    plannerDeclineReason: null,
    plannerDeclines: [],
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
  try {
    const text = response.rawContent.trim();
    return record(
      JSON.parse(text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text),
    );
  } catch {
    return null;
  }
}

function truncateUtf8(text: string) {
  const bytes = Buffer.from(text, "utf8");
  let end = Math.min(bytes.length, EVIDENCE_LIMIT_BYTES);
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  return {
    text: bytes.subarray(0, end).toString("utf8"),
    bytes: bytes.length,
    truncated: bytes.length > end,
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
  const document = rawDocument(response);
  if (!Array.isArray(document?.constructions)) return;
  document.constructions.forEach((value, constructionIndex) => {
    const call = record(value);
    if (!call) return;
    const constructionId = typeof call.id === "string" ? call.id : null;
    const outputs = Array.isArray(call.outputs) ? call.outputs : [];
    const direct = validation.errors.filter(
      (error) =>
        error.path
          ?.match(
            /(?:constructions\[(\d+)\]|constructions\.(\d+)|\/constructions\/(\d+))(?:\D|$)/,
          )
          ?.slice(1)
          .includes(String(constructionIndex)) ||
        error.entityIds?.some(
          (id) => id === constructionId || outputs.includes(id),
        ),
    );
    const argumentsPresent = Object.hasOwn(call, "inputs");
    const args = truncateUtf8(JSON.stringify(call.inputs ?? null));
    evidence.rejectedOperatorCalls.push({
      phase: response.phase,
      lane: response.lane,
      validationPass,
      constructionIndex,
      constructionId,
      operator: typeof call.operator === "string" ? call.operator : null,
      rawArguments: args.text,
      argumentsPresent,
      argumentBytes: args.bytes,
      truncated: args.truncated,
      attribution:
        direct.length > 0 ? "reported_path_or_entity" : "candidate_rejected",
      errorCodes: [
        ...new Set(
          (direct.length > 0 ? direct : validation.errors).map(
            (error) => error.code,
          ),
        ),
      ],
      errorPaths: [
        ...new Set(
          (direct.length > 0 ? direct : validation.errors).flatMap((error) =>
            error.path ? [error.path] : [],
          ),
        ),
      ],
    });
  });
}
