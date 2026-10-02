import { randomUUID } from "node:crypto";
import type { BillingPurchase, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { billingPeriodKey } from "./ledgerMath";
import { includedUsdMillicents } from "./catalog";
import { PaymentError, razorpayTestMode, requireRazorpayConfig, razorpayCurrencyEnabled } from "./razorpayConfig";
import { type PurchasePlanId } from "./razorpayProtocol";
import { readPriceQuote } from "./priceQuote";
import { createRazorpayOrder, findRazorpayOrderByReceipt } from "./razorpayApi";

type Database = Pick<Prisma.TransactionClient, "billingPurchase">;
export interface RazorpayAccess {
  planId: "free" | "plus" | "pro";
  period: string;
  startsAt: Date;
  endsAt: Date;
  includedMillicents: number;
}

export async function loadRazorpayAccess(userId: string, db: Database = prisma, now = new Date()): Promise<RazorpayAccess> {
  const rows = await db.billingPurchase.findMany({
    where: { userId, testMode: razorpayTestMode(), status: "paid", planId: { in: ["plus", "pro"] }, accessStartsAt: { lte: now }, accessEndsAt: { gt: now } },
    orderBy: [{ accessStartsAt: "desc" }, { id: "asc" }],
  });
  const active = rows.find(row => row.planId === "pro") ?? rows.find(row => row.planId === "plus");
  if (active?.accessStartsAt && active.accessEndsAt) {
    return {
      planId: active.planId === "pro" ? "pro" : "plus", period: `razorpay:${active.id}`,
      startsAt: active.accessStartsAt, endsAt: active.accessEndsAt, includedMillicents: active.usageMillicents,
    };
  }
  return {
    planId: "free", period: `razorpay:${razorpayTestMode() ? "test" : "live"}:free:${billingPeriodKey(now.getTime())}`, includedMillicents: includedUsdMillicents("free"),
    startsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    endsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export async function lockRazorpayUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  // Persistent, cross-process lock shared by order creation and payment grants.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`razorpay:${userId}`}, 0))`;
}

const ORDER_RECOVERY_AFTER_MS = 15_000; // The initial provider call has a 12s bound.
const ORDER_PREPARATION_TIMEOUT_MS = 60_000;

export function purchasePreparationStatus(purchase: Pick<BillingPurchase, "orderId" | "status" | "createdAt">): string {
  if (purchase.orderId || purchase.status !== "pending") return purchase.status;
  return Date.now() - purchase.createdAt.getTime() >= ORDER_PREPARATION_TIMEOUT_MS ? "expired" : "preparing";
}

/** Recover an uncertain creation by receipt, never by retrying its POST. Fresh
 * rows remain in flight; missing old orders expose an explicit retryable expiry. */
export async function recoverRazorpayPurchaseOrder(purchase: BillingPurchase): Promise<BillingPurchase> {
  if (purchase.orderId || purchase.status !== "pending" || Date.now() - purchase.createdAt.getTime() < ORDER_RECOVERY_AFTER_MS) return purchase;
  const config = requireRazorpayConfig();
  if (purchase.keyId !== config.keyId || purchase.testMode !== config.testMode) throw new PaymentError("payments_unavailable");
  const { currency, amount } = purchase;
  if ((currency !== "USD" && currency !== "INR") || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new PaymentError("payments_unavailable");
  }
  const orderId = await findRazorpayOrderByReceipt({ currency, amount }, purchase.id);
  if (orderId) {
    await prisma.billingPurchase.updateMany({ where: { id: purchase.id, orderId: null, status: "pending" }, data: { orderId } });
  }
  return prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
}

export async function createRazorpayCheckout(userId: string, planId: PurchasePlanId, idempotencyKey: string, quote: unknown) {
  const config = requireRazorpayConfig();
  const offer = readPriceQuote(quote, planId, config.keySecret);
  if (!razorpayCurrencyEnabled(offer.currency)) throw new PaymentError("payments_unavailable");
  const prepared = await prisma.$transaction(async tx => {
    await lockRazorpayUser(tx, userId);
    const existing = await tx.billingPurchase.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) {
      if (existing.planId !== planId || existing.keyId !== config.keyId || existing.currency !== offer.currency || existing.amount !== offer.amount || existing.status !== "pending") throw new PaymentError("checkout_conflict", 409);
      return { purchase: existing, created: false };
    }
    const recent = await tx.billingPurchase.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 60_000) } } });
    if (recent >= 5) throw new PaymentError("rate_limited", 429);
    const purchase = await tx.billingPurchase.create({ data: {
      id: randomUUID(), userId, idempotencyKey, ...offer, keyId: config.keyId, testMode: config.testMode,
    } });
    return { purchase, created: true };
  });
  let { purchase } = prepared;
  if (prepared.created) {
    // Never blindly retry a POST: an upstream timeout may already have created it.
    const orderId = await createRazorpayOrder(offer, purchase.id);
    purchase = await prisma.billingPurchase.update({ where: { id: purchase.id }, data: { orderId } });
  } else if (!purchase.orderId) purchase = await recoverRazorpayPurchaseOrder(purchase);
  if (!purchase.orderId) {
    const expired = purchasePreparationStatus(purchase) === "expired";
    throw new PaymentError(expired ? "checkout_expired" : "checkout_preparing", expired ? 410 : 409);
  }
  if (purchase.status !== "pending") throw new PaymentError("checkout_conflict", 409);
  return {
    provider: "razorpay" as const, purchaseId: purchase.id, keyId: purchase.keyId, orderId: purchase.orderId,
    amount: purchase.amount, currency: purchase.currency, planId: purchase.planId, testMode: purchase.testMode,
  };
}
