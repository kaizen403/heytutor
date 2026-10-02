import { isSpendActor, requireSpendActor } from "@/lib/billing/actor";
import { PaymentError, paymentErrorResponse, requireRazorpayConfig } from "@/lib/billing/razorpayConfig";
import { reconcileRazorpayPurchase } from "@/lib/billing/razorpayPayments";
import { UUID_PATTERN } from "@/lib/billing/paymentRequest";

export async function GET(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  try {
    requireRazorpayConfig();
    const purchaseId = new URL(request.url).searchParams.get("purchaseId");
    if (!purchaseId || !UUID_PATTERN.test(purchaseId)) throw new PaymentError("invalid_request", 400);
    return Response.json(await reconcileRazorpayPurchase(actor.userId, purchaseId), { headers: { "cache-control": "no-store" } });
  } catch (error) { return paymentErrorResponse(error); }
}
