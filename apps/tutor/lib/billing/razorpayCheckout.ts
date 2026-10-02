import { resolveApiUrl } from "@heytutor/tutor-core";

export interface RazorpayCheckout {
  provider: "razorpay";
  purchaseId: string;
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  planId: string;
  testMode: boolean;
}
interface CheckoutResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
}
interface CheckoutOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  handler: (response: CheckoutResponse) => void;
  modal: { ondismiss: () => void; confirm_close: boolean };
  theme: { color: string };
}
declare global {
  interface Window { Razorpay?: new (options: CheckoutOptions) => RazorpayInstance }
}

export class CheckoutError extends Error {
  constructor(public readonly code: string) { super(code); }
}

let scriptPromise: Promise<void> | null = null;
let checkoutOpen = false;
const PENDING_KEY = "accelute:pending-purchase";

function rememberPending(purchaseId: string): void {
  try { sessionStorage.setItem(PENDING_KEY, purchaseId); } catch { /* storage may be blocked */ }
}
export function pendingPurchaseId(): string | null {
  try { return sessionStorage.getItem(PENDING_KEY); } catch { return null; }
}
export function clearPendingPurchase(): void {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* storage may be blocked */ }
}

export function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    const fail = () => { clearTimeout(timer); script.remove(); reject(new CheckoutError("checkout_load_failed")); };
    const timer = setTimeout(fail, 15_000);
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      if (window.Razorpay) resolve(); else fail();
    };
    document.head.appendChild(script);
  }).catch(error => { scriptPromise = null; throw error; });
  return scriptPromise;
}

export async function checkPendingPurchase(purchaseId: string): Promise<"paid" | "pending" | "refunded"> {
  const response = await fetch(resolveApiUrl(`/api/billing/razorpay/status?purchaseId=${encodeURIComponent(purchaseId)}`), {
    credentials: "include", cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json() as { status?: string; code?: string };
  if (!response.ok) throw new CheckoutError(payload.code ?? "payments_unavailable");
  if (payload.status === "expired") throw new CheckoutError("checkout_expired");
  if (payload.status === "preparing") throw new CheckoutError("checkout_preparing");
  if (payload.status === "paid" || payload.status === "refunded") { clearPendingPurchase(); return payload.status; }
  return "pending";
}

async function confirmPayment(purchaseId: string, response: CheckoutResponse): Promise<void> {
  try {
    const verified = await fetch(resolveApiUrl("/api/billing/razorpay/verify"), {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ purchaseId, ...response }), signal: AbortSignal.timeout(20_000),
    });
    const body = await verified.json() as { status?: string };
    if (verified.ok && body.status === "paid") { clearPendingPurchase(); return; }
    if (verified.ok && body.status === "refunded") throw new CheckoutError("payment_refunded");
  } catch (error) { if (error instanceof CheckoutError) throw error; }
  // A signed webhook may have completed the purchase despite a lost callback.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const status = await checkPendingPurchase(purchaseId);
      if (status === "paid") return;
      if (status === "refunded") throw new CheckoutError("payment_refunded");
    } catch (error) { if (error instanceof CheckoutError && error.code === "payment_refunded") throw error; }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new CheckoutError("payment_pending");
}

export async function openRazorpayCheckout(checkout: RazorpayCheckout): Promise<boolean> {
  if (checkoutOpen) throw new CheckoutError("checkout_in_progress");
  checkoutOpen = true;
  try {
    // Load before creating a pending marker: an SDK failure is not a payment.
    await loadRazorpayCheckout();
    rememberPending(checkout.purchaseId);
    return await new Promise<boolean>((resolve, reject) => {
      let confirming = false;
      const sdk = new window.Razorpay!({
        key: checkout.keyId, order_id: checkout.orderId, amount: checkout.amount, currency: checkout.currency,
        name: "Accelute", description: checkout.planId === "lesson_top_up" ? "Added credits" : "Plus — one month",
        theme: { color: "#3399cc" },
        handler: response => {
          if (confirming) return;
          confirming = true;
          void confirmPayment(checkout.purchaseId, response).then(() => resolve(true), reject);
        },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            if (confirming) return;
            confirming = true;
            // Closing during a slow bank response must not claim the payment failed.
            void checkPendingPurchase(checkout.purchaseId).then(status => resolve(status === "paid"), () => resolve(false));
          },
        },
      });
      sdk.open();
    });
  } finally { checkoutOpen = false; }
}
