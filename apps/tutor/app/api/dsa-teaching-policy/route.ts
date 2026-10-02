import { requireLessonGrant } from "@/lib/billing/gate";
import {
  actualLlmCost,
  maximumLlmCost,
  reservePaidUsage,
} from "@/lib/billing/paidUsage";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import { assessDsaTeachingPolicy } from "@/lib/llm/dsaTeachingPolicy";
import { JEV_GATEWAY_MODEL } from "@/lib/llm/evaluation/types";
import { DEFAULT_DSA_TEACHING_POLICY } from "@heytutor/tutor-core";
import { tutorDebug } from "@heytutor/tutor-core";

export async function POST(request: Request): Promise<Response> {
  const gated = await requireLessonGrant(request);
  if (gated instanceof Response) return gated;
  let body: unknown;
  try {
    body = await readBoundedJson(request, 64 * 1024);
  } catch (error) {
    return Response.json(
      { error: "invalid_json" },
      { status: error instanceof RequestBodyError ? error.status : 400 },
    );
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if (
    typeof input.question !== "string" ||
    input.question.length < 1 ||
    input.question.length > 12_000 ||
    (input.familiarity !== "new" &&
      input.familiarity !== "normal" &&
      input.familiarity !== "revision") ||
    (input.technique !== undefined &&
      input.technique !== null &&
      (typeof input.technique !== "string" || input.technique.length > 100))
  ) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  if (!process.env.AI_GATEWAY_API_KEY?.trim())
    return Response.json({
      policy: DEFAULT_DSA_TEACHING_POLICY,
      source: "default",
    });
  const reservation = await reservePaidUsage({
    actor: gated.actor,
    grant: gated.grant,
    kind: "policy",
    traceId: request.headers.get("x-heytutor-trace-id") ?? undefined,
    usd: maximumLlmCost(input, 0, [JEV_GATEWAY_MODEL]) + 0.002,
  });
  if (reservation instanceof Response) return reservation;
  if (request.signal.aborted) {
    await reservation.cancelBeforeDispatch();
    return Response.json({
      policy: DEFAULT_DSA_TEACHING_POLICY,
      source: "default",
    });
  }
  try {
    const result = await assessDsaTeachingPolicy({
      question: input.question,
      familiarity: input.familiarity,
      technique: typeof input.technique === "string" ? input.technique : null,
      signal: request.signal,
      options: { model: JEV_GATEWAY_MODEL },
    });
    if (result.assessment.status === "assessed") {
      if (result.assessment.usage.knownUsage) {
        await reservation.settle(
          actualLlmCost(
            {
              input: result.assessment.usage.inputTokens,
              output: result.assessment.usage.outputTokens,
            },
            result.assessment.provenance.model,
          ),
        );
      }
      tutorDebug("llm", "dsa teaching policy", {
        source: "jev",
        latency_ms: result.assessment.provenance.latencyMs,
        estimated_usd: result.assessment.usage.estimatedUsd,
        motivation: result.policy.motivation,
        emphasis: result.policy.emphasis,
      });
    }
    return Response.json({
      policy: result.policy,
      source: result.assessment.status === "assessed" ? "jev" : "default",
    });
  } finally {
    await reservation.finish();
  }
}
