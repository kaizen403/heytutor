import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  AutumnUnavailableError,
  ensureAutumnCustomer,
  loadCustomerSnapshot,
  unlimitedSnapshot,
} from "@/lib/billing/autumnClient";
import { BILLING_PLANS, isKnownPlanId } from "@/lib/billing/catalog";
import { billingResponse } from "@/lib/billing/errors";
import { isSpendActor, requireSpendActor } from "@/lib/billing/gate";
import { cacheUsageOnUser, loadPeriodBalance } from "@/lib/billing/ledger";

function entitlementJson(input: {
  planId: string;
  remainingPct: number | null;
  nextResetAt: number | null;
  staff: boolean;
}) {
  return {
    remainingPct: input.remainingPct,
    planId: input.planId,
    nextResetAt: input.nextResetAt,
    staff: input.staff,
  };
}

export async function GET(request: Request): Promise<Response> {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;

  if (actor.skipGates) {
    const snapshot = unlimitedSnapshot();
    return NextResponse.json(
      entitlementJson({
        planId: snapshot.planId,
        remainingPct: null,
        nextResetAt: null,
        staff: actor.staff,
      }),
    );
  }

  try {
    let planId: "free" | "plus" | "pro" = BILLING_PLANS.free;
    if (!actor.skipAutumn) {
      await ensureAutumnCustomer({ userId: actor.userId, email: actor.email });
      const snapshot = await loadCustomerSnapshot({ userId: actor.userId });
      if (isKnownPlanId(snapshot.planId)) planId = snapshot.planId;
    } else {
      const row = await prisma.user.findUnique({
        where: { id: actor.userId },
        select: { planId: true },
      });
      if (isKnownPlanId(row?.planId)) planId = row.planId;
    }
    const balance = await loadPeriodBalance({ userId: actor.userId, planId });
    void cacheUsageOnUser({
      userId: actor.userId,
      planId,
      remainingPct: balance.remainingPct,
    }).catch(() => undefined);
    return NextResponse.json(
      entitlementJson({
        planId,
        remainingPct: balance.remainingPct,
        nextResetAt: balance.nextResetAt,
        staff: false,
      }),
    );
  } catch (error) {
    if (error instanceof AutumnUnavailableError) {
      return billingResponse("autumn_unavailable", null, error.message);
    }
    throw error;
  }
}
