import { prisma } from "@/lib/db/prisma";
import { isSpendActor, requireSpendActor } from "@/lib/billing/actor";
import { PaymentError, paymentErrorResponse, requireRazorpayConfig } from "@/lib/billing/razorpayConfig";
import { readPaymentJson, UUID_PATTERN } from "@/lib/billing/paymentRequest";
import { isProviderId, verifyCheckoutSignature } from "@/lib/billing/razorpayProtocol";
import { fetchRazorpayPayment } from "@/lib/billing/razorpayApi";
import { applyRazorpayPayment } from "@/lib/billing/razorpayPayments";

export async function POST(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  try {
    const config = requireRazorpayConfig();
    const body = await readPaymentJson(request);
    if (typeof body.purchaseId !== "string" || !UUID_PATTERN.test(body.purchaseId) || !isProviderId(body.razorpay_payment_id, "pay") || !isProviderId(body.razorpay_order_id, "order") || typeof body.razorpay_signature !== "string") {
      throw new PaymentError("invalid_payment", 400);
    }
    const purchase = await prisma.billingPurchase.findFirst({ where: { id: body.purchaseId, userId: actor.userId, testMode: config.testMode } });
    if (!purchase || !purchase.orderId || purchase.orderId !== body.razorpay_order_id || purchase.keyId !== config.keyId) throw new PaymentError("invalid_payment", 400);
    if (!verifyCheckoutSignature(purchase.orderId, body.razorpay_payment_id, body.razorpay_signature, config.keySecret)) throw new PaymentError("invalid_payment", 400);
    const payment = await fetchRazorpayPayment(body.razorpay_payment_id);
    if (payment.order_id !== purchase.orderId) throw new PaymentError("invalid_payment", 400);
    await applyRazorpayPayment(payment);
    const updated = await prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    return Response.json({ status: updated.status, purchaseId: purchase.id }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return paymentErrorResponse(error); }
}
