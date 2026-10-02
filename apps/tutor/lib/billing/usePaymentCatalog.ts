"use client";

import { useEffect, useState } from "react";
import { getLandingHref } from "../site";
import type { CheckoutCurrency, PaymentCatalog } from "./paymentCatalog";

const PREFERENCE = "accelute:checkout-currency";
function browserCurrency(): CheckoutCurrency {
  try {
    const stored = localStorage.getItem(PREFERENCE);
    if (stored === "USD" || stored === "INR") return stored;
  } catch { /* private browsing still supports checkout */ }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return ["Asia/Kolkata", "Asia/Calcutta"].includes(zone) || navigator.language.endsWith("-IN") ? "INR" : "USD";
}

export function usePaymentCatalog() {
  const [catalog, setCatalog] = useState<PaymentCatalog | null>(null);
  const [currency, setCurrency] = useState<CheckoutCurrency | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const resolve = async () => {
      const parameter = new URLSearchParams(window.location.search).get("currency");
      let preferred: string | null = parameter === "INR" || parameter === "USD" ? parameter : null;
      try { preferred ??= localStorage.getItem(PREFERENCE); } catch { /* optional preference */ }
      if (preferred === "INR" || preferred === "USD") {
        if (parameter === preferred) {
          try { localStorage.setItem(PREFERENCE, preferred); } catch { /* optional preference */ }
        }
        setCurrency(preferred);
        return;
      }
      try {
        const response = await fetch(getLandingHref("/api/region"), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]), credentials: "omit" });
        const value = await response.json() as { country?: unknown };
        if (response.ok && typeof value.country === "string" && /^[A-Z]{2}$/.test(value.country)) {
          if (!controller.signal.aborted) setCurrency(value.country === "IN" ? "INR" : "USD");
          return;
        }
      } catch { /* fallback if the hosting country signal is unavailable */ }
      if (!controller.signal.aborted) setCurrency(browserCurrency());
    };
    void resolve();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!currency) return;
    const controller = new AbortController();
    void fetch(`/api/billing/catalog?currency=${currency}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
      .then(async response => {
        if (!response.ok) throw new Error();
        const value = await response.json() as PaymentCatalog;
        if (!controller.signal.aborted) { setCatalog(value); setFailed(false); }
      }).catch(() => { if (!controller.signal.aborted) { setCatalog(null); setFailed(true); } });
    return () => controller.abort();
  }, [currency, revision]);
  const selectCurrency = (value: CheckoutCurrency) => {
    if (value === currency) return;
    setCatalog(null);
    setFailed(false);
    setCurrency(value);
    try { localStorage.setItem(PREFERENCE, value); } catch { /* optional preference */ }
    const url = new URL(window.location.href);
    url.searchParams.set("currency", value);
    window.history.replaceState(window.history.state, "", url);
  };
  return { catalog, currency, failed, selectCurrency, refresh: () => {
    setCatalog(null);
    setFailed(false);
    setRevision(value => value + 1);
  } };
}
