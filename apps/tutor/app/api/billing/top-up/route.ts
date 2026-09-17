import { AutumnUnavailableError, attachTopUp } from "@/lib/billing/autumnClient";
import { TOP_UP_USD } from "@/lib/billing/catalog";
import { billingResponse } from "@/lib/billing/errors";
import { isAutumnEnabled } from "@/lib/billing/flags";
import { isSpendActor, requireSpendActor } from "@/lib/billing/gate";

function successUrl(): string {
  const base = (process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/usage`;
}

export async function POST(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  if (actor.skipGates) {
    return Response.json({ url: null, skipped: true, usd: TOP_UP_USD });
  }
  if (!isAutumnEnabled()) {
    return billingResponse("autumn_unavailable", null, "Autumn is disabled");
  }

  try {
    const result = await attachTopUp({
      userId: actor.userId,
      successUrl: successUrl(),
    });
    return Response.json({ url: result.url, usd: TOP_UP_USD });
  } catch (error) {
    if (error instanceof AutumnUnavailableError) {
      return billingResponse("autumn_unavailable", null, error.message);
    }
    throw error;
  }
}
