"use client";

import { PLAN_CATALOG, type CheckoutPlanId } from "@/lib/billing/catalog";
import {
  TEEN_CHECKOUT_COPY,
  TOP_UP_CTA,
  formatResetLabel,
  isTeenAgeBand,
  remainingPctBarWidth,
  remainingPctLabel,
} from "@/lib/billing/studentCopy";
import { useEntitlement } from "@/lib/billing/useEntitlement";
import { SiteButton } from "@/components/ui/site-button";
import { AccountCard } from "./AccountPageFrame";
import { type CheckoutCurrency, type PaymentCatalog, formatCheckoutPrice } from "@/lib/billing/paymentCatalog";
import { PaymentHistory } from "./PaymentHistory";
import { usePaymentCatalog } from "@/lib/billing/usePaymentCatalog";
import { useBillingActions } from "./useBillingActions";
import { PaymentCurrencyPicker } from "./PaymentCurrencyPicker";

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
  selectedPlan,
}: {
  compact?: boolean;
  ageBand?: string | null;
  onOpenUsage?: () => void;
  selectedPlan?: CheckoutPlanId | null;
}) {
  const { entitlement, loading } = useEntitlement();
  const { catalog, currency, failed, selectCurrency, refresh } = usePaymentCatalog();
  const { busy, error, notice, checkout, topUp, portal, revision } = useBillingActions(catalog, refresh);
  const razorpay = catalog?.provider === "razorpay";
  const staff = entitlement?.staff === true;
  const plan = PLAN_CATALOG[entitlement?.planId === "plus" || entitlement?.planId === "pro" ? entitlement.planId : "free"];
  const remainingPct = entitlement?.remainingPct ?? null;
  const teen = isTeenAgeBand(ageBand);
  const planLabel = staff ? "Staff" : plan.name;

  return (
    <AccountCard title="Your learning plan">
      {loading && !entitlement ? (
        <p className="text-sm text-[rgba(237,237,235,0.55)]">Loading plan…</p>
      ) : (
        <>
          <p className="text-sm text-frost">{planLabel}</p>
          <p className="mt-1 text-xs text-[rgba(237,237,235,0.5)]">{formatResetLabel(entitlement?.nextResetAt ?? null)}</p>
          <UsageMeter remainingPct={remainingPct} staff={staff} />
          {razorpay && !staff ? <p className="mt-3 text-xs text-white/50">One month per purchase. No automatic renewal. Added credits expire with the current usage period.</p> : null}
          {catalog?.testMode && !staff ? <p role="status" className="mt-2 text-xs text-sky-300">Test checkout — no real money is charged.</p> : null}
          {teen ? (
            <p className="mt-3 text-sm text-[rgba(237,237,235,0.62)]">{TEEN_CHECKOUT_COPY}</p>
          ) : null}
          {staff ? (
            <p className="mt-3 text-sm text-[rgba(237,237,235,0.62)]">Staff accounts are not billed.</p>
          ) : null}
        </>
      )}

      {!staff ? <div className="mt-4"><PaymentCurrencyPicker currency={currency} onChange={selectCurrency} disabled={busy !== null} /></div> : null}
      {failed ? <p role="status" className="mt-3 text-xs text-white/50">Could not load payment options. Please refresh to try again.</p> : null}
      {catalog && !catalog.available && !staff ? <p role="status" className="mt-3 text-xs text-white/50">{catalog.unavailableReason === "exchange_rate_unavailable" ? "Could not get a recent INR amount. Please try again shortly." : "Checkout is not available in this currency yet. You can keep using your current plan."}</p> : null}

      {compact ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!staff ? (
            <SiteButton size="sm" onClick={() => void portal()} disabled={busy !== null}>
              Purchase history
            </SiteButton>
          ) : null}
          {!staff ? <SiteButton size="sm" variant="sky" disabled={busy !== null || !catalog?.available || !catalog.plans.lesson_top_up} onClick={() => void topUp()}>
            {busy === "credits" ? "Opening checkout…" : `Add credits${catalog?.plans.lesson_top_up ? ` · ${formatCheckoutPrice(catalog.plans.lesson_top_up)}` : ""}`}
          </SiteButton> : null}
          {onOpenUsage ? (
            <SiteButton size="sm" onClick={onOpenUsage}>
              Upgrade now
            </SiteButton>
          ) : null}
        </div>
      ) : null}

      {!compact && !staff ? (
        <div className="mt-4 space-y-3">
          <div>
            <PlanOffer
              planId="plus"
              current={entitlement?.planId === "plus"}
              busy={busy}
              onCheckout={checkout}
              catalog={catalog}
              currency={currency}
              currentPlan={entitlement?.planId ?? "free"}
              selected={selectedPlan === "plus"}
            />

          </div>
          <div className="flex flex-wrap gap-2">
            <SiteButton
              size="sm"
              variant="sky"
              disabled={busy !== null || !catalog?.available}
              onClick={() => void topUp()}
            >
              {busy === "credits" ? "Opening checkout…" : catalog?.plans.lesson_top_up ? `Add credits · ${formatCheckoutPrice(catalog.plans.lesson_top_up)}` : currency === "USD" ? TOP_UP_CTA : "Add credits"}
            </SiteButton>
            <SiteButton size="sm" disabled={busy !== null} onClick={() => void portal()}>
              Purchase history
            </SiteButton>
          </div>
          {currency === "INR" && catalog?.fxDate ? <p className="text-xs text-white/50">INR equivalent of $29 · reference rate from {catalog.fxDate}. The amount above is the checkout total.</p> : null}
          {razorpay ? <PaymentHistory revision={revision} /> : null}
        </div>
      ) : null}

      {notice ? <p role="status" className="mt-3 text-sm text-sky-300">{notice}</p> : null}
      {error ? <p role="status" className="mt-3 text-sm text-[rgba(237,237,235,0.62)]">{error}</p> : null}
    </AccountCard>
  );
}

function PlanOffer({
  planId,
  current,
  busy,
  onCheckout,
  catalog,
  currency,
  currentPlan,
  selected,
}: {
  planId: CheckoutPlanId;
  current: boolean;
  busy: string | null;
  onCheckout: () => Promise<void>;
  catalog: PaymentCatalog | null;
  currency: CheckoutCurrency | null;
  currentPlan: string;
  selected: boolean;
}) {
  const plan = PLAN_CATALOG[planId];
  const razorpay = catalog?.provider === "razorpay";
  const price = catalog?.plans[planId];
  return (
    <div className={`rounded-xl border p-3 ${selected ? "border-sky-500/60" : "border-white/10"}`}>
      <p className="text-sm font-medium text-frost">{plan.name}</p>
      <p className="mt-1 text-lg text-frost">
        {price ? formatCheckoutPrice(price) : currency === "USD" ? `$${plan.priceUsdPerMonth}` : currency === "INR" ? catalog ? "INR amount unavailable" : "Checking INR amount…" : "Loading price…"}
        <span className="text-xs text-[rgba(237,237,235,0.5)]"> / month</span>
      </p>
      <SiteButton
        className="mt-3"
        size="sm"
        variant="sky"
        disabled={(!razorpay && current) || busy !== null || !catalog?.available || !price}
        onClick={() => void onCheckout()}
      >
        {busy === planId ? "Opening checkout…" : current && razorpay ? "Extend your month" : current ? "Current plan" : "Upgrade now"}
      </SiteButton>
      {razorpay ? <p className="mt-2 text-xs text-white/55">{current || (currentPlan === "pro" && planId === "plus") ? "Starts after your existing paid months." : "One month of access from payment confirmation."}</p> : null}
    </div>
  );
}
