import { TOP_UP_USD } from "@/lib/billing/catalog";
import { isSpendActor, requireSpendActor } from "@/lib/billing/gate";
import { usesRazorpay, PaymentError, paymentErrorResponse } from "@/lib/billing/razorpayConfig";
import { createRazorpayCheckout } from "@/lib/billing/razorpayPurchases";
import { readPaymentJson, UUID_PATTERN } from "@/lib/billing/paymentRequest";

export async function POST(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  if (actor.skipGates) {
    return Response.json({ url: null, skipped: true, usd: TOP_UP_USD });
  }
  if (usesRazorpay()) {
    try {
      const body = await readPaymentJson(request);
      if (typeof body.idempotencyKey !== "string" || !UUID_PATTERN.test(body.idempotencyKey)) throw new PaymentError("invalid_request", 400);
      return Response.json({ checkout: await createRazorpayCheckout(actor.userId, "lesson_top_up", body.idempotencyKey, body.quote) }, { headers: { "cache-control": "no-store" } });
    } catch (error) { return paymentErrorResponse(error); }
  }
  return paymentErrorResponse(new PaymentError("payments_unavailable"));
}
