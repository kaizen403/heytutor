import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentError } from "./razorpayConfig";
import { type PaymentOffer, type PurchasePlanId } from "./razorpayProtocol";

const TTL_MS = 30 * 60_000;
function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`checkout-price:v1:${payload}`).digest();
}
export function createPriceQuote(offer: PaymentOffer, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...offer, expiresAt: now + TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("hex")}`;
}
export function readPriceQuote(token: unknown, planId: PurchasePlanId, secret: string, now = Date.now()): PaymentOffer {
  if (typeof token !== "string" || token.length > 2048) throw new PaymentError("price_changed", 409);
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(sign(payload, secret), Buffer.from(signature, "hex"))) throw new PaymentError("invalid_quote", 400);
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as PaymentOffer & { expiresAt: number };
    if (value.planId !== planId || !["plus", "lesson_top_up"].includes(planId) || !["INR", "USD"].includes(value.currency) ||
        !Number.isSafeInteger(value.amount) || value.amount < 100 || value.amount > 100_000_000 ||
        !Number.isSafeInteger(value.usageMillicents) || value.usageMillicents < 0 ||
        !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + TTL_MS) throw new Error();
    return { planId, amount: value.amount, currency: value.currency, usageMillicents: value.usageMillicents };
  } catch { throw new PaymentError("price_changed", 409); }
}
