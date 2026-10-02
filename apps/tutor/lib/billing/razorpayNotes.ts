import { prisma } from "../db/prisma";
import { PLAN_CATALOG } from "./catalog";
import { loadRazorpayAccess, lockRazorpayUser } from "./razorpayPurchases";

export async function reserveRazorpayNote(userId: string) {
  return prisma.$transaction(async tx => {
    await lockRazorpayUser(tx, userId);
    const access = await loadRazorpayAccess(userId, tx);
    const limit = PLAN_CATALOG[access.planId].notesMessagesPerMonth;
    const key = { userId, period: access.period };
    await tx.billingPeriodSpend.upsert({ where: { userId_period: key }, create: key, update: {} });
    const reserved = await tx.billingPeriodSpend.updateMany({ where: { ...key, notesMessages: { lt: limit } }, data: { notesMessages: { increment: 1 } } });
    if (!reserved.count) return null;
    const row = await tx.billingPeriodSpend.findUniqueOrThrow({ where: { userId_period: key } });
    let released = false;
    return {
      remaining: limit - row.notesMessages,
      release: async () => {
        if (released) return;
        released = true;
        await prisma.billingPeriodSpend.updateMany({ where: { ...key, notesMessages: { gt: 0 } }, data: { notesMessages: { decrement: 1 } } });
      },
    };
  });
}
