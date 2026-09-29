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
  type TurnGrant,
  type TurnKind,
} from "./grant";
import { cacheUsageOnUser, loadPeriodBalance, type PeriodBalance } from "./ledger";
import { isSpendActor, requireSpendActor, type SpendActor } from "./actor";
import { beginTurnAccess, paidCallAccess } from "./usageGate";

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
  beginTurnLocks.set(
    userId,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
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
  if (!input.traceId) {
    return billingResponse("no_grant", 0, "traceId is required");
  }

  return withUserLock(actor.userId, () => beginTurnLocked(actor, input));
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
    body = (await request.json()) as typeof body;
  } catch {
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
    return { actor, grant };
  }

  if (getTurnGrant(actor.userId)?.skipGates) return billingResponse("no_grant", 0);
  const traceId = readTraceIdHeader(request.headers.get(HEYTUTOR_TRACE_ID_HEADER));
  const matched = requireGrantForTrace(actor.userId, traceId);
  if (matched.ok) {
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
  const recovered = recoverGrantForPaidCall({
    userId: actor.userId,
    traceId: traceId ?? `recovered-${actor.userId}`,
    remainingMillicents: balance.remainingMillicents,
    planId,
    skipAutumn: actor.skipAutumn,
    skipGates: actor.skipGates,
  });
  if (!recovered) {
    return billingResponse("no_grant", remainingPct);
  }
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

/** Keep a chat grant busy through the streamed body, not just until response headers. */
export function holdGrantUntilStreamEnds(
  grant: TurnGrant,
  traceId: string,
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    markGrantInUse(grant, -1, traceId);
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controller.close();
        } else {
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
    traceId: traceId ?? `recovered-${actor.userId}`,
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
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  if (actor.skipGates) return authorizePaidCreditTrace(request, actor, null, BILLING_PLANS.pro);
  const grant = getTurnGrant(actor.userId);
  if (grant?.skipGates) return billingResponse("no_grant", 0);
  const traceId = readTraceIdHeader(request.headers.get(HEYTUTOR_TRACE_ID_HEADER));
  if (traceId && grant?.allowedTraceIds.has(traceId)) {
    return authorizePaidCreditTrace(request, actor, null, grant.planId);
  }
  if (grant && grant.usdMillicentsRemaining <= 0) return billingResponse("out_of_credits", 0);
  const planIdOrError = await resolvePlanId(actor);
  if (planIdOrError instanceof Response) return planIdOrError;
  const planId = planIdOrError;
  const balance = await loadPeriodBalance({ userId: actor.userId, planId });
  return authorizePaidCreditTrace(request, actor, balance, planId);
}

export async function requireNotesAccess(
  request: Request,
): Promise<{ actor: SpendActor; remaining: number | null } | Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
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
