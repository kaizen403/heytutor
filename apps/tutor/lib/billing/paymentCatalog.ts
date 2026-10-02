export type CheckoutCurrency = "USD" | "INR";
export interface CheckoutPrice { amount: number; currency: string; quote?: string | null }
export interface PaymentCatalog {
  provider: "razorpay" | "autumn";
  available: boolean;
  testMode: boolean;
  currency: CheckoutCurrency;
  fxDate: string | null;
  unavailableReason: string | null;
  plans: Record<"plus" | "lesson_top_up", CheckoutPrice | null>;
}

export function formatCheckoutPrice(price: CheckoutPrice): string {
  return new Intl.NumberFormat(price.currency === "INR" ? "en-IN" : "en-US", {
    style: "currency", currency: price.currency, maximumFractionDigits: price.amount % 100 ? 2 : 0,
  }).format(price.amount / 100);
}
