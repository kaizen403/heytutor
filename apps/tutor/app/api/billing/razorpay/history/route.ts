import { prisma } from "@/lib/db/prisma";
import { isSpendActor, requireSpendActor } from "@/lib/billing/actor";
import { razorpayTestMode, usesRazorpay } from "@/lib/billing/razorpayConfig";

export async function GET(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  if (!usesRazorpay()) return Response.json({ purchases: [] });
  const purchases = await prisma.billingPurchase.findMany({
    where: { userId: actor.userId, testMode: razorpayTestMode(), orderId: { not: null } },
    orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, planId: true, amount: true, currency: true, status: true, refundAmount: true, createdAt: true, accessStartsAt: true, accessEndsAt: true },
  });
  return Response.json({ purchases }, { headers: { "cache-control": "no-store" } });
}
