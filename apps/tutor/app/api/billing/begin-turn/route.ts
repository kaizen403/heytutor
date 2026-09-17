import { beginTurnFromRequest } from "@/lib/billing/gate";
import { billingResponse } from "@/lib/billing/errors";
import { cacheUsageOnUser } from "@/lib/billing/ledger";

export async function POST(request: Request): Promise<Response> {
  const result = await beginTurnFromRequest(request);
  if (result instanceof Response) return result;
  if (!result.grant) {
    return billingResponse("no_grant", result.remainingPct);
  }
  void cacheUsageOnUser({
    userId: result.grant.userId,
    planId: result.planId,
    remainingPct: result.remainingPct,
  }).catch((error) => {
    console.error("[billing] cache update failed", error);
  });
  return Response.json({
    remainingPct: result.remainingPct,
    remaining: result.remainingPct,
    planId: result.planId,
    nextResetAt: result.nextResetAt,
    ttsCharsRemaining: result.grant.ttsCharsRemaining,
  });
}
