export type CheckoutCurrency = "USD" | "INR";
export interface CheckoutPrice {
  amount: number;
  currency: string;
  quote?: string | null;
  /** The price before a promo code, present only when one discounted `amount`. */
  fullAmount?: number;
}
/** Echo of a requested promo code: null percentOff means the code was not accepted. */
export interface CatalogPromo { code: string; percentOff: number | null }
export interface PaymentCatalog {
  provider: "razorpay" | "autumn";
  available: boolean;
  testMode: boolean;
  currency: CheckoutCurrency;
  fxDate: string | null;
  unavailableReason: string | null;
  plans: Record<"plus" | "lesson_top_up", CheckoutPrice | null>;
  promo: CatalogPromo | null;
}

export function formatCheckoutPrice(price: CheckoutPrice): string {
  return new Intl.NumberFormat(price.currency === "INR" ? "en-IN" : "en-US", {
    style: "currency", currency: price.currency, maximumFractionDigits: price.amount % 100 ? 2 : 0,
  }).format(price.amount / 100);
}

/** How a typed promo code travels, shared by the page and the catalog route. */
export function promoCodeInput(value: string | null | undefined): string | null {
  return value?.trim().toUpperCase().slice(0, 32) || null;
}
