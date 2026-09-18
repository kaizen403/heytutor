import { resolveApiUrl } from "@heytutor/tutor-core";
import type { CheckoutPlanId } from "./catalog";
import { isBillingErrorCode } from "./errors";
import { isOutOfCreditsCode } from "./studentCopy";
import { patchEntitlementSnapshot, setEntitlementSnapshot, type Entitlement } from "./entitlementState";

export type BillingTurnKind = "lesson" | "doubt" | "resume";

export interface BillingErrorPayload {
  code: string;
  remaining: number | null;
}

export interface BillingFailure {
  status: number;
  code: string;
  remaining: number | null;
}

export interface BeginTurnOk {
  ok: true;
  remainingPct: number | null;
  remaining: number | null;
  planId: string;
  nextResetAt: number | null;
  ttsCharsRemaining: number;
}

export interface BeginTurnErr {
  ok: false;
  status: number;
  code: string;
  remaining: number | null;
}

export type BillingRedirect =
  | { ok: true; url: string }
  | { ok: true; skipped: true }
  | { ok: false } & BillingFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function remainingFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function remainingPctFromPayload(payload: Record<string, unknown>): number | null {
  return remainingFrom(payload.remainingPct) ?? remainingFrom(payload.remaining);
}

function rememberRemainingPct(remainingPct: number | null, extra?: Partial<Entitlement>): void {
  patchEntitlementSnapshot({ remainingPct, ...extra });
}

export function rememberBillingFailure(failure: BillingFailure): void {
  if (typeof failure.remaining === "number") {
    patchEntitlementSnapshot({ remainingPct: failure.remaining });
    return;
  }
  if (isOutOfCreditsCode(failure.code)) {
    patchEntitlementSnapshot({ remainingPct: 0 });
  }
}

export function isBillingErrorPayload(value: unknown): value is BillingErrorPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      "code" in value &&
      typeof (value as { code?: unknown }).code === "string",
  );
}

export function parseBillingFailureFromBody(status: number, body: unknown): BillingFailure | null {
  const payload = typeof body === "string" ? tryParseJson(body) : body;
  const code = isRecord(payload) && typeof payload.code === "string" ? payload.code : null;
  const remaining = isRecord(payload) ? remainingPctFromPayload(payload) : null;
  if (code) {
    return { status, code, remaining };
  }
  if (status === 402) return { status, code: "out_of_credits", remaining };
  if (status === 429) return { status, code: "rate_limited", remaining };
  if (status === 503) return { status, code: "autumn_unavailable", remaining };
  return null;
}

export function parseBillingFailureFromMessage(message: string): BillingFailure | null {
  const statusMatch = message.match(/LLM proxy error \((\d+)\)/);
  const notesMatch = message.match(/notes chat failed \((\d+)\)/);
  const status = statusMatch
    ? Number(statusMatch[1])
    : notesMatch
    ? Number(notesMatch[1])
    : 0;
  const json = extractJsonObject(message);
  if (json) {
    const parsed = parseBillingFailureFromBody(status || guessStatusFromCode(json.code), json);
    if (parsed) return parsed;
  }
  if (/out_of_credits/.test(message)) {
    return { status: status || 402, code: "out_of_credits", remaining: null };
  }
  if (/no_grant/.test(message)) {
    return { status: status || 402, code: "no_grant", remaining: null };
  }
  if (status === 402 || status === 429 || status === 503) {
    return parseBillingFailureFromBody(status, {});
  }
  return null;
}

export function parseBillingFailureFromUnknown(error: unknown): BillingFailure | null {
  if (error instanceof Error) return parseBillingFailureFromMessage(error.message);
  if (isRecord(error) && error.ok === false && typeof error.code === "string") {
    return {
      status: typeof error.status === "number" ? error.status : 402,
      code: error.code,
      remaining: remainingFrom(error.remainingPct) ?? remainingFrom(error.remaining),
    };
  }
  return null;
}

function guessStatusFromCode(code: unknown): number {
  if (typeof code !== "string" || !isBillingErrorCode(code)) return 402;
  if (code === "unauthorized") return 401;
  if (code === "autumn_unavailable") return 503;
  if (code === "rate_limited" || code === "concurrent_limit" || code === "doubt_limit" || code === "tts_budget") {
    return 429;
  }
  return 402;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function extractJsonObject(message: string): Record<string, unknown> | null {
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const parsed = tryParseJson(message.slice(start, end + 1));
  return isRecord(parsed) ? parsed : null;
}

const BEGIN_TURN_TIMEOUT_MS = 15_000;

function mergeAbortSignals(first?: AbortSignal, second?: AbortSignal): AbortSignal | undefined {
  if (!first) return second;
  if (!second) return first;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([first, second]);
  }
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  if (first.aborted) abort(first);
  else first.addEventListener("abort", () => abort(first), { once: true });
  if (second.aborted) abort(second);
  else second.addEventListener("abort", () => abort(second), { once: true });
  return controller.signal;
}

export async function beginTurn(input: {
  traceId: string;
  kind: BillingTurnKind;
  signal?: AbortSignal;
}): Promise<BeginTurnOk | BeginTurnErr> {
  const timeout =
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(BEGIN_TURN_TIMEOUT_MS)
      : undefined;
  let response: Response;
  try {
    response = await fetch(resolveApiUrl("/api/billing/begin-turn"), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      signal: mergeAbortSignals(input.signal, timeout),
      body: JSON.stringify({ traceId: input.traceId, kind: input.kind }),
    });
  } catch (error) {
    if (timeout?.aborted && !input.signal?.aborted) {
      return { ok: false, status: 504, code: "timeout", remaining: null };
    }
    throw error;
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const remainingPct = remainingPctFromPayload(payload);
  if (!response.ok) {
    const err: BeginTurnErr = {
      ok: false,
      status: response.status,
      code: typeof payload.code === "string" ? payload.code : "out_of_credits",
      remaining: remainingPct,
    };
    rememberRemainingPct(err.remaining);
    return err;
  }
  const ok: BeginTurnOk = {
    ok: true,
    remainingPct,
    remaining: remainingPct,
    planId: typeof payload.planId === "string" ? payload.planId : "free",
    nextResetAt: typeof payload.nextResetAt === "number" ? payload.nextResetAt : null,
    ttsCharsRemaining: typeof payload.ttsCharsRemaining === "number" ? payload.ttsCharsRemaining : 0,
  };
  rememberRemainingPct(ok.remainingPct, { planId: ok.planId, nextResetAt: ok.nextResetAt });
  return ok;
}

let entitlementInflight: Promise<{ ok: true; entitlement: Entitlement } | BeginTurnErr> | null = null;

export async function fetchEntitlement(
  signal?: AbortSignal,
): Promise<{ ok: true; entitlement: Entitlement } | BeginTurnErr> {
  if (entitlementInflight && !signal) return entitlementInflight;
  const run = (async () => {
    const response = await fetch(resolveApiUrl("/api/billing/entitlement"), {
      credentials: "include",
      signal,
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ok: false as const,
        status: response.status,
        code: typeof payload.code === "string" ? payload.code : "autumn_unavailable",
        remaining: remainingPctFromPayload(payload),
      };
    }
    const entitlement: Entitlement = {
      planId: typeof payload.planId === "string" ? payload.planId : "free",
      remainingPct: remainingPctFromPayload(payload),
      nextResetAt: typeof payload.nextResetAt === "number" ? payload.nextResetAt : null,
      staff: payload.staff === true,
    };
    setEntitlementSnapshot(entitlement);
    return { ok: true as const, entitlement };
  })();
  if (!signal) {
    entitlementInflight = run.finally(() => {
      entitlementInflight = null;
    });
    return entitlementInflight;
  }
  return run;
}

async function postBillingRedirect(
  path: string,
  body?: Record<string, unknown>,
): Promise<BillingRedirect> {
  const response = await fetch(resolveApiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: typeof payload.code === "string" ? payload.code : "autumn_unavailable",
      remaining: remainingPctFromPayload(payload),
    };
  }
  if (payload.skipped === true || payload.url == null) {
    return { ok: true, skipped: true };
  }
  if (typeof payload.url !== "string") {
    return { ok: true, skipped: true };
  }
  return { ok: true, url: payload.url };
}

export async function startCheckout(planId: CheckoutPlanId): Promise<BillingRedirect> {
  return postBillingRedirect("/api/billing/checkout", { planId });
}

export async function startTopUp(): Promise<BillingRedirect> {
  return postBillingRedirect("/api/billing/top-up");
}

export async function openCustomerPortal(): Promise<BillingRedirect> {
  return postBillingRedirect("/api/billing/portal");
}

export async function followBillingRedirect(result: BillingRedirect): Promise<boolean> {
  if (!result.ok) return false;
  if ("skipped" in result && result.skipped) return true;
  if ("url" in result && result.url) {
    window.location.assign(result.url);
    return true;
  }
  return false;
}
