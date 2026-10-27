/**
 * Which provider serves every LLM lane. One switch, `LLM_PROVIDER`:
 *
 * - `fireworks` (or unset): today's Kimi K3 lanes, unchanged.
 * - `azure`: every lane calls one Azure AI Foundry deployment
 *   (`AZURE_OPENAI_DEPLOYMENT`, gpt-6.1-sol) through the OpenAI v1 API.
 * - `openai_compat`: every lane calls one model (`OPENAI_COMPAT_MODEL`) on an
 *   OpenAI compatible relay (`OPENAI_COMPAT_BASE_URL`), such as tokens-flow.
 *
 * Call sites build the Fireworks body they always built and pass it through
 * `providerChatBody`. With Fireworks that returns the same object; with Azure
 * or a relay it translates the Fireworks-only fields (see `azureChatBody`).
 *
 * Fail safe: a provider with any variable missing logs one error and keeps
 * Fireworks, so a deploy that lands before its env cannot take lessons down.
 * A relay also has a circuit breaker (`noteProviderOutcome`): repeated
 * failures send new requests to Fireworks for a cooldown.
 */

export type LlmProviderName = "fireworks" | "azure" | "openai_compat";

export const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

export const AZURE_ENV_KEYS = [
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
] as const;

/** An OpenAI compatible relay. The base URL ends in `/v1`. */
export const OPENAI_COMPAT_ENV_KEYS = [
  "OPENAI_COMPAT_BASE_URL",
  "OPENAI_COMPAT_API_KEY",
  "OPENAI_COMPAT_MODEL",
] as const;

type Env = Record<string, string | undefined>;

export interface LlmEndpoint {
  provider: LlmProviderName;
  /** OpenAI-compatible chat completions URL. */
  url: string;
  /** Sent as `Authorization: Bearer`. Missing means mock mode. */
  apiKey: string | undefined;
  /** The Azure deployment or relay model every lane uses; null on Fireworks. */
  deployment: string | null;
  /** Set when `LLM_PROVIDER=azure` or `openai_compat` fell back to Fireworks. */
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

/** `https://relay.example/v1` (or with `/chat/completions` pasted on) to the chat URL. */
export function compatChatUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  return `${base}/chat/completions`;
}

/**
 * Relays pool upstream accounts and can vanish, block a key, or rate limit
 * without notice. A 401, 402, 403, 404 or 410 opens the circuit at once (a
 * blocked key, an empty balance, a wrong base URL or a model the relay no
 * longer routes); three 408, 429, 5xx or connect failures inside a minute open
 * it too. Callers report once per request, not per retry. While it is open new
 * requests resolve to Fireworks; after the cooldown the relay is tried again.
 * A relay that answers every request with a 400 never opens it: that is a
 * request the relay rejects, and Fireworks would get the same body shape.
 */
export const COMPAT_CIRCUIT = {
  failureWindowMs: 60_000,
  failuresToOpen: 3,
  cooldownMs: 5 * 60_000,
} as const;

export type ProviderOutcome = { ok: true } | { ok: false; status?: number };

/** Statuses that mean the relay cannot serve us at all, not a passing blip. */
const COMPAT_BLOCKING_STATUSES = new Set([401, 402, 403, 404, 410]);

export class CompatCircuit {
  private failures: number[] = [];
  private openUntil = 0;
  private reason: string | null = null;

  /** The reason new requests skip the relay, or null when it is closed. */
  openReason(now = Date.now()): string | null {
    if (now < this.openUntil) return this.reason;
    if (this.reason) {
      this.reason = null;
      this.failures = [];
    }
    return null;
  }

  /** Tests only: forget every failure and close the circuit. */
  reset(): void {
    this.failures = [];
    this.openUntil = 0;
    this.reason = null;
  }

  record(outcome: ProviderOutcome, now = Date.now()): boolean {
    if (outcome.ok) {
      this.failures = [];
      return false;
    }
    const status = outcome.status;
    const blocked = status !== undefined && COMPAT_BLOCKING_STATUSES.has(status);
    // Any other 4xx but a timeout or rate limit is our request, not the relay.
    if (status !== undefined && status < 500 && !blocked && status !== 408 && status !== 429) return false;
    if (this.openReason(now)) return false;
    this.failures = [...this.failures.filter((at) => now - at < COMPAT_CIRCUIT.failureWindowMs), now];
    if (!blocked && this.failures.length < COMPAT_CIRCUIT.failuresToOpen) return false;
    this.openUntil = now + COMPAT_CIRCUIT.cooldownMs;
    this.reason = blocked
      ? `openai_compat answered ${status}; using Fireworks for ${COMPAT_CIRCUIT.cooldownMs / 1000}s`
      : `openai_compat failed ${this.failures.length} times in ${COMPAT_CIRCUIT.failureWindowMs / 1000}s; using Fireworks for ${COMPAT_CIRCUIT.cooldownMs / 1000}s`;
    this.failures = [];
    return true;
  }
}

/**
 * The process-wide relay circuit every LLM route reports into. Next bundles
 * each route separately, so module state is per bundle; the circuit lives on
 * globalThis (as turn grants do) so one route's failures protect the others.
 */
const circuitHolder = globalThis as typeof globalThis & { __heytutorCompatCircuit?: CompatCircuit };
export const compatCircuit: CompatCircuit = circuitHolder.__heytutorCompatCircuit ??= new CompatCircuit();

/**
 * Report how a relay call ended. Ignored for other providers and when
 * `OPENAI_COMPAT_FALLBACK=off` (the lab measures the relay alone). Without a
 * Fireworks key there is nothing to fall back to, so the circuit stays shut
 * rather than sending students mock lessons.
 */
export function noteProviderOutcome(
  endpoint: Pick<LlmEndpoint, "provider">,
  outcome: ProviderOutcome,
  env: Env = process.env,
  circuit: CompatCircuit = compatCircuit,
): void {
  if (endpoint.provider !== "openai_compat" || !compatFallbackEnabled(env)) return;
  if (circuit.record(outcome)) console.error(`[llm] ${circuit.openReason()}`);
}

/**
 * A relay env that must not serve students. The base URL is checked because a
 * missing `/v1` makes every call a 404. Production also needs
 * `OPENAI_COMPAT_ALLOW_PRODUCTION=1`: the relay ignores `max_tokens` and
 * `max_completion_tokens` (probed 27 Oct 2026), so a reservation sized by the
 * cap does not bound what a student's turn can bill.
 */
function compatEnvProblem(env: Env): string | null {
  let path: string;
  try {
    const url = new URL(compatChatUrl(env.OPENAI_COMPAT_BASE_URL!));
    if (url.protocol !== "https:" && url.protocol !== "http:") return "OPENAI_COMPAT_BASE_URL is not an http(s) URL";
    path = url.pathname;
  } catch {
    return "OPENAI_COMPAT_BASE_URL is not a URL";
  }
  if (!/\/v1\/chat\/completions$/.test(path)) return "OPENAI_COMPAT_BASE_URL must end in /v1";
  if (env.NODE_ENV === "production" && trimmed(env.OPENAI_COMPAT_ALLOW_PRODUCTION) !== "1") {
    return "the relay does not enforce output caps and OPENAI_COMPAT_ALLOW_PRODUCTION is not 1";
  }
  return null;
}

/**
 * An env that resolves to the same provider `endpoint` did, whatever the relay
 * circuit does in between. Routes that resolve the endpoint, await something,
 * then pick a model pass this to the model resolvers so a Kimi id never goes
 * to the relay and the relay model never goes to Fireworks.
 */
export function endpointEnv(endpoint: Pick<LlmEndpoint, "provider">, env: Env = process.env): Env {
  if (endpoint.provider === "fireworks") return { ...env, LLM_PROVIDER: "fireworks" };
  if (endpoint.provider === "openai_compat") return { ...env, OPENAI_COMPAT_FALLBACK: "off" };
  return env;
}

function compatFallbackEnabled(env: Env): boolean {
  return trimmed(env.OPENAI_COMPAT_FALLBACK)?.toLowerCase() !== "off" && Boolean(trimmed(env.FIREWORKS_API_KEY));
}

const loggedFallbacks = new Set<string>();

function logFallbackOnce(reason: string): void {
  if (loggedFallbacks.has(reason)) return;
  loggedFallbacks.add(reason);
  console.error(`[llm] ${reason}`);
}

export function resolveLlmEndpoint(env: Env = process.env, circuit: CompatCircuit = compatCircuit): LlmEndpoint {
  const requested = trimmed(env.LLM_PROVIDER)?.toLowerCase();
  if (requested === "openai_compat") {
    const missing = OPENAI_COMPAT_ENV_KEYS.filter((key) => !trimmed(env[key]));
    if (missing.length > 0) {
      const reason = `LLM_PROVIDER=openai_compat but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set; using Fireworks`;
      logFallbackOnce(reason);
      return fireworksEndpoint(env, reason);
    }
    const invalid = compatEnvProblem(env);
    if (invalid) {
      const reason = `LLM_PROVIDER=openai_compat but ${invalid}; using Fireworks`;
      logFallbackOnce(reason);
      return fireworksEndpoint(env, reason);
    }
    const open = compatFallbackEnabled(env) ? circuit.openReason() : null;
    if (open) return fireworksEndpoint(env, open);
    return {
      provider: "openai_compat",
      url: compatChatUrl(env.OPENAI_COMPAT_BASE_URL!),
      apiKey: trimmed(env.OPENAI_COMPAT_API_KEY),
      deployment: trimmed(env.OPENAI_COMPAT_MODEL)!,
      fallbackReason: null,
    };
  }
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
    logFallbackOnce(reason);
    return fireworksEndpoint(env, reason);
  }
  if (requested && requested !== "fireworks") {
    const reason = `LLM_PROVIDER=${requested} is not azure, openai_compat or fireworks; using Fireworks`;
    logFallbackOnce(reason);
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

/** The one Azure deployment or relay model every lane uses, or null when Fireworks serves. */
export function activeSingleDeployment(env: Env = process.env): string | null {
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
export function azureChatBody(
  body: Record<string, unknown>,
  env: Env = process.env,
  minEffortKey: "AZURE_OPENAI_MIN_REASONING_EFFORT" | "OPENAI_COMPAT_MIN_REASONING_EFFORT" = "AZURE_OPENAI_MIN_REASONING_EFFORT",
): Record<string, unknown> {
  const effort = azureReasoningEffort(body);
  const translated: Record<string, unknown> = { ...body };
  for (const key of ["thinking", "perf_metrics_in_response", "temperature", "max_tokens"]) delete translated[key];
  translated.reasoning_effort = effort === "low"
    ? trimmed(env[minEffortKey]) ?? AZURE_MIN_REASONING_EFFORT
    : effort;
  const cap = Number(body.max_tokens);
  if (Number.isFinite(cap) && cap > 0) {
    translated.max_completion_tokens = Math.round(cap) + AZURE_REASONING_HEADROOM_TOKENS[effort];
  }
  return translated;
}

/**
 * A relay serving gpt-6.1-sol (tokens-flow, probed 27 Oct 2026) balances each
 * model across two upstreams. One accepts `reasoning_effort: none`; the other
 * answers it with a 400, exactly as Azure does, and the same holds for
 * `minimal`. So a relay gets the Azure translation, with its own floor
 * override. Neither upstream enforces `max_tokens` or `max_completion_tokens`:
 * the cap still sizes the spend reservation, it does not bound the reply.
 */
export function compatChatBody(body: Record<string, unknown>, env: Env = process.env): Record<string, unknown> {
  return azureChatBody(body, env, "OPENAI_COMPAT_MIN_REASONING_EFFORT");
}

/** The body to send. Fireworks gets the same object back. */
export function providerChatBody(
  body: Record<string, unknown>,
  endpoint: Pick<LlmEndpoint, "provider">,
  env: Env = process.env,
): Record<string, unknown> {
  if (endpoint.provider === "azure") return azureChatBody(body, env);
  if (endpoint.provider === "openai_compat") return compatChatBody(body, env);
  return body;
}

/** Completion tokens a provider body may bill, for spend reservations. */
export function completionTokenCap(body: Record<string, unknown>): number {
  return Number(body.max_completion_tokens ?? body.max_tokens);
}

/**
 * Which upstream behind a relay answered, from the response id. tokens-flow
 * (27 Oct 2026) answers one model from two pools: `resp_...` ids (Responses
 * API, about 4,200 hidden cached prompt tokens per call) and short
 * `chatcmpl-...` ids. Recording the split shows drift between them.
 */
export function relayUpstreamKind(id: unknown): "responses" | "chat_completions" | "unknown" {
  if (typeof id !== "string") return "unknown";
  if (id.startsWith("resp_")) return "responses";
  if (id.startsWith("chatcmpl-")) return "chat_completions";
  return "unknown";
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
