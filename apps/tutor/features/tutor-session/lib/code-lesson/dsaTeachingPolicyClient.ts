import { DEFAULT_DSA_TEACHING_POLICY, type DsaTeachingPolicy } from "@heytutor/tutor-core";

export const FALLBACK_DSA_TEACHING_POLICY = DEFAULT_DSA_TEACHING_POLICY;

/** A failed/slow evaluator never delays or blocks the lesson. */
export async function fetchDsaTeachingPolicy(input: {
  url: string;
  question: string;
  familiarity: "new" | "normal" | "revision";
  technique?: string | null;
  traceId?: string | null;
  signal?: AbortSignal;
}): Promise<DsaTeachingPolicy> {
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (input.traceId) headers.set("x-heytutor-trace-id", input.traceId);
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(3_000)])
      : AbortSignal.timeout(3_000);
    const response = await fetch(input.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        question: input.question,
        familiarity: input.familiarity,
        technique: input.technique ?? null,
      }),
      signal,
    });
    if (!response.ok) return FALLBACK_DSA_TEACHING_POLICY;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("policy" in body)) {
      return FALLBACK_DSA_TEACHING_POLICY;
    }
    const policy = body.policy as Record<string, unknown> | null;
    if (!policy ||
      (policy.motivation !== "show_slow_way" && policy.motivation !== "start_worked_example") ||
      (policy.emphasis !== "intuition" && policy.emphasis !== "walkthrough" &&
        policy.emphasis !== "implementation" && policy.emphasis !== "edge_cases")) {
      return FALLBACK_DSA_TEACHING_POLICY;
    }
    return {
      motivation: policy.motivation,
      emphasis: policy.emphasis,
    } as DsaTeachingPolicy;
  } catch {
    return FALLBACK_DSA_TEACHING_POLICY;
  }
}
