import { prisma } from "../db/prisma";
import { BILLING_PLANS, TOP_UP_USD, isKnownPlanId, usdToMillicents } from "./catalog";
import { billingPeriodKey } from "./ledgerMath";

/** The event receipt and resulting allowance commit together or both roll back. */
export async function applyAutumnWebhookEvent(input: { eventId: string; userId: string; planId: string }): Promise<void> {
  await prisma.$transaction(async tx => {
    const recorded = await tx.billingWebhookEvent.createMany({
      data: [{ provider: "autumn", eventId: input.eventId, userId: input.userId }],
      skipDuplicates: true,
    });
    if (recorded.count === 0) return;
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { planId: true } });
    if (!user) return;
    if (input.planId === BILLING_PLANS.lessonTopUp) {
      const period = billingPeriodKey();
      const bonusMillicents = usdToMillicents(TOP_UP_USD);
      await tx.billingPeriodSpend.upsert({
        where: { userId_period: { userId: input.userId, period } },
        create: { userId: input.userId, period, bonusMillicents },
        update: { bonusMillicents: { increment: bonusMillicents } },
      });
      return;
    }
    if (isKnownPlanId(input.planId)) {
      await tx.user.updateMany({ where: { id: input.userId }, data: { planId: input.planId } });
    }
  });
}
