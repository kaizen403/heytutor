import { prisma } from "../db/prisma";
import { PaymentError, razorpayTestMode } from "./razorpayConfig";
import { addBillingMonth, type RazorpayPayment } from "./razorpayProtocol";
import { fetchRazorpayOrderPayments } from "./razorpayApi";
import { loadRazorpayAccess, lockRazorpayUser } from "./razorpayPurchases";
import { loadRazorpayBalance } from "./razorpayBalance";
import { getTurnGrant, releaseTurnGrant } from "./grant";

/** The callback and every webhook converge here. Price + ownership are local;
 * payment status is fetched from Razorpay by the caller, never supplied by a browser. */
export async function applyRazorpayPayment(payment: RazorpayPayment): Promise<string | null> {
  const found = await prisma.billingPurchase.findUnique({ where: { orderId: payment.order_id } });
  if (!found) return null; // Other products on the same merchant account.
  const result = await prisma.$transaction(async tx => {
    await lockRazorpayUser(tx, found.userId);
    const purchase = await tx.billingPurchase.findUniqueOrThrow({ where: { id: found.id } });
    if (purchase.testMode !== razorpayTestMode() || purchase.amount !== payment.amount || purchase.currency !== payment.currency ||
        (purchase.paymentId && purchase.paymentId !== payment.id)) throw new PaymentError("invalid_payment", 400);
    if (!payment.captured || !["captured", "refunded"].includes(payment.status)) throw new PaymentError("payment_pending", 202);
    const refunded = Math.max(purchase.refundAmount, payment.amount_refunded);
    const fullyRefunded = refunded === purchase.amount;
    const now = new Date();
    let grantedPeriod = purchase.grantedPeriod;
    let accessStartsAt = purchase.accessStartsAt;
    let accessEndsAt = purchase.accessEndsAt;
    if (purchase.status === "pending" && !fullyRefunded) {
      if (purchase.planId === "lesson_top_up") {
        const access = await loadRazorpayAccess(purchase.userId, tx, now);
        grantedPeriod = access.period;
        accessStartsAt = now;
        accessEndsAt = access.endsAt;
      } else {
        // Same-plan renewals queue a full month. A lower plan bought while Pro
        // is active starts after Pro; upgrades to Pro start immediately.
        const reserved = await tx.billingPurchase.findFirst({
          where: {
            userId: purchase.userId, testMode: purchase.testMode, status: "paid", accessEndsAt: { gt: now },
            planId: { in: purchase.planId === "pro" ? ["pro"] : ["plus", "pro"] },
          }, orderBy: { accessEndsAt: "desc" },
        });
        accessStartsAt = reserved?.accessEndsAt ?? now;
        accessEndsAt = addBillingMonth(accessStartsAt);
        grantedPeriod = `razorpay:${purchase.id}`;
      }
    }
    await tx.billingPurchase.update({ where: { id: purchase.id }, data: {
      paymentId: payment.id, status: fullyRefunded ? "refunded" : "paid", refundAmount: refunded,
      grantedPeriod, accessStartsAt, accessEndsAt,
    } });
    if (fullyRefunded && purchase.status === "paid" && purchase.accessStartsAt && purchase.accessEndsAt && purchase.planId !== "lesson_top_up") {
      const queued = await tx.billingPurchase.findMany({
        where: { userId: purchase.userId, testMode: purchase.testMode, status: "paid", planId: { in: ["plus", "pro"] }, accessStartsAt: { gte: purchase.accessEndsAt, gt: now } },
        orderBy: [{ accessStartsAt: "asc" }, { id: "asc" }],
      });
      let originalEnd = purchase.accessEndsAt;
      let nextStart = new Date(Math.max(now.getTime(), purchase.accessStartsAt.getTime()));
      if (purchase.planId === "plus") {
        const pro = await tx.billingPurchase.findFirst({ where: { userId: purchase.userId, testMode: purchase.testMode, status: "paid", planId: "pro", accessEndsAt: { gt: now } }, orderBy: { accessEndsAt: "desc" } });
        if (pro?.accessEndsAt && pro.accessEndsAt > nextStart) nextStart = pro.accessEndsAt;
      }
      for (const renewal of queued) {
        if (!renewal.accessStartsAt || !renewal.accessEndsAt || renewal.accessStartsAt.getTime() !== originalEnd.getTime()) break;
        const nextEnd = addBillingMonth(nextStart);
        await tx.billingPurchase.update({ where: { id: renewal.id }, data: { accessStartsAt: nextStart, accessEndsAt: nextEnd } });
        originalEnd = renewal.accessEndsAt;
        nextStart = nextEnd;
      }
    }
    return { id: purchase.id, revoke: refunded > purchase.refundAmount, activated: purchase.status === "pending" && !fullyRefunded };
  });
  if (result.revoke) {
    const grant = getTurnGrant(found.userId);
    // Existing WS jobs retain this object even after it leaves the map.
    if (grant && !grant.skipGates) { grant.usdMillicentsRemaining = 0; grant.ttsCharsRemaining = 0; }
    releaseTurnGrant(found.userId);
  }
  if (result.activated) {
    const grant = getTurnGrant(found.userId);
    if (grant && !grant.skipGates) {
      const balance = await loadRazorpayBalance(found.userId);
      // A refund can revoke this retained WS object while the read is in flight.
      if (getTurnGrant(found.userId) === grant) {
        grant.planId = balance.planId;
        grant.usdMillicentsRemaining = balance.remainingMillicents;
        grant.billingExpiresAt = balance.nextResetAt;
      }
    }
  }
  return result.id;
}

export async function reconcileRazorpayPurchase(userId: string, purchaseId: string) {
  const purchase = await prisma.billingPurchase.findFirst({ where: { id: purchaseId, userId, testMode: razorpayTestMode() } });
  if (!purchase) throw new PaymentError("purchase_not_found", 404);
  if (purchase.orderId) {
    const payments = await fetchRazorpayOrderPayments(purchase.orderId);
    const captured = payments.find(row => row.captured && ["captured", "refunded"].includes(row.status));
    if (captured) await applyRazorpayPayment(captured);
  }
  const updated = await prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
  return { purchaseId, status: updated.status, planId: updated.planId };
}
