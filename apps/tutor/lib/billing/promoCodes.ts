import type { PaymentOffer, PurchasePlanId } from "./razorpayProtocol";

export interface PromoCode {
  code: string;
  percentOff: number;
  /** Credits sell at the usage they buy, so a discount there sells below cost. */
  plans: readonly PurchasePlanId[];
  /** ISO instant; null never expires. */
  expiresAt: string | null;
}

const PROMO_CODES: Record<string, PromoCode> = {
  // Product Hunt launch, 15 Oct 2026.
  PH50: { code: "PH50", percentOff: 50, plans: ["plus"], expiresAt: null },
};

export function normalizePromoCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{2,32}$/.test(code) ? code : null;
}

export function findPromoCode(value: unknown, now = Date.now()): PromoCode | null {
  const code = normalizePromoCode(value);
  if (!code || !Object.hasOwn(PROMO_CODES, code)) return null;
  const promo = PROMO_CODES[code];
  return promo.expiresAt && Date.parse(promo.expiresAt) <= now ? null : promo;
}

/** Discounts the charged amount only; the usage a purchase grants is unchanged. */
export function applyPromoCode(offer: PaymentOffer, promo: PromoCode | null): PaymentOffer {
  if (!promo || !promo.plans.includes(offer.planId)) return offer;
  return { ...offer, amount: Math.round(offer.amount * (100 - promo.percentOff) / 100), promoCode: promo.code };
}
