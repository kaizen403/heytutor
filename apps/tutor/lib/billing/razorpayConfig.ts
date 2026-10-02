import { razorpayOffer } from "./razorpayProtocol";

export function usesRazorpay(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BILLING_PROVIDER?.trim().toLowerCase() === "razorpay";
}

export function razorpayTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RAZORPAY_KEY_ID?.trim().startsWith("rzp_test_") ?? env.NODE_ENV !== "production";
}

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  testMode: boolean;
}

export class PaymentError extends Error {
  constructor(public readonly code: string, public readonly status: number = 503) {
    super(code);
    this.name = "PaymentError";
  }
}

export function requireRazorpayConfig(env: NodeJS.ProcessEnv = process.env): RazorpayConfig {
  const keyId = env.RAZORPAY_KEY_ID?.trim() ?? "";
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim() ?? "";
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "";
  if (!usesRazorpay(env) || !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId) || !keySecret || !webhookSecret) {
    throw new PaymentError("payments_unavailable");
  }
  const testMode = razorpayTestMode(env);
  if (env.NODE_ENV === "production" && testMode && env.RAZORPAY_ALLOW_TEST_MODE !== "1") {
    throw new PaymentError("payments_unavailable");
  }
  try {
    for (const planId of ["plus", "lesson_top_up"] as const) razorpayOffer(planId);
  } catch {
    throw new PaymentError("payments_unavailable");
  }
  return { keyId, keySecret, webhookSecret, testMode };
}

export function razorpayReady(env: NodeJS.ProcessEnv = process.env): boolean {
  try { requireRazorpayConfig(env); return true; } catch { return false; }
}

export function razorpayCurrencyEnabled(currency: "USD" | "INR", env: NodeJS.ProcessEnv = process.env): boolean {
  return razorpayReady(env) && (currency === "INR" || razorpayTestMode(env) || env.RAZORPAY_USD_ENABLED === "1");
}

export function paymentErrorResponse(error: unknown): Response {
  const failure = error instanceof PaymentError ? error : new PaymentError("payments_unavailable");
  // Provider bodies and credentials never reach logs or the browser.
  if (!(error instanceof PaymentError)) console.error("[billing] payment operation failed");
  return Response.json({ code: failure.code, remaining: null }, { status: failure.status });
}
