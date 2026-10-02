import { isCheckoutPlanId } from "@/lib/billing/catalog";
import { isSpendActor, requireSpendActor } from "@/lib/billing/gate";
import { usesRazorpay, PaymentError, paymentErrorResponse } from "@/lib/billing/razorpayConfig";
import { createRazorpayCheckout } from "@/lib/billing/razorpayPurchases";
import { readPaymentJson, UUID_PATTERN } from "@/lib/billing/paymentRequest";

export async function POST(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  if (actor.skipGates) {
    return Response.json({ url: null, skipped: true });
  }
  if (usesRazorpay()) {
    try {
      const body = await readPaymentJson(request);
      if (typeof body.planId !== "string" || !isCheckoutPlanId(body.planId) || typeof body.idempotencyKey !== "string" || !UUID_PATTERN.test(body.idempotencyKey)) {
        throw new PaymentError("invalid_request", 400);
      }
      const checkout = await createRazorpayCheckout(actor.userId, body.planId, body.idempotencyKey, body.quote);
      return Response.json({ checkout }, { headers: { "cache-control": "no-store" } });
    } catch (error) { return paymentErrorResponse(error); }
  }
  return paymentErrorResponse(new PaymentError("payments_unavailable"));
}
