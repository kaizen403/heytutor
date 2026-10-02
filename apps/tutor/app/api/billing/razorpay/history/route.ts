import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
import { isSpendActor, requireSpendActor } from "@/lib/billing/actor";
import { razorpayTestMode, usesRazorpay } from "@/lib/billing/razorpayConfig";
import { purchasePreparationStatus } from "@/lib/billing/razorpayPurchases";

export async function GET(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  if (!usesRazorpay()) return Response.json({ purchases: [] });
  const where = { userId: actor.userId, testMode: razorpayTestMode() };
  const select = { id: true, planId: true, amount: true, currency: true, status: true, orderId: true, refundAmount: true, createdAt: true, accessStartsAt: true, accessEndsAt: true } satisfies Prisma.BillingPurchaseSelect;
  // Unsuccessful preparation attempts cannot displace payment receipts.
  const [completed, pending] = await prisma.$transaction([
    prisma.billingPurchase.findMany({
      where: { ...where, status: { in: ["paid", "refunded"] } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 30, select,
    }),
    prisma.billingPurchase.findMany({
      where: { ...where, status: "pending" },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 10, select,
    }),
  ], { isolationLevel: "RepeatableRead" });
  const purchases = [...completed, ...pending].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id));
  return Response.json({ purchases: purchases.map(({ orderId, ...purchase }) => ({ ...purchase, status: purchasePreparationStatus({ ...purchase, orderId }) })) }, { headers: { "cache-control": "no-store" } });
}
