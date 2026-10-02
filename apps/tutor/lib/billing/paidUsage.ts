import { randomUUID } from "node:crypto";
import { calculateLlmCostDetails, type UsageCounts } from "../obs/usageCost";
import { billingResponse } from "./errors";
import type { SpendActor } from "./actor";
import { acquirePaidCall, getTurnGrant, syncGrantUsdRemaining, type PaidCallKind, type TurnGrant, PAID_CALL_LIMITS } from "./grant";
import { reservePeriodUsage, settlePeriodUsage, loadPeriodBalance } from "./ledger";
import { prisma } from "../db/prisma";
import { BILLING_PLANS, isKnownPlanId } from "./catalog";

export interface PaidUsageReservation {
  settle(actualUsd?: number): Promise<void>;
  finish(): Promise<void>;
  cancelBeforeDispatch(): Promise<void>;
}

/** Durable precharge plus finite admission. Only definitely undispatched work
 * may get a full refund. Cancellation/unknown vendor usage keeps the cap. */
export async function reservePaidUsage(input: {
  actor: SpendActor;
  grant?: TurnGrant | null;
  kind: PaidCallKind;
  traceId?: string;
  usd: number;
}): Promise<PaidUsageReservation | Response> {
  const grant = input.grant ?? getTurnGrant(input.actor.userId);
  const acquired = grant ? acquirePaidCall(grant, input.kind, input.traceId) : { release: () => {} };
  if (!acquired) return billingResponse("concurrent_limit", null);
  // This helper is called only for configured, real providers. A missing LLM
  // key must not make an independently configured speech provider free.
  const bypass = input.actor.skipGates;
  const millicents = Math.max(1, Math.ceil(input.usd * 1000));
  if (!Number.isSafeInteger(millicents) || millicents > 100_000) { acquired.release(); return billingResponse("out_of_credits", 0); }
  let receipt: Awaited<ReturnType<typeof reservePeriodUsage>> = null;
  try {
    // Ancillary work (notes and suggestions) can start without a lesson grant.
    // Its allowance still comes from the authenticated account's server state.
    let planId = grant?.planId;
    if (!bypass && !planId) {
      const user = await prisma.user.findUnique({ where: { id: input.actor.userId }, select: { planId: true } });
      if (!user) { acquired.release(); return Response.json({ error: "unauthorized" }, { status: 401 }); }
      planId = isKnownPlanId(user.planId) ? user.planId : BILLING_PLANS.free;
    }
    if (!bypass) receipt = await reservePeriodUsage({
      userId: input.actor.userId, planId: planId ?? BILLING_PLANS.free,
      traceId: input.traceId ?? grant?.lessonTraceId ?? randomUUID(),
      kind: input.kind, millicents, maxCalls: PAID_CALL_LIMITS[input.kind],
    });
    if (!bypass && !receipt) { acquired.release(); return billingResponse("out_of_credits", 0); }
    if (receipt) syncGrantUsdRemaining(input.actor.userId, receipt.remainingMillicents);
  } catch (error) {
    acquired.release();
    console.error("[billing] paid reservation failed", error);
    return Response.json({ error: "Usage service is temporarily unavailable." }, { status: 503 });
  }
  let finished = false;
  const settle = async (usd?: number) => {
    if (finished) return;
    finished = true;
    try {
      if (receipt) await settlePeriodUsage({
        userId: input.actor.userId, reservationId: receipt.id,
        actualMillicents: usd === undefined ? undefined : Math.max(usd > 0 ? 1 : 0, Math.ceil(usd * 1000)),
      });
      if (receipt) {
        const balance = await loadPeriodBalance({ userId: input.actor.userId, planId: receipt.planId });
        syncGrantUsdRemaining(input.actor.userId, balance.remainingMillicents);
      }
    } finally { acquired.release(); }
  };
  return { settle, finish: () => settle(), cancelBeforeDispatch: () => settle(0) };
}

/** Text-only input upper bound: at most one token per UTF-8 byte plus protocol
 * overhead. Models/output lengths are exclusively server-selected. */
export function maximumLlmCost(messages: unknown, maxTokens: number, models: readonly string[], attempts = 1): number {
  const input = new TextEncoder().encode(JSON.stringify(messages)).length + 2048;
  return Math.max(...models.map(model => calculateLlmCostDetails({ input, output: maxTokens }, { model }).total ?? 0)) * attempts;
}

export function actualLlmCost(usage: UsageCounts | undefined, model: string): number | undefined {
  if (!usage || typeof usage.input !== "number" || !Number.isFinite(usage.input) || usage.input < 0 ||
    typeof usage.output !== "number" || !Number.isFinite(usage.output) || usage.output < 0) return undefined;
  return calculateLlmCostDetails(usage, { model }).total;
}

/** Release receipt admission for every stream exit, including cancellation.
 * Accounting is already durable when the stream is created. */
export function holdPaidUsage(body: ReadableStream<Uint8Array>, reservation: PaidUsageReservation, unknownCost?: () => number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) { await reservation.settle(unknownCost?.()); controller.close(); }
        else controller.enqueue(chunk.value);
      } catch (error) { await reservation.settle(unknownCost?.()); controller.error(error); }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } finally { await reservation.settle(unknownCost?.()); }
    },
  });
}
