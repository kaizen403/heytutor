import { prisma } from "@/lib/db/prisma";
import { isSpendActor, requireSpendActor } from "@/lib/billing/actor";
import { razorpayTestMode, usesRazorpay } from "@/lib/billing/razorpayConfig";
import { purchasePreparationStatus } from "@/lib/billing/razorpayPurchases";

export async function GET(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  if (!usesRazorpay()) return Response.json({ purchases: [] });
  const purchases = await prisma.billingPurchase.findMany({
    where: { userId: actor.userId, testMode: razorpayTestMode() },
    orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, planId: true, amount: true, currency: true, status: true, orderId: true, refundAmount: true, createdAt: true, accessStartsAt: true, accessEndsAt: true },
  });
  return Response.json({ purchases: purchases.map(({ orderId, ...purchase }) => ({ ...purchase, status: purchasePreparationStatus({ ...purchase, orderId }) })) }, { headers: { "cache-control": "no-store" } });
}
