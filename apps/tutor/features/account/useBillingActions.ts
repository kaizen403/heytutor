"use client";
import { useEffect, useRef, useState } from "react";
import { followBillingRedirect, openCustomerPortal, startCheckout, startTopUp, refreshPaidEntitlement, type BillingRedirect } from "@/lib/billing/billingClient";
import { checkPendingPurchase, CheckoutError, pendingPurchaseId } from "@/lib/billing/razorpayCheckout";
import type { PaymentCatalog } from "@/lib/billing/paymentCatalog";
import { studentBillingMessage } from "@/lib/billing/studentCopy";

export function useBillingActions(catalog: PaymentCatalog | null, refreshCatalog: () => void) {
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const running = useRef(false);
  useEffect(() => {
    const purchaseId = pendingPurchaseId();
    if (!purchaseId) return;
    let active = true;
    void checkPendingPurchase(purchaseId).then(async status => {
      if (!active) return;
      if (status === "paid") {
        const refreshed = await refreshPaidEntitlement();
        if (!active) return;
        if (!refreshed) setNotice("Payment confirmed. Refresh this page to update your usage; you do not need to pay again.");
        setRevision(value => value + 1);
      } else if (status === "pending") setError("A checkout is awaiting confirmation. Use Check payment in your purchase history if you completed it.");
    }).catch(() => { /* history offers an explicit recovery button */ });
    return () => { active = false; };
  }, []);
  const run = async (label: string, work: () => Promise<BillingRedirect>) => {
    if (running.current) return;
    running.current = true;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const result = await work();
      if (!result.ok) {
        setError(studentBillingMessage(result.code));
        if (["price_changed", "invalid_quote"].includes(result.code)) refreshCatalog();
        return;
      }
      if ("skipped" in result && result.skipped) return;
      const completed = await followBillingRedirect(result);
      if (completed === "paid_refresh_needed") setNotice("Payment confirmed. Refresh this page to update your plan and usage. Your purchase is recorded; you do not need to pay again.");
      else if (!completed) setError("Checkout closed. If you completed a payment, check its status in your purchase history.");
      else if ("checkout" in result) setNotice("Payment confirmed. You can view it in your purchase history.");
      setRevision(value => value + 1);
    } catch (error) {
      setError(error instanceof CheckoutError ? studentBillingMessage(error.code) : "Could not open checkout. Check your connection and try again.");
      setRevision(value => value + 1);
    } finally { running.current = false; setBusy(null); }
  };
  return { busy, error, notice, revision,
    checkout: () => run("plus", () => startCheckout("plus", catalog?.plans.plus?.quote)),
    topUp: () => run("credits", () => startTopUp(catalog?.plans.lesson_top_up?.quote)),
    portal: () => run("portal", () => openCustomerPortal()),
  };
}
