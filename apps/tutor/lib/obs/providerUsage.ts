/** Provider usage objects, normalized for cost and billing. */

export interface ParsedProviderUsage {
  input?: number;
  output?: number;
  total?: number;
  /** Prompt tokens the provider reported as cache hits. A subset of `input`. */
  cachedInput?: number;
  /**
   * False when the provider sent no usage object. That spend is unknown.
   * It is not a measured zero.
   */
  known: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteToken(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function readCachedTokens(usage: Record<string, unknown>): number | undefined {
  const direct =
    finiteToken(usage.cached_tokens) ??
    finiteToken(usage.cache_read_input_tokens) ??
    finiteToken(usage.prompt_cache_hit_tokens) ??
    finiteToken(usage.cachedInput);
  if (direct !== undefined) return direct;
  const details = usage.prompt_tokens_details;
  if (!isRecord(details)) return undefined;
  return finiteToken(details.cached_tokens);
}

/**
 * Reads a Fireworks chat-completions usage object, including cache hits when
 * the provider reports them. Gateway evaluation usage is a different shape
 * and is parsed in the evaluation client.
 */
export function parseProviderUsage(usage: unknown): ParsedProviderUsage {
  if (!isRecord(usage)) {
    return { known: false };
  }
  const input = finiteToken(usage.prompt_tokens) ?? finiteToken(usage.input);
  const output = finiteToken(usage.completion_tokens) ?? finiteToken(usage.output);
  const total =
    finiteToken(usage.total_tokens) ??
    finiteToken(usage.total) ??
    (input !== undefined && output !== undefined ? input + output : undefined);
  if (input === undefined && output === undefined && total === undefined) {
    return { known: false };
  }
  const cachedInput = readCachedTokens(usage);
  return {
    input,
    output,
    total,
    cachedInput: cachedInput !== undefined && input !== undefined ? Math.min(cachedInput, input) : cachedInput,
    known: true,
  };
}

export function usageDetailsFromParsed(parsed: ParsedProviderUsage): {
  input?: number;
  output?: number;
  total?: number;
  cachedInput?: number;
} | undefined {
  if (!parsed.known) return undefined;
  return {
    input: parsed.input,
    output: parsed.output,
    total: parsed.total,
    cachedInput: parsed.cachedInput,
  };
}
