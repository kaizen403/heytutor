import {
  GRANT_TTL_MS,
  TTS_CHARS_PER_LESSON,
  BILLING_PLANS,
} from "./catalog";

export type TurnKind = "lesson" | "doubt" | "resume";

export interface TurnGrant {
  userId: string;
  lessonTraceId: string;
  allowedTraceIds: Set<string>;
  planId: string;
  expiresAt: number;
  ttsCharsRemaining: number;
  usdMillicentsRemaining: number;
  inUse: number;
  skipAutumn: boolean;
  skipGates: boolean;
}

const globalForGrants = globalThis as unknown as {
  heytutorTurnGrants?: Map<string, TurnGrant>;
};

function grantMap(): Map<string, TurnGrant> {
  globalForGrants.heytutorTurnGrants ??= new Map();
  return globalForGrants.heytutorTurnGrants;
}

let nowFn: () => number = Date.now;

export function resetTurnGrantsForTests(): void {
  grantMap().clear();
  nowFn = Date.now;
}

function prune(userId: string): TurnGrant | null {
  const grant = grantMap().get(userId);
  if (!grant) return null;
  if (grant.expiresAt <= nowFn()) {
    grantMap().delete(userId);
    return null;
  }
  return grant;
}

export function getTurnGrant(userId: string): TurnGrant | null {
  return prune(userId);
}

export function ensureBypassGrant(input: {
  userId: string;
  traceId: string;
  planId?: string;
}): TurnGrant | null {
  const existing = prune(input.userId);
  if (existing) {
    existing.allowedTraceIds.add(input.traceId);
    existing.expiresAt = Math.max(existing.expiresAt, nowFn() + GRANT_TTL_MS);
    existing.skipAutumn = true;
    existing.skipGates = true;
    existing.usdMillicentsRemaining = Number.MAX_SAFE_INTEGER;
    return existing;
  }
  const minted = createLessonGrant({
    userId: input.userId,
    traceId: input.traceId,
    planId: input.planId ?? BILLING_PLANS.pro,
    ttsChars: Number.MAX_SAFE_INTEGER,
    usdMillicents: Number.MAX_SAFE_INTEGER,
    skipAutumn: true,
    skipGates: true,
  });
  return minted.ok ? minted.grant : null;
}

export function createLessonGrant(input: {
  userId: string;
  traceId: string;
  planId?: string;
  ttsChars?: number;
  usdMillicents?: number;
  ttlMs?: number;
  skipAutumn?: boolean;
  skipGates?: boolean;
}): { ok: true; grant: TurnGrant } | { ok: false; reason: "concurrent_limit" } {
  const existing = prune(input.userId);
  if (existing && existing.inUse > 0 && existing.lessonTraceId !== input.traceId) {
    return { ok: false, reason: "concurrent_limit" };
  }
  if (existing && existing.inUse > 0 && existing.lessonTraceId === input.traceId) {
    return { ok: true, grant: existing };
  }
  const skipGates = input.skipGates === true;
  const grant: TurnGrant = {
    userId: input.userId,
    lessonTraceId: input.traceId,
    allowedTraceIds: new Set([input.traceId]),
    planId: input.planId ?? BILLING_PLANS.free,
    expiresAt: nowFn() + (input.ttlMs ?? GRANT_TTL_MS),
    ttsCharsRemaining: input.ttsChars ?? TTS_CHARS_PER_LESSON,
    usdMillicentsRemaining: input.usdMillicents ?? Number.MAX_SAFE_INTEGER,
    inUse: 0,
    skipAutumn: input.skipAutumn === true,
    skipGates,
  };
  grantMap().set(input.userId, grant);
  return { ok: true, grant };
}

export function recoverGrantForPaidCall(input: {
  userId: string;
  traceId: string;
  remainingMillicents: number;
  planId: string;
  skipAutumn?: boolean;
  skipGates?: boolean;
}): TurnGrant | null {
  const existing = prune(input.userId);
  if (existing) {
    if (existing.allowedTraceIds.has(input.traceId)) return existing;
    const attached = attachTraceToGrant(input.userId, input.traceId);
    return attached.ok ? attached.grant : null;
  }
  if (input.remainingMillicents <= 0) return null;
  const minted = createLessonGrant({
    userId: input.userId,
    traceId: input.traceId,
    planId: input.planId,
    usdMillicents: input.remainingMillicents,
    skipAutumn: input.skipAutumn,
    skipGates: input.skipGates,
  });
  return minted.ok ? minted.grant : null;
}

export function attachTraceToGrant(
  userId: string,
  traceId: string,
): { ok: true; grant: TurnGrant } | { ok: false; reason: "no_grant" } {
  const grant = prune(userId);
  if (!grant) return { ok: false, reason: "no_grant" };
  if (grant.allowedTraceIds.has(traceId)) return { ok: true, grant };
  grant.allowedTraceIds.add(traceId);
  grant.expiresAt = Math.max(grant.expiresAt, nowFn() + GRANT_TTL_MS);
  return { ok: true, grant };
}

/**
 * A doubt or resume (`Explain this`, Ask a doubt, continue lecture) attaches
 * to the in-flight lesson grant. After the lecture ends, the process restarts,
 * or the 20-minute TTL expires, that Map is empty — leftover monthly USD is
 * still usage. Mint in that case instead of mapping `no_grant` to Out of usage.
 */
export function grantForFollowOnTurn(input: {
  userId: string;
  traceId: string;
  remainingMillicents: number;
  planId: string;
  skipAutumn?: boolean;
  skipGates?: boolean;
}):
  | { ok: true; grant: TurnGrant }
  | { ok: false; reason: "out_of_credits" | "concurrent_limit" } {
  const existing = prune(input.userId);
  if (existing) {
    // Follow-up count is unrestricted, but each new answer still needs usage.
    // Otherwise a grant minted before the balance reached zero could buy
    // unbounded LLM calls after the monthly envelope was exhausted.
    if (
      !existing.allowedTraceIds.has(input.traceId) &&
      !existing.skipGates &&
      (input.remainingMillicents <= 0 || existing.usdMillicentsRemaining <= 0)
    ) {
      return { ok: false, reason: "out_of_credits" };
    }
    const attached = attachTraceToGrant(input.userId, input.traceId);
    if (attached.ok) {
      attached.grant.planId = input.planId;
      attached.grant.skipAutumn = input.skipAutumn === true;
      attached.grant.skipGates = input.skipGates === true;
      if (input.remainingMillicents > 0) {
        attached.grant.usdMillicentsRemaining = input.remainingMillicents;
      }
      return attached;
    }
  }
  if (input.remainingMillicents <= 0) {
    return { ok: false, reason: "out_of_credits" };
  }
  const minted = createLessonGrant({
    userId: input.userId,
    traceId: input.traceId,
    planId: input.planId,
    usdMillicents: input.remainingMillicents,
    skipAutumn: input.skipAutumn,
    skipGates: input.skipGates,
  });
  if (!minted.ok) return { ok: false, reason: "concurrent_limit" };
  return { ok: true, grant: minted.grant };
}

export function requireGrantForTrace(
  userId: string,
  traceId: string | undefined,
): { ok: true; grant: TurnGrant } | { ok: false; reason: "no_grant" } {
  const grant = prune(userId);
  if (!grant) return { ok: false, reason: "no_grant" };
  if (!traceId || grant.allowedTraceIds.has(traceId)) return { ok: true, grant };
  return attachTraceToGrant(userId, traceId);
}

export function markGrantInUse(grant: TurnGrant, delta: 1 | -1): void {
  grant.inUse = Math.max(0, grant.inUse + delta);
}

export function consumeTtsChars(
  grant: TurnGrant,
  characters: number,
): { allowed: boolean; remaining: number } {
  if (characters <= 0) {
    return { allowed: true, remaining: grant.ttsCharsRemaining };
  }
  if (grant.ttsCharsRemaining <= 0) {
    return { allowed: false, remaining: 0 };
  }
  if (characters > grant.ttsCharsRemaining) {
    grant.ttsCharsRemaining = 0;
    return { allowed: false, remaining: 0 };
  }
  grant.ttsCharsRemaining -= characters;
  return { allowed: true, remaining: grant.ttsCharsRemaining };
}

export function shouldSkipTtsForUsage(grant: TurnGrant): boolean {
  return !grant.skipGates && grant.usdMillicentsRemaining <= 0;
}

export function consumeUsdMillicents(
  grant: TurnGrant,
  millicents: number,
): { remaining: number } {
  if (grant.skipGates || millicents <= 0) {
    return { remaining: grant.usdMillicentsRemaining };
  }
  grant.usdMillicentsRemaining = Math.max(0, grant.usdMillicentsRemaining - millicents);
  return { remaining: grant.usdMillicentsRemaining };
}

export function syncGrantUsdRemaining(userId: string, remainingMillicents: number): void {
  const grant = prune(userId);
  if (!grant || grant.skipGates) return;
  grant.usdMillicentsRemaining = Math.max(0, remainingMillicents);
}

export function releaseTurnGrant(userId: string): void {
  grantMap().delete(userId);
}
