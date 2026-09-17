import { AutumnUnavailableError, openBillingPortal } from "@/lib/billing/autumnClient";
import { billingResponse } from "@/lib/billing/errors";
import { isAutumnEnabled } from "@/lib/billing/flags";
import { isSpendActor, requireSpendActor } from "@/lib/billing/gate";

function returnUrl(): string {
  const base = (process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/usage`;
}

export async function POST(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  if (actor.skipGates) {
    return Response.json({ url: null, skipped: true });
  }
  if (!isAutumnEnabled()) {
    return billingResponse("autumn_unavailable", null, "Autumn is disabled");
  }

  try {
    const result = await openBillingPortal({
      userId: actor.userId,
      returnUrl: returnUrl(),
    });
    return Response.json({ url: result.url });
  } catch (error) {
    if (error instanceof AutumnUnavailableError) {
      return billingResponse("autumn_unavailable", null, error.message);
    }
    throw error;
  }
}
