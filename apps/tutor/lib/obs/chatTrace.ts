import {
  HEYTUTOR_QUESTION_HEADER,
  HEYTUTOR_TRACE_ID_HEADER,
  readQuestionHeader,
  readTraceIdHeader,
} from "@heytutor/tutor-core";

export type ChatGenerationKind =
  | "teaching"
  | "turn-plan-v3"
  | "problem-ir-v1"
  | "scene-planner-v2"
  | "diagram-example-picker"
  | "code-lesson-v1";

/** Teaching keeps `fireworks-llm` so the existing Langfuse token widget still matches. */
export function chatGenerationName(kind: ChatGenerationKind): string {
  return kind === "teaching" ? "fireworks-llm" : kind;
}

export function resolveChatGenerationKind(headers: Headers): ChatGenerationKind {
  if (headers.get("x-planner") !== "1") return "teaching";
  if (headers.get("x-diagram-example-picker") === "1") return "diagram-example-picker";
  if (headers.get("x-code-lesson-version") === "1") return "code-lesson-v1";
  if (headers.get("x-problem-ir-version") === "1") return "problem-ir-v1";
  if (headers.get("x-turn-planner-version") === "3") return "turn-plan-v3";
  return "scene-planner-v2";
}

/**
 * Parent-trace input is the student question. Planner prompts must not replace
 * it when several `/api/chat` calls share one turn id.
 */
export function resolveTurnTraceInput(options: {
  kind: ChatGenerationKind;
  attach: boolean;
  question?: string;
  userInput: string;
}): string | undefined {
  if (options.question) return options.question;
  if (options.kind === "teaching" || !options.attach) return options.userInput;
  return undefined;
}

/** Continuations are extra generations; do not overwrite the parent lesson text. */
export function shouldUpdateParentTraceOutput(
  kind: ChatGenerationKind,
  userInput: string,
): boolean {
  if (kind !== "teaching") return false;
  return userInput.trim().toLowerCase() !== "continue";
}

export function readChatTraceHeaders(headers: Headers): {
  traceId?: string;
  question?: string;
} {
  return {
    traceId: readTraceIdHeader(headers.get(HEYTUTOR_TRACE_ID_HEADER)),
    question: readQuestionHeader(headers.get(HEYTUTOR_QUESTION_HEADER)),
  };
}

function perfNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0 ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export interface ProviderPerfMetadata {
  ttft_ms?: number;
  tokens_per_sec?: number;
  provider_processing_ms?: number;
}

/**
 * Fireworks `perf_metrics` (requested with `perf_metrics_in_response`) uses its
 * header names, `server-time-to-first-token` and `server-processing-time`, in
 * seconds. A non-streamed response repeats them as `fireworks-*` headers. The
 * older `ttft_ms` / `tokens_per_sec` names are still read when present.
 */
export function providerPerfMetadata(
  perf: unknown,
  options: { headers?: Headers; completionTokens?: number } = {},
): ProviderPerfMetadata {
  const record = perf && typeof perf === "object" ? perf as Record<string, unknown> : {};
  const seconds = (key: string) =>
    perfNumber(record[key]) ?? perfNumber(options.headers?.get(`fireworks-${key}`));
  const ttftSeconds = seconds("server-time-to-first-token");
  const processingSeconds = seconds("server-processing-time");
  const ttftMs = perfNumber(record.ttft_ms) ??
    (ttftSeconds === undefined ? undefined : Math.round(ttftSeconds * 1000));
  const generationSeconds = ttftSeconds !== undefined && processingSeconds !== undefined
    ? processingSeconds - ttftSeconds
    : undefined;
  const completionTokens = options.completionTokens ?? 0;
  const tokensPerSec = perfNumber(record.tokens_per_sec) ??
    (generationSeconds !== undefined && generationSeconds > 0 && completionTokens > 0
      ? Math.round((completionTokens / generationSeconds) * 10) / 10
      : undefined);
  const metadata: ProviderPerfMetadata = {};
  if (ttftMs !== undefined) metadata.ttft_ms = ttftMs;
  if (tokensPerSec !== undefined) metadata.tokens_per_sec = tokensPerSec;
  if (processingSeconds !== undefined) metadata.provider_processing_ms = Math.round(processingSeconds * 1000);
  return metadata;
}

/**
 * The route's own clock, all in ms. `server_setup_ms` is request received to
 * the first upstream fetch (auth, grant, reservation). `connect_ms` is the
 * final attempt's fetch start to its response headers; earlier failed
 * attempts and their backoff sleeps are `retry_ms`, and `attempt_count` says
 * how many fetches ran. `ttft_content_ms` is the first upstream fetch to the
 * first spoken content chunk, so it includes any retries.
 */
export function chatTimingMetadata(timing: {
  requestStartedAt: number;
  upstreamStartedAt: number;
  finalAttemptStartedAt?: number | null;
  attemptCount?: number;
  responseHeadersAt?: number | null;
  firstContentAt?: number | null;
}): {
  server_setup_ms: number;
  connect_ms?: number;
  retry_ms?: number;
  attempt_count?: number;
  ttft_content_ms?: number;
} {
  const finalAttemptStartedAt = timing.finalAttemptStartedAt ?? timing.upstreamStartedAt;
  return {
    server_setup_ms: Math.max(0, timing.upstreamStartedAt - timing.requestStartedAt),
    ...(timing.responseHeadersAt != null
      ? { connect_ms: Math.max(0, timing.responseHeadersAt - finalAttemptStartedAt) }
      : {}),
    ...(timing.attemptCount !== undefined
      ? {
          attempt_count: timing.attemptCount,
          retry_ms: Math.max(0, finalAttemptStartedAt - timing.upstreamStartedAt),
        }
      : {}),
    ...(timing.firstContentAt != null
      ? { ttft_content_ms: Math.max(0, timing.firstContentAt - timing.upstreamStartedAt) }
      : {}),
  };
}
