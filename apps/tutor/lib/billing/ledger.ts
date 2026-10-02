import { prisma } from "@/lib/db/prisma";
import { randomUUID } from "node:crypto";
import { BILLING_PLANS, isKnownPlanId, usdToMillicents } from "./catalog";
import { usesRazorpay } from "./razorpayConfig";
import { loadRazorpayBalance, spendRazorpayBalance } from "./razorpayBalance";
import { lockRazorpayUser } from "./razorpayPurchases";
import { razorpayTestMode } from "./razorpayConfig";
import {
  balanceFromRow,
  billingPeriodKey,
  type PeriodBalance,
} from "./ledgerMath";

export {
  type PeriodBalance,
} from "./ledgerMath";

async function loadRow(userId: string, period: string): Promise<{
  spentMillicents: number;
  bonusMillicents: number;
}> {
  const row = await prisma.billingPeriodSpend.findUnique({
    where: { userId_period: { userId, period } },
    select: { spentMillicents: true, bonusMillicents: true },
  });
  return {
    spentMillicents: row?.spentMillicents ?? 0,
    bonusMillicents: row?.bonusMillicents ?? 0,
  };
}

export async function loadPeriodBalance(input: {
  userId: string;
  planId?: string | null;
}): Promise<PeriodBalance> {
  if (usesRazorpay()) return loadRazorpayBalance(input.userId);
  const context = { planId: input.planId ?? BILLING_PLANS.free, period: billingPeriodKey() };
  const row = await loadRow(input.userId, context.period);
  return balanceFromRow({ ...context, ...row });
}

export async function addPeriodSpend(input: {
  userId: string;
  planId?: string | null;
  usd: number;
}): Promise<PeriodBalance> {
  const millicents = usdToMillicents(input.usd);
  if (usesRazorpay()) return millicents > 0 ? spendRazorpayBalance(input.userId, millicents) : loadRazorpayBalance(input.userId);
  const context = { planId: input.planId ?? BILLING_PLANS.free, period: billingPeriodKey() };
  const { planId, period } = context;
  if (millicents <= 0) {
    return loadPeriodBalance({ userId: input.userId, planId });
  }
  const row = await prisma.billingPeriodSpend.upsert({
    where: { userId_period: { userId: input.userId, period } },
    create: {
      userId: input.userId,
      period,
      spentMillicents: millicents,
      bonusMillicents: 0,
    },
    update: {
      spentMillicents: { increment: millicents },
    },
    select: { spentMillicents: true, bonusMillicents: true },
  });
  return balanceFromRow({
    ...context,
    spentMillicents: row.spentMillicents,
    bonusMillicents: row.bonusMillicents,
  });
}

export async function addPeriodBonusUsd(input: {
  userId: string;
  planId?: string | null;
  usd: number;
}): Promise<PeriodBalance> {
  const millicents = usdToMillicents(input.usd);
  const planId = input.planId ?? BILLING_PLANS.free;
  const period = billingPeriodKey();
  if (millicents <= 0) {
    return loadPeriodBalance({ userId: input.userId, planId });
  }
  const row = await prisma.billingPeriodSpend.upsert({
    where: { userId_period: { userId: input.userId, period } },
    create: {
      userId: input.userId,
      period,
      spentMillicents: 0,
      bonusMillicents: millicents,
    },
    update: {
      bonusMillicents: { increment: millicents },
    },
    select: { spentMillicents: true, bonusMillicents: true },
  });
  return balanceFromRow({
    planId,
    period,
    spentMillicents: row.spentMillicents,
    bonusMillicents: row.bonusMillicents,
  });
}

export async function cacheUsageOnUser(input: {
  userId: string;
  planId: string;
  remainingPct: number | null;
}): Promise<void> {
  await prisma.user.updateMany({
    where: { id: input.userId },
    data: {
      planId: input.planId,
      remainingPct: input.remainingPct,
    },
  });
}

type UsageAllocation = { period: string; millicents: number } | { purchaseId: string; millicents: number };

/** A receipt and the spend it represents commit together before any vendor call.
 * The user row lock also serializes account erasure and concurrent admission. */
export async function reservePeriodUsage(input: {
  userId: string;
  planId: string;
  traceId?: string;
  kind: string;
  millicents: number;
  maxCalls: number;
}): Promise<{ id: string; amountMillicents: number; remainingMillicents: number; planId: string } | null> {
  if (!Number.isSafeInteger(input.millicents) || input.millicents <= 0) return null;
  return prisma.$transaction(async tx => {
    // Checkout and purchase updates take this lock before their user FK lock.
    // Keep the same order here so concurrent admission cannot form a cycle.
    if (usesRazorpay()) await lockRazorpayUser(tx, input.userId);
    const users = await tx.$queryRaw<{ id: string; planId: string }[]>`SELECT id, plan_id AS "planId" FROM users WHERE id = ${input.userId} FOR UPDATE`;
    if (!users.length) return null;
    const recentPending = await tx.paidUsageReservation.count({ where: {
      userId: input.userId, settledMillicents: null,
      kind: input.kind === "tts" ? "tts" : { not: "tts" },
      createdAt: { gt: new Date(Date.now() - 5 * 60_000) },
    } });
    if (recentPending >= (input.kind === "tts" ? 24 : 4)) return null;
    if (input.traceId && await tx.paidUsageReservation.count({ where: {
      userId: input.userId, traceId: input.traceId, kind: input.kind,
    } }) >= input.maxCalls) return null;

    const period = billingPeriodKey();
    const row = !usesRazorpay() ? await tx.billingPeriodSpend.findUnique({ where: { userId_period: { userId: input.userId, period } } }) : null;
    const balance = usesRazorpay()
      ? await loadRazorpayBalance(input.userId, tx)
      : balanceFromRow({ planId: isKnownPlanId(users[0]?.planId) ? users[0].planId : BILLING_PLANS.free, period, spentMillicents: row?.spentMillicents ?? 0, bonusMillicents: row?.bonusMillicents ?? 0 });
    if (balance.remainingMillicents < input.millicents) return null;

    const allocations: UsageAllocation[] = [];
    let remaining = input.millicents;
    if (usesRazorpay()) {
      const base = await tx.billingPeriodSpend.findUnique({ where: { userId_period: { userId: input.userId, period: balance.period } } });
      const included = Math.min(remaining, Math.max(0, balance.allowanceMillicents - balance.bonusMillicents - (base?.spentMillicents ?? 0)));
      if (included > 0) { allocations.push({ period: balance.period, millicents: included }); remaining -= included; }
      const topUps = await tx.billingPurchase.findMany({ where: {
        userId: input.userId, testMode: razorpayTestMode(), status: "paid", planId: "lesson_top_up", accessEndsAt: { gt: new Date() },
      }, orderBy: [{ accessEndsAt: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
      for (const purchase of topUps) {
        const allowance = purchase.usageMillicents - Math.floor(purchase.usageMillicents * purchase.refundAmount / purchase.amount);
        const amount = Math.min(remaining, Math.max(0, allowance - purchase.spentMillicents));
        if (amount > 0) {
          await tx.billingPurchase.update({ where: { id: purchase.id }, data: { spentMillicents: { increment: amount } } });
          allocations.push({ purchaseId: purchase.id, millicents: amount }); remaining -= amount;
        }
        if (!remaining) break;
      }
      if (remaining) throw new Error("Usage allocation changed during reservation");
    } else allocations.push({ period: balance.period, millicents: remaining });
    for (const allocation of allocations) {
      if (!("period" in allocation)) continue;
      const key = { userId: input.userId, period: allocation.period };
      await tx.billingPeriodSpend.upsert({ where: { userId_period: key }, create: { ...key, spentMillicents: allocation.millicents }, update: { spentMillicents: { increment: allocation.millicents } } });
    }
    const receipt = await tx.paidUsageReservation.create({ data: {
      id: randomUUID(), userId: input.userId, traceId: input.traceId, kind: input.kind,
      period: balance.period, planId: balance.planId, amountMillicents: input.millicents, allocations,
    } });
    return { id: receipt.id, amountMillicents: input.millicents, remainingMillicents: balance.remainingMillicents - input.millicents, planId: balance.planId };
  });
}

/** Refund only the original allocation, never a new month or purchase. Replays
 * have no effect; missing usage seals the already-charged cap. */
export async function settlePeriodUsage(input: { userId: string; reservationId: string; actualMillicents?: number }): Promise<void> {
  await prisma.$transaction(async tx => {
    if (usesRazorpay()) await lockRazorpayUser(tx, input.userId);
    const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
    if (!users.length) return;
    const receipt = await tx.paidUsageReservation.findFirst({ where: { id: input.reservationId, userId: input.userId } });
    if (!receipt || receipt.settledMillicents !== null) return;
    const actual = input.actualMillicents === undefined ? receipt.amountMillicents : input.actualMillicents;
    if (!Number.isSafeInteger(actual) || actual < 0 || actual > 2_147_483_647) throw new Error("Invalid usage reconciliation");
    // The precharge is a conservative bound, but a vendor can still report
    // unexpected actual spend. Record that debt in its original period; never
    // silently discard it or credit an unrelated current subscription.
    if (actual > receipt.amountMillicents) {
      const key = { userId: input.userId, period: receipt.period };
      const debt = actual - receipt.amountMillicents;
      await tx.billingPeriodSpend.upsert({
        where: { userId_period: key }, create: { ...key, spentMillicents: debt },
        update: { spentMillicents: { increment: debt } },
      });
    }
    let refund = Math.max(0, receipt.amountMillicents - actual);
    const allocations = receipt.allocations as UsageAllocation[];
    for (const allocation of [...allocations].reverse()) {
      const amount = Math.min(refund, allocation.millicents);
      if (!amount) continue;
      if ("period" in allocation) {
        await tx.billingPeriodSpend.updateMany({ where: { userId: input.userId, period: allocation.period, spentMillicents: { gte: amount } }, data: { spentMillicents: { decrement: amount } } });
      } else {
        await tx.billingPurchase.updateMany({ where: { id: allocation.purchaseId, userId: input.userId, spentMillicents: { gte: amount } }, data: { spentMillicents: { decrement: amount } } });
      }
      refund -= amount;
    }
    await tx.paidUsageReservation.update({ where: { id: receipt.id }, data: { settledMillicents: actual } });
  });
}
