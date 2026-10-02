"use client";

import { useEffect, useState } from "react";
import { refreshPaidEntitlement } from "@/lib/billing/billingClient";
import { checkPendingPurchase, CheckoutError } from "@/lib/billing/razorpayCheckout";
import { formatCheckoutPrice } from "@/lib/billing/paymentCatalog";
import { studentBillingMessage } from "@/lib/billing/studentCopy";
import { SiteButton } from "@/components/ui/site-button";

interface Purchase {
  id: string;
  planId: string;
  amount: number;
  currency: string;
  status: string;
  refundAmount: number;
  createdAt: string;
  accessStartsAt: string | null;
  accessEndsAt: string | null;
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function PaymentHistory({ revision }: { revision: number }) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/billing/razorpay/history", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { purchases: Purchase[] };
        setPurchases(data.purchases);
      }).catch(() => { if (!controller.signal.aborted) setMessage("Could not load purchase history. Please refresh to try again."); });
    return () => controller.abort();
  }, [revision, refresh]);
  const check = async (purchaseId: string) => {
    setBusy(purchaseId);
    setMessage(null);
    try {
      const status = await checkPendingPurchase(purchaseId);
      const refreshed = status !== "pending" && await refreshPaidEntitlement();
      setMessage(status === "paid" ? refreshed ? "Payment confirmed. Your plan and usage are updated." : "Payment confirmed. Refresh this page to update your usage; you do not need to pay again." : status === "refunded" ? "This payment was refunded." : "No completed payment yet. If money was deducted, wait a moment and check again.");
    } catch (error) { setMessage(studentBillingMessage(error instanceof CheckoutError ? error.code : "payments_unavailable")); }
    finally { setRefresh(value => value + 1); setBusy(null); }
  };
  return (
    <div id="purchase-history" className="mt-5 border-t border-white/10 pt-4">
      <h3 className="text-sm font-medium text-frost">Purchase history</h3>
      {purchases.length === 0 ? <p className="mt-2 text-xs text-white/50">Your purchases and checkout attempts will appear here.</p> : null}
      <ul className="mt-2 space-y-3">
        {purchases.map(purchase => (
          <li key={purchase.id} className="flex flex-wrap items-start justify-between gap-2 text-xs text-white/60">
            <div>
              <p className="text-sm text-frost">{purchase.planId === "lesson_top_up" ? "Added credits" : purchase.planId === "pro" ? "Pro" : "Plus"} · {formatCheckoutPrice(purchase)}</p>
              <p className="mt-1">{dateLabel(purchase.createdAt)} · {purchase.status === "paid" ? "Paid" : purchase.status === "refunded" ? "Refunded" : purchase.status === "preparing" ? "Preparing checkout" : purchase.status === "expired" ? "Checkout expired" : "Awaiting payment"}</p>
              {purchase.status === "paid" && purchase.accessStartsAt && purchase.accessEndsAt ? <p>{dateLabel(purchase.accessStartsAt)}–{dateLabel(purchase.accessEndsAt)}</p> : null}
              {purchase.refundAmount > 0 && purchase.status !== "refunded" ? <p>Refunded {formatCheckoutPrice({ amount: purchase.refundAmount, currency: purchase.currency })}</p> : null}
              <p className="mt-1 break-all text-[11px] text-white/55">Reference: {purchase.id}</p>
            </div>
            {["pending", "preparing", "expired"].includes(purchase.status) ? <SiteButton size="sm" disabled={busy !== null} onClick={() => void check(purchase.id)}>{busy === purchase.id ? "Checking…" : purchase.status === "pending" ? "Check payment" : "Check checkout"}</SiteButton> : null}
          </li>
        ))}
      </ul>
      {message ? <p role="status" className="mt-3 text-sm text-white/60">{message}</p> : null}
    </div>
  );
}
