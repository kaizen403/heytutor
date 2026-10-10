/**
 * Which provider serves every LLM lane. One switch, `LLM_PROVIDER`:
 *
 * - `fireworks` (or unset): today's Kimi K3 lanes, unchanged.
 * - `azure`: every lane calls one Azure AI Foundry deployment
 *   (`AZURE_OPENAI_DEPLOYMENT`, gpt-6.1-sol) through the OpenAI v1 API.
 *
 * Call sites build the Fireworks body they always built and pass it through
 * `providerChatBody`. With Fireworks that returns the same object; with Azure
 * it translates the Fireworks-only fields (see `azureChatBody`).
 *
 * Fail safe: `LLM_PROVIDER=azure` with any Azure variable missing logs one
 * error and keeps Fireworks, so a deploy that lands before its env cannot take
 * lessons down.
 */

export type LlmProviderName = "fireworks" | "azure";

export const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

export const AZURE_ENV_KEYS = [
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
] as const;

type Env = Record<string, string | undefined>;

export interface LlmEndpoint {
  provider: LlmProviderName;
  /** OpenAI-compatible chat completions URL. */
  url: string;
  /** Sent as `Authorization: Bearer`. Missing means mock mode. */
  apiKey: string | undefined;
  /** The Azure deployment every lane uses; null on Fireworks. */
  deployment: string | null;
  /** Set when `LLM_PROVIDER=azure` fell back to Fireworks. */
  fallbackReason: string | null;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/** `https://x.cognitiveservices.azure.com/` (or with `/openai/v1` pasted on) to the v1 chat URL. */
export function azureChatUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, "").replace(/\/openai(?:\/v1)?$/, "");
  return `${base}/openai/v1/chat/completions`;
}

const loggedFallbacks = new Set<string>();

export function resolveLlmEndpoint(env: Env = process.env): LlmEndpoint {
  const requested = trimmed(env.LLM_PROVIDER)?.toLowerCase();
  if (requested === "azure") {
    const missing = AZURE_ENV_KEYS.filter((key) => !trimmed(env[key]));
    if (missing.length === 0) {
      return {
        provider: "azure",
        url: azureChatUrl(env.AZURE_OPENAI_ENDPOINT!),
        apiKey: trimmed(env.AZURE_OPENAI_API_KEY),
        deployment: trimmed(env.AZURE_OPENAI_DEPLOYMENT)!,
        fallbackReason: null,
      };
    }
    const reason = `LLM_PROVIDER=azure but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set; using Fireworks`;
    if (!loggedFallbacks.has(reason)) {
      loggedFallbacks.add(reason);
      console.error(`[llm] ${reason}`);
    }
    return fireworksEndpoint(env, reason);
  }
  if (requested && requested !== "fireworks") {
    const reason = `LLM_PROVIDER=${requested} is not azure or fireworks; using Fireworks`;
    if (!loggedFallbacks.has(reason)) {
      loggedFallbacks.add(reason);
      console.error(`[llm] ${reason}`);
    }
    return fireworksEndpoint(env, reason);
  }
  return fireworksEndpoint(env, null);
}

function fireworksEndpoint(env: Env, fallbackReason: string | null): LlmEndpoint {
  return {
    provider: "fireworks",
    url: FIREWORKS_CHAT_URL,
    apiKey: trimmed(env.FIREWORKS_API_KEY),
    deployment: null,
    fallbackReason,
  };
}

/** The Azure deployment every lane uses, or null when Fireworks serves. */
export function activeAzureDeployment(env: Env = process.env): string | null {
  return resolveLlmEndpoint(env).deployment;
}

export type AzureReasoningEffort = "low" | "medium" | "high";

/**
 * Probed 9 Oct 2026 on gpt-6.1-sol 2026-09-29: `reasoning_effort` accepts
 * low, medium, high and xhigh. `none` and `minimal` are 400s, so low is the
 * floor a "no reasoning" lane gets. `AZURE_OPENAI_MIN_REASONING_EFFORT` can
 * lower it for a deployment that accepts more.
 */
export const AZURE_MIN_REASONING_EFFORT = "low";

/**
 * Reasoning tokens count against `max_completion_tokens`, and no effort level
 * is a hard budget. Each Azure call gets this much on top of the Fireworks
 * content allowance so reasoning cannot eat the answer.
 */
export const AZURE_REASONING_HEADROOM_TOKENS: Record<AzureReasoningEffort, number> = {
  low: 2048,
  medium: 4096,
  high: 8192,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The Azure effort for a body written in Fireworks terms. */
export function azureReasoningEffort(body: Record<string, unknown>): AzureReasoningEffort {
  const thinking = body.thinking;
  if (isRecord(thinking)) {
    if (thinking.type === "disabled") return "low";
    if (thinking.type === "enabled") {
      const budget = Number(thinking.budget_tokens);
      return Number.isFinite(budget) && budget <= 1024 ? "low" : "medium";
    }
  }
  const effort = typeof body.reasoning_effort === "string" ? body.reasoning_effort.toLowerCase() : "";
  if (effort === "medium") return "medium";
  if (effort === "high" || effort === "xhigh") return "high";
  return "low";
}

/**
 * Translate a Fireworks chat body for the Azure v1 API. Probed 9 Oct 2026:
 *
 * - `temperature`: only the default 1 is accepted. Dropped.
 * - `max_tokens`: rejected. Becomes `max_completion_tokens`, plus reasoning
 *   headroom.
 * - `thinking`, `perf_metrics_in_response`: unknown parameters. Dropped;
 *   `thinking` maps onto `reasoning_effort`.
 * - `response_format` (json_object and json_schema), `stream_options`,
 *   `n`, and image parts pass through unchanged.
 */
export function azureChatBody(body: Record<string, unknown>, env: Env = process.env): Record<string, unknown> {
  const effort = azureReasoningEffort(body);
  const translated: Record<string, unknown> = { ...body };
  for (const key of ["thinking", "perf_metrics_in_response", "temperature", "max_tokens"]) delete translated[key];
  translated.reasoning_effort = effort === "low"
    ? trimmed(env.AZURE_OPENAI_MIN_REASONING_EFFORT) ?? AZURE_MIN_REASONING_EFFORT
    : effort;
  const cap = Number(body.max_tokens);
  if (Number.isFinite(cap) && cap > 0) {
    translated.max_completion_tokens = Math.round(cap) + AZURE_REASONING_HEADROOM_TOKENS[effort];
  }
  return translated;
}

/** The body to send. Fireworks gets the same object back. */
export function providerChatBody(
  body: Record<string, unknown>,
  endpoint: Pick<LlmEndpoint, "provider">,
  env: Env = process.env,
): Record<string, unknown> {
  return endpoint.provider === "azure" ? azureChatBody(body, env) : body;
}

/** Completion tokens a provider body may bill, for spend reservations. */
export function completionTokenCap(body: Record<string, unknown>): number {
  return Number(body.max_completion_tokens ?? body.max_tokens);
}

/**
 * Provider latency fields. Fireworks sends `perf_metrics`; Azure sends a
 * `latency_checkpoint` object (top level on a stream chunk, inside `usage`
 * on a plain response).
 */
export function readProviderPerf(payload: unknown): unknown {
  if (!isRecord(payload)) return undefined;
  if (payload.perf_metrics) return payload.perf_metrics;
  if (isRecord(payload.latency_checkpoint)) return payload.latency_checkpoint;
  if (isRecord(payload.usage) && isRecord(payload.usage.latency_checkpoint)) return payload.usage.latency_checkpoint;
  return undefined;
}
