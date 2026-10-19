import { beginTurnFromRequest } from "@/lib/billing/gate";
import { billingResponse } from "@/lib/billing/errors";
import { cacheUsageOnUser } from "@/lib/billing/ledger";
import { resolveDiagramStrictSubjects } from "@/lib/scene/diagramStrategy.server";
import { resolveLlmEndpoint } from "@/lib/llm/llmProvider";
import { resolvePlannerTimingProfile } from "@/lib/llm/plannerTiming";

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const result = await beginTurnFromRequest(request);
  if (result instanceof Response) {
    console.error(`[billing] begin-turn denied ${result.status} ${Date.now() - startedAt}ms`);
    return result;
  }
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
  const plannerTiming = resolvePlannerTimingProfile(resolveLlmEndpoint().provider);
  return Response.json({
    remainingPct: result.remainingPct,
    remaining: result.remainingPct,
    planId: result.planId,
    nextResetAt: result.nextResetAt,
    ttsCharsRemaining: result.grant.ttsCharsRemaining,
    diagramStrategy: result.diagramStrategy,
    diagramStrictSubjects: resolveDiagramStrictSubjects(),
    ...(plannerTiming ? { plannerTiming } : {}),
  });
}
