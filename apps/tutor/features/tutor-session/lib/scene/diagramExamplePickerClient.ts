import {
  resolveApiUrl,
  withFastModeHeader,
  withTurnTraceHeaders,
} from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

export const LIVE_DIAGRAM_EXAMPLE_PICKER_TIMEOUT_MS = 4_000;

export interface LiveDiagramExamplePickerResult {
  ids: string[];
  status: "picked" | "none" | "failed" | "timeout";
  elapsedMs: number;
}

function parseIds(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return [];
  const first = choices[0];
  if (typeof first !== "object" || first === null) return [];
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return [];
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") return [];
  try {
    const parsed = JSON.parse(content) as { ids?: unknown };
    if (!Array.isArray(parsed.ids)) return [];
    return [...new Set(parsed.ids.filter((id): id is string =>
      typeof id === "string" && /^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(id)))].slice(0, 3);
  } catch {
    return [];
  }
}

export async function pickLiveDiagramExampleIds(input: {
  question: string;
  plan: TurnPlanV3;
  traceId?: string;
  sessionId?: string;
  signal?: AbortSignal;
  fastMode?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<LiveDiagramExamplePickerResult> {
  const startedAt = Date.now();
  const timeout = AbortSignal.timeout(input.timeoutMs ?? LIVE_DIAGRAM_EXAMPLE_PICKER_TIMEOUT_MS);
  const signal = input.signal && typeof AbortSignal.any === "function"
    ? AbortSignal.any([input.signal, timeout])
    : timeout;
  try {
    const response = await (input.fetchImpl ?? fetch)(resolveApiUrl("/api/chat"), {
      method: "POST",
      credentials: "include",
      headers: withFastModeHeader(withTurnTraceHeaders({
        "content-type": "application/json",
        "x-planner": "1",
        "x-diagram-example-picker": "1",
        "x-planner-deadline-ms": String(input.timeoutMs ?? LIVE_DIAGRAM_EXAMPLE_PICKER_TIMEOUT_MS),
      }, {
        traceId: input.traceId,
        sessionId: input.sessionId,
        question: input.question,
      }), input.fastMode),
      signal,
      body: JSON.stringify({
        model: "server-selected",
        max_tokens: 60,
        temperature: 0,
        stream: false,
        messages: [{ role: "user", content: JSON.stringify({ plan: input.plan }) }],
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ids: [], status: "failed", elapsedMs: Date.now() - startedAt };
    }
    const ids = parseIds(await response.json());
    return {
      ids,
      status: ids.length > 0 ? "picked" : "none",
      elapsedMs: Date.now() - startedAt,
    };
  } catch {
    const timedOut = timeout.aborted && !input.signal?.aborted;
    return {
      ids: [],
      status: timedOut ? "timeout" : "failed",
      elapsedMs: Date.now() - startedAt,
    };
  }
}

export function scenePlannerUrlWithExampleIds(baseUrl: string, ids: readonly string[]): string {
  if (ids.length === 0) return baseUrl;
  const url = new URL(baseUrl, typeof window === "undefined" ? "http://localhost" : window.location.origin);
  url.searchParams.set("diagramExampleIds", [...new Set(ids)].slice(0, 3).join(","));
  return /^https?:\/\//i.test(baseUrl) ? url.toString() : `${url.pathname}${url.search}`;
}
