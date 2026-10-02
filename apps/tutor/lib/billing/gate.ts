import { randomUUID } from "node:crypto";
import { HEYTUTOR_TRACE_ID_HEADER, readTraceIdHeader } from "@heytutor/tutor-core";
import { prisma } from "@/lib/db/prisma";
import {
  AutumnUnavailableError,
  checkFeature,
  ensureAutumnCustomer,
  loadCustomerSnapshot,
} from "./autumnClient";
import { BILLING_FEATURES, BILLING_PLANS, isKnownPlanId } from "./catalog";
import { billingResponse } from "./errors";
import { questionsRemainingThisHour, recordNewQuestion } from "./fuses";
import {
  attachBypassFollowOnTrace,
  createLessonGrant,
  ensureBypassGrant,
  getTurnGrant,
  grantForFollowOnTurn,
  markGrantInUse,
  recoverGrantForPaidCall,
  releaseTurnGrant,
  requireGrantForTrace,
  touchGrantInUse,
  type TurnGrant,
  type TurnKind,
} from "./grant";
import { cacheUsageOnUser, loadPeriodBalance, type PeriodBalance } from "./ledger";
import { isSpendActor, requireSpendActor, type SpendActor } from "./actor";
import { beginTurnAccess, paidCallAccess } from "./usageGate";
import { usesRazorpay } from "./razorpayConfig";
import { loadRazorpayAccess } from "./razorpayPurchases";
import { reserveRazorpayNote } from "./razorpayNotes";
import { registerOwnedTrace, assertOwnedTrace } from "../obs/traceOwnership";
import { readBoundedJson, RequestBodyError } from "../http/requestBody";

function bindRazorpayGrant(grant: TurnGrant, balance: PeriodBalance): void {
  if (usesRazorpay()) grant.billingExpiresAt = balance.nextResetAt;
  grant.planId = balance.planId;
  grant.usdMillicentsRemaining = Math.min(grant.usdMillicentsRemaining, balance.remainingMillicents);
}

async function refreshRazorpayGrant(actor: SpendActor, grant: TurnGrant): Promise<Response | null> {
  const balance = await loadPeriodBalance({ userId: actor.userId, planId: grant.planId });
  bindRazorpayGrant(grant, balance);
  return balance.remainingMillicents <= 0 ? billingResponse("out_of_credits", 0) : null;
}

export interface BeginTurnSuccess {
  grant: TurnGrant;
  remainingPct: number | null;
  planId: string;
  nextResetAt: number | null;
}

const beginTurnLocks = new Map<string, Promise<void>>();

async function withUserLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const previous = beginTurnLocks.get(userId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  const settled = current.then(() => undefined, () => undefined);
  beginTurnLocks.set(userId, settled);
  try { return await current; }
  finally { if (beginTurnLocks.get(userId) === settled) beginTurnLocks.delete(userId); }
}

async function cachedPlanId(userId: string): Promise<string> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { planId: true },
  });
  return isKnownPlanId(row?.planId) ? row.planId : BILLING_PLANS.free;
}

async function resolvePlanId(actor: SpendActor): Promise<string | Response> {
  if (actor.skipGates) return BILLING_PLANS.pro;
  if (usesRazorpay()) return (await loadRazorpayAccess(actor.userId)).planId;
  const planId = await cachedPlanId(actor.userId);
  if (actor.skipAutumn) return planId;
  try {
    await ensureAutumnCustomer({ userId: actor.userId, email: actor.email });
    const snapshot = await loadCustomerSnapshot({ userId: actor.userId });
    return snapshot.planId;
  } catch (error) {
    if (error instanceof AutumnUnavailableError) {
      return billingResponse("autumn_unavailable", null, error.message);
    }
    throw error;
  }
}

function remainingPctFrom(balance: PeriodBalance): number {
  return balance.remainingPct;
}

export async function beginTurnForActor(
  actor: SpendActor,
  input: { traceId: string; kind: TurnKind; parentTraceId?: string },
): Promise<BeginTurnSuccess | Response> {
  if (readTraceIdHeader(input.traceId) !== input.traceId) {
    return billingResponse("no_grant", 0, "traceId is required");
  }

  return withUserLock(actor.userId, async () => {
    const result = await beginTurnLocked(actor, input);
    if (!(result instanceof Response) && !await registerOwnedTrace(actor.userId, input.traceId)) {
      releaseTurnGrant(actor.userId);
      return billingResponse("no_grant", 0);
    }
    return result;
  });
}

async function beginTurnLocked(
  actor: SpendActor,
  input: { traceId: string; kind: TurnKind; parentTraceId?: string },
): Promise<BeginTurnSuccess | Response> {
  if (actor.skipGates) {
    const followOn = input.kind !== "lesson"
      ? attachBypassFollowOnTrace(actor.userId, input.traceId, input.parentTraceId)
      : null;
    if (followOn) {
      return { grant: followOn, remainingPct: null, planId: BILLING_PLANS.pro, nextResetAt: null };
    }
    if (input.kind !== "lesson") return billingResponse("concurrent_limit", 0);
    const minted = createLessonGrant({
      userId: actor.userId,
      traceId: input.traceId,
      planId: BILLING_PLANS.pro,
      ttsChars: Number.MAX_SAFE_INTEGER,
      usdMillicents: Number.MAX_SAFE_INTEGER,
      skipAutumn: true,
      skipGates: true,
    });
    if (!minted.ok) return billingResponse("concurrent_limit", 0);

    return {
      grant: getTurnGrant(actor.userId) ?? minted.grant,
      remainingPct: null,
      planId: BILLING_PLANS.pro,
      nextResetAt: null,
    };
  }

  if (getTurnGrant(actor.userId)?.skipGates) return billingResponse("no_grant", 0);
  const planIdOrError = await resolvePlanId(actor);
  if (planIdOrError instanceof Response) return planIdOrError;
  const planId = planIdOrError;
  const balance = await loadPeriodBalance({ userId: actor.userId, planId });
  const remainingPct = remainingPctFrom(balance);
  const existing = getTurnGrant(actor.userId);

  if (
    beginTurnAccess({
      remainingMillicents: balance.remainingMillicents,
      grant: existing,
      kind: input.kind,
      traceId: input.traceId,
    }) === "out_of_credits"
  ) {
    void cacheUsageOnUser({ userId: actor.userId, planId, remainingPct: 0 }).catch(() => undefined);
    return billingResponse("out_of_credits", 0);
  }

  if (input.kind !== "lesson") {
    const followOn = grantForFollowOnTurn({
      userId: actor.userId,
      traceId: input.traceId,
      remainingMillicents: balance.remainingMillicents,
      planId,
      skipAutumn: actor.skipAutumn,
      skipGates: actor.skipGates,
    });
    if (!followOn.ok) {
      return billingResponse(followOn.reason, followOn.reason === "out_of_credits" ? 0 : remainingPct);
    }
    bindRazorpayGrant(followOn.grant, balance);
    return {
      grant: followOn.grant,
      remainingPct,
      planId,
      nextResetAt: balance.nextResetAt,
    };
  }

  if (balance.remainingMillicents <= 0 && existing) {
    existing.skipAutumn = actor.skipAutumn;
    existing.skipGates = actor.skipGates;
    existing.planId = planId;
    return {
      grant: existing,
      remainingPct,
      planId,
      nextResetAt: balance.nextResetAt,
    };
  }

  if (questionsRemainingThisHour(actor.userId) <= 0) {
    return billingResponse("rate_limited", 0);
  }

  const minted = createLessonGrant({
    userId: actor.userId,
    traceId: input.traceId,
    planId,
    usdMillicents: balance.remainingMillicents,
    skipAutumn: actor.skipAutumn,
    skipGates: actor.skipGates,
  });
  if (!minted.ok) {
    return billingResponse("concurrent_limit", remainingPct);
  }
  bindRazorpayGrant(minted.grant, balance);

  const hourly = recordNewQuestion(actor.userId);
  if (!hourly.ok) {
    releaseTurnGrant(actor.userId);
    return billingResponse("rate_limited", remainingPct);
  }

  void cacheUsageOnUser({ userId: actor.userId, planId, remainingPct }).catch((error) => {
    console.error("[billing] cache update failed", error);
  });

  return {
    grant: minted.grant,
    remainingPct,
    planId,
    nextResetAt: balance.nextResetAt,
  };
}

export async function beginTurnFromRequest(request: Request): Promise<BeginTurnSuccess | Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  let body: { traceId?: unknown; kind?: unknown; parentTraceId?: unknown } = {};
  try {
    body = await readBoundedJson(request, 4096);
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    return billingResponse("no_grant", 0, "invalid json");
  }
  const traceId = typeof body.traceId === "string" ? body.traceId.trim() : "";
  const kind: TurnKind =
    body.kind === "doubt" || body.kind === "resume" || body.kind === "lesson"
      ? body.kind
      : "lesson";
  const parentTraceId = typeof body.parentTraceId === "string" ? body.parentTraceId.trim() : undefined;
  return beginTurnForActor(actor, { traceId, kind, parentTraceId });
}

export async function requireLessonGrant(
  request: Request,
): Promise<{ actor: SpendActor; grant: TurnGrant } | Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  if (actor.skipGates) {
    const traceId = readTraceIdHeader(request.headers.get(HEYTUTOR_TRACE_ID_HEADER)) ?? `bypass-${actor.userId}`;
    const grant = ensureBypassGrant({
      userId: actor.userId,
      traceId,
      planId: BILLING_PLANS.pro,
    });
    if (!grant) return billingResponse("concurrent_limit", 0);
    if (!await registerOwnedTrace(actor.userId, traceId) || !await assertOwnedTrace(actor.userId, traceId, request.headers.get("x-session-id") ?? undefined)) return billingResponse("no_grant", 0);
    return { actor, grant };
  }

  if (getTurnGrant(actor.userId)?.skipGates) return billingResponse("no_grant", 0);
  const traceId = readTraceIdHeader(request.headers.get(HEYTUTOR_TRACE_ID_HEADER));
  const matched = requireGrantForTrace(actor.userId, traceId);
  if (matched.ok) {
    const denied = await refreshRazorpayGrant(actor, matched.grant);
    if (denied) return denied;
    if (traceId && !await assertOwnedTrace(actor.userId, traceId, request.headers.get("x-session-id") ?? undefined)) return billingResponse("no_grant", 0);
    return { actor, grant: matched.grant };
  }
  if (matched.reason === "out_of_credits") return billingResponse("out_of_credits", 0);
  const planIdOrError = await resolvePlanId(actor);
  if (planIdOrError instanceof Response) return planIdOrError;
  const planId = planIdOrError;
  const balance = await loadPeriodBalance({ userId: actor.userId, planId });
  const remainingPct = remainingPctFrom(balance);
  if (paidCallAccess({ remainingMillicents: balance.remainingMillicents, grant: null }) !== "allow") {
    return billingResponse("out_of_credits", remainingPct);
  }
  const recoveredTrace = traceId ?? randomUUID();
  if (questionsRemainingThisHour(actor.userId) <= 0) return billingResponse("rate_limited", remainingPct);
  if (!await registerOwnedTrace(actor.userId, recoveredTrace)) return billingResponse("no_grant", remainingPct);
  const recovered = recoverGrantForPaidCall({
    userId: actor.userId,
    traceId: recoveredTrace,
    remainingMillicents: balance.remainingMillicents,
    planId,
    skipAutumn: actor.skipAutumn,
    skipGates: actor.skipGates,
  });
  if (!recovered) {
    return billingResponse("no_grant", remainingPct);
  }
  if (!recordNewQuestion(actor.userId).ok) return billingResponse("rate_limited", remainingPct);
  if (!await assertOwnedTrace(actor.userId, recoveredTrace, request.headers.get("x-session-id") ?? undefined)) return billingResponse("no_grant", remainingPct);
  bindRazorpayGrant(recovered, balance);
  return { actor, grant: recovered };
}

export async function withGrantInUse<T>(
  grant: TurnGrant,
  work: () => Promise<T>,
): Promise<T> {
  markGrantInUse(grant, 1);
  try {
    return await work();
  } finally {
    markGrantInUse(grant, -1);
  }
}

/** One chat request may end by stream close, cancel, or the client disconnecting. */
export function createInUseRelease(grant: TurnGrant, traceId: string): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    markGrantInUse(grant, -1, traceId);
  };
}

/**
 * A browser abort does not always cancel the response stream. Fireworks can
 * stay open, `inUse` stays above zero, and the next question is refused.
 */
export function releaseInUseWhenClientLeaves(signal: AbortSignal, release: () => void): void {
  if (signal.aborted) {
    release();
    return;
  }
  signal.addEventListener("abort", release, { once: true });
}

/** Keep a chat grant busy through the streamed body, not just until response headers. */
export function holdGrantUntilStreamEnds(
  grant: TurnGrant,
  traceId: string,
  body: ReadableStream<Uint8Array>,
  releaseInUse?: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const release = releaseInUse ?? createInUseRelease(grant, traceId);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controller.close();
        } else {
          touchGrantInUse(grant);
          controller.enqueue(value);
        }
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason);
    },
  });
}

/** Shared admission for the paid STT and photo-extraction routes. Unknown traces
 * must receive a fresh persisted balance; a cached grant alone is not enough. */
export function authorizePaidCreditTrace(
  request: Request,
  actor: SpendActor,
  balance: Pick<PeriodBalance, "remainingMillicents" | "remainingPct"> | null,
  planId: string,
): { actor: SpendActor; grant: TurnGrant | null; remainingPct: number | null } | Response {
  const grant = getTurnGrant(actor.userId);
  if (grant && grant.skipGates !== actor.skipGates) return billingResponse("no_grant", 0);
  if (actor.skipGates) {
    return { actor, grant, remainingPct: null };
  }
  const traceId = readTraceIdHeader(request.headers.get(HEYTUTOR_TRACE_ID_HEADER));
  if (traceId && grant?.allowedTraceIds.has(traceId)) {
    if (!actor.skipGates && grant.usdMillicentsRemaining <= 0) return billingResponse("out_of_credits", 0);
    return { actor, grant, remainingPct: null };
  }
  if (grant && grant.usdMillicentsRemaining <= 0) return billingResponse("out_of_credits", 0);
  if (!balance) return billingResponse("no_grant", 0);
  const remainingPct = balance.remainingPct;
  if (paidCallAccess({ remainingMillicents: balance.remainingMillicents, grant: null }) !== "allow") {
    return billingResponse("out_of_credits", remainingPct);
  }
  const recovered = recoverGrantForPaidCall({
    userId: actor.userId,
    traceId: traceId ?? randomUUID(),
    remainingMillicents: balance.remainingMillicents,
    planId,
    skipAutumn: actor.skipAutumn,
    skipGates: false,
  });
  if (!recovered) return billingResponse("no_grant", remainingPct);
  return { actor, grant: recovered, remainingPct };
}

export async function requireLessonCredits(
  request: Request,
): Promise<{ actor: SpendActor; grant: TurnGrant | null; remainingPct: number | null } | Response> {
  const authorized = await requireLessonGrant(request);
  return authorized instanceof Response ? authorized : { ...authorized, remainingPct: null };
}

export async function requireNotesAccess(
  request: Request,
): Promise<{ actor: SpendActor; remaining: number | null; release?: () => Promise<void> } | Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  if (!actor.skipGates && usesRazorpay()) {
    const reservation = await reserveRazorpayNote(actor.userId);
    return reservation ? { actor, ...reservation } : billingResponse("notes_limit", 0);
  }
  if (actor.skipGates || actor.skipAutumn) {
    return { actor, remaining: null };
  }
  try {
    await ensureAutumnCustomer({ userId: actor.userId, email: actor.email });
    const checked = await checkFeature({
      userId: actor.userId,
      featureId: BILLING_FEATURES.notesMessages,
      requiredBalance: 1,
    });
    if (!checked.allowed) {
      return billingResponse("notes_limit", checked.remaining ?? 0);
    }
    return { actor, remaining: checked.remaining };
  } catch (error) {
    if (error instanceof AutumnUnavailableError) {
      return billingResponse("autumn_unavailable", null, error.message);
    }
    throw error;
  }
}

export { isSpendActor, requireSpendActor };
export type { SpendActor };
