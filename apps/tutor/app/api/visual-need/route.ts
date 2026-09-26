import { requireLessonGrant } from "@/lib/billing/gate";
import { recordLlmSpend } from "@/lib/billing/track";
import { assessVisualNeed } from "@/lib/llm/visualNeedPolicy";
import { tutorDebug } from "@heytutor/tutor-core";

export async function POST(request: Request): Promise<Response> {
  const gated = await requireLessonGrant(request);
  if (gated instanceof Response) return gated;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) ||
    typeof (body as { question?: unknown }).question !== "string" ||
    (body as { question: string }).question.length < 1 ||
    (body as { question: string }).question.length > 12_000 ||
    ((body as { conversationContext?: unknown }).conversationContext !== undefined &&
      (typeof (body as { conversationContext?: unknown }).conversationContext !== "string" ||
        (body as { conversationContext: string }).conversationContext.length > 12_000))) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const result = await assessVisualNeed({
    question: (body as { question: string }).question,
    conversationContext: (body as { conversationContext?: string }).conversationContext,
    signal: request.signal,
  });
  if (result.assessment.status === "assessed") {
    if (result.assessment.usage.inputTokens > 0) {
      recordLlmSpend({
        actor: gated.actor,
        model: result.assessment.provenance.model,
        usage: {
          input: result.assessment.usage.inputTokens,
          output: result.assessment.usage.outputTokens,
        },
      });
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
}
