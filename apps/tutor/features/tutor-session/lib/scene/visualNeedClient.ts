import type { VisualNeedDecision } from "@/lib/llm/visualNeedPolicy";

export async function fetchVisualNeed(input: {
  url: string;
  question: string;
  conversationContext?: string;
  traceId?: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<VisualNeedDecision | null> {
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (input.traceId) headers.set("x-heytutor-trace-id", input.traceId);
    const timeout = AbortSignal.timeout(3_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ question: input.question, conversationContext: input.conversationContext }),
      signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("decision" in body)) return null;
    const decision = body.decision;
    return decision === "required" || decision === "optional" || decision === "none"
      ? decision
      : null;
  } catch {
    return null;
  }
}
