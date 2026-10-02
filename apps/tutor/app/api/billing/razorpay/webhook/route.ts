import { PaymentError, paymentErrorResponse, requireRazorpayConfig } from "@/lib/billing/razorpayConfig";
import { readPaymentBody } from "@/lib/billing/paymentRequest";
import { isProviderId, verifyWebhookSignature } from "@/lib/billing/razorpayProtocol";
import { fetchRazorpayPayment } from "@/lib/billing/razorpayApi";
import { applyRazorpayPayment } from "@/lib/billing/razorpayPayments";

export async function POST(request: Request): Promise<Response> {
  try {
    const config = requireRazorpayConfig();
    const raw = await readPaymentBody(request);
    if (!verifyWebhookSignature(raw, request.headers.get("x-razorpay-signature") ?? "", config.webhookSecret)) throw new PaymentError("invalid_signature", 400);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw) as Record<string, unknown>; }
    catch { throw new PaymentError("invalid_request", 400); }
    if (!body || typeof body !== "object") throw new PaymentError("invalid_request", 400);
    if (!["payment.captured", "order.paid", "refund.processed"].includes(String(body.event))) return new Response(null, { status: 204 });
    const payload = body.payload as { payment?: { entity?: { id?: unknown } }; refund?: { entity?: { payment_id?: unknown } } } | undefined;
    const paymentId = payload?.payment?.entity?.id ?? payload?.refund?.entity?.payment_id;
    if (!isProviderId(paymentId, "pay")) throw new PaymentError("invalid_request", 400);
    const payment = await fetchRazorpayPayment(paymentId);
    try { await applyRazorpayPayment(payment); }
    catch (error) {
      if (error instanceof PaymentError && error.code === "payment_pending") throw new PaymentError("payments_unavailable");
      throw error;
    }
    return new Response(null, { status: 204 });
  } catch (error) { return paymentErrorResponse(error); }
}
