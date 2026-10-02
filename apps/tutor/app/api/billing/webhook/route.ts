import { isAutumnEnabled } from "@/lib/billing/flags";
import { usesRazorpay } from "@/lib/billing/razorpayConfig";
import { applyAutumnWebhookEvent } from "@/lib/billing/webhookCredit";
import { readBoundedText, RequestBodyError } from "@/lib/http/requestBody";
import {
  customerIdFromWebhookPayload,
  planIdFromWebhookPayload,
  readWebhookHeaders,
  verifyAutumnWebhookSignature,
} from "@/lib/billing/webhook";

export async function POST(request: Request): Promise<Response> {
  if (usesRazorpay()) return new Response(null, { status: 204 });
  let payload: string;
  try {
    payload = await readBoundedText(request);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid request body" }, { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  const secret = process.env.AUTUMN_WEBHOOK_SECRET?.trim();

  if (isAutumnEnabled() && !secret) {
    return Response.json({ error: "webhook secret missing" }, { status: 503 });
  }
  if (!secret) {
    return new Response(null, { status: 204 });
  }

  const headers = readWebhookHeaders(request.headers);
  if (
    !verifyAutumnWebhookSignature({
      payload,
      secret,
      svixId: headers.svixId,
      svixTimestamp: headers.svixTimestamp,
      svixSignature: headers.svixSignature,
    })
  ) {
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const customerId = customerIdFromWebhookPayload(parsed);
  const planId = planIdFromWebhookPayload(parsed);
  if (!customerId || !planId) {
    return new Response(null, { status: 204 });
  }

  await applyAutumnWebhookEvent({ eventId: headers.svixId, userId: customerId, planId });

  return new Response(null, { status: 204 });
}
