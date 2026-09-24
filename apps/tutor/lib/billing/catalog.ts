/** Accelute billing catalog. Keep in sync with `autumn.config.ts`. */

export const BILLING_FEATURES = {
  lessons: "lessons",
  notesMessages: "notes_messages",
  ttsChars: "tts_chars",
  llmTokens: "llm_tokens",
} as const;

export type BillingFeatureId = (typeof BILLING_FEATURES)[keyof typeof BILLING_FEATURES];

export const BILLING_PLANS = {
  free: "free",
  plus: "plus",
  pro: "pro",
  lessonTopUp: "lesson_top_up",
} as const;

export type BillingPlanId = (typeof BILLING_PLANS)[keyof typeof BILLING_PLANS];

export const GRANT_TTL_MS = 20 * 60 * 1000;
export const TTS_CHARS_PER_LESSON = 12_000;
export const MAX_IN_FLIGHT_LESSONS = 1;
export const MAX_NEW_QUESTIONS_PER_HOUR = 3;
export const TOP_UP_USD = 10;
export const TOP_UP_EXPIRY_MONTHS = 12;
export const MILLICENTS_PER_USD = 1000;

export interface PlanCatalogEntry {
  planId: BillingPlanId;
  name: string;
  priceUsdPerMonth: number | null;
  includedUsdPerMonth: number;
  notesMessagesPerMonth: number;
}

export const PLAN_CATALOG: Record<"free" | "plus" | "pro", PlanCatalogEntry> = {
  free: {
    planId: BILLING_PLANS.free,
    name: "Free",
    priceUsdPerMonth: 0,
    includedUsdPerMonth: 3.5,
    notesMessagesPerMonth: 30,
  },
  plus: {
    planId: BILLING_PLANS.plus,
    name: "Plus",
    priceUsdPerMonth: 19,
    includedUsdPerMonth: 12,
    notesMessagesPerMonth: 200,
  },
  pro: {
    planId: BILLING_PLANS.pro,
    name: "Pro",
    priceUsdPerMonth: 39,
    includedUsdPerMonth: 24,
    notesMessagesPerMonth: 500,
  },
};

export function isKnownPlanId(value: string | null | undefined): value is "free" | "plus" | "pro" {
  return value === "free" || value === "plus" || value === "pro";
}

export function planCatalogEntry(planId: string | null | undefined): PlanCatalogEntry {
  return isKnownPlanId(planId) ? PLAN_CATALOG[planId] : PLAN_CATALOG.free;
}

export function includedUsdMillicents(planId: string | null | undefined): number {
  return usdToMillicents(planCatalogEntry(planId).includedUsdPerMonth);
}

export function usdToMillicents(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * MILLICENTS_PER_USD);
}

/** Inverse of `usdToMillicents`. The ledger stores thousandths of a dollar. */
export function millicentsToUsd(millicents: number): number {
  if (!Number.isFinite(millicents) || millicents === 0) return 0;
  return millicents / MILLICENTS_PER_USD;
}

export const CHECKOUT_PLAN_IDS = [BILLING_PLANS.plus, BILLING_PLANS.pro] as const;
export type CheckoutPlanId = (typeof CHECKOUT_PLAN_IDS)[number];

export function isCheckoutPlanId(value: string | null | undefined): value is CheckoutPlanId {
  return value === BILLING_PLANS.plus || value === BILLING_PLANS.pro;
}
