import type { BillingPurchase, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { razorpayTestMode } from "./razorpayConfig";
import { loadRazorpayAccess, lockRazorpayUser } from "./razorpayPurchases";
import { balanceFromRow } from "./ledgerMath";

type Database = Pick<Prisma.TransactionClient, "billingPurchase" | "billingPeriodSpend">;

function topUpAllowance(purchase: BillingPurchase): number {
  return purchase.usageMillicents - Math.floor(purchase.usageMillicents * purchase.refundAmount / purchase.amount);
}

async function context(userId: string, db: Database) {
  const now = new Date();
  const access = await loadRazorpayAccess(userId, db, now);
  const [row, topUps] = await Promise.all([
    db.billingPeriodSpend.findUnique({ where: { userId_period: { userId, period: access.period } } }),
    db.billingPurchase.findMany({
      where: { userId, testMode: razorpayTestMode(), status: "paid", planId: "lesson_top_up", accessEndsAt: { gt: now } },
      orderBy: [{ accessEndsAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  return { access, baseSpent: row?.spentMillicents ?? 0, topUps };
}

export async function loadRazorpayBalance(userId: string, db: Database = prisma) {
  const { access, baseSpent, topUps } = await context(userId, db);
  const bonusMillicents = topUps.reduce((sum, row) => sum + topUpAllowance(row), 0);
  const topUpSpent = topUps.reduce((sum, row) => sum + Math.min(row.spentMillicents, topUpAllowance(row)), 0);
  return balanceFromRow({
    planId: access.planId, period: access.period, includedMillicents: access.includedMillicents,
    nextResetAt: access.endsAt.getTime(), spentMillicents: baseSpent + topUpSpent, bonusMillicents,
  });
}

/** Included usage is spent first, then portable top-ups in expiry order.
 * Top-up expiry stays at its original date when a student upgrades. */
export async function spendRazorpayBalance(userId: string, millicents: number) {
  return prisma.$transaction(async tx => {
    await lockRazorpayUser(tx, userId);
    const { access, baseSpent, topUps } = await context(userId, tx);
    let remaining = millicents;
    const includedSpend = Math.min(remaining, Math.max(0, access.includedMillicents - baseSpent));
    remaining -= includedSpend;
    for (const topUp of topUps) {
      const spend = Math.min(remaining, Math.max(0, topUpAllowance(topUp) - topUp.spentMillicents));
      if (spend > 0) await tx.billingPurchase.update({ where: { id: topUp.id }, data: { spentMillicents: { increment: spend } } });
      remaining -= spend;
      if (remaining === 0) break;
    }
    // Any already-incurred excess is debt in this period, never free usage.
    const baseIncrement = includedSpend + remaining;
    await tx.billingPeriodSpend.upsert({
      where: { userId_period: { userId, period: access.period } },
      create: { userId, period: access.period, spentMillicents: baseIncrement },
      update: { spentMillicents: { increment: baseIncrement } },
    });
    return loadRazorpayBalance(userId, tx);
  });
}
