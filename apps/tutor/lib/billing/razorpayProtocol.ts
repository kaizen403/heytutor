import { createHmac, timingSafeEqual } from "node:crypto";
import { PLAN_CATALOG, TOP_UP_USD, usdToMillicents, type CheckoutPlanId } from "./catalog";

export type PurchasePlanId = CheckoutPlanId | "lesson_top_up";
export type PaymentCurrency = "USD" | "INR";
export interface PaymentOffer {
  planId: PurchasePlanId;
  amount: number;
  currency: PaymentCurrency;
  usageMillicents: number;
}

export function razorpayOffer(planId: PurchasePlanId): PaymentOffer {
  if (planId !== "plus" && planId !== "lesson_top_up") throw new Error("Unsupported checkout plan");
  const amount = (planId === "lesson_top_up" ? TOP_UP_USD : PLAN_CATALOG[planId].priceUsdPerMonth!) * 100;
  return {
    planId, amount, currency: "USD",
    usageMillicents: usdToMillicents(planId === "lesson_top_up" ? TOP_UP_USD : PLAN_CATALOG[planId].includedUsdPerMonth),
  };
}

function verifyHmac(payload: string, signature: string, secret: string): boolean {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  return verifyHmac(`${orderId}|${paymentId}`, signature, secret);
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  return verifyHmac(rawBody, signature, secret);
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
  amount_refunded: number;
}

export function isProviderId(value: unknown, prefix: "order" | "pay"): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]{1,64}$`).test(value);
}

export function readPayment(value: unknown): RazorpayPayment {
  if (!value || typeof value !== "object") throw new Error("Invalid payment response");
  const row = value as Record<string, unknown>;
  if (!isProviderId(row.id, "pay") || !isProviderId(row.order_id, "order") ||
      typeof row.amount !== "number" || !Number.isSafeInteger(row.amount) || row.amount <= 0 ||
      typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency) ||
      typeof row.status !== "string" || typeof row.captured !== "boolean" ||
      typeof row.amount_refunded !== "number" || !Number.isSafeInteger(row.amount_refunded) ||
      row.amount_refunded < 0 || row.amount_refunded > row.amount) {
    throw new Error("Invalid payment response");
  }
  return {
    id: row.id, order_id: row.order_id, amount: row.amount, currency: row.currency,
    status: row.status, captured: row.captured, amount_refunded: row.amount_refunded,
  };
}

/** UTC month, clamped for the 29th–31st rather than overflowing into March. */
export function addBillingMonth(start: Date): Date {
  const end = new Date(start);
  const day = start.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}
