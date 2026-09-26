"use client";

import { useState } from "react";
import {
  followBillingRedirect,
  openCustomerPortal,
  startCheckout,
  startTopUp,
  type BillingRedirect,
} from "@/lib/billing/billingClient";
import { PLAN_CATALOG, type CheckoutPlanId } from "@/lib/billing/catalog";
import {
  TEEN_CHECKOUT_COPY,
  TOP_UP_CTA,
  UPGRADE_LABEL,
  formatResetLabel,
  isTeenAgeBand,
  remainingPctBarWidth,
  remainingPctLabel,
  studentBillingMessage,
} from "@/lib/billing/studentCopy";
import { useEntitlement } from "@/lib/billing/useEntitlement";
import { SiteButton } from "@/components/ui/site-button";
import { AccountCard } from "./AccountPageFrame";

function UsageMeter({
  remainingPct,
  staff,
}: {
  remainingPct: number | null;
  staff?: boolean;
}) {
  const width = remainingPctBarWidth(remainingPct, { staff });
  const label = remainingPctLabel(remainingPct, { staff });
  return (
    <div className="mt-3">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.1)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-sky-500"
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-frost">{label}</p>
    </div>
  );
}

export function PlanUsageCard({
  compact = false,
  ageBand,
  onOpenUsage,
}: {
  compact?: boolean;
  ageBand?: string | null;
  onOpenUsage?: () => void;
}) {
  const { entitlement, loading } = useEntitlement();
  const { busy, error, checkout, topUp, portal } = useBillingActions();
  const staff = entitlement?.staff === true;
  const plan = PLAN_CATALOG[entitlement?.planId === "plus" || entitlement?.planId === "pro" ? entitlement.planId : "free"];
  const remainingPct = entitlement?.remainingPct ?? null;
  const teen = isTeenAgeBand(ageBand);
  const planLabel = staff ? "Staff" : plan.name;

  return (
    <AccountCard title="Plan and usage">
      {loading && !entitlement ? (
        <p className="text-sm text-[rgba(237,237,235,0.55)]">Loading plan…</p>
      ) : (
        <>
          <p className="text-sm text-frost">{planLabel}</p>
          <p className="mt-1 text-xs text-[rgba(237,237,235,0.5)]">{formatResetLabel(entitlement?.nextResetAt ?? null)}</p>
          <UsageMeter remainingPct={remainingPct} staff={staff} />
          {teen ? (
            <p className="mt-3 text-sm text-[rgba(237,237,235,0.62)]">{TEEN_CHECKOUT_COPY}</p>
          ) : null}
          {staff ? (
            <p className="mt-3 text-sm text-[rgba(237,237,235,0.62)]">Staff accounts are not billed.</p>
          ) : null}
        </>
      )}

      {compact ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!staff ? (
            <SiteButton size="sm" onClick={() => void portal()} disabled={busy !== null}>
              Manage billing
            </SiteButton>
          ) : null}
          {onOpenUsage ? (
            <SiteButton size="sm" onClick={onOpenUsage}>
              Open usage
            </SiteButton>
          ) : null}
        </div>
      ) : null}

      {!compact && !staff ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <PlanOffer
              planId="plus"
              current={entitlement?.planId === "plus"}
              busy={busy}
              onCheckout={checkout}
            />
            <PlanOffer
              planId="pro"
              current={entitlement?.planId === "pro"}
              busy={busy}
              onCheckout={checkout}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <SiteButton
              size="sm"
              variant="sky"
              disabled={busy !== null}
              onClick={() => void topUp()}
            >
              {TOP_UP_CTA}
            </SiteButton>
            <SiteButton size="sm" disabled={busy !== null} onClick={() => void portal()}>
              Manage billing
            </SiteButton>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-[rgba(237,237,235,0.62)]">{error}</p> : null}
    </AccountCard>
  );
}

function PlanOffer({
  planId,
  current,
  busy,
  onCheckout,
}: {
  planId: CheckoutPlanId;
  current: boolean;
  busy: string | null;
  onCheckout: (planId: CheckoutPlanId) => Promise<void>;
}) {
  const plan = PLAN_CATALOG[planId];
  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.08)] p-3">
      <p className="text-sm font-medium text-frost">{plan.name}</p>
      <p className="mt-1 text-lg text-frost">
        ${plan.priceUsdPerMonth}
        <span className="text-xs text-[rgba(237,237,235,0.5)]"> / month</span>
      </p>
      <SiteButton
        className="mt-3"
        size="sm"
        variant={planId === "plus" ? "sky" : "ghost"}
        disabled={current || busy !== null}
        onClick={() => void onCheckout(planId)}
      >
        {current ? "Current plan" : `${UPGRADE_LABEL} to ${plan.name}`}
      </SiteButton>
    </div>
  );
}

function useBillingActions() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, work: () => Promise<BillingRedirect>) => {
    setBusy(label);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) {
        setError(studentBillingMessage(result.code));
        return;
      }
      if ("skipped" in result && result.skipped) {
        return;
      }
      await followBillingRedirect(result);
    } catch {
      setError("Could not open billing.");
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    error,
    checkout: (planId: CheckoutPlanId) => run(planId, () => startCheckout(planId)),
    topUp: () => run("top-up", () => startTopUp()),
    portal: () => run("portal", () => openCustomerPortal()),
  };
}
