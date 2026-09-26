import { requireLessonGrant } from "@/lib/billing/gate";
import { recordLlmSpend } from "@/lib/billing/track";
import { assessDsaTeachingPolicy } from "@/lib/llm/dsaTeachingPolicy";
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
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if (typeof input.question !== "string" || input.question.length < 1 || input.question.length > 12_000 ||
    (input.familiarity !== "new" && input.familiarity !== "normal" && input.familiarity !== "revision")) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const result = await assessDsaTeachingPolicy({
    question: input.question,
    familiarity: input.familiarity,
    technique: typeof input.technique === "string" ? input.technique : null,
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
}
