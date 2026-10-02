import { PaymentError, requireRazorpayConfig } from "./razorpayConfig";
import { isProviderId, readPayment, type PaymentOffer, type RazorpayPayment } from "./razorpayProtocol";

async function api(path: string, body?: unknown): Promise<unknown> {
  const config = requireRazorpayConfig();
  try {
    const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new PaymentError("payments_unavailable");
    return await response.json();
  } catch {
    throw new PaymentError("payments_unavailable");
  }
}

function readOrderId(value: unknown, offer: { amount: number; currency: string }, receipt: string): string {
  if (!value || typeof value !== "object") throw new PaymentError("payments_unavailable");
  const order = value as Record<string, unknown>;
  if (!isProviderId(order.id, "order") || order.amount !== offer.amount || order.currency !== offer.currency || order.receipt !== receipt) {
    throw new PaymentError("payments_unavailable");
  }
  return order.id;
}

export async function createRazorpayOrder(offer: PaymentOffer, receipt: string): Promise<string> {
  return readOrderId(await api("orders", {
    amount: offer.amount, currency: offer.currency, receipt, partial_payment: false,
    notes: { purchase_id: receipt, plan_id: offer.planId },
  }), offer, receipt);
}

/** Receipt filtering is a read-only Orders API operation. Require an exact
 * receipt and frozen price: substring matches or ambiguous orders are unsafe. */
export async function findRazorpayOrderByReceipt(offer: Pick<PaymentOffer, "amount" | "currency">, receipt: string): Promise<string | null> {
  const value = await api(`orders?receipt=${encodeURIComponent(receipt)}&count=100`);
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items) || value.items.length > 100) {
    throw new PaymentError("payments_unavailable");
  }
  const matches = value.items.filter(row => row && typeof row === "object" && row.receipt === receipt);
  if (matches.length > 1) throw new PaymentError("payments_unavailable");
  return matches.length ? readOrderId(matches[0], offer, receipt) : null;
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  if (!isProviderId(paymentId, "pay")) throw new PaymentError("invalid_payment", 400);
  try { return readPayment(await api(`payments/${paymentId}`)); }
  catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError("payments_unavailable");
  }
}

export async function fetchRazorpayOrderPayments(orderId: string): Promise<RazorpayPayment[]> {
  if (!isProviderId(orderId, "order")) throw new PaymentError("invalid_payment", 400);
  const value = await api(`orders/${orderId}/payments`);
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items)) {
    throw new PaymentError("payments_unavailable");
  }
  try { return value.items.map(readPayment); }
  catch { throw new PaymentError("payments_unavailable"); }
}
