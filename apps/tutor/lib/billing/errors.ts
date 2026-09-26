const BILLING_ERROR_CODES = [
  "unauthorized",
  "out_of_credits",
  "rate_limited",
  "concurrent_limit",
  "daily_usd_limit",
  "no_grant",
  "doubt_limit",
  "notes_limit",
  "tts_budget",
  "autumn_unavailable",
] as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];

export function isBillingErrorCode(value: unknown): value is BillingErrorCode {
  return typeof value === "string" && (BILLING_ERROR_CODES as readonly string[]).includes(value);
}

export interface BillingErrorBody {
  code: BillingErrorCode;
  remaining: number | null;
  error?: string;
}

export function billingStatus(code: BillingErrorCode): 401 | 402 | 429 | 503 {
  switch (code) {
    case "unauthorized":
      return 401;
    case "out_of_credits":
    case "no_grant":
    case "daily_usd_limit":
    case "notes_limit":
      return 402;
    case "rate_limited":
    case "concurrent_limit":
    case "doubt_limit":
    case "tts_budget":
      return 429;
    case "autumn_unavailable":
      return 503;
  }
}

export function billingBody(
  code: BillingErrorCode,
  remaining: number | null = null,
  error?: string,
): BillingErrorBody {
  return { code, remaining, ...(error ? { error } : {}) };
}

export function billingResponse(
  code: BillingErrorCode,
  remaining: number | null = null,
  error?: string,
): Response {
  return Response.json(billingBody(code, remaining, error), { status: billingStatus(code) });
}
