import type { VisualNeedDecision } from "@/lib/llm/visualNeedPolicy";
import type { EvaluationProvenance, EvaluationUsage } from "@/lib/llm/evaluation/types";

export const VISUAL_NEED_CLIENT_TIMEOUT_MS = 3_000;
export const VISUAL_NEED_EVIDENCE_VERSION = "live-visual-need/v1";

export interface VisualNeedAssessment {
  decision: VisualNeedDecision | null;
  source: "jev" | "unavailable";
  unavailableReason: string | null;
  usage: EvaluationUsage | null;
  provenance: EvaluationProvenance | null;
}

export interface VisualNeedClientInput {
  url: string;
  question: string;
  conversationContext?: string;
  traceId?: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function unavailable(reason: string): VisualNeedAssessment {
  return { decision: null, source: "unavailable", unavailableReason: reason, usage: null, provenance: null };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function usageFrom(value: unknown): EvaluationUsage | null {
  if (!record(value) || !Number.isSafeInteger(value.inputTokens) || !finiteNonnegative(value.inputTokens) ||
      !Number.isSafeInteger(value.outputTokens) || !finiteNonnegative(value.outputTokens) ||
      !finiteNonnegative(value.estimatedUsd)) return null;
  return { knownUsage: value.knownUsage === true, inputTokens: value.inputTokens, outputTokens: value.outputTokens,
    estimatedUsd: value.estimatedUsd, reportedCostUsd: finiteNonnegative(value.reportedCostUsd) ? value.reportedCostUsd : null };
}

function provenanceFrom(value: unknown): EvaluationProvenance | null {
  if (!record(value) || !finiteNonnegative(value.latencyMs)) return null;
  const fields = ["model", "rubricVersion", "policyVersion", "inputHash"] as const;
  if (fields.some((key) => typeof value[key] !== "string" || value[key].length > 300)) return null;
  return { model: String(value.model), rubricVersion: String(value.rubricVersion), policyVersion: String(value.policyVersion),
    inputHash: String(value.inputHash), latencyMs: value.latencyMs,
    gatewayModel: typeof value.gatewayModel === "string" ? value.gatewayModel.slice(0, 300) : null,
    generationId: typeof value.generationId === "string" ? value.generationId.slice(0, 300) : null };
}

/** Typed boundary shared by the live client and private lab replay loader. */
export function visualNeedAssessmentFromResponse(body: unknown): VisualNeedAssessment {
  if (!record(body)) return unavailable("invalid_response");
  const decision = body.decision;
  if (decision !== "required" && decision !== "optional" && decision !== "none") {
    return unavailable(body.source === "unavailable" && typeof body.unavailableReason === "string"
      ? body.unavailableReason.slice(0, 100) : body.source === "unavailable" ? "unavailable_unspecified" : "invalid_response");
  }
  return { decision, source: "jev", unavailableReason: null,
    usage: usageFrom(body.usage), provenance: provenanceFrom(body.provenance) };
}

/** Same request/deadline as live, with bounded evidence for lab records. */
export async function fetchVisualNeedAssessment(input: VisualNeedClientInput): Promise<VisualNeedAssessment> {
  let timeout: AbortSignal | undefined;
  try {
    timeout = AbortSignal.timeout(VISUAL_NEED_CLIENT_TIMEOUT_MS);
    const headers = new Headers({ "content-type": "application/json" });
    if (input.traceId) headers.set("x-heytutor-trace-id", input.traceId);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ question: input.question, conversationContext: input.conversationContext }),
      signal,
    });
    if (!response.ok) return unavailable(`http_${response.status}`);
    return visualNeedAssessmentFromResponse(await response.json());
  } catch {
    return unavailable(input.signal?.aborted ? "aborted" : timeout?.aborted ? "deadline" : "transport");
  }
}

/** Compatibility wrapper: the live answer and timeout behaviour are unchanged. */
export async function fetchVisualNeed(input: VisualNeedClientInput): Promise<VisualNeedDecision | null> {
  return (await fetchVisualNeedAssessment(input)).decision;
}
