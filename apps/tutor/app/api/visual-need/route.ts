import { requireLessonGrant } from "@/lib/billing/gate";
import {
  actualLlmCost,
  maximumLlmCost,
  reservePaidUsage,
} from "@/lib/billing/paidUsage";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import { assessVisualNeed } from "@/lib/llm/visualNeedPolicy";
import { JEV_GATEWAY_MODEL } from "@/lib/llm/evaluation/types";
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
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    typeof (body as { question?: unknown }).question !== "string" ||
    (body as { question: string }).question.length < 1 ||
    (body as { question: string }).question.length > 12_000 ||
    ((body as { conversationContext?: unknown }).conversationContext !==
      undefined &&
      (typeof (body as { conversationContext?: unknown })
        .conversationContext !== "string" ||
        (body as { conversationContext: string }).conversationContext.length >
          12_000))
  ) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const input = body as { question: string; conversationContext?: string };
  if (!process.env.AI_GATEWAY_API_KEY?.trim())
    return Response.json({ decision: null, source: "unavailable" });
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
    return Response.json({ decision: null, source: "unavailable" });
  }
  try {
    const result = await assessVisualNeed({
      ...input,
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
      tutorDebug("llm", "visual need policy", {
        source: "jev",
        latency_ms: result.assessment.provenance.latencyMs,
        estimated_usd: result.assessment.usage.estimatedUsd,
        decision: result.decision,
      });
    }
    return Response.json({
      decision: result.decision,
      source: result.assessment.status === "assessed" ? "jev" : "unavailable",
    });
  } finally {
    await reservation.finish();
  }
}
