import {
  GRANT_TTL_MS,
  TTS_CHARS_PER_LESSON,
  BILLING_PLANS,
} from "./catalog";

export type TurnKind = "lesson" | "doubt" | "resume";
export type PaidCallKind = "planner" | "teaching" | "stt" | "photo" | "tts" | "notes" | "policy" | "title" | "suggestions";
export const PAID_CALL_LIMITS: Record<PaidCallKind, number> = {
  planner: 12, teaching: 4, stt: 3, photo: 3, tts: 240, notes: 30, policy: 4, title: 1, suggestions: 2,
};

export interface TurnGrant {
  userId: string;
  lessonTraceId: string;
  allowedTraceIds: Set<string>;
  planId: string;
  expiresAt: number;
  /** Verified purchase expiry, including WS jobs holding this object. */
  billingExpiresAt?: number;
  ttsCharsRemaining: number;
  usdMillicentsRemaining: number;
  inUse: number;
  paidCallCounts: Map<string, number>;
  paidCallsPending: Map<string, number>;
  /** Last acquire, release, or streamed chunk while busy. Reclaimed when stale. */
  inUseUpdatedAt: number;
  /** Reserved staff traces; 0 means begun but no paid chat request has started yet. */
  activeBypassTraces: Map<string, number>;
  bypassFollowOnTraceIds: Set<string>;
  bypassFollowOnRoots: Map<string, string>;
  bypassLessonTraceIds: Set<string>;
  skipAutumn: boolean;
  skipGates: boolean;
}

/**
 * A chat that stopped streaming without releasing (browser gone, `request.signal`
 * never fired, stream `cancel` never ran) must not refuse retries for the full
 * 20-minute grant TTL. Streams touch the grant on every chunk, so 30s without
 * activity means the holder is dead, not slow.
 */
export const STALE_IN_USE_MS = 30_000;

const globalForGrants = globalThis as unknown as {
  heytutorTurnGrants?: Map<string, TurnGrant>;
};

function grantMap(): Map<string, TurnGrant> {
  globalForGrants.heytutorTurnGrants ??= new Map();
  return globalForGrants.heytutorTurnGrants;
}

let nowFn: () => number = Date.now;
let lastSweep = 0;

export function setGrantNowForTests(now: () => number): void {
  nowFn = now;
}

export function resetTurnGrantsForTests(): void {
  grantMap().clear();
  nowFn = Date.now;
  lastSweep = 0;
}

function prune(userId: string): TurnGrant | null {
  const now = nowFn();
  if (now - lastSweep >= 60_000 || grantMap().size >= 10_000) {
    lastSweep = now;
    for (const [id, old] of grantMap()) if (old.expiresAt <= now) grantMap().delete(id);
  }
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

const MAX_CONCURRENT_BYPASS_TRACES = 5;

function reserveBypassTrace(grant: TurnGrant, traceId: string): boolean {
  if (!grant.activeBypassTraces.has(traceId)) {
    if (grant.activeBypassTraces.size >= MAX_CONCURRENT_BYPASS_TRACES) return false;
    grant.activeBypassTraces.set(traceId, 0);
  }
  grant.allowedTraceIds.add(traceId);
  grant.bypassLessonTraceIds.add(traceId);
  grant.expiresAt = Math.max(grant.expiresAt, nowFn() + GRANT_TTL_MS);
  return true;
}

export function attachBypassFollowOnTrace(userId: string, traceId: string, parentTraceId: string | undefined): TurnGrant | null {
  const grant = prune(userId);
  if (!grant?.skipGates || !parentTraceId || parentTraceId === traceId) return null;
  const root = grant.bypassLessonTraceIds.has(parentTraceId)
    ? parentTraceId
    : grant.bypassFollowOnRoots.get(parentTraceId);
  if (!root || grant.bypassLessonTraceIds.has(traceId)) return null;
  if (grant.bypassFollowOnRoots.has(traceId) && grant.bypassFollowOnRoots.get(traceId) !== root) return null;
  // The original chat can end before recording audio. Reclaim its slot only
  // when capacity remains; a follow-on must not become a sixth recording.
  if (!grant.activeBypassTraces.has(root) && !reserveBypassTrace(grant, root)) return null;
  grant.bypassFollowOnTraceIds.add(traceId);
  grant.bypassFollowOnRoots.set(traceId, root);
  grant.allowedTraceIds.add(traceId);
  grant.expiresAt = Math.max(grant.expiresAt, nowFn() + GRANT_TTL_MS);
  return grant;
}

export function ensureBypassGrant(input: {
  userId: string;
  traceId: string;
  planId?: string;
}): TurnGrant | null {
  const existing = prune(input.userId);
  if (existing?.skipGates) {
    if (existing.bypassFollowOnTraceIds.has(input.traceId)) {
      if (!existing.activeBypassTraces.has(existing.bypassFollowOnRoots.get(input.traceId)!)) return null;
    } else if (!reserveBypassTrace(existing, input.traceId)) return null;
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
  // Bypass turns can begin before any paid call increments inUse. Keep every
  // active staff trace on the same grant instead of replacing its predecessor.
  if (existing?.skipGates && input.skipGates === true) {
    if (!reserveBypassTrace(existing, input.traceId)) return { ok: false, reason: "concurrent_limit" };
    return { ok: true, grant: existing };
  }
  if (existing && existing.inUse > 0 && existing.lessonTraceId !== input.traceId) {
    // A remount that never fired `request.signal` and never cancelled the
    // stream leaves `inUse` above zero. The holder is gone, so a retry on the
    // same board must teach instead of 429ing until the 20-minute TTL expires.
    if (!existing.skipGates && nowFn() - existing.inUseUpdatedAt > STALE_IN_USE_MS) {
      existing.inUse = 0;
    } else {
      return { ok: false, reason: "concurrent_limit" };
    }
  }
  if (existing && existing.inUse > 0 && existing.lessonTraceId === input.traceId) {
    return { ok: true, grant: existing };
  }
  const skipGates = input.skipGates === true;
  if (!existing && grantMap().size >= 10_000) return { ok: false, reason: "concurrent_limit" };
  const grant: TurnGrant = {
    userId: input.userId,
    lessonTraceId: input.traceId,
    allowedTraceIds: new Set([input.traceId]),
    planId: input.planId ?? BILLING_PLANS.free,
    expiresAt: nowFn() + (input.ttlMs ?? GRANT_TTL_MS),
    ttsCharsRemaining: input.ttsChars ?? TTS_CHARS_PER_LESSON,
    usdMillicentsRemaining: input.usdMillicents ?? Number.MAX_SAFE_INTEGER,
    inUse: 0,
    paidCallCounts: new Map(),
    paidCallsPending: new Map(),
    inUseUpdatedAt: nowFn(),
    activeBypassTraces: new Map(skipGates ? [[input.traceId, 0]] : []),
    bypassFollowOnTraceIds: new Set(),
    bypassFollowOnRoots: new Map(),
    bypassLessonTraceIds: new Set(skipGates ? [input.traceId] : []),
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
    if (existing.skipGates !== (input.skipGates === true)) return null;
    if (existing.allowedTraceIds.has(input.traceId)) return existing;
    if (!existing.skipGates && (input.remainingMillicents <= 0 || existing.usdMillicentsRemaining <= 0)) return null;
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
    if (existing.skipGates !== (input.skipGates === true)) {
      return { ok: false, reason: "concurrent_limit" };
    }
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
): { ok: true; grant: TurnGrant } | { ok: false; reason: "no_grant" | "out_of_credits" } {
  const grant = prune(userId);
  if (!grant) return { ok: false, reason: "no_grant" };
  if (!grant.skipGates && grant.usdMillicentsRemaining <= 0) {
    return { ok: false, reason: "out_of_credits" };
  }
  if (traceId && grant.allowedTraceIds.has(traceId)) return { ok: true, grant };
  // New direct paid traces must check the persisted balance in gate before
  // attaching; an in-memory grant may be stale after another process spends.
  return { ok: false, reason: "no_grant" };
}

export function touchGrantInUse(grant: TurnGrant): void {
  grant.inUseUpdatedAt = nowFn();
}

export function markGrantInUse(grant: TurnGrant, delta: 1 | -1, traceId?: string): void {
  grant.inUse = Math.max(0, grant.inUse + delta);
  grant.inUseUpdatedAt = nowFn();
  if (!grant.skipGates || !traceId) return;
  const root = grant.bypassFollowOnRoots.get(traceId) ?? traceId;
  const count = grant.activeBypassTraces.get(root);
  if (count === undefined) return;
  if (delta === 1) grant.activeBypassTraces.set(root, count + 1);
  else if (count <= 1) grant.activeBypassTraces.delete(root);
  else grant.activeBypassTraces.set(root, count - 1);
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
  return !grant.skipGates && (grant.usdMillicentsRemaining <= 0 || (grant.billingExpiresAt !== undefined && grant.billingExpiresAt <= nowFn()));
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

export function inFlightLessonCount(userId: string): number {
  const grant = prune(userId);
  return grant?.inUse ?? 0;
}

export function releaseTurnGrant(userId: string): void {
  grantMap().delete(userId);
}

/** Synchronous acquisition before the first await; identical traces cannot
 * race past this bound. Durable receipt counts provide the restart boundary. */
export function acquirePaidCall(grant: TurnGrant, kind: PaidCallKind, traceId = grant.lessonTraceId): { release(): void } | null {
  const group = kind === "tts" ? "tts" : "ai";
  const pending = grant.paidCallsPending.get(group) ?? 0;
  const key = `${traceId}:${kind}`;
  const used = grant.paidCallCounts.get(key) ?? 0;
  if (!grant.skipGates && (pending >= (group === "tts" ? 24 : 4) || used >= PAID_CALL_LIMITS[kind])) return null;
  grant.paidCallCounts.set(key, used + 1);
  grant.paidCallsPending.set(group, pending + 1);
  let released = false;
  return { release() {
    if (released) return;
    released = true;
    grant.paidCallsPending.set(group, Math.max(0, (grant.paidCallsPending.get(group) ?? 1) - 1));
  } };
}
