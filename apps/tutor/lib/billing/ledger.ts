import { prisma } from "@/lib/db/prisma";
import { BILLING_PLANS, usdToMillicents } from "./catalog";
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
  const planId = input.planId ?? BILLING_PLANS.free;
  const period = billingPeriodKey();
  const row = await loadRow(input.userId, period);
  return balanceFromRow({ planId, period, ...row });
}

export async function addPeriodSpend(input: {
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
      spentMillicents: millicents,
      bonusMillicents: 0,
    },
    update: {
      spentMillicents: { increment: millicents },
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
