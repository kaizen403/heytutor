import { prisma } from "@/lib/db/prisma";
import { BILLING_PLANS, TOP_UP_USD, isKnownPlanId } from "@/lib/billing/catalog";
import { isAutumnEnabled } from "@/lib/billing/flags";
import { addPeriodBonusUsd } from "@/lib/billing/ledger";
import {
  customerIdFromWebhookPayload,
  planIdFromWebhookPayload,
  readWebhookHeaders,
  verifyAutumnWebhookSignature,
} from "@/lib/billing/webhook";

export async function POST(request: Request): Promise<Response> {
  const payload = await request.text();
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

  if (planId === BILLING_PLANS.lessonTopUp) {
    const user = await prisma.user.findUnique({
      where: { id: customerId },
      select: { planId: true },
    });
    const knownPlan = isKnownPlanId(user?.planId) ? user.planId : BILLING_PLANS.free;
    await addPeriodBonusUsd({
      userId: customerId,
      planId: knownPlan,
      usd: TOP_UP_USD,
    });
    return new Response(null, { status: 204 });
  }

  await prisma.user.updateMany({
    where: { id: customerId },
    data: { planId },
  });

  return new Response(null, { status: 204 });
}
